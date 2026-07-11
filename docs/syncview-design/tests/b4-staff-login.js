'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');

const DUMMY_MEMBER = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Dummy Administrator',
  role: 'admin',
  team: null,
  active: true,
};
const DUMMY_KEY = 'dummy-admin-role-key';
const SCREENSHOT_DIR = process.env.B4_LOGIN_SCREENSHOT_DIR || '';
let verifyCalls = 0;

async function installMocks(page) {
  await page.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (/^https?:\/\/127\.0\.0\.1/.test(url)) return route.continue();

    if (url.includes('/rest/v1/team_members')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([DUMMY_MEMBER]) });
    }
    if (url.includes('/functions/v1/key-verify')) {
      verifyCalls++;
      const key = request.headers()['x-syncview-key'] || '';
      let body = {};
      try { body = request.postDataJSON() || {}; } catch (_) {}
      if (key !== DUMMY_KEY || !body.member || body.member.id !== DUMMY_MEMBER.id) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, mode: 'permissive', reason: 'invalid_key' }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          mode: 'permissive',
          role: 'admin',
          member: DUMMY_MEMBER,
        }),
      });
    }
    if (url.includes('.supabase.co/rest/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.includes('docs.google.com/spreadsheets')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'google.visualization.Query.setResponse({"version":"0.6","status":"ok","table":{"cols":[],"rows":[]}});',
      });
    }
    if (request.resourceType() === 'font' || request.resourceType() === 'stylesheet' || request.resourceType() === 'script') {
      return route.abort();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function seedStaffApp(page) {
  await page.addInitScript(() => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    if (sessionStorage.getItem('b4_staff_login_fixture_seeded') !== '1') {
      localStorage.removeItem('syncview_staff_identity_v1');
      sessionStorage.removeItem('syncview_staff_identity_prompted_v1');
      sessionStorage.setItem('b4_staff_login_fixture_seeded', '1');
    }
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log('PASS ' + message);
}

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await seedStaffApp(page);
    await installMocks(page);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#staffIdentityOverlay', { timeout: 10000 });
    if (SCREENSHOT_DIR) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'b4-staff-login-desktop.png'), fullPage: true });
    }
    assert(await page.locator('#staffIdentityMember option').count() === 2, 'modal lists only the dummy active roster row plus its placeholder');
    assert(await page.locator('#staffIdentityMember').evaluate(el => el.tagName) === 'SELECT', 'name is selected from a roster control');
    assert(await page.locator('#staffIdentityOverlay input[type="text"]').count() === 0, 'modal has no free-text name input');

    await page.selectOption('#staffIdentityMember', DUMMY_MEMBER.id);
    await page.fill('#staffIdentityKey', DUMMY_KEY);
    await page.click('#staffIdentitySubmit');
    await page.waitForSelector('#staffIdentityOverlay', { state: 'detached', timeout: 5000 });
    assert(await page.locator('#navProd').isVisible(), 'verified identity reveals the Production tab');

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('syncview_staff_identity_v1') || 'null'));
    assert(stored && stored.role === 'admin' && stored.member && stored.member.name === 'Dummy Administrator', 'verified role and roster member persist locally');
    const headers = await page.evaluate(() => ({
      edge: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, CAL_SUPABASE_URL + '/functions/v1/calendar-upsert'),
      fallback: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, 'https://automation.invalid/webhook/calendar-upsert'),
    }));
    assert(headers.edge['X-Syncview-Key'] === DUMMY_KEY && headers.edge['X-Syncview-Actor'] === DUMMY_MEMBER.name && headers.edge['X-Syncview-Role'] === 'admin', 'verified identity decorates Supabase EF writes');
    assert(!headers.fallback['X-Syncview-Key'], 'verified role key is not sent to n8n fallback URLs');

    const callsBeforeReload = verifyCalls;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const nav = document.getElementById('navProd');
      return nav && getComputedStyle(nav).display !== 'none';
    }, null, { timeout: 10000 });
    assert(verifyCalls > callsBeforeReload, 'stored identity is revalidated through key-verify at boot');
    assert(await page.locator('#staffIdentityOverlay').count() === 0, 'valid boot revalidation does not re-prompt');

    await page.evaluate(member => {
      localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({ key: 'invalid-dummy-key', role: 'admin', member }));
      sessionStorage.removeItem('syncview_staff_identity_prompted_v1');
    }, DUMMY_MEMBER);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#staffIdentityOverlay', { timeout: 10000 });
    const invalidState = await page.evaluate(() => localStorage.getItem('syncview_staff_identity_v1'));
    assert(invalidState === null, '401 boot verification clears the invalid stored identity');
    assert(!(await page.locator('#navProd').isVisible()), 'invalid stored identity hides normal Production navigation');
    await context.close();

    const previewContext = await browser.newContext();
    const preview = await previewContext.newPage();
    await seedStaffApp(preview);
    await installMocks(preview);
    await preview.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await preview.waitForSelector('.prod-view', { timeout: 10000 });
    await preview.waitForTimeout(1100);
    assert(await preview.locator('#staffIdentityOverlay').count() === 0, 'direct B2 Production preview remains available without a sign-in prompt');
    await previewContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobile = await mobileContext.newPage();
    await seedStaffApp(mobile);
    await installMocks(mobile);
    await mobile.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    const mobileCard = mobile.locator('.staff-auth-card');
    await mobileCard.waitFor({ timeout: 10000 });
    const box = await mobileCard.boundingBox();
    assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844, 'staff sign-in modal fits the mobile viewport');
    if (SCREENSHOT_DIR) await mobile.screenshot({ path: path.join(SCREENSHOT_DIR, 'b4-staff-login-mobile.png'), fullPage: true });
    await mobileContext.close();

    console.log(`B4 staff login browser checks passed (${verifyCalls} key-verify calls)`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
