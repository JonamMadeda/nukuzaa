import { Children, cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileDown, KeyRound, RefreshCw, Sparkles, Square } from 'lucide-react';
import type { TranscriptDoc } from '../lib/types';
import { docDisplayText, downloadTextFile, safeFilenameStem } from '../lib/utils';
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
import { mirrorDoc } from '../lib/vault';

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
const LOADING_STAGES: Array<{ afterSec: number; text: string }> = [  { afterSec: 0, text: 'Preparing your transcript…' },
  { afterSec: 3, text: 'Sending it securely to the summary service…' },
  { afterSec: 8, text: 'AI is reading through the video…' },
  { afterSec: 16, text: 'Pulling out the key points and arguments…' },
  { afterSec: 26, text: 'Structuring the TL;DR, topics and takeaways…' },
  { afterSec: 40, text: 'Almost there — free models can be slow on long videos…' },
  { afterSec: 60, text: 'Still working — hanging tight for the model to finish…' },
];

/**
 * Paged reading: completed summaries are split into fixed-height sheets.
 * Blocks are measured in a hidden twin of the sheet content box and packed
 * greedily; the sheet count is fully dynamic. Anything that would not fit
 * honestly (e.g. one giant block taller than a sheet) falls back to the
 * continuous view so no content is ever clipped.
 */
