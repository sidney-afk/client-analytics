// STAFF ENTRY GATE — the door to SyncView.
//
// The shared staff password was retired on 2026-09-10. Entry is now the same
// roster-name + personal role key that already gated every capability, and the
// property this file exists to hold is the one that is easy to lose in a
// refactor: THE SAVED IDENTITY IS NOT A CREDENTIAL. localStorage is writable by
// hand, so a stored blob may only decide what to PAINT; what opens the door is
// the key-verify Edge Function agreeing. Everything below drives the real page
// in a real browser with the backend stubbed.
//
// Run: node test/staff-entry-gate.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MEMBER = { id: 'm_admin', name: 'Gate Admin', role: 'admin', team: 'graphics' };
const ROSTER = [MEMBER, { id: 'm_smm', name: 'Gate Smm', role: 'smm', team: null }];

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.log('  FAIL  ' + message); }
}

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = rel === '/' ? '/index.html' : rel;
      try {
        const body = fs.readFileSync(path.join(ROOT, file));
        res.writeHead(200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'text/html' });
        res.end(body);
      } catch (e) { res.writeHead(404); res.end(''); }
    });
    server.listen(0, () => resolve(server));
  });
}

// keyVerify: 'ok' | 401 | 'down'
async function openPage(browser, origin, { identity, keyVerify }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(value => {
    if (value) localStorage.setItem('syncview_staff_identity_v1', value);
    else localStorage.removeItem('syncview_staff_identity_v1');
  }, identity ? JSON.stringify(identity) : null);
  // Playwright tries the most recently registered route first, so this
  // catch-all goes in BEFORE the specific stubs or it swallows them.
  await context.route('**/*', route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
  await context.route('**/rest/v1/team_members**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(ROSTER)
  }));
  await context.route('**/functions/v1/key-verify', route => {
    if (keyVerify === 401) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' });
    if (keyVerify === 'down') return route.abort();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, role: MEMBER.role, member: MEMBER })
    });
  });
  const page = await context.newPage();
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  return { context, page };
}

const state = page => page.evaluate(() => ({
  cover: getComputedStyle(document.getElementById('staffGateOverlay')).display !== 'none',
  card: !!document.getElementById('staffIdentityOverlay'),
  cancel: !!document.getElementById('staffIdentityCancel'),
  stored: !!localStorage.getItem('syncview_staff_identity_v1'),
  verified: typeof _syncviewStaffIdentityValid === 'function' ? _syncviewStaffIdentityValid() : null,
  headerVisible: !!document.querySelector('header.header')
    && getComputedStyle(document.querySelector('header.header')).display !== 'none'
}));

function identity(verifiedAt) {
  return { key: 'gate-role-key', role: MEMBER.role, member: MEMBER, verified_at: verifiedAt };
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    // 1. No identity at all: the gate is the whole page and cannot be dismissed.
    {
      const { context, page } = await openPage(browser, origin, { identity: null, keyVerify: 'ok' });
      await page.waitForSelector('#staffIdentityForm', { timeout: 15000 });
      const before = await state(page);
      ok(before.cover && before.card, 'a signed-out visit lands on the sign-in gate');
      ok(!before.cancel, 'the entry card has no "Not now": there is nothing behind it to dismiss to');
      await page.keyboard.press('Escape');
      await page.mouse.click(8, 8);
      await page.waitForTimeout(250);
      const after = await state(page);
      ok(after.cover && after.card, 'Escape and a backdrop click do not open the app');

      // Signing in with a key the verifier accepts lifts the gate and boots.
      await page.locator('#staffIdentityMemberBtn').click();
      await page.locator('[data-cc-select-option]', { hasText: MEMBER.name }).first().click();
      await page.locator('#staffIdentityKey').fill('gate-role-key');
      await page.locator('#staffIdentitySubmit').click();
      await page.waitForFunction(() => !document.getElementById('staffIdentityOverlay'), { timeout: 15000 });
      const signedIn = await state(page);
      ok(!signedIn.cover && signedIn.verified === true, 'a verified role key opens the app');
      ok(signedIn.headerVisible, 'and the app chrome is actually there behind it');
      await context.close();
    }

    // 2. THE LOAD-BEARING NEGATIVE: a hand-written identity is not a key.
    //    This is what anyone can do in devtools; the verifier is what decides.
    {
      const { context, page } = await openPage(browser, origin, {
        identity: identity(new Date().toISOString()), keyVerify: 401
      });
      await page.waitForSelector('#staffIdentityForm', { timeout: 15000 });
      const forged = await state(page);
      ok(forged.cover && forged.card, 'a stored identity the verifier rejects gets the gate, not the app');
      ok(!forged.stored, 'and the rejected identity is cleared rather than left to try again');
      ok(forged.verified === false, 'nothing is treated as verified on that path');
      await context.close();
    }

    // 3. Verifier unreachable, key never rejected: a recently verified browser
    //    keeps the read-only shell. A Supabase blip is not a lockout.
    {
      const { context, page } = await openPage(browser, origin, {
        identity: identity(new Date().toISOString()), keyVerify: 'down'
      });
      await page.waitForTimeout(2500);
      const grace = await state(page);
      ok(!grace.cover && !grace.card, 'a recently verified browser rides out a verifier outage');
      ok(grace.verified === false,
        'THE LOAD-BEARING NEGATIVE: riding it out is NOT verification -- every write still '
        + 'fails closed, so the grace window can never become a way to act unverified');
      await context.close();
    }

    // 4. ...but the grace window is a window. An old identity re-verifies or gates.
    {
      const stale = new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString();
      const { context, page } = await openPage(browser, origin, { identity: identity(stale), keyVerify: 'down' });
      await page.waitForSelector('#staffIdentityForm', { timeout: 15000 });
      const expired = await state(page);
      ok(expired.cover && expired.card, 'an identity last verified two days ago gates when the verifier is unreachable');
      await context.close();
    }

    // 5. Signing out returns to the door, not to a usable app.
    {
      const { context, page } = await openPage(browser, origin, {
        identity: identity(new Date().toISOString()), keyVerify: 'ok'
      });
      await page.waitForFunction(() => typeof _syncviewStaffIdentityClear === 'function', { timeout: 15000 });
      await page.waitForTimeout(800);
      ok(!(await state(page)).cover, 'a verified identity boots straight into the app');
      await page.evaluate(() => _syncviewStaffIdentityClear());
      await page.waitForTimeout(400);
      const out = await state(page);
      ok(out.cover, 'signing out drops the gate back over the running app');
      await context.close();
    }

    // 6. Surfaces with their own access model are NOT staff surfaces and must
    //    never see this gate. A client whose share link stops working because
    //    of a staff-side change is the worst outcome this change could have.
    for (const [suffix, label] of [['?intake=1', 'the client intake link'],
                                   ['#smm-weekly-report', 'the SMM weekly entry'],
                                   ['?c=someclient&t=sometoken', 'a client share link'],
                                   ['?onboarding=1', 'the onboarding funnel']]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.route('**/*', route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
      const page = await context.newPage();
      await page.goto(origin + '/index.html' + suffix, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const gated = await page.evaluate(() => getComputedStyle(document.getElementById('staffGateOverlay')).display !== 'none');
      ok(!gated, label + ' never meets the staff gate');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\nstaff-entry-gate: ${failures} check(s) failed ❌` : '\nstaff-entry-gate: all checks passed ✅');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
