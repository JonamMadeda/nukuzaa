-- Nukuzaa 004 — feature pack: notes, tags, favorites, edited text,
-- cue highlights, caption track metadata + global search indexes.
--
-- All statements idempotent; safe to re-run via `node scripts/migrate.mjs`.

-- 1. Per-document user data columns.
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS edited_text TEXT;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS highlights JSONB NOT NULL DEFAULT '[]';
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS track_lang TEXT;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS track_kind TEXT;

-- 2. Normalize pre-existing tags to lowercase (no-op when empty).
UPDATE transcripts SET tags = (
  SELECT coalesce(array_agg(lower(t)), '{}')
  FROM unnest(tags) AS t
) WHERE tags IS NOT NULL AND array_length(tags, 1) IS NOT NULL;

-- 3. Global search + filter indexes (RLS policies still scope every query).
CREATE INDEX IF NOT EXISTS idx_transcripts_user_video ON transcripts(user_id, "videoId");
CREATE INDEX IF NOT EXISTS idx_transcripts_favorite ON transcripts(user_id, favorite) WHERE favorite;
CREATE INDEX IF NOT EXISTS idx_transcripts_tags ON transcripts USING GIN (tags);

-- 4. Trigram index for substring search over titles + transcript bodies.
-- pg_trgm ships with Neon; both blocks tolerate its absence, in which case
-- search falls back to plain LIKE (see global search in lib/db.ts).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable — global search uses LIKE fallback';
END
$$;
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_transcripts_title_trgm ON transcripts USING GIN (title gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trigram index skipped — global search uses LIKE fallback';
END
$$;
