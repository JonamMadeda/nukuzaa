import { CalendarDays, CheckSquare, FileText, FolderOpen, Pin, Square } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { FOLDER_ACCENTS } from '../../lib/types';
import type { Folder } from '../../lib/types';
import type { CardProps } from './types';
import FolderActions from './FolderActions';

export default function FolderRow({
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
        'group flex items-center gap-2 rounded-xl border bg-white p-3 shadow-card transition-all hover:border-stone-300 hover:shadow-card-hover sm:gap-3.5 sm:px-4',
        selected ? 'border-stone-900 ring-2 ring-stone-900/10' : 'border-stone-200/90',
      )}
    >
      <button
        type="button"
        onClick={selectMode ? onToggleSelect : onOpen}
        aria-label={selectMode ? `${selected ? 'Deselect' : 'Select'} ${folder.title}` : `Open ${folder.title}`}
        aria-pressed={selectMode ? selected : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        {selectMode ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center text-stone-500">
            {selected ? <CheckSquare className="h-5 w-5 text-stone-900" /> : <Square className="h-5 w-5" />}
          </span>
        ) : (
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-xs transition-transform group-hover:scale-105',
              FOLDER_ACCENTS[folder.accent],
            )}
          >
            <FolderOpen className="h-4.5 w-4.5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-bold text-stone-900 group-hover:text-amber-900">
              {folder.title}
            </span>
            {folder.pinned && (
              <span
                title="Pinned"
                className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-500/20"
              >
                <Pin className="h-3 w-3 fill-amber-500" /> Pinned
              </span>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1 font-semibold text-stone-700">
              <FileText className="h-3.5 w-3.5 text-stone-400" />
              {folder.docCount} {folder.docCount === 1 ? 'transcript' : 'transcripts'}
            </span>
            <span className="text-stone-300">·</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 text-stone-400" />
              {formatDate(folder.createdAt)}
            </span>
            {folder.recentCount > 0 && (
              <>
                <span className="text-stone-300">·</span>
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  +{folder.recentCount} this week
                </span>
              </>
            )}
          </span>
        </span>
      </button>
      {!selectMode && (
        <span className="flex shrink-0 items-center gap-1 border-l border-stone-100 pl-2 opacity-75 transition-opacity group-hover:opacity-100 sm:pl-3">
          <FolderActions folder={folder} {...actions} />
        </span>
      )}
    </div>
  );
}
