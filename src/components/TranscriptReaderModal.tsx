import { useMemo, useState } from 'react';
import { AlignLeft, Check, Copy, ExternalLink, FileDown, ListOrdered, X } from 'lucide-react';
import type { TranscriptDoc } from '../lib/types';
import { cn, formatMMSS } from '../lib/utils';
import { useToast } from '../hooks/useToast';

interface Props {
  doc: TranscriptDoc | null;
  onClose: () => void;
}

type ReaderMode = 'paragraphs' | 'timestamps';

export default function TranscriptReaderModal({ doc, onClose }: Props) {
  const { notify } = useToast();
  const [mode, setMode] = useState<ReaderMode>('paragraphs');
  const [copied, setCopied] = useState(false);

  const bodyText = useMemo(() => {
    if (!doc) return '';
    if (mode === 'paragraphs') return doc.rawText;
    return doc.captions.map((c) => `[${formatMMSS(c.start)}] ${c.text}`).join('\n');
  }, [doc, mode]);

  if (!doc) return null;

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(bodyText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = bodyText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    notify('success', 'Transcript copied to clipboard.');
    window.setTimeout(() => setCopied(false), 2000);
  };

  const exportPdf = () => {
    // The print stylesheet isolates this transcript on the page —
    // choose "Save as PDF" as the print destination.
    window.print();
  };

  const watchVideo = async () => {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(doc.url);
    } catch {
      window.open(doc.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="print-root fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="no-print absolute inset-0 bg-stone-950/50" onClick={onClose} />
      <div className="print-area relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="no-print flex items-start gap-4 border-b border-stone-200 p-5">
          {doc.thumbnail && (
            <img src={doc.thumbnail} alt="" className="hidden h-16 w-28 shrink-0 rounded-lg object-cover sm:block" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 font-semibold leading-snug">{doc.title}</h2>
            <button
              onClick={watchVideo}
              className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 hover:text-sky-900 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Watch video
            </button>
          </div>
          <button
            onClick={onClose}
            aria-label="Close reader"
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3">
          <div className="flex rounded-xl bg-stone-100 p-1 text-sm">
            <button
              onClick={() => setMode('paragraphs')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition',
                mode === 'paragraphs' ? 'bg-white text-stone-900 shadow' : 'text-stone-500 hover:text-stone-800',
              )}
            >
              <AlignLeft className="h-4 w-4" /> Paragraphs
            </button>
            <button
              onClick={() => setMode('timestamps')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition',
                mode === 'timestamps' ? 'bg-white text-stone-900 shadow' : 'text-stone-500 hover:text-stone-800',
              )}
            >
              <ListOrdered className="h-4 w-4" /> Timestamps
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportPdf}
              title="Open the print dialog — choose “Save as PDF” as the destination"
              className="inline-flex items-center gap-2 rounded-xl border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              <FileDown className="h-4 w-4" />
              Export PDF
            </button>
            <button
              onClick={copyAll}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy All'}
            </button>
          </div>
        </div>

        {/* Print-only title block (screen: hidden, print: shown) */}
        <div className="hidden px-6 pb-1 pt-6 print:block">
          <h1 className="text-xl font-bold text-black">{doc.title}</h1>
          <p className="mt-1 break-all text-xs text-stone-600">{doc.url}</p>
          <p className="mt-0.5 text-xs text-stone-500">
            Exported from Nukuzaa on{' '}
            {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} ·{' '}
            {doc.captions.length} cues · {mode === 'paragraphs' ? 'paragraphs' : 'timestamps'}
          </p>
        </div>

        {/* Body */}
        <div className="print-body nice-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {mode === 'paragraphs' ? (
            <p className="font-serif text-[1.05rem] leading-relaxed text-stone-800">{doc.rawText}</p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {doc.captions.map((c, i) => (
                <li key={i} className="flex gap-3 text-[0.95rem] leading-relaxed">
                  <span className="w-12 shrink-0 select-none font-mono text-[0.8rem] font-medium text-sky-700">
                    {formatMMSS(c.start)}
                  </span>
                  <span className="text-stone-800">{c.text}</span>
                </li>
              ))}
            </ol>
          )}
          {doc.captions.length === 0 && (
            <p className="text-sm text-stone-500">No timestamped cues stored for this document.</p>
          )}
        </div>
      </div>
    </div>
  );
}
