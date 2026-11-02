'use strict';
/*
 * TRIAL REELS, MANY CLIENTS IN ONE READ, in a real browser, fully offline (session Trialchange, OPEN_REPAIRS 631).
 *
 * With the switch on for every client (trial_reels_pages = { "all": true }, 2 Nov 00:49 UTC), Kasper's queue asked
 * trial-reels once per client as it loaded: 48 requests in one second. On 2 Nov at 01:05 UTC the platform refused part
 * of such a burst from a staff browser (429, sb-error-code RATE_LIMIT_EXCEEDED, before the function ran), and each
 * refused client's trial cards drew as ordinary cards. The page now asks for many clients in one list_many request,
 * retries a refused or lost read with backoff (honouring Retry-After), and never counts a refused read as read.
 *
 *   new     one Kasper queue load makes ONE trial-reels request (list_many, every client in it), not one per client,
 *           and the trial card shows its versions.
 *   old     a function from before list_many answers 400 unknown_action (the deploy window): the page asks one client
 *           at a time, as before, and the trial card still shows its versions.
 *   retry   the first list_many is refused with 429 and Retry-After: 1: the page asks again after it, and the trial
 *           card still shows its versions. No console error is left from it but the browser's own resource line.
 *   lost    every read is refused: the card draws as today, and nothing marks the client as read (the next load after
 *           the cool-down asks again).
 * TRB_PART=new|old|retry|lost runs one part. Data: the review page's shared fixture (fictional clients and cards).
 */
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { SLUG, STAFF, CLIENT, open, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'retry-after' };
const part = k => !process.env.TRB_PART || process.env.TRB_PART === k;
const LINK = l => 'https://f.io/fixture-batch-' + l.toLowerCase();

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const versions = () => ['A', 'B', 'C'].map(l => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0,
    updated_at: '2026-10-27T09:00:00.000Z', hook: 'Fictional hook ' + l, smm_ok_at: '2026-10-27T08:00:00.000Z', kasper_ok_at: null, client_ok_at: null }));

  /* fn: 'new' answers list_many; 'old' refuses it as a function from before it does. refuse: how many reads to
     refuse with 429 first (Infinity: every one). */
  async function start(fn, refuse) {
    const t = await open(browser, origin, { stage: 'kasper', flags: 'on', flagValues: { trial_reels_pages: { all: true } }, staff: STAFF });
    t.calls = [];
    t.consoleErrors = [];
    t.page.on('console', m => { if (m.type() === 'error') t.consoleErrors.push(m.text().slice(0, 200)); });
    let refused = 0;
    const V = versions();
    const shape = () => Object.assign({ enabled: true, winner_letter: null }, L.readShape(V, { client: false, mainLink: V[0].frame_url, cardStatus: 'Kasper Approval' }));
    const cardsOf = slug => slug === SLUG ? { rs1: shape() } : {};
    await t.ctx.route('**/functions/v1/trial-reels', async route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const b = JSON.parse(r.postData() || '{}');
      t.calls.push({ action: b.action, n: Array.isArray(b.clients) ? b.clients.length : 1, at: Date.now() });
      const reply = (o, s, h) => route.fulfill({ status: s || 200, headers: Object.assign({}, CORS, h || {}), contentType: 'application/json', body: JSON.stringify(o) });
      // Only a read that carries the trial card's client is refused, so the card shows only if that read is retried.
      const carries = b.action === 'list_many' ? (b.clients || []).map(c => String(c).toLowerCase()).includes(SLUG) : b.action === 'list' && String(b.client || '').toLowerCase() === SLUG;
      if (carries && refused < refuse) {
        refused++;
        // As the platform answers it: before the function runs, with its own error code.
        return reply({ code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' }, 429, { 'retry-after': '1', 'sb-error-code': 'RATE_LIMIT_EXCEEDED' });
      }
      if (b.action === 'list_many') {
        if (fn === 'old') return reply({ ok: false, error: 'unknown_action' }, 400);
        const asked = (b.clients || []).map(c => String(c).toLowerCase());
        const plan = L.listManyPlan(asked, { all: true });
        if (plan.error) return reply({ ok: false, error: plan.error }, 400);
        return reply({ ok: true, clients: Object.fromEntries(plan.clients.map(s => [s, { cards: cardsOf(s) }])) });
      }
      if (b.action === 'list') return reply({ ok: true, cards: cardsOf(String(b.client || '').toLowerCase()) });
      return reply({ ok: true, enabled: false });
    });
    await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
    t.calls.length = 0;
    await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
    await waitNew(t);
    return t;
  }
  // The trial card's version bar (Video A, B, C) on Kasper's review page, once it is drawn.
  const trialShown = (t, ms) => t.page.waitForFunction(() => {
    const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot;
    return !!(r && [...r.querySelectorAll('.trv, .trk')].some(n => /Video A/.test(n.innerText || '')));
  }, null, { timeout: ms || 8000 }).then(() => true, () => false);

  try {
    if (part('new')) {
      const t = await start('new', 0);
      const shown = await trialShown(t);
      await sleep(1500);
      const many = t.calls.filter(c => c.action === 'list_many');
      ok(t.calls.length === 1 && many.length === 1, `new: one Kasper queue load makes one trial-reels request (${t.calls.length}: ${t.calls.map(c => c.action + '×' + c.n).join(', ')})`);
      ok(many.length && many[0].n > 1, `new: that one request asks for every client of the queue (${many.length ? many[0].n : 0})`);
      ok(shown, 'new: the trial card shows its versions');
      ok(!t.errors.length, `new: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    if (part('old')) {
      const t = await start('old', 0);
      const shown = await trialShown(t);
      await sleep(1500);
      const many = t.calls.filter(c => c.action === 'list_many'), single = t.calls.filter(c => c.action === 'list');
      ok(many.length === 1 && single.length > 1, `old: the function does not know list_many, so the page asks one client at a time, as before (${many.length} list_many, ${single.length} list)`);
      ok(shown, 'old: the trial card still shows its versions');
      ok(!t.errors.length, `old: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    if (part('retry')) {
      const t = await start('new', 1);
      const shown = await trialShown(t, 10000);
      const many = t.calls.filter(c => c.action === 'list_many');
      ok(many.length === 2, `retry: the refused list_many is asked again (${many.length} list_many)`);
      ok(many.length === 2 && many[1].at - many[0].at >= 900, `retry: after the Retry-After second (${many.length === 2 ? many[1].at - many[0].at : '-'} ms)`);
      ok(shown, 'retry: a 429 on the first try still shows the trial card after the retry');
      const noise = t.consoleErrors.filter(x => !/status of 429/.test(x) && /trial|429|rate/i.test(x));
      ok(!noise.length, `retry: no console error from it but the browser's own resource line (${noise.join(' | ')})`);
      ok(!t.errors.length, `retry: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    if (part('lost')) {
      const t = await start('new', Infinity);
      await sleep(9000);
      const reads = t.calls.length;
      ok(reads === 3, `lost: the one read is tried three times (once and two retries), then left (${reads})`);
      const state = await t.page.evaluate(slug => { try { const e = _trlCards[slug]; return e ? { at: e.at, failedAt: e.failedAt, n: Object.keys(e.cards).length } : null; } catch (err) { return { err: String(err) }; } }, SLUG);
      ok(state && state.at === 0 && state.failedAt > 0, `lost: a refused read does not count as read (${JSON.stringify(state)})`);
      ok(!(await trialShown(t, 500)), 'lost: the card draws as today, with no versions');
      ok(!t.errors.length, `lost: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\ntrial-reels-batch-browser: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.error('  - ' + f)); process.exit(1); }
})();
