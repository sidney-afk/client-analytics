#!/usr/bin/env node
'use strict';

// F42 card-comment APPLY runner — the reviewed release mechanism that was
// missing when Slice 4 was first attempted (its absence is why #928 reverted
// live client comments). It never plans on its own: it re-derives the plan from
// the exact owner-approved two-surface snapshot with the source-only planner
// (scripts/f42-card-comment-import.js), refuses anything that is not a complete,
// conflict-free, manifest-matched plan, and only then applies each canonical
// comment through the service-only `production_comment_card_import` RPC in the
// planner's topological (parents-before-children) order.
//
// The database layer is injected (deps.importOne / deps.readback) so the exact
// same apply logic drives Supabase's PostgREST rpc in production and a raw
// PostgreSQL connection in the disposable apply rehearsal
// (scripts/f42-apply-rehearsal.js). Without --apply the runner is source-only:
// it prints the eligibility verdict, the ordered apply set, and the plan's
// identity digest for owner review, and touches no database.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { planCardCommentImport, SNAPSHOT_CONTRACT } = require('./f42-card-comment-import');

const CONFIRM_ENV = 'F42_CONFIRM_CARD_COMMENT_IMPORT';
const CONFIRM_TOKEN = 'IMPORT_CARD_COMMENTS';
const BACKFILL_TAG = 'f42-card-thread';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value === undefined ? null : value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

// A deterministic fingerprint of exactly what would be applied: the ordered
// canonical identities, their source fingerprints, crosswalk targets, and the
// certified coverage. Two runs over the same reviewed snapshot produce the same
// digest, so an operator can pin the reviewed plan and prove the applied set is
// byte-for-byte the approved one.
function planApplyDigest(plan) {
  return sha256({
    contract: plan && plan.contract || null,
    surface: plan && plan.surface || null,
    import_run_id: plan && plan.import_run_id || null,
    coverage: plan && plan.coverage || null,
    imports: ((plan && plan.imports) || []).map(item => ({
      identity: item.identity,
      source_fingerprint: item.link && item.link.source_fingerprint,
      deliverable_id: item.link && item.link.deliverable_id,
      component: item.link && item.link.component,
      client_slug: item.link && item.link.client_slug,
      team: item.link && item.link.team,
      parent_id: item.comment && item.comment.parent_id,
      canonical_id: item.comment && item.comment.id,
    })),
  });
}

function derivePlan(snapshot, options = {}) {
  return planCardCommentImport(snapshot, {
    importRunId: options.importRunId,
    clientSlug: options.clientSlug,
  });
}

// The apply gate. A plan may only reach the RPC when it is a certified
// two-surface snapshot, complete, conflict-free, and carries at least one
// canonical import. Anything else is returned as blocking reasons — never a
// partial apply.
function applyEligibility(plan) {
  const reasons = [];
  if (!plan || typeof plan !== 'object') {
    return { eligible: false, reasons: ['plan_missing'] };
  }
  if (plan.contract !== SNAPSHOT_CONTRACT) reasons.push('snapshot_contract_required');
  if (plan.complete !== true) reasons.push('plan_not_complete');
  if (!Array.isArray(plan.conflicts) || plan.conflicts.length !== 0) reasons.push('plan_has_conflicts');
  if (!Array.isArray(plan.imports) || plan.imports.length === 0) reasons.push('plan_has_no_imports');
  return { eligible: reasons.length === 0, reasons };
}

function assertApplyEligible(plan) {
  const verdict = applyEligibility(plan);
  if (!verdict.eligible) {
    const error = new Error('apply_ineligible');
    error.reasons = verdict.reasons;
    throw error;
  }
  return true;
}

// Apply every canonical comment in the planner's order. importOne(link, comment,
// event) must return the persisted production_comments row. Each result is
// verified to carry the exact canonical id the planner derived, so a crosswalk
// or ordering drift fails loud instead of importing a mismatched row.
async function applyImports(plan, importOne) {
  assertApplyEligible(plan);
  if (typeof importOne !== 'function') throw new Error('importOne_required');
  const receipts = [];
  const seen = new Set();
  for (const item of plan.imports) {
    const expectedId = clean(item.comment && item.comment.id);
    const row = await importOne(item.link, item.comment, item.event);
    const productionId = clean(row && (row.id || row.production_comment_id));
    if (!productionId || productionId !== expectedId) {
      const error = new Error('apply_result_identity_mismatch');
      error.identity = item.identity;
      error.expected = expectedId;
      error.actual = productionId;
      throw error;
    }
    receipts.push({
      identity: item.identity,
      production_comment_id: productionId,
      native_comment_id: clean(item.link && item.link.native_comment_id),
      deliverable_id: clean(item.link && item.link.deliverable_id),
      component: clean(item.link && item.link.component),
    });
    seen.add(productionId);
  }
  return {
    applied_count: receipts.length,
    unique_comment_count: seen.size,
    receipts,
  };
}

