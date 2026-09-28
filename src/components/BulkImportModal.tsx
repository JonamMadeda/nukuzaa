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
      <div className="absolute inset-0 bg-stone-950/50" onClick={running ? undefined : onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-none border border-stone-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-none bg-stone-900 text-white">
              <ListPlus className="h-5 w-5" />
            </span>
            <h2 className="font-semibold">Bulk import</h2>
          </div>
          {!running && (
            <button
              onClick={onClose}
              aria-label="Close bulk import"
              className="rounded-none p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="nice-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <p className="text-sm text-stone-500">
            One URL per line — videos, Shorts, or a playlist link (expanded automatically).
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            disabled={running}
            placeholder={'https://www.youtube.com/watch?v=…\nhttps://youtu.be/…\nhttps://www.youtube.com/playlist?list=…'}
            className="mt-3 w-full rounded-none border border-stone-300 p-2.5 font-mono text-xs outline-none placeholder:text-stone-400 focus:border-stone-900 disabled:bg-stone-50"
          />
          {items.length > 0 && (
            <ul className="mt-3 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {items.map((it) => (
                <li
                  key={it.key}
                  className="flex items-start gap-2 border border-stone-200 px-2.5 py-2 text-xs"
                >
                  <span className="mt-0.5 shrink-0">
                    {it.status === 'working' && <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-500" />}
                    {it.status === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                    {it.status === 'failed' && <X className="h-3.5 w-3.5 text-red-600" />}
                    {(it.status === 'queued' || it.status === 'skipped') && (
                      <span
                        className={cn(
                          'inline-block h-3.5 w-3.5 border text-center text-[10px] leading-3',
                          it.status === 'skipped' ? 'border-amber-300 text-amber-600' : 'border-stone-300 text-stone-400',
                        )}
                      >
                        –
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono">{it.label}</span>
                    {it.detail && <span className="block truncate text-stone-500">{it.detail}</span>}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-medium',
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

        <div className="flex justify-end gap-2 border-t border-stone-200 p-4">
          {!running && (
            <button
              onClick={onClose}
              className="rounded-none px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
            >
              Close
            </button>
          )}
          <button
            onClick={start}
            disabled={running || lineCount === 0}
            className="inline-flex items-center gap-2 rounded-none bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {running ? 'Importing…' : `Import ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
