'use strict';
/*
 * rename-sync-browser.js — the browser side of release 1 of the card/sub-issue
 * rename (OPEN_REPAIRS 242), on the real built index.html, fully mocked.
 *
 *   1. Client view: the card name is read-only, and the input handlers refuse a
 *      rename even when called directly (Collab mode on). A blank card the
 *      client is creating can still be named.
 *   2. Staff: a saved rename nudges the background drain; a save that does not
 *      touch the name does not.
 *   3. Staff: the "name syncing" marker shows while the rename is pending, clears
 *      when it lands, and after a give-up shows "Name didn't sync · Retry",
 *      whose Retry re-queues exactly that rename and nudges the drain.
 *   4. The marker and the nudge never block or fail the save: with every
 *      rename endpoint failing, the save still succeeds.
 *
 * No network leaves the machine: every non-local request is answered here.
 */
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const full = path.join(root, path.normalize(file));
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': full.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function mockBackend(page, state) {
  return page.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.href), async route => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/rpc/rename_propagation_poke')) {
      state.pokes++;
      return state.failAll ? json({ message: 'down' }, 503) : json({ done: 1 });
    }
    if (url.pathname.endsWith('/rpc/rename_propagation_retry')) {
      state.retries.push(JSON.parse(route.request().postData() || '{}'));
      return state.failAll ? json({ message: 'down' }, 503) : json(true);
    }
    if (url.pathname.endsWith('/rename_propagation_status_v1')) {
      state.statusReads++;
      if (state.failAll) return json({ message: 'down' }, 503);
      const next = state.statusQueue.length > 1 ? state.statusQueue.shift() : state.statusQueue[0];
      return json(next ? [next] : []);
    }
    if (/calendar-upsert/.test(url.pathname)) {
      const body = JSON.parse(route.request().postData() || '{}');
      state.saves.push(body);
      const post = body.post || {};
      return json({ ok: true, post: { id: post.id, updated_at: new Date().toISOString() } });
    }
    if (url.pathname.endsWith('/functions/v1/key-verify')) {
      return json({ ok: true, role: 'admin', member: { id: 'qa_staff', name: 'QA Staff', role: 'admin', team: null } });
    }
    if (url.pathname.includes('/rest/v1/')) return json([]);
    if (url.hostname.includes('cdn') || url.hostname.includes('fonts')) return route.abort();
    return json({ ok: true });
  });
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ok  ' + msg); };
  try {
    // ── 1. Client view ─────────────────────────────────────────────────
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await mockBackend(page, { pokes: 0, retries: [], statusReads: 0, statusQueue: [], saves: [] });
      await page.goto(base + '?c=qa-client&t=qa-token&v=calendar', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof _calTitleRowHtml === 'function' && typeof _calOnFieldInput === 'function');
      const r = await page.evaluate(() => {
        window._calIsCollabOn = () => true; // the mode that used to allow client renames
        const html = _calTitleRowHtml('k1', { id: 'k1', name: 'Stored' }, true, true);
        const blankHtml = _calTitleRowHtml('__blank__1', { id: '__blank__1', name: '' }, false, true);
        const input = { dataset: { pid: 'k1', fld: 'name' }, value: 'Client rename' };
        _calOnFieldInput(input);
        _calOnFieldBlur(input);
        const caption = { dataset: { pid: 'k1', fld: 'caption' }, value: 'Client caption' };
        _calOnFieldInput(caption);
        return {
          isClient: _isClientLink,
          readonly: /data-fld="name"[^>]*readonly/.test(html),
          blankReadonly: /data-fld="name"[^>]*readonly/.test(blankHtml),
          marker: /data-name-sync=/.test(html),
          nameQueued: !!(_calPendingEdits.k1 && 'name' in _calPendingEdits.k1),
          captionQueued: !!(_calPendingEdits.k1 && _calPendingEdits.k1.caption === 'Client caption'),
        };
      });
      ok(r.isClient, 'client link detected');
      ok(r.readonly, 'client: card name is read-only');
      ok(!r.blankReadonly, 'client: a new blank card can still be named');
      ok(!r.marker, 'client: no name-syncing marker');
      ok(!r.nameQueued, 'client: a direct handler call cannot queue a rename');
      ok(r.captionQueued, 'client Collab: other text fields still edit');
      await page.close();
    }

    // ── 2-4. Staff ──────────────────────────────────────────────────────
    const state = { pokes: 0, retries: [], statusReads: 0, statusQueue: [], saves: [], failAll: false };
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedStaffGate(page);
    await mockBackend(page, state);
    await page.goto(base + '#calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _calFlushCardSave === 'function' && typeof calState === 'object');
    await page.evaluate(() => {
      calState.client = calState.client || 'qa-client';
      const host = document.createElement('div');
      host.innerHTML = _calTitleRowHtml('k1', { id: 'k1', name: 'Old' }, false) + _calTitleRowHtml('k2', { id: 'k2', name: 'Old' }, false);
      document.body.appendChild(host);
      calState.posts.push({ id: 'k1', name: 'Old', video_deliverable_id: 'd1', graphic_deliverable_id: 'g1' });
      calState.posts.push({ id: 'k2', name: 'Old', video_deliverable_id: 'd2' });
    });
    const marker = (pid) => page.evaluate((p) => {
      const el = document.querySelector(`[data-name-sync="${p}"]`);
      return el ? { hidden: el.hidden, text: el.textContent, cls: el.className } : null;
    }, pid);
    const readonlyStaff = await page.evaluate(() => /data-fld="name"[^>]*readonly/.test(_calTitleRowHtml('k9', { id: 'k9', name: 'x' }, false)));
    ok(!readonlyStaff, 'staff: card name stays editable');

    // A render with no rename made by this page reads nothing (boot, BFCache
    // restore and forced-meta renders must stay free of this traffic).
    await page.evaluate(() => _calNameSyncScheduleRefresh());
    await page.waitForTimeout(700);
    ok(state.statusReads === 0, 'render without a rename from this page makes no status read');

    // 2. A rename save nudges the drain; the marker shows, then clears.
    state.statusQueue = [{ id: 11, source_id: 'k1', state: 'pending' }, { id: 11, source_id: 'k1', state: 'done' }];
    const saved = await page.evaluate(async () => {
      _calPendingEdits.k1 = { name: 'New name' };
      await _calFlushCardSave('k1');
      return calState.posts.find(p => p.id === 'k1')._saveError || '';
    });
    ok(state.saves.length === 1 && state.saves[0].post && state.saves[0].post.name === 'New name', 'staff rename saved through calendar-upsert');
    ok(!saved, 'staff rename save reports no error');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-name-sync="k1"]');
      return el && !el.hidden && /syncing/.test(el.textContent);
    }, null, { timeout: 5000 });
    ok(state.pokes >= 1, 'staff rename nudges the drain');
    ok(true, 'marker shows "Name syncing…" while pending');
    await page.waitForFunction(() => document.querySelector('[data-name-sync="k1"]').hidden, null, { timeout: 10000 });
    ok(true, 'marker clears once the rename lands');
    const readsSettled = state.statusReads;
    await page.evaluate(() => _calNameSyncScheduleRefresh());
    await page.waitForTimeout(700);
    ok(state.statusReads === readsSettled, 'after the rename settles, later renders read nothing');

    // A save that does not touch the name does not nudge.
    const pokesBefore = state.pokes;
    await page.evaluate(async () => { _calPendingEdits.k2 = { caption: 'Only the caption' }; await _calFlushCardSave('k2'); });
    await page.waitForTimeout(600);
    ok(state.pokes === pokesBefore, 'a non-name save does not nudge the drain');

    // 3. Give-up shows Retry; Retry re-queues that rename and nudges.
    state.statusQueue = [{ id: 42, source_id: 'k2', state: 'failed' }];
    await page.evaluate(() => _calNameSyncRefresh(['k2']));
    const failed = await marker('k2');
    ok(failed && !failed.hidden && /didn.t sync/.test(failed.text) && /Retry/.test(failed.text), 'failed rename shows "Name didn’t sync · Retry"');
    const ring = await page.evaluate(() => (window.peekWriteUiQueueDiagnostics() || []).filter(r => r.outcome === 'rename_propagation_failed').length);
    ok(ring === 1, 'give-up is written to the local WR-101 ring once');
    await page.evaluate(() => _calNameSyncRefresh(['k2']));
    const ring2 = await page.evaluate(() => (window.peekWriteUiQueueDiagnostics() || []).filter(r => r.outcome === 'rename_propagation_failed').length);
    ok(ring2 === 1, 'repainting does not log it again');
    state.statusQueue = [{ id: 43, source_id: 'k2', state: 'pending' }, { id: 43, source_id: 'k2', state: 'done' }];
    const pokesBeforeRetry = state.pokes;
    await page.click('[data-name-sync="k2"] .cal-name-sync-retry');
    await page.waitForFunction(() => document.querySelector('[data-name-sync="k2"]').hidden, null, { timeout: 10000 });
    ok(state.retries.length === 1 && state.retries[0].p_id === 42, 'Retry re-queues exactly the failed rename');
    ok(state.pokes > pokesBeforeRetry, 'Retry nudges the drain');

    // 4. Every rename endpoint down: the save still succeeds, nothing throws.
    state.failAll = true;
    const outage = await page.evaluate(async () => {
      _calPendingEdits.k1 = { name: 'Rename during outage' };
      await _calFlushCardSave('k1');
      await new Promise(r => setTimeout(r, 800));
      return calState.posts.find(p => p.id === 'k1')._saveError || '';
    });
    ok(!outage && state.saves[state.saves.length - 1].post.name === 'Rename during outage', 'save succeeds with every rename endpoint failing');
    const hidden = await marker('k1');
    ok(hidden && hidden.hidden, 'unreadable status shows no marker rather than a wrong one');
    ok(!errors.some(e => /rename|NameSync|renameProp/i.test(e)), 'no page errors from the rename code');

    // ── 5. SyncLinear: rename a sub-issue (release 2) ─────────────────────
    {
      const prodState = { pokes: 0, retries: [], statusReads: 0, statusQueue: [], saves: [], writes: [] };
      const prod = await browser.newPage();
      const prodErrors = [];
      prod.on('pageerror', e => prodErrors.push(e.message));
      await seedStaffGate(prod);
      // Registered before the specific route: Playwright tries the LAST route first.
      await mockBackend(prod, prodState);
      await prod.route('**/functions/v1/production-write', async route => {
        const body = JSON.parse(route.request().postData() || '{}');
        prodState.writes.push(body);
        // A real save takes time; the page must not show a blank title meanwhile.
        if (prodState.delayMs) await new Promise(r => setTimeout(r, prodState.delayMs));
        if (prodState.refuse) {
          await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'write_conflict' }) });
          return;
        }
        const title = body.name ? 'Video 4 — ' + body.name : 'Video 4';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          ok: true, native_committed: true, row: { id: body.id, title, updated_at: '2026-09-23T12:00:01Z' } }) });
      });
      await prod.goto(base + '?prod=1', { waitUntil: 'domcontentloaded' });
      await prod.waitForFunction(() => typeof _prodDetailTitleHtml === 'function' && typeof _prodRoleCanWrite === 'function');

      // Role gate: the browser offers exactly what the gateway accepts.
      const roles = await prod.evaluate(() => {
        const issue = { id: 'd4', team: 'video' };
        const as = (role, team, owns) => {
          window._syncviewStaffIdentityForHeaders = () => ({ role, member: { team } });
          window._prodCreativeOwnsTarget = () => owns;
          return _prodRoleCanWrite(issue, 'title');
        };
        return {
          admin: as('admin', '', false), smm: as('smm', '', false),
          editorOwn: as('creative', 'video', true), editorOther: as('creative', 'video', false),
          editorWrongTeam: as('creative', 'graphics', true),
        };
      });
      ok(roles.admin && roles.smm, 'SyncLinear: admins and SMMs can rename');
      ok(roles.editorOwn, 'SyncLinear: an editor can rename their own assigned sub-issue');
      ok(!roles.editorOther && !roles.editorWrongTeam, 'SyncLinear: an editor cannot rename others or another team');

      // The control: prefix fixed, name editable, Enter saves through `title`.
      await prod.evaluate(() => {
        window.__issue = { id: 'd4', team: 'video', title: 'Video 4 — Old name', updatedRaw: '2026-09-23T12:00:00Z',
          authorityProject: 'qa-client', project: 'qa-client' };
        window._prodIssue = (id) => (id === 'd4' ? window.__issue : null);
        window._prodCanWrite = (issue, op) => op === 'title';
        window.__toasts = [];
        window._prodToast = (m) => window.__toasts.push(m);
        // Like the real page: a render rebuilds the heading from the STORED
        // title, which stays the old one until the gateway answers.
        window.__renders = 0;
        window._prodRender = () => {
          window.__renders++;
          const h = document.getElementById('rename-host');
          if (h && !h.querySelector('input')) h.innerHTML = _prodDetailTitleHtml(window.__issue);
        };
        const host = document.createElement('div');
        host.id = 'rename-host';
        host.innerHTML = _prodDetailTitleHtml(window.__issue);
        document.body.appendChild(host);
      });
      ok(await prod.evaluate(() => !!document.querySelector('#rename-host [data-prod-title-edit="d4"]')), 'SyncLinear: title is editable for a permitted user');
      await prod.click('#rename-host [data-prod-title-edit="d4"]');
      const edit = await prod.evaluate(() => {
        const el = document.querySelector('#rename-host [data-prod-title-edit="d4"]');
        return { prefix: (el.querySelector('.prod-title-prefix') || {}).textContent, value: el.querySelector('input').value };
      });
      ok(edit.prefix === 'Video 4 — ' && edit.value === 'Old name', 'SyncLinear: the number is fixed and only the name is edited');
      await prod.fill('#rename-host input', '  New   name ');
      await prod.press('#rename-host input', 'Enter');
      await prod.waitForFunction(() => window.__toasts.length > 0);
      const w = prodState.writes[0] || {};
      ok(prodState.writes.length === 1 && w.operation === 'title' && w.surface === 'production' && w.entity === 'deliverable'
        && w.id === 'd4' && w.name === 'New name' && w.expected_updated_at === '2026-09-23T12:00:00Z',
        'SyncLinear: Enter saves {operation: title, name} with the row clock');
      await prod.waitForTimeout(300);
      ok(prodState.pokes >= 1, 'SyncLinear: a saved rename nudges the drain so the card follows');

      ok(await prod.evaluate(() => window.__issue.title === 'Video 4 — New name'), 'SyncLinear: the open issue keeps the saved title');
      await prod.evaluate(() => { window.__issue.title = 'Video 4 — Old name'; });
      // Refusals happen before any request.
      const before = prodState.writes.length;
      const tryName = async (value, key) => {
        await prod.evaluate(() => { const h = document.getElementById('rename-host'); h.innerHTML = _prodDetailTitleHtml(window.__issue); });
        await prod.click('#rename-host [data-prod-title-edit="d4"]');
        await prod.fill('#rename-host input', value);
        await prod.press('#rename-host input', key);
        await prod.waitForTimeout(200);
      };
      await tryName('x'.repeat(161), 'Enter');
      await tryName('Old name', 'Escape');
      await tryName('Old name', 'Enter');
      await prod.evaluate(() => { window.__issue.title = 'Promo clip'; });
      await tryName('Video 7', 'Enter');
      ok(prodState.writes.length === before, 'SyncLinear: too long, Escape, unchanged and numbered-looking names send nothing');
      ok(await prod.evaluate(() => window.__toasts.some(t => /too long/.test(t)) && window.__toasts.some(t => /numbered/.test(t))),
        'SyncLinear: refusals say why');
      // ── Optimistic title: never blank while saving; rollback on refusal ──
      const heading = () => prod.evaluate(() => {
        const el = document.querySelector('#rename-host [data-prod-title-edit="d4"]');
        return el ? { text: el.textContent, saving: el.classList.contains('is-saving') } : null;
      });
      const sampleDuringSave = async (value) => {
        await prod.evaluate(() => {
          window.__issue.title = 'Video 4 — Old name';
          const h = document.getElementById('rename-host'); h.innerHTML = _prodDetailTitleHtml(window.__issue);
        });
        await prod.click('#rename-host [data-prod-title-edit="d4"]');
        await prod.fill('#rename-host input', value);
        // Click out, as the owner did, and sample the heading from that very
        // moment: synchronously right after the blur, then on every frame.
        await prod.evaluate(() => {
          const read = () => {
            const el = document.querySelector('#rename-host [data-prod-title-edit="d4"]');
            return el ? (el.querySelector('input') ? '<input:' + el.textContent + '>' : el.textContent) : '<missing>';
          };
          window.__frames = [];
          window.__sampling = true;
          document.querySelector('#rename-host input').blur();
          window.__frames.push(read());
          const tick = () => { window.__frames.push(read()); if (window.__sampling) requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        });
        const mid = await heading();
        await prod.waitForTimeout(prodState.delayMs + 400);
        const frames = await prod.evaluate(() => { window.__sampling = false; return window.__frames; });
        return { mid, frames, end: await heading() };
      };
      prodState.delayMs = 900;
      prodState.refuse = false;
      const good = await sampleDuringSave('Fresh name');
      if (process.env.RENAME_DEBUG) console.log('DEBUG', JSON.stringify(good.mid), JSON.stringify(good.frames.slice(0, 4)), JSON.stringify(good.end));
      ok(good.mid && good.mid.text === 'Video 4 — Fresh name' && good.mid.saving,
        'optimistic: the new title, prefix and all, shows the moment you click out, with a saving hint');
      ok(good.frames.length > 10 && good.frames.every(t => t === 'Video 4 — Fresh name'),
        'optimistic: no blank (or old) frame at any point while the save is in flight (' + good.frames.length + ' frames)');
      ok(good.end && good.end.text === 'Video 4 — Fresh name' && !good.end.saving, 'optimistic: the saved title stays, hint gone');
      ok(await prod.evaluate(() => window.__renders > 0), 'optimistic: the page re-rendered during the save and still held the new title');

      prodState.refuse = true;
      const bad = await sampleDuringSave('Refused name');
      ok(bad.mid && bad.mid.text === 'Video 4 — Refused name', 'rollback: the new title shows while saving');
      ok(!bad.frames.some(t => !t || t === '<missing>'), 'rollback: never blank, even on the refusal path');
      ok(bad.end && bad.end.text === 'Video 4 — Old name' && !bad.end.saving, 'rollback: a refused save puts the old title back');
      ok(await prod.evaluate(() => window.__toasts.length > 0 && !/Renamed/.test(window.__toasts[window.__toasts.length - 1])),
        'rollback: the refusal is explained, not reported as success');
      prodState.refuse = false;
      prodState.delayMs = 0;

      ok(!prodErrors.some(e => /rename|Title|prodTitle/i.test(e)), 'SyncLinear: no page errors from the rename control');
      await prod.close();
    }

    console.log('rename-sync-browser: ' + n + ' checks passed ✅');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
