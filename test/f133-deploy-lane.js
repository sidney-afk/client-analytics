'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const workflowFile = path.join(ROOT, '.github', 'workflows', 'deploy-f133-canonical-title.yml');
const workflow = fs.readFileSync(workflowFile, 'utf8');
const p3File = path.join(ROOT, '.github', 'workflows', 'deploy-f27-linear-inbound.yml');
const p3Bytes = fs.readFileSync(p3File);
const runbook = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'F133_CANONICAL_TITLE_INSTALL_RUNBOOK.md'), 'utf8');
let failures = 0;

function ok(value, message) {
  if (value) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}

function count(pattern, source = workflow) {
  return (source.match(pattern) || []).length;
}

const trigger = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:'));
ok(/^on:\n  workflow_dispatch:\n/m.test(trigger)
  && !/^\s{2}(?:push|pull_request|schedule):/m.test(trigger)
  && /operation:\n[\s\S]*?type: choice\n[\s\S]*?- capture-prior-three\n\s*- deploy-reviewed-release\n\s*- restore-captured-prior-three/.test(trigger)
  && /commit_sha:\n\s*description:[^\n]+\n\s*required: true\n\s*type: string/.test(trigger)
  && /confirm:\n\s*description:[^\n]+\n\s*required: true\n\s*type: string/.test(trigger)
  && !/(?:slug|function_name):\n\s*description:/.test(trigger),
'the F133 lane is dispatch-only with a bounded operation and no caller-selected slug');

const validationAt = workflow.indexOf('- name: Validate trusted release and bounded operation');
const currentMainAt = workflow.indexOf('if [ "$GITHUB_SHA" != "$current_main_sha" ]');
const releaseCheckoutAt = workflow.indexOf('- name: Check out exactly the reviewed release');
const firstSecretAt = workflow.indexOf('${{ secrets.');
const firstReleaseScriptAt = workflow.indexOf('working-directory: release');
ok(/- name: Check out trusted workflow bytes\n\s*uses: actions\/checkout@v4\n\s*with:\n\s*ref: \$\{\{ github\.sha \}\}/.test(workflow)
  && validationAt >= 0 && currentMainAt > validationAt
  && releaseCheckoutAt > currentMainAt
  && firstSecretAt > currentMainAt
  && firstReleaseScriptAt > currentMainAt
  && workflow.slice(validationAt, releaseCheckoutAt).includes('scripts/f133-post-inverse-verify.js')
  && workflow.slice(validationAt, releaseCheckoutAt).includes('scripts/f133-predeploy-db-verify.js')
  && workflow.includes('if [ "$GITHUB_REF" != "refs/heads/${{ github.event.repository.default_branch }}" ]')
  && workflow.includes('Forward commit_sha must equal the reviewed current-main workflow SHA')
  && workflow.includes('Capture commit_sha must equal the reviewed current-main workflow SHA'),
'trusted current-default-branch bytes validate capture/forward before any secret or release-owned script');

ok(workflow.includes("expected_confirmation='CAPTURE_F133_PRIOR_THREE_CLOSURES'")
  && workflow.includes("expected_confirmation='DEPLOY_REVIEWED_F133_CANONICAL_TITLE_CLOSURES'")
  && workflow.includes("expected_confirmation='RESTORE_CAPTURED_F133_CANONICAL_TITLE_CLOSURES'")
  && workflow.includes('Capture derives its bundle hash and length; both bundle inputs must be empty')
  && workflow.includes('rollback_bundle_sha256 must be exactly 64 lowercase hexadecimal characters')
  && workflow.includes('rollback_bundle_byte_length is outside the private source-bundle limit'),
'each operation has a distinct confirmation and the content-addressed restore inputs fail closed');

