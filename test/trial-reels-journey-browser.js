'use strict';
/*
 * TRIAL REELS, THE WHOLE JOURNEY OF ONE CARD, in real browsers, fully offline. Session Probe, 2026-10-27 (the
 * independent check of the Trials build; plan docs/features/TRIAL_REELS_PLAN.md).
 *
 * One card with five versions (Video A to E) goes through its whole life in one run, across every surface that
 * touches it:
 *   1. switch off for this client: the staff card, Production and the client link are today's, and nothing writes;
 *   2. the card's switch on; links pasted on the card (A, B, C) and in Production (D, E), each showing on the other;
 *   3. the SMM's Review tab: OKs on A and B, a change asked on C, Approve all on the rest; the card goes to Tweaks Needed;
 *   4. C's new cut pasted on the card: only C starts again (Q3); the SMM OKs C and today's Approve to Kasper runs;
 *   5. Kasper's Review Session: Approve all, then his approve moves the card to the client;
 *   6. the client link: two versions approved one at a time, the rest with Approve all; today's approve: Approved;
 *   7. the staff card: the trial starts, the 24 h timer, the trophy once it is up, the winner picked (today's attach
 *      first), Undo, the winner picked again;
 *   8. the client link shows only the winner;
 *   9. the card posts (today's path, not trial code) and every surface still carries the winner's one link;
 *  10. the card's switch off again: today's row, and the function refuses every write for a client the page switch
 *      does not list.
 * At every step it checks the card's status, each version's label, that the card's one link (the video sub-issue's
 * file_url and the card's asset_url) is one link that agrees with the version on the card, and the ledger rows.
 *
 * Two offline harnesses serve the pages (both fictional data only): docs/syncview-design/tests/lost-work-lib.js (the
 * staff Calendar and Production, with production-write's attach and the status bridge) and
 * test/fixtures/review-stage-fixture.js (the SMM's Review tab, Kasper's Review Session and the client link). They are
 * one card: both serve it as p_t1 with the video sub-issue del_vid_1, the test client under each harness's own slug,
 * and the card's status, link and notes are handed from one to the other at each step. The trial-reels function is
 * answered by ONE in-memory backend (below) that follows supabase/functions/trial-reels/index.ts step by step (auth,
 * page switch, card switch, the card's one link, stale-row checks, ledger rows) and its rules in logic.mjs.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');
const RS = require('./fixtures/review-stage-fixture.js');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const LINK = l => 'https://f.io/fixture-journey-' + l.toLowerCase();
const NEW_C = 'https://f.io/fixture-journey-c-cut-2';
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const SHOTS = process.env.TRIAL_JOURNEY_SHOTS || '';
const PID = 'p_t1';
const DID = 'del_vid_1';

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card(PID);
  const vid = S.deliv.find(d => d.id === DID);
  // The studio logged the five versions (no links yet); the card has no video yet.
  card.asset_url = ''; vid.file_url = '';
  card.video_tweaks = '[]';

  // ---------------- the one backend: trial-reels, as index.ts does it ----------------
  const TEST_SLUGS = ['fixtureclient', RS.SLUG];   // the test client, under each harness's own slug
  const W = {
    flagClients: [],             // trial_reel_pages' list
    sw: null,                    // trial_reel_cards row of p_t1
    versions: LETTERS.map((l, i) => ({ id: 'v' + l, client: 'fixtureclient', post_id: PID, letter: l, status: 'waiting', frame_url: null, revision: 0,
      hook: 'Fictional hook ' + l, smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, change_by: null, change_note: null, change_at: null,
      posted_at: null, trial_ends_at: null, updated_at: '2026-10-27T08:00:00.000Z' })),
    ledger: [], calls: [], writes: [], attaches: [], tick: 0,
  };
  const stamp = () => new Date(Date.parse('2026-10-27T09:00:00.000Z') + (++W.tick) * 1000).toISOString();
  const mainLink = () => String(vid.file_url || '').trim() || String(card.asset_url || '').trim();
  const CLIENT_ACTIONS = L.CLIENT_ACTIONS;
  function trialReels(b, headers) {
    const action = L.clean(b.action, 40).toLowerCase();
    const client = String(b.client || '').trim().toLowerCase();
    const postId = L.clean(b.post_id, 120);
    W.calls.push(Object.assign({ _client_link: !headers['x-syncview-key'] }, b));
    const refuse = (status, error) => ({ status, body: { ok: false, error } });
    if (!L.ACTIONS.includes(action)) return refuse(400, 'unknown_action');
    if (!client) return refuse(400, 'invalid_client');
    if (!postId && action !== 'list') return refuse(400, 'post_id_required');
    // principalFor: a staff key, a review token, or (read and answer only) a client link with neither (owner, Q5).
    const staffKey = headers['x-syncview-key'], token = headers['x-syncview-client-token'];
    if (staffKey && token) return refuse(401, 'ambiguous_credentials');
    let principal;
    if (staffKey) principal = { kind: 'staff', actor: 'staff:m1', role: 'admin' };
    else if (token) { if (token !== RS.TOKEN) return refuse(401, 'invalid_client_token'); principal = { kind: 'client', actor: 'client:' + client, role: 'client' }; }
    else if (CLIENT_ACTIONS.includes(action)) principal = { kind: 'client', actor: 'client:' + client, role: 'client' };
    else return refuse(401, 'credentials_required');
    if (principal.kind === 'client' && !CLIENT_ACTIONS.includes(action)) return refuse(403, 'staff_only');
    if (principal.kind === 'staff' && L.staffAllows && !L.staffAllows(principal.role, action)) return refuse(403, 'role_not_allowed');
    // assertSwitchOn
    if (!L.flagAllows({ clients: W.flagClients }, client)) return refuse(403, 'not_enabled');
    if (!TEST_SLUGS.includes(client)) return refuse(404, 'card_not_found');
    const isClient = principal.kind === 'client';
    const shape = () => L.readShape(W.versions, { client: isClient, mainLink: mainLink(), cardStatus: card.video_status });
    const heal = () => {
      const c = L.healMainPatch(W.versions, mainLink());
      if (!c) return;
      const now = stamp();
      Object.assign(W.versions.find(v => v.id === c.id), c.patch, { updated_at: now });
      W.writes.push({ action: 'heal', letter: c.letter });
      W.ledger.push(...L.ledgerRows(client, PID, [c], principal, now, 'version_link_set'));
    };
    if (action === 'list') {
      const cards = {};
      if (W.sw && W.sw.enabled) {
        if (!isClient) heal();
        cards[PID] = Object.assign({ enabled: true, winner_letter: W.sw.winner_letter || null }, shape());
      }
      return { status: 200, body: { ok: true, cards } };
    }
    if (postId !== PID) return refuse(404, 'card_not_found');
    const now = stamp();
    if (action === 'switch_set') {
      const enabled = b.enabled === true;
      W.sw = Object.assign(W.sw || { created_at: now, winner_letter: null }, { client, post_id: PID, enabled, updated_at: now, updated_by: principal.actor });
      W.writes.push({ action, enabled });
      W.ledger.push({ client, post_id: PID, ts: now, actor: principal.actor, role: principal.role, action: enabled ? 'trial_on' : 'trial_off', component: 'video', source: 'trial-reels', payload: null });
      return { status: 200, body: { ok: true, enabled } };
    }
    if (!W.sw || W.sw.enabled !== true) return refuse(409, 'trial_reels_off');
    if (!isClient) heal();
    if (action === 'read') {
      const out = Object.assign({ ok: true, enabled: true, winner_letter: W.sw.winner_letter || null }, shape());
      if (!isClient) {
        out.video_deliverable_id = card.video_deliverable_id || null;
        if (b.probe === true) out.link_states = Object.fromEntries(out.versions.map(v => [v.letter, v.frame_url ? { state: 'available', http_status: 200 } : { state: 'missing' }]));
      }
      return { status: 200, body: out };
    }
    const letter = L.clean(b.letter, 1).toUpperCase();
    let changes = [], extra = {}, r;
    if (action === 'answer') {
      const stage = isClient ? 'client' : L.clean(b.stage, 10).toLowerCase();
      r = L.answerPatches(W.versions, { stage, kind: L.clean(b.kind, 20).toLowerCase(), letter, note: b.note }, now);
      if (r.error) return refuse(400, r.error);
      changes = r.patches;
    } else if (action === 'version_link_set') {
      r = L.linkPatch(W.versions, letter, b.link, mainLink());
      if (r.error) return refuse(r.error === 'attach_first' ? 409 : 400, r.error);
      const v = W.versions.find(x => x.letter === letter);
      if (r.patch) changes = [{ id: v.id, letter, from: v.status, patch: r.patch }];
      extra = { restarted: !!r.restarted };
    } else if (action === 'version_drop' || action === 'version_restore') {
      r = L.dropPatch(W.versions, letter, action === 'version_restore');
      if (r.error) return refuse(400, r.error);
      const v = W.versions.find(x => x.letter === letter);
      if (r.patch) changes = [{ id: v.id, letter, from: v.status, patch: r.patch }];
    } else if (action === 'trial_start') {
      r = L.trialPatches(W.versions, W.nowMs || Date.now());
      if (r.error) return refuse(400, r.error);
      changes = r.patches;
    } else if (action === 'winner_set') {
      r = L.winnerPatches(W.versions, letter, mainLink(), { nowMs: Date.now(), cardStatus: card.video_status });
      if (r.error) return refuse(r.error === 'attach_first' ? 409 : 400, r.error);
      changes = r.patches;
    } else if (action === 'winner_undo') {
      r = L.undoWinnerPatches(W.versions, mainLink(), { cardStatus: card.video_status });
      if (r.error) return refuse(r.error === 'attach_first' ? 409 : 400, r.error);
      changes = r.patches;
    }
    for (const c of changes) Object.assign(W.versions.find(v => v.id === c.id), c.patch, { updated_at: now });
    if (action === 'winner_set' || action === 'winner_undo') Object.assign(W.sw, { winner_letter: action === 'winner_set' ? letter : null, updated_at: now, updated_by: principal.actor });
    if (changes.length) {
      W.writes.push({ action, letters: changes.map(c => c.letter) });
      W.ledger.push(...L.ledgerRows(client, PID, changes, principal, now, action === 'answer' ? L.clean(b.kind, 20).toLowerCase() : action));
    }
    return { status: 200, body: Object.assign({ ok: true, changed: changes.map(c => c.letter) }, extra, shape()) };
  }
  async function routeTrialReels(ctx) {
    await ctx.route('**/functions/v1/trial-reels', async route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      const out = trialReels(b, r.headers());
      return route.fulfill({ status: out.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(out.body) });
    });
  }

  // ---------------- checks used at every step ----------------
  const V = l => W.versions.find(v => v.letter === l);
  const statuses = () => W.versions.map(v => v.letter + ':' + v.status).join(' ');
  const ledgerSince = n => W.ledger.slice(n).map(r => r.action + (r.payload ? '(' + r.payload.letter + ')' : '')).join(' ');
  function oneLink(step) {
    const sh = L.readShape(W.versions, { client: false, mainLink: mainLink(), cardStatus: card.video_status });
    const main = sh.versions.find(v => v.on_card);
    const fileUrl = String(vid.file_url || ''), assetUrl = String(card.asset_url || '');
    ok(fileUrl === assetUrl && (!main || !fileUrl || (main.frame_url === fileUrl && V(main.letter).frame_url === fileUrl)) && !sh.main_copy_behind,
      `${step}: one link: file_url = asset_url = Video ${main ? main.letter : '?'}'s link (${fileUrl.replace('https://f.io/fixture-journey-', '…') || 'none'})`);
  }
  function noWritesSince(n, step) {
    const w = W.writes.slice(n);
    ok(!w.length, `${step}: nothing was written (${JSON.stringify(w)})`);
  }

  // ---------------- the staff side (lost-work harness) ----------------
  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: k === 'trial_reels_pages' ? { clients: W.flagClients.length ? W.flagClients : ['someotherclient'] }
        : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await routeTrialReels(S.ctx);
  // production-write: the attach, as the database does it (file_url, then the projection onto the card's link), and
  // the sub-issue's asset read (its file_url opens).
  await S.ctx.route('**/functions/v1/production-write{,?*}', async route => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    const reply = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(o) });
    if (r.method() === 'POST' && b.operation === 'attachment') {
      W.attaches.push({ id: b.id, file_url: b.file_url });
      if (b.id !== DID) return reply({ ok: false, error: 'scope_forbidden' }, 403);
      if (b.expected_updated_at !== vid.updated_at) return reply({ ok: false, error: 'write_conflict', conflict: true }, 409);
      vid.file_url = b.file_url; vid.updated_at = stamp();
      card.asset_url = b.file_url;   // the projection (production_artifact_write)
      return reply({ ok: true, native_committed: true, row: { ...vid } });
    }
    if (r.method() === 'POST' && b.action === 'asset_access_read') {
      const file = b.id === DID ? mainLink() : null;
      return reply({ ok: true, complete: true, id: b.id, client_slug: b.client_slug, team: 'video', assets: [{ slot: 'filming_plan', state: 'missing', url: null }, { slot: 'raw_footage', state: 'missing', url: null },
        { slot: 'delivery_folder', state: 'missing', url: null }, { slot: 'deliverable_file', state: file ? 'available' : 'missing', url: file, http_status: file ? 200 : undefined }] });
    }
    return route.fallback();
  });
  const heightOf = page => page.evaluate(() => { const c = [...document.querySelectorAll('#calView .cal-card')].find(n => n.offsetParent); return c ? Math.round(c.getBoundingClientRect().height * 10) / 10 : 0; });
  const rowText = page => page.evaluate(() => { const f = [...document.querySelectorAll('.cal-link-field.cal-link-post')].find(n => n.offsetParent); return f ? f.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const listRows = page => page.$$eval('.trl-list .trl-v', ns => ns.map(n => ({ t: n.innerText.replace(/\s+/g, ' ').trim(), lab: ((n.querySelector('.trl-lab') || {}).textContent || '').trim(),
    href: (n.querySelector('.trl-go') || {}).href || '', pick: !!n.querySelector('.trl-pick') })));
  async function shot(page, name) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false });
  }
  async function openCal() {
    const page = await S.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await S.openCalendar(page);
    await sleep(1500);
    return page;
  }
  async function openList(page) {
    if (!(await page.$('.trl-list'))) { await page.click('.cal-link-post .trl-chev'); await sleep(300); }
  }
  async function pasteOnCard(page, letter, link, change) {
    await openList(page);
    const i = LETTERS.indexOf(letter) + 1;
    if (change) { await page.hover('.trl-list .trl-v:nth-child(' + i + ')'); await page.click('.trl-list .trl-v:nth-child(' + i + ') .trl-ico[title="Change the link"]'); }
    else await page.click('.trl-list .trl-v:nth-child(' + i + ') .trl-paste');
    await page.fill('.trl-link-input', link);
    await page.keyboard.press('Enter');
    await sleep(1200);
  }
  async function openProd() {
    const page = await S.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await S.openProduction(page);
    await page.evaluate(x => _prodOpenDeliverable(x), DID);
    await sleep(2000);
    return page;
  }
  const prodRows = page => page.evaluate(() => [...document.querySelectorAll('.prod-assets-list .prod-asset-row')].filter(n => n.offsetParent).map(n => ({
    label: (n.querySelector('.prod-asset-label') || {}).textContent || '',
    value: ((n.querySelector('.prod-asset-value') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
    href: (n.querySelector('.prod-asset-value a') || {}).href || '',
    trial: n.classList.contains('trl-prod-v'), today: n.getAttribute('data-prod-asset-slot') === 'deliverable_file',
  })));
  async function pasteInProd(page, letter, link) {
    await page.click('.trl-prod-v[data-trl-slot="' + letter + '"] .prod-asset-edit');
    await sleep(300);
    await page.fill('[data-trl-input]', link);
    await page.click('[data-trl-editor="' + letter + '"] .prod-assets-save');
    await sleep(1500);
  }

  // ---------------- the review side (review-stage fixture) ----------------
  const rserver = await serveStatic();
  const rorigin = 'http://127.0.0.1:' + rserver.address().port;
  const rbrowser = await chromium.launch();
  const rcard = Object.assign(RS.cards('client')[0], { id: PID, name: card.name, video_deliverable_id: DID, video_tweaks: '[]' });
  const rstate = { cards: [rcard], upserts: [], gateway: [], flagReads: 0, orient: 'p', writeDelay: 0, writeFail: 0, native: {}, receipts: {}, writeAttempts: 0 };
  // The handover: the review pages see the card as the staff side left it, and the staff side gets what they saved.
  function toReview(asStatus) {
    Object.assign(rcard, { video_status: asStatus || card.video_status, status: asStatus || card.video_status, graphic_status: 'Approved', caption_status: 'Approved',
      asset_url: card.asset_url, video_tweaks: card.video_tweaks || '[]' });
  }
  const SLUG_TO = { tweak: 'Tweaks Needed', smm_approval: 'For SMM Approval', kasper_approval: 'Kasper Approval', client_approval: 'Client Approval', approved: 'Approved' };
  function videoStatusSent(n0, g0) {
    let st = '';
    // The video part's status, or the card's own status where today's save moves only that (the SMM's change request).
    rstate.upserts.slice(n0).forEach(u => { if (u.id === PID && (u.video_status || u.status)) st = u.video_status || u.status; });
    rstate.gateway.slice(g0).forEach(raw => { try { const b = JSON.parse(raw); if (b.operation === 'status' && SLUG_TO[b.status]) st = SLUG_TO[b.status]; } catch (e) {} });
    return st;
  }
  function fromReview(n0, g0) {
    const st = videoStatusSent(n0, g0);
    const patch = { video_tweaks: rcard.video_tweaks };
    if (st) patch.video_status = st;
    S.setCardField(PID, patch, 'review-page');
    return st;
  }
  async function openReview(mode, asStatus, calendarOnly) {
    toReview(asStatus);
    const t = await RS.open(rbrowser, rorigin, Object.assign({ stage: mode, state: rstate, flags: 'on', flagValues: { trial_reels_pages: { clients: W.flagClients.length ? W.flagClients : ['someotherclient'] } } },
      mode !== 'client' ? { staff: RS.STAFF } : {}));
    await routeTrialReels(t.ctx);
    if (mode === 'client') {
      await t.page.goto(rorigin + '/index.html?' + new URLSearchParams({ c: RS.CLIENT, v: 'calendar', t: RS.TOKEN }), { waitUntil: 'domcontentloaded' });
    } else if (mode === 'kasper') {
      await t.page.goto(rorigin + '/index.html', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, RS.CLIENT);
    } else {
      await t.page.goto(rorigin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, RS.CLIENT);
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t.page.evaluate(() => onCalViewChange('smmreview'));
    }
    if (calendarOnly) await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
    else await RS.waitNew(t);
    await sleep(1500);
    t.n0 = rstate.upserts.length; t.g0 = rstate.gateway.length;
    return t;
  }
  const bar = t => t.page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const b = r.querySelector('.trv');
    return {
      text: b ? b.innerText.replace(/\s+/g, ' ').trim() : '',
      dots: b ? [...b.querySelectorAll('.trv-dot i')].map(i => i.className || 'wait') : [],
      ok: ((r.querySelector('[data-ok="video"]') || {}).textContent || '').trim(),
      hook: /Fictional hook/.test(r.innerHTML),
    };
  });
  const until = async (f, n) => { for (let i = 0; i < (n || 80) && !(await f()); i++) await sleep(100); return f(); };
  async function approveOnScreen(t) {
    const c0 = W.calls.length;
    await RS.inS(t.page, '[data-ok="video"]').click();
    await until(() => W.calls.slice(c0).some(c => c.action === 'answer'));
    await sleep(900);
  }
  async function approveAll(t, settle) {
    const c0 = W.calls.length;
    await RS.inS(t.page, '.trv [data-trv-all]').click();
    await until(() => W.calls.slice(c0).some(c => c.kind === 'approve_all'));
    await until(settle || (() => false), 60);
    await sleep(600);
  }
  async function go(t, letter) { await RS.inS(t.page, '.trv [data-trv-go="' + letter + '"]').click(); await sleep(600); }

  try {
    // ============ 1. switch off for this client: today's everywhere, nothing writes ============
    let page = await openCal();
    ok(!(await page.$('.trl-sw-slot, .trl-main, .trl-list')), '1 switch off: the staff card is today\'s (no trial control)');
    const todayNoLinkH = await heightOf(page);
    await page.close();
    // Today's height of the same card WITH a video link: the baseline for a trial card (its row is a link row).
    card.asset_url = 'https://f.io/fixture-journey-baseline';
    page = await openCal();
    const todayH = await heightOf(page);
    await page.close();
    card.asset_url = '';
    console.log('     (today\'s card: ' + todayNoLinkH + ' px with no video link, ' + todayH + ' px with one)');
    page = await openProd();
    let pr = await prodRows(page);
    ok(pr.some(x => x.today && x.label === 'Deliverable file') && !pr.some(x => x.trial), '1 switch off: Production\'s Assets are today\'s single Deliverable file row');
    await page.close();
    // (Shown to the client as if it waited for the client, so the review page has the card to show.)
    let t = await openReview('client', 'Client Approval');
    let b = await bar(t);
    ok(!b.text && /Approve the video/.test(b.ok), '1 switch off: the client link is today\'s page (no version bar)');
    await t.ctx.close();
    ok(!W.calls.length && !W.writes.length && !W.ledger.length, `1 switch off: the function is never asked and nothing is written (${W.calls.length} calls)`);

    // ============ 2. switch on; links pasted on the card and in Production ============
    W.flagClients = TEST_SLUGS.slice();
    page = await openCal();
    let c0 = W.calls.length;
    await page.click('.cal-link-post .trl-sw-slot');
    await sleep(1200);
    ok(W.sw && W.sw.enabled === true && W.ledger.some(r => r.action === 'trial_on'), '2 the card\'s switch: on, with a "trial_on" ledger row');
    let txt = await rowText(page);
    ok(/Video · 5/.test(txt) && /0\/5 approved/.test(txt), `2 the row reads "Video · 5", "0/5 approved" (${txt})`);
    let hNow = await heightOf(page);
    ok(Math.abs(hNow - todayH) < 0.5, `2 collapsed, the card keeps today's height (${todayH} → ${hNow})`);
    let l0 = W.ledger.length;
    await pasteOnCard(page, 'A', LINK('A'));
    ok(W.attaches.length === 1 && W.attaches[0].file_url === LINK('A') && V('A').frame_url === LINK('A'), '2 Video A (on the card): today\'s attach first, then its own link');
    oneLink('2 after A');
    await pasteOnCard(page, 'B', LINK('B'));
    await pasteOnCard(page, 'C', LINK('C'));
    ok(V('B').frame_url === LINK('B') && V('C').frame_url === LINK('C') && W.attaches.length === 1, '2 Video B and C pasted on the card touch only their own links (no attach)');
    ok(ledgerSince(l0) === 'trial_version_link_set(A) trial_version_link_set(B) trial_version_link_set(C)', `2 ledger: one row per pasted link (${ledgerSince(l0)})`);
    await page.close();
    page = await openProd();
    pr = (await prodRows(page)).filter(x => x.trial);
    ok(pr.map(x => x.label.slice(-1)).join('') === 'ABCDE' && pr[0].today && pr[0].href === LINK('A') && pr[1].href === LINK('B') && pr[2].href === LINK('C') && /Not provided/.test(pr[3].value),
      '2 Production shows the links pasted on the card, one row per version, A on today\'s row (' + JSON.stringify(pr) + ')');
    await pasteInProd(page, 'D', LINK('D'));
    await pasteInProd(page, 'E', LINK('E'));
    ok(V('D').frame_url === LINK('D') && V('E').frame_url === LINK('E') && W.calls.filter(c => c.action === 'version_link_set' && /^[DE]$/.test(c.letter)).length === 2, '2 Video D and E pasted in Production');
    await page.close();
    page = await openCal();
    await openList(page);
    let rows = await listRows(page);
    ok(rows.length === 5 && rows.every((r, i) => r.href === LINK(LETTERS[i])) && rows.every(r => !r.lab), '2 the card shows the links pasted in Production; no label while every version waits (no visual noise)');
    oneLink('2 all links in');
    await page.close();

    // ============ 3. the SMM: OKs on A and B, a change on C, Approve all on the rest ============
    S.setCardField(PID, { video_status: 'For SMM Approval', status: 'For SMM Approval' }, 'editor');
    l0 = W.ledger.length;
    t = await openReview('smm');
    b = await bar(t);
    ok(/^Video A of 5/.test(b.text) && !b.hook, `3 SMM: "Video A of 5", no hook text (${b.text})`);
    await approveOnScreen(t);
    await approveOnScreen(t);
    ok(!!V('A').smm_ok_at && !!V('B').smm_ok_at && !V('C').smm_ok_at && !videoStatusSent(t.n0, t.g0), '3 SMM: A and B OK\'d one at a time; the card waits');
    await go(t, 'D');
    await approveOnScreen(t);
    b = await bar(t);
    if (!/^Video E/.test(b.text)) await go(t, 'E');
    await approveOnScreen(t);
    ok(['A', 'B', 'D', 'E'].every(l => V(l).smm_ok_at) && !V('C').smm_ok_at && !/Kasper Approval/.test(videoStatusSent(t.n0, t.g0)),
      '3 SMM: D and E OK\'d too; C still waits, so the card is not sent to Kasper');
    await go(t, 'C');
    await RS.inS(t.page, '[data-chg="video"]').click();
    await RS.inS(t.page, '#ta').fill('Fictional note: the hook word should land on the beat.');
    await RS.inS(t.page, '#sendBtn').click();
    await until(() => V('C').status === 'change asked' && /Tweaks Needed/.test(videoStatusSent(t.n0, t.g0)));
    ok(V('C').status === 'change asked' && V('C').change_by === 'smm' && ['A', 'B', 'D', 'E'].every(l => V(l).status === 'waiting'), '3 SMM: a change asked on Video C is on C only');
    if (process.env.JOURNEY_DEBUG) console.log('DEBUG upserts', JSON.stringify(rstate.upserts.slice(t.n0)).slice(0, 1500), 'gateway', JSON.stringify(rstate.gateway.slice(t.g0)).slice(0, 1500));
    let st = fromReview(t.n0, t.g0);
    ok(st === 'Tweaks Needed' && /Video C: Fictional note/.test(String(card.video_tweaks || '')), `3 today's change request starts "Video C:" and the card goes to Tweaks Needed (${st})`);
    ok(ledgerSince(l0) === 'trial_approve(A) trial_approve(B) trial_approve(D) trial_approve(E) trial_change(C)', `3 ledger: ${ledgerSince(l0)}`);
    await t.ctx.close();
    S.setCardField(PID, { video_status: 'Tweaks Needed', status: 'Tweaks Needed' }, 'review-page');

    // ============ 4. C's new cut: only C starts again (Q3); the SMM OKs it; Approve to Kasper ============
    page = await openCal();
    l0 = W.ledger.length;
    await pasteOnCard(page, 'C', NEW_C, true);
    ok(V('C').frame_url === NEW_C && V('C').status === 'waiting' && V('C').revision === 1 && !V('C').smm_ok_at && !V('C').change_note, '4 C\'s new link: C back to waiting, revision 1, its OKs and change cleared');
    ok(['A', 'B', 'D', 'E'].every(l => V(l).smm_ok_at && V(l).status === 'waiting'), '4 the other versions keep their answers');
    ok(ledgerSince(l0) === 'trial_version_link_set(C)', `4 ledger: ${ledgerSince(l0)}`);
    await openList(page);
    rows = await listRows(page);
    ok(rows[2].href === NEW_C, '4 the card\'s Video C row opens the new cut');
    oneLink('4');
    await page.close();
    S.setCardField(PID, { video_status: 'For SMM Approval', status: 'For SMM Approval' }, 'editor');
    t = await openReview('smm');
    b = await bar(t);
    ok(/^Video C of 5/.test(b.text), `4 SMM: the page opens on the one version waiting for the SMM (${b.text})`);
    await approveOnScreen(t);
    await until(() => /Kasper Approval/.test(videoStatusSent(t.n0, t.g0)));
    st = fromReview(t.n0, t.g0);
    ok(!!V('C').smm_ok_at && st === 'Kasper Approval', `4 SMM: C OK'd, the stage is done, today's Approve to Kasper (${st})`);
    await t.ctx.close();

    // ============ 5. Kasper: Approve all, then his approve sends the card to the client ============
    l0 = W.ledger.length;
    t = await openReview('kasper');
    b = await bar(t);
    ok(/^Video A of 5/.test(b.text), `5 Kasper: the same bar (${b.text})`);
    await approveAll(t, () => !!videoStatusSent(t.n0, t.g0));
    st = fromReview(t.n0, t.g0);
    ok(W.versions.every(v => v.kasper_ok_at), '5 Kasper: Approve all OKs every version');
    ok(st === 'Client Approval', `5 Kasper: then today's approve moves the card to the client (${st})`);
    ok(ledgerSince(l0) === LETTERS.map(l => 'trial_approve_all(' + l + ')').join(' '), `5 ledger: ${ledgerSince(l0)}`);
    await t.ctx.close();

    // ============ 6. the client: two one at a time, the rest with Approve all; Approved ============
    l0 = W.ledger.length;
    t = await openReview('client');
    b = await bar(t);
    ok(/^Video A of 5/.test(b.text) && b.ok === 'Approve Video A' && !b.hook, `6 client: "Video A of 5", "Approve Video A", no hook text (${b.text} / ${b.ok})`);
    await approveOnScreen(t);
    b = await bar(t);
    ok(V('A').status === 'approved' && /^Video B of 5/.test(b.text) && !videoStatusSent(t.n0, t.g0), `6 client: A approved, on to B, the card waits (${b.text})`);
    await approveOnScreen(t);
    ok(V('B').status === 'approved' && !videoStatusSent(t.n0, t.g0), '6 client: B approved, the card still waits');
    await approveAll(t, () => videoStatusSent(t.n0, t.g0) === 'Approved');
    st = fromReview(t.n0, t.g0);
    ok(W.versions.every(v => v.status === 'approved' && v.client_ok_at), `6 client: Approve all approves C, D and E (${statuses()})`);
    ok(st === 'Approved', `6 client: today's approve moves the card to Approved (${st})`);
    ok(ledgerSince(l0) === 'trial_approve(A) trial_approve(B) trial_approve_all(C) trial_approve_all(D) trial_approve_all(E)', `6 ledger: ${ledgerSince(l0)}`);
    ok(W.calls.filter(c => c.action === 'answer' && c._client_link).every(c => !c.stage || c.stage === 'client'), '6 the client link only ever answers as the client');
    ok(!t.errors.length, '6 client: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
    oneLink('6');

    // ============ 7. the trial, the timer, the trophy, the winner, Undo, the winner again ============
    page = await openCal();
    txt = await rowText(page);
    ok(/5\/5 approved/.test(txt), `7 the card reads "5/5 approved" (${txt})`);
    await openList(page);
    l0 = W.ledger.length;
    await page.click('.trl-list .trl-start');
    await sleep(1200);
    ok(W.versions.every(v => v.status === 'on trial' && v.posted_at && v.trial_ends_at && Date.parse(v.trial_ends_at) - Date.parse(v.posted_at) === 24 * 3600000), '7 "Start the 24 h": every approved version on trial, ends 24 h after');
    ok(ledgerSince(l0) === LETTERS.map(l => 'trial_trial_start(' + l + ')').join(' '), `7 ledger: ${ledgerSince(l0)}`);
    await page.close();
    page = await openCal();
    txt = await rowText(page);
    ok(/On trial · 2[34] h left/.test(txt) && !(await page.$('.cal-link-post .trl-state-ico')), `7 the timer, inside the Video row (${txt})`);
    hNow = await heightOf(page);
    ok(Math.abs(hNow - todayH) < 0.5, `7 on trial, collapsed: today's height (${todayH} → ${hNow})`);
    await shot(page, 'journey-trial');
    await page.close();
    // 24 h later.
    const past = new Date(Date.now() - 60000).toISOString();
    W.versions.forEach(v => { v.trial_ends_at = past; });
    page = await openCal();
    txt = await rowText(page);
    const trophy = await page.$('.cal-link-post .trl-state-ico[title="Trial over: pick the winner"]');
    ok(!!trophy && !/winner|pick|on trial/i.test(txt), `7 24 h up: only the muted trophy, no words (${txt})`);
    hNow = await heightOf(page);
    ok(Math.abs(hNow - todayH) < 0.5, `7 due, collapsed: today's height (${todayH} → ${hNow})`);
    await trophy.click();
    await sleep(300);
    rows = await listRows(page);
    ok(rows.filter(r => r.pick).length === 5 && rows.every(r => !r.lab), '7 the trophy opens the list: a trophy on every version, no "on trial" labels');
    await shot(page, 'journey-due-open');
    l0 = W.ledger.length;
    let a0 = W.attaches.length;
    await page.click('.trl-list .trl-v:nth-child(4) .trl-pick');
    await sleep(1500);
    ok(W.attaches.slice(a0).map(a => a.file_url).join('|') === LINK('D') && V('D').status === 'winner' && W.versions.filter(v => v.status === 'lost').length === 4 && W.sw.winner_letter === 'D',
      '7 Video D: today\'s attach first, then the winner; the others lost; the switch row has the letter');
    oneLink('7 winner D');
    const toast = await page.evaluate(() => { const x = [...document.querySelectorAll('.sv-toast')].pop(); return x ? x.innerText.replace(/\s+/g, ' ').trim() : ''; });
    ok(/Video D is the winner/.test(toast) && /Undo/.test(toast) && !(await page.$('#confirmOverlay.active')), `7 no confirm; today's toast offers Undo (${toast})`);
    await page.evaluate(() => { const x = [...document.querySelectorAll('.sv-toast button')].find(n => /Undo/.test(n.textContent)); if (x) x.click(); });
    await sleep(1500);
    ok(W.versions.every(v => v.status === 'on trial') && W.sw.winner_letter === null && vid.file_url === LINK('A'), '7 Undo: Video A back on the card through today\'s attach, every version back on trial');
    oneLink('7 after Undo');
    await openList(page);
    a0 = W.attaches.length;
    await page.click('.trl-list .trl-v:nth-child(5) .trl-pick');
    await sleep(1500);
    ok(V('E').status === 'winner' && W.sw.winner_letter === 'E' && W.attaches.slice(a0).map(a => a.file_url).join('|') === LINK('E'), '7 the winner picked again: Video E');
    oneLink('7 winner E');
    ok(ledgerSince(l0) === 'trial_winner_set(A) trial_winner_set(B) trial_winner_set(C) trial_winner_set(D) trial_winner_set(E) '
      + 'trial_winner_undo(A) trial_winner_undo(B) trial_winner_undo(C) trial_winner_undo(D) trial_winner_undo(E) '
      + 'trial_winner_set(A) trial_winner_set(B) trial_winner_set(C) trial_winner_set(D) trial_winner_set(E)', `7 ledger: ${ledgerSince(l0)}`);
    await page.close();
    page = await openCal();
    txt = await rowText(page);
    ok(/^Video E\b/.test(txt) && !/winner/.test(txt), `7 the collapsed row just says "Video E" (${txt})`);
    await openList(page);
    rows = await listRows(page);
    ok(rows.map(r => r.lab).join(',') === ',,,,winner', `7 the open list: "winner" on E only, no "lost" labels (${rows.map(r => r.lab).join(',')})`);
    await shot(page, 'journey-winner-open');
    await page.close();
    page = await openProd();
    pr = (await prodRows(page)).filter(x => x.trial);
    ok(pr.length === 5 && pr[4].today && pr[4].href === LINK('E') && /winner/.test(pr[4].value) && !pr.some(x => /lost|on the card/.test(x.value)), '7 Production: the winner\'s row is today\'s row, "winner", no "lost", no "on the card" (' + JSON.stringify(pr) + ')');
    await page.close();

    // ============ 8. the client sees only the winner ============
    const w8 = W.writes.length;
    // The card is Approved, so the client link shows it in the client's calendar (no review step waits for them).
    t = await openReview('client', null, true);
    const seen = await t.page.evaluate(id => {
      const p = (calState.posts || []).find(x => x.id === id);
      return { link: p ? p.asset_url : '', html: document.documentElement.outerHTML };
    }, PID);
    ok(seen.link === LINK('E'), `8 client link: the card's video is the winner's link (${String(seen.link).replace('https://f.io/fixture-journey-', '…')})`);
    ok(!['A', 'B', 'C', 'D'].some(l => seen.html.includes(LINK(l))) && !seen.html.includes(NEW_C), '8 client link: no other version\'s link anywhere on the page');
    await t.ctx.close();
    // And if the card is reopened for the client's review, only the winner shows.
    t = await openReview('client', 'Client Approval');
    b = await bar(t);
    ok(b.text === 'Video E: the one we are posting' && !b.dots.length, `8 client review: only "Video E: the one we are posting" (${b.text})`);
    await t.ctx.close();
    const clientRead = trialReels({ action: 'read', client: RS.SLUG, post_id: PID }, {});
    ok(clientRead.status === 200 && clientRead.body.versions.length === 1 && clientRead.body.versions[0].letter === 'E' && clientRead.body.versions[0].frame_url === LINK('E') && !('hook' in clientRead.body.versions[0]),
      '8 a client read answers only the winner, with no hook and the card\'s one link');
    noWritesSince(w8, '8 the client opening the page');

    // ============ 9. the card posts (today's path) ============
    const w9 = W.writes.length;
    S.setCardField(PID, { video_status: 'Posted', status: 'Posted', posted_at: new Date().toISOString() }, 'posted');
    page = await openCal();
    txt = await rowText(page);
    ok(/^Video E\b/.test(txt), `9 posted: the card still says "Video E" (${txt})`);
    await page.close();
    oneLink('9 posted');
    noWritesSince(w9, '9 posting is today\'s path; the trial wrote nothing');
    // Once posted, the winner stands: neither Undo nor another pick moves the card's link.
    const late = [trialReels({ action: 'winner_undo', client: RS.SLUG, post_id: PID }, { 'x-syncview-key': 'qa-key' }),
      trialReels({ action: 'winner_set', client: RS.SLUG, post_id: PID, letter: 'A' }, { 'x-syncview-key': 'qa-key' })];
    ok(late.every(r => r.status >= 400) && V('E').status === 'winner' && W.writes.length === w9, `9 posted: Undo and another pick are refused (${late.map(r => r.status + ' ' + r.body.error).join(', ')})`);

    // ============ 10. switch the card off; a client the page switch does not list ============
    page = await openCal();
    await page.click('.cal-link-post .trl-sw-slot.on');
    await sleep(1200);
    ok(W.sw.enabled === false && !(await page.$('.trl-main, .trl-list')) && !!(await page.$('.cal-link-post .trl-sw-slot[aria-checked="false"]')), '10 the card\'s switch off: today\'s row plus the faint switch');
    ok(vid.file_url === LINK('E') && card.asset_url === LINK('E'), '10 and the card keeps the winner\'s one link');
    await page.close();
    const w10 = W.writes.length;
    for (const action of ['answer', 'version_link_set', 'trial_start', 'winner_set', 'winner_undo', 'version_drop']) {
      const r = trialReels({ action, client: RS.SLUG, post_id: PID, kind: 'approve', letter: 'A', link: LINK('A') }, { 'x-syncview-key': 'qa-key' });
      ok(r.status === 409 && r.body.error === 'trial_reels_off', `10 card switch off: ${action} refused (${r.status} ${r.body.error})`);
    }
    W.flagClients = ['someotherclient'];
    for (const action of ['switch_set', 'answer', 'version_link_set', 'winner_set']) {
      const r = trialReels({ action, client: RS.SLUG, post_id: PID, enabled: true, kind: 'approve', letter: 'A', link: LINK('A') }, { 'x-syncview-key': 'qa-key' });
      ok(r.status === 403 && r.body.error === 'not_enabled', `10 client not listed: ${action} refused (${r.status} ${r.body.error})`);
    }
    for (const action of ['switch_set', 'version_link_set', 'trial_start', 'winner_set', 'winner_undo', 'version_drop']) {
      const r = trialReels({ action, client: RS.SLUG, post_id: PID, enabled: true }, {});
      ok(r.status === 401 || r.status === 403, `10 a client link cannot ${action} (${r.status} ${r.body.error})`);
    }
    noWritesSince(w10, '10 switch off or client not listed');
    page = await openCal();
    ok(!(await page.$('.trl-sw-slot, .trl-main, .trl-list')), '10 client not listed: the staff card is today\'s');
    const c10 = W.calls.length;
    await page.close();
    ok(W.calls.slice(c10).every(c => c.action === 'list' || c.action === 'read'), '10 the page sends no trial write for a client not listed');
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
    await rbrowser.close();
    rserver.close();
  }
  console.log(`trial-reels-journey-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
