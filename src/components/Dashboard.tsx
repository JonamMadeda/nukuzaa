import { useEffect, useState } from 'react';
import { Bookmark, Clock3, FolderOpen, Star } from 'lucide-react';
import type { Folder, StorageStats, TranscriptDoc } from '../lib/types';
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
import { cn } from '../lib/utils';
import { forgetFolder, relocateDoc } from '../lib/vault';
import { useToast } from '../hooks/useToast';

import type { DashboardProps } from './dashboard/types';
import HeaderStats from './dashboard/HeaderStats';
import SearchBar from './dashboard/SearchBar';
import QuickAddBar from './dashboard/QuickAddBar';
import SearchResults from './dashboard/SearchResults';
import DocumentShelf from './dashboard/DocumentShelf';
import FolderCard from './dashboard/FolderCard';
import FolderRow from './dashboard/FolderRow';
import BulkActionBar from './dashboard/BulkActionBar';
import ArchivedView from './dashboard/ArchivedView';
import DbErrorCard from './dashboard/DbErrorCard';
import Onboarding from './dashboard/Onboarding';

export type { FolderViewMode } from './dashboard/types';

export default function Dashboard(p: DashboardProps) {
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

  useEffect(() => {
    const query = p.search.trim();
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

  // Quick-add bar.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickUrl, setQuickUrl] = useState('');
  const [quickFolder, setQuickFolder] = useState('');
  const [quickActiveCount, setQuickActiveCount] = useState(0);
  const quickTarget = quickFolder || p.folders[0]?.id || '';

  const quickAdd = async () => {
    const input = quickUrl.trim();
    if (!input || !quickTarget) return;
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
    setQuickUrl('');
    setQuickActiveCount((c) => c + 1);
    void (async () => {
      try {
        const r = await importVideo(quickTarget, input);
        if (r.status === 'failed') throw new Error(r.detail ?? 'Import failed.');
        if (r.status === 'skipped') notify('info', `${r.title} — ${r.detail ?? 'skipped.'}`);
        else {
          p.onFoldersChanged();
          notify('success', `Saved “${r.title}”.`);
        }
      } catch (e) {
        if (e instanceof TranscriptError) notify('error', e.message);
        else notify('error', e instanceof Error ? e.message : 'Import failed.');
      } finally {
        setQuickActiveCount((c) => Math.max(0, c - 1));
      }
    })();
  };

  // Folder actions.
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
      setArchivedFolders(await listFoldersWithCounts('recent', true));
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not load archive.');
    } finally {
      setArchivedLoading(false);
    }
  };

  const restore = async (f: Folder) => {
    try {
      await setFolderArchived(f.id, false);
      setArchivedFolders((prev) => prev.filter((x) => x.id !== f.id));
      p.onFoldersChanged();
      notify('success', `Restored “${f.title}”.`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not restore folder.');
    }
  };

  // Bulk folder selection.
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
      {/* Page identity + Quick action buttons */}
      <HeaderStats
        folderCount={p.folders.length}
        totalDocs={totalDocs}
        activeCollections={collections}
        stats={stats}
        quickOpen={quickOpen}
        onToggleQuickOpen={() => setQuickOpen((v) => !v)}
        onOpenCreate={p.onOpenCreate}
        isEmpty={isEmpty}
        showArchived={showArchived}
      />

      {/* Toolbar & Search Bar */}
      {!isEmpty && (
        <SearchBar
          search={p.search}
          onSearch={p.onSearch}
          mode={p.mode}
          onMode={p.onMode}
          folderSort={p.folderSort}
          onFolderSort={p.onFolderSort}
          selectMode={selectMode}
          onToggleSelectMode={() => setSelectMode((v) => !v)}
          showArchived={showArchived}
          onToggleArchived={openArchived}
        />
      )}

      {showArchived && (
        <p className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-2.5 text-xs font-medium text-amber-900">
          Browsing archived collections — search, sort, and bulk actions apply to live library collections.
        </p>
      )}

      {/* Quick-add bar */}
      {quickOpen && !p.loading && !p.dbError && p.folders.length > 0 && (
        <QuickAddBar
          url={quickUrl}
          onUrlChange={setQuickUrl}
          targetFolder={quickTarget}
          onTargetFolderChange={setQuickFolder}
          folders={p.folders}
          activeCount={quickActiveCount}
          onSubmit={quickAdd}
        />
      )}

      {/* Global document search results */}
      {(docSearching || docResults.length > 0 || (q.length >= 2 && !p.loading && !p.dbError)) && (
        <SearchResults
          query={p.search}
          results={docResults}
          searching={docSearching}
          onOpenDoc={p.onOpenDoc}
        />
      )}

      {/* Revisit shelves */}
      {showShelves && recentDocs.length > 0 && (
        <DocumentShelf
          title="Recently opened"
          icon={<Clock3 className="h-3.5 w-3.5" />}
          docs={recentDocs}
          onOpen={p.onOpenDoc}
          mode={p.mode}
          layout="horizontal"
        />
      )}
      {showShelves && favDocs.length > 0 && (
        <DocumentShelf
          title="Favorites"
          icon={<Star className="h-3.5 w-3.5" />}
          docs={favDocs}
          onOpen={p.onOpenDoc}
          mode={p.mode}
        />
      )}
      {showShelves && highlightDocs.length > 0 && (
        <DocumentShelf
          title="Saved highlights"
          icon={<Bookmark className="h-3.5 w-3.5" />}
          docs={highlightDocs}
          onOpen={p.onOpenDoc}
          mode={p.mode}
          detail={(doc) =>
            `${doc.highlights.length} ${doc.highlights.length === 1 ? 'highlight' : 'highlights'} · ${doc.folderTitle ?? 'Folder'}`
          }
        />
      )}

      {/* Floating bulk action bar */}
      {selectMode && (
        <BulkActionBar
          selectedCount={selected.size}
          mergeTarget={mergeTarget}
          onMergeTargetChange={setMergeTarget}
          mergeCandidates={mergeCandidates}
          busy={bulkBusy}
          onMerge={bulkMerge}
          onArchive={bulkArchive}
          onDelete={bulkDelete}
          onExit={exitSelect}
        />
      )}

      {/* Main Content Areas */}
      {p.loading ? (
        <div
          className={cn(
            'mt-5',
            p.mode === 'grid'
              ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              : 'grid grid-cols-1 gap-2.5',
          )}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-stone-200 bg-white p-4 shadow-xs">
              <div className="h-4 w-2/3 animate-pulse rounded bg-stone-200" />
              <div className="mt-2.5 h-3 w-1/3 animate-pulse rounded bg-stone-100" />
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
        <ArchivedView
          folders={archivedFolders}
          loading={archivedLoading}
          onRestore={restore}
          onDelete={p.onDeleteFolder}
        />
      ) : visible.length === 0 ? (
        p.folders.length === 0 ? (
          <Onboarding onCreate={p.onOpenCreate} />
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center shadow-xs">
            <FolderOpen className="mx-auto h-8 w-8 text-stone-300" />
            <h2 className="mt-2.5 text-base font-bold text-stone-800">No collections match your search</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              Nothing found for “{p.search.trim()}”. Try searching with different keywords.
            </p>
            <button
              type="button"
              onClick={() => p.onSearch('')}
              className="mt-4 inline-flex items-center rounded-xl bg-amber-50 px-3.5 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            >
              Clear search
            </button>
          </div>
        )
      ) : (
        <div className="mt-6">
          {q && (
            <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-stone-500">
              Matching Collections ({visible.length})
            </p>
          )}

          {/* Pinned collections */}
          {pinned.length > 0 && !selectMode && !q && (
            <div className="mb-6">
              <div className="mb-2.5 flex items-center gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-500">Pinned</span>
                <span className="rounded-full bg-stone-100 px-2 py-0.2 text-[10px] font-semibold text-stone-600">
                  {pinned.length}
                </span>
              </div>
              <div
                className={cn(
                  p.mode === 'grid'
                    ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                    : 'grid grid-cols-1 gap-2.5',
                )}
              >
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

          {/* All / Unpinned collections */}
          {pinned.length > 0 && !selectMode && !q && (
            <div className="mb-2.5 flex items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-500">All Collections</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.2 text-[10px] font-semibold text-stone-600">
                {unpinned.length}
              </span>
            </div>
          )}

          {p.mode === 'grid' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
            <div className="grid grid-cols-1 gap-2.5">
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
