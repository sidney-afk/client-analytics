'use strict';
/*
 * A CACHE THAT CANNOT FIT MUST NOT DELETE ITS NEIGHBOURS TRYING.
 *
 * The Production tab paints from a localStorage snapshot and revalidates
 * behind it. Measured against the live estate on 2026-08-26, the snapshot it
 * actually serialised was 5.44M characters: every client, member, batch and
 * deliverable. localStorage stores UTF-16, so that is ~10.9MB asking for an
 * origin budget of roughly 5MB. It could not be written on any browser, on any
 * day, by anyone -- so SyncLinear paid a full cold read (~2-3.5s of sequential
 * paging) every single time it was opened, which is exactly what the owner's
 * team reported as "it loads really slowly at the beginning".
 *
 * The expensive part was not the miss. On QuotaExceededError the writer evicts
 * the oldest same-family snapshot and retries, one key at a time. No number of
 * evictions could make room for 10.9MB, so every Production open walked that
 * loop to the end and deleted EVERY calendar and samples snapshot in the
 * origin -- and then still failed. Opening one tab quietly made two others
 * slow.
 *
 * Three properties are pinned here, and the first is the one that matters:
 *
 *   1. The budget is checked BEFORE the first setItem. Checking after the
 *      first failure is the bug: by then the eviction has already started.
 *   2. What is cached is what the default view paints -- batch descriptions
 *      (2.12MB of the 5.44MB on their own) and completed deliverables (3,902
 *      of 5,398 rows) are dropped, because neither is on a first paint.
 *   3. Because the snapshot is a projection, nothing may present it as the
 *      whole truth: cachePartial is set on the cached paint and cleared by the
 *      live read, and the one tab that shows completed work says it is still
 *      loading rather than "no issues".
 *
 * The fixtures below are sized from the real measurement, so this suite fails
 * if the estate grows past what the projection can hold -- which is the point
 * at which someone must think again rather than discover it as slowness.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Slice a named function out of the shipped file and execute it. An end anchor
   that does not exist yields an EMPTY slice and every "absent" assertion would
   pass for the wrong reason, so each slice is asserted non-empty first. */
function fnSource(name, endAnchor) {
  const start = html.indexOf('function ' + name + '(');
  const end = html.indexOf(endAnchor, start);
  if (start < 0 || end <= start) return '';
  return html.slice(start, end);
}
function constValue(decl, endToken) {
  const start = html.indexOf(decl);
  if (start < 0) return '';
  const end = html.indexOf(endToken, start + decl.length);
  return end < 0 ? '' : html.slice(start + decl.length, end).trim();
}

// ---- 1. the shipped projection, EXECUTED ---------------------------------
const terminalSrc = fnSource('_prodCacheIsTerminal', 'function _prodCacheProject(');
const projectSrc = fnSource('_prodCacheProject', 'function _prodCachePurge(');
ok(!!terminalSrc && !!projectSrc, 'the projection and its terminal test are findable (harness is not vacuous)');

const terminalList = constValue('const PROD_CACHE_TERMINAL = ', ';');
const maxChars = Number(constValue('const PROD_CACHE_MAX_CHARS = ', ';'));
const schema = Number(constValue('const PROD_CACHE_SCHEMA = ', ';'));
ok(/'approved'/.test(terminalList) && /'posted'/.test(terminalList) && /'canceled'/.test(terminalList),
  'the terminal list names the states that actually dominate the estate (approved, posted, canceled)');
ok(Number.isFinite(maxChars) && maxChars > 0, 'the budget is a real number of characters (' + maxChars + ')');
ok(schema === 2, 'the schema is bumped, so a full snapshot written under the old contract is discarded, not read as a projection');

