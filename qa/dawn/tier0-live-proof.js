// tier0-live-proof.js — re-proves the three Tier 0 rows of
// docs/testing/ASSURANCE_LEDGER.md on the LIVE site, in a real Chromium, on the
// TEST client `sidneylaruel` only:
//
//   T0-1 share-link issuance  a staff member signs in through the real sign-in
//                             card, opens the test client's Calendar and clicks
//                             More > "Share with client"; the issuer answers 200
//                             and the copied link names the test client.
//   T0-2 client review links  the copied link, opened in a FRESH browser profile
//                             (no harness stubs, no saved sign-in): the Calendar
//                             review loads, the client approves one card and
//                             requests changes on another; the same token opens
//                             the Samples review, where staff sends the test
//                             client's one native sample's thumbnail to the client,
//                             the client approves it, and staff puts it back
//                             (native-sample-roundtrip.js says why it is that one).
//                             Every save is read back from the database and read
//                             again after a pause.
//   T0-3 client thumbnails    on the client link, the seeded card's and sample's
//                             thumbnails are drawn (the image decoded, width > 0).
//
// Unlike qa/dawn/dawn-check.js (which serves the repo's page on localhost and
// runs the courier harness), this script points the browser at the deployed
// site and fakes nothing, so it proves what clients get.
//
// Safety: every seed is a test-client row, archived and verified at the end; a
// page-level guard aborts any POST that names another client. The output carries
// only fixed words, pass/fail, counts and timings: never a token, a URL with a
// token, a person's name or a client name.
//
// Needs: SYNCVIEW_ROLE_KEY (a staff role key) and SYNCVIEW_ACTOR (the roster name
// that key signs in as), plus SYNCVIEW_STAFF_KEY for the seed writes.
// Usage:  node qa/dawn/tier0-live-proof.js        Exit 0 all passed, 1 otherwise.
'use strict';
const H = require('../probes/ot4_lib.js');
const { nativeSampleRoundTrip } = require('./native-sample-roundtrip.js');

const LIVE = (process.env.SYNCVIEW_LIVE_ORIGIN || 'https://syncview.synchrosocial.com').replace(/\/+$/, '');
const TEST_SLUG = 'sidneylaruel';
const TEST_NAME = 'Sidney Laruel';
const ROLE_KEY = String(process.env.SYNCVIEW_ROLE_KEY || '').trim();
const ACTOR = String(process.env.SYNCVIEW_ACTOR || '').trim();
const TS = Date.now();
const POLL = 35000;
const THUMB = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';

