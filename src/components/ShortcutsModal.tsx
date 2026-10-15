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
      <div className="absolute inset-0 bg-stone-950/40 backdrop-blur-xs transition-opacity" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-floating">
        <div className="flex items-center justify-between border-b border-stone-100 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-900 shadow-xs">
              <Keyboard className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-stone-900">Keyboard shortcuts</h2>
              <p className="text-xs text-stone-500">Fast navigation with your keyboard</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shortcuts"
            className="rounded-xl p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <ul className="flex flex-col gap-2 p-5">
          {ROWS.map(([key, desc]) => (
            <li key={key} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-stone-600">{desc}</span>
              <kbd className="min-w-20 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-center font-mono text-[11px] font-semibold text-stone-700 shadow-2xs">
                {key}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
