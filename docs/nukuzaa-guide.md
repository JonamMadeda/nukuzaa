# Nukuzaa — Complete Guide

> **Nukuzaa** extracts YouTube video transcripts and organizes them into folder
> collections. It is a desktop app (Tauri v2 + React) backed by a cloud Neon
> PostgreSQL database.
>
> - Repository: https://github.com/JonamMadeda/nukuzaa
> - Latest release: https://github.com/JonamMadeda/nukuzaa/releases/latest
> - Current version: **0.1.0**

---

## 1. What the app does

- **Folder collections** — create named folders (e.g. "Machine Learning",
  "Recipes") to group related transcripts.
- **One-paste import** — paste any YouTube URL (watch, `youtu.be`, Shorts,
  embed, live) and the app extracts the captions on your machine, then stores
  the transcript in Neon under the open folder.
- **Transcript reader** — open any saved document to read it as flowing
  **Paragraphs** or timestamped **Timestamps (MM:SS)**, with **Copy All** and
  **Export PDF** (via the system print dialog → "Save as PDF").
- **Dashboard metrics** — total folders, total documents, and total
  collections (folders containing at least one document), plus folder search
  and grid/list views.
- **Self-updating** — the installed app polls GitHub releases and prompts you
  to download + install new versions.

---

## 2. How it works (architecture)

```
┌─────────────────────────────────────────────────────────┐
│ Nukuzaa desktop window (Tauri WebView)                  │
│  React 18 + TypeScript + Tailwind UI                    │
│   Dashboard · Workspace · Reader · Updater dialog       │
└──────┬──────────────────────────────┬───────────────────┘
       │ Rust IPC commands            │ HTTPS (fetch)
       │ (localhost IP, no CORS)      │ (CORS-safe APIs)
┌──────▼──────────────┐      ┌────────▼────────────────────┐
│ Tauri Rust backend  │      │ Neon PostgreSQL (cloud)     │
│ · fetch_url_text    │      │ via @neondatabase/serverless│
│ · post_json_text    │      │ folders + transcripts tables│
│ · open_external     │      └─────────────────────────────┘
└──────┬──────────────┘
       │ HTTPS to youtube.com / youtubei
┌──────▼──────────────┐
│ YouTube             │
│ · youtubei player   │
│ · watch pages       │
│ · timedtext captions│
└─────────────────────┘
```

Two design decisions drive the architecture:

1. **YouTube fetching happens on the user's machine.** YouTube blocks
   datacenter IPs and its pages carry no CORS headers, so server-side or
   plain-browser fetching fails. The Rust backend (`fetch_url_text`,
   `post_json_text`) uses a desktop Chrome user-agent from your own IP, which
   YouTube serves normally.
2. **The database is accessed over HTTPS, not TCP.** The Neon serverless
   driver talks to Neon's HTTP query endpoint, which works from inside the
   WebView with no firewall or connection-pool issues.

---

## 3. Tech stack

| Layer      | Technology |
| ---------- | ---------- |
| Desktop shell | Tauri v2 (Rust backend + WebView frontend) |
| Frontend   | React 18, TypeScript, Vite |
| Styling    | Tailwind CSS, Lucide React icons |
| Database   | Neon PostgreSQL via `@neondatabase/serverless` |
| Tauri plugins | `opener` (external links), `updater` (auto-update), `process` (restart) |
| Updates    | GitHub Releases + `latest.json` feed, minisign signatures |
| CI         | GitHub Actions (`tauri-action`, builds on `v*` tags) |

---

## 4. Project structure

