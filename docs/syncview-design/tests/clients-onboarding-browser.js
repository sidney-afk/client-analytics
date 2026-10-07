'use strict';
/* clients-onboarding-browser.js -- Kasper › More › Clients, the onboarding sections on a client's
 * profile (HubSpot, Resources, Onboarding checklist; fragment 324), in a real browser, fully offline.
 *
 * Proves, with synthetic clients and every backend answer local:
 *   - an ADMIN opening a profile makes exactly two calls for it, both with the admin key and the
 *     admin's member id: client-onboarding `get` and client-hubspot-sync `refresh`; nothing is
 *     written until a button is pressed;
 *   - the checklist shows all 27 steps in order, 25 Required and 2 Optional, the owner of each,
 *     the evidence and the note, and "N of 25 required steps done";
 *   - "Mark done" sends the step, the evidence, the admin's member id and the row version; "Skip this
 *     optional step" is one click with an automatic note; skipping a required step needs a note and
 *     sends nothing without one; "Reopen" asks first; a version conflict shows the latest and says so;
 *   - the Resources list shows found / missing / unknown with the source, a link where one exists,
 *     and "unknown" (not "missing") where nobody has looked;
 *   - the HubSpot block shows the deal, the contract and the payment state, "Unknown" where HubSpot has
 *     nothing, and says plainly when the refresh is off or not switched on for the client;
 *   - an archived client makes no onboarding call; a second client opened quickly never shows the first
 *     client's checklist; a failed load offers "Try again";
 *   - an SMM or CREATIVE session never sends either call;
 *   - on two phones every control is at least 44px tall, inputs are 16px text, and nothing scrolls sideways.
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
const ROWS = [mk(1, 'Avery Fixture'), mk(2, 'Blake Sample'), mk(3, 'Casey Example', { archived_at: '2026-09-20T00:00:00Z' })];

// 27 fictional steps in the shape the function returns; 25 required, positions 25 and 27 optional.
function makeSteps() {
  const kinds = ['auto', 'client', 'owner', 'claude'];
  return Array.from({ length: 27 }, (_, i) => ({
    step_key: 'fixture_step_' + String(i + 1).padStart(2, '0'), position: i + 1, label: 'Fixture step ' + (i + 1),
    kind: kinds[i % 4], required: !(i + 1 === 25 || i + 1 === 27), detectable: i % 2 === 0, proof: 'Proof ' + (i + 1),
    status: 'todo', responsible: 'owner', evidence: null, note: null, source: null, done_by: null, done_at: null,
    updated_at: '2026-10-02T08:00:00.000000+00:00',
  }));
}
const PRESENT = {
  client_slug: 'fixture1', email_present: true, instagram_present: true, tiktok_present: false, youtube_present: false,
  client_channel_present: true, creative_channel_present: false, postforme_tiktok_present: false, competitors_present: false,
  keywords_present: true, description_present: true, token_present: true, routing_lists_enrolled: 4, filming_plan_linked: true,
  templates_row_present: true, canva_link_present: false, credentials_present: false, onboarding_form_present: true,
  cards_present: true, samples_present: false, metrics_present: true,
};
const STORED = [
  { resource_key: 'drive_client_folder', value: 'folderIdFixture1234567890', status: 'found', source: 'drive' },
  { resource_key: 'hubspot_contact', value: null, status: 'missing', source: 'hubspot' },
];

async function open(browser, origin, role, viewport, opts) {
  opts = opts || {};
  const failures = [];
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });
  const ob = [];            // client-onboarding calls
  const hs = [];            // client-hubspot-sync calls
  const others = [];        // any other non-GET that is not one of the allowed gateway calls
  const ctl = { getFail: 0, sales: { hubspot_deal_id: 'D-1', hubspot_stage: 'closedwon', contract_state: 'signed', payment_state: 'unknown', imported_unknown: false, synced_at: '2026-10-01T10:00:00Z' },
    hubspot: { status: 200, body: { ok: true, skipped: 'not_enabled' } }, delayFirst: 0, conflict: false, steps: {}, presentPatch: {} };
  const stepsFor = slug => ctl.steps[slug] || (ctl.steps[slug] = makeSteps());
  const dialogs = [];
  await ctx.route(u => !u.toString().startsWith(origin), async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (b, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/functions/v1/analytics-read') return json({ ok: true, principal: 'staff', authority: { source: 'sheet' }, clients: ROWS });
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role, member: { id: 'qa_' + role, name: 'QA ' + role, role, team: null } });
    if (u.pathname === '/functions/v1/client-onboarding') {
      const b = JSON.parse(r.postData() || '{}');
      ob.push({ body: b, key: r.headers()['x-syncview-key'] });
      const steps = stepsFor(b.slug);
      if (b.action === 'get') {
        if (ctl.getFail > 0) { ctl.getFail--; return json({ ok: false, error: 'request_failed' }, 503); }
        if (ctl.delayFirst && b.slug === 'fixture1') { await new Promise(res => setTimeout(res, ctl.delayFirst)); }
        return json({ ok: true, client_slug: b.slug, steps, summary: null, resources: { present: Object.assign({}, PRESENT, { client_slug: b.slug }, ctl.presentPatch), stored: STORED }, sales: ctl.sales });
      }
      if (b.action === 'set_step') {
        const s = steps.find(x => x.step_key === b.step_key);
        if (!s) return json({ ok: false, error: 'unknown_step' }, 400);
        if (ctl.conflict || b.expected_updated_at !== s.updated_at) {
          s.updated_at = '2026-10-02T09:30:00.000000+00:00'; s.status = 'done'; s.done_by = 'Someone Else';
          return json({ ok: false, error: 'version_conflict', row: s }, 409);
        }
        if (b.status === 'skipped' && !String(b.note || '').trim()) return json({ ok: false, error: 'skip_needs_note' }, 400);
        Object.assign(s, { status: b.status, evidence: b.evidence || null, note: b.note || null, source: 'manual',
          done_by: b.status === 'done' ? 'QA ' + role : null, done_at: b.status === 'done' ? '2026-10-02T10:00:00Z' : null,
          updated_at: '2026-10-02T10:00:0' + (ob.length % 10) + '.000000+00:00' });
        return json({ ok: true, request_id: 'r1', result: { client_slug: b.slug, step_key: b.step_key, status: s.status, updated_at: s.updated_at } });
      }
      return json({ ok: false, error: 'unknown_action' }, 400);
    }
    if (u.pathname === '/functions/v1/client-profile-write') {
      const b = JSON.parse(r.postData() || '{}');
      if (b.action !== 'update_client_profile') return json({ ok: true });
      ctl.presentPatch = { tiktok_present: true };
      const row = ROWS.find(x => x.slug === b.slug);
      return json({ ok: true, fields: Object.keys(b.changes || {}), row: Object.assign({}, row, b.changes, { source: 'syncview', updated_by: 'QA admin', updated_at: '2026-10-02T11:00:00Z' }) });
    }
    if (u.pathname === '/functions/v1/client-hubspot-sync') {
      const b = JSON.parse(r.postData() || '{}');
      hs.push({ body: b, key: r.headers()['x-syncview-key'] });
      return json(ctl.hubspot.body, ctl.hubspot.status);
    }
    if (r.method() !== 'GET' && !/functions\/v1\/(key-verify|write-diagnostics|analytics-read|client-profile-write)/.test(u.pathname)) others.push(r.method() + ' ' + u.pathname);
    if (/rest\/v1/.test(u.pathname)) return json([]);
    if (/functions|webhook/.test(u.pathname)) return json({});
    return route.abort();
  });
  await seedStaffIdentity(ctx, { id: 'qa_' + role, name: 'QA ' + role, role, team: null }, 'qa-' + role + '-key');
  await refuseStubKeyProductionWrite(ctx);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {} });
  const page = await ctx.newPage();
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  await page.goto(origin + '/#kasper', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _kasperGotoTab === 'function' && document.querySelector('[data-kasper-tab="clients"]'), null, { timeout: 20000 })
    .catch(() => failures.push(`${role}: Kasper never rendered its tabs`));
  await page.waitForTimeout(1200);
  return { ctx, page, ob, hs, others, errors, failures, ctl, dialogs };
}

// The Clients tab has no permanent list (owner, 2026-10-07): a client is
// opened from "All clients", and Onboarding is a folded section.
async function openClients(s, label) {
  await s.page.evaluate(() => _kasperGotoTab('clients'));
  await s.page.waitForFunction(() => document.querySelector('#caSearch') && _caState.loaded, null, { timeout: 10000 }).catch(() => s.failures.push(`${label}: the Clients tab never loaded`));
}
async function openList(s) {
  if (await s.page.$eval('#caDrop', d => d.hidden).catch(() => true)) await s.page.click('#caAllBtn');
}
async function openRow(s, n) {
  await openList(s);
  await s.page.click(`#caDrop .ca-row >> nth=${n}`);
}
async function openOnboarding(s) {
  await s.page.waitForSelector('[data-ca-fold="onboarding"]', { timeout: 6000 }).catch(() => {});
  if (!(await s.page.$eval('[data-ca-fold="onboarding"]', d => d.open).catch(() => true))) await s.page.click('[data-ca-fold="onboarding"] > summary');
}
async function pick(s, label, n) {
  await openRow(s, n);
  await openOnboarding(s);
  await s.page.waitForSelector('.cb-step', { timeout: 6000 }).catch(() => s.failures.push(`${label}: the checklist never drew`));
}
const text = (s, sel) => s.page.$eval(sel, e => e.innerText).catch(() => '');

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    // ---- desktop admin: everything behavioural ----
    {
      const label = 'admin desktop';
      const s = await open(browser, origin, 'admin', { width: 1440, height: 900 });
      failures.push(...s.failures);
      await openClients(s, label);
      if (s.ob.length || s.hs.length) failures.push(`${label}: the list alone made onboarding calls`);
      await pick(s, label, 0);
      await s.page.waitForTimeout(400);
      const gets = s.ob.filter(c => c.body.action === 'get');
      if (s.ob.length < 1 || gets.length !== 1 || gets[0].body.slug !== 'fixture1' || gets[0].key !== 'qa-admin-key' || gets[0].body.member_id !== 'qa_admin') failures.push(`${label}: opening a profile did not send exactly one admin checklist read (${JSON.stringify(s.ob.map(c => c.body))})`);
      if (s.ob.some(c => c.body.action !== 'get')) failures.push(`${label}: something other than a read was sent on open`);
      if (s.hs.length !== 1 || s.hs[0].body.action !== 'refresh' || s.hs[0].body.slug !== 'fixture1' || s.hs[0].key !== 'qa-admin-key' || s.hs[0].body.member_id !== 'qa_admin') failures.push(`${label}: opening a profile did not ask HubSpot for exactly one refresh with the admin key`);
      // checklist shape
      const shape = await s.page.evaluate(() => {
        const items = [...document.querySelectorAll('.cb-step')];
        const labels = items.map(e => e.querySelector('.cb-step-label').innerText);
        const badges = items.map(e => e.querySelector('.cb-badge').innerText);
        return { n: items.length, labels, req: badges.filter(b => b === 'Required').length, opt: badges.filter(b => b === 'Optional').length,
          owner: items.every(e => /Owner: Owner/.test(e.querySelector('.cb-step-sub').innerText)), nums: items.map(e => e.querySelector('.cb-num').innerText) };
      });
      if (shape.n !== 27) failures.push(`${label}: expected 27 steps, found ${shape.n}`);
      if (shape.req !== 25 || shape.opt !== 2) failures.push(`${label}: expected 25 required and 2 optional, found ${shape.req} and ${shape.opt}`);
      if (shape.nums.join(',') !== Array.from({ length: 27 }, (_, i) => String(i + 1)).join(',')) failures.push(`${label}: the steps are not in order`);
      if (!shape.owner) failures.push(`${label}: a step does not show its owner`);
      if (!/0 of 25 required steps done/.test(await text(s, '#cbChecklist'))) failures.push(`${label}: the summary does not say 0 of 25 required steps done`);
      if (!/Not onboarded yet/.test(await text(s, '#cbChecklist'))) failures.push(`${label}: a client with open steps is shown as onboarded`);
      // resources
      const res = await s.page.evaluate(() => {
        const rows = [...document.querySelectorAll('.cb-res-row')];
        const by = k => rows.find(r => r.querySelector('.cb-res-label').innerText === k);
        const word = k => { const r = by(k); return r ? r.querySelector('.cb-pill').innerText : null; };
        const link = k => { const r = by(k); const a = r && r.querySelector('a'); return a ? a.getAttribute('href') : null; };
        return { n: rows.length, calLink: link('Calendar cards'), tplLink: link('Templates page'), formLink: link('Onboarding form answers'), samplesLink: link('Sample reviews'), ig: word('Instagram handle'), tt: word('TikTok handle'), folder: word('Google Drive client folder'), contact: word('HubSpot contact'),
          sandcastles: word('Sandcastles project'), igLink: link('Instagram handle'), folderLink: link('Google Drive client folder'), emailLink: link('Email'),
          source: (by('Google Drive client folder') || { innerText: '' }).innerText, whole: document.querySelector('#cbResources').innerText };
      });
      if (res.ig !== 'Found' || res.tt !== 'Missing') failures.push(`${label}: profile resources not shown as found / missing (${res.ig}, ${res.tt})`);
      if (res.folder !== 'Found' || res.contact !== 'Missing') failures.push(`${label}: saved resources not shown as found / missing (${res.folder}, ${res.contact})`);
      if (res.sandcastles !== 'Unknown') failures.push(`${label}: a resource nobody checked is not "Unknown" (${res.sandcastles})`);
      if (!/instagram\.com\/fixture1/.test(res.igLink || '')) failures.push(`${label}: no Instagram link (${res.igLink})`);
      if (!/drive\.google\.com\/drive\/folders\/folderIdFixture1234567890/.test(res.folderLink || '')) failures.push(`${label}: no Drive folder link (${res.folderLink})`);
      if (!/^mailto:team1@example\.invalid/.test(res.emailLink || '')) failures.push(`${label}: no email link`);
      if (res.calLink !== '/calendar/fixture1' || res.tplLink !== '/templates/fixture1' || res.formLink !== '/onboarding/fixture1') failures.push(`${label}: the in-app links are wrong (${res.calLink}, ${res.tplLink}, ${res.formLink})`);
      if (res.samplesLink !== null) failures.push(`${label}: a resource that is missing still has a link (${res.samplesLink})`);
      if (!/Google Drive/.test(res.source)) failures.push(`${label}: a stored resource does not say where it came from`);
      if (/folderIdFixture1234567890/.test(res.whole)) failures.push(`${label}: a stored value is printed on the page (only a link may carry it)`);
      // hubspot block, switched on for nobody yet
      let hub = await text(s, '#cbHubspot');
      if (!/Deal\s*Found · Contract Signed/.test(hub) || !/Contract\s*Signed/.test(hub) || !/First payment\s*Unknown/.test(hub)) failures.push(`${label}: the HubSpot block is wrong: ${hub.replace(/\s+/g, ' ')}`);
      if (!/not switched on for this client yet/.test(hub)) failures.push(`${label}: the "not switched on" note is missing`);

      // Mark done with evidence
      await s.page.click('[data-step="fixture_step_01"] button:has-text("Mark done")');
      await s.page.fill('#cbEv_fixture_step_01', 'https://example.invalid/proof');
      const before = s.ob.length;
      await s.page.click('[data-step="fixture_step_01"] .cb-form button:has-text("Mark done")');
      await s.page.waitForSelector('[data-step="fixture_step_01"].is-done', { timeout: 4000 }).catch(() => failures.push(`${label}: the step never showed as done`));
      const sent = s.ob.slice(before).find(c => c.body.action === 'set_step');
      if (!sent || sent.body.step_key !== 'fixture_step_01' || sent.body.status !== 'done' || sent.body.evidence !== 'https://example.invalid/proof'
        || sent.body.expected_updated_at !== '2026-10-02T08:00:00.000000+00:00' || sent.body.member_id !== 'qa_admin' || sent.key !== 'qa-admin-key' || sent.body.slug !== 'fixture1') {
        failures.push(`${label}: Mark done sent the wrong thing: ${JSON.stringify(sent)}`);
      }
      await s.page.waitForTimeout(300);
      const done1 = await text(s, '[data-step="fixture_step_01"]');
      if (!/Done/.test(done1) || !/example\.invalid\/proof/.test(done1) || !/Marked done by QA admin/.test(done1)) failures.push(`${label}: a done step does not show its evidence and who marked it: ${done1.replace(/\s+/g, ' ')}`);
      if (!/1 of 25 required steps done/.test(await text(s, '#cbChecklist'))) failures.push(`${label}: the summary did not move to 1 of 25`);

      // Optional skip: one click, automatic note
      const beforeOpt = s.ob.length;
      await s.page.click('[data-step="fixture_step_27"] button:has-text("Skip this optional step")');
      await s.page.waitForSelector('[data-step="fixture_step_27"].is-skipped', { timeout: 4000 }).catch(() => failures.push(`${label}: the optional step never showed as skipped`));
      const optSent = s.ob.slice(beforeOpt).find(c => c.body.action === 'set_step');
      if (!optSent || optSent.body.status !== 'skipped' || !/optional/i.test(optSent.body.note || '')) failures.push(`${label}: skipping an optional step did not send an automatic note: ${JSON.stringify(optSent && optSent.body)}`);
      // Required skip needs a note
      await s.page.click('[data-step="fixture_step_03"] button:has-text("Skip with a note")');
      const beforeReq = s.ob.length;
      await s.page.click('[data-step="fixture_step_03"] .cb-form button:has-text("Skip step")');
      await s.page.waitForTimeout(300);
      if (s.ob.length !== beforeReq) failures.push(`${label}: a required skip with no note was sent`);
      if (!/Write why this step is being skipped/.test(await text(s, '[data-step="fixture_step_03"]'))) failures.push(`${label}: a required skip with no note did not ask for one`);
      await s.page.fill('#cbNote_fixture_step_03', 'Client declined this one.');
      await s.page.click('[data-step="fixture_step_03"] .cb-form button:has-text("Skip step")');
      await s.page.waitForSelector('[data-step="fixture_step_03"].is-skipped', { timeout: 4000 }).catch(() => failures.push(`${label}: the required skip never landed`));
      const reqSent = s.ob.slice(beforeReq).find(c => c.body.action === 'set_step');
      if (!reqSent || reqSent.body.note !== 'Client declined this one.' || reqSent.body.status !== 'skipped') failures.push(`${label}: the required skip sent the wrong thing`);
      await s.page.waitForTimeout(300);
      if (!/Client declined this one\./.test(await text(s, '[data-step="fixture_step_03"]'))) failures.push(`${label}: a skipped step does not show its note`);
      // Cancel leaves nothing behind
      await s.page.click('[data-step="fixture_step_05"] button:has-text("Mark done")');
      const beforeCancel = s.ob.length;
      await s.page.click('[data-step="fixture_step_05"] .cb-form button:has-text("Cancel")');
      if (s.ob.length !== beforeCancel || await s.page.$('[data-step="fixture_step_05"] .cb-form')) failures.push(`${label}: Cancel did not close the form quietly`);
      // Reopen asks first
      const beforeReopen = s.ob.length;
      await s.page.click('[data-step="fixture_step_01"] button:has-text("Reopen")');
      await s.page.waitForSelector('[data-step="fixture_step_01"].is-todo', { timeout: 4000 }).catch(() => failures.push(`${label}: Reopen never took the step back to to-do`));
      if (!s.dialogs.some(d => /not done yet/i.test(d))) failures.push(`${label}: Reopen did not ask first`);
      if (!s.ob.slice(beforeReopen).some(c => c.body.action === 'set_step' && c.body.status === 'todo')) failures.push(`${label}: Reopen did not send todo`);
      // Version conflict
      s.ctl.conflict = true;
      await s.page.click('[data-step="fixture_step_07"] button:has-text("Mark done")');
      await s.page.click('[data-step="fixture_step_07"] .cb-form button:has-text("Mark done")');
      await s.page.waitForSelector('[data-step="fixture_step_07"] .cb-msg', { timeout: 4000 }).catch(() => failures.push(`${label}: a version conflict showed no message`));
      const conflict = await text(s, '[data-step="fixture_step_07"]');
      if (!/Someone else changed this step/.test(conflict) || !/Done/.test(conflict)) failures.push(`${label}: a conflict did not show the latest: ${conflict.replace(/\s+/g, ' ')}`);
      s.ctl.conflict = false;
      // Saving the profile while it is open reads the onboarding sections again (email, handles and channels feed them).
      const tiktokBefore = await s.page.$eval('#cbResources', e => [...e.querySelectorAll('.cb-res-row')].find(r => r.querySelector('.cb-res-label').innerText === 'TikTok handle').querySelector('.cb-pill').innerText);
      const getsBefore = s.ob.filter(c => c.body.action === 'get').length;
      await s.page.click('.ca-edit-btn');
      await s.page.fill('#caIn_tiktok_handle', '@fixture1tt');
      await s.page.click('.ca-save');
      await s.page.waitForFunction(() => !document.querySelector('.ca-save'), null, { timeout: 5000 }).catch(() => failures.push(`${label}: the profile save never finished`));
      await s.page.waitForFunction(() => [...document.querySelectorAll('.cb-res-row')].some(r => r.querySelector('.cb-res-label').innerText === 'TikTok handle' && r.querySelector('.cb-pill').innerText === 'Found'), null, { timeout: 5000 })
        .catch(() => failures.push(`${label}: after saving the profile the Resources list still shows the old answer (was ${tiktokBefore})`));
      if (s.ob.filter(c => c.body.action === 'get').length <= getsBefore) failures.push(`${label}: saving the profile did not read the onboarding data again`);
      if (!await s.page.$('.cb-step')) failures.push(`${label}: the checklist disappeared while it was read again`);
      if (s.others.length) failures.push(`${label}: unexpected writes: ${s.others.join(', ')}`);
      if (s.errors.length) failures.push(`${label}: page errors: ${s.errors.join(' | ')}`);
      // Signing out purges the admin-only sections from memory and screen.
      await s.page.evaluate(() => { _syncviewStaffIdentityClear(); _syncviewStaffPurgeSensitiveState(); });
      await s.page.waitForTimeout(800);
      const left = await s.page.evaluate(() => ({ steps: document.querySelectorAll('.cb-step').length, text: /Fixture step/.test(document.body.innerText), mem: !!(_cbState.data || _cbState.slug) }));
      if (left.steps || left.text || left.mem) failures.push(`${label}: the checklist survived a sign-out (${JSON.stringify(left)})`);
      // all onboarding calls were reads or the pressed buttons
      const unexpected = s.ob.filter(c => !['get', 'set_step'].includes(c.body.action));
      if (unexpected.length) failures.push(`${label}: unexpected onboarding actions: ${unexpected.map(c => c.body.action).join(', ')}`);
      await s.ctx.close();
      console.log('ok   ' + label);
    }

    // ---- HubSpot states ----
    for (const [name, hubspot, sales, expect] of [
      ['hubspot checked', { status: 200, body: { ok: true, match: 'matched', contract_state: 'signed', payment_state: 'paid', synced_at: '2026-10-02T09:00:00Z', changed: true } },
        { hubspot_deal_id: 'D-1', hubspot_stage: '3230452433', contract_state: 'signed', payment_state: 'paid', imported_unknown: false, synced_at: '2026-10-02T09:00:00Z' },
        [/Deal\s*Found · Closed Won/, /Contract\s*Signed/, /First payment\s*Paid/, /Checked with HubSpot just now/]],
      ['hubspot nothing', { status: 200, body: { ok: true, match: 'no_contact', contract_state: 'unknown', payment_state: 'unknown', synced_at: '2026-10-02T09:00:00Z', changed: false } },
        null, [/No deal saved yet/, /Contract\s*Unknown/, /First payment\s*Unknown/, /no contact with this email/, /Not saved from HubSpot yet/]],
      ['hubspot imported', { status: 200, body: { ok: true, skipped: 'fresh', synced_at: '2026-10-02T09:00:00Z' } },
        { hubspot_deal_id: 'D-2', hubspot_stage: 'closedwon', contract_state: 'unknown', payment_state: 'unknown', imported_unknown: true, synced_at: '2026-10-01T10:00:00Z' },
        [/added to HubSpot by hand/, /Contract\s*Unknown/, /First payment\s*Unknown/, /a moment ago/]],
      ['hubspot off', { status: 200, body: { ok: true, skipped: 'off' } }, null, [/switched off/, /Contract\s*Unknown/]],
      ['hubspot rate limit', { status: 502, body: { ok: false, error: 'hubspot_rate_limited' } }, null, [/slow down/, /Contract\s*Unknown/]],
      ['hubspot down', { status: 500, body: { ok: false, error: 'hubspot_not_configured' } }, null, [/not set up on the server yet/]],
    ]) {
      const s = await open(browser, origin, 'admin', { width: 1440, height: 900 });
      failures.push(...s.failures);
      s.ctl.hubspot = hubspot; s.ctl.sales = sales;
      await openClients(s, name);
      await pick(s, name, 0);
      await s.page.waitForTimeout(700);
      const hub = (await text(s, '#cbHubspot')).replace(/\s+/g, ' ');
      for (const re of expect) {
        const spaced = new RegExp(re.source.replace(/\\s\*/g, '\\s*'), re.flags);
        if (!spaced.test(hub)) failures.push(`${name}: HubSpot block lacks ${re}: ${hub}`);
      }
      if (s.errors.length) failures.push(`${name}: page errors: ${s.errors.join(' | ')}`);
      await s.ctx.close();
      console.log('ok   ' + name);
    }

    // ---- archived client, quick switching, failed load ----
    {
      const label = 'edge cases';
      const s = await open(browser, origin, 'admin', { width: 1440, height: 900 });
      failures.push(...s.failures);
      await openClients(s, label);
      await openList(s);
      await s.page.click('#caDrop .ca-link');
      await s.page.click('#caDrop .ca-row >> nth=2');
      await openOnboarding(s);
      await s.page.waitForSelector('.cb-section', { timeout: 3000 }).catch(() => failures.push(`${label}: an archived client showed nothing`));
      await s.page.waitForTimeout(300);
      if (s.ob.length || s.hs.length) failures.push(`${label}: an archived client made onboarding calls`);
      if (!/Archived clients have no onboarding checklist/.test(await text(s, '#caOnboarding'))) failures.push(`${label}: an archived client did not say it has no checklist`);
      // quick switch: client 1 answers slowly, client 2 is opened meanwhile
      s.ctl.delayFirst = 900;
      await openRow(s, 0);
      await s.page.waitForTimeout(100);
      await s.page.evaluate(() => _caSelect('fixture2'));
      await s.page.waitForSelector('[data-step]', { timeout: 6000 }).catch(() => failures.push(`${label}: the second client's checklist never drew`));
      await s.page.waitForTimeout(1500);
      const shownFor = await s.page.evaluate(() => (document.querySelector('.ca-detail-head h3') || {}).innerText);
      if (shownFor !== 'Blake Sample') failures.push(`${label}: the wrong client is open (${shownFor})`);
      if (!s.ob.some(c => c.body.slug === 'fixture2' && c.body.action === 'get')) failures.push(`${label}: the second client was never read`);
      s.ctl.delayFirst = 0;
      // failed load, then Try again
      s.ctl.getFail = 1;
      await s.page.evaluate(() => _caSelect('fixture1'));
      await s.page.waitForSelector('#cbChecklist .cb-msg.is-error', { timeout: 6000 }).catch(() => failures.push(`${label}: a failed load showed no message`));
      await s.page.click('#cbChecklist button:has-text("Try again")');
      await s.page.waitForSelector('.cb-step', { timeout: 6000 }).catch(() => failures.push(`${label}: Try again never loaded the checklist`));
      if (s.errors.length) failures.push(`${label}: page errors: ${s.errors.join(' | ')}`);
      await s.ctx.close();
      console.log('ok   ' + label);
    }

    // ---- keep SMM and creative out ----
    for (const role of ['smm', 'creative']) {
      const s = await open(browser, origin, role, { width: 1440, height: 900 });
      await s.page.evaluate(() => { try { _kasperGotoTab('clients'); } catch (e) {} });
      await s.page.waitForTimeout(1200);
      const visible = await s.page.$eval('[data-kasper-tab="clients"]', b => !b.hidden).catch(() => false);
      if (visible) failures.push(`${role}: the Clients item is visible`);
      if (s.ob.length || s.hs.length) failures.push(`${role}: sent onboarding calls (${s.ob.length}, ${s.hs.length})`);
      // Second line of defence: even if the panel were pointed at a client by mistake, a non-admin sends nothing and draws nothing.
      await s.page.evaluate(() => {
        const d = document.createElement('div'); d.id = 'caOnboarding'; document.body.appendChild(d);
        _cbSync({ slug: 'fixture1', display_name: 'Avery Fixture', archived_at: null });
      });
      await s.page.waitForTimeout(800);
      if (s.ob.length || s.hs.length) failures.push(`${role}: a forced panel sent onboarding calls (${s.ob.length}, ${s.hs.length})`);
      if (await s.page.$('#caOnboarding .cb-section')) failures.push(`${role}: a forced panel drew the onboarding sections`);
      await s.ctx.close();
      console.log('ok   ' + role + ' is kept out');
    }

    // ---- phones ----
    for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
      const label = `admin ${vp.width}x${vp.height}`;
      const s = await open(browser, origin, 'admin', vp);
      failures.push(...s.failures);
      await openClients(s, label);
      await pick(s, label, 0);
      await s.page.waitForTimeout(500);
      await s.page.click('[data-step="fixture_step_02"] button:has-text("Skip with a note")');
      const m = await s.page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const vis = [...document.querySelectorAll('#caOnboarding button, #caOnboarding input, #caOnboarding textarea, #caOnboarding a')].filter(e => e.getClientRects().length);
        const small = vis.filter(e => e.getBoundingClientRect().height < 44).map(e => (e.innerText || e.id || e.tagName).trim().slice(0, 24));
        const fields = vis.filter(e => /INPUT|TEXTAREA/.test(e.tagName));
        return { W, sw: document.documentElement.scrollWidth, small, minFont: fields.length ? Math.min(...fields.map(e => parseFloat(getComputedStyle(e).fontSize))) : 16, buttons: vis.filter(e => e.tagName === 'BUTTON').length };
      });
      if (m.sw > m.W) failures.push(`${label}: page scrolls sideways (${m.sw} > ${m.W})`);
      if (m.small.length) failures.push(`${label}: controls under 44px tall: ${[...new Set(m.small)].join(', ')}`);
      if (m.minFont < 16) failures.push(`${label}: a field has ${m.minFont}px text (needs 16px so phones do not zoom)`);
      if (!m.buttons) failures.push(`${label}: no buttons were measured`);
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
    console.error('\nclients-onboarding-browser: FAILED (' + failures.length + ')');
    process.exit(1);
  }
  console.log('\nclients-onboarding-browser: OK (checklist, resources and HubSpot state on a profile; admin only; phones)');
})().catch(e => { console.error(e); process.exit(1); });
