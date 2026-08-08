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
const f27Workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-f27-linear-inbound.yml'), 'utf8');
const f27Runbook = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'F27_INSTALL_RUNBOOK.md'), 'utf8');
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
ok(fingerprintSource.includes('comparison.pass && entrypointMatch && active && jwtPostureOk(verifyJwt)')
  && /verify_jwt/.test(workflow) && workflow.includes('JWT posture:'),
'source closure, entrypoint, and verify_jwt are all part of the live PASS verdict');

const f27Trigger = f27Workflow.slice(
  f27Workflow.indexOf('on:'),
  f27Workflow.indexOf('permissions:'),
);
const f27ValidationAt = f27Workflow.indexOf('- name: Validate the reviewed release and operation');
const f27PrivateFetchAt = f27Workflow.indexOf('- name: Fetch and independently verify the sealed v39 rollback source');
const f27ReleaseCheckoutAt = f27Workflow.indexOf('- name: Check out exactly the reviewed release');
const f27DeployAt = f27Workflow.indexOf('supabase functions deploy linear-inbound');
const f27RestoreAt = f27Workflow.indexOf('node scripts/f27-edge-source-rollback.js restore');
const f27CleanupAt = f27Workflow.indexOf('- name: Delete private source and raw receipts');
const reviewedReleaseSha = '661e5b1bf9dc0643c89d09d47b93a1362c5af275';
const denoConfigBlob = spawnSync(
  'git',
  ['show', `${reviewedReleaseSha}:supabase/functions/linear-inbound/deno.json`],
  { cwd: ROOT, encoding: null },
);
const denoLockBlob = spawnSync(
  'git',
  ['show', `${reviewedReleaseSha}:supabase/functions/linear-inbound/deno.lock`],
  { cwd: ROOT, encoding: null },
);
const denoConfigBlobSha256 = denoConfigBlob.status === 0
  ? crypto.createHash('sha256').update(denoConfigBlob.stdout).digest('hex')
  : '';
const denoLockBlobSha256 = denoLockBlob.status === 0
  ? crypto.createHash('sha256').update(denoLockBlob.stdout).digest('hex')
  : '';
