'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SHARED_PATH = path.join(ROOT, 'supabase/functions/_shared/staff-role-auth.ts');
const SHARED = fs.readFileSync(SHARED_PATH, 'utf8');
const KEY_VERIFY = read('supabase/functions/key-verify/index.ts');
const CREDENTIALS = read('supabase/functions/client-credentials/index.ts');
const ONBOARDING_FULL = read('supabase/functions/onboarding-full/index.ts');
const FILMING_PLANS = read('supabase/functions/filming-plans/index.ts');
const DEPLOY_WORKFLOW = read('.github/workflows/deploy-onboarding-edge-functions.yml');
// Since 2026-10-16 merges deploy through deploy-edge-functions-on-merge.yml: a
// push to main that touches any function runs it, and the plan deploys every
// function it does not keep manual (scripts/ef-auto-deploy-plan.js).
const MERGE_LANE = read('.github/workflows/deploy-edge-functions-on-merge.yml');
const { MANUAL_ONLY: AUTO_MANUAL, F27_LANE: AUTO_F27 } = require('../scripts/ef-auto-deploy-plan');
const autoDeploys = slug => /^  push:\n    branches: \[main\]\n    paths:\n(?:      - '[^']+'\n)*      - 'supabase\/functions\/\*\*'/m.test(MERGE_LANE)
  && !AUTO_MANUAL[slug] && !AUTO_F27.includes(slug);

function ok(value, message) {
  if (!value) {
    console.error('FAIL staff-sensitive-surface-auth:', message);
    process.exit(1);
  }
}

[
  'ROLE_KEY_ADMIN',
  'ROLE_KEY_SMM',
  'ROLE_KEY_CREATIVE',
  'timingSafeEqual',
  'matchingRoleForKey',
  'authorizeStaffKey',
  'staffAuthFailureStatus',
].forEach(token => ok(SHARED.includes(token), `shared role-key helper missing ${token}`));
// The merge lane counts a change to any imported file (scripts/ef-deploy-manifest.js
// import walk), so a change to this helper deploys every function that imports it.
ok(autoDeploys('onboarding-list') && require('../scripts/ef-deploy-manifest').functionDependencies('onboarding-list').shared.includes('_shared/staff-role-auth.ts'),
  'changes to the shared role-key helper must trigger the dependent Edge Function deploy workflow');
ok(autoDeploys('key-verify'),
  'changes to key-verify must trigger its Edge Function deploy on merge');
// Since 2026-10-16 this lane is the manual fallback: it has no push trigger, so
// nothing it deploys (above all production-write) can ship on a merge from here.
ok(!/^  push:/m.test(DEPLOY_WORKFLOW) && /^  workflow_dispatch:/m.test(DEPLOY_WORKFLOW),
  'the staff-sensitive lane is dispatch-only');
// Owner request 2026-10-16 (session Conveyor): every function deploys on merge
// except the Section 4 three (their own lane, with the sealed capture) and the
// frozen and retired ones. notify and client-review-link therefore deploy on
// merge now, through the plan's safeguards: notify only after the Linear-exit
// SQL preflight and before production-write.
{
  const plan = require('../scripts/ef-auto-deploy-plan');
  ok(plan.F27_LANE.includes('production-write') && plan.MANUAL_ONLY['linear-outbound'],
    'production-write and linear-outbound are never deployed by the merge lane');
  ok((plan.PRECONDITIONS.notify || []).includes('linear-exit-sql-preflight')
    && plan.ORDER.some(([a, b]) => a === 'notify' && b === 'production-write'),
    'notify deploys on merge only after the Linear-exit preflight, and before the write gateway');
}

const deployLoops = Array.from(DEPLOY_WORKFLOW.matchAll(/for fn in ([^;]+); do/g), match => match[1]);
ok(deployLoops.length === 2, 'safe and pinned functions must use separate deploy loops');
const safeLoop = deployLoops[0] || '';
const pinnedLoop = deployLoops[1] || '';
ok(safeLoop === 'onboarding-list ai-onboarding-list legacy-onboarding-list onboarding-full client-credentials filming-plans smm-weekly-reports key-verify',
  'push-safe deploy loop must retain the current main function list exactly');
ok(/(?:^|\s)key-verify(?:\s|$)/.test(safeLoop),
  'the shared auth deployment loop must deploy key-verify with its dependents');
ok(pinnedLoop === 'notify production-write production-comments production-archive',
  'manual pinned deploy runs the notification sender before the write gateway and comment/archive readers');

