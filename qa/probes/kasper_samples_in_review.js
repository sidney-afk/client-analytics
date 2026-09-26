// kasper_samples_in_review.js — ON DEMAND. Samples waiting for Kasper are
// listed in his Review queue beside calendar cards (owner request
// 2026-09-26). Seeds one calendar card and one sample on the TEST client, then
// at desktop width (mouse) and at 390 and 375 (touch only) checks that the
// sample shows in "Waiting for your review" with its Sample label, the
// Samples tab is hidden, and every action on the sample card still runs the
// SAMPLES handler and saves through the samples saver: open, switch, video,
// thumbnail, comment, request change, approve. Saves are recorded and
// answered (the work items are synthetic), the retired Linear webhooks must
// see nothing, and both seeded cards are archived at the end.
'use strict';
const L = require('../sxr_courier_lib.js');
const NW = require('../native_work_item_fixture.js');
const { TEST_CLIENT } = require('../test-client-entry.js');

const TS = Date.now();
const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const ORIGIN = process.env.SYNCVIEW_ORIGIN || 'http://127.0.0.1:8000';
const REAL = {};
async function realIdentity() {
  const key = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
  const actor = String(process.env.SYNCVIEW_ACTOR || '').trim();
  if (!key || !actor) throw new Error('SYNCVIEW_ROLE_KEY and SYNCVIEW_ACTOR are required');
  const pub = L.KEY;
  const rows = await (await fetch(`${SUPA}/rest/v1/team_members?name=eq.${encodeURIComponent(actor)}&select=id`, { headers: { apikey: pub, authorization: 'Bearer ' + pub } })).json();
  const verified = await (await fetch(`${SUPA}/functions/v1/key-verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-syncview-key': key }, body: JSON.stringify({ surface: 'staff-boot', member: { id: rows[0] && rows[0].id } }) })).json();
  if (!verified || verified.ok !== true) throw new Error('key-verify refused the runner key');
  REAL.verified = verified;
  REAL.identity = JSON.stringify({ key, role: verified.role, member: verified.member, verified_at: new Date().toISOString() });
}
const results = [];
const ok = (c, m, x) => { results.push(!!c); console.log((c ? '✓  ' : '✗  ') + m + (x ? '  [' + String(x).slice(0, 160) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const made = [];

async function waitFor(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; }

async function runAt(browser, width) {
  const phone = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(id => { try { localStorage.setItem('syncview_staff_identity_v1', id); sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); sessionStorage.setItem('syncview_staff_identity_prompted_v1', '1'); localStorage.setItem('syncview_kasper_subtab_v1', 'review'); } catch (e) {} }, REAL.identity);
  await NW.applyProbeWorkItems(ctx);
  const retired = await NW.captureRetiredWebhooks(ctx);
  const gateway = await NW.stubNativeGateway(ctx, { onCall: c => { c._at = Date.now(); } });
  await ctx.route(u => /\/rest\/v1\/deliverables\?select=id,status/.test(u.toString()), async route => {
    const raw = decodeURIComponent(route.request().url());
    const ids = [...new Set(raw.match(/probe_del_[vg]_[A-Za-z0-9_-]+/g) || [])];
    if (!ids.length) return route.fallback();
    const now = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(ids.map(id => ({ id, status: 'kasper_approval', status_at: now, updated_at: now }))) });
  });
  // Sample saves: recorded and answered, never sent (synthetic work items).
  // Any calendar save for the SAMPLE id would mean the wrong saver ran.
  const saves = [], wrongSaver = [];
  await ctx.route(u => /sample-review-upsert(\?|$)/.test(u.toString()), async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' });
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    const s = body.sample || {};
    if (s.id !== sample.id) return route.fallback();
    saves.push(s);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: true, sample: Object.assign({}, s, { updated_at: new Date().toISOString() }) }) });
  });
  await ctx.route(u => /calendar-upsert/.test(u.toString()), async route => {
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (body.post && body.post.id === sample.id) { wrongSaver.push(body.post.id); return route.fulfill({ status: 500, body: '' }); }
    return route.fallback();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e && e.message)));
  await p.goto(ORIGIN + '/index.html?Kasper=1#kasper/review', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const gateOpen = await p.waitForFunction(() => { const ov = document.getElementById('staffIdentityOverlay'); return !(ov && ov.classList.contains('open')) && typeof _syncviewStaffIdentityValid === 'function' && _syncviewStaffIdentityValid(); }, null, { timeout: 45000 }).then(() => false, () => true);
  ok(!gateOpen, `${width}: signed in as staff, with no sign-in screen over the page`);
  const tapSel = async (q) => {
    const box = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, q);
    if (!box) throw new Error('no element for tap: ' + q);
    await sleep(150);
    if (phone) await p.touchscreen.tap(box.x, box.y); else await p.mouse.click(box.x, box.y);
  };
  const sSel = `#kasperReviewBody .kasper-waiting-wrap .kcard[data-sxr-kasper-pid="${sample.id}"]`;
  const cSel = `#kasperReviewBody .kcard[data-kasper-pid="${calCard.id}"]`;
  const seen = await p.waitForSelector(sSel, { timeout: 120000 }).then(() => true, () => false);
  ok(seen, `${width}: the sample is in "Waiting for your review" on the Review tab`);
  if (!seen) { await ctx.close(); return; }
  ok(await p.waitForSelector(cSel, { timeout: 120000 }).then(() => true, () => false), `${width}: the calendar card is in the same list`);
  ok(await p.evaluate(q => { const c = document.querySelector(q + ' .kcard-sample-chip'); return !!c && c.textContent.trim() === 'Sample' && c.getBoundingClientRect().width > 0; }, sSel), `${width}: the sample card carries a visible Sample label`);
  ok(!(await p.evaluate(q => !!document.querySelector(q + ' .kcard-sample-chip'), cSel)), `${width}: the calendar card has no Sample label`);
  ok(await p.evaluate(() => { const t = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); return !t || getComputedStyle(t).display === 'none'; }), `${width}: the Samples tab is hidden`);
  const counts = await p.evaluate(() => ({ head: Number((document.querySelector('#kasperWaitingWrap .kasper-history-count') || {}).textContent), cards: document.querySelectorAll('#kasperWaitingWrap .kcard').length }));
  ok(counts.head === counts.cards, `${width}: the waiting count includes samples`, JSON.stringify(counts));
  const tabCount = await p.evaluate(() => { const u = document.querySelectorAll('#kasperReviewBody .kasper-urgent-wrap .kcard').length; return { pill: Number((document.querySelector('[data-kasper-count="review"]') || {}).textContent), list: u + document.querySelectorAll('#kasperWaitingWrap .kcard').length }; });
  ok(tabCount.pill === tabCount.list, `${width}: the Review tab count includes samples`, JSON.stringify(tabCount));
  if (phone) { const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(sw <= 0, `${width}: the page does not scroll sideways`, sw); }
  const bigEnough = async (s, label) => { if (!phone) return; const d = await p.evaluate(q => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }, s); ok(!!d && d[0] >= 40 && d[1] >= 40, `${width}: ${label} is a thumb-sized target`, JSON.stringify(d)); };

  await tapSel(cSel + ' .kcard-title');
  ok(await waitFor(() => p.evaluate(q => !!document.querySelector(q + '.expanded'), cSel), 8000), `${width}: opening the calendar card works`);
  await tapSel(sSel + ' .kcard-title');
  ok(await waitFor(() => p.evaluate(q => !!document.querySelector(q + '.expanded'), sSel), 8000), `${width}: switching to the sample card opens it`);

  await bigEnough(sSel + ' .kcard-watch-btn', 'Watch video');
  const popup = ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null);
  await tapSel(sSel + ' .kcard-watch-btn');
  const tab = await popup; ok(!!tab, `${width}: Watch video opens the sample's video`); if (tab) await tab.close().catch(() => {});

  await tapSel(sSel + ' .kcard-thumb-zoom');
  ok(await waitFor(() => p.evaluate(() => { const l = document.getElementById('kasperLightbox'); return !!l && l.classList.contains('open') && /hqdefault/.test((l.querySelector('img') || {}).src || ''); }), 5000), `${width}: the thumbnail opens full screen`);
  await bigEnough('#kasperLightbox .kasper-lightbox-close', 'thumbnail close');
  await tapSel('#kasperLightbox .kasper-lightbox-close');
  ok(await waitFor(() => p.evaluate(() => !document.getElementById('kasperLightbox').classList.contains('open')), 5000), `${width}: closing the thumbnail works`);

  const vPanel = sSel + ' .cal-review-panel[data-sxr-kasper-comp="video"]';
  const gPanel = sSel + ' .cal-review-panel[data-sxr-kasper-comp="graphic"]';
  const hasV = await p.$(vPanel), hasG = await p.$(gPanel);
  ok(!!hasV && !!hasG, `${width}: the sample shows its video and thumbnail panels`);
  const tag = width + ' ' + TS;
  if (hasV) {
    await tapSel(vPanel + ' .cal-review-textarea');
    await p.fill(vPanel + ' .cal-review-textarea', 'Sample comment ' + tag);
    await bigEnough(vPanel + ' .cal-review-comment-btn', 'Comment');
    const pre = await p.evaluate(q => { const b = document.querySelector(q); const r = b.getBoundingClientRect(); b.scrollIntoView({ block: 'center' }); const r2 = b.getBoundingClientRect(); const hit = document.elementFromPoint(r2.x + r2.width / 2, r2.y + r2.height / 2); return JSON.stringify({ dis: b.disabled, hit: hit && (hit.className || hit.tagName), r: [r2.x, r2.y, r2.width, r2.height], vw: innerWidth, vh: innerHeight, sy: scrollY, vv: visualViewport && [visualViewport.offsetTop, visualViewport.height, visualViewport.scale] }); }, vPanel + ' .cal-review-comment-btn');
    await tapSel(vPanel + ' .cal-review-comment-btn');
    const cOk = await waitFor(() => saves.some(x => JSON.stringify(x).includes('Sample comment ' + tag)), 30000);
    if (!cOk) console.log('DEBUG', pre, JSON.stringify(saves).slice(0, 300));
    ok(cOk, `${width}: Comment saves through the samples saver`);
    await p.waitForSelector(vPanel + ' .cal-review-textarea', { timeout: 10000 }).catch(() => {});
    await tapSel(vPanel + ' .cal-review-textarea');
    await p.fill(vPanel + ' .cal-review-textarea', 'Sample tweak ' + tag);
    await bigEnough(vPanel + ' .cal-review-tweak-btn', 'Request change');
    await tapSel(vPanel + ' .cal-review-tweak-btn');
    ok(await waitFor(() => saves.some(x => x.video_status === 'Tweaks Needed' && JSON.stringify(x).includes('Sample tweak ' + tag)), 30000), `${width}: Request change moves the sample video to Tweaks Needed through the samples saver`);
  }
  if (hasG) {
    await p.waitForSelector(gPanel + ' .cal-review-approve-btn', { timeout: 10000 }).catch(() => {});
    await bigEnough(gPanel + ' .cal-review-approve-btn', 'Approve');
    await waitFor(() => p.evaluate(q => { const b = document.querySelector(q); return !!b && !b.disabled; }, gPanel + ' .cal-review-approve-btn'), 20000);
    await tapSel(gPanel + ' .cal-review-approve-btn');
    const got = await waitFor(() => saves.some(x => x.graphic_status === 'Client Approval'), 30000);
    if (!got) console.log('DEBUG', await p.evaluate(q => { const b = document.querySelector(q); const n = document.querySelector('.notify, #notify, .sv-notify, [class*="toast"]'); return JSON.stringify({ btn: b && { dis: b.disabled, txt: b.textContent.trim().slice(0, 40), title: b.title }, note: n && n.textContent.trim().slice(0, 200) }); }, gPanel + ' .cal-review-approve-btn'));
    ok(got, `${width}: Approve sends the sample thumbnail to the client through the samples saver`, JSON.stringify(saves.map(x => x.graphic_status)));
  }
  ok(await waitFor(() => p.evaluate(q => !!document.querySelector(q), sSel.replace(' .kasper-waiting-wrap', '')), 3000), `${width}: the sample card is still in the Review list after the decisions`);
  ok(wrongSaver.length === 0, `${width}: no calendar save was sent for the sample`);
  ok(NW.retiredCallCount(retired) === 0, `${width}: the retired Linear webhooks received nothing`);
  ok(gateway.length >= 1, `${width}: the native gateway received the sample's decisions`, gateway.length);
  ok(errs.length === 0, `${width}: no app errors`, errs[0]);
  await ctx.close();
}

