'use strict';
/* Shared stateful mock backend for the lost-work proofs (OPEN_REPAIRS 314). Fully mocked: every
 * non-localhost request is answered here, nothing reaches a live backend. Only the made-up client
 * `fixtureclient` appears. Modelled on prod-write-gateway-browser.js.
 *
 * The mock backend is STATEFUL and follows the real server rules that matter here:
 *   - calendar-upsert: field-level patch; the echo never carries *_status_at; a BEFORE trigger
 *     (migrations/calendar-status-at-migration.sql) stamps video_status_at = now() in the DB
 *     when video_status actually changes.
 *   - production-write status: no CAS (the page sends no expected_status), bridges onto the card.
 *   - production-write description: CAS on expected_updated_at -> 409 write_conflict.
 *   - production-write native_urgent_dispatch: urgentSnapshot rules (index.ts:3472):
 *       urgentRound() of the body must parse, card.video_status === 'Tweaks Needed',
 *       urgentRound(card.video_status_at) === urgentRound(body.video_status_at).
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require('playwright');
const { seedStaffIdentity } = require('../../../qa/staff-gate-seed.js');

const SLUG = 'fixtureclient';
const CLIENT = 'fixtureclient';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function serveStatic() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    p = path.normalize(p).replace(/^([.][\\/])+/, '');
    const full = path.join(REPO, p);
    if (!full.startsWith(REPO) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const iso = (ms) => new Date(ms).toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---- fake supabase-js (realtime only). Tests fire echoes with env.realtime(). ---- */
const FAKE_SUPABASE = `
window.__rtChannels = [];
window.supabase = { createClient: function () {
  return {
    channel: function (name) {
      var ch = { name: name, _cbs: [], on: function (t, f, cb) { ch._cbs.push({ f: f, cb: cb }); return ch; },
        subscribe: function (cb) { window.__rtChannels.push(ch); setTimeout(function () { if (cb) cb('SUBSCRIBED'); }, 20); return ch; },
        unsubscribe: function () {} };
      return ch;
    },
    removeChannel: function () { return Promise.resolve(); },
    from: function () { throw new Error('fake supabase: from() not mocked'); }
  };
} };
`;

