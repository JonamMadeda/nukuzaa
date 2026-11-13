import { Plus, Sparkles } from 'lucide-react';

interface OnboardingProps {
  onCreate: () => void;
}

export default function Onboarding({ onCreate }: OnboardingProps) {
  return (
    <div className="mt-5 rounded-2xl border border-stone-200/90 bg-white p-7 shadow-card sm:p-9">
      <div className="max-w-xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-500/20">
          <Sparkles className="h-3.5 w-3.5 text-amber-600" />
          Get Started
        </span>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-stone-900">
          Build your personal video library
        </h2>
        <p className="mt-1.5 text-sm text-stone-500 leading-relaxed">
          Organize lecture notes, research videos, and tutorials in private, searchable collections.
        </p>
      </div>

      <ol className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ['1', 'Create a collection', 'Group transcripts into topical folders like "AI Research" or "Cooking".'],
          ['2', 'Paste video URLs', 'Watch, youtu.be, or Shorts links. Captions are extracted on your device.'],
          ['3', 'Search, read & chat', 'Generate AI summaries, read with timestamps, and ask questions.'],
        ].map(([n, title, desc]) => (
          <li key={n} className="flex flex-col rounded-xl border border-stone-100 bg-stone-50/70 p-4.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-xs font-bold text-amber-900 shadow-2xs">
              {n}
            </span>
            <span className="mt-3.5 block text-sm font-bold text-stone-900">{title}</span>
            <span className="mt-1 block text-xs leading-relaxed text-stone-500">{desc}</span>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-stone-100 pt-6">
        <button
          type="button"
          onClick={onCreate}
          className="ui-primary h-10 px-4 text-xs font-semibold"
        >
          <Plus className="h-4 w-4" /> Create your first folder
        </button>
        <p className="text-xs text-stone-400">
          Keyboard shortcuts: <kbd className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-600 shadow-2xs">/</kbd> search, <kbd className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-600 shadow-2xs">n</kbd> new folder, <kbd className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-600 shadow-2xs">?</kbd> all shortcuts
        </p>
      </div>
    </div>
  );
}