```
nukuzaa/
├── src/
│   ├── App.tsx                    # view routing, DB lifecycle, auto-retry, footer
│   ├── main.tsx                   # React entry
│   ├── index.css                  # Tailwind + print stylesheet (PDF export)
│   ├── lib/
│   │   ├── db.ts                  # Neon client + folder/transcript queries
│   │   ├── extractor.ts           # YouTube transcript pipeline
│   │   ├── types.ts               # Folder, TranscriptDoc, CaptionCue, …
│   │   └── utils.ts               # time formatting, friendly DB errors
│   ├── hooks/useToast.tsx         # toast notifications
│   └── components/
│       ├── Header.tsx             # brand + Neon status pill
│       ├── Dashboard.tsx          # metrics, search, grid/list, folders
│       ├── Workspace.tsx          # add-document flow + document cards
│       ├── TranscriptReaderModal.tsx  # paragraphs/timestamps, copy, PDF
│       ├── CreateFolderModal.tsx  # new-folder dialog
│       └── UpdateManager.tsx      # update check, prompt, progress
├── src-tauri/
│   ├── tauri.conf.json            # app metadata, bundle, updater feed + pubkey
│   ├── Cargo.toml                 # Rust deps (tauri, reqwest, plugins)
│   ├── capabilities/default.json  # permission allow-list
│   └── src/
│       ├── main.rs                # binary entry
│       └── lib.rs                 # fetch_url_text, post_json_text, open_external
├── sql/
│   ├── 001_init.sql               # tables + constraints (quoted camelCase)
│   └── 002_fix_columns.sql        # case-fix renames + indexes (idempotent)
├── scripts/
│   ├── migrate.mjs                # runs sql/*.sql in order + verifies
│   ├── test-extract.mjs           # extractor smoke test for any YouTube URL
│   └── make-latest-json.mjs       # builds the updater feed for manual releases
├── .github/workflows/release.yml  # tag-triggered release builds
├── release/                       # portable exe (gitignored build output)
└── docs/                          # this manual
```

---

## 5. Database

### 5.1 Schema

**`folders`**

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | UUID, PK | default `gen_random_uuid()` |
| `title` | TEXT | 1–120 chars |
| `createdAt` | TIMESTAMPTZ | default `now()` |

**`transcripts`**

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | UUID, PK | default `gen_random_uuid()` |
| `folderId` | UUID, FK → `folders.id` | `ON DELETE CASCADE` |
| `videoId` | TEXT | 11-char YouTube ID |
| `title` / `thumbnail` / `url` | TEXT | display metadata |
| `rawText` | TEXT | full transcript as flowing text |
| `captionsJson` | JSONB | `[{ start, dur, text }]` with second offsets |
| `createdAt` | TIMESTAMPTZ | default `now()` |

Uniqueness: `(folderId, videoId)` — re-adding the same video updates it
instead of duplicating. Indexes on `folderId`, `videoId`, `folders.createdAt`.

> Identifiers are double-quoted camelCase (`"folderId"`, `"createdAt"`).
> Unquoted names would be folded to lowercase by Postgres and break the
> app's queries — migration `002` exists specifically to repair early
> databases created before quoting was added.

### 5.2 Migrations

```bash
node scripts/migrate.mjs
```

Reads the pooled connection string from local `.env`, executes every
`sql/*.sql` file in lexical order (split safely around `DO $$` blocks),
then verifies: all 12 expected columns exist and the dashboard's exact
query runs. All statements are `IF NOT EXISTS` / guarded, so re-running is
safe. You can also paste the files into the Neon SQL editor.

---

## 6. Transcript extraction pipeline

`src/lib/extractor.ts` — `extractTranscriptFromUrl(url)`:

1. **Parse the video ID** — accepts watch (`?v=`), `youtu.be`, `/shorts/`,
   `/embed/`, `/live/`, `/v/`, `music.youtube`, or a bare 11-char ID.
2. **Fetch tracks from the YouTubei `player` endpoint** (ANDROID client) via
   the Rust `post_json_text` command. These timedtext URLs are
   **session-independent** and download cookie-free. Playability is checked
   first: private/unplayable videos raise `PRIVATE` with YouTube's reason.
3. **Fallback: scrape the watch page** (`fetch_url_text` + `captionTracks`
   regex) if YouTubei is unreachable. Note: scrape URLs are bound to their
   page-load session and often return HTTP 200 with an empty body when
   re-fetched — the pipeline treats empty files as unusable and moves on.
