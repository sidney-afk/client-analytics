'use strict';

// Backend-only source contract for editable Workload plan dates. Behavioral
// optimistic/revert coverage lives in the separate client harness; this guard
// pins the locked sidecar, auth boundary, target scope, and actual-count rule
// before any live deployment.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const MIGRATION = read('migrations/2026-07-19-workload-plan.sql');
const EDGE = read('supabase/functions/workload-plan/index.ts');
const CONFIG = read('supabase/config.toml');
const THUMBNAIL_DEPLOY = read('.github/workflows/deploy-thumbnail-edge-functions.yml');
const DEPLOY_MANIFEST = read('docs/ops/EF_DEPLOY_MANIFEST.md');
const INDEX = read('index.html');
const clientIssueRead = INDEX.slice(
  INDEX.indexOf('async function loadLinearIssues('),
  INDEX.indexOf('// Date helpers'),
);
const clientRead = INDEX.slice(
  INDEX.indexOf('async function wlFetchPlanRows('),
  INDEX.indexOf('async function wlFetchLinearMetadata('),
);
const clientMetadataRead = INDEX.slice(
  INDEX.indexOf('async function wlFetchLinearMetadata('),
  INDEX.indexOf('function wlAdoptLinearMetadata('),
);
const clientWrite = INDEX.slice(
  INDEX.indexOf('async function _wlPlanWriteRequest('),
  INDEX.indexOf('async function _wlDueWriteRequest('),
);
const clientPersist = INDEX.slice(
  INDEX.indexOf('async function _wlPersistPlanDate('),
  INDEX.indexOf('async function wlSetPlanDate('),
);
const clientSet = INDEX.slice(
  INDEX.indexOf('async function wlSetPlanDate('),
  INDEX.indexOf('async function wlMovePlanGroup('),
);
const clientDueWrite = INDEX.slice(
  INDEX.indexOf('async function _wlDueWriteRequest('),
  INDEX.indexOf('async function wlSetDueDate('),
);
const clientDueSet = INDEX.slice(
  INDEX.indexOf('async function wlSetDueDate('),
  INDEX.indexOf('// Workload fail-closed boundary.'),
);
const clientGroupMove = INDEX.slice(
  INDEX.indexOf('async function wlMovePlanGroup('),
  INDEX.indexOf('// Single delegated handler on the shell root.'),
);
const dayRollups = INDEX.slice(
  INDEX.indexOf('function renderDayRollups('),
  INDEX.indexOf('const WL_TWEAK_COMMENTS_TTL_MS'),
);
const issueCards = INDEX.slice(
  INDEX.indexOf('function wlRenderPlanIssueCards('),
  INDEX.indexOf('function renderDayRollups('),
);
const timelineTrack = INDEX.slice(
  INDEX.indexOf('function wlRenderTimelineTrack('),
  INDEX.indexOf('function renderWeekDeadlineTimeline('),
);
const issueDragHandle = INDEX.slice(
  INDEX.indexOf('function wlIssueDragHandleHtml('),
  INDEX.indexOf('function wlGroupDragHandleHtml('),
);
const groupDragHandle = INDEX.slice(
  INDEX.indexOf('function wlGroupDragHandleHtml('),
  INDEX.indexOf('function wlWorkloadMeta('),
);
const watermarkSource = INDEX.slice(
  INDEX.indexOf('async function _wlV2FetchLatestWatermark('),
  INDEX.indexOf('window.wlV2Status'),
);
const rollupPopover = INDEX.slice(
  INDEX.indexOf('function wlOpenRollupPopover('),
  INDEX.indexOf('function wlApplySpotlight('),
);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL workload-plan-source: ' + message);
  }
}

ok(/create table if not exists public\.workload_plan/.test(MIGRATION)
  && /issue_id text primary key/.test(MIGRATION)
  && /client text not null/.test(MIGRATION)
  && /plan_date date/.test(MIGRATION)
  && /updated_by text not null/.test(MIGRATION)
  && /updated_at timestamptz not null default now\(\)/.test(MIGRATION),
'migration creates the isolated plan sidecar with stable identity and attribution');
ok(!/references\s+public\.workload_issues/i.test(MIGRATION),
  'rebuildable workload_issues is not a foreign-key owner of staff plan rows');
