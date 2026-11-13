import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import type { TranscriptDoc } from '../../lib/types';
import type { FolderViewMode } from './types';
import { formatDate } from '../../lib/utils';

interface ShelfProps {
  title: string;
  icon: ReactNode;
  docs: TranscriptDoc[];
  onOpen: (doc: TranscriptDoc) => void;
  detail?: (doc: TranscriptDoc) => string;
  mode: FolderViewMode;
  layout?: 'auto' | 'horizontal';
}

export default function DocumentShelf({
  title,
  icon,
  docs,
  onOpen,
  detail,
  mode,
  layout = 'auto',
}: ShelfProps) {
  if (docs.length === 0) return null;

  const showRow = layout === 'horizontal' || mode !== 'list';

  return (
    <div className="mt-7">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-amber-900 shadow-2xs">
          {icon}
        </span>
        <h2 className="text-xs font-bold uppercase tracking-wider text-stone-700">
          {title}
        </h2>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-stone-600">
          {docs.length}
        </span>
      </div>

      {mode === 'list' && !showRow ? (
        <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onOpen(doc)}
              title={doc.title}
              className="group flex items-center gap-3.5 rounded-xl border border-stone-200/90 bg-white p-3 text-left shadow-card transition-all hover:border-stone-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              {doc.thumbnail ? (
                <img
                  src={doc.thumbnail}
                  alt=""
                  loading="lazy"
                  className="h-11 w-18 shrink-0 rounded-lg object-cover ring-1 ring-stone-900/5 transition-transform group-hover:scale-102"
                />
              ) : (
                <span className="flex h-11 w-18 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-400">
                  <FileText className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-stone-900 group-hover:text-amber-900">
                  {doc.title}
                </span>
                <span className="mt-1 block truncate text-xs text-stone-500">
                  {detail ? detail(doc) : doc.folderTitle ?? 'Unsorted'} · {formatDate(doc.createdAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="nice-scroll mt-3 flex snap-x gap-3 overflow-x-auto scroll-px-4 pb-2">
          {docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onOpen(doc)}
              title={doc.title}
              className="group flex w-60 shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-stone-200/90 bg-white text-left shadow-card transition-all hover:border-stone-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-stone-100">
                {doc.thumbnail ? (
                  <img
                    src={doc.thumbnail}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-stone-400">
                    {icon}
                  </div>
                )}
                {doc.captions?.length > 0 && (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-stone-950/75 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
                    {doc.captions.length} cues
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col p-3">
                <span className="line-clamp-2 min-h-[2.6em] text-xs font-semibold leading-snug text-stone-900 group-hover:text-amber-900">
                  {doc.title}
                </span>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] text-stone-500">
                  <span className="min-w-0 flex-1 truncate font-medium text-stone-600">
                    {detail ? detail(doc) : doc.folderTitle ?? 'Unsorted'}
                  </span>
                  <span className="shrink-0 tabular-nums text-stone-400">{formatDate(doc.createdAt)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
