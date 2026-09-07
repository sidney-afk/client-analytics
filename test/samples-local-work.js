'use strict';
// Actual browser functions with fictional data and a held, intercepted writer.
// No HTTP, credentials, external processes or production mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setup, row, response } = require('./samples-authoritative-read');
const { extractFunction } = require('./helpers/extract-function');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function writerFixture(source = html) {
  const f = setup(source), { s } = f;
  const writes = [], pending = [];
  let principal = 'fixture-actor-a', sequence = 0;
  Object.assign(s, {
    _writeUiPrincipalKey: () => principal,
    _sxrMintId: () => 'fixture-new-' + (++sequence), _sxrPromoteBlankCard() {},
    _calShouldBumpThumbRevForGraphicStatus: () => false, _sxrSetCardStatus() {},
    _writeUiApplyOverallStatus() {}, _sxrStringifyComments: JSON.stringify,
    _sxrCommentsFor: () => [], SXR_REVIEW_COMPONENTS: ['video', 'graphic'],
    _calStripThumbnailFolderFields() {}, _sxrApplyClearSentinels() {},
    _writeUiFailureSentence: () => 'Synthetic save failure',
    _writeUiCompleteSourceRepairRefs: async () => false,
    _SXR_ROLLBACK_FIELDS: ['video_status', 'graphic_status'],
    _sxrUpsertFetchPinned: (slug, body) => {
      writes.push(JSON.parse(JSON.stringify({ slug, body })));
      return new Promise(resolve => pending.push(ok => resolve(response(ok ? { ok: true, sample: { ...body.sample, client: slug } } : {}, ok ? 200 : 500))));
    },
  });
  for (const name of ['_sxrFlushCardSave', '_sxrAwaitCardSave', '_sxrRetrySave', '_sxrOnFieldBlur', '_sxrFlushAllPending']) {
    vm.runInContext((['_sxrFlushCardSave', '_sxrAwaitCardSave'].includes(name) ? 'async ' : '') + extractFunction(source, name), s);
  }
  const type = (id, value) => s._sxrOnFieldInput({ dataset: { pid: id, fld: 'name' }, value });
  const draft = name => { const post = s._sxrBlankSample(); s.sxrState.posts.push(post); if (name) type(post.id, name); return post.id; };
  const load = async (client, rows = []) => {
    s.sxrState.client = client;
    s.fetch = async () => response(rows);
    await s.loadSxrCards({ skipCache: true });
  };
  return { ...f, writes, pending, type, draft, load, actor: value => { principal = value; } };
}
const ids = posts => Array.from(posts, p => p.id);
const work = f => [...f.storage.entries()].filter(([k]) => k.startsWith('syncview_sxr_work_v1:'));
const cloneStorage = (from, to) => { for (const [k,v] of from.storage) to.storage.set(k,v); };
async function run(source = html) {
  let passed = 0;
  const test = async (label, body) => { await body(); passed++; console.log('PASS ' + label); };
  for (const success of [false, true]) await test('held ' + (success ? 'success' : 'failure') + ' after client switch stays in originating client', async () => {
    const f = writerFixture(source), { s } = f;
    const id = f.draft('Unfinished fictional draft');
    const save = s._sxrFlushCardSave(id);
    await f.load('fixture-a');
    assert.equal(s.sxrState.posts[0].name, 'Unfinished fictional draft');
    assert.equal(JSON.parse(f.storage.get(f.key)).posts.length, 0, 'authoritative cache contains server rows only');
    await f.load('fixture-b', [row('fixture-new-1', 'fixture-b')]);
    const cacheB = f.storage.get('syncview_sxr_cache_v2_fixture-b');
    f.pending.shift()(success); await save;
    assert.equal(s.sxrState.posts[0].client, 'fixture-b');
    assert.equal(f.storage.get('syncview_sxr_cache_v2_fixture-b'), cacheB);
    const cacheA = JSON.parse(f.storage.get(f.key));
    assert.ok(cacheA.posts.every(p => p.client === 'fixture-a'), 'late A response never caches B');
    s.sxrState.client = 'fixture-a'; s.sxrState.posts = [];
    s.fetch = async () => response({}, 500); await s.loadSxrCards();
    assert.equal(s.sxrState.posts.length, 1, 'return to A retains its held-save content');
    assert.equal(s.sxrState.posts[0].name, 'Unfinished fictional draft');
    if (!success) {
      assert.ok(s.sxrState.posts[0]._saveError);
      const fresh = writerFixture(source); cloneStorage(f, fresh);
      await fresh.load('fixture-a');
      assert.equal(fresh.s.sxrState.posts[0].name, 'Unfinished fictional draft', 'fresh context recovers text');
      const retry = fresh.s._sxrRetrySave('fixture-new-1');
      assert.equal(fresh.writes[0].body.sample.client, 'fixture-a', 'new-row retry remains a whole card');
      fresh.pending.shift()(true); await retry;
      assert.equal(work(fresh).length, 0, 'acknowledged exact draft is retired');
    } else assert.equal(work(f).length, 0);
  });
  await test('blank, debounce and failed-new drafts survive reload without auto-writing', async () => {
    const f = writerFixture(source); const blank = f.draft(); const typed = f.draft('Typed during debounce');
    await f.load('fixture-a');
    assert.deepEqual(ids(f.s.sxrState.posts), [blank, typed]);
    assert.ok([...f.timers.values()].some(t => t.ms === 650));
    const fresh = writerFixture(source); cloneStorage(f, fresh); await fresh.load('fixture-a');
    assert.equal(fresh.s.sxrState.posts.length, 2); assert.equal(fresh.writes.length, 0);
    assert.equal(fresh.s.sxrState.posts.find(p => p.id === typed).name, 'Typed during debounce');
    assert.ok(fresh.s.sxrState.posts.find(p => p.id === typed)._saveError);
  });
  await test('late success cannot retire typing made while saving', async () => {
    const f = writerFixture(source), id = f.draft('First text');
    const save = f.s._sxrFlushCardSave(id);
    f.type('fixture-new-1', 'Newer text');
    await f.load('fixture-b'); f.pending.shift()(true); await save;
    const fresh = writerFixture(source); cloneStorage(f, fresh); await fresh.load('fixture-a');
    assert.equal(fresh.s.sxrState.posts[0].name, 'Newer text');
    assert.equal(f.writes.length, 1, 'switch never sends a trailing batch against another view');
    const retry = fresh.s._sxrRetrySave('fixture-new-1');
    assert.equal(fresh.writes[0].body.sample.name, 'Newer text'); fresh.pending.shift()(true); await retry;
    assert.equal(work(fresh).length, 0);
  });
  await test('same client and colliding IDs remain isolated by signed-in actor', async () => {
    const f = writerFixture(source), a = f.draft('Actor A text');
    const savingA = f.s._sxrFlushCardSave(a);
    f.actor('fixture-actor-b'); await f.load('fixture-a');
    assert.deepEqual(ids(f.s.sxrState.posts), []);
    f.s._sxrMintId = () => 'fixture-new-1';
    const b = f.draft('Actor B text'); const savingB = f.s._sxrFlushCardSave(b);
    f.pending.shift()(false); await savingA;
    assert.equal(f.s.sxrState.posts[0].name, 'Actor B text');
    assert.ok(f.s._sxrSaveInFlight['fixture-new-1'], 'old callback cannot release B lock');
    f.pending.shift()(false); await savingB;
    const fresh = writerFixture(source); cloneStorage(f, fresh);
    fresh.actor('fixture-actor-b'); await fresh.load('fixture-a'); assert.equal(fresh.s.sxrState.posts[0].name, 'Actor B text');
    fresh.actor('fixture-actor-a'); await fresh.load('fixture-a'); assert.equal(fresh.s.sxrState.posts[0].name, 'Actor A text');
  });
  await test('legacy mixed cache salvages scoped rows and preserves unattributable bytes privately', async () => {
    const f = writerFixture(source);
    const raw = JSON.stringify({ at: Date.now(), posts: [row('saved'), { id: '__sxrblank__old', name: 'Unknown author draft' }] });
    f.storage.set(f.key, raw); f.s.fetch = async () => response({}, 500);
    await f.s.loadSxrCards(); assert.deepEqual(ids(f.s.sxrState.posts), ['saved']);
    assert.equal(f.storage.get(f.key), raw); assert.equal(f.effects.stale, true);
    await f.load('fixture-a');
    assert.deepEqual(JSON.parse(f.storage.get('syncview_sxr_legacy_work_v1:fixture-a')), [raw]);
    assert.deepEqual(ids(f.s.sxrState.posts), []); assert.equal(work(f).length, 0, 'unknown ownership is not invented');
  });
  await test('storage failure keeps memory and prior bytes, warns, and can be retried', async () => {
    const f = writerFixture(source); const notice = { hidden: true };
    f.s.document.getElementById = () => notice;
    const id = f.draft('Before quota'); const prior = work(f)[0][1];
    const set = f.s.localStorage.setItem;
    f.s.localStorage.setItem = () => { throw new Error('synthetic quota'); };
    f.type(id, 'After quota'); assert.equal(notice.hidden, false);
    assert.equal(work(f)[0][1], prior);
    await f.load('fixture-b'); await f.load('fixture-a');
    assert.equal(f.s.sxrState.posts[0].name, 'After quota');
    f.s.localStorage.setItem = set; f.s._sxrWorkCheckpointView();
    assert.equal(notice.hidden, true); assert.match(work(f)[0][1], /After quota/);
  });
  await test('same-ID server recovery cannot overwrite a local edit or lose its ownership', async () => {
    const f = writerFixture(source); await f.load('fixture-a', [row('saved')]);
    f.type('saved', 'Pending edit'); await f.load('fixture-a', [row('saved')]);
    assert.equal(f.s.sxrState.posts[0].name, 'Pending edit');
    await f.load('fixture-b'); await f.load('fixture-a', [row('saved')]);
    assert.equal(f.s.sxrState.posts[0].name, 'Pending edit');
  });
  await test('empty blur stays a blank draft and explicit local archive removes recovery', async () => {
    const f = writerFixture(source), id = f.draft();
    f.s._sxrOnFieldBlur({ dataset: { pid: id, fld: 'name' }, value: '' });
    const fresh = writerFixture(source); cloneStorage(f, fresh); await fresh.load('fixture-a');
    assert.equal(fresh.s.sxrState.posts[0]._saveError, undefined);
    Object.assign(fresh.s, { _isClientLink: false, showConfirm: (_title,_body,yes) => yes(), _sxrArchivedAdd() {} });
    vm.runInContext(extractFunction(source, 'archiveSxrCard'), fresh.s);
    fresh.s.archiveSxrCard(id);
    assert.equal(work(fresh).length, 0); await fresh.load('fixture-a');
    assert.equal(fresh.s.sxrState.posts.length, 0); assert.equal(fresh.writes.length, 0);
  });
  await test('recovered local work still applies both teams native-authority filter', async () => {
    const f = writerFixture(source), id = f.draft('Owned text');
    const post = f.s.sxrState.posts[0]; post.linear_issue_id = 'fictional-video'; post.graphic_linear_issue_id = 'fictional-graphic';
    f.type(id, 'Owned text');
    const fresh = writerFixture(source); cloneStorage(f,fresh);
    fresh.s._writeUiAuthoritySnapshot = () => ({ video: 'syncview', graphics: 'syncview' });
    vm.runInContext(extractFunction(source, '_writeUiFilterCachedPosts'), fresh.s);
    await fresh.load('fixture-a');
    assert.equal(fresh.s.sxrState.posts[0].name, 'Owned text');
    assert.equal(fresh.s.sxrState.posts[0].linear_issue_id, '');
    assert.equal(fresh.s.sxrState.posts[0].graphic_linear_issue_id, '');
  });
  await test('changed recovery bytes are never blindly overwritten or removed', async () => {
    const f = writerFixture(source), id = f.draft('Local tab text');
    const [key,value] = work(f)[0]; const other = { ...JSON.parse(value), revision: 'another-tab-revision' };
    f.storage.set(key, JSON.stringify(other));
    f.type(id, 'New local text');
    assert.equal(f.storage.get(key), JSON.stringify(other));
    assert.equal(f.s.sxrState.posts[0].name, 'New local text');
    assert.equal(f.s._sxrWorkCheckpointView(), false, 'conflict leaves an honest storage warning');
  });
  await test('recovered name edit does not conceal an unrelated native status update', async () => {
    const f = writerFixture(source); await f.load('fixture-a', [{ ...row('saved'), video_status: 'In Progress' }]);
    f.type('saved', 'Unfinished name');
    const fresh = writerFixture(source); cloneStorage(f,fresh);
    await fresh.load('fixture-a', [{ ...row('saved'), video_status: 'Approved' }]);
    assert.equal(fresh.s.sxrState.posts[0].name, 'Unfinished name');
    assert.equal(fresh.s.sxrState.posts[0].video_status, 'Approved');
    assert.ok(fresh.s.sxrState.posts[0]._saveError);
  });
  await test('failed first field survives successful later field until its own retry acknowledgement', async () => {
    const f = writerFixture(source); await f.load('fixture-a', [{ ...row('existing'), name: 'Server original', creative_direction: 'Server direction' }]);
    f.type('existing', 'Unsaved first field'); const first = f.s._sxrFlushCardSave('existing');
    f.s._sxrOnFieldInput({ dataset: { pid: 'existing', fld: 'creative_direction' }, value: 'Newer second field' });
    f.pending.shift()(false); await first;
    assert.deepEqual(f.writes[1].body.sample, { id: 'existing', creative_direction: 'Newer second field' });
    f.pending.shift()(true); await f.s._sxrAwaitCardSave('existing');
    assert.equal(work(f).length, 1, 'acknowledgement of direction cannot retire failed name');
    const debt = JSON.parse(work(f)[0][1]); assert.deepEqual(debt.edits, { name: 'Unsaved first field' });
    assert.ok(f.s.sxrState.posts[0]._saveError, 'remaining field debt offers retry');
    const fresh = writerFixture(source); cloneStorage(f,fresh);
    await fresh.load('fixture-a', [{ ...row('existing'), name: 'Server original', creative_direction: 'Newer second field', video_status: 'Approved' }]);
    assert.equal(fresh.s.sxrState.posts[0].name, 'Unsaved first field');
    assert.equal(fresh.s.sxrState.posts[0].creative_direction, 'Newer second field');
    assert.equal(fresh.s.sxrState.posts[0].video_status, 'Approved');
    const retry = fresh.s._sxrRetrySave('existing');
    assert.deepEqual(fresh.writes[0].body.sample, { id: 'existing', name: 'Unsaved first field' });
    fresh.pending.shift()(true); await retry; assert.equal(work(fresh).length, 0);
  });
  await test('original-source promoted draft without client or error marker is privately archived', async () => {
    const oldSource = require('node:child_process').execFileSync('git', ['show', '13e187a7d0043ed110b486feb50502758a026229:index.html'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    const old = writerFixture(oldSource), id = old.draft('Unattributable synthetic draft'); old.s._sxrFlushCardSave(id);
    old.s._sxrCacheWrite('fixture-a', [row('saved'), ...old.s.sxrState.posts]);
    const raw = old.storage.get(old.key), promoted = JSON.parse(raw).posts[1];
    assert.ok(!promoted.client && !promoted._saveError && !promoted.id.startsWith('__sxrblank__'));
    const f = writerFixture(source); f.storage.set(f.key, raw); f.s.fetch = async () => response({},500);
    await f.s.loadSxrCards(); assert.deepEqual(ids(f.s.sxrState.posts), ['saved']);
    await f.load('fixture-a');
    assert.deepEqual(JSON.parse(f.storage.get('syncview_sxr_legacy_work_v1:fixture-a')), [raw]);
    assert.equal(work(f).length, 0, 'legacy source cannot establish a new author');
  });
  await test('storage retry hydrates intact records after transient per-record failure without duplicates', async () => {
    const seed = writerFixture(source); seed.draft('First stored draft'); seed.draft('Second stored draft');
    const fresh = writerFixture(source); cloneStorage(seed,fresh);
    const getter = fresh.s.localStorage.getItem, firstKey = work(fresh)[0][0]; let broken = true;
    fresh.s.localStorage.getItem = key => { if (broken && key === firstKey) throw Error('synthetic read failure'); return getter(key); };
    await fresh.load('fixture-a');
    assert.equal(fresh.s.sxrState.posts.length, 1, 'one unreadable record does not hide another intact record');
    const secondId = fresh.s.sxrState.posts[0].id; fresh.type(secondId, 'Newer memory');
    const bytes = work(fresh).map(([k,v]) => [k,v]); broken = false;
    assert.equal(fresh.s._sxrWorkCheckpointView(), true);
    assert.equal(fresh.s.sxrState.posts.length, 2);
    assert.equal(fresh.s.sxrState.posts.find(p => p.id === secondId).name, 'Newer memory');
    assert.deepEqual(work(fresh), bytes, 'hydration retry never rewrites stored debt');
    fresh.s._sxrWorkCheckpointView(); await fresh.load('fixture-a');
    assert.equal(fresh.s.sxrState.posts.length, 2);
    assert.equal(fresh.s._sxrWorkBindView().storageFailed, false);
  });
  await test('acknowledged creation retains newer field debt but trailing patch preserves a peer asset', async () => {
    const f = writerFixture(source), id = f.draft('Created name');
    const creation = f.s._sxrFlushCardSave(id), server = { ...f.writes[0].body.sample };
    f.type(server.id, 'Newer name');
    f.s._sxrOnFieldInput({ dataset: { pid: server.id, fld: 'creative_direction' }, value: 'New direction' });
    server.asset_url = 'https://synthetic.invalid/peer-asset.mp4';
    f.pending.shift()(true); await creation;
    const debt = JSON.parse(work(f)[0][1]);
    assert.equal(debt.isNew, false, 'positive creation ack transitions metadata even with trailing debt');
    assert.deepEqual(debt.edits, { name: 'Newer name', creative_direction: 'New direction' });
    assert.deepEqual(f.writes[1].body.sample, { id: server.id, name: 'Newer name', creative_direction: 'New direction' });
    Object.assign(server, f.writes[1].body.sample);
    assert.equal(server.asset_url, 'https://synthetic.invalid/peer-asset.mp4');
    f.pending.shift()(true); await f.s._sxrAwaitCardSave(server.id);
    assert.equal(work(f).length, 0);
  });
  for (const ambiguous of [false, true]) await test((ambiguous ? 'lost-response' : 'failed') + ' creation still requires whole-card retry', async () => {
    const f = writerFixture(source), id = f.draft('Retained creation');
    const normalWriter = f.s._sxrUpsertFetchPinned;
    if (ambiguous) f.s._sxrUpsertFetchPinned = async () => { throw new Error('synthetic lost response'); };
    const creation = f.s._sxrFlushCardSave(id);
    if (!ambiguous) f.pending.shift()(false);
    await creation;
    assert.equal(JSON.parse(work(f)[0][1]).isNew, true, 'failed or ambiguous response cannot establish creation');
    f.s._sxrUpsertFetchPinned = normalWriter;
    const retry = f.s._sxrRetrySave('fixture-new-1');
    const body = f.writes.at(-1).body.sample;
    assert.equal(body.client, 'fixture-a'); assert.equal(body.name, 'Retained creation');
    assert.ok(Object.hasOwn(body, 'asset_url'), 'unacknowledged creation retains the whole-row retry contract');
    f.pending.shift()(true); await retry;
    assert.equal(work(f).length, 0);
  });
  console.log(`Samples local work: ${passed} isolated lifecycle cases passed.`);
}
module.exports = { writerFixture, run };
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
