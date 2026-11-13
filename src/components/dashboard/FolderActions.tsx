import { Archive, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CardActions } from './types';

export default function FolderActions({ folder, onPin, onEdit, onArchive, onDelete }: CardActions) {
  const btn =
    'rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-800 focus-visible:opacity-100';

  return (
    <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onPin}
        title={folder.pinned ? 'Unpin folder' : 'Pin folder'}
        aria-label={folder.pinned ? 'Unpin folder' : 'Pin folder'}
        className={cn(btn, folder.pinned && 'text-amber-600 hover:text-amber-700')}
      >
        {folder.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={onEdit}
        title="Rename or recolor"
        aria-label="Rename or recolor folder"
        className={btn}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onArchive}
        title="Archive folder"
        aria-label="Archive folder"
        className={btn}
      >
        <Archive className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Delete folder"
        aria-label="Delete folder"
        className="rounded-md p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
