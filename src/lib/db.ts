import { neon, type NeonQueryFunction, type NeonQueryFunctionInTransaction, type NeonQueryInTransaction } from '@neondatabase/serverless';
import type { CaptionCue, Folder, TranscriptDoc } from './types';
import { getVerifiedClaimsJson, requireUserId } from './auth';

// ---------------------------------------------------------------------------
// Per-user Neon access (HTTP pooling — safe to call from a Tauri WebView).
//
// The shipped app connects as the least-privilege `nukuzaa_app` role
// (NOBYPASSRLS, see sql/003_user_isolation.sql). Every query runs inside a
// transaction that first injects the signed-in user's *verified* JWT into
// `request.jwt.claims`, so the database RLS policies confine all statements
// to rows owned by that user — even if a future code path forgot its
// `user_id` filter. Queries *also* filter on `user_id` explicitly for
// index-friendly, defense-in-depth scoping.
//
// The owner credential (VITE_DATABASE_URL) is used only by
// scripts/migrate.mjs and never ships in a query path here.
// ---------------------------------------------------------------------------

let sqlClient: NeonQueryFunction<false, false> | null = null;

type AppTxn = NeonQueryFunctionInTransaction<false, false>;

function appConnectionString(): string {
  const url = import.meta.env.VITE_DATABASE_AUTHENTICATED_URL as string | undefined;
  if (!url) {
    throw new Error(
      'VITE_DATABASE_AUTHENTICATED_URL is missing. Run `node scripts/migrate.mjs` once to provision the app role, then restart.',
    );
  }
  return url;
}

export function getSql(): NeonQueryFunction<false, false> {
  if (!sqlClient) sqlClient = neon(appConnectionString());
  return sqlClient;
}

/** Drop the cached client — call on sign-out / user switch. */
export function resetDbClient(): void {
  sqlClient = null;
}

/**
 * Run one query as the signed-in user: set the verified JWT claims for the
 * transaction (RLS enforcement) and execute the query in the same txn.
 */
async function authed<T>(build: (txn: AppTxn) => NeonQueryInTransaction): Promise<T[]> {
  const sql = getSql();
  const claims = await getVerifiedClaimsJson();
  const results = await sql.transaction((txn) => [
    txn`select set_config('request.jwt.claims', ${claims}, true)`,
    build(txn),
  ]);
  return results[1] as T[];
}

/** Lightweight connectivity probe used for the header status pill. */
export async function checkConnection(): Promise<void> {
  await authed((txn) => txn`select 1 as ok`);
}

function toCaptionArray(v: unknown): CaptionCue[] {
  if (Array.isArray(v)) {
    return v
      .filter((c) => c && typeof c === 'object')
      .map((c) => {
        const o = c as Record<string, unknown>;
        return {
          start: Number(o.start ?? 0),
          dur: Number(o.dur ?? 0),
          text: String(o.text ?? ''),
        };
      })
      .filter((c) => c.text.length > 0);
  }
  if (typeof v === 'string') {
    try {
      return toCaptionArray(JSON.parse(v));
    } catch {
      return [];
    }
  }
  return [];
}

// -- Folders ---------------------------------------------------------------

export async function listFoldersWithCounts(): Promise<Folder[]> {
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      select f.id::text as id, f.title, f."createdAt" as "createdAt",
             count(t.id)::int as "docCount"
      from folders f
      left join transcripts t on t."folderId" = f.id
      where f.user_id = ${uid}
      group by f.id, f.title, f."createdAt"
      order by f."createdAt" desc`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    createdAt: new Date(r.createdAt as string).toISOString(),
    docCount: Number(r.docCount ?? 0),
  }));
}

export async function createFolder(title: string): Promise<Folder> {
  const clean = title.trim().slice(0, 120);
  if (!clean) throw new Error('Folder name cannot be empty.');
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      insert into folders (title, user_id) values (${clean}, ${uid})
      returning id::text as id, title, "createdAt" as "createdAt"`,
  );
  const r = rows[0];
  return {
    id: String(r.id),
    title: String(r.title),
    createdAt: new Date(r.createdAt as string).toISOString(),
    docCount: 0,
  };
}

export async function deleteFolder(id: string): Promise<void> {
  const uid = requireUserId();
  await authed((txn) => txn`delete from folders where id = ${id}::uuid and user_id = ${uid}`);
}

// -- Transcripts ------------------------------------------------------------

export async function listTranscripts(folderId: string): Promise<TranscriptDoc[]> {
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      select id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
             title, thumbnail, url, "rawText" as "rawText",
             "captionsJson" as "captions", "createdAt" as "createdAt"
      from transcripts
      where "folderId" = ${folderId}::uuid and user_id = ${uid}
      order by "createdAt" desc`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    folderId: String(r.folderId),
    videoId: String(r.videoId ?? ''),
    title: String(r.title ?? 'Untitled video'),
    thumbnail: String(r.thumbnail ?? ''),
    url: String(r.url ?? ''),
    rawText: String(r.rawText ?? ''),
    captions: toCaptionArray(r.captions),
    createdAt: new Date(r.createdAt as string).toISOString(),
  }));
}

export interface SaveTranscriptInput {
  folderId: string;
  videoId: string;
  title: string;
  thumbnail: string;
  url: string;
  rawText: string;
  captions: CaptionCue[];
}

export async function saveTranscript(input: SaveTranscriptInput): Promise<TranscriptDoc> {
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      insert into transcripts ("folderId", "videoId", title, thumbnail, url, "rawText", "captionsJson", user_id)
      values (${input.folderId}::uuid, ${input.videoId}, ${input.title.slice(0, 300)},
              ${input.thumbnail}, ${input.url}, ${input.rawText},
              ${JSON.stringify(input.captions)}::jsonb, ${uid})
      on conflict ("folderId", "videoId") do update set
        title = excluded.title, thumbnail = excluded.thumbnail, url = excluded.url,
        "rawText" = excluded."rawText", "captionsJson" = excluded."captionsJson"
      returning id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
        title, thumbnail, url, "rawText" as "rawText",
        "captionsJson" as "captions", "createdAt" as "createdAt"`,
  );
  const r = rows[0];
  return {
    id: String(r.id),
    folderId: String(r.folderId),
    videoId: String(r.videoId ?? ''),
    title: String(r.title ?? ''),
    thumbnail: String(r.thumbnail ?? ''),
    url: String(r.url ?? ''),
    rawText: String(r.rawText ?? ''),
    captions: toCaptionArray(r.captions),
    createdAt: new Date(r.createdAt as string).toISOString(),
  };
}

export async function deleteTranscript(id: string): Promise<void> {
  const uid = requireUserId();
  await authed((txn) => txn`delete from transcripts where id = ${id}::uuid and user_id = ${uid}`);
}

// -- Diagnostics (safe to display: hostname only, never credentials) --------

export function isDbConfigured(): boolean {
  return Boolean(import.meta.env.VITE_DATABASE_AUTHENTICATED_URL as string | undefined);
}

/** Neon host the app is pointed at, e.g. `ep-xxx-pooler.…neon.tech`. */
export function getDbHost(): string | null {
  try {
    const url = import.meta.env.VITE_DATABASE_AUTHENTICATED_URL as string | undefined;
    if (!url) return null;
    return new URL(url).hostname || 'unparseable-url';
  } catch {
    return 'unparseable-url';
  }
}
