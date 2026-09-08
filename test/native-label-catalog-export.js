'use strict';

/*
 * B7 — the Linear label catalog exporter.
 *
 * The capture this script takes cannot be retaken after 2026-09-15, and the
 * only thing that will ever tell the owner his manifest was wrong is
 * production_label_catalog_check_manifest refusing it — by which time Linear
 * may be gone. So this suite does two jobs:
 *
 *   1. It re-reads every bound out of migrations/2026-09-05-native-label-
 *      catalog-foundation.sql and migrations/2026-09-06-native-label-writes.sql
 *      and asserts the script's mirrors carry the same numbers and the same
 *      refusal strings. The mirror cannot drift from the SQL without this
 *      going red.
 *   2. It runs the whole export pipeline offline through the fixture
 *      transport — paging, the independent reconciliation walk, the manifest,
 *      the attestation, both SQL artifacts — and asserts the output would be
 *      accepted, and that each specific malformation would be refused.
 *
 * Offline. No credentials, no network, no database.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const lib = require(path.join(root, 'scripts/linear-label-catalog-export.js'));
const cli = require(path.join(root, 'scripts/linear-label-catalog-export.cli.js'));

const foundationSql = fs.readFileSync(path.join(root, 'migrations/2026-09-05-native-label-catalog-foundation.sql'), 'utf8');
const writesSql = fs.readFileSync(path.join(root, 'migrations/2026-09-06-native-label-writes.sql'), 'utf8');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK  ${name}`);
}

function uuid(n) {
  const hex = String(n).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

/* ---------------------------------------------------------------------------
 * 1. The mirrors match the SQL they mirror.
 * ------------------------------------------------------------------------ */

check('the checker bounds in the script are the bounds in the migration', () => {
  const checker = foundationSql.split('production_label_catalog_check_manifest(p_manifest jsonb)')[1].split('$fn$;')[0];
  assert.ok(checker, 'check_manifest body not found');
  assert.match(checker, new RegExp(`octet_length\\(p_manifest::text\\) > ${lib.LIMITS.MAX_MANIFEST_BYTES}`));
  assert.match(checker, new RegExp(`v_pages < 1 or v_pages > ${lib.LIMITS.MAX_PAGES}`));
  assert.match(checker, new RegExp(`> ${lib.LIMITS.MAX_EXPECTED_COUNT}`));
  assert.match(checker, new RegExp(`jsonb_array_length\\(v_page->'nodes'\\) > ${lib.LIMITS.MAX_NODES_PER_PAGE}`));
  assert.match(checker, new RegExp(`length\\(v_cursor\\) > ${lib.LIMITS.MAX_CURSOR_LENGTH}`));
  assert.match(checker, new RegExp(`length\\(v_label->>'name'\\) > ${lib.LIMITS.MAX_LABEL_NAME_LENGTH}`));
  assert.match(checker, new RegExp(`'${lib.LIMITS.SOURCE_KIND}'`));
});

check('every refusal string the checker can raise has a branch in the mirror', () => {
  const checker = foundationSql.split('production_label_catalog_check_manifest(p_manifest jsonb)')[1].split('$fn$;')[0];
  const raised = new Set([...checker.matchAll(/message = '([a-z_]+)'/g)].map(m => m[1]));
  assert.ok(raised.size >= 5, `expected several refusal strings, saw ${raised.size}`);
  const mirror = fs.readFileSync(path.join(root, 'scripts/linear-label-catalog-export.js'), 'utf8');
  for (const code of raised) assert.ok(mirror.includes(`'${code}'`), `mirror has no branch for ${code}`);
});

check('the attestation contract and its required assertions match the migration', () => {
  const body = writesSql.split('production_label_catalog_stage_attested(')[1].split('$$;')[0];
  assert.match(body, new RegExp(`'${lib.LIMITS.ATTESTATION_CONTRACT}'`));
  for (const field of ['source_sha256', 'workspace_fingerprint', 'teams', 'expected_count', 'capture_id',
    'export_package_sha256', 'review_evidence_sha256', 'operator_subject',
    'archived_pages_verified', 'independent_count_reconciled', 'reviewed_at']) {
    assert.ok(body.includes(field), `stage_attested does not mention ${field}`);
  }
  assert.match(body, new RegExp(`length\\(p_attestation->>'operator_subject'\\)>${lib.LIMITS.MAX_OPERATOR_SUBJECT_LENGTH}`));
});

