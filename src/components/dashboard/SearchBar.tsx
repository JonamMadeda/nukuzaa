import { ArrowUpDown, CheckSquare, LayoutGrid, List, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { FolderSort } from '../../lib/types';
import type { FolderViewMode } from './types';

interface SearchBarProps {
  search: string;
  onSearch: (val: string) => void;
  mode: FolderViewMode;
  onMode: (m: FolderViewMode) => void;
  folderSort: FolderSort;
  onFolderSort: (s: FolderSort) => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  disabled?: boolean;
}

export default function SearchBar({
  search,
  onSearch,
  mode,
  onMode,
  folderSort,
  onFolderSort,
  selectMode,
  onToggleSelectMode,
  showArchived,
  onToggleArchived,
  disabled = false,
}: SearchBarProps) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-stone-200/90 bg-white p-2 shadow-card">
      {/* Search Input */}
      <div className="relative min-w-52 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          id="dashboard-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search folders and transcripts…"
          disabled={disabled || showArchived}
          className="h-9 w-full rounded-lg border border-transparent bg-stone-50/70 pl-9 pr-10 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-300 focus:bg-white focus:ring-2 focus:ring-stone-200/60 disabled:bg-stone-50"
        />
        {!search ? (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-400 shadow-2xs">
            /
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onSearch('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-400 hover:bg-stone-200/60 hover:text-stone-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* View switcher & Sort */}
      <div className="flex h-9 items-center gap-1 rounded-lg border border-stone-200/80 bg-stone-50/70 p-0.5">
        <button
          type="button"
          onClick={() => onMode('grid')}
          title="Grid view"
          aria-label="Grid view"
          aria-pressed={mode === 'grid'}
          className={cn(
            'inline-flex h-7.5 w-7.5 items-center justify-center rounded-md transition-all',
            mode === 'grid'
              ? 'bg-white text-stone-900 shadow-2xs ring-1 ring-stone-200/80'
              : 'text-stone-400 hover:bg-stone-200/50 hover:text-stone-700',
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onMode('list')}
          title="List view"
          aria-label="List view"
          aria-pressed={mode === 'list'}
          className={cn(
            'inline-flex h-7.5 w-7.5 items-center justify-center rounded-md transition-all',
            mode === 'list'
              ? 'bg-white text-stone-900 shadow-2xs ring-1 ring-stone-200/80'
              : 'text-stone-400 hover:bg-stone-200/50 hover:text-stone-700',
          )}
        >
          <List className="h-3.5 w-3.5" />
        </button>

        <span aria-hidden className="mx-0.5 h-4 w-px bg-stone-200" />

        <div className="flex items-center gap-1 px-1">
          <ArrowUpDown className="h-3 w-3 text-stone-400" />
          <select
            value={folderSort}
            onChange={(e) => onFolderSort(e.target.value as FolderSort)}
            title="Sort folders"
            disabled={disabled || showArchived}
            className="h-7 cursor-pointer rounded-md border-0 bg-transparent text-xs font-semibold text-stone-700 outline-none hover:text-stone-900 disabled:opacity-50"
          >
            <option value="recent">Recent</option>
            <option value="title">Title A–Z</option>
            <option value="docs">Most docs</option>
          </select>
        </div>
      </div>

      {/* Select Mode toggle */}
      <button
        type="button"
        onClick={onToggleSelectMode}
        title="Select folders for bulk actions"
        aria-pressed={selectMode}
        disabled={disabled || showArchived}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition disabled:opacity-50',
          selectMode
            ? 'border-stone-900 bg-stone-900 text-white'
            : 'border-stone-200/80 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900',
        )}
      >
        <CheckSquare className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Select</span>
      </button>

      {/* Archived toggle */}
      <button
        type="button"
        onClick={onToggleArchived}
        className={cn(
          'ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold transition',
          showArchived
            ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
            : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900',
        )}
      >
        {showArchived ? 'Hide archived' : 'Archived'}
      </button>
    </div>
  );
}
