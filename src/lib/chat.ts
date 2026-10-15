import type { TranscriptDoc } from './types';
import { docDisplayText, formatMMSS } from './utils';
import { getAuthToken } from './auth';
import {
  SUMMARY_MODEL_PRIMARY,
  SummaryError,
  getConfiguredApiKey,
  getProxyUrl,
  readOpenRouterStream,
} from './summarize';

// ---------------------------------------------------------------------------
// Transcript-grounded chat ("Ask this video").
//
// Speed design (free models only):
//  - Fast-first model order: a nimble 27B chat model leads
//    (~1.4s first answer in independent Sept-2026 probes), a sub-second
//    agent model is second, and the big 550B reasoner stays as the quality
//    fallback — not the default.
//  - `provider: { sort: 'throughput' }` routes every request to the fastest
//    OpenRouter provider serving that model.
//  - Relevance-picked context (~12k chars of the cues that actually match the
//    question) instead of dumping up to 60k chars through the model.
//  - Server-sent-events streaming end to end, so the first tokens render
//    while the rest generate.
//
// Same key story as summaries: proxy configured → POST /chat with the auth
// JWT (key stays server-side); otherwise direct OpenRouter with the user's
// own key.
// ---------------------------------------------------------------------------

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface OpenRouterMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Fast chat models first; the big reasoner is the quality fallback. */
export const CHAT_MODEL_PRIMARY =
  ((import.meta.env.VITE_OPENROUTER_CHAT_MODEL as string | undefined)?.trim() ||
    'qwen/qwen3.8-27b:free');

export const CHAT_MODEL_FALLBACKS = [
  'poolside/laguna-s-2.1:free',
  SUMMARY_MODEL_PRIMARY,
  'openrouter/auto',
] as const;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Safety net only — retrieval below normally sends ~12k chars. */
const MAX_TRANSCRIPT_CHARS = 30_000;
/** Relevance-picked excerpts stay small so prefill is fast. */
const MAX_EXCERPT_CHARS = 12_000;
const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 2_000;
/** Short answers stream faster and suit chat. */
const CHAT_MAX_TOKENS = 1000;

export const CHAT_SYSTEM_PROMPT =
  'You are Nukuzaa, a precise assistant that answers questions about ONE specific YouTube video. ' +
  'Answer ONLY from the transcript excerpts provided — never invent facts, and never use outside knowledge except to explain what the transcript says. ' +
  'If the excerpts do not contain the answer, say so plainly and suggest what the viewer could search for instead. ' +
  'When you reference a specific moment, cite it as [MM:SS] (or [H:MM:SS] for long videos) using the timestamps in the excerpts. ' +
  'Keep answers concise but complete, in clean Markdown (short paragraphs, bullets where helpful). No preamble about being an AI.';

