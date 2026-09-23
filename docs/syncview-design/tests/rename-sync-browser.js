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

    console.log('rename-sync-browser: ' + n + ' checks passed ✅');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
