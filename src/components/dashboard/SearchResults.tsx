import { useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { TranscriptDoc } from '../../lib/types';

interface SearchResultsProps {
  query: string;
  results: TranscriptDoc[];
  searching: boolean;
  onOpenDoc: (doc: TranscriptDoc) => void;
}

function snippet(d: TranscriptDoc, q: string): string {
  if (!q) return '';
  const hay = `${d.title} ${(d.editedText ?? d.rawText).slice(0, 4000)}`.toLowerCase();
  const i = hay.indexOf(q.toLowerCase());
  if (i === -1) {
    const tag = d.tags.find((t) => t.toLowerCase().includes(q.toLowerCase()));
    return tag ? `#${tag}` : '';
  }
  const text = `${d.title} ${(d.editedText ?? d.rawText).slice(0, 4000)}`;
  const start = Math.max(0, i - 45);
  return `${start > 0 ? '…' : ''}${text.slice(start, i + q.length + 60).replace(/\s+/g, ' ')}…`;
}

export default function SearchResults({
  query,
  results,
  searching,
  onOpenDoc,
}: SearchResultsProps) {
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="mt-4 rounded-xl border border-stone-200/90 bg-white p-4 shadow-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-stone-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-stone-600">
            Transcripts {searching ? '— searching…' : results.length > 0 ? `(${results.length} found)` : '— no matches'}
          </h2>
        </div>
        {query.length >= 2 && !searching && results.length > 0 && (
          <span className="hidden text-xs text-stone-400 sm:inline">
            Matches in titles, transcript text, or tags
          </span>
        )}
      </div>

      {results.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {(showAll ? results : results.slice(0, 6)).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onOpenDoc(d)}
              className="group flex items-center gap-3.5 rounded-xl border border-stone-100 bg-stone-50/50 p-2.5 text-left transition hover:border-stone-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              {d.thumbnail ? (
                <img
                  src={d.thumbnail}
                  alt=""
                  loading="lazy"
                  className="h-10 w-16 shrink-0 rounded-lg object-cover ring-1 ring-stone-900/5 transition group-hover:scale-102"
                />
              ) : (
                <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-lg bg-stone-200/60 text-stone-400">
                  <FileText className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-sm font-bold text-stone-900 group-hover:text-amber-900">
                  {d.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-stone-500">
                  {snippet(d, query) || `Saved in ${d.folderTitle ?? 'a folder'}`}
                </span>
              </span>
              <span className="hidden shrink-0 rounded-md bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600 sm:inline">
                {d.folderTitle ?? 'Unsorted'}
              </span>
            </button>
          ))}
        </div>
      )}

      {results.length > 6 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs font-semibold text-amber-700 hover:text-amber-900 hover:underline"
        >
          {showAll ? 'Show fewer results' : `Show all ${results.length} results`}
        </button>
      )}
    </div>
  );
}
