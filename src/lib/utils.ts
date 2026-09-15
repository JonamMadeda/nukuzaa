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
