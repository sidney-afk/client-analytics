// kasper_phone_touch.js — ON DEMAND. Kasper's Review tab on a PHONE, driven by
// touch only (Playwright tap, hasTouch + isMobile), at 390 and 375 wide, on
// two TEST-client cards: switch items, open the video, open and close the
// thumbnail, comment, request a change, approve. Every write goes to the
// native gateway, which is the fixture's committing stub (the work items are
// synthetic); the probe asserts each intent reached it, that the retired
// Linear webhooks saw nothing, that nothing on the page scrolls sideways, and
// that every control it tapped is at least 40 px on both sides. Cleans up by
// archiving both cards.
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
let cards = [];
const made = [];

async function waitFor(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; }

async function runAt(browser, width) {
  // Its own context rather than the shared courier harness: that harness
  // seeds an invented staff member who is not on the live roster, so the
  // entry gate re-locks over the page. This signs in as the runner's real
  // staff member (key from the environment, never the repository), keeps
  // every backend read live, and still stubs the native gateway and stamps
  // the test cards' work items exactly as the shared fixture does.
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  await ctx.addInitScript(id => { try { localStorage.setItem('syncview_staff_identity_v1', id); sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); sessionStorage.setItem('syncview_staff_identity_prompted_v1', '1'); } catch (e) {} }, REAL.identity);
  await NW.applyProbeWorkItems(ctx);
  const retired = await NW.captureRetiredWebhooks(ctx);
  const gateway = await NW.stubNativeGateway(ctx, { onCall: c => { c._at = Date.now(); } });
  // Card saves are RECORDED and answered as the Edge Function answers a
  // successful save, not sent: the test cards carry the fixture's synthetic
  // work-item ids, which a real save would write back into calendar_posts,
  // and the id columns' foreign key refuses them. What this probe proves is
  // that each TAP fires the real handler with the right change; the handlers
  // themselves are unchanged by the phone layout.
  // Before a status change the page reads the work item's current status and
  // clock. The shared fixture answers crosswalk reads only (no status), so
  // answer this one read for the test cards' synthetic items: both sit at
  // kasper_approval, as the seeded cards do.
  await ctx.route(u => /\/rest\/v1\/deliverables\?select=id,status/.test(u.toString()), async route => {
    const raw = decodeURIComponent(route.request().url());
    const ids = [...new Set(raw.match(/probe_del_[vg]_[A-Za-z0-9_-]+/g) || [])];
    if (!ids.length) return route.fallback();
    const now = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(ids.map(id => ({ id, status: 'kasper_approval', status_at: now, updated_at: now }))) });
  });
  const saves = [];
  await ctx.route(u => /\/functions\/v1\/calendar-upsert(\?|$)/.test(u.toString()), async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' });
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    const post = body.post || {};
    if (!cards.some(c => c.id === post.id)) return route.fallback();
    saves.push(post);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: true, post: Object.assign({}, post, { updated_at: new Date().toISOString() }) }) });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e && e.message)));
  await p.goto(ORIGIN + '/index.html?Kasper=1#kasper', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const t0 = Date.now();
  const gateOpen = await p.waitForFunction(() => { const ov = document.getElementById('staffIdentityOverlay'); return !(ov && ov.classList.contains('open')) && typeof _syncviewStaffIdentityValid === 'function' && _syncviewStaffIdentityValid(); }, null, { timeout: 45000 }).then(() => false, () => true);
  ok(!gateOpen, `${width}: signed in as staff, with no sign-in screen over the page`);
  const tapSel = async (q) => {
    const box = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, q);
    if (!box) throw new Error('no element for tap: ' + q);
    await sleep(150);
    await p.touchscreen.tap(box.x, box.y);
  };
  const sel = id => `#kasperReviewBody .kcard[data-kasper-pid="${id}"]`;
  const seen = await p.waitForSelector(sel(cards[1].id), { timeout: 90000 }).then(() => true, () => false);
  ok(seen, `${width}: both test cards are in the review queue`);
  if (!seen) { await p.context().close(); return; }
  const sideways = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(sideways <= 0, `${width}: the page does not scroll sideways`, sideways);
  const size = async (s) => p.evaluate(q => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }, s);
  const bigEnough = async (s, label) => { const d = await size(s); ok(!!d && d[0] >= 40 && d[1] >= 40, `${width}: ${label} is a thumb-sized target`, JSON.stringify(d)); };

  // Switch items: tap card 0 open, then card 1.
  await tapSel(sel(cards[0].id) + ' .kcard-title');
  ok(await waitFor(() => p.evaluate(q => !!document.querySelector(q + '.expanded'), sel(cards[0].id)), 8000), `${width}: tapping a card opens it`);
  await tapSel(sel(cards[1].id) + ' .kcard-title');
  ok(await waitFor(() => p.evaluate(q => !!document.querySelector(q + '.expanded'), sel(cards[1].id)), 8000), `${width}: tapping another card switches to it`);
  const c1 = sel(cards[1].id);

  // Open the video (a new tab).
  await bigEnough(c1 + ' .kcard-watch-btn', 'Watch video');
  const popup = p.context().waitForEvent('page', { timeout: 20000 }).catch(() => null);
  await tapSel(c1 + ' .kcard-watch-btn');
  const tab = await popup;
  ok(!!tab, `${width}: tapping Watch video opens the video`);
  if (tab) await tab.close().catch(() => {});

  // Open and close the thumbnail.
  await bigEnough(c1 + ' .kcard-thumb-zoom', 'thumbnail zoom');
  await tapSel(c1 + ' .kcard-thumb-zoom');
  ok(await waitFor(() => p.evaluate(() => { const l = document.getElementById('kasperLightbox'); return !!l && getComputedStyle(l).display !== 'none' && l.classList.contains('open'); }), 5000), `${width}: tapping the thumbnail opens it full screen`);
  await bigEnough('#kasperLightbox .kasper-lightbox-close', 'lightbox close');
  await tapSel('#kasperLightbox .kasper-lightbox-close');
  ok(await waitFor(() => p.evaluate(() => { const l = document.getElementById('kasperLightbox'); return !l.classList.contains('open'); }), 5000), `${width}: tapping close shuts it`);

  // Comment, request change, approve: through the real buttons, by tap.
  const vPanel = c1 + ' .cal-review-panel[data-comp="video"]';
  const gPanel = c1 + ' .cal-review-panel[data-comp="graphic"]';
  const hasV = await p.$(vPanel), hasG = await p.$(gPanel);
  ok(!!hasV && !!hasG, `${width}: the opened card shows its video and thumbnail panels`);
  if (hasV) {
    await tapSel(vPanel + ' .cal-review-textarea');
    await p.fill(vPanel + ' .cal-review-textarea', 'Phone comment ' + width + ' ' + TS);
    await bigEnough(vPanel + ' .cal-review-comment-btn', 'Comment');
    await tapSel(vPanel + ' .cal-review-comment-btn');
    ok(await waitFor(() => saves.some(x => x.id === cards[1].id && String(x.video_tweaks || '').includes('Phone comment ' + width + ' ' + TS)), 20000), `${width}: tapping Comment saves the comment on the card`);
    await p.waitForSelector(vPanel + ' .cal-review-textarea', { timeout: 10000 }).catch(() => {});
    await tapSel(vPanel + ' .cal-review-textarea');
    await p.fill(vPanel + ' .cal-review-textarea', 'Phone tweak ' + width + ' ' + TS);
    await bigEnough(vPanel + ' .cal-review-tweak-btn', 'Request change');
    await tapSel(vPanel + ' .cal-review-tweak-btn');
    // A Kasper change request is saved on the card as a tweak; the card only
    // moves to "Tweaks pending" when he taps Finish reviewing.
    const isTweak = x => { try { return JSON.parse(x.video_tweaks || '[]').some(t => t.body === 'Phone tweak ' + width + ' ' + TS && t.is_tweak === true); } catch (e) { return false; } };
    ok(await waitFor(() => saves.some(x => x.id === cards[1].id && isTweak(x)), 20000), `${width}: tapping Request change saves the change request on the card`);
  }
  if (hasG) {
    await bigEnough(gPanel + ' .cal-review-approve-btn', 'Approve');
    await tapSel(gPanel + ' .cal-review-approve-btn');
    ok(await waitFor(() => saves.some(x => x.id === cards[1].id && x.graphic_status === 'Client Approval'), 20000), `${width}: tapping Approve sends the thumbnail to the client`, JSON.stringify(saves.map(x => x.graphic_status)));
  }
  // The native comment is sent after the card save, so it is checked last.
  ok(await waitFor(() => NW.commentCalls(gateway, NW.nativeDeliverableId(cards[1].id, 'video')).length >= 1, 30000), `${width}: the comment reached the native gateway for the video work item`);
  ok(NW.retiredCallCount(retired) === 0, `${width}: the retired Linear webhooks received nothing`);
  ok(errs.length === 0, `${width}: no app errors`, errs[0]);
  await ctx.close();
}

