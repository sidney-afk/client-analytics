'use strict';

// The Onboarding page opened from the staff profile menu (/onboarding) must
// leave its loading skeleton once the list arrives (owner bug, 2026-09-28:
// _obvRerender only repainted the Kasper subtab and the standalone client
// view, so the staff page sat on its skeleton forever). Also: a failed read
// and an empty list each show their own message.
//
// Fully offline: onboarding-full is answered locally, everything else gets
// an empty answer. Fixture names only; this repo is public.

const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

async function openOnboarding(browser, port, answer) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()),
    route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {}));
  await seedStaffGate(context);
  await context.route('**/functions/v1/onboarding-full**', route => route.fulfill(answer));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto(`http://127.0.0.1:${port}/workload`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof currentNav === 'string' && currentNav === 'workload', null, { timeout: 20000 });
  // The way a person gets there: open the profile menu, click Onboarding.
  await page.click('#headerMenuButton');
  await page.waitForSelector('#headerOnboardingMenuItem:not([hidden])', { timeout: 10000 });
  await page.click('#headerOnboardingMenuItem');
  return { context, page, errors };
}
const settled = page => page.waitForFunction(() => {
  const el = document.querySelector('[data-sv-staff-page="staff-onboarding"] #kasperContent');
  return el && (el.querySelector('.obv-list, .obv-empty'));
}, null, { timeout: 15000 }).then(() => true, () => false);

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    {
      const { context, page, errors } = await openOnboarding(browser, port, { status: 200, contentType: 'application/json',
        body: JSON.stringify({ submissions: [{ id: 'sub_fixture', first_name: 'Fixture', last_name: 'Person', email: 'fixture@example.test', funnel: 'standard', created_at: new Date().toISOString() }] }) });
      check(await page.evaluate(() => location.pathname) === '/onboarding', 'the profile menu opens /onboarding');
      check(await settled(page), 'the page leaves its loading state once the list arrives');
      const text = await page.evaluate(() => document.querySelector('[data-sv-staff-page="staff-onboarding"]').innerText);
      check(/Fixture Person/.test(text), 'the onboarding list shows the submission');
      check(!errors.length, 'no page errors: ' + errors.join(' | '));
      await context.close();
    }
    {
      const { context, page } = await openOnboarding(browser, port, { status: 500, contentType: 'application/json', body: '{}' });
      await settled(page);
      const text = await page.evaluate(() => document.querySelector('[data-sv-staff-page="staff-onboarding"]').innerText);
      check(/Couldn.t load submissions/.test(text), 'a failed read shows its message');
      await context.close();
    }
    {
      const { context, page } = await openOnboarding(browser, port, { status: 200, contentType: 'application/json', body: JSON.stringify({ submissions: [] }) });
      await settled(page);
      const text = await page.evaluate(() => document.querySelector('[data-sv-staff-page="staff-onboarding"]').innerText);
      check(/No onboarding submissions yet/.test(text), 'an empty list shows its message');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`staff-onboarding-page: ${failures.length} failed`); process.exit(1); }
  console.log('staff-onboarding-page: PASS');
})().catch(e => { console.error(e); process.exit(1); });
