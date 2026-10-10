import type { TranscriptDoc } from './types';
import { docDisplayText } from './utils';
import { getAuthToken } from './auth';

// ---------------------------------------------------------------------------
// Video summarization.
//
// Preferred path: the Nukuzaa summary proxy (VITE_SUMMARY_PROXY_URL). The
// shared OpenRouter key lives server-side as a Worker secret — the app only
// sends the transcript plus the user's auth JWT, and the proxy enforces a
// per-user daily quota. No key is ever baked into the shipped app.
//
// Fallback path: direct OpenRouter with the user's own key
// (VITE_OPENROUTER_API_KEY for local dev, or pasted in the Summary tab).
// Used only when no proxy is configured.
// ---------------------------------------------------------------------------

export const SUMMARY_MODEL_PRIMARY =
  ((import.meta.env.VITE_OPENROUTER_MODEL as string | undefined)?.trim() ||
    'nvidia/nemotron-3-ultra-550b-a55b:free');

export const SUMMARY_MODEL_FALLBACKS = [
  'thinkingmachines/inkling-small:free',
  'dots-studio/dots-3-note-preview:free',
  'openrouter/free',
] as const;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Roughly 4 chars per token. Keep well under context limits incl. prompt. */
const MAX_TRANSCRIPT_CHARS = 100_000;

const KEY_OVERRIDE_STORAGE = 'nukuzaa:openrouter-key-override';
const SUMMARY_CACHE_PREFIX = 'nukuzaa:summary-v2:';

/**
 * Cache scope: direct summaries are keyed by model (a model change must not
 * serve stale summaries from the previous model); proxy summaries are keyed
 * by 'proxy' (the proxy owner bumps the model there — old entries orphan).
 * A per-transcript pointer remembers which model actually produced the
 * cached summary, so fallback-model results are found on revisit.
 */
export function summaryCacheTag(): string {
  return getProxyUrl() ? 'proxy' : SUMMARY_MODEL_PRIMARY;
}

export class SummaryError extends Error {
  code: 'MISSING_KEY' | 'RATE_LIMIT' | 'NETWORK' | 'API' | 'EMPTY';
  constructor(code: SummaryError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function getConfiguredApiKey(): string | null {
  const envKey = (import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined)?.trim();
  if (envKey) return envKey;
  try {
    const override = localStorage.getItem(KEY_OVERRIDE_STORAGE)?.trim();
    if (override) return override;
  } catch {
    /* storage unavailable */
  }
  return null;
}

/** Proxy base URL (public identifier, safe to ship). Null = BYOK direct mode. */
export function getProxyUrl(): string | null {
  const url = (import.meta.env.VITE_SUMMARY_PROXY_URL as string | undefined)?.trim();
  if (!url) return null;
  return url.replace(/\/+$/, '');
}

export function usesSummaryProxy(): boolean {
  return getProxyUrl() != null;
}

export function getKeyOverride(): string {
  try {
    return localStorage.getItem(KEY_OVERRIDE_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setKeyOverride(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(KEY_OVERRIDE_STORAGE, key.trim());
    else localStorage.removeItem(KEY_OVERRIDE_STORAGE);
  } catch {
    /* ignore */
  }
}

function transcriptHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return `${text.length}-${(h >>> 0).toString(16)}`;
}

function entryKey(doc: TranscriptDoc, text: string, tag: string): string {
  return `${SUMMARY_CACHE_PREFIX}${tag}:${doc.id}:${transcriptHash(text)}`;
}

function pointerKey(doc: TranscriptDoc, text: string): string {
  return `${SUMMARY_CACHE_PREFIX}ptr:${doc.id}:${transcriptHash(text)}`;
}

export function getCachedSummary(doc: TranscriptDoc, text: string): string | null {
  try {
    const tag = summaryCacheTag();
    const direct = localStorage.getItem(entryKey(doc, text, tag));
    if (direct) return direct;
    const ptr = localStorage.getItem(pointerKey(doc, text));
    if (ptr && ptr !== tag) return localStorage.getItem(entryKey(doc, text, ptr));
    return null;
  } catch {
    return null;
  }
}

export function setCachedSummary(doc: TranscriptDoc, text: string, summary: string, model: string): void {
  try {
    // Proxy model is server-managed — collapse to one tag per transcript.
    const tag = getProxyUrl() ? 'proxy' : model;
    localStorage.setItem(entryKey(doc, text, tag), summary);
    localStorage.setItem(pointerKey(doc, text), tag);
  } catch {
    /* quota — summaries regenerate on demand */
  }
}

function truncateTranscript(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return { text, truncated: false };
  // Keep head + tail: intros/outros carry disproportionate signal.
  const head = Math.floor(MAX_TRANSCRIPT_CHARS * 0.8);
  const tail = MAX_TRANSCRIPT_CHARS - head;
  return {
    text: `${text.slice(0, head)}\n\n[… middle omitted for length …]\n\n${text.slice(text.length - tail)}`,
    truncated: true,
  };
}

function buildPrompt(title: string, transcript: string, truncated: boolean): string {
  return [
    'You are an expert video analyst. Summarize the following YouTube video transcript COMPREHENSIVELY — the reader has not watched the video and wants every important idea.',
    '',
    `Video title: ${title}`,
    truncated
      ? '(Note: the middle of a very long transcript was omitted; summarize what is available and note any gap.)'
      : '',
    '',
    'Write the summary in Markdown with exactly these sections:',
    '',
    '## TL;DR',
    '2–4 sentences capturing the video in a nutshell.',
    '',
    '## Key Points',
    'A comprehensive bullet list — cover EVERY distinct idea, argument, fact, or step from the video. Be generous here (aim for thoroughness over brevity). Sub-bullets for supporting details where needed.',
    '',
    '## Main Topics Covered',
    'Numbered list of the major themes/sections in the order they appear.',
    '',
    '## Actionable Takeaways',
    'Concrete things the viewer can do or apply. Omit this section only if the video is purely informational with nothing actionable.',
    '',
    '## Notable Quotes & Moments',
    '2–5 striking or representative quotes (short, verbatim where possible).',
    '',
    'Rules: no invented content — only what the transcript supports. Keep formatting clean Markdown.',
    '',
    '--- TRANSCRIPT START ---',
    transcript,
    '--- TRANSCRIPT END ---',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

async function callOpenRouter(apiKey: string, model: string, messages: ChatMessage[]): Promise<string> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Nukuzaa',
      },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 4000 }),
    });
  } catch (e) {
    throw new SummaryError('NETWORK', e instanceof Error ? e.message : 'Network request failed.');
  }

  if (res.status === 401 || res.status === 403) {
    throw new SummaryError('MISSING_KEY', 'OpenRouter rejected the API key (invalid or revoked). Check VITE_OPENROUTER_API_KEY.');
  }
  if (res.status === 429) {
    throw new SummaryError(
      'RATE_LIMIT',
      'Free-model rate limit hit (20 req/min, 200/day). Wait a minute and retry.',
    );
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string }; message?: string };
      detail = j.error?.message ?? j.message ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new SummaryError('API', detail ? `OpenRouter error (HTTP ${res.status}): ${detail}` : `OpenRouter error: HTTP ${res.status}.`);
  }

  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = j.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) throw new SummaryError('EMPTY', 'The model returned an empty summary. Retry once.');
  return content;
}

