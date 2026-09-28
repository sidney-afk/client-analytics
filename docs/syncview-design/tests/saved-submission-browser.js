'use strict';

// A submission saved in the browser must never trap the person (owner rule
// 2026-09-28, after a videographer on the public submission link could not
// submit at all: every attempt said "Finish the previously saved submission"
// and nothing on the page could show, finish or remove it).
//
// Proves, on the Submit tab (public link) and in Calendar Create Post:
//   - the stuck state is SHOWN (a box with client, title, count, time);
//   - Restore puts it back, and the edited submit REPLACES it under the same
//     request id, so the gateway sees one batch identity, never two;
//   - Send it as it was sends the saved request unchanged;
//   - Discard (after a confirm) removes only it, and a fresh one works after;
//   - on the public link a saved submission is retried by itself on page load;
//   - every refusal is written to the save-problems log without a client name.
// And the four review fixes on #1824:
//   - a restored job is never sent in the background while it is being edited;
//   - the edited submit reuses the saved id only after the server says the
//     saved request never committed; committed or unknown refuses, sends nothing;
//   - the saved job survives when its replacement cannot be stored;
//   - Create Post refuses to restore when the restore mark cannot be stored.
//
// Fully offline: the gateway is answered here and can be told to drop the
// connection. Fixture names only; this repo is public.

const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const SLUG = 'savedfixture', NAME = 'Saved Fixture';
const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

async function harness(browser, port, { staff } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  // committed: the server already holds rows under the saved request id.
  // readFail: the commit check cannot be answered.
  const net = { drop: false, intake: [], beacons: [], committed: false, readFail: false, checks: 0 };
  // The staff seed goes FIRST: routes added later win, and this file's own
  // gateway answer must win over the seed's stub-key write refusal. Its
  // key-verify answer is kept by falling back to it.
  if (staff) await seedStaffGate(context);
  await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), async route => {
    const url = new URL(route.request().url());
    if (/functions\/v1\/key-verify/.test(url.pathname)) return route.fallback();
    if (/functions\/v1\/production-write/.test(url.pathname)) {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.operation === 'intake_create') {
        net.intake.push(body);
        if (net.drop) return route.abort('failed');
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
          ok: true, native_committed: true, mirror_pending: false, batch: { id: 'batch-' + body.request_id },
          items: body.items.map((item, item_index) => ({ item_index, id: 'd-' + item_index + '-' + body.request_id, team: item.team, card_id: item.card_id })),
        }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (/functions\/v1\/write-diagnostics/.test(url.pathname)) { net.beacons.push(route.request().postData() || ''); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    if (/calendar-upsert/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (/\/rest\/v1\/(deliverables|batches)$/.test(url.pathname) && /(^|&)select=id(&|$)/.test(url.search.slice(1))) {
      net.checks++;
      if (net.readFail) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: net.committed ? '[{"id":"x"}]' : '[]' });
    }
    if (url.pathname.endsWith('/clients')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ slug: SLUG, display_name: NAME, kind: 'client', active: true }]) });
    if (url.pathname.endsWith('/syncview_runtime_flags')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'write_ui_reroute_clients', value: { clients: [SLUG] } }]) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  return { context, page, net, errors };
}

