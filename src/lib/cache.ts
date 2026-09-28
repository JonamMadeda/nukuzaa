import type { TranscriptDoc } from './types';

// ---------------------------------------------------------------------------
// Offline cache: the most recently opened documents live in localStorage so
// a dropped connection (or Neon cold start) still allows reading.
// No secrets: only transcript content the user already owns.
// ---------------------------------------------------------------------------

const KEY = 'nukuzaa:recent-docs-v1';
const MAX = 20;

function load(): TranscriptDoc[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as TranscriptDoc[]).filter((d) => d && typeof d.id === 'string') : [];
  } catch {
    return [];
  }
}

function store(docs: TranscriptDoc[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(docs.slice(0, MAX)));
  } catch {
    /* quota exceeded — drop the cache silently */
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Remember a document after it opens in the reader. */
export function cacheDoc(doc: TranscriptDoc): void {
  const rest = load().filter((d) => d.id !== doc.id);
  store([doc, ...rest]);
}

export function getCachedDocs(): TranscriptDoc[] {
  return load();
}

export function getCachedDoc(id: string): TranscriptDoc | null {
  return load().find((d) => d.id === id) ?? null;
}

export function removeCachedDoc(id: string): void {
  store(load().filter((d) => d.id !== id));
}
