'use strict';
/*
 * A shared card link opened the issue and then hung the comment thread on the
 * loading skeleton for ever.
 *
 * Owner report 2026-08-31, against
 * https://syncview.synchrosocial.com/?prod=1&d=VID-13634#production — the exact
 * link format the team pastes to each other all day.
 *
 * THE SPLIT. A deep link carries the LINEAR IDENTIFIER. The URL parser stores
 * that string in `_prodState.openId` verbatim, and _prodApplyDeepLinkFallback
 * keeps it, because _prodIssue() resolves it perfectly well: it matches on `id`
 * OR `displayId`. So the row opens and the page looks right. But every
 * per-row read in the detail branch is keyed by `_prodState.openId`
 * ("VID-13634"), while every panel renders from `issue.id` (the canonical row
 * id). One row, two cache keys.
 *
 * WHY COMMENTS HUNG RATHER THAN JUST RELOADING. The three functions interlock:
 *
 *   render(id)  -> no state for this key? draw the loading skeleton.
 *   ensure(id)  -> state exists for this key? do nothing.
 *   refresh(id) -> status is 'loading'? return early.
 *
 * ensure() populated the identifier key, so it never fired again. render() was
 * handed the canonical key, which stayed empty, so it drew the skeleton on
 * every paint. Nothing was in an error state, so no Retry was offered. There
 * was no way out of it inside the tab.
 *
 * The other reads split the same way and merely degraded quietly: their panels
 * seed a state instead of returning a placeholder, so they showed unresolved
 * values rather than hanging.
 *
 * The fix normalises openId to the row's canonical id before anything is keyed
 * on it. The URL is deliberately left alone — the identifier is what people
 * paste.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Comment-aware: index.html comments are prose and contain apostrophes and
   braces, which a naive matcher reads as code. */
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
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
}

/* ---- 1. The split is real: resolution matches on either id --------------- */

const issueLookup = stripComments(grabFunc('function _prodIssue('));
ok(/i\.id === sid \|\| i\.displayId === sid/.test(issueLookup),
  '_prodIssue resolves a row by canonical id OR display identifier — which is why a deep link opens fine and still keys wrong');

const parse = stripComments(INDEX.slice(INDEX.indexOf("const d = q.get('d');"), INDEX.indexOf('_prodState.deepLinkMissing = \'\';')));
ok(/_prodState\.openId = d;/.test(parse),
  'the URL parser stores the raw ?d= value in openId — for a shared link that is the Linear identifier, not the row id');

/* ---- 2. The fix: normalise before anything is keyed on it ---------------- */

const render = stripComments(grabFunc('function _prodRender('));
const detailBranch = render.slice(render.indexOf("_prodState.view === 'detail' && _prodState.openId"));
const normIndex = detailBranch.indexOf('_prodState.openId = String(openRow.id)');
ok(normIndex > -1,
  'the detail branch normalises openId to the row\'s canonical id');
ok(normIndex < detailBranch.indexOf('_prodComments.ensure('),
  'and does it BEFORE the comment thread is asked for — after would key the read wrong all over again');
['_prodEnsureDescription(', '_prodEnsureLabels(', '_prodEnsureAssets('].forEach(fn => {
  ok(normIndex < detailBranch.indexOf(fn),
    'and before ' + fn.slice(0, -1) + ', which had the same split');
});
ok(!/_prodSetQuery/.test(detailBranch),
  'the URL is NOT rewritten — the identifier is the form people paste to each other, and normalising the state key does not require changing it');

/* ---- 3. Executed: the deadlock, and that the fix breaks it -------------- */
/* A faithful reduction of the three interlocking functions. Their real bodies
   are pinned structurally below, so this cannot drift into fiction. */

function makeThread() {
  const states = new Map();
  return {
    states,
    render(id) { return states.has(String(id)) ? 'thread' : 'skeleton'; },
    ensure(id) { if (!states.has(String(id))) states.set(String(id), 'loading'); },
    refresh(id) {
      const s = states.get(String(id));
      if (s === 'loading') return;          // an in-flight read is not re-raced
      states.set(String(id), 'loading');
    },
    settle(id) { if (states.get(String(id)) === 'loading') states.set(String(id), 'ready'); },
  };
}

const row = { id: 'del_7c1f', displayId: 'VID-13634' };

// BEFORE: openId is the identifier, the panel renders from row.id.
const broken = makeThread();
let openIdBroken = row.displayId;
for (let paint = 0; paint < 5; paint++) {
  broken.ensure(openIdBroken);
  broken.settle(openIdBroken);
  broken.refresh(openIdBroken);
}
ok(broken.render(row.id) === 'skeleton',
  'THE BUG: five paints later the panel still draws the skeleton, because the read populated the identifier key and the panel reads the row key');
ok(broken.states.get(row.displayId) === 'loading' || broken.states.get(row.displayId) === 'ready',
  'and the state that WAS loaded sits under the key nothing renders from');
ok(!broken.states.has(row.id),
  'nothing ever populates the key the panel actually asks for — no error, no Retry, no way out inside the tab');

// AFTER: normalise first.
const fixed = makeThread();
let openIdFixed = row.displayId;
const resolve = id => (id === row.id || id === row.displayId ? row : null);
for (let paint = 0; paint < 5; paint++) {
  const openRow = resolve(openIdFixed);
  if (openRow && String(openRow.id) !== String(openIdFixed)) openIdFixed = String(openRow.id);
  fixed.ensure(openIdFixed);
  fixed.settle(openIdFixed);
}
ok(openIdFixed === row.id,
  'after the fix openId is the canonical row id');
ok(fixed.render(row.id) === 'thread',
  'and the panel renders the thread it was given — the skeleton resolves');
ok(!fixed.states.has(row.displayId),
  'with nothing stranded under the identifier key');

// A row opened from the list already carries its canonical id; normalising is a
// no-op there and must not disturb it.
let openIdFromList = row.id;
const openRowFromList = resolve(openIdFromList);
if (openRowFromList && String(openRowFromList.id) !== String(openIdFromList)) openIdFromList = String(openRowFromList.id);
ok(openIdFromList === row.id,
  'opening from the list is unaffected — normalising an already-canonical id changes nothing');

/* ---- 4. The interlock the reduction above stands in for ----------------- */
/* If any one of these three stops holding, the reduction is no longer a model
   of the real thing and this file is lying. */

/* Brace-match the whole _prodComments module. Slicing between two named inner
   functions was the first attempt and it silently produced an EMPTY string,
   because retry() happens to sit above render() in the file — a negative slice
   that quietly asserts nothing. */
const commentsSrc = stripComments(grabFunc('const _prodComments = (() => {'));
ok(commentsSrc.length > 2000,
  'the comments module was located and is non-empty — a bad slice here would make every assertion below vacuous');
ok(/if \(!state \|\| state\.status === 'loading'\) return _prodCommentLoadingHTML\(\)/.test(commentsSrc),
  'render() really does draw the skeleton when it has no state for the key it is given');
ok(/function ensure\(id\) \{\s*if \(!stateFor\(id\)\) load\(id\);/.test(commentsSrc),
  'ensure() really does nothing once a state exists for ITS key');
ok(/current\.status === 'loading' \|\| current\.refreshing\)\) return;/.test(commentsSrc),
  'and refresh() really returns early on a loading state — the three together are what made this a dead end rather than a slow load');

console.log(failures === 0
  ? '\ndeep-link open-id key checks passed'
  : '\n' + failures + ' deep-link open-id check(s) failed');
process.exit(failures === 0 ? 0 : 1);
