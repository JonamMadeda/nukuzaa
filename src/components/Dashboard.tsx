import { useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckSquare,
  Copy,
  FileText,
  FolderOpen,
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
  listFoldersWithCounts,
  listTranscripts,
  moveTranscript,
  searchTranscripts,
  setFolderArchived,
  setFolderPinned,
} from '../lib/db';
import { TranscriptError, extractVideoId } from '../lib/extractor';
import { importVideo } from '../lib/importer';
import { cn, formatBytes, formatDate } from '../lib/utils';
import { useToast } from '../hooks/useToast';

export type FolderViewMode = 'grid' | 'list';

interface Props {
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

  // Favorites shelf + storage glance.
  const [favDocs, setFavDocs] = useState<TranscriptDoc[]>([]);
  const [stats, setStats] = useState<StorageStats | null>(null);
  useEffect(() => {
    listFavoriteDocs(8).then(setFavDocs).catch(() => setFavDocs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.folders]);
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
      for (const id of ids) await deleteFolder(id);
      exitSelect();
      p.onFoldersChanged();
      notify('success', 'Folders deleted.');
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
    setBulkBusy(true);
    try {
      for (const id of ids) {
        const docs = await listTranscripts(id, 'newest');
        for (const d of docs) await moveTranscript(d.id, mergeTarget, true);
        await deleteFolder(id);
      }
      exitSelect();
      p.onFoldersChanged();
      notify('success', 'Folders merged.');
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Merge failed.');
    } finally {
      setBulkBusy(false);
    }
  };
  const mergeCandidates = p.folders.filter((f) => !selected.has(f.id));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Row 1: page identity + creation actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto leading-tight">
          <h1 className="text-xl font-bold tracking-tight">Your folders</h1>
          <p className="text-xs text-stone-500">
            {p.folders.length} {p.folders.length === 1 ? 'folder' : 'folders'} · {totalDocs}{' '}
            {totalDocs === 1 ? 'document' : 'documents'}
            {stats ? ` · ${formatBytes(stats.bytes)} stored` : ''} · {collections}{' '}
            {collections === 1 ? 'collection' : 'collections'}
          </p>
        </div>
        {!isEmpty && (
          <button
            onClick={() => setQuickOpen((v) => !v)}
            title="Quick-add a video to any folder"
            aria-pressed={quickOpen}
            disabled={showArchived}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-none border px-3.5 py-2.5 text-sm font-medium transition disabled:opacity-50',
              quickOpen
                ? 'border-stone-900 bg-stone-900 text-white'
                : 'border-stone-300 bg-white text-stone-500 hover:text-stone-800',
            )}
          >
            <Link2 className="h-4 w-4" />
            <span className="hidden sm:inline">Quick add</span>
          </button>
        )}
        <button
          onClick={p.onOpenCreate}
          className="inline-flex items-center gap-1.5 rounded-none bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-card hover:bg-stone-700"
        >
          <Plus className="h-4 w-4" /> New folder
        </button>
      </div>

      {/* Row 2: find + organize */}
      {!isEmpty && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              id="dashboard-search"
              value={p.search}
              onChange={(e) => p.onSearch(e.target.value)}
              placeholder="Search folders and transcripts…"
              disabled={showArchived}
              className="w-full rounded-none border border-stone-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 focus:ring-2 focus:ring-stone-200 disabled:bg-stone-50"
            />
          </div>
          <div
            title="View options"
            className="flex items-center gap-1 rounded-none border border-stone-300 bg-white p-1"
          >
            <ToggleBtn active={p.mode === 'grid'} onClick={() => p.onMode('grid')} label="Grid view">
              <LayoutGrid className="h-4 w-4" />
            </ToggleBtn>
            <ToggleBtn active={p.mode === 'list'} onClick={() => p.onMode('list')} label="List view">
              <List className="h-4 w-4" />
            </ToggleBtn>
            <span aria-hidden className="h-6 w-px bg-stone-200" />
            <select
              value={p.folderSort}
              onChange={(e) => p.onFolderSort(e.target.value as FolderSort)}
              title="Sort folders"
              disabled={showArchived}
              className="rounded-none border-0 bg-transparent px-2 py-2 text-sm text-stone-700 outline-none disabled:opacity-50"
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
              'inline-flex items-center gap-1.5 rounded-none border px-3.5 py-2.5 text-sm font-medium transition disabled:opacity-50',
              selectMode
                ? 'border-stone-900 bg-stone-900 text-white'
                : 'border-stone-300 bg-white text-stone-500 hover:text-stone-800',
            )}
          >
            <CheckSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Select</span>
          </button>
          <button
            onClick={openArchived}
            className="ml-auto text-xs font-medium text-stone-500 hover:text-stone-800 hover:underline"
          >
            {showArchived ? 'Hide archived' : 'Archived'}
          </button>
        </div>
      )}
      {showArchived && (
        <p className="mt-3 border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
          Browsing archived folders — search, sort, and bulk actions apply to live folders.
        </p>
      )}

      {/* Quick-add bar (expandable) */}
      {quickOpen && !p.loading && !p.dbError && p.folders.length > 0 && (
        <div className="mt-5 flex flex-col gap-3 rounded-none border border-stone-200 bg-white p-3 shadow-card sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              value={quickUrl}
              onChange={(e) => setQuickUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void quickAdd();
              }}
              placeholder="Quick add — paste a YouTube URL…"
              disabled={quickBusy}
              className="w-full rounded-none border border-stone-300 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 disabled:bg-stone-50"
            />
          </div>
          <select
            value={quickTarget}
            onChange={(e) => setQuickFolder(e.target.value)}
            title="Target folder"
            className="max-w-44 truncate rounded-none border border-stone-300 bg-white px-2 py-2 text-sm text-stone-700 outline-none focus:border-stone-900"
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
            className="inline-flex items-center justify-center gap-2 rounded-none bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {quickBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {quickBusy ? 'Saving…' : 'Add'}
          </button>
        </div>
      )}

      {/* Global document results */}
      {(docSearching || docResults.length > 0 || (q.length >= 2 && !p.loading && !p.dbError)) && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-stone-600">
            Documents {docSearching ? '— searching…' : docResults.length > 0 ? `(${docResults.length})` : '— no matches'}
          </p>
          {docResults.length > 0 && (
            <div className="mt-3 flex flex-col gap-3">
              {(showAllDocs ? docResults : docResults.slice(0, 6)).map((d) => (
                <button
                  key={d.id}
                  onClick={() => p.onOpenDoc(d)}
                  className="group flex items-center gap-4 rounded-none border border-stone-200 bg-white p-3.5 text-left shadow-card transition hover:border-stone-300 hover:shadow"
                >
                  {d.thumbnail ? (
                    <img src={d.thumbnail} alt="" loading="lazy" className="h-10 w-16 shrink-0 rounded-none object-cover" />
                  ) : (
                    <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-none bg-stone-100">
                      <FileText className="h-4 w-4 text-stone-400" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-stone-500">
                      {snippet(d, q) || `in ${d.folderTitle ?? 'a folder'}`}
                    </span>
                  </span>
                  <span className="hidden shrink-0 bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-600 sm:inline">
                    {d.folderTitle ?? ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {docResults.length > 6 && (
            <button
              onClick={() => setShowAllDocs((v) => !v)}
              className="mt-2 text-xs font-medium text-stone-500 hover:text-stone-800 hover:underline"
            >
              {showAllDocs ? 'Show fewer' : `Show all ${docResults.length} results`}
            </button>
          )}
        </div>
      )}

      {/* Favorites shelf */}
      {showShelves && favDocs.length > 0 && (
        <Shelf title="Favorites" icon={<Star className="h-3.5 w-3.5" />}>
          {favDocs.map((d) => (
            <button
              key={d.id}
              onClick={() => p.onOpenDoc(d)}
              title={d.title}
              className="group flex w-64 shrink-0 snap-start items-center gap-3 border border-stone-200 bg-white p-3 text-left transition hover:border-stone-400"
            >
              {d.thumbnail ? (
                <img src={d.thumbnail} alt="" loading="lazy" className="h-14 w-24 shrink-0 rounded-none object-cover" />
              ) : (
                <span className="flex h-14 w-24 shrink-0 items-center justify-center rounded-none bg-stone-100">
                  <Star className="h-4 w-4 text-amber-400" />
                </span>
              )}
              <span className="min-w-0">
                <span className="line-clamp-2 block text-xs font-semibold leading-snug">{d.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-stone-500">
                  {d.folderTitle ?? ''}
                </span>
              </span>
            </button>
          ))}
        </Shelf>
      )}

      {/* Bulk action bar */}
      {selectMode && (
        <div className="sticky bottom-4 z-30 mt-6 flex flex-wrap items-center gap-3 rounded-none border border-stone-300 bg-stone-100 px-4 py-2.5 text-sm text-stone-800 shadow-lg">
          <span className="font-medium">
            {selected.size} selected
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-3">
            <select
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              title="Merge target folder"
              className="rounded-none border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800 outline-none"
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
              className="rounded-none bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50"
            >
              Merge
            </button>
            <button
              onClick={bulkArchive}
              disabled={bulkBusy || selected.size === 0}
              className="rounded-none border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-200 disabled:opacity-50"
            >
              Archive
            </button>
            <button
              onClick={bulkDelete}
              disabled={bulkBusy || selected.size === 0}
              className="rounded-none bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={exitSelect}
              aria-label="Exit select mode"
              className="rounded-none p-1.5 text-stone-500 hover:text-stone-900"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
      )}

      {/* Content states */}
      {p.loading ? (
        <div className={cn('mt-6', p.mode === 'grid' ? 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3' : 'flex flex-col gap-3')}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-none border border-stone-200 bg-white p-4">
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
        <div className="mt-6">
          <p className="text-xs font-semibold text-stone-600">
            Archived ({archivedFolders.length})
          </p>
          {archivedLoading ? (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading archived folders…
            </p>
          ) : archivedFolders.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">Nothing archived. Archive a folder to hide it without deleting.</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {archivedFolders.map((f) => (
                <div key={f.id} className="border border-stone-200 bg-white p-4 opacity-90">
                  <div className="flex items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{f.title}</h3>
                    <span className="shrink-0 bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-500">
                      Archived
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {f.docCount} {f.docCount === 1 ? 'document' : 'documents'}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={() => restore(f)}
                      className="inline-flex items-center gap-1 rounded-none border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                    >
                      <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                    </button>
                    <button
                      onClick={() => p.onDeleteFolder(f)}
                      className="inline-flex items-center gap-1 rounded-none border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
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
          <div className="mt-4 rounded-none border border-dashed border-stone-300 bg-white p-8 text-center">
            <FolderOpen className="mx-auto h-8 w-8 text-stone-300" />
            <h2 className="mt-3 font-semibold">No folders match your search</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              Nothing named “{p.search.trim()}”. Try a different search.
            </p>
          </div>
        )
      ) : (
        <div className="mt-8">
          {q && (
            <p className="mb-3 text-xs font-semibold text-stone-600">
              Folders ({visible.length})
            </p>
          )}
          {pinned.length > 0 && !selectMode && !q && (
            <div className="mb-6">
              <p className="text-xs font-semibold text-stone-600">Pinned</p>
              <div className={cn('mt-3', p.mode === 'grid' ? 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3' : 'flex flex-col gap-3')}>
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
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="flex flex-col gap-3">
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

function Shelf({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-7">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-stone-600">
        {icon} {title}
      </p>
      <div className="nice-scroll mt-3 flex snap-x gap-3 overflow-x-auto scroll-px-4 pb-1">{children}</div>
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
    <div className="mt-4 rounded-none border border-stone-200 bg-white p-8 shadow-card">
      <h2 className="text-lg font-bold tracking-tight">Save your first transcript</h2>
      <ol className="mt-4 flex flex-col gap-3">
        {[
          ['1', 'Create a folder', 'Group videos by topic — e.g. “Machine Learning”.'],
          ['2', 'Paste any YouTube URL', 'Watch, youtu.be, or Shorts links all work.'],
          ['3', 'Read, search & export', 'Paragraphs or timestamps, copy, PDF, or download.'],
        ].map(([n, title, desc]) => (
          <li key={n} className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-stone-900 text-sm font-bold text-white">
              {n}
            </span>
            <span>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block text-sm text-stone-500">{desc}</span>
            </span>
          </li>
        ))}
      </ol>
      <button
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-2 rounded-none bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
      >
        <Plus className="h-4 w-4" /> Create your first folder
      </button>
      <p className="mt-3 text-xs text-stone-400">Tip: press / to search, n for a new folder, ? for all shortcuts.</p>
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
  // Hover-reveal on precise pointers; always visible on touch screens.
  const btn =
    'rounded-none p-1.5 text-stone-300 opacity-0 transition group-hover:opacity-100 hover:bg-stone-100 hover:text-stone-700 [@media(hover:none)]:opacity-100';
  return (
    <span className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
      <button onClick={a.onPin} title={a.folder.pinned ? 'Unpin folder' : 'Pin folder'} className={cn(btn, a.folder.pinned && 'text-stone-900 opacity-100')}>
        {a.folder.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
      </button>
      <button onClick={a.onEdit} title="Rename / recolor" className={btn}>
        <Pencil className="h-4 w-4" />
      </button>
      <button onClick={a.onArchive} title="Archive folder" className={btn}>
        <Archive className="h-4 w-4" />
      </button>
      <button
        onClick={a.onDelete}
        title="Delete folder"
        className="rounded-none p-1.5 text-stone-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
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
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-none border bg-white p-4 shadow-card transition hover:shadow',
        selected ? 'border-stone-900' : 'border-stone-200 hover:border-stone-300',
      )}
    >
      <div className="flex items-center gap-4">
        {selectMode ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            aria-label={selected ? 'Deselect folder' : 'Select folder'}
            className="flex h-10 w-10 shrink-0 items-center justify-center text-stone-500"
          >
            {selected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
          </button>
        ) : (
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-none', FOLDER_ACCENTS[folder.accent])}>
            <FolderOpen className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{folder.title}</h3>
          <p className="mt-0.5 truncate text-xs text-stone-500">
            {folder.docCount} {folder.docCount === 1 ? 'doc' : 'docs'}
            {folder.recentCount > 0 && ` · +${folder.recentCount} this week`}
          </p>
        </div>
        {!selectMode && <ActionCluster folder={folder} {...actions} />}
      </div>
    </div>
  );
}

function FolderRow({ folder, selectMode, selected, onToggleSelect, onOpen, ...actions }: CardProps & { folder: Folder }) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        'group flex items-center gap-4 rounded-none border bg-white p-4 text-left shadow-card transition hover:shadow',
        selected ? 'border-stone-900' : 'border-stone-200 hover:border-stone-300',
      )}
    >
      {selectMode ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center text-stone-500">
          {selected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
        </span>
      ) : (
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-none', FOLDER_ACCENTS[folder.accent])}>
          <FolderOpen className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{folder.title}</span>
        <span className="mt-0.5 block truncate text-xs text-stone-500">
          {folder.docCount} {folder.docCount === 1 ? 'doc' : 'docs'} · Created {formatDate(folder.createdAt)}
          {folder.recentCount > 0 && ` · +${folder.recentCount} this week`}
        </span>
      </span>
      {!selectMode && <ActionCluster folder={folder} {...actions} />}
    </button>
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
        'rounded-none p-2 transition',
        active ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800',
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
    <div className="mt-4 rounded-none border border-red-200 bg-red-50 p-6 text-center">
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
          className="rounded-none bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
        >
          Retry connection
        </button>
        <button
          onClick={copyDiagnostics}
          title="Copy error details (host + message, no secrets)"
          className="inline-flex items-center gap-1.5 rounded-none border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
    </div>
  );
}
