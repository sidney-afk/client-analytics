'use strict';

/*
 * Staff role identity consolidation regression checks.
 *
 * Client Credentials, full onboarding, and filming-plan writes must reuse the
 * one verified roster identity. No surface may revive its former passphrase
 * prompt, and the UI role matrix must stay aligned with the Edge Functions.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function functionSource(name) {
  const start = INDEX.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const open = INDEX.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < INDEX.length; i++) {
    const ch = INDEX[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return INDEX.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const roleContext = vm.createContext({ identity: null });
roleContext._syncviewStaffIdentityForHeaders = () => roleContext.identity;
vm.runInContext(functionSource('_syncviewStaffRoleValue'), roleContext);
vm.runInContext(functionSource('_syncviewStaffCan'), roleContext);

const matrix = [
  { role: 'admin', credentials: true, onboarding: true },
  { role: 'smm', credentials: true, onboarding: false },
  { role: 'creative', credentials: false, onboarding: false },
  { role: 'editor', credentials: false, onboarding: false },
  { role: 'designer', credentials: false, onboarding: false },
];

for (const row of matrix) {
  roleContext.identity = { key: 'dummy-role-key', role: row.role, member: { id: 'dummy', name: 'Dummy Staff' } };
  ok(roleContext._syncviewStaffCan('credentials') === row.credentials, `${row.role} credentials access is ${row.credentials ? 'allowed' : 'denied'}`);
  ok(roleContext._syncviewStaffCan('onboarding') === row.onboarding, `${row.role} onboarding access is ${row.onboarding ? 'allowed' : 'denied'}`);
}
roleContext.identity = null;
ok(roleContext._syncviewStaffCan('credentials') === false, 'signed-out credentials access is denied');
ok(roleContext._syncviewStaffCan('onboarding') === false, 'signed-out onboarding access is denied');

const ensure = functionSource('_ccEnsureIdentity');
const api = functionSource('_ccApi');
const onboarding = functionSource('_obvFetchFull');
const filming = functionSource('_fpPostPlan');
const offer = functionSource('_syncviewOfferStaffSignIn');
const clearIdentity = functionSource('_syncviewStaffIdentityClear');
const storageChanged = functionSource('_syncviewStaffIdentityStorageChanged');
const openIdentity = functionSource('_syncviewOpenStaffIdentity');
const bootIdentity = functionSource('_syncviewStaffIdentityBoot');

ok(/_syncviewRequireStaffIdentity\('credentials'\)/.test(ensure), 'credentials reuse the verified staff identity');
ok(/actor:\s*\{\s*name:\s*ident\.member\.name,\s*role:\s*ident\.role\s*\}/.test(api), 'credential audit actor comes from the verified roster identity');
ok(/'X-Syncview-Key':\s*ident\.key/.test(api), 'credentials send the verified role key');
ok(/_syncviewStaffIdentityClear\(\)/.test(api) && /_syncviewOpenStaffIdentity\(\{ reason: 'expired' \}\)/.test(api), 'credential 401 clears and returns to the one staff sign-in');
ok(/_syncviewRequireStaffIdentity\('onboarding'\)/.test(onboarding), 'full onboarding reuses the verified admin identity');
ok(/headers:\s*\{\s*'X-Syncview-Key':\s*ident\.key\s*\}/.test(onboarding), 'full onboarding keeps its historical key-only CORS contract');
ok(/_syncviewStaffIdentityClear\(\)/.test(onboarding), 'full onboarding clears the global identity on 401');
ok(/_syncviewRequireStaffIdentity\('onboarding'\)/.test(filming), 'filming-plan writes reuse the verified admin identity');
ok(/'X-Syncview-Actor':\s*ident\.member\.name/.test(filming) && /'X-Syncview-Role':\s*ident\.role/.test(filming), 'filming-plan attribution comes from the verified identity');
ok(/_syncviewStaffIdentityClear\(\)/.test(filming), 'filming-plan 401 clears the global identity');
ok(/_syncviewOpenStaffIdentity\(\{ reason: 'required' \}\)/.test(offer), 'a signed-out gated action opens the global staff sign-in');
ok(/Sign out first to use another authorized account/.test(INDEX), 'wrong-role guidance uses sign out and never offers Switch user');
ok(/SYNCVIEW_STAFF_LEGACY_IDENTITY_KEYS/.test(clearIdentity) || /_syncviewStaffClearLegacyIdentityStorage\(\)/.test(clearIdentity), 'sign out and 401 clear the retired surface-specific stored keys');
for (const key of ['syncview_client_credentials_identity_v1', 'syncview_filming_plans_identity_v1']) {
  ok((INDEX.match(new RegExp(key, 'g')) || []).length === 1, `legacy storage key is retained only for explicit purge: ${key}`);
}
ok(/event\.key !== SYNCVIEW_STAFF_IDENTITY_KEY/.test(storageChanged)
  && /_syncviewStaffPurgeSensitiveState\(\)/.test(storageChanged)
  && /_syncviewStaffIdentityBoot\(\)/.test(storageChanged), 'cross-tab identity changes purge sensitive state and revalidate safely');
ok(/window\.addEventListener\('storage', _syncviewStaffIdentityStorageChanged\)/.test(INDEX), 'staff sign-out and identity changes synchronize across tabs');
ok(/_syncviewStaffBootPromise/.test(openIdentity) && /_afterBoot/.test(openIdentity), 'staff button waits for stored-identity boot verification before choosing form vs account');
ok(/_syncviewStaffIdentitySignature\(_syncviewStaffIdentityLoad\(\)\) !== currentSignature/.test(bootIdentity), 'stale boot responses cannot overwrite a newer cross-tab identity');
for (const [name, requestSource] of [['credentials', api], ['full onboarding', onboarding], ['filming plans', filming]]) {
  ok(/if \([a-z]+\.status === 401\) \{[\s\S]{0,260}_syncviewStaffIdentitySignature\(active\) !== _syncviewStaffIdentitySignature\(ident\)[\s\S]{0,180}_syncviewStaffIdentityClear\(\)/.test(requestSource),
    `${name} ignores a stale 401 instead of signing out a newer cross-tab identity`);
  ok(/_syncviewStaffIdentitySignature\(active\) !== _syncviewStaffIdentitySignature\(ident\)/.test(requestSource),
    `${name} response ownership includes the roster member, not only the shared role key`);
}

[
  '_ccPromptIdentity',
  '_fpIdentity',
  'Onboarding staff passphrase',
].forEach(token => ok(!INDEX.includes(token), `retired separate identity path is absent: ${token}`));

ok(!INDEX.includes('Switch user'), 'staff surfaces contain no Switch user action');
ok(/data-staff-capability="credentials"/.test(INDEX), 'credentials entry points carry a role capability gate');
ok(/data-staff-capability="onboarding"/.test(INDEX), 'onboarding write controls carry an admin capability gate');

if (failures) {
  console.error(`\n${failures} staff identity consolidation check(s) failed`);
  process.exit(1);
}
console.log('\nStaff identity consolidation checks passed');
