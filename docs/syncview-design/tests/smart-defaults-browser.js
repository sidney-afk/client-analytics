'use strict';

// Smart defaults (owner decision 2026-09-27): a creative (a non-admin on the
// video or graphics team) opens Workload filtered to themselves and SyncLinear
// on "My issues". An admin keeps the whole-team views, and an address that
// already names a view keeps it.
//
// Fully offline: key-verify answers with the fixture member, every other
// non-local request is answered with an empty list.

const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { refuseStubKeyProductionWrite } = require('../../../qa/staff-gate-seed');

const EDITOR = { id: 'fixture-editor', name: 'Fixture Editor', role: 'editor', team: 'video' };
const ADMIN = { id: 'fixture-admin', name: 'Fixture Admin', role: 'admin', team: 'graphics' };

async function open(browser, port, suffix, member, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
  });
  const identity = JSON.stringify({ key: 'qa-staff-gate-key', role, member, verified_at: new Date().toISOString() });
  await context.addInitScript(payload => {
    try { localStorage.setItem('syncview_staff_identity_v1', payload); localStorage.removeItem('syncview_nav'); } catch (e) {}
  }, identity);
  await refuseStubKeyProductionWrite(context);
  await context.route('**/functions/v1/key-verify', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, role, member }),
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto(`http://127.0.0.1:${port}${suffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navTo === 'function');
  await page.waitForTimeout(2000);
  return { context, page, errors };
}

const prodView = page => page.evaluate(() => {
  return new URLSearchParams(location.search).get('view') || (document.getElementById('prodRoot') ? document.getElementById('prodRoot').textContent.includes('My issues') && [...document.querySelectorAll('#prodRoot [class*="active"]')].some(el => el.textContent.trim() === 'My issues') ? 'my' : 'other' : 'none');
});

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push(msg); };
  try {
    {
      const { context, page, errors } = await open(browser, port, '/workload', EDITOR, 'editor');
      // Workload assignee ids are not staff ids: the default resolves by name
      // once rows for this person arrive.
      const picked = await page.evaluate(name => {
        wlState.allActiveSubs = [
          { assigneeId: 'wl-assignee-1', assigneeName: name, teamKey: 'VID', teamName: 'Video', nativeAssigneeEligible: true },
          { assigneeId: 'wl-assignee-2', assigneeName: 'Someone Else', teamKey: 'VID', teamName: 'Video', nativeAssigneeEligible: true },
        ];
        wlPopulateFilterOptions();
        return wlState.editor;
      }, EDITOR.name);
      expect(picked === 'wl-assignee-1', `creative: Workload did not filter to them once their rows loaded (${picked})`);
      await page.evaluate(() => navTo('production'));
      await page.waitForTimeout(1500);
      expect(await prodView(page) === 'my', `creative: SyncLinear did not open on My issues (${await prodView(page)})`);
      if (errors.length) failures.push('creative: page errors: ' + errors.slice(0, 2).join(' | '));
      await context.close();
    }
    {
      const { context, page } = await open(browser, port, '/synclinear?prod=1&view=list', EDITOR, 'editor');
      await page.waitForTimeout(500);
      expect(await prodView(page) !== 'my', 'creative: an address naming a view was overridden');
      await context.close();
    }
    {
      const { context, page } = await open(browser, port, '/workload', ADMIN, 'admin');
      const adminPick = await page.evaluate(name => {
        wlState.allActiveSubs = [{ assigneeId: 'wl-assignee-1', assigneeName: name, teamKey: 'GRA', teamName: 'Graphics', nativeAssigneeEligible: true }];
        wlPopulateFilterOptions();
        return wlState.editor;
      }, ADMIN.name);
      expect(adminPick === 'all', 'admin: Workload should stay on the whole team');
      await page.evaluate(() => navTo('production'));
      await page.waitForTimeout(1500);
      expect(await prodView(page) !== 'my', 'admin: SyncLinear should not default to My issues');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(formatFailures('smart-defaults failures', failures));
    process.exit(1);
  }
  console.log('smart-defaults: PASS');
})().catch(err => { console.error(err); process.exit(1); });