ok(workflow.includes('--slugs=linear-inbound,linear-outbound,production-write')
  && count(/--slugs=linear-inbound,linear-outbound,production-write/g) === 4
  && workflow.includes('receipt.function_count !== 3')
  && workflow.includes("const expected = ['linear-inbound', 'linear-outbound', 'production-write'];")
  && workflow.includes('F27_CONFIRM_PRIVATE_SNAPSHOT_UPLOAD')
  && workflow.includes('F27_PRIVATE_SHARED_DRIVE_ROOT_ID: ${{ secrets.F27_PRIVATE_SHARED_DRIVE_ROOT_ID }}')
  && workflow.includes('TRACK_B_BACKUP_DRIVE_FOLDER_ID: ${{ secrets.F27_PRIVATE_SHARED_DRIVE_ROOT_ID }}')
  && !workflow.includes('vars.TRACK_B_BACKUP_DRIVE_FOLDER_ID')
  && count(/--expected-folder-id-sha256 "\$EXPECTED_F27_SHARED_DRIVE_ROOT_ID_SHA256"/g) === 3
  && workflow.includes('receipt.folder_id_sha256 !== process.env.EXPECTED_F27_SHARED_DRIVE_ROOT_ID_SHA256')
  && workflow.includes('receipt.independent_private_readback !== \'PASS\'')
  && workflow.includes('receipt.local_private_readback !== \'PASS\'')
  && workflow.includes('assertCaptureProviderContract(capture')
  && workflow.includes('projectRef: process.env.F133_PROJECT_REF')
  && workflow.includes('cliVersion: process.env.EXPECTED_CLI_VERSION'),
'capture seals exactly the fixed three at the distinct Shared Drive root and independently re-fetches exact bytes');