ok(/alter table public\.workload_plan enable row level security/.test(MIGRATION)
  && /revoke all on table public\.workload_plan from public, anon, authenticated/.test(MIGRATION)
  && /grant select, insert, update on table public\.workload_plan to service_role/.test(MIGRATION)
  && /revoke delete, truncate, references, trigger on table public\.workload_plan from service_role/.test(MIGRATION),
  'sidecar is service-role-only with RLS enabled');
ok(!/create policy/i.test(MIGRATION)
  && !/grant\s+(?:all|select|insert|update|delete)[\s\S]{0,80}\b(?:anon|authenticated)\b/i.test(MIGRATION),
'migration creates no browser read or write policy/grant');
ok(!/alter table public\.workload_issues/i.test(MIGRATION)
  && !/syncview_runtime_flags/i.test(MIGRATION),
'migration does not modify the Linear mirror or any runtime flag');

ok(!/\[functions\.workload-plan\]/.test(CONFIG)
  && /-\s+['"]supabase\/config\.toml['"]/.test(THUMBNAIL_DEPLOY)
  && /\| `workload-plan` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\*[\s\S]*`--no-verify-jwt`/.test(DEPLOY_MANIFEST),
  'manual-only function stays out of shared config and cannot trigger unrelated thumbnail deploys');

for (const header of [
  'x-syncview-key',
  'x-syncview-actor',
  'x-syncview-role',
  'x-syncview-source',
  'x-syncview-client-token',
]) {
  ok(EDGE.includes(header), 'CORS includes ' + header);
}
const workloadPlanReadRoles = EDGE.slice(
  EDGE.indexOf('const WORKLOAD_PLAN_READ_ROLES'),
  EDGE.indexOf('const WORKLOAD_PLAN_WRITE_ROLES'),
);
const workloadPlanWriteRoles = EDGE.slice(
  EDGE.indexOf('const WORKLOAD_PLAN_WRITE_ROLES'),
  EDGE.indexOf('const SAFE_ISSUE_ID'),
);
const workloadPlanReadRoleValues = [...workloadPlanReadRoles.matchAll(/"([^"]+)"/g)]
  .map(match => match[1]);
const workloadPlanWriteRoleValues = [...workloadPlanWriteRoles.matchAll(/"([^"]+)"/g)]
  .map(match => match[1]);
ok(/authorizeStaffKey\(key, WORKLOAD_PLAN_READ_ROLES\)/.test(EDGE)
  && /staffAuthFailureStatus\(auth\)/.test(EDGE)
  && workloadPlanReadRoleValues.join(',') === 'admin,smm,creative',
'global list action is restricted to the exact Admin, SMM, and Creative read allowlist');
ok(/authorizeBrowserWrite\([\s\S]{0,180}client,[\s\S]{0,80}"workload-plan"/.test(EDGE)
  && /principal\.kind !== "staff"/.test(EDGE)
  && /!isWorkloadPlanWriteRole\(principal\.role\)/.test(EDGE)
  && /WORKLOAD_PLAN_WRITE_ROLES as readonly string\[\]/.test(EDGE)
  && workloadPlanWriteRoleValues.join(',') === 'admin,smm',
'set action uses the exact Admin/SMM write allowlist and rejects Creative, client, and automation principals');

// Execute the production role-key helper with dummy-only secrets so the split
// is behavioral, not just a source spelling assertion. The writer still uses
// authorizeBrowserWrite in production; this matrix pins the role decision it
// receives after that shared authentication step.
const helperUrl = pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/staff-role-auth.ts')).href
  + '?workload-plan-source';
const authRunner = `
  const { authorizeStaffKey, staffAuthFailureStatus } = await import(${JSON.stringify(helperUrl)});
  const secrets = {
    ROLE_KEY_ADMIN: 'dummy-admin',
    ROLE_KEY_SMM: 'dummy-smm',
    ROLE_KEY_CREATIVE: 'dummy-creative',
  };
  const getSecret = name => secrets[name];
  const readRoles = ${JSON.stringify(workloadPlanReadRoleValues)};
  const writeRoles = ${JSON.stringify(workloadPlanWriteRoleValues)};
  const result = (key, roles) => {
    const auth = authorizeStaffKey(key, roles, [], getSecret);
    return { ...auth, status: auth.ok ? 200 : staffAuthFailureStatus(auth) };
  };
  process.stdout.write(JSON.stringify({
    read: {
      admin: result('dummy-admin', readRoles),
      smm: result('dummy-smm', readRoles),
      creative: result('dummy-creative', readRoles),
      wrong: result('dummy-wrong', readRoles),
      empty: result('', readRoles),
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
ok(authChild.status === 0, `could not execute workload plan role matrix: ${authChild.stderr || authChild.stdout}`);
const authMatrix = authChild.status === 0 ? JSON.parse(authChild.stdout) : null;
ok(authMatrix
  && ['admin', 'smm', 'creative'].every(role => authMatrix.read[role].ok && authMatrix.read[role].status === 200)
  && ['admin', 'smm'].every(role => authMatrix.write[role].ok && authMatrix.write[role].status === 200)
  && !authMatrix.write.creative.ok && authMatrix.write.creative.status === 403
  && !authMatrix.read.wrong.ok && authMatrix.read.wrong.status === 401
  && !authMatrix.read.empty.ok && authMatrix.read.empty.status === 401,
'production staff auth allows Creative to read while write remains Admin/SMM-only');
ok(!/req\.headers\.get\(["']x-syncview-(?:actor|role)["']\)/i.test(EDGE)
  && /updated_by: principal\.actor/.test(EDGE),
'writer ignores spoofable actor/role metadata and stores the server principal');

ok(/\.from\("workload_issues"\)[\s\S]{0,180}\.select\("id,client_name,is_sub_issue,active"\)[\s\S]{0,180}\.eq\("id", issueId\)/.test(EDGE)
  && /target\.active !== true/.test(EDGE)
  && /target\.is_sub_issue !== true/.test(EDGE)
  && /normalizeBrowserWriteClient\(target\.client_name\) !== client/.test(EDGE),
'writer validates the exact active sub-issue and normalized client before mutation');
const mirrorOccurrences = [...EDGE.matchAll(/\.from\("workload_issues"\)/g)];
const mirrorChains = [...EDGE.matchAll(/\.from\("workload_issues"\)[\s\S]*?;/g)]
  .map(match => match[0]);
ok(mirrorChains.length >= 1
  && mirrorChains.length === mirrorOccurrences.length
  && mirrorChains.every(chain => (
    chain.includes('.select(')
    && !/\.(?:insert|update|upsert|delete)\s*\(/.test(chain)
  )),
'every workload_issues access chain in the complete function is read-only');

ok(/\.from\("workload_plan"\)[\s\S]{0,180}\.upsert\(\{[\s\S]{0,280}plan_date: planDate[\s\S]{0,160}updated_by: principal\.actor/.test(EDGE),
  'set and clear both write only the sidecar, with null retained as an explicit clear');
const setPlanSegment = EDGE.slice(
  EDGE.indexOf('async function setPlan'),
  EDGE.indexOf('Deno.serve'),
);
const trueCountWriteChain = /\.from\("workload_plan"\)\s*\.upsert\(\{[^;]*?plan_date:\s*planDate,[^;]*?updated_by:\s*principal\.actor[^;]*?\},\s*\{\s*onConflict:\s*"issue_id"\s*\}\)\s*\.select\("issue_id,client,plan_date,updated_at"\)/;
const selectCall = '.select("issue_id,client,plan_date,updated_at")';
const detachedSelectMutant = setPlanSegment.replace(
  selectCall,
  ';\n  db.from("workload_plan")\n    ' + selectCall,
);
ok(trueCountWriteChain.test(setPlanSegment)
  && detachedSelectMutant !== setPlanSegment
  && !trueCountWriteChain.test(detachedSelectMutant)
  && /const updated = Array\.isArray\(data\) \? data\.length : 0/.test(setPlanSegment)
  && /result\.updated !== 1/.test(EDGE)
  && /error: "short_write"[\s\S]{0,100}updated: result\.updated/.test(EDGE),
'true-count guard selects the written row on the upsert chain and fails closed on a short write');
ok(!/updated\s*:\s*1\b/.test(EDGE)
  && !/updated\s*:\s*(?:requested|items?\.length|parsed)/.test(EDGE),
'function never reports a literal or requested success count');

ok(/const LIST_PAGE_SIZE = 1000/.test(EDGE)
  && /const MAX_LIST_PAGES = 50/.test(EDGE)
  && /\.not\("plan_date", "is", null\)/.test(EDGE)
  && /\.order\("issue_id", \{ ascending: true \}\)/.test(EDGE)
  && /\.limit\(LIST_PAGE_SIZE\)/.test(EDGE)
  && /query = query\.gt\("issue_id", afterIssueId\)/.test(EDGE)
  && /throw new WorkloadPlanError\(503, "plan_list_limit"\)/.test(EDGE),
'staff projection keyset-pages non-null overrides and refuses partial-list success');
ok(!/\bfetch\s*\(/.test(EDGE)
  && !/webhook\//.test(EDGE)
  && !/functions\/v1\//.test(EDGE),
'function has no Linear, n8n, or secondary writer fallback');
ok(/console\.log\(JSON\.stringify\(\{[\s\S]{0,180}fn: "workload-plan"[\s\S]{0,180}updated: writeCount/.test(EDGE)
  && /let action = "invalid"/.test(EDGE)
  && /const requestedAction = clean\(body\.action\)\.toLowerCase\(\)/.test(EDGE)
  && /action = requestedAction/.test(EDGE)
  && !/console\.(?:log|warn|error)\([^)]*(?:client|issueId|planDate|principal)/.test(EDGE),
'operational logging stays aggregate-only and never echoes an invalid caller action');

ok(/const WORKLOAD_PLAN_URL\s*=\s*CAL_SUPABASE_URL \+ '\/functions\/v1\/workload-plan'/.test(INDEX)
  && INDEX.indexOf('const CAL_SUPABASE_URL') < INDEX.indexOf('const WORKLOAD_PLAN_URL')
  && /_syncviewRequireStaffIdentity\('workload-plan-read'\)/.test(clientRead)
  && /_syncviewEfHeaders\(\{ 'Content-Type': 'application\/json' \}, WORKLOAD_PLAN_URL\)/.test(clientRead)
  && /body: JSON\.stringify\(\{ action: 'list' \}\)/.test(clientRead)
  && !/action: 'set'/.test(clientRead)
  && /_syncviewRequireStaffIdentity\('workload-plan'\)/.test(clientWrite)
  && /_syncviewEfHeaders\(\{ 'Content-Type': 'application\/json' \}, WORKLOAD_PLAN_URL\)/.test(clientWrite),
'browser uses the staff-readable projection and the Admin/SMM-authenticated writer on the workload-plan endpoint');
ok(/if \(capability === 'workload-plan-read'\) return role === 'admin' \|\| role === 'smm' \|\| role === 'creative';/.test(INDEX)
  && /if \(capability === 'workload-plan'\) return role === 'admin' \|\| role === 'smm';/.test(INDEX)
  && /return wlState\.planStatus === 'ready' && _syncviewStaffCan\('workload-plan'\);/.test(INDEX)
  && /Work-day planning requires an Admin or SMM account/.test(INDEX),
'browser exposes authoritative plan reads to staff while keeping editing Admin/SMM-only');
ok(/const WORKLOAD_LINEAR_URL\s*=\s*CAL_SUPABASE_URL \+ '\/functions\/v1\/workload-linear'/.test(INDEX)
  && /_syncviewRequireStaffIdentity\('workload-linear-read'\)/.test(clientMetadataRead)
  && /action: 'metadata', issue_ids: chunk/.test(clientMetadataRead)
  && /index \+= 100/.test(clientMetadataRead)
  && /Math\.min\(3, chunks\.length\)/.test(clientMetadataRead)
  && /json\.complete !== true/.test(clientMetadataRead)
  && /if \(capability === 'workload-linear-read'\) return role === 'admin' \|\| role === 'smm' \|\| role === 'creative';/.test(INDEX)
  && /if \(capability === 'workload-linear'\) return role === 'admin' \|\| role === 'smm';/.test(INDEX),
'Workload metadata is bounded and readable by all staff while Linear due writes remain Admin/SMM-only');
ok(/if \(_wlV2Ready\(\) && !force\)/.test(clientIssueRead)
  && /const url = force[\s\S]*LINEAR_ISSUES_WEBHOOK/.test(clientIssueRead)
  && /cache: 'no-store'/.test(clientIssueRead),
'forced Workload refresh bypasses the scheduled mirror and reads Linear without browser cache');
ok(/usedFallback: true/.test(INDEX)
  && /const payload = await wlLoadSnapshot\(true, null\)/.test(INDEX)
  && /payload\.usedFallback !== true/.test(INDEX),
'silent refresh reports success only when the forced issue fetch did not fall back to stale state');
ok(/action: 'set'/.test(clientWrite)
  && /issue_id: String\(issue\.id/.test(clientWrite)
  && /client: String\(issue\.clientName/.test(clientWrite)
  && /plan_date: planDate/.test(clientWrite)
  && !/\bdue_date\b/.test(clientWrite),
'browser plan payload contains stable issue, client, and plan_date but never a Linear deadline write');
ok(!/calendar-upsert|sample-review-upsert|webhook|syncview_runtime_flags/.test(clientWrite),
'plan persistence cannot fall back to a frozen writer, webhook, or runtime flag');
ok(/workload\.label === '2× Workload' \|\| workload\.label === '3× Workload'/.test(INDEX)
    && /weight === 2 \|\| weight === 3/.test(INDEX)
    && /function wlWorkloadWeight\(/.test(INDEX)
    && /wlTeamBucket\(sub && sub\.teamKey, sub && sub\.teamName\) !== 'video'/.test(INDEX)
    && !/function wlPriorityValue\(|function wlPriorityIconHtml\(|priorityByIssueId/.test(INDEX),
'exact Workload labels replace native Linear priority and only weight video capacity');
ok(/_syncviewRequireStaffIdentity\('workload-linear'\)/.test(clientDueWrite)
    && /action: 'set_due_date'/.test(clientDueWrite)
    && /issue_id: String\(issue\.id/.test(clientDueWrite)
    && /client: String\(issue\.clientName/.test(clientDueWrite)
    && /due_date: dueDate/.test(clientDueWrite)
    && !/WORKLOAD_PLAN_URL|calendar-upsert|sample-review-upsert|webhook|syncview_runtime_flags/.test(clientDueWrite),
'Linear due-date writes use only the isolated Workload endpoint with stable issue and client scope');
ok(/const exactAck = resp\.ok/.test(clientDueSet)
    && /json\.linear_committed === true/.test(clientDueSet)
    && /hasOwnProperty\.call\(json, 'due_date'\)/.test(clientDueSet)
    && /String\(json\.issue_id \|\| ''\) === key/.test(clientDueSet)
    && /acknowledgedDate === dueDate/.test(clientDueSet)
    && /wlValidRfc3339Timestamp\(updatedAt\)/.test(clientDueSet)
    && /function wlValidRfc3339Timestamp\(/.test(INDEX)
    && /mirrorUpdated === 0 \|\| mirrorUpdated === 1/.test(clientDueSet)
    && /mirrorPending === \(mirrorUpdated === 0\)/.test(clientDueSet)
    && /wlApplyDueLocal\(key, previousDate\)/.test(clientDueSet)
    && /Couldn't update the Linear due date/.test(clientDueSet)
    && /json\.mirror_pending/.test(clientDueSet)
    && /Workload is catching up/.test(clientDueSet),
'browser accepts only an exact Linear acknowledgement, reverts every failure, and keeps a committed mirror-pending date');
ok(/json\.updated !== 1/.test(clientPersist)
  && /String\(saved\.issue_id/.test(clientPersist)
  && /saved\.plan_date/.test(clientPersist)
  && /wlApplyPlanLocal\(issue\.id, previousDate\)/.test(clientPersist)
  && /showNotify\("Couldn't save the work day"/.test(clientPersist),
'browser requires one matching actual write, then reverts and notifies on every mismatch');
ok(/data-wl-drag-handle="issue"/.test(issueDragHandle)
  && /draggable="true"/.test(issueDragHandle)
  && /data-wl-plan-drag=/.test(issueDragHandle)
  && /data-wl-drag-handle="group"/.test(groupDragHandle)
  && /draggable="true"/.test(groupDragHandle)
  && /data-wl-plan-group-drag/.test(groupDragHandle)
  && /wlIssueDragHandleHtml\(issueId, canDrag\)/.test(issueCards)
  && /wlGroupDragHandleHtml\(dayISO, ed\.assigneeId, g\.clientName, canDragGroup\)/.test(dayRollups)
  && /wlGroupDragHandleHtml\(track\.planDate, editor\.assigneeId, track\.clientName, canDragGroup\)/.test(timelineTrack)
  && !/<button type="button" class="workload-plan-item[^>]*(?:draggable=|data-wl-plan-drag)/.test(issueCards)
  && !/<summary class="workload-day-card-chip[^>]*(?:draggable=|data-wl-plan-group-drag)/.test(dayRollups)
  && !/<summary class="workload-timeline-plan-chip[^>]*(?:draggable=|data-wl-plan-group-drag)/.test(timelineTrack)
  && !/data-wl-plan-clear/.test(dayRollups)
  && /data-wl-due-issue/.test(rollupPopover)
  && /_svDateHtml\(dateId, s\.dueDate \|\| ''/.test(rollupPopover)
  && /Linear due date/.test(rollupPopover)
  && /explicitPlan \?/.test(rollupPopover)
  && /data-wl-plan-clear/.test(rollupPopover)
  && /Use automatic plan/.test(rollupPopover)
  && /function wlDisplayDate\(/.test(INDEX)
  && /function wlPlacementMode\(/.test(INDEX),
 'UX limits drag to dedicated handles while preserving branded due-date editing and a visible automatic-plan reset');
ok(/!issues\.length \|\| !wlPlanEditingEnabled\(\)/.test(clientGroupMove)
  && /issues\.some\(issue => wlIsTweaksNeeded\(issue\) \|\| _wlPlanWriteInFlight\.has/.test(clientGroupMove)
  && /for \(const move of moves\)[\s\S]*?await _wlPersistPlanDate\([\s\S]*?true[\s\S]*?\);/.test(clientGroupMove)
  && !/Promise\.all|_wlPlanWriteRequest|action:\s*['"]batch['"]/.test(clientGroupMove)
  && /Moved \$\{moved\} of \$\{moves\.length\} — \$\{moves\.length - moved\} put back/.test(clientGroupMove),
'collapsed group drag stays Admin/SMM-gated, tweak-exclusive, sequential, and aggregate-notified through the one-row writer');
ok(/rollupEl\.setAttribute\('aria-expanded', 'true'\)/.test(INDEX)
  && /anchor\.setAttribute\('aria-expanded', 'false'\)/.test(INDEX)
  && /pop\.querySelector\('\[data-wl-popover-close\]'\)/.test(INDEX)
  && /id="wlTitle" tabindex="-1"/.test(INDEX)
  && /const title = document\.getElementById\('wlTitle'\)/.test(INDEX),
'popover focus enters the dialog, expanded state is exposed, and off-screen moves keep focus in Workload');
ok(/planStatus === 'ready'/.test(INDEX)
  && /last good plan is shown; editing is paused/.test(INDEX)
  && /Deadlines are shown as a clearly marked fallback; editing is disabled/.test(INDEX),
'failed plan reads never masquerade as an authoritative empty override map');
ok(/if \(cache\) \{\s*wlApplyData\(cache\.issues, cache\.fetchedAt\);\s*renderWorkloadAll\(\);/.test(INDEX)
  && !/if \(cache && wlState\.planHasSnapshot\)/.test(INDEX),
'cached Phase-1 due dates paint immediately while the sidecar is unavailable');
ok(/const WL_PLAN_READ_TIMEOUT_MS = 8000/.test(INDEX)
  && /const controller = new AbortController\(\)/.test(INDEX)
  && /signal: controller\.signal/.test(INDEX),
'plan projection reads are bounded so a hung function cannot strand the board on a skeleton');
ok(/const WL_PLAN_WRITE_TIMEOUT_MS = 10000/.test(INDEX)
  && /setTimeout\(\(\) => controller\.abort\(\), WL_PLAN_WRITE_TIMEOUT_MS\)/.test(clientWrite)
  && /signal: controller\.signal/.test(clientWrite)
  && /clearTimeout\(timeout\)/.test(clientWrite),
'plan writes are bounded so a stalled save reaches the existing revert-and-notify path');
ok(/order=synced_at\.desc&limit=1/.test(watermarkSource)
  && /WL_V2_WATERMARK_POLL_MS = 60 \* 1000/.test(INDEX)
  && /Date\.parse\(latest\) > Date\.parse\(wlState\.sourceSyncedAt\)/.test(watermarkSource)
  && /const refreshed = await wlRefetchSilent\(\)/.test(watermarkSource)
  && /refreshed === true\) wlState\.sourceSyncedAt = latest/.test(watermarkSource)
  && /setInterval\(_wlV2CheckWatermark, WL_V2_WATERMARK_POLL_MS\)/.test(watermarkSource)
  && /clearInterval\(_wlV2WatermarkTimer\)/.test(watermarkSource)
  && /syncedAt: r\.synced_at/.test(INDEX),
'foreground Workload polling is bound to the mirror watermark and is torn down with the view');
ok(/function wlPurgePlanSensitiveState\(/.test(INDEX)
  && /_wlPlanSessionGeneration\+\+/.test(INDEX)
  && /_wlPlanLoadGeneration\+\+/.test(INDEX)
  && /wlState\.planByIssueId\.clear\(\)/.test(INDEX)
  && /status === 401[\s\S]{0,120}_syncviewStaffIdentityClear\(\)/.test(INDEX)
  && /status === 403[\s\S]{0,120}wlPurgePlanSensitiveState\(\)/.test(INDEX)
  && /typeof wlPurgePlanSensitiveState === 'function'/.test(INDEX),
'staff identity transitions and server auth denials purge the private projection');
ok(/_wlPlanLastWriteGeneration/.test(INDEX)
  && /writeGeneration > readGeneration/.test(INDEX)
  && /loadGeneration !== _wlPlanLoadGeneration/.test(INDEX)
  && /wlResetPlanDisplay\(key\)/.test(INDEX),
'overlapping plan loads, late lists, and no-op picker changes cannot leave false local dates');
ok(!/previousDate === null\s*&&\s*planDate === \(issue\.dueDate \|\| null\)/.test(clientSet),
'selecting an automatic card\'s current day is persisted as an explicit manual pin');
ok(/function wlAutoPlanDate\(/.test(INDEX)
    && /wlSubWorkingDays\([^,]+,\s*1\)/.test(INDEX)
    && /planHasSnapshot/.test(INDEX)
    && !INDEX.includes('function wlEffectiveWorkDate(')
    && !INDEX.includes('function scheduleAll(')
    && !INDEX.includes('effectiveWorkDate')
    && !INDEX.includes('scheduledDate')
    && !/assignedByEditorDate|findEarliestAvailableDay|remainingCapacity/.test(INDEX),
'hybrid mode derives only an item-local due-minus-one-working-day default and never restores packing or spilling');

if (failures) {
  console.error('\n' + failures + ' workload-plan source check(s) failed');
  process.exit(1);
}
console.log('\nWorkload plan backend source checks passed');
