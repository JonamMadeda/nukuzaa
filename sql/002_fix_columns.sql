-- Nukuzaa migration 002 — fix identifier case.
-- The original 001 created unquoted camelCase names, which Postgres folded to
-- lowercase (folderid, createdat, …) while the app queries quoted camelCase
-- ("folderId", "createdAt", …). Rename the live columns to the quoted form.
-- Each rename is guarded: safe to re-run, and a no-op on fresh DBs.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='folders' AND column_name='createdat')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='folders' AND column_name='createdAt') THEN
    ALTER TABLE folders RENAME COLUMN createdat TO "createdAt";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='folderid')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='folderId') THEN
    ALTER TABLE transcripts RENAME COLUMN folderid TO "folderId";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='videoid')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='videoId') THEN
    ALTER TABLE transcripts RENAME COLUMN videoid TO "videoId";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='rawtext')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='rawText') THEN
    ALTER TABLE transcripts RENAME COLUMN rawtext TO "rawText";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='captionsjson')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='captionsJson') THEN
    ALTER TABLE transcripts RENAME COLUMN captionsjson TO "captionsJson";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='createdat')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transcripts' AND column_name='createdAt') THEN
    ALTER TABLE transcripts RENAME COLUMN createdat TO "createdAt";
  END IF;
END $$;

-- Indexes (kept here so they are created after any renames, on fresh and old DBs alike).
CREATE INDEX IF NOT EXISTS idx_transcripts_folder ON transcripts("folderId");
CREATE INDEX IF NOT EXISTS idx_transcripts_video ON transcripts("videoId");
CREATE INDEX IF NOT EXISTS idx_folders_created ON folders("createdAt" DESC);