let sample, calCard;
(async () => {
  const px = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await L.PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors'].concat(px ? ['--proxy-server=' + px, '--proxy-bypass-list=127.0.0.1;localhost'] : []) });
  try {
    await realIdentity();
    for (const w of (process.env.KSR_WIDTHS || '1440,390,375').split(',').map(Number)) {
      sample = { id: 'p_ksr_s' + w + '_' + TS };
      calCard = { id: 'p_ksr_c' + w + '_' + TS };
      made.push({ id: sample.id, kind: 'sample' }, { id: calCard.id, kind: 'cal' });
      NW.registerProbeWorkItems([{ id: sample.id, components: ['video', 'graphic'] }, { id: calCard.id, components: ['video', 'graphic'] }]);
      L.up({ id: sample.id, name: 'Kasper sample ' + w + ' ' + TS, asset_url: 'https://frame.io/x/' + sample.id,
        thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval' });
      L.upCal({ id: calCard.id, name: 'Kasper cal ' + w + ' ' + TS, asset_url: 'https://frame.io/x/' + calCard.id,
        thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Approved',
        status: 'Kasper Approval', kasper_approved_at: '', kasper_seen: '' });
      await sleep(3000);
      await runAt(browser, w);
    }
  } catch (e) {
    ok(false, 'raised: ' + String(e && e.message || e).split('\n')[0].slice(0, 160));
  } finally {
    await browser.close();
    for (const c of made) ok((c.kind === 'sample' ? L.archiveSafe(c.id) : L.archiveCalSafe(c.id)) !== false, 'cleanup: archived ' + c.kind + ' ' + c.id);
    console.log(`\npass=${results.filter(Boolean).length} fail=${results.filter(x => !x).length} (test client ${TEST_CLIENT.slug.length ? 'only' : ''})`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
