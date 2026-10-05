'use strict';
/* Every screen and state the phone layout covers, with invented data. */
const F = require('./fixtures');
const json = body => r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const fail = r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' });
const sheets = over => Object.assign({
  'sheet=Metrics': () => F.metricsCsv(), 'sheet=Clients%20Info': () => F.clientsInfoCsv(), 'sheet=TopVideos': () => F.topVideosCsv(),
  'Market%20Research': 'col\r\n', 'ContentSummaries': 'col\r\n',
}, over || {});
const base = (hash, extra) => {
  const o = Object.assign({ hash, csv: sheets(), routes: [], fn: {} }, extra || {});
  if (!o.noTk) o.routes.push(['**/webhook/tiktok-uploads-list**', o.tkList || json({ rows: [] })]);
  if (!o.fn['instagram-upload']) o.fn['instagram-upload'] = body => (body && body.action === 'list' ? { ok: true, rows: o.igRows || [] } : { ok: false, error: 'offline_harness' });
  o.fnReads = true;
  return o;
};
const WL_FLAGS = [{ key: 'prod_authority', value: { video: 'syncview', graphics: 'syncview' } }];
const wl = (o) => {
  const opts = o || {};
  const rows = opts.rows || F.workloadRows();
  return base('#workload', {
    init: F.WORKLOAD_INIT,
    rest: {
      workload_issues: opts.fail ? (() => { throw new Error('refused'); }) : rows,
      syncview_runtime_flags: WL_FLAGS, production_deliverables_browser_v1: rows.filter(r => r.is_sub_issue).map(r => ({
        id: r.id, client_slug: 'fixture-' + String(r.client_name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), team: r.team_name,
        linear_issue_uuid: r.id, due_date: r.due_date, updated_at: '2026-10-05T14:00:00.000Z', workload_labels_complete: true, workload_labels: [],
      })),
    },
    fn: { 'workload-plan': b => {
        if (b && b.action === 'list') return { ok: true, plans: [] };
        if (b && /^native_snapshot/.test(b.action)) {
          if (opts.fail) return { ok: false, error: 'offline_harness_refused' };
          const parents = {}; rows.forEach(r => { if (r.parent_id) parents[r.parent_id] = r.parent_identifier; });
          const snap = rows.map(r => Object.assign({}, r, { source: 'native', linear_id: r.id, native_client_active: true, native_assignee_eligible: true, client_slug: 'fixture-' + String(r.client_name).toLowerCase().replace(/[^a-z0-9]+/g, '-') }));
          return { ok: true, complete: true, contract: 'workload-native-snapshot-v2', version: 'fixture-1', parents, rows: snap, plans: snap.slice(0, 12).map((r, i) => ({ issue_id: r.id, plan_date: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'][i % 5] })), count: snap.length, legacy_teams: [],
            authority: { video: 'syncview', graphics: 'syncview' }, roster: F.EDITORS.map(e => ({ id: e.id, native_id: 'native-' + e.id, name: e.name, team: e.team.toLowerCase() })) };
        }
        return { ok: false };
      }, 'instagram-upload': () => ({ ok: true, rows: [] }) },
  });
};
const prodOpts = (o) => {
  const P = F.productionFixtures();
  const rows = (o && o.rows) || P.deliverables;
  return base('#production', {
    rest: { clients: P.clients, team_members: P.members, production_deliverables_browser_v1: (o && o.fail) ? (() => { throw new Error('x'); }) : rows, deliverables: rows, batches: [], deliverable_events: [],
      syncview_runtime_flags: [{ key: 'prod_authority', value: { video: 'syncview', graphics: 'syncview' } }] },
    fn: { 'production-comments': () => ({ comments: [], next_cursor: null }), 'production-write': () => ({ ok: false, error: 'offline_harness' }) },
  });
};
const wait = (p, ms) => p.waitForTimeout(ms || 400);
const pick = name => async p => { await p.evaluate(n => _tkPickClient(n), name); await wait(p); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const seq = (...fns) => async p => { for (const f of fns) await f(p); };
const UP = { settle: 2500 };
const TK = (id, steps, extra) => Object.assign({ id, open: base('#tiktok-upload', extra), steps }, UP);
const IG = (id, steps, extra) => Object.assign({ id, open: base('#tiktok-upload', extra), steps: seq(async p => { await p.click('#tkPlatInstagram'); await wait(p, 900); }, steps || (async () => {})) }, UP);

const SCENARIOS = [
  TK('tiktok-empty'),
  TK('tiktok-client-ready', pick('Client A')),
  TK('tiktok-no-account', pick('Client D')),
  TK('tiktok-video-attached', seq(pick('Client A'), async p => {
    await p.setInputFiles('#tkFile', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048) }); await wait(p, 600);
    await p.fill('#tkTitle', 'Three tips for a calmer morning #routine'); await wait(p);
  })),
  TK('tiktok-photos-empty', seq(pick('Client A'), async p => { await p.click('text=Photo carousel'); await wait(p); })),
  TK('tiktok-photos-attached', seq(pick('Client A'), async p => {
    await p.click('text=Photo carousel'); await wait(p);
    await p.setInputFiles('#tkPhotoFile', [1, 2, 3].map(i => ({ name: 'photo-' + i + '.png', mimeType: 'image/png', buffer: PNG }))); await wait(p, 700);
  })),
  TK('tiktok-schedule', seq(pick('Client A'), async p => { await p.click('.tk-sched-head .tk-toggle'); await wait(p, 500); })),
  TK('tiktok-options', seq(pick('Client A'), async p => { await p.click('#tkOptsToggle'); await wait(p, 500); })),
  TK('tiktok-queue-upcoming', null, { tkList: json({ rows: F.uploadRows() }) }),
  TK('tiktok-queue-failed', async p => { await p.click('#tkQueueCol .tk-q-tab:nth-child(2)'); await wait(p); }, { tkList: json({ rows: F.uploadRows() }) }),
  TK('tiktok-queue-done', async p => { await p.click('#tkQueueCol .tk-q-tab:nth-child(3)'); await wait(p); }, { tkList: json({ rows: F.uploadRows() }) }),
  TK('tiktok-queue-error', null, { tkList: fail }),
  TK('tiktok-queue-loading', null, { tkList: () => new Promise(() => {}) }),
  TK('tiktok-cancel-confirm', async p => { await p.click('#tkQueueCol .tk-q-danger'); await wait(p, 500); }, { tkList: json({ rows: F.uploadRows() }) }),
  IG('instagram-empty'),
  IG('instagram-client-ready', async p => { await p.evaluate(() => { const s = document.querySelector('#igFormCol select'); if (s) { s.value = [...s.options].find(o => /Client A/.test(o.text))?.value; s.dispatchEvent(new Event('change', { bubbles: true })); } }); await wait(p); }),
  IG('instagram-frame-cover', async p => { await p.click('#igFormCol >> text=Frame from video'); await wait(p); }),
  IG('instagram-queue', null, { igRows: F.uploadRows().map(r => Object.assign({}, r)) }),
  { id: 'analytics-overview', open: base('#analytics'), settle: 3500 },
  { id: 'analytics-grid', open: base('#analytics'), settle: 3500, steps: async p => { await p.click('.view-toggle-btn:nth-child(2)'); await wait(p, 600); } },
  { id: 'analytics-detail', open: base('#analytics'), settle: 3500, steps: async p => { await p.click('.overview-table tbody >> text=Client A'); await wait(p, 2500); } },
  { id: 'analytics-loading', open: base('#analytics', { csv: sheets({ 'sheet=Metrics': { hold: true }, 'sheet=Clients%20Info': { hold: true } }) }), settle: 2500 },
  { id: 'analytics-empty', open: base('#analytics', { csv: sheets({ 'sheet=Metrics': 'client_name,date\r\n', 'sheet=TopVideos': 'col\r\n' }) }), settle: 3500 },
  { id: 'analytics-error', open: base('#analytics', { csv: sheets({ 'sheet=Metrics': { status: 500, contentType: 'text/plain', body: 'down' } }) }), settle: 4500 },
  { id: 'analytics-content-calendar', open: base('#analytics'), settle: 3500, steps: async p => { await p.click('.overview-table tbody >> text=Client A'); await wait(p, 2000); await p.click('text=Content Calendar'); await wait(p, 2500); } },
  { id: 'analytics-brief', open: base('#analytics'), settle: 3500, steps: async p => { await p.click('.overview-table tbody >> text=Client A'); await wait(p, 2000); await p.click('.view-tab-btn >> text=Brief'); await wait(p, 2500); } },
  TK('tiktok-post-error', seq(pick('Client A'), async p => {
    await p.setInputFiles('#tkFile', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048) }); await wait(p, 500);
    await p.fill('#tkTitle', 'Three tips for a calmer morning'); await p.click('#tkSubmit'); await wait(p, 1200);
  }), { routes: [['**/webhook/tiktok-upload', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Post For Me did not accept this video (example refusal).' }) })]] }),
  TK('tiktok-posting', seq(pick('Client A'), async p => {
    await p.setInputFiles('#tkFile', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048) }); await wait(p, 500);
    await p.fill('#tkTitle', 'Three tips for a calmer morning'); await p.click('#tkSubmit'); await wait(p, 800);
  }), { routes: [['**/webhook/tiktok-upload', () => new Promise(() => {})]] }),
  { id: 'analytics-search', open: base('#analytics'), settle: 3500, steps: async p => { await p.fill('#searchInput', 'Client'); await wait(p, 700); } },
  { id: 'analytics-pin', open: base('#analytics'), settle: 3500, steps: async p => { await p.click('.pin-add-btn'); await wait(p, 600); } },
  { id: 'analytics-week', open: base('#analytics'), settle: 3500, steps: async p => { await p.click('.controls-left >> text=Week'); await wait(p, 800); } },
  { id: 'workload-editors-menu', open: wl(), settle: 4000, steps: async p => { await p.click('text=All editors'); await wait(p, 600); } },
  { id: 'workload-clients-search', open: wl(), settle: 4000, steps: async p => { await p.click('#wlClientSearchInput'); await wait(p, 700); } },
  { id: 'workload-popover', open: wl(), settle: 4000, steps: async p => { await p.click('.workload-day .workload-day-card-chip >> nth=0'); await wait(p, 800); } },
  { id: 'workload-plan-due', open: wl(), settle: 4000, steps: async p => { await p.click('text=Plan + Due Date'); await wait(p, 800); } },
  { id: 'linear-search', open: prodOpts(), settle: 4500, viewportOnly: true, steps: async p => { await p.click('#fphMoreBtn'); await wait(p); await p.click('.fph-row >> text=Search'); await wait(p, 900); } },
  { id: 'linear-status-picker', open: prodOpts(), settle: 4500, viewportOnly: true, steps: async p => { await p.click('.prod-row .prod-status >> nth=0'); await wait(p, 700); } },
  { id: 'linear-assignee-picker', open: prodOpts(), settle: 4500, viewportOnly: true, steps: async p => { await p.click('.prod-row .prod-assign-hot >> nth=0'); await wait(p, 700); } },
  { id: 'linear-due-picker', open: prodOpts(), settle: 4500, viewportOnly: true, steps: async p => { await p.click('.prod-row .prod-due >> nth=0'); await wait(p, 700); } },
  { id: 'linear-backlog', open: prodOpts(), settle: 4500, viewportOnly: true, steps: async p => { await p.click('.prod-tab >> text=Backlog'); await wait(p, 700); } },
  { id: 'workload-week', open: wl(), settle: 4000 },
  { id: 'workload-month', open: wl(), settle: 4000, steps: async p => { await p.click('text=Month'); await wait(p, 800); } },
  { id: 'workload-loading', open: (() => { const o = wl(); o.fn = Object.assign({}, o.fn, { 'workload-plan': { __hold: true } }); return o; })(), settle: 2500 },
  { id: 'workload-empty', open: wl({ rows: [] }), settle: 4000 },
  { id: 'workload-error', open: wl({ fail: true }), settle: 4000 },
  { id: 'linear-list', open: prodOpts(), settle: 4500, viewportOnly: true },
  { id: 'linear-more', open: prodOpts(), settle: 4500, viewportOnly: true, steps: async p => { await p.click('#fphMoreBtn'); await wait(p); } },
  { id: 'linear-detail', open: prodOpts(), settle: 4500, viewportOnly: true, steps: async p => { await p.click('.prod-row >> nth=0'); await wait(p, 1500); } },
  { id: 'linear-filter', open: prodOpts(), settle: 4500, viewportOnly: true, steps: async p => { await p.click('#prodFilterBtn'); await wait(p, 700); } },
  { id: 'linear-display', open: prodOpts(), settle: 4500, viewportOnly: true, steps: async p => { await p.click('#prodGroupBtn'); await wait(p, 700); } },
  { id: 'linear-loading', open: Object.assign(prodOpts(), { rest: Object.assign({}, prodOpts().rest, { production_deliverables_browser_v1: { __hold: true } }) }), settle: 2500, viewportOnly: true },
  { id: 'linear-empty', open: prodOpts({ rows: [] }), settle: 4000, viewportOnly: true },
  { id: 'linear-error', open: prodOpts({ fail: true }), settle: 4000, viewportOnly: true },
  { id: 'menu-tabs', open: base('#tiktok-upload'), settle: 2500, steps: async p => { await p.click('#fphTabsBtn'); await wait(p); }, viewportOnly: true },
  { id: 'menu-more', open: base('#tiktok-upload'), settle: 2500, steps: async p => { await p.click('#fphMoreBtn'); await wait(p); }, viewportOnly: true },
  { id: 'menu-client', open: base('#tiktok-upload'), settle: 2500, steps: async p => { await p.click('#fphMoreBtn'); await wait(p); await p.click('text=Change client'); await wait(p, 600); }, viewportOnly: true },
];
module.exports = { SCENARIOS, F };
