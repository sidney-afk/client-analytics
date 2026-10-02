'use strict';
const { pathToFileURL } = require('node:url');
/*
 * The URGENT ping uses the round stamp the database holds, and a refused ping is
 * logged with its real reason and can be refreshed in one click.
 *
 * Run:  node test/urgent-ping-fresh-round.js   (exit 0 = all good)
 *       (through test/run-all.js the single-file page preload is added for you;
 *        by hand: NODE_OPTIONS=--require=./test/helpers/single-file-index.js)
 *
 * The bug (measured: 4 browser-side log rows, 1 card, 0 server-side rows in 7
 * days): a person set a video to Tweaks Needed and clicked URGENT a few seconds
 * later. The database stamps `video_status_at` by trigger when the status
 * changes, the save echo never carries it, and the page sent the PREVIOUS
 * round's stamp, so the gateway refused with urgent_target_changed. The failed-
 * saves log then recorded a generic 500 "browser_refusal" and lost the code.
 *
 * Offline. Runs the page's own functions in a VM with stubbed transport; the
 * browser proof is docs/syncview-design/tests/urgent-ping-fresh-round-browser.js.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
let passed = 0;
async function check(label, fn) { await fn(); passed += 1; console.log('PASS ' + label); }

/* ---- the dispatch, with a card row the test controls ---------------------- */
const names = ['_calUrgentSlackDispatch', '_calCheckQueuedUrgent', '_calSendUrgentSlack', '_writeUiNativeId',
  '_writeUiComponentHasWorkItem', '_syncviewEfHeaders', '_urgentWaitForSave', '_urgentHooksFor', '_urgentFreshenRound',
  '_urgentCardChangedAction', '_urgentAdoptRoundColumns', '_urgentLivePost', '_urgentAdoptStampsAfterSave', '_calBuildUrgentPatch'];
const asyncNames = new Set(['_calCheckQueuedUrgent', '_urgentWaitForSave', '_urgentFreshenRound', '_urgentAdoptStampsAfterSave']);
const gateway = html.match(/^\s*const WRITE_UI_PRODUCTION_WRITE_URL = [^;]+;/m);
assert.ok(gateway, 'gateway URL declaration found');
const failureTables = html.slice(html.indexOf('const WRITE_UI_FAILURE_CLASS_TEXT'), html.indexOf('function _writeUiReportFailure('));
const kinds = html.slice(html.indexOf('    const URGENT_PING_KINDS ='), html.indexOf('    function _urgentKind'));
const hooks = html.slice(html.indexOf('    const URGENT_SURFACE_HOOKS ='), html.indexOf('    function _urgentHooksFor'));
const codes = html.slice(html.indexOf('    const URGENT_CARD_CHANGED_CODES ='), html.indexOf('    function _urgentCardChangedAction'));
assert.ok(hooks.length > 50 && codes.length > 50, 'fresh-round constants found');
const source = [kinds, extractFunction(html, '_urgentKind'), gateway[0], failureTables, hooks, codes,
  ...names.map(n => (asyncNames.has(n) ? 'async ' : '') + extractFunction(html, n))].join('\n');

