import { useState } from 'react';
import { FolderInput, Loader2, X } from 'lucide-react';
import type { Folder, TranscriptDoc } from '../lib/types';
import { cn } from '../lib/utils';

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
      <div className="absolute inset-0 bg-stone-950/50" onClick={busyId ? undefined : onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-none border border-stone-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-none bg-stone-900 text-white">
              <FolderInput className="h-5 w-5" />
            </span>
            <h2 className="font-semibold">Move document</h2>
          </div>
          {!busyId && (
            <button
              onClick={onClose}
              aria-label="Close move dialog"
              className="rounded-none p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="p-5">
          <p className="truncate text-sm text-stone-500" title={doc.title}>
            “{doc.title}”
          </p>
          {targets.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">No other folders yet — create one first.</p>
          ) : (
            <ul className="nice-scroll mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {targets.map((f) => (
                <li key={f.id} className="border border-stone-200">
                  {conflictFolder === f.id ? (
                    <div className="px-3 py-2.5">
                      <p className="text-sm text-stone-700">
                        “{f.title}” already has this video. Replace it with this copy?
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => {
                            setConflictFolder(null);
                            void choose(f.id, true);
                          }}
                          disabled={busyId != null}
                          className="rounded-none bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                        >
                          Replace
                        </button>
                        <button
                          onClick={() => setConflictFolder(null)}
                          className="rounded-none border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                        >
                          Keep both
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => void choose(f.id, false)}
                      disabled={busyId != null}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-stone-50 disabled:opacity-50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{f.title}</span>
                        <span className="block text-xs text-stone-500">
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
