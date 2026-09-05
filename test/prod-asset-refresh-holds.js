'use strict';
/*
 * THE ASSET GRID STOPS BLINKING ON A TAB RETURN.
 *
 * OWNER REPORT, 2026-09-05, with the post-level fix already live: "let's say I
 * open a link to the deliverable file from a sub-issue. Then I come back to the
 * Sync Linear tab. It checks again and refreshes the grid ... whenever it
 * refreshes the link the open link button disappears and reappears ... two or
 * three times ... do we really need to refresh access every single time?"
 *
 * WHAT WAS HAPPENING. The 2026-08-31 change made _prodInvalidateScopedReads
 * preserve a completed, scope-stamped read so a refresh would revalidate in
 * place. But a tab return runs that invalidation TWICE -- once from
 * _prodRefresh, to quarantine held responses synchronously, and once from
 * _prodLoadData after the projection swap -- and any render between the two
 * starts a re-read, which sets `complete` false while it is in flight. The
 * second pass met a stamped, INCOMPLETE state, dropped it, and the next render
 * reseeded from nothing: skeleton, read, link, for a link that had not moved.
 * The delta tick's _prodInvalidateScopedReadsFor deleted outright, the pill
 * cache was cleared outright, and a batch write deleted every other row of the
 * post. Four places, one shape: throw away what is on screen, then fetch it
 * back identical.
 *
 * THE RULE NOW. What is stamped stays; what the use-time gate can refuse is
 * kept, and refused at the moment of use if its row moved. `complete` only
 * says whether the LATEST read landed. And a read that would be discarded on
 * landing -- one started while a projection load is in flight -- is not
 * started at all for a row that already holds a stamped answer.
 *
 * Executed against the lifted functions, in the same sandbox shape as
 * test/prod-asset-single-refresh.js.
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
function stripComments(src) {
  return stripBlockComments(src, ' ')
    .split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
}
function sliceBetween(startNeedle, endNeedle) {
  const a = INDEX.indexOf(startNeedle);
  const b = INDEX.indexOf(endNeedle, a);
  if (a < 0 || b < 0) throw new Error('slice not found: ' + startNeedle);
  return INDEX.slice(a, b);
}

/* ---- 1. The rule, read from source ------------------------------------- */

const invalidateSrc = stripComments(grabFunc('function _prodInvalidateScopedReads('));
ok(/const preservable = !!state\.scopeSignature/.test(invalidateSrc)
  && !/state\.complete && state\.scopeSignature/.test(invalidateSrc),
  'a STAMPED state is preserved whether or not its latest read has completed -- `complete` was the flicker');
ok(/_prodState\.batchFilesStatus\.clear\(\)/.test(invalidateSrc)
  && !/_prodState\.batchFiles\.clear\(\)/.test(invalidateSrc),
  'the pill cache keeps its entries and drops only the per-generation status that makes a parent re-ask');

const tail = stripComments(grabFunc('async function _prodLoadTerminalTail('));
ok(/_prodState\.batchFilesStatus\.clear\(\)/.test(tail) && !/_prodState\.batchFiles\.clear\(\)/.test(tail),
  'the terminal tail does the same: status dropped, entries kept');

