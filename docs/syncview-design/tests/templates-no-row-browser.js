'use strict';

// A client with no Templates row yet must still get a working Templates page
// (owner rule 2026-09-28). Rows in `templates` are created only by the first
// save (supabase/functions/templates-save upserts), and nothing at onboarding
// makes one, so a brand-new client always starts with no row.
//
// Proves, fully offline:
//   - the page for a client with no row draws an empty form, not a load error;
//   - saving the thumbnail Canva link goes through the normal save
//     (templates-save) with the client's name, the link list and the single
//     link, and nothing else;
//   - the saved link then shows on the page.
// Fixture names only; this repo is public.

const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const NAME = 'Templates Fixture';
const LINK = 'https://example.invalid/fixture-canva';
const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const saves = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await seedStaffGate(context);
    await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), async route => {
      const url = new URL(route.request().url());
      if (/functions\/v1\/key-verify/.test(url.pathname)) return route.fallback();
      if (/functions\/v1\/templates-save/.test(url.pathname)) {
        const body = JSON.parse(route.request().postData() || '{}');
        saves.push(body);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          ok: true, template: Object.assign({ client_name: body.clientName }, body.patch, { updated_at: new Date().toISOString() }),
        }) });
      }
      // No client has a Templates row: the table answers empty.
      if (/\/rest\/v1\/templates$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (/\/functions\/v1\//.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      if (/\/rest\/v1\//.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.goto(`http://127.0.0.1:${port}/templates`);
    await page.waitForFunction(() => typeof currentNav === 'string' && currentNav === 'templates', null, { timeout: 20000 });
    await page.evaluate(n => { _templatesSelected = n; navTo('templates'); }, NAME);
    await page.waitForFunction(() => !document.querySelector('.tpl-skeleton'), null, { timeout: 15000 }).catch(() => {});

    const view = await page.evaluate(() => {
      const c = document.getElementById('content');
      return { text: c ? c.innerText : '', banner: !!document.querySelector('.tpl-config-banner') };
    });
    check(view.text.includes(NAME), 'the page for a client with no row opens on that client');
    check(!view.banner && !/could(n.t| not) load/i.test(view.text), 'it shows no load error');

    await page.evaluate(() => setTemplatesEditMode(true));
    const input = page.locator('[data-tpl-link-field="thumbnails_canva_link"] input[data-tpl-link-set="0"]');
    check(await input.count() === 1, 'the empty form has the thumbnail Canva link field');
    check((await input.inputValue()) === '', 'the field starts empty');

    await input.fill(LINK);
    await page.mouse.click(5, 5);
    await page.waitForFunction(() => { const b = document.getElementById('tplStatusBadge'); return !b || !b.classList.contains('saving'); }, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const last = saves[saves.length - 1] || {};
    check(saves.length >= 1 && last.clientName === NAME, 'the normal save is sent for the client');
    const keys = Object.keys(last.patch || {}).sort();
    check(keys.join(',') === 'thumbnails_canva_link,thumbnails_canva_link_list', 'it saves only the link and its list');
    check(last.patch && last.patch.thumbnails_canva_link === LINK && last.patch.thumbnails_canva_link_list === JSON.stringify([LINK]), 'it saves the typed link');

    await page.evaluate(() => setTemplatesEditMode(false));
    await page.waitForTimeout(500);
    check(await page.evaluate(l => !!document.querySelector(`#content a[href="${l}"]`), LINK), 'the saved link shows on the page');
    check(!errors.length, 'no page errors: ' + errors.join(' | '));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `templates-no-row-browser: ${failures.length} failed` : 'templates-no-row-browser: all passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('templates-no-row-browser: harness error', e && e.message); process.exit(2); });
