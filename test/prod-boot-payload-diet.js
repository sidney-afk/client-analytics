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
const readAt = ensure.indexOf('_prodReadBatchDescriptionRow(batchId)');
const identityAt = ensure.indexOf('_syncviewStaffIdentityForHeaders()');
ok(branchAt > 0 && readAt > branchAt && readAt < identityAt,
  'a batch parent reads its own row inside the synthetic branch, before any staff-identity read');
ok(/batchGeneration === _prodState\.projectionGeneration/.test(ensure)
  && /_prodIssueScopeSignature\(live\) === batchScope/.test(ensure)
  && /batchToken === _prodState\.descriptionRequestTokens\.get\(id\)/.test(ensure),
  'and a late answer is discarded on the same three guards as the deliverable path: token, generation, scope');
ok(/_prodSyncBatchDescriptionRow\(id, row\.description, row\.updated_at\);\s*\n\s*_prodAdoptDescriptionValue\(id, row\.description, row\.updated_at\);/.test(ensure),
  'the row is written back into the batch AND adopted into the panel state, so descLoaded and the panel agree');
ok(!/state\.status = 'ready';\s*\n\s*return state;\s*\n\s*\}\s*\n\s*if \(!force/.test(ensure),
  'the old branch, which declared the description ready without ever reading it, is gone');

// ---- 2. the tab return asks for what changed -----------------------------
const listenerStart = html.indexOf('function _prodAutoRefreshOnReturn()');
const listenerSrc = html.slice(listenerStart, html.indexOf('\n        }', listenerStart) + '\n        }'.length);
{
  const calls = [];
  const scope = new Function('_prodState', 'document', '_prodEnabled', '_prodRefreshPolicyDay', '_prodRefresh',
    `let _prodLastAutoRefreshAt = 0;\n${listenerSrc}\nreturn _prodAutoRefreshOnReturn;`);
  const fire = scope({ loaded: true, loading: false, refreshing: false }, { hidden: false }, () => true, () => {}, o => calls.push(o));
  fire();
  ok(calls.length === 1 && calls[0].silent === true && calls[0].incremental === true,
    'the tab-return listener (executed) asks for a silent, INCREMENTAL refresh');
}
const refresh = grabFunc('function _prodRefresh(opts)');
const incrementalAt = refresh.indexOf('if (silent && opts && opts.incremental) {');
const deltaAt = refresh.indexOf('_prodDeltaRefresh({ force: true });');
const fullAt = refresh.indexOf('_prodLoadData({ silent });');
ok(incrementalAt > 0 && deltaAt > incrementalAt && deltaAt < fullAt && refresh.indexOf('return;', deltaAt) < fullAt,
  '_prodRefresh routes an incremental request to _prodDeltaRefresh and returns before the full load');
ok(refresh.indexOf('_prodRefreshAuthority({ silent: true });', incrementalAt) < deltaAt,
  'authority is still re-read on a tab return, so a flipped write gate does not wait for a row to change');

const delta = grabFunc('async function _prodDeltaRefresh(options)');
ok(/'updated_at=gte\.' \+ encodeURIComponent\(watermark\)/.test(delta),
  'the deliverable delta read is unchanged');
ok(/_prodRestRows\('batches', PROD_BATCH_SELECT, 'updated_at=gte\.' \+ encodeURIComponent\(batchWatermark\), 1000, 25, \{ keysetColumn: 'id' \}\)/.test(delta),
  'batches are walked by their own watermark, with the boot select (no description)');
ok(delta.indexOf('_prodState.adapter = _prodAdapter(_prodState);') < delta.indexOf('_prodMarkBatchDescriptionsStale(changedBatchIds);'),
  'changed batches mark their open panel stale AFTER the adapter is rebuilt, which is what _prodIssue reads');

// ---- 3. the two pure merges, executed -----------------------------------
const helpers = [
  grabFunc('function _prodById(rows, key)'),
  grabFunc('function _prodCarryBatchDescriptions(incoming, previous)'),
  grabFunc('function _prodMergeBatchRows(changed)'),
].join('\n');
const hasOwnDecl = html.match(/\n\s*(?:const|function) _prodHasOwn[^\n]*\n/);
ok(!!hasOwnDecl, '_prodHasOwn is findable (harness is not vacuous)');
const ctx = { _prodState: { batches: [] }, console };
vm.createContext(ctx);
vm.runInContext('const _prodHasOwn = (row, key) => !!row && Object.prototype.hasOwnProperty.call(row, key);\n' + helpers
  + '\nthis.carry = _prodCarryBatchDescriptions; this.merge = _prodMergeBatchRows;', ctx);

