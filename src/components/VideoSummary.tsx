import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw, Sparkles } from 'lucide-react';
import type { TranscriptDoc } from '../lib/types';
import { docDisplayText } from '../lib/utils';
import {
  SUMMARY_MODEL_PRIMARY,
  SummaryError,
  generateVideoSummary,
  getCachedSummary,
  getConfiguredApiKey,
  getKeyOverride,
  setKeyOverride,
  usesSummaryProxy,
} from '../lib/summarize';
import { useToast } from '../hooks/useToast';

interface Props {
  doc: TranscriptDoc;
}

/** Minimal Markdown renderer: headings, bullets, numbered lists, bold, paragraphs. */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split('\n');
  const out: React.ReactNode[] = [];
  let listKey = 0;
  let bulletBuf: string[] = [];
  let numberedBuf: string[] = [];

  const flushLists = () => {
    if (bulletBuf.length > 0) {
      const items = bulletBuf;
      bulletBuf = [];
      out.push(
        <ul key={`ul-${listKey++}`} className="my-2 list-disc space-y-1.5 pl-6">
          {items.map((t, i) => (
            <li key={i} className="leading-7 text-stone-800">{renderInline(t)}</li>
          ))}
        </ul>,
      );
    }
    if (numberedBuf.length > 0) {
      const items = numberedBuf;
      numberedBuf = [];
      out.push(
        <ol key={`ol-${listKey++}`} className="my-2 list-decimal space-y-1.5 pl-6">
          {items.map((t, i) => (
            <li key={i} className="leading-7 text-stone-800">{renderInline(t)}</li>
          ))}
        </ol>,
      );
    }
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (/^#{1,4}\s/.test(line)) {
      flushLists();
      const text = line.replace(/^#{1,4}\s*/, '');
      out.push(
        <h3 key={idx} className="mb-1 mt-5 text-base font-semibold text-stone-900 first:mt-0">
          {renderInline(text)}
        </h3>,
      );
    } else if (/^[-*]\s+/.test(line)) {
      if (numberedBuf.length > 0) flushLists();
      bulletBuf.push(line.replace(/^[-*]\s+/, ''));
    } else if (/^\d+[.)]\s+/.test(line)) {
      if (bulletBuf.length > 0) flushLists();
      numberedBuf.push(line.replace(/^\d+[.)]\s+/, ''));
    } else if (line === '' || line === '---') {
      flushLists();
    } else {
      flushLists();
      out.push(
        <p key={idx} className="my-2 leading-7 text-stone-800">{renderInline(line)}</p>,
      );
    }
  });
  flushLists();
  return out;
}

