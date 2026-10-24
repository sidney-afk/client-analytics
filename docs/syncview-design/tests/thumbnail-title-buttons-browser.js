'use strict';
/*
 * Thumbnail titles from the filming plan, in the browser (session Titlecard, 2026-10-23, OPEN_REPAIRS 481).
 *
 * Fully mocked: the page is served from this checkout, every network call is answered here, and the
 * thumbnail-titles function is a small fake that walks a run through its stages. Fictional data only.
 *
 * What it proves:
 *   1. The switch: with thumbnail_title_buttons_staff naming the signed-in person, the post shows
 *      "Thumbnail titles" on the right of its Sub-issues header, and a thumbnail sub-issue shows
 *      "Write title" beside Edit. With the switch not naming them, neither is drawn.
 *   2. A teammate's run already going: the button says "Being written by <first name>", and pressing it
 *      follows that run (no second run is started).
 *   3. A whole batch: Waiting on every thumbnail row at once, then each row's own state (a title written,
 *      a description that waits for review, a failed row), a toast that stays until it is all finished,
 *      the review sheet with Keep mine, Try again on the failed row, and Undo.
 *
 * Run: node docs/syncview-design/tests/thumbnail-title-buttons-browser.js   (TT_SHOTS=<dir> saves pictures)
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
const shots = process.env.TT_SHOTS || '';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function expect(value, message) { if (!value) throw new Error('thumbnail-title-buttons: ' + message); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function launch() {
  try { return await chromium.launch({ headless: true }); }
  catch (e) { return await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' }); }
}

async function runCase(listed) {
  const now = '2026-10-20T12:00:00.000Z';
  const clients = [{ slug: 'demo-fixture', display_name: 'Demo Fixture', active: true, kind: 'video', linear_project_ids: [{ id: 'linear-project-demo' }] }];
  const members = [{ id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics', active: true }];
  const base = { client_slug: 'demo-fixture', raw_project_id: 'linear-project-demo', status: 'todo', status_at: now, assignee_id: null, due_date: null, created_at: now, updated_at: now };
  const deliverables = [
    { ...base, id: 'post-parent', identifier: 'GRA-POST', linear_issue_uuid: 'linear-post', team: 'graphics', title: 'October batch', brief: 'Four videos.' },
    { ...base, id: 'vid-1', identifier: 'VID-1', linear_issue_uuid: 'linear-vid-1', raw_issue_parent_id: 'linear-post', team: 'video', title: 'Video 1 — Morning routine' },
    { ...base, id: 'th-1', identifier: 'GRA-1', linear_issue_uuid: 'linear-th-1', raw_issue_parent_id: 'linear-post', team: 'graphics', title: 'Thumbnail 1 — Morning routine', brief: '' },
    { ...base, id: 'th-2', identifier: 'GRA-2', linear_issue_uuid: 'linear-th-2', raw_issue_parent_id: 'linear-post', team: 'graphics', title: 'Thumbnail 2 — Pantry swaps', brief: 'Big text: jars on a shelf' },
    { ...base, id: 'th-3', identifier: 'GRA-3', linear_issue_uuid: 'linear-th-3', raw_issue_parent_id: 'linear-post', team: 'graphics', title: 'Thumbnail 3 — A work day', brief: '' },
  ];
  const flagStaff = listed ? { staff: ['admin'] } : null;

  // ---- the fake thumbnail-titles function -------------------------------------------------------
  const calls = [];
  let run = null;          // the one run this fake knows about
  let statusTicks = 0;
  const item = (id, state, extra) => Object.assign({ deliverable_id: id, state, outcome: null, message: null, video_number: Number(id.slice(-1)), title: null, before: null, after: null }, extra || {});
  const payload = () => ({ ok: true, run: run && run.run, items: run ? run.items : [] });
  function seedTeammateRun() {
    run = { run: { id: 'ttr_teammate', run_key: 'post:post-parent', state: 'running', stage: 'writing', requested_by: 'Sam Other', tab_name: 'October', tab_choices: [{ id: 't.oct', name: 'October', videos: 4 }, { id: 't.sep', name: 'September', videos: 6 }], created_at: now },
      items: [item('th-1', 'building'), item('th-2', 'building'), item('th-3', 'building')], script: 'teammate' };
    statusTicks = 0;
  }
  function advance() {
    statusTicks++;
    if (!run) return;
    if (run.script === 'teammate' && statusTicks >= 2) {
      run.run = { ...run.run, state: 'done', stage: 'finished', finished_at: new Date().toISOString() };
      run.items = [item('th-1', 'done', { title: 'Mornings that work', message: 'Mornings that work' }), item('th-2', 'kept', { message: 'Kept yours' }), item('th-3', 'done', { title: 'A day at work', message: 'A day at work' })];
      run.finishedTeammate = true;
    }
    if (run.script === 'mine') {
      if (statusTicks === 1) {
        run.run = { ...run.run, state: 'running', stage: 'writing', tab_name: 'October' };
        run.items = run.items.map(it => ({ ...it, state: 'building' }));
      } else if (statusTicks === 2) {
        run.items = [item('th-1', 'done', { title: 'Mornings that work', message: 'Mornings that work' }), item('th-2', 'building'), item('th-3', 'building')];
      } else if (statusTicks >= 3 && run.run.state !== 'done') {
        run.run = { ...run.run, state: 'done', stage: 'finished', finished_at: new Date().toISOString() };
        run.items = [
          item('th-1', 'done', { title: 'Mornings that work', message: 'Mornings that work' }),
          item('th-2', 'review', { outcome: 'human', title: 'Three pantry swaps', message: 'Three pantry swaps', before: 'Big text: jars on a shelf', after: 'Thumbnail title (generated by AI, from the October plan): Three pantry swaps' }),
          item('th-3', 'failed', { outcome: 'generation_failed', message: 'The AI did not answer' }),
        ];
      }
    }
    if (run.script === 'retry' && statusTicks >= 1 && run.run.state !== 'done') {
      run.run = { ...run.run, state: 'done', stage: 'finished', finished_at: new Date().toISOString() };
      run.items = run.items.map(it => it.deliverable_id === 'th-3' ? item('th-3', 'done', { title: 'A day at work', message: 'A day at work' }) : it);
    }
  }
  async function fakeTitles(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const body = JSON.parse(req.postData() || '{}');
    const headers = req.headers();
    calls.push({ action: body.action, body, actor: headers['x-syncview-actor'], key: headers['x-syncview-key'] });
    const reply = obj => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (!headers['x-syncview-key']) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'credentials_required' }) });
    if (body.client !== 'demo-fixture') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'wrong client' }) });
    if (body.action === 'status') { advance(); return reply(payload()); }
    if (body.action === 'run') {
      if (run && ['queued', 'running', 'ask'].includes(run.run.state)) return reply({ ...payload(), following: true });
      run = { run: { id: 'ttr_mine', run_key: body.run_key, state: 'queued', stage: 'reading', requested_by: 'Browser Admin', tab_choices: [{ id: 't.oct', name: 'October', videos: 4 }, { id: 't.sep', name: 'September', videos: 6 }], created_at: new Date().toISOString() },
        items: body.items.map(id => item(id, 'waiting')), script: 'mine' };
      statusTicks = 0;
      return reply({ ...payload(), following: false });
    }
    if (body.action === 'decide') {
      const it = run.items.find(x => x.deliverable_id === body.deliverable_id);
      if (body.choice === 'keep') Object.assign(it, { state: 'kept', outcome: 'kept', message: 'Kept yours' });
      if (body.choice === 'undo') Object.assign(it, { state: 'kept', outcome: 'undone', message: 'Undone' });
      return reply({ ...payload(), result: body.choice === 'keep' ? 'ok' : 'written' });
    }
    if (body.action === 'retry') {
      run.items = run.items.map(it => it.state === 'failed' ? item(it.deliverable_id, 'waiting') : it);
      run.run = { ...run.run, state: 'queued', stage: 'reading', finished_at: null };
      run.script = 'retry';
      statusTicks = 0;
      return reply(payload());
    }
    return reply(payload());
  }

  const server = await serve();
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await seedStaffGate(page);
  await page.route('**/functions/v1/key-verify', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, role: 'admin', member: members[0] }) }));
  await page.route('**/functions/v1/filming-plans**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, plans: [] }) }));
  await page.route('**/functions/v1/production-comments', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ comments: [], next_cursor: null, has_more: false, canonical_thread: true }) }));
  await page.route('**/functions/v1/thumbnail-titles', fakeTitles);
  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    let rows = [];
    if (table === 'clients') rows = clients;
    else if (table === 'team_members') rows = members;
    else if (table === 'syncview_runtime_flags') {
      const raw = String(url.searchParams.get('key') || '');
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map(s => s.trim()) : [raw.replace(/^eq\./, '')];
      rows = keys.filter(k => k !== 'client_comment_gateway_enabled').map(key => {
        if (key === 'thumbnail_title_buttons_staff') return flagStaff ? { key, value: flagStaff } : null;
        if (key === 'write_ui_reroute_clients' || key === 'calendar_upsert_ef_clients') return { key, value: { clients: ['demo-fixture'] } };
        if (/^review_|^kasper_|^workload_|^analytics_/.test(key)) return null;
        return { key, value: { video: 'syncview', graphics: 'syncview' } };
      }).filter(Boolean);
    } else if (table === 'deliverables' || table === 'production_deliverables_browser_v1') {
      const idFilter = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
      rows = idFilter ? deliverables.filter(r => r.id === idFilter) : deliverables;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.route('**/functions/v1/production-write', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const reply = obj => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (body.action === 'description_read') {
      const row = deliverables.find(r => r.id === body.id);
      return reply({ ok: true, complete: true, row: row ? { id: row.id, client_slug: row.client_slug, team: row.team, brief: row.brief || null, updated_at: row.updated_at } : null });
    }
    if (body.action === 'asset_access_read') {
      return reply({ ok: true, complete: true, assets: ['filming_plan', 'raw_footage', 'delivery_folder', 'deliverable_file'].map(slot => ({ slot, state: 'missing', url: null })) });
    }
    if (body.action === 'labels_read') return reply({ ok: true, complete: true, authority: 'syncview', catalog: [], label_ids: [] });
    return reply({ ok: true, complete: true });
  });

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-prod-row="th-1"], [data-prod-row="post-parent"]', { timeout: 20000 });
    await page.evaluate(() => {
      _syncviewStaffIdentitySave({ key: 'browser-role-key', role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
      _syncviewStaffIdentityVerified = true;
      _prodRender();
    });
    await page.waitForFunction(() => typeof svRsFlagsLoaded === 'function' && svRsFlagsLoaded(), null, { timeout: 15000 });

    if (!listed) {
      await page.evaluate(() => _prodOpenDeliverable('post-parent'));
      await page.waitForSelector('[data-prod-section="subissues"]', { timeout: 15000 });
      expect(await page.locator('[data-prod-tt-btn]').count() === 0, 'the batch button was drawn for someone the switch does not list');
      await page.evaluate(() => _prodOpenDeliverable('th-1'));
      await page.waitForSelector('[data-prod-description="th-1"]', { timeout: 15000 });
      expect(await page.locator('[data-prod-tt-descbtn]').count() === 0, 'Write title was drawn for someone the switch does not list');
      expect(!calls.length, 'the page called thumbnail-titles while switched off');
      console.log('  off: no buttons, no calls');
      return;
    }

    // 2. A teammate's run is already going for this post.
    seedTeammateRun();
    await page.evaluate(() => _prodOpenDeliverable('post-parent'));
    await page.waitForSelector('[data-prod-tt-btn="post-parent"] button', { timeout: 15000 });
    await page.waitForFunction(() => /Being written by Sam/.test((document.querySelector('[data-prod-tt-btn="post-parent"]') || {}).textContent || ''), null, { timeout: 15000 });
    await page.locator('[data-prod-tt-btn="post-parent"] button').click();
    expect(!calls.some(c => c.action === 'run'), 'pressing during a teammate\'s run started a second run');
    if (shots) await page.screenshot({ path: path.join(shots, 'tt-teammate.png') });
    await page.waitForFunction(() => !/Being written/.test((document.querySelector('[data-prod-tt-btn="post-parent"]') || {}).textContent || ''), null, { timeout: 20000 });
    console.log('  teammate: followed, no second run');

    // 3. My own run over the whole post.
    run = null;
    await page.evaluate(() => { for (const k of Object.keys(_prodTt.runs)) delete _prodTt.runs[k]; _prodTt.toastKey = ''; _prodTtPaint(); });
    await page.waitForFunction(() => /Thumbnail titles/.test((document.querySelector('[data-prod-tt-btn="post-parent"]') || {}).textContent || ''), null, { timeout: 10000 });
    await page.locator('[data-prod-tt-btn="post-parent"] button').click();
    // Waiting on every thumbnail row at once, and the toast is up before the server answers twice.
    await page.waitForFunction(() => ['th-1', 'th-2', 'th-3'].every(id => document.querySelector('[data-prod-tt-chip="' + id + '"] .prod-tt-chip')), null, { timeout: 5000 });
    expect(await page.locator('[data-prod-tt-chip="vid-1"]').count() === 0, 'a video row got a thumbnail chip');
    expect(await page.locator('#prodTtToast').count() === 1, 'no toast while the run started');
    const runCall = calls.find(c => c.action === 'run');
    expect(runCall && runCall.body.items.join(',') === 'th-1,th-2,th-3' && runCall.body.run_key === 'post:post-parent' && runCall.actor === 'Browser Admin', 'the run request did not name the three thumbnails of the post: ' + JSON.stringify(runCall && runCall.body));
    // A second press while it runs never starts another run.
    await page.locator('[data-prod-tt-btn="post-parent"] button').click();
    expect(calls.filter(c => c.action === 'run').length === 1, 'a second press started a second run');
    await page.waitForSelector('[data-prod-tt-chip="th-1"] .prod-tt-chip.is-building, [data-prod-tt-chip="th-1"] .prod-tt-chip.is-done', { timeout: 10000 });
    await page.waitForFunction(() => /October/.test((document.getElementById('prodTtToast') || {}).textContent || ''), null, { timeout: 10000 });
    if (shots) await page.screenshot({ path: path.join(shots, 'tt-building.png') });
    await page.waitForSelector('[data-prod-tt-chip="th-3"] .prod-tt-chip.is-failed', { timeout: 15000 });
    expect(await page.locator('[data-prod-tt-chip="th-1"] .prod-tt-chip.is-done').textContent().then(t => /Mornings that work/.test(t)), 'the written title is not on its row');
    expect(await page.locator('[data-prod-tt-chip="th-2"] .prod-tt-chip.is-review').count() === 1, 'the row with a person\'s text does not wait for review');
    const toastDone = await page.locator('#prodTtToast').textContent();
    expect(/1 title written/.test(toastDone) && /1 needs your OK/.test(toastDone) && /1 failed/.test(toastDone), 'the finished toast does not sum it up: ' + toastDone);
    await sleep(9000);
    expect(await page.locator('#prodTtToast').count() === 1, 'the toast left while a row still needs a person');
    if (shots) await page.screenshot({ path: path.join(shots, 'tt-finished.png') });

    // Review: Keep mine is first, and keeping writes nothing but the row's state.
    await page.locator('#prodTtToast .prod-tt-a', { hasText: 'Review 1' }).click();
    await page.waitForSelector('#prodTtSheet .prod-tt-compare', { timeout: 5000 });
    const firstChoice = await page.locator('#prodTtSheet .prod-tt-a').first().textContent();
    expect(firstChoice.trim() === 'Keep mine', 'Keep mine is not the first choice: ' + firstChoice);
    expect(/jars on a shelf/.test(await page.locator('#prodTtSheet').textContent()), 'the review does not show what is there now');
    if (shots) await page.screenshot({ path: path.join(shots, 'tt-review.png') });
    await page.keyboard.press('Escape');
    expect(await page.locator('#prodTtSheet').count() === 0, 'Escape did not close the review');
    await page.locator('#prodTtToast .prod-tt-a', { hasText: 'Review 1' }).click();
    await page.waitForSelector('#prodTtSheet', { timeout: 5000 });
    await page.mouse.click(640, 200);
    expect(await page.locator('#prodTtSheet').count() === 0, 'a click outside did not close the review');
    await page.locator('#prodTtToast .prod-tt-a', { hasText: 'Review 1' }).click();
    await page.locator('#prodTtSheet .prod-tt-a', { hasText: 'Keep mine' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-prod-tt-chip="th-2"] .prod-tt-chip.is-review'), null, { timeout: 5000 });
    expect(calls.some(c => c.action === 'decide' && c.body.choice === 'keep' && c.body.deliverable_id === 'th-2'), 'Keep mine was not sent');
    await page.locator('#prodTtSheet .prod-tt-a', { hasText: 'Done' }).click();

    // Try again on the failed row: same run, and it lands.
    await page.locator('#prodTtToast .prod-tt-a', { hasText: 'Try again' }).click();
    await page.waitForSelector('[data-prod-tt-chip="th-3"] .prod-tt-chip.is-done', { timeout: 15000 });
    expect(calls.some(c => c.action === 'retry' && c.body.all === true && c.body.run_id === 'ttr_mine'), 'Try again did not retry the failed rows of the same run');

    // Undo every written title.
    await page.waitForSelector('#prodTtToast', { timeout: 5000 });
    await page.evaluate(() => _prodTtShowToast('post:post-parent'));
    await page.locator('#prodTtToast .prod-tt-a', { hasText: /^Undo/ }).click();
    await page.waitForFunction(() => !document.querySelector('[data-prod-tt-chip] .prod-tt-chip.is-done'), null, { timeout: 8000 });
    expect(calls.filter(c => c.action === 'decide' && c.body.choice === 'undo').length === 2, 'Undo did not undo both written titles');

    // The sub-issue: "Write title" beside Edit.
    await page.evaluate(() => _prodOpenDeliverable('th-1'));
    await page.waitForSelector('[data-prod-description="th-1"] [data-prod-tt-descbtn="th-1"] button', { timeout: 15000 });
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-prod-description="th-1"] .prod-description-actions button')].map(b => b.textContent.trim()));
    expect(order.join('|') === 'Write title|Edit', 'Write title is not beside Edit: ' + order.join('|'));
    if (shots) await page.screenshot({ path: path.join(shots, 'tt-subissue.png') });
    expect(!pageErrors.length, 'page errors: ' + pageErrors.join(' | '));
    console.log('  on: batch run, review, retry, undo, sub-issue button');
  } finally {
    await browser.close();
    server.close();
  }
}

(async () => {
  await runCase(false);
  await runCase(true);
  console.log('thumbnail-title-buttons-browser: passed');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
