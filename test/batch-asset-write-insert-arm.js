'use strict';
/*
 * Batch asset writes never committed. Not once, for anyone, since the slots
 * shipped: `deliverable_events where action = 'batch_asset_change'` was 0 on
 * 2026-08-31 while due_change and status_change landed normally in the same
 * window. Three people reported it within two hours -- two Frame folders and a
 * raw footage folder -- all seeing a generic "try again".
 *
 * CAUSE. production_batch_asset_write handed batch_write a row of exactly two
 * keys, {id, <asset column>}. batch_write is an INSERT ... ON CONFLICT (id) DO
 * UPDATE, and PostgreSQL evaluates NOT NULL on the proposed INSERT tuple
 * BEFORE resolving the conflict -- so every call died with
 *
 *   23502: null value in column "client_slug" violates not-null constraint
 *
 * and never reached the update arm the design was reasoned around. The comment
 * that shipped with the bug was right that the per-key `v_row ? '<col>'`
 * guards stop the UPDATE arm clobbering anything; it just does not follow that
 * the INSERT arm may be an invalid row. An upsert has to be able to insert.
 *
 * WHAT THIS PINS is the general rule rather than the one column, because the
 * next NOT NULL column added to `batches` would reintroduce this silently and
 * identically:
 *
 *   every NOT NULL column on `batches` must either be supplied by the row
 *   production_batch_asset_write builds, or be given a fallback by
 *   batch_write's own INSERT arm (a coalesce/default).
 *
 * It is a source test because the failure lives in SQL that no JS suite
 * executes -- which is exactly why it survived to production. Read from the
 * migrations rather than restated here, so the check cannot drift from the
 * schema it is checking.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function readMigration(name) {
  return fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
}

/* ---- 1. The NOT NULL columns of `batches`, read from the schema ---------- */

const SCHEMA = readMigration('2026-07-06-b1-linear-data-model.sql');
const tableMatch = SCHEMA.match(/create table if not exists public\.batches \(([\s\S]*?)\n\);/);
ok(!!tableMatch, 'found the batches table definition to read NOT NULL columns from');

const notNullColumns = [];
for (const rawLine of (tableMatch ? tableMatch[1] : '').split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('--')) continue;
  if (!/\bnot null\b/i.test(line)) continue;
  const col = (line.match(/^([a-z_][a-z0-9_]*)\s/) || [])[1];
  if (!col) continue;
  // A column with its own DEFAULT can never be the null that breaks an insert.
  const hasDefault = /\bdefault\b/i.test(line);
  notNullColumns.push({ col, hasDefault });
}
ok(notNullColumns.length >= 3,
  'read the NOT NULL columns from the schema itself (' + notNullColumns.map(c => c.col).join(', ') + ')');
ok(notNullColumns.some(c => c.col === 'client_slug' && !c.hasDefault),
  'client_slug is NOT NULL with no default — the column this bug died on');

/* ---- 2. What batch_write's INSERT arm supplies a fallback for ------------ */

const BATCH_WRITE = readMigration('2026-08-19-samples-batch-write-purpose.sql');
function batchWriteHasFallback(col) {
  // e.g. coalesce(nullif(v_row->>'name', ''), 'Untitled batch')
  const pattern = new RegExp("coalesce\\(nullif\\(v_row->>'" + col + "'[^)]*\\)\\s*,");
  return pattern.test(BATCH_WRITE);
}

/* ---- 3. What production_batch_asset_write actually sends ----------------- */
/* Read the LIVE definition -- the last one applied. Filename sort cannot decide
   that: all three definitions carry the same 2026-08-31 date prefix, and sorting
   them alphabetically puts `-write` (the original) after `-client-slug-insert-arm`
   (the fix), which is backwards and would have passed this test against the very
   file carrying the bug. The migrations README is the ledger and is written in
   application order, so it is the ordering authority -- and a defining migration
   that is missing from it is a failure in itself, because then nothing in the
   repo says which definition is live. */

