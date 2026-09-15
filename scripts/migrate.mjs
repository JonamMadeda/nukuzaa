// Neon migration runner for Nukuzaa.
// Reads the pooled connection string from local `.env` (never commit it),
// executes every `sql/*.sql` file in lexical order, then verifies.
// Idempotent: all statements use IF NOT EXISTS / guarded renames.
//
// Usage:  node scripts/migrate.mjs
import { readFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
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

// --- Per-user isolation credentials (sql/003_user_isolation.sql) -------------
// The shipped app connects as least-privilege `nukuzaa_app` (NOBYPASSRLS) so
// RLS is enforced; the owner URL above stays local for migrations only.
// The app password is generated once, stored in .env, and never rotated by
// re-runs (003 guards role creation with IF NOT EXISTS on pg_roles).
function ensureEnvLine(key, value) {
  const envPath = path.join(root, '.env');
  const content = readFileSync(envPath, 'utf8');
  const hasKey = content.split('\n').some((l) => l.match(new RegExp(`^\\s*${key}\\s*=`)));
  if (!hasKey) {
    const nl = content.endsWith('\n') || content.length === 0 ? '' : '\n';
    appendFileSync(envPath, `${nl}${key}=${value}\n`);
    console.log(`Added ${key} to .env`);
  }
  process.env[key] ??= value;
  // If the file already had the key, prefer the file value for this run.
  const m = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'm'));
  if (m) process.env[key] = m[1].replace(/^["']|["']$/g, '');
  return process.env[key];
}

const appPassword =
  process.env.APP_DB_PASSWORD ?? randomBytes(24).toString('base64url');
ensureEnvLine('APP_DB_PASSWORD', appPassword);

function deriveAuthenticatedUrl(ownerUrl, password) {
  const u = new URL(ownerUrl);
  u.username = 'nukuzaa_app';
  u.password = password;
  return u.toString();
}
ensureEnvLine(
  'VITE_DATABASE_AUTHENTICATED_URL',
  deriveAuthenticatedUrl(connectionString, process.env.APP_DB_PASSWORD),
);

const files = readdirSync(path.join(root, 'sql'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
console.log(`Migration files: ${files.join(', ')}`);

const sql = neon(connectionString);
for (const file of files) {
  const raw = readFileSync(path.join(root, 'sql', file), 'utf8').split('{{APP_DB_PASSWORD}}').join(process.env.APP_DB_PASSWORD);
  const statements = splitStatements(raw);
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
  'folders.id', 'folders.title', 'folders.createdAt', 'folders.user_id',
  'transcripts.id', 'transcripts.folderId', 'transcripts.videoId',
  'transcripts.title', 'transcripts.thumbnail', 'transcripts.url',
  'transcripts.rawText', 'transcripts.captionsJson', 'transcripts.createdAt',
  'transcripts.user_id',
]) {
  if (!names.has(need)) throw new Error(`Verification failed: missing column ${need}`);
}

// Verify per-user isolation objects (sql/003).
const rls = await sql(
  `select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('folders', 'transcripts')`,
);
for (const t of rls) {
  if (!t.rowsecurity) throw new Error(`Verification failed: RLS not enabled on ${t.tablename}`);
  console.log(`  RLS enabled on ${t.tablename}`);
}
const policies = await sql(
  `select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('folders', 'transcripts') order by 1, 2`,
);
console.log('Live policies:');
for (const p of policies) console.log(`  ${p.tablename}.${p.policyname}`);
for (const need of ['folders.folders_owner_isolation', 'transcripts.transcripts_owner_isolation']) {
  if (!policies.some((p) => `${p.tablename}.${p.policyname}` === need)) {
    throw new Error(`Verification failed: missing policy ${need}`);
  }
}
const roles = await sql(
  `select rolname, rolcanlogin, rolbypassrls from pg_roles where rolname = 'nukuzaa_app'`,
);
if (roles.length !== 1 || !roles[0].rolcanlogin || roles[0].rolbypassrls) {
  throw new Error('Verification failed: nukuzaa_app role missing, non-login, or BYPASSRLS');
}
console.log('  role nukuzaa_app: login, NOBYPASSRLS');
const fns = await sql(
  `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'current_user_id'`,
);
if (fns[0].n !== 1) throw new Error('Verification failed: app.current_user_id() missing');
console.log('  function app.current_user_id(): present');

// Verify the app's exact failing query now runs.
await sql`select f.id::text as id, f.title, f."createdAt" as "createdAt", count(t.id)::int as "docCount" from folders f left join transcripts t on t."folderId" = f.id group by f.id, f.title, f."createdAt" order by f."createdAt" desc`;
console.log('\nApp dashboard query: OK');
console.log('\nMigration complete ✅');
