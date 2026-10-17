// client_request_linked_live.js -- ON DEMAND, not nightly: it creates a real work item on the TEST client.
//
// Live proof for OPEN_REPAIRS 427: does a client's "Request changes" on a card LINKED to a
// Production work item move that work item, even when the client page could not read the
// client-comment front-door switch?
//   1. make a card with a video work item through the real Create Post (staff page);
//   2. move the work item to Client Approval through the real Production status picker
//      (the bridge copies it onto the card);
//   3. open the real client link and press Request changes on the video;
//      with FRONT_DOOR_FAIL=1 the page's read of the front-door switch fails, the way a
//      read slower than its two-second limit does on a client's connection;
//   4. read back the card and the work item.
// Expected: the card says Tweaks Needed AND the work item says tweak.
// Cleans up: cancels the work item and archives the card. TEST client only.
// Run: PROBE_ATTEMPTS=1 FRONT_DOOR_FAIL=1 node qa/run-probes.js client_request_linked_live
'use strict';
const H = require('./ot4_lib.js');
const L = require('../sxr_courier_lib.js');
const { TEST_CLIENT } = require('../test-client-entry.js');

const TEST = TEST_CLIENT.slug;
const TS = Date.now();
const FRONT_DOOR_FAIL = process.env.FRONT_DOOR_FAIL === '1';
const res = [];
const ok = (c, m, x) => { res.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  [' + String(x).slice(0, 200) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = { apikey: L.KEY, Authorization: 'Bearer ' + L.KEY };
const REAL = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
const ACTOR = String(process.env.SYNCVIEW_ACTOR || '').trim();

/* The harness answers every production-write call with a fake "ok" (qa/native_work_item_fixture.js
   stubNativeGateway), which is right for offline probes and wrong here: this probe is about what the
   REAL gateway does. Registered last, so it is tried first. A staff tab gets the runner's real key on
   the wire (never in the page); a client tab sends exactly what the page sent (its link token). */
async function liveGateway(ctx, staff) {
  await ctx.route(u => u.toString().startsWith(L.SUPA + '/functions/v1/production-write'), async r => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' });
    const h = Object.assign({}, req.headers());
    if (staff && h['x-syncview-key']) { h['x-syncview-key'] = REAL; if (ACTOR) h['x-syncview-actor'] = ACTOR; }
    const out = L.filelessHttpRequest(req.method(), req.url(), h, req.postData());
    return r.fulfill({ status: out.status, contentType: out.ctype, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: out.body });
  });
}
async function staffPage(browser, route) {
  const p = await L.open(browser, '/qa/dawn/blank.html');
  await p.context().route(u => u.toString().startsWith(L.SUPA + '/functions/v1/') && !/production-write/.test(u.toString()), r => {
    const h = r.request().headers();
    if (!h['x-syncview-key']) return r.fallback();
    return r.fallback({ headers: Object.assign({}, h, { 'x-syncview-key': REAL }, ACTOR ? { 'x-syncview-actor': ACTOR } : {}) });
  });
  await liveGateway(p.context(), true);
  await p.goto(L.ORIGIN + route, { waitUntil: 'domcontentloaded' });
  return p;
}
function rest(table, qs) {
  const out = L.filelessHttpRequest('GET', `${L.SUPA}/rest/v1/${table}?${qs}`, anon).body.toString('utf8');
  try { return JSON.parse(out); } catch (e) { return []; }
}
const item = id => (rest('production_deliverables_browser_v1', `id=eq.${encodeURIComponent(id)}&select=id,status,updated_at,card_id`)[0] || null);
const card = id => (L.supaCal(`id=eq.${encodeURIComponent(id)}&client=eq.${TEST}&select=*`) || [])[0] || null;
const findCard = name => (L.supaCal(`client=eq.${TEST}&name=like.*${encodeURIComponent(name)}*&select=id`) || [])[0] || null;
async function pollUntil(fn, pred, ms) { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (pred(v)) return v; await sleep(1500); } return null; }

async function prodStatus(browser, id, status) {
  const p = await staffPage(browser, '/index.html?prod=1#production');
  try {
    await p.waitForFunction(i => typeof _prodIssue === 'function' && !!_prodIssue(i), id, { timeout: 90000 }).catch(() => {});
    await p.evaluate(([i, s]) => _prodRunPickerWrite('status', [i], s), [id, status]).catch(() => {});
    return (await pollUntil(async () => (item(id) || {}).status, s => s === status, 45000)) === status;
  } finally { await p.context().close().catch(() => {}); }
}