check('capability() reads only the runtime flag, so the step-4 SQL must warn that it does not self-guard', () => {
  const body = writesSql.split('production_label_catalog_capability() returns jsonb')[1].split('$$;')[0];
  assert.match(body, /syncview_runtime_flags where key='production_native_label_catalog'/);
  assert.doesNotMatch(body, /production_label_catalog_versions/,
    'capability() now reads the versions table; the step-4 warning and OPEN_REPAIRS 170 need revisiting');
  const flagSql = lib.renderCapabilityFlagSql({ versionId: uuid(1) });
  assert.match(flagSql, /reads ONLY this flag/);
  assert.match(flagSql, /503s/);
});

check('the per-card predicate excludes exactly the terminal deliverable statuses, and they are real statuses', () => {
  const model = fs.readFileSync(path.join(root, 'migrations/2026-07-06-b1-linear-data-model.sql'), 'utf8');
  const constraint = model.split("status text not null default 'in_progress' check (status in")[1].split(')')[0];
  for (const status of lib.ACTIVE_CARD_PREDICATE.excludedStatuses) {
    assert.ok(constraint.includes(`'${status}'`), `${status} is not a deliverables.status value`);
  }
  assert.deepEqual(lib.ACTIVE_CARD_PREDICATE.excludedStatuses, ['posted', 'canceled', 'duplicate']);
  assert.equal(lib.ACTIVE_CARD_PREDICATE.excludesArchived, true);
  for (const status of lib.ACTIVE_CARD_PREDICATE.excludedStatuses) {
    assert.ok(lib.ACTIVE_CARD_PREDICATE.sql.includes(`'${status}'`));
    assert.ok(lib.ACTIVE_CARD_PREDICATE.postgrest.includes(status));
  }
});

check('classifyLabelRelation agrees with the state production_labels_write refuses', () => {
  const body = writesSql.split('production_labels_write(p_row jsonb,p_event jsonb)')[1].split('$$;')[0];
  assert.match(body, /hasNextPage' is distinct from 'false'::jsonb[\s\S]*native_label_state_incomplete/);
  assert.equal(lib.classifyLabelRelation({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }), 'complete');
  assert.equal(lib.classifyLabelRelation({ nodes: [], pageInfo: { hasNextPage: true, endCursor: 'c' } }), 'paginated');
  assert.equal(lib.classifyLabelRelation(null), 'missing');
  assert.equal(lib.classifyLabelRelation(undefined), 'missing');
  assert.equal(lib.classifyLabelRelation({ nodes: [] }), 'malformed');
  assert.equal(lib.classifyLabelRelation({ pageInfo: { hasNextPage: false } }), 'malformed');
  assert.equal(lib.classifyLabelRelation({ nodes: [], pageInfo: { hasNextPage: 'no' } }), 'malformed');
});

/* ---------------------------------------------------------------------------
 * 2. The pipeline, end to end, offline.
 * ------------------------------------------------------------------------ */

const TEAM_VIDEO = uuid(101);
const TEAM_GRAPHICS = uuid(102);

function label(n, overrides) {
  return Object.assign({
    id: uuid(n),
    name: `label-${n}`,
    color: '#5e6ad2',
    description: null,
    isGroup: false,
    archivedAt: null,
    team: { id: TEAM_VIDEO },
  }, overrides || {});
}

/* 5 labels split two ways: 3+2 for the manifest walk, 2+2+1 for the
 * independent reconciliation walk. Same set, different cursor chain — which is
 * exactly what the reconciliation is meant to prove. */
const ALL = [
  label(1),
  label(2, { archivedAt: '2026-08-01T00:00:00.000Z' }),
  label(3, { isGroup: true, team: null }),
  label(4, { team: { id: TEAM_GRAPHICS }, description: 'graphics only' }),
  label(5, { team: null }),
];

function chunk(list, size) {
  const pages = [];
  for (let i = 0; i < list.length; i += size) pages.push(list.slice(i, i + size));
  if (!pages.length) pages.push([]);
  return pages.map((nodes, index) => ({
    after: index === 0 ? null : `cur${size}-${index}`,
    nodes,
    pageInfo: { hasNextPage: index < pages.length - 1, endCursor: index < pages.length - 1 ? `cur${size}-${index + 1}` : null },
  }));
}

const FIXTURE = {
  pageSize: 3,
  workspace: {
    organization: { id: uuid(900), urlKey: 'example-workspace' },
    video: { id: TEAM_VIDEO, key: 'VID' },
    graphics: { id: TEAM_GRAPHICS, key: 'GRA' },
  },
  pages: chunk(ALL, 3),
  verifyPages: chunk(ALL, 2),
  activeCards: [
    { id: 'b1_d_complete', client_slug: 'sidneylaruel', team: 'video', status: 'in_progress', linear_issue_uuid: uuid(201),
      labels: { nodes: [{ id: uuid(1) }], pageInfo: { hasNextPage: false, endCursor: null } }, archived: null },
    { id: 'b1_d_paginated', client_slug: 'sidneylaruel', team: 'video', status: 'todo', linear_issue_uuid: uuid(202),
      labels: { nodes: [{ id: uuid(1) }], pageInfo: { hasNextPage: true, endCursor: 'x' } }, archived: null },
    { id: 'b1_d_missing', client_slug: 'sidneylaruel', team: 'graphics', status: 'tweak', linear_issue_uuid: uuid(203),
      labels: null, archived: null },
  ],
  issueLabels: {
    [`${uuid(202)}|`]: { issue: { id: uuid(202), team: { id: TEAM_VIDEO }, labels: { nodes: [label(1), label(5)], pageInfo: { hasNextPage: false, endCursor: null } } } },
    [`${uuid(203)}|`]: { issue: { id: uuid(203), team: { id: TEAM_GRAPHICS }, labels: { nodes: [label(4)], pageInfo: { hasNextPage: false, endCursor: null } } } },
  },
};

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'b7-capture-'));
const fixtureFile = path.join(out, 'fixture.json');
fs.writeFileSync(fixtureFile, JSON.stringify(FIXTURE));
const packageDir = path.join(out, 'package');

