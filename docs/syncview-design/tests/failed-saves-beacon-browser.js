'use strict';
/* failed-saves-beacon-browser.js -- saves that do not go through the write
 * gateway report their refusals to the failed-saves log (Priority 4, 2026-09-29).
 *
 * Fully offline, on a staff page, with made-up client info. Real saves are run
 * through the page's own code and every backend answer is local:
 *   - a refused Templates save (HTTP 500) sends ONE report to the log with the
 *     operation name, the status, the staff-page tag and a hashed-on-arrival
 *     client reference, and the page still shows its own "save failed" state;
 *   - a Templates save that never reaches a server is reported as a network
 *     failure with no status;
 *   - a refused Filming plan save (HTTP 403) is reported as filming_plan_save
 *     and still throws the message the page shows;
 *   - a caption-prompt save refused as HTTP 200 with {"ok":false} (how the n8n
 *     webhook route answers) is reported as caption_prompt_save and still
 *     re-enables the Save button and shows its notice;
 *   - a Templates save answered with HTTP 200 but no {"ok":true} (which the page
 *     itself rejects) is reported too;
 *   - a save that succeeds sends no report;
 *   - no report carries anything the person typed.
 */
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const CLIENT = 'Sample Save Client';
const TYPED = 'ZZ-typed-text-must-not-leave-the-page';

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const fail = m => failures.push(m);
  try {
    const context = await browser.newContext();
    const claims = [];
    const behaviour = { templates: 'ok', filming: 'ok', captions: 'ok' };
    const respond = (route, mode, okBody, code) => {
      if (mode === 'network') return route.abort('failed');
      if (mode === 'empty') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' });
      if (mode === 'refuse') return route.fulfill({ status: code, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'refused' }) });
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(okBody) });
    };
    await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), async route => {
      const r = route.request(); const u = new URL(r.url());
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      if (u.pathname === '/functions/v1/write-diagnostics') {
        let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
        claims.push({ body, raw: r.postData() || '' });
        return route.fulfill({ status: 202, headers: CORS, contentType: 'application/json', body: '{"ok":true}' });
      }
      if (u.pathname === '/functions/v1/templates-save') return respond(route, behaviour.templates, { ok: true, template: { client_name: CLIENT } }, 500);
      if (u.pathname === '/functions/v1/filming-plans' && r.method() === 'POST') return respond(route, behaviour.filming, { ok: true, plan: { clientName: CLIENT, clientSlug: 'samplesaveclient', docUrl: 'https://example.invalid/doc' } }, 403);
      if (u.pathname === '/functions/v1/caption-prompts-save') return respond(route, behaviour.captions, { ok: true }, 500);
      // The n8n webhook route (a client not yet on the function) refuses with HTTP 200 and {"ok":false}.
      if (u.pathname === '/webhook/caption-prompts-save') {
        return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(behaviour.captions === 'ok' ? { ok: true } : { ok: false, error: 'refused' }) });
      }
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' }).catch(() => {});
    });
    await seedStaffGate(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.navTo === 'function' && typeof _tplQueueSave === 'function', null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const next = async n => {
      const deadline = Date.now() + 6000;
      while (claims.length < n && Date.now() < deadline) await page.waitForTimeout(50);
      await page.waitForTimeout(250);   // a second report, if one wrongly followed, would arrive now
      return claims.slice(n - 1);
    };
    const settle = () => page.waitForTimeout(800);

    // A save that succeeds: no report.
    await page.evaluate(({ name, typed }) => { _tplQueueSave(name, 'notes', typed, true); }, { name: CLIENT, typed: TYPED });
    await settle();
    if (claims.length) fail('a Templates save that succeeded sent a report');
    else console.log('failed-saves-beacon: a save that succeeds sends no report');

    // Refused Templates save.
    behaviour.templates = 'refuse';
    await page.evaluate(({ name, typed }) => { _tplQueueSave(name, 'notes', typed + ' again', true); }, { name: CLIENT, typed: TYPED });
    let got = await next(1);
    if (got.length !== 1) fail(`refused Templates save: expected exactly 1 report, got ${got.length}`);
    else {
      const b = got[0].body;
      const okShape = b.action === 'browser_claim' && b.operation === 'templates_save' && b.status === 500 && b.page === 'staff_page'
        && b.identifiers && typeof b.identifiers.client_slug === 'string' && b.identifiers.client_slug && !b.failure;
      if (!okShape) fail('refused Templates save: report has the wrong shape: ' + JSON.stringify(b).slice(0, 300));
      else console.log('failed-saves-beacon: refused Templates save reported as templates_save, status 500, staff page');
      if (b.message !== 'HTTP 500' && !/^Save failed|refused/.test(String(b.message || ''))) fail('refused Templates save: report message is not a fixed phrase: ' + b.message);
    }
    const stateAfter = await page.evaluate(() => (typeof _tplSaveErrorMsg === 'string' ? _tplSaveErrorMsg : null));
    if (!stateAfter) fail('refused Templates save: the page no longer shows its own save-failed state');
    else console.log('failed-saves-beacon: the page still shows its own save-failed state');

    // Templates save that never reaches a server.
    behaviour.templates = 'network';
    await page.evaluate(({ name, typed }) => { _tplQueueSave(name, 'notes', typed + ' third', true); }, { name: CLIENT, typed: TYPED });
    got = await next(2);
    if (got.length !== 1) fail(`network Templates save: expected exactly 1 more report, got ${got.length}`);
    else {
      const b = got[0].body;
      if (!(b.operation === 'templates_save' && b.failure === 'network' && b.status === undefined)) fail('network Templates save: report should be a network failure with no status: ' + JSON.stringify(b).slice(0, 300));
      else console.log('failed-saves-beacon: a save that never got an answer is reported as a network failure, no status');
    }

    // Refused Filming plan save.
    behaviour.filming = 'refuse';
    const thrown = await page.evaluate(async ({ name }) => {
      try { await _fpPostPlan({ clientName: name, clientSlug: 'samplesaveclient', docUrl: 'https://example.invalid/doc' }); return ''; }
      catch (e) { return String(e && e.message || e); }
    }, { name: CLIENT });
    got = await next(3);
    if (!/needs an Admin account/.test(thrown)) fail('refused Filming plan save: the page message changed: ' + thrown);
    if (got.length !== 1) fail(`refused Filming plan save: expected exactly 1 more report, got ${got.length}`);
    else {
      const b = got[0].body;
      if (!(b.operation === 'filming_plan_save' && b.status === 403 && b.page === 'staff_page')) fail('refused Filming plan save: wrong report ' + JSON.stringify(b).slice(0, 300));
      else console.log('failed-saves-beacon: refused Filming plan save reported as filming_plan_save, status 403, and still throws the same message');
    }

    // Refused caption-prompt save.
    behaviour.captions = 'refuse';
    const captionState = await page.evaluate(async ({ name, typed }) => {
      calState.client = name;
      document.body.insertAdjacentHTML('beforeend', '<textarea id="calPromptTA"></textarea><button id="calPromptSaveBtn">Save</button>');
      document.getElementById('calPromptTA').value = typed + ' caption prompt';
      await _calSaveCaptionPrompt();
      const btn = document.getElementById('calPromptSaveBtn');
      return { disabled: btn.disabled, text: btn.textContent };
    }, { name: CLIENT, typed: TYPED });
    got = await next(4);
    if (captionState.disabled || captionState.text !== 'Save') fail('refused caption-prompt save: the Save button was not restored: ' + JSON.stringify(captionState));
    if (got.length !== 1) fail(`refused caption-prompt save: expected exactly 1 more report, got ${got.length}`);
    else {
      const b = got[0].body;
      if (!(b.operation === 'caption_prompt_save' && b.status === undefined && b.message === 'save refused' && b.page === 'staff_page')) fail('refused caption-prompt save: wrong report ' + JSON.stringify(b).slice(0, 300));
      else console.log('failed-saves-beacon: caption-prompt save refused with HTTP 200 and ok:false reported as caption_prompt_save (no status), and the button is restored');
    }

    // A save answered with HTTP 200 and no ok:true: the page rejects it, so it is reported too.
    behaviour.templates = 'empty';
    await page.evaluate(({ name, typed }) => { _tplQueueSave(name, 'notes', typed + ' fifth', true); }, { name: CLIENT, typed: TYPED });
    got = await next(5);
    if (got.length !== 1) fail(`Templates save answered without ok:true: expected exactly 1 more report, got ${got.length}`);
    else {
      const b = got[0].body;
      if (!(b.operation === 'templates_save' && b.message === 'save refused' && b.status === undefined)) fail('Templates save answered without ok:true: wrong report ' + JSON.stringify(b).slice(0, 300));
      else console.log('failed-saves-beacon: a Templates save answered with HTTP 200 and no ok:true (the page rejects it) is reported too');
    }

    // Nothing typed ever leaves the page in a report.
    if (claims.some(c => c.raw.includes(TYPED))) fail('a report carried text the person typed');
    else console.log('failed-saves-beacon: no report carries anything that was typed');
    if (errors.length) fail('page errors: ' + errors.join(' | '));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(formatFailures('failed-saves-beacon failures', failures));
    process.exit(1);
  }
  console.log('failed-saves-beacon: PASS');
})().catch(err => { console.error(err); process.exit(1); });
