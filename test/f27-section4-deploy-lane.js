'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'deploy-f27-section4-closures.yml');
const inboundWorkflowPath = path.join(ROOT, '.github', 'workflows', 'deploy-f27-linear-inbound.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const inboundWorkflow = fs.readFileSync(inboundWorkflowPath, 'utf8');
const rollbackLibrary = fs.readFileSync(path.join(ROOT, 'scripts', 'f27-edge-source-rollback-lib.js'), 'utf8');
const manifestGenerator = fs.readFileSync(path.join(ROOT, 'scripts', 'ef-deploy-manifest.js'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'EF_DEPLOY_MANIFEST.md'), 'utf8');
const runbook = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'F27_INSTALL_RUNBOOK.md'), 'utf8');

const EXACT_SLUGS = [
  'linear-outbound',
  'production-write',
  'deliverable-write',
  'batch-write',
];
const CANDIDATES = new Map([
  ['batch-write', {
    source: '86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a',
    entrypoint: '15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5',
    files: 2,
  }],
  ['deliverable-write', {
    source: '78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575',
    entrypoint: '74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68',
    files: 2,
  }],
  // Re-pinned 2026-08-07 (third release): linear-outbound stops reading Linear's
  // URL auto-linking as a create-intent mismatch, and fails closed on a create
  // whose declared parent dependency resolved nothing. Entrypoint hash is
  // unchanged because it hashes the PATH, not the file. The other three are
  // untouched and deploy byte-identical.
  ['linear-outbound', {
    source: 'ef89adbf7245127516fad90877c3b00de0043b9430e7ad5f33cbfd675543b26a',
    entrypoint: '606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684',
    files: 5,
  }],
  // Re-pinned 2026-08-05 (second release): production-write now also stamps
  // intake-created rows and records WHY an asset probe threw. The other three
  // are unchanged and deploy byte-identical.
  ['production-write', {
    source: '50970ca24c74c9044b2c92492d6bdb6f8327e7d7ccd6de80a48926ed8a05913d',
    entrypoint: '7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5',
    files: 5,
  }],
]);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else {
    failures += 1;
    console.error(`FAIL  ${message}`);
  }
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)];
}

const trigger = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:'));
ok(/^on:\n  workflow_dispatch:\n/m.test(trigger)
  && !/^\s{2}(?:push|pull_request|schedule):/m.test(trigger)
  && /commit_sha:[\s\S]*?required: true[\s\S]*?type: string/.test(trigger)
  && /operation:[\s\S]*?type: choice[\s\S]*?- deploy-reviewed-release\n\s*- restore-captured-prior-four/.test(trigger)
  && /confirm:[\s\S]*?required: true[\s\S]*?type: string/.test(trigger)
  && /rollback_bundle_sha256:[\s\S]*?required: true[\s\S]*?type: string/.test(trigger)
  && /rollback_bundle_byte_length:[\s\S]*?required: true[\s\S]*?type: string/.test(trigger),
'the Section 4 lane is dispatch-only with a bounded operation and mandatory reviewed-release/source-bundle inputs');

