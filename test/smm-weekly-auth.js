'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SHARED_PATH = path.join(ROOT, 'supabase/functions/_shared/staff-role-auth.ts');
const WEEKLY = read('supabase/functions/smm-weekly-reports/index.ts');
const INDEX = read('index.html');
const DEPLOY = read('.github/workflows/deploy-onboarding-edge-functions.yml');

function ok(value, message) {
  if (!value) {
    console.error('FAIL smm-weekly-auth:', message);
    process.exit(1);
  }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let i = INDEX.indexOf('{', at); i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}' && --depth === 0) return INDEX.slice(at, i + 1);
  }
  throw new Error('unbalanced function: ' + name);
}

ok(WEEKLY.includes('../_shared/staff-role-auth.ts'), 'weekly gateway must use the shared role-key gate');
ok(WEEKLY.includes('x-syncview-key'), 'weekly gateway CORS must allow the staff key');
ok(/\[Deno\.env\.get\("ONBOARDING_STAFF_KEY"\), Deno\.env\.get\("CREDENTIALS_STAFF_KEY"\)\]/.test(WEEKLY),
  'weekly gateway must accept both configured legacy staff secrets for human and scheduler compatibility');
ok(/authorizeStaffKey\(given, \["admin", "smm"\], legacyKeys\)/.test(WEEKLY),
  'weekly submit/options must require an admin/SMM role key or a configured legacy staff key');
ok(/staffAuthFailureStatus\(auth\)/.test(WEEKLY),
  'weekly gateway must return 401 for unmatched keys and 403 for disallowed role keys');
ok((WEEKLY.match(/if \(auth\.role && auth\.role !== "admin"\) return json\(\{ ok: false, error: "forbidden" \}, 403\);/g) || []).length === 2,
  'report-text reads and sync_managers must both reject a valid non-admin role key');

const handler = WEEKLY.slice(WEEKLY.indexOf('Deno.serve'));
ok(handler.indexOf('authorizeStaffKey(given') < handler.indexOf('await req.json()'),
  'weekly gateway must authenticate before parsing a POST body');
ok(handler.indexOf('authorizeStaffKey(given') < handler.indexOf('return await loadOptions()'),
  'weekly gateway must authenticate before any service-role-backed action');

const api = grabFunc('_srpApi');
ok(/_syncviewRequireStaffIdentity\(capability\)/.test(api),
  'weekly browser calls must obtain a verified staff identity first');
ok(/headers\['X-Syncview-Key'\] = ident\.key/.test(api),
  'weekly browser calls must send only the verified stored role key');
ok(/action === 'reports' \|\| action === 'sync_managers'[\s\S]*'weekly-report-manage'[\s\S]*'weekly-report-submit'/.test(api),
  'weekly browser calls must select the admin-only capability for privileged actions');

const staffCan = grabFunc('_syncviewStaffCan');
ok(/capability === 'weekly-report-submit'\) return role === 'admin' \|\| role === 'smm'/.test(staffCan),
  'weekly submit UI must allow verified admin and SMM roles');
ok(/capability === 'weekly-report-manage'\) return role === 'admin'/.test(staffCan),
  'weekly report-text UI must allow only a verified admin role');
const eligible = grabFunc('_syncviewStaffEligible');
ok(!eligible.includes('_isSmmWeeklyEntry') && !eligible.includes('_isOnboardingView'),
  'isolated weekly/onboarding staff routes must be able to open verified staff sign-in');

ok(DEPLOY.includes("supabase/functions/smm-weekly-reports/**"),
  'weekly gateway changes must trigger the Edge Function deploy workflow');
const deployLoop = (DEPLOY.match(/for fn in ([^;]+); do/) || [])[1] || '';
ok(/(?:^|\s)smm-weekly-reports(?:\s|$)/.test(deployLoop),
  'weekly gateway must remain in the deploy loop when shared auth changes');

const helperUrl = pathToFileURL(SHARED_PATH).href + '?smm-weekly-auth';
const runner = `
  const { authorizeStaffKey, staffAuthFailureStatus } = await import(${JSON.stringify(helperUrl)});
  const secrets = {
    ROLE_KEY_ADMIN: 'dummy-admin',
    ROLE_KEY_SMM: 'dummy-smm',
    ROLE_KEY_CREATIVE: 'dummy-creative',
  };
  const getSecret = name => secrets[name];
  const check = key => {
    const auth = authorizeStaffKey(key, ['admin', 'smm'], ['dummy-onboarding', 'dummy-credentials'], getSecret);
    return { ...auth, status: auth.ok ? 200 : staffAuthFailureStatus(auth) };
  };
  process.stdout.write(JSON.stringify({
    admin: check('dummy-admin'),
    smm: check('dummy-smm'),
    onboardingLegacy: check('dummy-onboarding'),
    credentialsLegacy: check('dummy-credentials'),
    creative: check('dummy-creative'),
    wrong: check('dummy-wrong'),
    empty: check(''),
  }));
`;
const child = spawnSync(process.execPath, [
  '--no-warnings',
  '--experimental-strip-types',
  '--input-type=module',
  '--eval',
  runner,
], { encoding: 'utf8' });
ok(child.status === 0, `could not execute shared helper: ${child.stderr || child.stdout}`);
const matrix = JSON.parse(child.stdout);
for (const allowed of ['admin', 'smm', 'onboardingLegacy', 'credentialsLegacy']) {
  ok(matrix[allowed].ok && matrix[allowed].status === 200, `${allowed} weekly allow path failed`);
}
ok(matrix.admin.role === 'admin' && matrix.smm.role === 'smm'
  && matrix.onboardingLegacy.role === null && matrix.credentialsLegacy.role === null,
  'admin-only action guard must distinguish admin, SMM, and both legacy service callers');
ok(!matrix.creative.ok && matrix.creative.status === 403,
  'creative role key must be forbidden without being misclassified as unauthenticated');
for (const invalid of ['wrong', 'empty']) {
  ok(!matrix[invalid].ok && matrix[invalid].status === 401, `${invalid} key must be unauthorized`);
}

console.log('SMM weekly auth checks passed (admin/SMM/two legacy keys allow; absent/wrong 401; creative 403; reads/sync admin-only)');
