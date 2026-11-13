import { useState } from 'react';
import { Check, Copy, Loader2, WifiOff } from 'lucide-react';

interface DbErrorCardProps {
  error: string;
  dbHost?: string | null;
  autoRetrying?: boolean;
  attempt?: number;
  onRetry: () => void;
}

export default function DbErrorCard({
  error,
  dbHost = null,
  autoRetrying = false,
  attempt = 0,
  onRetry,
}: DbErrorCardProps) {
  const [copied, setCopied] = useState(false);

  const copyDiagnostics = async () => {
    const text = `Nukuzaa diagnostics\nTarget DB host: ${dbHost ?? '(no URL configured)'}\nAttempt: ${attempt ?? 0}\nError: ${error}`;
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
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-red-50/70 p-6 text-center">
      <WifiOff className="mx-auto h-8 w-8 text-red-500" />
      <h2 className="mt-3 text-base font-bold text-red-900">Could not reach the database</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-red-700">{error}</p>
      <p className="mx-auto mt-2 max-w-md font-mono text-xs text-red-600">
        Target: {dbHost ?? '(no database URL configured — check .env)'}
      </p>
      {autoRetrying && (
        <p className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-amber-800">
          <Loader2 className="h-4 w-4 animate-spin" /> Retrying automatically… (attempt {attempt ?? 0})
        </p>
      )}
      <div className="mt-5 flex items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl bg-red-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-red-600"
        >
          Retry connection
        </button>
        <button
          type="button"
          onClick={copyDiagnostics}
          title="Copy error details (host + message, no secrets)"
          className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 shadow-2xs transition hover:bg-red-50"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
    </div>
  );
}
