import { Captions, Keyboard, RefreshCw, UserRound, WifiOff } from 'lucide-react';
import type { DbStatus } from '../lib/types';
import { cn } from '../lib/utils';

interface Props {
  status: DbStatus;
  onRetry: () => void;
  autoRetrying: boolean;
  onOpenAccount: () => void;
  onOpenShortcuts?: () => void;
  userEmail?: string | null;
}

export default function Header({ status, onRetry, autoRetrying, onOpenAccount, onOpenShortcuts, userEmail }: Props) {
  const userInitial = userEmail ? userEmail.charAt(0).toUpperCase() : null;

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 text-stone-950 shadow-xs ring-1 ring-amber-400/30">
            <Captions className="h-4.5 w-4.5 stroke-[2.2]" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-stone-900">Nukuzaa</span>
              <span className="hidden rounded bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-600 sm:inline-block">
                Library
              </span>
            </div>
            <p className="hidden text-[11px] font-medium text-stone-400 md:block">
              Your video transcripts & research
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Connection status indicator */}
          {status === 'error' && !autoRetrying && (
            <button
              onClick={onRetry}
              title="Database offline — click to retry connection"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1.5',
                'text-xs font-medium text-red-700 ring-1 ring-red-200/80 transition-all hover:bg-red-100',
              )}
            >
              <WifiOff className="h-3.5 w-3.5" />
              <span>Offline — Retry</span>
              <RefreshCw className="h-3 w-3" />
            </button>
          )}

          {status === 'connecting' && (
            <span className="hidden items-center gap-1.5 text-xs text-stone-400 sm:inline-flex">
              <span className="h-2 w-2 animate-ping rounded-full bg-amber-400" />
              Syncing…
            </span>
          )}

          {onOpenShortcuts && (
            <button
              onClick={onOpenShortcuts}
              title="Keyboard shortcuts (?)"
              className="hidden items-center gap-1 rounded-md border border-stone-200/80 bg-stone-50/60 px-2 py-1 text-xs font-medium text-stone-500 transition hover:border-stone-300 hover:bg-stone-100 hover:text-stone-800 sm:inline-flex"
            >
              <Keyboard className="h-3.5 w-3.5" />
              <span>?</span>
            </button>
          )}

          <button
            onClick={onOpenAccount}
            title={userEmail ? `Account (${userEmail})` : 'Account'}
            className="group inline-flex items-center gap-2 rounded-md border border-stone-200/80 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 shadow-xs transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-stone-100 text-[11px] font-semibold text-stone-700 group-hover:bg-amber-100 group-hover:text-amber-900">
              {userInitial ?? <UserRound className="h-3 w-3" />}
            </span>
            <span className="hidden sm:inline">
              {userEmail ? userEmail.split('@')[0] : 'Account'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
