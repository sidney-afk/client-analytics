'use strict';
/* Invented data for the staff phone harness. Nothing here is real: clients are
 * "Client A".."Client D", handles are made up, numbers are generated. */
const CLIENTS = ['Client A', 'Client B', 'Client C', 'Client D'];

function csv(rows) {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const keys = Object.keys(rows[0] || { col: 1 });
  return [keys.join(',')].concat(rows.map(r => keys.map(k => q(r[k])).join(','))).join('\r\n') + '\r\n';
}
function iso(d) { return d.toISOString().slice(0, 10); }

/* 60 days of daily rows per client, ending 2026-10-04 (the pinned "today"). */
function metricsCsv(days) {
  const rows = [];
  const end = Date.UTC(2026, 9, 4);
  CLIENTS.forEach((name, ci) => {
    for (let i = (days || 60) - 1; i >= 0; i--) {
      const day = new Date(end - i * 864e5);
      const t = (days || 60) - i;
      rows.push({
        client_name: name, date: iso(day),
        ig_followers: 12000 + ci * 3100 + t * (14 + ci * 3) + ((t * 7 + ci) % 11) * 4,
        tiktok_followers: 5200 + ci * 1900 + t * (22 + ci * 5) + ((t * 5) % 13) * 6,
        yt_subscribers: 800 + ci * 240 + t * 2,
        yt_total_views: 90000 + ci * 21000 + t * 310,
        /* A rolling 30 day total that keeps growing; one client repeats the same total so the "no 30 day total yet" dash is visible. */
        ig_views_this_month: ci === 2 ? 52000 : 40000 + ci * 9000 + t * 850,
        ig_views_gained_today: 900 + ((t * 37 + ci * 11) % 17) * 130,
        tiktok_plays_this_month: 62000 + ci * 12000 + t * 1100,
        tiktok_plays_gained_today: 1500 + ((t * 41 + ci * 7) % 19) * 210,
        ig_avg_views: 2100 + ci * 300, tiktok_avg_plays: 3300 + ci * 410,
      });
    }
  });
  return csv(rows);
}
function clientsInfoCsv() {
  return csv(CLIENTS.map((name, i) => ({
    client_name: name, instagram_handle: 'client_' + 'abcd'[i], tiktok_handle: 'client_' + 'abcd'[i],
    youtube_channel_id: i % 2 ? '' : 'UCexample' + i, postforme_account_id: i === 3 ? '' : 'spc_example_' + i,
  })));
}
function topVideosCsv() {
  const rows = [];
  CLIENTS.forEach((name, ci) => {
    ['instagram', 'tiktok'].forEach(platform => {
      for (let i = 1; i <= 5; i++) rows.push({
        client_name: name, platform, rank: i, url: 'https://example.invalid/' + platform + '/' + ci + i,
        caption: 'Example post ' + i + ' for ' + name, views: 90000 - i * 11000 + ci * 700, likes: 4200 - i * 500,
        comments: 120 - i * 10, shares: 80 - i * 9, thumbnail: '', date: '2026-09-' + String(10 + i).padStart(2, '0'),
      });
    });
  });
  return csv(rows);
}
/* Upload queue rows relative to the pinned clock (2026-10-05 15:00Z). */
function uploadRows() {
  const now = Date.UTC(2026, 9, 5, 15);
  const at = h => new Date(now + h * 36e5).toISOString();
  return [
    { id: 'u1', client: 'Client A', title: 'Three tips for a calmer morning', status: 'scheduled', scheduled_for: at(20), timezone: 'America/New_York' },
    { id: 'u2', client: 'Client B', title: 'Behind the scenes of this week\'s shoot, with a longer title that has to wrap onto a second line', status: 'scheduled', scheduled_for: at(72), timezone: 'America/Los_Angeles' },
    { id: 'u3', client: 'Client C', title: 'Launch day reel', status: 'failed', scheduled_for: at(-30), timezone: 'America/New_York', error: 'Post For Me rejected the video: unsupported frame rate.' },
    { id: 'u4', client: 'Client A', title: 'Our story in 30 seconds', status: 'posted', scheduled_for: at(-80), timezone: 'America/New_York', tiktok_url: 'https://example.invalid/post/4' },
    { id: 'u5', client: 'Client D', title: 'Q&A answers', status: 'posted', scheduled_for: at(-120), timezone: 'America/New_York' },
  ];
}
/* Workload board: invented people and clients; due dates fall in the week of
 * Mon 2026-10-05 (the pinned clock). */
