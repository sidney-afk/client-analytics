'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');

const ADMIN = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Dummy Administrator',
  role: 'admin',
  team: null,
  active: true,
};
const CREATIVE = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Dummy Designer',
  role: 'designer',
  team: 'Design',
  active: true,
};
const ADMIN_PEER = {
  id: '00000000-0000-4000-8000-000000000003',
  name: 'Dummy Admin Peer',
  role: 'admin',
  team: null,
  active: true,
};
const ADMIN_KEY = 'dummy-admin-role-key';
const CREATIVE_KEY = 'dummy-creative-role-key';
const SCREENSHOT_DIR = process.env.B4_LOGIN_SCREENSHOT_DIR || '';

let verifyCalls = 0;
let rosterGate = null;
let verifyGate = null;
let credentialGate = null;
let nextCredentialStatus = 200;
const sensitiveRequests = [];

function holdGate(kind) {
  let release;
  let entered;
  const gate = {
    promise: new Promise(resolve => { release = resolve; }),
    entered: new Promise(resolve => { entered = resolve; }),
    markEntered: () => entered(),
  };
  if (kind === 'roster') rosterGate = gate;
  else if (kind === 'verify') verifyGate = gate;
  else credentialGate = gate;
  return release;
}

async function consumeGate(kind) {
  const gate = kind === 'roster' ? rosterGate : (kind === 'verify' ? verifyGate : credentialGate);
  if (!gate) return;
  gate.markEntered();
  await gate.promise;
  if (kind === 'roster' && rosterGate === gate) rosterGate = null;
  if (kind === 'verify' && verifyGate === gate) verifyGate = null;
  if (kind === 'credentials' && credentialGate === gate) credentialGate = null;
}

async function installMocks(page) {
  await page.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (/^https?:\/\/127\.0\.0\.1/.test(url)) return route.continue();

    if (url.includes('/rest/v1/team_members')) {
      await consumeGate('roster');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ADMIN, CREATIVE]) });
    }
    if (url.includes('/functions/v1/key-verify')) {
      verifyCalls++;
      await consumeGate('verify');
      const key = request.headers()['x-syncview-key'] || '';
      let body = {};
      try { body = request.postDataJSON() || {}; } catch (_) {}
      const member = body.member && [ADMIN, CREATIVE].find(row => row.id === body.member.id);
      const role = member === ADMIN && key === ADMIN_KEY ? 'admin' : (member === CREATIVE && key === CREATIVE_KEY ? 'creative' : '');
      if (!member || !role) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, mode: 'permissive', reason: 'invalid_key' }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, mode: 'permissive', role, member }),
      });
    }
    if (url.includes('/functions/v1/client-credentials')) {
      sensitiveRequests.push({ surface: 'credentials', headers: request.headers(), body: request.postDataJSON() });
      await consumeGate('credentials');
      const status = nextCredentialStatus;
      nextCredentialStatus = 200;
      if (status === 401) {
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'unauthorized' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true,
        credentials: [{ id: 'dummy-credential', client_slug: 'test-client', client_name: 'TEST Client', platform: 'instagram', handle: '@dummy', password: 'dummy-secret' }],
      }) });
    }
    if (url.includes('/functions/v1/onboarding-full')) {
      sensitiveRequests.push({ surface: 'onboarding', headers: request.headers() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ submissions: [{ id: 'dummy-onboarding', slug: 'test-client', password: 'dummy-secret' }] }) });
    }
    if (url.includes('/functions/v1/filming-plans')) {
      sensitiveRequests.push({ surface: 'filming', headers: request.headers(), body: request.postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, plan: {
        client_name: 'TEST Client', client_slug: 'test-client', doc_url: 'https://docs.google.com/document/d/dummy', notes: '', plan_months: '',
      } }) });
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

