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
 * The first fix removed that call outright, on the reasoning that phase two
 * only APPENDS terminal rows so an id means the same thing before and after.
 * That reasoning was WRONG and review caught it. _prodAdapter filters rows
 * through _prodDeliverableLive, which drops only ARCHIVED rows -- approved,
 * posted, canceled and duplicate rows all reach the adapter. So the tail
 * enlarges the row set _prodResolveAttributions walks ancestors through, and a
 * live child whose nearest mapped ancestor is an approved parent resolves to
 * needs_attribution in phase one and to that ancestor's CLIENT in phase two.
 * requestStillCurrent() refuses a response still in flight; it cannot refuse a
 * value that already landed and is merely being redrawn.
 *
 * So the tail stamps each row's scope before and after the merge and
 * invalidates exactly the rows whose stamp moved. Normally that is none of
 * them -- the double refresh stays gone -- and when it is not, the rows that
 * would have leaked another client's link are the ones that pay.
 *
 * The file pills ARE still cleared unconditionally, and that distinction is
 * part of the point of this file: a terminal row joining a batch legitimately
 * changes which pills that batch draws, and that cache re-asks on the next
 * render of a parent with no visible state of its own to churn.
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

/* ---- 1. Phase 2 does not throw away phase 1's reads WHOLESALE ---------- */

const tail = stripComments(grabFunc('async function _prodLoadTerminalTail('));

/* THE REGRESSION THIS EXISTS FOR. The blanket call is the double refresh.
   Matched with a trailing `(` and no `For`, so the targeted variant below
   cannot satisfy this by accident. */
