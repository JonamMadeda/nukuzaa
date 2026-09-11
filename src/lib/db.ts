import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CaptionCue, Folder, TranscriptDoc } from './types';

// ---------------------------------------------------------------------------
// Neon connection client (HTTP pooling — safe to call from a Tauri WebView).
//
// Reads VITE_DATABASE_URL at runtime. All queries go through one lazy client
// so misconfiguration surfaces once as a clear error instead of per-query.
// ---------------------------------------------------------------------------

let sqlClient: NeonQueryFunction<false, false> | null = null;

function connectionString(): string {
  const url = import.meta.env.VITE_DATABASE_URL as string | undefined;
  if (!url) {
    throw new Error(
      'VITE_DATABASE_URL is missing. Copy .env.example to .env and paste your Neon pooled connection string.',
    );
  }
  return url;
}

export function getSql(): NeonQueryFunction<false, false> {
  if (!sqlClient) sqlClient = neon(connectionString());
  return sqlClient;
}

/** Lightweight connectivity probe used for the header status pill. */
export async function checkConnection(): Promise<void> {
  const sql = getSql();
  await sql`select 1 as ok`;
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
  const sql = getSql();
  const rows = await sql`
    select f.id::text as id, f.title, f."createdAt" as "createdAt",
           count(t.id)::int as "docCount"
    from folders f
    left join transcripts t on t."folderId" = f.id
    group by f.id, f.title, f."createdAt"
    order by f."createdAt" desc`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    createdAt: new Date(r.createdAt as string).toISOString(),
    docCount: Number(r.docCount ?? 0),
  }));
}

export async function createFolder(title: string): Promise<Folder> {
  const clean = title.trim().slice(0, 120);
  if (!clean) throw new Error('Folder name cannot be empty.');
  const sql = getSql();
  const rows = await sql`
    insert into folders (title) values (${clean})
    returning id::text as id, title, "createdAt" as "createdAt"`;
  const r = (rows as Array<Record<string, unknown>>)[0];
  return {
    id: String(r.id),
    title: String(r.title),
    createdAt: new Date(r.createdAt as string).toISOString(),
    docCount: 0,
  };
}

export async function deleteFolder(id: string): Promise<void> {
  const sql = getSql();
  await sql`delete from folders where id = ${id}::uuid`;
}

// -- Transcripts ------------------------------------------------------------

export async function listTranscripts(folderId: string): Promise<TranscriptDoc[]> {
  const sql = getSql();
  const rows = await sql`
    select id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
           title, thumbnail, url, "rawText" as "rawText",
           "captionsJson" as "captions", "createdAt" as "createdAt"
    from transcripts where "folderId" = ${folderId}::uuid
    order by "createdAt" desc`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
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
  const sql = getSql();
  const rows = await sql`
    insert into transcripts ("folderId", "videoId", title, thumbnail, url, "rawText", "captionsJson")
    values (${input.folderId}::uuid, ${input.videoId}, ${input.title.slice(0, 300)},
            ${input.thumbnail}, ${input.url}, ${input.rawText},
            ${JSON.stringify(input.captions)}::jsonb)
    on conflict ("folderId", "videoId") do update set
      title = excluded.title, thumbnail = excluded.thumbnail, url = excluded.url,
      "rawText" = excluded."rawText", "captionsJson" = excluded."captionsJson"
    returning id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
      title, thumbnail, url, "rawText" as "rawText",
      "captionsJson" as "captions", "createdAt" as "createdAt"`;
  const r = (rows as Array<Record<string, unknown>>)[0];
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
  const sql = getSql();
  await sql`delete from transcripts where id = ${id}::uuid`;
}

// -- Diagnostics (safe to display: hostname only, never credentials) --------

export function isDbConfigured(): boolean {
  return Boolean(import.meta.env.VITE_DATABASE_URL as string | undefined);
}

/** Neon host the app is pointed at, e.g. `ep-xxx-pooler.…neon.tech`. */
export function getDbHost(): string | null {
  try {
    const url = import.meta.env.VITE_DATABASE_URL as string | undefined;
    if (!url) return null;
    return new URL(url).hostname || 'unparseable-url';
  } catch {
    return 'unparseable-url';
  }
}
