'use strict';
/* clients-admin-browser.js -- Kasper › More › Clients (admin), in a real
 * browser, fully offline. The layout is the owner's pick of 2026-10-07
 * (direction A "Dossier", docs/syncview-design/mockups/clients-redesign).
 *
 * Proves, with synthetic clients and every backend answer local:
 *   - an ADMIN sees the Clients item; the page asks analytics-read for
 *     `list_client_profiles` and client-profile-write for `list_managers`,
 *     both with the admin key, and nothing else without a click;
 *   - the header is the title, the search and a small "All clients": no
 *     subtitle, no Refresh, and no permanent list (the list is closed until
 *     asked for);
 *   - search filters as you type on name, handle and email; ↓ ↑ move, Enter
 *     opens, Esc closes;
 *   - "All clients" opens the list (archived hidden until asked), picks a
 *     client and closes;
 *   - the profile puts the core details first and every value with a stable
 *     address is a link: email (mailto), Instagram, TikTok, YouTube, and both
 *     Slack channels (Slack's app_redirect); Post for Me and Upload-Post have
 *     no stable page, so they are text with a Copy button; HubSpot sits
 *     below; Content research and Onboarding are folded;
 *   - the manager picker sends ONE assign_manager with the client, the new
 *     manager, the manager the page showed (the version check), the admin
 *     key and the admin's member id; "someone changed it" is handled;
 *   - an admin can edit: Save sends ONLY the changed fields with the row
 *     version; the version conflict, the sheet conflict and the unshared
 *     sheet are each shown; "See history" reads the history;
 *   - on a phone (390 and 375 wide) nothing scrolls sideways, every control
 *     is at least 44px tall and fields have 16px text;
 *   - an SMM or CREATIVE session never sees the item and never sends a call;
 *   - signing out purges the list from memory and the screen.
 * CA_SHOTS=<dir> also saves desktop and phone screenshots (CA_THEME=dark for the
 * dark theme; the file names then end in -dark).
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffIdentity, refuseStubKeyProductionWrite } = require('../../../qa/staff-gate-seed');

const root = path.resolve(__dirname, '..', '..', '..');
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
const mk = (i, name, extra) => Object.assign({
  slug: 'fixture' + i, display_name: name, email: 'team' + i + '@example.invalid', instagram_handle: '@fixture' + i,
  tiktok_handle: null, youtube_channel_id: null, competitors: null, keywords: 'routines', specific_keywords: null,
  content_description: 'Short educational reels.', slack_channel_id: null, creative_channel_id: null, roam_channel_id: null,
  upload_post_profile: null, postforme_account_id: null, extra: {}, source: 'sheet', sheet_synced_at: '2026-09-25T06:00:00Z',
  archived_at: null, created_at: '2026-09-25T06:00:00Z', updated_at: '2026-09-25T06:00:00Z', updated_by: 'sheet-copy',
}, extra || {});
const rows = () => [
  mk(1, 'Avery Fixture', { tiktok_handle: '@avery.tt', youtube_channel_id: 'UCfixtureAvery01', slack_channel_id: 'C0FIXTURE01', creative_channel_id: 'C0FIXTURE02', postforme_account_id: 'spc_fixture01', upload_post_profile: 'averyfixture' }),
  mk(2, 'Blake Sample', { email: 'hello@blakestudio.example.invalid', instagram_handle: '@blake.makes' }),
  mk(3, 'Casey Example', { archived_at: '2026-09-20T00:00:00Z' }),
];
const MANAGERS = [{ slug: 'qamanagerone', name: 'Manager One' }, { slug: 'qamanagertwo', name: 'Manager Two' }];

async function open(browser, origin, role, viewport) {
  const failures = [];
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });
  const calls = [];
  const writes = [];
  const ctl = { fail: false, edit: 'ok', assign: 'ok', managersFail: 0 };
  const edits = [];
  const ROWS = rows();
  await ctx.route(u => !u.toString().startsWith(origin), route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (b, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/functions/v1/analytics-read' && ctl.fail) return json({ ok: false, error: 'read_failed' }, 503);
    if (u.pathname === '/functions/v1/analytics-read') { calls.push({ body: r.postData(), key: r.headers()['x-syncview-key'] }); return json({ ok: true, principal: 'staff', authority: { source: 'syncview' }, clients: ROWS }); }
    if (u.pathname === '/functions/v1/client-profile-write') {
      const b = JSON.parse(r.postData() || '{}');
      edits.push({ body: b, key: r.headers()['x-syncview-key'] });
      if (b.action === 'list_managers' && ctl.managersFail > 0) { ctl.managersFail--; return json({ ok: false, error: 'unknown_action' }, 400); }
      if (b.action === 'list_managers') return json({ ok: true, managers: MANAGERS, assignments: { fixture1: 'qamanagerone', fixture2: 'qamanagerone' } });
      if (b.action === 'assign_manager') {
        if (ctl.assign === 'changed') return json({ ok: false, error: 'manager_changed', manager_slug: 'qamanagertwo' }, 409);
        return json({ ok: true, manager_slug: b.manager_slug, old_manager_slug: b.expected_manager_slug });
      }
      if (b.action === 'history') return json({ ok: true, edits: [{ field: 'email', old_value: 'team1@example.invalid', new_value: 'changed@example.invalid', edited_by: 'QA admin', edited_at: '2026-10-07T10:00:00Z' }], manager_moves: [{ old_manager_slug: 'qamanagerone', new_manager_slug: 'qamanagertwo', edited_by: 'QA admin', edited_at: '2026-10-07T09:00:00Z' }] });
      if (b.action === 'status') return json({ ok: true, sheet_configured: true, service_account: 'robot@fixture.iam.example.invalid', sheet_id_secret: 'X' });
      if (ctl.edit === 'unshared') return json({ ok: false, error: 'sheet_not_shared' }, 502);
      if (b.action === 'refresh_from_sheet') return json({ ok: true, row: Object.assign({}, ROWS[0], { instagram_handle: '@from-sheet', updated_at: '2026-09-25T09:00:00Z' }) });
      if (ctl.edit === 'conflict') return json({ ok: false, error: 'sheet_changed', fields: ['instagram_handle'] }, 409);
      if (ctl.edit === 'version') return json({ ok: false, error: 'client_profile_version_conflict', row: ROWS[0] }, 409);
      const row = ROWS.find(x => x.slug === b.slug);
      return json({ ok: true, native: true, fields: Object.keys(b.changes || {}), row: Object.assign({}, row, b.changes, { source: 'syncview', updated_by: 'QA admin', updated_at: '2026-09-25T10:00:00Z' }) });
    }
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role, member: { id: 'qa_' + role, name: 'QA ' + role, role, team: null } });
    if (r.method() !== 'GET' && !/functions\/v1\/(key-verify|write-diagnostics|client-profile-write|analytics-read|client-onboarding|client-hubspot-sync)/.test(u.pathname)) writes.push(r.method() + ' ' + u.pathname);
    if (/rest\/v1/.test(u.pathname)) return json([]);
    if (/functions|webhook/.test(u.pathname)) return json({});
    return route.abort();
  });
  await seedStaffIdentity(ctx, { id: 'qa_' + role, name: 'QA ' + role, role, team: null }, 'qa-' + role + '-key');
  await refuseStubKeyProductionWrite(ctx);
  await ctx.addInitScript(dark => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); if (dark) localStorage.setItem('syncview_theme', 'dark'); } catch (e) {} }, process.env.CA_THEME === 'dark');
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  await page.goto(origin + '/#kasper', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _kasperGotoTab === 'function' && document.querySelector('[data-kasper-tab="clients"]'), null, { timeout: 20000 })
    .catch(() => failures.push(`${role}: Kasper never rendered its tabs`));
  await page.waitForTimeout(1500);
  return { ctx, page, calls, writes, errors, failures, ctl, edits };
}

// Every visible control in the tab, for the phone size rule.
const measure = page => page.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const vis = [...document.querySelectorAll('.ca-wrap button, .ca-wrap input, .ca-wrap textarea, .ca-wrap a, .ca-wrap summary')]
    .filter(e => e.getClientRects().length && !e.closest('#caOnboarding') && !e.closest('#caHubspot') && e.getAttribute('aria-hidden') !== 'true' && e.tabIndex !== -1);
  return {
    W, sw: document.documentElement.scrollWidth,
    small: vis.filter(e => e.getBoundingClientRect().height < 44).map(e => ((e.innerText || e.getAttribute('aria-label') || e.placeholder || e.id || e.tagName) + '').trim().slice(0, 28)),
    font: Math.min(16, ...vis.filter(e => /INPUT|TEXTAREA/.test(e.tagName)).map(e => parseFloat(getComputedStyle(e).fontSize))),
  };
});

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const shots = process.env.CA_SHOTS;
  const sfx = process.env.CA_THEME === 'dark' ? '-dark' : '';
  try {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 375, height: 667 }]) {
      const label = `admin ${vp.width}x${vp.height}`;
      const phone = vp.width < 768;
      const s = await open(browser, origin, 'admin', vp);
      const p = s.page;
      failures.push(...s.failures);
      const visible = await p.$eval('[data-kasper-tab="clients"]', b => !b.hidden).catch(() => false);
      if (!visible) failures.push(`${label}: the Clients item is hidden for an admin`);
      await p.evaluate(() => _kasperGotoTab('clients'));
      await p.waitForFunction(() => _caState.loaded && _caState.managers, null, { timeout: 10000 }).catch(() => failures.push(`${label}: clients or managers never loaded`));
      const call = s.calls[0];
      if (!call || JSON.parse(call.body || '{}').action !== 'list_client_profiles' || call.key !== 'qa-admin-key') failures.push(`${label}: analytics-read was not asked for list_client_profiles with the admin key`);
      const lm = s.edits.find(e => e.body.action === 'list_managers');
      if (!lm || lm.key !== 'qa-admin-key' || lm.body.member_id !== 'qa_admin') failures.push(`${label}: list_managers was not sent with the admin key and member`);
      if (s.edits.some(e => e.body.action !== 'list_managers')) failures.push(`${label}: something other than list_managers was sent without a click`);

      // Header: title, search, All clients. No subtitle, no Refresh, no permanent list.
      const head = await p.evaluate(() => ({
        title: (document.querySelector('.ca-head .cc-title') || {}).innerText,
        sub: !!document.querySelector('.ca-wrap .cc-sub'),
        refresh: [...document.querySelectorAll('.ca-wrap button')].some(b => /refresh/i.test(b.innerText)),
        listShown: !!document.querySelector('.ca-row') || !document.getElementById('caDrop').hidden,
        pill: !!document.querySelector('.ca-head .search-bar-pill #caSearch'),
      }));
      if (head.title !== 'Clients' || head.sub || head.refresh || head.listShown || !head.pill) failures.push(`${label}: header is not title + search + All clients (${JSON.stringify(head)})`);
      if (phone) {
        // Lighthouse review 2026-10-07: one "Clients" heading, a placeholder that fits,
        // a labelled "All clients". Prism batch 6 gave search its own full row with
        // "All clients" and "New client" side by side underneath.
        const ph = await p.evaluate(() => {
          const vis = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
          const titles = [...document.querySelectorAll('h1, h2, .cc-title, [class*="title"]')]
            .filter(e => vis(e) && e.children.length === 0 && e.innerText.trim() === 'Clients');
          const input = document.getElementById('caSearch');
          const cs = getComputedStyle(input);
          const ctx = document.createElement('canvas').getContext('2d');
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const btn = document.getElementById('caAllBtn').getBoundingClientRect();
          const pill = document.querySelector('.ca-search .search-bar-pill').getBoundingClientRect();
          const head = document.getElementById('caHead').getBoundingClientRect();
          const nb = document.getElementById('caNewBtn');
          const nbr = nb && vis(nb) ? nb.getBoundingClientRect() : null;
          const mid = r => (r.top + r.bottom) / 2;
          return { titles: titles.length, placeholder: input.placeholder, fits: ctx.measureText(input.placeholder).width <= room,
            label: document.getElementById('caAllBtn').innerText.trim(),
            searchRow: pill.width >= head.width - 24 && btn.top >= pill.bottom - 1,
            buttonsRow: !nbr || Math.abs(mid(btn) - mid(nbr)) < 6 };
        });
        if (ph.titles !== 1) failures.push(`${label}: "Clients" heading shown ${ph.titles} times`);
        if (!ph.fits) failures.push(`${label}: the search placeholder "${ph.placeholder}" is cut off`);
        if (ph.label !== 'All clients') failures.push(`${label}: the list button reads "${ph.label}"`);
        if (!ph.searchRow) failures.push(`${label}: search does not span its own row above All clients`);
        if (!ph.buttonsRow) failures.push(`${label}: All clients and New client are not on one row`);
      }
      if (shots) await p.screenshot({ path: path.join(shots, `start-${vp.width}${sfx}.png`) });

      // Search: name, handle and email; arrows and Enter; Esc closes.
      const opts = () => p.$$eval('#caSearchPop .ca-opt', x => x.map(o => o.getAttribute('data-ca-slug')));
      await p.fill('#caSearch', 'blake.makes');
      if ((await opts()).join() !== 'fixture2') failures.push(`${label}: searching a handle found ${(await opts()).join()}`);
      await p.fill('#caSearch', 'blakestudio');
      if ((await opts()).join() !== 'fixture2') failures.push(`${label}: searching an email found ${(await opts()).join()}`);
      await p.fill('#caSearch', 'fixture');
      const both = await opts();
      if (both.join() !== 'fixture1,fixture2') failures.push(`${label}: searching a name part found ${both.join()} (archived must stay out)`);
      if (shots) await p.screenshot({ path: path.join(shots, `search-${vp.width}${sfx}.png`) });
      await p.press('#caSearch', 'ArrowDown');
      const act1 = await p.$eval('#caSearchPop .ca-opt.is-active', o => o.getAttribute('data-ca-slug')).catch(() => '');
      await p.press('#caSearch', 'ArrowDown');
      const act2 = await p.$eval('#caSearchPop .ca-opt.is-active', o => o.getAttribute('data-ca-slug')).catch(() => '');
      await p.press('#caSearch', 'ArrowUp');
      const act3 = await p.$eval('#caSearchPop .ca-opt.is-active', o => o.getAttribute('data-ca-slug')).catch(() => '');
      if (act1 !== 'fixture2' || act2 !== 'fixture1' || act3 !== 'fixture2') failures.push(`${label}: arrow keys moved ${act1} → ${act2} → ${act3}`);
      await p.press('#caSearch', 'Escape');
      if (!(await p.$eval('#caSearchPop', x => x.hidden))) failures.push(`${label}: Esc did not close the search`);
      await p.fill('#caSearch', 'blak');
      await p.press('#caSearch', 'Enter');
      await p.waitForSelector('.ca-detail-head h3', { timeout: 3000 }).catch(() => {});
      if ((await p.$eval('.ca-detail-head h3', h => h.innerText).catch(() => '')) !== 'Blake Sample') failures.push(`${label}: Enter did not open the highlighted client`);
      if (!(await p.$eval('#caSearchPop', x => x.hidden)) || (await p.inputValue('#caSearch')) !== '') failures.push(`${label}: opening a client did not clear and close the search`);

      // All clients: closed by default, archived hidden until asked, picks and closes.
      await p.click('#caAllBtn');
      const listed = await p.$$eval('#caDrop .ca-row', x => x.length);
      if (listed !== 2) failures.push(`${label}: All clients listed ${listed}, expected the 2 active ones`);
      await p.click('#caDrop .ca-link');
      const withArchived = await p.$$eval('#caDrop .ca-row', x => x.length);
      if (withArchived !== 3) failures.push(`${label}: "Show archived" did not reveal the archived client`);
      if (shots) await p.screenshot({ path: path.join(shots, `all-clients-${vp.width}${sfx}.png`) });
      await p.click('#caDrop .ca-row[data-ca-slug="fixture1"]');
      if (!(await p.$eval('#caDrop', d => d.hidden))) failures.push(`${label}: picking from All clients did not close the list`);
      await p.click('#caAllBtn');
      await p.keyboard.press('Escape');
      if (!(await p.$eval('#caDrop', d => d.hidden))) failures.push(`${label}: Esc did not close All clients`);

      // The profile: core details first, links, HubSpot below, folds closed.
      const prof = await p.evaluate(() => {
        const d = document.getElementById('caDetail');
        const href = k => { const a = d.querySelector(`.ca-card a[data-ca-link="${k}"]`); return a ? a.getAttribute('href') : null; };
        const order = [...d.children].map(c => c.className.split(' ')[0]);
        const folds = [...d.querySelectorAll('details.ca-fold')].map(f => ({ k: f.getAttribute('data-ca-fold'), open: f.open }));
        return {
          name: d.querySelector('h3').innerText, mgr: (d.querySelector('#caMgrBtn') || {}).innerText || '',
          email: href('email'), ig: href('instagram_handle'), tt: href('tiktok_handle'), yt: href('youtube_channel_id'),
          slack: href('slack_channel_id'), creative: href('creative_channel_id'),
          pfm: { link: !!d.querySelector('a[data-ca-link="postforme_account_id"]'), copy: !!d.querySelector('[data-ca-copy="spc_fixture01"]') },
          up: { link: !!d.querySelector('a[data-ca-link="upload_post_profile"]'), copy: !!d.querySelector('[data-ca-copy="averyfixture"]') },
          reach: d.querySelectorAll('.ca-reach a').length, blank: [...d.querySelectorAll('.ca-card a')].every(a => a.target === '_blank' && /noopener/.test(a.rel)),
          order, folds, roam: /roam/i.test(d.innerText),
        };
      });
      const want = {
        email: 'mailto:team1@example.invalid', ig: 'https://www.instagram.com/fixture1/', tt: 'https://www.tiktok.com/@avery.tt',
        yt: 'https://www.youtube.com/channel/UCfixtureAvery01', slack: 'https://slack.com/app_redirect?channel=C0FIXTURE01', creative: 'https://slack.com/app_redirect?channel=C0FIXTURE02',
      };
      for (const [k, v] of Object.entries(want)) if (prof[k] !== v) failures.push(`${label}: ${k} link is ${prof[k]}, expected ${v}`);
      if (prof.name !== 'Avery Fixture' || !/Manager One/.test(prof.mgr)) failures.push(`${label}: profile head shows ${prof.name} / ${prof.mgr}`);
      if (prof.pfm.link || !prof.pfm.copy || prof.up.link || !prof.up.copy) failures.push(`${label}: Post for Me / Upload-Post should be text with Copy (${JSON.stringify([prof.pfm, prof.up])})`);
      if (prof.reach !== 6 || !prof.blank) failures.push(`${label}: reach buttons ${prof.reach}, links open in a new tab: ${prof.blank}`);
      const iCards = prof.order.indexOf('ca-cards'), iHs = prof.order.indexOf('cb-mount'), iLower = prof.order.indexOf('ca-lower');
      if (!(prof.order[0] === 'ca-hero' && iCards > 0 && iHs > iCards && iLower > iHs)) failures.push(`${label}: profile order is ${prof.order.join(' > ')}`);
      if (JSON.stringify(prof.folds) !== JSON.stringify([{ k: 'research', open: false }, { k: 'onboarding', open: false }])) failures.push(`${label}: folds ${JSON.stringify(prof.folds)}`);
      if (prof.roam) failures.push(`${label}: the Roam channel is still shown`);
      if (shots) await p.screenshot({ path: path.join(shots, `profile-${vp.width}${sfx}.png`), fullPage: true });

      // Manager picker: one call with the version check.
      await p.click('#caMgrBtn');
      await p.waitForSelector('#caMgrPop .ca-mgr-opt', { timeout: 3000 }).catch(() => failures.push(`${label}: the manager picker never opened`));
      const pick = await p.$$eval('#caMgrPop .ca-mgr-opt', x => x.map(o => [o.getAttribute('data-ca-mgr'), o.getAttribute('aria-checked'), o.innerText.replace(/\s+/g, ' ').trim()]));
      if (pick.length !== 2 || pick[0][1] !== 'true' || !/2 clients/.test(pick[0][2])) failures.push(`${label}: picker options ${JSON.stringify(pick)}`);
      if (shots) await p.screenshot({ path: path.join(shots, `manager-picker-${vp.width}${sfx}.png`) });
      await p.click('#caMgrPop [data-ca-mgr="qamanagertwo"]');
      await p.waitForFunction(() => /Manager Two/.test(document.getElementById('caMgrBtn').innerText), null, { timeout: 4000 }).catch(() => failures.push(`${label}: the new manager is not shown after picking`));
      const asg = s.edits.filter(e => e.body.action === 'assign_manager');
      const wantAsg = { action: 'assign_manager', member_id: 'qa_admin', slug: 'fixture1', manager_slug: 'qamanagertwo', expected_manager_slug: 'qamanagerone' };
      if (asg.length !== 1 || asg[0].key !== 'qa-admin-key' || JSON.stringify(asg[0].body, Object.keys(wantAsg).sort()) !== JSON.stringify(wantAsg, Object.keys(wantAsg).sort())) failures.push(`${label}: assign_manager sent ${JSON.stringify(asg)}`);
      // Someone else moved this client meanwhile: the page shows their pick and saves nothing more.
      await p.evaluate(() => _caSelect('fixture2'));
      s.ctl.assign = 'changed';
      await p.click('#caMgrBtn');
      await p.click('#caMgrPop [data-ca-mgr="qamanagertwo"]');
      await p.waitForFunction(() => /Manager Two/.test(document.getElementById('caMgrBtn').innerText) && !_caState.pickerBusy, null, { timeout: 4000 }).catch(() => failures.push(`${label}: a "manager changed" refusal did not show the current manager`));
      s.ctl.assign = 'ok';
      await p.evaluate(() => _caSelect('fixture1'));

      if (phone) {
        const m = await measure(p);
        if (m.sw > m.W) failures.push(`${label}: page scrolls sideways (${m.sw} > ${m.W})`);
        for (const x of new Set(m.small)) failures.push(`${label}: "${x}" is under 44px tall`);
      }
      if (s.writes.length) failures.push(`${label}: unexpected writes: ${s.writes.join(', ')}`);
      if (s.errors.length) failures.push(`${label}: page errors: ${s.errors.join(' | ')}`);

      // Edit: change one field, save, and only that field is sent with the version.
      const before = s.edits.length;
      await p.click('.ca-edit-btn');
      await p.waitForSelector('#caIn_email', { timeout: 3000 }).catch(() => failures.push(`${label}: Edit never opened the form`));
      const em = await p.evaluate(() => ({ n: document.querySelectorAll('.ca-detail .ca-input').length, roam: !!document.querySelector('[data-ca-field="roam_channel_id"]'), research: document.querySelector('[data-ca-fold="research"]').open }));
      if (em.n !== 12 || em.roam || !em.research) failures.push(`${label}: expected 12 editable fields with research open (${JSON.stringify(em)})`);
      if (shots) { await p.waitForTimeout(3500); await p.screenshot({ path: path.join(shots, `edit-${vp.width}${sfx}.png`) }); }
      if (phone) {
        const m = await measure(p);
        if (m.sw > m.W) failures.push(`${label}: the edit form scrolls sideways`);
        if (m.font < 16) failures.push(`${label}: edit fields have ${m.font}px text`);
        for (const x of new Set(m.small)) failures.push(`${label}: edit form: "${x}" is under 44px tall`);
      }
      await p.fill('#caIn_email', 'changed@example.invalid');
      await p.click('.ca-save');
      await p.waitForFunction(() => !document.querySelector('#caIn_email'), null, { timeout: 5000 }).catch(() => failures.push(`${label}: a successful save did not close the form`));
      const sent = s.edits[before];
      const wantSave = { action: 'update_client_profile', slug: 'fixture1', member_id: 'qa_admin', expected_updated_at: '2026-09-25T06:00:00Z', changes: { email: 'changed@example.invalid' } };
      if (!sent || sent.key !== 'qa-admin-key' || JSON.stringify(sent.body, Object.keys(wantSave).concat(['email']).sort()) !== JSON.stringify(wantSave, Object.keys(wantSave).concat(['email']).sort())) failures.push(`${label}: the save request was ${JSON.stringify(sent)}`);
      const shown = await p.evaluate(() => ({ email: (document.querySelector('a[data-ca-link="email"]') || {}).getAttribute?.('href'), prov: document.querySelector('.ca-prov').innerText }));
      if (shown.email !== 'mailto:changed@example.invalid' || !/QA admin/.test(shown.prov)) failures.push(`${label}: the saved values are not shown (${JSON.stringify(shown)})`);
      // Someone saved a moment ago: the edit stays, nothing saved.
      s.ctl.edit = 'version';
      await p.click('.ca-edit-btn');
      await p.fill('#caIn_tiktok_handle', '@new-tiktok');
      await p.click('.ca-save');
      await p.waitForSelector('.ca-msg.is-error', { timeout: 5000 }).catch(() => failures.push(`${label}: a version conflict was silent`));
      if ((await p.inputValue('#caIn_tiktok_handle').catch(() => '')) !== '@new-tiktok') failures.push(`${label}: a version conflict lost the typed value`);
      // The sheet changed underneath (Sheet-main mode): fields named, a way to load them.
      s.ctl.edit = 'conflict';
      await p.click('.ca-save');
      await p.waitForFunction(() => /Instagram/.test((document.querySelector('.ca-msg') || {}).innerText || ''), null, { timeout: 5000 }).catch(() => failures.push(`${label}: a sheet conflict did not name the field`));
      if (!(await p.$('#caIn_instagram_handle.is-conflict'))) failures.push(`${label}: the conflicting field is not flagged`);
      await p.click('.ca-msg .cc-btn');
      await p.waitForFunction(() => /Loaded the latest values/.test((document.querySelector('.ca-msg') || {}).innerText || ''), null, { timeout: 5000 }).catch(() => failures.push(`${label}: loading the sheet's values failed`));
      const refreshed = await p.evaluate(() => ({ ig: document.querySelector('#caIn_instagram_handle').value, tt: document.querySelector('#caIn_tiktok_handle').value }));
      if (refreshed.ig !== '@from-sheet' || refreshed.tt !== '@new-tiktok') failures.push(`${label}: after loading the sheet: ${JSON.stringify(refreshed)}`);
      // The sheet is not shared yet: the page asks for the account to share with.
      s.ctl.edit = 'unshared';
      await p.click('.ca-save');
      await p.waitForFunction(() => /robot@fixture\.iam\.example\.invalid/.test((document.querySelector('.ca-msg') || {}).innerText || ''), null, { timeout: 5000 })
        .catch(() => failures.push(`${label}: an unshared sheet did not show the service account to share with`));
      const acts = s.edits.slice(before).map(e => e.body.action).join(',');
      if (acts !== 'update_client_profile,update_client_profile,update_client_profile,refresh_from_sheet,update_client_profile,status') failures.push(`${label}: edit calls were ${acts}`);
      s.ctl.edit = 'ok';
      p.once('dialog', d => d.accept());
      await p.click('.ca-editbar .cc-btn:not(.primary)');

      // History: read on demand.
      await p.click('#caHistBtn');
      await p.waitForFunction(() => _caState.history && document.querySelector('.ca-hist-row'), null, { timeout: 4000 }).catch(() => failures.push(`${label}: the history never drew`));
      const hist = await p.$$eval('.ca-hist-row', x => x.map(r => r.innerText.replace(/\s+/g, ' ')));
      if (hist.length !== 2 || !/changed Email/.test(hist.join('|')) || !/Manager One to Manager Two/.test(hist.join('|'))) failures.push(`${label}: history shows ${JSON.stringify(hist)}`);
      if (!s.edits.some(e => e.body.action === 'history' && e.body.slug === 'fixture1')) failures.push(`${label}: the history was not read for this client`);

      if (vp.width === 1440) {
        // Signing out purges the admin-only list from memory and screen.
        await p.evaluate(() => { _syncviewStaffIdentityClear(); _syncviewStaffPurgeSensitiveState(); });
        await p.waitForTimeout(800);
        const leftover = await p.evaluate(() => ({ rows: document.querySelectorAll('.ca-row, .ca-opt').length, text: /Avery Fixture/.test(document.body.innerText), mem: (_caState.rows || []).length + (_caState.managers ? 1 : 0) }));
        if (leftover.rows || leftover.text || leftover.mem) failures.push(`${label}: client details survived a sign-out (${JSON.stringify(leftover)})`);
      }
      console.log(`${failures.length ? '...' : 'ok  '} ${label}`);
      await s.ctx.close();
    }
    // A failed load says so, and offers to try again.
    {
      const s = await open(browser, origin, 'admin', { width: 1440, height: 900 });
      s.ctl.fail = true;
      await s.page.evaluate(() => _kasperGotoTab('clients'));
      await s.page.waitForSelector('.ca-status.is-error', { timeout: 5000 }).catch(() => failures.push('failed load: no message'));
      s.ctl.fail = false;
      await s.page.click('.ca-status .cc-btn');
      await s.page.waitForFunction(() => _caState.loaded, null, { timeout: 5000 }).catch(() => failures.push('failed load: Try again did not load'));
      console.log('ok   a failed load says so and recovers');
      // A failed manager list (e.g. before client-profile-write is deployed) offers Try again.
      // Every manager load fails until "Try again" is pressed: a background re-render of the tab may load the
      // managers too, and a single planned failure could be used up by it (seen 2026-10-10, a race, not a defect).
      s.ctl.managersFail = 1000;
      await s.page.evaluate(() => { _caState.managers = null; _caState.managersError = null; });
      await s.page.evaluate(() => _caLoadManagers());
      await s.page.evaluate(() => _caSelect('fixture1'));
      const retry = await s.page.$eval('#caMgrBtn', b => ({ text: b.innerText, disabled: b.disabled })).catch(() => ({}));
      if (!/Try again/.test(retry.text || '') || retry.disabled) failures.push(`manager load failure: the chip shows ${JSON.stringify(retry)}`);
      s.ctl.managersFail = 0;
      await s.page.click('#caMgrBtn');
      await s.page.waitForFunction(() => _caState.managers && /Manager One/.test(document.getElementById('caMgrBtn').innerText), null, { timeout: 4000 })
        .catch(() => failures.push('manager load failure: Try again did not load the managers'));
      console.log('ok   a failed manager load offers Try again and recovers');
      await s.ctx.close();
    }
    for (const role of ['smm', 'creative']) {
      const s = await open(browser, origin, role, { width: 1440, height: 900 });
      const hidden = await s.page.$eval('[data-kasper-tab="clients"]', b => b.hidden).catch(() => true);
      if (!hidden) failures.push(`${role}: the Clients item is visible to a non-admin`);
      await s.page.evaluate(() => _kasperGotoTab('clients')).catch(() => {});
      await s.page.waitForTimeout(800);
      if (s.calls.length) failures.push(`${role}: a non-admin session called list_client_profiles`);
      if (s.edits.length) failures.push(`${role}: a non-admin session called client-profile-write`);
      if (await s.page.$('.ca-row, .ca-detail')) failures.push(`${role}: a non-admin session rendered clients`);
      console.log(`ok   ${role} is kept out`);
      await s.ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error('\n' + failures.join('\n')); process.exit(1); }
  console.log('\nclients-admin-browser: OK (search, All clients, links, manager picker, edit + conflicts, history; desktop + two phones; smm and creative kept out)');
})().catch(e => { console.error(e); process.exit(2); });