{
  const prior = [{ id: 'b1', updated_at: 't1', description: 'held' }, { id: 'b2', updated_at: 't1', description: 'old' }];
  const out = ctx.carry([{ id: 'b1', updated_at: 't1' }, { id: 'b2', updated_at: 't2' }, { id: 'b3', updated_at: 't1' }, { id: 'b4', updated_at: 't1', description: 'fresh' }], prior);
  ok(out[0].description === 'held', 'full load: a held description survives while the stamp is unchanged');
  ok(!Object.prototype.hasOwnProperty.call(out[1], 'description'), 'full load: a moved stamp drops the held text, so the panel reads it again');
  ok(!Object.prototype.hasOwnProperty.call(out[2], 'description'), 'full load: a batch never seen carries nothing');
  ok(out[3].description === 'fresh', 'full load: a row that arrives with a description keeps its own');
}
{
  ctx._prodState.batches = [{ id: 'b1', updated_at: 't1', description: 'held' }, { id: 'b2', updated_at: 't1', description: 'old' }];
  const changed = ctx.merge([{ id: 'b1', updated_at: 't1' }, { id: 'b2', updated_at: 't2' }, { id: 'b3', updated_at: 't3' }]);
  const byId = Object.fromEntries(ctx._prodState.batches.map(r => [r.id, r]));
  ok(JSON.stringify(changed) === JSON.stringify(['b2', 'b3']), 'delta: only rows whose stamp moved, or new rows, count as changed');
  ok(byId.b1.description === 'held', 'delta: an unchanged row keeps the description it already held');
  ok(!Object.prototype.hasOwnProperty.call(byId.b2, 'description'), 'delta: a moved row arrives without one');
  ok(Object.keys(byId).length === 3, 'delta: a new batch joins the set');
  ok(ctx.merge([]).length === 0 && ctx.merge(null).length === 0, 'delta: an empty or absent answer changes nothing');
}

// ---- 4. the one-row read TERMINATES (Codex #1364, P1) --------------------
/* The first version of this change called _prodRestRows with pageSize 1 and
   maxPages 1. The helper only returns when a page comes back SHORTER than the
   page size, so an exact one-row match filled the only page and fell out of the
   loop into `read exceeded pagination cap` — every batch-parent description
   read threw, and the panel said "Description could not load." The wiring
   assertions above all passed while that was true, which is exactly why this
   section EXECUTES the real pager instead of reading it. */
const restRowsSrc = grabFunc('async function _prodRestRows(table, select, params, pageSize, maxPages, options)');
function runPager(pageSize, maxPages, rowCount) {
  const ctx = {
    CAL_SUPABASE_URL: 'https://x', CAL_SUPABASE_ANON_KEY: 'k', console, Promise, Array, String, Number, Math, encodeURIComponent,
    _prodRestPage: async () => Array.from({ length: rowCount }, (_, i) => ({ id: 'b' + i })),
  };
  vm.createContext(ctx);
  vm.runInContext(restRowsSrc + '\nthis.run = _prodRestRows;', ctx);
  return ctx.run('batches', 'id,description,updated_at', 'id=eq.b0', pageSize, maxPages);
}
{
  let threw = '';
  try { await runPager(1, 1, 1); } catch (e) { threw = String(e && e.message || e); }
  ok(/exceeded pagination cap/.test(threw),
    'HARNESS: the old arguments (pageSize 1, maxPages 1) really do throw on an exact one-row match — this test can fail for the reason it names');
}
{
  const rows = await runPager(1000, 1, 1);
  ok(Array.isArray(rows) && rows.length === 1,
    'the shipped arguments (pageSize 1000, maxPages 1) RETURN the single row instead of throwing');
}
const readRow = grabFunc('async function _prodReadBatchDescriptionRow(batchId)');
ok(/_prodRestRows\('batches', PROD_BATCH_DESCRIPTION_SELECT, 'id=eq\.' \+ encodeURIComponent\(batchId\), 1000, 1\)/.test(readRow),
  'and the shipped call site uses exactly those arguments');
