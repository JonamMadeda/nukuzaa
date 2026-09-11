import { useState } from 'react';
import { FolderPlus, Loader2, X } from 'lucide-react';

interface Props {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (title: string) => void;
}

export default function CreateFolderModal({ open, creating, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');

  if (!open) return null;

  const submit = () => {
    if (title.trim() && !creating) onCreate(title.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-950/40" onClick={creating ? undefined : onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-900 text-white">
              <FolderPlus className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold">Create new folder</h2>
              <p className="text-sm text-stone-500">Group transcripts into a collection.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
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
          className="mt-1.5 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 focus:ring-2 focus:ring-stone-200"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-xl px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || creating}
            className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            Create folder
          </button>
        </div>
      </div>
    </div>
  );
}
