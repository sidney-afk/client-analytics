'use strict';

// Source guard for the isolated Workload Linear metadata/deadline gateway.
// This pins the role split, Linear-only authority, completeness receipts, and
// post-commit mirror semantics before any deliberate manual deployment.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const EDGE = read('supabase/functions/workload-linear/index.ts');
const POLICY = read('supabase/functions/workload-linear/policy.mjs');
const MANIFEST = read('docs/ops/EF_DEPLOY_MANIFEST.md');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures += 1;
    console.error('FAIL workload-linear-source: ' + message);
  }
}

for (const header of [
  'x-syncview-key',
  'x-syncview-actor',
  'x-syncview-role',
  'x-syncview-source',
  'x-syncview-client-token',
]) {
  ok(EDGE.includes(header), 'CORS includes ' + header);
}

const readRolesSource = EDGE.slice(
  EDGE.indexOf('const WORKLOAD_LINEAR_READ_ROLES'),
  EDGE.indexOf('const WORKLOAD_LINEAR_WRITE_ROLES'),
);
const writeRolesSource = EDGE.slice(
  EDGE.indexOf('const WORKLOAD_LINEAR_WRITE_ROLES'),
  EDGE.indexOf('const SAFE_ISSUE_ID'),
);
const readRoles = [...readRolesSource.matchAll(/"([^"]+)"/g)].map(match => match[1]);
const writeRoles = [...writeRolesSource.matchAll(/"([^"]+)"/g)].map(match => match[1]);