(async () => {
  const browser = await H.launch();
  const name = `Echo request probe ${TS}`;
  let id = null, vid = null;
  try {
    // 1. Create Post, video only.
    const s = await staffPage(browser, `/index.html?v2debug=1#calendar/${TEST}`);
    await s.waitForFunction(() => typeof calState === 'object' && !!calState.client && typeof _calOpenNativePost === 'function', null, { timeout: 60000 });
    await s.waitForTimeout(4000);
    await s.evaluate(([n, sl]) => _calOpenNativePost(n, sl, 'calendar'), [TEST_CLIENT.name, TEST]);
    await s.waitForSelector('#calNativePostCreate', { timeout: 20000 });
    const v = s.locator('input[name=calNativeModeChoice][value=video]');
    if (await v.count()) await v.check();
    await s.locator('#calNativePostNames input').first().fill(name);
    const bn = s.locator('#calNativeBatchName'); if (await bn.count()) await bn.fill(`Echo probe batch ${TS}`);
    s.on('console', m => { if (/Create Post failed|\[probe\]/.test(m.text())) console.log('INFO console ' + m.type() + ' ' + m.text().slice(0, 240)); });
    await s.evaluate(() => { const o = window._writeUiRecordFailure; if (typeof o === 'function') window._writeUiRecordFailure = function (a, b, e) { console.warn('[probe] intake failure ' + a + ' ' + b + ' ' + (e && (e.code || e.message)) + ' ' + (e && e.status)); return o.apply(this, arguments); }; }).catch(() => {});
    s.on('response', async r => { if (/production-write/.test(r.url())) console.log('INFO production-write ' + r.status() + ' ' + (await r.text().catch(() => '')).slice(0, 200)); });
    await s.click('#calNativePostCreate');
    await s.waitForFunction(() => !document.getElementById('calNativePostOverlay'), null, { timeout: 60000 }).catch(() => {});
    const dialog = await s.evaluate(() => { const e = document.getElementById('calNativePostError'); return { open: !!document.getElementById('calNativePostOverlay'), error: e && !e.hidden ? e.textContent.slice(0, 160) : '' }; }).catch(() => ({}));
    if (dialog.open || dialog.error) console.log('INFO Create Post dialog: ' + JSON.stringify(dialog) + ' errors=' + L.appErrs(s).join(' | ').slice(0, 300));
    const found = await pollUntil(async () => findCard(name), r => !!r, 60000);
    ok(!!found, 'a test card was made through the real Create Post', found && found.id);
    if (!found) return;
    id = found.id;
    const settled = await pollUntil(async () => card(id), r => r && r.video_deliverable_id, 60000);
    vid = settled && settled.video_deliverable_id;
    ok(!!vid, 'it carries a video work item', vid);
    if (!vid) return;
    // A video link so the client sees the video part (a card field, not a status).
    await s.evaluate(i => { const p = calState.posts.find(x => x.id === i); if (p) { _calPendingEdits[i] = Object.assign(_calPendingEdits[i] || {}, { asset_url: 'https://example.com/echo-probe.mp4', scheduled_date: new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10) }); return _calFlushCardSave(i); } }, id).catch(() => {});
    await s.context().close().catch(() => {});

    // 2. Work item to Client Approval through Production; the bridge moves the card.
    ok(await prodStatus(browser, vid, 'client_approval'), 'work item moved to client_approval through the Production picker');
    const bridged = await pollUntil(async () => card(id), r => r && r.video_status === 'Client Approval', 45000);
    ok(!!bridged, 'the card shows the video in Client Approval', bridged && bridged.video_status);
    if (!bridged) return;
    const cardName = bridged.name;

    // 3. The client link: Request changes on the video.
    const c = await L.clientCal(browser);
    await liveGateway(c.context(), false);
    if (FRONT_DOOR_FAIL) {
      await c.context().route(u => /syncview_runtime_flags/.test(u.toString()) && /client_comment_gateway_enabled/.test(decodeURIComponent(u.toString())), r => r.abort());
    }
    await c.reload({ waitUntil: 'domcontentloaded' });
    await c.waitForTimeout(1800);
    await c.waitForFunction(() => !!document.querySelector('.cal-review-card'), null, { timeout: 60000 }).catch(() => {});
    const txt = 'Echo probe: please shorten the intro ' + TS;
    let clicked = 'disabled';
    for (let i = 0; i < 15 && clicked !== 'ok'; i++) { clicked = await H.clientAct(c, cardName, 'video', 'request', txt).catch(e => 'err ' + e.message); if (clicked !== 'ok') await sleep(1000); }
    ok(clicked === 'ok', 'the client pressed Request changes on the video', clicked);
    const after = await pollUntil(async () => card(id), r => r && r.video_status === 'Tweaks Needed', 45000);
    ok(!!after, 'card: video Tweaks Needed', after && after.video_status);
    const wi = await pollUntil(async () => item(vid), r => r && r.status === 'tweak', 45000);
    ok(!!wi, 'work item: tweak (the request reached Production)', (item(vid) || {}).status);
    const pc = rest('production_comments', `deliverable_id=eq.${encodeURIComponent(vid)}&role=eq.client&select=id`);
    console.log('INFO client comment rows on the work item: ' + (Array.isArray(pc) ? pc.length : 'unreadable') + (FRONT_DOOR_FAIL ? ' (front door made to fail)' : ''));
    const errs = L.appErrs(c);
    console.log('INFO client page app errors: ' + errs.length);
    await c.context().close().catch(() => {});
  } catch (e) {
    ok(false, 'raised: ' + String(e && e.message || e).split('\n')[0].slice(0, 200));
  } finally {
    if (vid) ok(await prodStatus(browser, vid, 'canceled'), 'cleanup: work item canceled');
    if (id) ok(L.archiveCalSafe(id) !== false, 'cleanup: card archived');
    await browser.close();
    console.log(`\npass=${res.filter(Boolean).length} fail=${res.filter(x => !x).length}`);
    process.exit(res.every(Boolean) ? 0 : 1);
  }
})();
