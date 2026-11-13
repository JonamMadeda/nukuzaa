import { Database, FileText, Folder as FolderIcon, HardDrive, Link2, Plus } from 'lucide-react';
import { cn, formatBytes } from '../../lib/utils';
import type { StorageStats } from '../../lib/types';

interface HeaderStatsProps {
  folderCount: number;
  totalDocs: number;
  activeCollections: number;
  stats: StorageStats | null;
  quickOpen: boolean;
  onToggleQuickOpen: () => void;
  onOpenCreate: () => void;
  isEmpty: boolean;
  showArchived: boolean;
}

export default function HeaderStats({
  folderCount,
  totalDocs,
  activeCollections,
  stats,
  quickOpen,
  onToggleQuickOpen,
  onOpenCreate,
  isEmpty,
  showArchived,
}: HeaderStatsProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-stone-900 sm:text-2xl">
          Library
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <span className="inline-flex items-center gap-1 font-semibold text-stone-700">
            <FolderIcon className="h-3.5 w-3.5 text-stone-400" />
            <span>{folderCount} {folderCount === 1 ? 'folder' : 'folders'}</span>
          </span>
          <span className="text-stone-300">·</span>
          <span className="inline-flex items-center gap-1 text-stone-600">
            <FileText className="h-3.5 w-3.5 text-stone-400" />
            <span>{totalDocs} {totalDocs === 1 ? 'transcript' : 'transcripts'}</span>
          </span>
          {stats && (
            <>
              <span className="text-stone-300">·</span>
              <span className="inline-flex items-center gap-1 text-stone-600">
                <HardDrive className="h-3.5 w-3.5 text-stone-400" />
                <span>{formatBytes(stats.bytes)} stored</span>
              </span>
            </>
          )}
          {activeCollections > 0 && (
            <>
              <span className="text-stone-300">·</span>
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <Database className="h-3 w-3 text-emerald-600" />
                <span>{activeCollections} active</span>
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!isEmpty && (
          <button
            type="button"
            onClick={onToggleQuickOpen}
            title="Quick-add a video to any folder"
            aria-pressed={quickOpen}
            disabled={showArchived}
            className={cn(
              'ui-secondary h-9 px-3.5 text-xs font-semibold shadow-xs transition',
              quickOpen &&
                'border-stone-900 bg-stone-900 text-white hover:border-stone-900 hover:bg-stone-800 hover:text-white',
            )}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>Quick add</span>
          </button>
        )}
        <button
          type="button"
          onClick={onOpenCreate}
          className="ui-primary h-9 px-3.5 text-xs font-semibold shadow-xs"
        >
          <Plus className="h-4 w-4" />
          <span>New folder</span>
        </button>
      </div>
    </div>
  );
}