const README = fs.readFileSync(path.join(MIGRATIONS, 'README.md'), 'utf8');
const ledgerAt = file => README.indexOf('- **`' + file + '`**');

const definingFiles = fs.readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .filter(f => readMigration(f).includes('create or replace function public.production_batch_asset_write'));
ok(definingFiles.length > 0, 'found the migration(s) defining production_batch_asset_write');

const undocumented = definingFiles.filter(f => ledgerAt(f) < 0);
ok(undocumented.length === 0,
  'every definition of production_batch_asset_write is entered in the migrations README, which is what makes their order knowable'
  + (undocumented.length ? ' — MISSING: ' + undocumented.join(', ') : ''));

const NEWEST = definingFiles.slice().sort((a, b) => ledgerAt(a) - ledgerAt(b)).pop();
const ASSET_FN = readMigration(NEWEST);
console.log('       (live definition, last in the README ledger: ' + NEWEST + ')');

const vRowMatch = ASSET_FN.match(/v_row\s*:=\s*jsonb_build_object\(([\s\S]*?)\)\s*\n?\s*\|\|/);
ok(!!vRowMatch, 'found the row it hands to batch_write');
const vRowKeys = [...(vRowMatch ? vRowMatch[1] : '').matchAll(/'([a-z_][a-z0-9_]*)'/g)].map(m => m[1]);
ok(vRowKeys.includes('id'), 'the row carries id, the key the upsert matches on');

/* ---- 4. THE RULE: no NOT NULL column may be left to chance -------------- */

const uncovered = notNullColumns.filter(({ col, hasDefault }) =>
  !hasDefault && !vRowKeys.includes(col) && !batchWriteHasFallback(col));

ok(uncovered.length === 0,
  'every NOT NULL batches column is either sent by production_batch_asset_write or defaulted by batch_write'
  + (uncovered.length ? ' — UNCOVERED: ' + uncovered.map(c => c.col).join(', ') : ''));

ok(vRowKeys.includes('client_slug'),
  'client_slug specifically is sent — the regression that made every batch asset write fail with 23502');

/* ---- 5. The no-clobber property the original design wanted still holds --- */
/* The fix must not turn into "send everything": the per-key guards in
   batch_write only protect columns the row does NOT carry, so each key added
   here is a column this write now overwrites. */

const assetColumns = ['footage_folder_url', 'delivery_folder_url'];
const extras = vRowKeys.filter(k => k !== 'id' && k !== 'client_slug' && !assetColumns.includes(k));
ok(extras.length === 0,
  'and it sends NOTHING beyond id, client_slug and the asset column — every extra key is a column this write would start overwriting'
  + (extras.length ? ' (found: ' + extras.join(', ') + ')' : ''));

/* ---- 6. Executed: the upsert semantics this all rests on ---------------- */
{
  // NOT NULL is checked on the proposed tuple; ON CONFLICT never gets a say.
  function insertArmValid(row, schema) {
    return schema
      .filter(c => !c.hasDefault)
      .every(c => Object.prototype.hasOwnProperty.call(row, c.col));
  }
  const schema = [
    { col: 'id', hasDefault: false },
    { col: 'client_slug', hasDefault: false },
    { col: 'status', hasDefault: true },
  ];
  ok(!insertArmValid({ id: 'b1', footage_folder_url: 'x' }, schema),
    'the OLD two-key row is rejected by the same rule Postgres applied — this is the bug, reproduced');
  ok(insertArmValid({ id: 'b1', client_slug: 'c', footage_folder_url: 'x' }, schema),
    'and the fixed row passes');
}

console.log(failures === 0
  ? '\nBatch asset write insert-arm checks passed'
  : '\n' + failures + ' batch asset write insert-arm check(s) failed');
process.exit(failures === 0 ? 0 : 1);
