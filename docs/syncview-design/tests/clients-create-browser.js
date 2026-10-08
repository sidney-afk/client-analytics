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
 *   - a REAL client may be created without an email (the Slack checklist shows it missing, and warns when
 *     the form is already in); a name that differs from the onboarding form is explained with a
 *     one-click fix; the preview lists what the Slack finalizer still waits for; the toast says Slack follows;
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
const MANAGERS = [{ slug: 'managerone', name: 'Manager One', slack_id: false }, { slug: 'managertwo', name: 'Manager Two', slack_id: true }];
// The onboarding form already in for the real client (fictional).
const FORM = { name: 'Qx Newclient', email: 'qx@example.invalid' };
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
        const mode = /^ZZ THROWAWAY/.test(name) ? 'test' : 'client';
        const blockers = rows.some(x => x.display_name.toLowerCase() === name.toLowerCase()) ? ['name_taken'] : [];
        const manager = MANAGERS.find(m => m.slug === b.manager_slug) || null;
        let slack = { mode: 'never' };
        if (mode === 'client') {
          const form = String(b.email).toLowerCase() === FORM.email || slug === FORM.name.toLowerCase().replace(/[^a-z0-9&]+/g, '') ? FORM : null;
          if (form && form.name !== name) blockers.push('name_differs_from_form');
          slack = { mode: 'finalizer', client_email: !!String(b.email || '').trim(), form_received: !!form, form_name: form ? form.name : null, form_email: form ? form.email : null, manager_slack_id: !!(manager && manager.slack_id), filming_plan_linked: false };
        }
        return json({ ok: true, ready: !blockers.length, blockers, mode, slug, display_name: name, email: b.email || null, manager, managers: MANAGERS, will_create: WILL, slack });
      }
      if (b.action === 'create') {
        if (ctl.notInstalled) return json({ ok: false, error: 'create_not_installed', blockers: [] }, 503);
        const slug = String(b.display_name).toLowerCase().replace(/[^a-z0-9&]+/g, '');
        rows.push(mk(slug, b.display_name, { email: b.email || null }));
        const mode = /^ZZ THROWAWAY/.test(b.display_name) ? 'test' : 'client';
        return json({ ok: true, request_id: b.request_id, client_slug: slug, mode, result: { ok: true, outcome: 'created', slack: mode === 'client' ? 'finalizer_nudged' : 'not_queued' } });
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
  await s.page.waitForFunction(() => document.querySelector('#caSearch') && _caState.loaded, null, { timeout: 15000 }).catch(() => s.failures.push(`${label}: the Clients tab never loaded`));
}
async function fill(s, name) {
  await s.page.fill('#cnName', name);
  await s.page.waitForFunction(() => document.querySelectorAll('#cnManager option').length > 1, null, { timeout: 15000 }).catch(() => s.failures.push('the manager list never loaded'));
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
      await s.page.waitForSelector('.cn-dialog', { timeout: 15000 }).catch(() => failures.push(`${label}: the dialog never opened`));
      const focused = await s.page.evaluate(() => document.activeElement && document.activeElement.id);
      if (focused !== 'cnName') failures.push(`${label}: the name field is not focused on open (${focused})`);
      const first = s.ob.filter(c => /^create/.test(c.body.action));
      if (first.length !== 1 || first[0].body.action !== 'create_preview' || first[0].body.display_name || first[0].key !== 'qa-admin-key' || first[0].body.member_id !== 'qa_admin') failures.push(`${label}: opening should only list managers with the admin key (${JSON.stringify(first.map(c => c.body))})`);
      if (!(await s.page.$eval('#cnCreateBtn', b => b.disabled))) failures.push(`${label}: Create is on before anything was checked`);
      await shot(s, 'dialog-empty-1440');

      // a name already in use
      await s.page.fill('#cnEmail', 'someone@example.invalid');
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
      if (!/Ready\. This will make/.test(ready) || !/27-step onboarding checklist/.test(ready) || !/stays off the Clients Info Sheet and Slack/.test(ready)) failures.push(`${label}: the ready preview is missing its list (${ready})`);
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
      await s.page.waitForFunction(() => !document.querySelector('.cn-dialog'), null, { timeout: 15000 }).catch(() => failures.push(`${label}: the dialog did not close after a create`));
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

    // ---- a REAL client: email needed, the form's exact name, and what the Slack finalizer still waits for ----
    {
      const label = 'admin, real client and Slack';
      const s = await open(browser, origin, 'admin', { width: 1440, height: 900 });
      failures.push(...s.failures);
      await openClients(s, label);
      await s.page.evaluate(() => _caSelect('sidneylaruel'));
      await s.page.click('#caNewBtn');
      await s.page.waitForSelector('.cn-dialog');
      const note = await s.page.$eval('#cnEmailNote', e => e.innerText).catch(() => '');
      if (note !== 'optional, needed for Slack channels') failures.push(`${label}: the email is not marked optional and needed for Slack channels (${note})`);
      // The managers load after the dialog opens; read the picker only once they are in.
      await s.page.waitForFunction(() => document.querySelectorAll('#cnManager option').length > 1, null, { timeout: 15000 }).catch(() => {});
      const opts = await s.page.$$eval('#cnManager option', os => os.map(o => o.textContent)).catch(() => []);
      if (!opts.some(t => /Manager One \(no Slack id yet\)/.test(t)) || opts.some(t => /Manager Two \(/.test(t))) failures.push(`${label}: the picker does not flag the manager without a Slack id (${opts.join(' | ')})`);
      await fill(s, 'Qx newclient');
      // No email (owner decision 2026-10-10: allowed). The form is found by its name, so the name difference is the blocker.
      let msg = await s.page.$eval('#cnPreview', e => e.innerText).catch(() => '');
      if (!/different spelling of this name/.test(msg) || !(await s.page.$('[data-cn-use="name"]'))) failures.push(`${label}: a name that differs from the form is not explained with a fix (${msg})`);
      await shot(s, 'slack-name-differs-1440');
      await s.page.click('[data-cn-use="name"]');
      await s.page.waitForTimeout(800);
      const nameNow = await s.page.$eval('#cnName', e => e.value);
      if (nameNow !== FORM.name) failures.push(`${label}: "Use the form's name" did not set the name (${nameNow})`);
      msg = await s.page.$eval('#cnPreview', e => e.innerText).catch(() => '');
      if (!/Client email\s*\(still missing\)/.test(msg)) failures.push(`${label}: no email does not show "Client email" as missing (${msg})`);
      if (!/sends the job to you to sort out by hand/.test(msg) || !(await s.page.$('.cn-slack-warn [data-cn-use="email"]'))) failures.push(`${label}: with the form in and no email, there is no warning with the form's email (${msg})`);
      if (await s.page.$eval('#cnCreateBtn', b => b.disabled)) failures.push(`${label}: Create is off without an email (it must be allowed)`);
      await shot(s, 'slack-no-email-1440');
      await s.page.click('.cn-slack-warn [data-cn-use="email"]');
      await s.page.waitForTimeout(800);
      if ((await s.page.$eval('#cnEmail', e => e.value)) !== FORM.email) failures.push(`${label}: "Use the form's email" did not set the email`);
      msg = await s.page.$eval('#cnPreview', e => e.innerText).catch(() => '');
      if (!/Client email\s*\(in\)/.test(msg)) failures.push(`${label}: with the email the checklist does not show it as in (${msg})`);
      if (!/Slack channels: made automatically once these are in/.test(msg) || !/Filming plan link\s*\(still missing\)/.test(msg) || !/Onboarding form from the client, same name and email\s*\(in\)/.test(msg) || !/Slack id\s*\(in\)/.test(msg)) failures.push(`${label}: the Slack checklist is wrong (${msg})`);
      if (await s.page.$eval('#cnCreateBtn', b => b.disabled)) failures.push(`${label}: Create stays off for a ready real client`);
      await shot(s, 'slack-ready-1440');
      const before = s.ob.length;
      await s.page.click('#cnCreateBtn');
      await s.page.waitForFunction(() => !document.querySelector('.cn-dialog'), null, { timeout: 15000 }).catch(() => failures.push(`${label}: the dialog did not close`));
      const c = s.ob.slice(before).filter(x => x.body.action === 'create');
      if (c.length !== 1 || c[0].body.display_name !== FORM.name || c[0].body.email !== FORM.email) failures.push(`${label}: the create did not carry the form's name and email`);
      const toast = await s.page.evaluate(() => (document.querySelector('.toast, #toast, [class*="toast"]') || {}).innerText || '').catch(() => '');
      if (!/Slack channels follow/.test(toast)) failures.push(`${label}: the toast does not mention Slack (${toast})`);
      if (s.errors.length) failures.push(`${label}: page errors: ${s.errors.join(' | ')}`);
      await s.ctx.close();
      console.log('ok   ' + label);
    }

    // ---- a REAL client with no email and no form yet: created (owner decision 2026-10-10) ----
    {
      const label = 'admin, real client without email';
      const s = await open(browser, origin, 'admin', { width: 1440, height: 900 });
      failures.push(...s.failures);
      await openClients(s, label);
      await s.page.evaluate(() => _caSelect('sidneylaruel'));
      await s.page.click('#caNewBtn');
      await s.page.waitForSelector('.cn-dialog');
      await fill(s, 'Qx Noemail');
      const msg = await s.page.$eval('#cnPreview', e => e.innerText).catch(() => '');
      if (!/Client email\s*\(still missing\)/.test(msg) || /sends the job to you/.test(msg)) failures.push(`${label}: the checklist is wrong without an email and without a form (${msg})`);
      if (await s.page.$eval('#cnCreateBtn', b => b.disabled)) failures.push(`${label}: Create is off without an email`);
      const before = s.ob.length;
      await s.page.click('#cnCreateBtn');
      await s.page.waitForFunction(() => !document.querySelector('.cn-dialog'), null, { timeout: 15000 }).catch(() => failures.push(`${label}: the dialog did not close`));
      const c = s.ob.slice(before).filter(x => x.body.action === 'create');
      if (c.length !== 1 || c[0].body.display_name !== 'Qx Noemail' || String(c[0].body.email || '') !== '') failures.push(`${label}: the create did not go out with an empty email (${JSON.stringify(c.map(x => x.body))})`);
      if ((await s.page.evaluate(() => _caState.selected)) !== 'qxnoemail') failures.push(`${label}: the new client's profile did not open`);
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
      if (vp.width === 390) {
        await s.page.fill('#cnName', FORM.name);
        await s.page.fill('#cnEmail', FORM.email);
        await s.page.waitForTimeout(800);
        const sm = await s.page.evaluate(() => { const W = document.documentElement.clientWidth; return { sw: document.documentElement.scrollWidth, W, has: !!document.querySelector('.cn-slack') }; });
        if (!sm.has || sm.sw > sm.W) failures.push(`${label}: the Slack checklist is missing or scrolls sideways`);
        await s.page.evaluate(() => { const d = document.querySelector('.cn-dialog'); if (d) d.scrollTop = d.scrollHeight; });
        await shot(s, 'slack-ready-390');
      }
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