const validationAt = workflow.indexOf('- name: Validate the reviewed Section 4 release and operation');
const firstSecretAt = workflow.search(/secrets\./);
const privateFetchAt = workflow.indexOf('- name: Fetch and independently verify the sealed prior-four source');
const priorInspectAt = workflow.indexOf('- name: Inspect the exact sealed prior-four rollback set');
const releaseCheckoutAt = workflow.indexOf('- name: Check out exactly the reviewed release');
const dockerGateAt = workflow.indexOf('- name: Verify exact Supabase CLI and Docker bundler');
const providerGateAt = workflow.indexOf('- name: Bind the sealed restore provider target and CLI');
const importGateAt = workflow.indexOf('- name: Prove exact imports, lock applicability, and candidate closures');
const firstDeployAt = workflow.indexOf('supabase functions deploy linear-outbound');
const restoreAt = workflow.indexOf('node scripts/f27-edge-source-rollback.js restore');
ok(validationAt >= 0
  && validationAt < firstSecretAt
  && validationAt < privateFetchAt
  && privateFetchAt < priorInspectAt
  && priorInspectAt < releaseCheckoutAt
  && releaseCheckoutAt < dockerGateAt
  && dockerGateAt < firstDeployAt
  && providerGateAt > dockerGateAt && providerGateAt < firstDeployAt
  && importGateAt < firstDeployAt
  && privateFetchAt < restoreAt && providerGateAt < restoreAt,
'trusted-main validation, private round-trip, exact prior-set inspection, CLI/Docker, and candidate gates all precede mutation');
const priorInspectBlock = workflow.slice(priorInspectAt, releaseCheckoutAt);
const forwardGateBlock = workflow.slice(importGateAt, firstDeployAt);
ok(priorInspectBlock.includes("typeof row.verify_jwt !== 'boolean'")
  && !priorInspectBlock.includes('row.verify_jwt !== false')
  && forwardGateBlock.includes('"$F27_PRIVATE_DIR/prior-inspect.json"')
  && forwardGateBlock.includes('row.verify_jwt !== false')
  && forwardGateBlock.includes('Captured forward JWT arguments: PASS (4 at `--no-verify-jwt`)'),
'the sealed capture retains arbitrary exact JWT booleans for restore while forward deploy binds all four captured arguments to --no-verify-jwt');
ok(workflow.includes('if [ "$GITHUB_SHA" != "$current_main_sha" ]')
  && workflow.includes('if [ "$DEPLOY_COMMIT" != "$GITHUB_SHA" ]')
  && workflow.includes('git -C operator merge-base --is-ancestor "$DEPLOY_COMMIT" "$GITHUB_SHA"')
  && workflow.indexOf('if [ "$DEPLOY_COMMIT" != "$GITHUB_SHA" ]')
    < workflow.indexOf("expected_confirmation='DEPLOY_REVIEWED_F27_SECTION4_CLOSURES'")
  && workflow.indexOf('git -C operator merge-base --is-ancestor')
    < workflow.indexOf("expected_confirmation='RESTORE_CAPTURED_F27_SECTION4_CLOSURES'")
  && workflow.includes('ref: ${{ github.sha }}')
  && workflow.includes('ref: ${{ inputs.commit_sha }}')
  && workflow.includes("expected_confirmation='DEPLOY_REVIEWED_F27_SECTION4_CLOSURES'")
  && workflow.includes("expected_confirmation='RESTORE_CAPTURED_F27_SECTION4_CLOSURES'"),
'forward is bound to the trusted current-main release, while restore accepts its recorded reviewed ancestor under current trusted operator code');
ok(workflow.includes('F27_PROJECT_REF=$project_ref')
  && workflow.includes('echo "::add-mask::$project_ref"')
  && workflow.includes('assertCaptureProviderContract')
  && rollbackLibrary.includes("provider.adapter !== 'supabase-management-readback-cli-docker-deploy'")
  && rollbackLibrary.includes("provider.restore_adapter !== 'local-docker-provider-source-redeploy'")
  && rollbackLibrary.includes('provider.project_ref !== expectedProjectRef')
  && rollbackLibrary.includes('provider.supabase_cli_version !== expectedCliVersion'),
'the sealed undo is privately bound to the masked reviewed project, exact CLI, and both approved adapters before either operation mutates');

ok(/^  deploy:\n(?:    [^\n]*\n)*    environment: production\n/m.test(workflow)
  && !/^    env:\n(?:      [^\n]*\n)*      (?:SUPABASE_ACCESS_TOKEN|F27_PRIVATE_SHARED_DRIVE_ROOT_ID|TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON):/m.test(workflow)
  && occurrences(workflow, /F27_PRIVATE_SHARED_DRIVE_ROOT_ID: \$\{\{ secrets\.F27_PRIVATE_SHARED_DRIVE_ROOT_ID \}\}/g).length === 1
  && occurrences(workflow, /TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON: \$\{\{ secrets\.TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON \}\}/g).length === 1
  && occurrences(workflow, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g).length === 6
  && validationAt < firstSecretAt,
'production credentials are protected-Environment, step-scoped, and unavailable before trusted validation');

