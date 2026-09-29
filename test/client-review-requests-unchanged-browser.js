'use strict';
/* client-review-requests-unchanged-browser.js -- the failed-saves work (Priority 4,
 * 2026-09-29) touched code next to the client's approve and request-changes
 * buttons, and the owner's rule is that those requests must not change.
 *
 * This proves it two ways, fully offline, on both client review links
 * (Calendar and Samples):
 *
 *   1. REQUESTS. A client opens the review card, approves the video, then types
 *      a note and requests a change. Every write the page sends (method, path,
 *      the names of the headers it sets, and the body) is recorded, with
 *      timestamps, ids and other per-run values normalised, and compared with
 *      test/fixtures/client-review-requests.golden.json, which was recorded
 *      from `main` BEFORE this work (WRITE_GOLDEN=1 rewrites it; never do that
 *      from a build you are trying to check).
 *   2. CODE. The source of the approve / request-changes functions and of the
 *      transports they use hashes to the values recorded from `main`.
 *
 * No request leaves the machine; every backend answer is local.
 */
require('./helpers/single-file-index.js'); // split switch on: reads of index.html get the single-file page
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils');
const { extractFunction } = require('./helpers/extract-function');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, 'fixtures', 'client-review-requests.golden.json');
const CLIENT = 'Review Fixture Client';
const SLUG = 'reviewfixtureclient';
const TOKEN = 'synthetic-review-token';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const SURFACES = {
  calendar: { card: 'p_review_fixture_1', query: { v: 'calendar' }, table: 'calendar_posts', tweakComp: 'caption' },
  samples: { card: 'sr_review_fixture_1', query: { v: 'sample-reviews', sxr: '1' }, table: 'sample_reviews', tweakComp: 'graphic' },
};
const FUNCTIONS = ['_calReviewApprove', '_calReviewRequestTweak', '_sxrReviewApprove', '_sxrReviewRequestTweak',
  '_writeUiGatewayPost', '_calUpsertFetch', '_calUpsertFetchClientLink', '_calUpsertFetchGuarded', '_calUpsertFetchPinned', '_sxrUpsertFetch', '_sxrUpsertFetchPinned'];

// Per-run values (times, random ids) must not make two identical clicks differ.
function normalise(value) {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalise(value[key]);
    return out;
  }
  if (typeof value === 'number' && value > 1e12) return '<ms>';
  if (typeof value !== 'string') return value;
  return value
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<ts>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b(?:wr|cal|sxr|req|w|ui|rq)[-_][A-Za-z0-9_-]{8,}\b/g, '<id>')
    .replace(/\bc_[a-z0-9]{6,10}_[a-z0-9]{4,8}\b/g, '<comment-id>')
    .replace(/\b\d{13}\b/g, '<ms>');
}
function normaliseRequest(w) {
  let body = w.body;
  try { body = normalise(JSON.parse(w.body)); } catch (e) { body = normalise(w.body); }
  return { method: w.method, path: w.path, headers: w.headers, body };
}

