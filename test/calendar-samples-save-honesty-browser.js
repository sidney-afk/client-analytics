'use strict';
/* calendar-samples-save-honesty-browser.js -- three saves that used to fail or
 * misfire without telling anyone, in a real browser, fully offline.
 *
 *   T1  Samples: an archive the server refuses (HTTP 200, {"ok":false}) put the
 *       sample back with no message, or counted as done. It must say "Archive
 *       failed", put the sample back, and park no work items.
 *   T2  Samples: an edit queued behind a save, then a client switch. The queued
 *       edit was inserted as a new sample under the client now on screen. It
 *       must be held for its own client and saved there on return.
 *   T3  Calendar, Month view: a reschedule (drag to another day) whose save
 *       fails left the post on the new day with no sign of trouble. It must go
 *       back to its day and say "Date not saved".
 *
 * Two made-up clients; every backend answer is local. No request leaves the
 * machine. Fixture names only.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const A = { name: 'Fixture Alpha', slug: 'fixturealpha' };
const B = { name: 'Fixture Beta', slug: 'fixturebeta' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const row = (id, slug, name, extra) => Object.assign({
  id, client: slug, name, status: 'In Progress', order_index: 1, updated_at: '2026-09-20T12:00:00.000Z',
  scheduled_date: '2026-10-03', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: '', cta: '', thumbnail_url: '', asset_url: '', video_deliverable_id: '', graphic_deliverable_id: '',
  linear_issue_id: '', graphic_linear_issue_id: '', comments: [], graphic_comments: [], caption_comments: [],
}, extra || {});

async function open(browser, origin, kind, behave) {
  const table = kind === 'sxr' ? 'sample_reviews' : 'calendar_posts';
  const state = {
    rows: { [A.slug]: [row(kind === 'sxr' ? 's1' : 'a1', A.slug, 'Alpha item')], [B.slug]: [row(kind === 'sxr' ? 't1' : 'b1', B.slug, 'Beta item')] },
    writes: [], gateway: [],
  };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (r.method() === 'POST' && (p === '/functions/v1/calendar-upsert' || p === '/functions/v1/sample-review-upsert')) {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      const patch = body.post || body.sample || {};
      state.writes.push({ client: body.client, id: patch.id, patch, raw: r.postData() || '' });
      if (behave.delay) await sleep(behave.delay);
      if (behave.fail === 'http') return json({ ok: false, error: 'card write refused' }, 500);
      if (behave.fail === 'refuse-archive' && patch.status === 'Archived') return json({ ok: false, _conflict: true, id: patch.id, error: 'Could not read the stored row. Nothing was saved.' });
      const list = state.rows[body.client] || (state.rows[body.client] = []);
      let found = list.find(x => x.id === patch.id);
      if (!found) { found = Object.assign({ client: body.client }, patch); list.push(found); } else Object.assign(found, patch);
      found.updated_at = new Date().toISOString();
      return json({ ok: true, post: found, sample: found });
    }
    if (r.method() === 'POST' && p === '/functions/v1/production-write') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      state.gateway.push(body);
      return json({ ok: true, native_committed: true });
    }
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([A, B].map(c => ({ slug: c.slug, display_name: c.name, active: true, kind: 'video' })));
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [A.slug, B.slug] } : { enabled: false }) })));
    }
    if (p === '/rest/v1/' + table) {
      const slug = String(sp.get('client') || '').replace(/^eq\./, '');
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      return json((state.rows[slug] || []).filter(x => x.status !== 'Archived' && (!one || x.id === one)));
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await page.goto(kind === 'sxr' ? `${origin}/index.html?v=sample-reviews&sxr=1` : `${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function' && typeof _sxrSavePins === 'function', null, { timeout: 30000 });
  await page.evaluate(({ kind, names }) => {
    _syncviewStaffIdentityVerified = true;
    if (kind === 'sxr') { _sxrSavePins(names); sxrState.client = names[0]; navTo('sample-reviews'); }
    else { _calSavePins(names); calState.client = names[0]; navTo('calendar'); }
  }, { kind, names: [A.name, B.name] });
  await page.waitForSelector(`.cal-card[data-pid="${kind === 'sxr' ? 's1' : 'a1'}"]`, { timeout: 20000 });
  const notice = () => page.evaluate(() => { const o = document.getElementById('confirmOverlay'); return o && o.classList.contains('active') ? (document.getElementById('confirmTitle').textContent || '') : ''; });
  const yes = () => page.evaluate(() => { const o = document.getElementById('confirmOverlay'); if (o && o.classList.contains('active')) document.getElementById('confirmYes').click(); });
  return { page, ctx, state, pageErrors, notice, yes, behave };
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---- T1: Samples archive refused with HTTP 200 {"ok":false} --------------
    console.log('--- T1: Samples archive the server refuses ---');
    let t = await open(browser, origin, 'sxr', { fail: 'refuse-archive' });
    await t.page.evaluate(() => archiveSxrCard('s1'));
    expect(/Archive this sample/.test(await t.notice()), 'T1: archiving asks first');
    await t.yes();
    await sleep(1800);
    expect(/Archive failed/i.test(await t.notice()), 'T1: a refused archive says "Archive failed" (' + (await t.notice()) + ')');
    await t.yes();
    await sleep(600);
    expect(await t.page.locator('.cal-card[data-pid="s1"]').count() === 1, 'T1: the sample is back in the list');
    expect(t.state.gateway.length === 0, 'T1: no work item was parked for an archive that did not happen');
    expect(t.pageErrors.length === 0, 'T1: no page errors (' + t.pageErrors.join(' | ') + ')');
    await t.ctx.close();

    // ---- T2: Samples edit queued behind a save, then a client switch ---------
    console.log('--- T2: Samples edit queued behind a save, then the client switched ---');
    t = await open(browser, origin, 'sxr', { delay: 1500 });
    await t.page.evaluate(() => { _sxrPendingEdits.s1 = { name: 'First' }; _sxrFlushCardSave('s1'); });
    await sleep(250);
    expect(t.state.writes.length === 1, 'T2: the first save is in flight');
    await t.page.evaluate(name => { _sxrPendingEdits.s1 = { name: 'First and second' }; _sxrFlushCardSave('s1'); onSxrClientChange(name); }, B.name);
    await t.page.waitForSelector('.cal-card[data-pid="t1"]', { timeout: 20000 });
    await sleep(2600);
    expect(t.state.writes.filter(w => w.client === B.slug).length === 0, 'T2: nothing was written to the client the view moved to');
    expect(!t.state.rows[B.slug].some(x => x.id === 's1'), 'T2: the other client did not gain a sample');
    expect(/not saved yet/i.test(await t.notice()), 'T2: the person is told the edit is not saved yet (' + (await t.notice()) + ')');
    await t.yes();
    await t.page.evaluate(name => onSxrClientChange(name), A.name);
    await t.page.waitForSelector('.cal-card[data-pid="s1"]', { timeout: 20000 });
    await sleep(3600);
    expect(t.state.rows[A.slug].find(x => x.id === 's1').name === 'First and second', 'T2: coming back saves the queued edit on its own sample');
    expect(t.state.writes.filter(w => w.client === B.slug).length === 0, 'T2: and still nothing went to the other client');
    expect(t.pageErrors.length === 0, 'T2: no page errors (' + t.pageErrors.join(' | ') + ')');
    await t.ctx.close();

    // ---- T3: Calendar Month view, a reschedule whose save fails --------------
    console.log('--- T3: Calendar reschedule whose save fails ---');
    t = await open(browser, origin, 'cal', {});
    await t.page.evaluate(() => onCalViewChange('month'));
    await sleep(500);
    t.behave.fail = 'http';
    await t.page.evaluate(() => _calMovePostToDate('a1', '2026-10-10'));
    await sleep(2500);
    expect(/Date not saved/i.test(await t.notice()), 'T3: a failed reschedule says "Date not saved" (' + (await t.notice()) + ')');
    await t.yes();
    const dateNow = await t.page.evaluate(() => String((calState.posts.find(p => p.id === 'a1') || {}).scheduled_date || '').slice(0, 10));
    expect(dateNow === '2026-10-03', 'T3: the post is back on the day it was on (' + dateNow + ')');
    expect(t.state.rows[A.slug][0].scheduled_date === '2026-10-03', 'T3: and the stored date never changed');
    t.behave.fail = '';
    await t.page.evaluate(() => _calMovePostToDate('a1', '2026-10-11'));
    await sleep(2500);
    expect(t.state.rows[A.slug][0].scheduled_date === '2026-10-11' && !(await t.notice()), 'T3: a reschedule that saves still saves, with no notice');
    expect(t.pageErrors.length === 0, 'T3: no page errors (' + t.pageErrors.join(' | ') + ')');
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' check(s) failed'); process.exit(1); }
  console.log('\ncalendar-samples-save-honesty-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