async function createEnv(opts = {}) {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: opts.executablePath });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  let tick = 0;
  const T0 = Date.parse('2026-10-01T09:00:00.000Z');
  const S = {
    origin, browser, ctx, server,
    now: () => Date.now(),
    log: [],           // every backend request: {t, key, summary, outcome}
    behave: {},        // key -> { delay, mode, status, body, commit, times }
    pages: new Set(),
    cards: [], deliv: [], batches: [], comments: [],
    authority: { video: 'syncview', graphics: 'syncview' },
    commentsFor: [],
  };
  const t0 = Date.now();
  S.since = () => Date.now() - t0;
  // ---------- seed ----------
  S.cards.push({
    id: 'p_t1', client: SLUG, name: 'Test card one', status: 'In Progress', order_index: 1, updated_at: iso(T0),
    scheduled_date: '2026-10-09', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', title_status: 'In Progress',
    video_status_at: iso(T0), graphic_status_at: iso(T0), caption_status_at: iso(T0), title_status_at: iso(T0),
    asset_url: 'https://example.invalid/video.mp4', thumbnail_url: 'https://example.invalid/t.jpg', caption: 'A fictional caption.', name_set: true,
    video_deliverable_id: 'del_vid_1', graphic_deliverable_id: 'del_gra_1', platforms: 'instagram',
    comments: [], graphic_comments: [], caption_comments: [], title_comments: [],
  });
  S.deliv.push(
    { id: 'del_vid_1', identifier: 'VID-T1', raw_project_id: 'proj1', client_slug: SLUG, team: 'video', kind: 'video', title: 'Test card one', status: 'in_progress', status_at: iso(T0), assignee_id: 'ed1', due_date: null, origin: 'calendar', card_id: 'p_t1', batch_id: 'b1', brief: 'Original description', created_at: iso(T0), updated_at: iso(T0), linear_issue_uuid: 'lin-vid-1' },
    { id: 'del_gra_1', identifier: 'GRA-T1', raw_project_id: 'proj1', client_slug: SLUG, team: 'graphics', kind: 'graphic', title: 'Test card one', status: 'in_progress', status_at: iso(T0), assignee_id: 'des1', due_date: null, origin: 'calendar', card_id: 'p_t1', batch_id: 'b1', brief: 'Graphic description', created_at: iso(T0), updated_at: iso(T0), linear_issue_uuid: 'lin-gra-1' },
  );
  S.batches.push({ id: 'b1', client_slug: SLUG, status: 'active', purpose: 'calendar', name: 'Batch one', team: null, updated_at: iso(T0), created_at: iso(T0), linear_parent_ids: { video: { uuid: 'linear-parent-video' }, graphics: { uuid: 'linear-parent-graphics' } } });
  const members = [
    { id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true },
    { id: 'ed1', name: 'Fixture Editor', role: 'editor', team: 'video', active: true, slack_user_id: 'U0000000001' },
    { id: 'des1', name: 'Fixture Designer', role: 'designer', team: 'graphics', active: true },
  ];
  const clients = [{ slug: SLUG, display_name: CLIENT, active: true, kind: 'test', linear_project_ids: [{ id: 'proj1' }] }];

  // ---------- helpers on the model ----------
  const card = (id) => S.cards.find(c => c.id === id);
  S.card = card;
  const STATUS_SLUG = { 'In Progress': 'in_progress', 'Tweaks Needed': 'tweak', 'For SMM Approval': 'smm_approval', 'Kasper Approval': 'kasper_approval', 'Client Approval': 'client_approval', 'Approved': 'approved', 'Scheduled': 'scheduled', 'Posted': 'posted' };
  const SLUG_STATUS = Object.fromEntries(Object.entries(STATUS_SLUG).map(([k, v]) => [v, k]));
  S.setCardField = (id, patch, who) => {   // a DB write by "someone else" (other tab / teammate) incl. the trigger stamp
    const c = card(id);
    for (const comp of ['video', 'graphic', 'caption', 'title']) {
      const k = comp + '_status';
      if (k in patch && patch[k] !== c[k]) c[comp + '_status_at'] = iso(Date.now());
    }
    Object.assign(c, patch);
    c.updated_at = iso(Date.now());
    S.log.push({ t: S.since(), key: 'DB:' + (who || 'other-writer'), summary: JSON.stringify(patch).slice(0, 160) });
  };
  S.realtime = async (delay = 0) => {
    if (delay) await sleep(delay);
    for (const p of S.pages) { try { await p.evaluate(() => (window.__rtChannels || []).forEach(ch => ch._cbs.forEach(c => { try { c.cb({ eventType: 'UPDATE' }); } catch (e) {} }))); } catch (e) {} }
  };

  // ---------- behaviour table ----------
  // S.behave[key] = {delay, mode:'ok'|'reject'|'http', status, body, commit(default true), times}
  function takeBehavior(key) {
    const b = S.behave[key];
    if (!b) return null;
    if (typeof b.times === 'number') { if (b.times <= 0) return null; b.times--; }
    return b;
  }
  const json = (route, status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});

  /* Run `apply()` (the server-side commit) according to the behaviour, then deliver the response. */
  async function serve(route, key, summary, apply) {
    const entry = { t: S.since(), key, summary, outcome: 'received' };
    S.log.push(entry);
    const b = takeBehavior(key);
    let commit = !(b && (b.mode === 'reject') && b.commit !== true);
    if (b && b.commit === false) commit = false;
    let result = null;
    if (commit) result = apply();
    if (b && b.delay) await sleep(b.delay);
    if (b && b.mode === 'reject') { entry.outcome = 'connection-failed (committed=' + commit + ')'; return route.abort('failed').catch(() => {}); }
    if (b && b.mode === 'http') { entry.outcome = 'http ' + b.status + ' (committed=' + commit + ')'; return json(route, b.status, b.body || { ok: false, error: 'synthetic' }); }
    if (!result) result = apply();
    entry.outcome = 'http ' + result.status + ' ' + (result.body && (result.body.error || (result.body.ok ? 'ok' : '')));
    return json(route, result.status, result.body);
  }

  const deliverableOut = (d) => ({ ...d });

  // ---------- network ----------
  await ctx.route(u => !u.toString().startsWith(origin), async route => {
    const r = route.request(); const u = new URL(r.url()); const p = u.pathname; const sp = u.searchParams;
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (S.offline) { S.log.push({ t: S.since(), key: 'OFFLINE-ABORT ' + r.method() + ' ' + p, summary: '' }); return route.abort('internetdisconnected').catch(() => {}); }
    if (/jsdelivr|supabase-js/.test(u.host + p)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE });
    let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}

    if (p === '/functions/v1/key-verify') return json(route, 200, { ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (p === '/functions/v1/write-diagnostics') { S.log.push({ t: S.since(), key: 'write-diagnostics', summary: JSON.stringify(body).slice(0, 200) }); return json(route, 202, { ok: true }); }
    if (p === '/functions/v1/brain') return json(route, 200, { ok: true, frame: [], raw: [] });
    if (p === '/functions/v1/filming-plans') return json(route, 200, { ok: true, plans: [] });
    if (p === '/functions/v1/production-comments') return json(route, 200, { comments: S.comments.filter(c => !body.deliverable_id || c.deliverable_id === body.deliverable_id).map(c => ({ ...c, source_created_at: c.created_at, source_updated_at: c.updated_at })), next_cursor: null, has_more: false, canonical_thread: true });

    if (p === '/functions/v1/calendar-upsert') {
      const post = body.post || {};
      return serve(route, 'cal-upsert', JSON.stringify({ id: post.id, keys: Object.keys(post).filter(k => k !== 'id').slice(0, 14), video_status: post.video_status, baseAt: String(body.comments_base_at || '') }), () => {
        let c = card(post.id);
        if (!c) { c = { id: post.id, client: SLUG, status: 'In Progress', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', title_status: 'In Progress', comments: [], updated_at: iso(Date.now()), video_status_at: iso(Date.now()), graphic_status_at: iso(Date.now()) }; S.cards.push(c); S.log.push({ t: S.since(), key: 'DB:insert-card', summary: post.id }); }
        // applyGuards() (calendar-upsert/index.ts:363): a stale tab (its comments_base_at older than the stored updated_at) that changes a scalar field is refused with ok:false/conflict:true
        const baseAt = String(body.comments_base_at || '');
        const SCALARS = ['scheduled_date','name','caption','caption_alt','caption_alt_platform','asset_url','thumbnail_url','post_url','cta','status','video_status','graphic_status','caption_status','linear_issue_id','video_deliverable_id','graphic_linear_issue_id','graphic_deliverable_id','platform','platforms','color','kasper_approved_at','posted_at'];
        if (baseAt && c.updated_at && String(c.updated_at) > baseAt) {
          const changed = SCALARS.filter(k => k in post && String(post[k] == null ? '' : post[k]) !== String(c[k] == null ? '' : c[k]));
          if (changed.length) return { status: 200, body: { ok: false, conflict: true, id: c.id, error: 'Not saved: someone else updated this card (' + changed.join(', ') + ') after your screen last loaded it. Refresh the calendar to see their version, then re-apply your change.' } };
        }
        const FIELDS = Object.keys(post).filter(k => !/_status_at$/.test(k) && !/^_/.test(k));
        const patch = {}; for (const k of FIELDS) patch[k] = post[k];
        S.setCardField(c.id, patch, 'cal-upsert');
        const echo = { ...patch, id: c.id, updated_at: c.updated_at };
        return { status: 200, body: { ok: true, post: echo } };
      });
    }
    if (p === '/functions/v1/calendar-reorder') return json(route, 200, { ok: true });

    if (p === '/functions/v1/production-write') {
      const op = body.operation || body.action || '?';
      const key = 'gw:' + (op === 'native_urgent_dispatch' ? 'urgent' : op === 'native_urgent_status' ? 'urgent_status' : op);
      const READ_ACTIONS = ['labels_read', 'asset_access_read', 'assignee_options', 'create_options', 'intake_editor_options'];
      if (body.action === 'description_read') {
        const d = S.deliv.find(x => x.id === body.id);
        return serve(route, 'gw:description_read', body.id, () => d ? { status: 200, body: { ok: true, complete: true, row: { id: d.id, client_slug: d.client_slug, team: d.team, brief: d.brief, updated_at: d.updated_at } } } : { status: 403, body: { ok: false, error: 'description_scope_forbidden' } });
      }
      if (body.action === 'asset_access_read') return json(route, 200, { ok: true, complete: true, assets: [{ slot: 'filming_plan', state: 'missing', url: null }, { slot: 'raw_footage', state: 'missing', url: null }, { slot: 'delivery_folder', state: 'missing', url: null }, { slot: 'deliverable_file', state: 'missing', url: null }] });
      if (body.action === 'labels_read') return json(route, 200, { ok: true, complete: true, authority: 'syncview', catalog: [], selected_label_ids: [], selected_labels: [] });
      if (body.action === 'assignee_options') return json(route, 200, { ok: true, complete: true, assignees: members.filter(m => m.team).map(m => ({ id: m.id, name: m.name })) });
      if (body.action === 'create_options') return json(route, 200, { ok: true, complete: true, authority: 'syncview', catalog: [], assignees: members.filter(m => m.team === body.team).map(m => ({ id: m.id, name: m.name })) });
      if (body.action === 'intake_editor_options') return json(route, 400, { ok: false, error: 'unsupported_action' });

      if (body.action === 'native_urgent_dispatch') {
        return serve(route, 'gw:urgent', JSON.stringify({ video_status_at: body.video_status_at, deliverable_id: body.deliverable_id, card_id: body.card_id }), () => {
          const notSent = (status, error) => ({ status, body: { ok: false, error, delivery: 'not_sent', retry_safe: true } });
          const d = S.deliv.find(x => x.id === body.deliverable_id);
          if (!d || d.status !== 'tweak') return notSent(409, 'urgent_target_changed');
          const c = card(body.card_id);
          if (!c) return notSent(409, 'urgent_context_unavailable');
          // urgentRound(): ISO with zone, else 409 urgent_round_unavailable
          const rx = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
          if (!rx.test(String(body.video_status_at || ''))) return notSent(409, 'urgent_round_unavailable');
          const round = new Date(body.video_status_at).toISOString();
          const cardRound = c.video_status_at ? new Date(c.video_status_at).toISOString() : null;
          if (c.video_deliverable_id !== d.id || c.video_status !== 'Tweaks Needed' || cardRound !== round) return notSent(409, 'urgent_target_changed');
          S.urgentSent = (S.urgentSent || 0) + 1;
          return { status: 202, body: { ok: true, delivery: 'pending', dispatch_id: 'disp-' + S.urgentSent, retry_safe: false } };
        });
      }
      if (body.action === 'native_urgent_status') {
        return serve(route, 'gw:urgent_status', '', () => ({ status: 200, body: { ok: true, delivery: S.urgentSent ? 'sent' : 'absent', sent: !!S.urgentSent } }));
      }
      if (body.operation === 'intake_create') {
        return serve(route, 'gw:intake_create', JSON.stringify({ batch_id: body.batch_id, expected: body.expected_batch_updated_at, items: (body.items || []).length, req: String(body.request_id || '').slice(0, 40) }), () => {
          const b = S.batches.find(x => x.id === body.batch_id);
          if (b && body.expected_batch_updated_at && Date.parse(body.expected_batch_updated_at) !== Date.parse(b.updated_at)) {
            return { status: 409, body: { ok: false, error: 'write_conflict', conflict: true } };
          }
          S.intakeCount = (S.intakeCount || 0) + 1;
          const items = (body.items || []).map((item, item_index) => ({ item_index, id: 'native-' + S.intakeCount + '-' + item.team + '-' + item.videoNumber, team: item.team, card_id: item.card_id, origin: 'calendar', title: 'Fixture ' + item.team + ' ' + item.videoNumber + (item.name ? ' \u2014 ' + item.name : ''), linear_issue_url: 'https://linear.invalid/x' }));
          if (b) b.updated_at = iso(Date.now());
          S.lastIntake = { body, items };
          return { status: 201, body: { ok: true, native_committed: true, mirror_pending: false, batch: { id: body.batch_id || 'native-batch-' + S.intakeCount }, items } };
        });
      }
      if (['status', 'comment', 'description', 'due', 'assignee', 'labels'].includes(body.operation)) {
        const d = S.deliv.find(x => x.id === body.id);
        return serve(route, 'gw:' + body.operation, JSON.stringify({ op: body.operation, id: body.id, status: body.status, exp_upd: body.expected_updated_at, req: body.request_id }), () => {
          if (!d) return { status: 403, body: { ok: false, error: 'scope_forbidden' } };
          // assertCas() (production-write/index.ts:1639): applies whenever the page sent expected_*
          if ((body.expected_updated_at !== undefined && body.expected_updated_at !== d.updated_at)
              || (body.expected_status !== undefined && body.expected_status !== d.status)) {
            return { status: 409, body: { ok: false, error: 'write_conflict', conflict: true, row: deliverableOut(d) } };
          }
          let comment = null;
          if (body.operation === 'status') {
            d.status = body.status; d.status_at = iso(Date.now());
            if (d.team === 'video' && d.card_id) {   // the native -> calendar bridge (migrations/2026-09-18-native-calendar-status-bridge.sql)
              const c = card(d.card_id); const cs = SLUG_STATUS[body.status];
              if (c && cs && c.video_status !== cs) S.setCardField(c.id, { video_status: cs }, 'status-bridge');
            }
          }
          if (body.operation === 'description') d.brief = body.description;
          if (body.operation === 'due') d.due_date = body.due_date || null;
          if (body.operation === 'assignee') d.assignee_id = body.assignee_id || null;
          d.updated_at = iso(Date.now());
          if (body.operation === 'comment') {
            comment = { id: 'c' + (S.comments.length + 1), deliverable_id: d.id, body: (body.comment || {}).body, audience: (body.comment || {}).audience, author_name: 'Browser Staff', created_at: iso(Date.now()), updated_at: iso(Date.now()), version: 1, native_comment_id: 'nc' + (S.comments.length + 1) };
            S.comments.push(comment);
          }
          return { status: 200, body: { ok: true, native_committed: true, mirror_pending: true, row: deliverableOut(d), ...(comment ? { comment } : {}) } };
        });
      }
      S.log.push({ t: S.since(), key: 'gw:UNHANDLED', summary: JSON.stringify(body).slice(0, 200) });
      return json(route, 200, { ok: true, native_committed: true, row: {} });
    }

    if (p === '/rest/v1/clients') return json(route, 200, clients);
    if (p === '/rest/v1/team_members') return json(route, 200, members);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(route, 200, keys.filter(k => k !== 'client_comment_gateway_enabled').map(k => ({ key: k, value: k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false } })));
    }
    if (p === '/rest/v1/calendar_posts') {
      S.log.push({ t: S.since(), key: 'READ calendar_posts', summary: '' });
      const b = takeBehavior('read:calendar_posts');
      if (b && b.delay) await sleep(b.delay);
      if (b && b.mode === 'reject') return route.abort('failed').catch(() => {});
      return json(route, 200, S.cards.map(c => ({ ...c })));
    }
    if (p === '/rest/v1/batches') return json(route, 200, S.batches.map(b => ({ ...b })));
    if (p === '/rest/v1/production_deliverables_browser_v1' || p === '/rest/v1/deliverables') {
      const idf = (sp.get('id') || '').replace(/^eq\./, '');
      const rows = idf ? S.deliv.filter(d => d.id === idf) : S.deliv;
      return json(route, 200, rows.map(d => ({ ...d })));
    }
    if (/\/rest\/v1\//.test(p)) return json(route, 200, []);
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    if (r.method() !== 'GET') { S.log.push({ t: S.since(), key: 'OTHER ' + r.method() + ' ' + p, summary: '' }); return json(route, 200, { ok: true }); }
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json(route, 200, {});
    return route.abort().catch(() => {});
  });
  await seedStaffIdentity(ctx, { id: 'm1', name: 'Browser Staff', role: 'admin', team: null }, 'rk-harness-7f3a9c');

  // ---------- page helpers ----------
  const INSTRUMENT = () => {
    window.__seen = window.__seen || [];
    const t0 = performance.now();
    const rec = (kind, a, b) => window.__seen.push({ ms: Math.round(performance.now()), kind, a: String(a == null ? '' : a), b: String(b == null ? '' : b) });
    if (!window.__wrapped) {
      window.__wrapped = true;
      const sn = window.showNotify; window.showNotify = function (t, m) { rec('notify', t, m); return sn.apply(this, arguments); };
      const st = window.showToast; if (st) window.showToast = function (m, o) { rec('toast', m, o && o.actionLabel); return st.apply(this, arguments); };
      const pt = window._prodToast; if (typeof pt === 'function') window._prodToast = function (m) { rec('prodToast', m, ''); return pt.apply(this, arguments); };
      const sc = window.showConfirm; window.showConfirm = function (t, m, cb, cta) { rec('confirm', t, m); return sc.apply(this, arguments); };
    }
  };
  S.newPage = async () => {
    const page = await ctx.newPage();
    page.errors = [];
    if (process.env.LOST_WORK_FAST) page.setDefaultTimeout(2500);   // used to watch the proofs fail quickly on older code
    page.on('pageerror', e => page.errors.push(String(e.message || e).slice(0, 200)));
    S.pages.add(page);
    page.on('close', () => S.pages.delete(page));
    return page;
  };
  S.openCalendar = async (page) => {
    await page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function' && typeof showNotify === 'function', null, { timeout: 30000 });
    await page.evaluate(client => { _syncviewStaffIdentityVerified = true; _calSavePins([client]); navTo('calendar'); }, CLIENT);
    await page.waitForSelector('.cal-linear-pile, .cal-card, [data-post-id]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.evaluate(INSTRUMENT);
    return page;
  };
  S.openProduction = async (page) => {
    await page.goto(origin + '/?prod=1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-prod-row]', { timeout: 20000 });
    await page.evaluate(() => { _syncviewStaffIdentityVerified = true; try { _prodRender(); } catch (e) {} });
    await page.waitForTimeout(600);
    await page.evaluate(INSTRUMENT);
    return page;
  };
  S.instrument = (page) => page.evaluate(INSTRUMENT);
  S.close = async () => { try { await browser.close(); } catch (e) {} await new Promise(r => server.close(r)); };
  S.STATUS_SLUG = STATUS_SLUG; S.SLUG_STATUS = SLUG_STATUS;
  return S;
}

/* What the person sees right now: modal notice (title+text), toasts, alert/error banners, and whatever the caller asks for. */
async function see(page, extra) {
  return page.evaluate((extraSel) => {
    const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const ov = document.getElementById('confirmOverlay');
    const modal = ov && ov.classList.contains('active') ? { title: (document.getElementById('confirmTitle') || {}).textContent, text: (document.getElementById('confirmMsg') || {}).textContent, button: (document.getElementById('confirmYes') || {}).textContent } : null;
    const toast = [...document.querySelectorAll('.sv-toast, .toast, [data-toast]')].filter(vis).map(e => e.textContent.trim().slice(0, 240));
    const alerts = [...document.querySelectorAll('[role="alert"], .is-error, .cal-save-error, .prod-save-error')].filter(vis).map(e => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 300)).filter(t => t && !/^Feedback from the original card is unavailable|^Asset access could not be verified/.test(t));
    const out = { modal, toast, alerts };
    for (const [k, sel] of Object.entries(extraSel || {})) {
      const el = document.querySelector(sel);
      out[k] = el ? { text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 300), disabled: !!el.disabled, cls: (el.className || '').toString().slice(0, 80), value: el.value } : null;
    }
    out.seen = (window.__seen || []).slice(-8);
    return out;
  }, extra || null);
}

module.exports = { createEnv, see, sleep, SLUG, CLIENT, iso, REPO, chromium };
