'use strict';

/*
 * B7 — capture the Linear label catalog before Linear access ends 2026-09-15.
 *
 * WHY THIS SCRIPT EXISTS, AND WHY IT IS THE ONE-WAY ITEM
 * ------------------------------------------------------
 * `migrations/2026-09-05-native-label-catalog-foundation.sql` and
 * `migrations/2026-09-06-native-label-writes.sql` give SyncView a native label
 * lane, but both are inert until a version row exists in
 * `production_label_catalog_versions` carrying an operator attestation.
 * The only way in is `production_label_catalog_stage_attested(uuid, manifest,
 * attestation)`, and NOTHING in this repository produced that manifest before
 * this file. The manifest is an archived-inclusive, closed-cursor-chain page
 * capture of the workspace's issue labels. It can only be taken while
 * api.linear.app still answers. After 2026-09-15 it is unrecoverable by any
 * other means, so this capture has an earlier deadline than the deploy.
 *
 * TWO HALVES, TWO DIFFERENT SCOPES — this is deliberate, see docs/ops/NATIVE_LABEL_CATALOG_CAPTURE.md
 * ------------------------------------------------------
 *   (a) THE CATALOG is taken WHOLE. `production_label_catalog_check_manifest`
 *       validates a closed cursor chain, a terminal page, archived entries and
 *       an exact count, and refuses partial evidence — a filtered catalog
 *       cannot satisfy its own manifest. "Whole" is cheap: the checker itself
 *       bounds it at 50 pages x 100 rows, 5000 rows and 5 MiB.
 *   (b) PER-CARD LABEL STATE (`deliverables.linear_raw -> issue -> labels`) is
 *       taken for ACTIVE cards only, per the owner's ruling. See
 *       ACTIVE_CARD_PREDICATE below for the exact predicate and
 *       docs/ops/NATIVE_LABEL_CATALOG_CAPTURE.md for what that leaves behind.
 *
 * READ-ONLY. This script writes nothing to Linear and nothing to Postgres. It
 * writes a private package to disk and prints the SQL a human then runs.
 *
 * PUBLIC SAFETY: the package it writes contains workspace label names, label
 * ids, client slugs and card ids. It is PRIVATE. Write it outside the
 * repository. Nothing it emits belongs in a commit, an issue or CI output.
 * This script's own stdout is counts, digests and file paths only.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LINEAR_URL = 'https://api.linear.app/graphql';

/* Every bound below is read off production_label_catalog_check_manifest in
 * migrations/2026-09-05-native-label-catalog-foundation.sql. test/native-label-
 * catalog-export.js re-reads them out of that file so the two cannot drift. */