ok(readRoles.join(',') === 'admin,smm,creative'
  && /authorizeStaffKey\(key, WORKLOAD_LINEAR_READ_ROLES\)/.test(EDGE)
  && /staffAuthFailureStatus\(auth\)/.test(EDGE),
'metadata is restricted to the exact Admin, SMM, and Creative staff allowlist');
ok(writeRoles.join(',') === 'admin,smm'
  && /authorizeBrowserWrite\([\s\S]{0,180}client,[\s\S]{0,80}"workload-linear"/.test(EDGE)
  && /principal\.kind !== "staff" \|\| !isWriteRole\(principal\.role\)/.test(EDGE),
'due-date writes use shared browser-write authentication and the exact Admin/SMM role gate');

const helperUrl = pathToFileURL(path.join(
  ROOT,
  'supabase/functions/_shared/staff-role-auth.ts',
)).href + '?workload-linear-source';
const authRunner = `
  const { authorizeStaffKey, staffAuthFailureStatus } = await import(${JSON.stringify(helperUrl)});
  const secrets = {
    ROLE_KEY_ADMIN: 'dummy-admin',
    ROLE_KEY_SMM: 'dummy-smm',
    ROLE_KEY_CREATIVE: 'dummy-creative',
  };
  const getSecret = name => secrets[name];
  const result = (key, roles) => {
    const auth = authorizeStaffKey(key, roles, [], getSecret);
    return { ...auth, status: auth.ok ? 200 : staffAuthFailureStatus(auth) };
  };
  const readRoles = ${JSON.stringify(readRoles)};
  const writeRoles = ${JSON.stringify(writeRoles)};
  process.stdout.write(JSON.stringify({
    read: {
      admin: result('dummy-admin', readRoles),
      smm: result('dummy-smm', readRoles),
      creative: result('dummy-creative', readRoles),
      wrong: result('dummy-wrong', readRoles),
    },
    write: {
      admin: result('dummy-admin', writeRoles),
      smm: result('dummy-smm', writeRoles),
      creative: result('dummy-creative', writeRoles),
    },
  }));
`;
const authChild = spawnSync(process.execPath, [
  '--no-warnings',
  '--experimental-strip-types',
  '--input-type=module',
  '--eval',
  authRunner,
], { encoding: 'utf8' });
ok(authChild.status === 0,
  `production workload-linear role matrix executes (${authChild.stderr || 'synthetic secrets only'})`);
const auth = authChild.status === 0 ? JSON.parse(authChild.stdout) : null;
ok(auth
  && ['admin', 'smm', 'creative'].every(role => auth.read[role].ok && auth.read[role].status === 200)
  && ['admin', 'smm'].every(role => auth.write[role].ok && auth.write[role].status === 200)
  && !auth.write.creative.ok && auth.write.creative.status === 403
  && !auth.read.wrong.ok && auth.read.wrong.status === 401,
'production staff helper behavior keeps Creative read-only and unknown keys unauthorized');

ok(/export const MAX_METADATA_ISSUES = 100/.test(POLICY)
  && /export const LINEAR_ALIAS_BATCH_SIZE = 20/.test(POLICY)
  && /normalizeMetadataIssueIds\(body\.issue_ids\)/.test(EDGE)
  && /too_many_issue_ids/.test(POLICY)
  && /duplicate_issue_id/.test(POLICY)
  && /for \(const batch of splitAliasBatches\(issueIds\)\)/.test(EDGE),
'metadata accepts at most 100 unique IDs and emits bounded 20-issue Linear batches');

ok(/\.from\("workload_issues"\)[\s\S]{0,180}\.select\("id,client_name,is_sub_issue,active"\)[\s\S]{0,120}\.in\("id", issueIds\)/.test(EDGE)
  && /rows\.size !== issueIds\.length/.test(EDGE)
  && /row\.active !== true \|\| row\.is_sub_issue !== true/.test(EDGE)
  && /issue_not_readable/.test(EDGE),
'metadata validates the complete request as active mirrored sub-issues before contacting Linear');
ok(/\.from\("workload_issues"\)[\s\S]{0,180}\.select\("id,client_name,is_sub_issue,active"\)[\s\S]{0,120}\.eq\("id", issueId\)/.test(EDGE)
  && /normalizeBrowserWriteClient\(row\.client_name\) !== client/.test(EDGE)
  && /issue_not_writable/.test(EDGE),
'writer validates exact normalized client scope and active sub-issue state');

ok(/Deno\.env\.get\("LINEAR_MIRROR_API_KEY"\)/.test(EDGE)
  && !/Deno\.env\.get\("LINEAR_(?:READ_)?API_KEY"\)/.test(EDGE)
  && !/LINEAR_MIRROR_API_KEY[\s\S]{0,80}\|\|/.test(EDGE),
'the gateway uses only LINEAR_MIRROR_API_KEY with no legacy or write-key fallback');
ok(/query WorkloadLinearMetadata\(/.test(EDGE)
  && /i\$\{index\}: issue\(id: \$id\$\{index\}\)/.test(EDGE)
  && /labels\(first: 50\) \{ nodes \{ name color \} pageInfo \{ hasNextPage \}/.test(EDGE)
  && /linearMetadataRow\(result\.data\[`i\$\{index\}`\], issueId\)/.test(EDGE)
  && /workload: maxWorkloadLabel\(nodesComplete \? nodes : \[\]\)/.test(POLICY),
'metadata uses GraphQL aliases and projects only deadline/update plus exact workload-label policy');
ok(/metadataSuccessReceipt\([\s\S]{0,180}metadata\.missingIssueIds,[\s\S]{0,80}metadata\.incompleteIssueIds/.test(EDGE)
  && /complete: returned === requested && missing\.length === 0 && incomplete\.length === 0/.test(POLICY)
  && /missing_issue_ids: missing/.test(POLICY)
  && /incomplete_issue_ids: incomplete/.test(POLICY)
  && /hasErrors: graphqlResponseHasErrors\(body\)/.test(EDGE)
  && /!Array\.isArray\(value\.errors\) \|\| value\.errors\.length > 0/.test(POLICY)
  && /const connectionComplete = nodesComplete && pageComplete/.test(POLICY)
  && /incomplete: !connectionComplete \|\| pageInfo\.hasNextPage !== false/.test(POLICY)
  && /if \(result\.hasErrors\)[\s\S]{0,100}incomplete\.add/.test(EDGE),
'GraphQL errors, missing aliases, and truncated label connections cannot claim a complete metadata read');

const mutationAt = EDGE.indexOf('mutation WorkloadLinearSetDueDate');
const commitAt = EDGE.indexOf('linearCommitted = true');
const mirrorCallAt = EDGE.indexOf('mirrorUpdated = await updateMirrorAfterCommit');
ok(mutationAt >= 0
  && /issueUpdate\(id: \$id, input: \$input\) \{ success issue \{ id dueDate updatedAt \}/.test(EDGE)
  && /exactDueDateAcknowledgement\([\s\S]{0,100}result\.data\.issueUpdate,[\s\S]{0,80}dueDate/.test(EDGE)
  && /value\.success !== true/.test(POLICY)
  && /!owns\(issue, "dueDate"\)/.test(POLICY)
  && /issue\.dueDate !== expectedDueDate/.test(POLICY)
  && /validRfc3339Timestamp\(issue\.updatedAt\)/.test(POLICY)
  && /linear_commit_unconfirmed/.test(EDGE),
'set_due_date requires an exact Linear issue/date acknowledgement before declaring commit');
ok(commitAt > mutationAt && mirrorCallAt > commitAt
  && /async function updateMirrorAfterCommit[\s\S]*?catch \(_error\) \{[\s\S]*?return 0;/.test(EDGE)
  && /return json\(dueDateSuccessReceipt\(/.test(EDGE),
'every post-commit mirror failure stays on the success receipt with mirror_pending');

const mirrorSegment = EDGE.slice(
  EDGE.indexOf('async function updateMirrorAfterCommit'),
  EDGE.indexOf('Deno.serve'),
);
const mirrorChain = /\.from\("workload_issues"\)\s*\.update\(\{[^;]*?due_date:\s*dueDate,[^;]*?linear_updated_at:\s*linearUpdatedAt,[^;]*?synced_at:[^;]*?\}\)\s*\.eq\("id", issue\.id\)\s*\.eq\("client_name", issue\.clientName\)\s*\.eq\("active", true\)\s*\.eq\("is_sub_issue", true\)\s*\.select\("id"\)\s*\.abortSignal\(controller\.signal\)/;
const selectCall = '.select("id")';
const detachedSelectMutant = mirrorSegment.replace(
  selectCall,
  ';\n    db.from("workload_issues")\n      ' + selectCall,
);
ok(mirrorChain.test(mirrorSegment)
  && detachedSelectMutant !== mirrorSegment
  && !mirrorChain.test(detachedSelectMutant)
  && /const MIRROR_UPDATE_TIMEOUT_MS = 2500/.test(EDGE)
  && /setTimeout\(\(\) => controller\.abort\(\), MIRROR_UPDATE_TIMEOUT_MS\)/.test(mirrorSegment)
  && /finally \{\s*clearTimeout\(timeout\);/.test(mirrorSegment)
  && /data\.length !== 1\) return 0/.test(mirrorSegment)
  && /return data\.length/.test(mirrorSegment),
'mirror count comes from select on a time-bounded update chain and requires exactly one actual row');

ok(!/calendar-upsert|sample-review-upsert|syncview_runtime_flags|webhook|n8n/i.test(EDGE)
  && !/\.from\("workload_plan"\)/.test(EDGE),
'the isolated gateway has no frozen-writer, n8n, flag, schema, or plan-sidecar fallback');
ok(/fn: "workload-linear"/.test(EDGE)
  && /requested: requestedCount/.test(EDGE)
  && /returned: returnedCount/.test(EDGE)
  && /linear_committed: linearCommitted/.test(EDGE)
  && /mirror_updated: mirrorUpdated/.test(EDGE)
  && !/console\.(?:log|warn|error)\([^)]*(?:client|issueId|dueDate|principal|label)/.test(EDGE),
'operational logs remain aggregate-only');
ok(/\| `workload-linear` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\*/.test(MANIFEST),
'deploy manifest records workload-linear as a deliberate-manual function');

if (failures) {
  console.error(`\n${failures} workload-linear source check(s) failed`);
  process.exit(1);
}
console.log('\nWorkload Linear source checks passed');