// Exact-count verification. The planned canonical set, the applied receipts, the
// distinct canonical ids, and the independent DB readback (card-link and comment
// counts filtered to this backfill run) must all agree before an apply is called
// APPLIED. Any disagreement is a GAPS result the owner must reconcile.
function verifyCounts(plan, applyResult, readback = {}) {
  const expected = Array.isArray(plan.imports) ? plan.imports.length : 0;
  const applied = Number(applyResult && applyResult.applied_count);
  const unique = Number(applyResult && applyResult.unique_comment_count);
  const linkCount = Number(readback.card_link_count);
  const commentCount = Number(readback.comment_count);
  const checks = {
    expected_imports: expected,
    applied_count: applied,
    unique_comment_count: unique,
    card_link_count: Number.isFinite(linkCount) ? linkCount : null,
    comment_count: Number.isFinite(commentCount) ? commentCount : null,
  };
  const mismatches = [];
  if (applied !== expected) mismatches.push('applied_count');
  if (unique !== expected) mismatches.push('unique_comment_count');
  if (!Number.isFinite(linkCount) || linkCount !== expected) mismatches.push('card_link_count');
  if (!Number.isFinite(commentCount) || commentCount !== expected) mismatches.push('comment_count');
  return { ok: mismatches.length === 0, checks, mismatches };
}

// End-to-end apply orchestration shared by the CLI and the rehearsal: gate,
// apply in order, read back, verify. Returns a structured, source-safe result.
async function applyPlan(plan, deps = {}) {
  assertApplyEligible(plan);
  const applyResult = await applyImports(plan, deps.importOne);
  const readback = typeof deps.readback === 'function'
    ? await deps.readback(plan)
    : {};
  const verification = verifyCounts(plan, applyResult, readback);
  return {
    status: verification.ok ? 'APPLIED' : 'GAPS',
    import_run_id: plan.import_run_id,
    apply_digest: planApplyDigest(plan),
    applied_count: applyResult.applied_count,
    receipts: applyResult.receipts,
    verification,
  };
}

// ---- Supabase PostgREST database layer (production default) -----------------

async function supabaseRpc(config, name, body, fetchImpl) {
  const response = await fetchImpl(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`rpc_${name}_${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function supabaseDeps(config, fetchImpl) {
  return {
    async importOne(link, comment, event) {
      const row = await supabaseRpc(config, 'production_comment_card_import', {
        p_link: link,
        p_comment: comment,
        p_event: event || {},
      }, fetchImpl);
      // PostgREST returns the composite type as a single-row object.
      return Array.isArray(row) ? row[0] : row;
    },
    async readback() {
      const rows = await supabaseRpc(config, 'production_comment_card_import_counts', {
        p_backfill_tag: BACKFILL_TAG,
      }, fetchImpl);
      const summary = Array.isArray(rows) ? rows[0] : rows;
      return {
        card_link_count: Number(summary && summary.card_link_count),
        comment_count: Number(summary && summary.comment_count),
      };
    },
  };
}

// ---- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

function loadSnapshot(inputPath) {
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(String(inputPath)), 'utf8'));
  if (!snapshot || Array.isArray(snapshot) || clean(snapshot.contract) !== SNAPSHOT_CONTRACT) {
    throw new Error(`F42 apply requires ${SNAPSHOT_CONTRACT} with both Calendar and SXR surfaces`);
  }
  return snapshot;
}

async function run(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parseArgs(argv);
  if (!args.input) {
    throw new Error('usage: node scripts/f42-card-comment-apply.js --input snapshot.json --import-run-id <id> [--plan reviewed-plan.json] [--apply]');
  }
  const snapshot = loadSnapshot(args.input);
  const plan = derivePlan(snapshot, {
    importRunId: args['import-run-id'],
    clientSlug: args['client-slug'],
  });
  const digest = planApplyDigest(plan);
  const verdict = applyEligibility(plan);

  // Pin the reviewed plan: a re-derived plan whose apply digest differs from the
  // owner-reviewed plan is refused before any database work.
  if (args.plan) {
    const reviewed = JSON.parse(fs.readFileSync(path.resolve(String(args.plan)), 'utf8'));
    const reviewedDigest = planApplyDigest(reviewed);
    if (reviewedDigest !== digest) {
      throw new Error('reviewed_plan_digest_mismatch');
    }
  }

  if (!args.apply) {
    return {
      status: verdict.eligible ? 'READY' : 'BLOCKED',
      source_only: true,
      import_run_id: plan.import_run_id,
      apply_digest: digest,
      eligible: verdict.eligible,
      reasons: verdict.reasons,
      planned_imports: Array.isArray(plan.imports) ? plan.imports.length : 0,
      conflicts: Array.isArray(plan.conflicts) ? plan.conflicts.length : 0,
      coverage: plan.coverage,
    };
  }

  if (clean(env[CONFIRM_ENV]) !== CONFIRM_TOKEN) throw new Error('owner_confirmation_required');
  assertApplyEligible(plan);
  const url = clean(env.SUPABASE_URL);
  const serviceKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  const applyDeps = deps.importOne || deps.readback
    ? deps
    : (() => {
      if (!url || !serviceKey) throw new Error('supabase_configuration_required');
      const fetchImpl = deps.fetch || globalThis.fetch;
      if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
      return supabaseDeps({ url, serviceKey }, fetchImpl);
    })();
  return await applyPlan(plan, applyDeps);
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result && result.status === 'GAPS') process.exitCode = 2;
    if (result && result.status === 'BLOCKED') process.exitCode = 2;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAIL',
      code: clean(error && error.message) || 'unexpected_failure',
      reasons: error && error.reasons || undefined,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  BACKFILL_TAG,
  CONFIRM_ENV,
  CONFIRM_TOKEN,
  applyEligibility,
  applyImports,
  applyPlan,
  assertApplyEligible,
  derivePlan,
  planApplyDigest,
  run,
  supabaseDeps,
  verifyCounts,
};
