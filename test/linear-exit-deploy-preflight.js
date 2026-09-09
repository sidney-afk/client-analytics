'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CONTRACT, PreflightError, contractQuery, expectedObjects, readContract, validateRows,
} = require('../scripts/linear-exit-deploy-preflight');

const ROOT = path.resolve(__dirname, '..');
const checks = [];
function ok(label, value) {
  assert.ok(value, label);
  checks.push(label);
  console.log('  ok  ' + label);
}

function rows() {
  return expectedObjects().keys.map(object_key => ({ object_key, present: true, compatible: true }));
}
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
async function rejectsCode(run, code) {
  let caught;
  try { await run(); } catch (error) { caught = error; }
  return caught instanceof PreflightError && caught.code === code;
}

(async () => {
  const query = contractQuery();
  ok('the contract is a single read-only catalog statement',
    /^with expected_routine/.test(query) && !query.includes(';')
      && !/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/i.test(query));
  ok('the contract binds the final named/native append body and durable receipt triggers',
    query.includes('production_intake_append(text,timestamptz,jsonb,jsonb)')
      && query.includes('zz_native_intake_delete_guard')
      && query.includes('zzz_native_assignment_receipt_guard')
      && query.includes('zzz_native_label_receipt_guard'));
  ok('a missing one-team config member is false rather than ignored as SQL NULL',
    (query.match(/bool_and\(coalesce\(/g) || []).length === 3
      && (query.match(/unnest\(array\['video','graphics'\]\) team/g) || []).length === 3);
  ok('trigger compatibility binds timing, event set, row/statement scope and an unqualified predicate',
    query.includes("t.tgtype=e.tgtype and t.tgqual is null")
      && query.includes("'zz_native_intake_receipt_guard','production_native_intake_receipt_guard',23")
      && query.includes("'zz_native_intake_truncate_guard','production_native_intake_truncate_guard',34"));

  ok('an absent required object fails closed', await rejectsCode(async () => {
    const fixture = rows(); fixture[0].present = false; fixture[0].compatible = false;
    validateRows(fixture);
  }, 'CONTRACT_ABSENT'));

  ok('a present but source/ACL/config mismatch fails closed', await rejectsCode(async () => {
    const fixture = rows(); fixture[0].compatible = false;
    validateRows(fixture);
  }, 'CONTRACT_MISMATCH'));

  const calls = [];
  const token = 'private-fixture-token';
  const success = await readContract({ token, projectRef: 'a'.repeat(20), fetchImpl: async (url, init) => {
    calls.push({ url, init }); return response(200, rows());
  } });
  ok('a complete compatible read returns the bounded public-safe receipt',
    success.status === 'PASS' && success.contract === CONTRACT && success.read_only === true
      && success.checked_objects === rows().length
      && !JSON.stringify(success).includes(token));
  ok('live mode uses one redirect-refusing Management API catalog request',
    calls.length === 1 && calls[0].init.method === 'POST' && calls[0].init.redirect === 'error'
      && calls[0].url.endsWith('/database/query')
      && JSON.parse(calls[0].init.body).query === query);

  ok('a management authorization failure is reported without retrying or exposing its body',
    await rejectsCode(() => readContract({ token, projectRef: 'a'.repeat(20),
      fetchImpl: async () => response(403, { message: token }) }), 'READ_FAILED_HTTP_403'));

  const onboarding = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-onboarding-edge-functions.yml'), 'utf8');
  const f27 = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-f27-section4-closures.yml'), 'utf8');
  const onboardingGate = onboarding.indexOf('node scripts/linear-exit-deploy-preflight.js');
  const onboardingFirstDeploy = onboarding.indexOf('supabase functions deploy');
  ok('manual onboarding gates SQL before the first of its 12 function deployments',
    onboardingGate > 0 && onboardingGate < onboardingFirstDeploy
      && onboarding.includes('Fingerprint scope: 12 functions deployed by this workflow'));
  const f27Gate = f27.indexOf('node scripts/linear-exit-deploy-preflight.js');
  const f27FirstDeploy = f27.indexOf('supabase functions deploy linear-outbound');
  ok('F27 Section 4 gates SQL before its first forward deployment', f27Gate > 0 && f27Gate < f27FirstDeploy);
  const f27GateStep = f27.slice(f27.lastIndexOf('- name:', f27Gate), f27.indexOf('\n      - name:', f27Gate));
  ok('the F27 SQL gate is forward-only, leaving captured old-source restore independent',
    /inputs\.operation == 'deploy-reviewed-release'/.test(f27GateStep)
      && !/restore-captured-prior-four/.test(f27GateStep));

  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, contract: CONTRACT }));
})().catch(error => { console.error(error); process.exit(1); });
