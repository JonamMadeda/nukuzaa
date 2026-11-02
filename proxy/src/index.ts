// Nukuzaa summary proxy (Cloudflare Worker).
//
// The shared OpenRouter key lives ONLY here as an encrypted Worker secret.
// The desktop app never sees it: it POSTs { title, transcript } with the
// user's short-lived Neon Auth JWT, this Worker verifies the JWT against the
// same JWKS/issuer the app uses, enforces a per-user daily quota, and
// forwards to OpenRouter with server-side model fallbacks.
//
// Secrets (via `wrangler secret put` — never in this repo):
//   OPENROUTER_API_KEY   your shared key (use a paid/rate-limited key;
//                          free tier is 200 req/day TOTAL across all users)
//   MODEL_OVERRIDE       optional model id override

import { createRemoteJWKSet, jwtVerify } from 'jose';

interface Env {
  OPENROUTER_API_KEY: string;
  AUTH_BASE_URL: string;
  JWKS_URL: string;
  PRIMARY_MODEL?: string;
  MODEL_OVERRIDE?: string;
  PRIMARY_CHAT_MODEL?: string;
  CHAT_MODEL_OVERRIDE?: string;
  DAILY_LIMIT_PER_USER?: string;
  CHAT_DAILY_LIMIT_PER_USER?: string;
  SUMMARY_KV: KVNamespace;
}

const FALLBACK_MODELS = [
  'thinkingmachines/inkling-small:free',
  'dots-studio/dots-3-note-preview:free',
  'openrouter/auto',
];

/** Chat is latency-sensitive: nimble models first, the big reasoner as fallback. */
const CHAT_FALLBACK_MODELS = [
  'poolside/laguna-s-2.1:free',
  'openrouter/auto',
];

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_TITLE_CHARS = 300;

function json(data: unknown, status = 200, cors: Headers): Response {
  const h = new Headers(cors);
  h.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(data), { status, headers: h });
}

function corsHeaders(req: Request): Headers {
  // Auth rides a Bearer header (not cookies), so a wildcard origin is safe.
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

/** Same issuer/audience derivation as the app's src/lib/auth.ts. */
function issuerOf(authBaseUrl: string): string {
  return new URL(authBaseUrl).origin;
}

async function verifyUser(req: Request, env: Env): Promise<string> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw { status: 401, message: 'Missing bearer token — sign in again.' };

  const issuer = issuerOf(env.AUTH_BASE_URL);
  const jwks = createRemoteJWKSet(new URL(env.JWKS_URL));
  let sub: unknown;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: issuer });
    sub = payload.sub;
  } catch {
    throw { status: 401, message: 'Invalid or expired session — sign in again.' };
  }
  if (typeof sub !== 'string' || !sub) {
    throw { status: 401, message: 'Auth token has no subject — sign in again.' };
  }
  return sub;
}

function todayKey(scope: 'summaries' | 'chat', userId: string): string {
  return `${scope}:${userId}:${new Date().toISOString().slice(0, 10)}`;
}

function secondsUntilMidnightUtc(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
}

/** Per-scope daily limit. Chat has its own knob so enabling chat can't
 *  silently double shared-key spend; falls back to the shared limit. */
function limitFor(env: Env, scope: 'summaries' | 'chat'): number {
  const raw = scope === 'chat' ? (env.CHAT_DAILY_LIMIT_PER_USER ?? env.DAILY_LIMIT_PER_USER ?? '10') : (env.DAILY_LIMIT_PER_USER ?? '10');
  return Math.max(1, Number(raw) || 10);
}

/** Read-only quota check — validation errors (400/413) must not burn quota. */
async function assertQuota(env: Env, scope: 'summaries' | 'chat', userId: string): Promise<void> {
  const limit = limitFor(env, scope);
  const key = todayKey(scope, userId);
  const current = Number((await env.SUMMARY_KV.get(key)) ?? '0') || 0;
  if (current >= limit) {
    const noun = scope === 'chat' ? 'chat' : 'summary';
    throw {
      status: 429,
      message: `Daily ${noun} limit reached (${limit}/day). Try again tomorrow.`,
    };
  }
}

/** Increment only after upstream success. Best-effort: KV read-then-write
 *  can over-admit under concurrency, which fails open (safe for quota). */
