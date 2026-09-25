'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  closureFingerprint,
  dispositionValue,
  multipartBoundary,
  normalizeLiveEntrypoint,
  normalizeLivePath,
  parseMultipart,
} = require('../scripts/ef-fingerprint.js');

const ROOT = path.resolve(__dirname, '..');
const fingerprintSource = fs.readFileSync(path.join(ROOT, 'scripts', 'ef-fingerprint.js'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-onboarding-edge-functions.yml'), 'utf8');
const hiringWorkflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-hiring-applications.yml'), 'utf8');
const hiringAutomationWorkflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-hiring-automation.yml'), 'utf8');
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
ok(normalizeLiveEntrypoint('linear-outbound', 'file:///tmp/source/index.ts')
    === 'functions/linear-outbound/index.ts'
  && normalizeLiveEntrypoint('fixture', 'functions/fixture/index.ts')
    === 'functions/fixture/index.ts'
  && throws(() => normalizeLiveEntrypoint('fixture', '../outside.ts')),
'live entrypoint normalization is canonical and fails closed on unsafe paths');

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

const providerAt = workflow.indexOf('for fn in notify production-write production-comments production-archive');
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
const sqlPreflightAt = workflow.indexOf('- name: Assert the Linear-exit SQL contract before a manual deployment');
const sqlPreflightEnd = workflow.indexOf('\n      - ', sqlPreflightAt + 1);
const sqlPreflightBlock = workflow.slice(sqlPreflightAt, sqlPreflightEnd);
const firstDeployAt = workflow.indexOf('- name: Deploy push-safe staff-sensitive functions');
ok(validateAt >= 0 && ancestryAt >= 0 && validatedCheckoutAt >= 0
  && ancestryAt < validatedCheckoutAt
  && /Check out the trusted default branch for validation\n\s*uses: actions\/checkout@v4\n\s*with:\n\s*ref: \$\{\{ github\.event\.repository\.default_branch \}\}/.test(workflow),
'main-ancestry validation runs from the trusted default branch before the dispatched commit is checked out');
ok(jobEnvAt >= 0
  && !/^    env:\n(?:      [^\n]*\n)*      SUPABASE_ACCESS_TOKEN:/m.test(workflow)
  && (workflow.match(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g) || []).length === 4
  && workflow.slice(jobEnvAt, ancestryAt).indexOf('SUPABASE_ACCESS_TOKEN') === -1
  && sqlPreflightAt > validatedCheckoutAt && sqlPreflightAt < firstDeployAt
  && /if: github\.event_name == 'workflow_dispatch'/.test(sqlPreflightBlock)
  && (sqlPreflightBlock.match(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g) || []).length === 1
  && sqlPreflightBlock.includes('node scripts/linear-exit-deploy-preflight.js')
  && !/F27_PRIVATE_SHARED_DRIVE_ROOT_ID|TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON/.test(sqlPreflightBlock),
'the production token never lives at job scope; the manual SQL preflight receives one scoped token only after validation and before deployment');
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
ok(fingerprintSource.includes('comparison.pass && entrypointMatch && active && jwtPostureOk(verifyJwt)')
  && /verify_jwt/.test(workflow) && workflow.includes('JWT posture:'),
'source closure, entrypoint, and verify_jwt are all part of the live PASS verdict');

// B2 Slice 7 (2026-09-24): linear-inbound was deleted from production and its
// dispatch lane retired. The lane must stay gone, so nothing can redeploy it.
ok(!fs.existsSync(path.join(ROOT, '.github', 'workflows', 'deploy-f27-linear-inbound.yml')),
'the retired linear-inbound deploy lane is absent');

const manifestCheck = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ef-deploy-manifest.js'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const slugRows = manifest.split(/\r?\n/).filter(line => /^\| `[a-z0-9-]+` \|/.test(line));
// write-diagnostics is now registered DELIBERATE-MANUAL (2026-09-22, ledger
// 240) rather than merely absent from every lane. The assertion still requires
// that it has no CI deploy path -- the wording changes, the property does not --
// and additionally that its manual release states the --no-verify-jwt posture
// it needs, since it accepts unauthenticated browser refusal claims by design.
const writeDiagnosticsRow = slugRows.find(line => line.startsWith('| `write-diagnostics` |')) || '';
// 2026-09-23: its manual release now runs through the one-function exact-SHA
// lane, dispatch-only, and the deliberate-manual note stays on its row.
ok(manifestCheck.status === 0 && slugRows.length === 40
  && writeDiagnosticsRow.includes('[deploy-single-function]')
  && writeDiagnosticsRow.includes('| workflow_dispatch only (pinned SHA guard)<br>**Manual release note:**')
  && !writeDiagnosticsRow.includes('main push')
  && writeDiagnosticsRow.includes('--no-verify-jwt')
  && writeDiagnosticsRow.includes('WRITE_DIAGNOSTICS_ENABLED=true'),
`generated deploy manifest is current and contains all 40 slugs including dormant write-diagnostics on the dispatch-only one-function lane (${(manifestCheck.stderr || '').trim()})`);
/*
 * 2026-08-08: client-review-link left the deliberate-manual set. The manual
 * lane is WHY the #1016 mint-on-demand fix sat merged-but-undeployed for five
 * days while the hand-written "live v2" note drifted (live was v3, found by
 * measurement). Deliberateness now lives in the production Environment's
 * required-reviewer approval on its dispatch-only workflow, and the readback
 * gate proves deployed == reviewed. These pins assert the new ownership so a
 * regression back to NONE — or a second owner claiming the slug — fails CI.
 */
ok(/\| `client-review-link` \| \[deploy-client-review-link\]\([^)]*deploy-client-review-link\.yml\) \| workflow_dispatch \|/.test(manifest),
'client-review-link is owned by its dispatch-only CI lane, not by an operator laptop');
ok(!/\| `client-review-link` \| NONE \|/.test(manifest),
  'client-review-link is no longer a NO-CI-DEPLOY-PATH exception');
ok(/^on:\n  workflow_dispatch:/m.test(hiringWorkflow)
  && !/^  push:/m.test(hiringWorkflow)
  && /commit_sha:[\s\S]{0,180}required: true/.test(hiringWorkflow)
  && /git merge-base --is-ancestor "\$DEPLOY_COMMIT" origin\/main/.test(hiringWorkflow)
  && /supabase functions deploy hiring-applications \\/.test(hiringWorkflow)
  && /--no-verify-jwt --yes/.test(hiringWorkflow)
  && /--slugs=hiring-applications --format=json/.test(hiringWorkflow),
  'hiring-applications has an exact-SHA, production-gated manual deploy and readback lane');
ok(/\| `hiring-applications` \| \[deploy-hiring-applications\]\([^)]*deploy-hiring-applications\.yml\) \| workflow_dispatch \| `_shared\/staff-role-auth\.ts` \|/.test(manifest),
  'the manifest records the dedicated hiring API deploy owner and its auth dependency');
