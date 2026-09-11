import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  FileText,
  Link2,
  Loader2,
  Plus,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { deleteTranscript, listTranscripts, saveTranscript } from '../lib/db';
import { TranscriptError, extractTranscriptFromUrl } from '../lib/extractor';
import type { Folder, TranscriptDoc } from '../lib/types';
import { formatDate, friendlyDbError } from '../lib/utils';
import { useToast } from '../hooks/useToast';

interface Props {
  folder: Folder;
  onBack: () => void;
  onDocsChanged: () => void;
  onOpenDoc: (d: TranscriptDoc) => void;
}

export default function Workspace({ folder, onBack, onDocsChanged, onOpenDoc }: Props) {
  const { notify } = useToast();
  const [url, setUrl] = useState('');
  const [docs, setDocs] = useState<TranscriptDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDocs(await listTranscripts(folder.id));
    } catch (e) {
      setLoadError(friendlyDbError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder.id]);

  const addDocument = async () => {
    const input = url.trim();
    if (!input || extracting) return;
    setExtracting(true);
    try {
      notify('info', 'Fetching captions from YouTube…');
      const data = await extractTranscriptFromUrl(input);
      const saved = await saveTranscript({
        folderId: folder.id,
        videoId: data.videoId,
        title: data.title,
        thumbnail: data.thumbnail,
        url: data.url,
        rawText: data.rawText,
        captions: data.captions,
      });
      setDocs((prev) => {
        const rest = prev.filter((d) => d.videoId !== saved.videoId);
        return [saved, ...rest];
      });
      setUrl('');
      onDocsChanged();
      notify('success', `Saved “${saved.title}” (${saved.captions.length} cues).`);
    } catch (e) {
      if (e instanceof TranscriptError) notify('error', e.message);
      else notify('error', friendlyDbError(e));
    } finally {
      setExtracting(false);
    }
  };

  const removeDoc = async (d: TranscriptDoc) => {
    if (!window.confirm(`Delete “${d.title}” from this folder?`)) return;
    setDeletingId(d.id);
    try {
      await deleteTranscript(d.id);
      setDocs((prev) => prev.filter((x) => x.id !== d.id));
      onDocsChanged();
      notify('success', 'Document deleted.');
    } catch (e) {
      notify('error', friendlyDbError(e));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Folders
      </button>

      <h1 className="mt-5 truncate text-2xl font-bold tracking-tight">{folder.title}</h1>
      <p className="mt-1 text-sm text-stone-500">
        {docs.length} {docs.length === 1 ? 'document' : 'documents'} in this collection
      </p>

      {/* Add-document bar */}
      <div className="mt-5 flex flex-col gap-2 rounded-2xl border border-stone-200 bg-white p-3 shadow-card sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addDocument();
            }}
            placeholder="Paste any YouTube URL — watch, youtu.be, or Shorts..."
            disabled={extracting}
            className="w-full rounded-xl border border-stone-300 py-2.5 pl-10 pr-4 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 focus:ring-2 focus:ring-stone-200 disabled:bg-stone-50"
          />
        </div>
        <button
          onClick={addDocument}
          disabled={!url.trim() || extracting}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {extracting ? 'Extracting…' : 'Add document'}
        </button>
      </div>
      {extracting && (
        <p className="mt-2 text-xs text-stone-500">
          Reading the watch page + caption XML on this device — usually a few seconds.
        </p>
      )}

      {/* Document list */}
      {loading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              <div className="aspect-video animate-pulse bg-stone-200" />
              <div className="p-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-stone-200" />
                <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-stone-100" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
          <WifiOff className="mx-auto h-8 w-8 text-red-400" />
          <h2 className="mt-3 font-semibold text-red-900">Could not load documents</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-red-700">{loadError}</p>
          <button
            onClick={refresh}
            className="mt-4 rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
          >
            Retry
          </button>
        </div>
      ) : docs.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center">
          <FileText className="mx-auto h-10 w-10 text-stone-300" />
          <h2 className="mt-3 font-semibold">No documents yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            Paste a YouTube URL above — the transcript is extracted on this device and stored in Neon.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => (
            <article
              key={d.id}
              onClick={() => onOpenDoc(d)}
              className="group cursor-pointer overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow"
            >
              <div className="relative aspect-video overflow-hidden bg-stone-100">
                {d.thumbnail ? (
                  <img src={d.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <FileText className="h-8 w-8 text-stone-300" />
                  </div>
                )}
                <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {d.captions.length} cues
                </span>
              </div>
              <div className="p-4">
                <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug">{d.title}</h3>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-stone-500">{formatDate(d.createdAt)}</p>
                  <button
                    title="Delete document"
                    disabled={deletingId === d.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDoc(d);
                    }}
                    className="rounded-lg p-1.5 text-stone-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    {deletingId === d.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
