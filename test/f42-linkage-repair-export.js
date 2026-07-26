'use strict';

/*
 * F42 Brick 1 — repair exporter.
 *
 * Pins the two things that make the export safe to feed a production write:
 * it emits exactly the shape the runner plans from (with a manifest the runner
 * verifies), and it carries comment COUNTS but never comment bodies.
 */

const exporter = require('../scripts/f42-linkage-repair-export.js');
const repair = require('../scripts/f42-linkage-defect-repair.js');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

const SECRET = 'CLIENT SAID SOMETHING PRIVATE';

const calendarRow = {
  id: 'cal-1',
  client: 'acme-co',
  status: 'Active',
  brief: 'a private brief nobody should export',
  linear_raw: { issue: { title: 'private' } },
  video_deliverable_id: 'dlv-1',
  graphic_deliverable_id: '',
  linear_issue_id: 'https://linear.app/synchro-social/issue/VID-1/v',
  graphic_linear_issue_id: '',
  video_comments: [{ id: 'c1', body: SECRET }, { id: 'c2', body: 'second' }],
  video_tweaks: JSON.stringify([{ id: 't1', body: SECRET }]),
  caption_comments: [{ id: 'c3', body: SECRET }],
};
const sxrRow = {
  id: 'sxr-1', client: 'acme-co', status: 'Active',
  video_deliverable_id: '', graphic_deliverable_id: 'dlv-2',
  graphic_comments: [{ id: 'g1', body: SECRET }],
};
const unlinkedRow = { id: 'cal-2', client: 'acme-co', video_comments: [{ id: 'x', body: SECRET }] };
const deliverableRow = {
  id: 'dlv-1', client_slug: 'acme-co', team: 'video', kind: 'video',
  origin: 'manual', card_id: null, status: 'in_progress',
  linear_identifier: 'VID-1', linear_issue_url: 'https://linear.app/synchro-social/issue/VID-1/v',
  brief: 'private brief', linear_raw: { big: 'blob' }, comments: 'private',
};

function fakeFetch(tables) {
  return async url => {
    const table = String(url).match(/\/rest\/v1\/([a-z_]+)/)[1];
    const offset = Number((String(url).match(/offset=(\d+)/) || [])[1] || 0);
    const rows = offset === 0 ? (tables[table] || []) : [];
    return { ok: true, status: 200, json: async () => rows };
  };
}

(async () => {
  console.log('F42 Brick 1 — repair exporter\n');

  const snapshot = await exporter.exportSnapshot(
    { url: 'https://db.test', serviceKey: 'service-key' },
    {
      fetch: fakeFetch({
        calendar_posts: [calendarRow, unlinkedRow],
        sample_reviews: [sxrRow],
        deliverables: [deliverableRow],
      }),
      now: () => '2026-07-26T12:00:00Z',
    },
  );

  // ---------------------------------------------------------------- shape
  ok(snapshot.contract === repair.SNAPSHOT_CONTRACT,
    'the exporter stamps the contract the runner requires');
  ok(Array.isArray(snapshot.cards.calendar) && Array.isArray(snapshot.cards.sxr)
    && Array.isArray(snapshot.deliverables),
  'the snapshot carries cards.calendar, cards.sxr and deliverables');
  ok(repair.verifySnapshotManifest(snapshot, Date.parse('2026-07-26T12:00:00Z')).length === 0,
    'the exported snapshot passes the runner manifest verification it will face');

  // ---------------------------------------------------------------- no bodies
  const serialized = JSON.stringify(snapshot);
  ok(!serialized.includes(SECRET),
    'PUBLIC-SAFETY: no comment body reaches the snapshot, only counts');
  ok(!serialized.includes('a private brief nobody should export')
    && !serialized.includes('private brief'),
  'deliverable and card briefs are not exported');
  ok(!serialized.includes('big') && !serialized.includes('linear_raw'),
    'linear_raw is not exported');

  // ---------------------------------------------------------------- counts
  const card = snapshot.cards.calendar[0];
  ok(card.comment_counts.video === 3,
    'video counts sum the aliased comment + tweak fields (2 comments + 1 tweak)');
  ok(card.comment_counts.caption === 1 && card.comment_counts.graphic === 0
    && card.comment_counts.title === 0,
  'per-component counts are reported independently');
  ok(exporter.commentCounts({ video_tweaks: '[not json' }).video === 0,
    'an unparseable tweak string counts zero rather than throwing');

  // ---------------------------------------------------------------- projection
  ok(card.id === 'cal-1' && card.client === 'acme-co'
    && card.video_deliverable_id === 'dlv-1'
    && card.linear_issue_id === 'https://linear.app/synchro-social/issue/VID-1/v',
  'the card projection carries identity, link columns and Linear links');
  ok(!('brief' in card) && !('video_comments' in card) && !('video_tweaks' in card),
    'the card projection drops every non-F42 and every body-bearing column');
  ok(snapshot.cards.calendar.length === 1,
    'a card naming no deliverable is not exported at all');
  ok(snapshot.cards.sxr.length === 1 && snapshot.cards.sxr[0].graphic_deliverable_id === 'dlv-2',
    'the sxr surface is exported through the same projection');

  const d = snapshot.deliverables[0];
  ok(exporter.DELIVERABLE_FIELDS.every(f => f in d),
    'the deliverable projection carries every field the repair authority needs');
  ok(d.kind === 'video' && d.linear_identifier === 'VID-1' && d.card_id === null,
    'kind and Linear identity are exported, and NULL card_id stays NULL');

  // ---------------------------------------------------------------- end to end
  const plan = repair.planLinkageRepair(snapshot, { runId: 'export-e2e' });
  ok(plan.writes.length === 1 && plan.writes[0].deliverable_id === 'dlv-1'
    && plan.writes[0].repair_class === 'class_a_unstamped_deliverable',
  'the runner plans a Class A repair directly from exporter output (end to end)');
  ok(plan.scope.comment_rows_unblocked === 4,
    'the plan counts the comment rows the exporter reported for that card');

  if (failures) {
    console.error(`\n${failures} repair exporter check(s) failed`);
    process.exit(1);
  }
  console.log('\nRepair exporter checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
