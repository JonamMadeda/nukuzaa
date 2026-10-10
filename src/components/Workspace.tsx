import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  FileText,
  FolderInput,
  Link2,
  ListPlus,
  Loader2,
  Plus,
  Star,
  Trash2,
  WifiOff,
} from 'lucide-react';
import {
  deleteTranscript,
  findDuplicateVideo,
  listTranscripts,
  moveTranscript,
  updateTranscriptMeta,
} from '../lib/db';
import {
  TranscriptError,
  extractPlaylistIds,
  extractVideoId,
} from '../lib/extractor';
import { importVideo, type ImportOutcome } from '../lib/importer';
import type { DocSort, Folder, TranscriptDoc } from '../lib/types';
import { cn, formatDate, friendlyDbError } from '../lib/utils';
import { getCachedDocs, removeCachedDoc } from '../lib/cache';
import { useToast } from '../hooks/useToast';
import BulkImportModal from './BulkImportModal';
import MoveDocModal from './MoveDocModal';

interface Props {
  folder: Folder;
  allFolders: Folder[];
  onBack: () => void;
  onDocsChanged: () => void;
  onOpenDoc: (d: TranscriptDoc) => void;
  /** Bumped by the shell when the reader closes so card state stays fresh. */
  refreshKey: number;
}

export type { ImportOutcome };