const scope = new Function('PROD_CACHE_TERMINAL',
  terminalSrc + '\n' + projectSrc + '\nreturn { _prodCacheIsTerminal, _prodCacheProject };')(
  JSON.parse(terminalList.replace(/'/g, '"')));
const project = scope._prodCacheProject;
const isTerminal = scope._prodCacheIsTerminal;

ok(isTerminal({ status: 'approved' }) && isTerminal({ status: 'POSTED' }) && isTerminal({ status: 'Canceled' }),
  'terminal matching is case-insensitive -- the estate holds both cases');
ok(!isTerminal({ status: 'in_progress' }) && !isTerminal({ status: 'smm_approval' }) && !isTerminal({ status: 'tweak' }),
  'and live work -- including the approval queues staff live in -- is never treated as history');
ok(!isTerminal({}) && !isTerminal({ status: '' }),
  'a row with no status is kept: an unknown state is not silently retired from the snapshot');

// ---- 2. the size contract, against the measured estate -------------------
/* Per-row sizes from the 2026-08-26 live measurement: 1,465 batches averaging
   ~2,060 chars of which ~1,517 is description; 5,398 deliverables averaging
   ~499 chars, 3,902 of them terminal. */
const filler = n => 'x'.repeat(n);
const batches = Array.from({ length: 1465 }, (_, i) => ({
  id: 'b_' + i, client_slug: 'client-' + (i % 40), team: i % 2 ? 'video' : 'graphics',
  name: 'Batch ' + i + filler(20), description: filler(1517), color: '#123456',
  status: i % 4 ? 'active' : 'archived', sort_key: i, created_by: 'm_' + (i % 20),
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  linear_parent_ids: { video: { url: filler(60), uuid: filler(36), identifier: 'VID-' + i } },
}));
const deliverables = Array.from({ length: 5398 }, (_, i) => ({
  id: 'd_' + filler(30) + i, identifier: 'VID-' + i, batch_id: 'b_' + (i % 1465),
  client_slug: 'client-' + (i % 40), team: 'video', kind: 'video',
  title: 'A deliverable title ' + filler(25), status: i < 3902 ? 'approved' : 'in_progress',
  status_at: '2026-08-01T00:00:00Z', assignee_id: filler(36), due_date: '2026-09-01',
  origin: 'linear', card_id: '', sync_state: 'synced',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
}));
const full = { clients: [], members: [], batches, deliverables, authority: { video: 'linear', graphics: 'syncview' } };

const fullChars = JSON.stringify(Object.assign({ schema: 1, savedAt: 1 }, full)).length;
ok(fullChars > maxChars * 2,
  'the OLD full snapshot is still far past the budget at estate size (' + Math.round(fullChars / 1000) + 'k chars vs a '
    + Math.round(maxChars / 1000) + 'k budget) -- this is the write that could never succeed');

const projected = project(full);
const projectedChars = JSON.stringify(Object.assign({ schema, savedAt: 1 }, projected)).length;
ok(projectedChars <= maxChars,
  'the PROJECTED snapshot fits the budget at estate size (' + Math.round(projectedChars / 1000) + 'k chars)');
ok(projectedChars * 2 < 3 * 1024 * 1024,
  'and fits in UTF-16 with room beside the calendar and samples snapshots ('
    + (projectedChars * 2 / 1048576).toFixed(2) + 'MB of a ~5MB origin budget)');

ok(projected.batches.length === batches.length,
  'every batch survives the projection -- a batch missing from the snapshot is a batch missing from the paint');
ok(projected.batches.every(b => !('description' in b)),
  'but no batch carries its description, which was 2.12MB of the 5.44MB on its own');
ok(projected.batches[0].linear_parent_ids && projected.batches[0].name,
  'while the fields the list actually paints are untouched');
ok(projected.deliverables.length === 1496,
  'only live deliverables are cached (1,496 of 5,398 at estate size)');
ok(projected.deliverables.every(d => !isTerminal(d)),
  'and not one terminal row slips through');
ok(projected.authority && projected.authority.video === 'linear',
  'authority is cached whole -- it is small, and a paint that guesses at authority is worse than no paint');

// ---- 3. the order that is the whole safety argument ----------------------
const writeSrc = html.slice(html.indexOf('function _prodCacheWrite('), html.indexOf('function _prodCachePurge('));
ok(!!writeSrc, 'the writer is findable');
const budgetAt = writeSrc.indexOf('PROD_CACHE_MAX_CHARS');
const evictAt = writeSrc.indexOf('evictable');
ok(budgetAt > 0 && evictAt > budgetAt,
  'the budget is checked BEFORE the eviction loop -- checking after the first failure is the bug, because by then a neighbour is already gone');
ok(/if \(payload\.length > PROD_CACHE_MAX_CHARS\)[\s\S]{0,200}?return false;/.test(writeSrc),
  'and an oversized payload returns without writing rather than starting a retry it cannot win');

// ---- 4. nothing may present the projection as the whole truth ------------
ok(/cachePartial: false/.test(html), 'cachePartial starts false');
ok(/_prodState\.fromCache = true;\s*\n\s*_prodState\.cachePartial = true;/.test(html),
  'the cached paint marks itself partial');
ok(/_prodState\.fromCache = false;\s*\n\s*_prodState\.cachePartial = false;/.test(html),
  'and the live read clears it -- the window is exactly one background refresh long');
ok(/_prodState\.cachePartial && _prodState\.tab === 'all'/.test(html)
  && /Loading completed work/.test(html),
  'the one tab that shows completed work says it is still loading rather than "no issues here yet"');
ok(html.indexOf("const historyPending") < html.indexOf("else if (myGate) msg = myGate;"),
  'and the F37 sign-in gate still wins over it, because an unverified session is a stronger truth than a pending read');

if (failures) {
  console.error(`\n${failures} production cache check(s) failed`);
  process.exit(1);
}
console.log('\nproduction cache fits, and never evicts for a write it cannot win');
