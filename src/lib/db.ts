import { neon, type NeonQueryFunction, type NeonQueryFunctionInTransaction, type NeonQueryInTransaction } from '@neondatabase/serverless';
import type { CaptionCue, DocSort, Folder, FolderSort, StorageStats, TranscriptDoc } from './types';
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

function toFolder(r: Record<string, unknown>): Folder {
  const accentRaw = String(r.accent ?? 'amber');
  const accent = (['amber', 'stone', 'sky', 'emerald', 'rose', 'violet'] as const).includes(
    accentRaw as Folder['accent'],
  )
    ? (accentRaw as Folder['accent'])
    : 'amber';
  return {
    id: String(r.id),
    title: String(r.title),
    createdAt: new Date(r.createdAt as string).toISOString(),
    docCount: Number(r.docCount ?? 0),
    pinned: Boolean(r.pinned),
    archived: Boolean(r.archived),
    accent,
    recentCount: Number(r.recentCount ?? 0),
  };
}

export async function listFoldersWithCounts(
  sort: FolderSort = 'recent',
  includeArchived = false,
): Promise<Folder[]> {
  const uid = requireUserId();
  // Static ORDER BY per sort key (identifiers can't be parameterized).
  // Pinned folders always lead; archived are post-filtered (small lists).
  let rows: Record<string, unknown>[];
  if (sort === 'title') {
    rows = await authed<Record<string, unknown>>(
      (txn) => txn`
        select f.id::text as id, f.title, f."createdAt" as "createdAt",
                count(t.id)::int as "docCount",
                f.pinned, f.archived, f.accent,
                (select count(*)::int from transcripts t2
                 where t2."folderId" = f.id and t2.user_id = ${uid}
                   and t2."createdAt" > now() - interval '7 days') as "recentCount"
        from folders f
        left join transcripts t on t."folderId" = f.id
        where f.user_id = ${uid}
        group by f.id, f.title, f."createdAt", f.pinned, f.archived, f.accent
        order by f.pinned desc, f.title asc`,
    );
  } else if (sort === 'docs') {
    rows = await authed<Record<string, unknown>>(
      (txn) => txn`
        select f.id::text as id, f.title, f."createdAt" as "createdAt",
                count(t.id)::int as "docCount",
                f.pinned, f.archived, f.accent,
                (select count(*)::int from transcripts t2
                 where t2."folderId" = f.id and t2.user_id = ${uid}
                   and t2."createdAt" > now() - interval '7 days') as "recentCount"
        from folders f
        left join transcripts t on t."folderId" = f.id
        where f.user_id = ${uid}
        group by f.id, f.title, f."createdAt", f.pinned, f.archived, f.accent
        order by f.pinned desc, count(t.id) desc, f."createdAt" desc`,
    );
  } else {
    rows = await authed<Record<string, unknown>>(
      (txn) => txn`
        select f.id::text as id, f.title, f."createdAt" as "createdAt",
                count(t.id)::int as "docCount",
                f.pinned, f.archived, f.accent,
                (select count(*)::int from transcripts t2
                 where t2."folderId" = f.id and t2.user_id = ${uid}
                   and t2."createdAt" > now() - interval '7 days') as "recentCount"
        from folders f
        left join transcripts t on t."folderId" = f.id
        where f.user_id = ${uid}
        group by f.id, f.title, f."createdAt", f.pinned, f.archived, f.accent
        order by f.pinned desc, f."createdAt" desc`,
    );
  }
  const all = rows.map(toFolder);
  return includeArchived ? all : all.filter((f) => !f.archived);
}