ok(grabFunc('async function _prodEnsureDescription(id, force)').includes('_prodReadBatchDescriptionRow(batchId)'),
  'the synthetic parent panel goes through the one shared reader, so it cannot drift from the batch view');

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
    _prodState: { batches: [{ id: 'b1', updated_at: 't1' }], batchDescriptionReads: new Map(), batchDescriptionTokens: new Map(), projectionGeneration: 3, adapter: {} },
    _prodReadBatchDescriptionRow: async () => ctx.__answer(),
  };
  vm.createContext(ctx);
  vm.runInContext(grabFunc('function _prodNextBatchDescriptionToken(batchId)') + '\n'
    + grabFunc('function _prodInvalidateBatchDescriptionReads(batchIds)') + '\n'
    + ensureBatch + '\nthis.ensure = _prodEnsureBatchDescription;', ctx);

  ctx.__answer = () => ({ id: 'b1', description: 'the plan', updated_at: 't2' });
  await ctx.ensure('b1', false);
  ok(ctx._prodState.batches[0].description === 'the plan' && ctx._prodState.batches[0].updated_at === 't2',
    'a successful read writes the column back onto the batch row the view renders');
  ok(ctx._prodState.adapter === null && renders.length === 1,
    'and invalidates the adapter and repaints exactly once');

  await ctx.ensure('b1', false);
  ok(renders.length === 1,
    'TERMINATION: a row that already has the column does not read again, so render -> ensure -> render cannot spin');

  ctx._prodState.batches = [{ id: 'b2', updated_at: 't1' }];
  ctx.__answer = () => { throw new Error('boom'); };
  await ctx.ensure('b2', false);
  ok(ctx._prodState.batchDescriptionReads.get('b2') === 'error' && renders.length === 2,
    'a failed read is remembered and repaints once');
  await ctx.ensure('b2', false);
  ok(renders.length === 2, 'TERMINATION: and is not retried on every render');
  ctx.__answer = () => ({ id: 'b2', description: 'later', updated_at: 't9' });
  await ctx.ensure('b2', true);
  ok(ctx._prodState.batches[0].description === 'later', 'but force (the Retry path) does read again');

  ctx._prodState.batches = [{ id: 'b3', updated_at: 't1' }];
  ctx._prodState.batchDescriptionReads.clear();
  ctx.__answer = () => { ctx._prodState.projectionGeneration = 99; return { id: 'b3', description: 'stale', updated_at: 't2' }; };
  await ctx.ensure('b3', false);
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
      batchDescriptionReads: new Map(), batchDescriptionTokens: new Map(),
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
  ok(gate.resolve.length === 2, 'read B started beside it');

  gate.resolve[1]({ id: 'b1', description: 'FRESH', updated_at: 't3' });   // B lands first
  gate.resolve[0]({ id: 'b1', description: 'STALE', updated_at: 't1' });   // A lands after
  await Promise.all([readA, readB]);
  {
    const row = ctx._prodState.batches[0];
    ok(row.description === 'FRESH',
      'THE RACE: the superseded answer does not overwrite the newer text');
    ok(row.updated_at === 't3',
      '...and does not write its older stamp back, which would corrupt the batch delta watermark');
    ok(ctx._prodState.batchDescriptionReads.get('b1') === 'ready',
      '...and leaves the newer read owning the state, rather than clearing an entry it no longer owns');
  }
}


// ---- 5c. the two readers share ONE token domain (Codex #1364, round 3) ----
/* The synthetic parent panel (keyed by ISSUE id) and the direct ?batch= view
   (keyed by BATCH id) write the SAME batch row. A token that retires only its
   own domain lets the other domain's older answer land on top of a newer one --
   and, through the save path, silently revert text the user just committed. */
{
  const ensureDesc = grabFunc('async function _prodEnsureDescription(id, force)');
  ok(/const batchSharedToken = _prodNextBatchDescriptionToken\(batchId\);/.test(ensureDesc)
    && /batchSharedToken === _prodState\.batchDescriptionTokens\.get\(batchId\)/.test(ensureDesc),
    'the synthetic parent read takes AND checks the shared per-batch token, so it retires and is retired by the direct read');
  const sync = grabFunc('function _prodSyncBatchDescriptionRow(id, value, updatedAt)');
  ok(/_prodNextBatchDescriptionToken\(batchId\);/.test(sync),
    'and every write to a batch row (optimistic, committed save, both conflict restores) retires an in-flight direct read, so a save cannot be reverted by a read that started before it');
  ok(!/batchDescriptionReads\.delete/.test(sync),
    '...the token only — the read state belongs to whichever reader owns it');
}
{
  // Executed: a read in flight is retired by a save landing first.
  const helpers = grabFunc('function _prodNextBatchDescriptionToken(batchId)');
  const ctx = { Map, Number, String, _prodState: { batchDescriptionTokens: new Map() } };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\nthis.next = _prodNextBatchDescriptionToken;', ctx);
  const readToken = ctx.next('b1');
  const saveToken = ctx.next('b1');
  ok(readToken !== saveToken && ctx._prodState.batchDescriptionTokens.get('b1') === saveToken,
    'tokens only ever advance, so a token held across a retirement cannot collide with a fresh one');
}

