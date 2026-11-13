import { useEffect, useRef, useState } from 'react';
import { Check, Layers, ListPlus, Loader2, Square, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { extractVideoId } from '../lib/extractor';

export interface BulkOutcome {
  status: 'saved' | 'skipped' | 'failed';
  title: string;
  detail?: string;
}

interface Props {
  open: boolean;
  initialText: string;
  onClose: () => void;
  onExpandPlaylist: (url: string) => Promise<{ playlistId: string; videoIds: string[] }>;
  onImport: (url: string) => Promise<BulkOutcome>;
  onDone: () => void;
}

interface Item {
  key: string;
  label: string;
  status: 'queued' | 'working' | 'saved' | 'skipped' | 'failed';
  detail?: string;
}

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export default function BulkImportModal({ open, initialText, onClose, onExpandPlaylist, onImport, onDone }: Props) {
  const { notify } = useToast();
  const [text, setText] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [concurrency, setConcurrency] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem('nukuzaa_bulk_concurrency'));
      return stored >= 1 && stored <= 5 ? stored : 3;
    } catch {
      return 3;
    }
  });
  const stopRef = useRef(false);

  useEffect(() => {
    if (open) {
      setText(initialText);
      setItems([]);
      setRunning(false);
      stopRef.current = false;
    }
  }, [open, initialText]);

  if (!open) return null;

  const updateConcurrency = (n: number) => {
    setConcurrency(n);
    try {
      localStorage.setItem('nukuzaa_bulk_concurrency', String(n));
    } catch {
      /* ignore */
    }
  };

  const lineCount = text.split('\n').map((l) => l.trim()).filter(Boolean).length;
  const activeCount = items.filter((it) => it.status === 'working').length;
  const completedCount = items.filter(
    (it) => it.status === 'saved' || it.status === 'failed' || it.status === 'skipped',
  ).length;

  const stop = () => {
    stopRef.current = true;
  };

  const start = async () => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0 || running) return;

    setRunning(true);
    stopRef.current = false;

    // Expand playlists first so every item below is a single video URL.
    const expanded: Item[] = [];
    for (const line of lines) {
      if (stopRef.current) break;
      if (/[?&]list=/.test(line)) {
        try {
          const pl = await onExpandPlaylist(line);
          pl.videoIds.forEach((id, i) =>
            expanded.push({ key: `${line}#${i}`, label: watchUrl(id), status: 'queued' }),
          );
          notify('success', `Playlist: found ${pl.videoIds.length} videos.`);
        } catch (e) {
          expanded.push({
            key: line,
            label: line.slice(0, 80),
            status: 'failed',
            detail: e instanceof Error ? e.message : 'Playlist read failed.',
          });
        }
      } else {
        expanded.push({ key: line, label: line.slice(0, 80), status: 'queued' });
      }
    }

    if (stopRef.current) {
      setRunning(false);
      return;
    }

    // Deduplicate repeated video IDs within this batch to prevent redundant concurrent fetches
    const seenVideos = new Set<string>();
    const sanitized: Item[] = [];
    for (const it of expanded) {
      if (it.status === 'failed') {
        sanitized.push(it);
        continue;
      }
      const vid = extractVideoId(it.label);
      if (vid) {
        if (seenVideos.has(vid)) {
          sanitized.push({ ...it, status: 'skipped', detail: 'Duplicate in batch.' });
          continue;
        }
        seenVideos.add(vid);
      }
      sanitized.push(it);
    }

    setItems(sanitized);

    const queueIndices = sanitized
      .map((it, idx) => (it.status === 'queued' ? idx : -1))
      .filter((idx) => idx !== -1);

    if (queueIndices.length === 0) {
      setRunning(false);
      onDone();
      return;
    }

    let nextQueuePos = 0;
    let saved = 0;

    const worker = async () => {
      while (nextQueuePos < queueIndices.length) {
        if (stopRef.current) break;
        const itemIndex = queueIndices[nextQueuePos++];

        setItems((prev) => prev.map((it, j) => (j === itemIndex ? { ...it, status: 'working' } : it)));
        try {
          const r = await onImport(sanitized[itemIndex].label);
          if (r.status === 'saved') saved += 1;
          setItems((prev) =>
            prev.map((it, j) =>
              j === itemIndex
                ? {
                    ...it,
                    status: r.status,
                    detail: r.detail ?? (r.status === 'saved' ? r.title : undefined),
                  }
                : it,
            ),
          );
        } catch (e) {
          setItems((prev) =>
            prev.map((it, j) =>
              j === itemIndex
                ? { ...it, status: 'failed', detail: e instanceof Error ? e.message : 'Import failed.' }
                : it,
            ),
          );
        }
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, queueIndices.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (stopRef.current) {
      setItems((prev) =>
        prev.map((it) => (it.status === 'queued' ? { ...it, status: 'skipped', detail: 'Stopped by user.' } : it)),
      );
      notify('info', `Stopped bulk downloads (${saved} saved).`);
    } else {
      notify('success', `Bulk import finished — ${saved} saved.`);
    }

    setRunning(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-stone-950/40 backdrop-blur-xs transition-opacity"
        onClick={running ? undefined : onClose}
      />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-floating">
        <div className="flex items-center justify-between border-b border-stone-100 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-900 shadow-xs">
              <ListPlus className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-stone-900">Bulk import</h2>
              <p className="text-xs text-stone-500">Import multiple videos or entire playlists concurrently</p>
            </div>
          </div>
          {!running && (
            <button
              onClick={onClose}
              aria-label="Close bulk import"
              className="rounded-xl p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="nice-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <p className="text-xs text-stone-500">
            One URL per line — videos, Shorts, or playlist links (expanded automatically).
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            disabled={running}
            placeholder={'https://www.youtube.com/watch?v=…\nhttps://youtu.be/…\nhttps://www.youtube.com/playlist?list=…'}
            className="mt-2.5 w-full rounded-xl border border-stone-200 p-3 font-mono text-xs outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-200/60 disabled:bg-stone-50"
          />

          {/* Concurrency Selector */}
          <div className="mt-3 flex items-center justify-between rounded-xl border border-stone-200/80 bg-stone-50/80 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-stone-400" />
              <div>
                <span className="text-xs font-semibold text-stone-700">Concurrent downloads</span>
                <p className="text-[11px] text-stone-500">Number of videos downloading simultaneously</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={running}
                  onClick={() => updateConcurrency(n)}
                  className={cn(
                    'h-7 w-7 rounded-lg text-xs font-semibold transition',
                    concurrency === n
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-100 disabled:opacity-50',
                  )}
                  title={`Download up to ${n} video${n > 1 ? 's' : ''} at the same time`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Progress bar and active status */}
          {running && (
            <div className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/60 p-3">
              <div className="flex items-center justify-between text-xs text-stone-700">
                <span className="flex items-center gap-1.5 font-medium">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
                  <span>
                    {activeCount > 0
                      ? `Downloading ${activeCount} simultaneously (max ${concurrency})…`
                      : 'Finalizing batch…'}
                  </span>
                </span>
                <span className="font-mono text-[11px] font-semibold text-stone-500">
                  {completedCount} / {items.length} done
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/50">
                <div
                  className="h-full bg-amber-600 transition-all duration-300"
                  style={{
                    width: `${items.length > 0 ? (completedCount / items.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}

          {items.length > 0 && (
            <ul className="mt-3 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-0.5">
              {items.map((it) => (
                <li
                  key={it.key}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border p-2.5 text-xs transition',
                    it.status === 'working'
                      ? 'border-amber-300 bg-amber-50/40 shadow-xs'
                      : 'border-stone-200/80 bg-white',
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {it.status === 'working' && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />}
                    {it.status === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                    {it.status === 'failed' && <X className="h-3.5 w-3.5 text-red-600" />}
                    {(it.status === 'queued' || it.status === 'skipped') && (
                      <span
                        className={cn(
                          'inline-flex h-3.5 w-3.5 items-center justify-center rounded text-center text-[10px] leading-none',
                          it.status === 'skipped' ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-400',
                        )}
                      >
                        –
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-stone-800">{it.label}</span>
                    {it.detail && <span className="block truncate text-[11px] text-stone-500">{it.detail}</span>}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-[11px] font-semibold uppercase',
                      it.status === 'saved' && 'text-emerald-700',
                      it.status === 'failed' && 'text-red-700',
                      it.status === 'skipped' && 'text-amber-700',
                      it.status === 'working' && 'text-amber-600 font-bold',
                      it.status === 'queued' && 'text-stone-400',
                    )}
                  >
                    {it.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-stone-100 p-4">
          <div>
            {running && (
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
              >
                <Square className="h-3.5 w-3.5 fill-red-700" />
                Stop remaining
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {!running && (
              <button
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-100"
              >
                Close
              </button>
            )}
            <button
              onClick={start}
              disabled={running || lineCount === 0}
              className="ui-primary h-9 px-4 text-xs font-semibold"
            >
              {running && <Loader2 className="h-4 w-4 animate-spin" />}
              {running
                ? `Importing (${activeCount} active)…`
                : `Import ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