export async function createFolder(title: string, accent: Folder['accent'] = 'amber'): Promise<Folder> {
  const clean = title.trim().slice(0, 120);
  if (!clean) throw new Error('Folder name cannot be empty.');
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      insert into folders (title, user_id, accent) values (${clean}, ${uid}, ${accent})
      returning id::text as id, title, "createdAt" as "createdAt", pinned, archived, accent`,
  );
  const r = rows[0];
  return {
    id: String(r.id),
    title: String(r.title),
    createdAt: new Date(r.createdAt as string).toISOString(),
    docCount: 0,
    pinned: Boolean(r.pinned),
    archived: Boolean(r.archived),
    accent: String(r.accent ?? 'amber') as Folder['accent'],
    recentCount: 0,
  };
}

export async function updateFolder(
  id: string,
  patch: { title?: string; accent?: Folder['accent'] },
): Promise<void> {
  const uid = requireUserId();
  if (patch.title !== undefined) {
    const clean = patch.title.trim().slice(0, 120);
    if (!clean) throw new Error('Folder name cannot be empty.');
    await authed(
      (txn) => txn`update folders set title = ${clean} where id = ${id}::uuid and user_id = ${uid}`,
    );
  }
  if (patch.accent !== undefined) {
    await authed(
      (txn) => txn`update folders set accent = ${patch.accent} where id = ${id}::uuid and user_id = ${uid}`,
    );
  }
}

export async function setFolderPinned(id: string, pinned: boolean): Promise<void> {
  const uid = requireUserId();
  await authed((txn) => txn`update folders set pinned = ${pinned} where id = ${id}::uuid and user_id = ${uid}`);
}

export async function setFolderArchived(id: string, archived: boolean): Promise<void> {
  const uid = requireUserId();
  await authed((txn) => txn`update folders set archived = ${archived} where id = ${id}::uuid and user_id = ${uid}`);
}

/** Starred documents across all folders (for the homepage shelf). */
export async function listFavoriteDocs(limit = 8): Promise<TranscriptDoc[]> {
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      select t.id::text as id, t."folderId"::text as "folderId", t."videoId" as "videoId",
             t.title, t.thumbnail, t.url, t."rawText" as "rawText",
             t."captionsJson" as "captions", t."createdAt" as "createdAt",
             t.notes, t.tags, t.favorite,
             t.edited_text as "editedText", t.highlights,
             t.track_lang as "trackLang", t.track_kind as "trackKind",
             f.title as "folderTitle"
      from transcripts t join folders f on f.id = t."folderId"
      where t.user_id = ${uid} and t.favorite and not f.archived
      order by t."createdAt" desc
      limit ${limit}`,
  );
  return rows.map(toDoc);
}

export async function deleteFolder(id: string): Promise<void> {
  const uid = requireUserId();
  await authed((txn) => txn`delete from folders where id = ${id}::uuid and user_id = ${uid}`);
}

// -- Transcripts ------------------------------------------------------------

function toHighlights(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((n) => Number(n)).filter((n) => Number.isFinite(n));
}

function toTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((t) => String(t).toLowerCase().trim()).filter((t) => t.length > 0);
}

function toDoc(r: Record<string, unknown>): TranscriptDoc {
  return {
    id: String(r.id),
    folderId: String(r.folderId),
    videoId: String(r.videoId ?? ''),
    title: String(r.title ?? 'Untitled video'),
    thumbnail: String(r.thumbnail ?? ''),
    url: String(r.url ?? ''),
    rawText: String(r.rawText ?? ''),
    captions: toCaptionArray(r.captions),
    createdAt: new Date(r.createdAt as string).toISOString(),
    notes: String(r.notes ?? ''),
    tags: toTags(r.tags),
    favorite: Boolean(r.favorite),
    editedText: r.editedText == null ? null : String(r.editedText),
    highlights: toHighlights(r.highlights),
    trackLang: r.trackLang == null ? null : String(r.trackLang),
    trackKind: r.trackKind == null ? null : String(r.trackKind),
    folderTitle: r.folderTitle == null ? undefined : String(r.folderTitle),
  };
}

export async function listTranscripts(
  folderId: string,
  sort: DocSort = 'newest',
  favOnly = false,
): Promise<TranscriptDoc[]> {
  const uid = requireUserId();
  // Static ORDER BY per sort key (identifiers can't be parameterized).
  // The favorites-first default keeps starred docs on top; favOnly is a
  // post-filter so the SQL stays fully static.
  let rows: Record<string, unknown>[];
  if (sort === 'oldest') {
    rows = await authed<Record<string, unknown>>(
      (txn) => txn`
      select id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
             title, thumbnail, url, "rawText" as "rawText",
             "captionsJson" as "captions", "createdAt" as "createdAt",
             notes, tags, favorite,
             edited_text as "editedText", highlights,
             track_lang as "trackLang", track_kind as "trackKind"
      from transcripts
      where "folderId" = ${folderId}::uuid and user_id = ${uid}
      order by "createdAt" asc`,
    );
  } else if (sort === 'title') {
    rows = await authed<Record<string, unknown>>(
      (txn) => txn`
      select id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
             title, thumbnail, url, "rawText" as "rawText",
             "captionsJson" as "captions", "createdAt" as "createdAt",
             notes, tags, favorite,
             edited_text as "editedText", highlights,
             track_lang as "trackLang", track_kind as "trackKind"
      from transcripts
      where "folderId" = ${folderId}::uuid and user_id = ${uid}
      order by title asc`,
    );
  } else {
    rows = await authed<Record<string, unknown>>(
      (txn) => txn`
      select id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
             title, thumbnail, url, "rawText" as "rawText",
             "captionsJson" as "captions", "createdAt" as "createdAt",
             notes, tags, favorite,
             edited_text as "editedText", highlights,
             track_lang as "trackLang", track_kind as "trackKind"
      from transcripts
      where "folderId" = ${folderId}::uuid and user_id = ${uid}
      order by favorite desc, "createdAt" desc`,
    );
  }
  const docs = rows.map(toDoc);
  return favOnly ? docs.filter((d) => d.favorite) : docs;
}

