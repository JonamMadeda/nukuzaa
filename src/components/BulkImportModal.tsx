import { useEffect, useState } from 'react';
import { Check, ListPlus, Loader2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';

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

  useEffect(() => {
    if (open) {
      setText(initialText);
      setItems([]);
      setRunning(false);
    }
  }, [open, initialText]);

  if (!open) return null;

  const lineCount = text.split('\n').map((l) => l.trim()).filter(Boolean).length;

  const start = async () => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0 || running) return;
    // Expand playlists first so every item below is a single video URL.
    const expanded: Item[] = [];
    for (const line of lines) {
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
    setItems(expanded);
    setRunning(true);
    let saved = 0;
    for (let i = 0; i < expanded.length; i += 1) {
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'working' } : it)));
      try {
        const r = await onImport(expanded[i].label);
        if (r.status === 'saved') saved += 1;
        setItems((prev) =>
          prev.map((it, j) =>
            j === i ? { ...it, status: r.status, detail: r.detail ?? (r.status === 'saved' ? r.title : undefined) } : it,
          ),
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((it, j) =>
            j === i ? { ...it, status: 'failed', detail: e instanceof Error ? e.message : 'Import failed.' } : it,
          ),
        );
      }
    }
    setRunning(false);
    onDone();
    notify('success', `Bulk import finished — ${saved} saved.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-950/40 backdrop-blur-xs transition-opacity" onClick={running ? undefined : onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-floating">
        <div className="flex items-center justify-between border-b border-stone-100 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-900 shadow-xs">
              <ListPlus className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-stone-900">Bulk import</h2>
              <p className="text-xs text-stone-500">Import multiple videos or entire playlists</p>
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
          {items.length > 0 && (
            <ul className="mt-3 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-0.5">
              {items.map((it) => (
                <li
                  key={it.key}
                  className="flex items-start gap-2.5 rounded-xl border border-stone-200/80 bg-white p-2.5 text-xs"
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
                      (it.status === 'queued' || it.status === 'working') && 'text-stone-400',
                    )}
                  >
                    {it.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-100 p-4">
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
            {running ? 'Importing…' : `Import ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
