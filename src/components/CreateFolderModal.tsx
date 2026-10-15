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
      <div className="absolute inset-0 bg-stone-950/40 backdrop-blur-xs transition-opacity" onClick={creating ? undefined : onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-stone-200/90 bg-white p-6 shadow-floating">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-900 shadow-xs">
              {editing ? <Pencil className="h-5 w-5" /> : <FolderPlus className="h-5 w-5" />}
            </span>
            <div>
              <h2 className="text-base font-bold text-stone-900">{editing ? 'Edit collection' : 'New collection'}</h2>
              <p className="text-xs text-stone-500">
                {editing ? 'Rename or recolor this collection.' : 'Group transcripts into a focused folder.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-xl p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mt-5 block text-xs font-semibold uppercase tracking-wider text-stone-600" htmlFor="folder-title">
          Collection Name
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
          placeholder="e.g. Machine Learning, Recipes, Podcasts…"
          maxLength={120}
          className="mt-1.5 w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-200/60"
        />

        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-stone-600">Color Tag</p>
        <div className="mt-2 flex gap-2">
          {ACCENT_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setAccent(key)}
              title={key}
              aria-label={`Color ${key}`}
              aria-pressed={accent === key}
              className={cn(
                'h-8 w-8 rounded-xl border transition-all',
                accent === key ? 'border-stone-900 ring-2 ring-stone-900/20 scale-105' : 'border-transparent hover:scale-105 hover:border-stone-300',
                FOLDER_ACCENTS[key].split(' ')[0],
              )}
            >
              <span className="sr-only">{key}</span>
            </button>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-stone-100 pt-4">
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-xl px-4 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || creating}
            className="ui-primary h-9 px-4 text-xs font-semibold"
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'Save changes' : 'Create folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