ok(/uses: supabase\/setup-cli@v1\n\s*with:\n\s*version: 2\.109\.0/.test(workflow)
  && workflow.includes('if [ "$cli_version" != "$EXPECTED_CLI_VERSION" ]')
  && workflow.includes("docker info --format '{{.ServerVersion}}'")
  && occurrences(workflow, /--use-docker --yes/g).length === 4
  && !/--use-api/.test(workflow),
'the lane pins Supabase CLI 2.109.0 and requires Docker for every forward deployment');

const deployMatches = occurrences(workflow, /\bsupabase functions deploy ([a-z0-9-]+) \\\n/g);
ok(deployMatches.map(match => match[1]).join(',') === EXACT_SLUGS.join(',')
  && deployMatches.length === 4
  && !/supabase functions deploy "\$/.test(workflow)
  && !/for\s+(?:fn|slug)\s+in\b/.test(workflow)
  && !/function_slug:|slugs?:\n\s*description:/i.test(trigger),
'exactly four literal deploy commands exist in the mandated order, with no arbitrary slug input or deployment loop');

let serialReadbacks = true;
for (let index = 0; index < EXACT_SLUGS.length; index += 1) {
  const slug = EXACT_SLUGS[index];
  const deploy = workflow.indexOf(`supabase functions deploy ${slug}`);
  const capture = workflow.indexOf(`--slugs=${slug} \\`, deploy);
  const fingerprint = workflow.indexOf(`--slugs=${slug} --format=json`, capture);
  const nextDeploy = index + 1 < EXACT_SLUGS.length
    ? workflow.indexOf(`supabase functions deploy ${EXACT_SLUGS[index + 1]}`)
    : workflow.indexOf('- name: Verify the final exact four-function release');
  serialReadbacks = serialReadbacks
    && deploy >= 0 && capture > deploy && fingerprint > capture && nextDeploy > fingerprint
    && workflow.slice(deploy, nextDeploy).includes(`row.slug === '${slug}'`)
    && workflow.slice(deploy, nextDeploy).includes('entrypoint_match !== true')
    && workflow.slice(deploy, nextDeploy).includes('verify_jwt !== false')
    && workflow.slice(deploy, nextDeploy).includes("status !== 'ACTIVE'")
    && workflow.slice(deploy, nextDeploy).includes("!/^[0-9]+$/.test(String(captureRow.captured_version))");
}
ok(serialReadbacks,
'each literal deploy is followed by source/entrypoint/JWT/status/version readback before the next deploy can start');

const finalForwardAt = workflow.indexOf('- name: Verify the final exact four-function release');
const finalRestoreCaptureAt = workflow.indexOf('final-restored-four-capture.json');
ok(finalForwardAt > firstDeployAt
  && workflow.indexOf('--bundle="$F27_PRIVATE_DIR/final-four-live.sourcebundle"', finalForwardAt) > finalForwardAt
  && workflow.includes('String(finalCaptured.captured_version) !== String(row.version)')
  && workflow.includes('String(stepCaptured.captured_version) !== String(row.version)')
  && workflow.includes('stepLive.bundle_fingerprint !== row.bundle_fingerprint')
  && finalRestoreCaptureAt > restoreAt
  && workflow.includes('String(finalRow.captured_version) !== String(row.restored_active_version)')
  && workflow.includes('finalRow.source_closure_sha256 !== captured.source_closure_sha256')
  && workflow.includes('finalRow.entrypoint_sha256 !== captured.entrypoint_sha256')
  && workflow.includes('finalRow.verify_jwt !== captured.verify_jwt'),
'final forward and restore receipts re-capture all four and bind versions, provider/source, entrypoint, and JWT to the serial receipts');

