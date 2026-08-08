'use strict';
/*
 * The outbound drain's schedule must be able to actually execute, and owner
 * dispatch must still be gated.
 *
 * WHAT THIS FIXES (2026-08-07).
 *
 * The drain is the retry lane for Linear pushes that failed. It is scheduled
 * every 10 minutes and its job carried `environment: production`. The lane ran
 * normally until 2026-08-06T15:15Z; then approval requirements landed on that
 * environment, one run (31120080907) stuck at "waiting", and with
 * cancel-in-progress:false every later run queued behind it and was displaced
 * by its successor — zero executions from that moment until the stuck run was
 * cancelled on 2026-08-08. `failed_write_count=1` alerted hourly through
 * 2026-08-07 with nothing able to clear it. (An earlier version of this
 * header claimed the schedule had NEVER executed; the run history refutes
 * that, and the correction is kept here on purpose.)
 *
 * The gate was not protecting the write. A drained row is a write SyncView
 * already decided to send and already attempted; the drainer retries it. The
 * gate blocked recovery, not risk.
 *
 * The split shipped here is not invented for the occasion — it is the one
 * `dispatchEligibility` has always encoded: `schedule` is a first-class route
 * needing no attestation, `workflow_dispatch` requires the owner actor and a
 * matching secret. The evidence lane was written expecting the schedule to run.
 *
 * This suite pins BOTH halves, because dropping the gate everywhere would be a
 * real weakening and is the obvious way to "simplify" this later.
 */
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'linear-outbound-drain.yml');
const source = fs.readFileSync(WORKFLOW, 'utf8');
const evidence = fs.readFileSync(path.join(ROOT, 'scripts', 'graphics-f2-evidence.js'), 'utf8');

// --- 1. The gate is conditional, and conditional on the right thing ---------
const environmentLine = (source.match(/^\s*environment:.*$/m) || [''])[0];
ok(environmentLine.length > 0, 'the drain job still declares an environment');
ok(!/^\s*environment:\s*production\s*$/.test(environmentLine),
  'the gate is no longer unconditional — an unconditional gate plus required reviewers is what wedged the schedule on 2026-08-06');
/*
 * The condition is the ATTESTATION, not the event name.
 *
 * Gating on `event_name == 'workflow_dispatch'` reads correct and is wrong. The
 * live n8n pager's `Trigger Outbound Drainer` node dispatches this workflow
 * every 15 minutes THROUGH workflow_dispatch, carrying only `limit` and no
 * attestation. An event-name gate leaves that path exactly as stuck as before
 * and fixes only the cron — half a fix that looks whole. This assertion exists
 * so that regression cannot be reintroduced by someone "simplifying" the
 * expression back to the event name.
 */
ok(/inputs\.f2_owner_attestation != ''/.test(environmentLine)
  && /'production'/.test(environmentLine),
'the gate keys on the owner attestation input, so an automated workflow_dispatch is not caught by it');
ok(!/github\.event_name/.test(environmentLine),
  'the gate does NOT key on the event name — the n8n pager retries through workflow_dispatch');

/*
 * The expression must yield an EMPTY environment on the automated routes. A
 * typo that yields any other string names an environment that does not exist,
 * which fails the job outright rather than skipping the gate — the drain would
 * go from never-running to always-failing, and both look like "no retries".
 */
ok(/\|\|\s*''/.test(environmentLine),
  "the non-dispatch branch resolves to an empty environment, not to another environment name");

// --- 2. The schedule still exists and is still frequent ---------------------
ok(/cron:\s*"\*\/10 \* \* \* \*"/.test(source),
  'the 10-minute schedule is unchanged — the point was to let it run, not to slow it down');
ok(/repository_dispatch:/.test(source) && /types: \[syncview-linear-outbound-drain\]/.test(source),
  'the n8n repository_dispatch backstop is still wired');

// --- 3. The owner route keeps every one of its checks -----------------------
ok(/f2_owner_attestation:/.test(source),
  'owner dispatch still takes an attestation input');
ok(/GRAPHICS_F2_OWNER_DISPATCH_ATTESTATION: \$\{\{ secrets\.GRAPHICS_F2_OWNER_DISPATCH_ATTESTATION \}\}/.test(source),
  'the attestation secret is still supplied to the evidence step');

const eligibility = evidence.slice(evidence.indexOf('function dispatchEligibility'),
  evidence.indexOf('function dispatchEligibility') + 1400);
ok(/if \(event === 'schedule'\)/.test(eligibility) && /SCHEDULE_ROUTE/.test(eligibility),
  'a scheduled run is a first-class eligibility route needing no attestation (this predates the change)');
ok(/if \(event !== 'workflow_dispatch'\) throw new GateError\('drainer_dispatch_ineligible'\)/.test(eligibility),
  'any other event is still ineligible for the attested route');
ok(/actor !== OWNER_LOGIN \|\| triggeringActor !== OWNER_LOGIN/.test(eligibility)
  && /drainer_owner_attestation_missing/.test(eligibility)
  && /drainer_owner_attestation_rejected/.test(eligibility),
'owner dispatch still requires the owner actor AND a matching attestation — unchanged');

// --- 4. The write path itself is untouched ----------------------------------
// Loosening a gate must not quietly loosen what the job then does.
ok(/SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/.test(source),
  'the drainer still authenticates with the service-role secret');
ok(/test "\$\{\{ steps\.drainer\.outputs\.http_status \}\}" = "200"/.test(source)
  && /test "\$\(jq -r '\.ok'/.test(source),
'the run still fails unless the drainer returned 200 and ok:true');
ok(/concurrency:/.test(source) && /group: linear-outbound-drain/.test(source)
  && /cancel-in-progress: false/.test(source),
'one drain at a time is still enforced, so unblocking the schedule cannot stack overlapping drains');

if (failures) {
  console.error(`\n${failures} outbound drain schedule check(s) failed`);
  process.exit(1);
}
console.log('\nOutbound drain schedule execution checks passed');
