'use strict';
/*
 * ONE RETRY FOR THE TWO BOOT READS THAT HAD NONE (session Retry, 2026-10-18). Fully offline: a fictional staff member,
 * every backend call answered locally, and the three reads below answered the way each case says. The reads:
 *   - flags:  the page head's one public-flag read (the batch of seven keys),
 *   - review: the review-stage switch read (188),
 *   - roster: the Google Sheets "Clients Info" read the Analytics boot makes.
 * For each: a first attempt that fails at the network level, or answers 5xx / 429, is tried once more about a second
 * later on the SAME address (so the read/console audit counts it as recovered), a 4xx is never retried, and when the
 * retry fails too the old fallback stands (the page still loads and nothing throws).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const fx = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const READS = {
  flags: u => u.pathname === '/rest/v1/syncview_runtime_flags' && u.searchParams.get('limit') === '7' && (u.searchParams.get('key') || '').includes('kasper_urgent_ping_enabled'),
  review: u => u.pathname === '/rest/v1/syncview_runtime_flags' && (u.searchParams.get('key') || '').includes('review_stage_client_pages'),
  roster: u => u.host === 'docs.google.com' && u.searchParams.get('sheet') === 'Clients Info',
};
// What each attempt does, in order; after the list runs out the fixture's normal answer is used.
const CASES = [
  { name: 'network reset, then ok', plan: ['reset'], attempts: 2, recovered: true },
  { name: 'server 503, then ok', plan: [503], attempts: 2, recovered: true },
  { name: 'rate limit 429, then ok', plan: [429], attempts: 2, recovered: true },
  { name: 'both attempts reset', plan: ['reset', 'reset'], attempts: 2, recovered: false },
  { name: 'client error 401 is not retried', plan: [401], attempts: 1, recovered: false },
  { name: 'client error 404 is not retried', plan: [404], attempts: 1, recovered: false },
];

async function run(browser, origin, read, c) {
  const t = await fx.open(browser, origin, { stage: 'smm', staff: fx.STAFF, flags: 'on' });
  const seen = [];
  const consoleErrors = [];
  t.page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  let n = 0;
  // Registered after the fixture's catch-all, so it answers first.
  await t.ctx.route('**/*', async route => {
    const r = route.request();
    let u; try { u = new URL(r.url()); } catch (e) { return route.fallback(); }
    if (r.method() !== 'GET' || !READS[read](u)) return route.fallback();
    const step = c.plan[n++];
    seen.push({ at: Date.now(), step: step === undefined ? 'ok' : step });
    if (step === undefined) return route.fallback();
    if (step === 'reset') return route.abort('connectionreset');
    return route.fulfill({ status: step, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"message":"fixture"}' });
  });
  await t.page.goto(origin + '/index.html#today', { waitUntil: 'load' });
  await fx.sleep(3600);
  const alive = await t.page.evaluate(() => !!document.getElementById('mainWrap') && !!document.querySelector('header.header'));
  await t.ctx.close();
  return { seen, consoleErrors, alive, errors: t.errors };
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const read of Object.keys(READS)) {
      for (const c of CASES) {
        const name = read + ': ' + c.name;
        console.log('--- ' + name + ' ---');
        const r = await run(browser, origin, read, c);
        expect(r.seen.length === c.attempts, name + ': ' + c.attempts + ' attempt(s) at that address (saw ' + r.seen.length + ')');
        if (c.attempts === 2) {
          const gap = r.seen[1].at - r.seen[0].at;
          expect(gap >= 900 && gap < 2500, name + ': the retry comes after a short pause (' + gap + ' ms)');
        }
        if (c.recovered) expect(r.seen[1].step === 'ok', name + ': the second attempt is answered normally');
        // The browser's own "Failed to load resource" line for a failed attempt is the audit's to match to the
        // recovery; anything else on the console is the app's and is not allowed.
        const appErrors = r.consoleErrors.filter(m => !/^Failed to load resource/.test(m));
        expect(appErrors.length === 0, name + ': no console error from the app (' + appErrors.join(' | ').slice(0, 200) + ')');
        expect(r.alive && r.errors.length === 0, name + ': the page still loads, no page errors (' + r.errors.join(' | ') + ')');
      }
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' check(s) failed'); process.exit(1); }
  console.log('\nBoot reads retry: all checks passed');
})();