/*
 * F51: the forward receipt must say WHAT IS RUNNING, not merely that it passed.
 *
 * It used to end at "PASS" for all four while only the restore path printed
 * per-slug versions, so after a deploy nothing attested which version of each
 * function was live. On 2026-08-05 that cost two full diagnosis cycles: an
 * unfollowed 303 on the artifact probe and an attribution stamp that proved
 * ABSENT rather than partial were both investigated against source that was
 * not the source running.
 */
{
  const forward = workflow.slice(finalForwardAt, restoreAt);
  ok(/const attestation = rows\.map/.test(forward)
    && /syncview_f27_section4_deployed_versions_v1/.test(forward),
  'the forward receipt emits a machine-readable deployed-version attestation');
  ok(/active_version/.test(forward)
    && /source_closure_sha256/.test(forward)
    && /entrypoint_sha256/.test(forward)
    && /provider_bundle_sha256/.test(forward)
    && /verify_jwt/.test(forward),
  'and it records version, source closure, entrypoint, provider bundle and JWT posture per function');
  ok(/Deployed versions/.test(forward) && /EXECUTION_LOG/.test(forward),
    'and it tells the operator where the record has to land');
  ok(!/expected_fingerprint: *row\.live_fingerprint[\s\S]{0,200}client_slug/.test(forward),
    'and it carries no client identity');
}
{
  const log = fs.readFileSync(path.join(ROOT, 'EXECUTION_LOG.md'), 'utf8');
  ok(/syncview_f27_section4_deployed_versions_v1/.test(log),
    'EXECUTION_LOG.md holds the slot the attestation is pasted into');
}

const head = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: ROOT, encoding: 'utf8', timeout: 30_000,
});
const fingerprint = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'ef-fingerprint.js'),
  (head.stdout || '').trim(),
  `--slugs=${EXACT_SLUGS.join(',')}`,
  '--expected-only',
  '--format=json',
], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
let currentCandidatesMatch = head.status === 0 && fingerprint.status === 0;
if (currentCandidatesMatch) {
  const receipt = JSON.parse(fingerprint.stdout);
  currentCandidatesMatch = receipt.results.length === 4 && receipt.results.every(row => {
    const expected = CANDIDATES.get(row.slug);
    return expected
      && row.expected_fingerprint === expected.source
      && row.expected_files === expected.files
      && row.expected_entrypoint === `functions/${row.slug}/index.ts`
      && workflow.includes(expected.source)
      && workflow.includes(expected.entrypoint);
  });
}
ok(currentCandidatesMatch,
`the hardcoded candidate source/file/entrypoint contracts match the exact reviewed repository closure (${(fingerprint.stderr || '').trim()})`);

const exactImport = 'npm:@supabase/supabase-js@2.49.8';
const sourceFiles = [
  'supabase/functions/_shared/b4-write.ts',
  'supabase/functions/linear-outbound/index.ts',
  'supabase/functions/production-write/index.ts',
];
const actualImportSites = sourceFiles.flatMap(file => {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return [...source.matchAll(/npm:@supabase\/supabase-js@[0-9A-Za-z.+-]+/g)]
    .map(match => [file, match[0]]);
});
const lockFiles = EXACT_SLUGS.flatMap(slug => ['deno.json', 'deno.lock']
  .map(name => path.join(ROOT, 'supabase', 'functions', slug, name)))
  .filter(file => fs.existsSync(file));
ok(JSON.stringify(actualImportSites) === JSON.stringify(sourceFiles.map(file => [file, exactImport]))
  && lockFiles.length === 0
  && workflow.includes('a Section 4 Deno config/lock appeared and needs a separately reviewed frozen-lock gate'),
'the exact 2.49.8 imports are proven and zero current lockfiles is an explicit fail-on-appearance contract');

ok(workflow.includes('--slugs=linear-outbound,production-write,deliverable-write,batch-write')
  && workflow.includes('F27_EDGE_ROLLBACK_CONFIRM: RESTORE_CAPTURED_SOURCE_SET:batch-write,deliverable-write,linear-outbound,production-write')
  && workflow.includes('--expected-bundle-sha256="$ROLLBACK_BUNDLE_SHA256"')
  && workflow.includes('--apply')
  && rollbackLibrary.includes('for (const captured of capture.functions) functions.push(await restoreOne(adapter, captured));')
  && !/Promise\.all\s*\([^)]*restore/i.test(rollbackLibrary)
  && workflow.includes("row.entrypoint_sha256 !== captured.entrypoint_sha256")
  && workflow.includes("row.verify_jwt !== captured.verify_jwt")
  && workflow.includes("row.deployed_source_readback !== 'PASS'"),
'restore consumes the exact four-function sealed capture and performs serial source/entrypoint/JWT readback without workstation dependence');

