# Nukuzaa — App Overview

> **Nukuzaa** is a Windows desktop app that turns YouTube videos into a
> personal knowledge library: it extracts full transcripts, writes
> comprehensive **AI summaries**, lets you **chat with any video**, and
> organizes everything into searchable folder collections.
>
> - Repository: https://github.com/JonamMadeda/nukuzaa
> - Latest release: https://github.com/JonamMadeda/nukuzaa/releases/latest
> - Current version: **0.5.0**
> - Landing page: https://github.com/JonamMadeda/nukuzaa_landing_page

---

## 1. What it is

Paste any YouTube link — watch, `youtu.be`, Shorts, embed, or live — and
Nukuzaa fetches the captions **on your own machine**, saves the transcript to
your private cloud library, and opens a reader where AI does the heavy
lifting. Instead of re-watching a 2-hour video, you read a structured summary
or simply ask the video questions.

## 2. Key features

- **AI video summaries** — every transcript gets a TL;DR, key points, main
  topics in order, actionable takeaways, and notable quotes. Generated per
  video, cached for instant re-reads.
- **Ask this video (AI chat)** — transcript-grounded Q&A with streamed
  answers. Every factual claim cites a clickable `[MM:SS]` timestamp that
  jumps to the moment in the video. The AI answers *only* from the
  transcript and says so when the answer isn't there.
- **Transcript reader** — flowing **Paragraphs**, timestamped **Timestamps**,
  in-text search with match navigation, manual text editing, notes, tags,
  caption-language switching, highlights, **Copy All**, and **Export PDF**.
- **Folder collections** — custom folders with accent colors, pinning,
  archiving, bulk import (including playlists), move-between-folders, and
  grid/list views with instant search.
- **Dashboard shelves** — Recently opened (newest first, capped so the row
  never overflows), Favorites, and Saved highlights.
- **Local vault** — every folder and transcript is auto-mirrored as plain
  files you own at `Documents/Nukuzaa/[Folder]/[Document]/`
  (`transcript.md`, `notes.md`, `summary.md`, `meta.json`). One-click full
  backup from Account → Local vault; nothing secret ever lands there.
- **Private by account** — Neon Auth sign-in with per-user data isolation
  (row-level scoping on `user_id`); transcripts stay private to your account.
- **Self-updating** — polls GitHub releases on start (plus a manual
  footer check) and installs updates in-app.

## 3. How it works

```
Desktop window (Tauri WebView: React 18 + TypeScript + Tailwind)
  Dashboard · Workspace · Reader (Summary / Chat / Paragraphs /
  Timestamps / Notes) · Account · Auto-updater
        │ Rust IPC commands              │ HTTPS
        │ (your own IP, no CORS issues)  │ (CORS-safe APIs)
┌───────▼──────────────┐        ┌────────▼───────────────────────┐
│ Tauri Rust backend   │        │ Neon PostgreSQL (cloud)        │
│ · YouTube fetching   │        │ folders + transcripts,         │
│ · local vault mirror │        │ scoped per user                │
│ · opener / updater   │        └────────────────────────────────┘
└───────┬──────────────┘
        │ HTTPS to youtube.com / youtubei player / timedtext
┌───────▼────────┐     ┌────────────────────────────────────────┐
│ YouTube        │     │ Summary proxy (Cloudflare Worker)      │
│ captions +     │     │ holds the shared OpenRouter key        │
│ metadata       │     │ server-side; verifies your auth JWT,   │
└────────────────┘     │ enforces a per-user daily quota,       │
                       │ streams summaries + chat back          │
                       └────────────────────────────────────────┘
```

Three design decisions drive this shape:

1. **YouTube fetching runs on the user's machine.** YouTube blocks
   datacenter IPs and sends no CORS headers, so the Rust backend fetches
   watch pages, the YouTubei `player` endpoint, and caption tracks from a
   residential IP the same way a browser would.
2. **The AI key never ships with the app.** Releases use a Cloudflare
   Worker proxy (`proxy/`): the app sends the transcript plus your short
   auth token, the Worker verifies you, counts quota in KV, and forwards
   to OpenRouter with server-side model fallbacks. Without a proxy
   configured, the app falls back to your own OpenRouter key.
3. **Chat is retrieval-grounded, not whole-transcript.** Questions are
   matched against caption cues by keyword overlap (plus neighbors and
   intro context), so ~12k relevant characters — not 60k+ — go to the
   model. Fast-first free models lead; the large reasoner is the quality
   fallback.

## 4. Tech stack

| Layer    | Tech |
| -------- | ---- |
| Desktop  | Tauri v2 (Rust), WebView |
| Frontend | React 18, TypeScript, Tailwind CSS, Vite |
| Backend  | Neon PostgreSQL via `@neondatabase/serverless`, Neon Auth (Better Auth) |
| AI       | OpenRouter free models via the `proxy/` Cloudflare Worker (`/summarize`, `/chat`) |
| Releases | GitHub Releases + Tauri updater (`latest.json`); push a `v*` tag to ship |

## 5. Project layout

```
nukuzaa/
  src/                    React frontend
    components/           Dashboard, Workspace, ReaderPage, VideoSummary,
                          VideoChat, AccountPage, modals, UpdateManager …
    lib/                  db, auth, extractor, importer, summarize, chat,
                          vault, cache, utils, types
    hooks/                useToast
  src-tauri/              Rust backend: YouTube fetch commands + vault
                          mirror commands, updater/opener plugins
  proxy/                  Cloudflare Worker: JWT verify, per-user quotas,
                          OpenRouter fan-out for /summarize and /chat
  docs/                   this file + nukuzaa-guide.md (full manual)
  scripts/                DB migrations, extractor bundle, release helpers
  release/                portable .exe artifacts from past releases
```

## 6. Further reading

- **[README.md](../README.md)** — install, first run, updates, troubleshooting.
- **[docs/nukuzaa-guide.md](nukuzaa-guide.md)** — full manual: schema,
  extraction pipeline, signing, and the release process.
- **[proxy/README.md](../proxy/README.md)** — deploying and operating the
  summary/chat proxy (quotas, key rotation, logs).
