import { Captions, Database, Loader2, LogOut, RefreshCw, WifiOff } from 'lucide-react';
import type { DbStatus } from '../lib/types';
import { cn } from '../lib/utils';

interface Props {
  status: DbStatus;
  onRetry: () => void;
  autoRetrying: boolean;
  attempt: number;
  userEmail?: string | null;
  onSignOut?: () => void;
  signingOut?: boolean;
}

export default function Header({ status, onRetry, autoRetrying, attempt, userEmail, onSignOut, signingOut }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-900 text-white">
            <Captions className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-tight">Nukuzaa</p>
            <p className="hidden text-xs text-stone-500 sm:block">YouTube transcripts, organized</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status === 'ready' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              <Database className="h-3.5 w-3.5" /> Neon connected
            </span>
          )}
          {status === 'connecting' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…
            </span>
          )}
          {status === 'error' && autoRetrying && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Retrying… (attempt {attempt})
            </span>
          )}
          {status === 'error' && !autoRetrying && (
            <button
              onClick={onRetry}
              title="Retry database connection"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5',
                'text-xs font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100',
              )}
            >
              <WifiOff className="h-3.5 w-3.5" /> DB offline — retry
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
          {userEmail && (
            <span
              title={userEmail}
              className="hidden max-w-44 truncate rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-stone-200 sm:inline"
            >
              {userEmail}
            </span>
          )}
          {onSignOut && (
            <button
              onClick={onSignOut}
              disabled={signingOut}
              title="Sign out"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-stone-500 ring-1 ring-stone-200 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
            >
              {signingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
