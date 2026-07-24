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
const {
  IMPORT_SCOPE_POLICY,
  SNAPSHOT_CONTRACT,
  planCardCommentImport,
} = require('./f42-card-comment-import');

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

// Under the linked-cohort scope the raw coverage also counts DEFERRED
// out-of-scope rows. Hashing it would make an edit to any unlinked card — of
// which there are thousands, none of them importable — refuse an otherwise
// identical apply, so the drift guard would never pass in production. Pin the
// manifest-certification FACT per surface instead: that the exporter's
// independently-produced manifest still matched what the planner read. Drift
// inside the cohort that will actually be written is already covered exactly by
// the per-import source fingerprints below, so nothing about the applied set
// escapes the guard.
function applyCoverageScope(plan) {
  const surfaces = plan && plan.coverage && plan.coverage.surfaces;
  if (!surfaces || typeof surfaces !== 'object' || Array.isArray(surfaces)) return null;
  const out = {};
  for (const surface of Object.keys(surfaces).sort()) {
    const row = surfaces[surface];
    out[surface] = {
      matches_manifest: !!(row && row.matches_manifest === true),
    };
  }
  return out;
}

// A deterministic fingerprint of exactly what would be applied: the ordered
// canonical identities, their source fingerprints, crosswalk targets, the
// declared import scope, and the per-surface manifest certification. Two runs
// over the same reviewed snapshot produce the same digest, so an operator can
// pin the reviewed plan and prove the applied set is byte-for-byte the approved
// one.
function planApplyDigest(plan) {
  return sha256({
    contract: plan && plan.contract || null,
    surface: plan && plan.surface || null,
    import_run_id: plan && plan.import_run_id || null,
    scope_policy: plan && plan.scope && plan.scope.policy || null,
    coverage_scope: applyCoverageScope(plan),
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
// two-surface snapshot, complete FOR ITS DECLARED SCOPE, free of blocking
// conflicts, and carrying at least one canonical import. Anything else is
// returned as blocking reasons — never a partial apply.
//
// `plan.conflicts` is the BLOCKING set and must be empty. `plan.deferrals` —
// out-of-scope rows whose card carries no native deliverable binding — is
// counted and reported but deliberately does not gate: those rows can never be
// imported by this run under any owner action, so blocking on them would only
// keep the linked cohort permanently unimportable. The scope policy is asserted
// explicitly so a plan produced under different (or unstated) scope semantics
// can never be applied by this runner.
function applyEligibility(plan) {
  const reasons = [];
  if (!plan || typeof plan !== 'object') {
    return { eligible: false, reasons: ['plan_missing'] };
  }
  if (plan.contract !== SNAPSHOT_CONTRACT) reasons.push('snapshot_contract_required');
  if (!plan.scope || plan.scope.policy !== IMPORT_SCOPE_POLICY) reasons.push('plan_scope_unrecognized');
  if (plan.complete !== true) reasons.push('plan_not_complete');
  if (!Array.isArray(plan.conflicts) || plan.conflicts.length !== 0) reasons.push('plan_has_conflicts');
  if (!Array.isArray(plan.deferrals)) reasons.push('plan_deferrals_unreported');
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
    // Per-row audience verification (not just counts): the persisted row's
    // audience must equal the planned audience. A server-side clamp or RPC bug
    // that flipped a client-visible row to internal (or the reverse) is a
    // silent visibility change and must fail the run loudly, before it is
    // called APPLIED. Verified whenever the RPC returns the row's audience.
    const expectedAudience = clean(item.comment && item.comment.audience);
    if (row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, 'audience')) {
      const appliedAudience = clean(row.audience);
      if (appliedAudience !== expectedAudience) {
        const error = new Error('apply_result_audience_mismatch');
        error.identity = item.identity;
        error.expected = expectedAudience;
        error.actual = appliedAudience;
        throw error;
      }
    }
    receipts.push({
      identity: item.identity,
      production_comment_id: productionId,
      native_comment_id: clean(item.link && item.link.native_comment_id),
      deliverable_id: clean(item.link && item.link.deliverable_id),
      component: clean(item.link && item.link.component),
      audience: expectedAudience,
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

// ---- Public-safe blocked-plan summary ---------------------------------------
//
// A blocked plan's conflict rows carry per-row evidence — card ids, native
// comment ids, client slugs, composite identities, source fingerprints — that
// must never reach a public Actions log. But an operator who cannot see WHY a
// plan is blocked cannot fix it, and the full result document is runner-local
// by design.
//
// The projection below is an ALLOWLIST, not a redaction pass: it reads only the
// planner's own fixed enums (`classification`, `surface`, `reason`, and the
// coverage field names) and emits those plus counts. Every other property on a
// conflict row is dropped here and is structurally unable to reach the render.

const PUBLIC_SURFACES = Object.freeze(['calendar', 'sxr']);

function publicSurface(value) {
  const surface = clean(value).toLowerCase();
  return PUBLIC_SURFACES.includes(surface) ? surface : 'unspecified';
}

// `reason` is a hardcoded planner slug (e.g. unparseable_timestamp,
// internal_reply_under_client_visible_root). `coverage_mismatch` carries no
// reason but does carry `fields`, whose entries are coverage field names
// (cards, comments.video, source_sha256) — enums, not data.
function publicReason(conflict) {
  const row = conflict && typeof conflict === 'object' ? conflict : {};
  const reason = clean(row.reason);
  if (reason) return reason;
  if (Array.isArray(row.fields) && row.fields.length) {
    return `fields:${row.fields.map(clean).filter(Boolean).sort().join(',')}`;
  }
  return 'unspecified';
}

// Tally an allowlisted conflict/deferral set into classification x surface x
// reason rows. Identical projection for both sets — only enum fields and counts.
function tallyRows(rows) {
  const tally = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const classification = clean(row && row.classification) || 'unclassified';
    const surface = publicSurface(row && row.surface);
    const reason = publicReason(row);
    const key = [classification, surface, reason].join('|');
    const existing = tally.get(key);
    if (existing) existing.count += 1;
    else tally.set(key, { classification, surface, reason, count: 1 });
  }
  return [...tally.values()].sort((a, b) =>
    b.count - a.count
    || a.classification.localeCompare(b.classification)
    || a.surface.localeCompare(b.surface)
    || a.reason.localeCompare(b.reason));
}

function conflictBreakdown(plan) {
  const doc = plan && typeof plan === 'object' ? plan : {};
  const conflicts = Array.isArray(doc.conflicts) ? doc.conflicts : [];
  const deferrals = Array.isArray(doc.deferrals) ? doc.deferrals : [];
  const imports = Array.isArray(doc.imports) ? doc.imports : [];

  const plannedBySurface = Object.fromEntries(PUBLIC_SURFACES.map(surface => [surface, 0]));
  for (const item of imports) {
    const surface = publicSurface(item && item.link && item.link.source_surface);
    if (Object.prototype.hasOwnProperty.call(plannedBySurface, surface)) plannedBySurface[surface] += 1;
  }

  const surfaces = doc.coverage && doc.coverage.surfaces && typeof doc.coverage.surfaces === 'object'
    ? doc.coverage.surfaces
    : {};
  let sourceRows = 0;
  for (const surface of PUBLIC_SURFACES) {
    const actual = surfaces[surface] && surfaces[surface].actual;
    const comments = actual && actual.comments && typeof actual.comments === 'object'
      ? actual.comments
      : {};
    for (const value of Object.values(comments)) {
      const count = Number(value);
      if (Number.isFinite(count)) sourceRows += count;
    }
  }

  return {
    scope_policy: clean(doc.scope && doc.scope.policy) || 'unspecified',
    total_conflicts: conflicts.length,
    total_deferred: deferrals.length,
    planned_imports: imports.length,
    planned_by_surface: plannedBySurface,
    source_comment_rows: sourceRows,
    // Raw source rows minus planned canonical imports. This covers deferred
    // out-of-scope rows, rows the planner blocked, AND the exact-duplicate
    // aliases (a card shape that lists the same comment under `comments` and
    // `video_comments`) that legitimately collapse into one canonical import.
    excluded_rows: Math.max(0, sourceRows - imports.length),
    by_classification: tallyRows(conflicts),
    // Out-of-scope, non-blocking. Same allowlisted projection as conflicts.
    deferred_by_classification: tallyRows(deferrals),
  };
}

// Render the step-summary markdown for a plan or apply result document. Only
// counts, status/gate slugs, the apply digest, and the allowlisted conflict
// enums are emitted — never receipts, identities, bodies, or slugs of clients.
function renderPlanSummaryMarkdown(result) {
  const doc = result && typeof result === 'object' ? result : {};
  const isApply = !!(doc.verification && typeof doc.verification === 'object');
  const status = clean(doc.status) || 'UNKNOWN';
  const lines = [`## F42 import — ${isApply ? 'APPLY' : 'PLAN'}`, '', `- status: ${status}`];

  if (isApply) {
    const checks = doc.verification.checks && typeof doc.verification.checks === 'object'
      ? doc.verification.checks
      : {};
    const mismatches = Array.isArray(doc.verification.mismatches) ? doc.verification.mismatches : [];
    lines.push(`- applied: ${Number(doc.applied_count || 0)}`);
    lines.push(`- apply digest: \`${clean(doc.apply_digest)}\``);
    lines.push(`- planned / applied / distinct: ${Number(checks.expected_imports || 0)} / ${Number(checks.applied_count || 0)} / ${Number(checks.unique_comment_count || 0)}`);
    lines.push(`- readback links / comments: ${Number(checks.card_link_count || 0)} / ${Number(checks.comment_count || 0)}`);
    if (mismatches.length) {
      lines.push(`- verification mismatches: ${mismatches.map(clean).filter(Boolean).sort().join(', ')}`);
    }
    lines.push('', 'Per-row receipts stay in the runner-local result document and are never uploaded.');
    return `${lines.join('\n')}\n`;
  }

  const breakdown = doc.conflict_breakdown && typeof doc.conflict_breakdown === 'object'
    ? doc.conflict_breakdown
    : conflictBreakdown({});
  const planned = breakdown.planned_by_surface && typeof breakdown.planned_by_surface === 'object'
    ? breakdown.planned_by_surface
    : {};
  const reasons = Array.isArray(doc.reasons) ? doc.reasons.map(clean).filter(Boolean) : [];

  lines.push(`- eligible: ${doc.eligible === true}`);
  lines.push(`- import scope: ${clean(breakdown.scope_policy) || 'unspecified'}`);
  if (reasons.length) lines.push(`- blocking gates: ${reasons.sort().join(', ')}`);
  lines.push(`- planned imports: ${Number(breakdown.planned_imports || 0)} `
    + `(calendar ${Number(planned.calendar || 0)}, sxr ${Number(planned.sxr || 0)})`);
  lines.push(`- deferred rows (out of scope, not imported): ${Number(breakdown.total_deferred || 0)}`);
  lines.push(`- source comment rows: ${Number(breakdown.source_comment_rows || 0)}`);
  lines.push(`- excluded rows: ${Number(breakdown.excluded_rows || 0)} `
    + '(deferred plus blocked rows plus collapsed exact-duplicate aliases)');
  lines.push(`- conflicts (blocking): ${Number(breakdown.total_conflicts || 0)}`);
  lines.push(`- apply digest: \`${clean(doc.apply_digest)}\``);

  const renderTable = (heading, rows) => {
    if (!Array.isArray(rows) || !rows.length) return;
    lines.push('', heading, '',
      '| Classification | Surface | Reason | Count |', '|---|---|---|---:|');
    for (const row of rows) {
      lines.push(`| \`${clean(row.classification)}\` | ${clean(row.surface)} | \`${clean(row.reason)}\` | ${Number(row.count || 0)} |`);
    }
  };
  renderTable('### Blocking reasons (classification enums and counts only)', breakdown.by_classification);
  renderTable('### Deferred — out of scope, NOT imported and not blocking',
    breakdown.deferred_by_classification);
  if ((Array.isArray(breakdown.by_classification) && breakdown.by_classification.length)
    || (Array.isArray(breakdown.deferred_by_classification) && breakdown.deferred_by_classification.length)) {
    lines.push('', 'Per-row evidence (card/comment identities, client slugs, bodies) stays in the '
      + 'runner-local result document and is never uploaded.');
  }
  if (status === 'READY') {
    lines.push('', 'Re-run this workflow with mode=apply, the same import_run_id, '
      + 'expected_apply_digest set to the digest above, and confirm=IMPORT_CARD_COMMENTS.');
  }
  return `${lines.join('\n')}\n`;
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
  // Drift guard for the split plan/apply dispatches: the apply run re-exports and
  // re-derives from live data, so if the source cards changed since the reviewed
  // plan, the digests differ and the apply is refused before any write.
  if (args['expect-apply-digest'] && clean(args['expect-apply-digest']) !== digest) {
    throw new Error('expected_apply_digest_mismatch');
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
      deferred: Array.isArray(plan.deferrals) ? plan.deferrals.length : 0,
      scope: plan.scope || null,
      // Public-safe aggregate: classification/surface/reason enums plus counts.
      // This is what a BLOCKED dispatch renders to the run summary, so an
      // operator can see why the plan is blocked without any identifier
      // reaching the log. The full conflict rows stay in this runner-local
      // document only.
      conflict_breakdown: conflictBreakdown(plan),
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
  IMPORT_SCOPE_POLICY,
  PUBLIC_SURFACES,
  applyCoverageScope,
  applyEligibility,
  applyImports,
  applyPlan,
  assertApplyEligible,
  conflictBreakdown,
  derivePlan,
  planApplyDigest,
  renderPlanSummaryMarkdown,
  run,
  supabaseDeps,
  verifyCounts,
};
