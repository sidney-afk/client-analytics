'use strict';
/*
 * The one-time cleanup that parks open work items behind archived samples and
 * calendar posts (scripts/archived-work-items-park.js). Offline: the network
 * is a fake. Proves the planner's rules, that the dry run prints counts only
 * and writes nothing, and that --apply goes through the guarded gateway
 * status operation (never a table write), one request per item, and reads the
 * change journal back. Fixture names only; this repo is public.
 */
const assert = require('assert');
const { plan, counts, main } = require('../scripts/archived-work-items-park.js');

let failures = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { failures++; console.error('FAIL  ' + msg); } }

const clients = [{ slug: 'fixture-real', kind: 'client' }, { slug: 'fixture-test', kind: 'test' }];
const cards = [
  { source: 'sample', surface: 'sxr', rows: [
    { id: 's1', client: 'fixture-real', status: 'Archived', video_deliverable_id: 'd1', graphic_deliverable_id: 'd2' },
    { id: 's2', client: 'fixture-test', status: 'Archived', video_deliverable_id: 'd3' },
    { id: 's3', client: 'fixture-real', status: 'In Progress', video_deliverable_id: 'd4' },
  ] },
  { source: 'calendar', surface: 'calendar', rows: [
    { id: 'p1', client: 'fixture-real', status: 'Archived', video_deliverable_id: 'd5', graphic_deliverable_id: 'd6' },
    { id: 'p2', client: 'fixture-real', status: 'Archived', video_deliverable_id: 'd7' },
  ] },
];
const deliverables = [
  { id: 'd1', status: 'todo', card_id: 's1', client_slug: 'fixture-real' },
  { id: 'd2', status: 'approved', card_id: 's1', client_slug: 'fixture-real' },
  { id: 'd3', status: 'smm_approval', card_id: 's2', client_slug: 'fixture-test' },
  { id: 'd4', status: 'todo', card_id: 's3', client_slug: 'fixture-real' },
  { id: 'd5', status: 'backlog', card_id: 'p1', client_slug: 'fixture-real' },
  { id: 'd6', status: 'triage', card_id: 'p1', client_slug: 'fixture-real' },
  { id: 'd7', status: 'in_progress', card_id: 'p9', client_slug: 'fixture-real' },
];

const items = plan({ cards, deliverables, clients });
const ids = items.map(i => i.id).sort();
ok(JSON.stringify(ids) === JSON.stringify(['d1', 'd3', 'd6']), 'only open items behind archived cards are planned (got ' + ids.join(',') + ')');
ok(!ids.includes('d2') && !ids.includes('d5'), 'finished and already-parked items are left alone');
ok(!ids.includes('d4'), 'items behind a card that is not archived are left alone');
ok(!ids.includes('d7'), 'an item now bound to a different card is left alone');
ok(items.find(i => i.id === 'd3').client_kind === 'test' && items.find(i => i.id === 'd1').client_kind === 'real', 'real and test clients are told apart');
ok(items.find(i => i.id === 'd6').surface === 'calendar' && items.find(i => i.id === 'd1').surface === 'sxr', 'each item goes out on its own surface');
const c = counts(items);
ok(c.total === 3 && c.by_client_kind.real === 2 && c.by_client_kind.test === 1, 'counts by client kind');
ok(c.by_source_kind_status['sample/video/todo'] === 1 && c.by_source_kind_status['calendar/graphic/triage'] === 1, 'counts by source, kind and status');

// A fake network for main().
function fakeNetwork() {
  const writes = [];
  const reads = [];
  global.fetch = async (url, init) => {
    const u = new URL(url);
    if (init && init.method === 'POST') {
      writes.push({ path: u.pathname, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    reads.push(u.pathname);
    const table = u.pathname.split('/').pop();
    let rows = [];
    if (table === 'sample_reviews') rows = cards[0].rows.filter(r => r.status === 'Archived');
    if (table === 'calendar_posts') rows = cards[1].rows;
    if (table === 'deliverables') rows = deliverables;
    if (table === 'clients') rows = clients;
    if (table === 'card_change_journal') rows = [{ id: 1 }];
    return { ok: true, status: 200, json: async () => rows };
  };
  return { writes, reads };
}

(async () => {
  const logs = [];
  const realLog = console.log;
  let net = fakeNetwork();
  console.log = line => logs.push(String(line));
  const dry = await main([]);
  console.log = realLog;
  ok(dry.mode === 'dry_run' && dry.open_work_items.total === 3, 'the dry run finds the three items');
  ok(net.writes.length === 0, 'the dry run writes nothing');
  const printed = logs.join('\n');
  ok(!/fixture-|"d\d"|"s\d"|"p\d"/.test(printed), 'the dry run prints counts only: no slug, card or item id');

  net = fakeNetwork();
  process.env.SYNCVIEW_STAFF_KEY = 'fixture-staff-key';
  process.env.SYNCVIEW_ACTOR = 'Fixture Staff';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-key';
  logs.length = 0;
  console.log = line => logs.push(String(line));
  const run = await main(['--apply']);
  console.log = realLog;
  ok(net.writes.length === 3 && net.writes.every(w => /\/functions\/v1\/production-write$/.test(w.path)), 'apply sends one request per item, all to the guarded gateway');
  ok(net.writes.every(w => w.body.operation === 'status' && w.body.status === 'backlog' && w.body.entity === 'deliverable'), 'each is a status move to backlog');
  ok(net.writes.every(w => w.headers['x-syncview-key'] && w.headers['x-syncview-actor']), 'each carries the staff key and a named staff member');
  ok(new Set(net.writes.map(w => w.body.request_id)).size === 3, 'each move has its own request id');
  ok(run.run.parked === 3 && run.run.journal_confirmed === 3, 'every move is confirmed in the change journal');
  ok(!/fixture-|"d\d"|"s\d"|"p\d"/.test(logs.join('\n')), 'the apply output prints counts only');

  delete process.env.SYNCVIEW_STAFF_KEY;
  let refused = false;
  net = fakeNetwork();
  try { await main(['--apply']); } catch (e) { refused = /SYNCVIEW_STAFF_KEY/.test(e.message); }
  ok(refused && net.writes.length === 0, 'apply refuses without a staff key and writes nothing');

  if (failures) { console.error(`archived-work-items-park: ${failures} failed`); process.exit(1); }
  console.log('archived-work-items-park: PASS');
})().catch(e => { console.error(e); process.exit(1); });
