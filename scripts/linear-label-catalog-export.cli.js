'use strict';

/*
 * The runnable half of B7. See scripts/linear-label-catalog-export.js for what
 * this captures and why it cannot be done after 2026-09-15, and
 * docs/ops/NATIVE_LABEL_CATALOG_CAPTURE.md for the owner's runbook.
 *
 * READ-ONLY against both Linear and Postgres. It writes only to --out.
 *
 * PUBLIC SAFETY: --out contains workspace label names, client slugs and card
 * ids. Write it OUTSIDE the repository and never commit it. This file's own
 * stdout is counts, digests, uuids and paths — no label names, no client names.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const lib = require('./linear-label-catalog-export.js');
const { LIMITS, ACTIVE_CARD_PREDICATE } = lib;

const LINEAR_URL = 'https://api.linear.app/graphql';

/* Exactly the seven node fields production_label_catalog_check_manifest reads,
 * plus the page envelope. Asking for less is a refused manifest; asking for
 * more inflates the manifest against its own 5 MiB ceiling. */
const CATALOG_QUERY = `query LabelPage($first: Int!, $after: String) {
  issueLabels(first: $first, after: $after, includeArchived: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id name color description isGroup archivedAt team { id } }
  }
}`;

const WORKSPACE_QUERY = `query Workspace($video: String!, $graphics: String!) {
  organization { id urlKey }
  video: team(id: $video) { id key }
  graphics: team(id: $graphics) { id key }
}`;

const SELECTED_LABELS_QUERY = `query IssueLabels($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    id
    team { id }
    labels(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id name color description isGroup archivedAt team { id } }
    }
  }
}`;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parseArgs(argv) {
  const args = new Map();
  const positional = [];
  for (const raw of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (match) args.set(match[1], match[2] === undefined ? '1' : match[2]);
    else positional.push(raw);
  }
  return { args, command: positional[0] || 'export' };
}

function required(name, value) {
  const text = clean(value);
  if (!text) throw new Error(`${name} is required`);
  return text;
}

/* ---------------------------------------------------------------- transport */

function linearTransport(apiKey) {
  return async function call(query, variables) {
    const response = await fetch(LINEAR_URL, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { body = null; }
    if (!response.ok || !body || body.errors) {
      /* Never echo the response body: a GraphQL error can quote the request,
       * and the request carries an Authorization header in some proxies. */
      throw new Error(`Linear read failed: HTTP ${response.status}`);
    }
    return { data: body.data, text };
  };
}

/* An offline rehearsal transport. The fixture is a recorded capture, so the
 * whole pipeline — paging, reconciliation, manifest, attestation, SQL — can be
 * exercised with no credentials and no network. test/native-label-catalog-
 * export.js runs the real pipeline through this. */
function fixtureTransport(fixture) {
  return async function call(query, variables) {
    if (query === WORKSPACE_QUERY) {
      return { data: fixture.workspace, text: JSON.stringify({ data: fixture.workspace }) };
    }
    if (query === SELECTED_LABELS_QUERY) {
      const key = `${variables.id}|${variables.after == null ? '' : variables.after}`;
      const page = (fixture.issueLabels || {})[key];
      if (!page) throw new Error(`fixture has no issue label page for ${key}`);
      return { data: page, text: JSON.stringify({ data: page }) };
    }
    const bucket = variables.first === Number(fixture.pageSize) ? 'pages' : 'verifyPages';
    const list = fixture[bucket] || [];
    const index = list.findIndex(p => (p.after == null ? null : p.after) === (variables.after == null ? null : variables.after));
    if (index < 0) throw new Error(`fixture has no ${bucket} entry after=${variables.after}`);
    const data = { issueLabels: { pageInfo: list[index].pageInfo, nodes: list[index].nodes } };
    return { data, text: JSON.stringify({ data }) };
  };
}

/* ------------------------------------------------------------------ capture */

/*
 * Walk the whole issueLabels connection, archived included, recording the
 * `after` we actually sent alongside each page. The manifest's cursor chain is
 * evidence, so it has to be what happened, not what we would have liked.
 */
async function capturePages(call, pageSize, maxPages) {
  const pages = [];
  const bodies = [];
  let after = null;
  for (let index = 0; index < maxPages; index++) {
    const { data, text } = await call(CATALOG_QUERY, { first: pageSize, after });
    bodies.push(text);
    const connection = (data && data.issueLabels) || null;
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
      throw new Error('Linear returned a malformed issueLabels page');
    }
    pages.push({ after, nodes: connection.nodes, pageInfo: connection.pageInfo });
    if (connection.pageInfo.hasNextPage !== true) return { pages, bodies };
    after = clean(connection.pageInfo.endCursor);
    if (!after) throw new Error('Linear reported hasNextPage with no endCursor');
  }
  throw new Error(`the catalog did not terminate within ${maxPages} pages`);
}

