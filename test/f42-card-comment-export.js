'use strict';

// Unit coverage for the F42 card-comment exporter. The PostgREST backend is
// faked (injected fetch); the exporter's output is fed through the real planner
// to prove it round-trips to a certifiable snapshot.

const { planCardCommentImport, SNAPSHOT_CONTRACT } = require('../scripts/f42-card-comment-import');
const exporter = require('../scripts/f42-card-comment-export');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// A fake PostgREST that serves per-table rows with limit/offset pagination and
// echoes back exactly what the exporter requested.
function fakeFetch(tables) {
  return async (url) => {
    const table = /\/rest\/v1\/([a-z_]+)\?/.exec(url)[1];
    const limit = Number(/[?&]limit=(\d+)/.exec(url)[1]);
    const offset = Number(/[?&]offset=(\d+)/.exec(url)[1]);
    const all = tables[table] || [];
    const page = all.slice(offset, offset + limit);
    return { ok: true, status: 200, json: async () => page };
  };
}

(async () => {
  ok(exporter.projectCard({
    id: 'card-1', client_slug: 'test-client', video_deliverable_id: 'dlv-v',
    graphic_deliverable_id: 'dlv-g', comments: [{ id: 'c1', body: 'hi' }],
    brief: 'SECRET brief', linear_raw: { secret: true }, file_url: 'https://x',
  }).brief === undefined
    && exporter.projectCard({ id: 'card-1', linear_raw: { s: 1 } }).linear_raw === undefined
    && exporter.projectCard({ id: 'card-1', comments: [] }).id === 'card-1',
  'projectCard keeps only F42 fields and drops brief/linear_raw/file_url');

  ok(exporter.cardHasComments({ comments: [{ id: 'x' }] }) === true
    && exporter.cardHasComments({ video_comments: '[{"id":"y"}]' }) === true
    && exporter.cardHasComments({ comments: [], graphic_comments: '' }) === false
    && exporter.cardHasComments({ id: 'no-comments' }) === false,
  'cardHasComments detects any non-empty comment array and skips comment-free cards');

  const calendarRows = [{
    id: 'cal-card-1', client_slug: 'test-client',
    video_deliverable_id: 'dlv-cal-vid', graphic_deliverable_id: 'dlv-cal-gra',
    comments: [{ id: 'cal-root', author: 'SMM', role: 'smm', body: 'Root', created_at: '2026-07-23T10:00:00Z', updated_at: '2026-07-23T10:00:00Z' }],
    graphic_comments: [{ id: 'cal-graphic', author: 'Designer', role: 'designer', body: 'Graphic note', created_at: '2026-07-23T11:00:00Z' }],
    brief: 'private brief should never be exported',
    linear_raw: { private: true },
  }, {
    id: 'cal-empty', client_slug: 'test-client', video_deliverable_id: 'dlv-x',
    comments: [],
  }];
  const sxrRows = [{
    id: 'sxr-card-1', client_slug: 'test-client',
    video_deliverable_id: 'dlv-sxr-vid', graphic_deliverable_id: 'dlv-sxr-gra',
    video_comments: [{ id: 'sxr-root', author: 'SMM', role: 'smm', body: 'SXR note', created_at: '2026-07-23T12:00:00Z' }],
  }];

  // The v2 contract requires the deliverable crosswalk the import RPC re-checks.
  const deliverableRows = [
    { id: 'dlv-cal-vid', client_slug: 'test-client', team: 'video', origin: 'calendar',
      card_id: 'cal-card-1', title: 'SECRET deliverable title', linear_raw: { private: true } },
    { id: 'dlv-cal-gra', client_slug: 'test-client', team: 'graphics', origin: 'calendar',
      card_id: 'cal-card-1' },
    { id: 'dlv-sxr-vid', client_slug: 'test-client', team: 'video', origin: 'samples',
      card_id: 'sxr-card-1' },
    { id: 'dlv-sxr-gra', client_slug: 'test-client', team: 'graphics', origin: 'samples',
      card_id: 'sxr-card-1' },
  ];
  const snapshot = await exporter.exportSnapshot(
    { url: 'https://fixture.invalid', serviceKey: 'service-key' },
    { fetch: fakeFetch({
      calendar_posts: calendarRows, sample_reviews: sxrRows, deliverables: deliverableRows,
    }) },
  );
  ok(snapshot.contract === SNAPSHOT_CONTRACT
    && snapshot.surfaces.calendar.length === 1
    && snapshot.surfaces.sxr.length === 1,
  'exportSnapshot emits the two-surface contract and drops comment-free cards');
  ok(JSON.stringify(snapshot).indexOf('private brief') === -1
    && JSON.stringify(snapshot).indexOf('linear_raw') === -1,
  'the exported snapshot never carries private brief/linear_raw content');
  ok(snapshot.manifest.surfaces.calendar.cards === 1
    && snapshot.manifest.surfaces.sxr.cards === 1
    && /^[a-f0-9]{64}$/.test(snapshot.manifest.surfaces.calendar.source_sha256),
  'the exporter produces a self-consistent coverage manifest with a stable source hash');

  // The exporter must carry the crosswalk the import RPC validates against, and
  // project it to exactly the five crosswalk fields.
  ok(Array.isArray(snapshot.deliverables)
    && snapshot.deliverables.length === 4
    && snapshot.deliverables.every(row =>
      Object.keys(row).sort().join(',') === 'card_id,client_slug,id,origin,team')
    && snapshot.deliverables[0].id === 'dlv-cal-gra',
  'exportSnapshot emits the deliverable crosswalk, id-sorted and projected to the crosswalk fields');
  ok(JSON.stringify(snapshot.deliverables).indexOf('SECRET deliverable title') === -1
    && JSON.stringify(snapshot.deliverables).indexOf('linear_raw') === -1,
  'the exported crosswalk never carries deliverable titles or linear_raw');

  // The exported snapshot must certify through the real planner unchanged.
  const plan = planCardCommentImport(snapshot, { importRunId: 'export-fixture' });
  ok(plan.complete === true && plan.conflicts.length === 0 && plan.imports.length === 3,
    'the exported snapshot round-trips to a complete, conflict-free plan');

  // Pagination: a full page followed by a partial page collects every row.
  const many = Array.from({ length: 1500 }, (_, index) => ({
    id: `card-${String(index).padStart(4, '0')}`,
    client_slug: 'test-client', video_deliverable_id: 'dlv',
    comments: [{ id: `c-${index}`, role: 'smm', body: 'x', created_at: '2026-07-23T10:00:00Z' }],
  }));
  const paged = await exporter.exportSnapshot(
    { url: 'https://fixture.invalid', serviceKey: 'k', pageSize: 1000 },
    { fetch: fakeFetch({ calendar_posts: many, sample_reviews: [], deliverables: [] }) },
  );
  ok(paged.surfaces.calendar.length === 1500,
    'exportSnapshot paginates PostgREST reads until the final short page');

  let configThrew = '';
  try {
    await exporter.exportSnapshot({ url: '', serviceKey: '' }, { fetch: fakeFetch({}) });
  } catch (error) { configThrew = error && error.message; }
  ok(configThrew === 'supabase_configuration_required',
    'the exporter refuses to run without Supabase service configuration');

  if (failures) {
    console.error(`\n${failures} F42 export check(s) failed`);
    process.exit(1);
  }
  console.log('\nF42 card-comment export checks passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
