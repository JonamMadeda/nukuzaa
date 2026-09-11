import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Loader2, RefreshCw, Rocket, X } from 'lucide-react';
import type { Update } from '@tauri-apps/plugin-updater';
import { useToast } from '../hooks/useToast';

export const CHECK_UPDATES_EVENT = 'nukuzaa:check-updates';

export function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Silent update check shortly after startup + manual checks via
 * `window.dispatchEvent(new Event(CHECK_UPDATES_EVENT))`.
 * When an update is found the user is prompted; download progress and any
 * errors are shown in-dialog. Browser (non-Tauri) usage skips silently.
 */
export default function UpdateManager() {
  const { notify } = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkNow = useCallback(
    async (silent: boolean) => {
      if (!isDesktop()) {
        if (!silent) notify('info', 'Update checks run inside the desktop app.');
        return;
      }
      setError(null);
      setPhase('checking');
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const u = await check();
        if (!u) {
          setPhase('idle');
          if (!silent) notify('success', 'You are on the latest version.');
          return;
        }
        setUpdate(u);
        setDownloaded(0);
        setTotal(null);
        setPhase('available');
      } catch (e) {
        setPhase('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [notify],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void checkNow(true), 4000);
    const onManual = () => void checkNow(false);
    window.addEventListener(CHECK_UPDATES_EVENT, onManual);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener(CHECK_UPDATES_EVENT, onManual);
    };
  }, [checkNow]);

  const downloadAndInstall = async () => {
    if (!update) return;
    setPhase('downloading');
    setDownloaded(0);
    setTotal(null);
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') {
          setTotal(ev.data.contentLength ?? null);
        } else if (ev.event === 'Progress') {
          setDownloaded((d) => d + ev.data.chunkLength);
        } else if (ev.event === 'Finished') {
          setPhase('ready');
        }
      });
      setPhase('ready');
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restartNow = async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (phase === 'idle') return null;

  if (phase === 'checking') {
    return (
      <div className="fixed bottom-5 left-5 z-[90] inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-stone-600 shadow-lg">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking for updates…
      </div>
    );
  }

  const pct = total ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-stone-950/40"
        onClick={phase === 'available' || phase === 'error' ? () => setPhase('idle') : undefined}
      />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-900 text-white">
              <ArrowDownToLine className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold">
                {phase === 'ready'
                  ? 'Update ready to install'
                  : phase === 'error'
                    ? 'Update failed'
                    : `Update available: v${update?.version ?? ''}`}
              </h2>
              <p className="text-sm text-stone-500">
                {phase === 'ready'
                  ? 'Restart Nukuzaa to finish installing.'
                  : phase === 'error'
                    ? 'Something went wrong — details below.'
                    : 'A newer Nukuzaa release was published on GitHub.'}
              </p>
            </div>
          </div>
          {(phase === 'available' || phase === 'error') && (
            <button
              onClick={() => setPhase('idle')}
              className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
              aria-label="Dismiss"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {update?.body && phase !== 'error' && (
          <p className="mt-4 max-h-32 overflow-y-auto rounded-xl bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
            {update.body}
          </p>
        )}

        {phase === 'error' && error && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-700">{error}</p>
        )}

        {phase === 'downloading' && (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-stone-100">
              {pct === null ? (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-stone-900" />
              ) : (
                <div className="h-full rounded-full bg-stone-900 transition-all" style={{ width: `${pct}%` }} />
              )}
            </div>
            <p className="mt-1.5 text-xs text-stone-500">
              Downloading… {formatBytes(downloaded)}
              {total ? ` of ${formatBytes(total)} (${pct}%)` : ''}
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {(phase === 'available' || phase === 'error') && (
            <button
              onClick={() => setPhase('idle')}
              className="rounded-xl px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
            >
              Later
            </button>
          )}
          {phase === 'available' && (
            <button
              onClick={downloadAndInstall}
              className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
            >
              <ArrowDownToLine className="h-4 w-4" /> Download & install
            </button>
          )}
          {phase === 'downloading' && (
            <button
              disabled
              className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white opacity-70"
            >
              <Loader2 className="h-4 w-4 animate-spin" /> Installing…
            </button>
          )}
          {phase === 'ready' && (
            <button
              onClick={restartNow}
              className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
            >
              <Rocket className="h-4 w-4" /> Restart now
            </button>
          )}
          {phase === 'error' && (
            <button
              onClick={() => void checkNow(false)}
              className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
