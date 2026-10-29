'use strict';
/*
 * TRIAL REELS, EVERY ACTION ON EVERY SURFACE, in real browsers, fully offline. Session Allactions, 2026-10-28.
 *
 * Why: Sidney pressed a version row's edit pencil on the staff card, did nothing, pressed Escape, and the versions
 * list was drawn twice (then the copy went away). No test caught it, because each test walks the happy path of one
 * feature. His words: "we need to test every single action possible and make sure to see what happens, and I mean
 * everything: changing links, removing, dropping, whatever."
 *
 * This walks the matrix of actions on a trial card, surface by surface, and after EVERY step asserts the same
 * invariants (inv() below):
 *   - one Video row and at most one versions list for the card, no letter twice, no "Paste" row twice;
 *   - nothing left half-drawn: no link box still open, no row still busy, no field stuck in "editing";
 *   - what the list shows is what the backend holds (each version's link, the count, the state on the collapsed row);
 *   - the card's one link: file_url = asset_url = the version on the card's link;
 *   - no page errors;
 *   - no write when nothing changed (Escape, click away, Save with the same link, Cancel).
 * Surfaces: the staff Calendar card at 1440 and 390, Production's Assets rows, the SMM's Review tab, Kasper's review
 * (standard layout and layout 2), the client link at 1440 and 390, and the Notes player. Plus slow and refused server
 * answers, double clicks, two tabs at once and a reload in the middle of a write.
 *
 * One in-memory backend answers the trial-reels function for every page (as supabase/functions/trial-reels/index.ts
 * does, step by step, with its rules from logic.mjs), so every surface sees one card. Fixtures are fictional
 * (docs/syncview-design/tests/lost-work-lib.js for the staff side, test/fixtures/review-stage-fixture.js for the
 * review pages).
 *
 * KNOWN: checks that fail on main because of a finding not fixed yet are listed in KNOWN with the finding id
 * (OPEN_REPAIRS 576). They print "KNOWN" and do not fail the run, so the rest of the matrix stays a gate. When the
 * fix lands, delete its line: a KNOWN check that passes prints "NOW PASSES" so it is easy to see.
 *   MATRIX_ONLY=card,prod,review,notes,tabs   runs only those parts.
 *   MATRIX_STRICT=1                            fails on KNOWN checks too (to watch a fix).
 */
const path = require('path');
const { chromium } = require('playwright');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');
const RS = require('./fixtures/review-stage-fixture.js');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');

// Finding id -> the check ids it makes fail on main. Trials removes a line when it fixes the finding.
const KNOWN = {
  // None open. 576a (pencil then Escape drew the list twice), 576b (a double click on Approve answered the next
  // version) and 576c (the client shown a server code) were fixed by #2412 as 573, 574 and 575; their checks are real.
};
const KNOWN_IDS = new Map(Object.entries(KNOWN).flatMap(([f, ids]) => ids.map(id => [id, f])));
const STRICT = !!process.env.MATRIX_STRICT;
const ONLY = new Set(String(process.env.MATRIX_ONLY || 'card,prod,review,notes,tabs').split(',').map(s => s.trim()).filter(Boolean));

