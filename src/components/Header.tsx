import { Captions, RefreshCw, UserRound, WifiOff } from 'lucide-react';
import type { DbStatus } from '../lib/types';
import { cn } from '../lib/utils';

interface Props {
  status: DbStatus;
  onRetry: () => void;
  autoRetrying: boolean;
  onOpenAccount: () => void;
}

export default function Header({ status, onRetry, autoRetrying, onOpenAccount }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-none bg-stone-900 text-white">
            <Captions className="h-5 w-5" />
          </span>
          <div className="flex h-9 flex-col justify-center">
            <p className="text-lg font-bold leading-[1.1] tracking-tight">Nukuzaa</p>
            <p className="mt-[3px] hidden text-[11px] leading-none text-stone-500 sm:block">YouTube transcripts, organized</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection is silent by design: only a hard failure surfaces a retry. */}
          {status === 'error' && !autoRetrying && (
            <button
              onClick={onRetry}
              title="Retry database connection"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-none bg-red-50 px-3 py-1.5',
                'text-xs font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100',
              )}
            >
              <WifiOff className="h-3.5 w-3.5" /> DB offline — retry
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={onOpenAccount}
            title="Account"
            className="inline-flex items-center gap-1.5 rounded-none px-3 py-1.5 text-xs font-medium text-stone-500 ring-1 ring-stone-200 hover:bg-stone-100 hover:text-stone-800"
          >
            <UserRound className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Account</span>
          </button>
        </div>
      </div>
    </header>
  );
}