const OLD = '2030-01-01T00:00:00.000Z';
const NEW = '2030-01-01T00:00:07.250+00:00';
function world(row) {
  const post = { id: 'card-1', video_deliverable_id: 'native-video-1', video_status: 'Tweaks Needed', video_status_at: OLD, name: 'Synthetic card' };
  const sent = [], notices = [], confirms = [], failures = [], store = new Map(), persisted = [], caches = [];
  const ctx = {
    console: { warn() {} }, JSON, String, Date, Map, Promise, Number, Object, Array, setTimeout, clearTimeout, AbortSignal,
    crypto: require('node:crypto').webcrypto, CAL_SUPABASE_URL: 'https://project.invalid', CAL_SUPABASE_ANON_KEY: 'synthetic-public',
    URGENT_KASPER_SLACK_URL: 'https://n8n.invalid/kasper', _isClientLink: false,
    _syncviewStaffIdentityForHeaders: () => ({ key: 'synthetic-staff', member: { name: 'Synthetic Staff' }, role: 'smm' }),
    _calNormStatus: x => x, _sxrNormStatus: x => x, calClientSlug: () => 'fixture', sxrClientSlug: () => 'fixture',
    calState: { client: 'Fixture', posts: [post] }, sxrState: { client: 'Fixture', posts: [] },
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    showNotify: (...x) => notices.push(x), showConfirm: (title, text, fn) => confirms.push(fn),
    _calAssertSavingOn: async () => true,
    _calPersistUrgentSentForPost: async (...x) => { persisted.push(x); },
    // The page's own failed-saves helpers run (they sit in the sliced block); the queue diagnostic is the seam to the log.
    _writeUiQueueDiagnostic: (surface, outcome, item, error) => failures.push([surface, item && item.kind, error]),
    _urgentReadCardRow: async () => (typeof row === 'function' ? row() : row),
    _calAwaitCardSave: async () => {}, _sxrAwaitCardSave: async () => {},
    _calCacheWrite: (...x) => caches.push(x), _sxrCacheWrite() {}, _calUpdateCardStatusDisplay() {}, _sxrUpdateCardStatusDisplay() {},
    _urgentRefreshCard() {},
    fetch: async (url, options) => {
      sent.push({ url, options, body: JSON.parse(options.body) });
      const reply = ctx.reply, status = ctx.status;
      return { ok: status === 200, status, json: async () => { if (ctx.badJson) throw Error('parse'); return reply; } };
    },
    status: 200, reply: { ok: true, delivery: 'sent', dispatch_id: 'dispatch-1', slack_ts: '123.456' },
  };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const button = { disabled: false, textContent: 'URGENT', dataset: {}, classList: { add() {} } };
  const click = () => {
    ctx._calSendUrgentSlack({ currentTarget: button, preventDefault() {}, stopPropagation() {} }, post.id);
    return button;
  };
  const confirm = async () => { assert.equal(confirms.length, 1); confirms.shift()(); await new Promise(r => setTimeout(r, 60)); };
  return { ctx, post, sent, notices, confirms, failures, store, persisted, caches, button, click, confirm };
}
const goodRow = (over) => Object.assign({ id: 'card-1', video_status: 'Tweaks Needed', video_status_at: NEW, video_deliverable_id: 'native-video-1', status: 'Tweaks Needed' }, over || {});

