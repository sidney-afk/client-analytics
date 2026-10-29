'use strict';
/*
 * TRIAL REELS ON THE EDITOR'S TODAY (session Trials, 2026-10-29, the Supervisor's question on #2434).
 * With the owner's choice (a), a change asked on one version keeps the card in its review stage while other versions
 * wait, so the video sub-issue keeps its review status and Today's tweak list (todo, in progress, tweak) never saw it.
 * The version itself is "change asked" in trial-reels: the editor's Today now lists that sub-issue with the tweaks,
 * "changes asked on Video B", and drops it again once the new cut is in (the version back to waiting).
 * Fully offline: the switch read and trial-reels' list are answered here; everything else is refused.
 */
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true });
  const T = { versions: [{ letter: 'A', status: 'approved' }, { letter: 'B', status: 'change asked' }, { letter: 'C', status: 'waiting' }], calls: [] };
  try {
    for (const width of [1100, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => route.abort());
      await context.route('**/rest/v1/syncview_runtime_flags*', route => {
        const u = new URL(route.request().url());
        const raw = u.searchParams.get('key') || '';
        const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
        const rows = keys.map(k => ({ key: k, value: k === 'trial_reels_pages' ? { clients: ['fixtureclient'] } : /_clients$/.test(k) ? { clients: [] } : { enabled: false } }));
        return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
      });
      await context.route('**/functions/v1/trial-reels', route => {
        const r = route.request();
        if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
        const b = JSON.parse(r.postData() || '{}');
        T.calls.push(b);
        const cards = b.client === 'fixtureclient' ? { p_trial: { enabled: true, winner_letter: null, versions: T.versions.map(v => Object.assign({}, v)) } } : {};
        return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, cards }) });
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof _tdyEditorHtml === 'function' && typeof _tdyTrialAsks === 'function', null, { timeout: 20000 }).catch(() => {});
      const run = () => page.evaluate(async () => {
        if (typeof _tdyTrialAsks !== 'function') return { missing: true };
        const row = (id, extra) => Object.assign({ id, client_slug: 'fixtureclient', team: 'video', kind: 'video', title: 'Trial card ' + id, status: 'client_approval', status_at: new Date().toISOString(), assignee_id: 'ed1', due_date: null, origin: 'calendar', card_id: 'p_trial', linear_issue_uuid: null }, extra);
        const rows = [row('d1'), row('d2', { card_id: 'p_other' }), row('d3', { client_slug: 'otherclient' }), row('d4', { team: 'graphics' })];
        const asks = await _tdyTrialAsks(rows);
        const host = document.createElement('div');
        host.id = 'tdyRoot'; host.className = 'tdy';
        document.body.innerHTML = ''; document.body.appendChild(host);
        host.innerHTML = _tdyEditorHtml({ first: 'Casey', editor: true }, { names: { fixtureclient: 'Fixture client' }, open: asks, done: [], urgent: [] }, 'List');
        const r = [...host.querySelectorAll('.tdy-rw')].map(n => n.innerText.replace(/\s+/g, ' ').trim());
        return { ids: asks.map(a => a.id), status: asks.map(a => a.status), rows: r };
      });
      let out = await run();
      ok(!out.missing && out.ids.join() === 'd1' && out.status.join() === 'tweak', `${width}: only the review-stage video sub-issue whose trial card has a version asked to change is the editor's work (${JSON.stringify(out.ids)})`);
      ok(out.rows && out.rows.length === 1 && /changes asked on Video B/.test(out.rows[0]), `${width}: Today's row says "changes asked on Video B" (${JSON.stringify(out.rows)})`);
      T.versions[1].status = 'waiting';   // the new cut is in
      out = await page.evaluate(async () => (await _tdyTrialAsks([{ id: 'd1', client_slug: 'fixtureclient', team: 'video', status: 'client_approval', origin: 'calendar', card_id: 'p_trial' }])).length).catch(() => -1);
      ok(out === 0, `${width}: once the new cut is in, it leaves the list (${out})`);
      T.versions[1].status = 'change asked';
      await context.close();
    }
  } catch (e) { failures.push('threw: ' + (e && e.stack || e)); console.error(e); }
  finally { await browser.close(); server.close(); }
  console.log(`trial-reels-today-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
