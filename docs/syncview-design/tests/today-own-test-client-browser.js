'use strict';

// Today: a staff member's OWN test client (owner request 2026-10-26).
// A test client (clients.kind = 'test') that the signed-in person's roster
// row lists shows for them on Today (chips and rows) and in the dropdown's
// "My clients", like a real client. Another SMM who does not list it, and an
// admin who is not on the roster ("all clients"), never see it. Rule 1 still
// holds: it must be in Clients Info. Fully offline: every non-local request
// is refused, and the page's reads go to a stubbed fetch with fictional
// fixtures (OPEN_REPAIRS 511).

const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');

const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => route.abort());
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _tdyLoad === 'function' && typeof _tdySmmHtml === 'function' && typeof svOwnTestClients === 'function');
    const r = await page.evaluate(async () => {
      const today = _tdyIso(_tdyDays(1));
      const now = new Date().toISOString();
      const clients = [
        { slug: 'real-fixture', display_name: 'Real Fixture', active: true, kind: 'client' },
        { slug: 'other-fixture', display_name: 'Other Fixture', active: true, kind: 'client' },
        { slug: 'test-fixture', display_name: 'Test Fixture', active: true, kind: 'test' },
        { slug: 'stray-test-fixture', display_name: 'Stray Test Fixture', active: true, kind: 'test' }   // listed, but not in Clients Info
      ];
      const managers = [
        { slug: 'tess', name: 'Tess Smm', email: 'tess@example.test', active: true, source_clients: ['Real Fixture', 'Test Fixture', 'Stray Test Fixture'] },
        { slug: 'robin', name: 'Robin Smm', email: 'robin@example.test', active: true, source_clients: ['Other Fixture'] }
      ];
      const emails = { m1: 'tess@example.test', m2: 'robin@example.test', m3: 'boss@example.test' };
      const del = (id, slug) => ({ id, client_slug: slug, team: 'video', kind: 'video', title: 'Item ' + id, status: 'smm_approval', status_at: now, assignee_id: null, due_date: today, origin: 'calendar', card_id: null, linear_issue_uuid: null });
      const post = (id, slug) => ({ id, client: slug, name: 'Post ' + id, scheduled_date: today, status: 'Draft', video_status: 'Kasper Approval', graphic_status: null, caption: '', asset_url: null, thumbnail_url: null, video_deliverable_id: null, graphic_deliverable_id: null });
      const deliverables = [del('d-real', 'real-fixture'), del('d-other', 'other-fixture'), del('d-test', 'test-fixture')];
      const posts = [post('p-real', 'real-fixture'), post('p-test', 'test-fixture')];
      let who = 'm1';
      window.fetch = async (url) => {
        const u = decodeURIComponent(String(url));
        let body = [];
        if (u.includes('/rest/v1/clients?')) body = clients;
        else if (u.includes('/rest/v1/team_members?')) body = [{ email: emails[who] }];
        else if (u.includes('production_deliverables_browser_v1') && u.includes('smm_approval') && !u.includes('raw_issue_parent_id')) body = deliverables;
        else if (u.includes('/rest/v1/calendar_posts?') && !u.includes('caption_status') && !u.includes('deliverable_id.in')) body = posts;
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      };
      _srpState.managers = managers; _srpState.managersLoaded = true; _tdyAlsoSees = [];
      const roles = { m1: ['Tess Smm', 'smm'], m2: ['Robin Smm', 'smm'], m3: ['Boss Admin', 'admin'] };
      _syncviewStaffIdentityForHeaders = () => ({ key: 'k', role: roles[who][1], member: { id: who, name: roles[who][0], role: roles[who][1], team: 'smm' } });
      const fill = names => { Object.keys(clientMap).forEach(k => { delete clientMap[k]; }); names.forEach(n => { clientMap[n] = { client_name: n }; }); };
      const run = async (id) => {
        who = id; _tdyEmailReading = null; _tdyClientRows = null;
        const me = _tdyIdentity();
        const data = await _tdyLoad(me);
        const host = document.createElement('div');
        host.id = 'tdyRoot'; host.className = 'tdy';
        document.body.innerHTML = '<div id="content"></div>';
        document.getElementById('content').appendChild(host);
        tdyState.job = 'approve';
        host.innerHTML = _tdySmmHtml(me, data, 'Rings');
        const text = host.textContent;
        const dropdown = await tdyMyClientNames();
        return {
          own: (data.mine.own || []).map(c => c.name), mode: data.mine.mode,
          rows: [...host.querySelectorAll('.tdy-rw .tdy-tt')].map(n => n.textContent),
          showsTest: text.includes('Test Fixture'),
          dropdown: dropdown.names,
          provisional: data.provisional
        };
      };
      fill(['Real Fixture', 'Other Fixture', 'Test Fixture']);   // Clients Info: the stray test client is not in it
      const out = { tess: await run('m1'), robin: await run('m2'), admin: await run('m3') };
      // The clients-table stand-in (Clients Info not loaded yet): same answer for Tess.
      fill([]);
      who = 'm1'; _tdyEmailReading = null; _tdyClientRows = null;
      const v = await _tdyVisibleClients(_tdyIdentity(), clients);
      out.standIn = { own: v.own, provisional: !!v.provisional, testKey: v.keys.has(svClientKey('Test Fixture')) };
      return out;
    });

    check(r.tess.mode === 'mine' && r.tess.own.join() === 'Real Fixture,Test Fixture', 'Tess (lists the test client): her chips show her real and her test client (' + r.tess.own.join() + ')');
    check(r.tess.rows.includes('Item d-test') && r.tess.rows.includes('Item d-real') && !r.tess.rows.includes('Item d-other'), 'Tess: the test client\'s work shows in To approve beside her real client\'s, nobody else\'s (' + r.tess.rows.join() + ')');
    check(r.tess.dropdown.slice().sort().join() === 'Real Fixture,Test Fixture', 'Tess: the dropdown\'s "My clients" agrees with Today (' + r.tess.dropdown.join() + ')');
    check(!r.tess.own.includes('Stray Test Fixture') && !r.tess.dropdown.includes('Stray Test Fixture'), 'rule 1: a listed test client missing from Clients Info never shows');
    check(!r.robin.showsTest && !r.robin.rows.includes('Item d-test') && r.robin.dropdown.join() === 'Other Fixture', 'Robin (does not list it): never sees the test client (' + r.robin.rows.join() + ')');
    check(r.admin.mode === 'all' && !r.admin.rows.includes('Item d-test') && !r.admin.showsTest, 'an admin not on the roster ("all clients") never sees the test client (' + r.admin.rows.join() + ')');
    check(r.admin.rows.includes('Item d-real') && r.admin.rows.includes('Item d-other'), 'the admin still sees every real client');
    check(r.standIn.provisional && r.standIn.testKey && r.standIn.own.includes('Test Fixture'), 'before Clients Info loads, the clients-table stand-in gives Tess the same own test client');
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`today-own-test-client: ${failures.length} failed`); process.exit(1); }
  console.log('today-own-test-client: PASS');
})().catch(e => { console.error(e); process.exit(1); });