const saved = page => page.evaluate(() => { const j = _linearIntakeRead(); return j ? { rid: j.payload.request_id, surface: j.payload.surface } : null; });
const status = page => page.evaluate(() => (document.getElementById('linearStatus') || {}).textContent || '');
const box = page => page.evaluate(() => { const b = document.getElementById('linearSavedBox'); return b ? b.innerText : ''; });
async function fillSubmit(page, link) {
  await page.waitForSelector('#linearClientSearch');
  await page.evaluate(([n, s]) => {
    selectLinearProject(n, s);
    Array.from(document.querySelectorAll('[id^="videoCard_"]')).slice(1).forEach(card => card.remove());
    renumberVideoCards(); linearVideoCount = 1; saveLinearForm();
  }, [NAME, SLUG]);
  await page.locator('#vid_main_1').fill(link);
}
async function submit(page) {
  await page.locator('#linearSubmitBtnVideo').click();
  await page.waitForFunction(() => !document.querySelector('#linearSubmitBtnVideo[disabled]'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
}
// The stuck state: the first send loses its connection, then a DIFFERENT form.
async function getStuck(page, net, port) {
  await page.goto(`http://127.0.0.1:${port}/intake`);
  net.drop = true;
  await fillSubmit(page, 'https://drive.invalid/first');
  await submit(page);
  await fillSubmit(page, 'https://drive.invalid/second');
  await submit(page);
  net.drop = false;
}

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    // 1. Stuck state shown, and the refusal logged.
    {
      const { context, page, net, errors } = await harness(browser, port);
      await getStuck(page, net, port);
      const text = await box(page);
      check(/saved in this browser/.test(text) && text.includes(NAME) && /1 video/.test(text) && /saved /.test(text),
        'the stuck state is shown: a box names the client, the count and when it was saved');
      check(/Restore it/.test(text) && /Send it as it was/.test(text) && /Discard it/.test(text), 'the box offers Restore it, Send it as it was and Discard it');
      check(/box at the top/.test(await status(page)), 'the refused submit points at the box instead of a dead end');
      const diag = await page.evaluate(() => peekWriteUiQueueDiagnostics());
      check(diag.some(row => row.outcome === 'ui_write_failure' && /native_intake_pending_conflict/.test(row.code)), 'the refusal is in the save-problems log');
      check(net.beacons.length > 0 && net.beacons.every(b => !b.includes(SLUG) && !b.includes(NAME)), 'the logged refusal carries no client name or slug');
      check(net.intake.length === 1, 'nothing reached the server while it was blocked (one attempt, the dropped one)');
      check(!errors.length, 'no page errors: ' + errors.join(' | '));
      await context.close();
    }
    // 2. Restore: fills the form; the edited submit replaces it; one batch identity.
    {
      const { context, page, net } = await harness(browser, port);
      await getStuck(page, net, port);
      const before = await saved(page);
      await page.click('#linearSavedBox >> text=Restore it');
      await page.waitForTimeout(500);
      check(await page.evaluate(() => document.getElementById('vid_main_1').value) === 'https://drive.invalid/first', 'Restore it fills the form with the saved submission');
      check(/back in the form/.test(await box(page)), 'the box says the saved one is back in the form and will be replaced');
      await page.locator('#vid_main_1').fill('https://drive.invalid/edited');
      await submit(page);
      const sent = net.intake.slice(1);
      check(sent.length === 1 && sent[0].request_id === before.rid, 'the edited submit is sent once, under the saved request id');
      check(new Set(net.intake.map(b => b.request_id)).size === 1, 'exactly one batch identity ever reached the gateway (no second batch)');
      check(/drive\.invalid\/edited/.test(sent[0] && sent[0].items[0].brief || ''), 'what was sent is the edited form');
      check(!(await saved(page)) && !(await box(page)), 'the saved copy is gone once the edited one is created');
      await context.close();
    }
    // 3. Send it as it was.
    {
      const { context, page, net } = await harness(browser, port);
      await getStuck(page, net, port);
      const before = await saved(page);
      await page.click('#linearSavedBox >> text=Send it as it was');
      await page.waitForFunction(() => !_linearIntakeRead(), null, { timeout: 10000 }).catch(() => {});
      const last = net.intake[net.intake.length - 1];
      check(net.intake.length === 2 && last.request_id === before.rid && /drive\.invalid\/first/.test(last.items[0].brief), 'Send it as it was sends the saved request unchanged');
      check(!(await saved(page)), 'and it is no longer saved afterwards');
      await context.close();
    }
    // 4. Discard, then a fresh submission works.
    {
      const { context, page, net } = await harness(browser, port);
      await getStuck(page, net, port);
      const before = await saved(page);
      await page.click('#linearSavedBox >> text=Discard it');
      await page.waitForTimeout(400);
      check(!(await saved(page)) && !(await box(page)) && /discarded/.test(await status(page)), 'Discard it (after the confirm) removes the saved submission');
      check(net.intake.length === 1, 'discarding sends nothing');
      await fillSubmit(page, 'https://drive.invalid/fresh');
      await submit(page);
      const last = net.intake[net.intake.length - 1];
      check(net.intake.length === 2 && last.request_id !== before.rid && !(await saved(page)), 'a fresh submission works afterwards');
      await context.close();
    }
    // 5. The public link retries a saved submission by itself on page load.
    {
      const { context, page, net } = await harness(browser, port);
      await page.goto(`http://127.0.0.1:${port}/intake`);
      net.drop = true;
      await fillSubmit(page, 'https://drive.invalid/first');
      await submit(page);
      net.drop = false;
      await page.reload();
      await page.waitForFunction(() => !_linearIntakeRead(), null, { timeout: 15000 }).catch(() => {});
      check(net.intake.length === 2 && !(await saved(page)), 'on the public link, a saved submission is sent by itself when the page loads');
      await context.close();
    }
    // 7. A restored job is never sent in the background while it is edited.
    {
      const { context, page, net } = await harness(browser, port);
      await getStuck(page, net, port);
      const before = await saved(page);
      await page.click('#linearSavedBox >> text=Restore it');
      await page.waitForTimeout(400);
      await page.evaluate(async () => {
        await _writeUiResumePublicIntake('resume').catch(() => {});
        await _writeUiResumePublicIntake('online').catch(() => {});
        await (_resumeNativeIntakeJob('resume') || Promise.resolve()).catch(() => {});
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      await page.waitForTimeout(1200);
      check(net.intake.length === 1 && (await saved(page) || {}).rid === before.rid, 'a restored job is not sent in the background (focus, online, resume)');
      await page.locator('#vid_main_1').fill('https://drive.invalid/edited');
      await submit(page);
      check(net.intake.length === 2 && new Set(net.intake.map(b => b.request_id)).size === 1 && /edited/.test(net.intake[1].items[0].brief),
        'after the pause, the edited submit is the only thing sent, under the saved id');
      await context.close();
    }
    // 8. The saved request already committed: the edit is never sent under its id.
    {
      const { context, page, net } = await harness(browser, port);
      await getStuck(page, net, port);
      const before = await saved(page);
      await page.click('#linearSavedBox >> text=Restore it');
      await page.waitForTimeout(400);
      net.committed = true;
      await page.locator('#vid_main_1').fill('https://drive.invalid/edited');
      await submit(page);
      check(net.checks > 0, 'the server is asked before the saved id is reused');
      check(net.intake.length === 1, 'committed on the server: the edited payload is not sent');
      check(/already went through/.test(await status(page)), 'the person is told it already went through and how to finish it');
      const job = await page.evaluate(() => _linearIntakeRead());
      check(job && job.payload.request_id === before.rid && job.replace_on_submit !== true && /first/.test(job.payload.items[0].brief),
        'the saved job is kept unchanged and no longer marked for replacement');
      await page.click('#linearSavedBox >> text=Send it as it was');
      await page.waitForFunction(() => !_linearIntakeRead(), null, { timeout: 10000 }).catch(() => {});
      check(net.intake.length === 2 && /first/.test(net.intake[1].items[0].brief), 'it can still be finished as it was');
      await context.close();
    }
    // 8b. The server cannot answer: refuse, send nothing, keep the job.
    {
      const { context, page, net } = await harness(browser, port);
      await getStuck(page, net, port);
      await page.click('#linearSavedBox >> text=Restore it');
      await page.waitForTimeout(400);
      net.readFail = true;
      await page.locator('#vid_main_1').fill('https://drive.invalid/edited');
      await submit(page);
      check(net.intake.length === 1 && /could not confirm/.test(await status(page)) && !!(await saved(page)),
        'commit state unknown: nothing is sent and the saved job is kept');
      net.readFail = false;
      await submit(page);
      check(net.intake.length === 2 && /edited/.test(net.intake[1].items[0].brief), 'once the server answers, the edit goes through');
      await context.close();
    }
    // 9. The replacement cannot be stored: the saved job survives.
    {
      const { context, page, net } = await harness(browser, port);
      await getStuck(page, net, port);
      const before = await saved(page);
      await page.click('#linearSavedBox >> text=Restore it');
      await page.waitForTimeout(400);
      await page.locator('#vid_main_1').fill('https://drive.invalid/' + 'x'.repeat(40));
      await page.evaluate(() => {
        const real = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === NATIVE_INTAKE_PENDING_KEY && /drive\.invalid\/x{40}/.test(value)) throw new DOMException('full', 'QuotaExceededError');
          return real.call(this, key, value);
        };
      });
      await submit(page);
      const job = await page.evaluate(() => _linearIntakeRead());
      check(net.intake.length === 1, 'nothing is sent when the replacement cannot be stored');
      check(job && job.payload.request_id === before.rid && /drive\.invalid\/first/.test(job.payload.items[0].brief),
        'the saved submission is still there, unchanged, when its replacement could not be stored');
      await context.close();
    }
    // 6. Calendar Create Post: shown, restore, send, discard, fresh.
    const openCreatePost = async page => {
      await page.goto(`http://127.0.0.1:${port}/workload`);
      await page.waitForFunction(() => typeof currentNav === 'string' && currentNav === 'workload', null, { timeout: 20000 });
      await page.evaluate(async n => { calState.client = n; calState.posts = []; await _calOpenNativePost(); }, NAME);
      await page.waitForSelector('#calNativePostCreate', { timeout: 10000 });
    };
    const createPost = async page => { await page.click('#calNativePostCreate'); await page.waitForTimeout(1200); };
    const stuckPost = async (page, net) => {
      await openCreatePost(page);
      net.drop = true;
      await createPost(page);                       // saved, connection dropped
      await page.evaluate(() => { _calNativePostState.postCount = 2; _calRenderNativePostChoice(); });
      await createPost(page);                       // different post: blocked
      net.drop = false;
    };
    const postBox = page => page.evaluate(() => { const b = document.getElementById('calNativeSavedBox'); return b ? b.innerText : ''; });
    {
      const { context, page, net, errors } = await harness(browser, port, { staff: true });
      await stuckPost(page, net);
      const text = await postBox(page);
      check(/saved in this browser/.test(text) && /Restore it/.test(text) && /Send it as it was/.test(text) && /Discard it/.test(text), 'Create Post: the stuck state is shown with the three ways out');
      check(/box at the top/.test(await page.evaluate(() => document.getElementById('calNativePostError').textContent)), 'Create Post: the refusal points at the box');
      const rid = (await saved(page)).rid;
      await page.click('#calNativeSavedBox >> text=Restore it');
      await page.waitForTimeout(300);
      check(await page.evaluate(() => _calNativePostState.postCount) === 1, 'Create Post: Restore it puts the saved post back in the window');
      await page.evaluate(() => { _calNativePostState.postCount = 3; _calRenderNativePostChoice(); });
      await createPost(page);
      check(net.intake.length === 2 && net.intake[1].request_id === rid && new Set(net.intake.map(b => b.request_id)).size === 1,
        'Create Post: the edited post replaces the saved one under the same request id (one batch)');
      check(!(await saved(page)), 'Create Post: nothing is left saved afterwards');
      check(!errors.length, 'no page errors: ' + errors.join(' | '));
      await context.close();
    }
    {
      const { context, page, net } = await harness(browser, port, { staff: true });
      await stuckPost(page, net);
      const rid = (await saved(page)).rid;
      await page.click('#calNativeSavedBox >> text=Send it as it was');
      await page.waitForFunction(() => !_linearIntakeRead(), null, { timeout: 10000 }).catch(() => {});
      check(net.intake.length === 2 && net.intake[1].request_id === rid && !(await saved(page)), 'Create Post: Send it as it was sends the saved post');
      await context.close();
    }
    {
      const { context, page, net } = await harness(browser, port, { staff: true });
      await stuckPost(page, net);
      await page.click('#calNativeSavedBox >> text=Discard it');
      await page.waitForTimeout(300);
      check(!(await saved(page)) && !(await postBox(page)), 'Create Post: Discard it removes the saved post');
      await createPost(page);
      check(net.intake.length === 2 && !(await saved(page)), 'Create Post: a fresh post works afterwards');
      await context.close();
    }
    // 10. Create Post refuses to restore when the mark cannot be stored.
    {
      const { context, page, net } = await harness(browser, port, { staff: true });
      await stuckPost(page, net);
      await page.evaluate(() => {
        const real = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === NATIVE_INTAKE_PENDING_KEY && /"replace_on_submit":true/.test(value)) throw new DOMException('full', 'QuotaExceededError');
          return real.call(this, key, value);
        };
      });
      await page.click('#calNativeSavedBox >> text=Restore it');
      await page.waitForTimeout(400);
      const job = await page.evaluate(() => _linearIntakeRead());
      check(await page.evaluate(() => _calNativePostState.postCount) === 2, 'Create Post: the window is left as it was when the restore mark cannot be stored');
      check(/could not be restored/.test(await page.evaluate(() => (document.getElementById('calNativeSavedStatus') || {}).textContent || '')), 'Create Post: the person is told it could not be restored');
      check(job && job.replace_on_submit !== true, 'Create Post: the saved post is not left half-marked');
      check(net.intake.length === 1, 'Create Post: nothing was sent');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`saved-submission: ${failures.length} failed`); process.exit(1); }
  console.log('saved-submission: PASS');
})().catch(e => { console.error(e); process.exit(1); });