function renderInline(text: string): React.ReactNode[] {
  // **bold** only — keeps it predictable and safe (no raw HTML).
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
      <strong key={i} className="font-semibold text-stone-900">{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/** Staged status lines shown while a summary generates (single request, so
 *  these are time-based narrations, not measured progress). */
const LOADING_STAGES: Array<{ afterSec: number; text: string }> = [
  { afterSec: 0, text: 'Preparing your transcript…' },
  { afterSec: 3, text: 'Sending it securely to the summary service…' },
  { afterSec: 8, text: 'AI is reading through the video…' },
  { afterSec: 16, text: 'Pulling out the key points and arguments…' },
  { afterSec: 26, text: 'Structuring the TL;DR, topics and takeaways…' },
  { afterSec: 40, text: 'Almost there — free models can be slow on long videos…' },
  { afterSec: 60, text: 'Still working — hanging tight for the model to finish…' },
];

export default function VideoSummary({ doc }: Props) {
  const { notify } = useToast();
  const [summary, setSummary] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyInput, setKeyInput] = useState(() => getKeyOverride());
  const [showKeyBox, setShowKeyBox] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  // Proxy mode: shared key lives server-side, no client key ever needed.
  const viaProxy = usesSummaryProxy();

  const text = docDisplayText(doc);

  useEffect(() => {
    setSummary(getCachedSummary(doc, text.trim()) ?? null);
    setModel(null);
    setError(null);
    setErrorCode(null);
    setLoading(false);
    setElapsedSec(0);
    setNeedsKey(!viaProxy && !getConfiguredApiKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, doc.editedText, doc.rawText]);

  // Tick the elapsed timer while a summary is generating.
  useEffect(() => {
    if (!loading) return;
    setElapsedSec(0);
    const t = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [loading]);

  const stageText =
    LOADING_STAGES.filter((s) => elapsedSec >= s.afterSec).pop()?.text ?? LOADING_STAGES[0].text;

  const run = useCallback(
    async (force = false) => {
      if (loading) return;
      if (!force) {
        const cached = getCachedSummary(doc, text.trim());
        if (cached) {
          setSummary(cached);
          return;
        }
      }
      setLoading(true);
      setError(null);
      setErrorCode(null);
      try {
        const r = await generateVideoSummary(doc);
        setSummary(r.summary);
        setModel(r.model === 'cache' ? null : r.model);
        setNeedsKey(false);
        if (r.truncated) notify('info', 'Very long video — summary used head + tail of the transcript.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not generate a summary.';
        setError(msg);
        setErrorCode(e instanceof SummaryError ? e.code : 'API');
        if (e instanceof SummaryError && e.code === 'MISSING_KEY') {
          setNeedsKey(true);
          if (!viaProxy) setShowKeyBox(true);
        }
      } finally {
        setLoading(false);
      }
    },
    [doc, text, loading, notify],
  );

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = summary;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const saveKey = () => {
    setKeyOverride(keyInput);
    setShowKeyBox(false);
    setNeedsKey(!keyInput.trim() && !getConfiguredApiKey());
    notify('success', keyInput.trim() ? 'API key saved on this device.' : 'Custom key cleared.');
  };

  if (!text.trim()) {
    return <p className="text-sm text-stone-500">No transcript text available to summarize.</p>;
  }

  return (
    <div className="mx-auto max-w-[68ch]">
      {/* Controls */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        {!summary && !loading && (
          <button
            onClick={() => void run()}
            className="ui-primary inline-flex items-center gap-2 px-4 py-2"
          >
            <Sparkles className="h-4 w-4" /> Generate summary
          </button>
        )}
        {summary && (
          <>
            <button
              onClick={() => void run(true)}
              disabled={loading}
              title="Regenerate with the latest transcript text"
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Summarizing…' : 'Regenerate'}
            </button>
            <button
              onClick={() => void copy()}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy summary'}
            </button>
          </>
        )}
        {!viaProxy && (
          <button
            onClick={() => setShowKeyBox((s) => !s)}
            title="Configure your OpenRouter API key"
            className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-500 hover:bg-stone-100"
          >
            <KeyRound className="h-4 w-4" /> API key
          </button>
        )}
      </div>

      {!viaProxy && showKeyBox && (
        <div className="no-print mb-4 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <p className="text-xs text-stone-600">
            Uses OpenRouter free model <code className="font-mono">{SUMMARY_MODEL_PRIMARY}</code>.
            Prefer <code className="font-mono">VITE_OPENROUTER_API_KEY</code> in <code className="font-mono">.env</code>;
            or paste a key here (stored only in this browser).
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder="sk-or-v1-…"
              aria-label="OpenRouter API key"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-1.5 font-mono text-xs outline-none focus:border-yellow-600"
            />
            <button onClick={saveKey} className="ui-primary px-3.5 py-1.5 text-sm">Save</button>
          </div>
        </div>
      )}

      {loading && !summary && (
        <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4">
          <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-stone-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-stone-800" role="status" aria-live="polite">
              {stageText}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-stone-500">
              {elapsedSec}s elapsed · usually takes 10–30s on free models
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Couldn&apos;t generate a summary</p>
          <p className="mt-1 text-sm text-red-700">{error}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void run(true)}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
            >
              Retry
            </button>
            {needsKey && !viaProxy && (
              <button
                onClick={() => setShowKeyBox(true)}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
              >
                Add API key
              </button>
            )}
            {errorCode === 'MISSING_KEY' && viaProxy && (
              <button
                onClick={() => window.location.reload()}
                title="Reload to refresh your session, then retry"
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
              >
                Reload and retry
              </button>
            )}
          </div>
        </div>
      )}

      {summary && (
        <article className="font-serif text-[1.02rem]">
          {renderMarkdown(summary)}
          {model && (
            <p className="no-print mt-6 border-t border-stone-100 pt-2 font-sans text-[11px] text-stone-400">
              Generated with <code className="font-mono">{model}</code> · cached on this device
            </p>
          )}
        </article>
      )}

      {!summary && !loading && !error && (
        <div className="rounded-lg border border-dashed border-stone-300 p-6 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-stone-300" />
          <p className="mt-2 text-sm font-medium text-stone-700">Comprehensive AI summary</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-stone-500">
            TL;DR, every key point, topics in order, actionable takeaways, and notable quotes —
            generated from the full transcript. Cached per video so re-opens are instant.
            {viaProxy && (
              <> Fair-use daily limits apply per account.</>
            )}
            {needsKey && !viaProxy && (
              <>
                {' '}You&apos;ll need a free OpenRouter key first — click <strong>API key</strong> above
                (get one at openrouter.ai/keys, no credit card).
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
