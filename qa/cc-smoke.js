const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  file = path.join(root, file);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(8123, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const calls = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    localStorage.setItem('syncview_client_credentials_identity_v1', JSON.stringify({ name: 'Smoke Tester', role: 'Kasper', key: 'fake-key' }));
    sessionStorage.setItem('syncview_kasper_unlocked', 'ok');
  });
  await page.route('**/functions/v1/client-credentials', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body.action);
    if (body.action === 'list') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, credentials: [
        { id: 'cred-1', client_slug: 'bayavoce', client_name: 'Baya Voce', platform: 'instagram', label: '', handle: '@bayavoce', password: 'fake-pass-1', notes: '2FA in 1Password', status: 'active', source: 'manual', updated_at: '2026-07-02T12:00:00Z', updated_by: 'Smoke Tester' },
        { id: 'cred-2', client_slug: 'unmatched:janedoe', client_name: 'Jane Doe', platform: 'tiktok', label: 'backup', handle: '@jane', password: 'fake-pass-2', notes: 'raw onboarding text', status: 'needs_review', source: 'onboarding', updated_at: '2026-07-02T13:00:00Z', updated_by: 'Onboarding' }
      ] }) });
    } else if (body.action === 'history') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, events: [] }) });
    } else {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
  });
  await page.goto('http://127.0.0.1:8123/?Kasper=1#kasper/client-credentials', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('.cc-wrap', { timeout: 20000 });
  } catch (e) {
    console.error('url=' + page.url());
    console.error('errors=' + errors.join(' | '));
    console.error('body=' + (await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(0, 1000));
    await page.screenshot({ path: path.join(root, 'qa', 'cc-smoke-failure.png'), fullPage: true }).catch(() => {});
    throw e;
  }
  // Clients are collapsed by default now (WS3 3e): the Baya Voce rows are
  // hidden until its header is expanded. Confirm the collapse, then open it.
  const bayaToggle = page.getByRole('button', { name: 'Expand or collapse Baya Voce' });
  await bayaToggle.waitFor({ timeout: 10000 });
  if (await page.locator('.cc-row', { hasText: '@bayavoce' }).isVisible().catch(() => false)) {
    throw new Error('client card should be collapsed by default');
  }
  await bayaToggle.click();
  await page.waitForSelector('text=@bayavoce', { timeout: 20000 });
  const bayaRow = page.locator('.cc-row', { hasText: '@bayavoce' });
  const masked = await bayaRow.locator('.cc-secret code').first().innerText();
  if (masked !== '••••••') throw new Error('password was not masked initially: ' + masked);
  // Locate the reveal/hide toggle by aria-label, not title: the global tooltip
  // system (setupGlobalTooltip) strips the native `title` off whatever the
  // pointer is hovering, and with instant reveal the fresh "Hide" button lands
  // right under the cursor. aria-label is stable through that.
  await page.locator('.cc-row', { hasText: '@bayavoce' }).locator('button[aria-label="Reveal password"]').click();
  try {
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.cc-secret code')).some(x => x.textContent === 'fake-pass-1'), null, { timeout: 10000 });
  } catch (e) {
    console.error('after reveal calls=' + calls.join(','));
    console.error('after reveal errors=' + errors.join(' | '));
    console.error('secrets=' + await page.locator('.cc-secret code').evaluateAll(nodes => nodes.map(n => n.textContent).join('|')).catch(() => 'n/a'));
    throw e;
  }
  // Reveal is now instant (the password is already in hand); the audit
  // log_reveal fires in the background, so wait briefly for it to land rather
  // than asserting synchronously.
  for (let i = 0; i < 50 && !calls.includes('log_reveal'); i++) await page.waitForTimeout(100);
  if (!calls.includes('log_reveal')) throw new Error('reveal was not logged');
  await page.locator('.cc-row', { hasText: '@bayavoce' }).locator('button[aria-label="Hide password"]').click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.cc-secret code')).some(x => x.textContent === '••••••'), null, { timeout: 10000 });
  await page.evaluate(() => { window.calState = window.calState || {}; calState.client = 'Baya Voce'; _ccOpenModal('Baya Voce'); });
  await page.locator('#ccModalBody').getByText('@bayavoce').waitFor({ timeout: 10000 });
  const modalTitle = await page.locator('#ccOverlay h3').innerText();
  if (!/Baya Voce credentials/.test(modalTitle)) throw new Error('SMM modal did not open');
  if (await page.locator('#ccOverlay .cc-row button[title="Archive"]').count() < 1) throw new Error('SMM modal should expose archive action');
  await page.locator('#ccOverlay button', { hasText: 'Add credential' }).click();
  await page.locator('#ccEditPlatformBtn').waitFor({ timeout: 10000 });
  if (await page.locator('#ccEditLabel').count()) throw new Error('label field should not render');
  if (await page.locator('#ccEditStatus').count()) throw new Error('status field should not render');
  await page.locator('#ccEditPlatformBtn').click();
  await page.locator('#ccEditPlatformMenu .cc-select-option', { hasText: 'tiktok' }).click();
  const platform = await page.locator('#ccEditPlatform').inputValue();
  if (platform !== 'tiktok') throw new Error('custom platform dropdown did not update: ' + platform);
  await page.locator('#ccEditPassword').fill('visible-test');
  await page.locator('.cc-pass-toggle').click();
  if (await page.locator('#ccEditPassword').getAttribute('type') !== 'text') throw new Error('password toggle did not show text');
  await page.locator('.cc-pass-toggle').click();
  if (await page.locator('#ccEditPassword').getAttribute('type') !== 'password') throw new Error('password toggle did not hide text');
  const calRace = await page.evaluate(() => {
    const first = (WL_CLIENT_NAMES || [])[0] || 'Baya Voce';
    currentNav = 'calendar';
    document.getElementById('content').innerHTML = renderCalendarView();
    calState.client = null;
    calState.embedded = false;
    localStorage.setItem('syncview_calendar_prefs', JSON.stringify({ client: first, view: 'organizer', zoom: 'm' }));
    _calRenderShell();
    const before = !!document.getElementById('calKebabMenu');
    const origLoad = loadCalendarPosts;
    window.__calLoadCalled = false;
    loadCalendarPosts = () => { window.__calLoadCalled = true; };
    _calResolveClientAfterDataReady();
    loadCalendarPosts = origLoad;
    return { before, after: !!document.getElementById('calKebabMenu'), client: calState.client, called: window.__calLoadCalled };
  });
  if (calRace.before || !calRace.after || !calRace.client || !calRace.called) throw new Error('calendar client/menu race fix failed: ' + JSON.stringify(calRace));
  if (errors.length) throw new Error('browser errors: ' + errors.join(' | '));
  await browser.close();
  server.close();
  console.log('client credentials smoke passed; actions=' + calls.join(','));
})().catch(async err => {
  try { await page?.screenshot({ path: path.join(root, 'qa', 'cc-smoke-failure.png'), fullPage: true }); } catch {}
  try { await browser?.close(); } catch {}
  server.close();
  console.error(err.stack || err.message || err);
  process.exit(1);
});