const LIMITS = Object.freeze({
  SOURCE_KIND: 'linear_workspace_issue_labels',
  ATTESTATION_CONTRACT: 'operator-reviewed-complete-export-v1',
  MAX_PAGES: 50,
  MAX_NODES_PER_PAGE: 100,
  MAX_EXPECTED_COUNT: 5000,
  MAX_MANIFEST_BYTES: 5242880,
  MAX_CURSOR_LENGTH: 1024,
  MAX_LABEL_NAME_LENGTH: 1000,
  MAX_OPERATOR_SUBJECT_LENGTH: 128,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/* The SQL accepts 1-6 fractional digits; Date#toISOString emits exactly 3. */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const COUNT_TEXT_RE = /^(0|[1-9][0-9]{0,3})$/;

/* The seven keys production_label_catalog_check_manifest requires on a label
 * node, and nothing else. Extra keys would pass the checker but inflate the
 * manifest toward the 5 MiB ceiling for no reader. */
const LABEL_FIELDS = Object.freeze(['id', 'name', 'color', 'description', 'isGroup', 'archivedAt', 'team']);

/*
 * (b) THE OWNER'S SCOPE RULING, AS A PREDICATE.
 *
 * "Active" is decided at the DELIVERABLE, not at the client. A client-level
 * filter (clients.active, clients.board_status) would also drop in-flight
 * cards belonging to a client whose flag is stale, and the capture is cheap
 * enough that the narrower filter buys nothing. The three excluded statuses
 * are the terminal ones in the deliverables_status_check constraint
 * (migrations/2026-07-06-b1-linear-data-model.sql:38-41); `archived` is the
 * marker linear-inbound stamps onto linear_raw at index.ts:903.
 *
 * WHAT THIS DELIBERATELY DOES NOT CAPTURE, permanently, after 2026-09-15:
 * the label state of every posted, canceled, duplicate or archived card. See
 * OPEN_REPAIRS 170.
 */
const ACTIVE_CARD_PREDICATE = Object.freeze({
  excludedStatuses: Object.freeze(['posted', 'canceled', 'duplicate']),
  excludesArchived: true,
  sql: [
    'select d.id, d.client_slug, d.team, d.status, d.linear_issue_uuid,',
    "       d.linear_raw -> 'issue' -> 'labels' as labels,",
    "       d.linear_raw ->> 'archived'         as archived",
    '  from public.deliverables d',
    " where d.status not in ('posted', 'canceled', 'duplicate')",
    "   and d.linear_raw ->> 'archived' is null",
    ' order by d.id',
  ].join('\n'),
  postgrest: [
    'deliverables',
    '?select=id,client_slug,team,status,linear_issue_uuid,labels:linear_raw->issue->labels,archived:linear_raw->>archived',
    '&status=not.in.(posted,canceled,duplicate)',
    '&linear_raw->>archived=is.null',
    '&order=id.asc',
  ].join(''),
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Deterministic, key-sorted JSON. Every digest this script emits is over this. */
function canonicalJson(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalJson: unserializable ${typeof value}`);
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8')).digest('hex');
}

class ManifestError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ManifestError';
    this.code = code;
  }
}

/*
 * A faithful JS mirror of production_label_catalog_check_manifest. Every
 * `raise exception` in that function has a branch here with the same message
 * string, so a manifest this script writes cannot be one the database refuses.
 * It deliberately does NOT return a digest: the SQL returns sha256 of
 * `p_manifest::text` as PostgreSQL renders jsonb (its own key ordering and
 * spacing), which is not reproducible from here. The authoritative
 * manifest_sha256 is whatever the staging call returns.
 */
function checkManifest(manifest) {
  const bad = detail => { throw new ManifestError('label_catalog_manifest_invalid', detail); };
  if (!isObject(manifest)) bad('not an object');
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > LIMITS.MAX_MANIFEST_BYTES) bad('over 5 MiB');
  if (manifest.schema_version !== 1) bad('schema_version');
  if (manifest.source_kind !== LIMITS.SOURCE_KIND) bad('source_kind');
  if (!UUID_RE.test(clean(manifest.capture_id))) bad('capture_id');
  if (!SHA256_RE.test(clean(manifest.source_sha256))) bad('source_sha256');
  if (!SHA256_RE.test(clean(manifest.workspace_fingerprint))) bad('workspace_fingerprint');
  if (manifest.include_archived !== true) bad('include_archived');
  if (typeof manifest.captured_at !== 'string' || !TIMESTAMP_RE.test(manifest.captured_at)) bad('captured_at');
  if (!Number.isFinite(Date.parse(manifest.captured_at))) bad('captured_at unparseable');
  if (!isObject(manifest.teams)) bad('teams');
  if (!UUID_RE.test(clean(manifest.teams.video))) bad('teams.video');
  if (!UUID_RE.test(clean(manifest.teams.graphics))) bad('teams.graphics');
  if (manifest.teams.video === manifest.teams.graphics) bad('teams.video equals teams.graphics');
  if (typeof manifest.expected_count !== 'number') bad('expected_count type');
  if (!COUNT_TEXT_RE.test(String(manifest.expected_count))) bad('expected_count format');
  if (!Array.isArray(manifest.pages)) bad('pages');

  const pageCount = manifest.pages.length;
  if (pageCount < 1 || pageCount > LIMITS.MAX_PAGES) bad(`pages length ${pageCount}`);
  if (manifest.expected_count > LIMITS.MAX_EXPECTED_COUNT) bad('expected_count over 5000');

  let after = null;
  let seen = 0;
  const ids = new Set();
  const cursors = new Set();

  manifest.pages.forEach((page, index) => {
    const pageBad = d => { throw new ManifestError('label_catalog_page_invalid', d); };
    if (!isObject(page)) pageBad('page not an object');
    if (!Object.prototype.hasOwnProperty.call(page, 'after')) pageBad('page missing after');
    if (page.after !== null && typeof page.after !== 'string') pageBad('page.after type');
    if ((page.after === null ? null : page.after) !== after) pageBad(`page ${index + 1} after does not chain`);
    if (!Array.isArray(page.nodes)) pageBad('page.nodes');
    if (!isObject(page.pageInfo)) pageBad('page.pageInfo');
    if (typeof page.pageInfo.hasNextPage !== 'boolean') pageBad('pageInfo.hasNextPage');
    if (!Object.prototype.hasOwnProperty.call(page.pageInfo, 'endCursor')) pageBad('pageInfo.endCursor missing');
    if (page.pageInfo.endCursor !== null && typeof page.pageInfo.endCursor !== 'string') pageBad('pageInfo.endCursor type');

    const more = page.pageInfo.hasNextPage;
    const cursor = page.pageInfo.endCursor;
    const incomplete = d => { throw new ManifestError('label_catalog_page_incomplete', d); };
    if (more !== (index < pageCount - 1)) incomplete(`page ${index + 1} hasNextPage=${more}`);
    if (page.nodes.length > LIMITS.MAX_NODES_PER_PAGE) incomplete('page over 100 nodes');
    if (more && (page.nodes.length === 0 || clean(cursor) === '')) incomplete('non-terminal page is empty or uncursored');
    if (cursor !== null && (clean(cursor) !== cursor || cursor === '' || cursor.length > LIMITS.MAX_CURSOR_LENGTH || cursors.has(cursor))) {
      incomplete('endCursor blank, padded, oversized or repeated');
    }
    if (cursor !== null) cursors.add(cursor);
    after = cursor;

    for (const label of page.nodes) {
      const labelBad = d => { throw new ManifestError('label_catalog_label_invalid', d); };
      if (!isObject(label)) labelBad('label not an object');
      if (!UUID_RE.test(clean(label.id))) labelBad('label.id');
      if (typeof label.name !== 'string' || clean(label.name) === '' || label.name.length > LIMITS.MAX_LABEL_NAME_LENGTH) labelBad('label.name');
      if (typeof label.color !== 'string' || !COLOR_RE.test(label.color)) labelBad('label.color');
      if (!Object.prototype.hasOwnProperty.call(label, 'description')) labelBad('label.description missing');
      if (label.description !== null && typeof label.description !== 'string') labelBad('label.description type');
      if (typeof label.isGroup !== 'boolean') labelBad('label.isGroup');
      if (!Object.prototype.hasOwnProperty.call(label, 'archivedAt')) labelBad('label.archivedAt missing');
      if (!Object.prototype.hasOwnProperty.call(label, 'team')) labelBad('label.team missing');
      if (ids.has(label.id)) throw new ManifestError('label_catalog_duplicate_identity', label.id);
      if (label.archivedAt !== null) {
        if (typeof label.archivedAt !== 'string' || !TIMESTAMP_RE.test(label.archivedAt)) labelBad('label.archivedAt format');
        if (!Number.isFinite(Date.parse(label.archivedAt))) labelBad('label.archivedAt unparseable');
      }
      if (label.team !== null && (!isObject(label.team) || !UUID_RE.test(clean(label.team.id)))) {
        throw new ManifestError('label_catalog_team_invalid', 'label.team');
      }
      ids.add(label.id);
      seen += 1;
    }
  });

  if (seen !== manifest.expected_count) {
    throw new ManifestError('label_catalog_count_mismatch', `counted ${seen}, expected_count ${manifest.expected_count}`);
  }
  return { labelCount: seen, pageCount };
}

/** Reduce one Linear label node to exactly the seven keys the checker reads. */
function projectLabel(node) {
  if (!isObject(node)) throw new ManifestError('label_catalog_label_invalid', 'node not an object');
  const team = isObject(node.team) ? { id: clean(node.team.id) } : null;
  return {
    id: clean(node.id),
    name: typeof node.name === 'string' ? node.name : '',
    color: clean(node.color),
    description: typeof node.description === 'string' ? node.description : null,
    isGroup: node.isGroup === true,
    archivedAt: node.archivedAt == null ? null : clean(node.archivedAt),
    team,
  };
}

function buildManifest(options) {
  const pages = (options.pages || []).map(page => ({
    after: page.after == null ? null : String(page.after),
    nodes: (page.nodes || []).map(projectLabel),
    pageInfo: {
      hasNextPage: page.pageInfo.hasNextPage === true,
      endCursor: page.pageInfo.endCursor == null ? null : String(page.pageInfo.endCursor),
    },
  }));
  const manifest = {
    schema_version: 1,
    source_kind: LIMITS.SOURCE_KIND,
    capture_id: clean(options.captureId),
    source_sha256: clean(options.sourceSha256),
    workspace_fingerprint: clean(options.workspaceFingerprint),
    include_archived: true,
    captured_at: clean(options.capturedAt),
    teams: { video: clean(options.teams.video), graphics: clean(options.teams.graphics) },
    expected_count: pages.reduce((total, page) => total + page.nodes.length, 0),
    pages,
  };
  checkManifest(manifest);
  return manifest;
}

/*
 * A JS mirror of every refusal in production_label_catalog_stage_attested
 * (migrations/2026-09-06-native-label-writes.sql:19-35). Same purpose as
 * checkManifest: never hand the owner a call the database will reject.
 */
function checkAttestation(manifest, attestation) {
  const bad = detail => { throw new ManifestError('native_label_catalog_unverified', detail); };
  if (!isObject(attestation)) bad('not an object');
  if (attestation.contract !== LIMITS.ATTESTATION_CONTRACT) bad('contract');
  if (attestation.source_sha256 !== manifest.source_sha256) bad('source_sha256 does not match the manifest');
  if (attestation.workspace_fingerprint !== manifest.workspace_fingerprint) bad('workspace_fingerprint does not match the manifest');
  if (canonicalJson(attestation.teams) !== canonicalJson(manifest.teams)) bad('teams does not match the manifest');
  if (attestation.expected_count !== manifest.expected_count) bad('expected_count does not match the manifest');
  if (attestation.capture_id !== manifest.capture_id) bad('capture_id does not match the manifest');
  if (!SHA256_RE.test(clean(attestation.export_package_sha256))) bad('export_package_sha256');
  if (!SHA256_RE.test(clean(attestation.review_evidence_sha256))) bad('review_evidence_sha256');
  if (typeof attestation.operator_subject !== 'string') bad('operator_subject type');
  if (clean(attestation.operator_subject) === '') bad('operator_subject empty');
  if (attestation.operator_subject.length > LIMITS.MAX_OPERATOR_SUBJECT_LENGTH) bad('operator_subject over 128 chars');
  if (attestation.archived_pages_verified !== true) bad('archived_pages_verified');
  if (attestation.independent_count_reconciled !== true) bad('independent_count_reconciled');
  if (typeof attestation.reviewed_at !== 'string' || !TIMESTAMP_RE.test(attestation.reviewed_at)) bad('reviewed_at');
  if (!Number.isFinite(Date.parse(attestation.reviewed_at))) bad('reviewed_at unparseable');
  return true;
}

function buildAttestation(options) {
  const manifest = options.manifest;
  const attestation = {
    contract: LIMITS.ATTESTATION_CONTRACT,
    capture_id: manifest.capture_id,
    source_sha256: manifest.source_sha256,
    workspace_fingerprint: manifest.workspace_fingerprint,
    teams: { video: manifest.teams.video, graphics: manifest.teams.graphics },
    expected_count: manifest.expected_count,
    export_package_sha256: clean(options.exportPackageSha256),
    review_evidence_sha256: clean(options.reviewEvidenceSha256),
    operator_subject: clean(options.operatorSubject),
    archived_pages_verified: true,
    independent_count_reconciled: true,
    reviewed_at: clean(options.reviewedAt),
  };
  checkAttestation(manifest, attestation);
  return attestation;
}

/*
 * `deliverables.linear_raw -> issue -> labels` in the three states that matter.
 * `paginated` and `missing` are the ones that bite: production_labels_write
 * (migrations/2026-09-06-native-label-writes.sql:163-165) refuses with
 * `native_label_state_incomplete` unless nodes is an array AND hasNextPage is
 * exactly false, and the only repair for a card in either state is a re-read
 * from Linear. That is why (b) is deadline-bound too, not merely a snapshot.
 */
function classifyLabelRelation(relation) {
  if (relation === null || relation === undefined) return 'missing';
  if (!isObject(relation)) return 'malformed';
  if (!Array.isArray(relation.nodes)) return 'malformed';
  if (!isObject(relation.pageInfo)) return 'malformed';
  if (relation.pageInfo.hasNextPage === false) return 'complete';
  if (relation.pageInfo.hasNextPage === true) return 'paginated';
  return 'malformed';
}

/** A jsonb literal safe to paste: dollar-quoted with a tag the payload cannot contain. */
function sqlJsonLiteral(value) {
  const text = JSON.stringify(value);
  let tag = 'lblcat';
  while (text.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${text}$${tag}$::jsonb`;
}

function renderStageAttestedSql(options) {
  return [
    '-- B7 step 3 of 4: stage the attested Linear label catalog version.',
    '-- Runs as the service role. Idempotent: a second run with the same bytes',
    '-- returns the same row; different bytes raise label_catalog_version_conflict.',
    `-- capture_id ${options.manifest.capture_id}`,
    `-- expected_count ${options.manifest.expected_count} across ${options.manifest.pages.length} page(s)`,
    'select public.production_label_catalog_stage_attested(',
    `  '${options.versionId}'::uuid,`,
    `  ${sqlJsonLiteral(options.manifest)},`,
    `  ${sqlJsonLiteral(options.attestation)}`,
    ');',
    '',
  ].join('\n');
}

function renderCapabilityFlagSql(options) {
  return [
    '-- B7 step 4 of 4: point the native label lane at the staged version.',
    '-- DO NOT RUN THIS UNTIL step 3 returned ok:true. production_label_catalog_capability()',
    '-- reads ONLY this flag (migrations/2026-09-06-native-label-writes.sql:57-72). It does',
    '-- NOT check that the version exists. Flipping to native with nothing staged reports',
    "-- \"native\" and then 503s one call later inside production_label_catalog_read_attested.",
    'update public.syncview_runtime_flags',
    `   set value = '{"schema_version":1,"mode":"native","version_id":"${options.versionId}"}'::jsonb,`,
    "       updated_by = 'b7-label-catalog-capture'",
    " where key = 'production_native_label_catalog';",
    '',
    '-- UNDO (containment, not rollback — provider stops working the day Linear dies):',
    '-- update public.syncview_runtime_flags',
    '--    set value = \'{"schema_version":1,"mode":"hold","version_id":null}\'::jsonb',
    "--  where key = 'production_native_label_catalog';",
    '',
  ].join('\n');
}

module.exports = {
  LIMITS,
  ACTIVE_CARD_PREDICATE,
  LABEL_FIELDS,
  ManifestError,
  canonicalJson,
  sha256Hex,
  checkManifest,
  buildManifest,
  projectLabel,
  checkAttestation,
  buildAttestation,
  classifyLabelRelation,
  renderStageAttestedSql,
  renderCapabilityFlagSql,
  sqlJsonLiteral,
};

if (require.main === module) {
  require('./linear-label-catalog-export.cli.js').main(process.argv.slice(2));
}