/**
 * Generate (and cache) a comprehensive Markdown summary for a transcript.
 *
 * Proxy configured → authenticated request to the proxy (no client key).
 * Otherwise → direct OpenRouter with the user's own key + model fallbacks.
 */
export async function generateVideoSummary(
  doc: TranscriptDoc,
  opts?: { apiKey?: string; signal?: AbortSignal },
): Promise<{ summary: string; model: string; truncated: boolean; fromCache: boolean }> {
  const text = docDisplayText(doc).trim();
  if (!text) throw new SummaryError('EMPTY', 'This transcript has no text to summarize yet.');

  const cached = getCachedSummary(doc, text);
  if (cached) return { summary: cached, model: 'cache', truncated: false, fromCache: true };

  const proxy = getProxyUrl();
  if (proxy) return requestViaProxy(proxy, doc, text, opts?.signal);

  return requestDirect(doc, text, opts?.apiKey);
}

/** Proxy path: JWT-authenticated, key stays server-side. */
async function requestViaProxy(
  proxy: string,
  doc: TranscriptDoc,
  text: string,
  signal?: AbortSignal,
): Promise<{ summary: string; model: string; truncated: boolean; fromCache: boolean }> {
  let token: string;
  try {
    token = await getAuthToken();
  } catch {
    throw new SummaryError('MISSING_KEY', 'Session expired — please sign in again.');
  }

  const { text: clipped } = truncateTranscript(text);
  let res: Response;
  try {
    res = await fetch(`${proxy}/summarize`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: doc.title.slice(0, 300), transcript: clipped }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new SummaryError('NETWORK', 'Summary cancelled.');
    throw new SummaryError('NETWORK', e instanceof Error ? e.message : 'Could not reach the summary service.');
  }

  let body: { summary?: string; model?: string; truncated?: boolean; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* fall through to status handling */
  }
  if (res.status === 401) {
    throw new SummaryError('MISSING_KEY', body.error ?? 'Session expired — please sign in again.');
  }
  if (res.status === 429) {
    throw new SummaryError('RATE_LIMIT', body.error ?? 'Daily summary limit reached. Try again tomorrow.');
  }
  if (!res.ok || !body.summary?.trim()) {
    throw new SummaryError('API', body.error ?? `Summary service error (HTTP ${res.status}).`);
  }
  setCachedSummary(doc, text, body.summary.trim(), body.model ?? 'proxy');
  return { summary: body.summary.trim(), model: body.model ?? 'proxy', truncated: body.truncated ?? false, fromCache: false };
}

/** Direct path: user's own OpenRouter key, primary model + fallbacks. */
async function requestDirect(
  doc: TranscriptDoc,
  text: string,
  apiKeyOverride?: string,
): Promise<{ summary: string; model: string; truncated: boolean; fromCache: boolean }> {
  const apiKey = apiKeyOverride?.trim() || getConfiguredApiKey();
  if (!apiKey) {
    throw new SummaryError(
      'MISSING_KEY',
      'No OpenRouter API key configured. Add VITE_OPENROUTER_API_KEY to .env (see .env.example) or paste a key below.',
    );
  }

  const { text: clipped, truncated } = truncateTranscript(text);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You write thorough, faithful, well-structured video summaries in Markdown.',
    },
    { role: 'user', content: buildPrompt(doc.title, clipped, truncated) },
  ];

  const models = [SUMMARY_MODEL_PRIMARY, ...SUMMARY_MODEL_FALLBACKS];
  let lastError: SummaryError | null = null;
  for (const model of models) {
    try {
      const summary = await callOpenRouter(apiKey, model, messages);
      setCachedSummary(doc, text, summary, model);
      return { summary, model, truncated, fromCache: false };
    } catch (e) {
      const err = e instanceof SummaryError ? e : new SummaryError('API', String(e));
      // Wrong key won't heal by trying another model.
      if (err.code === 'MISSING_KEY') throw err;
      lastError = err;
    }
  }
  throw lastError ?? new SummaryError('API', 'All summary models failed. Retry shortly.');
}