(async () => {
  const px = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await L.PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors'].concat(px ? ['--proxy-server=' + px, '--proxy-bypass-list=127.0.0.1;localhost'] : []) });
  try {
    await realIdentity();
    for (const w of (process.env.KPT_WIDTHS || '390,375').split(',').map(Number)) {
      // Fresh cards for each width, so each run starts at Kasper Approval
      // with nothing already opened.
      cards = [0, 1].map(i => ({ id: 'p_kphone' + w + i + '_' + TS, name: 'Kasper phone ' + w + ' ' + i + ' ' + TS }));
      made.push(...cards);
      for (const c of cards) {
        NW.registerProbeWorkItems([{ id: c.id, components: ['video', 'graphic'] }]);
        L.upCal({ id: c.id, name: c.name, asset_url: 'https://frame.io/x/' + c.id,
          thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Approved',
          status: 'Kasper Approval', kasper_approved_at: '', kasper_seen: '' });
      }
      await sleep(3000);
      await runAt(browser, w);
    }
  } catch (e) {
    ok(false, 'raised: ' + String(e && e.message || e).split('\n')[0].slice(0, 160));
  } finally {
    await browser.close();
    for (const c of made) ok(L.archiveCalSafe(c.id) !== false, 'cleanup: card archived ' + c.id);
    console.log(`\npass=${results.filter(Boolean).length} fail=${results.filter(x => !x).length} (test client ${TEST_CLIENT.slug.length ? 'only' : ''})`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