async function consumeQuota(env: Env, scope: 'summaries' | 'chat', userId: string): Promise<void> {
  const key = todayKey(scope, userId);
  const current = Number((await env.SUMMARY_KV.get(key)) ?? '0') || 0;
  await env.SUMMARY_KV.put(key, String(current + 1), {
    expirationTtl: secondsUntilMidnightUtc(),
  });
}

function truncateTranscript(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return { text, truncated: false };
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

const CHAT_SYSTEM_PROMPT =
  'You are Nukuzaa, a precise assistant that answers questions about ONE specific YouTube video. ' +
  'Answer ONLY from the transcript provided — never invent facts, and never use outside knowledge except to explain what the transcript says. ' +
  'If the transcript does not contain the answer, say so plainly and suggest what the viewer could search for instead. ' +
  'When you reference a specific moment, cite it as [MM:SS] (or [H:MM:SS] for long videos) using the timestamps in the transcript. ' +
  'Keep answers concise but complete, in clean Markdown (short paragraphs, bullets where helpful). No preamble about being an AI.';

const MAX_CHAT_TRANSCRIPT_CHARS = 60_000;
const MAX_CHAT_HISTORY = 8;
const MAX_CHAT_TURN_CHARS = 2_000;

function truncateChatTranscript(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CHAT_TRANSCRIPT_CHARS) return { text, truncated: false };
  const head = Math.floor(MAX_CHAT_TRANSCRIPT_CHARS * 0.75);
  const tail = MAX_CHAT_TRANSCRIPT_CHARS - head;
  return {
    text: `${text.slice(0, head)}\n\n[… middle omitted for length …]\n\n${text.slice(text.length - tail)}`,
    truncated: true,
  };
}

interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: ChatMsg[],
  maxTokens = 4000,
): Promise<{ content: string } | { rateLimited: true } | { failed: string }> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nukuzaa.app',
        'X-Title': 'Nukuzaa summary proxy',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: maxTokens,
        messages,
        // Fastest provider serving this model — cuts time-to-first-token.
        provider: { sort: 'throughput' },
      }),
    });
  } catch {
    return { failed: `Network error contacting OpenRouter (${model}).` };
  }
  if (res.status === 401 || res.status === 403) {
    throw { status: 502, message: 'Proxy key rejected by OpenRouter — owner must rotate OPENROUTER_API_KEY.' };
  }
  if (res.status === 429) return { rateLimited: true }; // try next fallback model
  if (!res.ok) {
    // Surface the real cause (e.g. 400 context-length overflow on a small
    // fallback model) instead of blaming a busy model.
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string }; message?: string };
      detail = j.error?.message ?? j.message ?? '';
    } catch {
      /* non-JSON body */
    }
    return { failed: detail ? `OpenRouter HTTP ${res.status} (${model}): ${detail}` : `OpenRouter HTTP ${res.status} (${model}).` };
  }
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = j.choices?.[0]?.message?.content?.trim() ?? '';
  return content ? { content } : { failed: `Empty response (${model}).` };
}

/** POST /chat — transcript-grounded Q&A. Separate daily quota from summaries. */
async function handleChat(req: Request, env: Env, cors: Headers, userId: string): Promise<Response> {
  let body: { title?: unknown; transcript?: unknown; history?: unknown; question?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400, cors);
  }
  const title = String(body.title ?? '').slice(0, MAX_TITLE_CHARS) || 'Untitled video';
  const transcript = String(body.transcript ?? '').trim();
  const question = String(body.question ?? '').trim().slice(0, 4000);
  if (!transcript) return json({ error: 'Empty transcript.' }, 400, cors);
  if (!question) return json({ error: 'Empty question.' }, 400, cors);
  if (transcript.length > MAX_CHAT_TRANSCRIPT_CHARS * 2) {
    return json({ error: 'Transcript too long for one question.' }, 413, cors);
  }

  // Validate first so malformed requests never burn quota.
  await assertQuota(env, 'chat', userId);

  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role?: unknown; content?: unknown }>)
        .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
        .slice(-MAX_CHAT_HISTORY)
        .map((t) => ({ role: t.role as 'user' | 'assistant', content: String(t.content).slice(0, MAX_CHAT_TURN_CHARS) }))
        .filter((t) => t.content.trim().length > 0)
    : [];

  const { text, truncated } = truncateChatTranscript(transcript);
  const context = [
    `Video title: ${title}`,
    truncated ? '(Note: the middle of a very long transcript was omitted; answer from what is available.)' : '',
    '',
    '--- TRANSCRIPT START ---',
    text,
    '--- TRANSCRIPT END ---',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const messages: ChatMsg[] = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    { role: 'user', content: context },
    ...history,
    { role: 'user', content: question },
  ];

  // Latency-first chain (deduped): nimble chat models, then the configured
  // primary as the quality fallback, then the free router.
  const configured = env.CHAT_MODEL_OVERRIDE || env.PRIMARY_CHAT_MODEL || 'qwen/qwen3.8-27b:free';
  const fallbackPrimary = env.MODEL_OVERRIDE || env.PRIMARY_MODEL || FALLBACK_MODELS[0];
  const models = [...new Set([configured, ...CHAT_FALLBACK_MODELS, fallbackPrimary])];
  return streamViaFirstWorkingModel(env, models, messages, 0.4, 1000, 'chat', 'All chat models are busy — retry in a minute.', cors, {
    scope: 'chat',
    userId,
  });
}

