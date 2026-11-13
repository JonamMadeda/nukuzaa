import { CheckSquare, FolderOpen, Pin, Square } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { FOLDER_ACCENTS } from '../../lib/types';
import type { Folder } from '../../lib/types';
import type { CardProps } from './types';
import FolderActions from './FolderActions';

export default function FolderCard({
  folder,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  ...actions
}: CardProps & { folder: Folder }) {
  return (
    <div
      className={cn(
        'group flex flex-col justify-between rounded-xl border bg-white p-4 shadow-card transition-all duration-200 hover:border-stone-300 hover:shadow-card-hover',
        selected ? 'border-stone-900 ring-2 ring-stone-900/10' : 'border-stone-200/90',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={selectMode ? onToggleSelect : onOpen}
          aria-label={selectMode ? `${selected ? 'Deselect' : 'Select'} ${folder.title}` : `Open ${folder.title}`}
          aria-pressed={selectMode ? selected : undefined}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          {selectMode ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-stone-500">
              {selected ? <CheckSquare className="h-5 w-5 text-stone-900" /> : <Square className="h-5 w-5" />}
            </span>
          ) : (
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-xs transition-transform group-hover:scale-105',
                FOLDER_ACCENTS[folder.accent],
              )}
            >
              <FolderOpen className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-1.5">
              <h3
                className="truncate text-sm font-bold text-stone-900 group-hover:text-amber-900"
                title={folder.title}
              >
                {folder.title}
              </h3>
              {folder.pinned && (
                <Pin className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-600" />
              )}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500">
              <span className="font-semibold text-stone-700">
                {folder.docCount} {folder.docCount === 1 ? 'doc' : 'docs'}
              </span>
              <span className="text-stone-300">·</span>
              <span>{formatDate(folder.createdAt)}</span>
            </p>
          </div>
        </button>
      </div>

      <div className="mt-3.5 flex items-center justify-between border-t border-stone-100 pt-2.5">
        <div className="flex items-center">
          {folder.recentCount > 0 ? (
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              +{folder.recentCount} this week
            </span>
          ) : (
            <span className="text-[11px] font-medium text-stone-400">Up to date</span>
          )}
        </div>
        {!selectMode && (
          <div className="opacity-75 transition-opacity group-hover:opacity-100">
            <FolderActions folder={folder} {...actions} />
          </div>
        )}
      </div>
    </div>
  );
}