/** Broad "tell me about the video" questions need head+tail, not keyword hits. */
const SUMMARY_INTENT =
  /summar|tl;?\s?dr|overview|key points?|takeaways?|main topics?|what(?:'s| is) (?:this|the) video about|about this video|entire video|whole video/i;

const STOPWORDS = new Set(
  'what,when,where,which,who,whom,whose,will,shall,should,would,could,can,there,their,about,from,that,this,these,those,with,have,has,had,were,was,are,but,not,you,your,the,and,for,how,why,explain,tell,give,say,said,says,mean,means'.split(','),
);

function cueLine(start: number, text: string): string {
  return `[${formatMMSS(start)}] ${text}`;
}

function headTailCues(doc: TranscriptDoc, cap: number): string {
  const lines = doc.captions.map((c) => cueLine(c.start, c.text));
  const joined = lines.join('\n');
  if (joined.length <= cap) return joined;
  const head = Math.floor(cap * 0.7);
  const tail = cap - head;
  return `${joined.slice(0, head)}\n\n[… middle omitted …]\n\n${joined.slice(joined.length - tail)}`;
}

/**
 * Pick the transcript lines most likely to answer the question: score cues
 * by keyword overlap, keep the winners plus immediate neighbours (so
 * citations stay in context) and the opening lines (so "who/what is this"
 * still resolves). Falls back to head+tail for summary-style questions.
 */
export function buildChatContext(doc: TranscriptDoc, question: string): { context: string; excerpted: boolean } {
  if (doc.captions.length === 0) {
    const text = docDisplayText(doc).trim();
    if (text.length <= MAX_EXCERPT_CHARS) return { context: text, excerpted: false };
    const head = Math.floor(MAX_EXCERPT_CHARS * 0.7);
    return {
      context: `${text.slice(0, head)}\n\n[… middle omitted …]\n\n${text.slice(text.length - (MAX_EXCERPT_CHARS - head))}`,
      excerpted: true,
    };
  }

  if (SUMMARY_INTENT.test(question)) {
    return { context: headTailCues(doc, MAX_EXCERPT_CHARS), excerpted: true };
  }

  const words = question
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (words.length === 0) return { context: headTailCues(doc, MAX_EXCERPT_CHARS), excerpted: true };

  const scored = doc.captions.map((c, i) => {
    const lower = c.text.toLowerCase();
    let score = 0;
    for (const w of words) {
      let at = lower.indexOf(w);
      while (at !== -1) {
        // Whole-word hits count double; partial hits still count.
        const before = at === 0 || /[^a-z0-9]/.test(lower[at - 1]);
        const after = at + w.length >= lower.length || /[^a-z0-9]/.test(lower[at + w.length]);
        score += before && after ? 2 : 1;
        at = lower.indexOf(w, at + w.length);
      }
    }
    return { i, score };
  });

  const winners = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);
  if (winners.length === 0) return { context: headTailCues(doc, MAX_EXCERPT_CHARS), excerpted: true };

  const keep = new Set<number>();
  for (let k = 0; k < 6 && k < doc.captions.length; k++) keep.add(k); // intro context
  for (const w of winners) {
    keep.add(w.i);
    if (w.i > 0) keep.add(w.i - 1);
    if (w.i < doc.captions.length - 1) keep.add(w.i + 1);
  }

  const byScore = new Map(winners.map((w) => [w.i, w.score]));
  const ordered = [...keep].sort((a, b) => a - b);
  let lines = ordered.map((i) => cueLine(doc.captions[i].start, doc.captions[i].text));
  // Trim lowest-relevance lines first (never the intro) until it fits.
  if (lines.join('\n').length > MAX_EXCERPT_CHARS) {
    const droppable = ordered
      .filter((i) => i >= 6)
      .sort((a, b) => (byScore.get(a) ?? 0) - (byScore.get(b) ?? 0));
    const doomed = new Set(droppable);
    while (lines.join('\n').length > MAX_EXCERPT_CHARS && doomed.size > 0) {
      // Drop from the ends of the droppable set inward is overkill; drop all
      // below-median scores first, then re-check.
      const scores = [...doomed].map((i) => byScore.get(i) ?? 0).sort((x, y) => x - y);
      const cutoff = scores[Math.floor(scores.length / 2)] ?? 0;
      let removed = false;
      for (const i of [...doomed]) {
        if ((byScore.get(i) ?? 0) <= cutoff) {
          doomed.delete(i);
          removed = true;
        }
      }
      if (!removed) break;
      const remaining = ordered.filter((i) => i < 6 || doomed.has(i));
      lines = remaining.map((i) => cueLine(doc.captions[i].start, doc.captions[i].text));
    }
  }
  return { context: lines.join('\n'), excerpted: true };
}

/** Prefer timestamped cues so answers can cite moments; fall back to plain text. */
export function transcriptForChat(doc: TranscriptDoc): string {
  if (doc.captions.length > 0) {
    const joined = doc.captions.map((c) => cueLine(c.start, c.text)).join('\n');
    if (joined.trim()) return joined;
  }
  return docDisplayText(doc);
}

function clipHistory(history: ChatTurn[]): ChatTurn[] {
  return history
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({
      role: t.role,
      content: t.content.slice(0, MAX_TURN_CHARS),
    }))
    .filter((t) => t.content.trim().length > 0);
}

function buildContextBlock(title: string, excerpts: string): string {
  return [
    `Video title: ${title}`,
    '(Relevant excerpts from the transcript are below; answer from them. If they lack the answer, say so.)',
    '',
    '--- EXCERPTS START ---',
    excerpts,
    '--- EXCERPTS END ---',
  ].join('\n');
}

function openRouterBody(model: string, messages: OpenRouterMsg[]): Record<string, unknown> {
  return {
    model,
    messages,
    temperature: 0.4,
    max_tokens: CHAT_MAX_TOKENS,
    stream: true,
    // Route each request to the fastest provider serving this model.
    provider: { sort: 'throughput' },
  };
}

function throwStreamError(res: Response, bodyText: string): never {
  if (res.status === 401 || res.status === 403) {
    throw new SummaryError('MISSING_KEY', 'OpenRouter rejected the API key (invalid or revoked).');
  }
  if (res.status === 429) {
    throw new SummaryError('RATE_LIMIT', 'Free-model rate limit hit (20 req/min, 200/day). Wait a minute and retry.');
  }
  let detail = '';
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string }; message?: string };
    detail = j.error?.message ?? j.message ?? '';
  } catch {
    /* non-JSON error body */
  }
  throw new SummaryError('API', detail ? `OpenRouter error (HTTP ${res.status}): ${detail}` : `OpenRouter error: HTTP ${res.status}.`);
}