/*
 * The independent count. A second full walk at a DIFFERENT page size: if the
 * two walks disagree on the id set or on any label's content, the workspace
 * changed mid-capture and the cursor chain is not a coherent snapshot, so the
 * capture is refused rather than attested. This is the evidence behind the
 * attestation's `independent_count_reconciled`.
 */
function reconcile(primaryPages, verifyPages) {
  const flatten = pages => {
    const map = new Map();
    for (const page of pages) for (const node of page.nodes) map.set(clean(node.id), lib.projectLabel(node));
    return map;
  };
  const a = flatten(primaryPages);
  const b = flatten(verifyPages);
  const onlyPrimary = [...a.keys()].filter(id => !b.has(id));
  const onlyVerify = [...b.keys()].filter(id => !a.has(id));
  const changed = [...a.keys()].filter(id => b.has(id) && lib.canonicalJson(a.get(id)) !== lib.canonicalJson(b.get(id)));
  return {
    primary_count: a.size,
    verify_count: b.size,
    only_in_primary: onlyPrimary.length,
    only_in_verify: onlyVerify.length,
    content_diverged: changed.length,
    reconciled: onlyPrimary.length === 0 && onlyVerify.length === 0 && changed.length === 0 && a.size === b.size,
  };
}

function archivedEvidence(pages) {
  let archived = 0;
  let groups = 0;
  let workspaceScoped = 0;
  for (const page of pages) {
    for (const node of page.nodes) {
      if (node.archivedAt != null) archived += 1;
      if (node.isGroup === true) groups += 1;
      if (node.team == null) workspaceScoped += 1;
    }
  }
  return { archived, groups, workspace_scoped: workspaceScoped };
}

/* ------------------------------------------------------- per-card, half (b) */

