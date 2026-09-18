'use strict';

/*
 * Actual PostgreSQL 16 proof of migrations/2026-09-18-native-label-retired-state.sql.
 * Synthetic identities, disposable database; nothing reaches a live backend.
 *
 * THE PROPERTY. A Linear label can be RETIRED, which is not the same as
 * archived, and the pre-2026-09-18 capture could not see it -- so every retired
 * label would have been served as a live, selectable one. After this migration:
 *
 *   1. a retired label is KEPT in the catalog, carrying its retiredAt, so the
 *      manifest still describes the whole workspace and its count reconciles;
 *   2. it is NEVER served as applicable;
 *   3. an EXISTING selection of one still resolves for display, and can be
 *      retained or removed but not newly added -- exactly the archived rules;
 *   4. an old-shape manifest with no retiredAt is REFUSED rather than read as
 *      "nothing here is retired".
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { bootCluster, MIGRATIONS, jsonRows, scalar } = require('../scripts/native-intake-manifest/harness');

if (process.env.F63_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native label retired state PostgreSQL: F63 disposable PostgreSQL required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw Error('native label retired-state proof requires loopback disposable PostgreSQL');
}
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete process.env[key];

let cluster;
let passed = 0;
const ok = (name, value) => { assert.ok(value, name); passed += 1; console.log(`  ok ${name}`); };
const literal = v => `'${String(v).replace(/'/g, "''")}'`;
const json = v => `${literal(JSON.stringify(v))}::jsonb`;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function rejection(sql, pattern) {
  try { cluster.exec(sql); } catch (error) {
    assert.match(String(error && error.message), pattern);
    return true;
  }
  return false;
}

const VIDEO_TEAM = '11111111-1111-4111-8111-111111111111';
const GRAPHICS_TEAM = '22222222-2222-4222-8222-222222222222';
const LIVE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const RETIRED = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ARCHIVED = 'cccccccc-3333-4333-8333-cccccccccccc';
const BOTH = 'dddddddd-4444-4444-8444-dddddddddddd';
const VERSION = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const CAPTURE = 'ffffffff-6666-4666-8666-ffffffffffff';

function node(id, over) {
  return Object.assign({
    id, name: `fixture-${id.slice(0, 4)}`, color: '#5e6ad2', description: null,
    isGroup: false, archivedAt: null, retiredAt: null, team: null,
  }, over || {});
}

/* Four labels: live, retired, archived, and retired AND archived. The last one
   exists because the two states are independent -- a filter handling only one
   of them must still be caught. */
function manifest(nodes) {
  return {
    schema_version: 1,
    source_kind: 'linear_workspace_issue_labels',
    capture_id: CAPTURE,
    source_sha256: sha('synthetic-source'),
    workspace_fingerprint: sha('synthetic-workspace'),
    include_archived: true,
    captured_at: '2026-09-18T00:00:00Z',
    teams: { video: VIDEO_TEAM, graphics: GRAPHICS_TEAM },
    expected_count: nodes.length,
    pages: [{ after: null, nodes, pageInfo: { hasNextPage: false, endCursor: null } }],
  };
}

const NODES = [
  node(LIVE),
  node(RETIRED, { retiredAt: '2026-09-01T00:00:00Z' }),
  node(ARCHIVED, { archivedAt: '2026-08-01T00:00:00Z' }),
  node(BOTH, { retiredAt: '2026-09-02T00:00:00Z', archivedAt: '2026-09-03T00:00:00Z' }),
];

function catalogIds(versionId = VERSION) {
  return jsonRows(cluster, `select public.production_label_catalog_read_version(${literal(versionId)}::uuid,'video') as r`)[0]
    .r.catalog.map(l => l.id).sort();
}