const pinnedStepAt = DEPLOY_WORKFLOW.indexOf('- name: Deploy pinned Track-B write/read functions');
const pinnedStep = pinnedStepAt >= 0 ? DEPLOY_WORKFLOW.slice(pinnedStepAt) : '';
ok(pinnedStepAt >= 0 && /if: github\.event_name == 'workflow_dispatch'/.test(pinnedStep),
  'the high-risk write-path deploy step must be workflow_dispatch-only');
ok(!DEPLOY_WORKFLOW.includes('client-review-link'),
  'unchanged live-v2 client-review-link must not be redeployed by this workflow');
ok(/commit_sha:[\s\S]{0,180}required: true/.test(DEPLOY_WORKFLOW)
  && /ref: \$\{\{ env\.DEPLOY_COMMIT \}\}/.test(DEPLOY_WORKFLOW)
  && /\^\[0-9a-f\]\{40\}\$/.test(DEPLOY_WORKFLOW)
  && /git merge-base --is-ancestor "\$DEPLOY_COMMIT" origin\/main/.test(DEPLOY_WORKFLOW)
  && /github\.event_name == 'workflow_dispatch' && inputs\.commit_sha \|\| github\.sha/.test(DEPLOY_WORKFLOW),
  'manual deploys require an exact 40-character commit already on main');

ok(/import \{ matchingRoleForKey, type StaffRoleKey \} from "\.\.\/_shared\/staff-role-auth\.ts"/.test(KEY_VERIFY),
  'key-verify must use the same shared secret-to-role resolver as sensitive surfaces');
ok(/const role = matchingRoleForKey\(key\)/.test(KEY_VERIFY),
  'key-verify must resolve the verified role from the shared key matcher');
ok(/return member\.role === "editor" \|\| member\.role === "designer"/.test(KEY_VERIFY),
  'key-verify must keep editor and designer members represented by the creative role key');

ok(/authorizeStaffKey\(supplied, \["admin", "smm"\], \[kOnb, kStaff\]\)/.test(CREDENTIALS),
  'client-credentials must allow admin+smm role keys and both historical secrets');
ok(/staffAuthFailureStatus\(auth\)/.test(CREDENTIALS),
  'client-credentials must distinguish a forbidden role from an unmatched key');
ok(CREDENTIALS.indexOf('authorizeStaffKey(supplied') < CREDENTIALS.indexOf('JSON.parse(await req.text())'),
  'client-credentials must authenticate the secret-derived role before parsing actor metadata');
ok(/if \(auth\.via === "role" && auth\.role\) actor\.role = auth\.role/.test(CREDENTIALS),
  'client-credentials audit role must use the secret-derived role on role-key requests');

ok(/authorizeStaffKey\(given, \["admin"\], \[legacyKey\]\)/.test(ONBOARDING_FULL),
  'onboarding-full must allow only the admin role key plus its historical fallback');
ok(/staffAuthFailureStatus\(auth\)/.test(ONBOARDING_FULL),
  'onboarding-full must distinguish a forbidden role from an unmatched key');
ok(/Deno\.env\.get\("ONBOARDING_STAFF_KEY"\) \|\| Deno\.env\.get\("CREDENTIALS_STAFF_KEY"\)/.test(ONBOARDING_FULL),
  'onboarding-full must preserve onboarding-key precedence and credentials-key fallback');

const filmingAuth = FILMING_PLANS.slice(
  FILMING_PLANS.indexOf('function requireOnboardingKey'),
  FILMING_PLANS.indexOf('function serialize'),
);
ok(/authorizeStaffKey\(supplied, \["admin"\], \[legacyKey\]\)/.test(filmingAuth),
  'filming-plans writes must allow only the admin role key plus ONBOARDING_STAFF_KEY');
ok(/authorizeStaffKey\(supplied, \["admin", "smm", "creative"\], \[legacyKey\]\)/.test(filmingAuth),
  'filming-plans reads must allow every verified staff role plus ONBOARDING_STAFF_KEY');
ok(/staffAuthFailureStatus\(auth\)/.test(filmingAuth),
  'filming-plans must distinguish a forbidden role from an unmatched key');
ok(/Deno\.env\.get\("ONBOARDING_STAFF_KEY"\)/.test(filmingAuth)
  && !/Deno\.env\.get\("CREDENTIALS_STAFF_KEY"\)/.test(filmingAuth),
  'filming-plans must preserve its exact onboarding-only legacy path');

