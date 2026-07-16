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