function main() {
  try {
    cluster = bootCluster();
    cluster.runFile(path.join(MIGRATIONS, '2026-09-05-native-label-catalog-foundation.sql'));

    /* ---------- BEFORE: the defect, reproduced ---------- */
    cluster.exec(`select public.production_label_catalog_stage(${literal(VERSION)}::uuid,${json(manifest(NODES))})`);
    ok('BEFORE: the old checker accepts a manifest carrying retiredAt (it simply ignores the field)',
      true);
    ok('BEFORE: a RETIRED label is served as applicable -- the defect',
      catalogIds().includes(RETIRED));
    ok('BEFORE: archived is already excluded, so the two are genuinely different states',
      !catalogIds().includes(ARCHIVED));

    const oldShape = manifest(NODES.map(n => { const c = { ...n }; delete c.retiredAt; return c; }));
    ok('BEFORE: a manifest with NO retiredAt at all is accepted, which is how the state stayed invisible',
      !rejection(`select public.production_label_catalog_stage('0f0f0f0f-7777-4777-8777-0f0f0f0f0f0f'::uuid,${json(oldShape)})`,
        /./));

    /* ---------- AFTER ---------- */
    cluster.runFile(path.join(MIGRATIONS, '2026-09-18-native-label-retired-state.sql'));

    ok('AFTER: the retired label is still IN the catalog version, with its retiredAt',
      scalar(cluster, `select (manifest->'pages'->0->'nodes'->1->>'retiredAt') from public.production_label_catalog_versions where version_id=${literal(VERSION)}::uuid`) === '2026-09-01T00:00:00Z');
    const served = catalogIds();
    ok('AFTER: the retired label is NOT served as applicable', !served.includes(RETIRED));
    ok('AFTER: the retired-AND-archived label is not served either', !served.includes(BOTH));
    ok('AFTER: the live label is still served', served.includes(LIVE));
    ok('AFTER: exactly one of the four is applicable', served.length === 1);

    ok('AFTER: the count still reconciles -- retired labels are kept, not dropped',
      scalar(cluster, `select (manifest->>'expected_count') from public.production_label_catalog_versions where version_id=${literal(VERSION)}::uuid`) === '4');

    /* THE FAIL-CLOSED PROPERTY. An old capture must be refused, never read as
       "nothing here is retired". */
    ok('AFTER: a manifest with no retiredAt is REFUSED',
      rejection(`select public.production_label_catalog_stage('0f0f0f0f-7777-4777-8777-0f0f0f0f0f0f'::uuid,${json(oldShape)})`,
        /label_catalog_label_invalid/));
    ok('AFTER: a malformed retiredAt is refused',
      rejection(`select public.production_label_catalog_stage('0f0f0f0f-8888-4888-8888-0f0f0f0f0f0f'::uuid,${json(
        manifest(NODES.map((n, i) => (i === 1 ? { ...n, retiredAt: 'yesterday' } : n))))})`,
        /label_catalog_label_invalid/));

    /* ---------- selections of a retired label still resolve ---------- */
    const selection = [{ id: RETIRED, name: 'fixture-bbbb', color: '#5e6ad2', description: null }];
    const keep = jsonRows(cluster, `select public.production_label_catalog_validate_selection(
      ${literal(VERSION)}::uuid,'video',${json(selection)},${json([RETIRED])}) as r`)[0].r;
    ok('an EXISTING selection of a retired label still resolves, and can be retained',
      keep.selected_label_ids.length === 1 && keep.selected_label_ids[0] === RETIRED
        && keep.selected_labels[0].name === 'fixture-bbbb');

    const drop = jsonRows(cluster, `select public.production_label_catalog_validate_selection(
      ${literal(VERSION)}::uuid,'video',${json(selection)},${json([])}) as r`)[0].r;
    ok('the same selection can be REMOVED', drop.selected_label_ids.length === 0);

    ok('a retired label NOT already on the card cannot be newly added',
      rejection(`select public.production_label_catalog_validate_selection(
        ${literal(VERSION)}::uuid,'video','[]'::jsonb,${json([RETIRED])})`,
      /label_not_applicable/));
    ok('the live label CAN be newly added, so the refusal above is about retirement alone',
      jsonRows(cluster, `select public.production_label_catalog_validate_selection(
        ${literal(VERSION)}::uuid,'video','[]'::jsonb,${json([LIVE])}) as r`)[0].r.selected_label_ids[0] === LIVE);

    console.log(JSON.stringify({ marker: 'NATIVE_LABEL_RETIRED_STATE_OK', checks: passed }));
  } finally {
    if (cluster && cluster.stop) cluster.stop();
  }
}

main();
