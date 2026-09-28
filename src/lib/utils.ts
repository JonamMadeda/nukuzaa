export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** 65.2 -> "01:05" · 3720 -> "1:02:00" */
export function formatMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** 1536 -> "1.5 KB" · 2097152 -> "2 MB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`;
}

/** "https://www.youtube.com/watch?v=ID" + start seconds -> timestamped watch URL. */
export function timestampUrl(baseUrl: string, seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  try {
    const u = new URL(baseUrl);
    u.searchParams.set('t', `${s}s`);
    return u.toString();
  } catch {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}t=${s}s`;
  }
}

/** Save a text blob to disk (Tauri + browser). */
export function downloadTextFile(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Filesystem-safe stem: "My Video: Part 1?" -> "My_Video_Part_1". */
export function safeFilenameStem(name: string, maxLen = 80): string {
  const clean = name
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`~]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (clean || 'transcript').slice(0, maxLen);
}

function srtTimestamp(totalSeconds: number): string {
  const ms = Math.max(0, Math.round(totalSeconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(rest).padStart(3, '0')}`;
}

function vttTimestamp(totalSeconds: number): string {
  return `${srtTimestamp(totalSeconds).replace(',', '.')}`;
}

export interface ExportableDoc {
  title: string;
  url: string;
  rawText: string;
  editedText?: string | null;
  captions: Array<{ start: number; dur: number; text: string }>;
}

export function docDisplayText(d: ExportableDoc): string {
  return d.editedText ?? d.rawText;
}

export function buildMarkdown(d: ExportableDoc): string {
  const lines = [
    `# ${d.title}`,
    '',
    `Source: ${d.url}`,
    '',
    ...docDisplayText(d)
      .split(/\n{2,}|\n/)
      .map((p) => p.trim())
      .filter(Boolean),
  ];
  return `${lines.join('\n\n')}\n`;
}

export function buildSrt(d: ExportableDoc): string {
  return (
    d.captions
      .map((c, i) => `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.start + c.dur)}\n${c.text}\n`)
      .join('\n') + '\n'
  );
}

export function buildVtt(d: ExportableDoc): string {
  return (
    `WEBVTT\n\n` +
    d.captions
      .map((c) => `${vttTimestamp(c.start)} --> ${vttTimestamp(c.start + c.dur)}\n${c.text}\n`)
      .join('\n') + '\n'
  );
}

export function friendlyDbError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Already-friendly session messages pass through untouched.
  if (/not signed in|session expired|sign in again/i.test(msg)) return msg;
  if (/fetch failed|network|Failed to fetch|Load failed/i.test(msg))
    return 'Network error — check your connection and that the Neon hosts are reachable.';
  if (/jwt|token.*expir|expir.*token|unauthorized|policy|row-level|permission|denied/i.test(msg))
    return 'Access denied — sign out and sign back in. If it persists, run `node scripts/migrate.mjs` to repair database roles.';
  if (/password|role/i.test(msg))
    return 'Database rejected the connection — run `node scripts/migrate.mjs` to repair credentials.';
  if (/relation .* does not exist|migrate/i.test(msg))
    return 'Tables not found — run `node scripts/migrate.mjs` first.';
  if (/timeout|timed out|504|502|cold start/i.test(msg))
    return `${msg} — Neon serverless computes can cold-start after idle (up to ~30s). The app retries automatically.`;
  if (/invalid input syntax for type uuid/i.test(msg)) return 'Internal error: bad folder id.';
  return msg || 'Unexpected database error.';
}
