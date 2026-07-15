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
ok(DEPLOY_WORKFLOW.includes("supabase/functions/_shared/staff-role-auth.ts"),
  'changes to the shared role-key helper must trigger the dependent Edge Function deploy workflow');
ok(DEPLOY_WORKFLOW.includes("supabase/functions/key-verify/**"),
  'changes to key-verify must trigger its Edge Function deploy workflow');
const deployLoop = (DEPLOY_WORKFLOW.match(/for fn in ([^;]+); do/) || [])[1] || '';
ok(/(?:^|\s)key-verify(?:\s|$)/.test(deployLoop),
  'the shared auth deployment loop must deploy key-verify with its dependents');

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
