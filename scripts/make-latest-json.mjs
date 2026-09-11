// Build the updater's latest.json for a manual (non-CI) release.
// Usage: node scripts/make-latest-json.mjs 0.1.0
// Reads the .sig produced by `tauri build` and points at the GitHub release URL.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) throw new Error('usage: node scripts/make-latest-json.mjs <version>');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tag = `v${version}`;
const setupName = `Nukuzaa_${version}_x64-setup.exe`;
const sig = readFileSync(path.join(root, 'src-tauri/target/release/bundle/nsis', `${setupName}.sig`), 'utf8').trim();

const latest = {
  version,
  notes: `Nukuzaa ${tag} — YouTube transcripts organized into folder collections.`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: sig,
      url: `https://github.com/JonamMadeda/nukuzaa/releases/download/${tag}/${setupName}`,
    },
  },
};

const out = path.join(root, 'src-tauri/target/release/bundle/latest.json');
writeFileSync(out, JSON.stringify(latest, null, 2) + '\n');
console.log(`wrote ${out}`);
