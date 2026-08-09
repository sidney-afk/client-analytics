'use strict';

/* Nightly wrapper: run the source-read-only full-roster audit, then publish a
 * public-safe aggregate telemetry event for the n8n pager. */

const fs = require('fs');
const path = require('path');
const { main: runReadOnlyAudit } = require('./b4-outbound-shadow-audit');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const PUBLIC_JSON = String(process.env.PRODUCTION_SHADOW_PUBLIC_JSON || '');

const n = value => Number(value || 0);

// Top 8 entries of a {reason: count} map, largest first. The keys are the
// classifier's fixed vocabulary, never row content.
function topReasons(map) {
  const entries = Object.entries(map && typeof map === 'object' ? map : {})
    .filter(([, count]) => Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 8);
  return Object.fromEntries(entries.map(([reason, count]) => [String(reason).slice(0, 80), Number(count)]));
}

function publicPayload(report) {
  const zero = report.zero_write_proof || {};
  const protectedFlagsUnchanged = zero.protected_flag_digest_unchanged === undefined
    ? zero.runtime_flag_digest_unchanged === true
    : zero.protected_flag_digest_unchanged === true;
  const queueStable = n(zero.outbox_total_before) === n(zero.outbox_total_after)
    && n(zero.outbox_high_water_before) === n(zero.outbox_high_water_after)
    && n(zero.pending_before) === n(zero.pending_after)
    && n(zero.real_written_before) === n(zero.real_written_after);
  const zeroWrite = protectedFlagsUnchanged
    && (zero.queue_stability_required === false || queueStable)
    && n(zero.linear_mutation_calls) === 0;
  const payload = {
    run_id: report.run_id,
    generated_at: report.generated_at,
    ok: n(report.divergences && report.divergences.unexpected) === 0
      && n(report.intended_writes && report.intended_writes.unexpected) === 0
      && n(report.repairs && report.repairs.unexpected) === 0
      && zeroWrite,
    roster_count: n(report.roster && report.roster.active_real_clients),
    entities_checked: n(report.coverage && report.coverage.entities_checked),
    unexpected_divergences: n(report.divergences && report.divergences.unexpected),
    unexpected_intents: n(report.intended_writes && report.intended_writes.unexpected),
    unexpected_repairs: n(report.repairs && report.repairs.unexpected),
    /*
     * WHY, not merely HOW MANY. The by-reason maps existed only in the CI
     * artifact (14-day retention, one click and a download away), so when this
     * lane sat at ~4,100 unexpected divergences for weeks, every reader of the
     * telemetry event — health checks, the pager, the 2026-08-08 audit — could
     * see the count and nobody could see that one reason accounted for nearly
     * all of it. Reason labels are fixed vocabulary from the classifier
     * (public-safe by construction: no client, row id, or payload content);
     * top 8 keeps the event bounded if a pathological run fans out.
     */
    unexpected_divergences_by_reason: topReasons(report.divergences && report.divergences.unexpected_by_reason),
    unexpected_divergence_sample: sampleRows(report.divergences && report.divergences.unexpected_sample),
    unexpected_intents_by_operation: topReasons(report.intended_writes && report.intended_writes.unexpected_by_operation),
    expected_divergences_by_reason: topReasons(report.divergences && report.divergences.expected_explainable_by_reason),
    tolerated_historical: n(report.tolerated_historical && report.tolerated_historical.total),
    zero_write_proof: zeroWrite,
    queue_stability_required: zero.queue_stability_required !== false,
    queue_stable: zero.queue_stable === undefined ? queueStable : zero.queue_stable === true,
    operational_controls_changed: zero.operational_controls_changed === true,
    by_team: report.by_team || {},
    private_artifact_sha256: report.private_artifact_sha256,
  };
  return payload;
}

// Bounded pass-through of the auditor's unexpected-row sample (hoisted —
// publicPayload above calls it). Every field is re-clamped here so a
// pathological upstream row cannot bloat the event: at most 20 rows, and ONLY
// entity/team/identifier/reasons survive — a row carrying anything else (a
// client slug, a field value) is stripped, not forwarded.
function sampleRows(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map(row => ({
    entity: String((row && row.entity) || '').slice(0, 20),
    team: String((row && row.team) || '').slice(0, 20),
    identifier: String((row && row.identifier) || '').slice(0, 40),
    reasons: (Array.isArray(row && row.reasons) ? row.reasons : [])
      .slice(0, 8).map(reason => String(reason).slice(0, 80)),
  }));
}

async function writeTelemetry(payload) {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const response = await fetch(`${SUPA_URL}/rest/v1/deliverable_events`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify([{
      client_slug: '_system',
      action: 'production_shadow_audit',
      source: 'system',
      payload,
    }]),
  });
  if (!response.ok) throw new Error(`shadow telemetry HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
}

async function main() {
  const report = await runReadOnlyAudit();
  const payload = publicPayload(report);
  if (PUBLIC_JSON) {
    const output = path.resolve(PUBLIC_JSON);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(payload, null, 2));
  }
  await writeTelemetry(payload);
  console.log(JSON.stringify({ telemetry: payload }, null, 2));
  if (!payload.ok) throw new Error('production shadow audit found unexpected data-integrity work');
  return payload;
}

module.exports = { publicPayload, writeTelemetry };

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
