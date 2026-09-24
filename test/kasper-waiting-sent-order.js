'use strict';
/*
 * "Waiting for your review" is ordered oldest hand-off first: by when each card
 * was SENT TO KASPER (its latest Kasper Approval entry in calendar_post_events,
 * per part still waiting on him), not by scheduled date. Urgent pings stay a
 * separate section above, untouched by this order.
 *
 * Executes the shipped helpers extracted from index.html.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Brace-balanced extraction that understands COMMENTS as well as strings.
 * The plain quote-aware scanner most suites use cannot read this region: the
 * loader is heavily commented and those comments are full of apostrophes
 * ("Kasper's queue", "hasn't yet propagated"), each of which opens a string
 * the scanner never closes. */
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

const src = ['_kasperSentAtMs', '_kasperSortBySentAt', '_kasperPartitionItems'].map(grabFunc).join('\n');
const api = new Function('_kasperIsFinished', '_calKasperUrgentActive',
  "const _KASPER_PARTS = ['video', 'graphic', 'caption', 'title'];\n" + src
  + '\nreturn { _kasperSentAtMs, _kasperSortBySentAt, _kasperPartitionItems };')(
  p => !!p.finished, p => !!p.urgent);

const KA = 'Kasper Approval';
const item = (id, post, client) => ({ client: client || 'Test client', post: Object.assign({ id }, post) });

// Scheduled dates deliberately run OPPOSITE to hand-off order.
const A = item('a', { video_status: KA, scheduled_date: '2026-10-01' });           // sent Sep 20
const B = item('b', { caption_status: KA, scheduled_date: '2026-09-25' });         // sent Sep 22 (caption only)
const C = item('c', { video_status: KA, graphic_status: KA, scheduled_date: '2026-09-24' }); // graphic Sep 18, video Sep 23
const D = item('d', { video_status: KA, video_status_at: '2026-09-19T00:00:00Z', scheduled_date: '2026-09-26' }); // no event: stamp fallback
const E = item('e', { title_status: KA, scheduled_date: '2026-09-20' });           // no record at all -> last
const U = item('u', { video_status: KA, urgent: true, scheduled_date: '2026-12-01' }); // sent latest, but urgent
const events = [
  { post_id: 'a', component: 'video', ts: '2026-09-10T00:00:00Z' },   // earlier round...
  { post_id: 'a', component: 'video', ts: '2026-09-20T00:00:00Z' },   // ...latest entry wins
  { post_id: 'b', component: 'caption', ts: '2026-09-22T00:00:00Z' },
  { post_id: 'c', component: 'video', ts: '2026-09-23T00:00:00Z' },
  { post_id: 'c', component: 'graphic', ts: '2026-09-18T00:00:00Z' },
  { post_id: 'c', component: 'caption', ts: '2026-09-01T00:00:00Z' }, // caption no longer at Kasper: ignored
  { post_id: 'u', component: 'video', ts: '2026-09-23T12:00:00Z' },
];

const items = [E, A, U, B, D, C];
api._kasperSortBySentAt(items, events);
const { urgent, waiting } = api._kasperPartitionItems(items);
const order = waiting.map(it => it.post.id).join(',');
ok(order === 'c,d,a,b,e', 'waiting is oldest hand-off first, not scheduled date (got ' + order + ')');
ok(urgent.length === 1 && urgent[0].post.id === 'u', 'urgent ping stays in its own section above');
ok(A.sentAtMs === Date.parse('2026-09-20T00:00:00Z'), 'a returned card is dated by its LATEST entry');
ok(C.sentAtMs === Date.parse('2026-09-18T00:00:00Z'), 'a multi-part card is dated by its longest-waiting part');
ok(D.sentAtMs === Date.parse('2026-09-19T00:00:00Z'), 'no event row falls back to the status stamp');
ok(E.sentAtMs === Infinity, 'a card with no record sorts last');

// A failed event read must not break ordering: stamps + scheduled date.
const F1 = item('f1', { video_status: KA, scheduled_date: '2026-09-30' });
const F2 = item('f2', { video_status: KA, scheduled_date: '2026-09-28' });
const fb = api._kasperSortBySentAt([F1, F2], []).map(it => it.post.id).join(',');
ok(fb === 'f2,f1', 'with no timestamps at all it falls back to scheduled date');

ok(/_kasperSortBySentAt\(items, sentEvents\)/.test(INDEX), 'the loader sorts with the sent-at helper');
ok(!/Stable sort: scheduled date first/.test(INDEX), 'the old scheduled-date sort is gone');

if (failures) { console.error('\n' + failures + ' check(s) failed'); process.exit(1); }
console.log('\nKasper waiting-order checks passed');