export default function Workspace({ folder, allFolders, onBack, onDocsChanged, onOpenDoc, refreshKey }: Props) {
  const { notify } = useToast();
  const [url, setUrl] = useState('');
  const [docs, setDocs] = useState<TranscriptDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sort, setSort] = useState<DocSort>('newest');
  const [favOnly, setFavOnly] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [movingDoc, setMovingDoc] = useState<TranscriptDoc | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDocs(await listTranscripts(folder.id, sort, favOnly));
    } catch (e) {
      setLoadError(friendlyDbError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder.id, sort, favOnly, refreshKey]);

  /** Core importer shared by single + bulk adds. Never prompts (bulk-safe). */
  const importOne = async (rawUrl: string): Promise<ImportOutcome> => {
    const outcome = await importVideo(folder.id, rawUrl);
    if (outcome.status === 'saved' && outcome.doc) {
      const saved = outcome.doc;
      setDocs((prev) => {
        const rest = prev.filter((d) => d.videoId !== saved.videoId);
        return [saved, ...rest];
      });
    }
    return outcome;
  };

  const addDocument = async () => {
    const input = url.trim();
    if (!input || extracting) return;
    // Playlist shortcut: a ?list= URL opens the bulk importer prefilled.
    if (/[?&]list=/.test(input)) {
      setBulkOpen(true);
      return;
    }
    // Duplicate prompt for interactive adds (elsewhere only — same-folder is an update).
    const videoId = extractVideoId(input);
    if (videoId) {
      try {
        const dupes = await findDuplicateVideo(videoId);
        const elsewhere = dupes.filter((d) => d.folderId !== folder.id);
        if (elsewhere.length > 0) {
          const ok = window.confirm(
            `This video is already saved in ${elsewhere.map((d) => `“${d.folderTitle}”`).join(', ')}. Save a copy here too?`,
          );
          if (!ok) return;
        }
      } catch {
        /* duplicate check is best-effort */
      }
    }
    setExtracting(true);
    try {
      notify('info', 'Fetching captions from YouTube…');
      const outcome = await importOne(input);
      if (outcome.status === 'failed') throw new Error(outcome.detail ?? 'Import failed.');
      if (outcome.status === 'skipped') {
        notify('info', `${outcome.title} — ${outcome.detail ?? 'skipped.'}`);
      } else {
        setUrl('');
        onDocsChanged();
        notify('success', `Saved “${outcome.title}”.${outcome.detail ? ` ${outcome.detail}` : ''}`);
      }
    } catch (e) {
      if (e instanceof TranscriptError) notify('error', e.message);
      else notify('error', e instanceof Error ? e.message : friendlyDbError(e));
    } finally {
      setExtracting(false);
    }
  };

  const toggleFavorite = async (d: TranscriptDoc) => {
    try {
      const updated = await updateTranscriptMeta(d.id, d, { favorite: !d.favorite });
      setDocs((prev) => prev.map((x) => (x.id === d.id ? updated : x)));
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not update favorite.');
    }
  };

  const handleMove = async (folderId: string, replace: boolean): Promise<'moved' | 'conflict'> => {
    if (!movingDoc) return 'moved';
    try {
      const res = await moveTranscript(movingDoc.id, folderId, replace);
      if (res.status === 'conflict') return 'conflict';
      setDocs((prev) => prev.filter((x) => x.id !== movingDoc.id));
      removeCachedDoc(movingDoc.id);
      setMovingDoc(null);
      onDocsChanged();
      notify('success', 'Document moved.');
      return 'moved';
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not move document.');
      return 'moved';
    }
  };

  const removeDoc = async (d: TranscriptDoc) => {    if (!window.confirm(`Delete “${d.title}” from this folder?`)) return;
    setDeletingId(d.id);
    try {
      await deleteTranscript(d.id);
      removeCachedDoc(d.id);
      setDocs((prev) => prev.filter((x) => x.id !== d.id));
      onDocsChanged();
      notify('success', 'Document deleted.');
    } catch (e) {
      notify('error', friendlyDbError(e));
    } finally {
      setDeletingId(null);
    }
  };

  const cachedHere = loadError ? getCachedDocs().filter((d) => d.folderId === folder.id) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={onBack}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Folders
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="truncate text-lg font-bold tracking-tight">{folder.title}</h1>
          <p className="text-xs text-stone-500">
            {folder.docCount} saved {folder.docCount === 1 ? 'transcript' : 'transcripts'}
            {favOnly ? ' · Showing favorites' : ' · All transcripts'}
          </p>
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as DocSort)}
          aria-label="Sort transcripts"
          title="Sort documents"
          className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm text-stone-700 outline-none focus:border-stone-900"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="title">Title A–Z</option>
        </select>
        <button
          onClick={() => setFavOnly((v) => !v)}
          title={favOnly ? 'Show all documents' : 'Show favorites only'}
          aria-label={favOnly ? 'Show all transcripts' : 'Show favorite transcripts only'}
          aria-pressed={favOnly}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
            favOnly
              ? 'border-stone-900 bg-stone-900 text-white'
              : 'border-stone-300 bg-white text-stone-500 hover:text-amber-600',
          )}
        >
          <Star className={cn('h-4 w-4', favOnly && 'fill-amber-400 text-amber-400')} />
          <span className="hidden sm:inline">Favorites</span>
        </button>
      </div>

      {/* Add-document bar */}
      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-2 shadow-card sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            id="workspace-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addDocument();
            }}
            placeholder="Paste any YouTube URL — watch, youtu.be, Shorts, or playlist…"
            disabled={extracting}
            className="w-full rounded-lg border border-stone-300 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 focus:ring-2 focus:ring-stone-200 disabled:bg-stone-50"
          />
        </div>
        <button
          onClick={addDocument}
          disabled={!url.trim() || extracting}
          className="ui-primary"
        >
          {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {extracting ? 'Extracting…' : 'Add document'}
        </button>
        <button
          onClick={() => setBulkOpen(true)}
          title="Import many URLs or a playlist at once"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          <ListPlus className="h-4 w-4" /> Bulk
        </button>
      </div>
      {extracting && (
        <p className="mt-2 text-xs text-stone-500">
          Reading the watch page + caption XML on this device — usually a few seconds.
        </p>
      )}

      {/* Document list */}
      {loading ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="aspect-video animate-pulse bg-stone-200" />
              <div className="p-3">
                <div className="h-4 w-3/4 animate-pulse rounded-lg bg-stone-200" />
                <div className="mt-2 h-3 w-1/3 animate-pulse rounded-lg bg-stone-100" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div>
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-6 text-center">
            <WifiOff className="mx-auto h-8 w-8 text-red-400" />
            <h2 className="mt-3 font-semibold text-red-900">Could not load documents</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-red-700">{loadError}</p>
            <button
              onClick={refresh}
              className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
            >
              Retry
            </button>
          </div>
          {cachedHere.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Available offline ({cachedHere.length})
              </p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {cachedHere.map((d) => (
                  <OfflineCard key={d.id} doc={d} onOpen={() => onOpenDoc(d)} />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : docs.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-stone-300" />
          <h2 className="mt-3 font-semibold">No documents yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            Paste a YouTube URL above — the transcript is extracted on this device and kept private to your account.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {docs.map((d) => (
            <article
              key={d.id}
              className="group overflow-hidden rounded-xl border border-stone-200 bg-white shadow-card transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md"
            >
              <button onClick={() => onOpenDoc(d)} aria-label={`Read transcript: ${d.title}`} className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yellow-700">
                <div className="relative aspect-video overflow-hidden bg-stone-100">
                  {d.thumbnail ? (
                    <img src={d.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <FileText className="h-8 w-8 text-stone-300" />
                    </div>
                  )}
                  <span className="absolute bottom-2 right-2 rounded-md bg-stone-950/80 px-2 py-1 text-[11px] font-medium text-white">
                    {d.captions.length} cues
                  </span>
                  {d.favorite && <Star aria-label="Favorite" className="absolute left-2 top-2 h-5 w-5 fill-yellow-300 text-yellow-300 drop-shadow" />}
                </div>
                <div className="p-3 pb-2">
                  <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-stone-900">{d.title}</h3>
                  {d.tags.length > 0 && (
                    <p className="mt-2 truncate text-[11px] text-stone-500">
                      {d.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}
                      {d.tags.length > 3 ? ` +${d.tags.length - 3}` : ''}
                    </p>
                  )}
                </div>
              </button>
              <div className="flex items-center justify-between border-t border-stone-100 px-3 py-1.5">
                <p className="text-xs text-stone-500">{formatDate(d.createdAt)}</p>
                <span className="flex items-center">
                  <button
                    type="button"
                    title={d.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-label={d.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-pressed={d.favorite}
                    onClick={() => void toggleFavorite(d)}
                    className={cn('rounded-md p-2 transition hover:bg-yellow-50', d.favorite ? 'text-amber-600' : 'text-stone-500 hover:text-amber-700')}
                  >
                    <Star className={cn('h-4 w-4', d.favorite && 'fill-yellow-300')} />
                  </button>
                  <button
                    type="button"
                    title="Move to another folder"
                    aria-label="Move to another folder"
                    onClick={() => setMovingDoc(d)}
                    className="rounded-md p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"
                  >
                    <FolderInput className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Delete document"
                    aria-label="Delete document"
                    disabled={deletingId === d.id}
                    onClick={() => void removeDoc(d)}
                    className="rounded-md p-2 text-stone-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  >
                    {deletingId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      <MoveDocModal
        doc={movingDoc}
        folders={allFolders}
        onClose={() => setMovingDoc(null)}
        onMove={handleMove}
      />
      <BulkImportModal
        open={bulkOpen}
        initialText={/[?&]list=/.test(url) ? url : ''}
        onClose={() => setBulkOpen(false)}
        onExpandPlaylist={extractPlaylistIds}
        onImport={importOne}
        onDone={() => {
          onDocsChanged();
          void refresh();
        }}
      />
    </div>
  );
}

function OfflineCard({ doc, onOpen }: { doc: TranscriptDoc; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="overflow-hidden rounded-lg border border-dashed border-stone-300 bg-white text-left transition hover:border-stone-400"
    >
      <div className="p-3">
        <h3 className="line-clamp-2 min-h-[2.25rem] text-sm font-semibold leading-snug">{doc.title}</h3>
        <p className="mt-1 text-[11px] text-stone-500">Saved copy — edits unavailable offline</p>
      </div>
    </button>
  );
}