export interface SaveTranscriptInput {
  folderId: string;
  videoId: string;
  title: string;
  thumbnail: string;
  url: string;
  rawText: string;
  captions: CaptionCue[];
  trackLang?: string | null;
  trackKind?: string | null;
}

export async function saveTranscript(input: SaveTranscriptInput): Promise<TranscriptDoc> {
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      insert into transcripts ("folderId", "videoId", title, thumbnail, url, "rawText", "captionsJson", user_id, track_lang, track_kind)
      values (${input.folderId}::uuid, ${input.videoId}, ${input.title.slice(0, 300)},
              ${input.thumbnail}, ${input.url}, ${input.rawText},
              ${JSON.stringify(input.captions)}::jsonb, ${uid},
              ${input.trackLang ?? null}, ${input.trackKind ?? null})
      on conflict ("folderId", "videoId") do update set
        title = excluded.title, thumbnail = excluded.thumbnail, url = excluded.url,
        "rawText" = excluded."rawText", "captionsJson" = excluded."captionsJson",
        track_lang = excluded.track_lang, track_kind = excluded.track_kind
      returning id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
        title, thumbnail, url, "rawText" as "rawText",
        "captionsJson" as "captions", "createdAt" as "createdAt",
        notes, tags, favorite,
        edited_text as "editedText", highlights,
        track_lang as "trackLang", track_kind as "trackKind"`,
  );
  return toDoc(rows[0]);
}

export interface UpdateTranscriptPatch {
  title?: string;
  notes?: string;
  tags?: string[];
  favorite?: boolean;
  /** null clears back to the extracted text. */
  editedText?: string | null;
  highlights?: number[];
}

/** Persist user edits/annotations. Always writes the full editable set. */
export async function updateTranscriptMeta(
  id: string,
  current: TranscriptDoc,
  patch: UpdateTranscriptPatch,
): Promise<TranscriptDoc> {
  const uid = requireUserId();
  const title = (patch.title ?? current.title).slice(0, 300);
  const notes = patch.notes ?? current.notes;
  const tags = (patch.tags ?? current.tags)
    .map((t) => t.toLowerCase().trim().replace(/,/g, ''))
    .filter(Boolean)
    .slice(0, 20);
  // Explicit array literal (avoids driver-dependent array encoding).
  const tagsLiteral = `{${tags.map((t) => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
  const favorite = patch.favorite ?? current.favorite;
  const editedText = patch.editedText !== undefined ? patch.editedText : current.editedText;
  const highlights = patch.highlights ?? current.highlights;
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      update transcripts set
        title = ${title}, notes = ${notes}, tags = ${tagsLiteral}::text[],
        favorite = ${favorite}, edited_text = ${editedText},
        highlights = ${JSON.stringify(highlights)}::jsonb
      where id = ${id}::uuid and user_id = ${uid}
      returning id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
        title, thumbnail, url, "rawText" as "rawText",
        "captionsJson" as "captions", "createdAt" as "createdAt",
        notes, tags, favorite,
        edited_text as "editedText", highlights,
        track_lang as "trackLang", track_kind as "trackKind"`,
  );
  if (rows.length === 0) throw new Error('Document not found.');
  return toDoc(rows[0]);
}

/** Replace extracted content (track switch). Clears any manual text edit. */
export async function replaceTranscriptContent(
  id: string,
  content: { rawText: string; captions: CaptionCue[]; trackLang: string | null; trackKind: string | null },
): Promise<TranscriptDoc> {
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      update transcripts set
        "rawText" = ${content.rawText},
        "captionsJson" = ${JSON.stringify(content.captions)}::jsonb,
        track_lang = ${content.trackLang}, track_kind = ${content.trackKind},
        edited_text = null
      where id = ${id}::uuid and user_id = ${uid}
      returning id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
        title, thumbnail, url, "rawText" as "rawText",
        "captionsJson" as "captions", "createdAt" as "createdAt",
        notes, tags, favorite,
        edited_text as "editedText", highlights,
        track_lang as "trackLang", track_kind as "trackKind"`,
  );
  if (rows.length === 0) throw new Error('Document not found.');
  return toDoc(rows[0]);
}

/** Move a document to another folder (same account). */
export async function moveTranscript(
  id: string,
  toFolderId: string,
  replace = false,
): Promise<{ status: 'moved'; doc: TranscriptDoc } | { status: 'conflict'; existing: TranscriptDoc }> {
  const uid = requireUserId();
  const dest = await authed<Record<string, unknown>>(
    (txn) => txn`select id from folders where id = ${toFolderId}::uuid and user_id = ${uid}`,
  );
  if (dest.length === 0) throw new Error('Destination folder not found.');
  const src = await authed<Record<string, unknown>>(
    (txn) => txn`
      select id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
             title, thumbnail, url, "rawText" as "rawText",
             "captionsJson" as "captions", "createdAt" as "createdAt",
             notes, tags, favorite,
             edited_text as "editedText", highlights,
             track_lang as "trackLang", track_kind as "trackKind"
      from transcripts where id = ${id}::uuid and user_id = ${uid}`,
  );
  if (src.length === 0) throw new Error('Document not found.');
  if (String(src[0].folderId) === toFolderId) return { status: 'moved', doc: toDoc(src[0]) };
  const videoId = String(src[0].videoId ?? '');
  const existing = await authed<Record<string, unknown>>(
    (txn) => txn`
      select id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
             title, thumbnail, url, "rawText" as "rawText",
             "captionsJson" as "captions", "createdAt" as "createdAt",
             notes, tags, favorite,
             edited_text as "editedText", highlights,
             track_lang as "trackLang", track_kind as "trackKind"
      from transcripts
      where "folderId" = ${toFolderId}::uuid and "videoId" = ${videoId} and user_id = ${uid}`,
  );
  if (existing.length > 0 && !replace) {
    return { status: 'conflict', existing: toDoc(existing[0]) };
  }
  if (existing.length > 0) {
    await authed((txn) => txn`delete from transcripts where id = ${String(existing[0].id)}::uuid and user_id = ${uid}`);
  }
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      update transcripts set "folderId" = ${toFolderId}::uuid
      where id = ${id}::uuid and user_id = ${uid}
      returning id::text as id, "folderId"::text as "folderId", "videoId" as "videoId",
        title, thumbnail, url, "rawText" as "rawText",
        "captionsJson" as "captions", "createdAt" as "createdAt",
        notes, tags, favorite,
        edited_text as "editedText", highlights,
        track_lang as "trackLang", track_kind as "trackKind"`,
  );
  if (rows.length === 0) throw new Error('Document not found.');
  return { status: 'moved', doc: toDoc(rows[0]) };
}

export interface DuplicateHit {
  docId: string;
  folderId: string;
  folderTitle: string;
}

/** Everywhere this video already lives (for the duplicate prompt). */
export async function findDuplicateVideo(videoId: string): Promise<DuplicateHit[]> {
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      select t.id::text as id, t."folderId"::text as "folderId", f.title as "folderTitle"
      from transcripts t join folders f on f.id = t."folderId"
      where t.user_id = ${uid} and t."videoId" = ${videoId}
      order by t."createdAt" desc`,
  );
  return rows.map((r) => ({
    docId: String(r.id),
    folderId: String(r.folderId),
    folderTitle: String(r.folderTitle ?? '(deleted folder)'),
  }));
}

function likePattern(q: string): string {
  return `%${q.replace(/([%_\\])/g, '\\$1')}%`;
}

/** Global search over titles, bodies, and tags (scoped to the user). */
export async function searchTranscripts(query: string, limit = 30): Promise<TranscriptDoc[]> {
  const uid = requireUserId();
  const q = query.trim().slice(0, 120);
  if (!q) return [];
  const like = likePattern(q);
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      select t.id::text as id, t."folderId"::text as "folderId", t."videoId" as "videoId",
             t.title, t.thumbnail, t.url, t."rawText" as "rawText",
             t."captionsJson" as "captions", t."createdAt" as "createdAt",
             t.notes, t.tags, t.favorite,
             t.edited_text as "editedText", t.highlights,
             t.track_lang as "trackLang", t.track_kind as "trackKind",
             f.title as "folderTitle"
      from transcripts t join folders f on f.id = t."folderId"
      where t.user_id = ${uid}
        and (t.title ilike ${like} escape '\\'
             or t."rawText" ilike ${like} escape '\\'
             or exists (select 1 from unnest(t.tags) tag where tag ilike ${like} escape '\\'))
      order by t."createdAt" desc
      limit ${limit}`,
  );
  return rows.map(toDoc);
}

/** Quota inputs for the account page: counts + stored bytes. */
export async function getStorageStats(): Promise<StorageStats> {
  const uid = requireUserId();
  const rows = await authed<Record<string, unknown>>(
    (txn) => txn`
      select (select count(*)::int from folders where user_id = ${uid}) as folders,
             (select count(*)::int from transcripts where user_id = ${uid}) as docs,
             (select coalesce(sum(
                octet_length(t."rawText")
                + octet_length(t."captionsJson"::text)
                + octet_length(coalesce(t.notes, ''))
                + octet_length(coalesce(t.edited_text, ''))
              ), 0)::bigint as bytes
              from transcripts t where t.user_id = ${uid})`,
  );
  const r = rows[0] ?? {};
  return {
    folders: Number(r.folders ?? 0),
    docs: Number(r.docs ?? 0),
    bytes: Number(r.bytes ?? 0),
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