const invalidateForSrc = stripComments(grabFunc('function _prodInvalidateScopedReadsFor('));
ok(!/_prodState\.assets\.delete\(/.test(invalidateForSrc)
  && /if \(asset\) \{ asset\.status = 'idle'; asset\.complete = false;/.test(invalidateForSrc),
  'the delta tick marks a changed row\'s asset read stale instead of deleting it');

const batchInvalidate = stripComments(grabFunc('function _prodInvalidateBatchAssetReads('));
ok(/function _prodInvalidateBatchAssetReads\(issue, writtenId, slot, url\)/.test(batchInvalidate)
  && !/_prodState\.assets\.delete\(/.test(batchInvalidate)
  && /state\.status = 'idle';/.test(batchInvalidate),
  'a batch write marks the rest of the post stale rather than deleting it, and is told what was written');
ok(/_prodInvalidateBatchAssetReads\(issue, id, slot, value\)/.test(grabFunc('async function _prodSaveAsset(')),
  'and the save passes the slot and value along');

const ensure = stripComments(grabFunc('async function _prodEnsureAssets('));
ok(/if \(!force && _prodState\.refreshing && current\.scopeSignature\) return current;/.test(ensure),
  'a stamped row does not start a read while a projection load is in flight -- that read is refused on landing anyway');
ok(ensure.indexOf('_prodState.refreshing && current.scopeSignature') < ensure.indexOf('_syncviewStaffIdentityForHeaders()'),
  'and the deferral sits before the identity check, so a deferred read costs nothing');
ok(/\.\.\.\(recheck \? \{ recheck: true \} : \{\}\)/.test(ensure) && /const recheck = !!\(opts && opts\.recheck\);/.test(ensure),
  'the read body carries `recheck: true` only when asked to');
ok(/_prodEnsureAssets\(id, true, \{ recheck: true \}\)/.test(grabFunc('function _prodRefreshAssetsManual(')),
  'and the Refresh access button is the one caller that asks');

const ensureFiles = stripComments(grabFunc('async function _prodEnsureBatchFiles('));
ok(/batchId,\s*scope: clientSlug/.test(ensureFiles),
  'each pill entry is stamped with the batch row and scope it was answered for');
const pillFor = stripComments(grabFunc('function _prodBatchFileFor('));
ok(/function _prodBatchFileFor\(id, row\)/.test(pillFor)
  && /String\(live\.batchId \|\| ''\)\.trim\(\) !== entry\.batchId\) return null;/.test(pillFor)
  && /scope !== entry\.scope\) return null;/.test(pillFor),
  'and refused at use time for a row that left that batch or changed scope');
ok(/const kFile = _prodBatchFileFor\(k\.id, k\);/.test(INDEX),
  'the sub-issue row hands its live row to the gate');

/* ---- 2. The parent grid drops its empty Deliverable file row ------------ */

const detail = grabFunc('function _prodDetail() {');
ok(/const parentSlots = isHierarchyParent && d\.syntheticBatchParent !== true/.test(detail)
  && /\['filming_plan', 'raw_footage', 'delivery_folder'\]\s*\.concat\(String\(parentAsset && parentAsset\.url \|\| ''\)\.trim\(\) \? \['deliverable_file'\] : \[\]\)/.test(detail),
  'a real hierarchy parent draws the three post-level slots, and the Deliverable file row only when one is actually attached');
ok(/: parentSlots \? \{ slots: parentSlots \} : undefined\)/.test(detail),
  'the synthetic-parent branch keeps its own read-only rule, and every other row still draws all four');

/* ---- 3. Executed: the double invalidation of a tab return ---------------- */

let rows = {
  'row-1': { id: 'row-1', team: 'graphics', project: 'client-a', authorityProject: 'client-a', storedClientSlug: 'client-a', batchId: 'bat_1' },
};
const ctx = {
  _prodIssue(id) { return rows[String(id)] || null; },
  _prodIssues() { return Object.values(rows); },
  _prodChildrenOf(id) { return Object.values(rows).filter(r => r.parent === id); },
  _prodDescriptionState() { return null; },
  _syncviewStaffIdentityForHeaders() { throw new Error('reached the network path'); },
  PROD_BATCH_ASSET_GUIDANCE: 'held on the post',
  PROD_ASSET_UNREAD_GUIDANCE: 'not readable yet',
  PROD_ATTRIBUTION_NEEDS: '__needs_attribution__',
  PROD_ATTRIBUTION_CONFLICT: '__attribution_conflict__',
};
vm.createContext(ctx);
vm.runInContext([
  sliceBetween('const PROD_ASSET_SPECS', 'function _prodAssetDefaultEvidence('),
  grabFunc('function _prodAssetDefaultEvidence('),
  grabFunc('function _prodWriteTeam('),
  grabFunc('function _prodIssueScopeSignature('),
  grabFunc('function _prodAssetState('),
  grabFunc('function _prodInvalidateScopedReads('),
  grabFunc('function _prodInvalidateScopedReadsFor('),
  grabFunc('function _prodInvalidateBatchAssetReads('),
  grabFunc('function _prodPostRows('),
  grabFunc('function _prodBatchFileFor('),
  grabFunc('async function _prodEnsureAssets('),
  'this.assetState = _prodAssetState; this.invalidate = _prodInvalidateScopedReads;',
  'this.invalidateFor = _prodInvalidateScopedReadsFor; this.invalidateBatch = _prodInvalidateBatchAssetReads;',
  'this.pillFor = _prodBatchFileFor; this.ensureAssets = _prodEnsureAssets;',
  'this.state = _prodState;',
].join('\n'), ctx);
const S = ctx.state;
['assets', 'descriptions', 'batchFiles', 'batchFilesStatus', 'assetRequestTokens', 'descriptionRequestTokens',
  'labelRequestTokens', 'assigneeOptionRequestTokens', 'assigneeOptions', 'events', 'linearRaw', 'labels', 'writes']
  .forEach(key => { if (!(S[key] instanceof Map)) S[key] = new Map(); });