ok(!/_prodInvalidateScopedReads\s*\(/.test(tail),
  'the terminal tail does NOT blanket-invalidate every scoped read — that was the second refresh');

ok(/_prodState\.batchFiles\.clear\(\)/.test(tail)
  && /_prodState\.batchFilesStatus\.clear\(\)/.test(tail),
  'but it DOES clear the file pills, because a terminal row joining a batch changes which pills it draws');
ok(/_prodRender\(\)/.test(tail),
  'and it still re-renders, so the newly appended rows appear');

/* ---- 1b. ...but it DOES catch the rows whose scope actually moved ------ */

ok(/_prodScopeSignatures\(_prodState\.adapter\)/.test(tail),
  'the tail stamps every row scope BEFORE the merge');
ok((tail.match(/_prodScopeSignatures\(/g) || []).length === 2,
  'and again AFTER it, so the two can be compared');
ok(/_prodInvalidateScopedReadsFor\(rescoped\)/.test(tail),
  'and invalidates exactly the rows whose stamp moved');
ok(tail.indexOf('scopeBefore') < tail.indexOf('_prodState.deliverables = merged'),
  'the BEFORE stamp is taken while the pre-merge adapter is still installed — after it, there is nothing left to compare against');
ok(tail.indexOf('_prodState.adapter = _prodAdapter(') < tail.indexOf('const scopeAfter'),
  'and the AFTER stamp is taken from the rebuilt adapter, not the old one');

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

/* ---- 5. Executed: the premise the whole fix rests on ------------------- */
/* If terminal rows never reached the adapter, the tail really could not change
   any row's scope and the blanket removal would have been safe. They do reach
   it: _prodAdapter filters on _prodDeliverableLive, and that drops ARCHIVED,
   not TERMINAL. Run the real function rather than reasoning about it. */

const adapterSrc = stripComments(grabFunc('function _prodAdapter('));
ok(/\(raw\.deliverables \|\| \[\]\)\.filter\(_prodDeliverableLive\)/.test(adapterSrc),
  'the adapter admits rows by _prodDeliverableLive, not by the terminal filter');

const liveSandbox = {};
[
  'function _prodHasOwn(', 'function _prodNormKey(', 'function _prodLinearRaw(',
  'function _prodRawHasAny(', 'function _prodRawMarkerTruthy(', 'function _prodDeliverableLive(',
  'function _prodWriteTeam(', 'function _prodIssueScopeSignature(', 'function _prodScopeSignatures('
].forEach(sig => {
  const fn = new Function('sandbox', grabFunc(sig) + '\nreturn ' + sig.slice(9, -1) + ';');
  liveSandbox[sig.slice(9, -1)] = fn(liveSandbox);
});
// The lifted helpers call each other by bare name; bind them globally so they
// resolve, rather than rewriting the source and testing a paraphrase.
Object.assign(global, liveSandbox);

const TERMINAL = ['approved', 'posted', 'canceled', 'cancelled', 'duplicate'];
TERMINAL.forEach(status => {
  ok(_prodDeliverableLive({ id: 'x', status }) === true,
    'a ' + status + ' row REACHES the adapter — so the tail really does enlarge the attribution row set');
});
ok(_prodDeliverableLive({ id: 'x', status: 'archived' }) === false,
  'only archived rows are dropped, which is why "the tail only appends invisible rows" was false');

/* ---- 6. Executed: the scope diff ---------------------------------------- */
/* The exact loop from the tail, lifted from source so a change there breaks
   here rather than silently diverging. */

const diffSrc = tail.slice(tail.indexOf('const rescoped = [];'), tail.indexOf('_prodState.batchFiles.clear()'));
ok(/scopeBefore\.forEach/.test(diffSrc) && /rescoped\.push\(id\)/.test(diffSrc),
  'the diff loop was located in source and is what runs below');

function runDiff(before, after) {
  const calls = [];
  const fn = new Function('scopeBefore', 'scopeAfter', '_prodInvalidateScopedReadsFor',
    diffSrc.replace(/const scopeAfter = [^;]+;/, '') + '\nreturn rescoped;');
  const rescoped = fn(before, after, ids => calls.push(ids));
  return { rescoped, calls };
}

// The scenario Codex named: a live child under an approved parent.
const child = { id: 'child', team: 'video', project: 'NEEDS', authorityProject: '', storedClientSlug: '' };
const childAfter = { id: 'child', team: 'video', project: 'laura', authorityProject: 'laura', storedClientSlug: '' };
const steady = { id: 'steady', team: 'video', project: 'sidneylaruel', authorityProject: 'sidneylaruel', storedClientSlug: '' };

const before = _prodScopeSignatures({ ISSUES: [child, steady] });
const after = _prodScopeSignatures({ ISSUES: [childAfter, steady] });
const moved = runDiff(before, after);

ok(moved.rescoped.length === 1 && moved.rescoped[0] === 'child',
  'a live child that gains a client when its approved ancestor lands IS invalidated — its phase-one asset read was answered for another scope');
ok(moved.calls.length === 1,
  'and the invalidation actually fires for it');

const quiet = runDiff(
  _prodScopeSignatures({ ISSUES: [childAfter, steady] }),
  _prodScopeSignatures({ ISSUES: [childAfter, steady] }));
ok(quiet.rescoped.length === 0 && quiet.calls.length === 0,
  'THE COMMON CASE: nothing re-scopes, nothing is invalidated, and the tab checks once — this is the reported bug staying fixed');

const teamMoved = runDiff(
  _prodScopeSignatures({ ISSUES: [steady] }),
  _prodScopeSignatures({ ISSUES: [{ ...steady, team: 'graphics' }] }));
ok(teamMoved.rescoped.length === 1,
  'a team change counts as a re-scope too, because the read is answered per client AND team');

const vanished = runDiff(
  _prodScopeSignatures({ ISSUES: [steady] }),
  _prodScopeSignatures({ ISSUES: [] }));
ok(vanished.rescoped.length === 1,
  'and a row that disappears from the merge is invalidated rather than left holding a value nothing can re-check');

/* ---- 7. One definition of scope, not three ----------------------------- */
/* The two read paths refuse an in-flight response on scope; the tail refuses a
   landed one. All three used to spell the rule out by hand -- and the tail
   simply did not have it. */

const assets = stripComments(grabFunc('async function _prodEnsureAssets('));
const description = stripComments(grabFunc('async function _prodEnsureDescription('));
[['_prodEnsureAssets', assets], ['_prodEnsureDescription', description]].forEach(([name, src]) => {
  ok(/_prodIssueScopeSignature\(liveIssue\) === scopeSignature/.test(src),
    name + ' compares scope through the shared helper');
  ok(!/liveClientSlug/.test(src),
    name + ' no longer spells the comparison out by hand, so it cannot drift from the tail\'s');
});

/* ---- 8. Executed: values survive a refresh, and only the right ones ----- */
/* The second half of the owner's report. _prodInvalidateScopedReads used to
   DELETE every completed read, so a tab return walked the panel back through
   the skeleton for links that had not moved. It now preserves them, which is
   safe only because _prodAssetState refuses a stamped value whose scope has
   changed. Both halves are executed here, against the real functions. */

const vm = require('vm');
function sliceBetween(startNeedle, endNeedle) {
  const a = INDEX.indexOf(startNeedle);
  const b = INDEX.indexOf(endNeedle, a);
  if (a < 0 || b < 0) throw new Error('slice not found: ' + startNeedle);
  return INDEX.slice(a, b);
}

let scopeRow = {
  id: 'row-1', team: 'graphics',
  project: 'client-a', authorityProject: 'client-a', storedClientSlug: 'client-a',
};
const ctx = {
  _prodState: { assets: new Map(), descriptions: new Map(), batchFiles: new Map(),
    batchFilesStatus: new Map(), assetRequestTokens: new Map(),
    descriptionRequestTokens: new Map(), linearRaw: new Map() },
  _prodIssue(id) { return String(id) === scopeRow.id ? scopeRow : null; },
  _prodDescriptionState() { return null; },
  PROD_BATCH_ASSET_GUIDANCE: 'held on the post',
  PROD_ASSET_UNREAD_GUIDANCE: 'not readable yet',
};
vm.createContext(ctx);
vm.runInContext([
  sliceBetween('const PROD_ASSET_SPECS', 'function _prodAssetDefaultEvidence('),
  grabFunc('function _prodAssetDefaultEvidence('),
  grabFunc('function _prodWriteTeam('),
  grabFunc('function _prodIssueScopeSignature('),
  grabFunc('function _prodAssetState('),
  grabFunc('function _prodInvalidateScopedReads('),
  'this.assetState = _prodAssetState; this.invalidate = _prodInvalidateScopedReads;',
].join('\n'), ctx);

// A read completes for client-a and is stamped with that scope.
const landed = ctx.assetState('row-1');
landed.status = 'ready';
landed.complete = true;
landed.assets.deliverable_file = { url: 'https://drive.google.com/file/kept', state: 'available' };
landed.scopeSignature = 'client-a\u0000graphics';

// (a) A refresh that re-scopes NOTHING must not blank the panel.
ctx.invalidate();
const afterQuietRefresh = ctx.assetState('row-1');
ok(afterQuietRefresh.assets.deliverable_file.url === 'https://drive.google.com/file/kept',
  'THE REPORTED BUG: a refresh that changes nothing KEEPS the link on screen instead of blanking it back to a skeleton');
ok(afterQuietRefresh.status === 'idle' && afterQuietRefresh.complete === false,
  'and still re-reads underneath — the value is shown while it revalidates, not instead of revalidating');

// (b) ...but the row moving to another client drops it on sight.
scopeRow = { ...scopeRow, team: 'video', authorityProject: 'client-b', storedClientSlug: 'client-b', project: 'client-b' };
const afterRescope = ctx.assetState('row-1');
ok(afterRescope.assets.deliverable_file.url === '',
  'THE GUARD: once the row belongs to another client, the preserved link is refused at USE time and never drawn');
ok(afterRescope.scopeSignature === '',
  'and the refused state carries no stamp, so it cannot be mistaken for a fresh answer');

// (c) A value the row never read is not resurrected either.
ctx._prodState.assets.clear();
const neverRead = ctx.assetState('row-1');
ok(neverRead.complete === false && neverRead.scopeSignature === '',
  'a state that has never completed a read carries no stamp and nothing to preserve');
ctx.invalidate();
ok(!ctx._prodState.assets.has('row-1'),
  'and is dropped by the invalidation as before, because there is nothing on screen worth keeping');

console.log(failures === 0
  ? '\nsingle-refresh + skeleton checks passed'
  : '\n' + failures + ' single-refresh check(s) failed');
process.exit(failures === 0 ? 0 : 1);