const EDITORS = [
  { id: 'ed-1', name: 'editor-1', norm: 'editor1', team: 'Video' },
  { id: 'ed-2', name: 'editor-2', norm: 'editor2', team: 'Video' },
  { id: 'des-1', name: 'designer-1', norm: 'designer1', team: 'Graphics' },
];
function workloadRows(n) {
  const rows = [];
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-02'];
  const statuses = [['To Do', 'unstarted'], ['In Progress', 'started'], ['Tweaks Needed', 'started']];
  for (let i = 0; i < (n == null ? 18 : n); i++) {
    const ed = EDITORS[i % 3];
    const st = statuses[i % 3];
    rows.push({
      id: 'issue-' + i, identifier: (ed.team === 'Video' ? 'VID-' : 'GRA-') + (100 + i), title: 'Example deliverable ' + (i + 1),
      url: 'https://example.invalid/issue/' + i, is_sub_issue: true, parent_id: 'parent-' + (i % 4), parent_identifier: 'PAR-' + (i % 4),
      due_date: days[i % days.length], status: st[0], status_type: st[1], team_key: ed.team === 'Video' ? 'VID' : 'GRA', team_name: ed.team,
      assignee_id: ed.id, assignee_name: ed.name, assignee_email: null, client_name: CLIENTS[i % 3],
      linear_created_at: '2026-09-20T00:00:00.000Z', linear_updated_at: '2026-10-01T00:00:00.000Z', synced_at: '2026-10-05T14:00:00.000Z', sort_order: i,
    });
  }
  return rows;
}
const WORKLOAD_INIT = `(() => { const payload = ${JSON.stringify({ clients: ['Client A', 'Client B', 'Client C'], editors: ['editor1', 'editor2'], designers: ['designer1'] })};
  const t = setInterval(() => { if (typeof window.wlMergeClientsFromSheet !== 'function') return; clearInterval(t);
    try { window.wlMergeClientsFromSheet(payload.clients); } catch (e) {}
    try { for (const n of payload.editors) WL_ALLOWED_EDITORS.add(n); } catch (e) {}
    try { for (const n of payload.designers) WL_ALLOWED_GRAPHICS.add(n); } catch (e) {} }, 2);
  setTimeout(() => clearInterval(t), 30000); })();`;
/* SyncLinear (Production): invented clients, people and deliverables. */
function productionFixtures() {
  const now = '2026-10-04T12:00:00.000Z';
  const clients = CLIENTS.map((n, i) => ({ slug: 'fixture-client-' + 'abcd'[i], display_name: n, active: true, kind: 'video', linear_project_ids: [{ id: 'proj-' + i }] }));
  const members = [
    { id: 'm-admin', name: 'QA Admin', role: 'admin', team: 'graphics', active: true },
    { id: 'm-ed', name: 'Editor One', role: 'editor', team: 'video', active: true },
    { id: 'm-des', name: 'Designer One', role: 'designer', team: 'graphics', active: true },
  ];
  const sts = ['todo', 'in_progress', 'in_review', 'tweaks_needed', 'done', 'backlog'];
  const deliverables = [];
  for (let i = 0; i < 16; i++) {
    const c = clients[i % 4];
    const video = i % 2 === 0;
    deliverables.push({
      id: 'd-' + i, identifier: (video ? 'VID-' : 'GRA-') + (200 + i), raw_project_id: 'proj-' + (i % 4), client_slug: c.slug,
      team: video ? 'video' : 'graphics', title: (video ? 'Reel: ' : 'Thumbnail: ') + 'Example post ' + (i + 1), status: sts[i % sts.length],
      status_at: now, assignee_id: video ? 'm-ed' : 'm-des', due_date: i % 3 === 0 ? '2026-10-0' + (6 + (i % 3)) : null, origin: 'calendar', card_id: 'card-' + (i >> 1),
      created_at: now, updated_at: now,
    });
  }
  return { clients, members, deliverables };
}
module.exports = { productionFixtures, workloadRows, WORKLOAD_INIT, EDITORS, uploadRows, CLIENTS, csv, metricsCsv, clientsInfoCsv, topVideosCsv, iso };