// ---- 5d. the batch delta cursor is server truth (Codex #1364, round 3) ----
/* The cursor was recomputed from local rows, and a point read or a description
   save writes a fresh `updated_at` onto ONE row. That jumped the cursor past
   any batch changed in between, hiding it until the ten-minute reconcile. */
{
  const delta = grabFunc('async function _prodDeltaRefresh(options)');
  ok(/const batchWatermark = _prodState\.batchDeltaCursor;/.test(delta),
    'the batch delta reads its own cursor, not a watermark recomputed from mutated rows');
  ok(delta.indexOf('_prodAdvanceBatchDeltaCursor(batchRows);') < delta.indexOf('_prodMergeBatchRows(batchRows)'),
    '...advanced from the server answer BEFORE the merge lets a local value near those rows');
  const load = html.slice(html.indexOf('_prodState.batches = mergedBatches;'));
  ok(/_prodAdvanceBatchDeltaCursor\(batches\);/.test(load.slice(0, 300)),
    '...and seeded on a full load from the RAW server rows, not the merged ones');

  const advance = grabFunc('function _prodAdvanceBatchDeltaCursor(rows)');
  const ctx = {
    Date, Number, String, Array,
    _prodState: { batchDeltaCursor: '' },
    _prodRowUpdatedMs: (row) => { const v = Date.parse(String(row && row.updated_at || '')); return Number.isFinite(v) ? v : -1; },
  };
  vm.createContext(ctx);
  vm.runInContext(grabFunc('function _prodDeliverableWatermark(rows)') + '\n' + advance
    + '\nthis.advance = _prodAdvanceBatchDeltaCursor;', ctx);
  ctx.advance([{ updated_at: '2026-09-01T00:00:00+00:00' }, { updated_at: '2026-09-03T00:00:00+00:00' }]);
  ok(ctx._prodState.batchDeltaCursor === '2026-09-03T00:00:00+00:00', 'the cursor takes the newest stamp in a server answer');
  ctx.advance([{ updated_at: '2026-09-02T00:00:00+00:00' }]);
  ok(ctx._prodState.batchDeltaCursor === '2026-09-03T00:00:00+00:00',
    'THE BUG: and never moves BACKWARDS, so an older answer cannot rewind the delta');
  ctx.advance([]);
  ok(ctx._prodState.batchDeltaCursor === '2026-09-03T00:00:00+00:00', 'an empty answer leaves it alone');
  ctx.advance([{ updated_at: 'not a date' }]);
  ok(ctx._prodState.batchDeltaCursor === '2026-09-03T00:00:00+00:00', 'and an unparseable stamp cannot poison it');
}

const batchDetail = grabFunc('function _prodBatchDetail(');
ok(/descReadFailed \? 'Description could not load\.' : 'No batch description\.'/.test(batchDetail)
  && /batchDescriptionReads\.get\(String\(batch\.id \|\| ''\)\) === 'error'/.test(batchDetail),
  'and a failed read says so, instead of holding the loading skeleton forever');
ok(/_prodInvalidateBatchDescriptionReads\(null\);/.test(grabFunc('function _prodMarkDescriptionsStale()')),
  'a manual refresh retires every direct-batch read, so a failure is not permanent for the session');
ok(/_prodInvalidateBatchDescriptionReads\(Array\.from\(targets\)\)/.test(grabFunc('function _prodMarkBatchDescriptionsStale(batchIds)')),
  'and a batch whose stamp moved in the delta retires its read so the view re-reads');
ok(/token === _prodState\.batchDescriptionTokens\.get\(batchId\)/.test(grabFunc('async function _prodEnsureBatchDescription(batchId, force)')),
  'the read is gated on a per-batch token, not on the generation alone — the delta never advances the generation');

if (failures) { console.error(`\n${failures} boot payload diet check(s) failed`); process.exit(1); }
console.log('\nprod-boot-payload-diet: all ok');
})();
