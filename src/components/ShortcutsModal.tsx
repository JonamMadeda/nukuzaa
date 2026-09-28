import { Keyboard, X } from 'lucide-react';

const ROWS: Array<[string, string]> = [
  ['/', 'Focus search (folders) or the URL bar (workspace)'],
  ['n', 'New folder (dashboard)'],
  ['Enter', 'Next transcript match (reader search)'],
  ['Shift + Enter', 'Previous transcript match (reader search)'],
  ['Esc', 'Close dialog → back to folders'],
  ['?', 'Open this cheatsheet'],
];

export default function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-950/50" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-none border border-stone-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-none bg-stone-900 text-white">
              <Keyboard className="h-5 w-5" />
            </span>
            <h2 className="font-semibold">Keyboard shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shortcuts"
            className="rounded-none p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <ul className="flex flex-col gap-2 p-5">
          {ROWS.map(([key, desc]) => (
            <li key={key} className="flex items-center gap-3 text-sm">
              <kbd className="min-w-24 shrink-0 border border-stone-300 bg-stone-50 px-2 py-1 text-center font-mono text-xs font-medium text-stone-700">
                {key}
              </kbd>
              <span className="text-stone-600">{desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