async function readActiveCards(supabaseUrl, serviceKey) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = `${supabaseUrl}/rest/v1/${ACTIVE_CARD_PREDICATE.postgrest}&limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Supabase read HTTP ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Supabase returned a non-array');
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

/*
 * Classify every active card's stored label relation and re-read from Linear
 * only the ones the native writer would refuse. production_labels_write raises
 * `native_label_state_incomplete` unless nodes is an array and hasNextPage is
 * exactly false, so a `paginated`/`missing`/`malformed` card is one whose
 * labels can never be changed natively — and only Linear can repair it.
 */
async function captureCardState(rows, call, options) {
  const buckets = { complete: 0, paginated: 0, missing: 0, malformed: 0 };
  const cards = [];
  const repairs = [];
  const repairFailures = [];
  for (const row of rows) {
    const state = lib.classifyLabelRelation(row.labels);
    buckets[state] += 1;
    const card = {
      id: clean(row.id),
      client_slug: clean(row.client_slug),
      team: clean(row.team),
      status: clean(row.status),
      linear_issue_uuid: clean(row.linear_issue_uuid),
      stored_state: state,
      stored_label_ids: state === 'complete'
        ? row.labels.nodes.map(node => clean(node.id)).sort()
        : null,
    };
    if (state !== 'complete' && options.repair && card.linear_issue_uuid) {
      try {
        const relation = await readSelectedLabels(call, card.linear_issue_uuid, options.selectedPageSize);
        card.repaired_relation = relation;
        repairs.push(card.id);
      } catch (error) {
        card.repair_error = error && error.message ? String(error.message).slice(0, 200) : 'unknown';
        repairFailures.push(card.id);
      }
    }
    cards.push(card);
  }
  return { cards, buckets, repaired: repairs.length, repair_failed: repairFailures.length };
}

async function readSelectedLabels(call, issueId, pageSize) {
  const nodes = [];
  const cursors = new Set();
  let after = null;
  for (let page = 0; page < 20; page++) {
    const { data } = await call(SELECTED_LABELS_QUERY, { id: issueId, first: pageSize, after });
    const issue = (data && data.issue) || null;
    if (!issue || clean(issue.id) !== issueId) throw new Error('issue identity changed');
    const connection = issue.labels || {};
    if (!Array.isArray(connection.nodes) || !connection.pageInfo) throw new Error('malformed label connection');
    for (const node of connection.nodes) nodes.push(lib.projectLabel(node));
    if (connection.pageInfo.hasNextPage === false) {
      return {
        nodes: nodes.sort((x, y) => x.id.localeCompare(y.id)),
        pageInfo: { hasNextPage: false, endCursor: null },
      };
    }
    const cursor = clean(connection.pageInfo.endCursor);
    if (!cursor || cursors.has(cursor)) throw new Error('invalid or repeated cursor');
    cursors.add(cursor);
    after = cursor;
  }
  throw new Error('selected labels did not terminate');
}

/* ------------------------------------------------------------------ package */

function writeFileAndDigest(dir, name, contents) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return { name, file, sha256: lib.sha256Hex(contents), bytes: Buffer.byteLength(contents, 'utf8') };
}

/* Digest of the whole package: sha256 over the canonical {name: sha256} map,
 * so it is order-independent and reproducible from the files on disk. */
function packageDigest(entries) {
  const map = {};
  for (const entry of entries) map[entry.name] = entry.sha256;
  return lib.sha256Hex(lib.canonicalJson(map));
}

/* --------------------------------------------------------------- subcommand */

async function runExport(args) {
  const out = required('--out', args.get('out'));
  fs.mkdirSync(out, { recursive: true });

  const fixturePath = clean(args.get('fixture'));
  const pageSize = Number(args.get('page-size') || (fixturePath ? 0 : LIMITS.MAX_NODES_PER_PAGE)) || LIMITS.MAX_NODES_PER_PAGE;
  const verifyPageSize = Number(args.get('verify-page-size') || 0) || Math.max(1, Math.floor(pageSize / 2));

  let call;
  let fixture = null;
  if (fixturePath) {
    fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    call = fixtureTransport(fixture);
  } else {
    call = linearTransport(required('LINEAR_API_KEY', process.env.LINEAR_API_KEY || process.env.LINEAR_API_TOKEN));
  }

  const teams = {
    video: required('LINEAR_VIDEO_TEAM_ID', args.get('video-team') || process.env.LINEAR_VIDEO_TEAM_ID).toLowerCase(),
    graphics: required('LINEAR_GRAPHICS_TEAM_ID', args.get('graphics-team') || process.env.LINEAR_GRAPHICS_TEAM_ID).toLowerCase(),
  };

  /* Resolve the workspace FIRST. A wrong team id must fail before we produce a
   * manifest that names it, not after. */
  const workspace = (await call(WORKSPACE_QUERY, { video: teams.video, graphics: teams.graphics })).data;
  const org = (workspace && workspace.organization) || {};
  if (clean((workspace.video || {}).id).toLowerCase() !== teams.video) throw new Error('LINEAR_VIDEO_TEAM_ID does not resolve in this workspace');
  if (clean((workspace.graphics || {}).id).toLowerCase() !== teams.graphics) throw new Error('LINEAR_GRAPHICS_TEAM_ID does not resolve in this workspace');
  const workspaceFingerprint = lib.sha256Hex(lib.canonicalJson({
    organization_id: clean(org.id),
    organization_url_key: clean(org.urlKey),
    graphics_team_id: teams.graphics,
    video_team_id: teams.video,
  }));

  process.stdout.write(`workspace resolved; page size ${pageSize}, reconciliation page size ${verifyPageSize}\n`);
  const primary = await capturePages(call, pageSize, LIMITS.MAX_PAGES);
  const verify = await capturePages(call, verifyPageSize, 200);
  const reconciliation = reconcile(primary.pages, verify.pages);

  /* source_sha256 is the digest of the ORIGINAL export bytes: the Linear
   * response bodies of the manifest walk, in order, joined by \n and written
   * verbatim to raw-pages.ndjson. The owner can re-derive it from that file
   * alone, without trusting this script. */
  const rawBytes = primary.bodies.join('\n');
  const sourceSha256 = lib.sha256Hex(rawBytes);

  const manifest = lib.buildManifest({
    pages: primary.pages,
    teams,
    captureId: crypto.randomUUID(),
    sourceSha256,
    workspaceFingerprint,
    capturedAt: new Date().toISOString(),
  });

  const evidence = {
    capture_id: manifest.capture_id,
    captured_at: manifest.captured_at,
    workspace_fingerprint: workspaceFingerprint,
    source_sha256: sourceSha256,
    page_size: pageSize,
    reconciliation_page_size: verifyPageSize,
    pages: manifest.pages.length,
    expected_count: manifest.expected_count,
    reconciliation,
    composition: archivedEvidence(primary.pages),
    checker_bounds: {
      max_pages: LIMITS.MAX_PAGES,
      max_nodes_per_page: LIMITS.MAX_NODES_PER_PAGE,
      max_expected_count: LIMITS.MAX_EXPECTED_COUNT,
      max_manifest_bytes: LIMITS.MAX_MANIFEST_BYTES,
    },
    card_state: null,
  };

  /* ---- half (b): per-card label state, ACTIVE cards only ---- */
  let cardState = null;
  if (!args.has('skip-card-state')) {
    let rows = null;
    const cardStateFile = clean(args.get('card-state-file'));
    if (cardStateFile) {
      rows = JSON.parse(fs.readFileSync(cardStateFile, 'utf8'));
    } else if (fixture) {
      rows = fixture.activeCards || [];
    } else {
      const supabaseUrl = clean(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
      rows = await readActiveCards(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY));
    }
    cardState = await captureCardState(rows, call, {
      repair: !args.has('no-repair-read'),
      selectedPageSize: Number(args.get('selected-page-size') || 100) || 100,
    });
    evidence.card_state = {
      predicate: ACTIVE_CARD_PREDICATE.sql,
      excluded_statuses: ACTIVE_CARD_PREDICATE.excludedStatuses,
      excludes_archived: ACTIVE_CARD_PREDICATE.excludesArchived,
      active_rows: cardState.cards.length,
      stored_state: cardState.buckets,
      repaired_from_linear: cardState.repaired,
      repair_failed: cardState.repair_failed,
    };
  }

  const files = [];
  files.push(writeFileAndDigest(out, 'raw-pages.ndjson', rawBytes));
  files.push(writeFileAndDigest(out, 'label-catalog-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`));
  if (cardState) files.push(writeFileAndDigest(out, 'active-card-label-state.json', `${JSON.stringify(cardState.cards, null, 2)}\n`));
  const evidenceEntry = writeFileAndDigest(out, 'review-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
  files.push(evidenceEntry);

  const receipt = {
    capture_id: manifest.capture_id,
    captured_at: manifest.captured_at,
    expected_count: manifest.expected_count,
    pages: manifest.pages.length,
    source_sha256: sourceSha256,
    workspace_fingerprint: workspaceFingerprint,
    export_package_sha256: packageDigest(files),
    review_evidence_sha256: evidenceEntry.sha256,
    reconciled: reconciliation.reconciled,
    files: files.map(f => ({ name: f.name, sha256: f.sha256, bytes: f.bytes })),
  };
  writeFileAndDigest(out, 'capture-receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);

  process.stdout.write([
    '',
    '=== B7 capture complete — READ-ONLY, nothing was written to Linear or Postgres ===',
    `capture_id              ${receipt.capture_id}`,
    `captured_at             ${receipt.captured_at}`,
    `labels captured         ${receipt.expected_count} across ${receipt.pages} page(s), archived included`,
    `  of which archived     ${evidence.composition.archived}`,
    `  of which label groups ${evidence.composition.groups}`,
    `  workspace-scoped      ${evidence.composition.workspace_scoped}`,
    `independent walk        page size ${verifyPageSize}: ${reconciliation.reconciled ? 'RECONCILED' : 'DIVERGED'} ` +
      `(only-primary ${reconciliation.only_in_primary}, only-verify ${reconciliation.only_in_verify}, changed ${reconciliation.content_diverged})`,
    evidence.card_state
      ? `active cards            ${evidence.card_state.active_rows} rows; complete ${evidence.card_state.stored_state.complete}, ` +
        `paginated ${evidence.card_state.stored_state.paginated}, missing ${evidence.card_state.stored_state.missing}, ` +
        `malformed ${evidence.card_state.stored_state.malformed}; re-read from Linear ${evidence.card_state.repaired_from_linear}, failed ${evidence.card_state.repair_failed}`
      : 'active cards            SKIPPED (--skip-card-state)',
    `source_sha256           ${receipt.source_sha256}`,
    `export_package_sha256   ${receipt.export_package_sha256}`,
    `review_evidence_sha256  ${receipt.review_evidence_sha256}`,
    `package                 ${path.resolve(out)}`,
    '',
    reconciliation.reconciled
      ? 'NEXT: review docs/ops/NATIVE_LABEL_CATALOG_CAPTURE.md "What you are attesting to", then run the attest step.'
      : 'STOP: the two walks disagree, so the workspace changed mid-capture. Re-run the capture. Do NOT attest this package.',
    '',
  ].join('\n'));

  return reconciliation.reconciled ? 0 : 1;
}

async function runAttest(args) {
  const dir = required('--package', args.get('package'));
  const subject = required('--subject', args.get('subject'));
  const confirm = clean(args.get('confirm'));
  if (confirm !== 'REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT') {
    throw new Error('--confirm=REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT is required. It is your assertion, not this script\'s: '
      + 'it says a human read review-evidence.json and independently satisfied himself the export is the complete workspace catalog.');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'label-catalog-manifest.json'), 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'capture-receipt.json'), 'utf8'));
  lib.checkManifest(manifest);
  if (!receipt.reconciled) throw new Error('this package did not reconcile; re-capture rather than attesting it');

  const versionId = clean(args.get('version-id')) || crypto.randomUUID();
  const attestation = lib.buildAttestation({
    manifest,
    exportPackageSha256: receipt.export_package_sha256,
    reviewEvidenceSha256: receipt.review_evidence_sha256,
    operatorSubject: subject,
    reviewedAt: new Date().toISOString(),
  });

  const stageSql = lib.renderStageAttestedSql({ versionId, manifest, attestation });
  const flagSql = lib.renderCapabilityFlagSql({ versionId });
  const a = writeFileAndDigest(dir, 'label-catalog-attestation.json', `${JSON.stringify(attestation, null, 2)}\n`);
  const b = writeFileAndDigest(dir, '3-stage-attested.sql', stageSql);
  const c = writeFileAndDigest(dir, '4-capability-flag.sql', flagSql);

  process.stdout.write([
    '',
    '=== B7 attestation written — still nothing has been sent to Postgres ===',
    `version_id   ${versionId}`,
    `attestation  ${a.file}  sha256 ${a.sha256}`,
    `step 3 SQL   ${b.file}  ${b.bytes} bytes  sha256 ${b.sha256}`,
    `step 4 SQL   ${c.file}  ${c.bytes} bytes  sha256 ${c.sha256}`,
    '',
    'Run step 3 first and require ok:true in its result. Only then run step 4.',
    'production_label_catalog_capability() reads ONLY the runtime flag and never checks that',
    'the version exists, so step 4 before a successful step 3 reports "native" and then 503s',
    'one call later inside production_label_catalog_read_attested.',
    '',
  ].join('\n'));
  return 0;
}

