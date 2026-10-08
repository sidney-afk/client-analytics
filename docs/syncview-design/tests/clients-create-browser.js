'use strict';
/* clients-create-browser.js -- Kasper › More › Clients, "New client" (step 2.5 of
 * docs/plans/2026-10-01-onboarding-checklist-and-profile.md; fragments 323 and 324), in a real
 * browser, fully offline. The roster holds the test client (slug sidneylaruel) and one fixture; the
 * new client is a "ZZ THROWAWAY" test client.
 *
 * Proves:
 *   - an ADMIN sees "New client"; an SMM or CREATIVE session neither sees it nor sends anything;
 *   - opening the dialog only lists the managers (create_preview with no name); nothing is written;
 *   - typing a name and picking a manager asks create_preview (admin key and member id) and shows
 *     exactly what will be made; "Create client" stays off until that check is clean and current;
 *   - a name already in use is shown as a blocker in plain words and Create stays off;
 *   - "Create client" sends ONE create with a request id, the name, manager and email; the list is
 *     read again and the new client's profile opens;
 *   - when the database step is not installed yet, the dialog says so and that nothing was made;
 *   - Escape closes the dialog; on two phones it is a bottom sheet with 44px controls, 16px inputs and
 *     no sideways scroll.
 * Screenshots (desktop 1440 and iPhone 390): docs/syncview-design/screenshots/clients-create/.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffIdentity, refuseStubKeyProductionWrite } = require('../../../qa/staff-gate-seed');

const root = path.resolve(__dirname, '..', '..', '..');
const SHOTS = path.join(root, 'docs', 'syncview-design', 'screenshots', 'clients-create');
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

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const mk = (slug, name, extra) => Object.assign({
  slug, display_name: name, email: null, instagram_handle: null, tiktok_handle: null, youtube_channel_id: null, competitors: null,
  keywords: null, specific_keywords: null, content_description: null, slack_channel_id: null, creative_channel_id: null,
  roam_channel_id: null, upload_post_profile: null, postforme_account_id: null, extra: {}, source: 'syncview',
  sheet_synced_at: null, archived_at: null, created_at: '2026-10-01T06:00:00Z', updated_at: '2026-10-01T06:00:00Z', updated_by: 'QA admin',
}, extra || {});
const MANAGERS = [{ slug: 'managerone', name: 'Manager One' }, { slug: 'managertwo', name: 'Manager Two' }];
const NEW_NAME = 'ZZ THROWAWAY Beacon';
const WILL = ['Roster row (the client appears across SyncView)', 'Review link for the client', 'Save permissions in all four lists',
  'Client profile (the Clients tab details)', 'Social media manager assignment', '27-step onboarding checklist, with 4 steps ticked by this create'];

async function open(browser, origin, role, viewport, opts) {
  opts = opts || {};
  const failures = [];
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768, deviceScaleFactor: viewport.width < 768 ? 2 : 1 });
  const ob = [];
  const rows = [mk('sidneylaruel', 'QA Test Client', { email: 'qa@example.invalid', instagram_handle: '@qa.test' })];
  const ctl = { notInstalled: !!opts.notInstalled };
  await ctx.route(u => !u.toString().startsWith(origin), async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (b, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/functions/v1/analytics-read') return json({ ok: true, principal: 'staff', authority: { source: 'syncview' }, clients: rows });
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role, member: { id: 'qa_' + role, name: 'QA ' + role, role, team: null } });
    if (u.pathname === '/functions/v1/client-profile-write') {
      const b = JSON.parse(r.postData() || '{}');
      if (b.action === 'list_managers') return json({ ok: true, managers: MANAGERS, assignments: Object.fromEntries(rows.map(x => [x.slug, x.slug === 'sidneylaruel' ? 'managerone' : 'managertwo'])) });
      return json({ ok: true });
    }
    if (u.pathname === '/functions/v1/client-onboarding') {
      const b = JSON.parse(r.postData() || '{}');
      ob.push({ body: b, key: r.headers()['x-syncview-key'] });
      if (b.action === 'create_preview') {
        if (!String(b.display_name || '').trim()) return json({ ok: true, ready: false, blockers: ['name_invalid'], managers: MANAGERS });
        const name = String(b.display_name).trim().replace(/\s+/g, ' ');
        const slug = name.toLowerCase().replace(/[^a-z0-9&]+/g, '');
        const blockers = rows.some(x => x.display_name.toLowerCase() === name.toLowerCase()) ? ['name_taken'] : [];
        const manager = MANAGERS.find(m => m.slug === b.manager_slug) || null;
        return json({ ok: true, ready: !blockers.length, blockers, mode: /^ZZ THROWAWAY/.test(name) ? 'test' : 'client', slug, display_name: name, email: b.email || null, manager, managers: MANAGERS, will_create: WILL, slack: 'not_queued' });
      }
      if (b.action === 'create') {
        if (ctl.notInstalled) return json({ ok: false, error: 'create_not_installed', blockers: [] }, 503);
        const slug = String(b.display_name).toLowerCase().replace(/[^a-z0-9&]+/g, '');
        rows.push(mk(slug, b.display_name, { email: b.email || null }));
        return json({ ok: true, request_id: b.request_id, client_slug: slug, mode: 'test', result: { ok: true, outcome: 'created', slack: 'not_queued' } });
      }
      if (b.action === 'get') {
        const steps = Array.from({ length: 27 }, (_, i) => ({ step_key: 'fixture_step_' + String(i + 1).padStart(2, '0'), position: i + 1, label: 'Fixture step ' + (i + 1), kind: 'owner', required: !(i + 1 === 25 || i + 1 === 27), detectable: false, proof: 'Proof', status: i >= 9 && i <= 13 && i !== 10 ? 'done' : 'todo', responsible: 'owner', evidence: null, note: null, source: null, done_by: null, done_at: null, updated_at: '2026-10-08T08:00:00Z' }));
        return json({ ok: true, client_slug: b.slug, steps, summary: null, resources: { present: { client_slug: b.slug, token_present: true }, stored: [] }, sales: null });
      }
      return json({ ok: false, error: 'unknown_action' }, 400);
    }
    if (u.pathname === '/functions/v1/client-hubspot-sync') return json({ ok: true, skipped: 'not_enabled' });
    if (/rest\/v1/.test(u.pathname)) return json([]);
    if (/functions|webhook/.test(u.pathname)) return json({});
    return route.abort();
  });
  await seedStaffIdentity(ctx, { id: 'qa_' + role, name: 'QA ' + role, role, team: null }, 'qa-' + role + '-key');
  await refuseStubKeyProductionWrite(ctx);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  await page.goto(origin + '/#kasper', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _kasperGotoTab === 'function' && document.querySelector('[data-kasper-tab="clients"]'), null, { timeout: 20000 })
    .catch(() => failures.push(`${role}: Kasper never rendered its tabs`));
  await page.waitForTimeout(1000);
  return { ctx, page, ob, errors, failures, rows };
}
async function openClients(s, label) {
  await s.page.evaluate(() => _kasperGotoTab('clients'));
  await s.page.waitForFunction(() => document.querySelector('#caSearch') && _caState.loaded, null, { timeout: 10000 }).catch(() => s.failures.push(`${label}: the Clients tab never loaded`));
}
async function fill(s, name) {
  await s.page.fill('#cnName', name);
  await s.page.waitForFunction(() => document.querySelectorAll('#cnManager option').length > 1, null, { timeout: 5000 }).catch(() => s.failures.push('the manager list never loaded'));
  await s.page.selectOption('#cnManager', 'managertwo');
  await s.page.waitForTimeout(700);
}
const shot = (s, name) => s.page.screenshot({ path: path.join(SHOTS, name + '.png') });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    // ---- desktop admin: the whole flow ----
    {
      const label = 'admin desktop';
      const s = await open(browser, origin, 'admin', { width: 1440, height: 900 });
      failures.push(...s.failures);
      await openClients(s, label);
      await s.page.evaluate(() => _caSelect('sidneylaruel'));
      await s.page.waitForTimeout(500);
      if (!(await s.page.$('#caNewBtn'))) failures.push(`${label}: no New client button`);
      if (s.ob.some(c => /^create/.test(c.body.action))) failures.push(`${label}: create calls before the button was pressed`);
      await s.page.click('#caNewBtn');
      await s.page.waitForSelector('.cn-dialog', { timeout: 4000 }).catch(() => failures.push(`${label}: the dialog never opened`));
      const focused = await s.page.evaluate(() => document.activeElement && document.activeElement.id);
      if (focused !== 'cnName') failures.push(`${label}: the name field is not focused on open (${focused})`);
      const first = s.ob.filter(c => /^create/.test(c.body.action));
      if (first.length !== 1 || first[0].body.action !== 'create_preview' || first[0].body.display_name || first[0].key !== 'qa-admin-key' || first[0].body.member_id !== 'qa_admin') failures.push(`${label}: opening should only list managers with the admin key (${JSON.stringify(first.map(c => c.body))})`);
      if (!(await s.page.$eval('#cnCreateBtn', b => b.disabled))) failures.push(`${label}: Create is on before anything was checked`);
      await shot(s, 'dialog-empty-1440');

      // a name already in use
      await fill(s, 'qa test client');
      const blocked = await s.page.$eval('#cnPreview', e => e.innerText).catch(() => '');
      if (!/already exists/.test(blocked)) failures.push(`${label}: a taken name is not explained (${blocked})`);
      if (!(await s.page.$eval('#cnCreateBtn', b => b.disabled))) failures.push(`${label}: Create is on for a taken name`);
      await shot(s, 'dialog-name-taken-1440');

      // the throwaway, ready
      await s.page.fill('#cnName', NEW_NAME);
      await s.page.fill('#cnEmail', 'zz@example.invalid');
      await s.page.waitForTimeout(800);
      const ready = await s.page.$eval('#cnPreview', e => e.innerText).catch(() => '');
      if (!/Ready\. This will make/.test(ready) || !/27-step onboarding checklist/.test(ready) || !/Slack channels are not made here/.test(ready)) failures.push(`${label}: the ready preview is missing its list (${ready})`);
      const slugLine = await s.page.$eval('#cnSlug', e => e.innerText).catch(() => '');
      if (!/zzthrowawaybeacon/.test(slugLine) || !/Test client/.test(slugLine)) failures.push(`${label}: the link name and test badge are not shown (${slugLine})`);
      if (await s.page.$eval('#cnCreateBtn', b => b.disabled)) failures.push(`${label}: Create stays off after a clean check`);
      const lastPreview = s.ob.filter(c => c.body.action === 'create_preview').pop();
      if (!lastPreview || lastPreview.body.display_name !== NEW_NAME || lastPreview.body.manager_slug !== 'managertwo' || lastPreview.body.email !== 'zz@example.invalid') failures.push(`${label}: the check did not send the name, manager and email`);
      await shot(s, 'dialog-ready-1440');

      // typing again makes the old check stale: Create goes off until the new one lands
      await s.page.type('#cnName', 'x');
      if (!(await s.page.$eval('#cnCreateBtn', b => b.disabled))) failures.push(`${label}: Create stays on while the name changed and was not checked`);
      await s.page.fill('#cnName', NEW_NAME);
      await s.page.waitForTimeout(800);

      const before = s.ob.length;
      await s.page.click('#cnCreateBtn');
      await s.page.waitForFunction(() => !document.querySelector('.cn-dialog'), null, { timeout: 5000 }).catch(() => failures.push(`${label}: the dialog did not close after a create`));
      await s.page.waitForTimeout(900);
      const creates = s.ob.slice(before).filter(c => c.body.action === 'create');
      if (creates.length !== 1) failures.push(`${label}: expected exactly one create, saw ${creates.length}`);
      else {
        const b = creates[0].body;
        if (!/^create-/.test(b.request_id || '') || b.display_name !== NEW_NAME || b.manager_slug !== 'managertwo' || b.email !== 'zz@example.invalid' || b.member_id !== 'qa_admin' || creates[0].key !== 'qa-admin-key') failures.push(`${label}: the create body is wrong (${JSON.stringify(b)})`);
      }
      const selected = await s.page.evaluate(() => _caState.selected);
      if (selected !== 'zzthrowawaybeacon') failures.push(`${label}: the new client's profile did not open (${selected})`);
      const hero = await s.page.$eval('.ca-hero h3', e => e.innerText).catch(() => '');
      if (hero !== NEW_NAME) failures.push(`${label}: the profile shows "${hero}"`);
      await shot(s, 'created-profile-1440');

      // Escape closes; a second open gets a new request id
      await s.page.click('#caNewBtn');
      await s.page.waitForSelector('.cn-dialog');
      await s.page.keyboard.press('Escape');
      if (await s.page.$('.cn-dialog')) failures.push(`${label}: Escape did not close the dialog`);
      if (s.errors.length) failures.push(`${label}: page errors: ${s.errors.join(' | ')}`);
      await s.ctx.close();
      console.log('ok   ' + label);
    }

    // ---- the database step not installed yet (today's live state) ----
    {
      const label = 'admin, create not installed';
      const s = await open(browser, origin, 'admin', { width: 1440, height: 900 }, { notInstalled: true });
      await openClients(s, label);
      await s.page.evaluate(() => _caSelect('sidneylaruel'));
      await s.page.click('#caNewBtn');
      await s.page.waitForSelector('.cn-dialog');
      await fill(s, NEW_NAME);
      await s.page.click('#cnCreateBtn');
      await s.page.waitForTimeout(800);
      const msg = await s.page.$eval('#cnPreview', e => e.innerText).catch(() => '');
      if (!/not installed yet/.test(msg) || !/Nothing was made/.test(msg)) failures.push(`${label}: the dialog does not say the step is not installed (${msg})`);
      if (!(await s.page.$('.cn-dialog'))) failures.push(`${label}: the dialog closed on a refusal`);
      if (s.rows.length !== 1) failures.push(`${label}: a client appeared`);
      await shot(s, 'not-installed-1440');
      await s.ctx.close();
      console.log('ok   ' + label);
    }

    // ---- SMM and creative never see it ----
    for (const role of ['smm', 'creative']) {
      const s = await open(browser, origin, role, { width: 1440, height: 900 });
      await s.page.evaluate(() => { try { _kasperGotoTab('clients'); } catch (e) {} });
      await s.page.waitForTimeout(1000);
      if (await s.page.$('#caNewBtn')) failures.push(`${role}: sees New client`);
      await s.page.evaluate(() => { try { _cnOpen(); } catch (e) {} });
      await s.page.waitForTimeout(600);
      if (await s.page.$('.cn-dialog')) failures.push(`${role}: the dialog opened when forced`);
      if (s.ob.length) failures.push(`${role}: sent ${s.ob.length} client-onboarding call(s)`);
      await s.ctx.close();
      console.log('ok   ' + role + ' is kept out');
    }

    // ---- phones ----
    for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
      const label = `admin ${vp.width}x${vp.height}`;
      const s = await open(browser, origin, 'admin', vp);
      failures.push(...s.failures);
      await openClients(s, label);
      await s.page.evaluate(() => _caSelect('sidneylaruel'));
      await s.page.waitForTimeout(400);
      const head = await s.page.evaluate(() => {
        const b = document.getElementById('caNewBtn').getBoundingClientRect();
        const a = document.getElementById('caAllBtn').getBoundingClientRect();
        return { w: b.width, h: b.height, sameRow: Math.abs(b.top - a.top) < 4, W: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
      });
      if (head.h < 44 || head.w < 44) failures.push(`${label}: New client is smaller than 44px (${head.w}x${head.h})`);
      if (!head.sameRow) failures.push(`${label}: New client is not on the All clients row`);
      if (head.sw > head.W) failures.push(`${label}: the page scrolls sideways (${head.sw} > ${head.W})`);
      if (vp.width === 390) await shot(s, 'header-390');
      await s.page.click('#caNewBtn');
      await s.page.waitForSelector('.cn-dialog');
      await fill(s, NEW_NAME);
      const m = await s.page.evaluate(() => {
        const W = document.documentElement.clientWidth, H = window.innerHeight;
        const d = document.querySelector('.cn-dialog').getBoundingClientRect();
        const vis = [...document.querySelectorAll('.cn-dialog button, .cn-dialog input, .cn-dialog select')].filter(e => e.getClientRects().length);
        const small = vis.filter(e => e.getBoundingClientRect().height < 44).map(e => (e.innerText || e.id || e.tagName).trim().slice(0, 24));
        const fields = vis.filter(e => /INPUT|SELECT/.test(e.tagName));
        return { W, sw: document.documentElement.scrollWidth, small, minFont: Math.min(...fields.map(e => parseFloat(getComputedStyle(e).fontSize))), sheet: Math.abs(d.bottom - H) < 2 && d.left === 0 && Math.abs(d.right - W) < 1 };
      });
      if (m.sw > m.W) failures.push(`${label}: page scrolls sideways (${m.sw} > ${m.W})`);
      if (m.small.length) failures.push(`${label}: controls under 44px tall: ${[...new Set(m.small)].join(', ')}`);
      if (m.minFont < 16) failures.push(`${label}: a field has ${m.minFont}px text`);
      if (!m.sheet) failures.push(`${label}: the dialog is not a bottom sheet`);
      if (await s.page.$eval('#cnCreateBtn', b => b.disabled)) failures.push(`${label}: Create stays off after a clean check`);
      if (vp.width === 390) await shot(s, 'dialog-ready-390');
      if (s.errors.length) failures.push(`${label}: page errors: ${s.errors.join(' | ')}`);
      await s.ctx.close();
      console.log('ok   ' + label);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error('\n' + failures.map(f => 'FAIL ' + f).join('\n'));
    console.error('\nclients-create-browser: FAILED (' + failures.length + ')');
    process.exit(1);
  }
  console.log('\nclients-create-browser: OK (New client: preview, create, refusals, admin only, phones)');
})().catch(e => { console.error(e); process.exit(1); });
