-- Nukuzaa 005 — homepage pack: pinned + archived folders, accent colors.
--
-- All statements idempotent; safe to re-run via `node scripts/migrate.mjs`.

ALTER TABLE folders ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS accent TEXT NOT NULL DEFAULT 'amber';

-- Clamp any unexpected accent values back to the known palette.
UPDATE folders SET accent = 'amber'
WHERE accent NOT IN ('amber', 'stone', 'sky', 'emerald', 'rose', 'violet');

CREATE INDEX IF NOT EXISTS idx_folders_user_archived ON folders(user_id, archived);