ok(/^on:\n  workflow_dispatch:\n/m.test(f27Trigger)
  && !/^\s{2}(?:push|pull_request|schedule):/m.test(f27Trigger)
  && /commit_sha:\n\s*description:[^\n]+\n\s*required: true\n\s*type: string/.test(f27Trigger)
  && /operation:\n[\s\S]*?type: choice\n[\s\S]*?- deploy-reviewed-release\n\s*- restore-captured-v39/.test(f27Trigger)
  && /confirm:\n\s*description:[^\n]+\n\s*required: true\n\s*type: string/.test(f27Trigger),
'the F27 inbound lane is dispatch-only and requires the pinned SHA, bounded operation, and explicit confirmation');
ok(f27Workflow.includes('REVIEWED_RELEASE_SHA: 661e5b1bf9dc0643c89d09d47b93a1362c5af275')
  && f27Workflow.includes('if [ "$DEPLOY_COMMIT" != "$REVIEWED_RELEASE_SHA" ]')
  && f27Workflow.includes('git -C operator merge-base --is-ancestor')
  && f27Workflow.includes('git -C operator cat-file -e "$DEPLOY_COMMIT:$required"')
  && f27Workflow.includes('ref: ${{ github.sha }}')
  && f27Workflow.includes('ref: ${{ inputs.commit_sha }}')
  && f27ValidationAt >= 0
  && f27ValidationAt < f27PrivateFetchAt
  && f27PrivateFetchAt < f27ReleaseCheckoutAt
  && f27ReleaseCheckoutAt < f27DeployAt,
'trusted-main validation binds the exact reviewed release before private fetch, pinned checkout, or deployment');
ok(/^  deploy:\n(?:    [^\n]*\n)*    environment: production\n/m.test(f27Workflow)
  && !/^    env:\n(?:      [^\n]*\n)*      (?:SUPABASE_ACCESS_TOKEN|F27_PRIVATE_SHARED_DRIVE_ROOT_ID|TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON):/m.test(f27Workflow)
  && (f27Workflow.match(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g) || []).length === 2
  && (f27Workflow.match(/F27_PRIVATE_SHARED_DRIVE_ROOT_ID: \$\{\{ secrets\.F27_PRIVATE_SHARED_DRIVE_ROOT_ID \}\}/g) || []).length === 1
  && !/TRACK_B_BACKUP_DRIVE_FOLDER_ID: \$\{\{ (?:secrets|vars)\.TRACK_B_BACKUP_DRIVE_FOLDER_ID \}\}/.test(f27Workflow)
  && (f27Workflow.match(/TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON: \$\{\{ secrets\.TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON \}\}/g) || []).length === 1
  && f27ValidationAt < f27Workflow.indexOf('secrets.F27_PRIVATE_SHARED_DRIVE_ROOT_ID')
  && f27ValidationAt < f27Workflow.indexOf('secrets.SUPABASE_ACCESS_TOKEN')
  && /if: github\.event_name == 'workflow_dispatch' && inputs\.operation == 'deploy-reviewed-release'[\s\S]*?SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/.test(f27Workflow)
  && /if: inputs\.operation == 'restore-captured-v39'[\s\S]*?SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/.test(f27Workflow),
'the protected production Environment scopes a distinct F27 Shared Drive root and Supabase material to the selected post-validation operation');
ok(/uses: supabase\/setup-cli@v1\n\s*with:\n\s*version: 2\.109\.0/.test(f27Workflow)
  && /- name: Install exact Deno\n\s*if: inputs\.operation == 'deploy-reviewed-release'\n\s*uses: denoland\/setup-deno@v2\n\s*with:\n\s*deno-version: v2\.2\.15/.test(f27Workflow)
  && f27Workflow.includes('if [ "$cli_version" != "$EXPECTED_CLI_VERSION" ]')
  && f27Workflow.includes('if [ "$deno_version" != "$EXPECTED_DENO_VERSION" ]')
  && f27Workflow.includes("docker info --format '{{.ServerVersion}}'")
  && f27Workflow.indexOf("docker info --format '{{.ServerVersion}}'") < f27DeployAt,
'the lane always verifies Supabase CLI 2.109.0 and Docker while pinning Deno 2.2.15 only for forward deployment');
ok(f27Workflow.includes("imports[0] !== 'npm:@supabase/supabase-js@2.49.8'")
  && f27Workflow.includes("config.lock.frozen !== true")
  && f27Workflow.includes("specifiers[0] !== 'npm:@supabase/supabase-js@2.49.8'")
  && f27Workflow.includes('deno cache --frozen')
  && f27Workflow.includes('git diff --exit-code --')
  && denoConfigBlobSha256 === 'e13cf0336d14f38013762c11935bd6123978f809120f530738d5b69669281524'
  && denoLockBlobSha256 === 'a42630fbcde6d3f93da9ca2f5a9a39fd92ad23614853338443a56e7d4ab525ed'
  && f27Workflow.includes(`EXPECTED_DENO_CONFIG_SHA256: ${denoConfigBlobSha256}`)
  && f27Workflow.includes(`EXPECTED_DENO_LOCK_SHA256: ${denoLockBlobSha256}`)
  && f27Workflow.includes('CANDIDATE_SOURCE_SHA256: 3d91b2a2dfb9b8b1dc563cd8425378f7067d9e2fdf16278f45a4546823f09574')
  && f27Workflow.includes('CANDIDATE_FILE_COUNT: \'5\'')
  && /- name: Prove the exact pinned import, frozen lock, and candidate closure\n\s*if: inputs\.operation == 'deploy-reviewed-release'/.test(f27Workflow),
'the sole 2.49.8 import, exact release-blob config/lock bytes, no-diff frozen cache, and five-file candidate closure are pre-deploy gates');
ok((f27Workflow.match(/\bsupabase functions deploy\b/g) || []).length === 1
  && /supabase functions deploy linear-inbound \\\n\s*--project-ref "\$project_ref" \\\n\s*--no-verify-jwt --use-docker --yes/.test(f27Workflow)
  && /^ {8}if: github\.event_name == 'workflow_dispatch' && inputs\.operation == 'deploy-reviewed-release'$/m.test(f27Workflow)
  && !/\bsupabase functions deploy (?!linear-inbound\b)[a-z0-9-]+/.test(f27Workflow)
  && !/supabase functions deploy "\$fn"/.test(f27Workflow),
'the dispatch-only deploy step contains one literal Docker-only, JWT-off linear-inbound command and no other function');
ok(f27Workflow.includes('V39_BUNDLE_SHA256: cd0b391962a18b5e912dacf0c0e63c2ae972818343d1c41f77058039dd570690')
  && f27Workflow.includes("V39_BUNDLE_BYTE_LENGTH: '49968'")
  && f27Workflow.includes('EXPECTED_F27_SHARED_DRIVE_ROOT_ID_SHA256: 9d1480048b17bcd038650c4d3191e12cb94b65938374ab335b955a9cab2df042')
  && f27Workflow.includes('CAPTURED_V39_SOURCE_SHA256: b6c830f3bca709de6f8b10af56ce189f625e66ce4da9e394f53f28bf4d46b348')
  && f27Workflow.includes('node operator/scripts/f27-private-snapshot-fetch.js')
  && f27Workflow.includes('receipt.folder_id_sha256 !== process.env.EXPECTED_F27_SHARED_DRIVE_ROOT_ID_SHA256')
  && f27Workflow.includes('F27 Shared Drive root ID SHA-256')
  && f27Workflow.includes('F27_EDGE_ROLLBACK_CONFIRM: RESTORE_CAPTURED_SOURCE_SET:linear-inbound')
  && f27Workflow.includes('--expected-bundle-sha256="$V39_BUNDLE_SHA256"')
  && f27Workflow.includes('row.source_closure_sha256 !== process.env.CAPTURED_V39_SOURCE_SHA256')
  && f27PrivateFetchAt < f27DeployAt
  && f27PrivateFetchAt < f27RestoreAt,
'both operations prefetch the exact sealed v39 bundle and restore mode requires source/JWT provider readback against its captured closure');
ok(/- name: Install exact Deno\n\s*if: inputs\.operation == 'deploy-reviewed-release'/.test(f27Workflow)
  && /- name: Verify exact forward-deploy Deno\n\s*if: inputs\.operation == 'deploy-reviewed-release'/.test(f27Workflow)
  && /- name: Prove the exact pinned import, frozen lock, and candidate closure\n\s*if: inputs\.operation == 'deploy-reviewed-release'/.test(f27Workflow)
  && /- name: Restore the exact captured v39 source\n[\s\S]*?if: inputs\.operation == 'restore-captured-v39'/.test(f27Workflow),
'captured-v39 restore does not depend on Deno, npm resolution, or the forward candidate closure');
ok(!/upload-artifact/.test(f27Workflow)
  && !/\$\{\{ vars\./.test(f27Workflow)
  && !/\bproject_ref:\s*[a-z0-9]{20}\b/.test(f27Workflow)
  && !/^\s+(?:file_id|folder_id|drive_id):/m.test(f27Workflow)
  && (f27Workflow.match(/if: always\(\)/g) || []).length === 1
  && f27CleanupAt > f27DeployAt
  && f27CleanupAt > f27RestoreAt
  && /case "\$F27_PRIVATE_DIR" in\n\s*"\$RUNNER_TEMP"\/f27-v39\.\*/.test(f27Workflow),
'the workflow publishes no private identity/raw artifact and reserves always() solely for bounded temporary cleanup');
ok(f27Runbook.includes('deploy-f27-linear-inbound.yml')
  && f27Runbook.includes('deploy-reviewed-release')
  && f27Runbook.includes('restore-captured-v39')
  && f27Runbook.includes('same workflow')
  && f27Runbook.includes('server-side bundling'),
'the F27 runbook names the dispatch lane, its exact restore operation, and the no-server-bundling boundary');

const manifestCheck = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ef-deploy-manifest.js'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const slugRows = manifest.split(/\r?\n/).filter(line => /^\| `[a-z0-9-]+` \|/.test(line));
ok(manifestCheck.status === 0 && slugRows.length === 30,
`generated deploy manifest is current and contains all 30 slugs (${(manifestCheck.stderr || '').trim()})`);
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
ok(/\| `client-review-link` \|[^|]*\|[^|]*\| `_shared\/browser-write-auth-policy\.mjs`<br>`_shared\/browser-write-auth\.ts`<br>`_shared\/client-review-token-policy\.mjs`<br>`_shared\/staff-role-auth\.ts` \|/.test(manifest),
'the manifest records the shared review-token policy in the client-review-link deploy closure');
ok(/\| `client-token-verify` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* Strict client-entry v1 is deliberate-manual: deploy and read back the exact reviewed function source before serving its matching browser caller; no runtime-flag change is part of this release\./.test(manifest),
'client-token-verify pins the fail-closed provider-before-browser manual release order');
ok(/\| `production-archive` \| \[deploy-onboarding\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest)
  && /\| `production-comments` \| \[deploy-onboarding\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest),
'production-comments and production-archive deploy via the pinned-SHA dispatch-only lane, not local credentials');
ok(/\| `linear-inbound` \| \[deploy-f27-inbound\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest),
'linear-inbound has one dispatch-only pinned-SHA owner and no push deploy path');
ok(/\| `linear-outbound` \| \[deploy-f27-section4\]\([^)]*\)<br>\[deploy-onboarding\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\)<br>workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest)
  && /\| `production-write` \| \[deploy-f27-section4\]\([^)]*\)<br>\[deploy-onboarding\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\)<br>workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest)
  && /\| `deliverable-write` \| \[deploy-f27-section4\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest)
  && /\| `batch-write` \| \[deploy-f27-section4\]\([^)]*\) \| workflow_dispatch only \(pinned SHA guard\) \|/.test(manifest),
'the manifest records the exact reviewed Section 4 ownership, including only the two deliberate onboarding overlaps');
ok(/for fn in linear-outbound production-write production-comments production-archive/.test(workflow),
'the Track-B deploy set deploys the provider and write gateway before the comment/archive readers from one pinned commit');
ok(/\| `workload-linear` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* Source-only Workload Linear metadata\/deadline gateway/.test(manifest),
'workload-linear is explicitly recorded as a source-only deliberate-manual exception');

if (failures) {
  console.error(`\n${failures} Edge Function deploy provenance check(s) failed`);
  process.exit(1);
}
console.log('\nEdge Function deploy provenance checks passed');
