'use strict';
/* popup-behaviour-areas-browser.js -- the second half of the pop-up behaviour
 * check (the first half, popup-behaviour-browser.js, covers Calendar, Samples,
 * Today, Messages and the main bar). This one covers SyncLinear / Production,
 * Kasper's area, Workload, Analytics, Templates and the weekly reports page.
 *
 * The same five rules, for every surface, opened by a real click, fully offline
 * on the test client, at desktop width and at 390px:
 *   1. Escape closes it (with two open, only the top one).
 *   2. A click outside closes it; a click inside never does.
 *   3. Focus is back on the opening button afterwards.
 *   4. Typed text is not lost: it is kept, or the pop-up asks first.
 *   5. A background refresh neither closes it nor takes its focus.
 *
 * Run:  node docs/syncview-design/tests/popup-behaviour-areas-browser.js
 */
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate, seedStaffIdentity, refuseStubKeyProductionWrite } = require('../../../qa/staff-gate-seed.js');
const lib = require('./popup-behaviour-browser.js');
const { runSurface, expect, summary, fromStub, STUB, CORS, serve } = lib;
const {
  launchWorkloadHarness, waitForPlanSettled, issueRow, parentRow, WED, MON, EDITOR_1,
} = require('./workload-harness-lib.js');

const now = '2026-07-12T12:00:00.000Z';
const FIXTURE_CLIENT = { slug: 'normal-fixture', display_name: 'Normal Fixture', active: true, kind: 'video', linear_project_ids: [{ id: 'linear-project-normal' }] };
const MEMBERS = [
  { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics', active: true },
  { id: 'designer', name: 'Browser Designer', role: 'designer', team: 'graphics', active: true },
  { id: 'editor', name: 'Browser Editor', role: 'editor', team: 'video', active: true },
];
const DELIVERABLES = [
  { id: 'gra-fixture', identifier: 'GRA-TEST', raw_project_id: 'linear-project-normal', client_slug: 'normal-fixture', team: 'graphics', title: 'Graphics fixture', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: '2026-07-20', created_at: now, updated_at: now },
  { id: 'vid-fixture', identifier: 'VID-TEST', linear_issue_uuid: 'linear-video-parent', raw_project_id: 'linear-project-normal', client_slug: 'normal-fixture', team: 'video', title: 'Video fixture', status: 'in_progress', status_at: now, assignee_id: 'editor', due_date: '2026-07-22', created_at: now, updated_at: now },
];

async function productionPage(browser, origin, viewport) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (b, st) => route.fulfill({ status: st || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
    if (p === '/functions/v1/production-comments') return json({ comments: [], next_cursor: null, has_more: false, canonical_thread: true });
    if (p === '/functions/v1/production-write') {
      const body = JSON.parse(r.postData() || '{}');
      if (body.action === 'description_read') {
        const row = DELIVERABLES.find(d => d.id === body.id);
        return json(row ? { ok: true, complete: true, row: { id: row.id, client_slug: row.client_slug, team: row.team, brief: 'A made-up description.', updated_at: row.updated_at } }
          : { ok: false, error: 'description_scope_forbidden' }, row ? 200 : 403);
      }
      if (body.action === 'labels_read') return json({ ok: true, complete: true, authority: 'syncview', catalog: [], selected_label_ids: [], selected_labels: [] });
      return json({ ok: true });
    }
    if (/\/functions\/v1\//.test(p) || /\/webhook\//.test(p)) return json({});
    if (r.method() !== 'GET' && r.method() !== 'HEAD') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([FIXTURE_CLIENT]);
    if (p === '/rest/v1/team_members') return json(MEMBERS);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = u.searchParams.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: /_clients$/.test(k) ? { clients: [FIXTURE_CLIENT.slug] } : { video: 'syncview', graphics: 'syncview' } })));
    }
    if (p === '/rest/v1/deliverables' || p === '/rest/v1/production_deliverables_browser_v1') {
      const idFilter = String(u.searchParams.get('id') || '').replace(/^eq\./, '');
      return json(idFilter ? DELIVERABLES.filter(d => d.id === idFilter) : DELIVERABLES);
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await page.goto(`${origin}/?prod=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.prod-row', { timeout: 40000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}

const prodRefresh = async page => { await page.evaluate(() => _prodDeltaRefresh({ force: true })).catch(() => {}); };
const prodPopOpen = p => p.evaluate(() => !!document.querySelector('#prodLayer .prod-pop'));
const PROD_SURFACES = [
  { area: 'SyncLinear', name: 'Status picker', opener: '.prod-row .prod-status',
    open: async p => { await p.locator('.prod-row .prod-status').first().click(); },
    isOpen: prodPopOpen, inside: '#prodLayer .prod-pop', insideEdge: true, refresh: prodRefresh },
  { area: 'SyncLinear', name: 'Assignee picker', opener: '.prod-row .prod-assign-hot',
    open: async p => { await p.locator('.prod-row .prod-assign-hot').first().click(); },
    isOpen: prodPopOpen, inside: '#prodLayer .prod-pop', insideEdge: true, refresh: prodRefresh },
  { area: 'SyncLinear', name: 'Due-date picker', opener: '.prod-row .prod-due',
    open: async p => { await p.locator('.prod-row .prod-due').first().click(); },
    isOpen: prodPopOpen, inside: '#prodLayer .prod-pop', insideEdge: true, refresh: prodRefresh },
  { area: 'SyncLinear', name: 'Row menu (right-click)', opener: '.prod-row',
    open: async p => { await p.locator('.prod-row').first().click({ button: 'right' }); },
    isOpen: prodPopOpen, inside: '#prodLayer .prod-pop', insideEdge: true, refresh: prodRefresh },
  { only: 'desktop', area: 'SyncLinear', name: 'Filter menu', opener: '#prodFilterBtn',
    open: async p => { await p.click('#prodFilterBtn'); },
    isOpen: prodPopOpen, inside: '#prodLayer .prod-pop', insideEdge: true, refresh: prodRefresh },
  { only: 'desktop', area: 'SyncLinear', name: 'Group / display menu', opener: '#prodGroupBtn',
    open: async p => { await p.click('#prodGroupBtn'); },
    isOpen: prodPopOpen, inside: '#prodLayer .prod-pop', insideEdge: true, refresh: prodRefresh },
  { area: 'SyncLinear', name: 'Search palette (Ctrl+K)', opener: STUB,
    open: async p => { await fromStub('0')(p); await p.keyboard.press('Control+k'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.prod-cmd-bd')), inside: '.prod-cmd' },
];

async function openCard(page) {
  await page.evaluate(() => _prodOpenDeliverable('vid-fixture'));
  await page.waitForSelector('[data-prod-description-state="ready"] [data-prod-description-control="edit"]', { timeout: 15000 });
}
const DESC_SURFACE = {
  area: 'SyncLinear', name: 'Description editor (in the card)', opener: '[data-prod-description-control="edit"]',
  open: async p => { await p.click('[data-prod-description-control="edit"]'); await p.waitForSelector('[data-prod-description-control="rich"], [data-prod-description-control="source"]'); },
  isOpen: p => p.evaluate(() => !!document.querySelector('[data-prod-description-control="rich"], [data-prod-description-control="source"]')),
  inside: '[data-prod-description-mode]',
  type: { selector: '[data-prod-description-control="rich"], [data-prod-description-control="source"]', text: ' MADEUP',
    // the typed text must still be there when Edit is pressed again (kept as a draft)
    kept: async p => {
      await p.click('[data-prod-description-control="edit"]');
      await p.waitForSelector('[data-prod-description-control="rich"], [data-prod-description-control="source"]');
      return p.evaluate(() => /MADEUP/.test((document.querySelector('[data-prod-description-control="rich"], [data-prod-description-control="source"]') || {}).textContent || (document.querySelector('[data-prod-description-control="source"]') || {}).value || ''));
    } },
};

const TEMPLATES_SURFACES = [
  { only: 'desktop', area: 'Templates', name: 'Client search dropdown', opener: '#tplSearchInput',
    open: async p => { await p.click('#tplSearchInput'); },
    isOpen: p => p.evaluate(() => { const b = document.getElementById('tplSearchBox'); return !!b && b.classList.contains('open'); }), inside: '#tplSearchInput' },
  { only: 'desktop', area: 'Templates', name: 'Pin-a-client dropdown', opener: '#tplPinsAddRow .pin-add-btn',
    open: async p => { await p.click('#tplPinsAddRow .pin-add-btn'); },
    isOpen: p => p.evaluate(() => { const b = document.getElementById('tplPinSelectorDropdown'); return !!b && b.classList.contains('open'); }), inside: '#tplPinSelectorDropdown' },
];

async function plainPage(browser, origin, url, viewport, member) {
  const who = member || { id: 'qa_staff', name: 'QA Staff', role: 'admin', team: null };
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffIdentity(page, who);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (b, st) => route.fulfill({ status: st || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: who.role, member: who });
    if (p === '/functions/v1/analytics-read') return json({ ok: true, principal: 'staff', authority: { source: 'syncview' }, clients: [] });
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: lib.SLUG, display_name: lib.CLIENT, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([Object.assign({ active: true }, who)]);
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors };
}

const WL_SURFACES = [
  { only: 'desktop', area: 'Workload', name: 'Editor filter dropdown', opener: '.wl-dropdown .dropdown-trigger',
    open: async p => { await p.locator('.wl-dropdown .dropdown-trigger').first().click(); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.wl-dropdown .dropdown-trigger.open')), inside: '.wl-dropdown .dropdown-menu.open', insideEdge: true },
  // The board itself cannot paint in the offline harness here, so the popover is opened from a stand-in button, the same way its badge calls it.
  { only: 'desktop', area: 'Workload', name: 'Rollup popover', opener: STUB,
    open: fromStub("wlOpenRollupPopover(document.getElementById('popupTestOpener'))"),
    isOpen: p => p.evaluate(() => { const m = document.getElementById('wlPopover'); return !!m && m.classList.contains('open'); }), inside: '#wlPopover', insideEdge: true },
];

const KASPER_ROWS = [{
  slug: 'phone-fixture', display_name: 'QA Test Client', email: 'qa@example.invalid', instagram_handle: '@qa.test', tiktok_handle: null,
  youtube_channel_id: null, competitors: null, keywords: null, specific_keywords: null, content_description: null, slack_channel_id: null,
  creative_channel_id: null, roam_channel_id: null, upload_post_profile: null, postforme_account_id: null, extra: {}, source: 'syncview',
  sheet_synced_at: null, archived_at: null, created_at: '2026-10-01T06:00:00Z', updated_at: '2026-10-01T06:00:00Z', updated_by: 'QA admin',
}];
const MANAGERS = [{ slug: 'managerone', name: 'Manager One', slack_id: false }, { slug: 'managertwo', name: 'Manager Two', slack_id: true }];
async function kasperPage(browser, origin, viewport) {
  const who = { id: 'qa_admin', name: 'QA admin', role: 'admin', team: null };
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffIdentity(page, who, 'qa-admin-key');
  await refuseStubKeyProductionWrite(page);
  await page.addInitScript(() => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {} });
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (b, st) => route.fulfill({ status: st || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname;
    if (p === '/functions/v1/analytics-read') return json({ ok: true, principal: 'staff', authority: { source: 'syncview' }, clients: KASPER_ROWS });
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: who });
    if (p === '/functions/v1/client-profile-write') {
      const b = JSON.parse(r.postData() || '{}');
      if (b.action === 'list_managers') return json({ ok: true, managers: MANAGERS, assignments: { 'phone-fixture': 'managerone' } });
      return json({ ok: true });
    }
    if (p === '/functions/v1/client-onboarding') {
      const b = JSON.parse(r.postData() || '{}');
      if (b.action === 'create_preview') return json({ ok: true, ready: false, blockers: ['name_invalid'], managers: MANAGERS });
      return json({ ok: false, error: 'unknown_action' }, 400);
    }
    if (p === '/functions/v1/client-hubspot-sync') return json({ ok: true, skipped: 'not_enabled' });
    if (/rest\/v1/.test(p)) return json([]);
    if (/functions|webhook/.test(p)) return json({});
    return route.abort();
  });
  await page.goto(origin + '/#kasper', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _kasperGotoTab === 'function' && document.querySelector('[data-kasper-tab="clients"]'), null, { timeout: 25000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => _kasperGotoTab('clients'));
  await page.waitForFunction(() => document.querySelector('#caSearch') && _caState.loaded, null, { timeout: 20000 });
  await page.evaluate(() => _caSelect('phone-fixture'));
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}
const KASPER_SURFACES = [
  { area: 'Kasper', name: 'Clients tab: search results', opener: '#caSearch',
    open: async p => { await p.click('#caSearch'); await p.keyboard.type('q'); },
    isOpen: p => p.evaluate(() => { const m = document.getElementById('caSearchPop'); return !!m && !m.hidden; }), inside: '#caSearchWrap' },
  { area: 'Kasper', name: 'Clients tab: All clients list', opener: '#caAllBtn',
    open: async p => { await p.click('#caAllBtn'); },
    isOpen: p => p.evaluate(() => { const m = document.getElementById('caDrop'); return !!m && !m.hidden; }), inside: '#caDrop .ca-drop-head' },
  { area: 'Kasper', name: 'Clients tab: manager picker', opener: '#caMgrBtn',
    open: async p => { await p.click('#caMgrBtn'); },
    isOpen: p => p.evaluate(() => !!document.getElementById('caMgrPop')), inside: '#caMgrPop .ca-mgr-title' },
  { area: 'Kasper', name: 'New client dialog', opener: '#caNewBtn',
    open: async p => { await p.click('#caNewBtn'); await p.waitForSelector('.cn-dialog'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.cn-dialog')), inside: '.cn-dialog',
    // typing a name, then Escape: the box asks before it throws the text away, and keeps it if the answer is no
    type: { selector: '#cnName', text: 'Made Up Name', kept: p => p.evaluate(() => !!document.querySelector('.cn-dialog') && /Made Up Name/.test((document.getElementById('cnName') || {}).value || '')) } },
];

async function pass(browser, origin, label, viewport) {
  console.log(`--- ${label} (${viewport.width}px) ---`);
  const run = async (t, list) => { for (const s of list) await runSurface(t.page, s, label); };
  try {
    const prod = await productionPage(browser, origin, viewport);
    await run(prod, PROD_SURFACES);
    await openCard(prod.page);
    await run(prod, [DESC_SURFACE]);
    expect(prod.errors.length === 0, `[${label}] no page errors (Production)` + (prod.errors[0] ? ' : ' + prod.errors[0] : ''));
    await prod.ctx.close();

    const an = await plainPage(browser, origin, `${origin}/index.html`, viewport);
    await an.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
    await an.page.evaluate(() => navTo('templates'));
    await an.page.waitForSelector('#tplSearchInput', { timeout: 30000 }).catch(() => {});
    await an.page.waitForTimeout(800);
    await run(an, TEMPLATES_SURFACES);
    expect(an.errors.length === 0, `[${label}] no page errors (Templates)` + (an.errors[0] ? ' : ' + an.errors[0] : ''));
    await an.ctx.close();

    const k = await kasperPage(browser, origin, viewport);
    await run(k, KASPER_SURFACES);
    expect(k.errors.length === 0, `[${label}] no page errors (Kasper)` + (k.errors[0] ? ' : ' + k.errors[0] : ''));
    await k.ctx.close();
  } catch (e) {
    expect(false, `[${label}] raised: ` + String(e && e.message || e).slice(0, 260));
  }
}

async function workloadPass() {
  console.log('--- workload (1440px) ---');
  const h = await launchWorkloadHarness({
    issues: [parentRow({}), issueRow({ id: 's1', identifier: 'VID-S1', title: 'Card s1', due_date: WED, client_name: 'Client A' })],
    plans: [{ issue_id: 's1', plan_date: MON }],
  });
  try {
    await waitForPlanSettled(h.page);
    for (const s of WL_SURFACES) await runSurface(h.page, s, 'desktop');
    expect(h.state.pageErrors.length === 0, '[desktop] no page errors (Workload)' + (h.state.pageErrors[0] ? ' : ' + h.state.pageErrors[0] : ''));
  } catch (e) {
    expect(false, '[desktop] workload raised: ' + String(e && e.message || e).slice(0, 260));
  } finally { await h.close(); }
}

module.exports = { productionPage, plainPage, kasperPage, openCard, PROD_SURFACES, KASPER_SURFACES, TEMPLATES_SURFACES, WL_SURFACES, DESC_SURFACE };
if (require.main === module) (async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    await pass(browser, origin, 'desktop', { width: 1280, height: 1100 });
    await pass(browser, origin, 'phone', { width: 390, height: 844 });
    await workloadPass();
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(summary('popup-behaviour-areas-browser'));
})();
