import type { TranscriptDoc } from './types';
import { docDisplayText, formatMMSS } from './utils';
import { getCachedSummary } from './summarize';
import { listFoldersWithCounts, listTranscripts } from './db';

// ---------------------------------------------------------------------------
// Local vault: best-effort human-readable mirror of the library at
// `{Documents}/Nukuzaa/[Folder]/[Document]/` (desktop app only).
//
//   transcript.md  title, source + plain text + timestamped cues
//   notes.md       your notes (only when non-empty)
//   summary.md     cached AI summary (only when generated)
//   meta.json      ids, tags, favorite, highlights, caption track, dates
//
// Every function is fire-and-forget safe: outside the Tauri runtime they
// no-op, and failures only warn — the database write that triggered them
// has already succeeded. Nothing secret ever lands here (no tokens, keys,
// or session data); filenames are sanitized again on the Rust side.
// ---------------------------------------------------------------------------

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export function vaultSupported(): boolean {
  return isTauriRuntime();
}

let corePromise: Promise<typeof import('@tauri-apps/api/core')> | null = null;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Cache the dynamic import: backfills issue hundreds of invokes and each
  // bare `import()` re-resolves the module otherwise.
  corePromise ??= import('@tauri-apps/api/core');
  const { invoke: tauriInvoke } = await corePromise;
  return tauriInvoke<T>(cmd, args);
}

