'use strict';
/* sxr-focus-return-browser.js -- Samples: coming back to the tab keeps the
 * caret in the box the person was typing in. Fully offline.
 *
 * The bug (found by Vigil): type in a sample's name box without saving, hide
 * the page for a while, come back. The return-to-tab refresh restores focus by
 * a field signature, and every Samples name box shares the same one
 * (`oninput="_sxrOnFieldInput(this)"`), so focus landed in the FIRST card's
 * box and further typing went into the wrong card. Samples made in the Create
 * dialog sit below other cards, which is why they always showed it.
 *
 * This drives the real index.html against the test client with every backend
 * answer local (nothing is read from or written to the live backend): two samples, type in the SECOND card's name box,
 * hide the page past the return-refresh threshold, show it again, and check
 * the focused box is still the second card's, with the typed text and caret
 * intact, and that typing more goes into that card.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate, STAFF_GATE_MEMBER } = require('../../../qa/staff-gate-seed.js');
const { TEST_CLIENT } = require('../../../qa/test-client-entry.js');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// The test client: already in the app's built-in roster, so no sheet is needed.
const SLUG = TEST_CLIENT.slug;
const CLIENT = TEST_CLIENT.displayName || TEST_CLIENT.name;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const row = (id, name, order) => ({
  id, client: SLUG, name, status: 'In Progress', order_index: order, updated_at: '2026-09-20T12:00:00.000Z',
  asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress',
  comments: [], graphic_comments: [],
});
// The second card stands in for the Create-dialog sample: it is not the first
// name box on the page.
const ROWS = [row('sr_focus_first', 'First sample', 1), row('sr_focus_created', 'Created sample', 2)];
const FIRST = 'sr_focus_first', TARGET = 'sr_focus_created';

(async () => {
  const failures = [];
  const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  [' + x + ']' : '')); if (!c) failures.push(m); };
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let sampleReads = 0;
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role: STAFF_GATE_MEMBER.role, member: STAFF_GATE_MEMBER });
    if (r.method() !== 'GET' && r.method() !== 'HEAD') return json({ ok: true });
    if (u.pathname === '/rest/v1/sample_reviews') { sampleReads += 1; return json(ROWS.map(x => Object.assign({}, x))); }
    if (u.pathname === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, kind: 'client', active: true }]);
    if (u.pathname === '/rest/v1/team_members') return json([Object.assign({ active: true }, STAFF_GATE_MEMBER)]);
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await seedStaffGate(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  try {
    await page.goto(`${origin}/index.html?sxr=1#sample-reviews/${SLUG}`, { waitUntil: 'domcontentloaded' });
    const box = pid => `input.cal-fld-name[data-pid="${pid}"]`;
    const drew = await page.waitForSelector(box(TARGET), { timeout: 30000 }).then(() => true, () => false);
    if (!drew && process.env.SXR_FOCUS_DEBUG) console.log(await page.evaluate(() => JSON.stringify({ href: location.href, nav: typeof currentNav !== 'undefined' ? currentNav : '', body: document.body.innerText.slice(0, 400), sxr: typeof sxrState !== 'undefined' ? { client: sxrState.client, n: (sxrState.posts || []).length } : null })));
    ok(drew, 'both sample cards drew');
    if (!drew) throw new Error('no cards');
    ok(await page.$(box(FIRST)) !== null, 'the first card has its own name box above');

    await page.click(box(TARGET));
    await page.keyboard.press('End');
    await page.keyboard.type(' draft');
    const before = await page.evaluate(() => ({ pid: document.activeElement.getAttribute('data-pid'), value: document.activeElement.value, caret: document.activeElement.selectionStart }));
    ok(before.pid === TARGET && before.value === 'Created sample draft', 'typing lands in the created sample', JSON.stringify(before));

    // Hide the page past the return-refresh threshold, then show it again.
    const readsBefore = sampleReads;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(9500);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(2500);
    ok(sampleReads > readsBefore, 'coming back ran the return-to-tab refresh', `${readsBefore} -> ${sampleReads}`);

    const after = await page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a && a.tagName, pid: a && a.getAttribute('data-pid'), value: a && a.value, caret: a && a.selectionStart };
    });
    ok(after.pid === TARGET, 'focus is still in the created sample\'s name box, not another card', JSON.stringify(after));
    ok(after.value === 'Created sample draft', 'the unsaved text is still there', after.value);
    ok(after.caret === before.caret, 'the caret is where it was', `${before.caret} -> ${after.caret}`);

    await page.keyboard.type('!');
    const vals = await page.evaluate(([a, b]) => [document.querySelector(a).value, document.querySelector(b).value], [box(FIRST), box(TARGET)]);
    ok(vals[1] === 'Created sample draft!' && vals[0] === 'First sample', 'further typing goes into the same card only', JSON.stringify(vals));
    ok(errors.length === 0, 'no page errors', errors[0]);
  } catch (e) {
    ok(false, 'raised: ' + String(e && e.message || e).slice(0, 160));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\nsxr-focus-return-browser: ${failures.length} check(s) failed` : '\nsxr-focus-return-browser: focus stays in the same sample across a hide and return');
  process.exit(failures.length ? 1 : 0);
})();