const failures = [], known = [], nowPass = [];
let passed = 0;
function ok(id, c, m) {
  const f = KNOWN_IDS.get(id);
  if (c) { passed++; if (f) { nowPass.push(id + ' (' + f + ')'); console.log('  NOW PASSES  [' + id + '] ' + m + '  (un-mark ' + f + ')'); } else console.log('  ok  [' + id + '] ' + m); return true; }
  if (f && !STRICT) { known.push(id + ' (' + f + ')'); console.log('  KNOWN ' + f + '  [' + id + '] ' + m); return false; }
  failures.push('[' + id + '] ' + m); console.error('FAIL  [' + id + '] ' + m);
  return false;
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const LINK = l => 'https://f.io/fixture-matrix-' + l.toLowerCase();
const PID = 'p_t1';
const DID = 'del_vid_1';
const short = u => String(u || '').replace('https://f.io/fixture-matrix-', '…') || 'none';

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card(PID);
  const vid = S.deliv.find(d => d.id === DID);

  // ---------------- the one backend: trial-reels, as index.ts does it ----------------
  const TEST_SLUGS = ['fixtureclient', RS.SLUG];
  const W = { flagClients: TEST_SLUGS.slice(), sw: null, versions: [], ledger: [], calls: [], writes: [], attaches: [], tick: 0,
    fault: null,       // { action, kind?, mode: 'refuse'|'delay'|'fail500', ms, error, times }
  };
  const stamp = () => new Date(Date.parse('2026-10-28T09:00:00.000Z') + (++W.tick) * 1000).toISOString();
  const mainLink = () => String(vid.file_url || '').trim() || String(card.asset_url || '').trim();
  const mkv = (l, over) => Object.assign({ id: 'v' + l + '-' + (++W.tick), client: 'fixtureclient', post_id: PID, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0, hook: 'Fictional hook ' + l,
    smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, client_pass_at: null, change_by: null, change_note: null, change_at: null, posted_at: null, trial_ends_at: null, updated_at: '2026-10-28T08:00:00.000Z' }, over || {});
  function seed(letters, over, opts) {
    W.versions = letters.map(l => mkv(l, typeof over === 'function' ? over(l) : over));
    W.sw = { client: 'fixtureclient', post_id: PID, enabled: !(opts && opts.off), winner_letter: (opts && opts.winner) || null };
    const main = (opts && opts.main !== undefined) ? opts.main : (W.versions[0] ? W.versions[0].frame_url : '');
    vid.file_url = main; card.asset_url = main; vid.updated_at = stamp();
    W.fault = null;
  }
  function trialReels(b, headers) {
    const action = L.clean(b.action, 40).toLowerCase();
    const client = String(b.client || '').trim().toLowerCase();
    const postId = L.clean(b.post_id, 120);
    W.calls.push(Object.assign({ _client_link: !headers['x-syncview-key'] }, b));
    const refuse = (status, error) => ({ status, body: { ok: false, error } });
    if (!L.ACTIONS.includes(action)) return refuse(400, 'unknown_action');
    if (!client) return refuse(400, 'invalid_client');
    if (!postId && action !== 'list') return refuse(400, 'post_id_required');
    const staffKey = headers['x-syncview-key'], token = headers['x-syncview-client-token'];
    if (staffKey && token) return refuse(401, 'ambiguous_credentials');
    let principal;
    if (staffKey) principal = { kind: 'staff', actor: 'staff:m1', role: 'admin' };
    else if (token) { if (token !== RS.TOKEN) return refuse(401, 'invalid_client_token'); principal = { kind: 'client', actor: 'client:' + client, role: 'client' }; }
    else if (L.CLIENT_ACTIONS.includes(action)) principal = { kind: 'client', actor: 'client:' + client, role: 'client' };
    else return refuse(401, 'credentials_required');
    if (principal.kind === 'client' && !L.CLIENT_ACTIONS.includes(action)) return refuse(403, 'staff_only');
    if (!L.flagAllows({ clients: W.flagClients }, client)) return refuse(403, 'not_enabled');
    if (!TEST_SLUGS.includes(client)) return refuse(404, 'card_not_found');
    const isClient = principal.kind === 'client';
    const shape = () => L.readShape(L.settleWinner(W.versions, W.sw && W.sw.winner_letter), { client: isClient, mainLink: mainLink(), cardStatus: card.video_status });
    const heal = () => {
      const c = L.healMainPatch(W.versions, mainLink());
      if (!c) return;
      const now = stamp();
      Object.assign(W.versions.find(v => v.id === c.id), c.patch, { updated_at: now });
      W.writes.push({ action: 'heal', letter: c.letter });
    };
    // Round 3 (#2412): a read of a Posted card starts the trial of its approved versions (logic.mjs autoTrialPatches).
    const autoStart = () => {
      if (!L.autoTrialPatches || !W.sw || !W.sw.enabled) return;
      const r = L.autoTrialPatches(L.settleWinner(W.versions, W.sw.winner_letter), { cardStatus: card.video_status, postedAt: card.video_status_at, nowMs: Date.now() });
      for (const c of r.patches) Object.assign(W.versions.find(v => v.id === c.id), c.patch, { updated_at: stamp() });
      if (r.patches.length) W.writes.push({ action: 'auto_trial_start', letters: r.patches.map(c => c.letter) });
    };
    autoStart();
    if (action === 'list') {
      const cards = {};
      if (W.sw && W.sw.enabled) { if (!isClient) heal(); cards[PID] = Object.assign({ enabled: true, winner_letter: W.sw.winner_letter || null }, shape()); }
      return { status: 200, body: { ok: true, cards } };
    }
    if (postId !== PID) return refuse(404, 'card_not_found');
    const now = stamp();
    if (action === 'switch_set') {
      const enabled = b.enabled === true;
      W.sw = Object.assign(W.sw || { created_at: now, winner_letter: null }, { client, post_id: PID, enabled, updated_at: now });
      W.writes.push({ action, enabled });
      if (enabled && !W.versions.length && L.cleanLink(mainLink()).link) W.versions.push(mkv('A', { frame_url: L.cleanLink(mainLink()).link }));
      return { status: 200, body: { ok: true, enabled } };
    }
    if (action === 'read' && (!W.sw || W.sw.enabled !== true)) return { status: 200, body: { ok: true, enabled: false } };
    if (!W.sw || W.sw.enabled !== true) return refuse(409, 'trial_reels_off');
    if (!isClient) heal();
    if (action === 'version_add') {
      const r = L.addVersion(W.versions, b.link, mainLink());
      if (r.error) return refuse(r.error === 'attach_first' ? 409 : 400, r.error);
      W.versions.push(mkv(r.letter, { frame_url: r.link, updated_at: now }));
      W.writes.push({ action, letters: [r.letter] });
      return { status: 200, body: Object.assign({ ok: true, changed: [r.letter], winner_letter: W.sw.winner_letter || null }, shape()) };
    }
    if (action === 'read') {
      const out = Object.assign({ ok: true, enabled: true, winner_letter: W.sw.winner_letter || null }, shape());
      if (!isClient) {
        out.video_deliverable_id = card.video_deliverable_id || null;
        if (b.probe === true) out.link_states = Object.fromEntries(out.versions.map(v => [v.letter, v.frame_url ? { state: 'available', http_status: 200 } : { state: 'missing' }]));
      }
      return { status: 200, body: out };
    }
    const letter = L.clean(b.letter, 1).toUpperCase();
    const vs = L.settleWinner(W.versions, W.sw.winner_letter);
    let changes = [], extra = {}, r;
    if (action === 'answer') {
      const stage = isClient ? 'client' : L.clean(b.stage, 10).toLowerCase();
      r = L.answerPatches(vs, { stage, kind: L.clean(b.kind, 20).toLowerCase(), letter, note: b.note, cardStatus: card.video_status }, now);
      if (r.error) return refuse(400, r.error);
      changes = r.patches;
    } else if (action === 'version_link_set') {
      r = L.linkPatch(vs, letter, b.link, mainLink());
      if (r.error) return refuse(r.error === 'attach_first' ? 409 : 400, r.error);
      const v = vs.find(x => x.letter === letter);
      if (r.patch) changes = [{ id: v.id, letter, from: v.status, patch: r.patch }];
      extra = { restarted: !!r.restarted };
    } else if (action === 'version_drop' || action === 'version_restore') {
      r = L.dropPatch(vs, letter, action === 'version_restore', mainLink());
      if (r.error) return refuse(r.error === 'attach_first' ? 409 : 400, r.error);
      const v = vs.find(x => x.letter === letter);
      if (r.patch) changes = [{ id: v.id, letter, from: v.status, patch: r.patch }];
    } else if (action === 'version_new_cut') {
      r = L.newCutPatch(vs, letter);
      if (r.error) return refuse(400, r.error);
      const v = vs.find(x => x.letter === letter);
      changes = [{ id: v.id, letter, from: v.status, patch: r.patch }];
    } else if (action === 'trial_start') {
      r = L.trialPatches(vs, Date.now());
      if (r.error) return refuse(400, r.error);
      changes = r.patches;
    } else if (action === 'winner_set') {
      r = L.winnerPatches(vs, letter, mainLink(), { nowMs: Date.now(), cardStatus: card.video_status });
      if (r.error) return refuse(r.error === 'attach_first' ? 409 : 400, r.error);
      changes = r.patches;
    } else if (action === 'winner_undo') {
      r = L.undoWinnerPatches(vs, mainLink(), { cardStatus: card.video_status });
      if (r.error) return refuse(r.error === 'attach_first' ? 409 : 400, r.error);
      changes = r.patches;
    }
    for (const c of changes) Object.assign(W.versions.find(v => v.id === c.id), c.patch, { updated_at: now });
    if (action === 'winner_set' || action === 'winner_undo') W.sw.winner_letter = action === 'winner_set' ? letter : null;
    if (changes.length) W.writes.push({ action, kind: b.kind, letters: changes.map(c => c.letter) });
    return { status: 200, body: Object.assign({ ok: true, changed: changes.map(c => c.letter) }, extra, shape()) };
  }
  async function routeTrialReels(ctx) {
    await ctx.route('**/functions/v1/trial-reels', async route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      const f = W.fault;
      if (f && f.action === b.action && (!f.kind || f.kind === b.kind) && (f.times == null || f.times > 0)) {
        if (f.times != null) f.times--;
        if (f.mode === 'delay') await sleep(f.ms || 2000);
        if (f.mode === 'refuse') { W.calls.push(Object.assign({ _refused: f.error }, b)); return route.fulfill({ status: f.status || 400, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: false, error: f.error || 'request_failed' }) }).catch(() => {}); }
        if (f.mode === 'fail500') { W.calls.push(Object.assign({ _refused: '500' }, b)); return route.fulfill({ status: 500, headers: CORS, contentType: 'text/plain', body: 'upstream error' }).catch(() => {}); }
      }
      const out = trialReels(b, r.headers());
      // lateReply: the write is done at once, its answer is slow (the server committed, the page has not heard yet).
      if (f && f.mode === 'lateReply' && f.action === b.action) { W.fault = null; await sleep(f.ms || 3000); }
      return route.fulfill({ status: out.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(out.body) }).catch(() => {});
    });
  }

  // ---------------- the staff side ----------------
  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: k === 'trial_reels_pages' ? { clients: W.flagClients.length ? W.flagClients : ['someotherclient'] }
        : k === 'frame_viewer_clients' ? { all: true }
        : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await routeTrialReels(S.ctx);
  await S.ctx.route('**/functions/v1/production-write{,?*}', async route => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    const reply = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(o) }).catch(() => {});
    if (r.method() === 'POST' && b.operation === 'attachment') {
      W.attaches.push({ id: b.id, file_url: b.file_url });
      if (b.id !== DID) return reply({ ok: false, error: 'scope_forbidden' }, 403);
      if (b.expected_updated_at !== vid.updated_at) return reply({ ok: false, error: 'write_conflict', conflict: true, row: { id: DID, file_url: vid.file_url, updated_at: vid.updated_at } }, 409);
      vid.file_url = b.file_url; vid.updated_at = stamp();
      card.asset_url = b.file_url;
      return reply({ ok: true, native_committed: true, row: { ...vid } });
    }
    if (r.method() === 'POST' && b.action === 'asset_access_read') {
      const file = b.id === DID ? mainLink() : null;
      return reply({ ok: true, complete: true, id: b.id, client_slug: b.client_slug, team: 'video', assets: [{ slot: 'filming_plan', state: 'missing', url: null }, { slot: 'raw_footage', state: 'missing', url: null },
        { slot: 'delivery_folder', state: 'missing', url: null }, { slot: 'deliverable_file', state: file ? 'available' : 'missing', url: file, http_status: file ? 200 : undefined }] });
    }
    return route.fallback();
  });
  // The Notes player: every version plays the fixture clip.
  const fs = require('fs');
  const CLIP = fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-clip-vertical.webm'));
  const MEDIA = 'https://media.fixture.test/clip-vertical.webm';
  const views = [];
  await S.ctx.route('**/functions/v1/frameio-view*', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    const asked = String(b.link || '');
    views.push(asked);
    // Each version plays its own address (the same clip), so the page shows which version's video it mounted. A
    // later version answers sooner, so a slow first answer can land after the switch moved on.
    await sleep(/-a$/.test(asked) ? 900 : 250);
    const MEDIA = 'https://media.fixture.test/clip-vertical.webm?v=' + encodeURIComponent(asked.slice(-1));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({
      ok: true, video: { url: MEDIA, renditions: { efficient: MEDIA, high_quality: MEDIA, original: MEDIA }, expires_at: new Date(Date.now() + 3600000).toISOString(), name: 'Fixture clip.webm', file_id: 'f1', duration_seconds: 12, fps: 24 },
      comments: [], comments_error: '', open_url: 'https://next.frame.io/share/00000000-0000-4000-8000-000000000001', fetched_at: new Date().toISOString() }) }).catch(() => {});
  });
  await S.ctx.route('https://media.fixture.test/**', route => route.fulfill({ status: 200, headers: Object.assign({ 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: CLIP }).catch(() => {}));

  // ---------------- what every step checks ----------------
  const V = l => W.versions.find(v => v.letter === l);
  const trialWrites = n => W.writes.slice(n).filter(w => w.action !== 'heal');
  // The card as drawn: every Video row and versions list of p_t1 that is on screen, and what each version row says.
  const drawn = page => page.evaluate(pid => {
    const vis = n => !!(n && n.getClientRects().length);
    const fields = [...document.querySelectorAll('.cal-link-field[data-pid-wrap="' + pid + '"][data-fld-wrap="asset_url"]')].filter(vis);
    const lists = [...document.querySelectorAll('.trl-list')].filter(vis);
    const rows = lists.map(l => [...l.querySelectorAll('.trl-v')].map(n => ({
      letter: ((n.querySelector('.trl-l') || {}).textContent || '').replace('Video ', '').trim(),
      add: n.classList.contains('trl-add'), editing: !!n.querySelector('.trl-link-input'),
      href: (n.querySelector('.trl-go') || {}).href || '', lab: ((n.querySelector('.trl-lab, .sv-dropped-note') || {}).textContent || '').trim(),
      text: n.innerText.replace(/\s+/g, ' ').trim(),
    })));
    const main = fields[0];
    return {
      fields: fields.length, lists: lists.length, rows,
      // a list right after a field that is not this card's own Video row, or one left behind with no row before it
      orphan: lists.filter(l => { const p = l.previousElementSibling; return !p || !p.matches('.cal-link-field.cal-link-post'); }).length,
      editingField: fields.some(f => f.classList.contains('editing')), busy: fields.some(f => f.getAttribute('aria-busy') === 'true'),
      inputs: document.querySelectorAll('.trl-link-input').length,
      mainText: main ? main.innerText.replace(/\s+/g, ' ').trim() : '', trial: !!(main && main.classList.contains('trl-main')),
      open: !!(main && main.classList.contains('trl-open')),
    };
  }, PID);
  /* The invariants. `exp` says what this step expects: open (the list shown), editing (a link box open on purpose),
     writes (how many trial writes since n0; default: not checked), attaches (since a0). */
  async function inv(page, id, step, exp) {
    exp = exp || {};
    const d = await drawn(page);
    const sh = L.readShape(L.settleWinner(W.versions, W.sw && W.sw.winner_letter), { client: false, mainLink: mainLink(), cardStatus: card.video_status });
    ok(id + '.one-row', d.fields === 1, `${step}: one Video row for the card (${d.fields})`);
    ok(id + '.lists', d.lists <= 1 && !d.orphan, `${step}: at most one versions list, none orphaned (${d.lists} list(s), ${d.orphan} orphaned)`);
    if (exp.open !== undefined && W.sw && W.sw.enabled) ok(id + '.open', (d.lists === 1) === !!exp.open, `${step}: the list is ${exp.open ? 'open' : 'closed'} (${d.lists})`);
    if (d.lists >= 1) {
      const rs = d.rows[0];
      exp.inflight = exp.inflight || false;
      const letters = rs.filter(r => !r.add).map(r => r.letter);
      ok(id + '.no-dup', new Set(letters).size === letters.length && rs.filter(r => r.add).length <= 1, `${step}: no version drawn twice (${letters.join('')}${rs.some(r => r.add) ? '+' : ''})`);
      ok(id + '.versions', letters.join('') === sh.versions.map(v => v.letter).join(''), `${step}: the list shows the backend's versions (${letters.join('')} / ${sh.versions.map(v => v.letter).join('')})`);
      const links = rs.filter(r => !r.add && !r.editing).every(r => { const v = sh.versions.find(x => x.letter === r.letter); return !v || (r.href || '') === (v.frame_url || ''); });
      if (!exp.inflight) ok(id + '.links', links, `${step}: each version row opens its own link (${rs.filter(r => !r.add).map(r => r.letter + '=' + short(r.href)).join(' ')})`);
    }
    if (!exp.editing && !exp.inflight) ok(id + '.settled', !d.inputs && !d.editingField && !d.busy, `${step}: nothing half-drawn (link boxes ${d.inputs}, editing ${d.editingField}, busy ${d.busy})`);
    const fileUrl = String(vid.file_url || ''), assetUrl = String(card.asset_url || '');
    const onCard = sh.versions.find(v => v.on_card);
    ok(id + '.one-link', fileUrl === assetUrl && (!onCard || onCard.frame_url === fileUrl), `${step}: the card's one link agrees (file_url ${short(fileUrl)}, asset_url ${short(assetUrl)}, on the card ${onCard ? onCard.letter + ' ' + short(onCard.frame_url) : 'none'})`);
    if (exp.n0 !== undefined && exp.writes !== undefined) { const w = trialWrites(exp.n0); ok(id + '.writes', w.length === exp.writes, `${step}: ${exp.writes} trial write(s) (${JSON.stringify(w)})`); }
    if (exp.a0 !== undefined && exp.attaches !== undefined) ok(id + '.attaches', W.attaches.length - exp.a0 === exp.attaches, `${step}: ${exp.attaches} attach(es) (${JSON.stringify(W.attaches.slice(exp.a0))})`);
    if (exp.u0 !== undefined) ok(id + '.no-card-save', S.upserts.length === exp.u0, `${step}: no card save (${S.upserts.length - exp.u0})`);
    ok(id + '.errors', !page.errors.length, `${step}: no page errors (${page.errors.join(' | ')})`);
    page.errors.length = 0;
    return d;
  }
  // What the page said: showNotify's dialog (#confirmOverlay) and the toast. dismiss() presses the dialog's OK.
  const notices = page => page.evaluate(() => {
    const o = document.getElementById('confirmOverlay');
    const dlg = o && o.classList.contains('active') ? ((document.getElementById('confirmTitle') || {}).textContent || '') + ': ' + ((document.getElementById('confirmMsg') || {}).textContent || '') : '';
    const toast = [...document.querySelectorAll('.sv-toast')].filter(n => n.getClientRects().length).map(n => n.innerText.replace(/\s+/g, ' ').trim()).join(' | ');
    return [dlg, toast].filter(Boolean).join(' | ');
  });
  const dismiss = page => page.evaluate(() => { const o = document.getElementById('confirmOverlay'); if (o && o.classList.contains('active')) document.getElementById('confirmYes').click(); }).then(() => sleep(250)).catch(() => {});
  async function openCal(w, h) {
    const page = await S.newPage();
    await page.setViewportSize({ width: w || 1440, height: h || 900 });
    await S.openCalendar(page);
    if (w && w < 600) { await page.getByText(card.name).first().click(); await sleep(1000); }
    await sleep(1500);
    return page;
  }
  const sel = {
    row: i => '.trl-list .trl-v:not(.trl-add):nth-child(' + i + ')',
  };
  async function openList(page) { await dismiss(page); if (!(await page.$('.trl-list'))) { await page.click('.cal-link-post .trl-chev'); await sleep(300); } }
  async function versionPencil(page, i) {
    await openList(page);
    await page.mouse.move(1, 1);
    await page.hover(sel.row(i));
    if (process.env.MATRIX_DEBUG) console.log('DEBUG pencil', await page.evaluate(q => { const r = document.querySelector(q); if (!r) return 'no row'; const b = r.querySelector('.trl-ico[aria-label^="Change the link"]'); return r.outerHTML.slice(0, 600) + ' || ' + (b ? JSON.stringify(b.getBoundingClientRect()) + getComputedStyle(b).visibility + getComputedStyle(b).opacity + getComputedStyle(b.parentNode).display : 'no pencil'); }, sel.row(i)));
    await page.click(sel.row(i) + ' .trl-ico[aria-label^="Change the link"]');
    await sleep(200);
  }
  const mark = () => ({ n0: W.writes.length, a0: W.attaches.length, u0: S.upserts.length, c0: W.calls.length });

  const rbrowser = ONLY.has('review') ? await chromium.launch() : null;
  const rserver = ONLY.has('review') ? await serveStatic() : null;
  try {
    // =====================================================================================================
    // A. THE STAFF CARD, at 1440 and at 390
    // =====================================================================================================
    if (ONLY.has('card')) for (const [w, h, sz] of [[1440, 900, 'desk'], [390, 844, 'phone']].filter(x => !process.env.MATRIX_SIZE || x[2] === process.env.MATRIX_SIZE)) try {
      const P = 'card.' + sz;
      // A0. Switch on a card that already carries a video: Video A is that link.
      W.versions = []; W.sw = null; vid.file_url = LINK('a'); card.asset_url = LINK('a'); vid.updated_at = stamp();
      let page = await openCal(w, h);
      let m = mark();
      await inv(page, P + '.off', `${sz} off: today's row plus the faint switch`, { n0: m.n0, writes: 0 });
      await page.click('.cal-link-post .trl-sw-slot');
      await sleep(1500);
      await inv(page, P + '.on', `${sz} switch on: Video A seeded from the card's link, list open`, { open: true, n0: m.n0, writes: 1, a0: m.a0, attaches: 0 });
      ok(P + '.on.seed', W.versions.length === 1 && V('A').frame_url === LINK('a'), `${sz} switch on: the backend has Video A = the card's link`);

      // A1. Add B and C through the "Paste" row.
      for (const l of ['B', 'C']) {
        m = mark();
        await page.click('.trl-list .trl-add .trl-paste');
        await sleep(150);
        await inv(page, P + '.add-open.' + l, `${sz} add ${l}: the paste box opens`, { editing: true, open: true, n0: m.n0, writes: 0 });
        await page.fill('.trl-link-input', LINK(l));
        await page.keyboard.press('Enter');
        await sleep(1200);
        await inv(page, P + '.add.' + l, `${sz} add ${l}: pasted and Enter`, { open: true, n0: m.n0, writes: 1, a0: m.a0, attaches: 0 });
      }
      // A2. Add, then Escape with something typed, and with nothing typed: nothing written.
      m = mark();
      await page.click('.trl-list .trl-add .trl-paste'); await sleep(150);
      await page.fill('.trl-link-input', LINK('zz'));
      await page.keyboard.press('Escape'); await sleep(150);
      await inv(page, P + '.add-esc', `${sz} add, type, Escape: the box closes`, { open: true, n0: m.n0, writes: 0 });
      await sleep(1000);
      await inv(page, P + '.add-esc-later', `${sz} add, type, Escape (a second later)`, { open: true, n0: m.n0, writes: 0 });
      m = mark();
      await page.click('.trl-list .trl-add .trl-paste'); await sleep(150);
      await page.mouse.click(5, 5); await sleep(600);
      await inv(page, P + '.add-away', `${sz} add, nothing typed, click away`, { open: true, n0: m.n0, writes: 0 });

      // A3. THE OWNER'S BUG: a version row's pencil, nothing typed, Escape.
      for (const [i, l] of [[2, 'B'], [1, 'A']]) {
        m = mark();
        await versionPencil(page, i);
        await inv(page, P + '.pencil.' + l, `${sz} Video ${l}'s pencil: its link box opens in place`, { editing: true, open: true, n0: m.n0, writes: 0 });
        await page.keyboard.press('Escape');
        await sleep(80);
        await inv(page, P + '.pencil-esc.' + l, `${sz} Video ${l}'s pencil, nothing typed, Escape (at once)`, { open: true, n0: m.n0, writes: 0, a0: m.a0, attaches: 0, u0: m.u0 });
        await sleep(1500);
        await inv(page, P + '.pencil-esc-later.' + l, `${sz} Video ${l}'s pencil, Escape (1.5 s later)`, { open: true, n0: m.n0, writes: 0, a0: m.a0, attaches: 0, u0: m.u0 });
      }
      // A4. Pencil, type a new link, Escape: the old link stays, nothing written.
      m = mark();
      await versionPencil(page, 2);
      await page.fill('.trl-link-input', LINK('b-typed'));
      await page.keyboard.press('Escape'); await sleep(1200);
      await inv(page, P + '.pencil-type-esc', `${sz} B's pencil, type, Escape: B keeps its link`, { open: true, n0: m.n0, writes: 0 });
      ok(P + '.pencil-type-esc.kept', V('B').frame_url === LINK('B'), `${sz} B's link unchanged (${short(V('B').frame_url)})`);
      // A5. Pencil, click away with nothing changed.
      m = mark();
      await versionPencil(page, 2);
      await page.mouse.click(5, 5); await sleep(1200);
      await inv(page, P + '.pencil-away', `${sz} B's pencil, click away with nothing changed`, { open: true, n0: m.n0, writes: 0 });
      // A6. Pencil, same link, Enter.
      m = mark();
      await versionPencil(page, 2);
      await page.fill('.trl-link-input', LINK('B'));
      await page.keyboard.press('Enter'); await sleep(1200);
      await inv(page, P + '.pencil-same', `${sz} B's pencil, the same link, Enter`, { open: true, n0: m.n0, writes: 0 });
      // A7. A link that is not https, a foreign host, another version's link: said, nothing moves.
      for (const [bad, what] of [['http://f.io/fixture-matrix-plain', 'not https'], ['https://www.youtube.com/watch?v=fixture', 'a foreign host'], [LINK('C'), "Video C's link"], ['not a link', 'words']]) {
        m = mark();
        await versionPencil(page, 2);
        await page.fill('.trl-link-input', bad);
        await page.keyboard.press('Enter'); await sleep(1000);
        // Since Trialeyes E3 (2026-10-29) a link the page refuses is said under its field, which stays open with the
        // text to fix (never a dialog); Escape closes it.
        const said = await page.evaluate(() => { const e = document.querySelector('.trl-list .trl-link-err'), i = document.querySelector('.trl-list .trl-link-input'); return (e ? e.textContent : '') + (i ? ' [' + i.value + ']' : ''); });
        const bid = P + '.bad.' + what.replace(/\W+/g, '-');
        await inv(page, bid, `${sz} B's pencil, ${what}, Enter`, { open: true, editing: true, n0: m.n0, writes: 0, a0: m.a0, attaches: 0 });
        ok(bid + '.said', /Frame\.io, Google Drive or Dropbox|Another version already has this link/.test(said) && said.includes('[' + bad + ']'), `${sz} ${what}: the refusal is said under the field, the text kept (${said.slice(0, 120)})`);
        ok(bid + '.kept', V('B').frame_url === LINK('B'), `${sz} ${what}: B keeps its link`);
        await page.keyboard.press('Escape'); await sleep(300);
        await dismiss(page);
      }
      // A8. Clear B's link (empty, Enter).
      m = mark();
      await versionPencil(page, 2);
      await page.fill('.trl-link-input', '');
      await page.keyboard.press('Enter'); await sleep(1200);
      await inv(page, P + '.clear', `${sz} B's pencil, clear the box, Enter`, { open: true });
      const afterClear = await notices(page);
      await dismiss(page);
      ok(P + '.clear.said', V('B').frame_url === LINK('B') ? /did not save|cannot|link/i.test(afterClear) : !V('B').frame_url, `${sz} clearing B either clears it or says why not (B ${short(V('B').frame_url)}; "${afterClear.slice(0, 100)}")`);
      if (!V('B').frame_url) { V('B').frame_url = LINK('B'); }
      // A9. A new link on B: one write, B starts again.
      m = mark();
      await page.close();
      page = await openCal(w, h);
      await versionPencil(page, 2);
      await page.fill('.trl-link-input', LINK('B2'));
      await page.keyboard.press('Enter'); await sleep(1200);
      await inv(page, P + '.relink', `${sz} B's pencil, a new link, Enter`, { open: true, n0: m.n0, writes: 1, a0: m.a0, attaches: 0 });
      ok(P + '.relink.b', V('B').frame_url === LINK('B2'), `${sz} B has its new link`);
      // A10. A new link on A (the version on the card): today's attach first, then A's copy.
      m = mark();
      await versionPencil(page, 1);
      await page.fill('.trl-link-input', LINK('A2'));
      await page.keyboard.press('Enter'); await sleep(1500);
      await inv(page, P + '.relink-main', `${sz} A's pencil (on the card), a new link, Enter`, { open: true, a0: m.a0, attaches: 1 });
      ok(P + '.relink-main.a', V('A').frame_url === LINK('A2'), `${sz} A has its new link (${short(V('A').frame_url)})`);
      // A11. Edit, then click another version's pencil (switching rows while editing).
      m = mark();
      await versionPencil(page, 2);
      await page.fill('.trl-link-input', LINK('b-half'));
      await page.hover(sel.row(3));
      await page.click(sel.row(3) + ' .trl-ico[aria-label^="Change the link"]').catch(() => {});
      await sleep(1200);
      await inv(page, P + '.switch-row', `${sz} B's pencil with a half link, then C's pencil`, { editing: true, open: true });
      await page.keyboard.press('Escape'); await sleep(1000);
      await inv(page, P + '.switch-row-esc', `${sz} then Escape on C`, { open: true });
      ok(P + '.switch-row.b', V('B').frame_url === LINK('B2') || V('B').frame_url === LINK('b-half'), `${sz} B ends with its old link or the one typed (${short(V('B').frame_url)})`);
      if (V('B').frame_url !== LINK('B2')) { /* a blur saved it: keep going from the backend's truth */ }

      // A12. THE MAIN ROW'S pencil (today's card link editor on the trial row), nothing typed, Escape / click away.
      // (Today's link box saves the card on any close, Escape included, to refresh a file swapped behind the same
      // link (_calOnLinkBlur); a card with no trial does the same, so a card save is not counted here.)
      for (const how of ['Escape', 'away']) {
        m = mark();
        await page.click('.cal-link-post.trl-main .cal-link-edit', { force: true });
        await sleep(200);
        if (how === 'Escape') await page.keyboard.press('Escape'); else await page.mouse.click(5, 5);
        await sleep(100);
        await inv(page, P + '.main-pencil-' + how, `${sz} the Video row's own pencil, nothing typed, ${how} (at once)`, { open: true, n0: m.n0, writes: 0, a0: m.a0, attaches: 0 });
        await sleep(1500);
        await inv(page, P + '.main-pencil-' + how + '-later', `${sz} the Video row's own pencil, ${how} (1.5 s later)`, { open: true, n0: m.n0, writes: 0, a0: m.a0, attaches: 0 });
      }

      // Start again from a clean page, so what the steps above left on screen cannot hide a later finding.
      await page.close();
      page = await openCal(w, h);
      await openList(page);
      // A13. Open and close the list; double click on the arrow.
      await page.click('.cal-link-post .trl-chev'); await sleep(300);
      await inv(page, P + '.close', `${sz} the arrow closes the list`, { open: false });
      await page.dblclick('.cal-link-post .trl-chev'); await sleep(400);
      await inv(page, P + '.chev-dbl', `${sz} a double click on the arrow`, {});
      await openList(page);

      // A14. Drop C, bring it back; double click on drop.
      m = mark();
      await page.hover(sel.row(3)); await page.click(sel.row(3) + ' .trl-ico[aria-label^="Drop Video"]'); await sleep(1200);
      await inv(page, P + '.drop', `${sz} drop C`, { open: true, n0: m.n0, writes: 1 });
      ok(P + '.drop.c', V('C').status === 'dropped', `${sz} C is dropped`);
      m = mark();
      await page.hover(sel.row(3)); await page.click(sel.row(3) + ' .trl-ico[aria-label^="Bring back"]'); await sleep(1200);
      await inv(page, P + '.restore', `${sz} bring C back`, { open: true, n0: m.n0, writes: 1 });
      m = mark();
      await page.hover(sel.row(3)); await page.dblclick(sel.row(3) + ' .trl-ico[aria-label^="Drop Video"]'); await sleep(1500);
      await inv(page, P + '.drop-dbl', `${sz} double click on C's drop`, { open: true });
      ok(P + '.drop-dbl.state', V('C').status === 'dropped' || V('C').status === 'waiting', `${sz} after a double click C is dropped or back, never stuck (${V('C').status})`);
      if (V('C').status === 'dropped') { await page.hover(sel.row(3)); await page.click(sel.row(3) + ' .trl-ico[aria-label^="Bring back"]'); await sleep(1200); }

      // A15. Drop A, the version on the card: the card's link moves to B first; bring A back.
      m = mark();
      await page.hover(sel.row(1)); await page.click(sel.row(1) + ' .trl-ico[aria-label^="Drop Video"]'); await sleep(1800);
      await inv(page, P + '.drop-main', `${sz} drop A (on the card): the card's link moves to B`, { open: true, n0: m.n0, writes: 1, a0: m.a0, attaches: 1 });
      ok(P + '.drop-main.moved', V('A').status === 'dropped' && mainLink() === V('B').frame_url, `${sz} A dropped, the card carries B (${short(mainLink())})`);
      m = mark();
      await page.hover(sel.row(1)); await page.click(sel.row(1) + ' .trl-ico[aria-label^="Bring back"]'); await sleep(1500);
      await inv(page, P + '.restore-main', `${sz} bring A back`, { open: true, n0: m.n0, writes: 1 });

      // A16. Switch off and on: the versions are kept.
      m = mark();
      await page.click('.cal-link-post .trl-sw-slot.on'); await sleep(300);
      // With versions on the card it asks first (Trialeyes E19, 2026-10-29).
      ok(P + '.sw-off.asks', await page.evaluate(() => document.getElementById('confirmOverlay').classList.contains('active') && /versions? (is|are) kept/.test(document.getElementById('confirmMsg').textContent)), `${sz} switch off asks first`);
      await page.click('#confirmYes'); await sleep(1300);
      await inv(page, P + '.sw-off', `${sz} switch off`, { n0: m.n0, writes: 1 });
      ok(P + '.sw-off.row', !(await page.$('.trl-main, .trl-list')), `${sz} switch off: today's row`);
      await page.click('.cal-link-post .trl-sw-slot'); await sleep(1500);
      await inv(page, P + '.sw-on-again', `${sz} switch on again: the same versions`, { open: true });
      ok(P + '.sw-on-again.kept', W.versions.length === 3, `${sz} the three versions are kept (${W.versions.map(v => v.letter).join('')})`);
      // A17. A double click on the switch.
      m = mark();
      await page.dblclick('.cal-link-post .trl-sw-slot'); await sleep(2000);
      await inv(page, P + '.sw-dbl', `${sz} a double click on the switch`, {});
      ok(P + '.sw-dbl.agree', !!W.sw.enabled === !!(await page.$('.trl-main')), `${sz} after a double click the switch on screen is the backend's (${W.sw.enabled})`);
      // The first click can leave "Turn off trial reels?" open: on a phone the staff phone polish (every signed-in staff
      // member since 2026-10-29) puts the switch where the second click lands inside the dialog, not on its backdrop.
      // The person cancels it; the next step must not press its "Turn off".
      await page.evaluate(() => { const o = document.getElementById('confirmOverlay'); if (o && o.classList.contains('active')) dismissConfirm(); }); await sleep(300);
      if (!W.sw.enabled) { await page.click('.cal-link-post .trl-sw-slot'); await sleep(1500); }
      await openList(page);

      // A18. A slow server: a new link on C answered after 2.5 s; the row shows it at once, and Escape on another row
      // while it is in flight draws nothing twice.
      m = mark();
      W.fault = { action: 'version_link_set', mode: 'delay', ms: 2500, times: 1 };
      await versionPencil(page, 3);
      await page.fill('.trl-link-input', LINK('C2'));
      await page.keyboard.press('Enter'); await sleep(300);
      await inv(page, P + '.slow-shown', `${sz} slow answer: C's new link shows at once`, { open: true, inflight: true });
      const shown = (await drawn(page)).rows[0].find(r => r.letter === 'C');
      ok(P + '.slow-shown.c', shown && shown.href === LINK('C2'), `${sz} slow answer: C's row shows the new link before the answer (${short(shown && shown.href)})`);
      await versionPencil(page, 2);
      await page.keyboard.press('Escape'); await sleep(300);
      await inv(page, P + '.slow-esc', `${sz} slow answer: B's pencil and Escape while C's write is in flight`, { open: true, inflight: true });
      await sleep(3000);
      await inv(page, P + '.slow-done', `${sz} slow answer landed`, { open: true, n0: m.n0, writes: 1 });
      ok(P + '.slow-done.c', V('C').frame_url === LINK('C2'), `${sz} C has its new link`);
      // A19. A refused answer and a 500: the row goes back and says so.
      for (const [mode, err] of [['refuse', 'conflict'], ['fail500', '']]) {
        m = mark();
        W.fault = { action: 'version_drop', mode, error: err, status: 409, times: 1 };
        await page.hover(sel.row(2)); await page.click(sel.row(2) + ' .trl-ico[aria-label^="Drop Video"]'); await sleep(1500);
        const said = await notices(page);
        await inv(page, P + '.refused-' + mode, `${sz} drop B refused (${mode})`, { open: true, n0: m.n0, writes: 0 });
        const row = (await drawn(page)).rows[0].find(r => r.letter === 'B');
        ok(P + '.refused-' + mode + '.back', V('B').status !== 'dropped' && row && !/dropped/.test(row.text) && /did not save/.test(said), `${sz} ${mode}: B is back as it was and the refusal is said (${row && row.text} / ${said.slice(0, 80)})`);
        await dismiss(page);
      }
      W.fault = null;

      // A20. New cut: C has a change asked.
      Object.assign(V('C'), { status: 'change asked', change_by: 'client', change_note: 'Fictional note', smm_ok_at: '2026-10-28T08:00:00.000Z' });
      await page.close();
      page = await openCal(w, h);
      await openList(page);
      m = mark();
      await page.hover(sel.row(3));
      const nc = await page.$(sel.row(3) + ' .trl-ico[aria-label^="New cut of"]');
      ok(P + '.newcut.btn', !!nc, `${sz} a version with a change asked offers "New cut ready"`);
      if (nc) { await nc.click(); await sleep(1300); }
      await inv(page, P + '.newcut', `${sz} New cut ready on C`, { open: true, n0: m.n0, writes: 1 });
      ok(P + '.newcut.c', V('C').status === 'waiting' && V('C').revision >= 1, `${sz} C waits again (revision ${V('C').revision})`);

      // A21. Start the trial, the trophy, the winner, Undo, a double click on a trophy.
      W.versions.forEach(v => Object.assign(v, { status: 'approved', smm_ok_at: '2026-10-28T08:00:00.000Z', kasper_ok_at: '2026-10-28T08:05:00.000Z', client_ok_at: '2026-10-28T08:10:00.000Z', change_by: null, change_note: null }));
      await page.close();
      page = await openCal(w, h);
      await openList(page);
      m = mark();
      if (await page.$('.trl-list .trl-start')) {
        await page.click('.trl-list .trl-start'); await sleep(1300);
        await inv(page, P + '.start', `${sz} start the 24 h`, { open: true, n0: m.n0, writes: 1 });
      } else {
        // Round 3 (#2412): the card set to Posted starts the 24 h by itself.
        S.setCardField(PID, { video_status: 'Posted', status: 'Posted' }, 'posted');
        await page.close();
        page = await openCal(w, h);
        await openList(page);
        await inv(page, P + '.start', `${sz} the card is Posted: the 24 h start by themselves`, { open: true, n0: m.n0, writes: 1 });
      }
      ok(P + '.start.all', W.versions.every(v => v.status === 'on trial'), `${sz} every version on trial`);
      W.versions.forEach(v => { v.trial_ends_at = new Date(Date.now() - 60000).toISOString(); });
      await page.close();
      page = await openCal(w, h);
      await inv(page, P + '.due', `${sz} 24 h up: the trophy`, { open: false });
      await page.click('.cal-link-post .trl-state-ico'); await sleep(300);
      m = mark();
      await page.dblclick(sel.row(2) + ' .trl-pick'); await sleep(2500);
      await inv(page, P + '.pick-dbl', `${sz} a double click on B's trophy`, { open: true });
      ok(P + '.pick-dbl.one', V('B').status === 'winner' && W.attaches.length - m.a0 === 1 && trialWrites(m.n0).filter(x => x.action === 'winner_set').length === 1, `${sz} B is the winner, once (${W.attaches.length - m.a0} attach(es), ${trialWrites(m.n0).length} write(s))`);
      m = mark();
      await page.evaluate(() => { const x = [...document.querySelectorAll('.sv-toast button')].find(n => /Undo/.test(n.textContent)); if (x) x.click(); });
      await sleep(1800);
      await inv(page, P + '.undo', `${sz} Undo`, { open: true });
      ok(P + '.undo.state', W.versions.every(v => v.status === 'on trial') && mainLink() === V('A').frame_url, `${sz} Undo: every version on trial, A on the card (${short(mainLink())})`);
      m = mark();
      await page.click(sel.row(3) + ' .trl-pick'); await sleep(1800);
      await inv(page, P + '.pick', `${sz} pick C`, { open: true, n0: m.n0, writes: 1, a0: m.a0, attaches: 1 });
      // A22. After the winner: the pencil on a decided version is refused before anything moves.
      const pen = await page.$(sel.row(1) + ' .trl-ico[aria-label^="Change the link"]');
      if (pen) {
        m = mark();
        await page.hover(sel.row(1)); await pen.click(); await sleep(200);
        await page.keyboard.press('Escape'); await sleep(1200);
        await inv(page, P + '.decided-pencil-esc', `${sz} a decided version's pencil, Escape`, { open: true, n0: m.n0, writes: 0 });
      }
      await page.close();
      S.setCardField(PID, { video_status: 'In Progress', status: 'In Progress' }, 'reset');
    } catch (e) { failures.push('card ' + sz + ' threw: ' + String(e && e.message || e).split('\n')[0]); console.error('FAIL  card ' + sz + ' threw', e); }

    // =====================================================================================================
    // B. PRODUCTION'S ASSETS
    // =====================================================================================================
    if (ONLY.has('prod')) try {
      seed(['A', 'B', 'C']);
      const page = await S.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      await S.openProduction(page);
      await page.evaluate(x => _prodOpenDeliverable(x), DID);
      await sleep(2200);
      const prodRows = () => page.evaluate(() => {
        const rows = [...document.querySelectorAll('.prod-assets-list .prod-asset-row')].filter(n => n.getClientRects().length);
        return { n: rows.length, letters: rows.filter(n => n.classList.contains('trl-prod-v')).map(n => n.getAttribute('data-trl-slot')),
          editors: document.querySelectorAll('[data-trl-editor]').length, inputs: document.querySelectorAll('[data-trl-input]').length,
          hrefs: rows.filter(n => n.classList.contains('trl-prod-v')).map(n => (n.querySelector('.prod-asset-value a') || {}).href || ''),
          today: rows.filter(n => n.getAttribute('data-prod-asset-slot') === 'deliverable_file').length,
          lists: document.querySelectorAll('.prod-assets-list').length };
      });
      const pinv = async (id, step, exp) => {
        const r = await prodRows();
        const letters = r.letters.filter(Boolean);
        ok(id + '.no-dup', new Set(letters).size === letters.length && r.lists === 1, `prod ${step}: one Assets list, no version twice (${letters.join('')}, ${r.lists} list(s))`);
        ok(id + '.versions', letters.join('') === W.versions.map(v => v.letter).join(''), `prod ${step}: one row per version (${letters.join('')})`);
        if (!exp || !exp.editing) ok(id + '.settled', !r.editors && !r.inputs, `prod ${step}: no editor left open (${r.editors})`);
        if (exp && exp.n0 !== undefined) { const w = trialWrites(exp.n0); ok(id + '.writes', w.length === exp.writes, `prod ${step}: ${exp.writes} trial write(s) (${JSON.stringify(w)})`); }
        ok(id + '.errors', !page.errors.length, `prod ${step}: no page errors (${page.errors.join(' | ')})`);
        page.errors.length = 0;
        return r;
      };
      await pinv('prod.open', 'opened');
      let m = mark();
      await page.click('.trl-prod-v[data-trl-slot="B"] .prod-asset-edit'); await sleep(300);
      await pinv('prod.edit', 'Edit on B', { editing: true });
      await page.click('[data-trl-editor="B"] .prod-assets-action:not(.prod-assets-save)'); await sleep(600);
      await pinv('prod.cancel', 'Edit on B, Cancel', { n0: m.n0, writes: 0 });
      m = mark();
      await page.click('.trl-prod-v[data-trl-slot="B"] .prod-asset-edit'); await sleep(300);
      await page.keyboard.press('Escape'); await sleep(600);
      // Today's asset editor does not close on Escape either (240, _prodAssetsPanelHTML): only "nothing written" is asked.
      await pinv('prod.esc', 'Edit on B, Escape', { editing: true, n0: m.n0, writes: 0 });
      m = mark();
      if (await page.$('[data-trl-editor="B"]')) await page.click('[data-trl-editor="B"] .prod-assets-action:not(.prod-assets-save)').catch(() => {});
      await page.click('.trl-prod-v[data-trl-slot="B"] .prod-asset-edit'); await sleep(300);
      await page.click('[data-trl-editor="B"] .prod-assets-save'); await sleep(1500);
      await pinv('prod.same', 'Edit on B, Save with the same link', { n0: m.n0, writes: 0 });
      m = mark();
      await page.click('.trl-prod-v[data-trl-slot="B"] .prod-asset-edit'); await sleep(300);
      await page.fill('[data-trl-input]', 'https://www.youtube.com/watch?v=fixture');
      await page.click('[data-trl-editor="B"] .prod-assets-save'); await sleep(1500);
      const errShown = await page.evaluate(() => (document.querySelector('[data-trl-editor]') || {}).innerText || '');
      ok('prod.bad.said', /Frame\.io|link/i.test(errShown), `prod: a foreign link is refused in words (${errShown.replace(/\s+/g, ' ').slice(0, 100)})`);
      await pinv('prod.bad', 'Edit on B, a foreign link, Save', { editing: true, n0: m.n0, writes: 0 });
      await page.click('[data-trl-editor="B"] .prod-assets-action:not(.prod-assets-save)').catch(() => {}); await sleep(500);
      m = mark();
      await page.click('.trl-prod-v[data-trl-slot="B"] .prod-asset-edit'); await sleep(300);
      await page.fill('[data-trl-input]', LINK('B3'));
      await page.click('.trl-prod-v[data-trl-slot="C"] .prod-asset-edit').catch(() => {}); await sleep(800);
      await pinv('prod.switch-row', 'Edit on B with a new link, then Edit on C', { editing: true });
      const ed = await page.evaluate(() => [...document.querySelectorAll('[data-trl-editor]')].map(n => n.getAttribute('data-trl-editor')).join(''));
      ok('prod.switch-row.one', ed.length <= 1, `prod: one editor open at a time (${ed})`);
      if (await page.$('[data-trl-editor]')) await page.click('[data-trl-editor] .prod-assets-action:not(.prod-assets-save)').catch(() => {});
      await sleep(400);
      m = mark();
      await page.click('.trl-prod-v[data-trl-slot="C"] .prod-asset-edit'); await sleep(300);
      await page.fill('[data-trl-input]', LINK('C3'));
      await page.dblclick('[data-trl-editor="C"] .prod-assets-save'); await sleep(1800);
      await pinv('prod.save-dbl', 'a new link on C, double click Save', { n0: m.n0, writes: 1 });
      ok('prod.save-dbl.c', V('C').frame_url === LINK('C3'), `prod: C has its new link`);
      m = mark();
      await page.click('.trl-prod-v[data-trl-slot="C"] .prod-asset-edit'); await sleep(300);
      await page.fill('[data-trl-input]', LINK('C4'));
      await page.keyboard.press('Enter'); await sleep(1500);
      await pinv('prod.enter', 'a new link on C, Enter', { n0: m.n0, writes: 1 });
      await page.close();
    } catch (e) { failures.push('prod threw: ' + String(e && e.message || e).split('\n')[0]); console.error('FAIL  prod threw', e); }

    // =====================================================================================================
    // C. THE REVIEW PAGES: the SMM, Kasper (both layouts), the client (1440 and 390)
    // =====================================================================================================
    if (ONLY.has('review')) try {
      const rorigin = 'http://127.0.0.1:' + rserver.address().port;
      const rcard = Object.assign(RS.cards('client')[0], { id: PID, name: card.name, video_deliverable_id: DID, video_tweaks: '[]' });
      const rstate = { cards: [rcard], upserts: [], gateway: [], flagReads: 0, orient: 'p', writeDelay: 0, writeFail: 0, native: {}, receipts: {}, writeAttempts: 0 };
      async function openReview(mode, status, extra) {
        Object.assign(rcard, { video_status: status, status, graphic_status: 'Approved', caption_status: 'Approved', asset_url: mainLink(), video_tweaks: '[]' });
        const t = await RS.open(rbrowser, rorigin, Object.assign({ stage: mode, state: rstate, flags: 'on', flagValues: { trial_reels_pages: { clients: W.flagClients } } },
          mode !== 'client' ? { staff: RS.STAFF } : {}, extra || {}));
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
        if (extra && extra.layout2) await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
        else await RS.waitNew(t);
        await sleep(1500);
        return t;
      }
      const look = t => t.page.evaluate(() => {
        const r = document.getElementById('svReviewStage').shadowRoot;
        const vis = n => !!(n && n.getClientRects().length);
        const bars = [...r.querySelectorAll('.trv')].filter(vis);
        const b = bars[0];
        const tiles = [...r.querySelectorAll('#l2trv .trk-v')].filter(vis);
        return {
          bars: bars.length, text: b ? b.innerText.replace(/\s+/g, ' ').trim() : '',
          dots: b ? [...b.querySelectorAll('.trv-dot')].length : 0,
          dotLetters: b ? [...b.querySelectorAll('[data-trv-go]')].map(n => n.getAttribute('data-trv-go')).join('') : '',
          tiles: tiles.map(v => (v.innerText || '').replace(/\s+/g, ' ').trim()), tileLists: r.querySelectorAll('#l2trv').length,
          ok: ((r.querySelector('[data-ok="video"]') || {}).textContent || '').trim(),
          busy: [...r.querySelectorAll('button[disabled]')].filter(vis).length,
        };
      });
      const until = async (f, n) => { for (let i = 0; i < (n || 80) && !(await f()); i++) await sleep(100); return f(); };
      async function rinv(t, id, step, exp) {
        const s = await look(t);
        const nLive = W.versions.filter(v => v.status !== 'dropped').length;
        if (!exp || !exp.tiles) {
          ok(id + '.one-bar', s.bars === 1, `${step}: one version bar (${s.bars})`);
          ok(id + '.dots', s.dots === nLive && new Set(s.dotLetters.split('')).size === s.dotLetters.length, `${step}: one dot per live version, none twice (${s.dots} dots "${s.dotLetters}", ${nLive} live)`);
        } else {
          const letters = s.tiles.map(x => (/Video (\w)/.exec(x) || [])[1]);
          ok(id + '.tiles', s.tileLists <= 1 && new Set(letters).size === letters.length && letters.length === nLive, `${step}: one tile per live version, none twice (${letters.join('')}, ${nLive} live, ${s.tileLists} list(s))`);
        }
        if (exp && exp.n0 !== undefined) { const w = trialWrites(exp.n0); ok(id + '.writes', w.length === exp.writes, `${step}: ${exp.writes} trial write(s) (${JSON.stringify(w)})`); }
        ok(id + '.errors', !t.errors.length, `${step}: no page errors (${t.errors.join(' | ')})`);
        t.errors.length = 0;
        return s;
      }
      const reviewed = { smm_ok_at: '2026-10-28T08:00:00.000Z', kasper_ok_at: '2026-10-28T08:05:00.000Z' };

      // C1. The SMM's Review tab.
      seed(['A', 'B', 'C']);
      let t = await openReview('smm', 'For SMM Approval');
      let m = mark();
      await rinv(t, 'smm.open', 'SMM opened', { n0: m.n0, writes: 0 });
      for (const l of ['C', 'A', 'B', 'A']) { await RS.inS(t.page, '[data-trv-go="' + l + '"]').click().catch(() => {}); await sleep(250); }
      await rinv(t, 'smm.go', 'SMM switches A/B/C quickly', { n0: m.n0, writes: 0 });
      m = mark();
      await RS.inS(t.page, '[data-ok="video"]').dblclick();
      await sleep(1500);
      await rinv(t, 'smm.ok-dbl', 'SMM double clicks Approve on A', {});
      ok('smm.ok-dbl.a', !!V('A').smm_ok_at, `SMM: A OK'd`);
      ok('smm.ok-dbl.not-b', !V('B').smm_ok_at, `SMM: a double click on Approve OKs only the version on screen, never the next one the page moved to (B ${V('B').smm_ok_at ? 'OK\'d' : 'waits'}; writes ${JSON.stringify(trialWrites(m.n0))})`);
      const allBtn = RS.inS(t.page, '[data-trv-all]');
      if (await allBtn.count()) {
        m = mark();
        await allBtn.click(); await sleep(1800);
        await rinv(t, 'smm.all', 'SMM Approve all', {});
        ok('smm.all.state', W.versions.every(v => v.smm_ok_at), `SMM: every version OK'd`);
      } else {
        for (const l of ['B', 'C']) if (!V(l).smm_ok_at) { await RS.inS(t.page, '[data-trv-go="' + l + '"]').click().catch(() => {}); await sleep(300); await RS.inS(t.page, '[data-ok="video"]').click(); await sleep(1200); }
        await rinv(t, 'smm.rest', 'SMM approves the rest one at a time', {});
      }
      await t.ctx.close();

      // C2. Kasper, standard layout and layout 2.
      seed(['A', 'B', 'C'], { smm_ok_at: '2026-10-28T08:00:00.000Z' });
      t = await openReview('kasper', 'Kasper Approval', { width: 1280, height: 860 });
      m = mark();
      await rinv(t, 'kasper.open', 'Kasper (standard) opened', { n0: m.n0, writes: 0 });
      await RS.inS(t.page, '[data-ok="video"]').dblclick(); await sleep(1500);
      await rinv(t, 'kasper.ok-dbl', 'Kasper double clicks Approve on A', {});
      ok('kasper.ok-dbl.not-b', !!V('A').kasper_ok_at && !V('B').kasper_ok_at, `Kasper: a double click on Approve OKs only A (A ${!!V('A').kasper_ok_at}, B ${!!V('B').kasper_ok_at})`);
      await t.ctx.close();
      seed(['A', 'B', 'C'], { smm_ok_at: '2026-10-28T08:00:00.000Z' });
      t = await openReview('kasper', 'Kasper Approval', { layout2: true });
      await until(() => t.page.evaluate(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('#l2trv .trk-v')), 60);
      m = mark();
      await rinv(t, 'kasper2.open', 'Kasper layout 2 opened', { tiles: true, n0: m.n0, writes: 0 });
      await RS.inS(t.page, '[data-trk-ok="B"]').click().catch(() => {}); await sleep(1300);
      await rinv(t, 'kasper2.ok', 'Kasper layout 2: approve B', { tiles: true, n0: m.n0, writes: 1 });
      m = mark();
      await RS.inS(t.page, '[data-trk-drop="C"]').dblclick().catch(() => {}); await sleep(2000);
      await rinv(t, 'kasper2.drop-dbl', 'Kasper layout 2: double click drop C', { tiles: true });
      ok('kasper2.drop-dbl.c', V('C').status === 'dropped' && trialWrites(m.n0).filter(w => w.action === 'version_drop').length === 1, `Kasper: C dropped once (${JSON.stringify(trialWrites(m.n0))})`);
      await t.ctx.close();
      // Approve all (shown while two or more wait), double clicked.
      seed(['A', 'B', 'C'], { smm_ok_at: '2026-10-28T08:00:00.000Z' });
      t = await openReview('kasper', 'Kasper Approval', { layout2: true });
      await until(() => t.page.evaluate(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('#l2trv [data-trk-all]')), 60);
      m = mark();
      await RS.inS(t.page, '[data-trk-all]').dblclick().catch(() => {}); await sleep(2500);
      await rinv(t, 'kasper2.all', 'Kasper layout 2: double click Approve all', { tiles: true });
      ok('kasper2.all.state', W.versions.every(v => v.kasper_ok_at) && trialWrites(m.n0).filter(w => w.kind === 'approve_all').length === 1, `Kasper: every version OK'd, by one Approve all (${JSON.stringify(trialWrites(m.n0))})`);
      await t.ctx.close();

      // C3. The client, at 1440 and at 390.
      for (const [w, h, sz] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
        const P = 'client.' + sz;
        seed(['A', 'B', 'C'], reviewed);
        t = await openReview('client', 'Client Approval', { width: w, height: h });
        m = mark();
        let s = await rinv(t, P + '.open', `client ${sz} opened`, { n0: m.n0, writes: 0 });
        ok(P + '.open.a', /\bVideo A of 3/.test(s.text), `client ${sz}: "Video A of 3" (${s.text})`);
        for (const l of ['B', 'C', 'A']) { await RS.inS(t.page, '[data-trv-go="' + l + '"]').click().catch(() => {}); await sleep(250); }
        s = await rinv(t, P + '.go', `client ${sz}: B, C, A by the dots`, { n0: m.n0, writes: 0 });
        ok(P + '.go.a', /\bVideo A of 3/.test(s.text), `client ${sz}: back on A (${s.text})`);
        m = mark();
        await RS.inS(t.page, '[data-ok="video"]').dblclick(); await sleep(1800);
        s = await rinv(t, P + '.ok-dbl', `client ${sz}: double click Approve on A`, {});
        const ans = trialWrites(m.n0).filter(x => x.action === 'answer');
        ok(P + '.ok-dbl.a', V('A').status === 'approved', `client ${sz}: A approved`);
        ok(P + '.ok-dbl.not-b', V('B').status !== 'approved', `client ${sz}: a double click on Approve approves only A, never B the page moved to (B ${V('B').status}; ${JSON.stringify(ans)})`);
        await t.ctx.close();
        // A fresh page with A approved: Not this one on B, then a change on C typed and Escaped.
        seed(['A', 'B', 'C'], l => Object.assign({}, reviewed, l === 'A' ? { status: 'approved', client_ok_at: '2026-10-28T08:20:00.000Z' } : {}));
        t = await openReview('client', 'Client Approval', { width: w, height: h });
        await RS.inS(t.page, '[data-trv-go="B"]').click().catch(() => {}); await sleep(400);
        m = mark();
        s = await look(t);
        await RS.inS(t.page, '[data-pass="video"]').click(); await sleep(1500);
        s = await rinv(t, P + '.pass', `client ${sz}: Not this one on ${s.text.slice(0, 12)}`, { n0: m.n0, writes: 1 });
        ok(P + '.pass.b', !!V('B').client_pass_at && !V('C').client_pass_at, `client ${sz}: the pass is on B (B ${!!V('B').client_pass_at}, C ${!!V('C').client_pass_at})`);
        await RS.inS(t.page, '[data-trv-go="C"]').click().catch(() => {}); await sleep(400);
        // A refused approve on C: the page says so and C is not shown approved.
        m = mark();
        W.fault = { action: 'answer', kind: 'approve', mode: 'refuse', error: 'request_failed', status: 500, times: 1 };
        await RS.inS(t.page, '[data-ok="video"]').click(); await sleep(1800);
        W.fault = null;
        s = await rinv(t, P + '.refused', `client ${sz}: Approve on C refused by the server`, { n0: m.n0, writes: 0 });
        const cDot = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const d = r.querySelector('[data-trv-go="C"]'); return d ? (d.className + ' ' + d.innerHTML + ' ' + (d.getAttribute('aria-label') || '')) : ''; });
        ok(P + '.refused.c', V('C').status !== 'approved' && !/approved|ok\b/i.test(cDot), `client ${sz}: after the refusal C is not shown approved (${cDot.replace(/<[^>]+>/g, '').slice(0, 80)})`);
        const said = await notices(t.page);
        ok(P + '.refused.said', /not approved/i.test(said), `client ${sz}: the refusal is said (${said.slice(0, 120)})`);
        ok(P + '.refused.words', !/request_failed|"[a-z_]+"/.test(said), `client ${sz}: the client is not shown a server code (${said.slice(0, 120)})`);
        await dismiss(t.page);
        await RS.inS(t.page, '[data-trv-go="C"]').click().catch(() => {}); await sleep(400);
        // After the refusal the page must not stay busy: Approve, Ask for a change and Not this one work again.
        const stuck = async () => t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot;
          return ['[data-ok="video"]', '[data-chg="video"]', '[data-pass="video"]'].map(q => { const b = r.querySelector(q); return q.replace(/\[data-|="video"\]/g, '') + ':' + (!b ? 'none' : b.disabled ? 'disabled' : 'ok'); }).join(' '); });
        let st = await stuck(); for (let i = 0; i < 30 && /disabled/.test(st); i++) { await sleep(200); st = await stuck(); }
        ok(P + '.refused.not-stuck', !/disabled|none/.test(st.replace(/pass:none/, '')), `client ${sz}: 6 s after the refused Approve, the buttons work again (${st})`);
        if (/disabled|none/.test(st.replace(/pass:none/, ''))) { await t.ctx.close(); continue; }
        if (process.env.MATRIX_DEBUG) { await t.page.screenshot({ path: '/tmp/claude-0/-home-user-client-analytics/64f59a47-720b-5eeb-b761-f69e0558989f/scratchpad/after-refuse-' + sz + '.png' }); console.log('DEBUG box', await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const b = r.querySelector('[data-chg="video"]'); const x = b.getBoundingClientRect(); const top = document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2); return JSON.stringify(x) + ' top=' + (top && (top.id || top.className)) + ' overlay=' + (document.getElementById('confirmOverlay') || {}).className; })); }
        m = mark();
        if (process.env.MATRIX_DEBUG) console.log('DEBUG chg', JSON.stringify(await look(t)), W.versions.map(v => v.letter + ':' + v.status + (v.client_pass_at ? '/passed' : '')).join(' '));
        await RS.inS(t.page, '[data-chg="video"]').click(); await sleep(300);
        await RS.inS(t.page, '#ta').fill('Fictional note.');
        await t.page.keyboard.press('Escape'); await sleep(600);
        s = await rinv(t, P + '.chg-esc', `client ${sz}: Ask for a change, type, Escape`, { n0: m.n0, writes: 0 });
        await t.ctx.close();
      }
    } catch (e) { failures.push('review threw: ' + String(e && e.message || e).split('\n')[0]); console.error('FAIL  review threw', e); }

    // =====================================================================================================
    // D. NOTES: the version switch under the player
    // =====================================================================================================
    if (ONLY.has('notes')) try {
      seed(['A', 'B', 'C'], { status: 'approved' });
      for (const [w, h, sz] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
        const page = await S.newPage();
        await page.setViewportSize({ width: w, height: h });
        await S.openCalendar(page);
        await sleep(1500);
        await page.evaluate(() => openCalComments('p_t1'));
        await sleep(1800);
        const n0 = W.writes.length;
        const look = () => page.evaluate(() => ({
          sws: [...document.querySelectorAll('.trl-notes-sw')].filter(n => n.getClientRects().length).length,
          players: [...document.querySelectorAll('#calNotesShell video')].filter(n => n.getClientRects().length).length,
          active: ((document.querySelector('#calNotesShell .trl-notes-sw .is-active') || {}).textContent || '').trim(),
          playing: [...document.querySelectorAll('#calNotesShell video')].map(v => (/[?&]v=(\w)/.exec(v.currentSrc || v.src || '') || [])[1] || '').join(','),
        }));
        let s = await look();
        ok('notes.' + sz + '.open', s.sws === 1 && s.active === 'A', `notes ${sz}: one version switch, on A (${JSON.stringify(s)})`);
        for (const i of [2, 3, 1, 3, 2]) await page.click('#calNotesShell .trl-notes-sw .cal-cm-aud-btn:nth-child(' + i + ')').catch(() => {});
        await sleep(2500);
        s = await look();
        ok('notes.' + sz + '.rapid', s.sws === 1 && s.players <= 1 && s.active === 'B', `notes ${sz}: five quick switches end on B with one switch and one player (${JSON.stringify(s)})`);
        ok('notes.' + sz + '.plays', s.playing === 'b', `notes ${sz}: the player plays B's video, the version the switch names (${s.playing || 'none'})`);
        // From the start again: A is slow to answer; switch to C before it lands.
        await page.click('#calNotesShell .trl-notes-sw .cal-cm-aud-btn:nth-child(1)'); await sleep(60);
        await page.click('#calNotesShell .trl-notes-sw .cal-cm-aud-btn:nth-child(3)');
        await sleep(2500);
        s = await look();
        ok('notes.' + sz + '.slow-first', s.active === 'C' && s.playing === 'c', `notes ${sz}: A answered late after a switch to C: C plays (${JSON.stringify(s)})`);
        ok('notes.' + sz + '.writes', trialWrites(n0).length === 0, `notes ${sz}: switching versions writes nothing`);
        ok('notes.' + sz + '.errors', !page.errors.length, `notes ${sz}: no page errors (${page.errors.join(' | ')})`);
        await page.close();
      }
    } catch (e) { failures.push('notes threw: ' + String(e && e.message || e).split('\n')[0]); console.error('FAIL  notes threw', e); }

    // =====================================================================================================
    // E. TWO TABS AT ONCE, AND A RELOAD MID-WRITE
    // =====================================================================================================
    if (ONLY.has('tabs')) try {
      seed(['A', 'B', 'C']);
      const one = await openCal(1440, 900), two = await openCal(1440, 900);
      await openList(one); await openList(two);
      // E1. Tab one drops C; tab two (still showing C live) changes C's link.
      let m = mark();
      await one.hover(sel.row(3)); await one.click(sel.row(3) + ' .trl-ico[aria-label^="Drop Video"]'); await sleep(1200);
      await versionPencil(two, 3);
      await two.fill('.trl-link-input', LINK('C5'));
      await two.keyboard.press('Enter'); await sleep(1500);
      await inv(two, 'tabs.stale-link', 'tab two changes the link of C, which tab one dropped', { open: true });
      ok('tabs.stale-link.state', V('C').status === 'dropped', `tabs: C stays dropped (${V('C').status}, link ${short(V('C').frame_url)})`);
      // E2. Both tabs drop B at once.
      m = mark();
      await Promise.all([one, two].map(async p => { await p.hover(sel.row(2)); await p.click(sel.row(2) + ' .trl-ico[aria-label^="Drop Video"]'); }));
      await sleep(2000);
      await inv(one, 'tabs.both-drop.one', 'both tabs drop B: tab one', { open: true });
      await inv(two, 'tabs.both-drop.two', 'both tabs drop B: tab two', { open: true });
      ok('tabs.both-drop.state', V('B').status === 'dropped' && V('A').status !== 'dropped', `tabs: B dropped, A (the last live) kept (${W.versions.map(v => v.letter + ':' + v.status).join(' ')})`);
      // E3. Tab two, still showing A and B, tries to drop A (the last live version).
      await one.close(); await two.close();
      // E4. A reload in the middle of a slow write.
      seed(['A', 'B', 'C']);
      const page = await openCal(1440, 900);
      await openList(page);
      W.fault = { action: 'version_link_set', mode: 'lateReply', ms: 3000 };
      m = mark();
      await versionPencil(page, 2);
      await page.fill('.trl-link-input', LINK('B6'));
      await page.keyboard.press('Enter'); await sleep(300);
      await S.openCalendar(page);   // a reload: the page is loaded again while the write is still out
      await sleep(4000);
      await openList(page).catch(() => {});
      await inv(page, 'tabs.reload', 'reload while B\'s new link is in flight', { open: true });
      const d = await drawn(page);
      const bRow = d.rows[0] && d.rows[0].find(r => r.letter === 'B');
      ok('tabs.reload.agree', bRow && bRow.href === (V('B').frame_url || ''), `tabs: after the reload B's row shows what the backend holds (${short(bRow && bRow.href)} / ${short(V('B').frame_url)})`);
      await page.close();
    } catch (e) { failures.push('tabs threw: ' + String(e && e.message || e).split('\n')[0]); console.error('FAIL  tabs threw', e); }
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
    if (rbrowser) await rbrowser.close();
    if (rserver) rserver.close();
  }
  console.log(`trial-reels-action-matrix-browser: ${passed} checks passed` + (known.length ? `, ${known.length} KNOWN (${[...new Set(known.map(k => k.replace(/^.*\((.*)\)$/, '$1')))].join(', ')})` : '')
    + (nowPass.length ? `, ${nowPass.length} NOW PASS (un-mark them)` : '') + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
