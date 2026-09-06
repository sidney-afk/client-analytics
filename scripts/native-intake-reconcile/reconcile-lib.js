'use strict';
/*
 * Native intake reconciliation driver: the part of the runner that decides
 * WHAT to call and in WHICH order. It owns no persistence, no transport and no
 * business rule. Every decision about a request (what is owed, what is safe to
 * write, what is a conflict) is made inside the SQL functions of
 * migrations/2026-09-05-native-intake-reconcile.sql under the request lock;
 * this module only pages the backlog, calls the two stages in order, and folds
 * the returned facts into one report.
 *
 * `rpc(name, args)` is injected: production uses the Supabase REST rpc endpoint
 * with the service role (run.js); the proof lane injects the same calls over
 * psql against the disposable database. Nothing else differs between the two.
 *
 * Dry-run is the default. With apply=false no function writes anything and no
 * reason event is recorded; the report is the plan.
 *
 * TWO REPORTS. `runReconcile` returns the FULL report: request ids, client
 * slugs, deliverable and card ids, every reason as the SQL returned it. That
 * report is for protected storage only (an operator's private file, never a
 * public log or a public Actions artifact). `publicReport` derives what may be
 * printed anywhere: aggregate counts, reason CODES from a fixed allowlist, and,
 * only when a private hash key is configured, a keyed correlation token per
 * request so two runs can be compared without naming the request.
 */
const crypto = require('crypto');

const STAGE_KEYS = Object.freeze({
  children: ['recovered', 'complete', 'conflict', 'unresolved', 'planned'],
  cards: ['materialized', 'complete', 'conflict', 'unresolved', 'planned'],
});

/* Every reason the SQL can return, plus the codes the reason-bounding function
   collapses PostgreSQL messages to. Anything else prints as `other`. */
const REASON_CODES = Object.freeze(new Set([
  'provider_epoch_child_missing', 'child_identity_conflict', 'child_receipt_without_row',
  'batch_missing', 'batch_not_active', 'client_inactive', 'parent_receipt_missing',
  'parent_receipt_provenance_mismatch', 'f27_hold', 'children_incomplete',
  'deliverable_card_cleared', 'deliverable_rebound', 'card_archived', 'card_slot_occupied',
  'card_deleted_after_creation', 'card_provenance_unavailable', 'card_creation_held', 'card_slot_cleared',
  'card_missing_under_lock', 'reconcile_child_identity_changed', 'reconcile_readback_mismatch',
  'authority_unavailable', 'team_is_linear_authoritative', 'legacy_parity_gate_unavailable',
  'legacy_parity_not_allowed', 'test_client_scope_required', 'idempotency_conflict',
  'write_conflict', 'idempotent_result_missing', 'project_mapping_missing', 'team_rollback_hold',
  'f27_authority_generation_stale', 'f27_drill_insert_forbidden', 'invalid_outbound_entity',
  'invalid_outbound_operation', 'incomplete_outbound_intent', 'invalid_f27_authority_binder',
  'production_deliverable_id_required', 'production_write_dedup_and_intent_fingerprint_required',
]));
const OUTCOMES = Object.freeze(new Set(['recovered', 'materialized', 'complete', 'conflict', 'unresolved', 'planned', 'skipped']));
const OWNERS = Object.freeze(new Set(['operator', 'reconciler', 'gateway-retry']));
const SURFACES = Object.freeze(new Set(['calendar', 'samples']));

