'use strict';

// "Never lose what was typed" for the upload form (owner goal 2026-10-18).
// Covers the public upload link (?intake=1) and the staff Submit tab, offline:
// the gateway is answered here and nothing reaches a server. Every way a send
// can fail or be interrupted is driven in a real headless browser, and each
// case checks three things: the typed values are still on the page or in the
// saved draft, the person is told the truth (received or not), and a retry
// cannot make a second batch.
//
// Demo names only; this repo is public.

const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const SLUG = 'demo-upload-fixture', NAME = 'Alex Morgan';
const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

// `plan` decides what the pretend server does with each intake_create call, in
// order: 'ok', 'drop' (nothing reaches the server), 'lost' (server keeps it,
// the answer never arrives), '500', '401', 'plain200' (200 without a commit).
async function harness(browser, port, { staff, width = 1280, height = 900, blockStorage, noLocks, plan = [], delayMs = 0, clientsFail, cardFails = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const net = { intake: [], stored: new Map(), plan: plan.slice(), cardFails };
  if (staff) await seedStaffGate(context);
  if (noLocks) await context.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'locks', { get() { return undefined; } }); } catch (e) {} });
  if (blockStorage) {
    await context.addInitScript(() => {
      const boom = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
      try { Storage.prototype.setItem = boom; } catch (e) {}
    });
  }
  await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), async route => {
    const url = new URL(route.request().url());
    if (/functions\/v1\/key-verify/.test(url.pathname)) return route.fallback();
    if (/functions\/v1\/production-write/.test(url.pathname)) {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.operation === 'intake_create') {
        net.intake.push(body);
        const step = net.plan.length ? net.plan.shift() : 'ok';
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
        const committed = () => {
          net.stored.set(body.request_id, body);
          return { ok: true, native_committed: true, mirror_pending: false, batch: { id: 'batch-' + body.request_id },
            items: body.items.map((item, item_index) => ({ item_index, id: 'd-' + item_index + '-' + body.request_id, team: item.team, card_id: item.card_id })) };
        };
        if (step === 'drop') return route.abort('failed');
        if (step === 'lost') { committed(); return route.abort('connectionreset'); }
        if (step === '500') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"write_failed"}' });
        if (step === '401') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"error":"credentials_required"}' });
        if (step === 'plain200') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        return route.fulfill({ status: net.stored.has(body.request_id) ? 200 : 201, contentType: 'application/json', body: JSON.stringify(committed()) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (/calendar-(upsert|card)|sample-upsert/.test(url.pathname) && net.cardFails > 0) {
      net.cardFails--; net.cardFailed = (net.cardFailed || 0) + 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' });
    }
    if (/functions\/v1\//.test(url.pathname) || /calendar-upsert/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (/\/rest\/v1\/(deliverables|batches)$/.test(url.pathname) && /(^|&)select=id(&|$)/.test(url.search.slice(1))) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.pathname.endsWith('/clients')) {
      if (clientsFail) return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ slug: SLUG, display_name: NAME, kind: 'client', active: true }]) });
    }
    if (url.pathname.endsWith('/syncview_runtime_flags')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'write_ui_reroute_clients', value: { clients: [SLUG] } }]) });
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e) + (process.env.STACK ? ' @ ' + String(e.stack || '').split('\n').slice(1,3).join(' ') : '')));
  return { context, page, net, errors };
}

async function open(page, port, surface) {
  if (surface === 'link') await page.goto(`http://127.0.0.1:${port}/?intake=1`);
  else {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => typeof navTo === 'function');
    await page.evaluate(() => navTo('linear'));
  }
  await page.waitForSelector('#linearClientSearch');
  await page.waitForTimeout(300);
}

