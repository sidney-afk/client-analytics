'use strict';
/*
 * TRIAL REELS SWITCHED ON FOR EVERYONE (trial_reels_pages = { "all": true }), with no card of the client using it, in a
 * real browser, fully offline, on the review page's shared fixture (fictional clients and cards). Session Trialchange,
 * 2026-11-01, before the switch goes to every client. The trial-reels read is held slow, as a cold function can be.
 *   client     the client link draws the same review as with the switch off, and nothing of trial reels shows before
 *              or after the read lands (no trial words, no version bar, no tile placeholders). With a trial read at a
 *              normal speed (300 ms) the video's answer is up as fast as with the switch off. With a very slow one
 *              (3 s) the review is up as fast, and the video's answer waits for the read at most 2 s (194: it never
 *              answers a trial card's whole video before the card's trial read is in).
 *   kasper     Kasper's queue is not held back by the trial reads: with the switch on for every client, his queue waited
 *              for one trial-reels read per client before it even started reading the cards (41 live clients: 0.6 to
 *              2.6 s, measured 2026-11-01). The reads now run beside the card read, and the queue is cut once both are
 *              in (the trial reads waited for at most a few seconds).
 *   kasper2    Kasper's second layout: no tile placeholders are left on a card that is not a trial card.
 * TRE_PART=client|kasper|kasper2 runs one part.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const part = k => !process.env.TRE_PART || process.env.TRE_PART === k;
let TRIAL_MS = 3000;     // the trial-reels read, held
const POSTS_MS = 3000;   // the card read, held

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  // `on`: the switch for every client; off: for another client only.
  async function start(mode, on, extra) {
    const t = await open(browser, origin, Object.assign({ stage: mode, flags: 'on', flagValues: { trial_reels_pages: on ? { all: true } : { clients: ['someotherclient'] } } },
      mode !== 'client' ? { staff: STAFF } : {}, extra || {}));
    t.trialCalls = [];
    await t.ctx.route('**/functions/v1/trial-reels', async route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const b = JSON.parse(r.postData() || '{}');
      t.trialCalls.push(b.action);
      await sleep(TRIAL_MS);
      const body = b.action === 'list' ? { ok: true, cards: {} } : { ok: true, enabled: false };
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    });
    return t;
  }
  const R = (t, fn) => t.page.evaluate(f => (new Function('r', f))(document.getElementById('svReviewStage').shadowRoot), String(fn));
  const trialBits = t => R(t, `return [...r.querySelectorAll('.trv, .trv-tag, .trv-why, .trk, .trk-skel, .trv-dot, [data-trv-go], [data-pass]')].length;`);
  const rowText = t => R(t, `const d = r.querySelector('.drow, .decide, #decide'); return d ? d.innerText.replace(/\\s+/g, ' ').trim() : '';`);

  try {
    // ---------- client: the review is the same, as fast, with nothing of trial reels ----------
    for (const [ms0, slow] of [[300, false], [3000, true]].filter(() => part('client'))) {
      TRIAL_MS = ms0;
      const seen = {};
      for (const on of [false, true]) {
        const t = await start('client', on, { width: 1440, height: 900 });
        const t0 = Date.now();
        await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: 'fixture-review-stage-token' }), { waitUntil: 'domcontentloaded' });
        await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!(h && h.shadowRoot && h.shadowRoot.querySelector('#stepper .stp')); }, null, { timeout: 30000 });
        const up = Date.now() - t0;
        await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const b = h && h.shadowRoot && h.shadowRoot.querySelector('[data-ok]'); return !!(b && b.offsetParent); }, null, { timeout: 30000 });
        const ms = Date.now() - t0;
        const early = await trialBits(t);
        await sleep(TRIAL_MS + 800);
        seen[on] = { up, ms, early, late: await trialBits(t), row: await rowText(t), calls: t.trialCalls.length, errors: t.errors.slice() };
        await t.ctx.close();
      }
      const a = seen[false], b = seen[true];
      const L = `client (trial read ${TRIAL_MS} ms)`;
      ok(b.calls > 0, `${L}: with the switch on for everyone the page reads trial reels (${b.calls} read(s))`);
      ok(b.up - a.up < 1200, `${L}: the review is up as fast with the switch on (${b.up} ms) as off (${a.up} ms)`);
      if (!slow) ok(b.ms - a.ms < 800, `${L}: the video's answer is up as fast with the switch on (${b.ms} ms) as off (${a.ms} ms)`);
      else ok(b.ms - a.ms < 2800, `${L}: the video's answer waits for the slow read at most about 2 s (${b.ms} ms on, ${a.ms} ms off)`);
      ok(b.early === 0 && b.late === 0, `${L}: nothing of trial reels on a card that is not a trial card, before or after the read (${b.early} / ${b.late})`);
      ok(b.row === a.row, `${L}: the decision row reads the same ("${b.row}" / "${a.row}")`);
      ok(!a.errors.length && !b.errors.length, `${L}: no page errors (${a.errors.concat(b.errors).join(' | ')})`);
    }

    TRIAL_MS = 3000;
    // ---------- kasper: the queue is not held back by the trial reads ----------
    for (const [layout2, label] of [[false, 'kasper'], [true, 'kasper2']].filter(x => part(x[1]))) {
      const seen = {};
      for (const on of [false, true]) {
        const t = await start('kasper', on, Object.assign({ postsDelay: POSTS_MS }, layout2 ? { layout2: true } : {}));
        await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
        await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
        const t0 = Date.now();
        await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
        if (layout2) await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
        else await waitNew(t);
        const ms = Date.now() - t0;
        await sleep(TRIAL_MS + 800);
        seen[on] = { ms, late: await trialBits(t), errors: t.errors.slice(), calls: t.trialCalls.length };
        await t.ctx.close();
      }
      const a = seen[false], b = seen[true];
      ok(b.calls > 0, `${label}: with the switch on for everyone Kasper's page reads trial reels (${b.calls} read(s))`);
      ok(b.ms - a.ms < 1500, `${label}: the queue is up in ${b.ms} ms with the switch on against ${a.ms} ms off (card read ${POSTS_MS} ms, trial read ${TRIAL_MS} ms, side by side, not one after the other)`);
      ok(b.late === 0, `${label}: nothing of trial reels left on a card that is not a trial card once the read is in (${b.late})`);
      ok(!a.errors.length && !b.errors.length, `${label}: no page errors (${a.errors.concat(b.errors).join(' | ')})`);
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\ntrial-reels-everyone-browser: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.error('  - ' + f)); process.exit(1); }
})();