S.refreshing = false;

/* The stamp the code itself would write: client, NUL, team. It has to be the
   real shape because _prodAssetState compares it against the live row at use
   time, and a made-up stamp would be refused there and prove nothing. */
const STAMP = 'client-a\u0000graphics';
const KEPT = 'https://drive.google.com/file/d/kept';
function landed(id, extra) {
  const st = ctx.assetState(id);
  st.status = 'ready';
  st.complete = true;
  st.assets.deliverable_file = Object.assign({ url: KEPT, state: 'available' }, extra || {});
  st.assets.raw_footage = { url: 'https://www.dropbox.com/scl/fo/old/x', state: 'available', source: '' };
  st.scopeSignature = STAMP;
  return st;
}

// THE REPORTED SEQUENCE. A read landed; the tab is left and returned to.
S.assets.clear();
landed('row-1');
ctx.invalidate();                                   // _prodRefresh, synchronously
let between = ctx.assetState('row-1');
ok(between.status === 'idle' && between.assets.deliverable_file.url === KEPT,
  'pass 1 (from _prodRefresh) keeps the link and marks the read stale, as before');
between.status = 'loading';                          // a render in between re-read it
between.complete = false;
ctx.invalidate();                                   // _prodLoadData, after the swap
const after = S.assets.get('row-1');
ok(!!after && after.assets.deliverable_file.url === KEPT,
  'THE FLICKER: pass 2 (after the projection swap) no longer drops a stamped read just because a re-read was in flight -- the link stays on screen');
ok(after.status === 'idle' && after.complete === false && after.scopeSignature === STAMP,
  'and it is stale, not ready: the next render still re-reads it, under the same stamp');

// What is NOT kept is unchanged: a state that never completed a read.
S.assets.clear();
const never = ctx.assetState('row-1');
never.status = 'loading';
ctx.invalidate();
ok(!S.assets.has('row-1'), 'an unstamped in-flight state is still dropped -- there is nothing on screen worth keeping');

// The use-time gate is what makes keeping it safe, and it still fires.
S.assets.clear();
landed('row-1');
between = ctx.assetState('row-1'); between.status = 'loading'; between.complete = false;
ctx.invalidate();
rows['row-1'] = Object.assign({}, rows['row-1'], { project: 'client-b', authorityProject: 'client-b', storedClientSlug: 'client-b' });
ok(ctx.assetState('row-1').assets.deliverable_file.url === '',
  'a preserved-but-stale read is still refused on sight once its row belongs to another client');
rows['row-1'] = Object.assign({}, rows['row-1'], { project: 'client-a', authorityProject: 'client-a', storedClientSlug: 'client-a' });

/* ---- 4. Executed: the delta tick keeps the value too --------------------- */

S.assets.clear();
landed('row-1');
ctx.invalidateFor(['row-1']);
const ticked = S.assets.get('row-1');
ok(!!ticked && ticked.assets.deliverable_file.url === KEPT && ticked.status === 'idle' && ticked.remoteChanged === true,
  'a changed row keeps its link on screen and is marked stale for the re-read, instead of being deleted');

/* ---- 5. Executed: a batch write patches the rest of the post ------------ */