const FILL = {
  '#linearNotes': 'Shot outside in the morning.',
  '#vid_main_1': 'https://drive.invalid/v1/main',
  '#vid_notes_1': 'Use the second take.',
  '#vid_main_2': 'https://drive.invalid/v2/main',
};
async function fillForm(page) {
  await page.evaluate(([n, s]) => selectLinearProject(n, s), [NAME, SLUG]);
  for (const [sel, value] of Object.entries(FILL)) await page.locator(sel).fill(value);
}
async function values(page) {
  return page.evaluate(sels => Object.fromEntries(sels.map(s => [s, (document.querySelector(s) || {}).value || ''])), Object.keys(FILL));
}
async function typedIntact(page) {
  const v = await values(page);
  return Object.entries(FILL).every(([s, want]) => v[s] === want);
}
async function client(page) { return page.evaluate(() => document.getElementById('linearClientSearch').value); }
async function status(page) { return page.evaluate(() => ((document.getElementById('linearStatus') || {}).textContent || '').trim()); }
async function bodyText(page) { return page.evaluate(() => document.body.innerText); }
const received = text => /Upload received|Production work created|Production work received/.test(text);
async function send(page) { await page.locator('#linearSubmitBtn').click(); }
async function settle(page, ms = 1500) { await page.waitForTimeout(ms); }
async function waitSettled(page, net, count) {
  for (let i = 0; i < 100 && net.intake.length < count; i++) await page.waitForTimeout(50);
  await page.waitForTimeout(1200);
}

async function scenario(browser, port, surface, name, opts, run) {
  const h = await harness(browser, port, { staff: surface === 'staff', ...opts });
  try {
    await open(h.page, port, surface);
    await run(h, label => `${surface}${opts.width && opts.width < 500 ? ' phone' : ''}: ${name} ${label}`);
  } catch (e) {
    check(false, `${surface}: ${name} crashed: ${e && e.message}`);
  } finally { await h.context.close(); }
}

