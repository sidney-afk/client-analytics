'use strict';

const fs = require('fs');
const path = require('path');
const {
  TEST_CLIENT,
  TEST_PROJECT_NAMES,
  deterministicCreateId,
  statusSlug,
  stateForSlug,
  assertTestIssue,
  scenarioPlan,
} = require('../scripts/b4-linear-outbound-harness');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'b4-linear-outbound-harness.js'), 'utf8');
const outbound = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'linear-outbound', 'index.ts'), 'utf8');
const inbound = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'linear-inbound', 'index.ts'), 'utf8');

ok(TEST_CLIENT === 'sidneylaruel', 'live harness is pinned to the TEST client');
ok(TEST_PROJECT_NAMES.video === 'Sidney Laruel' && TEST_PROJECT_NAMES.graphics === 'Test Project',
  'both team-specific TEST projects are pinned');

const id1 = deterministicCreateId('fixture:create:1');
const id2 = deterministicCreateId('fixture:create:1');
ok(id1 === id2 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id1),
  'native-create UUID is deterministic and Linear-valid version-4 shaped');
ok(deterministicCreateId('fixture:create:2') !== id1, 'different dedup keys get different Linear ids');

ok(statusSlug('For SMM approval') === 'smm_approval', 'SMM state maps to the canonical slug');
ok(statusSlug('Tweak Needed ') === 'tweak', 'trailing-space tweak state maps canonically');
ok(stateForSlug({ states: { nodes: [{ id: 's1', name: 'For Client Approval' }] } }, 'client_approval').id === 's1',
  'team state lookup tolerates the team-specific client-approval casing');

const projects = new Map([['project_test', 'Sidney Laruel']]);
ok(assertTestIssue({ identifier: 'VID-1', project: { id: 'project_test', name: 'Sidney Laruel' } }, projects),
  'VID issue in the pinned TEST project passes the guard');
let rejected = false;
try {
  assertTestIssue({ identifier: 'VID-1', project: { id: 'project_real', name: 'Other' } }, projects);
} catch (_) {
  rejected = true;
}
ok(rejected, 'issue outside the TEST project allowlist is rejected');

const scenarios = scenarioPlan();
for (const name of [
  'create_shadow', 'create_live', 'status_ladder', 'comment', 'due_set_clear',
  'assignee_set_clear', 'title', 'archive_restore', 'pause_linear_newer_wins',
  'kill_switch_off', 'echo_drop', 'two_way_reconcile', 'final_reconcile', 'cleanup_archive',
]) {
  ok(scenarios.includes(name), 'scenario matrix includes ' + name);
}

ok(/B4_CONFIRM_TEST_MUTATIONS === '1'/.test(source), 'live mutations require explicit confirmation');
ok(/client\.kind === 'test'/.test(source) && /client\.active === true/.test(source),
  'live preflight requires an active TEST client');
ok(/assertTestIssue\(before, this\.projects\)/.test(source),
  'every direct Linear edit re-checks TEST project scope');
ok(/new Set\(\['title', 'dueDate', 'assigneeId', 'stateId', 'priority', 'parentId'\]\)/.test(source),
  'direct TEST edits use a closed field allowlist');
ok(!/syncview_runtime_flags[^\n]*(POST|PATCH|DELETE)|rest\([^\n]*syncview_runtime_flags[^\n]*method/.test(source),
  'harness only reads runtime flags');
ok(!/mirror_outbox[^\n]*(POST|PATCH|DELETE)|rest\([^\n]*mirror_outbox[^\n]*method/.test(source),
  'harness never writes mirror_outbox directly');
ok(/functions\/v1\/\$\{name\}/.test(source) && /deliverable-write/.test(source) && /batch-write/.test(source),
  'TEST writes go through the guarded HTTP write endpoints');
ok(/test_override: true/.test(source) && /confirm: 'B4_TEST_ONLY'/.test(source),
  'all local TEST writes carry the fail-closed override confirmation');
ok(/comments: JSON\.stringify\(localComments\)/.test(source)
  && /comment was not committed to the SyncView thread before mirroring/.test(source),
  'comment scenario proves the local thread is committed before Linear reflection');
ok(/spawnSync[^]*linear-deliverables-reconcile\.js/.test(source),
  'harness finishes with the real reconciler v2');

ok(/checkpointLinearResult/.test(outbound) && /await checkpointLinearResult\(supabase, row, linearResult\)/.test(outbound),
  'drainer checkpoints every acknowledged mutation before finalization');
ok(/B4_TEST_PROJECT_IDS/.test(outbound) && /kind !== "test"/.test(outbound),
  'drainer TEST override requires both a private project allowlist and test client kind');
ok(/\.in\("status", \["pending", "shadow_ok", "written", "failed"\]\)/.test(inbound),
  'inbound echo matching covers the acknowledgement/finalization race');
ok(/updateLinearFieldClocks/.test(inbound) && /field_updated_at/.test(inbound),
  'inbound records per-field Linear timestamps for pause/resume conflict checks');

if (failures) {
  console.error(`\n${failures} B4 outbound harness check(s) failed`);
  process.exit(1);
}
console.log('\nB4 outbound harness offline checks passed');
