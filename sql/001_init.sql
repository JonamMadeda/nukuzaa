-- Nukuzaa initial migration — Neon PostgreSQL
-- Run once in the Neon SQL editor (or `node scripts/migrate.mjs`).
-- NOTE: camelCase identifiers are double-quoted to preserve case.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "folderId" UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  "videoId" TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled video',
  thumbnail TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  "rawText" TEXT NOT NULL DEFAULT '',
  "captionsJson" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transcripts_folder_video UNIQUE ("folderId", "videoId")
);