const SHEET_H_PX = 720;
const SHEET_PAD_PX = 48; // p-6 on the sheet
const SHEET_FOOT_PX = 60; // footer + gaps
const SHEET_SAFETY_PX = 52;
const PAGE_CAPACITY_PX = SHEET_H_PX - SHEET_PAD_PX - SHEET_FOOT_PX - SHEET_SAFETY_PX;
const BLOCK_GAP_PX = 12;
const ITEM_GAP_PX = 6; // space-y-1.5 between bullets
const BLOCK_START_PX = 10; // share of a block's own top margin when (re)starting it

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
  // Live tokens while generating; cleared once the full summary lands.
  const [streamed, setStreamed] = useState('');
  const streamedRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  // Pagination: sheets of block slices, recomputed from measurements.
  // A slice is either a whole block ({ items: null }) or a run of list
  // items ({ items: [from, to) }) — sheets may break BETWEEN bullets,
  // never inside one, so long Key Points lists flow across sheets.
  interface SheetSlice {
    bi: number;
    items: [number, number] | null;
  }
  const [sheets, setSheets] = useState<SheetSlice[][] | null>(null);
  const [jump, setJump] = useState(0);
  const blockRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  // Floating back-to-top, shown once the user scrolls past the first sheet.
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // Proxy mode: shared key lives server-side, no client key ever needed.
  const viaProxy = usesSummaryProxy();

  const text = docDisplayText(doc);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSummary(getCachedSummary(doc, text.trim()) ?? null);
    setModel(null);
    setError(null);
    setErrorCode(null);
    setLoading(false);
    setStreamed('');
    streamedRef.current = '';
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

  // Blocks of the finished summary, shared by the measurer and the sheets.
  const blocks = useMemo(() => (summary ? renderMarkdown(summary) : []), [summary]);

  // Fresh summary → drop old pagination synchronously, then rebuild it in
  // the same commit (a separate effect would race the compute below).
  // Measure each block in the hidden twin and pack greedily into sheets.
  useLayoutEffect(() => {
    setSheets(null);
    setJump(0);
    if (!summary || blocks.length === 0) return;
    let live = true;
    const compute = () => {
      const els = blockRefs.current.slice(0, blocks.length);
      if (els.length !== blocks.length) return;
      const hs = els.map((el) => (el ? el.offsetHeight : 0));
      if (hs.some((h) => h === 0)) return; // not laid out yet — resize/fonts pass will retry

      // Per-item heights for splittable lists (ul/ol), measured from the DOM.
      const itemHs: Array<number[] | null> = blocks.map((b, i) => {
        if (!isValidElement(b) || (b.type !== 'ul' && b.type !== 'ol')) return null;
        const kids = Children.toArray((b.props as { children?: React.ReactNode }).children);
        if (kids.length < 2) return null;
        const list = els[i]?.firstElementChild;
        if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) return null;
        const items = Array.from(list.children);
        if (items.length !== kids.length) return null;
        return items.map((c) => c.getBoundingClientRect().height);
      });

      const out: SheetSlice[][] = [];
      let cur: SheetSlice[] = [];
      let used = 0;
      const newSheet = () => {
        if (cur.length > 0) out.push(cur);
        cur = [];
        used = 0;
      };
      const pushAtomic = (bi: number, h: number) => {
        const need = h + BLOCK_GAP_PX;
        if (used > 0 && used + need > PAGE_CAPACITY_PX) newSheet();
        cur.push({ bi, items: null });
        used += need;
      };

      // Emit slices, breaking lists between bullets (never inside one).
      blocks.forEach((b, bi) => {
        const items = itemHs[bi];
        if (!items) {
          pushAtomic(bi, hs[bi] ?? 0);
          return;
        }
        let from = 0;
        items.forEach((ih, j) => {
          const startsBlock = j === from;
          const need = ih + ITEM_GAP_PX + (startsBlock ? BLOCK_START_PX : 0);
          if (used > 0 && used + need > PAGE_CAPACITY_PX) {
            if (j > from) cur.push({ bi, items: [from, j] });
            newSheet();
            from = j;
          }
          used += ih + ITEM_GAP_PX + (j === from ? BLOCK_START_PX : 0);
        });
        cur.push({ bi, items: [from, items.length] });
      });
      if (cur.length > 0) out.push(cur);

      if (live) {
        setSheets(out);
        setJump(0);
      }
    };
    const t = window.setTimeout(compute, 0);
    try {
      void document.fonts?.ready.then(() => {
        if (live) compute();
      });
    } catch {
      /* fonts API unavailable — initial compute stands */
    }
    window.addEventListener('resize', compute);
    return () => {
      live = false;
      window.clearTimeout(t);
      window.removeEventListener('resize', compute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  const jumpTo = (i: number) => {
    if (!sheets || sheets.length === 0) return;
    const next = Math.max(0, Math.min(sheets.length - 1, i));
    setJump(next);
    pageRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
      setStreamed('');
      streamedRef.current = '';
      setError(null);
      setErrorCode(null);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const r = await generateVideoSummary(doc, {
          signal: ctrl.signal,
          onToken: (partial) => {
            streamedRef.current = partial;
            setStreamed(partial);
          },
        });
        setSummary(r.summary);
        setStreamed('');
        setModel(r.model === 'cache' ? null : r.model);
        setNeedsKey(false);
        void mirrorDoc(doc, { summary: r.summary }).catch(() => {});
        if (r.truncated) notify('info', 'Very long video — summary used head + tail of the transcript.');
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          // Stopped by the user — keep whatever streamed in so far.
          // (Aborted runs are never cached; Regenerate fetches the full text.)
          const partial = streamedRef.current.trim();
          if (partial) setSummary(`${partial}\n\n*(Stopped early — Regenerate for the full version.)*`);
          setStreamed('');
        } else {
          const msg = e instanceof Error ? e.message : 'Could not generate a summary.';
          setError(msg);
          setErrorCode(e instanceof SummaryError ? e.code : 'API');
          if (e instanceof SummaryError && e.code === 'MISSING_KEY') {
            setNeedsKey(true);
            if (!viaProxy) setShowKeyBox(true);
          }
        }
      } finally {
        abortRef.current = null;
        setLoading(false);
      }
    },
    [doc, text, loading, notify],
  );

  const stop = () => abortRef.current?.abort();

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

  const [moreOpen, setMoreOpen] = useState(false);
  const stem = safeFilenameStem(doc.title);

  const exportPdf = () => {
    // Save-as-PDF inherits document.title as the suggested filename.
    const prev = document.title;
    document.title = `${stem}-summary`;
    const restore = () => {
      document.title = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    window.setTimeout(restore, 3000);
  };

  const summaryMarkdownFile = () =>
    `# ${doc.title} — Summary\n\nSource: ${doc.url}\n\n${summary ?? ''}\n`;

  const downloadMd = () => {
    setMoreOpen(false);
    downloadTextFile(`${stem}-summary.md`, summaryMarkdownFile(), 'text/markdown;charset=utf-8');
  };

  const downloadTxt = () => {
    setMoreOpen(false);
    downloadTextFile(`${stem}-summary.txt`, `# ${doc.title} — Summary\n\nSource: ${doc.url}\n\n${summary ?? ''}\n`);
  };

  if (!text.trim()) {
    return <p className="text-sm text-stone-500">No transcript text available to summarize.</p>;
  }

  return (
    <div className="relative w-full">
      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title="Back to top"
          aria-label="Back to top"
          className="no-print fixed bottom-6 right-6 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full bg-stone-950 text-white shadow-lg transition hover:bg-stone-700"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
      {/* Hidden twin of a sheet content box — blocks are measured here. */}
      {summary && (
        <div aria-hidden className="no-print pointer-events-none invisible absolute inset-x-0 top-0 -z-10">
          <div className="mx-auto w-full max-w-[68ch]">
            <div className="p-6 font-serif text-[1.02rem]">
            {blocks.map((b, i) => (
              <div
                key={`m${i}`}
                ref={(el) => {
                  blockRefs.current[i] = el;
                }}
              >
                {b}
              </div>
            ))}
            </div>
          </div>
        </div>
      )}
      {/* Controls */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-center gap-2">
        {loading && (
          <button
            onClick={stop}
            title="Stop generating"
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            <Square className="h-4 w-4 fill-current" /> Stop
          </button>
        )}
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
            <button
              onClick={exportPdf}
              title="Open the print dialog — filename defaults to this summary's title"
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              <FileDown className="h-4 w-4" /> Export PDF
            </button>
            <span className="relative inline-flex">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                More <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
              </button>
              {moreOpen && (
                <span className="absolute left-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 text-left shadow-lg">
                  <button onClick={downloadMd} className="block w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-100">
                    Download .md
                  </button>
                  <button onClick={downloadTxt} className="block w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-100">
                    Download .txt
                  </button>
                </span>
              )}
            </span>
            {sheets && sheets.length > 1 && (
              <span className="ml-3 inline-flex items-center gap-1.5 border-l border-stone-200 pl-4 text-xs font-medium text-stone-600">
                <button
                  onClick={() => jumpTo(jump - 1)}
                  disabled={jump <= 0}
                  title="Previous page"
                  aria-label="Previous page"
                  className="rounded-lg border border-stone-300 bg-white p-1.5 hover:bg-stone-100 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-20 px-1 text-center tabular-nums">
                  Page {Math.min(jump + 1, sheets.length)} of {sheets.length}
                </span>
                <button
                  onClick={() => jumpTo(jump + 1)}
                  disabled={jump >= sheets.length - 1}
                  title="Next page"
                  aria-label="Next page"
                  className="rounded-lg border border-stone-300 bg-white p-1.5 hover:bg-stone-100 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </span>
            )}
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

      {loading && !summary && !streamed && (
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

      {summary && !(loading && streamed) && (
        sheets && sheets.length > 0 ? (
          <div className="mx-auto mt-4 flex w-full max-w-[68ch] flex-col gap-5">
            {sheets.map((slices, pi) => (
              <div
                key={pi}
                ref={(el) => {
                  pageRefs.current[pi] = el;
                }}
                className="page-sheet flex h-[720px] scroll-mt-4 flex-col rounded-lg border border-stone-200 bg-stone-50/60 p-6"
              >
                <div className="min-h-0 flex-1 overflow-hidden font-serif text-[1.02rem]">
                  {slices.map((s, si) =>
                    s.items === null ? (
                      <div key={`s${si}`}>{blocks[s.bi]}</div>
                    ) : (
                      cloneElement(
                        blocks[s.bi] as React.ReactElement,
                        { key: `s${si}` },
                        Children.toArray(
                          (blocks[s.bi] as React.ReactElement).props.children,
                        ).slice(s.items[0], s.items[1]),
                      )
                    ),
                  )}
                </div>
                <p className="page-foot mt-3 border-t border-stone-200 pt-2 text-center font-sans text-[11px] font-medium tracking-wide text-stone-400">
                  Page {pi + 1} of {sheets.length}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <article className="w-full max-w-[68ch] font-serif text-[1.02rem]">
            {blocks}
            {model && (
              <p className="no-print mt-6 border-t border-stone-100 pt-2 font-sans text-[11px] text-stone-400">
                Generated with <code className="font-mono">{model}</code> · cached on this device
              </p>
            )}
          </article>
        )
      )}

      {loading && streamed && (
        <article className="w-full max-w-[68ch] font-serif text-[1.02rem]" aria-live="polite">
          {renderMarkdown(streamed)}
          <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-amber-500 align-middle" aria-hidden />
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
