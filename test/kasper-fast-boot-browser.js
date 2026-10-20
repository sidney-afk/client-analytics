'use strict';
/*
 * KASPER'S TAB BOOTS FAST (owner request 2026-10-20, session Quick).
 * Real browser, fully offline, the shared mocked backend of review-stage-browser.js (fictional client, cards, people).
 *
 * Behind the runtime flag kasper_fast_boot { "staff": [...] } (same listing rule as the review switches, default off):
 *   - no "Refreshing" pill on the tab, on entry or on a later refresh;
 *   - the review page's code and the player's switch are asked for at page start, not when the first card paints after
 *     the list has loaded;
 *   - the first card's video address is asked for while the list is still being drawn (not when the stage mounts);
 *   - on a second visit, while the switch read is on its way, the tab holds its loader instead of drawing the old page
 *     and swapping to the new one.
 * Flag off, naming someone else, the wrong shape: the tab is exactly as it was (pill, late start, old page first).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, OTHER, open, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
let checks = 0;
function expect(value, message) { checks++; if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

// Records, from the first moment of the page, whether the pill was ever shown and whether the old page's list was ever drawn.
const WATCH = () => {
  window.__pillShown = false; window.__oldList = false; window.__loader = false;
  const look = () => {
    const pill = document.getElementById('kasperReviewRefreshPill');
    if (pill && !pill.hidden) window.__pillShown = true;
    const body = document.getElementById('kasperReviewBody');
    if (body && body.querySelector('#kasperWaitingWrap, .kasper-list, .kcard')) window.__oldList = true;
    if (body && body.querySelector('.sv-skel, [data-skeleton], .sv-loading-skeleton, [aria-label="Loading Kasper review"]')) window.__loader = true;
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
};

// One visit to Kasper's tab on t.page (the roster is merged by hand, as the other Kasper tests do).
async function boot(t, origin, hash) {
  await t.page.addInitScript(WATCH);
  await t.page.goto(origin + '/index.html#' + (hash || 'kasper'), { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
}
// A second visit in the same browser (same storage: the cards and the hint of the first one are still there).
async function again(t, origin, delays) {
  await t.page.close();
  t.page = await t.ctx.newPage();
  t.page.on('pageerror', e => t.errors.push(String(e.message || e).slice(0, 200)));
  t.state.reqLog = [];
  // The live switch read no longer lists the person (a hint from an earlier visit still does).
  if (delays && delays.dropFast) { t.state.dropFast = true; await t.ctx.route('**/rest/v1/syncview_runtime_flags?select=key,value*', async route => { await sleep(delays.dropFast); await route.fallback(); }); }
  if (delays && delays.frameFlag) await t.ctx.route('**/rest/v1/syncview_runtime_flags?select=value&key=eq.frame_viewer_clients*', async route => { await sleep(delays.frameFlag); await route.fallback(); });
  if (delays && delays.noHint) await t.page.addInitScript(() => { try { localStorage.removeItem('sv-kasper-fast'); } catch (e) {} });
  if (delays && delays.flags) await t.ctx.route('**/rest/v1/syncview_runtime_flags*', async route => { await sleep(delays.flags); await route.fallback(); });
  if (delays && delays.posts) t.state.postsDelay = delays.posts;
  // No saved list in this browser: the first card appears only when the list has loaded.
  if (delays && delays.noCache) await t.page.addInitScript(() => { try { localStorage.removeItem('syncview_kasper_review_cache_v1'); } catch (e) {} });
  await boot(t, origin, delays && delays.hash);
}
const stageUp = page => page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && !h.hidden && r.querySelectorAll('.pn, #stepper > *').length); }, null, { timeout: 30000 });
const first = (state, re) => { const hit = (state.reqLog || []).find(x => re.test(x.path + (x.key ? '?' + x.key : ''))); return hit ? hit.t : 0; };
const newTab = (browser, origin, o) => open(browser, origin, Object.assign({ stage: 'kasper', flags: 'on', staff: STAFF, expectNew: true, linkedParts: true, mergeComments: true, reqLog: true }, o));

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---------- the pill, flag on / off / someone else ----------
    for (const [label, opt, expectPill] of [
      ['flag off', {}, true],
      ['flag names someone else', { fast: { staff: [OTHER.id] } }, true],
      ['flag wrong shape', { fast: { staff: 'everyone' } }, true],
      ['flag on', { fast: true }, false],
    ]) {
      console.log('--- pill: ' + label + ' ---');
      const t = await newTab(browser, origin, opt);
      await boot(t, origin);
      await stageUp(t.page);
      await sleep(1500);
      // A refresh with the cards already on screen (what a tab focus or a poll does): the pill belongs here.
      await t.page.evaluate(() => { window.__pillShown = false; });
      t.state.postsDelay = 1200;
      await t.page.evaluate(() => { _kasperLoadReview(true); });
      await sleep(600);
      const shown = await t.page.evaluate(() => window.__pillShown);
      expect(shown === expectPill, label + ': the refresh pill ' + (expectPill ? 'shows, as today' : 'never shows') + ' while the list refreshes');
      expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- what starts at page start (a second visit: this browser has seen the switch) ----------
    const timing = {};
    for (const [label, opt] of [['off', {}], ['on', { fast: true }]]) {
      console.log('--- start-up order, flag ' + label + ' ---');
      const t = await newTab(browser, origin, opt);
      await boot(t, origin);
      await stageUp(t.page);
      await sleep(1500);
      await again(t, origin, { flags: 600, posts: 1500, noCache: true });
      await stageUp(t.page);
      await sleep(1200);
      const posts = first(t.state, /calendar_posts/);
      timing[label] = {
        code: first(t.state, /reviewstage/) - posts,
        frameFlag: first(t.state, /syncview_runtime_flags\?eq\.frame_viewer_clients/) - posts,
        video: first(t.state, /frameio-view/) - posts,
      };
      console.log('     ms after the list was asked for: review page code ' + timing[label].code + ', player switch ' + timing[label].frameFlag + ', first video address ' + timing[label].video);
      if (label === 'on') {
        expect(timing.on.code <= 100, 'on: the review page\'s code is requested at page start, before the list is asked for (' + timing.on.code + ' ms)');
        expect(timing.on.frameFlag < 1000 && timing.off.frameFlag > 1500, 'on: the player\'s switch is read at page start, not when the first card paints (' + timing.on.frameFlag + ' ms vs ' + timing.off.frameFlag + ' ms)');
      } else {
        expect(timing.off.code >= 300, 'off (control): the review page\'s code waits for the switch read to come back, as today (' + timing.off.code + ' ms)');
      }
      expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
    expect(timing.on.video < timing.off.video - 300, 'the first card\'s video address is asked for sooner with the flag on (' + timing.on.video + ' ms vs ' + timing.off.video + ' ms after the list was asked for)');

    // ---------- a second visit: a loader, not the old page first ----------
    for (const [label, opt, wantOld] of [['flag off', {}, true], ['flag on', { fast: true }, false], ['flag on, review page switch off for this person', { fast: true, noKasperStage: true }, true]]) {
      console.log('--- second visit, ' + label + ' ---');
      const t = await newTab(browser, origin, opt);
      await boot(t, origin);
      await (opt.noKasperStage ? sleep(3000) : stageUp(t.page));
      await sleep(1500);
      await again(t, origin, { flags: 1500 });
      await (opt.noKasperStage ? sleep(5000) : stageUp(t.page));
      const old = await t.page.evaluate(() => window.__oldList);
      expect(old === wantOld, label + ': the old page\'s list ' + (wantOld ? 'is drawn first while the switch is read, as today' : 'is never drawn first, the loader holds instead'));
      expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
    // ---------- right after the rollout: no hint yet, the live answer arrives while the list is still loading ----------
    {
      console.log('--- no hint yet: the pill that showed before the answer goes when it arrives ---');
      const t = await newTab(browser, origin, { fast: true });
      await boot(t, origin);
      await stageUp(t.page);
      await sleep(1500);
      await again(t, origin, { flags: 700, posts: 3500, noHint: true });
      await sleep(2200);
      const pill = await t.page.evaluate(() => { const p = document.getElementById('kasperReviewRefreshPill'); return { there: !!p, hidden: p ? p.hidden : null, loading: _kasperState.loading }; });
      expect(pill.loading === true && pill.hidden === true, 'the list is still loading and the pill is hidden once the live answer says fast boot (' + JSON.stringify(pill) + ')');
      await t.ctx.close();
    }

    // ---------- the live answer takes fast boot away: the pill of a refresh already running comes back ----------
    {
      console.log('--- hint says yes, live answer says no ---');
      const t = await newTab(browser, origin, { fast: true });
      await boot(t, origin);
      await stageUp(t.page);
      await sleep(1500);
      await again(t, origin, { dropFast: 700, posts: 3500 });
      await sleep(2200);
      const pill = await t.page.evaluate(() => { const p = document.getElementById('kasperReviewRefreshPill'); return { hidden: p ? p.hidden : null, loading: _kasperState.loading }; });
      expect(pill.loading === true && pill.hidden === false, 'the refresh is still running and its pill is back once the live answer says no (' + JSON.stringify(pill) + ')');
      await t.ctx.close();
    }

    // ---------- another Kasper tool's address does not start the review page's download ----------
    {
      console.log('--- #kasper/hiring-process ---');
      const t = await newTab(browser, origin, { fast: true });
      await boot(t, origin);
      await stageUp(t.page);
      await sleep(1500);
      await again(t, origin, { hash: 'kasper/hiring-process' });
      await sleep(400);
      const early = first(t.state, /reviewstage/);
      expect(!early, 'the review page\'s code is not requested at page start for another tool\'s address');
      await t.ctx.close();
    }

    // ---------- the old #kasper/samples address is the Review Session: it still starts early ----------
    {
      console.log('--- #kasper/samples ---');
      const t = await newTab(browser, origin, { fast: true });
      await boot(t, origin);
      await stageUp(t.page);
      await sleep(1500);
      await again(t, origin, { hash: 'kasper/samples', flags: 600, posts: 1500, noCache: true });
      await sleep(1200);
      const posts = first(t.state, /calendar_posts/);
      const code = first(t.state, /reviewstage/);
      expect(code > 0 && code - posts <= 100, 'the review page\'s code is requested at page start for the old samples address (' + (code - posts) + ' ms after the list)');
      await t.ctx.close();
    }

    // ---------- a slow player switch (3.6 s): the first video is still warmed when it arrives ----------
    {
      console.log('--- slow player switch ---');
      const t = await newTab(browser, origin, { fast: true });
      await boot(t, origin);
      await stageUp(t.page);
      await sleep(1500);
      await again(t, origin, { frameFlag: 3600 });
      await stageUp(t.page);
      await sleep(6500);
      const warmed = first(t.state, /frameio-view/) > 0;
      expect(warmed, 'the first video address was asked for after the slow switch answered, with no one pressing anything');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\nkasper-fast-boot: ' + checks + ' checks, ' + (failures.length ? failures.length + ' FAILED' : 'all passed'));
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
