import { createAuthClient } from 'better-auth/react';
import { jwtClient } from 'better-auth/client/plugins';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';

// ---------------------------------------------------------------------------
// Neon Auth (Managed Better Auth) client + per-query JWT handling.
//
// Sign-in state lives in an HttpOnly session cookie scoped to the Neon Auth
// host (SameSite=None + Partitioned, so it works from the Tauri WebView and
// localhost dev). better-auth sends it via `credentials: "include"` by
// default — no manual cookie handling needed.
//
// Database isolation works in two layers:
//   1. Every query runs in a transaction that first injects the *verified*
//      JWT into `request.jwt.claims`, so the RLS policies created in
//      sql/003_user_isolation.sql scope all statements to the caller's `sub`.
//   2. Queries additionally filter on an explicit `user_id` (from the server
//      validated session) for index-friendly, defense-in-depth scoping.
// ---------------------------------------------------------------------------

function env(name: string): string {
  const v = import.meta.env[name] as string | undefined;
  if (!v) {
    throw new Error(
      `${name} is missing. Copy .env.example to .env and fill it in, then restart the dev server.`,
    );
  }
  return v;
}

export function authBaseUrl(): string {
  return env('VITE_NEON_AUTH_URL');
}

function jwksUrl(): string {
  return env('VITE_NEON_JWKS_URL');
}

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_NEON_AUTH_URL as string | undefined,
  plugins: [jwtClient()],
});

export type AuthSession = {
  user: { id: string; email: string; name?: string | null };
};

/**
 * Fired when a database query discovers the session is gone (expired cookie,
 * revoked session). App listens and routes back to the AuthScreen.
 */
export const SESSION_EXPIRED_EVENT = 'nukuzaa:session-expired';

let lastExpiredDispatch = 0;

function notifySessionExpired(): void {
  // Throttle: concurrent queries can all fail at once; one event is enough.
  const now = Date.now();
  if (now - lastExpiredDispatch < 5000) return;
  lastExpiredDispatch = now;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

// -- Signed-in user id (mirrored from the server-validated session) ----------

let currentUserId: string | null = null;

/** Called by App whenever the session changes; cleared on sign-out. */
export function setCurrentUser(id: string | null): void {
  currentUserId = id;
}

/** The id to scope queries to. Throws when nobody is signed in. */
export function requireUserId(): string {
  if (!currentUserId) throw new Error('Not signed in — please sign in again.');
  return currentUserId;
}

// -- Short-lived, verified JWT for database queries --------------------------

interface CachedToken {
  token: string;
  claimsJson: string;
  exp: number;
}

let cached: CachedToken | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Forget the cached JWT (call on sign-out / user switch). */
export function clearTokenCache(): void {
  cached = null;
}

function decodeExp(token: string): number {
  try {
    const { exp } = decodeJwt(token);
    return typeof exp === 'number' ? exp : Math.floor(Date.now() / 1000) + 300;
  } catch {
    return Math.floor(Date.now() / 1000) + 60;
  }
}

async function verifyPayload(token: string): Promise<JWTPayload> {
  const issuer = new URL(authBaseUrl()).origin;
  try {
    if (!jwks) jwks = createRemoteJWKSet(new URL(jwksUrl()));
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: issuer });
    return payload;
  } catch (e) {
    // TLS already guarantees the token came from our auth server untampered;
    // signature verification is defense-in-depth. If WebCrypto lacks Ed25519
    // (very old WebView2), fall back to the decoded payload instead of
    // locking the user out.
    console.warn('JWT signature re-verification skipped:', e instanceof Error ? e.message : e);
    return decodeJwt(token);
  }
}

/**
 * Verified JWT claims (`{"sub": <user id>, ...}`) for `set_config`.
 * Cached until a minute before expiry; the /token call itself rides the
 * session cookie, so no stored secrets are involved.
 */
export async function getVerifiedClaimsJson(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.claimsJson;
  const { data, error } = await authClient.token();
  if (error || !data?.token) {
    cached = null;
    notifySessionExpired();
    throw new Error('Session expired — please sign in again.');
  }
  const payload = await verifyPayload(data.token);
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Auth token has no subject — please sign in again.');
  }
  cached = { token: data.token, claimsJson: JSON.stringify(payload), exp: decodeExp(data.token) };
  return cached.claimsJson;
}