async function all(browser, port, surface, width) {
  const base = { width };
  // 1 typed values survive reload / closed tab / back-forward.
  await scenario(browser, port, surface, 'typed values', base, async ({ page, context, net, errors }, L) => {
    await fillForm(page);
    await page.reload(); await page.waitForSelector('#linearClientSearch'); await page.waitForTimeout(300);
    check(await typedIntact(page) && await client(page) === NAME, L('survive a reload'));
    const second = await context.newPage(); await second.goto(page.url());
    await second.waitForSelector('#linearClientSearch'); await second.waitForTimeout(300);
    check(await typedIntact(second) && await client(second) === NAME, L('survive a closed and reopened tab'));
    await second.goto('about:blank'); await second.goBack(); await second.waitForSelector('#linearClientSearch'); await second.waitForTimeout(300);
    check(await typedIntact(second), L('survive back then forward'));
    // a crash with no chance to run unload code: the draft was written on typing.
    const crash = await context.newPage(); await crash.goto(page.url());
    await crash.waitForSelector('#linearClientSearch'); await crash.waitForTimeout(300);
    await crash.locator('#vid_notes_2').fill('last words before the phone slept');
    await crash.close({ runBeforeUnload: false });
    const again = await context.newPage(); await again.goto(page.url());
    await again.waitForSelector('#linearClientSearch'); await again.waitForTimeout(300);
    check(await again.locator('#vid_notes_2').inputValue() === 'last words before the phone slept', L('the last keystroke before a crash is kept'));
    check(!errors.length, L('no page errors ' + errors.join('|')));
  });
  // 2 each failure keeps everything, says so, offers a retry, and one retry sends once.
  for (const step of ['drop', '500', '401', 'plain200']) {
    await scenario(browser, port, surface, 'failed send (' + step + ')', { ...base, plan: [step] }, async ({ page, net, errors }, L) => {
      await fillForm(page); await send(page); await waitSettled(page, net, 1);
      const t = await bodyText(page);
      check(!received(t), L('does not claim it was received'));
      check(await typedIntact(page), L('keeps every typed value on the page'));
      check(/not (completed|sent|received)|try again|retry|could not|saved/i.test(await status(page) + ' ' + t), L('tells the person plainly: "' + (await status(page)).slice(0, 80) + '"'));
      check(await page.locator('#linearSubmitBtn').isEnabled(), L('the button is usable again'));
      await send(page); await waitSettled(page, net, 2);
      check(received(await bodyText(page)), L('the retry is told it arrived'));
      check(net.stored.size === 1, L('exactly one submission on the server (' + net.stored.size + ')'));
      check(new Set(net.intake.map(b => b.request_id)).size === 1, L('the retry reuses the same request id'));
      check(!errors.length, L('no page errors ' + errors.join('|')));
    });
  }
  // 3 answer lost: server has it; retry must not duplicate; person told.
  await scenario(browser, port, surface, 'answer lost', { ...base, plan: ['lost'] }, async ({ page, net, errors }, L) => {
    await fillForm(page); await send(page); await waitSettled(page, net, 1);
    check(!received(await bodyText(page)) || net.stored.size === 1, L('no false claim'));
    await send(page).catch(() => {}); await waitSettled(page, net, 2);
    check(net.stored.size === 1, L('still exactly one submission'));
    check(new Set(net.intake.map(b => b.request_id)).size === 1, L('same request id on retry'));
    check(received(await bodyText(page)), L('told it arrived'));
  });
  // 4 double click.
  await scenario(browser, port, surface, 'double click', { ...base, delayMs: 600 }, async ({ page, net }, L) => {
    await fillForm(page);
    await page.locator('#linearSubmitBtn').dblclick(); await waitSettled(page, net, 1);
    check(net.intake.length === 1 && net.stored.size === 1, L('one request for a double click (' + net.intake.length + ')'));
    check(received(await bodyText(page)), L('told it arrived'));
  });
  // 5 closed during send, reopened.
  await scenario(browser, port, surface, 'closed mid send', { ...base, delayMs: 1500 }, async ({ page, context, net }, L) => {
    await fillForm(page); await send(page); await page.waitForTimeout(400);
    const url = page.url(); await page.close({ runBeforeUnload: false });
    const again = await context.newPage(); await again.goto(url);
    await again.waitForSelector('#linearClientSearch'); await again.waitForTimeout(2500);
    const t = await bodyText(again);
    check(net.stored.size <= 1, L('never two submissions'));
    check(await typedIntact(again) || received(t) || /saved submission|Restore|Send it/i.test(t), L('the form, the receipt or the saved box is showing'));
  });
  // 6 storage unusable (full, or blocked): must still send from memory and tell the truth.
  await scenario(browser, port, surface, 'storage full', { ...base, blockStorage: true }, async ({ page, net, errors }, L) => {
    await fillForm(page);
    check(await typedIntact(page), L('typing still works with storage refusing writes'));
    await send(page); await waitSettled(page, net, 1);
    check(net.stored.size === 1 && received(await bodyText(page)), L('still sent and confirmed (' + net.stored.size + ')'));
    check(!errors.length, L('no page errors ' + errors.join('|')));
  });
  // 6b storage full AND the answer lost: the retry must be the same request.
  await scenario(browser, port, surface, 'storage full and answer lost', { ...base, blockStorage: true, plan: ['lost'] }, async ({ page, net }, L) => {
    await fillForm(page); await send(page); await waitSettled(page, net, 1);
    check(!received(await bodyText(page)) && /Not sent yet/.test(await status(page)) && await typedIntact(page), L('nothing claimed, form intact, plain message'));
    await send(page); await waitSettled(page, net, 2);
    check(net.stored.size === 1 && new Set(net.intake.map(b => b.request_id)).size === 1, L('the second press is the same request: one submission'));
    check(received(await bodyText(page)), L('told it arrived'));
  });
  // 6c an older browser with no cross-tab lock must still send, once.
  await scenario(browser, port, surface, 'no Web Locks (older browser)', { ...base, noLocks: true, plan: ['lost'] }, async ({ page, net }, L) => {
    check(await page.evaluate(() => !navigator.locks), L('the page really has no navigator.locks'));
    await fillForm(page); await send(page); await waitSettled(page, net, 1);
    check(!received(await bodyText(page)) && await typedIntact(page), L('answer lost: nothing claimed, form intact'));
    await send(page); await waitSettled(page, net, 2);
    check(net.stored.size === 1 && new Set(net.intake.map(b => b.request_id)).size === 1 && received(await bodyText(page)), L('retry is the same request and is confirmed'));
  });
  // 7 slow network.
  await scenario(browser, port, surface, 'slow server', { ...base, delayMs: 2500 }, async ({ page, net }, L) => {
    await fillForm(page); await send(page); await page.waitForTimeout(800);
    check(!received(await bodyText(page)), L('no success while waiting'));
    check(/Submitting/.test(await page.locator('#linearSubmitBtn').innerText()), L('says it is sending'));
    await waitSettled(page, net, 1); await page.waitForTimeout(2200);
    check(received(await bodyText(page)) && net.stored.size === 1, L('success only after the answer'));
  });
  // 7b the server took it, but the calendar-card step after it failed.
  await scenario(browser, port, surface, 'card step fails after server accepted', { ...base, cardFails: 1 }, async ({ page, net }, L) => {
    await fillForm(page); await send(page); await waitSettled(page, net, 1);
    const t = (await bodyText(page));
    check(net.stored.size === 1, L('server has it'));
    if (!net.cardFailed) { check(true, L('(card step not reached in this harness; skipped)')); return; }
    check(/received|saved|safe/i.test(await status(page)) && !/not (completed|sent)|Not sent/i.test(await status(page)), L('the person is told it was received, not that it failed: "' + (await status(page)).slice(0, 100) + '"'));
    if (surface === 'link') check(!/calendar|request|resume/i.test(await status(page)), L('plain words for the client link'));
    await send(page); await waitSettled(page, net, 2);
    check(net.stored.size === 1 && net.intake.length <= 2, L('retry finishes without a second batch'));
    check(received(await bodyText(page)), L('then shows received'));
  });
  // 7c a saved send the server keeps refusing is discarded after strikes: the typed form must come back.
  await scenario(browser, port, surface, 'refused saved send is discarded', { ...base, plan: ['drop'] }, async ({ page, net }, L) => {
    await fillForm(page); await send(page); await waitSettled(page, net, 1);
    const out = await page.evaluate(() => {
      const job = JSON.parse(localStorage.getItem('syncview_native_intake_pending_v1') || 'null');
      if (!job) return { noJob: true };
      localStorage.removeItem('syncview_linear_form');
      job.resume_refusals = 1; localStorage.setItem('syncview_native_intake_pending_v1', JSON.stringify(job));
      const id = job.payload.request_id;
      const gone = _linearIntakeDiscardTerminallyRefused('startup', id, { status: 409, code: 'x' });
      return { gone, still: !!localStorage.getItem('syncview_native_intake_pending_v1'), form: JSON.parse(localStorage.getItem('syncview_linear_form') || 'null') };
    });
    check(out.gone === true && !out.still, L('the refused saved send is discarded after its strikes'));
    check(!!out.form && out.form.client === NAME && out.form.videos && out.form.videos[0].main_cam === FILL['#vid_main_1'], L('what was typed is put back in the form draft'));
  });
  // 8 client list cannot load: what was typed is kept.
  await scenario(browser, port, surface, 'client list down', { ...base, clientsFail: true }, async ({ page, net }, L) => {
    await page.locator('#linearNotes').fill(FILL['#linearNotes']);
    await page.locator('#vid_main_1').fill(FILL['#vid_main_1']);
    await page.locator('#linearClientSearch').fill(NAME);
    await send(page); await page.waitForTimeout(1500);
    check(!received(await bodyText(page)), L('no false success'));
    check((await page.locator('#linearNotes').inputValue()) === FILL['#linearNotes'] && (await page.locator('#vid_main_1').inputValue()) === FILL['#vid_main_1'], L('typed values kept'));
    check((await status(page)).length > 0, L('tells the person something: "' + (await status(page)).slice(0, 80) + '"'));
  });
}

async function signedOut(browser, port) {
  const h = await harness(browser, port, {});
  try {
    await open(h.page, port, 'staff');
    await fillForm(h.page); await h.page.evaluate(() => { submitLinearUpload().catch(() => {}); }); await h.page.waitForTimeout(1500);
    check(h.net.intake.length === 0 && !received(await bodyText(h.page)), 'staff signed out: nothing is sent and no success is shown');
    check(await typedIntact(h.page), 'staff signed out: everything typed is still on the page');
    check((await status(h.page)).length > 0 || /sign/i.test(await bodyText(h.page)), 'staff signed out: the person is told why: "' + (await status(h.page)).slice(0, 80) + '"');
  } catch (e) { check(false, 'staff signed out crashed: ' + e.message); } finally { await h.context.close(); }
}

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const surface of ['link', 'staff']) {
      await all(browser, port, surface, 1280);
    }
    await all(browser, port, 'link', 390);
    await signedOut(browser, port);
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nnever-lost checks passed');
})().catch(error => { console.error(error); process.exit(1); });
