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
  DAILY_LIMIT_PER_USER?: string;
  SUMMARY_KV: KVNamespace;
}

const FALLBACK_MODELS = [
  'thinkingmachines/inkling-small:free',
  'dots-studio/dots-3-note-preview:free',
  'openrouter/free',
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

function todayKey(userId: string): string {
  return `summaries:${userId}:${new Date().toISOString().slice(0, 10)}`;
}

function secondsUntilMidnightUtc(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
}

/** Increment today's counter; throws 429 when the user is over quota. */
async function checkQuota(env: Env, userId: string): Promise<void> {
  const limit = Math.max(1, Number(env.DAILY_LIMIT_PER_USER ?? '10') || 10);
  const key = todayKey(userId);
  const current = Number((await env.SUMMARY_KV.get(key)) ?? '0') || 0;
  if (current >= limit) {
    throw {
      status: 429,
      message: `Daily summary limit reached (${limit}/day). Try again tomorrow.`,
    };
  }
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

async function callOpenRouter(
  apiKey: string,
  model: string,
  userContent: string,
): Promise<{ content: string } | { rateLimited: true } | { failed: string }> {
  const res = await fetch(OPENROUTER_URL, {
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
      max_tokens: 4000,
      messages: [
        { role: 'system', content: 'You write thorough, faithful, well-structured video summaries in Markdown.' },
        { role: 'user', content: userContent },
      ],
    }),
  });
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req);
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true }, 200, cors);
    }
    if (req.method !== 'POST' || url.pathname !== '/summarize') {
      return json({ error: 'Not found. POST /summarize or GET /health.' }, 404, cors);
    }

    try {
      if (!env.OPENROUTER_API_KEY) {
        return json({ error: 'Proxy misconfigured — owner must set OPENROUTER_API_KEY.' }, 500, cors);
      }
      const userId = await verifyUser(req, env);
      await checkQuota(env, userId);

      let body: { title?: unknown; transcript?: unknown };
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

      const { text, truncated } = truncateTranscript(transcript);
      const prompt = buildPrompt(title, text, truncated);
      const models = [env.MODEL_OVERRIDE || env.PRIMARY_MODEL || FALLBACK_MODELS[0], ...FALLBACK_MODELS];
      let summary: string | null = null;
      let usedModel = '';
      let lastFailure = '';
      for (const model of models) {
        const out = await callOpenRouter(env.OPENROUTER_API_KEY, model, prompt);
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
