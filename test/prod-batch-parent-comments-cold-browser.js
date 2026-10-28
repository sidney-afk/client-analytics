'use strict';
/*
 * A COLD LINK TO A BATCH PARENT ASKS FOR NO COMMENT THREAD (OPEN_REPAIRS 543, session Comment403).
 *
 * A batch parent (`bat_...`, `b1_b_...`, or a two-team `bat_...::uuid`) is never a deliverable, so
 * production-comments always refuses it with 403 `target_forbidden`. The Production comment loader skipped it only
 * when `_prodIssue(id)` already answered the synthetic batch parent, and that row is minted from the batches and
 * deliverables reads. A cold `?prod=1&d=bat_...` link (the Workload parent links) opened the post before those reads
 * landed, so the loader asked, got the 403, and kept "not available to your exact team or client scope" on the post.
 * Measured 2026-10-27: 28 of that day's 43 refused reads, 5 to 70 a day since 6 Oct.
 *
 * Fully offline: every backend read answers an empty list, so no batch row ever loads (the cold state held open),
 * key-verify answers locally, and production-comments answers the live 403 while counting what it was asked.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const failures = [];
function ok(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const IDS = [
  'bat_00000000-0000-4000-8000-000000000001',
  'b1_b_00000000-0000-4000-8000-000000000002',
  'bat_00000000-0000-4000-8000-000000000003::00000000-0000-4000-8000-000000000004',
];

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const id of IDS) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const asked = [];
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      // Registered first, so the specific routes below (registered later) answer before it.
      await ctx.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.host.startsWith('127.0.0.1')) return route.fallback();
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '[]' });
      });
      await seedStaffGate(page);
      await ctx.route('**/functions/v1/production-comments', route => {
        if (route.request().method() === 'OPTIONS') return route.fallback();
        let body = {};
        try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        asked.push(String(body.deliverable_id || ''));
        return route.fulfill({ status: 403, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"ok":false,"error":"forbidden"}' });
      });
      await page.goto(origin + '/?prod=1&d=' + encodeURIComponent(id), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof _prodComments !== 'undefined' && typeof _prodState !== 'undefined', null, { timeout: 30000 });
      await sleep(2500);
      // The detail view may still be waiting on its rows; ask the loader directly, the way the open does.
      await page.evaluate(bid => _prodComments.retry(bid), id);
      await sleep(1500);
      const state = await page.evaluate(bid => {
        const verified = typeof _syncviewStaffIdentityForHeaders === 'function' && !!_syncviewStaffIdentityForHeaders();
        const minted = typeof _prodIssue === 'function' && !!_prodIssue(bid);
        const m = /data-prod-comments-state="([a-z]+)"/.exec(_prodComments.render(bid) || '');
        return { verified, minted, status: m ? m[1] : '' };
      }, id);
      const label = id.split('_')[0] + '_' + (id.includes('::') ? ' (two-team node)' : '');
      ok(state.verified, label + ': the harness is signed in, so a refusal would have been asked for');
      ok(!state.minted, label + ': the batch parent row has not loaded (the cold state this pins)');
      ok(asked.length === 0, label + ': no production-comments read was sent for the batch id (asked ' + asked.length + ')');
      ok(state.status !== 'forbidden', label + ': the comments panel is not left on the scope refusal (status ' + (state.status || 'none') + ')');
      ok(errors.length === 0, label + ': no page error' + (errors.length ? ' (' + errors[0] + ')' : ''));
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' check(s) failed'); process.exit(1); }
  console.log('\nprod-batch-parent-comments-cold-browser: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
