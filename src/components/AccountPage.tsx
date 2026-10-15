import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Database, FolderOpen, Loader2, LogOut, MonitorSmartphone, RefreshCw, Square, UserRound } from 'lucide-react';
import AuthScreen from './AuthScreen';
import { authClient } from '../lib/auth';
import { getStorageStats } from '../lib/db';
import { backfillVault, revealVault, vaultRootPath, vaultSupported, type BackfillProgress } from '../lib/vault';
import type { StorageStats } from '../lib/types';
import { formatBytes } from '../lib/utils';
import { useToast } from '../hooks/useToast';

interface Props {
  userId: string | null;
  userEmail: string | null;
  signingOut: boolean;
  onSignOut: () => void;
  onBack?: () => void;
}

/** Soft storage reference so the meter has a scale (transcripts are tiny). */
const QUOTA_BYTES = 50 * 1024 * 1024;

interface SessionRow {
  id: string;
  createdAt?: string | Date;
  userAgent?: string | null;
  current?: boolean;
}

export default function AccountPage({ userId, userEmail, signingOut, onSignOut, onBack }: Props) {
  const { notify } = useToast();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionsUnsupported, setSessionsUnsupported] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [backfill, setBackfill] = useState<BackfillProgress | null>(null);
  const backfillAbort = useRef<AbortController | null>(null);

  useEffect(() => () => {
    backfillAbort.current?.abort();
    backfillAbort.current = null;
  }, []);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    getStorageStats()
      .then((s) => {
        if (live) setStats(s);
      })
      .catch(() => {
        /* offline — meter stays hidden */
      });
    const client = authClient as unknown as {
      listSessions?: () => Promise<{ data?: unknown; error?: unknown }>;
    };
    if (typeof client.listSessions === 'function') {
      client
        .listSessions()
        .then((res) => {
          if (!live) return;
          if (res?.error || !Array.isArray(res?.data)) {
            setSessionsUnsupported(true);
            return;
          }
          setSessions(res.data as SessionRow[]);
        })
        .catch(() => {
          if (live) setSessionsUnsupported(true);
        });
    } else {
      setSessionsUnsupported(true);
    }
    return () => {
      live = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !vaultSupported()) return;
    vaultRootPath().then((p) => {
      if (p) setVaultPath(p);
    }).catch(() => {});
  }, [userId]);

  const runBackfill = async () => {
    if (backingUp) return;
    const ctrl = new AbortController();
    backfillAbort.current = ctrl;
    setBackingUp(true);
    setBackfill({ foldersDone: 0, foldersTotal: 0, docsDone: 0 });
    try {
      const r = await backfillVault(setBackfill, { signal: ctrl.signal });
      notify('success', `Local vault updated — ${r.docs} ${r.docs === 1 ? 'document' : 'documents'} in ${r.folders} ${r.folders === 1 ? 'folder' : 'folders'}.`);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        notify('info', 'Local backup stopped — already-mirrored files were kept.');
      } else {
        notify('error', e instanceof Error ? e.message : 'Local backup failed.');
      }
    } finally {
      backfillAbort.current = null;
      setBackingUp(false);
    }
  };

  const stopBackfill = () => backfillAbort.current?.abort();

  const openVault = async () => {
    const ok = await revealVault();
    if (!ok) notify('error', 'Could not open the local vault folder.');
  };

  // Sign-in lives here: signed-out visitors get the login form as the accounts page.
  if (!userId) {
    return <AuthScreen />;
  }

  const revokeOthers = async () => {
    const client = authClient as unknown as {
      revokeOtherSessions?: () => Promise<{ error?: unknown }>;
    };
    if (typeof client.revokeOtherSessions !== 'function') {
      notify('error', 'Session revocation is not available with the current login server.');
      return;
    }
    setRevoking(true);
    try {
      const res = await client.revokeOtherSessions();
      if (res?.error) throw new Error('Revocation failed.');
      setSessions((prev) => (prev ? prev.filter((s) => s.current) : prev));
      notify('success', 'Signed out everywhere else.');
    } catch {
      notify('error', 'Could not revoke other sessions.');
    } finally {
      setRevoking(false);
    }
  };

  const pct = stats ? Math.min(100, Math.round((stats.bytes / QUOTA_BYTES) * 100)) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      {onBack && (
        <button
          onClick={onBack}
          className="ui-secondary h-9 px-3.5 text-xs font-semibold"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      )}

      <div className="mt-5 rounded-2xl border border-stone-200/90 bg-white p-7 shadow-card sm:p-9">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 text-stone-950 shadow-xs ring-1 ring-amber-400/30">
            <UserRound className="h-6 w-6 stroke-[2.2]" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-stone-900">Account</h1>
          <p className="mt-1 text-xs text-stone-500">Your transcripts and collections stay private to this account.</p>
        </div>

        <dl className="mt-6 space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-100 bg-stone-50/70 px-4 py-2.5">
            <dt className="text-xs font-medium text-stone-500">Email</dt>
            <dd className="truncate text-xs font-semibold text-stone-900" title={userEmail ?? ''}>
              {userEmail ?? '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-100 bg-stone-50/70 px-4 py-2.5">
            <dt className="text-xs font-medium text-stone-500">User ID</dt>
            <dd className="truncate font-mono text-[11px] text-stone-600" title={userId}>
              {userId}
            </dd>
          </div>
        </dl>

        {stats && (
          <div className="mt-6 border-t border-stone-100 pt-5">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-stone-500" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-stone-700">Storage</h2>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              <span className="font-semibold text-stone-800">{stats.docs} {stats.docs === 1 ? 'document' : 'documents'}</span>
              {' · '}
              <span>{stats.folders} {stats.folders === 1 ? 'folder' : 'folders'}</span>
              {' · '}
              <span>{formatBytes(stats.bytes)} of {formatBytes(QUOTA_BYTES)}</span>
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
              <div className="h-full rounded-full bg-stone-900 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {vaultSupported() && (
          <div className="mt-6 border-t border-stone-100 pt-5">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-stone-500" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-stone-700">Local vault</h2>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-inset ring-emerald-200">
                Auto-mirror on
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-600">
              Every folder and transcript is mirrored as plain files you own —{' '}
              <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11px]">transcript.md</code>,{' '}
              <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11px]">notes.md</code>,{' '}
              <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11px]">summary.md</code>,{' '}
              <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11px]">meta.json</code> — under:
            </p>
            <p className="mt-2 break-all rounded-xl border border-stone-200/80 bg-stone-50/60 px-3 py-2 font-mono text-[11px] text-stone-700">
              {vaultPath ?? 'Documents › Nukuzaa'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={openVault}
                className="ui-secondary h-9 px-3.5 text-xs font-semibold"
              >
                <FolderOpen className="h-3.5 w-3.5" /> Open in Explorer
              </button>
              <button
                onClick={runBackfill}
                disabled={backingUp}
                className="ui-secondary h-9 px-3.5 text-xs font-semibold"
              >
                {backingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {backingUp
                  ? backfill && backfill.foldersTotal > 0
                    ? `Backing up… ${backfill.foldersDone}/${backfill.foldersTotal} folders · ${backfill.docsDone} docs`
                    : 'Backing up…'
                  : 'Back up now'}
              </button>
              {backingUp && (
                <button
                  onClick={stopBackfill}
                  className="ui-secondary h-9 px-3.5 text-xs font-semibold"
                >
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
              New and edited items save automatically. “Back up now” mirrors anything saved before this feature.
              No keys or sessions are ever written here.
            </p>
          </div>
        )}

        <div className="mt-6 border-t border-stone-100 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 text-stone-500" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-stone-700">Sessions</h2>
            </div>
            {sessions && sessions.length > 1 && (
              <button
                onClick={revokeOthers}
                disabled={revoking}
                className="rounded-xl border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
              >
                {revoking ? 'Working…' : 'Sign out other devices'}
              </button>
            )}
          </div>
          {sessionsUnsupported ? (
            <p className="mt-2 text-xs text-stone-500">
              Session listing is not available with the current login server.
            </p>
          ) : sessions == null ? (
            <p className="mt-2 inline-flex items-center gap-2 text-xs text-stone-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sessions…
            </p>
          ) : sessions.length === 0 ? (
            <p className="mt-2 text-xs text-stone-500">No active sessions reported.</p>
          ) : (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-stone-200/80 bg-white px-3.5 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-stone-700">
                    {s.userAgent || 'Unknown device'}
                  </span>
                  {s.current ? (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                      This device
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-stone-400">
                      {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={onSignOut}
          disabled={signingOut}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-5 py-2.5 text-xs font-semibold text-stone-700 transition hover:border-stone-300 hover:bg-stone-100 hover:text-stone-950 disabled:opacity-50"
        >
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
