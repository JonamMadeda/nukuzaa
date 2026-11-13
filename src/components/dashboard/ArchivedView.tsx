import { ArchiveRestore, FolderArchive, Loader2, Trash2 } from 'lucide-react';
import type { Folder } from '../../lib/types';

interface ArchivedViewProps {
  folders: Folder[];
  loading: boolean;
  onRestore: (f: Folder) => void;
  onDelete: (f: Folder) => void;
}

export default function ArchivedView({
  folders,
  loading,
  onRestore,
  onDelete,
}: ArchivedViewProps) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <FolderArchive className="h-4 w-4 text-stone-500" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-stone-600">
          Archived Folders ({folders.length})
        </h2>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center justify-center p-8 text-sm text-stone-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-amber-600" />
          <span>Loading archived collections…</span>
        </div>
      ) : folders.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-stone-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-stone-600">No archived collections.</p>
          <p className="mt-1 text-xs text-stone-400">
            Archive folders from your library to tuck them away without deleting transcripts.
          </p>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((f) => (
            <div
              key={f.id}
              className="flex flex-col justify-between rounded-xl border border-stone-200/90 bg-white p-4 shadow-card transition hover:border-stone-300"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-stone-900" title={f.title}>
                    {f.title}
                  </h3>
                  <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-600">
                    Archived
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {f.docCount} {f.docCount === 1 ? 'document' : 'documents'}
                </p>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-stone-100 pt-3">
                <button
                  type="button"
                  onClick={() => onRestore(f)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 hover:text-stone-900"
                >
                  <ArchiveRestore className="h-3.5 w-3.5 text-stone-500" />
                  <span>Restore</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(f)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
