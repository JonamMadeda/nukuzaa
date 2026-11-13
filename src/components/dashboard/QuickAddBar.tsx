import { Link2, Loader2, Plus } from 'lucide-react';
import type { Folder } from '../../lib/types';

interface QuickAddBarProps {
  url: string;
  onUrlChange: (val: string) => void;
  targetFolder: string;
  onTargetFolderChange: (val: string) => void;
  folders: Folder[];
  activeCount: number;
  onSubmit: () => void;
}

export default function QuickAddBar({
  url,
  onUrlChange,
  targetFolder,
  onTargetFolderChange,
  folders,
  activeCount,
  onSubmit,
}: QuickAddBarProps) {
  return (
    <div className="mt-3 flex flex-col gap-2.5 rounded-xl border border-stone-200/90 bg-white p-3 shadow-card sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSubmit();
          }}
          placeholder="Paste any YouTube URL (watch, youtu.be, Shorts)…"
          className="h-10 w-full rounded-lg border border-stone-200 py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-200/60"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={targetFolder}
          onChange={(e) => onTargetFolderChange(e.target.value)}
          title="Target collection folder"
          className="h-10 max-w-52 truncate rounded-lg border border-stone-200 bg-white px-3 text-sm font-medium text-stone-700 outline-none transition hover:border-stone-300 focus:border-stone-400"
        >
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>

        {activeCount > 0 && (
          <span className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
            <span>{activeCount} downloading</span>
          </span>
        )}

        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={!url.trim() || !targetFolder}
          className="ui-primary h-10 px-4 text-xs font-semibold"
        >
          <Plus className="h-4 w-4" />
          <span>Add to folder</span>
        </button>
      </div>
    </div>
  );
}
