import { useEffect, useState } from 'react';
import { FolderPlus, Loader2, Pencil, X } from 'lucide-react';
import { FOLDER_ACCENTS, type FolderAccent } from '../lib/types';
import { cn } from '../lib/utils';

interface Props {
  open: boolean;
  creating: boolean;
  /** Edit mode: prefill + save title/accent instead of creating. */
  editing?: { id: string; title: string; accent: FolderAccent } | null;
  onClose: () => void;
  onCreate: (title: string, accent: FolderAccent) => void;
  onSaveEdit?: (id: string, title: string, accent: FolderAccent) => void;
}

const ACCENT_KEYS = Object.keys(FOLDER_ACCENTS) as FolderAccent[];

export default function CreateFolderModal({ open, creating, editing, onClose, onCreate, onSaveEdit }: Props) {
  const [title, setTitle] = useState('');
  const [accent, setAccent] = useState<FolderAccent>('amber');

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? '');
      setAccent(editing?.accent ?? 'amber');
    }
  }, [open, editing]);

  if (!open) return null;

  const submit = () => {
    if (!title.trim() || creating) return;
    if (editing && onSaveEdit) onSaveEdit(editing.id, title.trim(), accent);
    else onCreate(title.trim(), accent);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-950/40" onClick={creating ? undefined : onClose} />
      <div className="relative w-full max-w-md rounded-none border border-stone-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-none bg-stone-900 text-white">
              {editing ? <Pencil className="h-5 w-5" /> : <FolderPlus className="h-5 w-5" />}
            </span>
            <div>
              <h2 className="text-base font-semibold">{editing ? 'Edit folder' : 'Create new folder'}</h2>
              <p className="text-sm text-stone-500">
                {editing ? 'Rename or recolor this collection.' : 'Group transcripts into a collection.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-none p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mt-5 block text-sm font-medium text-stone-700" htmlFor="folder-title">
          Folder title
        </label>
        <input
          id="folder-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="e.g. Machine Learning, Recipes…"
          maxLength={120}
          className="mt-1.5 w-full rounded-none border border-stone-300 px-3.5 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 focus:ring-2 focus:ring-stone-200"
        />

        <p className="mt-4 text-sm font-medium text-stone-700">Color</p>
        <div className="mt-1.5 flex gap-2">
          {ACCENT_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setAccent(key)}
              title={key}
              aria-label={`Color ${key}`}
              aria-pressed={accent === key}
              className={cn(
                'h-8 w-8 rounded-none border transition',
                accent === key ? 'border-stone-900 ring-2 ring-stone-300' : 'border-transparent hover:border-stone-300',
                FOLDER_ACCENTS[key].split(' ')[0],
              )}
            >
              <span className="sr-only">{key}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-none px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || creating}
            className="inline-flex items-center gap-2 rounded-none bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'Save changes' : 'Create folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
