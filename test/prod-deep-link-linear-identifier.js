'use strict';
/*
 * "It says it has no row in Production."
 *
 * Owner report 2026-09-07, from the Workload calendar: open a designer's
 * OVERDUE rollup, open a client chip, press "Open SyncView →" and the
 * Production tab answers
 *
 *   GRA-7197 has no row in Production. Most often its post could not be
 *   resolved here; it may also never have been imported. Ask an Admin to look
 *   it up. Showing the full list instead.
 *
 * The row exists. It is `b1_d_188ba4ad...`, an active client, status `todo`,
 * team `graphics`, and the page had already FETCHED it —
 * `_prodDeepLinkRowQuery` asks for `id`, `identifier` and `linear_identifier`.
 *
 * TWO NAMES FOR ONE ROW. `deliverables.identifier` is a snapshot the b1 import
 * took (`scripts/b1-linear-backfill.js` writes it and `linear_identifier` from
 * the same Linear value) and nothing maintains it: native creation writes it
 * null, and `linear-inbound` refreshes `linear_identifier` and `team` on every
 * webhook while never touching it. Move an issue between Linear teams and
 * Linear re-keys it — VID-13553 became GRA-7197 — so the row's snapshot names a
 * team it no longer belongs to.
 *
 * The adapter read the snapshot FIRST (`d.identifier || d.linear_identifier`),
 * so this tab called the row VID-13553 while Linear, Workload and every person
 * called it GRA-7197. `_prodIssue` matched on `id` or `displayId` only, and the
 * one deep link in the product that carries no row id is exactly the one that
 * asks by Linear identifier: the Workload popover builds every link as
 * `?prod=1&d=<identifier>` (test/workload-syncview-links.js). So the fallback
 * evicted the reader and published "no row" over a row it was holding.
 *
 * Measured 2026-09-07 across all 6,369 browser-visible rows with the keys the
 * adapter uses: 7 disagree across two clients, all graphics rows carrying a
 * VID- snapshot; zero
 * rows carry an `identifier` without a `linear_identifier`; and no string is
 * one row's displayId and another row's `linear_identifier`.
 *
 * The maintained column wins, and the snapshot keeps resolving as an alias so
 * an older link is opened rather than denied.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripBlockComments } = require('./helpers/strip-comments');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Comment-aware brace matcher: the prose in index.html carries apostrophes and
   braces that a naive scan reads as code. */
function grabFunc(signature) {
  const start = INDEX.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  let depth = 0, quote = '', comment = '', escaped = false;
  for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
    const c = INDEX[i], n = INDEX[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return INDEX.slice(start, i + 1);
  }
  throw new Error('unclosed: ' + signature);
}
function stripComments(src) {
  return stripBlockComments(src, ' ')
    .split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
}

/* ---- 1. The adapter names the row by the column that is maintained ------- */

const adapter = stripComments(grabFunc('function _prodAdapter('));
ok(/const linearIdent = String\(d\.linear_identifier \|\| ''\);/.test(adapter)
  && /const importIdent = String\(d\.identifier \|\| ''\);/.test(adapter),
  'the adapter reads both identifier columns separately');
ok(/displayId: linearIdent \|\| importIdent \|\| String\(d\.id \|\| ''\)/.test(adapter),
  'the LINEAR identifier names the row; the import snapshot is only the fallback');
ok(!/displayId: d\.identifier \|\| d\.linear_identifier/.test(adapter),
  'and the old precedence — snapshot first — is gone');
ok(/aliasId: importIdent && importIdent !== linearIdent \? importIdent : ''/.test(adapter),
  'a snapshot that disagrees is kept as an alias, and one that agrees adds nothing');
ok(/aliasId: '',/.test(adapter),
  'the synthetic batch parent carries the same field, so every row in the set has the shape');

/* ---- 2. Resolution: canonical first, alias second ----------------------- */

const lookup = grabFunc('function _prodIssue(');
const sandbox = { rows: [] };
vm.createContext(sandbox);
vm.runInContext(
  'function _prodIssues() { return rows; }\n' + lookup + '\nthis.find = _prodIssue;',
  sandbox,
);
const find = sandbox.find;
ok(typeof find === 'function', 'the resolver extracts and executes (the harness is not vacuous)');

// The live row, built the way the adapter builds it.
const moved = { id: 'b1_d_188ba4ad', displayId: 'GRA-7197', aliasId: 'VID-13553' };
const ordinary = { id: 'del_6b4bc876', displayId: 'GRA-7195', aliasId: '' };
sandbox.rows = [ordinary, moved];

ok(find('GRA-7197') === moved,
  'THE REPORT: the Workload link asks by Linear identifier and gets the row — no "has no row in Production"');
ok(find('b1_d_188ba4ad') === moved, 'opening from the list is unchanged');
ok(find('VID-13553') === moved,
  'and a link or bookmark holding the retired number still opens the row instead of being denied');
ok(find('GRA-7195') === ordinary && find('del_6b4bc876') === ordinary,
  'a row whose two columns agree resolves by either of its names');
ok(find('GRA-9999') === null && find('') === null && find(null) === null,
  'a genuinely absent target still resolves to nothing — the notice keeps its real cases');

// Canonical beats alias, whatever the row order.
const claimant = { id: 'del_new', displayId: 'VID-13553', aliasId: '' };
sandbox.rows = [moved, claimant];
ok(find('VID-13553') === claimant,
  'if a retired number is ever a live row\'s own name, that row wins — an alias never steals a canonical match');
sandbox.rows = [claimant, moved];
ok(find('VID-13553') === claimant, 'and the winner does not depend on row order');

/* ---- 3. The fetch and the resolver ask for the same three names --------- */

const rowQuery = stripComments(grabFunc('function _prodDeepLinkRowQuery('));
ok(/\['id', 'identifier', 'linear_identifier'\]/.test(rowQuery),
  'the one-row deep-link read still asks for all three columns — fetching a row the resolver then calls missing is the shape of this bug');

/* ---- 4. The notice tests both identifier columns independently ---------- */

const notice = stripComments(grabFunc('function _prodDeepLinkNoticeHTML('));
ok(/names\.includes\(missing\)/.test(notice)
  && /row && row\.identifier, row && row\.linear_identifier/.test(notice),
  'the archived branch compares the missing target against id AND both identifier columns');
ok(!/row\.identifier \|\| row\.linear_identifier/.test(notice),
  'and no longer asks only about the snapshot, which for a moved row is the number nobody links');

/* ---- 5. The caller this exists for ------------------------------------- */

const popover = INDEX.slice(INDEX.indexOf('const parentUrl   = clientName'),
  INDEX.indexOf('No upcoming sub-issues.'));
ok(/'\?prod=1&d=' \+ encodeURIComponent\(parentIdent\)/.test(popover)
  && /'\?prod=1&d=' \+ encodeURIComponent\(s\.identifier\)/.test(popover),
  'the Workload popover still links by Linear identifier — the header and every row — which is why the row must answer to it');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nProduction deep-link Linear-identifier checks passed.');
