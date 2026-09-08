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

// ---- 1. the boot select, and the one-row read that replaces it ------------
const bootSelect = constValue("const PROD_BATCH_SELECT = ").split(',');
ok(bootSelect.length > 5 && !bootSelect.includes('description') && !bootSelect.includes('desc'),
  'PROD_BATCH_SELECT no longer asks for the description (' + bootSelect.length + ' columns)');
ok(constValue("const PROD_BATCH_DESCRIPTION_SELECT = ") === 'id,description,updated_at',
  'the per-batch read asks for the description with its stamp, and nothing else');

const ensure = grabFunc('async function _prodEnsureDescription(id, force)');
const branchAt = ensure.indexOf('if (issue.syntheticBatchParent === true) {');
const readAt = ensure.indexOf("_prodRestRows('batches', PROD_BATCH_DESCRIPTION_SELECT, 'id=eq.' + encodeURIComponent(batchId), 1, 1)");
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

if (failures) { console.error(`\n${failures} boot payload diet check(s) failed`); process.exit(1); }
console.log('\nprod-boot-payload-diet: all ok');
