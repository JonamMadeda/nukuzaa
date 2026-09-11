// Neon migration runner for Nukuzaa.
// Reads the pooled connection string from local `.env` (never commit it),
// executes every `sql/*.sql` file in lexical order, then verifies.
// Idempotent: all statements use IF NOT EXISTS / guarded renames.
//
// Usage:  node scripts/migrate.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) throw new Error('Missing .env — copy .env.example to .env first.');
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}

// Split on semicolons, but keep DO $$ … END $$; blocks intact.
function splitStatements(sqlText) {
  const noComments = sqlText
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
  const parts = [];
  let depth = 0;
  let current = '';
  const tokens = noComments.split(/(DO\s+\$\$|\$\$|;)/gi);
  for (const tok of tokens) {
    if (/^DO\s+\$\$$/i.test(tok)) depth += 1;
    if (tok === '$$') depth = Math.max(0, depth - 1);
    if (tok === ';' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += tok;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

loadEnv();
const connectionString = process.env.VITE_DATABASE_URL;
if (!connectionString) throw new Error('VITE_DATABASE_URL is not set in .env.');

const files = readdirSync(path.join(root, 'sql'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
console.log(`Migration files: ${files.join(', ')}`);

const sql = neon(connectionString);
for (const file of files) {
  const statements = splitStatements(readFileSync(path.join(root, 'sql', file), 'utf8'));
  console.log(`\n${file}: ${statements.length} statements…`);
  for (const [i, stmt] of statements.entries()) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 90);
    try {
      await sql(stmt);
      console.log(`  [${i + 1}/${statements.length}] OK  ${preview}…`);
    } catch (e) {
      console.error(`  [${i + 1}/${statements.length}] FAIL ${preview}…`);
      throw e;
    }
  }
}

// Verify: tables + exact column names the app queries.
const cols = await sql(
  `select table_name, column_name from information_schema.columns
   where table_schema = 'public' and table_name in ('folders', 'transcripts')
   order by table_name, ordinal_position`,
);
console.log('\nLive columns:');
for (const c of cols) console.log(`  ${c.table_name}.${c.column_name}`);

const names = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
for (const need of [
  'folders.id', 'folders.title', 'folders.createdAt',
  'transcripts.id', 'transcripts.folderId', 'transcripts.videoId',
  'transcripts.title', 'transcripts.thumbnail', 'transcripts.url',
  'transcripts.rawText', 'transcripts.captionsJson', 'transcripts.createdAt',
]) {
  if (!names.has(need)) throw new Error(`Verification failed: missing column ${need}`);
}

// Verify the app's exact failing query now runs.
await sql`select f.id::text as id, f.title, f."createdAt" as "createdAt", count(t.id)::int as "docCount" from folders f left join transcripts t on t."folderId" = f.id group by f.id, f.title, f."createdAt" order by f."createdAt" desc`;
console.log('\nApp dashboard query: OK');
console.log('\nMigration complete ✅');
