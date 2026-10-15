# Nukuzaa summary proxy

Cloudflare Worker that holds your **one shared OpenRouter key server-side**.
The desktop app never sees the key — it sends the transcript + the user's
Neon Auth JWT, the Worker verifies the user, enforces a daily per-user quota,
and forwards to OpenRouter with model fallbacks.

## One-time setup (~10 min, free tier)

```powershell
cd proxy
npm install

# 1. Log in (opens a browser)
npx wrangler login

# 2. Create the quota store, then paste the printed id into wrangler.toml
npx wrangler kv:namespace create SUMMARY_KV

# 3. Point the Worker at your auth server (edit wrangler.toml vars):
#      AUTH_BASE_URL = your VITE_NEON_AUTH_URL
#      JWKS_URL      = your VITE_NEON_JWKS_URL
#      DAILY_LIMIT_PER_USER = 10
#      CHAT_DAILY_LIMIT_PER_USER = 10  (POST /chat quota; defaults to DAILY_LIMIT_PER_USER)

# 4. Store the shared key (ENCRYPTED — never in the repo)
npx wrangler secret put OPENROUTER_API_KEY
#    paste your sk-or-v1-... key when prompted

# 5. Deploy
npm run deploy
#    → https://nukuzaa-summary-proxy.<you>.workers.dev
```

## Point the app at it

```powershell
# .env (local dev)
VITE_SUMMARY_PROXY_URL=https://nukuzaa-summary-proxy.<you>.workers.dev
```

For releases, set the same value as a GitHub **Variable**
(`VITE_SUMMARY_PROXY_URL`) — it's a public URL, not a secret — and it is
already wired into `.github/workflows/release.yml`.

## How it stays safe

- The key exists only as a Worker secret (encrypted at rest, never logged).
- Every request must carry a valid, unexpired Neon Auth JWT (`sub` = user id).
  Forged/anonymous requests get 401.
- Each user gets `DAILY_LIMIT_PER_USER` summaries/day and
  `CHAT_DAILY_LIMIT_PER_USER` chats/day (defaults to the summary limit,
  tracked in KV, resets at UTC midnight). One abuser can't burn the shared
  quota. Quota is consumed only on upstream success — malformed requests
  and failed models never burn quota.
- Transcripts are capped (200k chars in, 100k forwarded) so one giant video
  can't eat the context budget.
- If a key ever leaks or OpenRouter flags abuse: `wrangler secret put
  OPENROUTER_API_KEY` with a fresh key — no app update needed.

## Ops

- Health: `GET /health` → `{ "ok": true }`
- Endpoints: `POST /summarize` (full-transcript summary), `POST /chat` (transcript-grounded Q&A with `{ title, transcript, history, question }`)
- Logs: `npm run tail`
- Quota check for a user: KV keys `summaries:<userId>:<YYYY-MM-DD>` and `chat:<userId>:<YYYY-MM-DD>` (separate daily counters; chat defaults to `DAILY_LIMIT_PER_USER` when `CHAT_DAILY_LIMIT_PER_USER` is unset).
- Costs: Workers free tier (100k req/day) + your OpenRouter key. Free-model
  keys share 200 req/day across ALL users — a paid key with a spending limit
  is recommended for any real user base.
