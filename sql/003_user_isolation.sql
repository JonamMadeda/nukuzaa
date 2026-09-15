-- Nukuzaa 003 — per-user isolation via Neon Auth (Better Auth) JWT + RLS.
--
-- What changes:
--   * folders / transcripts gain a non-nullable `user_id` TEXT owner column.
--   * A least-privilege `nukuzaa_app` LOGIN role (NOBYPASSRLS) is created for
--     the shipped app; the owner credential stays local for migrations only.
--   * `app.current_user_id()` reads the `sub` claim the app injects per
--     transaction via `set_config('request.jwt.claims', <verified JWT>, true)`.
--   * RLS policies restrict the app role to rows it owns. The owner bypasses
--     RLS (normal Postgres semantics) — admin tooling only.
--
-- Approved wipe (ONE-TIME, executed 2026-09-15): the DELETE statements that
-- removed pre-auth shared rows were retired after first apply, so re-running
-- this file (e.g. alongside future migrations) never touches user data.
-- All remaining statements are idempotent no-ops on re-run.
--
-- IMPORTANT: run via `node scripts/migrate.mjs`, NOT the raw SQL editor —
-- the runner substitutes {{APP_DB_PASSWORD}} and wires .env automatically.

-- 1. Least-privilege app role. Guarded: re-runs never rotate the password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nukuzaa_app') THEN
    CREATE ROLE nukuzaa_app WITH LOGIN PASSWORD '{{APP_DB_PASSWORD}}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- 2. Owner columns (tables are empty after step 0, so NOT NULL is safe).
ALTER TABLE folders ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE folders ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transcripts ALTER COLUMN user_id SET NOT NULL;

-- 3. Helper: current user id from per-transaction JWT claims.
-- Own `app` schema (not `auth`) so a future Neon Data API / auth enablement
-- can install its own objects without colliding with ours.
-- Defensive CASE: pooled connections may surface an empty-string setting
-- instead of NULL when no JWT was injected — both mean "unauthenticated".
CREATE SCHEMA IF NOT EXISTS app;
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS TEXT
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN current_setting('request.jwt.claims', true) IS NULL THEN NULL
    WHEN current_setting('request.jwt.claims', true) = '' THEN NULL
    ELSE nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
  END
$$;

-- 4. Defaults (apply when the app sets JWT claims) + indexes.
ALTER TABLE folders ALTER COLUMN user_id SET DEFAULT (app.current_user_id());
ALTER TABLE transcripts ALTER COLUMN user_id SET DEFAULT (app.current_user_id());
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_user ON transcripts(user_id);

-- 5. Least-privilege grants.
GRANT USAGE ON SCHEMA public TO nukuzaa_app;
GRANT USAGE ON SCHEMA app TO nukuzaa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON folders TO nukuzaa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON transcripts TO nukuzaa_app;

-- 6. Row-Level Security: the app role sees/touches only its own rows.
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS folders_owner_isolation ON folders;
CREATE POLICY folders_owner_isolation ON folders FOR ALL TO nukuzaa_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
DROP POLICY IF EXISTS transcripts_owner_isolation ON transcripts;
CREATE POLICY transcripts_owner_isolation ON transcripts FOR ALL TO nukuzaa_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