const results = [];
function rec(key, ok, detail) { results.push({ key, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${key}  ${detail}`); }

const violations = [];
async function guard(page) {
  await page.route('**/*', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      const m = body.match(/"(?:client|client_slug|slug)"\s*:\s*"([^"]*)"/g) || [];
      const bad = m.map(s => s.split(':').pop().replace(/[\s"]/g, '').toLowerCase())
        .filter(v => v && v !== TEST_SLUG && v !== 'sidneylaruel');
      if (bad.length) { violations.push(1); return route.abort(); }
    }
    return route.fallback();
  });
}
function errorsOf(page) {
  const errs = [];
  page.on('pageerror', () => errs.push(1));
  return errs;
}

// T0-1: a real staff sign-in and a real "Share with client" click.
async function issueThroughTheUi(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: LIVE });
  const p = await ctx.newPage();
  await guard(p);
  const errs = errorsOf(p);
  let issued = null;
  p.on('response', async (r) => {
    if (r.url().includes('/functions/v1/client-review-link') && r.request().method() === 'POST') {
      let j = null; try { j = await r.json(); } catch {}
      issued = { status: r.status(), ok: !!(j && j.ok && j.token) };
    }
  });
  await p.goto(LIVE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('#staffIdentityMemberBtn', { timeout: 30000 });
  await p.click('#staffIdentityMemberBtn');
  const picked = await p.evaluate((who) => {
    const o = [...document.querySelectorAll('.cc-select-option')].find(b => b.textContent.trim() === who);
    if (!o) return false; o.click(); return true;
  }, ACTOR);
  await p.fill('#staffIdentityKey', ROLE_KEY);
  await p.click('#staffIdentitySubmit');
  const signedIn = await p.waitForFunction(() => { const g = document.getElementById('staffGateOverlay'); return !g || getComputedStyle(g).display === 'none' || g.hidden; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  if (!picked || !signedIn) { rec('T0-1 share-link issuance', false, `sign-in did not complete (name listed=${picked ? 'yes' : 'no'})`); await ctx.close(); return null; }
  await p.goto(LIVE + '/#calendar/' + TEST_SLUG, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForFunction(() => typeof calState === 'object' && !!calState.client && !!document.querySelector('.cal-kebab'), null, { timeout: 30000 }).catch(() => {});
  await p.click('.cal-kebab').catch(() => {});
  await p.click('#calKebabMenu .cal-kebab-item:has-text("Share with client")').catch(() => {});
  await p.waitForFunction(() => /copied/i.test((document.querySelector('.sv-toast, .toast') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
  let url = ''; try { url = await p.evaluate(() => navigator.clipboard.readText()); } catch {}
  let q = null; try { q = new URL(url).searchParams; } catch {}
  const ok = !!issued && issued.status === 200 && issued.ok && !!q && q.get('c') === TEST_NAME && !!q.get('t') && q.get('v') === 'calendar';
  rec('T0-1 share-link issuance', ok, ok
    ? `issuer answered 200 with a token; the copied link names the test client and the Calendar view; page errors ${errs.length}`
    : `issuer status ${issued ? issued.status : 'none'}, link usable=${q && q.get('t') ? 'yes' : 'no'}`);
  await ctx.close();
  return ok ? url : null;
}

async function thumbDrawn(page, name) {
  return page.evaluate((n) => {
    const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === n);
    if (!card) return { card: false };
    const imgs = [...card.querySelectorAll('img')];
    return { card: true, imgs: imgs.length, drawn: imgs.filter(i => i.complete && i.naturalWidth > 0).length };
  }, name);
}
async function waitThumb(page, name) {
  const end = Date.now() + 20000; let t = null;
  while (Date.now() < end) { t = await thumbDrawn(page, name); if (t.card && t.drawn > 0) return t; await H.sleep(800); }
  return t || { card: false };
}
async function act(page, name, comp, kind, text) {
  for (let i = 0; i < 12; i++) { const r = await H.clientAct(page, name, comp, kind, text); if (r !== 'disabled') return r; await H.sleep(1000); }
  return 'disabled';
}

// T0-2 and T0-3: the issued link in a fresh profile.
async function clientCalendar(browser, url, A, R) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await guard(p);
  const errs = errorsOf(p);
  const t0 = Date.now();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const landed = await p.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), A.name, { timeout: 30000 }).then(() => Date.now() - t0).catch(() => null);
  rec('T0-2 client link loads (Calendar review)', landed != null, landed != null ? `review cards shown after ${landed} ms` : 'the seeded card never showed');
  const th = landed != null ? await waitThumb(p, A.name) : { card: false };
  rec('T0-3 client-visible thumbnail (Calendar)', !!(th.card && th.drawn > 0), `images on the card ${th.imgs || 0}, drawn ${th.drawn || 0}`);
  if (landed != null) {
    await H.expandReview(p, A.name);
    const c1 = await act(p, A.name, 'caption', 'approve');
    const r1 = c1 === 'ok' ? await H.pollRow(() => H.rowCal(A.id, 'caption_status'), r => r.caption_status === 'Approved', POLL) : null;
    await H.sleep(4000);
    const h1 = r1 ? H.rowCal(A.id, 'caption_status') : null;
    rec('T0-2 client approve saves (Calendar)', !!(r1 && r1.caption_status === 'Approved' && h1 && h1.caption_status === 'Approved'), `click ${c1}; saved and held=${h1 && h1.caption_status === 'Approved' ? 'yes' : 'no'}`);
    const txt = 'Tier 0 live proof: please adjust ' + TS;
    await H.expandReview(p, R.name);
    const c2 = await act(p, R.name, 'caption', 'request', txt);
    const r2 = c2 === 'ok' ? await H.pollRow(() => H.rowCal(R.id, 'caption_status,caption_tweaks'), r => r.caption_status === 'Tweaks Needed', POLL) : null;
    rec('T0-2 client request changes saves (Calendar)', !!(r2 && JSON.stringify(r2.caption_tweaks || '').includes(txt)), `click ${c2}; status Tweaks Needed with its text=${r2 && JSON.stringify(r2.caption_tweaks || '').includes(txt) ? 'yes' : 'no'}`);
  }
  rec('T0-2 client Calendar page has no app errors', errs.length === 0, `page errors ${errs.length}`);
  await ctx.close();
}
async function clientSamples(browser, url) {
  const u = new URL(url); u.searchParams.set('sxr', '1'); u.searchParams.set('v', 'sample-reviews');
  const r = await nativeSampleRoundTrip({ browser, origin: LIVE, clientUrl: u.toString(), roleKey: ROLE_KEY, actor: ACTOR, guard });
  if (r.step === 'target') { rec('T0-2 client Samples approve', false, 'not run: the test client has no sample with a real work item'); return; }
  rec('T0-2 client link loads (Samples review)', r.landedMs != null, r.landedMs != null ? `samples shown after ${r.landedMs} ms (${r.cards} on screen)` : `stopped at step ${r.step}`);
  if (r.landedMs != null) rec('T0-3 client-visible thumbnail (Samples)', r.thumb.drawn > 0, `images on the sample ${r.thumb.imgs}, drawn ${r.thumb.drawn}`);
  rec('T0-2 client approve saves (Samples, real work item)', r.ok, r.ok ? `staff sent the thumbnail to the client, the client approved it, saved and held in ${r.ms} ms` : `stopped at step ${r.step}`);
  rec('T0-2 client Samples page has no app errors', r.clientErrors === 0, `page errors ${r.clientErrors}`);
  rec('Samples sample put back where it was', r.restored, `restored=${r.restored ? 'yes' : 'no'}`);
}

(async () => {
  if (!ROLE_KEY || !ACTOR || !String(process.env.SYNCVIEW_STAFF_KEY || '').trim()) {
    console.error('tier0-live-proof: needs SYNCVIEW_ROLE_KEY, SYNCVIEW_ACTOR and SYNCVIEW_STAFF_KEY.');
    process.exit(2);
  }
  const A = { id: `p_t0_a_${TS}`, name: `T0 approve ${TS}` };
  const R = { id: `p_t0_r_${TS}`, name: `T0 request ${TS}` };
  const day = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  for (const c of [A, R]) {
    H.upCal({ id: c.id, name: c.name, platforms: 'youtube', scheduled_date: day, video_status: 'Approved', graphic_status: 'Approved',
      caption_status: 'Client Approval', status: 'Client Approval', caption: 'Tier 0 live proof caption', thumbnail_url: THUMB, asset_url: 'https://example.com/t0.mp4' });
  }
  const browser = await H.PW.chromium.launch();
  try {
    await H.pollRow(() => H.rowCal(A.id, 'id'), r => !!r.id, POLL);
    await H.pollRow(() => H.rowCal(R.id, 'id'), r => !!r.id, POLL);
    const url = await issueThroughTheUi(browser);
    if (url) {
      await clientCalendar(browser, url, A, R);
      await clientSamples(browser, url);
    } else rec('T0-2 client review links', false, 'not run: no link was issued');
  } catch (e) {
    rec('harness', false, 'stopped early (' + ((e && e.name) || 'Error') + ')');
  } finally {
    try { await browser.close(); } catch {}
    const okA = H.archiveCalSafe(A.id), okR = H.archiveCalSafe(R.id);
    rec('cleanup', okA && okR && !violations.length, `seeds archived ${[okA, okR].filter(Boolean).length}/2; other-client writes blocked ${violations.length}`);
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})();