ok(/^on:\n  workflow_dispatch:/m.test(hiringAutomationWorkflow)
  && !/^  push:/m.test(hiringAutomationWorkflow)
  && /commit_sha:[\s\S]{0,180}required: true/.test(hiringAutomationWorkflow)
  && /git merge-base --is-ancestor "\$DEPLOY_COMMIT" origin\/main/.test(hiringAutomationWorkflow)
  && /node test\/hiring-automation-contract\.js/.test(hiringAutomationWorkflow)
  && /supabase functions deploy hiring-automation \\/.test(hiringAutomationWorkflow)
  && /--no-verify-jwt --yes/.test(hiringAutomationWorkflow)
  && /--slugs=hiring-automation --format=json/.test(hiringAutomationWorkflow),
  'hiring-automation has a tested, exact-SHA, production-gated manual deploy and readback lane');
ok(/\| `hiring-automation` \| \[deploy-hiring-automation\]\([^)]*deploy-hiring-automation\.yml\) \| workflow_dispatch \| - \|/.test(manifest),
  'the manifest records the server-to-server hiring bridge and its no-shared-import closure');
ok(/\| `client-review-link` \|[^|]*\|[^|]*\| `_shared\/browser-write-auth-policy\.mjs`<br>`_shared\/browser-write-auth\.ts`<br>`_shared\/client-review-token-policy\.mjs`<br>`_shared\/staff-role-auth\.ts` \|/.test(manifest),
'the manifest records the shared review-token policy in the client-review-link deploy closure');
ok(/\| `client-token-verify` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* Strict client-entry v1 is deliberate-manual: deploy and read back the exact reviewed function source before serving its matching browser caller; no runtime-flag change is part of this release\./.test(manifest),
'client-token-verify pins the fail-closed provider-before-browser manual release order');
ok(/\| `production-archive` \| \[deploy-onboarding\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest)
  && /\| `production-comments` \| \[deploy-onboarding\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest),
'production-comments and production-archive deploy via the pinned-SHA dispatch-only lane, not local credentials');
ok(/\| `notify` \| \[deploy-onboarding\]\([^)]*\)<br>\[deploy-single-function\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\)<br>workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest),
'notify is owned only by pinned-SHA dispatch-only lanes (onboarding and the one-function lane), never a push or laptop deploy');
ok(/\| `linear-inbound` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* RETIRED 2026-09-24 \(B2 Slice 7\)/.test(manifest),
'linear-inbound is recorded as retired, with no deploy path (B2 Slice 7)');
ok(/\| `linear-outbound` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* RETIRED \(B2 Slice 8/.test(manifest)
  && /\| `production-write` \| \[deploy-f27-section4\]\([^)]*\)<br>\[deploy-onboarding\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\)<br>workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest)
  && /\| `deliverable-write` \| \[deploy-f27-section4\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest)
  && /\| `batch-write` \| \[deploy-f27-section4\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest),
'the manifest records the exact reviewed Section 4 ownership, with production-write as the one deliberate onboarding overlap and linear-outbound retired (B2 Slice 8)');
ok(/for fn in notify production-write production-comments production-archive/.test(workflow)
  && !/for fn in[^\n]*linear-outbound/.test(workflow),
'the Track-B deploy set deploys the notification sender before the write gateway, then its readers, from one pinned commit, and no longer deploys linear-outbound (B2 Slice 8)');
ok(!/\| `workload-linear` \|/.test(manifest),
'workload-linear is gone from the manifest (deleted in B2 Slice 7)');

if (failures) {
  console.error(`\n${failures} Edge Function deploy provenance check(s) failed`);
  process.exit(1);
}
console.log('\nEdge Function deploy provenance checks passed');