4. **Try candidate tracks in order** — English manual → English auto →
   others. Each track's XML is downloaded and parsed; the first track that
   yields cues wins.
5. **Parse the XML** — handles both classic `<text start dur>` and srv3
   word-level `<p t=ms d=ms>` formats into `{ start, dur, text }[]`.
6. **Resolve the title** — YouTubei `videoDetails` → page scrape → oEmbed →
   `YouTube video <id>` fallback. Thumbnail is always
   `https://i.ytimg.com/vi/<id>/hqdefault.jpg`.

Error codes (`TranscriptError.code`): `INVALID_URL`, `NETWORK`, `PRIVATE`,
`NO_CAPTIONS` (also used when a video genuinely has captions disabled or
auto-captions are still processing), `PARSE`.

Smoke-test any URL without the UI:

```bash
npx esbuild src/lib/extractor.ts --bundle --platform=node \
  --format=esm --outfile=scripts/extractor.bundle.mjs
node scripts/test-extract.mjs "https://youtu.be/<id>"
```

---

## 7. Desktop backend (Rust)

`src-tauri/src/lib.rs` exposes three commands, all restricted by host
allow-lists:

| Command | Method | Allow-list | Purpose |
| ------- | ------ | ---------- | ------- |
| `fetch_url_text` | GET | YouTube + `i.ytimg.com` + `googlevideo.com` hosts | watch pages, timedtext XML |
| `post_json_text` | POST, 4 KB max | `youtube.com/youtubei/` only | YouTubei player API |
| `open_external` | — | — | "Watch video" links in the system browser |

Capabilities (`capabilities/default.json`) grant only
`opener:allow-open-url`, `process:allow-restart`,
`updater:allow-check`, and `updater:allow-download-and-install`.

---

## 8. UI tour

- **Header** — brand + Neon status pill: green *connected*, amber
  *connecting/retrying (attempt N)*, red *offline — retry*.
- **Dashboard** — "Your folders" header with counts, metric cards, folder
  search, grid/list toggle, folder cards (doc count, creation date, delete),
  loading skeletons, and a DB-error card showing the target host plus a
  *Copy details* button (host + message, never credentials).
- **Workspace** — back button, folder title, YouTube URL bar + *Add
  document* (with "extracting…" progress), document cards (thumbnail, title,
  date, cue count, delete). Click a card to read.
- **Reader modal** — thumbnail/title + Watch-video link; Paragraphs /
  Timestamps toggle; **Copy All** with confirmation; **Export PDF** (print
  dialog → "Save as PDF"; print stylesheet isolates the transcript and adds
  a title/URL/date header).
- **Footer** — app version + *Check for updates* link.
- **Toasts** — bottom-right success/error/info notifications for saves,
  deletes, copies, reconnections, and update results.

**Connection resilience** (`App.tsx`): the initial load retries automatically
(5 attempts, 4s/8s/12s/16s backoff) to ride out Neon cold starts after idle,
with a "Back online" toast on recovery.

---

## 9. Getting started

### 9.1 Prerequisites

- Node.js 20+, Rust stable, a Neon account (free tier works).

### 9.2 Install options (v0.1.0)

| File | How | Effect |
| ---- | --- | ------ |
| `Nukuzaa_0.1.0_x64-setup.exe` | run installer | Start Menu + Apps entry, per-user |
| `Nukuzaa-0.1.0-portable.exe` | double-click | runs as-is, no install |
| `Nukuzaa_0.1.0_x64_en-US.msi` | run installer | alternative installer |

### 9.3 Connect the database

1. In Neon: SQL editor → run `sql/001_init.sql`, then `sql/002_fix_columns.sql`
   (or `node scripts/migrate.mjs` from the repo).
2. Copy the **pooled** connection string (Neon → Connect).
3. For development: put it in local `.env` as `VITE_DATABASE_URL=…`
   (see `.env.example`; `.env` is gitignored and never committed).

