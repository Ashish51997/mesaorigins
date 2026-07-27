#!/usr/bin/env node
/**
 * Inventory of the three data planes: static mockData exports, the legacy
 * data.json blob, and the Postgres models. Flags exports nothing imports and
 * blob keys with no matching Prisma model.
 *
 * Usage: node .cursor/skills/static-data-migration/scripts/audit-static-data.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SCAN_DIRS = ['src', 'server'];
const SKIP = new Set(['node_modules', 'dist', '.git', 'migrations']);
const CODE = /\.(ts|tsx|mjs)$/;

function read(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (CODE.test(name)) out.push(path);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const sources = files.map((path) => ({ rel: relative(ROOT, path), text: readFileSync(path, 'utf8') }));

// --- 1. Legacy blob -------------------------------------------------------
const blobRaw = read('data.json');
const blob = blobRaw ? JSON.parse(blobRaw) : null;

// --- 2. Prisma models -----------------------------------------------------
const schema = read('server/prisma/schema.prisma') ?? '';
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
const seed = read('server/prisma/seed.ts') ?? '';

// --- 3. mockData exports + importers -------------------------------------
const mock = read('src/mockData.ts') ?? '';
const exports_ = [...mock.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);

const importersOf = (name) =>
  sources
    .filter(({ rel, text }) => rel !== 'src/mockData.ts' && new RegExp(`\\b${name}\\b`).test(text))
    .map(({ rel }) => rel);

// Export names don't always match the model they map to.
const ALIASES = { initialCustomerComplaints: 'Complaint' };

function singular(s) {
  const w = s.toLowerCase().replace(/[^a-z]/g, '');
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

const modelFor = (name) =>
  ALIASES[name] ?? models.find((m) => singular(m) === singular(name.replace(/^initial/, ''))) ?? null;

const pad = (s, n) => String(s).padEnd(n);
const head = (title) => console.log(`\n${title}\n${'─'.repeat(title.length)}`);

console.log('Static data audit — Mass Polimer ERP');

head('data.json (legacy blob)');
if (!blob) console.log('  data.json not found — blob plane may already be retired.');
else {
  for (const [key, value] of Object.entries(blob)) {
    const rows = Array.isArray(value) ? value.length : '(not an array)';
    const note = Array.isArray(value) && value.length === 0 ? 'empty — safe to drop' : '';
    console.log(`  ${pad(key, 22)} ${pad(rows, 6)} ${note}`);
  }
}

head(`src/mockData.ts (${exports_.length} exports)`);
const orphans = [];
for (const name of exports_) {
  const importers = importersOf(name);
  const model = modelFor(name);
  const flags = [model ? `model ${model}` : 'NO PRISMA MODEL'];
  if (importers.length === 0) { flags.push('no importers'); orphans.push(name); }
  if (!new RegExp(`\\b${name}\\b`).test(seed)) flags.push('not seeded');
  console.log(`  ${pad(name, 30)} ${pad(`${importers.length} importer(s)`, 16)} ${flags.join(' · ')}`);
  for (const imp of importers) console.log(`      ${imp}`);
}

head(`Prisma models (${models.length})`);
console.log('  ' + models.join(', '));

head('Client localStorage keys');
for (const { rel, text } of sources) {
  const keys = [...text.matchAll(/['"`](mp_[a-z_]+|erp_session|theme)['"`]/g)].map((m) => m[1]);
  if (keys.length) console.log(`  ${pad(rel, 26)} ${[...new Set(keys)].join(', ')}`);
}

head('Next steps');
if (orphans.length) console.log(`  Unused exports (delete or wire up): ${orphans.join(', ')}`);
console.log('  Read STATIC_AND_UNLINKED_DATA.md for relationship-level problems.');
console.log('  Follow .cursor/skills/static-data-migration/SKILL.md for the migration workflow.');