ok(!/upload-artifact/.test(workflow)
  && !/\$\{\{ vars\./.test(workflow)
  && !/\bproject_ref:\s*[a-z0-9]{20}\b/.test(workflow)
  && !/TRACK_B_BACKUP_DRIVE_FOLDER_ID/.test(workflow)
  && occurrences(workflow, /if: always\(\)/g).length === 1
  && workflow.indexOf('- name: Delete private source and raw receipts') > firstDeployAt
  && workflow.indexOf('- name: Delete private source and raw receipts') > restoreAt,
'public receipts expose only safe aggregates/hashes/versions and private files have one bounded always-cleanup step');

ok(!workflow.includes('supabase functions deploy linear-inbound')
  && !workflow.includes('supabase functions deploy production-comments')
  && !workflow.includes('supabase functions deploy production-archive')
  && !/\bsupabase functions deploy (?:calendar-upsert|sample-review-upsert)\b/.test(workflow)
  && occurrences(inboundWorkflow, /\bsupabase functions deploy\b/g).length === 1
  && inboundWorkflow.includes('supabase functions deploy linear-inbound'),
'the new lane cannot deploy inbound, frozen writers, or comment/archive readers, and the P.3 single-slug lane remains separate');

const reviewedOwnerBlock = manifestGenerator.match(/const REVIEWED_MULTI_OWNER = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
ok(reviewedOwnerBlock
  && occurrences(reviewedOwnerBlock[1], /^\s*'[^']+':/gm).map(match => match[0].trim().slice(1, -2)).sort().join(',')
    === 'linear-outbound,production-write'
  && manifestGenerator.includes('has an unreviewed multiple-workflow deploy owner set')
  && manifestGenerator.includes('is missing its exact reviewed multiple-workflow deploy owner set')
  && manifest.includes('| `batch-write` | [deploy-f27-section4]')
  && manifest.includes('| `deliverable-write` | [deploy-f27-section4]')
  && manifest.includes('| `linear-outbound` | [deploy-f27-section4]')
  && manifest.includes('[deploy-onboarding]')
  && manifest.includes('| `production-write` | [deploy-f27-section4]'),
'the generated ownership manifest permits only the two exact reviewed onboarding overlaps and rejects every other duplicate owner set');

ok(runbook.includes('This Node-only Section 1 operation, not the Section 4 deploy workflow, produces')
  && runbook.includes('four `PRIOR_*_VERSION` values')
  && runbook.includes('The Section 4 lane only')
  && runbook.includes('but needs no Docker,')
  && runbook.includes('and must finish before DDL')
  && runbook.includes('Require public `provider_contract=PASS` before')
  && runbook.includes('requires all four to be')
  && runbook.includes('Restore')
  && runbook.includes('always uses each exact captured')
  && runbook.includes('prior_four_source_bundle_sha256=')
  && runbook.includes('prior_four_source_bundle_byte_length=')
  && runbook.includes('restore accepts the recorded')
  && runbook.includes('install `RELEASE_SHA` only when it remains an ancestor')
  && runbook.includes('deploy-f27-section4-closures.yml')
  && runbook.includes('DEPLOY_REVIEWED_F27_SECTION4_CLOSURES')
  && runbook.includes('RESTORE_CAPTURED_F27_SECTION4_CLOSURES')
  && runbook.includes('must never substitute for this exact-four lane'),
'the runbook says plainly that §0/§1 prior-version capture is separate and the reviewed §4 lane is the only install deploy/restore mechanism');

if (failures) {
  console.error(`\n${failures} F27 Section 4 deploy-lane check(s) failed`);
  process.exit(1);
}
console.log('\nF27 Section 4 deploy-lane checks passed');