function boundReason(reason) {
  const value = String(reason == null ? '' : reason);
  if (REASON_CODES.has(value)) return value;
  if (/^sql_error:[0-9A-Z]{5}$/.test(value)) return value;
  return 'other';
}
function boundOutcome(outcome) {
  const value = String(outcome == null ? '' : outcome);
  return OUTCOMES.has(value) ? value : 'other';
}
function boundOwner(owner) {
  const value = String(owner == null ? '' : owner);
  return OWNERS.has(value) ? value : 'other';
}
function boundSurface(surface) {
  const value = String(surface == null ? '' : surface);
  return SURFACES.has(value) ? value : 'other';
}
function count(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function emptyCounts() {
  const out = {};
  for (const [stage, keys] of Object.entries(STAGE_KEYS)) {
    out[stage] = Object.fromEntries(keys.map(key => [key, 0]));
    out[stage].calls = 0;
    out[stage].skipped = 0;
  }
  out.children.recovered_children = 0;
  out.cards.created_cards = 0;
  out.cards.bound_cards = 0;
  return out;
}

function tally(counts, stage, result) {
  counts[stage].calls += 1;
  const outcome = String(result && result.outcome || '');
  if (Object.prototype.hasOwnProperty.call(counts[stage], outcome)) counts[stage][outcome] += 1;
  if (stage === 'children') counts.children.recovered_children += Array.isArray(result.recovered) ? result.recovered.length : 0;
  if (stage === 'cards') {
    counts.cards.created_cards += Array.isArray(result.created) ? result.created.length : 0;
    counts.cards.bound_cards += Array.isArray(result.bound) ? result.bound.length : 0;
  }
}

/* Stage 2 is only asked when stage 1 left nothing missing for this request:
   'recovered' (it just wrote them) or 'complete' (they were already there).
   A conflict or an unresolved child makes the card question premature, and the
   SQL would answer children_incomplete anyway; not calling it keeps the reason
   ledger to one row per real decision. */
function cardsEligible(children) {
  return !!children && (children.outcome === 'recovered' || children.outcome === 'complete');
}

async function runReconcile(options) {
  const rpc = options.rpc;
  if (typeof rpc !== 'function') throw new Error('rpc transport required');
  const actor = String(options.actor || '').trim();
  if (!actor) throw new Error('actor required');
  const apply = options.apply === true;
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 25));
  const pageSize = Math.max(1, Math.min(500, Number(options.pageSize) || 50));
  const only = Array.isArray(options.requestIds) && options.requestIds.length ? new Set(options.requestIds.map(String)) : null;
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};

  const counts = emptyCounts();
  const processed = [];
  let after = null;
  let examined = 0;
  let exhausted = false;
  let pages = 0;
  while (!exhausted && processed.length < limit) {
    const page = await rpc('production_intake_reconcile_backlog', { p_limit: pageSize, p_after: after });
    pages += 1;
    examined += count(page && page.examined);
    for (const item of (page && page.items) || []) {
      if (processed.length >= limit) break;
      const requestId = String(item.request_id);
      if (only && !only.has(requestId)) continue;
      const entry = { request_id: requestId, client_slug: item.client_slug, surface: item.surface, owed: item.owed };
      entry.children = await rpc('production_intake_reconcile_children', { p_request_id: requestId, p_actor: actor, p_apply: apply });
      tally(counts, 'children', entry.children);
      onEvent('children', entry);
      if (cardsEligible(entry.children)) {
        entry.cards = await rpc('production_intake_reconcile_cards', { p_request_id: requestId, p_actor: actor, p_apply: apply });
        tally(counts, 'cards', entry.cards);
      } else {
        entry.cards = { stage: 'cards', request_id: requestId, applied: false, outcome: 'skipped', reason: 'children_incomplete' };
        counts.cards.skipped += 1;
      }
      onEvent('cards', entry);
      processed.push(entry);
    }
    after = (page && page.next_after) || after;
    exhausted = !!page && page.exhausted === true;
    if (!page || !page.items || !page.items.length) break;
  }
  const summary = await rpc('production_intake_reconcile_summary', {});
  return {
    dry_run: !apply,
    actor,
    limit,
    pages,
    examined,
    exhausted,
    processed,
    counts,
    summary,
    // Operators read these first. Anything conflicted or unresolved after an
    // apply run needs a human decision or a different owner (see the reason
    // ledger); a growing backlog age means the reconciler is not keeping up.
    attention: {
      conflicted: counts.children.conflict + counts.cards.conflict,
      unresolved: counts.children.unresolved + counts.cards.unresolved,
      backlog_age_seconds: count(summary && summary.backlog_age_seconds),
      missing_terminal_receipts: count(summary && summary.owed && summary.owed.missing_terminal_receipts),
    },
  };
}

/* Keyed, truncated, one-way. Without a key there is no per-request output at
   all; the request id is caller-supplied text and never leaves the private
   report. */
function correlation(requestId, hashKey) {
  if (!hashKey) return null;
  return crypto.createHmac('sha256', String(hashKey)).update(String(requestId)).digest('hex').slice(0, 12);
}

function reasonCodes(result) {
  const codes = [];
  for (const list of [result && result.unresolved, result && result.conflicts]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) codes.push({ reason: boundReason(entry && entry.reason), owner: boundOwner(entry && entry.owner) });
  }
  if (result && result.outcome === 'skipped') codes.push({ reason: boundReason(result.reason), owner: 'reconciler' });
  return codes;
}

function publicReport(report, options = {}) {
  const hashKey = options && options.hashKey ? String(options.hashKey) : '';
  const reasons = { children: {}, cards: {} };
  const requests = [];
  for (const entry of report.processed || []) {
    const row = { surface: boundSurface(entry.surface) };
    for (const stage of ['children', 'cards']) {
      const result = entry[stage] || {};
      row[stage] = boundOutcome(result.outcome);
      const codes = reasonCodes(result);
      row[stage + '_reasons'] = codes.map(c => c.reason);
      for (const code of codes) reasons[stage][code.reason] = (reasons[stage][code.reason] || 0) + 1;
    }
    if (hashKey) requests.push({ correlation: correlation(entry.request_id, hashKey), ...row });
  }
  const summary = report.summary || {};
  const owed = summary.owed || {};
  const latest = {};
  for (const [key, n] of Object.entries(summary.latest_outcomes || {})) {
    const [stage, outcome] = String(key).split(':');
    const label = (stage === 'children' || stage === 'cards' ? stage : 'other') + ':' + boundOutcome(outcome);
    latest[label] = (latest[label] || 0) + count(n);
  }
  return {
    dry_run: report.dry_run === true,
    limit: count(report.limit),
    pages: count(report.pages),
    examined: count(report.examined),
    exhausted: report.exhausted === true,
    processed_count: Array.isArray(report.processed) ? report.processed.length : 0,
    counts: report.counts,
    reasons,
    attention: report.attention,
    summary: {
      manifests: count(summary.manifests),
      requests_complete: count(summary.requests_complete),
      requests_owed: count(summary.requests_owed),
      owed: {
        children_native: count(owed.children_native), children_provider: count(owed.children_provider),
        cards: count(owed.cards), identity_conflicts: count(owed.identity_conflicts),
        missing_terminal_receipts: count(owed.missing_terminal_receipts),
      },
      backlog_age_seconds: count(summary.backlog_age_seconds),
      latest_outcomes: latest,
    },
    correlated: !!hashKey,
    ...(hashKey ? { requests } : {}),
  };
}

module.exports = {
  runReconcile, publicReport, boundReason, boundOutcome, boundOwner, correlation,
  cardsEligible, emptyCounts, STAGE_KEYS, REASON_CODES,
};
