import { useState } from 'react';
import { Captions, Loader2 } from 'lucide-react';
import { authClient } from '../lib/auth';
import { cn } from '../lib/utils';

type Mode = 'signin' | 'signup';

function prettyAuthError(raw: unknown): string {
  const msg = typeof raw === 'object' && raw !== null && 'message' in raw
    ? String((raw as { message: unknown }).message)
    : String(raw ?? '');
  if (/invalid email or password|invalid credentials|not found/i.test(msg))
    return 'Wrong email or password. Try again or create an account.';
  if (/user already exists|already.*registered|duplicate/i.test(msg))
    return 'That email is already registered — sign in instead.';
  if (/password.*(short|weak|8)|too short/i.test(msg))
    return 'Password must be at least 8 characters.';
  if (/invalid email/i.test(msg)) return 'Enter a valid email address.';
  if (/network|fetch failed|failed to fetch/i.test(msg))
    return 'Cannot reach the login server — check your connection and retry.';
  return msg || 'Something went wrong signing you in.';
}

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const res = mode === 'signin'
        ? await authClient.signIn.email({ email: cleanEmail, password })
        : await authClient.signUp.email({ name: name.trim() || cleanEmail.split('@')[0], email: cleanEmail, password });
      if (res.error) {
        setError(prettyAuthError(res.error));
        return;
      }
      // Reconcile the session hook explicitly so routing into the app never
      // depends on the hook's background refresh timing.
      try {
        await authClient.getSession();
      } catch {
        /* hook will retry on its own; success path already validated */
      }
    } catch (e) {
      setError(prettyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-8 shadow-card">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-900 text-white">
            <Captions className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Nukuzaa</h1>
          <p className="mt-1 text-sm text-stone-500">
            {mode === 'signin' ? 'Welcome back — sign in to your transcripts.' : 'Create an account to keep transcripts private.'}
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1 text-sm font-medium">
          {(['signin', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              className={cn(
                'rounded-lg py-2 transition',
                mode === m ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800',
              )}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {mode === 'signup' && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name (optional)"
              autoComplete="name"
              className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 focus:ring-2 focus:ring-stone-200"
            />
          )}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="Email address"
            type="email"
            autoComplete="email"
            className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 focus:ring-2 focus:ring-stone-200"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder={mode === 'signup' ? 'Password (min 8 characters)' : 'Password'}
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 focus:ring-2 focus:ring-stone-200"
          />
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200">{error}</p>
        )}

        <button
          onClick={() => void submit()}
          disabled={busy}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <p className="mt-4 text-center text-xs leading-relaxed text-stone-400">
          Your folders and transcripts are private to this account.
        </p>
      </div>
    </div>
  );
}
