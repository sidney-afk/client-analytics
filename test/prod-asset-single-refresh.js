'use strict';
/*
 * The Production tab said "checking" TWICE on every single load.
 *
 * Owner report 2026-08-31, and the cause arrived the night before with the
 * two-phase boot that made the tab fast. Phase 1 loads the live rows and
 * renders; the panel reads its assets. Phase 2 fetches the terminal tail and
 * called _prodInvalidateScopedReads(), which DELETES every cached asset read --
 * so the next render re-seeded from nothing and read all of them again.
 *
 * Phase 2 only APPENDS terminal rows. It changes no asset, no description and
 * no scope: a deliverable id means the same thing before and after it lands.
 * There was nothing to invalidate, and the cost was that the fast boot looked
 * like a flaky one.
 *
 * The file pills ARE still cleared there, and that distinction is the point of
 * this file: a terminal row joining a batch legitimately changes which pills
 * that batch draws, and that cache re-asks on the next render of a parent with
 * no visible state of its own to churn.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const start = INDEX.indexOf(name);
  if (start < 0) throw new Error('not found: ' + name);
  let i = INDEX.indexOf('{', start);
  let depth = 0, inS = '', inC = '';
  for (let j = i; j < INDEX.length; j++) {
    const c = INDEX[j], n = INDEX[j + 1];
    if (inC === 'line') { if (c === '\n') inC = ''; continue; }
    if (inC === 'block') { if (c === '*' && n === '/') { inC = ''; j++; } continue; }
    if (inS) { if (c === '\\') { j++; continue; } if (c === inS) inS = ''; continue; }
    if (c === '/' && n === '/') { inC = 'line'; j++; continue; }
    if (c === '/' && n === '*') { inC = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return INDEX.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* Structural assertions read CODE. The comment inside the tail explains the
   removal by NAMING _prodInvalidateScopedReads, and the first draft of this
   file reported two failures against that prose -- the same mistake the
   migration guards made this morning. Comments are stripped first. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
}

/* ---- 1. Phase 2 does not throw away phase 1's reads -------------------- */

const tail = stripComments(grabFunc('async function _prodLoadTerminalTail('));
ok(!/_prodInvalidateScopedReads\(\)/.test(tail),
  'the terminal tail does NOT invalidate scoped reads — appending terminal rows changes no asset and no scope');
ok(/_prodState\.batchFiles\.clear\(\)/.test(tail)
  && /_prodState\.batchFilesStatus\.clear\(\)/.test(tail),
  'but it DOES clear the file pills, because a terminal row joining a batch changes which pills it draws');
ok(/_prodRender\(\)/.test(tail),
  'and it still re-renders, so the newly appended rows appear');

/* THE REGRESSION THIS EXISTS FOR. Re-adding the call is the whole bug. */
ok(!/_prodInvalidateScopedReads/.test(tail),
  'the invalidation is not merely moved or conditional inside the tail — it is absent');

/* ---- 2. The invalidation itself is unchanged where it belongs ---------- */
/* It still runs on a real refresh, and still deletes: the attempt to preserve
   values across one was reverted because a refresh can re-scope a row to
   another client, and the guard in production-attachments.js says so. */

const invalidate = stripComments(grabFunc('function _prodInvalidateScopedReads('));
ok(/_prodState\.assets\.delete\(id\)/.test(invalidate),
  'a genuine refresh still drops cached asset reads — preserving them across a re-scope would leak another client\'s link');
ok(/assetRequestTokens\.forEach/.test(invalidate),
  'and still bumps the request tokens, which is what actually quarantines a held response');

/* ---- 3. First paint draws a shape, not a vocabulary -------------------- */

const panel = stripComments(grabFunc('function _prodAssetsPanelHTML('));
ok(/const pending = !url && assetState === 'checking';/.test(panel),
  'the pending case is exactly: nothing known yet, and a read on the way');
ok(/pending\s*\n?\s*\?\s*'<span class="prod-asset-skeleton"/.test(panel),
  'the value cell draws a skeleton rather than the word Checking');
ok(/prod-asset-skeleton prod-asset-skeleton-pill/.test(panel),
  'and so does the state pill, so the row does not half-load');
ok(/aria-label="Checking access"/.test(panel),
  'with an accessible name, because a shimmer says nothing to a screen reader');

ok(/@keyframes prod-asset-shimmer/.test(INDEX),
  'the shimmer is defined');
ok(/prefers-reduced-motion: reduce\) \{ \.prod-asset-skeleton \{ animation: none/.test(INDEX),
  'and holds still under prefers-reduced-motion rather than vanishing — the placeholder IS the information');

/* ---- 4. Executed: which states draw a skeleton ------------------------- */

function pendingFor(asset) {
  const url = String(asset.url || '').trim();
  const state = String(asset.state || (url ? 'checking' : 'missing'));
  return !url && state === 'checking';
}
ok(pendingFor({ url: '', state: 'checking' }),
  'an unread slot on a real deliverable shows the skeleton');
ok(!pendingFor({ url: 'https://drive.google.com/x', state: 'checking' }),
  'a slot that already has a link never does — there is something to show');
ok(!pendingFor({ url: '', state: 'missing' }),
  'a slot the server confirmed empty says Missing, which is a real answer');
ok(!pendingFor({ url: '', state: 'unavailable' }),
  'and an unreadable slot keeps its explanation rather than shimmering forever');

console.log(failures === 0
  ? '\nsingle-refresh + skeleton checks passed'
  : '\n' + failures + ' single-refresh check(s) failed');
process.exit(failures === 0 ? 0 : 1);
