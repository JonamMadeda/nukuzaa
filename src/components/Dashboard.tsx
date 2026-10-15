import { useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Check,
  CheckSquare,
  Clock3,
  Copy,
  FileText,
  FolderOpen,
  Bookmark,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Square,
  Star,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import type { Folder, FolderSort, StorageStats, TranscriptDoc } from '../lib/types';
import { FOLDER_ACCENTS } from '../lib/types';
import {
  deleteFolder,
  findDuplicateVideo,
  getStorageStats,
  listFavoriteDocs,
  listHighlightedDocs,
  listFoldersWithCounts,
  listRecentDocs,
  listTranscripts,
  moveTranscript,
  searchTranscripts,
  setFolderArchived,
  setFolderPinned,
} from '../lib/db';
import { TranscriptError, extractVideoId } from '../lib/extractor';
import { importVideo } from '../lib/importer';
import { cn, formatBytes, formatDate } from '../lib/utils';
import { forgetFolder, relocateDoc } from '../lib/vault';
import { useToast } from '../hooks/useToast';

export type FolderViewMode = 'grid' | 'list';

interface Props {
  userId: string;
  recentDocIds: string[];
  docRevision: number;
  folders: Folder[];
  loading: boolean;
  dbError: string | null;
  dbHost: string | null;
  autoRetrying: boolean;
  attempt: number;
  search: string;
  onSearch: (v: string) => void;
  mode: FolderViewMode;
  onMode: (m: FolderViewMode) => void;
  folderSort: FolderSort;
  onFolderSort: (s: FolderSort) => void;
  onOpenCreate: () => void;
  onOpenFolder: (f: Folder) => void;
  onOpenDoc: (d: TranscriptDoc) => void;
  onEditFolder: (f: Folder) => void;
  onDeleteFolder: (f: Folder) => void;
  onRetry: () => void;
  onFoldersChanged: () => void;
}

export default function Dashboard(p: Props) {
  const { notify } = useToast();
  const totalDocs = p.folders.reduce((n, f) => n + f.docCount, 0);
  const collections = p.folders.filter((f) => f.docCount > 0).length;
  const q = p.search.trim().toLowerCase();
  const visible = q
    ? p.folders.filter((f) => f.title.toLowerCase().includes(q))
    : p.folders;
  const pinned = visible.filter((f) => f.pinned);
  const unpinned = visible.filter((f) => !f.pinned);

  // Global document search (titles, bodies, tags) — debounced.
  const [docResults, setDocResults] = useState<TranscriptDoc[]>([]);
  const [docSearching, setDocSearching] = useState(false);
  const [showAllDocs, setShowAllDocs] = useState(false);
  useEffect(() => {
    const query = p.search.trim();
    setShowAllDocs(false);
    if (query.length < 2) {
      setDocResults([]);
      setDocSearching(false);
      return;
    }
    setDocSearching(true);
    const t = window.setTimeout(() => {
      searchTranscripts(query, 12)
        .then(setDocResults)
        .catch(() => setDocResults([]))
        .finally(() => setDocSearching(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [p.search]);

  // Revisit shelves + storage glance.
  const [favDocs, setFavDocs] = useState<TranscriptDoc[]>([]);
  const [highlightDocs, setHighlightDocs] = useState<TranscriptDoc[]>([]);
  const [recentDocs, setRecentDocs] = useState<TranscriptDoc[]>([]);
  const [stats, setStats] = useState<StorageStats | null>(null);
  useEffect(() => {
    listFavoriteDocs(8).then(setFavDocs).catch(() => setFavDocs([]));
    listHighlightedDocs(8).then(setHighlightDocs).catch(() => setHighlightDocs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.folders, p.docRevision]);
  useEffect(() => {
    listRecentDocs(p.recentDocIds).then(setRecentDocs).catch(() => setRecentDocs([]));
  }, [p.recentDocIds, p.userId]);
  useEffect(() => {
    getStorageStats().then(setStats).catch(() => setStats(null));
  }, []);

  const showShelves = q.length < 2 && !p.loading && !p.dbError;
  const isEmpty = !p.loading && !p.dbError && p.folders.length === 0;

  // Quick-add bar (collapsed behind a toolbar toggle).
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickUrl, setQuickUrl] = useState('');
  const [quickFolder, setQuickFolder] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const quickTarget = quickFolder || p.folders[0]?.id || '';
  const quickAdd = async () => {
    const input = quickUrl.trim();
    if (!input || quickBusy || !quickTarget) return;
    if (/[?&]list=/.test(input)) {
      notify('info', 'Playlist links import from inside a folder — use the Bulk button there.');
      return;
    }
    const videoId = extractVideoId(input);
    if (videoId) {
      try {
        const dupes = await findDuplicateVideo(videoId);
        const elsewhere = dupes.filter((d) => d.folderId !== quickTarget);
        if (elsewhere.length > 0) {
          const ok = window.confirm(
            `Already saved in ${elsewhere.map((d) => `“${d.folderTitle}”`).join(', ')}. Save a copy here too?`,
          );
          if (!ok) return;
        }
      } catch {
        /* best-effort */
      }
    }
    setQuickBusy(true);
    try {
      const r = await importVideo(quickTarget, input);
      if (r.status === 'failed') throw new Error(r.detail ?? 'Import failed.');
      if (r.status === 'skipped') notify('info', `${r.title} — ${r.detail ?? 'skipped.'}`);
      else {
        setQuickUrl('');
        p.onFoldersChanged();
        notify('success', `Saved “${r.title}”.`);
      }
    } catch (e) {
      if (e instanceof TranscriptError) notify('error', e.message);
      else notify('error', e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setQuickBusy(false);
    }
  };

  // Folder actions (reload counts afterwards).
  const mutateFolders = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      p.onFoldersChanged();
      if (okMsg) notify('success', okMsg);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Operation failed.');
    }
  };
  const togglePin = (f: Folder) => void mutateFolders(() => setFolderPinned(f.id, !f.pinned));
  const archive = (f: Folder) =>
    void mutateFolders(() => setFolderArchived(f.id, true), `Archived “${f.title}”.`);

  // Archived view.
  const [showArchived, setShowArchived] = useState(false);
  const [archivedFolders, setArchivedFolders] = useState<Folder[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const openArchived = async () => {
    if (showArchived) {
      setShowArchived(false);
      return;
    }
    setShowArchived(true);
    setArchivedLoading(true);
    try {
      const all = await listFoldersWithCounts(p.folderSort, true);
      setArchivedFolders(all.filter((f) => f.archived));
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not load archived folders.');
      setShowArchived(false);
    } finally {
      setArchivedLoading(false);
    }
  };
  const restore = (f: Folder) =>
    void mutateFolders(async () => {
      await setFolderArchived(f.id, false);
      setArchivedFolders((prev) => prev.filter((x) => x.id !== f.id));
    }, `Restored “${f.title}”.`);

  // Bulk select mode.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
    setMergeTarget('');
  };
  const bulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} ${ids.length === 1 ? 'folder' : 'folders'} and all their documents?`)) return;
    setBulkBusy(true);
    try {
      const titles = p.folders.filter((f) => ids.includes(f.id)).map((f) => f.title);
      for (const id of ids) await deleteFolder(id);
      exitSelect();
      p.onFoldersChanged();
      notify('success', 'Folders deleted.');
      for (const t of titles) void forgetFolder(t).catch(() => {});
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Bulk delete failed.');
    } finally {
      setBulkBusy(false);
    }
  };
  const bulkArchive = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      for (const id of ids) await setFolderArchived(id, true);
      exitSelect();
      p.onFoldersChanged();
      notify('success', 'Folders archived.');
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Bulk archive failed.');
    } finally {
      setBulkBusy(false);
    }
  };
  const bulkMerge = async () => {
    const ids = [...selected].filter((id) => id !== mergeTarget);
    if (ids.length === 0 || !mergeTarget) return;
    const targetTitle = mergeCandidates.find((f) => f.id === mergeTarget)?.title ?? p.folders.find((f) => f.id === mergeTarget)?.title;
    setBulkBusy(true);
    try {
      const removedTitles: string[] = [];
      for (const id of ids) {
        const docs = await listTranscripts(id, 'newest');
        for (const d of docs) {
          await moveTranscript(d.id, mergeTarget, true);
          if (targetTitle) void relocateDoc(d.id, targetTitle, d.title).catch(() => {});
        }
        const title = p.folders.find((f) => f.id === id)?.title;
        await deleteFolder(id);
        if (title) removedTitles.push(title);
      }
      exitSelect();
      p.onFoldersChanged();
      notify('success', 'Folders merged.');
      for (const t of removedTitles) void forgetFolder(t).catch(() => {});
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Merge failed.');
    } finally {
      setBulkBusy(false);
    }
  };
  const mergeCandidates = p.folders.filter((f) => !selected.has(f.id));

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      {/* Row 1: page identity + creation actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-stone-900 sm:text-2xl">
            Library
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
            <span className="font-medium text-stone-700">{p.folders.length} {p.folders.length === 1 ? 'folder' : 'folders'}</span>
            <span className="text-stone-300">·</span>
            <span>{totalDocs} {totalDocs === 1 ? 'transcript' : 'transcripts'}</span>
            {stats && (
              <>
                <span className="text-stone-300">·</span>
                <span>{formatBytes(stats.bytes)} stored</span>
              </>
            )}
            {collections > 0 && (
              <>
                <span className="text-stone-300">·</span>
                <span>{collections} active</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isEmpty && (
            <button
              onClick={() => setQuickOpen((v) => !v)}
              title="Quick-add a video to any folder"
              aria-pressed={quickOpen}
              disabled={showArchived}
              className={cn(
                'ui-secondary h-9 px-3 text-xs font-semibold',
                quickOpen && 'border-stone-900 bg-stone-900 text-white hover:border-stone-900 hover:bg-stone-800 hover:text-white',
              )}
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>Quick add</span>
            </button>
          )}
          <button
            onClick={p.onOpenCreate}
            className="ui-primary h-9 px-3.5 text-xs font-semibold"
          >
            <Plus className="h-4 w-4" />
            <span>New folder</span>
          </button>
        </div>
      </div>

      {/* Row 2: find on the left, view + utility controls grouped right */}
      {!isEmpty && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-stone-200/90 bg-white p-1.5 shadow-card">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              id="dashboard-search"
              value={p.search}
              onChange={(e) => p.onSearch(e.target.value)}
              placeholder="Search folders and transcripts…"
              disabled={showArchived}
              className="h-9 w-full rounded-md border border-transparent bg-stone-50/70 pl-9 pr-12 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-300 focus:bg-white focus:ring-2 focus:ring-stone-200/60 disabled:bg-stone-50"
            />
            {!p.search ? (
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-400">
                /
              </span>
            ) : (
              <button
                type="button"
                onClick={() => p.onSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-400 hover:bg-stone-200/60 hover:text-stone-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div
            title="View options"
            className="flex h-9 items-center gap-0.5 rounded-md border border-stone-200/80 bg-stone-50/70 p-0.5"
          >
            <ToggleBtn active={p.mode === 'grid'} onClick={() => p.onMode('grid')} label="Grid view">
              <LayoutGrid className="h-3.5 w-3.5" />
            </ToggleBtn>
            <ToggleBtn active={p.mode === 'list'} onClick={() => p.onMode('list')} label="List view">
              <List className="h-3.5 w-3.5" />
            </ToggleBtn>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-stone-200" />
            <select
              value={p.folderSort}
              onChange={(e) => p.onFolderSort(e.target.value as FolderSort)}
              title="Sort folders"
              disabled={showArchived}
              className="h-7 rounded-md border-0 bg-transparent px-1.5 text-xs font-medium text-stone-700 outline-none hover:text-stone-900 disabled:opacity-50"
            >
              <option value="recent">Recent</option>
              <option value="title">Title A–Z</option>
              <option value="docs">Most docs</option>
            </select>
          </div>
          <button
            onClick={() => setSelectMode((v) => !v)}
            title="Select folders for bulk actions"
            aria-pressed={selectMode}
            disabled={showArchived}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition disabled:opacity-50',
              selectMode
                ? 'border-stone-900 bg-stone-900 text-white'
                : 'border-stone-200/80 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900',
            )}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Select</span>
          </button>
          <button
            onClick={openArchived}
            className={cn(
              'ml-auto rounded-md px-2.5 py-1.5 text-xs font-medium transition',
              showArchived
                ? 'bg-amber-100 text-amber-900'
                : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900',
            )}
          >
            {showArchived ? 'Hide archived' : 'Archived'}
          </button>
        </div>
      )}
      {showArchived && (
        <p className="mt-3 rounded-md border border-stone-200 bg-stone-50/80 px-3.5 py-2.5 text-xs text-stone-600">
          Browsing archived folders — search, sort, and bulk actions apply to live folders.
        </p>
      )}

      {/* Quick-add bar (expandable) */}
      {quickOpen && !p.loading && !p.dbError && p.folders.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-stone-200/90 bg-white p-2.5 shadow-card sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              value={quickUrl}
              onChange={(e) => setQuickUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void quickAdd();
              }}
              placeholder="Paste any YouTube URL (watch, youtu.be, Shorts)…"
              disabled={quickBusy}
              className="w-full rounded-md border border-stone-200 py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-200 disabled:bg-stone-50"
            />
          </div>
          <select
            value={quickTarget}
            onChange={(e) => setQuickFolder(e.target.value)}
            title="Target folder"
            className="max-w-48 truncate rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 outline-none focus:border-stone-400"
          >
            {p.folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => void quickAdd()}
            disabled={!quickUrl.trim() || quickBusy || !quickTarget}
            className="ui-primary h-9 px-4 text-xs font-semibold"
          >
            {quickBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {quickBusy ? 'Saving…' : 'Add to folder'}
          </button>
        </div>
      )}

      {/* Global document results */}
      {(docSearching || docResults.length > 0 || (q.length >= 2 && !p.loading && !p.dbError)) && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-stone-600">
            Documents {docSearching ? '— searching…' : docResults.length > 0 ? `(${docResults.length})` : '— no matches'}
            {q.length >= 2 && !docSearching && docResults.length > 0 && (
              <span className="ml-2 font-normal text-stone-500">Matches in titles, transcript text, or tags</span>
            )}
          </p>
          {docResults.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {(showAllDocs ? docResults : docResults.slice(0, 6)).map((d) => (
                <button
                  key={d.id}
                  onClick={() => p.onOpenDoc(d)}
              className="group flex items-center gap-3 rounded-md border border-stone-200 bg-white p-2.5 text-left transition hover:border-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-700"
                >
                  {d.thumbnail ? (
                    <img src={d.thumbnail} alt="" loading="lazy" className="h-9 w-14 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="flex h-9 w-14 shrink-0 items-center justify-center rounded bg-stone-100">
                      <FileText className="h-4 w-4 text-stone-400" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug text-stone-900">{d.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-stone-600">
                      {snippet(d, q) || `in ${d.folderTitle ?? 'a folder'}`}
                    </span>
                  </span>
                  <span className="hidden shrink-0 rounded bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-600 sm:inline">
                    {d.folderTitle ?? ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {docResults.length > 6 && (
            <button
              onClick={() => setShowAllDocs((v) => !v)}
              className="mt-2 text-xs font-medium text-stone-600 hover:text-stone-900 hover:underline"
            >
              {showAllDocs ? 'Show fewer' : `Show all ${docResults.length} results`}
            </button>
          )}
        </div>
      )}

      {showShelves && recentDocs.length > 0 && (
        <DocumentShelf title="Recently opened" icon={<Clock3 className="h-3.5 w-3.5" />} docs={recentDocs} onOpen={p.onOpenDoc} mode={p.mode} layout="horizontal" />
      )}
      {showShelves && favDocs.length > 0 && (
        <DocumentShelf title="Favorites" icon={<Star className="h-3.5 w-3.5" />} docs={favDocs} onOpen={p.onOpenDoc} mode={p.mode} />
      )}
      {showShelves && highlightDocs.length > 0 && (
        <DocumentShelf
          title="Saved highlights"
          icon={<Bookmark className="h-3.5 w-3.5" />}
          docs={highlightDocs}
          onOpen={p.onOpenDoc}
          mode={p.mode}
          detail={(doc) => `${doc.highlights.length} ${doc.highlights.length === 1 ? 'highlight' : 'highlights'} · ${doc.folderTitle ?? 'Folder'}`}
        />
      )}

      {/* Bulk action bar */}
      {selectMode && (
        <div className="sticky bottom-4 z-30 mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-stone-800 bg-stone-900/95 px-4 py-3 text-sm text-white shadow-floating backdrop-blur-md">
          <span className="flex items-center gap-2 font-medium">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-400 text-xs font-bold text-stone-950">
              {selected.size}
            </span>
            <span>selected</span>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              title="Merge target folder"
              className="rounded-md border border-stone-700 bg-stone-800 px-3 py-1.5 text-xs text-stone-200 outline-none focus:border-amber-400"
            >
              <option value="">Merge into…</option>
              {mergeCandidates.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
            <button
              onClick={bulkMerge}
              disabled={bulkBusy || selected.size === 0 || !mergeTarget}
              className="ui-primary-amber px-3 py-1.5 text-xs font-semibold"
            >
              Merge
            </button>
            <button
              onClick={bulkArchive}
              disabled={bulkBusy || selected.size === 0}
              className="rounded-md border border-stone-700 bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-300 hover:bg-stone-700 hover:text-white disabled:opacity-50"
            >
              Archive
            </button>
            <button
              onClick={bulkDelete}
              disabled={bulkBusy || selected.size === 0}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={exitSelect}
              aria-label="Exit select mode"
              className="rounded-md p-1.5 text-stone-400 hover:bg-stone-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Content states */}
      {p.loading ? (
        <div className={cn('mt-4', p.mode === 'grid' ? 'grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid grid-cols-1 gap-2')}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-md border border-stone-200 bg-white p-3">
              <div className="h-4 w-2/3 animate-pulse rounded bg-stone-200" />
              <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-stone-100" />
            </div>
          ))}
        </div>
      ) : p.dbError ? (
        <DbErrorCard
          error={p.dbError}
          dbHost={p.dbHost}
          autoRetrying={p.autoRetrying}
          attempt={p.attempt}
          onRetry={p.onRetry}
        />
      ) : showArchived ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-stone-600">
            Archived ({archivedFolders.length})
          </p>
          {archivedLoading ? (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-stone-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading archived folders…
            </p>
          ) : archivedFolders.length === 0 ? (
            <p className="mt-2 text-sm text-stone-600">Nothing archived. Archive a folder to hide it without deleting.</p>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {archivedFolders.map((f) => (
                <div key={f.id} className="border border-stone-200 bg-white p-3 opacity-90">
                  <div className="flex items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{f.title}</h3>
                    <span className="shrink-0 bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-600">
                      Archived
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-stone-600">
                    {f.docCount} {f.docCount === 1 ? 'document' : 'documents'}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={() => restore(f)}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                    >
                      <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                    </button>
                    <button
                      onClick={() => p.onDeleteFolder(f)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : visible.length === 0 ? (
        p.folders.length === 0 ? (
          <Onboarding onCreate={p.onOpenCreate} />
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-stone-300 bg-white p-6 text-center">
            <FolderOpen className="mx-auto h-7 w-7 text-stone-300" />
            <h2 className="mt-2 font-semibold">No folders match your search</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">
              Nothing named “{p.search.trim()}”. Try a different search.
            </p>
            <button onClick={() => p.onSearch('')} className="mt-3 rounded-lg px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
              Clear search
            </button>
          </div>
        )
      ) : (
        <div className="mt-5">
          {q && (
            <p className="mb-2 text-xs font-semibold text-stone-600">
              Folders ({visible.length})
            </p>
          )}
          {pinned.length > 0 && !selectMode && !q && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-stone-600">Pinned</p>
              <div className={cn('mt-2', p.mode === 'grid' ? 'grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid grid-cols-1 gap-2')}>
                {pinned.map((f) =>
                  p.mode === 'grid' ? (
                    <FolderCard
                      key={f.id}
                      folder={f}
                      selectMode={false}
                      selected={false}
                      onToggleSelect={() => {}}
                      onOpen={() => p.onOpenFolder(f)}
                      onPin={() => togglePin(f)}
                      onEdit={() => p.onEditFolder(f)}
                      onArchive={() => archive(f)}
                      onDelete={() => p.onDeleteFolder(f)}
                    />
                  ) : (
                    <FolderRow
                      key={f.id}
                      folder={f}
                      selectMode={false}
                      selected={false}
                      onToggleSelect={() => {}}
                      onOpen={() => p.onOpenFolder(f)}
                      onPin={() => togglePin(f)}
                      onEdit={() => p.onEditFolder(f)}
                      onArchive={() => archive(f)}
                      onDelete={() => p.onDeleteFolder(f)}
                    />
                  ),
                )}
              </div>
            </div>
          )}
          {p.mode === 'grid' ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(selectMode || q ? visible : unpinned).map((f) => (
                <FolderCard
                  key={f.id}
                  folder={f}
                  selectMode={selectMode}
                  selected={selected.has(f.id)}
                  onToggleSelect={() => toggleSelect(f.id)}
                  onOpen={() => (selectMode ? toggleSelect(f.id) : p.onOpenFolder(f))}
                  onPin={() => togglePin(f)}
                  onEdit={() => p.onEditFolder(f)}
                  onArchive={() => archive(f)}
                  onDelete={() => p.onDeleteFolder(f)}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {(selectMode || q ? visible : unpinned).map((f) => (
                <FolderRow
                  key={f.id}
                  folder={f}
                  selectMode={selectMode}
                  selected={selected.has(f.id)}
                  onToggleSelect={() => toggleSelect(f.id)}
                  onOpen={() => (selectMode ? toggleSelect(f.id) : p.onOpenFolder(f))}
                  onPin={() => togglePin(f)}
                  onEdit={() => p.onEditFolder(f)}
                  onArchive={() => archive(f)}
                  onDelete={() => p.onDeleteFolder(f)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentShelf({
  title,
  icon,
  docs,
  onOpen,
  detail,
  mode,
  layout = 'auto',
}: {
  title: string;
  icon: React.ReactNode;
  docs: TranscriptDoc[];
  onOpen: (doc: TranscriptDoc) => void;
  detail?: (doc: TranscriptDoc) => string;
  mode: FolderViewMode;
  /** 'horizontal' pins the snap-scroll row regardless of the view toggle. */
  layout?: 'auto' | 'horizontal';
}) {
  const showRow = layout === 'horizontal' || mode !== 'list';
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-stone-100 text-stone-600">
          {icon}
        </span>
        <h2 className="text-xs font-bold uppercase tracking-wider text-stone-600">
          {title}
        </h2>
        <span className="rounded bg-stone-100 px-1.5 py-0.2 text-[10px] font-semibold tabular-nums text-stone-500">
          {docs.length}
        </span>
      </div>
      {mode === 'list' && !showRow ? (
        <div className="mt-2.5 grid grid-cols-1 gap-2 md:grid-cols-2">
          {docs.map((doc) => (
            <button
              key={doc.id}
              onClick={() => onOpen(doc)}
              title={doc.title}
              className="group flex items-center gap-3 rounded-md border border-stone-200/90 bg-white p-2.5 text-left shadow-card transition-all hover:border-stone-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              {doc.thumbnail ? (
                <img src={doc.thumbnail} alt="" loading="lazy" className="h-10 w-16 shrink-0 rounded object-cover ring-1 ring-stone-900/5" />
              ) : (
                <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-stone-100 text-stone-400">
                  <FileText className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-stone-900 group-hover:text-amber-900">{doc.title}</span>
                <span className="mt-0.5 block truncate text-xs text-stone-500">
                  {detail ? detail(doc) : doc.folderTitle ?? ''} · {formatDate(doc.createdAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
      <div className="nice-scroll mt-2.5 flex snap-x gap-3 overflow-x-auto scroll-px-4 pb-1">
        {docs.map((doc) => (
          <button
            key={doc.id}
            onClick={() => onOpen(doc)}
            title={doc.title}
            className="group flex w-56 shrink-0 snap-start flex-col overflow-hidden rounded-md border border-stone-200/90 bg-white text-left shadow-card transition-all hover:border-stone-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {doc.thumbnail ? (
              <img src={doc.thumbnail} alt="" loading="lazy" className="aspect-video w-full shrink-0 bg-stone-100 object-cover" />
            ) : (
              <span className="flex aspect-video w-full shrink-0 items-center justify-center bg-stone-100 text-stone-400">
                {icon}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col p-3">
              <span className="line-clamp-2 min-h-[2.6em] text-xs font-semibold leading-snug text-stone-900 group-hover:text-amber-900">
                {doc.title}
              </span>
              <span className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] text-stone-500">
                <span className="min-w-0 flex-1 truncate font-medium text-stone-600">
                  {detail ? detail(doc) : doc.folderTitle ?? ''}
                </span>
                <span className="shrink-0 tabular-nums text-stone-400">{formatDate(doc.createdAt)}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      )}
    </div>
  );
}

function snippet(d: TranscriptDoc, q: string): string {
  if (!q) return '';
  const hay = `${d.title} ${(d.editedText ?? d.rawText).slice(0, 4000)}`.toLowerCase();
  const i = hay.indexOf(q);
  if (i === -1) {
    const tag = d.tags.find((t) => t.includes(q));
    return tag ? `#${tag}` : '';
  }
  const text = `${d.title} ${(d.editedText ?? d.rawText).slice(0, 4000)}`;
  const start = Math.max(0, i - 45);
  return `${start > 0 ? '…' : ''}${text.slice(start, i + q.length + 60).replace(/\s+/g, ' ')}…`;
}

function Onboarding({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-4 rounded-lg border border-stone-200/90 bg-white p-7 shadow-card sm:p-9">
      <div className="max-w-lg">
        <span className="inline-flex items-center gap-1.5 rounded bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-500/20">
          Get Started
        </span>
        <h2 className="mt-2 text-xl font-bold tracking-tight text-stone-900">
          Build your personal video library
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Organize lecture notes, research videos, and tutorials in private, searchable collections.
        </p>
      </div>

      <ol className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ['1', 'Create a collection', 'Group transcripts into topical folders like "AI Research" or "Cooking".'],
          ['2', 'Paste video URLs', 'Watch, youtu.be, or Shorts links. Captions are extracted on your device.'],
          ['3', 'Search, read & chat', 'Generate AI summaries, read with timestamps, and ask questions.'],
        ].map(([n, title, desc]) => (
          <li key={n} className="flex flex-col rounded-md border border-stone-100 bg-stone-50/60 p-4">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-amber-100 text-xs font-bold text-amber-900">
              {n}
            </span>
            <span className="mt-3 block text-sm font-semibold text-stone-900">{title}</span>
            <span className="mt-1 block text-xs leading-relaxed text-stone-500">{desc}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={onCreate}
          className="ui-primary h-10 px-4 text-sm font-semibold"
        >
          <Plus className="h-4 w-4" /> Create your first folder
        </button>
        <p className="text-xs text-stone-400">
          Keyboard shortcuts: <kbd className="rounded border border-stone-200 bg-stone-50 px-1 py-0.5 font-mono text-[11px] text-stone-600">/</kbd> search, <kbd className="rounded border border-stone-200 bg-stone-50 px-1 py-0.5 font-mono text-[11px] text-stone-600">n</kbd> new folder, <kbd className="rounded border border-stone-200 bg-stone-50 px-1 py-0.5 font-mono text-[11px] text-stone-600">?</kbd> all shortcuts
        </p>
      </div>
    </div>
  );
}

interface CardActions {
  folder: Folder;
  onPin: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function ActionCluster(a: CardActions) {
  const btn =
    'rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-800 focus-visible:opacity-100';
  return (
    <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button onClick={a.onPin} title={a.folder.pinned ? 'Unpin folder' : 'Pin folder'} aria-label={a.folder.pinned ? 'Unpin folder' : 'Pin folder'} className={cn(btn, a.folder.pinned && 'text-amber-600 hover:text-amber-700')}>
        {a.folder.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </button>
      <button onClick={a.onEdit} title="Rename or recolor" aria-label="Rename or recolor folder" className={btn}>
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button onClick={a.onArchive} title="Archive folder" aria-label="Archive folder" className={btn}>
        <Archive className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={a.onDelete}
        title="Delete folder"
        aria-label="Delete folder"
        className="rounded-md p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

interface CardProps extends CardActions {
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}

function FolderCard({ folder, selectMode, selected, onToggleSelect, onOpen, ...actions }: CardProps & { folder: Folder }) {
  return (
    <div
      className={cn(
        'group flex flex-col justify-between rounded-lg border bg-white p-3.5 shadow-card transition-all duration-200 hover:border-stone-300 hover:shadow-card-hover',
        selected ? 'border-stone-900 ring-2 ring-stone-900/10' : 'border-stone-200/90',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={selectMode ? onToggleSelect : onOpen}
          aria-label={selectMode ? `${selected ? 'Deselect' : 'Select'} ${folder.title}` : `Open ${folder.title}`}
          aria-pressed={selectMode ? selected : undefined}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          {selectMode ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-stone-500">
              {selected ? <CheckSquare className="h-5 w-5 text-stone-900" /> : <Square className="h-5 w-5" />}
            </span>
          ) : (
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md shadow-xs transition-transform group-hover:scale-105', FOLDER_ACCENTS[folder.accent])}>
              <FolderOpen className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold text-stone-900 group-hover:text-amber-900" title={folder.title}>
                {folder.title}
              </h3>
              {folder.pinned && (
                <Pin className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-600" />
              )}
            </div>
            <p className="mt-1 flex items-center gap-1 text-xs text-stone-500">
              <span className="font-medium text-stone-700">{folder.docCount} {folder.docCount === 1 ? 'doc' : 'docs'}</span>
              <span className="text-stone-300">·</span>
              <span>{formatDate(folder.createdAt)}</span>
            </p>
          </div>
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2.5">
        <div className="flex items-center">
          {folder.recentCount > 0 ? (
            <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
              +{folder.recentCount} this week
            </span>
          ) : (
            <span className="text-[11px] text-stone-400">Up to date</span>
          )}
        </div>
        {!selectMode && (
          <div className="opacity-70 transition-opacity group-hover:opacity-100">
            <ActionCluster folder={folder} {...actions} />
          </div>
        )}
      </div>
    </div>
  );
}

function FolderRow({ folder, selectMode, selected, onToggleSelect, onOpen, ...actions }: CardProps & { folder: Folder }) {
  return (
    <div className={cn(
      'group flex items-center gap-2 rounded-lg border bg-white p-3 shadow-card transition-all hover:border-stone-300 hover:shadow-card-hover sm:gap-3 sm:px-4',
      selected ? 'border-stone-900 ring-2 ring-stone-900/10' : 'border-stone-200/90',
    )}>
      <button
        onClick={selectMode ? onToggleSelect : onOpen}
        aria-label={selectMode ? `${selected ? 'Deselect' : 'Select'} ${folder.title}` : `Open ${folder.title}`}
        aria-pressed={selectMode ? selected : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        {selectMode ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center text-stone-500">
            {selected ? <CheckSquare className="h-5 w-5 text-stone-900" /> : <Square className="h-5 w-5" />}
          </span>
        ) : (
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md shadow-xs', FOLDER_ACCENTS[folder.accent])}>
            <FolderOpen className="h-4.5 w-4.5" />
          </span>
        )}
        {/* Left — identity + details */}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-stone-900 group-hover:text-amber-900">{folder.title}</span>
            {folder.pinned && (
              <span title="Pinned" className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-500/20">
                <Pin className="h-3 w-3 fill-amber-500" /> Pinned
              </span>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1 font-medium text-stone-700">
              <FileText className="h-3.5 w-3.5 text-stone-400" />
              {folder.docCount} {folder.docCount === 1 ? 'transcript' : 'transcripts'}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 text-stone-400" />
              {formatDate(folder.createdAt)}
            </span>
            {folder.recentCount > 0 && (
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                +{folder.recentCount} this week
              </span>
            )}
          </span>
        </span>
      </button>
      {/* Right — status + actions */}
      {!selectMode && (
        <span className="flex shrink-0 items-center gap-1 border-l border-stone-100 pl-2 opacity-80 transition-opacity group-hover:opacity-100 sm:pl-3">
          <ActionCluster folder={folder} {...actions} />
        </span>
      )}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded transition-all',
        active ? 'bg-white text-stone-900 shadow-xs ring-1 ring-stone-200/80' : 'text-stone-400 hover:bg-stone-200/50 hover:text-stone-700',
      )}
    >
      {children}
    </button>
  );
}

function DbErrorCard({
  error,
  dbHost = null,
  autoRetrying = false,
  attempt = 0,
  onRetry,
}: {
  error: string;
  dbHost?: string | null;
  autoRetrying?: boolean;
  attempt?: number;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyDiagnostics = async () => {
    const text = `Nukuzaa diagnostics\nTarget DB host: ${dbHost ?? '(no URL configured)'}\nAttempt: ${attempt ?? 0}\nError: ${error}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-6 text-center">
      <WifiOff className="mx-auto h-8 w-8 text-red-400" />
      <h2 className="mt-3 font-semibold text-red-900">Could not reach the database</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-red-700">{error}</p>
      <p className="mx-auto mt-2 max-w-md font-mono text-xs text-red-500">
        Target: {dbHost ?? '(no database URL configured — check .env)'}
      </p>
      {autoRetrying && (
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-amber-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Retrying automatically… (attempt {attempt ?? 0})
        </p>
      )}
      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          onClick={onRetry}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
        >
          Retry connection
        </button>
        <button
          onClick={copyDiagnostics}
          title="Copy error details (host + message, no secrets)"
          className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
    </div>
  );
}
