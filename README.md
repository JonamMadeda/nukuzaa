# Nukuzaa — YouTube Transcripts, Organized

Nukuzaa is a Windows desktop app for **extracting, saving, and reading YouTube
video transcripts** organized into folder collections. Paste any YouTube link —
watch, `youtu.be`, or Shorts — and get a clean, readable transcript you can
search, copy, or export as PDF.

## Install (recommended)

1. Go to **[Releases](https://github.com/JonamMadeda/nukuzaa/releases/latest)**
   and download **`Nukuzaa_0.1.0_x64-setup.exe`**.
2. Double-click the setup file and follow the installer. This adds Nukuzaa to
   your Start Menu and Apps list.
3. Open **Nukuzaa** and start saving transcripts. No accounts, no settings,
   no configuration — just run it.

> **"Unknown publisher" warning?** The installer isn't code-signed with a
> commercial certificate, so Windows SmartScreen may ask you to confirm.
> Click **More info → Run anyway**. The app updates itself from this GitHub
> repo (see below), so you only need to trust this one prompt.

**No-install option:** download **`Nukuzaa-0.1.0-portable.exe`** from the same
release page and double-click it — nothing is installed.

**Requirements:** Windows 10/11 64-bit and an internet connection. (WebView2
is preinstalled on modern Windows.)

## First run in 30 seconds

1. Click **Create New Folder** (e.g. "Machine Learning").
2. Open the folder, paste a YouTube URL, click **Add document**.
3. Click the saved card to read — switch between **Paragraphs** and
   **Timestamps**, **Copy All**, or **Export PDF**.

## Updates

Nukuzaa checks for new releases on GitHub every time it starts (and whenever
you click **Check for updates** in the footer). When one is available you'll
get a prompt: **Download & install → Restart now**. That's it — you never
need to revisit the releases page unless you want to.

## Features

- Folder collections with document counts, search, and grid/list views
- Local caption extraction (runs on your machine, no datacenter blocks)
- Reader with paragraphs/timestamps views, copy-all, and PDF export
- Dashboard metrics: folders, documents, collections
- Automatic database reconnection (rides out cloud cold starts)

## For developers

```bash
git clone https://github.com/JonamMadeda/nukuzaa.git
cd nukuzaa
cp .env.example .env   # add your Neon pooled URL as VITE_DATABASE_URL
npm install
npm run tauri dev
```

Full manual — architecture, database schema, extraction pipeline, signing,
and release process: **[docs/nukuzaa-guide.md](docs/nukuzaa-guide.md)**.

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| SmartScreen warning on install | More info → Run anyway (expected for unsigned builds) |
| Red "DB offline" pill | Wait a few seconds — the app retries automatically |
| "No captions found" | Video has captions disabled, or auto-captions still processing |
| Import fails | Transcripts import only in the desktop app, not a browser |

Current version: **0.1.0**