/** Read the upstream SSE far enough to know the model is actually working:
 *  resolve as soon as the first complete `data:` line arrives. An in-stream
 *  error event (model overloaded/removed right after accepting the request)
 *  counts as a failure so the caller can try the next model; anything else
 *  (metadata, first token) means the model committed. Returns every chunk
 *  consumed so the caller can replay them into the client-facing stream. */
async function peekSseCommit(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ ok: true; buffered: Uint8Array[] } | { ok: false; error: string }> {
  const decoder = new TextDecoder();
  const buffered: Uint8Array[] = [];
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (!done) {
        buffered.push(value);
        buf += decoder.decode(value, { stream: true });
      }
      // Consume every complete line; non-data lines (SSE comments, blank
      // keep-alives) are skipped without blocking the scan of later lines.
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') return { ok: false, error: 'Empty stream from model' };
        try {
          const j = JSON.parse(data) as { error?: { message?: string } };
          if (j.error?.message) return { ok: false, error: `In-stream error: ${j.error.message}` };
        } catch {
          /* unparseable event — pipe through and let the client decide */
        }
        return { ok: true, buffered };
      }
      if (done) return { ok: false, error: 'Stream ended before any output' };
    }
  } catch {
    return { ok: false, error: 'Upstream stream error' };
  }
}

/** Re-emits the chunks consumed by the peek, then pipes the rest of the
 *  upstream body through unchanged. */
function pipeWithReplay(
  buffered: Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < buffered.length) {
        controller.enqueue(buffered[i++]);
        return;
      }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
}

/** Pipe OpenRouter SSE from the first working model; JSON error if none works.
 *  Quota is consumed only when a model commits (first SSE event is not an
 *  error) or returns content — invalid requests and upstream failures never
 *  burn quota. Any non-401/403 upstream failure (network error, 429, 404,
 *  400, 5xx, or an immediate in-stream error) falls through to the next model
 *  so a removed/renamed or temporarily dead model id can't take the endpoint
 *  down. */
