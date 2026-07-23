'use strict';

/*
 * F200 audited-cohort attribution repair planner.
 *
 * This tool is offline and write-incapable. It consumes a private snapshot and
 * an owner-approved, snapshot-bound classification manifest, then emits exact
 * atomic deliverables CAS-patch descriptors for the existing reconciler lane.
 * It has no Supabase/Linear credentials, fetches, or mutation mode.
 */

const fs = require('fs');
const path = require('path');
const {
  ATTRIBUTION_SCHEMA,
  OWNER_MANIFEST_SCHEMA,
  buildProjectIndex,
  canonical,
  clean,
  issueId,
  parseJson,
  resolveAttributionGraph,
  sha256,
  stableJson,
  withAttribution,
} = require('./f200-attribution');

const ROOT = path.resolve(__dirname, '..');
const PLAN_SCHEMA = 'syncview_f200_attribution_repair_plan_v1';
const DEFAULT_EXPECTED_COUNT = 72;

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const current = String(argv[i]);
    if (!current.startsWith('--')) throw new Error(`unexpected argument: ${current}`);
    const inline = current.match(/^(--[^=]+)=(.*)$/);
    if (inline) {
      args.set(inline[1], inline[2]);
      continue;
    }
    const next = argv[i + 1];
    args.set(current, next && !String(next).startsWith('--') ? String(argv[++i]) : '1');
  }
  for (const forbidden of ['--apply', '--write', '--live']) {
    if (args.has(forbidden)) throw new Error('F200 attribution planner is offline and has no write mode');
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function insideRepository(file) {
  const target = path.resolve(file);
  const relative = path.relative(ROOT, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function writePrivatePlan(file, plan) {
  if (!file) return;
  if (insideRepository(file)) {
    throw new Error('private F200 repair plans must be written outside the repository');
  }
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(plan, null, 2));
}

function writePublicReport(file, report) {
  if (!file) return;
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
}

function snapshotRows(snapshot) {
  const rows = snapshot && (snapshot.deliverables || snapshot.rows);
  if (!Array.isArray(rows)) throw new Error('snapshot.deliverables must be an array');
  return rows;
}

function snapshotClients(snapshot) {
  const clients = snapshot && snapshot.clients;
  if (!Array.isArray(clients)) throw new Error('snapshot.clients must be an array');
  return clients;
}

function snapshotLinearIssues(snapshot) {
  const rows = snapshot && (snapshot.linear_issues || snapshot.linearIssues || []);
  if (!Array.isArray(rows)) throw new Error('snapshot.linear_issues must be an array');
  return rows;
}

function deliverableIssueId(row) {
  const raw = parseJson(row && row.linear_raw);
  return clean(row && row.linear_issue_uuid || raw.issue && raw.issue.id);
}

function cohortSnapshotHash(snapshot) {
  return sha256({
    schema: PLAN_SCHEMA,
    clients: snapshotClients(snapshot),
    deliverables: snapshotRows(snapshot),
    linear_issues: snapshotLinearIssues(snapshot),
    family_complete: snapshot && snapshot.family_complete === true,
  });
}

function mergedIssues(snapshot) {
  const byId = new Map();
  for (const row of snapshotRows(snapshot)) {
    const raw = parseJson(row.linear_raw);
    const stored = raw.issue && typeof raw.issue === 'object' ? raw.issue : {};
    const id = deliverableIssueId(row);
    if (!id) throw new Error(`deliverable ${clean(row.id) || '(missing id)'} has no Linear issue id`);
    byId.set(id, Object.assign({}, stored, { id }));
  }
  for (const issue of snapshotLinearIssues(snapshot)) {
    const id = issueId(issue);
    if (!id) throw new Error('snapshot Linear issue has no id');
    byId.set(id, Object.assign({}, byId.get(id) || {}, issue, { id }));
  }
  return [...byId.values()];
}

function validateManifest(manifest, snapshotHash, expectedCount, issueIds) {
  if (!manifest) return null;
  if (clean(manifest.schema) !== OWNER_MANIFEST_SCHEMA) {
    throw new Error(`owner manifest schema must be ${OWNER_MANIFEST_SCHEMA}`);
  }
  if (manifest.owner_approved !== true) throw new Error('owner manifest must set owner_approved=true');
  if (clean(manifest.snapshot_sha256) !== snapshotHash) {
    throw new Error('owner manifest snapshot_sha256 does not match this exact cohort snapshot');
  }
  if (Number(manifest.expected_count) !== expectedCount) {
    throw new Error(`owner manifest expected_count must be exactly ${expectedCount}`);
  }
  const rules = manifest.issues;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    throw new Error('owner manifest issues must be an object keyed by Linear issue id');
  }
  const manifestIds = Object.keys(rules).map(clean).filter(Boolean).sort();
  const scopedIds = [...issueIds].sort();
  if (manifestIds.length !== expectedCount
      || stableJson(manifestIds) !== stableJson(scopedIds)) {
    throw new Error('owner manifest issue scope must exactly equal the bounded cohort');
  }
  return manifest;
}

function currentAttribution(rawValue) {
  const raw = parseJson(rawValue);
  return raw.attribution && typeof raw.attribution === 'object' ? raw.attribution : null;
}

function manifestDecisionMode(rule) {
  if (typeof rule === 'string') return '';
  return clean(rule && (rule.classification || rule.resolution || rule.source)
    || '').toLowerCase();
}

function countBy(values, keyFn) {
  const out = {};
  for (const value of values) {
    const key = clean(keyFn(value)) || 'missing';
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function buildRepairPlan(snapshot, manifest, options = {}) {
  const expectedCount = Number(options.expectedCount == null
    ? DEFAULT_EXPECTED_COUNT
    : options.expectedCount);
  if (!Number.isSafeInteger(expectedCount) || expectedCount <= 0) {
    throw new Error('expectedCount must be a positive integer');
  }

  const rows = snapshotRows(snapshot);
  if (rows.length !== expectedCount) {
    throw new Error(`F200 cohort must contain exactly ${expectedCount} deliverables; got ${rows.length}`);
  }
  const rowIds = rows.map(row => clean(row.id));
  const issueIds = rows.map(deliverableIssueId);
  if (rowIds.some(id => !id) || new Set(rowIds).size !== expectedCount) {
    throw new Error('F200 cohort requires distinct non-empty deliverable ids');
  }
  if (issueIds.some(id => !id) || new Set(issueIds).size !== expectedCount) {
    throw new Error('F200 cohort requires distinct non-empty Linear issue ids');
  }
  const repairStates = new Set(['missing', 'needs_attribution', 'provisional_child_family', 'conflict']);
  for (const row of rows) {
    const beforeAttribution = currentAttribution(row.linear_raw);
    const beforeState = clean(beforeAttribution && beforeAttribution.state) || 'missing';
    if (clean(row.client_slug) !== 'unattributed' || !repairStates.has(beforeState)) {
      throw new Error('F200 source cohort must be the known unattributed repair cohort');
    }
  }

  const snapshotHash = cohortSnapshotHash(snapshot);
  const ownerManifest = validateManifest(
    manifest || null,
    snapshotHash,
    expectedCount,
    new Set(issueIds),
  );
  const clients = snapshotClients(snapshot);
  const projectIndex = buildProjectIndex(clients);
  const manifestSha = ownerManifest ? sha256(ownerManifest) : '';
  const resolutionManifest = ownerManifest ? Object.assign({}, ownerManifest, {
    manifest_sha256: manifestSha,
  }) : null;
  const graph = resolveAttributionGraph(mergedIssues(snapshot), clients, {
    projectIndex,
    explicitClassifications: resolutionManifest || {},
    familyComplete: snapshot.family_complete === true,
  });

  const payloads = [];
  const proofRows = [];
  for (const row of rows) {
    const linearIssueId = deliverableIssueId(row);
    const attribution = graph.byIssueId.get(linearIssueId);
    if (!attribution) throw new Error(`attribution graph omitted issue ${linearIssueId}`);
    if (ownerManifest) {
      const decision = ownerManifest.issues[linearIssueId];
      const mode = manifestDecisionMode(decision);
      const expectedSlug = clean(typeof decision === 'string' ? decision : decision && decision.client_slug);
      if (['mapped_project', 'direct_project'].includes(mode)) {
        if (!expectedSlug || attribution.state !== 'resolved'
            || attribution.source !== 'direct_project'
            || attribution.client_slug !== expectedSlug) {
          throw new Error(`owner manifest direct-project assertion failed for ${linearIssueId}`);
        }
      } else if (['mapped_ancestor', 'nearest_mapped_ancestor'].includes(mode)) {
        if (!expectedSlug || attribution.state !== 'resolved'
            || attribution.source !== 'nearest_mapped_ancestor'
            || attribution.client_slug !== expectedSlug) {
          throw new Error(`owner manifest ancestor assertion failed for ${linearIssueId}`);
        }
      } else {
        const owner = projectIndex.clientBySlug.get(expectedSlug);
        const expectedSource = owner && owner.kind === 'client'
          ? 'explicit_roster_classification'
          : 'explicit_internal_test_classification';
        if (attribution.state !== 'resolved'
            || attribution.source !== expectedSource
            || attribution.client_slug !== expectedSlug) {
          throw new Error(`owner manifest explicit roster classification failed for ${linearIssueId}`);
        }
        if (!clean(attribution.explicit_decision_ref)
            || clean(attribution.explicit_manifest_sha256) !== manifestSha
            || attribution.explicit_owner_approved !== true) {
          throw new Error(`owner manifest explicit classification lacks durable approval proof for ${linearIssueId}`);
        }
      }
    }
    const beforeRaw = parseJson(row.linear_raw);
    const afterRaw = withAttribution(beforeRaw, attribution);
    const targetClient = attribution.state === 'resolved' ? clean(attribution.client_slug) : '';
    const sourceIssue = mergedIssues(snapshot).find(issue => issueId(issue) === linearIssueId) || {};
    const patch = {
      client_slug: targetClient || clean(row.client_slug),
      linear_raw: afterRaw,
    };
    const precondition = {
      deliverable_id: clean(row.id),
      linear_issue_uuid: linearIssueId,
      client_slug: clean(row.client_slug),
      updated_at: clean(row.updated_at) || null,
      linear_raw_sha256: sha256(beforeRaw),
      linear_issue_sha256: sha256(sourceIssue),
    };
    const payload = {
      mutation: 'deliverables_cas_patch',
      table: 'deliverables',
      target_id: clean(row.id),
      patch,
      // Private plan proof only. The direct CAS patch is audited by the
      // existing deliverables ledger trigger; this object is not transmitted.
      repair_evidence: {
        source: 'reconcile',
        action: 'f200_attribution_repair',
        actor: 'f200-owner-approved-repair',
        payload: {
          finding: 'F200',
          linear_issue_uuid: linearIssueId,
          attribution_state: attribution.state,
          attribution_source: attribution.source,
          mapping_revision: attribution.mapping_revision,
          snapshot_sha256: snapshotHash,
        },
      },
      precondition,
    };
    payload.descriptor_sha256 = sha256(payload);
    payloads.push(payload);
    proofRows.push({
      deliverable_id: clean(row.id),
      linear_issue_uuid: linearIssueId,
      before_client_slug: clean(row.client_slug),
      before_attribution_state: clean(currentAttribution(beforeRaw) && currentAttribution(beforeRaw).state) || 'missing',
      after_client_slug: patch.client_slug,
      after_attribution_state: attribution.state,
      attribution_source: attribution.source,
      mapping_revision: attribution.mapping_revision,
      descriptor_sha256: payload.descriptor_sha256,
    });
  }

  payloads.sort((a, b) => a.precondition.deliverable_id.localeCompare(b.precondition.deliverable_id));
  proofRows.sort((a, b) => a.deliverable_id.localeCompare(b.deliverable_id));
  const resolvedCount = proofRows.filter(row => row.after_attribution_state === 'resolved'
    && row.after_client_slug).length;
  const complete = !!ownerManifest
    && resolvedCount === expectedCount
    && payloads.length === expectedCount;

  const plan = {
    schema: PLAN_SCHEMA,
    finding: 'F200',
    source_only: true,
    writes_executed: 0,
    expected_count: expectedCount,
    snapshot_sha256: snapshotHash,
    mapping_revision: projectIndex.mapping_revision,
    owner_manifest: ownerManifest ? {
      schema: ownerManifest.schema,
      owner_approved: true,
      decision_ref: clean(ownerManifest.decision_ref) || null,
      expected_count: Number(ownerManifest.expected_count),
      snapshot_sha256: clean(ownerManifest.snapshot_sha256),
      manifest_sha256: sha256(ownerManifest),
    } : null,
    before: {
      total: expectedCount,
      by_client_slug: countBy(rows, row => row.client_slug),
      by_attribution_state: countBy(rows, row => {
        const attribution = currentAttribution(row.linear_raw);
        return attribution && attribution.state || 'missing';
      }),
    },
    after: {
      total: expectedCount,
      by_client_slug: countBy(proofRows, row => row.after_client_slug),
      by_attribution_state: countBy(proofRows, row => row.after_attribution_state),
      by_source: countBy(proofRows, row => row.attribution_source),
    },
    proof: {
      complete,
      exact_input_count: rows.length === expectedCount,
      exact_owner_decision_count: !!ownerManifest
        && Object.keys(ownerManifest.issues || {}).length === expectedCount,
      exact_payload_count: payloads.length === expectedCount,
      source_cohort_is_unattributed_repair: rows.every(row => {
        const attribution = currentAttribution(row.linear_raw);
        const state = clean(attribution && attribution.state) || 'missing';
        return clean(row.client_slug) === 'unattributed' && repairStates.has(state);
      }),
      distinct_deliverable_ids: new Set(rowIds).size,
      distinct_linear_issue_ids: new Set(issueIds).size,
      resolved_count: resolvedCount,
      repair_required_count: proofRows.filter(row => row.after_attribution_state !== 'resolved').length,
      all_payloads_are_cas_patch: payloads.every(row => row.mutation === 'deliverables_cas_patch'
        && row.table === 'deliverables'),
      all_preconditions_bound: payloads.every(row => row.precondition.linear_raw_sha256
        && row.precondition.linear_issue_sha256
        && row.precondition.client_slug),
      no_client_inserts: true,
      no_name_or_title_inference: true,
    },
    payloads,
    rows: proofRows,
  };
  plan.plan_sha256 = sha256(Object.assign({}, plan, { plan_sha256: undefined }));
  return plan;
}

function publicReport(plan) {
  return {
    schema: PLAN_SCHEMA,
    finding: 'F200',
    source_only: true,
    writes_executed: 0,
    expected_count: plan.expected_count,
    snapshot_sha256: plan.snapshot_sha256,
    mapping_revision: plan.mapping_revision,
    owner_manifest_present: !!plan.owner_manifest,
    before: {
      total: plan.before.total,
      by_attribution_state: canonical(plan.before.by_attribution_state),
    },
    after: {
      total: plan.after.total,
      by_attribution_state: canonical(plan.after.by_attribution_state),
      by_source: canonical(plan.after.by_source),
    },
    proof: canonical(plan.proof),
    plan_sha256: plan.plan_sha256,
    safety: {
      supabase_mutations: 0,
      linear_mutations: 0,
      credentials_read: 0,
      private_rows_in_public_report: 0,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshotFile = clean(args.get('--snapshot'));
  if (!snapshotFile) throw new Error('--snapshot is required');
  const expectedCount = Number(args.get('--expected-count') || DEFAULT_EXPECTED_COUNT);
  const snapshot = readJson(snapshotFile);
  const manifestFile = clean(args.get('--owner-manifest'));
  const manifest = manifestFile ? readJson(manifestFile) : null;
  const plan = buildRepairPlan(snapshot, manifest, { expectedCount });
  const report = publicReport(plan);
  writePrivatePlan(clean(args.get('--private-plan')), plan);
  writePublicReport(clean(args.get('--public-json')), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (manifest && !plan.proof.complete) {
    throw new Error('owner-approved F200 plan is incomplete; refusing a repair artifact');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`F200 attribution plan failed: ${error && error.message || String(error)}`);
    process.exit(1);
  }
}

module.exports = {
  PLAN_SCHEMA,
  DEFAULT_EXPECTED_COUNT,
  parseArgs,
  snapshotRows,
  snapshotClients,
  snapshotLinearIssues,
  deliverableIssueId,
  cohortSnapshotHash,
  mergedIssues,
  validateManifest,
  buildRepairPlan,
  publicReport,
  writePrivatePlan,
};
