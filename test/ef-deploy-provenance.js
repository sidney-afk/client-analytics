'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  closureFingerprint,
  dispositionValue,
  multipartBoundary,
  normalizeLivePath,
  parseMultipart,
} = require('../scripts/ef-fingerprint.js');

const ROOT = path.resolve(__dirname, '..');
const fingerprintSource = fs.readFileSync(path.join(ROOT, 'scripts', 'ef-fingerprint.js'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-onboarding-edge-functions.yml'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'EF_DEPLOY_MANIFEST.md'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}

function throws(fn) {
  try { fn(); } catch (_) { return true; }
  return false;
}

ok(normalizeLivePath('functions/pto/index.ts', 'pto', 'functions/pto/index.ts') === 'functions/pto/index.ts'
  && normalizeLivePath('linear-outbound/mapping.mjs', 'linear-outbound', 'linear-outbound/index.ts') === 'functions/linear-outbound/mapping.mjs'
  && normalizeLivePath('source/index.ts', 'onboarding-capture', 'source/index.ts') === 'functions/onboarding-capture/index.ts'
  && normalizeLivePath('index.ts', 'fixture', 'index.ts') === 'functions/fixture/index.ts',
'live source paths normalize across modern, slug-root, legacy-root, and plain multipart layouts');
ok(throws(() => normalizeLivePath('../outside.ts', 'fixture', 'fixture/index.ts'))
  && throws(() => normalizeLivePath('/absolute.ts', 'fixture', 'fixture/index.ts'))
  && throws(() => normalizeLivePath('unknown/index.ts', 'fixture', 'fixture/index.ts')),
'live source path normalization rejects traversal, absolute, and unmapped files');

const boundary = 'syncview-fingerprint-fixture';
const multipart = Buffer.from([
  `--${boundary}\r\n`,
  'Content-Disposition: form-data; name="metadata"\r\n\r\n',
  '{"deno2_entrypoint_path":"source/index.ts"}',
  `\r\n--${boundary}\r\n`,
  'Content-Disposition: form-data; name="index.ts"; filename="index.ts"\r\n',
  'Supabase-Path: source/index.ts\r\n',
  'Content-Type: text/plain\r\n\r\n',
  `const embedded = "\r\n--${boundary}-not-a-delimiter";\n`,
  `\r\n--${boundary}--\r\n`,
].join(''), 'utf8');
const parts = parseMultipart(multipart, multipartBoundary(`multipart/form-data; boundary="${boundary}"`));
ok(parts.length === 2
  && parts[1].headers.get('supabase-path') === 'source/index.ts'
  && parts[1].body.toString('utf8').includes('-not-a-delimiter'),
'multipart parser preserves source bytes/headers and ignores boundary prefixes inside a file');
ok(dispositionValue(parts[1].headers.get('content-disposition'), 'name') === 'index.ts'
  && dispositionValue(parts[1].headers.get('content-disposition'), 'filename') === 'index.ts',
'multipart parser supports official source parts whose field name is the filename');

const lf = new Map([['functions/example/index.ts', Buffer.from('one\ntwo\n')]]);
const crlf = new Map([['functions/example/index.ts', Buffer.from('one\r\ntwo\r\n')]]);
ok(closureFingerprint(lf) !== closureFingerprint(crlf),
'source fingerprints retain exact deployed bytes instead of hiding line-ending drift');

ok(/method:\s*['"]GET['"]/.test(fingerprintSource)
  && !/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/.test(fingerprintSource)
  && fingerprintSource.includes("const API_ORIGIN = 'https://api.supabase.com'")
  && fingerprintSource.includes("redirect: 'error'"),
'fingerprint readback is pinned to redirect-free GET requests on the official Management API');

// The attestation is gated on validation + deploy success, NOT always(): an
// attestation must never be produced for a run whose ancestry or deploy failed.
const attestBlock = workflow.slice(workflow.indexOf('- name: Attest pinned manual release'));
ok(/- name: Attest pinned manual release\n\s*# [\s\S]*?\n\s*if: github\.event_name == 'workflow_dispatch'/.test(attestBlock)
  && !/if: always\(\)/.test(workflow)
  && workflow.includes('Fingerprint scope: 12 functions deployed by this workflow')
  && workflow.includes('Drill outcome: \\`PENDING\\`')
  && workflow.includes('--format=markdown | tee -a "$GITHUB_STEP_SUMMARY"'),
'the attestation is gated on success (never always()) and appends a scoped public-safe fingerprint + drill placeholder');

const providerAt = workflow.indexOf('for fn in linear-outbound production-write production-comments production-archive');
const attestationAt = workflow.indexOf('- name: Attest pinned manual release');
const attestorPreflightAt = workflow.indexOf('node scripts/ef-fingerprint.js "$DEPLOY_COMMIT" --expected-only');
ok(attestorPreflightAt >= 0 && attestorPreflightAt < providerAt
  && providerAt >= 0 && attestationAt > providerAt,
'attestor readiness fails before mutation and live fingerprints follow the gateway-before-readers deployment step');

// Finding P0 #1 — a dispatched ref can neither execute code nor read a secret
// before main-ancestry validation passes: the ancestry check comes first (from
// the trusted default branch), the token never lives at job scope, and each
// deploy/attestation step scopes it itself.
const validateAt = workflow.indexOf('Validate the dispatched commit is on main');
const ancestryAt = workflow.indexOf('git merge-base --is-ancestor "$DEPLOY_COMMIT" origin/main');
const validatedCheckoutAt = workflow.indexOf('Check out the validated deploy commit');
const jobEnvAt = workflow.indexOf('    env:\n      PROJECT_REF:');
ok(validateAt >= 0 && ancestryAt >= 0 && validatedCheckoutAt >= 0
  && ancestryAt < validatedCheckoutAt
  && /Check out the trusted default branch for validation\n\s*uses: actions\/checkout@v4\n\s*with:\n\s*ref: \$\{\{ github\.event\.repository\.default_branch \}\}/.test(workflow),
'main-ancestry validation runs from the trusted default branch before the dispatched commit is checked out');
ok(jobEnvAt >= 0
  && !/^    env:\n(?:      [^\n]*\n)*      SUPABASE_ACCESS_TOKEN:/m.test(workflow)
  && (workflow.match(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g) || []).length === 3
  && workflow.slice(jobEnvAt, ancestryAt).indexOf('SUPABASE_ACCESS_TOKEN') === -1,
'the production token never lives at job scope; only the three deploy/attestation steps carry it, all after validation');
ok(/^  deploy:\n(?:    [^\n]*\n)*    environment: production\n/m.test(workflow),
'the deploy job runs in the production Environment so a branch copy cannot reach the secret');

// Finding P2 #8 — the attestor folds the verify_jwt posture into the verdict.
const { EXPECTED_VERIFY_JWT, jwtPostureOk, reasonFor } = require('../scripts/ef-fingerprint.js');
const jwtPass = { result: 'PASS', verify_jwt: false, comparison: { missing: [], extra: [], changed: [] } };
const jwtFlipped = { result: 'FAIL', verify_jwt: true, status: 'ACTIVE', comparison: { missing: [], extra: [], changed: [] } };
ok(EXPECTED_VERIFY_JWT === false
  && jwtPostureOk(false) === true && jwtPostureOk(true) === false && jwtPostureOk(null) === false
  && /verify_jwt=true \(expected false\)/.test(reasonFor(jwtFlipped))
  && !/verify_jwt/.test(reasonFor(jwtPass)),
'the attestor treats verify_jwt=false as the only sound posture and folds a flipped posture into the FAIL reason');
ok(fingerprintSource.includes('comparison.pass && active && jwtPostureOk(verifyJwt)')
  && /verify_jwt/.test(workflow) && workflow.includes('JWT posture:'),
'verify_jwt is part of the live PASS verdict and the release attestation summary');

const manifestCheck = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ef-deploy-manifest.js'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const slugRows = manifest.split(/\r?\n/).filter(line => /^\| `[a-z0-9-]+` \|/.test(line));
ok(manifestCheck.status === 0 && slugRows.length === 30,
`generated deploy manifest is current and contains all 30 slugs (${(manifestCheck.stderr || '').trim()})`);
ok(/\| `client-review-link` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* Live v2 deployed by operator on 2026-07-15\./.test(manifest),
'client-review-link is explicitly recorded as the operator-deployed v2 deliberate-manual exception');
ok(/\| `client-token-verify` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* Strict client-entry v1 is deliberate-manual: deploy and read back the exact reviewed function source before serving its matching browser caller; no runtime-flag change is part of this release\./.test(manifest),
'client-token-verify pins the fail-closed provider-before-browser manual release order');
ok(/\| `production-archive` \| \[deploy-onboarding\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest)
  && /\| `production-comments` \| \[deploy-onboarding\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest),
'production-comments and production-archive deploy via the pinned-SHA dispatch-only lane, not local credentials');
ok(/for fn in linear-outbound production-write production-comments production-archive/.test(workflow),
'the Track-B deploy set deploys the provider and write gateway before the comment/archive readers from one pinned commit');
ok(/\| `workload-linear` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* Source-only Workload Linear metadata\/deadline gateway/.test(manifest),
'workload-linear is explicitly recorded as a source-only deliberate-manual exception');

if (failures) {
  console.error(`\n${failures} Edge Function deploy provenance check(s) failed`);
  process.exit(1);
}
console.log('\nEdge Function deploy provenance checks passed');
