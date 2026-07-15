'use strict';

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function numericPick(value, keys) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of keys) {
    const item = value[key];
    if (Number.isFinite(item)) out[key] = item;
  }
  return out;
}

function booleanPick(value, keys) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of keys) {
    const item = value[key];
    if (typeof item === 'boolean') out[key] = item;
  }
  return out;
}

function writeCounts(writes) {
  const out = {};
  if (!writes || typeof writes !== 'object' || Array.isArray(writes)) return out;
  for (const target of ['clients', 'team_members', 'team_member_link_updates', 'batches', 'deliverables', 'linear_archive']) {
    const rows = writes[target];
    out[target] = Array.isArray(rows) ? rows.length : 0;
  }
  return out;
}

function allowedString(value, allowed) {
  const text = String(value == null ? '' : value);
  return allowed.includes(text) ? text : '';
}

function isoOrEmpty(value) {
  const text = String(value == null ? '' : value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) return '';
  return Number.isNaN(Date.parse(text)) ? '' : text;
}

/**
 * Build the only representation safe for a public GitHub Actions artifact.
 * Deliberately allowlists aggregate fields instead of recursively redacting:
 * nested rows can contain client slugs, titles, briefs, names, emails, phones,
 * raw Linear payloads, or future person fields unknown to this serializer.
 */
function publicB1Artifact(plan, applyResult, verification) {
  const authority = plan && plan.authority && typeof plan.authority === 'object'
    ? plan.authority
    : {};
  const authorityValue = authority.value && typeof authority.value === 'object'
    ? authority.value
    : {};
  const gated = plan && plan.gated && typeof plan.gated === 'object'
    ? plan.gated
    : {};
  const spotParity = verification && Array.isArray(verification.spot_parity)
    ? verification.spot_parity
    : [];

  return {
    schema_version: 1,
    generated_at: isoOrEmpty(plan && plan.generated_at),
    mode: allowedString(plan && plan.mode, ['incremental', 'apply', 'apply-reconciliation-only', 'plan']),
    window: {
      as_of: isoOrEmpty(plan && plan.as_of),
      changed_since: isoOrEmpty(plan && plan.changed_since),
      cutoff_months: finiteNumber(plan && plan.cutoff_months),
    },
    counts: {
      issue_count_total: finiteNumber(plan && plan.issue_count_total),
      changed_issue_count: finiteNumber(plan && plan.changed_issue_count),
      operational_count: finiteNumber(plan && plan.operational_count),
      soft_handled_count: finiteNumber(plan && plan.soft_handled_count),
      archive_count: finiteNumber(plan && plan.archive_count),
      linked_live_card_included: finiteNumber(plan && plan.linked_live_card_included),
    },
    authority: {
      video: allowedString(authorityValue.video, ['linear', 'syncview']),
      graphics: allowedString(authorityValue.graphics, ['linear', 'syncview']),
      source: allowedString(authority.source, ['live', 'last-known-good']),
      write_safe: authority.write_safe === true,
    },
    gated: {
      batch_write_candidates: finiteNumber(gated.batch_write_candidates),
      deliverable_write_candidates: finiteNumber(gated.deliverable_write_candidates),
      by_team: numericPick(gated.by_team, ['video', 'graphics']),
    },
    planned_write_counts: writeCounts(plan && plan.writes),
    existing_counts: numericPick(plan && plan.existing_counts, ['batches', 'deliverables', 'linear_archive', 'deliverable_events']),
    batch_shapes: numericPick(plan && plan.batch_shapes, ['total_batches', 'mirrored_pair_batches', 'video_only_batches', 'graphics_only_batches', 'mixed_or_null_team_batches']),
    event_source_counts: numericPick(plan && plan.event_source_counts, ['backfill', 'system', 'linear', 'reconcile', 'ui']),
    apply: numericPick(applyResult, ['inserted_clients', 'inserted_team_members', 'patched_team_members', 'batch_rpc_writes', 'deliverable_rpc_writes', 'archive_upserts', 'summary_event_written']),
    verification: verification ? {
      counts: numericPick(verification.counts, ['batches', 'deliverables', 'linear_archive', 'deliverable_events']),
      expected: numericPick(verification.expected, ['batches', 'deliverables', 'linear_archive']),
      event_source_counts: numericPick(verification.event_source_counts, ['backfill', 'system', 'linear', 'reconcile', 'ui']),
      all_events_backfill: verification.all_events_backfill === true,
      deliverables_with_backfill_event: finiteNumber(verification.deliverables_with_backfill_event),
      batches_with_backfill_event: finiteNumber(verification.batches_with_backfill_event),
      spot_parity_passed: finiteNumber(verification.spot_parity_passed),
      spot_parity_checked: spotParity.length,
      replay_verify: booleanPick(verification.replay_verify, ['deliverable_count_matches', 'batch_count_matches', 'archive_count_matches', 'event_coverage_matches']),
    } : null,
  };
}

module.exports = { publicB1Artifact };