rows = {
  p: { id: 'p', team: 'video', project: 'client-a', authorityProject: 'client-a', storedClientSlug: 'client-a', batchId: 'bat_mirror' },
  c1: { id: 'c1', parent: 'p', team: 'video', project: 'client-a', authorityProject: 'client-a', storedClientSlug: 'client-a', batchId: 'bat_1' },
  c2: { id: 'c2', parent: 'p', team: 'video', project: 'client-a', authorityProject: 'client-a', storedClientSlug: 'client-a', batchId: 'bat_1' },
  c3: { id: 'c3', parent: 'p', team: 'video', project: 'client-a', authorityProject: 'client-a', storedClientSlug: 'client-a', batchId: 'bat_1' },
};
const VIDEO_STAMP = 'client-a\u0000video';
S.assets.clear();
['p', 'c1', 'c2', 'c3'].forEach(id => { landed(id).scopeSignature = VIDEO_STAMP; });
const editing = S.assets.get('c3'); editing.editing = 'raw_footage'; editing.draft = 'typing';
const NEW = 'https://www.dropbox.com/scl/fo/new/y';
ctx.invalidateBatch(rows.c1, 'c1', 'raw_footage', NEW);
ok(S.assets.get('c1').status === 'ready' && S.assets.get('c1').assets.raw_footage.url !== NEW,
  'the written row is left alone -- its caller re-reads it immediately');
['p', 'c2'].forEach(id => {
  const st = S.assets.get(id);
  ok(!!st && st.assets.raw_footage.url === NEW && st.assets.raw_footage.state === 'checking' && st.status === 'idle',
    id + ': the new link is already in the cached slot as `checking`, and the state is stale so the next open re-reads it');
  ok(st.assets.deliverable_file.url === KEPT && st.assets.deliverable_file.state === 'available',
    id + ': the slots that were not written keep saying what they said');
});
ok(S.assets.get('c3').assets.raw_footage.url !== NEW && S.assets.get('c3').draft === 'typing',
  'a row under edit keeps its draft and its values, as before');

/* ---- 6. Executed: pills survive, and are gated ------------------------- */

S.batchFiles.clear(); S.batchFilesStatus.clear();
S.batchFiles.set('c1', { url: 'https://drive.google.com/file/d/c1', source: '', batchId: 'bat_1', scope: 'client-a' });
S.batchFilesStatus.set('bat_1\u0000client-a', { generation: 1, status: 'ready' });
ctx.invalidate();
ok(S.batchFiles.has('c1') && S.batchFilesStatus.size === 0,
  'a refresh keeps the pill entries and drops the status that makes the parent re-ask');
ok(!!ctx.pillFor('c1', rows.c1), 'the pill is drawn for the row it was answered for');
ok(ctx.pillFor('c1', Object.assign({}, rows.c1, { batchId: 'bat_other' })) === null,
  'and refused once that row sits on another batch row');
ok(ctx.pillFor('c1', Object.assign({}, rows.c1, { authorityProject: 'client-b', storedClientSlug: 'client-b' })) === null,
  'and refused once that row declares another scope');
ok(!!ctx.pillFor('c1', Object.assign({}, rows.c1, { authorityProject: '__needs_attribution__', storedClientSlug: '' })),
  'a row declaring a sentinel was never the scope the request carried, and is judged on the batch alone');

/* ---- 7. Executed: no doomed read during a projection load -------------- */

(async () => {
  S.assets.clear();
  rows = { 'row-1': { id: 'row-1', team: 'graphics', project: 'client-a', authorityProject: 'client-a', storedClientSlug: 'client-a', batchId: 'bat_1' } };
  landed('row-1');
  ctx.invalidate();
  S.refreshing = true;
  let deferred = null, threw = null;
  try { deferred = await ctx.ensureAssets('row-1', false); } catch (e) { threw = e; }
  ok(!threw && deferred && deferred.status === 'idle' && deferred.assets.deliverable_file.url === KEPT,
    'while a projection load is in flight, a stamped idle row returns its held answer and starts no read');
  S.refreshing = false;
  threw = null;
  try { await ctx.ensureAssets('row-1', false); } catch (e) { threw = e; }
  ok(threw && /reached the network path/.test(threw.message),
    'once the load has landed, the same row DOES read (the harness throws at the first network-path call to prove it got there)');
  S.refreshing = true;
  S.assets.clear();
  threw = null;
  try { await ctx.ensureAssets('row-1', false); } catch (e) { threw = e; }
  ok(threw && /reached the network path/.test(threw.message),
    'a row that has never been read is not deferred -- a first paint does not queue behind a background refresh');
  threw = null;
  landed('row-1'); ctx.invalidate();
  try { await ctx.ensureAssets('row-1', true); } catch (e) { threw = e; }
  ok(threw && /reached the network path/.test(threw.message),
    'and a forced read (Refresh access) is never deferred');
  S.refreshing = false;

  console.log(failures === 0
    ? '\nasset refresh holds: all checks passed'
    : '\n' + failures + ' asset refresh check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