const outboundDeployAt = workflow.indexOf('supabase functions deploy linear-outbound');
const productionDeployAt = workflow.indexOf('supabase functions deploy production-write');
const inboundDeployAt = workflow.indexOf('supabase functions deploy linear-inbound');
ok(count(/\bsupabase functions deploy\b/g) === 3
  && outboundDeployAt >= 0 && outboundDeployAt < productionDeployAt && productionDeployAt < inboundDeployAt
  && !/supabase functions deploy ["']?\$/.test(workflow)
  && !/for\s+(?:fn|slug)\s+in\s+/.test(workflow)
  && count(/--no-verify-jwt --use-docker --yes/g) === 3
  && count(/inputs\.operation == 'deploy-reviewed-release'/g) === 6,
'forward contains exactly three literal Docker deploys in outbound -> gateway -> inbound order');

const immediateGateAt = workflow.indexOf('scripts/f133-edge-deploy-gate.js prior-live');
ok(immediateGateAt >= 0 && immediateGateAt < outboundDeployAt
  && workflow.includes('--slugs=linear-inbound,linear-outbound,production-write \\')
  && workflow.includes('--bundle="$F133_PRIVATE_DIR/immediate-predeploy-live.sourcebundle"')
  && workflow.includes('--prior-receipt="$F133_PRIVATE_DIR/prior-inspect.json"')
  && workflow.includes('--expected-bundle-sha256="$ROLLBACK_BUNDLE_SHA256"')
  && workflow.includes('The active provider closures changed after the sealed capture; no function was deployed')
  && workflow.includes("receipt.gate !== 'f133_predeploy_prior_three_exact'"),
'all three active closures must equal the sealed source/entrypoint/JWT/version receipt immediately before function 1');

for (const [index, slug] of ['linear-outbound', 'production-write', 'linear-inbound'].entries()) {
  ok(workflow.includes(`Deploy and verify ${index + 1} of 3 - ${slug}`)
    && workflow.includes(`--slugs=${slug} --format=json`)
    && workflow.includes(`capture --slugs=${slug} \\`)
    && workflow.includes('row.result !== \'PASS\' || row.status !== \'ACTIVE\' || row.verify_jwt !== false')
    && workflow.includes('row.live_entrypoint !== expected.expected_entrypoint || row.entrypoint_match !== true')
    && workflow.includes('String(row.version) !== String(captured.captured_version)')
    && workflow.includes('Number(row.version) <= Number(priorRow.captured_version)'),
  `${slug} stops on a source/entrypoint/JWT/status/version provider readback mismatch`);
}

const restoreInboundAt = workflow.indexOf("await restoreExact('linear-inbound')");
const restoreProductionAt = workflow.indexOf("await restoreExact('production-write')");
const restoreOutboundAt = workflow.indexOf("await restoreExact('linear-outbound')");
const restoreDatabaseGateAt = workflow.indexOf('- name: Require exact post-inverse database posture before restore');
const restoreDatabaseGateEndAt = workflow.indexOf('- name: Require pre-DDL compatibility before forward deploy');
const forwardDatabaseGateAt = restoreDatabaseGateEndAt;
const forwardDatabaseGateEndAt = workflow.indexOf('- name: Prove frozen import and exact reviewed candidate closures');
const restoreStepAt = workflow.indexOf('- name: Restore and verify exactly three in reverse dependency order');
ok(restoreInboundAt >= 0 && restoreInboundAt < restoreProductionAt && restoreProductionAt < restoreOutboundAt
  && count(/await restoreExact\('/g) === 3
  && workflow.includes("restore_order: ['linear-inbound', 'production-write', 'linear-outbound']")
  && workflow.includes('functions: [bySlug.get(slug)]')
  && workflow.includes("result.deployed_source_readback !== 'PASS'")
  && workflow.includes('row.source_closure_sha256 !== bySlug.get(slug).manifest.source_closure_sha256')
  && workflow.includes('row.entrypoint_sha256 !== require(\'crypto\').createHash(\'sha256\')'),
'restore is fixed to inbound -> gateway -> outbound and independently reads back each exact sealed closure before continuing');

const restoreGateBlock = workflow.slice(restoreDatabaseGateAt, restoreDatabaseGateEndAt);
ok(restoreDatabaseGateAt >= 0 && restoreDatabaseGateAt < outboundDeployAt
  && restoreDatabaseGateAt < restoreStepAt
  && restoreDatabaseGateEndAt > restoreDatabaseGateAt
  && restoreGateBlock.includes("if: inputs.operation == 'restore-captured-prior-three'")
  && restoreGateBlock.includes('working-directory: operator')
  && restoreGateBlock.includes('F133_DATABASE_URL: ${{ secrets.F27_DATABASE_URL }}')
  && restoreGateBlock.includes('node scripts/f133-post-inverse-verify.js')
  && restoreGateBlock.includes("receipt.status !== 'PASS'")
  && restoreGateBlock.includes("receipt.gate !== 'f133_post_inverse_exact'")
  && restoreGateBlock.includes('receipt.predicate_count !== 12')
  && restoreGateBlock.includes('receipt.failed_predicates.length !== 0')
  && !restoreGateBlock.includes('SUPABASE_ACCESS_TOKEN')
  && workflow.slice(restoreStepAt, workflow.indexOf('run: |', restoreStepAt))
    .includes('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}'),
'restore requires the exact read-only post-inverse DB gate before the first prior deploy receives a provider token');

const forwardGateBlock = workflow.slice(forwardDatabaseGateAt, forwardDatabaseGateEndAt);
ok(forwardDatabaseGateAt >= 0 && forwardDatabaseGateAt < outboundDeployAt
  && forwardDatabaseGateEndAt > forwardDatabaseGateAt
  && forwardGateBlock.includes("if: inputs.operation == 'deploy-reviewed-release'")
  && forwardGateBlock.includes('working-directory: operator')
  && forwardGateBlock.includes('F133_DATABASE_URL: ${{ secrets.F27_DATABASE_URL }}')
  && forwardGateBlock.includes('node scripts/f133-predeploy-db-verify.js')
  && forwardGateBlock.includes("receipt.gate !== 'f133_predeploy_database_exact'")
  && forwardGateBlock.includes("!['absent', 'off'].includes(receipt.flag_state)")
  && forwardGateBlock.includes('receipt.open_title_intent_count !== 0')
  && !forwardGateBlock.includes('SUPABASE_ACCESS_TOKEN'),
'forward requires exact absent/OFF and zero-open-title DB compatibility before function 1 or any provider token');

ok(/uses: supabase\/setup-cli@v1\n\s*with:\n\s*version: 2\.109\.0/.test(workflow)
  && /uses: denoland\/setup-deno@v2\n\s*with:\n\s*deno-version: v2\.2\.15/.test(workflow)
  && workflow.includes('if [ "$cli_version" != "$EXPECTED_CLI_VERSION" ]')
  && workflow.includes("docker info --format '{{.ServerVersion}}'")
  && workflow.includes('scripts/f133-edge-deploy-gate.js candidate-imports')
  && workflow.includes('An exact-three candidate Supabase import closure drifted')
  && workflow.includes("config.lock.path !== './deno.lock' || config.lock.frozen !== true")
  && workflow.includes("specifiers[0] !== 'npm:@supabase/supabase-js@2.49.8'")
  && workflow.includes('deno cache --frozen')
  && workflow.includes('git diff --exit-code -- supabase/functions')
  && workflow.includes('--expected-only --format=json'),
'CLI 2.109.0, Docker, Deno 2.2.15, the frozen 2.49.8 lock, clean tree, and reviewed-SHA fingerprints gate forward');

ok(/^  deploy:\n(?:    [^\n]*\n)*    environment: production\n/m.test(workflow)
  && !/^    env:\n(?:      [^\n]*\n)*      (?:SUPABASE_ACCESS_TOKEN|F27_PRIVATE_SHARED_DRIVE_ROOT_ID|TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON):/m.test(workflow)
  && count(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g) === 5
  && count(/TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON: \$\{\{ secrets\.TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON \}\}/g) === 3
  && count(/F133_DATABASE_URL: \$\{\{ secrets\.F27_DATABASE_URL \}\}/g) === 2
  && !/upload-artifact/.test(workflow)
  && !/\$\{\{ vars\./.test(workflow)
  && count(/if: always\(\)/g) === 1
  && workflow.includes('case "$F133_PRIVATE_DIR" in')
  && workflow.includes('"$RUNNER_TEMP"/f133-closures.*) rm -rf'),
'credentials remain step-scoped, private artifacts are never published, and always() is reserved for bounded cleanup');

const p3Hash = crypto.createHash('sha256').update(p3Bytes).digest('hex');
ok(p3Hash === 'a43d83fd1ac33a5a3324b79e3eaf9610a500d0e6c56bbe38e7c62ef6c0ddf5b9',
'the existing single-slug P.3 lane remains byte-for-byte unchanged');

ok(runbook.includes('.github/workflows/deploy-f133-canonical-title.yml')
  && runbook.includes('operation=capture-prior-three')
  && runbook.includes('confirm=CAPTURE_F133_PRIOR_THREE_CLOSURES')
  && runbook.includes('confirm=DEPLOY_REVIEWED_F133_CANONICAL_TITLE_CLOSURES')
  && runbook.includes('confirm=RESTORE_CAPTURED_F133_CANONICAL_TITLE_CLOSURES')
  && runbook.includes('linear-outbound` -> `production-write` -> `linear-inbound')
  && /linear-inbound` -> `production-write` ->\s*`linear-outbound/.test(runbook)
  && runbook.indexOf('## 2. Deploy and read back exactly three Edge Functions')
    < runbook.indexOf('## 3. Apply and verify the migration')
  && runbook.includes('reports the flag as\nonly `absent` or exact `off`')
  && runbook.includes("zero open\n`operation='title'` rows in `pending|failed|shadow_ok`")
  && runbook.includes('apply the migration\'s owner-only database inverse exactly once **before**')
  && runbook.includes('`scripts/f133-post-inverse-verify.js` against one `REPEATABLE READ, READ ONLY`')
  && runbook.includes('stops the workflow before `linear-inbound` is restored')
  && runbook.includes('preferred kill retains both the additive F133 database contract and the')
  && runbook.includes('Never restore the prior closures before the database inverse'),
'the install runbook names the exact workflow, dispatch inputs, and forward/restore orders');

if (failures) {
  console.error(`\n${failures} F133 deploy-lane check(s) failed`);
  process.exit(1);
}
console.log('\nF133 deploy-lane checks passed');
