/* ISOLATED_BROWSER: all responses are fictional; no request is forwarded. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const source = process.env.CALENDAR_LAYOUT_SOURCE || path.join(ROOT, 'index.html');
const output = process.env.CALENDAR_LAYOUT_OUTPUT;
if (!output) throw new Error('Set CALENDAR_LAYOUT_OUTPUT outside the checkout.');
const html = fs.readFileSync(source);
const CLIENT = 'Layout Fixture';
const ORIGIN = 'http://calendar-layout.invalid';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="#b9c8ed"/><text x="60" y="460" font-size="36">Synthetic media</text></svg>';
const posts = Array.from({ length: 6 }, (_, i) => ({
  id: 'layout-card-' + i, client: 'layoutfixture', name: 'Fictional card ' + (i + 1),
  order_index: i, scheduled_date: '2026-09-05', platforms: 'instagram',
  status: 'Client Approval', video_status: 'Approved', graphic_status: 'Approved',
  caption_status: i < 2 ? 'Client Approval' : 'Approved', caption: 'Fictional caption for layout inspection.',
  asset_url: '', thumbnail_url: ORIGIN + '/media.png', cta: '', tweaks: '',
  video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]',
}));
const report = { classification: 'ISOLATED_BROWSER', startedAt: new Date().toISOString(),
  sourceSha256: crypto.createHash('sha256').update(html).digest('hex'),
  runnerSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  checkoutHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  sourcePath: path.basename(source), checks: [], cases: [], blocked: {}, pageErrors: [],
  networkPolicy: 'Every routed request is fulfilled locally or aborted; no forwarding branch.',
  limitations: ['Fictional data and persona; no server or authentication proof.', 'CDN fonts, charts and realtime are stubbed.'] };
function check(condition, name, details) { report.checks.push({ name, pass: !!condition, ...(details === undefined ? {} : { details }) }); }
function count(key) { report.blocked[key] = (report.blocked[key] || 0) + 1; }
async function install(context, theme, persona, fixturePosts) {
  await context.addInitScript(({ theme, persona }) => {
    localStorage.setItem('syncview_theme', theme);
    if (persona === 'staff') localStorage.setItem('syncview_auth_v1', 'ok');
    window.__layoutTransportBlocks = [];
    Object.defineProperty(Navigator.prototype, 'sendBeacon', { configurable: false, value() { window.__layoutTransportBlocks.push('beacon'); return false; } });
    const nativeFetch = window.fetch;
    window.fetch = function(input, init) {
      if (init?.keepalive || (input instanceof Request && input.keepalive)) { window.__layoutTransportBlocks.push('keepalive'); return Promise.reject(new TypeError('Fixture blocks keepalive')); }
      return nativeFetch.call(this, input, init);
    };
    for (const name of ['Worker', 'SharedWorker', 'WebTransport', 'RTCPeerConnection']) {
      Object.defineProperty(window, name, { configurable: false, value: function() { throw new Error('Fixture blocks transport'); } });
    }
    class FakeChart { destroy() {} }
    FakeChart.defaults = {}; window.Chart = FakeChart;
    window.supabase = { createClient() { return { channel() { const ch = { on() { return ch; }, subscribe() { return ch; }, unsubscribe() { return Promise.resolve('ok'); } }; return ch; }, removeChannel() { return Promise.resolve('ok'); } }; } };
  }, { theme, persona });
  await context.routeWebSocket('**/*', socket => { count('websocket'); socket.close(); });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    const text = (body, contentType) => route.fulfill({ status: 200, contentType, headers: { 'access-control-allow-origin': '*' }, body });
    if (url.origin === ORIGIN && url.pathname === '/' && req.method() === 'GET') return text(html, 'text/html');
    if (url.origin === ORIGIN && url.pathname === '/media.png' && req.method() === 'GET') return text(svg, 'image/svg+xml');
    // Only the existing strict-verifier read is simulated with POST semantics.
    if (url.pathname === '/functions/v1/client-token-verify' && req.method() === 'POST') return json({ ok: true, valid: true, allowed: true, active: true, strict: true, slug: 'layoutfixture', display_name: CLIENT, view: 'calendar', protocol: 'syncview-client-entry-v1' });
    if (req.method() !== 'GET') { count('mutation-or-unreviewed-method'); count('method-' + req.method() + '-' + url.pathname.split('/').pop()); return route.abort('blockedbyclient'); }
    if (url.hostname === 'fonts.googleapis.com') return text('/* Offline font fallback */', 'text/css');
    if (url.hostname === 'cdn.jsdelivr.net') return text('/* Offline dependency stub */', 'application/javascript');
    if (url.hostname === 'docs.google.com' && url.pathname.includes('/spreadsheets/')) {
      const sheet = url.searchParams.get('sheet');
      return text(sheet === 'Clients Info' ? 'client_name,content_description,instagram_handle\nLayout Fixture,Fictional,layout_fixture\n' : 'client_name,date,ig_followers\nLayout Fixture,2026-09-05,123\n', 'text/csv');
    }
    if (url.pathname === '/rest/v1/calendar_posts') return json(fixturePosts);
    if (url.pathname === '/rest/v1/clients') return json([{ client_name: CLIENT, client: 'layoutfixture', status: 'Active' }]);
    if (/^\/rest\/v1\/(runtime_flags|team_members|templates|sample_reviews)$/.test(url.pathname)) return json([]);
    if (url.pathname.endsWith('/calendar-get')) return json({ ok: true, posts: fixturePosts });
    if (url.pathname.endsWith('/templates-get')) return json({ ok: true, templates: {} });
    if (url.pathname.endsWith('/caption-prompts-get')) return json({ ok: true, prompts: {} });
    count('unreviewed-' + req.resourceType());
    return route.abort('blockedbyclient');
  });
}
async function measure(page, selector) {
  return page.locator(selector).evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }; });
}
async function layout(page, name, width) {
  // Compare settled boxes, not different frames of the source's entry animation.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect.getTiming().iterations)).map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const mid = await measure(page, '#calView .cal-toolbar-mid');
  check(docWidth <= width + 1, name + ': document contained', { width, docWidth, toolbarRight: mid.right });
  for (const selector of ['#calView .cal-view-btn:visible', '#calOrganizeBtn:visible', '#calZoomCtl:visible button']) {
    for (const e of await page.locator(selector).all()) {
      const r = await e.boundingBox();
      if (r) check(r.x >= -1 && r.x + r.width <= width + 1, name + ': toolbar control reachable');
    }
  }
  const overflowingToolbarChildren = await page.locator('#calView .cal-toolbar').evaluate((root, width) => Array.from(root.querySelectorAll('*')).filter(e => e.getBoundingClientRect().right > width + 1).map(e => ({ tag: e.tagName, className: e.className.baseVal ?? e.className, right: e.getBoundingClientRect().right, visibility: getComputedStyle(e).visibility })), width);
  report.cases.push({ name, width, docWidth, toolbar: mid, overflowingToolbarChildren });
}
async function containedControl(page, selector, name, width) {
  const e = page.locator(selector).first();
  await e.scrollIntoViewIfNeeded();
  const box = await e.boundingBox();
  check(box && box.x >= -1 && box.x + box.width <= width + 1, name + ': control contained');
  return e;
}
async function transportGuard(browser) {
  let received = 0;
  const server = http.createServer((req, res) => { received++; res.end('unexpected'); });
  server.on('upgrade', (req, socket) => { received++; socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const canary = 'http://127.0.0.1:' + server.address().port;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await install(context, 'light', 'client', []);
    await context.route(ORIGIN + '/guard', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic transport guard</title>' }));
    const page = await context.newPage();
    await page.goto(ORIGIN + '/guard');
    const blocks = await page.evaluate(async canary => {
      const results = [];
      results.push(navigator.sendBeacon(canary + '/beacon', 'synthetic') === false);
      results.push(await fetch(canary + '/keepalive', { method: 'POST', keepalive: true, body: 'synthetic' }).then(() => false, () => true));
      results.push(await fetch(canary + '/functions/v1/calendar-upsert', { method: 'POST', body: 'synthetic' }).then(() => false, () => true));
      results.push(await fetch(canary + '/unreviewed-get').then(() => false, () => true));
      results.push(await new Promise(resolve => { const xhr = new XMLHttpRequest(); xhr.open('POST', canary + '/xhr'); xhr.onerror = () => resolve(true); xhr.onload = () => resolve(false); xhr.send('synthetic'); }));
      results.push(await new Promise(resolve => { const ws = new WebSocket(canary.replace('http:', 'ws:') + '/ws'); ws.onerror = () => resolve(true); ws.onclose = () => resolve(true); ws.onopen = () => { ws.close(); resolve(false); }; }));
      return { results, transportBlocks: window.__layoutTransportBlocks };
    }, canary);
    await page.waitForTimeout(100);
    report.guard = { classification: 'ISOLATED_BROWSER', canaryRequests: received, deliberateBlocks: { ...report.blocked }, ...blocks };
    check(received === 0 && blocks.results.every(Boolean), 'Transport guard: canary receives zero requests', report.guard);
    // Deliberate negative probes are reported separately from application activity.
    report.blocked = {};
  } finally { await context.close(); await new Promise(resolve => server.close(resolve)); }
}
async function runCase(browser, width, theme, reducedMotion, persona) {
  const activeTheme = persona === 'client' ? 'light' : theme; // Share links intentionally stay light.
  const name = `${persona}-${width}-${activeTheme}-${reducedMotion}`;
  const review = persona === 'staff' ? 'smmreview' : 'review';
  const fixturePosts = posts.map(p => ({ ...p, caption_status: persona === 'staff' && p.caption_status === 'Client Approval' ? 'For SMM Approval' : p.caption_status }));
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 800, colorScheme: theme, reducedMotion, serviceWorkers: 'block' });
  await install(context, theme, persona, fixturePosts);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => report.pageErrors.push({ case: name, message: e.message }));
  try {
    await page.goto(ORIGIN + (persona === 'staff' ? '/#calendar' : '/?c=Layout%20Fixture&t=synthetic-layout-token&v=calendar'), { waitUntil: 'domcontentloaded' });
    if (persona === 'staff') await page.evaluate(() => navTo('calendar'));
    await page.waitForSelector('#calView .cal-toolbar', { timeout: 20000 });
    if (persona === 'client') await page.waitForFunction(() => !calState.loading && calState.posts.length === 6);
    // Seed only state data, retaining source rendering and event handlers.
    await page.evaluate(({ posts, CLIENT, review, persona }) => {
      _calSavePins([CLIENT]);
      Object.assign(calState, { client: CLIENT, posts: posts.map(_calMigratePostShape), view: review, embedded: persona === 'client', loading: false, error: null, zoom: 'm', monthFilter: 'all', monthCursor: new Date(2026, 8, 1), weekCursor: new Date(2026, 8, 5) });
      _calRenderShell(); _calRenderBody();
    }, { posts: fixturePosts, CLIENT, review, persona });
    const display = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), storedTheme: localStorage.getItem('syncview_theme'), font: getComputedStyle(document.body).fontFamily, bg: getComputedStyle(document.body).backgroundColor, white: getComputedStyle(document.documentElement).getPropertyValue('--white') }));
    check((display.theme === 'dark') === (activeTheme === 'dark'), name + ': source-defined theme active', display);
    await layout(page, name + '-review', width);
    await page.screenshot({ path: path.join(output, name + '-review.png') });
    check(await page.locator('.cal-review-card').count() === 2, name + ': real renderer shows two pending cards');
    const expand = page.locator('.cal-review-card .kcard-expand-btn').first();
    if (width < 800) await expand.tap(); else await expand.click();
    check(await page.locator('.cal-review-card.expanded').count() === 1, name + ': review card opens');
    await containedControl(page, '.cal-review-approve-btn', name + '-approve', width);
    const draft = await containedControl(page, '.cal-review-textarea', name + '-review-draft', width);
    await draft.focus();
    check(await draft.evaluate(e => e === document.activeElement), name + ': review composer can receive focus');
    await page.screenshot({ path: path.join(output, name + '-review-open.png') });
    // Move through the actual toolbar with Tab + Enter; no action is submitted.
    await page.locator(`[data-cal-view="${review}"]`).focus();
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.activeElement.dataset.calView === 'organizer'), name + ': logical toolbar tab order');
    check(await page.evaluate(() => document.activeElement.matches(':focus-visible')), name + ': toolbar focus visible');
    await page.keyboard.press('Enter');
    await layout(page, name + '-sheet', width);
    await page.screenshot({ path: path.join(output, name + '-sheet.png') });
    if (persona === 'staff') {
      const profiles = page.locator('#calClientLinksBtn');
      if (width < 800) await profiles.tap(); else await profiles.click();
      await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('calClientLinksMenu')).opacity) === 1);
      const menu = await measure(page, '#calClientLinksMenu');
      check(await profiles.getAttribute('aria-expanded') === 'true' && menu.left >= -1 && menu.right <= width + 1, name + ': social profile menu contained', menu);
      await page.screenshot({ path: path.join(output, name + '-profiles.png') });
      await profiles.click();
    }
    check(await page.locator('#calStrip .cal-card').count() === (persona === 'staff' ? 6 : 4), name + ': expected cards remain in Sheet');
    const strip = await measure(page, '#calStrip');
    check(strip.scrollWidth > strip.clientWidth, name + ': card strip still scrolls', strip);
    const organize = page.locator('#calOrganizeBtn');
    if (width < 800) await organize.tap(); else await organize.click();
    check(await organize.getAttribute('aria-expanded') === 'true', name + ': Organize opens');
    const menu = await measure(page, '#calOrganizeMenu');
    check(menu.left >= -1 && menu.right <= width + 1, name + ': Organize menu contained', menu);
    await page.screenshot({ path: path.join(output, name + '-organize.png') });
    await page.keyboard.press('Escape');
    check(await organize.getAttribute('aria-expanded') === 'false' && await organize.evaluate(e => document.activeElement === e), name + ': Escape closes menu and restores focus');
    const notes = page.locator('#calStrip .cal-comments-btn').first();
    if (width < 800) await notes.tap(); else await notes.click();
    check(await page.locator('#calCommentsOverlay').evaluate(e => e.classList.contains('open')), name + ': Notes opens from card');
    const modal = await measure(page, '#calCommentsModal');
    check(modal.left >= -1 && modal.right <= width + 1, name + ': Notes modal contained', modal);
    await containedControl(page, '#calCommentsModal textarea', name + '-notes-composer', width);
    await page.screenshot({ path: path.join(output, name + '-notes.png') });
    await page.locator('#calCommentsModal .cal-comments-close').click();
    check(!await page.locator('#calCommentsOverlay').evaluate(e => e.classList.contains('open')), name + ': Notes closes');
    // Physical touch pan / desktop wheel must move the strip, not the document.
    await page.locator('#calStrip').evaluate(e => e.scrollIntoView({ block: 'start' }));
    const bounds = await page.locator('#calStrip').boundingBox();
    const y = Math.min(500, Math.max(40, bounds.y + 160));
    if (width < 800) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width - 55, y }] });
      for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width - 55 - step * (width - 120) / 8, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(width / 2, y); await page.mouse.wheel(400, 0);
    }
    await page.waitForFunction(() => document.getElementById('calStrip').scrollLeft > 20, null, { timeout: 3000 });
    check(await page.evaluate(() => window.scrollX === 0), name + ': pan stays inside card strip');
    // Focus a real control in the last card: browser must scroll it into reach.
    const lastNotes = page.locator('#calStrip .cal-comments-btn').last();
    await lastNotes.focus();
    await containedControl(page, '#calStrip .cal-card:last-of-type .cal-comments-btn', name + '-last-card', width);
    check(await lastNotes.evaluate(e => document.activeElement === e), name + ': last card keyboard reachable');
    await page.locator(`[data-cal-view="${review}"]`).click();
    await layout(page, name + '-review-return', width);
  } catch (e) { check(false, name + ': completion', String(e.message)); await page.screenshot({ path: path.join(output, name + '-error.png') }).catch(() => {}); }
  finally { await context.close(); }
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const actualOutput = fs.realpathSync(output).toLowerCase(), actualRoot = fs.realpathSync(ROOT).toLowerCase();
  if (actualOutput === actualRoot || actualOutput.startsWith(actualRoot + path.sep)) throw new Error('Evidence must stay outside the checkout.');
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND', '--no-proxy-server'] });
  report.chromium = browser.version();
  try {
    await transportGuard(browser);
    const widths = (process.env.CALENDAR_LAYOUT_WIDTHS || '360,390,768,1440').split(',').map(Number);
    for (const persona of ['client', 'staff']) for (const width of widths) for (const theme of ['light', 'dark']) await runCase(browser, width, theme, theme === 'dark' ? 'reduce' : 'no-preference', persona);
    check(report.pageErrors.length === 0, 'No uncaught page errors', report.pageErrors);
    check(!report.blocked['mutation-or-unreviewed-method'], 'No business write attempts', report.blocked);
  } finally {
    await browser.close(); report.finishedAt = new Date().toISOString();
    report.passed = report.checks.filter(c => c.pass).length; report.failed = report.checks.filter(c => !c.pass).length;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, failed: report.failed, sourceSha256: report.sourceSha256, failures: report.checks.filter(c => !c.pass) }));
    process.exitCode = report.failed ? 1 : 0;
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
