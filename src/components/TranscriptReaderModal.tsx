import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileDown,
  Languages,
  Link2,
  ListOrdered,
  Pencil,
  Star,
  Tag,
  X,
} from 'lucide-react';
import type { TrackInfo, TranscriptDoc } from '../lib/types';
import {
  buildMarkdown,
  buildSrt,
  buildVtt,
  cn,
  docDisplayText,
  downloadTextFile,
  formatMMSS,
  safeFilenameStem,
  timestampUrl,
} from '../lib/utils';
import { extractTrackFromUrl, listAvailableTracks } from '../lib/extractor';
import { replaceTranscriptContent, updateTranscriptMeta } from '../lib/db';
import { cacheDoc } from '../lib/cache';
import { useToast } from '../hooks/useToast';

interface Props {
  doc: TranscriptDoc | null;
  onClose: () => void;
  onDocUpdated?: (d: TranscriptDoc) => void;
}

type ReaderMode = 'paragraphs' | 'timestamps';
const MAX_MATCHES = 200;

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

async function openExternal(url: string): Promise<boolean> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return true;
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }
}

export default function TranscriptReaderModal({ doc, onClose, onDocUpdated }: Props) {
  const { notify } = useToast();
  const docId = doc?.id ?? null;

  const [mode, setMode] = useState<ReaderMode>('paragraphs');
  const [search, setSearch] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tracks, setTracks] = useState<TrackInfo[] | null>(null);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [switchingLang, setSwitchingLang] = useState<string | null>(null);
  const matchRefs = useRef<Array<HTMLElement | null>>([]);

  // Reset per-document UI + remember for offline reading.
  useEffect(() => {
    setMode('paragraphs');
    setSearch('');
    setActiveMatch(0);
    setCopied(false);
    setEditing(false);
    setEditDraft('');
    setNotesDraft(doc?.notes ?? '');
    setTagInput('');
    setTracks(null);
    matchRefs.current = [];
    if (doc) cacheDoc(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const displayText = useMemo(() => (doc ? docDisplayText(doc) : ''), [doc]);
  const q = search.trim().toLowerCase();

  // -- Search matches -------------------------------------------------------
  const paraOffsets = useMemo(() => {
    if (mode !== 'paragraphs' || !q || !displayText) return [] as number[];
    const lower = displayText.toLowerCase();
    const out: number[] = [];
    let i = lower.indexOf(q);
    while (i !== -1 && out.length < MAX_MATCHES) {
      out.push(i);
      i = lower.indexOf(q, i + q.length);
    }
    return out;
  }, [mode, displayText, q]);

  const cueMatchIdx = useMemo(() => {
    if (mode !== 'timestamps' || !q || !doc) return [] as number[];
    const out: number[] = [];
    doc.captions.forEach((c, i) => {
      if (out.length < MAX_MATCHES && c.text.toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [mode, doc, q]);

  const matchCount = mode === 'paragraphs' ? paraOffsets.length : cueMatchIdx.length;

  useEffect(() => {
    setActiveMatch(0);
    matchRefs.current = [];
  }, [q, mode, docId]);

  useEffect(() => {
    if (!q || matchCount === 0) return;
    const el = matchRefs.current[activeMatch % matchCount];
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeMatch, q, matchCount, mode]);

  const stepMatch = (dir: 1 | -1) => {
    if (matchCount === 0) return;
    setActiveMatch((a) => (a + dir + matchCount) % matchCount);
  };

  if (!doc) return null;
  const current = doc;

  // -- Persistence helpers --------------------------------------------------
  const persistMeta = async (
    patch: Parameters<typeof updateTranscriptMeta>[2],
    okMsg?: string,
  ): Promise<boolean> => {
    setSaving(true);
    try {
      const updated = await updateTranscriptMeta(current.id, current, patch);
      onDocUpdated?.(updated);
      if (okMsg) notify('success', okMsg);
      return true;
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not save.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleFavorite = () => void persistMeta({ favorite: !current.favorite });

  const toggleHighlight = (start: number) => {
    const has = current.highlights.includes(start);
    const next = has ? current.highlights.filter((s) => s !== start) : [...current.highlights, start];
    void persistMeta({ highlights: next });
  };

  const saveEdit = async () => {
    const draft = editDraft.trim();
    const ok = await persistMeta(
      { editedText: draft && draft !== current.rawText ? editDraft : null },
      'Transcript updated.',
    );
    if (ok) setEditing(false);
  };

  const saveNotes = () => void persistMeta({ notes: notesDraft }, 'Notes saved.');

  const addTag = () => {
    const t = tagInput.toLowerCase().trim().replace(/,/g, '');
    setTagInput('');
    if (!t || current.tags.includes(t)) return;
    void persistMeta({ tags: [...current.tags, t] });
  };

  const removeTag = (t: string) => void persistMeta({ tags: current.tags.filter((x) => x !== t) });

  // -- Exports ---------------------------------------------------------------
  const stem = safeFilenameStem(current.title);

  const doCopyAll = async (markdown: boolean) => {
    await copyText(markdown ? buildMarkdown(current) : displayText);
    setCopied(true);
    notify('success', markdown ? 'Markdown copied to clipboard.' : 'Transcript copied to clipboard.');
    window.setTimeout(() => setCopied(false), 2000);
  };

  const exportPdf = () => {
    // Save-as-PDF inherits document.title as the suggested filename.
    const prev = document.title;
    document.title = stem;
    const restore = () => {
      document.title = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    window.setTimeout(restore, 3000);
  };

  // -- Caption tracks ---------------------------------------------------------
  const openTracks = async () => {
    if (tracks || tracksLoading) return;
    setTracksLoading(true);
    try {
      const r = await listAvailableTracks(current.url);
      setTracks(r.tracks);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not list caption tracks.');
    } finally {
      setTracksLoading(false);
    }
  };

  const switchTrack = async (lang: string) => {
    if (switchingLang) return;
    setSwitchingLang(lang);
    try {
      const r = await extractTrackFromUrl(current.url, lang);
      const updated = await replaceTranscriptContent(current.id, {
        rawText: r.rawText,
        captions: r.captions,
        trackLang: r.trackLang,
        trackKind: r.trackKind,
      });
      onDocUpdated?.(updated);
      setEditing(false);
      notify('success', `Switched to ${lang} captions (${r.captions.length} cues).`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not load that language.');
    } finally {
      setSwitchingLang(null);
    }
  };

  // -- Render helpers ----------------------------------------------------------
  const registerMark = (mi: number) => (el: HTMLElement | null) => {
    matchRefs.current[mi] = el;
  };

  const renderParaMatches = () => {
    if (!q || paraOffsets.length === 0) return <>{displayText}</>;
    const parts: React.ReactNode[] = [];
    let pos = 0;
    paraOffsets.forEach((start, mi) => {
      if (start > pos) parts.push(<span key={`t${mi}`}>{displayText.slice(pos, start)}</span>);
      parts.push(
        <mark
          key={`m${mi}`}
          ref={registerMark(mi)}
          className={cn(mi === activeMatch % matchCount ? 'bg-amber-400' : 'bg-amber-200')}
        >
          {displayText.slice(start, start + q.length)}
        </mark>,
      );
      pos = start + q.length;
    });
    if (pos < displayText.length) parts.push(<span key="tail">{displayText.slice(pos)}</span>);
    return <>{parts}</>;
  };

  const renderCueText = (text: string, cueIdx: number) => {
    if (!q || !cueMatchIdx.includes(cueIdx)) return <>{text}</>;
    const lower = text.toLowerCase();
    const parts: React.ReactNode[] = [];
    let pos = 0;
    let mi = 0;
    let i = lower.indexOf(q);
    while (i !== -1 && mi < 50) {
      if (i > pos) parts.push(<span key={`t${mi}`}>{text.slice(pos, i)}</span>);
      parts.push(
        <mark key={`m${mi}`} className="bg-amber-200">
          {text.slice(i, i + q.length)}
        </mark>,
      );
      pos = i + q.length;
      i = lower.indexOf(q, pos);
      mi += 1;
    }
    if (pos < text.length) parts.push(<span key="tail">{text.slice(pos)}</span>);
    return <>{parts}</>;
  };

  return (
    <div className="print-root fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="no-print absolute inset-0 bg-stone-950/50" onClick={onClose} />
      <div className="print-area relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-none border border-stone-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="no-print flex items-start gap-4 border-b border-stone-200 p-5">
          {current.thumbnail && (
            <img src={current.thumbnail} alt="" className="hidden h-16 w-28 shrink-0 rounded-none object-cover sm:block" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h2 className="line-clamp-2 flex-1 font-semibold leading-snug">{current.title}</h2>
              <button
                onClick={toggleFavorite}
                title={current.favorite ? 'Remove from favorites' : 'Add to favorites'}
                className={cn(
                  'shrink-0 rounded-none p-1.5 transition hover:bg-amber-50',
                  current.favorite ? 'text-amber-500' : 'text-stone-300 hover:text-amber-500',
                )}
              >
                <Star className={cn('h-5 w-5', current.favorite && 'fill-amber-400')} />
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                onClick={() => void openExternal(current.url)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 hover:text-sky-900 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Watch video
              </button>
              {current.trackLang && (
                <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                  <Languages className="h-3.5 w-3.5" />
                  {current.trackLang}
                  {current.trackKind === 'asr' ? ' (auto)' : ''}
                </span>
              )}
              {current.editedText != null && (
                <span className="bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Edited</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close reader"
            className="rounded-none p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-stone-100 px-5 py-3">
          <div className="flex rounded-none bg-stone-100 p-1 text-sm">
            <button
              onClick={() => setMode('paragraphs')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-none px-3 py-1.5 font-medium transition',
                mode === 'paragraphs' ? 'bg-white text-stone-900 shadow' : 'text-stone-500 hover:text-stone-800',
              )}
            >
              <AlignLeft className="h-4 w-4" /> Paragraphs
            </button>
            <button
              onClick={() => setMode('timestamps')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-none px-3 py-1.5 font-medium transition',
                mode === 'timestamps' ? 'bg-white text-stone-900 shadow' : 'text-stone-500 hover:text-stone-800',
              )}
            >
              <ListOrdered className="h-4 w-4" /> Timestamps
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1);
            }}
            placeholder="Search in transcript…"
            className="min-w-36 flex-1 rounded-none border border-stone-300 px-3 py-1.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900"
          />
          {q && (
            <span className="inline-flex items-center gap-1 text-xs text-stone-500">
              {matchCount} {matchCount === 1 ? 'match' : 'matches'}
              <button
                onClick={() => stepMatch(-1)}
                title="Previous match (Shift+Enter)"
                className="rounded-none p-1 hover:bg-stone-100"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => stepMatch(1)}
                title="Next match (Enter)"
                className="rounded-none p-1 hover:bg-stone-100"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </span>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={exportPdf}
              title="Open the print dialog — filename defaults to this video's title"
              className="inline-flex items-center gap-2 rounded-none border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              <FileDown className="h-4 w-4" />
              Export PDF
            </button>
            <button
              onClick={() => void doCopyAll(false)}
              className="inline-flex items-center gap-2 rounded-none border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy All'}
            </button>
            <details className="relative">
              <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-none border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 [&::-webkit-details-marker]:hidden">
                More
              </summary>
              <div className="absolute right-0 z-10 mt-1 w-52 border border-stone-200 bg-white py-1 shadow-lg">
                <MenuItem label="Copy as Markdown" onClick={() => void doCopyAll(true)} />
                <MenuItem
                  label="Download .txt"
                  onClick={() => downloadTextFile(`${stem}.txt`, displayText)}
                />
                <MenuItem
                  label="Download .md"
                  onClick={() => downloadTextFile(`${stem}.md`, buildMarkdown(current), 'text/markdown;charset=utf-8')}
                />
                <MenuItem
                  label="Download .srt"
                  onClick={() => downloadTextFile(`${stem}.srt`, buildSrt(current), 'text/plain;charset=utf-8')}
                />
                <MenuItem
                  label="Download .vtt"
                  onClick={() => downloadTextFile(`${stem}.vtt`, buildVtt(current), 'text/vtt;charset=utf-8')}
                />
              </div>
            </details>
          </div>
        </div>

        {/* Print-only title block (screen: hidden, print: shown) */}
        <div className="hidden px-6 pb-1 pt-6 print:block">
          <h1 className="text-xl font-bold text-black">{current.title}</h1>
          <p className="mt-1 break-all text-xs text-stone-600">{current.url}</p>
          <p className="mt-0.5 text-xs text-stone-500">
            Exported from Nukuzaa on{' '}
            {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} ·{' '}
            {current.captions.length} cues · {mode === 'paragraphs' ? 'paragraphs' : 'timestamps'}
          </p>
        </div>

        {/* Body */}
        <div className="print-body nice-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {mode === 'paragraphs' ? (
            editing ? (
              <div className="no-print">
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={14}
                  className="w-full rounded-none border border-stone-300 p-3 font-serif text-[1.05rem] leading-relaxed outline-none focus:border-stone-900"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="rounded-none bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="rounded-none border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="font-serif text-[1.05rem] leading-relaxed text-stone-800">{renderParaMatches()}</p>
            )
          ) : (
            <ol className="flex flex-col gap-2.5">
              {current.captions.map((c, i) => {
                const highlighted = current.highlights.includes(c.start);
                return (
                  <li
                    key={i}
                    ref={cueMatchIdx.includes(i) ? registerMark(cueMatchIdx.indexOf(i)) : undefined}
                    className={cn('flex gap-3 text-[0.95rem] leading-relaxed', highlighted && 'bg-amber-50')}
                  >
                    <button
                      onClick={() => void openExternal(timestampUrl(current.url, c.start))}
                      title={`Open video at ${formatMMSS(c.start)}`}
                      className="w-12 shrink-0 select-none self-start font-mono text-[0.8rem] font-medium text-sky-700 hover:underline"
                    >
                      {formatMMSS(c.start)}
                    </button>
                    <span className="flex-1 text-stone-800">{renderCueText(c.text, i)}</span>
                    <span className="no-print flex shrink-0 items-start gap-0.5">
                      <button
                        onClick={() => toggleHighlight(c.start)}
                        title={highlighted ? 'Remove highlight' : 'Highlight this cue'}
                        className={cn(
                          'rounded-none p-1 transition',
                          highlighted ? 'text-amber-500' : 'text-stone-300 hover:text-amber-500',
                        )}
                      >
                        <Bookmark className={cn('h-4 w-4', highlighted && 'fill-amber-300')} />
                      </button>
                      <button
                        onClick={() => void copyText(timestampUrl(current.url, c.start)).then(() => notify('success', 'Timestamp link copied.'))}
                        title="Copy link to this timestamp"
                        className="rounded-none p-1 text-stone-300 transition hover:text-stone-600"
                      >
                        <Link2 className="h-4 w-4" />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {current.captions.length === 0 && (
            <p className="text-sm text-stone-500">No timestamped cues stored for this document.</p>
          )}
        </div>

        {/* Annotations */}
        <details className="no-print border-t border-stone-200">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-6 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 [&::-webkit-details-marker]:hidden">
            <Pencil className="h-4 w-4" /> Notes, tags & languages
          </summary>
          <div className="space-y-4 border-t border-stone-100 px-6 py-4">
            {!editing && mode === 'paragraphs' && (
              <button
                onClick={() => {
                  setEditDraft(displayText);
                  setEditing(true);
                }}
                className="rounded-none border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                Edit transcript text
              </button>
            )}
            {current.editedText != null && (
              <button
                onClick={() => void persistMeta({ editedText: null }, 'Reverted to extracted text.')}
                className="ml-2 rounded-none border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                Revert to extracted text
              </button>
            )}
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-stone-500">Notes</label>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={3}
                placeholder="Your notes on this video…"
                className="mt-1.5 w-full rounded-none border border-stone-300 p-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900"
              />
              <button
                onClick={saveNotes}
                disabled={saving || notesDraft === current.notes}
                className="mt-1.5 rounded-none bg-stone-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
              >
                Save notes
              </button>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-stone-500">Tags</label>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {current.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
                    <Tag className="h-3 w-3" /> {t}
                    <button onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`} className="hover:text-red-600">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="+ add tag"
                  className="w-24 rounded-none border border-dashed border-stone-300 px-2 py-1 text-xs outline-none placeholder:text-stone-400 focus:border-stone-900"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-stone-500">Caption language</label>
              <div className="mt-1.5">
                {!tracks ? (
                  <button
                    onClick={openTracks}
                    disabled={tracksLoading}
                    className="inline-flex items-center gap-2 rounded-none border border-stone-300 px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                  >
                    <Languages className="h-4 w-4" />
                    {tracksLoading ? 'Loading languages…' : 'Choose language'}
                  </button>
                ) : tracks.length === 0 ? (
                  <p className="text-sm text-stone-500">No caption tracks found.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {tracks.map((t) => {
                      const isCurrent = current.trackLang === t.languageCode && (current.trackKind ?? '') === (t.kind ?? '');
                      return (
                        <button
                          key={`${t.languageCode}|${t.kind}`}
                          onClick={() => void switchTrack(t.languageCode)}
                          disabled={switchingLang != null || isCurrent}
                          className={cn(
                            'border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50',
                            isCurrent
                              ? 'border-stone-900 bg-stone-900 text-white'
                              : 'border-stone-300 text-stone-700 hover:bg-stone-100',
                          )}
                        >
                          {switchingLang === t.languageCode ? 'Loading…' : t.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-100"
    >
      {label}
    </button>
  );
}
