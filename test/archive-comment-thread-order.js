'use strict';
/*
 * AN ARCHIVED CONVERSATION READS IN THE ORDER IT HAPPENED.
 *
 * Found 2026-08-27 by the pre-video-flip bug archaeology (the text-order_index
 * pattern, swept for siblings): production-archive ordered the comment thread
 * by TEXT id, and comment ids are random uuids in two families — `linear:*`
 * (imported) and `pc_*` (native). Lexicographically every imported comment
 * sorts before every native one, and order within a family is random. A mixed
 * conversation — Linear comment, native reply, Linear comment — rendered
 * shuffled the moment the issue was archived, while the LIVE thread endpoint
 * (production-comments) orders (created_at, id) and reads correctly. Measured
 * live the same day: 33 mixed-family threads, 21 already archived — and the
 * video flip makes the shape structural, because from then on every new
 * comment is native `pc_*` on top of imported history.
 *
 * The fix is negotiated BEFORE the first page (Codex P1 on #1168 caught the
 * first draft gating only the cursor: a cached pre-change browser took a
 * chronological page 1 from the new server, then resumed by id — the exact
 * mixed-mode corruption the gate exists to prevent). The browser DECLARES
 * `chrono_paging` on every request; without the marker the server keeps the
 * whole conversation — first page included — in the old id-order world, so
 * each browser generation lives in one consistent ordering whatever deploys
 * first. This suite executes the shuffle, the mixed-mode skip, composite
 * continuity, and the exhausted-comments cursor retention.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ef = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-archive', 'index.ts'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- the defect, EXECUTED --------------------------------------------------
/* A mixed-family thread in the order it actually happened. */
const thread = [
  { id: 'linear:ad08efd3-b85f-4acb-bde0-e42ae1cc45ab', created_at: '2026-08-01T10:00:00+00:00' },
  { id: 'pc_062bb17b-ca9f-405a-8133-308b297a3974', created_at: '2026-08-02T09:00:00+00:00' },
  { id: 'linear:253cbe8a-cb5e-4939-b614-408f00f3763c', created_at: '2026-08-03T08:00:00+00:00' },
  { id: 'pc_79edd06c-585f-4dc1-9aa4-e986a9abd3e9', created_at: '2026-08-03T08:00:00+00:00' },
];
const byId = rows => rows.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const chrono = rows => rows.slice().sort((a, b) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1
  : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

ok(byId(thread).map(r => r.created_at.slice(8, 10)).join(',') === '03,01,02,03',
  'id order really shuffles a mixed thread — it OPENS on the Aug 3 imported comment');
ok(chrono(thread).map(r => r.created_at.slice(8, 10)).join(',') === '01,02,03,03',
  'while (created_at, id) reads in the order the conversation happened');

/* The page-skip the legacy branch exists to prevent: a v1 id cursor applied
 * to the CHRONOLOGICAL order. Page 1 (limit 2) of chrono order ends on the
 * Aug 2 pc_ comment; filtering id > that cursor drops the remaining
 * `linear:*` comment entirely — 'l' < 'p' — so the reader silently loses the
 * Aug 3 imported half of the conversation. */
const page1 = chrono(thread).slice(0, 2);
const v1CursorOnChrono = chrono(thread).filter(r => r.id > page1[1].id);
const lostIds = thread.map(r => r.id)
  .filter(id => !page1.concat(v1CursorOnChrono).some(r => r.id === id));
ok(lostIds.length === 1 && lostIds[0].startsWith('linear:'),
  'a v1 id cursor against chronological order silently loses an imported comment — mixing the modes loses data');

/* Composite keyset continuity across a duplicate timestamp: strictly-after
 * (created_at, id) neither skips nor repeats the Aug 3 pair. */
const after = page1[1];
const compositeAfter = (rows, a) => rows.filter(r =>
  r.created_at > a.created_at || (r.created_at === a.created_at && r.id > a.id));
const page2 = compositeAfter(chrono(thread), after);
ok(page2.length === 2 && page2[0].created_at.slice(8, 10) === '03'
  && page1.concat(page2).map(r => r.id).sort().join('|') === thread.map(r => r.id).sort().join('|'),
  'the composite cursor resumes exactly after (created_at, id) — no skip, no repeat, duplicates included');

/* An UNDECLARED browser lives entirely in the id world — first page included —
 * and that world is self-consistent: id pages under id cursors reassemble the
 * full set with no skip and no repeat, exactly as before this change. */
const idPage1 = byId(thread).slice(0, 2);
const idPage2 = byId(thread).filter(r => r.id > idPage1[1].id);
ok(idPage1.concat(idPage2).map(r => r.id).sort().join('|') === thread.map(r => r.id).sort().join('|'),
  'an undeclared browser pages id-order under id cursors — old world, complete and duplicate-free');

/* Comments exhausted while refs still page (Codex P2): the browser RETAINS the
 * final (created_at, id) pair, so the next refs-only Load More re-sends it and
 * the comment stream contributes ZERO rows instead of re-appending the page. */
const lastPair = chrono(thread)[thread.length - 1];
ok(compositeAfter(chrono(thread), lastPair).length === 0,
  'a retained exhausted cursor returns zero comment rows on later mixed-stream pages — nothing re-appends');

// ---- the EF, pinned to the shape that passes the executable proof ----------
const detailAt = ef.indexOf('let commentQuery = supabase.from("production_comments")');
const detail = ef.slice(detailAt, detailAt + 2400);
ok(/commentQuery = chronoPaging\s*\n\s*\? commentQuery\.order\("created_at", \{ ascending: true \}\)\.order\("id", \{ ascending: true \}\)\s*\n\s*: commentQuery\.order\("id", \{ ascending: true \}\)/.test(detail),
  'the ORDER itself is negotiated: chronological only for a declared browser, id-order — first page included — for everyone else');
ok(detail.includes('if (chronoPaging && commentAfterAt && commentAfter) {'),
  'the composite cursor applies only inside the declared world');
ok(detail.includes('created_at.gt."') && detail.includes('and(created_at.eq."'),
  'and quotes its timestamp values — ":" and "+" would split an unquoted or-list');
const legacyAt = detail.indexOf('} else if (commentAfter) {');
const legacy = legacyAt >= 0 ? detail.slice(legacyAt, legacyAt + 500) : '';
ok(legacy.includes('.gt("id", commentAfter)'),
  'an undeclared cursor is an id keyset over the id order the same request already selected');
ok(ef.includes('comments_next_at: chronoPaging &&'),
  'the timestamp cursor half is only ever advertised to a browser that declared for it');
ok(ef.includes('(commentAfterAt && !commentAfter)') && ef.includes('(commentAfterAt && !chronoPaging)'),
  'a timestamp half without its id, or without the declaration, is refused as an invalid page');
ok(/SAFE_TS = \/\^\\d\{4\}/.test(ef),
  'comment_after_at is validated as a timestamp before it reaches an or-filter (harness is not vacuous)');

// ---- the browser, pinned ---------------------------------------------------
ok(html.includes('chrono_paging: true,'),
  'the browser declares chronological paging on EVERY request, first page included');
ok(html.includes('comment_after_at: append && existing ? (existing.commentCursorAt || null) : null'),
  'and sends the timestamp half only from stored state');
ok(html.includes("commentCursorAt: json.comments_next_at") && /\: \(existing && existing\.commentCursorAt \|\| ''\),/.test(html),
  'the timestamp half is RETAINED like the id half when comments are exhausted — the zero-rows proof above depends on it');

if (failures) {
  console.error(`\n${failures} archive-thread-order check(s) failed`);
  process.exit(1);
}
console.log('\narchive comment thread order checks passed — conversations read in order');
