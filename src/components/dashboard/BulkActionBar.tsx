import { Archive, Merge, Trash2, X } from 'lucide-react';
import type { Folder } from '../../lib/types';

interface BulkActionBarProps {
  selectedCount: number;
  mergeTarget: string;
  onMergeTargetChange: (id: string) => void;
  mergeCandidates: Folder[];
  busy: boolean;
  onMerge: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onExit: () => void;
}

export default function BulkActionBar({
  selectedCount,
  mergeTarget,
  onMergeTargetChange,
  mergeCandidates,
  busy,
  onMerge,
  onArchive,
  onDelete,
  onExit,
}: BulkActionBarProps) {
  return (
    <div className="sticky bottom-4 z-30 mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-stone-800 bg-stone-900/95 px-4 py-3 text-sm text-white shadow-floating backdrop-blur-md">
      <span className="flex items-center gap-2 font-semibold">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-400 text-xs font-bold text-stone-950">
          {selectedCount}
        </span>
        <span>selected</span>
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <select
          value={mergeTarget}
          onChange={(e) => onMergeTargetChange(e.target.value)}
          title="Merge target folder"
          className="h-8.5 rounded-lg border border-stone-700 bg-stone-800 px-3 text-xs font-medium text-stone-200 outline-none transition focus:border-amber-400"
        >
          <option value="">Merge into…</option>
          {mergeCandidates.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onMerge}
          disabled={busy || selectedCount === 0 || !mergeTarget}
          className="ui-primary-amber flex h-8.5 items-center gap-1.5 px-3 text-xs font-semibold"
        >
          <Merge className="h-3.5 w-3.5" />
          <span>Merge</span>
        </button>

        <button
          type="button"
          onClick={onArchive}
          disabled={busy || selectedCount === 0}
          className="flex h-8.5 items-center gap-1.5 rounded-lg border border-stone-700 bg-stone-800 px-3 text-xs font-medium text-stone-300 transition hover:bg-stone-700 hover:text-white disabled:opacity-50"
        >
          <Archive className="h-3.5 w-3.5" />
          <span>Archive</span>
        </button>

        <button
          type="button"
          onClick={onDelete}
          disabled={busy || selectedCount === 0}
          className="flex h-8.5 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete</span>
        </button>

        <button
          type="button"
          onClick={onExit}
          aria-label="Exit select mode"
          className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