async function runVerify(args) {
  const dir = required('--package', args.get('package'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'label-catalog-manifest.json'), 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'capture-receipt.json'), 'utf8'));
  const summary = lib.checkManifest(manifest);
  const raw = fs.readFileSync(path.join(dir, 'raw-pages.ndjson'));
  const rawSha = lib.sha256Hex(raw);
  const ok = rawSha === manifest.source_sha256 && rawSha === receipt.source_sha256;
  process.stdout.write([
    '',
    `manifest         VALID — ${summary.labelCount} labels across ${summary.pageCount} page(s)`,
    `raw-pages sha256 ${rawSha}`,
    `matches manifest ${ok ? 'YES' : 'NO'}`,
    `reconciled       ${receipt.reconciled ? 'YES' : 'NO'}`,
    '',
  ].join('\n'));
  return ok && receipt.reconciled ? 0 : 1;
}

const USAGE = `B7 — Linear label catalog capture (read-only)

  node scripts/linear-label-catalog-export.js export --out=<private dir>
  node scripts/linear-label-catalog-export.js attest --package=<dir> --subject="<who reviewed>" --confirm=REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT
  node scripts/linear-label-catalog-export.js verify --package=<dir>

Credentials come only from the approved private secret mechanism:
  LINEAR_API_KEY (or LINEAR_API_TOKEN), LINEAR_VIDEO_TEAM_ID, LINEAR_GRAPHICS_TEAM_ID
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (half (b) only; omit with --skip-card-state)

Options: --fixture=<file> offline rehearsal, --card-state-file=<file> feed rows from
the SQL editor instead of PostgREST, --skip-card-state, --no-repair-read,
--page-size, --verify-page-size, --version-id.

The package it writes is PRIVATE. Write it outside the repository.
`;

async function main(argv) {
  const { args, command } = parseArgs(argv);
  if (args.has('help') || command === 'help') { process.stdout.write(USAGE); return 0; }
  let code = 1;
  if (command === 'export') code = await runExport(args);
  else if (command === 'attest') code = await runAttest(args);
  else if (command === 'verify') code = await runVerify(args);
  else { process.stderr.write(`unknown command: ${command}\n\n${USAGE}`); code = 2; }
  process.exitCode = code;
  return code;
}

module.exports = { main, capturePages, reconcile, archivedEvidence, captureCardState, readSelectedLabels, fixtureTransport, packageDigest, CATALOG_QUERY, WORKSPACE_QUERY, SELECTED_LABELS_QUERY };

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