(async () => {
  await check('the request carries the stamp the database holds, not the one the page held', async () => {
    const w = world(goodRow()); w.click(); await w.confirm();
    assert.equal(w.sent.length, 1);
    assert.equal(w.sent[0].body.video_status_at, NEW);
    assert.equal(w.post.video_status_at, NEW, 'the card on screen was brought to the same stamp');
  });

  await check('the local delivery hold is keyed by the stamp that was actually sent', async () => {
    const w = world(goodRow()); w.ctx.status = 202; w.ctx.reply = { ok: true, delivery: 'pending', dispatch_id: 'queued-1' };
    w.click(); await w.confirm();
    const keys = [...w.store.keys()];
    assert.equal(keys.length, 1);
    assert.ok(keys[0].includes(new Date(NEW).toISOString()), 'hold key carries the fresh stamp, normalised');
    assert.ok(!keys[0].includes(OLD), 'and not the stale one');
    // The same round, retried after a reload that already holds the fresh stamp, matches that hold.
    const again = world(goodRow()); again.store.set(keys[0], w.store.get(keys[0]));
    again.post.video_status_at = NEW; again.click();
    assert.equal(again.confirms.length, 0, 'the retained hold is found before the dialog opens');
  });

  await check('a hold written for a round the card has moved past does not block the fresh round', async () => {
    const stale = world(goodRow());
    stale.store.set('syncview-native-urgent:v1:' + JSON.stringify({ action: 'native_urgent_dispatch', client_slug: 'fixture', deliverable_id: 'native-video-1', card_id: 'card-1', surface: 'calendar', video_status_at: OLD }), '{"state":"delivery_unknown"}');
    stale.post.video_status_at = '2029-01-01T00:00:00.000Z';
    stale.click(); await stale.confirm();
    assert.equal(stale.sent.length, 1, 'the earlier round hold is a different key');
  });

  await check('the freshly read hold is re-checked: an uncertain send for the fresh round blocks a second', async () => {
    const w = world(goodRow());
    w.store.set('syncview-native-urgent:v1:' + JSON.stringify({ action: 'native_urgent_dispatch', client_slug: 'fixture', deliverable_id: 'native-video-1', card_id: 'card-1', surface: 'calendar', video_status_at: new Date(NEW).toISOString() }), '{"state":"delivery_unknown"}');
    w.click(); await w.confirm();
    assert.equal(w.sent.length, 0, 'nothing sent');
    assert.equal(w.button.textContent, 'Check delivery');
  });

  await check('a card that no longer says Tweaks Needed is not pinged, and the person is told what it says', async () => {
    const w = world(goodRow({ video_status: 'For SMM Approval' })); w.click(); await w.confirm();
    assert.equal(w.sent.length, 0);
    assert.equal(w.store.size, 0, 'no hold');
    assert.equal(w.button.disabled, false); assert.equal(w.button.textContent, 'URGENT');
    assert.match(w.notices[0][1], /For SMM Approval/); assert.match(w.notices[0][1], /Nothing was sent/);
    assert.ok(!/—/.test(w.notices[0].join(' ')), 'no em dash');
    assert.equal(w.notices[0][2].actionLabel, 'Refresh this card');
    assert.equal(typeof w.notices[0][2].onAction, 'function');
  });

  await check('a changed work item link, or an archived card, is not pinged either', async () => {
    const link = world(goodRow({ video_deliverable_id: 'native-video-2' })); link.click(); await link.confirm();
    assert.equal(link.sent.length, 0); assert.match(link.notices[0][1], /work item/);
    const cleared = world(goodRow({ video_deliverable_id: null })); cleared.click(); await cleared.confirm();
    assert.equal(cleared.sent.length, 0);
    const archived = world(goodRow({ status: 'Archived' })); archived.click(); await archived.confirm();
    assert.equal(archived.sent.length, 0); assert.match(archived.notices[0][1], /archived/);
  });

  await check('a card read that fails sends with what the page has (permissive)', async () => {
    for (const row of [null, () => { throw Error('network'); }]) {
      const w = world(row); w.click(); await w.confirm();
      assert.equal(w.sent.length, 1);
      assert.equal(w.sent[0].body.video_status_at, OLD);
    }
  });

  await check('a row without a stamp keeps the page stamp and lets the gateway decide', async () => {
    const w = world(goodRow({ video_status_at: null })); w.click(); await w.confirm();
    assert.equal(w.sent.length, 1); assert.equal(w.sent[0].body.video_status_at, OLD);
  });

  await check('a refused ping: the log gets the real code and HTTP status, and the notice offers a refresh', async () => {
    for (const code of ['urgent_target_changed', 'urgent_round_unavailable', 'urgent_context_unavailable', 'urgent_assignment_unavailable', 'notification_urgent_target_changed']) {
      const w = world(null); w.ctx.status = 409; w.ctx.reply = { ok: false, delivery: 'not_sent', retry_safe: true, error: code };
      w.click(); await w.confirm();
      assert.equal(w.failures.length, 1, code);
      const [surface, operation, error] = w.failures[0];
      assert.equal(surface, 'calendar'); assert.equal(operation, 'urgent_ping');
      assert.equal(error.code, code); assert.equal(error.status, 409);
      assert.match(w.notices[0][1], new RegExp('code: ' + code));
      assert.equal(w.notices[0][2].actionLabel, 'Refresh this card', code);
      assert.equal(w.button.disabled, false);
    }
    const lookup = world(null); lookup.ctx.status = 503; lookup.ctx.reply = { ok: false, delivery: 'not_sent', retry_safe: true, error: 'urgent_lookup_unavailable' };
    lookup.click(); await lookup.confirm();
    assert.equal(lookup.failures[0][2].code, 'urgent_lookup_unavailable'); assert.equal(lookup.failures[0][2].status, 503);
    assert.equal(lookup.notices[0][2], undefined, 'a code that is not a card-changed class has no refresh button');
  });

  await check('an unconfirmed answer with an unknown outcome still logs its status and code but keeps the hold message', async () => {
    const w = world(null); w.ctx.status = 500; w.ctx.reply = { ok: false, error: 'urgent_lookup_unavailable' };
    w.click(); await w.confirm();
    assert.equal(w.failures[0][2].status, 500); assert.equal(w.failures[0][2].code, 'urgent_lookup_unavailable');
    assert.equal(w.button.textContent, 'Check delivery', 'the person is still told to check, as before');
    assert.equal(w.store.size, 1, 'and the hold stays');
  });

  await check('Samples refusals are filed under the Samples surface', () => {
    assert.match(extractFunction(html, '_calUrgentSlackDispatch'), /native\.surface === 'samples' \|\| native\.surface === 'sxr'\) \? 'sxr' : 'calendar'/);
  });

  /* ---- the stamp adoption, executed ---------------------------------------- */
  const adopt = vm.runInNewContext(extractFunction(html, '_urgentAdoptRoundColumns') + '\n_urgentAdoptRoundColumns', { Date, Number, Object, String, _calNormStatus: x => x });
  await check('adoption copies only the stamp columns, and only for the status the screen shows', () => {
    const post = { id: 'c', video_status: 'Tweaks Needed', video_status_at: OLD, graphic_status: 'In Progress', graphic_status_at: '2029-05-05T00:00:00.000Z', caption: 'typed locally', name: 'Local name', updated_at: '2030-02-02T00:00:00.000Z' };
    const row = { id: 'c', video_status: 'Tweaks Needed', video_status_at: NEW, graphic_status: 'Approved', graphic_status_at: '2031-01-01T00:00:00.000Z', caption: 'SERVER caption', name: 'Server name', updated_at: '2031-01-01T00:00:00.000Z' };
    assert.equal(adopt(post, row), true);
    assert.equal(post.video_status_at, NEW);
    assert.equal(post.graphic_status_at, '2029-05-05T00:00:00.000Z', 'a stamp is never paired with a status the screen does not show');
    assert.equal(post.caption, 'typed locally'); assert.equal(post.name, 'Local name'); assert.equal(post.updated_at, '2030-02-02T00:00:00.000Z');
    assert.equal(post.graphic_status, 'In Progress'); assert.equal(post.video_status, 'Tweaks Needed');
  });
  await check('adoption never blanks a stamp, and adopts only a newer urgent-ping marker group', () => {
    const post = { video_status: 'Tweaks Needed', video_status_at: OLD, video_urgent_pinged_at: '2030-01-01T00:00:09.000Z', video_urgent_status_at: OLD, video_urgent_editor: 'local' };
    assert.equal(adopt(post, { video_status: 'Tweaks Needed', video_status_at: '', video_urgent_pinged_at: '2030-01-01T00:00:01.000Z', video_urgent_editor: 'older' }), false);
    assert.equal(post.video_status_at, OLD); assert.equal(post.video_urgent_editor, 'local');
    assert.equal(adopt(post, { video_status: 'Tweaks Needed', video_urgent_pinged_at: '2030-01-01T00:00:30.000Z', video_urgent_status_at: NEW, video_urgent_editor: 'newer' }), true);
    assert.equal(post.video_urgent_editor, 'newer'); assert.equal(post.video_urgent_status_at, NEW);
  });

  /* ---- the failed-saves log claim, executed -------------------------------- */
  await check('the failed-saves helper carries error.code and error.status into the claim', () => {
    const logged = [];
    const record = vm.runInNewContext(extractFunction(html, '_writeUiRecordSaveFailure') + '\n_writeUiRecordSaveFailure', { String, Number, Object, console,
      _writeUiRecordFailure: (...x) => logged.push(x) });
    const e = new Error('native_urgent_unconfirmed'); e.code = 'urgent_target_changed'; e.status = 409;
    record('calendar', 'urgent_ping', e, null, { id: 'card-1' });
    assert.equal(logged[0][2].code, 'urgent_target_changed'); assert.equal(logged[0][2].status, 409);
    // Precedence: a response status, then an "HTTP nnn" message, then the error's own status.
    const r = new Error('x'); r.status = 409; record('calendar', 'op', r, { status: 503 }, null); assert.equal(logged[1][2].status, 503);
    record('calendar', 'op', Object.assign(new Error('failed HTTP 502'), { status: 409 }), null, null); assert.equal(logged[2][2].status, 502);
    // A numeric driver code, free text or no code at all adds no code; an old caller's shape is unchanged.
    record('calendar', 'op', Object.assign(new Error('x'), { code: '42501' }), null, null); assert.equal('code' in logged[3][2], false);
    record('calendar', 'op', Object.assign(new Error('x'), { code: 20 }), null, null); assert.equal('code' in logged[4][2], false);
    record('calendar', 'op', Object.assign(new Error('x'), { code: 'Some free text' }), null, null); assert.equal('code' in logged[5][2], false);
    const plain = new TypeError('Failed to fetch'); record('calendar', 'op', plain, null, null);
    assert.equal('code' in logged[6][2], false); assert.equal('status' in logged[6][2], false); assert.equal(logged[6][2].network, true);
    record('calendar', 'op', Object.assign(new Error('x'), { status: 200 }), null, null); assert.equal('status' in logged[7][2], false, 'a non-error status is not invented into a refusal');
  });

  /* ---- the notice with an action ------------------------------------------- */
  await check('showNotify can carry one action, and the Cancel button always comes back for the next confirm', () => {
    const el = () => ({ textContent: '', style: {}, hidden: false, onclick: null, classList: { added: new Set(), add(c) { this.added.add(c); }, remove(c) { this.added.delete(c); } } });
    const dom = { confirmTitle: el(), confirmMsg: el(), confirmCheckWrap: el(), confirmOverlay: el(), confirmYes: el(), confirmCheck: el(), confirmCheckLabel: el() };
    const cancel = el(); cancel.textContent = 'Cancel';
    const document = { getElementById: id => dom[id], querySelector: sel => (/brief-action-btn:not\(\.primary\)/.test(sel) ? cancel : null) };
    const src = ['let _confirmCb = null;', extractFunction(html, 'showConfirm'), extractFunction(html, 'dismissConfirm'), extractFunction(html, '_confirmResetCancel'), extractFunction(html, 'showNotify'),
      'this.api = { showConfirm, dismissConfirm, showNotify };'].join('\n');
    const ctx = { document, console: { warn() {} } }; vm.createContext(ctx); vm.runInContext(src, ctx);
    let ran = 0;
    ctx.api.showNotify('Title', 'Body', { actionLabel: 'Refresh this card', onAction: () => { ran += 1; } });
    assert.equal(cancel.textContent, 'Refresh this card'); assert.equal(cancel.style.display, '');
    assert.ok(dom.confirmOverlay.classList.added.has('active'));
    cancel.onclick();
    assert.equal(ran, 1, 'the action ran once'); assert.ok(!dom.confirmOverlay.classList.added.has('active'), 'and the notice closed');
    assert.equal(cancel.textContent, 'Cancel', 'the label did not leak');
    ctx.api.showNotify('Plain', 'No action');
    assert.equal(cancel.style.display, 'none'); dom.confirmYes.onclick();
    ctx.api.showConfirm('Sure?', 'Really', () => {}, 'Do it');
    assert.equal(cancel.textContent, 'Cancel'); assert.equal(cancel.style.display, '');
    ctx.api.showNotify('Throws', 'x', { actionLabel: 'Boom', onAction: () => { throw Error('boom'); } });
    cancel.onclick();
    assert.ok(!dom.confirmOverlay.classList.added.has('active'), 'a throwing action still closes the notice');
  });

  /* ---- the codes, the wording, and the allow-list ---------------------------- */
  await check('the refresh covers exactly the card-changed codes, and none of the new text has an em dash', () => {
    const list = [...codes.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
    assert.deepEqual(list, ['notification_urgent_target_changed', 'urgent_assignment_unavailable', 'urgent_context_unavailable', 'urgent_round_unavailable', 'urgent_target_changed']);
    for (const name of ['_urgentFreshenRound', '_urgentRefreshCard', '_urgentCardChangedAction', '_urgentReadCardRow']) {
      assert.ok(!/—/.test(extractFunction(html, name)), name + ' has no em dash');
    }
  });
  await check('which urgent codes the failed-saves log can keep as themselves (the rest still keep their real status)', async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '../supabase/functions/_shared/write-refusal-codes.mjs')).href);
    const recordable = c => mod.REFUSAL_CODES.includes(c) || mod.BROWSER_REFUSAL_CODES.includes(c);
    for (const c of ['urgent_target_changed', 'urgent_round_unavailable', 'urgent_context_unavailable', 'urgent_assignment_unavailable', 'urgent_editor_unavailable', 'urgent_lookup_unavailable', 'urgent_notification_unavailable', 'invalid_urgent_request']) {
      assert.ok(recordable(c), c + ' is on the allow-list');
    }
    const unlisted = ['notification_urgent_target_changed', 'notification_urgent_editor_unavailable', 'notification_urgent_authority_unavailable', 'notification_urgent_destination_unconfigured',
      'notification_urgent_actor_invalid', 'notification_urgent_client_invalid', 'native_urgent_unconfirmed'].filter(c => !recordable(c));
    console.log('NOTE not on the server allow-list (logged as browser_refusal with the real status): ' + unlisted.join(', '));
  });

  console.log('\nurgent-ping-fresh-round: ' + passed + ' checks passed');
})().catch(error => { console.error(error); process.exit(1); });
