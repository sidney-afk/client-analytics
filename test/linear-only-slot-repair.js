'use strict';
// Offline guard for scripts/linear-only-slot-repair.js: the classifier proposes
// a connection only for one same-team, same-client, unconnected deliverable,
// and the SQL it hands a reviewer re-checks that state at apply time.
const { classify, proposedSql, linearIdentifier } = require('../scripts/linear-only-slot-repair.js');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };
const U = n => 'https://linear.app/x/issue/' + n + '/slug';
const NOW = Date.parse('2026-09-24T12:00:00Z');
const posts = [
  { id: 'c1', client: 'client-x', status: 'In Progress', scheduled_date: '2026-09-30', linear_issue_id: U('VID-1') },
  { id: 'c2', client: 'client-x', status: 'In Progress', scheduled_date: '2026-09-30', graphic_linear_issue_id: U('GRA-2') },
  { id: 'c3', client: 'client-x', status: 'In Progress', scheduled_date: '2026-09-30', linear_issue_id: U('GRA-3'), graphic_deliverable_id: 'd3' },
  { id: 'c4', client: 'client-x', status: 'In Progress', scheduled_date: '2026-09-30', linear_issue_id: U('VID-4') },
  { id: 'c5', client: 'client-x', status: 'In Progress', scheduled_date: '2026-09-30', linear_issue_id: U('VID-5') },
  { id: 'c6', client: 'client-x', status: 'Posted', scheduled_date: '2026-09-30', linear_issue_id: U('VID-1') },
  { id: 'c7', client: 'client-x', status: 'In Progress', scheduled_date: '2026-07-01', linear_issue_id: U('VID-1') },
  { id: 'c8', client: 'client-x', status: 'In Progress', scheduled_date: '', linear_issue_id: U('VID-1') },
  { id: 'c9', client: 'client-x', status: 'Archived', scheduled_date: '2026-09-30', linear_issue_id: U('VID-1') },
  { id: 'c10', client: 'client-x', status: 'In Progress', scheduled_date: '2026-09-30', linear_issue_id: U('VID-1'), video_deliverable_id: 'dz' },
  { id: 'c11', client: 'client-x', status: 'In Progress', scheduled_date: '2026-09-30', linear_issue_id: U('VID-9') },
  { id: 'c12', client: 'client-x', status: 'In Progress', scheduled_date: '2026-09-30', linear_issue_id: U('VID-12') },
  { id: 'c13', client: 'client-x', status: 'In Progress', scheduled_date: '2026-09-30', linear_issue_id: U('VID-13') },
];
const dels = [
  { id: 'd1', team: 'video', client_slug: 'client-x', card_id: null, origin: 'calendar', linear_identifier: 'VID-1' },
  { id: 'd3', team: 'graphics', client_slug: 'client-x', card_id: 'c3', linear_identifier: 'GRA-3' },
  { id: 'd4', team: 'video', client_slug: 'client-x', card_id: 'other-card', linear_identifier: 'VID-4' },
  { id: 'd5a', team: 'video', client_slug: 'client-x', card_id: null, linear_identifier: 'VID-5' },
  { id: 'd5b', team: 'video', client_slug: 'client-x', card_id: null, linear_identifier: 'VID-5' },
  { id: 'd9', team: 'video', client_slug: 'client-y', card_id: null, linear_identifier: 'VID-9' },
  { id: 'd12a', team: 'video', client_slug: 'client-x', card_id: 'elsewhere', origin: 'calendar', linear_identifier: 'VID-12' },
  { id: 'd12b', team: 'video', client_slug: 'client-x', card_id: null, origin: 'calendar', linear_identifier: 'VID-12' },
  { id: 'd13', team: 'video', client_slug: 'client-x', card_id: null, origin: 'manual', linear_identifier: 'VID-13' },
];
const r = classify(posts, dels, { now: NOW });
ok(linearIdentifier(U('vid-12')) === 'VID-12', 'reads the Linear identifier out of an issue URL');
ok(r.since === '2026-08-25', 'default cutoff is 30 days before today');
ok(r.exact.length === 1 && r.exact[0].card_id === 'c1' && r.exact[0].deliverable_id === 'd1', 'one free same-team same-client deliverable is proposed');
ok(r.none.some(e => e.card_id === 'c2'), 'no deliverable for the issue: listed as none');
ok(r.mismatch.some(e => e.card_id === 'c3'), 'a video slot holding its own thumbnail issue is a mismatch, not a proposal');
ok(r.taken.some(e => e.card_id === 'c4'), 'a deliverable connected to another card is never taken over');
ok(r.ambiguous.some(e => e.card_id === 'c5'), 'two candidates are ambiguous, not guessed');
ok(r.mismatch.some(e => e.card_id === 'c11'), 'another client\'s deliverable is never proposed');
const all = [].concat(r.exact, r.ambiguous, r.taken, r.mismatch, r.none).map(e => e.card_id);
ok(!all.includes('c6') && !all.includes('c7') && !all.includes('c9') && !all.includes('c10'), 'posted, old, archived and already-linked slots are out of scope');
ok(r.undated === 1 && !all.includes('c8'), 'undated slots are counted but never proposed');
ok(r.ambiguous.some(e => e.card_id === 'c12') && !r.exact.some(e => e.card_id === 'c12'), 'one free and one taken match for the same issue is ambiguous, not exact');
ok(r.unbound.some(e => e.card_id === 'c13'), "a free match whose origin is not 'calendar' is unbound, never proposed");
const sql = proposedSql(r.exact);
ok(/client = 'client-x' and id = 'c1'/.test(sql) && !/where id = 'c1'/.test(sql), 'the card is matched on its full key, client and id');
ok(/for update/.test(sql) && /raise exception 'card slot no longer empty'/.test(sql) && /raise exception 'deliverable no longer eligible'/.test(sql), 'both rows are locked and either side no longer eligible aborts the whole block');
ok(/^begin;/.test(sql) && /commit;$/.test(sql), 'the plan runs as one transaction');
ok(/origin = 'calendar'/.test(sql) && /team = 'video'/.test(sql) && /client_slug = 'client-x'/.test(sql), 'the deliverable is re-checked for client, team and Calendar origin');
ok(proposedSql([]) === '', 'no exact match means no SQL at all');
if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('linear-only-slot-repair: ok');