### 9.4 Run from source

```bash
npm install
npm run tauri dev     # full desktop runtime (recommended)
npm run dev           # web preview (DB works; YouTube import needs desktop)
```

> In a plain browser, YouTube watch pages block cross-origin reads, so
> caption import only works in the desktop runtime. The DB layer works in
> both.

---

## 10. Building & releasing

### 10.1 Version numbers

Keep `0.x.y` in sync across `package.json`, `src-tauri/tauri.conf.json`,
and `src-tauri/Cargo.toml`.

### 10.2 Local release build

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$HOME\.tauri\nukuzaa.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "$HOME\.tauri\nukuzaa.pw.txt" -Raw).Trim()
npx tauri build
node scripts/make-latest-json.mjs <version>
gh release create v<version> --title "Nukuzaa v<version>" --notes "…" \
  src-tauri/target/release/bundle/nsis/Nukuzaa_<version>_x64-setup.exe \
  src-tauri/target/release/bundle/nsis/Nukuzaa_<version>_x64-setup.exe.sig \
  src-tauri/target/release/bundle/latest.json
```

Outputs: NSIS setup + `.sig`, MSI + `.sig`, `latest.json` (updater feed),
and the portable binary at `src-tauri/target/release/nukuzaa.exe`.

### 10.3 Signing keys

- Private key: `~/.tauri/nukuzaa.key` + password in `~/.tauri/nukuzaa.pw.txt`
  — **back both up; losing them permanently breaks updates.**
- Public key: baked into `tauri.conf.json → plugins.updater.pubkey`.
- Never commit keys (gitignored: `*.key`, `*.pub`).

### 10.4 CI releases

`.github/workflows/release.yml` builds + publishes on `git tag v*` pushes.
Required repo secret: `TAURI_SIGNING_PRIVATE_KEY` (key file contents);
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has a password.

### 10.5 How updates reach users

1. A new tag/release publishes `latest.json` + signed setup to GitHub.
2. Installed apps poll
   `.../releases/latest/download/latest.json` at startup (and on manual
   check), verify the minisign signature against the baked public key, and
   prompt: *Update available → Download & install → Restart now*.
3. The repo must stay **public** — the updater downloads without auth.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| Red *DB offline* pill | Neon cold start after idle | Wait — auto-retry (5 attempts) usually recovers; else click retry |
| *Tables not found* | migrations not run | Run `node scripts/migrate.mjs` |
| *column t.folderId does not exist* | pre-002 lowercase schema | Run `sql/002_fix_columns.sql` |
| *VITE_DATABASE_URL is missing* | no `.env` (dev) | Copy `.env.example` → `.env`, fill pooled URL, restart |
| *No captions found* | uploader disabled them, or auto-captions still processing | Try later / another video |
| *Caption files were empty* | session-bound scrape URLs | Automatic — pipeline prefers YouTubei URLs; retry |
| Import fails in browser preview | YouTube CORS | Use `npm run tauri dev` / installed app |
| Update check fails | no network / prerelease tag | Check connection; feed serves only full releases |

The dashboard error card's **Copy details** button captures host + attempt +
message for bug reports (no secrets included).

---

## 12. Security notes

- Never commit `.env`, `*.key`, or `*.pub`.
- Rotate the Neon password if it was ever pasted into chat or logs.
- The repo is public (updater requirement) — keep credentials out of code;
  the connection string lives only in local `.env` / user machines.
- Rust network commands are host-allow-listed; the POST body is capped at
  4 KB and restricted to the YouTubei endpoint.

## 13. Limitations & ideas

- Windows x64 only so far (NSIS/MSI/portable); macOS needs `icon.icns` +
  CI-built artifacts, Linux needs its bundle targets enabled.
- Single-user design; Neon holds the shared source of truth if the same
  database URL is used on multiple machines.
- Possible next steps: transcript search across folders, edit/annotate
  saved transcripts, multi-language track picker, PDF filename + export
  location choice, auto-check cadence setting.