for (const [name, source] of [
  ['client-credentials', CREDENTIALS],
  ['onboarding-full', ONBOARDING_FULL],
  ['filming-plans auth', filmingAuth],
]) {
  ok(!/req\.headers\.get\(["']x-syncview-role["']\)/i.test(source),
    `${name} must not trust a spoofable role header for authorization`);
}

// Execute the actual shared TypeScript helper with dummy-only secrets. Node's
// type-stripping flag lets this offline source suite test the production helper
// directly without copying its authorization logic into the test.
const helperUrl = pathToFileURL(SHARED_PATH).href + '?staff-auth-matrix';
const runner = `
  const { authorizeStaffKey, staffAuthFailureStatus } = await import(${JSON.stringify(helperUrl)});
  const roleSecrets = {
    ROLE_KEY_ADMIN: 'dummy-role-admin',
    ROLE_KEY_SMM: 'dummy-role-smm',
    ROLE_KEY_CREATIVE: 'dummy-role-creative',
  };
  const getRoleSecret = name => roleSecrets[name];
  const noRoleSecrets = () => undefined;
  const people = [
    ['admin', 'admin'],
    ['smm', 'smm'],
    ['creative', 'creative'],
    ['editor', 'creative'],
    ['designer', 'creative'],
  ];
  const keys = {
    admin: roleSecrets.ROLE_KEY_ADMIN,
    smm: roleSecrets.ROLE_KEY_SMM,
    creative: roleSecrets.ROLE_KEY_CREATIVE,
  };
  const surfaces = {
    credentials: ['admin', 'smm'],
    onboardingFull: ['admin'],
    filmingPlansRead: ['admin', 'smm', 'creative'],
    filmingPlansWrite: ['admin'],
  };
  const results = { matrix: {}, legacy: {}, spoof: {}, collision: {}, invalid: {} };

  for (const [surface, allowed] of Object.entries(surfaces)) {
    results.matrix[surface] = {};
    for (const [personRole, keyRole] of people) {
      results.matrix[surface][personRole] = authorizeStaffKey(
        keys[keyRole], allowed, [], getRoleSecret,
      );
    }
    results.invalid[surface] = {
      wrong: authorizeStaffKey('dummy-wrong', allowed, [], getRoleSecret),
      empty: authorizeStaffKey('', allowed, [], getRoleSecret),
    };
  }

  results.legacy.credentialsKey = authorizeStaffKey(
    'dummy-credentials-legacy', surfaces.credentials,
    ['dummy-onboarding-legacy', 'dummy-credentials-legacy'], noRoleSecrets,
  );
  results.legacy.credentialsOnboardingKey = authorizeStaffKey(
    'dummy-onboarding-legacy', surfaces.credentials,
    ['dummy-onboarding-legacy', 'dummy-credentials-legacy'], noRoleSecrets,
  );
  results.legacy.onboardingDedicated = authorizeStaffKey(
    'dummy-onboarding-legacy', surfaces.onboardingFull,
    ['dummy-onboarding-legacy'], noRoleSecrets,
  );
  results.legacy.onboardingCredentialsRejectedWhenDedicated = authorizeStaffKey(
    'dummy-credentials-legacy', surfaces.onboardingFull,
    ['dummy-onboarding-legacy'], noRoleSecrets,
  );
  results.legacy.onboardingCredentialsFallback = authorizeStaffKey(
    'dummy-credentials-legacy', surfaces.onboardingFull,
    ['dummy-credentials-legacy'], noRoleSecrets,
  );
  results.legacy.filmingOnboardingKey = authorizeStaffKey(
    'dummy-onboarding-legacy', surfaces.filmingPlansWrite,
    ['dummy-onboarding-legacy'], noRoleSecrets,
  );
  results.legacy.filmingCredentialsKey = authorizeStaffKey(
    'dummy-credentials-legacy', surfaces.filmingPlansWrite,
    ['dummy-onboarding-legacy'], noRoleSecrets,
  );

  // A caller may claim admin in X-Syncview-Role, but the helper receives only
  // the supplied key and therefore retains the key's real SMM/creative role.
  results.spoof.smmClaimingAdmin = authorizeStaffKey(
    keys.smm, surfaces.onboardingFull, [], getRoleSecret,
  );
  results.spoof.editorClaimingAdmin = authorizeStaffKey(
    keys.creative, surfaces.credentials, [], getRoleSecret,
  );
  results.collision.creativeCannotMasqueradeAsLegacy = authorizeStaffKey(
    keys.creative, surfaces.credentials, [keys.creative], getRoleSecret,
  );

  results.status = {
    credentialsCreative: staffAuthFailureStatus(results.matrix.credentials.creative),
    onboardingSmm: staffAuthFailureStatus(results.matrix.onboardingFull.smm),
    onboardingCreative: staffAuthFailureStatus(results.matrix.onboardingFull.creative),
    filmingSmm: staffAuthFailureStatus(results.matrix.filmingPlansWrite.smm),
    invalidCredentials: staffAuthFailureStatus(results.invalid.credentials.wrong),
    invalidOnboarding: staffAuthFailureStatus(results.invalid.onboardingFull.wrong),
    invalidFilmingRead: staffAuthFailureStatus(results.invalid.filmingPlansRead.wrong),
    invalidFilming: staffAuthFailureStatus(results.invalid.filmingPlansWrite.wrong),
  };

  process.stdout.write(JSON.stringify(results));
`;
const child = spawnSync(process.execPath, [
  '--no-warnings',
  '--experimental-strip-types',
  '--input-type=module',
  '--eval',
  runner,
], { encoding: 'utf8' });
ok(child.status === 0, `could not execute shared helper: ${child.stderr || child.stdout}`);

let results;
try { results = JSON.parse(child.stdout); }
catch (error) { ok(false, `shared helper returned invalid test output: ${error.message}`); }

const expected = {
  credentials: { admin: true, smm: true, creative: false, editor: false, designer: false },
  onboardingFull: { admin: true, smm: false, creative: false, editor: false, designer: false },
  filmingPlansRead: { admin: true, smm: true, creative: true, editor: true, designer: true },
  filmingPlansWrite: { admin: true, smm: false, creative: false, editor: false, designer: false },
};
for (const [surface, roles] of Object.entries(expected)) {
  for (const [personRole, allowed] of Object.entries(roles)) {
    const actual = results.matrix[surface][personRole];
    const keyRole = (personRole === 'editor' || personRole === 'designer') ? 'creative' : personRole;
    ok(actual.ok === allowed, `${surface} ${personRole} allow/deny mismatch`);
    ok(actual.role === keyRole, `${surface} ${personRole} must retain secret-derived ${keyRole} role`);
    ok(actual.via === 'role', `${surface} ${personRole} must be classified through the role-key path`);
  }
  ok(results.invalid[surface].wrong.ok === false && results.invalid[surface].wrong.role === null,
    `${surface} must reject a wrong key`);
  ok(results.invalid[surface].empty.ok === false && results.invalid[surface].empty.role === null,
    `${surface} must reject an empty key`);
}

for (const name of [
  'credentialsKey',
  'credentialsOnboardingKey',
  'onboardingDedicated',
  'onboardingCredentialsFallback',
  'filmingOnboardingKey',
]) {
  ok(results.legacy[name].ok === true && results.legacy[name].via === 'legacy',
    `${name} must remain authorized in a legacy-only deployment`);
}
ok(results.legacy.onboardingCredentialsRejectedWhenDedicated.ok === false,
  'onboarding-full must preserve dedicated onboarding-key precedence over credentials fallback');
ok(results.legacy.filmingCredentialsKey.ok === false,
  'filming-plans must not expand legacy access to CREDENTIALS_STAFF_KEY');
ok(results.spoof.smmClaimingAdmin.ok === false && results.spoof.smmClaimingAdmin.role === 'smm',
  'an SMM key cannot become admin by spoofing X-Syncview-Role');
ok(results.spoof.editorClaimingAdmin.ok === false && results.spoof.editorClaimingAdmin.role === 'creative',
  'an editor/designer creative key cannot become admin by spoofing X-Syncview-Role');
ok(results.collision.creativeCannotMasqueradeAsLegacy.ok === false
  && results.collision.creativeCannotMasqueradeAsLegacy.role === 'creative'
  && results.collision.creativeCannotMasqueradeAsLegacy.via === 'role',
  'a configured role key must not bypass its deny matrix by matching a legacy secret');
for (const name of ['credentialsCreative', 'onboardingSmm', 'onboardingCreative', 'filmingSmm']) {
  ok(results.status[name] === 403, `${name} must return forbidden without invalidating the signed-in role key`);
}
for (const name of ['invalidCredentials', 'invalidOnboarding', 'invalidFilmingRead', 'invalidFilming']) {
  ok(results.status[name] === 401, `${name} must return unauthorized for an unmatched key`);
}

console.log('Staff sensitive-surface auth matrix checks passed (admin, smm, creative/editor/designer + legacy paths)');
