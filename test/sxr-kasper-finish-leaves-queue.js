'use strict';
/*
 * Owner decision 2026-09-27: when Kasper sends a sample back with a change
 * request and clicks "Finish reviewing", the sample LEAVES his queue (and its
 * count). It comes back only when the editor sends a new version, which puts a
 * component back at Kasper Approval. Before he clicks Finish, nothing changes.
 *
 * Run:  node test/sxr-kasper-finish-leaves-queue.js   (exit 0 = all good)
 *
 * Pulls the REAL queue load, Finish handler and predicates out of ../index.html
 * and drives them against stubbed fetches. On the old code the finished
 * sample stayed in _sxrKasperState.items (the "Tweaks pending" group).
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  let at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  const isAsync = INDEX.slice(at - 6, at) === 'async ';
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return (isAsync ? 'async ' : '') + INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

const REAL = [
  '_sxrCompHasUnresolvedKasperTweak', '_sxrCompKasperVisible', '_sxrPostKasperVisible',
  '_sxrKasperFindItem', '_sxrKasperUndecidedComps', '_sxrKasperPostHasUnresolvedKasperTweak',
  '_sxrKasperLatestMsgAt', '_sxrKasperIsFinished', '_sxrKasperIsClosed', '_sxrKasperPartitionItems',
  '_sxrKasperAppendFinishLog', '_sxrKasperHistoryEntryFromPost', '_sxrKasperRecordHistory',
  '_sxrKasperLoadQueue', '_sxrKasperDismiss',
].map(grabFunc).join('\n\n');

const HARNESS = `
const SXR_REVIEW_COMPONENTS = ['video', 'graphic'];
const _sxrKasperState = { items: [], dismissed: {}, closed: {}, history: [], loading: false, loaded: false };
let ROWS = [];
const persisted = [];
async function _sxrKasperFetchAllSamples() { return JSON.parse(JSON.stringify(ROWS)); }
async function _kasperLoadSMMMap() { return new Map(); }
function _sxrNormStatus(s) { return String(s || ''); }
function _sxrMigrateShape() {}
function wlCanonicalClient(s) { return s; }
function wlNormalizeClient(s) { return s; }
function _sxrCommentsFor(p, c) { return p[c + '_comments'] || []; }
function _sxrMsgIsTweak(m) { return !!m.is_tweak; }
function _calCompLinked(p, c) { return c !== 'graphic' || !!p.graphic_linked; }
function _calKasperUrgentActive() { return false; }
function _sxrKasperRenderQueue() {}
function _kasperMarkSeenAt() {}
let failOnce = false;
function _sxrKasperPersist(it, patch) { if (failOnce) { failOnce = false; return Promise.reject(new Error('x')); } persisted.push(patch); return Promise.resolve(); }
const _kasperState = { sxrRepairs: [] };
function setTimeout() {}
`;

const mod = new Function(HARNESS + REAL + `
return { S: _sxrKasperState, setRows: r => { ROWS = r; }, load: _sxrKasperLoadQueue,
  finish: _sxrKasperDismiss, failNext: () => { failOnce = true; }, part: _sxrKasperPartitionItems, persisted };`)();

let failures = 0;
function check(label, got, want) {
  const ok = got === want; if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
const ids = () => mod.S.items.map(it => it.post.id).sort().join(',');
const openCount = () => { const p = mod.part(mod.S.items); return p.urgent.length + p.waiting.length; };
const tweak = { id: 'c1', role: 'kasper', is_tweak: true, done: false, body: 'change', created_at: '2026-09-27T10:00:00Z' };

(async () => {
  // A sample Kasper sent back (video Tweaks Needed with his open change
  // request) plus one untouched sample waiting for him.
  const sentBack = { id: 's_back', client: 'test', status: 'Tweaks Needed', video_status: 'Tweaks Needed', video_comments: [tweak] };
  const waiting = { id: 's_wait', client: 'test', status: 'Kasper Approval', video_status: 'Kasper Approval' };
  mod.setRows([sentBack, waiting]);
  await mod.load();
  check('before Finish: the sent-back sample is still in his queue', ids(), 's_back,s_wait');
  check('before Finish: it still counts', openCount(), 2);

  mod.finish('s_back');
  check('after Finish: it leaves his queue at once', ids(), 's_wait');
  check('after Finish: the count drops to 1', openCount(), 1);
  check('the finish stamp is persisted', !!(mod.persisted[0] && mod.persisted[0].kasper_finished_at), true);

  // A refresh reads the stamped row back: it must stay gone.
  const stamped = Object.assign({}, sentBack, { kasper_finished_at: mod.persisted[0].kasper_finished_at });
  mod.setRows([stamped, waiting]);
  await mod.load();
  check('after a refresh: still gone', ids(), 's_wait');

  // Stamp not saved yet (same-device flag only): a refresh keeps it gone too.
  mod.setRows([sentBack, waiting]);
  await mod.load();
  check('refresh before the stamp lands: still gone (local flag kept)', ids(), 's_wait');

  // The editor sends a new version: video goes back to Kasper Approval.
  mod.setRows([Object.assign({}, stamped, { video_status: 'Kasper Approval', status: 'Kasper Approval' }), waiting]);
  await mod.load();
  check('new version sent: the sample is back in his queue', ids(), 's_back,s_wait');
  check('and it counts again', openCount(), 2);

  // Approving everything still works as before (leaves the queue, goes to history).
  const clean = { id: 's_ok', client: 'test', status: 'Client Approval', video_status: 'Client Approval', video_comments: [] };
  mod.S.items.push({ post: clean, slug: 'test', client: 'test' });
  mod.finish('s_ok');
  check('clean approve: leaves the queue as today', mod.S.items.some(it => it.post.id === 's_ok'), false);
  check('clean approve: recorded in approved history', mod.S.history[0] && mod.S.history[0].id, 's_ok');

  // A finish whose stamp fails to save must not hide the sample for good.
  mod.S.dismissed = {};
  mod.setRows([sentBack]);
  await mod.load();
  mod.failNext();
  mod.finish('s_back');
  await new Promise(r => setImmediate(r));
  mod.setRows([Object.assign({}, sentBack, { video_status: 'Kasper Approval' })]);
  await mod.load();
  check('stamp failed to save: a new version still shows', ids(), 's_back');

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nAll sxr-kasper-finish-leaves-queue checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