async function tryInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`[vault] ${cmd} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

interface VaultFile {
  name: string;
  content: string;
}

// -- folder title resolution (cached; imports are infrequent) --------------

let folderCache: { at: number; map: Map<string, string> } | null = null;
const FOLDER_CACHE_TTL_MS = 30_000;

export function invalidateFolderCache(): void {
  folderCache = null;
}

async function resolveFolderTitle(folderId: string, hint?: string | null): Promise<string> {
  if (hint?.trim()) return hint.trim();
  const now = Date.now();
  if (!folderCache || now - folderCache.at > FOLDER_CACHE_TTL_MS) {
    try {
      const folders = await listFoldersWithCounts('recent');
      folderCache = { at: now, map: new Map(folders.map((f) => [f.id, f.title])) };
    } catch {
      return 'Unsorted';
    }
  }
  return folderCache.map.get(folderId) ?? 'Unsorted';
}

// -- file builders -----------------------------------------------------------

function buildTranscriptMd(doc: TranscriptDoc): string {
  const lines = [
    `# ${doc.title}`,
    '',
    `Source: ${doc.url}`,
    `Video ID: ${doc.videoId}`,
    `Captions: ${doc.captions.length} cues${doc.trackLang ? ` (${doc.trackLang}${doc.trackKind === 'asr' ? ', auto-generated' : ''})` : ''}`,
    '',
    '## Transcript',
    '',
    docDisplayText(doc).trim() || '(no transcript text)',
  ];
  if (doc.captions.length > 0) {
    lines.push('', '## Timestamped cues', '');
    for (const c of doc.captions) lines.push(`[${formatMMSS(c.start)}] ${c.text}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildMetaJson(doc: TranscriptDoc): string {
  return `${JSON.stringify(
    {
      docId: doc.id,
      folderId: doc.folderId,
      videoId: doc.videoId,
      title: doc.title,
      url: doc.url,
      thumbnail: doc.thumbnail || null,
      trackLang: doc.trackLang,
      trackKind: doc.trackKind,
      tags: doc.tags,
      favorite: doc.favorite,
      edited: doc.editedText != null,
      highlights: doc.highlights,
      cueCount: doc.captions.length,
      createdAt: doc.createdAt,
      exportedAt: new Date().toISOString(),
      exporter: 'nukuzaa-local-vault-v1',
    },
    null,
    2,
  )}\n`;
}

// -- public mirror API (all best-effort, never throw) ------------------------

/** Write/refresh one document's vault directory. Returns the dir path. */
export async function mirrorDoc(
  doc: TranscriptDoc,
  opts?: { folderTitle?: string | null; summary?: string | null },
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const folderTitle = await resolveFolderTitle(doc.folderId, opts?.folderTitle ?? doc.folderTitle);
    const text = docDisplayText(doc);
    const files: VaultFile[] = [
      { name: 'transcript.md', content: buildTranscriptMd(doc) },
      { name: 'meta.json', content: buildMetaJson(doc) },
    ];
    if (doc.notes.trim()) {
      files.push({ name: 'notes.md', content: `# Notes — ${doc.title}\n\n${doc.notes.trim()}\n` });
    }
    const summary = opts?.summary ?? (text.trim() ? getCachedSummary(doc, text.trim()) : null);
    if (summary?.trim()) {
      files.push({
        name: 'summary.md',
        content: `# ${doc.title} — Summary\n\nSource: ${doc.url}\n\n${summary.trim()}\n`,
      });
    }
    return await invoke<string>('vault_write_doc', {
      folderTitle,
      docTitle: doc.title,
      docId: doc.id,
      files,
    });
  } catch (e) {
    console.warn('[vault] mirrorDoc failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Remove one document's vault directory (found by database id). */
export async function forgetDoc(docId: string): Promise<void> {
  await tryInvoke('vault_remove_doc', { docId });
}

/** Move one document's vault directory (cross-folder move or rename). */
export async function relocateDoc(docId: string, newFolderTitle: string, newDocTitle: string): Promise<void> {
  await tryInvoke('vault_relocate_doc', { docId, newFolderTitle, newDocTitle });
}

/** Rename a folder directory after a title change. */
export async function relocateFolder(oldFolderTitle: string, newFolderTitle: string): Promise<void> {
  invalidateFolderCache();
  await tryInvoke('vault_relocate_folder', { oldFolderTitle, newFolderTitle });
}

/** Delete a folder directory after the folder is deleted. */
export async function forgetFolder(folderTitle: string): Promise<void> {
  invalidateFolderCache();
  await tryInvoke('vault_remove_folder', { folderTitle });
}

/** Create a folder directory alongside a new database folder. */
export async function ensureFolder(folderTitle: string): Promise<void> {
  invalidateFolderCache();
  await tryInvoke('vault_ensure_folder', { folderTitle });
}

/** Absolute vault root path (for display). Null outside Tauri / on error. */
export async function vaultRootPath(): Promise<string | null> {
  return tryInvoke<string>('vault_root_path');
}

/** Open the vault (or a subpath) in the OS file manager. */
export async function revealVault(relative?: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await invoke('vault_reveal', relative ? { relative } : {});
    return true;
  } catch (e) {
    console.warn('[vault] reveal failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

export interface BackfillProgress {
  foldersDone: number;
  foldersTotal: number;
  docsDone: number;
}

/** Mirror the whole library (existing items predate the vault).
 *  Docs within each folder mirror with bounded concurrency (default 4) so
 *  large libraries don't take N sequential round-trips. Pass an AbortSignal
 *  to let the UI offer a Stop button; aborting throws DOMException AbortError
 *  after reporting partial progress. */
export async function backfillVault(
  onProgress?: (p: BackfillProgress) => void,
  opts?: { signal?: AbortSignal; concurrency?: number },
): Promise<{ folders: number; docs: number }> {
  const signal = opts?.signal;
  const concurrency = Math.max(1, Math.min(8, Math.floor(opts?.concurrency ?? 4) || 4));
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const folders = await listFoldersWithCounts('recent');
  let docs = 0;
  onProgress?.({ foldersDone: 0, foldersTotal: folders.length, docsDone: 0 });
  for (let i = 0; i < folders.length; i++) {
    throwIfAborted();
    const f = folders[i];
    try {
      const items = await listTranscripts(f.id, 'newest');
      // Bounded worker pool over this folder's docs (single-threaded JS:
      // the shared index is safe without locks).
      let next = 0;
      const workers = Array.from(
        { length: Math.min(concurrency, Math.max(1, items.length)) },
        async () => {
          for (;;) {
            throwIfAborted();
            const d = items[next++];
            if (!d) return;
            await mirrorDoc({ ...d, folderTitle: f.title });
            docs += 1;
            onProgress?.({ foldersDone: i, foldersTotal: folders.length, docsDone: docs });
          }
        },
      );
      await Promise.all(workers);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      console.warn(`[vault] backfill skipped folder ${f.title}:`, e instanceof Error ? e.message : e);
    }
    onProgress?.({ foldersDone: i + 1, foldersTotal: folders.length, docsDone: docs });
  }
  return { folders: folders.length, docs };
}
