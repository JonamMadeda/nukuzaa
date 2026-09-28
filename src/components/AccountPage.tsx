import { useEffect, useState } from 'react';
import { ArrowLeft, Database, Loader2, LogOut, MonitorSmartphone, UserRound } from 'lucide-react';
import AuthScreen from './AuthScreen';
import { authClient } from '../lib/auth';
import { getStorageStats } from '../lib/db';
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
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-none border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}

      <div className="mt-5 rounded-none border border-stone-200 bg-white p-8 shadow-card">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-none bg-stone-900 text-white">
            <UserRound className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Account</h1>
          <p className="mt-1 text-sm text-stone-500">Signed in — your folders and transcripts are private to this account.</p>
        </div>

        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4 rounded-none bg-stone-100 px-4 py-2.5">
            <dt className="font-medium text-stone-500">Email</dt>
            <dd className="truncate font-medium text-stone-900" title={userEmail ?? ''}>
              {userEmail ?? '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-none bg-stone-100 px-4 py-2.5">
            <dt className="font-medium text-stone-500">User ID</dt>
            <dd className="truncate font-mono text-xs text-stone-700" title={userId}>
              {userId}
            </dd>
          </div>
        </dl>

        {stats && (
          <div className="mt-6 border-t border-stone-100 pt-5">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-stone-500" />
              <h2 className="text-sm font-semibold">Storage</h2>
            </div>
            <p className="mt-2 text-sm text-stone-600">
              {stats.docs} {stats.docs === 1 ? 'document' : 'documents'} · {stats.folders}{' '}
              {stats.folders === 1 ? 'folder' : 'folders'} · {formatBytes(stats.bytes)} of {formatBytes(QUOTA_BYTES)}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-none bg-stone-100">
              <div className="h-full rounded-none bg-stone-900 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="mt-6 border-t border-stone-100 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 text-stone-500" />
              <h2 className="text-sm font-semibold">Sessions</h2>
            </div>
            {sessions && sessions.length > 1 && (
              <button
                onClick={revokeOthers}
                disabled={revoking}
                className="rounded-none border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
              >
                {revoking ? 'Working…' : 'Sign out other devices'}
              </button>
            )}
          </div>
          {sessionsUnsupported ? (
            <p className="mt-2 text-sm text-stone-500">
              Session listing is not available with the current login server.
            </p>
          ) : sessions == null ? (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
            </p>
          ) : sessions.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No active sessions reported.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 border border-stone-200 px-3 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-stone-600">
                    {s.userAgent || 'Unknown device'}
                  </span>
                  {s.current ? (
                    <span className="shrink-0 bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
                      This device
                    </span>
                  ) : (
                    <span className="shrink-0 text-stone-400">
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
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-none border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
        >
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