async function streamViaFirstWorkingModel(
  env: Env,
  models: string[],
  messages: ChatMsg[],
  temperature: number,
  maxTokens: number,
  workerName: string,
  busyMessage: string,
  cors: Headers,
  quota?: { scope: 'summaries' | 'chat'; userId: string },
): Promise<Response> {
  let lastFailure = '';
  for (const model of models) {
    let upstream: Response;
    try {
      upstream = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://nukuzaa.app',
          'X-Title': `Nukuzaa ${workerName} proxy`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
          provider: { sort: 'throughput' },
        }),
      });
    } catch {
      lastFailure = `Network error contacting OpenRouter (${model}).`;
      continue;
    }
    if (upstream.ok && upstream.body) {
      const reader = upstream.body.getReader();
      // Peek before committing: a model that accepts the request but errors
      // in the first SSE event must not burn quota or block the fallbacks.
      const decision = await peekSseCommit(reader);
      if (!decision.ok) {
        lastFailure = `${decision.error} (${model}).`;
        await reader.cancel().catch(() => {});
        continue;
      }
      // This model committed — count quota once, then pipe SSE through.
      if (quota) {
        try {
          await consumeQuota(env, quota.scope, quota.userId);
        } catch {
          /* quota write failure must not break a committed stream */
        }
      }
      const h = new Headers(cors);
      h.set('Content-Type', 'text/event-stream');
      h.set('Cache-Control', 'no-cache');
      h.set('X-Chat-Model', model);
      return new Response(pipeWithReplay(decision.buffered, reader), { status: 200, headers: h });
    }
    if (upstream.status === 401 || upstream.status === 403) {
      return json({ error: 'Proxy key rejected by OpenRouter — owner must rotate OPENROUTER_API_KEY.' }, 502, cors);
    }
    if (upstream.status === 429) continue; // try the next model
    let detail = '';
    try {
      const t = await upstream.text();
      try {
        const j = JSON.parse(t) as { error?: { message?: string }; message?: string };
        detail = j.error?.message ?? j.message ?? '';
      } catch {
        detail = t.slice(0, 200);
      }
    } catch {
      /* unreadable body */
    }
    lastFailure = detail ? `OpenRouter HTTP ${upstream.status} (${model}): ${detail}` : `OpenRouter HTTP ${upstream.status} (${model}).`;
  }
  return json({ error: lastFailure || busyMessage }, 502, cors);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req);
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true }, 200, cors);
    }
    const isChat = req.method === 'POST' && url.pathname === '/chat';
    const isSummarize = req.method === 'POST' && url.pathname === '/summarize';
    if (!isChat && !isSummarize) {
      return json({ error: 'Not found. POST /summarize, POST /chat, or GET /health.' }, 404, cors);
    }

    try {
      if (!env.OPENROUTER_API_KEY) {
        return json({ error: 'Proxy misconfigured — owner must set OPENROUTER_API_KEY.' }, 500, cors);
      }
      const userId = await verifyUser(req, env);
      if (isChat) return await handleChat(req, env, cors, userId);

      let body: { title?: unknown; transcript?: unknown; stream?: unknown };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return json({ error: 'Request body must be JSON.' }, 400, cors);
      }
      const title = String(body.title ?? '').slice(0, MAX_TITLE_CHARS) || 'Untitled video';
      const transcript = String(body.transcript ?? '').trim();
      if (!transcript) return json({ error: 'Empty transcript.' }, 400, cors);
      if (transcript.length > MAX_TRANSCRIPT_CHARS * 2) {
        return json({ error: 'Transcript too long for one summary.' }, 413, cors);
      }

      // Validate first so malformed requests never burn quota.
      await assertQuota(env, 'summaries', userId);

      const { text, truncated } = truncateTranscript(transcript);
      const prompt = buildPrompt(title, text, truncated);
      const summaryMessages: ChatMsg[] = [
        { role: 'system', content: 'You write thorough, faithful, well-structured video summaries in Markdown.' },
        { role: 'user', content: prompt },
      ];
      const models = [...new Set([env.MODEL_OVERRIDE || env.PRIMARY_MODEL || FALLBACK_MODELS[0], ...FALLBACK_MODELS])];
      if (body.stream === true) {
        // Live-token path: same models/prompt, SSE piped straight through.
        // Quota is consumed when a model commits (inside the helper).
        return streamViaFirstWorkingModel(env, models, summaryMessages, 0.3, 4000, 'summary', 'All summary models are busy — retry in a minute.', cors, {
          scope: 'summaries',
          userId,
        });
      }
      let summary: string | null = null;
      let usedModel = '';
      let lastFailure = '';
      for (const model of models) {
        const out = await callOpenRouter(env.OPENROUTER_API_KEY, model, summaryMessages, 4000);
        if ('content' in out) {
          summary = out.content;
          usedModel = model;
          break;
        }
        if ('failed' in out) lastFailure = out.failed;
      }
      if (!summary) {
        return json(
          { error: lastFailure || 'All summary models are busy — retry in a minute.' },
          502,
          cors,
        );
      }
      try {
        await consumeQuota(env, 'summaries', userId);
      } catch {
        /* quota write failure must not break a successful summary */
      }
      return json({ summary, model: usedModel, truncated }, 200, cors);
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e) {
        const { status, message } = e as { status: number; message: string };
        return json({ error: message }, status, cors);
      }
      return json({ error: 'Internal proxy error.' }, 500, cors);
    }
  },
};