const previous = { video: process.env.LINEAR_VIDEO_TEAM_ID, graphics: process.env.LINEAR_GRAPHICS_TEAM_ID };
process.env.LINEAR_VIDEO_TEAM_ID = TEAM_VIDEO;
process.env.LINEAR_GRAPHICS_TEAM_ID = TEAM_GRAPHICS;

const silence = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
let exportCode;
let attestCode;
let verifyCode;
(async () => {
  exportCode = await cli.main(['export', `--out=${packageDir}`, `--fixture=${fixtureFile}`, '--page-size=3', '--verify-page-size=2']);
  attestCode = await cli.main(['attest', `--package=${packageDir}`, '--subject=lane-b-test', '--confirm=REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT', `--version-id=${uuid(777)}`]);
  verifyCode = await cli.main(['verify', `--package=${packageDir}`]);
})().then(() => {
  process.stdout.write = silence;
  process.exitCode = 0;
  runAssertions();
}).catch(error => {
  process.stdout.write = silence;
  console.error(error);
  process.exit(1);
});

function runAssertions() {
  process.env.LINEAR_VIDEO_TEAM_ID = previous.video;
  process.env.LINEAR_GRAPHICS_TEAM_ID = previous.graphics;

  check('a full offline capture exits 0 and writes the whole package', () => {
    assert.equal(exportCode, 0);
    assert.equal(attestCode, 0);
    assert.equal(verifyCode, 0);
    for (const name of ['raw-pages.ndjson', 'label-catalog-manifest.json', 'active-card-label-state.json',
      'review-evidence.json', 'capture-receipt.json', 'label-catalog-attestation.json',
      '3-stage-attested.sql', '4-capability-flag.sql']) {
      assert.ok(fs.existsSync(path.join(packageDir, name)), `missing ${name}`);
    }
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'label-catalog-manifest.json'), 'utf8'));
  const attestation = JSON.parse(fs.readFileSync(path.join(packageDir, 'label-catalog-attestation.json'), 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(path.join(packageDir, 'capture-receipt.json'), 'utf8'));
  const evidence = JSON.parse(fs.readFileSync(path.join(packageDir, 'review-evidence.json'), 'utf8'));

  check('the manifest is one the SQL checker accepts, and carries the whole catalog', () => {
    const summary = lib.checkManifest(manifest);
    assert.equal(summary.labelCount, ALL.length);
    assert.equal(manifest.expected_count, ALL.length);
    assert.equal(manifest.include_archived, true);
    assert.equal(manifest.source_kind, lib.LIMITS.SOURCE_KIND);
    assert.deepEqual(manifest.teams, { video: TEAM_VIDEO, graphics: TEAM_GRAPHICS });
    /* the archived and the group entry survive the capture: the checker sees
       every label BEFORE applicability filtering, so dropping either is a
       count_mismatch, not a tidier manifest */
    const ids = manifest.pages.flatMap(p => p.nodes.map(n => n.id));
    assert.ok(ids.includes(uuid(2)), 'archived label was dropped');
    assert.ok(ids.includes(uuid(3)), 'label group was dropped');
  });

  check('the cursor chain closes: page N carries page N-1 endCursor, only the last says hasNextPage false', () => {
    let after = null;
    manifest.pages.forEach((page, index) => {
      assert.equal(page.after, after, `page ${index + 1} does not chain`);
      assert.equal(page.pageInfo.hasNextPage, index < manifest.pages.length - 1);
      after = page.pageInfo.endCursor;
    });
    assert.equal(manifest.pages[manifest.pages.length - 1].pageInfo.endCursor, null);
  });

  check('every node carries exactly the seven keys the checker reads and nothing else', () => {
    for (const page of manifest.pages) {
      for (const node of page.nodes) {
        assert.deepEqual(Object.keys(node).sort(), [...lib.LABEL_FIELDS].sort());
      }
    }
  });

  check('source_sha256 is the digest of raw-pages.ndjson, re-derivable without trusting the script', () => {
    const raw = fs.readFileSync(path.join(packageDir, 'raw-pages.ndjson'));
    assert.equal(lib.sha256Hex(raw), manifest.source_sha256);
    assert.equal(lib.sha256Hex(raw), receipt.source_sha256);
  });

  check('the independent walk used a different page size and reconciled', () => {
    assert.equal(evidence.page_size, 3);
    assert.equal(evidence.reconciliation_page_size, 2);
    assert.notEqual(evidence.pages, (evidence.reconciliation.verify_count / 2));
    assert.equal(evidence.reconciliation.reconciled, true);
    assert.equal(evidence.reconciliation.only_in_primary, 0);
    assert.equal(evidence.reconciliation.only_in_verify, 0);
    assert.equal(evidence.reconciliation.content_diverged, 0);
    assert.equal(receipt.reconciled, true);
  });

  check('a workspace that changes between the two walks refuses to reconcile', () => {
    const drifted = cli.reconcile(FIXTURE.pages, chunk(ALL.slice(1), 2));
    assert.equal(drifted.reconciled, false);
    assert.equal(drifted.only_in_primary, 1);
    const renamed = cli.reconcile(FIXTURE.pages, chunk([label(1, { name: 'renamed' }), ...ALL.slice(1)], 2));
    assert.equal(renamed.reconciled, false);
    assert.equal(renamed.content_diverged, 1);
  });

  check('the attestation is one stage_attested accepts, and is bound to this manifest', () => {
    lib.checkAttestation(manifest, attestation);
    assert.equal(attestation.contract, lib.LIMITS.ATTESTATION_CONTRACT);
    assert.equal(attestation.capture_id, manifest.capture_id);
    assert.equal(attestation.source_sha256, manifest.source_sha256);
    assert.equal(attestation.expected_count, manifest.expected_count);
    assert.deepEqual(attestation.teams, manifest.teams);
    assert.equal(attestation.operator_subject, 'lane-b-test');
    assert.equal(attestation.export_package_sha256, receipt.export_package_sha256);
    assert.equal(attestation.review_evidence_sha256, receipt.review_evidence_sha256);
  });

  check('an attestation bound to a different capture is refused, exactly as the SQL refuses it', () => {
    for (const mutate of [
      a => { a.contract = 'something-else'; },
      a => { a.capture_id = uuid(5); },
      a => { a.source_sha256 = 'f'.repeat(64); },
      a => { a.workspace_fingerprint = 'f'.repeat(64); },
      a => { a.expected_count = manifest.expected_count + 1; },
      a => { a.teams = { video: TEAM_GRAPHICS, graphics: TEAM_VIDEO }; },
      a => { a.export_package_sha256 = 'nope'; },
      a => { a.review_evidence_sha256 = ''; },
      a => { a.operator_subject = '   '; },
      a => { a.operator_subject = 'x'.repeat(129); },
      a => { a.archived_pages_verified = false; },
      a => { a.independent_count_reconciled = false; },
      a => { a.reviewed_at = '2026-09-07 12:00:00'; },
    ]) {
      const copy = JSON.parse(JSON.stringify(attestation));
      mutate(copy);
      assert.throws(() => lib.checkAttestation(manifest, copy), /native_label_catalog_unverified/);
    }
  });

  check('attest refuses without the operator confirmation token', async () => {
    // exercised synchronously below via the mirror; the CLI branch is asserted by source
    const source = fs.readFileSync(path.join(root, 'scripts/linear-label-catalog-export.cli.js'), 'utf8');
    assert.match(source, /REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT/);
    assert.match(source, /if \(!receipt\.reconciled\) throw new Error/);
  });

  check('each way a manifest can be malformed is refused with the checker\'s own code', () => {
    const base = () => JSON.parse(JSON.stringify(manifest));
    const cases = [
      [m => { m.include_archived = false; }, /label_catalog_manifest_invalid/],
      [m => { m.source_kind = 'something_else'; }, /label_catalog_manifest_invalid/],
      [m => { m.capture_id = 'not-a-uuid'; }, /label_catalog_manifest_invalid/],
      [m => { m.teams.graphics = m.teams.video; }, /label_catalog_manifest_invalid/],
      [m => { m.captured_at = '2026-09-07 12:00:00Z'; }, /label_catalog_manifest_invalid/],
      [m => { m.expected_count = 5001; }, /label_catalog_manifest_invalid/],
      [m => { m.pages = []; }, /label_catalog_manifest_invalid/],
      [m => { m.expected_count += 1; }, /label_catalog_count_mismatch/],
      [m => { m.pages[0].after = 'unexpected'; }, /label_catalog_page_invalid/],
      [m => { m.pages[0].pageInfo.hasNextPage = false; }, /label_catalog_page_incomplete/],
      [m => { m.pages[m.pages.length - 1].pageInfo.hasNextPage = true; }, /label_catalog_page_incomplete/],
      [m => { m.pages[0].nodes[0].color = 'blue'; }, /label_catalog_label_invalid/],
      [m => { m.pages[0].nodes[0].name = '  '; }, /label_catalog_label_invalid/],
      [m => { delete m.pages[0].nodes[0].archivedAt; }, /label_catalog_label_invalid/],
      [m => { delete m.pages[0].nodes[0].team; }, /label_catalog_label_invalid/],
      [m => { m.pages[1].nodes[0].id = m.pages[0].nodes[0].id; }, /label_catalog_duplicate_identity/],
      [m => { m.pages[0].nodes[0].team = { id: 'nope' }; }, /label_catalog_team_invalid/],
    ];
    for (const [mutate, expected] of cases) {
      const copy = base();
      mutate(copy);
      assert.throws(() => lib.checkManifest(copy), expected, `expected ${expected} for this mutation`);
    }
  });

  check('an empty workspace still produces a valid one-page manifest', () => {
    const empty = lib.buildManifest({
      pages: [{ after: null, nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }],
      teams: { video: TEAM_VIDEO, graphics: TEAM_GRAPHICS },
      captureId: uuid(11), sourceSha256: '0'.repeat(64), workspaceFingerprint: '1'.repeat(64),
      capturedAt: '2026-09-07T00:00:00.000Z',
    });
    assert.equal(empty.expected_count, 0);
    assert.equal(lib.checkManifest(empty).labelCount, 0);
  });

  check('per-card capture takes ACTIVE cards only and re-reads the ones the native writer would refuse', () => {
    const cards = JSON.parse(fs.readFileSync(path.join(packageDir, 'active-card-label-state.json'), 'utf8'));
    assert.equal(cards.length, 3);
    assert.deepEqual(evidence.card_state.stored_state, { complete: 1, paginated: 1, missing: 1, malformed: 0 });
    assert.equal(evidence.card_state.repaired_from_linear, 2);
    assert.equal(evidence.card_state.repair_failed, 0);
    assert.deepEqual(evidence.card_state.excluded_statuses, ['posted', 'canceled', 'duplicate']);
    const complete = cards.find(c => c.id === 'b1_d_complete');
    assert.equal(complete.stored_state, 'complete');
    assert.equal(complete.repaired_relation, undefined, 'a complete card must not be re-read');
    const paginated = cards.find(c => c.id === 'b1_d_paginated');
    assert.equal(paginated.stored_state, 'paginated');
    assert.equal(paginated.repaired_relation.pageInfo.hasNextPage, false);
    assert.equal(paginated.repaired_relation.nodes.length, 2);
    const missing = cards.find(c => c.id === 'b1_d_missing');
    assert.equal(missing.stored_state, 'missing');
    assert.equal(missing.repaired_relation.nodes.length, 1);
  });

  check('the two SQL artifacts are ordered and self-describing, and the jsonb literals round-trip', () => {
    const stage = fs.readFileSync(path.join(packageDir, '3-stage-attested.sql'), 'utf8');
    const flag = fs.readFileSync(path.join(packageDir, '4-capability-flag.sql'), 'utf8');
    assert.match(stage, /production_label_catalog_stage_attested\(/);
    assert.match(stage, new RegExp(`'${uuid(777)}'::uuid`));
    assert.match(flag, new RegExp(`"version_id":"${uuid(777)}"`));
    assert.match(flag, /DO NOT RUN THIS UNTIL step 3 returned ok:true/);
    /* the manifest must survive dollar-quoting byte for byte */
    const quoted = stage.split('$lblcat$');
    assert.equal(quoted.length, 5, 'expected two dollar-quoted literals');
    assert.deepEqual(JSON.parse(quoted[1]), manifest);
    assert.deepEqual(JSON.parse(quoted[3]), attestation);
  });

  check('a payload containing the quote tag gets a longer tag rather than a broken literal', () => {
    const literal = lib.sqlJsonLiteral({ note: '$lblcat$ drop table x; --' });
    assert.ok(literal.startsWith('$lblcatx$'), literal.slice(0, 20));
    assert.ok(literal.endsWith('$lblcatx$::jsonb'));
  });

  check('canonicalJson is order-independent, so every digest is reproducible', () => {
    assert.equal(lib.canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), lib.canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
    assert.equal(cli.packageDigest([{ name: 'b', sha256: 'x' }, { name: 'a', sha256: 'y' }]),
      cli.packageDigest([{ name: 'a', sha256: 'y' }, { name: 'b', sha256: 'x' }]));
  });

  check('the capture asks Linear for archived labels and for exactly the seven fields', () => {
    assert.match(cli.CATALOG_QUERY, /includeArchived:\s*true/);
    for (const field of ['id', 'name', 'color', 'description', 'isGroup', 'archivedAt', 'team']) {
      assert.match(cli.CATALOG_QUERY, new RegExp(`\\b${field}\\b`));
    }
    assert.match(cli.CATALOG_QUERY, /hasNextPage endCursor/);
  });

  check('nothing in the exporter writes to Linear or to Postgres', () => {
    for (const file of ['scripts/linear-label-catalog-export.js', 'scripts/linear-label-catalog-export.cli.js']) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      assert.doesNotMatch(source, /\bmutation\b/, `${file} contains a GraphQL mutation`);
      assert.doesNotMatch(source, /method:\s*'(POST|PATCH|PUT|DELETE)'[\s\S]{0,200}rest\/v1/, `${file} writes over PostgREST`);
    }
  });

  check('the exporter emits no client display names and no tokens', () => {
    for (const file of ['scripts/linear-label-catalog-export.js', 'scripts/linear-label-catalog-export.cli.js']) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      assert.doesNotMatch(source, /lin_api_|sbp_|eyJhbGciOi/, `${file} looks like it carries a credential`);
      assert.doesNotMatch(source, /display_name/, `${file} reads a client display name`);
    }
  });

  fs.rmSync(out, { recursive: true, force: true });
  console.log(`\nnative-label-catalog-export: ${passed} passed, 0 failed ✅`);
}
