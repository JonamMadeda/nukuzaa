# Nukuzaa — YouTube Transcripts, Organized

Desktop app (Tauri v2 + React 18 + TypeScript + Tailwind) for extracting, saving,
and reading YouTube transcripts in folder collections. Backed by Neon PostgreSQL.

## 1. Database setup (Neon)

1. Open your Neon project → SQL Editor.
2. Run `sql/001_init.sql` (creates `folders` + `transcripts`, UUID PKs, CASCADE delete).
3. Copy the **pooled** connection string from Neon → Connect.

```bash
cp .env.example .env
# edit .env and set VITE_DATABASE_URL to your pooled string
```

> Never commit `.env`. The connection string you pasted in chat should stay
> in `.env` locally only.

## 2. Run

```bash
npm install
npm run dev          # web preview (DB works; YouTube fetch needs the desktop runtime — see below)
npm run tauri dev    # full desktop runtime (recommended)
npm run tauri build  # production installer
```

## 3. Why extraction is "local"

YouTube blocks datacenter IPs and its watch page has no CORS headers, so a
plain `fetch()` from a server or browser fails. Nukuzaa fixes this by fetching
from **your own machine**:

- Frontend: `src/lib/extractor.ts` parses the video ID, captionTracks JSON and
  timedtext XML into `{ start, dur, text }[]`.
- Transport: `fetchText()` calls the Rust command `fetch_url_text`
  (`src-tauri/src/lib.rs`, `reqwest` + desktop UA) when running under Tauri,
  falling back to `fetch()` in a plain browser. The Rust command is
  allow-listed to YouTube/thumbnail hosts only.
- Result is saved with `saveTranscript()` (`src/lib/db.ts`, `@neondatabase/serverless`
  HTTP pooling — CORS-safe) into `transcripts` with `rawText` + `captionsJson`.

## 4. Project map

```
sql/001_init.sql              migration
src/lib/db.ts                 Neon client + folder/transcript queries
src/lib/extractor.ts          video-ID, captionTracks + XML parsing
src/lib/types.ts, utils.ts    shared types, time/format helpers
src/hooks/useToast.tsx        toast notifications
src/components/Header.tsx     brand + Neon status pill
src/components/Dashboard.tsx  metrics, search, grid/list, folders
src/components/Workspace.tsx  add-document flow + doc cards
src/components/TranscriptReaderModal.tsx  paragraphs/timestamps, copy-all
src/App.tsx                   view routing + DB lifecycle
src-tauri/                    Tauri v2 backend (fetch command + opener)
```
