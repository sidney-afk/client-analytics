'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SHARED_PATH = path.join(ROOT, 'supabase/functions/_shared/staff-role-auth.ts');
const INDEX = read('index.html');
const CAPTURE = read('supabase/functions/onboarding-capture/index.ts');
const DEPLOY = read('.github/workflows/deploy-onboarding-edge-functions.yml');
const READERS = [
  'legacy-onboarding-list',
  'onboarding-list',
  'ai-onboarding-list',
].map(name => ({ name, source: read(`supabase/functions/${name}/index.ts`) }));

function ok(value, message) {
  if (!value) {
    console.error('FAIL onboarding-reader-auth:', message);
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

for (const { name, source } of READERS) {
  ok(source.includes('../_shared/staff-role-auth.ts'), `${name} must use the shared role-key gate`);
  ok(source.includes('x-syncview-key'), `${name} CORS must allow the staff key`);
  ok(/Deno\.env\.get\("ONBOARDING_STAFF_KEY"\) \|\| Deno\.env\.get\("CREDENTIALS_STAFF_KEY"\)/.test(source),
    `${name} must preserve onboarding-key precedence and credentials-key fallback`);
  ok(/authorizeStaffKey\(given, \["admin"\], \[legacyKey\]\)/.test(source),
    `${name} must allow only admin role keys plus the legacy fallback`);
  ok(/staffAuthFailureStatus\(auth\)/.test(source),
    `${name} must return 401 for unmatched keys and 403 for disallowed role keys`);
  ok(source.indexOf('authorizeStaffKey(given') < source.indexOf('createClient(Deno.env.get("SUPABASE_URL")'),
    `${name} must authenticate before constructing the service-role client`);
  ok(DEPLOY.includes(`supabase/functions/${name}/**`), `${name} must remain covered by deploy path filters`);
}

const deployLoop = (DEPLOY.match(/for fn in ([^;]+); do/) || [])[1] || '';
for (const { name } of READERS) {
  ok(new RegExp(`(?:^|\\s)${name}(?:\\s|$)`).test(deployLoop), `${name} must remain in the deploy loop`);
}

const listFetch = grabFunc('_obvFetchLists');
const standaloneMount = grabFunc('_obvMountStandalone');
ok(/_syncviewRequireStaffIdentity\('onboarding'\)/.test(listFetch),
  'all onboarding list reads must start from a verified admin staff identity');
ok(/headers: \{ 'X-Syncview-Key': ident\.key \}/.test(listFetch),
  'all onboarding list reads must send the verified role key in X-Syncview-Key');
ok(!/fetch\([^\n]*(?:ONBOARDING_LIST_URL|AI_ONBOARDING_LIST_URL|LEGACY_ONBOARDING_LIST_URL|ONBOARDING_FULL_URL)/.test(
  INDEX.replace(listFetch, '').replace(grabFunc('_obvFetchFull'), ''),
),
  'onboarding readers must not have a second unauthenticated fetch path');
ok(/_syncviewStaffIdentityBoot\(\)[\s\S]*_obvEnsureLoaded\(\)/.test(standaloneMount),
  'the isolated onboarding viewer must reverify its stored staff key before loading');

ok(!/\.select\s*\(/.test(CAPTURE), 'public onboarding-capture must never read stored submissions');
ok(/return json\(\{ ok: true, id, kind \}, 200\)/.test(CAPTURE),
  'onboarding-capture success must return only its receipt fields');
ok(!/return json\(\{[^}]*\b(?:email|phone|first|last|answers|payload)\b/i.test(CAPTURE),
  'onboarding-capture responses must not echo submitted or stored PII');

// Execute the production helper with dummy-only secrets for explicit deny and
// allow proofs without contacting live data or exposing a real role key.
const helperUrl = pathToFileURL(SHARED_PATH).href + '?onboarding-reader-auth';
const runner = `
  const { authorizeStaffKey, staffAuthFailureStatus } = await import(${JSON.stringify(helperUrl)});
  const secrets = {
    ROLE_KEY_ADMIN: 'dummy-admin',
    ROLE_KEY_SMM: 'dummy-smm',
    ROLE_KEY_CREATIVE: 'dummy-creative',
  };
  const getSecret = name => secrets[name];
  const check = key => {
    const auth = authorizeStaffKey(key, ['admin'], ['dummy-legacy'], getSecret);
    return { ...auth, status: auth.ok ? 200 : staffAuthFailureStatus(auth) };
  };
  process.stdout.write(JSON.stringify({
    admin: check('dummy-admin'),
    legacy: check('dummy-legacy'),
    smm: check('dummy-smm'),
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
ok(matrix.admin.ok && matrix.admin.status === 200 && matrix.admin.role === 'admin', 'admin allow path failed');
ok(matrix.legacy.ok && matrix.legacy.status === 200 && matrix.legacy.via === 'legacy', 'legacy allow path failed');
for (const role of ['smm', 'creative']) {
  ok(!matrix[role].ok && matrix[role].status === 403, `${role} role key must be forbidden`);
}
for (const invalid of ['wrong', 'empty']) {
  ok(!matrix[invalid].ok && matrix[invalid].status === 401, `${invalid} key must be unauthorized`);
}

console.log('Onboarding reader auth checks passed (admin/legacy allow; absent/wrong 401; SMM/creative 403; capture write-only)');
