'use strict';
/*
 * Every batches column the browser NAMES must be in the anon column allowlist.
 *
 * WHY THIS SUITE EXISTS
 * On 2026-08-19 the samples create dialog began filtering batches by a new
 * `purpose` column. Every such read returned HTTP 401 / SQLSTATE 42501
 * "permission denied for table batches" -- for THE WHOLE TABLE, not the column.
 *
 * 2026-07-23 (f34/f53) deliberately revoked the table-wide SELECT on
 * public.batches and replaced it with an explicit COLUMN allowlist, so a stale
 * client asking for a column it should not see fails closed. Column privileges
 * are NOT inherited by columns added later, and PostgreSQL refuses the whole
 * statement rather than the single column -- so the symptom looks like a
 * blanket auth failure and points nowhere near the real cause.
 *
 * The migration that added the column was compiled and behaviour-proven on a
 * real PostgreSQL 16 and still shipped this, because that proof ran as
 * SUPERUSER against a fixture with no grants. Everything about the column was
 * correct; the permission governing reach was invisible to the method.
 *
 * So the guard belongs here, where it is cheap and runs on every change:
 * cross-reference the columns the browser asks for against the columns the
 * migrations actually grant. Referencing a column in a filter needs the same
 * privilege as selecting it, so both are checked.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migrationsDir = path.join(root, 'migrations');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && source[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

// --- what the migrations actually grant to anon on public.batches ----------
const granted = new Set();
let sawRevoke = false;
for (const file of fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  if (/revoke\s+select\s+on\s+table\s+public\.batches\s+from[^;]*anon/i.test(sql)) sawRevoke = true;
  const re = /grant\s+select\s*\(([^)]*)\)\s*on\s+table\s+public\.batches\s+to\s+([^;]*);/gi;
  let m;
  while ((m = re.exec(sql))) {
    if (!/anon/i.test(m[2])) continue;
    m[1].split(',').map(c => c.trim().toLowerCase()).filter(Boolean).forEach(c => granted.add(c));
  }
}
ok(sawRevoke,
'the table-wide anon SELECT on batches really is revoked -- this suite is only meaningful because an allowlist governs reads');
ok(granted.size > 5, 'the column allowlist was parsed from the migrations (' + granted.size + ' columns)');
ok(granted.has('purpose'),
'`purpose` is granted -- without this every batches read that names it 401s for the WHOLE table');

// --- what the browser asks for --------------------------------------------
const reader = extract('_calLatestNativeBatches');
const selectMatch = /'batches', '([^']+)'/.exec(reader);
ok(!!selectMatch, 'the batches select list was located in the reader');
const selected = (selectMatch ? selectMatch[1] : '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
ok(selected.length > 0, 'the reader names at least one column');

for (const column of selected) {
  ok(granted.has(column), 'selected column `' + column + '` is inside the anon allowlist');
}

// Filters need the same privilege as a select, and are the exact way this bug
// reached production -- the dialog filtered on a column it had not been granted.
const filtered = [];
for (const m of reader.matchAll(/([a-z_][a-z0-9_]*)=eq\./gi)) filtered.push(m[1].toLowerCase());
ok(filtered.length > 0, 'the reader applies at least one column filter');
for (const column of new Set(filtered)) {
  ok(granted.has(column), 'FILTERED column `' + column + '` is inside the anon allowlist');
}

// `purpose` is safe to expose: two fixed routing words, no client data.
const grantFile = path.join(migrationsDir, '2026-08-19-samples-batch-purpose-grant.sql');
ok(fs.existsSync(grantFile), 'the grant migration exists as its own reviewable file');
const grantSql = fs.readFileSync(grantFile, 'utf8');
ok(/grant select \(purpose\) on table public\.batches to anon, authenticated;/.test(grantSql),
'it grants exactly the one column, to exactly the two browser roles');
ok(!/grant select on table public\.batches/.test(grantSql),
'it does NOT restore the table-wide grant the allowlist deliberately replaced');

if (failures) process.exit(1);
console.log('\nBatches column grant checks passed');