async function runSurface(browser, origin, name) {
  const { card: CARD, query, table, tweakComp } = SURFACES[name];
  const ROW = {
    id: CARD, client: SLUG, name: 'Review fixture post', status: 'In Progress', scheduled_date: null, order_index: 1,
    updated_at: '2026-09-20T12:00:00.000Z', asset_url: 'https://example.invalid/video.mp4', thumbnail_url: '',
    video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
    caption: 'Fixture caption', comments: [], graphic_comments: [], caption_comments: [],
  };
  const writes = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), async route => {
    const r = route.request(); const u = new URL(r.url());
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (u.pathname === '/functions/v1/client-token-verify') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (r.method() !== 'GET' && r.method() !== 'HEAD') {
      const headers = Object.keys(r.headers()).filter(h => !/^(user-agent|origin|referer|accept|accept-|sec-|content-length|host|connection|pragma|cache-control|priority)/.test(h)).sort();
      writes.push({ method: r.method(), path: u.pathname, headers, body: r.postData() || '' });
      if (/\/rest\/v1\//.test(u.pathname)) return json([Object.assign({}, ROW)]);
      return json({ ok: true });
    }
    if (u.pathname === '/rest/v1/' + table) return json([ROW]);
    if (u.pathname === '/rest/v1/clients') return json([{ slug: SLUG, kind: 'client', active: true }]);
    if (u.pathname === '/rest/v1/syncview_runtime_flags' && /prod_authority/.test(u.search)) return json([{ value: { video: 'linear', graphics: 'linear' } }]);
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  const q = new URLSearchParams(Object.assign({ c: CLIENT, t: TOKEN }, query));
  await page.goto(`${origin}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
  const card = `.kcard[data-cal-review-pid="${CARD}"]`;
  await page.waitForSelector(card, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.click(`${card} .kcard-expand-btn`);
  await page.waitForSelector(`${card} .cal-review-body`, { timeout: 8000 });
  await page.waitForTimeout(500);

  const approve = `${card} .cal-review-panel[data-comp="video"] .cal-review-approve-btn`;
  const before = writes.length;
  await page.click(approve);
  await page.waitForTimeout(400);
  if (await page.$('#confirmOverlay.active')) await page.click('#confirmYes');
  await page.waitForTimeout(2500);
  const loadMode = await page.evaluate(() => (self.__svLoad ? self.__svLoad.mode : 'single-file'));
  const approveWrites = writes.slice(before).map(normaliseRequest);

  const panel = `${card} .cal-review-panel[data-comp="${tweakComp}"]`;
  await page.click(`${panel} .cal-review-textarea`);
  await page.keyboard.type('Review fixture: please shorten the first line.');
  const before2 = writes.length;
  await page.click(`${panel} .cal-review-tweak-btn`);
  await page.waitForTimeout(2500);
  const tweakWrites = writes.slice(before2).map(normaliseRequest);
  await ctx.close();
  return { approve: approveWrites, requestChanges: tweakWrites, errors, loadMode };
}

function functionHashes() {
  const source = require('fs').readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = {};
  for (const name of FUNCTIONS) {
    let text;
    try { text = extractFunction(source, name); } catch (e) { text = null; }
    if (text == null) { out[name] = null; continue; }
    out[name] = crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
  }
  return out;
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const result = { requests: {}, functions: functionHashes() };
  let pageErrors = [];
  const loadModes = {};
  try {
    for (const name of Object.keys(SURFACES)) {
      const r = await runSurface(browser, origin, name);
      result.requests[name] = { approve: r.approve, requestChanges: r.requestChanges };
      pageErrors = pageErrors.concat(r.errors);
      loadModes[name] = r.loadMode;
      console.log(`  ${name}: approve sent ${r.approve.length} write(s), request changes sent ${r.requestChanges.length} write(s)`);
    }
  } finally { await browser.close(); server.close(); }

  if (process.env.WRITE_GOLDEN === '1') {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(result, null, 2) + '\n');
    console.log('client-review-requests-unchanged: golden written to ' + path.relative(ROOT, GOLDEN));
    return;
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  let passed = 0;
  const ok = (cond, message) => { assert.ok(cond, message); passed += 1; console.log('  ok  ' + message); };
  for (const name of Object.keys(SURFACES)) {
    for (const action of ['approve', 'requestChanges']) {
      const label = `${name} ${action === 'approve' ? 'Approve' : 'Request changes'}`;
      ok(golden.requests[name][action].length > 0, `${label}: the recorded run sent at least one write`);
      assert.deepStrictEqual(result.requests[name][action], golden.requests[name][action], `${label}: requests differ from main`);
      ok(true, `${label}: sends exactly the requests main sent (${result.requests[name][action].length} write(s): method, path, header names, body)`);
    }
  }
  for (const name of FUNCTIONS) {
    ok(golden.functions[name] !== null, `${name}: was found in the recorded source`);
    assert.strictEqual(result.functions[name], golden.functions[name], `${name} changed; the client approve / request-changes path must stay as main has it`);
    ok(true, `${name}: source is byte-identical to main`);
  }
  ok(pageErrors.length === 0, 'no page errors on either client review link');
  // Plan step 5: with split.json on and "clients" on, a client link is served in
  // parts. Prove the requests above were recorded on the code as it ships.
  const splitCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'index', 'split.json'), 'utf8'));
  const want = splitCfg.enabled && splitCfg.clients ? 'parts' : (splitCfg.enabled ? 'full' : 'single-file');
  for (const name of Object.keys(SURFACES)) ok(loadModes[name] === want, `${name}: the client link was served as "${want}" (got "${loadModes[name]}"), so these requests are the shipped code's`);
  console.log(`\nclient-review-requests-unchanged: ${passed} checks passed`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
