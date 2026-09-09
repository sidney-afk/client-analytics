/**
 * Boot payload diet (ledger item 182, 2026-09-08).
 *
 * The owner reported SyncLinear "sometimes really slow" while every backend
 * read answered in about half a second. The weight was in what the tab pulled:
 * 1,688 batch descriptions (2.3 million characters, about 1 MB compressed) on
 * every open AND on every return to the tab after 30 seconds, plus the whole
 * live projection again, to show one description at a time.
 *
 * Two rules, both checked here against the shipped source and, where a pure
 * function exists, EXECUTED:
 *   1. The boot read of batches carries no description. A batch parent's panel
 *      reads its ONE row on open, over the same browser grant.
 *   2. A return to the tab takes the delta path (rows stamped since the
 *      watermark), not the full reload. Batches ride along on their own
 *      watermark so a new filming day still appears promptly.
 */
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const vm = require('node:vm');


const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function grabFunc(signature) {
  const start = html.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  const end = html.indexOf('\n        }', start) + '\n        }'.length;
  return html.slice(start, end);
}
function constValue(decl) {
  const start = html.indexOf(decl);
  if (start < 0) return '';
  return html.slice(start + decl.length, html.indexOf(';', start)).trim().replace(/^'|'$/g, '');
}

void (async () => {
// ---- 1. the boot select, and the one-row read that replaces it ------------
const bootSelect = constValue("const PROD_BATCH_SELECT = ").split(',');
ok(bootSelect.length > 5 && !bootSelect.includes('description') && !bootSelect.includes('desc'),
  'PROD_BATCH_SELECT no longer asks for the description (' + bootSelect.length + ' columns)');
ok(constValue("const PROD_BATCH_DESCRIPTION_SELECT = ") === 'id,description,updated_at',
  'the per-batch read asks for the description with its stamp, and nothing else');

const ensure = grabFunc('async function _prodEnsureDescription(id, force)');
const branchAt = ensure.indexOf('if (issue.syntheticBatchParent === true) {');
const delegateAt = ensure.indexOf('await _prodEnsureBatchDescription(batchId, force);');
const identityAt = ensure.indexOf('_syncviewStaffIdentityForHeaders()');
ok(branchAt > 0 && delegateAt > branchAt && delegateAt < identityAt,
  'a batch parent DELEGATES to the single owner inside the synthetic branch, before any staff-identity read');
ok(!/_prodReadBatchDescriptionRow\(/.test(ensure),
  'ONE OWNER: the panel no longer runs its own read beside _prodEnsureBatchDescription — that second reader is what produced four separate defects over three review rounds');
ok(!/batchSharedToken/.test(ensure) && !/_prodNextBatchDescriptionToken\(/.test(ensure),
  '...so the shared per-batch token this branch used to take is gone, along with the "which reader owns this entry" question');
ok(!/_prodState\.batchDescriptionReads\.(set|delete)\(/.test(ensure),
  '...and the panel never WRITES the shared read state (it may read it to tell a failure from a not-yet-loaded read), so it cannot strand the direct view');
ok(/_prodAdoptDescriptionValue\(id, batchRow\.description, batchRow\.updated_at\)/.test(ensure),
  'the panel reflects the row the owner wrote, rather than a value it fetched itself');
ok(/panelToken === _prodState\.descriptionRequestTokens\.get\(id\)/.test(ensure)
  && /panelGeneration === _prodState\.projectionGeneration/.test(ensure)
  && /_prodIssueScopeSignature\(live\) === panelScope/.test(ensure),
  'what stays per-panel is still guarded per-panel: token, generation and scope — a split-team batch has two parents sharing one batchId');
{
  const releaseAt = ensure.indexOf('if (!panelStillCurrent()) {');
  const adoptAt = ensure.indexOf('_prodAdoptDescriptionValue(id, batchRow.description');
  ok(releaseAt > 0 && releaseAt < adoptAt && /state\.status = state\.hasValue \? 'stale' : 'idle';/.test(ensure.slice(releaseAt, adoptAt)),
    'a panel displaced while the owner was reading clears its own refreshing flag, so reopening it is not wedged by the guard at the top');
}

// ---- 5. the direct batch view is served too (Codex #1364, P2) ------------
/* `?batch=<id>` renders batch.description straight off the row through
   _prodBatchDetail, and is view 'batch' with openBatchId — never view 'detail'
   with an openId, so _prodEnsureDescription is not reached for it. Dropping the
   column left that view on its skeleton forever. */
/* Anchored on the ensure call, not on the view test: `view === 'batch' &&
   openBatchId` also opens _prodVisibleRowOrder, and slicing from the first
   match asserted against the wrong block. */
const ensureBatchAt = html.indexOf('_prodEnsureBatchDescription(_prodState.openBatchId, false);');
ok(ensureBatchAt > 0, 'the render pass loads the description for the direct batch view');
const guardAt = html.lastIndexOf("if (_prodState.view === 'batch' && _prodState.openBatchId) {", ensureBatchAt);
const guardEnd = html.indexOf('\n            }', guardAt);
ok(guardAt > 0 && guardEnd > ensureBatchAt,
  '...inside the batch-view guard, so no other view pays for the read');
/* It must live in the batch block that follows the detail branch, not in one
   placed ahead of it: test/prod-deep-link-open-id-key.js slices the detail
   branch as detail-start up to the FIRST `view === 'batch'`, so a block above
   the detail branch empties that slice and makes its whole
   canonical-row-id section pass vacuously. That is how the first draft of this
   fix broke a suite it never mentioned. */
const detailBranchAt = html.indexOf("if (_prodState.view === 'detail' && _prodState.openId) {\n                const openRowId = _prodOpenRowId();");
ok(detailBranchAt > 0 && detailBranchAt < guardAt,
  '...and AFTER the detail branch, so the deep-link suite still slices a non-empty detail branch');
{
  const ensureBatch = grabFunc('async function _prodEnsureBatchDescription(batchId, force)');
  const renders = [];
  const ctx = {
    console, Promise, Array, String, Number, JSON,
    _prodHasOwn: (row, key) => !!row && Object.prototype.hasOwnProperty.call(row, key),
    document: { getElementById: () => ({}) },
    _prodRender: () => renders.push(1),
    Set, Map,
    _prodState: { batches: [{ id: 'b1', updated_at: 't1' }], batchDescriptionReads: new Map(), batchDescriptionTokens: new Map(), batchDescriptionInFlight: new Map(), projectionGeneration: 3, adapter: {} },
    /* The owner now asks whether the batch it just loaded is what the reader is
       LOOKING at before repainting; these two feed that question. */
    _prodOpenRowId: () => '',
    _prodIssue: () => null,
    _prodReadBatchDescriptionRow: async () => ctx.__answer(),
  };
  vm.createContext(ctx);
  vm.runInContext(grabFunc('function _prodNextBatchDescriptionToken(batchId)') + '\n'
    + grabFunc('function _prodInvalidateBatchDescriptionReads(batchIds)') + '\n'
    + ensureBatch + '\nthis.ensure = _prodEnsureBatchDescription;', ctx);

  /* Ensure with the batch ON SCREEN. The owner repaints only for the batch the
     reader is looking at, so a test that left the view elsewhere would assert
     "repaints once" against a path that correctly repaints zero times. */
  const ensureVisible = async (batchId, force) => {
    ctx._prodState.view = 'batch';
    ctx._prodState.openBatchId = batchId;
    return ctx.ensure(batchId, force);
  };
  ctx.__answer = () => ({ id: 'b1', description: 'the plan', updated_at: 't2' });
  await ensureVisible('b1', false);
  ok(ctx._prodState.batches[0].description === 'the plan',
    'a successful read writes the column back onto the batch row the view renders');
  ok(ctx._prodState.batches[0].updated_at === 't2',
    '...and advances the row stamp with it, which is the clock _prodGatewayWrite sends as expected_updated_at for the next description save');
  ok(ctx._prodState.adapter === null && renders.length === 1,
    'and invalidates the adapter and repaints exactly once');

  await ensureVisible('b1', false);
  ok(renders.length === 1,
    'TERMINATION: a row that already has the column does not read again, so render -> ensure -> render cannot spin');

  ctx._prodState.batches = [{ id: 'b2', updated_at: 't1' }];
  ctx.__answer = () => { throw new Error('boom'); };
  await ensureVisible('b2', false);
  ok(ctx._prodState.batchDescriptionReads.get('b2') === 'error' && renders.length === 2,
    'a failed read is remembered and repaints once');
  await ensureVisible('b2', false);
  ok(renders.length === 2, 'TERMINATION: and is not retried on every render');
  ctx.__answer = () => ({ id: 'b2', description: 'later', updated_at: 't9' });
  await ensureVisible('b2', true);
  ok(ctx._prodState.batches[0].description === 'later', 'but force (the Retry path) does read again');

  ctx._prodState.batches = [{ id: 'b3', updated_at: 't1' }];
  ctx._prodState.batchDescriptionReads.clear();
  ctx.__answer = () => { ctx._prodState.projectionGeneration = 99; return { id: 'b3', description: 'stale', updated_at: 't2' }; };
  await ensureVisible('b3', false);
  ok(!Object.prototype.hasOwnProperty.call(ctx._prodState.batches[0], 'description'),
    'an answer that lands after the projection moved on is discarded, not written onto a row from another generation');
  ok(!ctx._prodState.batchDescriptionReads.has('b3'),
    '...and RELEASES the read state, because only the generation moved — no newer read owns it, and a stranded "loading" would wedge the batch out of ever loading again');
}

// ---- 5b. a superseded direct-batch read cannot land (Codex #1364, round 2) ----
/* The generation counter is NOT a stand-in for a request token here: it only
   advances in _prodLoadData, never on the operational delta. So a delta that
   moves a batch's stamp mid-read left the generation equal, and the older
   answer wrote its stale text AND its older stamp onto the replacement row --
   which then never refetched, because a row carrying the column looks loaded.
   Permanently stale text, and a corrupted batch watermark with it. Executed,
   with the two reads resolved in the damaging order. */
{
  const ensureBatch = grabFunc('async function _prodEnsureBatchDescription(batchId, force)');
  const helpers = grabFunc('function _prodNextBatchDescriptionToken(batchId)')
    + '\n' + grabFunc('function _prodInvalidateBatchDescriptionReads(batchIds)');
  const gate = {};
  const ctx = {
    console, Promise, Array, String, Number, Set, Map,
    _prodHasOwn: (row, key) => !!row && Object.prototype.hasOwnProperty.call(row, key),
    document: { getElementById: () => ({}) },
    _prodRender: () => {},
    _prodState: {
      batches: [{ id: 'b1', updated_at: 't1' }],
      batchDescriptionReads: new Map(), batchDescriptionTokens: new Map(), batchDescriptionInFlight: new Map(),
            projectionGeneration: 7, adapter: {},
    },
    _prodReadBatchDescriptionRow: (id) => new Promise(resolve => { gate.resolve = gate.resolve || []; gate.resolve.push(resolve); }),
  };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\n' + ensureBatch
    + '\nthis.ensure = _prodEnsureBatchDescription; this.invalidate = _prodInvalidateBatchDescriptionReads;', ctx);

  const readA = ctx.ensure('b1', false);            // read A goes in flight
  ok(ctx._prodState.batchDescriptionReads.get('b1') === 'loading', 'read A is in flight');

  // the delta replaces the row (stamp moved, description dropped) and retires
  // the in-flight read — exactly what _prodMarkBatchDescriptionsStale now does.
  ctx._prodState.batches = [{ id: 'b1', updated_at: 't2' }];
  ctx.invalidate(['b1']);

  const readB = ctx.ensure('b1', false);            // read B starts on the new row
  ok(gate.resolve.length === 2,
    'read B starts a FRESH read rather than joining the one the invalidation just retired — single-flight joins live reads, not dead ones');

  gate.resolve[1]({ id: 'b1', description: 'FRESH', updated_at: 't3' });   // B lands first
  gate.resolve[0]({ id: 'b1', description: 'STALE', updated_at: 't1' });   // A lands after
  await Promise.all([readA, readB]);
  {
    const row = ctx._prodState.batches[0];
    ok(row.description === 'FRESH',
      'THE RACE: the superseded answer does not overwrite the newer text');
    ok(row.updated_at === 't3',
      '...and the winning read is the one whose stamp lands, so the CAS clock follows the text rather than a discarded answer');
    ok(ctx._prodState.batchDescriptionReads.get('b1') === 'ready',
      '...and leaves the newer read owning the state, rather than clearing an entry it no longer owns');
  }
}


// ---- 5e. the owner is the ONLY writer of the shared read state --------------
/* Round six found a synthetic parent replaced mid-read by a real one stranding
   the shared entry on 'loading', which then refused every later direct read.
   That was possible only because two functions wrote that entry. Now one does. */
{
  const writers = [];
  ['async function _prodEnsureBatchDescription(batchId, force)',
   'async function _prodEnsureDescription(id, force)',
   'function _prodSyncBatchDescriptionRow(id, value, updatedAt)',
   'function _prodInvalidateBatchDescriptionReads(batchIds)',
  ].forEach(sig => {
    const src = grabFunc(sig);
    if (/_prodState\.batchDescriptionReads\.(set|delete)\(/.test(src)) writers.push(sig.split('(')[0].replace(/^(async )?function /, ''));
  });
  ok(writers.length === 2
    && writers.includes('_prodEnsureBatchDescription')
    && writers.includes('_prodInvalidateBatchDescriptionReads'),
    'exactly two things write the shared read state — the owner and the shared invalidator — not the panel: ' + writers.join(', '));
  const owner = grabFunc('async function _prodEnsureBatchDescription(batchId, force)');
  ok(/const release = \(\) => \{ if \(tokenCurrent\(\)\) _prodState\.batchDescriptionReads\.delete\(batchId\); \};/.test(owner),
    'and the owner releases that state on the exits where it still owns it');
}

// ---- 5g. the visible Refresh button actually clears a failed read (round 5) ----
/* _prodMarkDescriptionsStale is reached from _prodRefresh, NOT from the topbar
   button: that runs _prodManualRefresh -> _prodDeltaRefresh({full:true}) ->
   _prodLoadData. So an 'error' remembered by a failed batch-description read
   survived the very control offered to clear it, and the batch view kept saying
   "Description could not load." until a page reload. The whole path is walked
   here rather than assumed. */
{
  const manual = grabFunc('function _prodManualRefresh()');
  ok(/_prodDeltaRefresh\(\{ force: true, full: true \}\)/.test(manual),
    'HARNESS: the topbar Refresh really does go through _prodDeltaRefresh({full:true})');
  const delta = grabFunc('async function _prodDeltaRefresh(options)');
  const needsFullAt = delta.indexOf('if (needsFull) {');
  const loadCallAt = delta.indexOf('_prodLoadData({ silent: true })', needsFullAt);
  ok(needsFullAt > 0 && loadCallAt > needsFullAt,
    'HARNESS: ...which reaches _prodLoadData on the full branch');
  ok(!/_prodMarkDescriptionsStale\(\)/.test(manual) && !/_prodMarkDescriptionsStale\(\)/.test(delta),
    'HARNESS: ...and neither of them calls _prodMarkDescriptionsStale, which is why clearing there was not enough');
  const load = html.slice(html.indexOf('_prodState.batches = mergedBatches;'));
  ok(/_prodInvalidateBatchDescriptionReads\(null\);/.test(load.slice(0, 1200)),
    'THE FIX: the full load itself retires every remembered batch-description read, so the Refresh button is a real retry');
}


// ---- 5h. the fast-paint sandbox mirrors every loader dependency -------------
/* THREE separate breaks of test/prod-deep-link-fast-paint.js in this PR came
   from the same place, so it is worth a check rather than a fourth apology.
   That suite runs the REAL _prodLoadData against a hand-built sandbox, so every
   _prod* function the loader calls must exist there. When one does not, the
   loader throws into its own catch and the suite's assertions run against a load
   that never happened -- which reads as a deep-link regression, not a missing
   stub, and costs a cycle to re-diagnose every time. This derives the list from
   the shipped loader instead of trusting anyone to remember.

   (Only FUNCTIONS: _prodState fields the loader merely assigns are harmless
   when absent, since assigning a new property on the sandbox state object is
   not an error.) */
{
  const fastPaint = fs.readFileSync(path.join(ROOT, 'test', 'prod-deep-link-fast-paint.js'), 'utf8');
  const loadStart = html.indexOf('async function _prodLoadData(opts)');
  const loadEnd = html.indexOf('\n        async function _prodLoadEventsFor', loadStart);
  ok(loadStart > 0 && loadEnd > loadStart, 'HARNESS: _prodLoadData is findable and bounded');
  /* The SHARED stripper, not a raw regex. test/comment-strip-is-honest.js
     forbids the naive one for a measured reason: it opens a comment at any
     "/" followed by "*" -- including inside a string or an attribute like
     accept="...,video/*" -- and runs to the next closing delimiter anywhere in
     the file, which once deleted about 64k characters of real index.html and
     made every negative assertion over that region pass vacuously
     (OPEN_REPAIRS 145). It caught this file doing exactly that. */
  const body = stripComments(html.slice(loadStart, loadEnd));
  const called = [...new Set([...body.matchAll(/\b(_prod[A-Za-z0-9_]+)\s*\(/g)].map(m => m[1]))]
    .filter(name => name !== '_prodLoadData');
  ok(called.length > 8, 'HARNESS: the loader really does call a list of helpers (' + called.length + ')');
  const missing = called.filter(name => !new RegExp('\\b' + name + '\\b').test(fastPaint));
  ok(missing.length === 0,
    'every _prod* helper _prodLoadData calls is mirrored in the fast-paint sandbox'
      + (missing.length ? ' — MISSING: ' + missing.join(', ') : ''));
}


// ---- 5i. the owner repaints only for a batch someone is looking at ---------
/* The single-owner redesign first repainted on EVERY completed read, for any
   batch, open or not. A repaint rebuilds the surface, and the description editor
   is a contenteditable — so a background read for an unrelated batch destroyed an
   in-progress edit on the open row along with its caret and focus. The mocked
   browser gate caught it twice at the step that hovers a link in a deliverable's
   editor and expects focus back; the commit before the redesign passes that step
   in the same sandbox, which is how it was told apart from the known flake there.
   A real bug for anyone typing, not a test artifact. */
{
  const owner = grabFunc('async function _prodEnsureBatchDescription(batchId, force)');
  ok(/const visible = \(_prodState\.view === 'batch' && String\(_prodState\.openBatchId \|\| ''\) === batchId\)/.test(owner)
    && /openIssue\.syntheticBatchParent === true && String\(openIssue\.batchId \|\| ''\) === batchId/.test(owner),
    'the owner repaints only for the direct batch view of THIS batch, or a synthetic parent of it');
  ok(/if \(visible && document\.getElementById\('prodRoot'\)\) _prodRender\(\);/.test(owner),
    '...and the visibility test gates the repaint rather than merely being computed');

  const renders = [];
  const ctx = {
    Map, Set, String, Number, Promise, console,
    _prodHasOwn: (row, key) => !!row && Object.prototype.hasOwnProperty.call(row, key),
    document: { getElementById: () => ({}) },
    _prodRender: () => renders.push(1),
    _prodOpenRowId: () => 'open-row',
    _prodIssue: () => ({ id: 'open-row', syntheticBatchParent: false, batchId: 'other' }),
    _prodState: {
      batches: [{ id: 'b1', updated_at: 't1' }],
      batchDescriptionReads: new Map(), batchDescriptionTokens: new Map(), batchDescriptionInFlight: new Map(),
      projectionGeneration: 1, adapter: {},
      view: 'detail', openId: 'open-row', openBatchId: '',
    },
    _prodReadBatchDescriptionRow: async () => ({ id: 'b1', description: 'x', updated_at: 't2' }),
  };
  vm.createContext(ctx);
  vm.runInContext(grabFunc('function _prodNextBatchDescriptionToken(batchId)') + '\n'
    + grabFunc('function _prodInvalidateBatchDescriptionReads(batchIds)') + '\n'
    + owner + '\nthis.ensure = _prodEnsureBatchDescription;', ctx);

  await ctx.ensure('b1', true);
  ok(ctx._prodState.batches[0].description === 'x',
    'a read for a batch nobody has open still writes its state');
  ok(renders.length === 0,
    'THE REGRESSION: but does NOT repaint, so it cannot destroy an in-progress edit on the open row');

  ctx._prodState.batches = [{ id: 'b2', updated_at: 't1' }];
  ctx._prodIssue = () => ({ id: 'open-row', syntheticBatchParent: true, batchId: 'b2' });
  ctx._prodReadBatchDescriptionRow = async () => ({ id: 'b2', description: 'y', updated_at: 't2' });
  await ctx.ensure('b2', true);
  ok(renders.length === 1,
    'and a read for the batch whose synthetic parent IS open does repaint, so the panel still fills');
}


// ---- 5j. concurrent waiters JOIN the read instead of racing past it (round 7) ----
/* The redesign's owner returned immediately when a read was already in flight.
   A second panel's `await` therefore resumed BEFORE the column existed, saw it
   absent, called that a failure, and then refused to retry because its own error
   guard blocked it — "Description could not load." until a manual refresh.
   Reachable with the two synthetic parents of a split-team batch, or by moving
   from ?batch= to its parent mid-read. */
{
  const owner = grabFunc('async function _prodEnsureBatchDescription(batchId, force)');
  ok(/const inFlight = _prodState\.batchDescriptionInFlight\.get\(batchId\);\s*\n\s*if \(inFlight\) return inFlight;/.test(owner),
    'a caller arriving while a read is in the air JOINS that read rather than returning');
  ok(owner.indexOf('if (inFlight) return inFlight;') < owner.indexOf("_prodState.batchDescriptionReads.set(batchId, 'loading')"),
    '...before the read state is claimed, so the join wins over the old loading short-circuit');
  ok(/if \(_prodState\.batchDescriptionInFlight\.get\(batchId\) === run\) \{\s*\n\s*_prodState\.batchDescriptionInFlight\.delete\(batchId\);/.test(owner),
    '...and clears the in-flight entry ONLY when the map still holds this read, so a settling invalidated read cannot evict the fresh one that replaced it');

  const ensureDesc = grabFunc('async function _prodEnsureDescription(id, force)');
  ok(/\} else if \(_prodState\.batchDescriptionReads\.get\(batchId\) === 'error'\) \{/.test(ensureDesc),
    'the delegating panel calls an absent column a FAILURE only when the owner actually recorded one');
  ok(/state\.status = state\.hasValue \? 'stale' : 'idle';/.test(ensureDesc.slice(ensureDesc.indexOf("=== 'error') {"))),
    "...otherwise it lands on 'idle', which the guard at the top does NOT block, so the next render can ask again");

  // Executed: two waiters, one read.
  let reads = 0;
  let resolveRead;
  const ctx = {
    Map, Set, String, Number, Promise, console,
    _prodHasOwn: (row, key) => !!row && Object.prototype.hasOwnProperty.call(row, key),
    document: { getElementById: () => null },
    _prodRender: () => {},
    _prodOpenRowId: () => '',
    _prodIssue: () => null,
    _prodState: {
      batches: [{ id: 'b1', updated_at: 't1' }],
      batchDescriptionReads: new Map(), batchDescriptionTokens: new Map(),
      batchDescriptionInFlight: new Map(),       projectionGeneration: 1, adapter: {}, view: 'detail', openId: '', openBatchId: '',
    },
    _prodReadBatchDescriptionRow: () => { reads++; return new Promise(r => { resolveRead = r; }); },
  };
  vm.createContext(ctx);
  vm.runInContext(grabFunc('function _prodNextBatchDescriptionToken(batchId)') + '\n'
    + grabFunc('function _prodInvalidateBatchDescriptionReads(batchIds)') + '\n'
    + owner + '\nthis.ensure = _prodEnsureBatchDescription;', ctx);

  const first = ctx.ensure('b1', false);
  const second = ctx.ensure('b1', false);      // the second panel, mid-read
  ok(reads === 1, 'THE FIX: two concurrent callers issue ONE network read, not two');
  resolveRead({ id: 'b1', description: 'shared answer', updated_at: 't2' });
  await Promise.all([first, second]);
  ok(ctx._prodState.batches[0].description === 'shared answer',
    '...and both resume only once the answer has landed on the row');
  ok(ctx._prodState.batchDescriptionInFlight.size === 0,
    '...leaving no in-flight entry behind');
}


// ---- 5k. a settling old read does not evict the fresh one (round 8) ---------
/* The classic single-flight bug, and it reads as tidying up: read A is
   invalidated, read B starts and stores its own promise, then A settles and its
   unconditional cleanup evicts B. The next render sees nothing in flight, starts
   C, advances the token, and B's perfectly good answer is discarded — longer
   loading and redundant requests. Executed, in that order. */
{
  const owner = grabFunc('async function _prodEnsureBatchDescription(batchId, force)');
  const settle = [];
  const ctx = {
    Map, Set, String, Number, Promise, console,
    _prodHasOwn: (row, key) => !!row && Object.prototype.hasOwnProperty.call(row, key),
    document: { getElementById: () => null },
    _prodRender: () => {},
    _prodOpenRowId: () => '',
    _prodIssue: () => null,
    _prodState: {
      batches: [{ id: 'b1', updated_at: 't1' }],
      batchDescriptionReads: new Map(), batchDescriptionTokens: new Map(),
      batchDescriptionInFlight: new Map(),       projectionGeneration: 1, adapter: {}, view: 'detail', openId: '', openBatchId: '',
    },
    _prodReadBatchDescriptionRow: () => new Promise(r => settle.push(r)),
  };
  vm.createContext(ctx);
  vm.runInContext(grabFunc('function _prodNextBatchDescriptionToken(batchId)') + '\n'
    + grabFunc('function _prodInvalidateBatchDescriptionReads(batchIds)') + '\n'
    + owner + '\nthis.ensure = _prodEnsureBatchDescription; this.invalidate = _prodInvalidateBatchDescriptionReads;', ctx);

  const readA = ctx.ensure('b1', false);
  ctx.invalidate(['b1']);                       // A is retired, its entry dropped
  const readB = ctx.ensure('b1', false);        // B starts fresh
  ok(settle.length === 2, 'HARNESS: B really did start its own read rather than joining the retired A');
  const bPromise = ctx._prodState.batchDescriptionInFlight.get('b1');
  ok(!!bPromise, 'HARNESS: and B is the read now on record');

  settle[0]({ id: 'b1', description: 'stale', updated_at: 't1' });   // A settles LAST-registered-first
  await readA;
  ok(ctx._prodState.batchDescriptionInFlight.get('b1') === bPromise,
    "THE BUG: A's cleanup does NOT evict B — the map still holds B's read, so the next caller joins it instead of starting a third");

  settle[1]({ id: 'b1', description: 'fresh', updated_at: 't2' });
  await readB;
  ok(ctx._prodState.batches[0].description === 'fresh', "and B's answer is the one that lands");
  ok(ctx._prodState.batchDescriptionInFlight.size === 0, 'and B clears its own entry when it settles');
}



// ---- 5c. the batch delta is GONE, and five findings' worth of state with it ----
/* Five findings on #1364 traced to one added read: a per-batch delta whose
   watermark forced `batches.updated_at` to stop being the CAS clock the gateway
   reads. Removing the read removes the conflict at its source. */
{
  const delta = grabFunc('async function _prodDeltaRefresh(options)');
  ok(!/_prodRestRows\('batches'/.test(delta),
    'the operational delta reads deliverables only — no batch read rides along');
  /* The SHARED stripper. I reached for the raw regex here a second time tonight,
     and test/comment-strip-is-honest.js caught it a second time — it opens a
     comment at any "/" followed by "*", including inside a string or an
     accept="...,video/*" attribute (OPEN_REPAIRS 145). */
  const code = stripComments(html);
  ok(!/batchDeltaCursor|_prodAdvanceBatchDeltaCursor|_prodMergeBatchRows|batchPartialRows|batchDescriptionClocks/.test(code),
    'and every piece of state that read needed is gone: cursor, advancer, batch merge, partial marker, CAS clock');
  const sync = grabFunc('function _prodSyncBatchDescriptionRow(id, value, updatedAt)');
  ok(/if \(updatedAt\) row\.updated_at = updatedAt;/.test(sync),
    'a description write advances the row stamp again, which is what _prodGatewayWrite reads for the CAS');
  const gateway = html.slice(html.indexOf('const batch = _prodBatch(payload.id);'));
  ok(/payload\.expected_updated_at = batchClock\s*\n\s*\|\| \(batch \? String\(batch\.updated_at \|\| ''\) : ''\);/.test(gateway.slice(0, 400)),
    'so the CAS expression is exactly the two-term one that shipped before this PR');
  ok(/if \(fresh\.updated_at\) live\.updated_at = fresh\.updated_at;/.test(
      grabFunc('async function _prodEnsureBatchDescription(batchId, force)')),
    'and the one-row read keeps the row stamp current, so the first save after opening a panel is not guessing');
}

const batchDetail = grabFunc('function _prodBatchDetail(');
ok(/descReadFailed \? 'Description could not load\.' : 'No batch description\.'/.test(batchDetail)
  && /batchDescriptionReads\.get\(String\(batch\.id \|\| ''\)\) === 'error'/.test(batchDetail),
  'and a failed read says so, instead of holding the loading skeleton forever');
ok(/_prodInvalidateBatchDescriptionReads\(null\);/.test(grabFunc('function _prodMarkDescriptionsStale()')),
  'a manual refresh retires every direct-batch read, so a failure is not permanent for the session');
/* The per-batch stale-marker went with the batch delta (5c) — nothing calls it
   now that no delta reports changed batches, so it is deleted rather than left
   as an unreachable helper. The token guard below still earns its place: the
   full load bumps the generation, but a save or an invalidation does not. */
ok(!/_prodMarkBatchDescriptionsStale/.test(html),
  'the per-batch stale marker is gone with the delta that fed it, not left dead in the file');
ok(/token === _prodState\.batchDescriptionTokens\.get\(batchId\)/.test(grabFunc('async function _prodEnsureBatchDescription(batchId, force)')),
  'the read is still gated on a per-batch token, not on the generation alone');

if (failures) { console.error(`\n${failures} boot payload diet check(s) failed`); process.exit(1); }
console.log('\nprod-boot-payload-diet: all ok');
})();