async function seedStaffApp(page, identity) {
  await page.addInitScript(value => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    if (sessionStorage.getItem('b4_staff_login_fixture_seeded') === '1') return;
    if (value) localStorage.setItem('syncview_staff_identity_v1', JSON.stringify(value));
    else localStorage.removeItem('syncview_staff_identity_v1');
    sessionStorage.removeItem('syncview_staff_identity_prompted_v1');
    sessionStorage.setItem('b4_staff_login_fixture_seeded', '1');
  }, identity || null);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log('PASS ' + message);
}

async function selectMember(page, member) {
  await page.click('#staffIdentityMemberBtn');
  await page.click(`#staffIdentityMemberMenu [data-value="${member.id}"]`);
}

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  if (SCREENSHOT_DIR) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await seedStaffApp(page);
    await installMocks(page);

    const releaseRoster = holdGate('roster');
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#staffIdentityOverlay', { timeout: 10000 });
    const loadingDialog = page.locator('#staffIdentityOverlay [role="dialog"]');
    assert(await loadingDialog.getAttribute('aria-busy') === 'true', 'roster loading exposes a busy dialog');
    assert(await page.locator('.staff-auth-loading').textContent().then(text => text.includes('Preparing secure sign-in')), 'roster loading shows calm progress copy');
    await loadingDialog.focus();
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement && document.activeElement.closest('#staffIdentityOverlay') !== null), 'Tab cannot escape the roster-loading dialog');
    releaseRoster();
    await page.waitForSelector('#staffIdentityForm', { timeout: 5000 });

    await page.waitForTimeout(250);
    if (SCREENSHOT_DIR) await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'b4-staff-login-desktop-light.png'), fullPage: true });
    assert(await page.locator('#staffIdentityMemberMenu [data-cc-select-option]').count() === 3, 'modal lists only the two dummy active roster rows plus its placeholder');
    assert(await page.locator('#staffIdentityMember').evaluate(el => el.tagName === 'INPUT' && el.type === 'hidden'), 'custom roster control stores its selected value in a hidden input');
    assert(await page.locator('#staffIdentityOverlay input[type="text"]').count() === 0, 'modal has no free-text name input');
    assert(await page.locator('#staffIdentityButton').getAttribute('aria-haspopup') === 'dialog', 'signed-out staff button advertises a dialog');
    const listboxA11y = await page.evaluate(() => ({
      controls: document.getElementById('staffIdentityMemberBtn').getAttribute('aria-controls'),
      labelled: document.getElementById('staffIdentityMemberMenu').getAttribute('aria-labelledby'),
      roles: Array.from(document.querySelectorAll('#staffIdentityMemberMenu [data-cc-select-option]')).map(el => el.getAttribute('role')),
    }));
    assert(listboxA11y.controls === 'staffIdentityMemberMenu' && listboxA11y.labelled === 'staffIdentityMemberBtn' && listboxA11y.roles.every(role => role === 'option'), 'roster picker exposes complete listbox semantics');
    const scrim = await page.locator('#staffIdentityOverlay').evaluate(el => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, blur: style.backdropFilter || style.webkitBackdropFilter || '' };
    });
    assert(scrim.background !== 'rgba(0, 0, 0, 0)' && scrim.blur.includes('blur(3px)'), 'staff sign-in uses a dimmed blurred scrim');

    await page.fill('#staffIdentityKey', ADMIN_KEY);
    await page.click('#staffIdentitySubmit');
    assert(await page.locator('#staffIdentityError').textContent() === 'Choose your name.', 'missing roster choice shows validation feedback');
    assert(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'staffIdentityMemberBtn', 'missing roster choice focuses the custom dropdown trigger');

    await page.click('#staffIdentityMemberBtn');
    assert(await page.locator('#staffIdentityMemberBtn').getAttribute('aria-expanded') === 'true', 'custom roster dropdown opens accessibly');
    await page.keyboard.press('Escape');
    assert(await page.locator('#staffIdentityMemberBtn').getAttribute('aria-expanded') === 'false' && await page.evaluate(() => document.activeElement.id) === 'staffIdentityMemberBtn', 'Escape closes the roster picker and returns focus');
    await selectMember(page, ADMIN);
    assert(await page.locator('#staffIdentityMember').inputValue() === ADMIN.id, 'custom roster choice reaches the form value path');
    assert(await page.locator(`#staffIdentityMemberMenu [data-value="${ADMIN.id}"]`).getAttribute('aria-selected') === 'true', 'selected roster option updates aria-selected');

    const roleKeyToggle = page.locator('#staffIdentityKeyToggle');
    assert(await roleKeyToggle.getAttribute('aria-label') === 'Show role key', 'role-key visibility toggle has an accessible initial label');
    await roleKeyToggle.click();
    assert(await page.locator('#staffIdentityKey').getAttribute('type') === 'text' && await page.locator('#staffIdentityKey').inputValue() === ADMIN_KEY, 'role-key visibility toggle reveals without changing the value');
    assert(await roleKeyToggle.getAttribute('aria-label') === 'Hide role key', 'role-key visibility toggle updates its accessible label');
    await roleKeyToggle.click();
    assert(await page.locator('#staffIdentityKey').getAttribute('type') === 'password', 'role-key visibility toggle restores password masking');

    await page.fill('#staffIdentityKey', 'wrong-dummy-key');
    await page.click('#staffIdentitySubmit');
    await page.waitForFunction(() => document.getElementById('staffIdentityError')?.textContent.includes('does not match'));
    assert(await page.locator('#staffIdentityKey').getAttribute('aria-invalid') === 'true', 'wrong key marks the key field invalid');
    assert(await page.locator('#staffIdentityForm').getAttribute('aria-busy') === 'false', 'wrong key returns the form to its calm idle state');
    await page.fill('#staffIdentityKey', ADMIN_KEY);
    assert(await page.locator('#staffIdentityError').textContent() === '', 'editing the key clears stale error feedback');

    const releaseVerify = holdGate('verify');
    await page.click('#staffIdentitySubmit');
    await page.waitForFunction(() => document.getElementById('staffIdentityForm')?.getAttribute('aria-busy') === 'true');
    assert((await page.locator('#staffIdentitySubmit').textContent()).includes('Verifying') && (await page.locator('#staffIdentityStatus').textContent()).includes('Verifying your identity'), 'verification shows spinner copy and a live status');
    assert(await page.locator('#staffIdentityKey').isDisabled() && await page.locator('#staffIdentityMemberBtn').isDisabled(), 'verification prevents duplicate edits and submissions');
    releaseVerify();
    await page.waitForSelector('#staffIdentityOverlay', { state: 'detached', timeout: 5000 });
    assert(await page.locator('#navProd').isVisible()
      && (await page.locator('#navProd').textContent()).trim() === 'Linear'
      && (await page.locator('#navLinear').textContent()).trim() === 'Submit', 'verified identity sees the promoted Linear mirror and Submit labels');
    assert(await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('#headerNav > .header-nav-btn')).map(item => item.id);
      return ids.indexOf('navHome') < ids.indexOf('navProd') && ids.indexOf('navProd') < ids.indexOf('navLinear');
    }), 'staff nav orders Analytics then Linear mirror then Submit');
    assert(await page.evaluate(async () => {
      const nav = document.getElementById('headerNav');
      const actions = document.querySelector('.header-actions');
      const extras = ['navSxr', 'navKasper', 'navTiktokPilot'].map(id => document.getElementById(id)).filter(Boolean);
      const snapshots = extras.map(item => ({ item, display: item.style.display, active: item.classList.contains('active') }));
      const originalActive = document.querySelector('#headerNav > .header-nav-btn.active');
      extras.forEach(item => { item.style.display = ''; item.classList.remove('active'); });
      const target = document.getElementById('navKasper');
      if (originalActive) originalActive.classList.remove('active');
      target.classList.add('active');
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const navBox = nav.getBoundingClientRect();
      const actionBox = actions.getBoundingClientRect();
      const activeBox = target.getBoundingClientRect();
      const clean = navBox.right <= actionBox.left + 0.5
        && activeBox.left >= navBox.left - 0.5 && activeBox.right <= navBox.right + 0.5;
      target.classList.remove('active');
      if (originalActive) originalActive.classList.add('active');
      snapshots.forEach(({ item, display, active }) => { item.style.display = display; item.classList.toggle('active', active); });
      nav.scrollLeft = 0;
      return clean;
    }), 'expanded staff nav scrolls inside its column without overlapping account controls');

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('syncview_staff_identity_v1') || 'null'));
    assert(stored && stored.role === 'admin' && stored.member && stored.member.name === ADMIN.name, 'verified role and roster member persist locally');
    const headers = await page.evaluate(() => ({
      edge: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, CAL_SUPABASE_URL + '/functions/v1/calendar-upsert'),
      fallback: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, 'https://automation.invalid/webhook/calendar-upsert'),
    }));
    assert(headers.edge['X-Syncview-Key'] === ADMIN_KEY && headers.edge['X-Syncview-Actor'] === ADMIN.name && headers.edge['X-Syncview-Role'] === 'admin', 'verified identity decorates Supabase EF writes');
    assert(!headers.fallback['X-Syncview-Key'], 'verified role key is not sent to n8n fallback URLs');

    await page.evaluate(async () => {
      await _ccApi('list', {});
      await _obvFetchFull(false);
      await _fpPostPlan({ clientName: 'TEST Client', docUrl: 'https://docs.google.com/document/d/dummy' });
    });
    const credentialCall = sensitiveRequests.find(call => call.surface === 'credentials');
    const onboardingCall = sensitiveRequests.find(call => call.surface === 'onboarding');
    const filmingCall = sensitiveRequests.find(call => call.surface === 'filming');
    assert(credentialCall.headers['x-syncview-key'] === ADMIN_KEY && !credentialCall.headers['x-syncview-actor'] && credentialCall.body.actor.name === ADMIN.name && credentialCall.body.actor.role === 'admin', 'credentials reuse the admin role key and verified audit actor with the historical key-only CORS contract');
    assert(onboardingCall.headers['x-syncview-key'] === ADMIN_KEY && !onboardingCall.headers['x-syncview-role'], 'full onboarding reuses the admin role key with its historical key-only CORS contract');
    assert(filmingCall.headers['x-syncview-key'] === ADMIN_KEY && filmingCall.headers['x-syncview-actor'] === ADMIN.name && filmingCall.headers['x-syncview-role'] === 'admin', 'filming-plan writes reuse the verified admin identity');

    nextCredentialStatus = 401;
    const releaseCredential = holdGate('credentials');
    await page.evaluate(() => {
      window.__b4StaleCredentialRequest = _ccApi('list', {}).then(
        () => 'unexpected success',
        error => error && error.message,
      );
    });
    await credentialGate.entered;
    await page.evaluate(({ peer, key }) => {
      _syncviewStaffIdentityVerified = true;
      _syncviewStaffIdentitySave({ key, role: 'admin', member: peer, verified_at: new Date().toISOString() });
      _syncviewStaffRefreshChrome();
    }, { peer: ADMIN_PEER, key: ADMIN_KEY });
    releaseCredential();
    const staleResult = await page.evaluate(() => window.__b4StaleCredentialRequest);
    const activeAfterStale401 = await page.evaluate(() => JSON.parse(localStorage.getItem('syncview_staff_identity_v1') || 'null'));
    assert(staleResult === 'Staff sign-in changed.' && activeAfterStale401?.member?.id === ADMIN_PEER.id,
      'a stale 401 cannot sign out a newer person who shares the same role key');
    await page.evaluate(identity => {
      _syncviewStaffIdentityVerified = true;
      _syncviewStaffIdentitySave(identity);
      _syncviewStaffRefreshChrome();
    }, stored);

    await page.click('#staffIdentityButton');
    const popover = page.locator('#staffAccountPopover');
    await popover.waitFor({ state: 'visible' });
    assert((await page.locator('.staff-account-line').textContent()).trim() === `Signed in as ${ADMIN.name} · Admin`, 'account popover shows the exact signed-in name and role');
    assert(await page.locator('#staffIdentityOverlay').count() === 0 && await page.getByText('Switch user', { exact: true }).count() === 0, 'signed-in staff button never reopens the form or offers Switch user');
    assert(await page.locator('#staffIdentityButton').getAttribute('aria-haspopup') === 'menu' && await page.locator('#staffIdentityButton').getAttribute('aria-expanded') === 'true', 'signed-in staff button advertises its open menu');
    assert(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'staffIdentitySignOut', 'account popover moves focus to Sign out');
    await page.waitForTimeout(250);
    if (SCREENSHOT_DIR) await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'b4-staff-account-desktop-light.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    if (SCREENSHOT_DIR) await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'b4-staff-account-desktop-dark.png'), fullPage: true });
    assert((await popover.evaluate(el => getComputedStyle(el).backgroundColor)) !== 'rgb(255, 255, 255)', 'account popover follows dark theme tokens');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.keyboard.press('Escape');
    assert(await popover.isHidden() && await page.evaluate(() => document.activeElement.id) === 'staffIdentityButton', 'Escape closes the account popover and restores focus');
    await page.click('#staffIdentityButton');
    await page.waitForFunction(() => document.activeElement?.id === 'staffIdentitySignOut');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(30);
    assert(await popover.isHidden(), 'Tab closes the account popover after focus leaves its wrapper');

    const callsBeforeReload = verifyCalls;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('staffIdentityButton')?.getAttribute('aria-haspopup') === 'menu', null, { timeout: 10000 });
    assert(verifyCalls > callsBeforeReload, 'stored identity is revalidated through key-verify at boot');
    assert(await page.locator('#staffIdentityOverlay').count() === 0, 'valid boot revalidation does not re-prompt');

    const sibling = await context.newPage();
    await sibling.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));
    await installMocks(sibling);
    await sibling.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await sibling.waitForFunction(() => document.getElementById('staffIdentityButton')?.getAttribute('aria-haspopup') === 'menu');
    await sibling.evaluate(() => {
      _ccState.modal.open = true;
      _ccState.modal.credentials = [{ id: 'dummy-sibling-secret', password: 'dummy-secret' }];
      _obvMode = 'full';
      _obvSubs = [{ id: 'dummy-sibling-onboarding', password: 'dummy-secret' }];
      const overlay = document.createElement('div');
      overlay.id = 'ccOverlay';
      overlay.className = 'cc-sensitive-overlay';
      document.body.appendChild(overlay);
    });

    await page.evaluate(async () => {
      localStorage.setItem('syncview_client_credentials_identity_v1', JSON.stringify({ key: 'dummy-legacy-credentials' }));
      localStorage.setItem('syncview_filming_plans_identity_v1', JSON.stringify({ key: 'dummy-legacy-onboarding' }));
      await _ccOpenModal('TEST Client');
    });
    await page.waitForFunction(() => typeof _ccState !== 'undefined' && _ccState.modal.credentials.length === 1);
    await page.evaluate(() => {
      _obvMode = 'full';
      _obvSubs = [{ id: 'dummy-onboarding-cache', password: 'dummy-secret' }];
      _syncviewOpenStaffAccount();
    });
    assert(await page.evaluate(() => document.activeElement?.id) === 'staffIdentitySignOut', 'Sign out remains keyboard reachable above an open sensitive modal');
    await page.keyboard.press('Enter');
    const purged = await page.evaluate(() => ({
      stored: localStorage.getItem('syncview_staff_identity_v1'),
      modalRows: _ccState.modal.credentials.length,
      kasperRows: _ccState.kasper.credentials.length,
      reveals: _ccRevealed.size,
      onboarding: _obvSubs,
      onboardingMode: _obvMode,
      legacyCredentials: localStorage.getItem('syncview_client_credentials_identity_v1'),
      legacyFilming: localStorage.getItem('syncview_filming_plans_identity_v1'),
    }));
    const accountStillVisible = await page.locator('#staffAccountPopover').isVisible();
    assert(purged.stored === null && !accountStillVisible, `Sign out clears the stored identity and closes the account menu (stored=${String(purged.stored)}, visible=${accountStillVisible})`);
    assert(await page.locator('#ccOverlay').count() === 0 && purged.modalRows === 0 && purged.kasperRows === 0 && purged.reveals === 0, 'Sign out closes credentials UI and purges sensitive credential state');
    assert(purged.onboarding === null && purged.onboardingMode === 'edge', 'Sign out purges full-onboarding cache and returns to stripped mode');
    assert(purged.legacyCredentials === null && purged.legacyFilming === null, 'Sign out removes retired surface-specific keys from browser storage');
    assert(await page.locator('#staffIdentityOverlay').count() === 0 && await page.locator('#staffIdentityButton').getAttribute('aria-haspopup') === 'dialog', 'Sign out leaves the calm signed-out button without an automatic prompt');
    await sibling.waitForFunction(() => localStorage.getItem('syncview_staff_identity_v1') === null
      && document.getElementById('staffIdentityButton')?.getAttribute('aria-haspopup') === 'dialog'
      && _ccState.modal.credentials.length === 0 && _obvSubs === null
      && !document.getElementById('ccOverlay'));
    assert(true, 'Sign out propagates across tabs and purges sibling sensitive state');
    await sibling.close();

    await page.evaluate(() => _fpToggleAdd());
    await page.waitForSelector('#staffIdentityForm', { timeout: 5000 });
    assert(await page.locator('#staffIdentityOverlay').count() === 1, 'a signed-out gated action opens the single global staff sign-in');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#staffIdentityOverlay', { state: 'detached' });
    assert(await page.evaluate(() => document.activeElement.id) === 'staffIdentityButton', 'Escape closes the sign-in dialog and restores focus');
    await page.click('#staffIdentityButton');
    await page.waitForSelector('#staffIdentityForm');
    await page.locator('#staffIdentityOverlay').click({ position: { x: 4, y: 4 } });
    await page.waitForSelector('#staffIdentityOverlay', { state: 'detached' });
    assert(await page.evaluate(() => document.activeElement.id) === 'staffIdentityButton', 'clicking the backdrop closes sign-in and restores focus');

    await page.evaluate(member => {
      localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({ key: 'invalid-dummy-key', role: 'admin', member }));
      sessionStorage.removeItem('syncview_staff_identity_prompted_v1');
    }, ADMIN);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#staffIdentityOverlay', { timeout: 10000 });
    assert(await page.evaluate(() => localStorage.getItem('syncview_staff_identity_v1')) === null, '401 boot verification clears the invalid stored identity');
    assert(await page.locator('#navProd').isVisible(), 'promoted Linear mirror remains mounted in normal staff navigation');
    assert(await page.evaluate(() => {
      navTo('production');
      return currentNav === 'home' && !_prodAccessAllowed();
    }), 'invalid stored identity still cannot enter the guarded production route');
    await context.close();

    const creativeContext = await browser.newContext();
    const creativePage = await creativeContext.newPage();
    await seedStaffApp(creativePage, { key: CREATIVE_KEY, role: 'creative', member: CREATIVE });
    await installMocks(creativePage);
    await creativePage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await creativePage.waitForFunction(() => document.getElementById('staffIdentityButton')?.getAttribute('aria-haspopup') === 'menu');
    assert(await creativePage.locator('#navProd').isVisible() && (await creativePage.locator('#navProd').textContent()).trim() === 'Linear', 'creative staff also see the read-only Linear mirror tab');
    await creativePage.evaluate(() => _fpToggleAdd());
    await creativePage.waitForSelector('.sv-toast-msg');
    assert((await creativePage.locator('.sv-toast-msg').textContent()).includes('Sign out first') && await creativePage.locator('#staffIdentityOverlay').count() === 0, 'wrong-role onboarding action explains how to use an authorized account without a Switch user flow');
    await creativePage.evaluate(async () => { await _ccOpenModal('TEST Client'); });
    await creativePage.waitForFunction(() => document.querySelector('.sv-toast-msg')?.textContent.includes('Admin or SMM'));
    assert((await creativePage.locator('.sv-toast-msg').textContent()).includes('Sign out first') && await creativePage.locator('#ccOverlay').count() === 0, 'creative account cannot expose credentials and receives clear sign-out guidance');
    await creativePage.click('#staffIdentityButton');
    assert((await creativePage.locator('.staff-account-line').textContent()).trim() === `Signed in as ${CREATIVE.name} · Designer`, 'creative account menu shows the person\'s roster role');
    await creativeContext.close();

    const bootRaceContext = await browser.newContext();
    const bootRace = await bootRaceContext.newPage();
    await seedStaffApp(bootRace, { key: ADMIN_KEY, role: 'admin', member: ADMIN });
    await installMocks(bootRace);
    const releaseBootVerify = holdGate('verify');
    await bootRace.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await bootRace.waitForFunction(() => document.getElementById('staffIdentityButton')?.getAttribute('aria-busy') === 'true');
    await bootRace.click('#staffIdentityButton');
    await bootRace.waitForTimeout(80);
    assert(await bootRace.locator('#staffIdentityOverlay').count() === 0, 'slow boot verification never opens the entry form for a stored identity');
    assert((await bootRace.locator('#staffIdentityButton').getAttribute('aria-label')).includes('Checking saved'), 'returning staff see an explicit checking state during boot verification');
    releaseBootVerify();
    await bootRace.locator('#staffAccountPopover').waitFor({ state: 'visible' });
    assert(await bootRace.locator('#staffIdentityOverlay').count() === 0
      && (await bootRace.locator('.staff-account-line').textContent()).includes(ADMIN.name), 'boot verification resolves directly to the account popover');
    await bootRaceContext.close();

    const previewContext = await browser.newContext();
    const preview = await previewContext.newPage();
    await seedStaffApp(preview);
    await installMocks(preview);
    await preview.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await preview.waitForSelector('.prod-view', { timeout: 10000 });
    await preview.waitForTimeout(1100);
    assert(await preview.locator('#staffIdentityOverlay').count() === 0, 'direct ?prod=1 mirror alias remains available without a sign-in prompt');
    await previewContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobile = await mobileContext.newPage();
    await seedStaffApp(mobile);
    await installMocks(mobile);
    await mobile.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    const mobileCard = mobile.locator('.staff-auth-card');
    await mobile.waitForSelector('#staffIdentityForm', { timeout: 10000 });
    const cardBox = await mobileCard.boundingBox();
    assert(cardBox && cardBox.x >= 0 && cardBox.y >= 0 && cardBox.x + cardBox.width <= 390 && cardBox.y + cardBox.height <= 844, 'staff sign-in modal fits the mobile viewport');
    await mobile.waitForTimeout(250);
    if (SCREENSHOT_DIR) await mobile.screenshot({ path: path.join(SCREENSHOT_DIR, 'b4-staff-login-mobile-light.png') });
    await selectMember(mobile, ADMIN);
    await mobile.fill('#staffIdentityKey', ADMIN_KEY);
    await mobile.click('#staffIdentitySubmit');
    await mobile.waitForSelector('#staffIdentityOverlay', { state: 'detached' });
    await mobile.click('#staffIdentityButton');
    const mobilePopover = mobile.locator('#staffAccountPopover');
    await mobilePopover.waitFor({ state: 'visible' });
    const popoverBox = await mobilePopover.boundingBox();
    assert(popoverBox && popoverBox.x >= 0 && popoverBox.y >= 0 && popoverBox.x + popoverBox.width <= 390 && popoverBox.y + popoverBox.height <= 844, 'account popover fits the mobile viewport');
    await mobile.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await mobile.waitForTimeout(250);
    if (SCREENSHOT_DIR) await mobile.screenshot({ path: path.join(SCREENSHOT_DIR, 'b4-staff-account-mobile-dark.png') });
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