async function callOpenRouterStream(
  apiKey: string,
  model: string,
  messages: OpenRouterMsg[],
  onToken?: (partial: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Nukuzaa chat',
      },
      body: JSON.stringify(openRouterBody(model, messages)),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new SummaryError('NETWORK', e instanceof Error ? e.message : 'Network request failed.');
  }

  if (!res.ok || !res.body) {
    let text = '';
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    throwStreamError(res, text);
  }
  const out = await readOpenRouterStream(res, onToken, signal);
  return { text: out.text, model: out.model ?? model };
}

/**
 * Ask a question grounded in one transcript. Streams tokens via `onToken`
 * and resolves with the full answer + model used. Pass an AbortSignal to
 * let the user stop generation.
 */
export async function askTranscriptQuestion(
  doc: TranscriptDoc,
  history: ChatTurn[],
  question: string,
  opts?: { apiKey?: string; signal?: AbortSignal; onToken?: (partial: string) => void },
): Promise<{ answer: string; model: string; truncated: boolean }> {
  const q = question.trim();
  if (!q) throw new SummaryError('EMPTY', 'Type a question first.');
  const raw = transcriptForChat(doc).trim();
  if (!raw) throw new SummaryError('EMPTY', 'This transcript has no text to chat about yet.');

  const { context, excerpted } = buildChatContext(doc, q);
  const clippedHistory = clipHistory(history);

  const proxy = getProxyUrl();
  if (proxy) return requestViaProxy(proxy, doc, context, excerpted, clippedHistory, q, opts);

  return requestDirect(doc, context, excerpted, clippedHistory, q, opts);
}

async function requestViaProxy(
  proxy: string,
  doc: TranscriptDoc,
  excerpts: string,
  excerpted: boolean,
  history: ChatTurn[],
  question: string,
  opts?: { signal?: AbortSignal; onToken?: (partial: string) => void },
): Promise<{ answer: string; model: string; truncated: boolean }> {
  let token: string;
  try {
    token = await getAuthToken();
  } catch {
    throw new SummaryError('MISSING_KEY', 'Session expired — please sign in again.');
  }

  let res: Response;
  try {
    res = await fetch(`${proxy}/chat`, {
      method: 'POST',
      signal: opts?.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: doc.title.slice(0, 300),
        transcript: excerpts.slice(0, MAX_TRANSCRIPT_CHARS),
        history,
        question: question.slice(0, 4000),
      }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new SummaryError('NETWORK', e instanceof Error ? e.message : 'Could not reach the chat service.');
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (res.ok && contentType.includes('text/event-stream') && res.body) {
    const headerModel = res.headers.get('x-chat-model')?.trim() || null;
    const out = await readOpenRouterStream(res, opts?.onToken, opts?.signal);
    const model = out.model ?? headerModel ?? 'proxy';
    return { answer: out.text.trim(), model, truncated: excerpted };
  }

  let body: { answer?: string; model?: string; truncated?: boolean; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* fall through to status handling */
  }
  if (res.status === 401) {
    throw new SummaryError('MISSING_KEY', body.error ?? 'Session expired — please sign in again.');
  }
  if (res.status === 429) {
    throw new SummaryError('RATE_LIMIT', body.error ?? 'Daily chat limit reached. Try again tomorrow.');
  }
  throw new SummaryError('API', body.error ?? `Chat service error (HTTP ${res.status}).`);
}

async function requestDirect(
  doc: TranscriptDoc,
  excerpts: string,
  excerpted: boolean,
  history: ChatTurn[],
  question: string,
  opts?: { apiKey?: string; signal?: AbortSignal; onToken?: (partial: string) => void },
): Promise<{ answer: string; model: string; truncated: boolean }> {
  const apiKey = opts?.apiKey?.trim() || getConfiguredApiKey();
  if (!apiKey) {
    throw new SummaryError(
      'MISSING_KEY',
      'No OpenRouter API key configured. Add VITE_OPENROUTER_API_KEY to .env or paste a key in the Summary tab.',
    );
  }

  const messages: OpenRouterMsg[] = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    { role: 'user', content: buildContextBlock(doc.title, excerpts) },
    ...history.map((t): OpenRouterMsg => ({ role: t.role, content: t.content })),
    { role: 'user', content: question },
  ];

  const models = [CHAT_MODEL_PRIMARY, ...CHAT_MODEL_FALLBACKS];
  let lastError: SummaryError | null = null;
  for (const model of models) {
    try {
      const out = await callOpenRouterStream(apiKey, model, messages, opts?.onToken, opts?.signal);
      return { answer: out.text, model: out.model, truncated: excerpted };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      const err = e instanceof SummaryError ? e : new SummaryError('API', String(e));
      // Wrong key won't heal by trying another model. Every other failure
      // (429, 404/removed model id, 400 context overflow, 5xx) falls through
      // to the next fallback.
      if (err.code === 'MISSING_KEY') throw err;
      lastError = err;
    }
  }
  throw lastError ?? new SummaryError('API', 'All chat models failed. Retry shortly.');
}
