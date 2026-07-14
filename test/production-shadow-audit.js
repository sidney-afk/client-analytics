'use strict';

const fs = require('fs');
const path = require('path');
const { publicPayload } = require('../scripts/production-shadow-audit');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const base = {
  run_id: 'fixture-shadow',
  generated_at: '2026-07-12T00:00:00.000Z',
  roster: { active_real_clients: 5 },
  coverage: { entities_checked: 12 },
  divergences: { unexpected: 0 },
  intended_writes: { unexpected: 0 },
  repairs: { unexpected: 0 },
  tolerated_historical: { total: 3 },
  by_team: { video: { entities_checked: 8 }, graphics: { entities_checked: 4 } },
  private_artifact_sha256: 'a'.repeat(64),
  zero_write_proof: {
    runtime_flag_digest_unchanged: true,
    outbox_total_before: 10,
    outbox_total_after: 10,
    outbox_high_water_before: 20,
    outbox_high_water_after: 20,
    pending_before: 2,
    pending_after: 2,
    real_written_before: 4,
    real_written_after: 4,
    linear_mutation_calls: 0,
  },
};
const green = publicPayload(base);
ok(green.ok === true && green.zero_write_proof === true, 'unchanged queues and zero unexpected work are green');
ok(green.roster_count === 5 && green.entities_checked === 12, 'public payload keeps aggregate coverage');
ok(!JSON.stringify(green).includes('client_slug'), 'public payload contains no client identities');

const changed = publicPayload({
  ...base,
  zero_write_proof: { ...base.zero_write_proof, outbox_high_water_after: 21 },
});
ok(changed.ok === false && changed.zero_write_proof === false, 'queue movement during the audit is red');
const liveMovement = publicPayload({
  ...base,
  zero_write_proof: {
    ...base.zero_write_proof,
    runtime_flag_digest_unchanged: false,
    protected_flag_digest_unchanged: true,
    operational_controls_changed: true,
    queue_stability_required: false,
    queue_stable: false,
    outbox_high_water_after: 21,
  },
});
ok(liveMovement.ok === true
  && liveMovement.zero_write_proof === true
  && liveMovement.queue_stability_required === false,
'legitimate live-team queue movement stays green while protected flags and zero-mutation proof hold');
const drift = publicPayload({ ...base, divergences: { unexpected: 1 } });
ok(drift.ok === false && drift.unexpected_divergences === 1, 'unexpected divergence is red');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'production-shadow-audit.yml'), 'utf8');
ok(/cron: '17 5 \* \* \*'/.test(workflow) && /workflow_dispatch:/.test(workflow), 'shadow audit has nightly and manual triggers');
ok(/runner\.temp.*production-shadow-private\.json/.test(workflow), 'row-level shadow evidence stays in runner-temporary storage');
ok(/path: artifacts\/production-shadow-audit\.json/.test(workflow) && !/path:.*runner\.temp/.test(workflow), 'only the public aggregate is uploaded');

if (failures) process.exit(1);
console.log('\nProduction shadow audit telemetry checks passed');
