import { useState } from 'react';
import { FolderInput, Loader2, X } from 'lucide-react';
import type { Folder, TranscriptDoc } from '../lib/types';

interface Props {
  doc: TranscriptDoc | null;
  folders: Folder[];
  onClose: () => void;
  /** Returns 'moved' or 'conflict' (target already has this video). */
  onMove: (folderId: string, replace: boolean) => Promise<'moved' | 'conflict'>;
}

export default function MoveDocModal({ doc, folders, onClose, onMove }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [conflictFolder, setConflictFolder] = useState<string | null>(null);

  if (!doc) return null;
  const targets = folders.filter((f) => f.id !== doc.folderId);

  const choose = async (folderId: string, replace: boolean) => {
    setBusyId(folderId);
    try {
      const res = await onMove(folderId, replace);
      if (res === 'conflict') setConflictFolder(folderId);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-950/40 backdrop-blur-xs transition-opacity" onClick={busyId ? undefined : onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-floating">
        <div className="flex items-center justify-between border-b border-stone-100 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-900 shadow-xs">
              <FolderInput className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-stone-900">Move transcript</h2>
              <p className="text-xs text-stone-500">Relocate to another collection</p>
            </div>
          </div>
          {!busyId && (
            <button
              onClick={onClose}
              aria-label="Close move dialog"
              className="rounded-xl p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="p-5">
          <p className="truncate text-xs font-medium text-stone-500" title={doc.title}>
            Document: <span className="text-stone-800 font-semibold">“{doc.title}”</span>
          </p>
          {targets.length === 0 ? (
            <p className="mt-4 rounded-xl bg-stone-50 p-4 text-center text-xs text-stone-500">
              No other collections available yet — create one first.
            </p>
          ) : (
            <ul className="nice-scroll mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto pr-0.5">
              {targets.map((f) => (
                <li key={f.id} className="overflow-hidden rounded-xl border border-stone-200/80 bg-white transition hover:border-stone-300">
                  {conflictFolder === f.id ? (
                    <div className="bg-amber-50/60 p-3">
                      <p className="text-xs text-stone-700">
                        “{f.title}” already has this video. Replace it with this copy?
                      </p>
                      <div className="mt-2.5 flex gap-2">
                        <button
                          onClick={() => {
                            setConflictFolder(null);
                            void choose(f.id, true);
                          }}
                          disabled={busyId != null}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                        >
                          Replace
                        </button>
                        <button
                          onClick={() => setConflictFolder(null)}
                          className="ui-secondary px-3 py-1.5 text-xs"
                        >
                          Keep both
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => void choose(f.id, false)}
                      disabled={busyId != null}
                      className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition hover:bg-stone-50 disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-stone-900">{f.title}</span>
                        <span className="block text-xs text-stone-400">
                          {f.docCount} {f.docCount === 1 ? 'document' : 'documents'}
                        </span>
                      </span>
                      {busyId === f.id && <Loader2 className="h-4 w-4 animate-spin text-stone-500" />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
