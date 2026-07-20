'use strict';

// Backend-only source contract for editable Workload plan dates. Behavioral
// optimistic/revert coverage lives in the separate client harness; this guard
// pins the locked sidecar, auth boundary, target scope, and F141 actual-count
// rule before any live deployment.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const MIGRATION = read('migrations/2026-07-19-workload-plan.sql');
const EDGE = read('supabase/functions/workload-plan/index.ts');
const CONFIG = read('supabase/config.toml');
const THUMBNAIL_DEPLOY = read('.github/workflows/deploy-thumbnail-edge-functions.yml');
const DEPLOY_MANIFEST = read('docs/ops/EF_DEPLOY_MANIFEST.md');
const INDEX = read('index.html');
const clientWrite = INDEX.slice(
  INDEX.indexOf('async function _wlPlanWriteRequest('),
  INDEX.indexOf('async function _wlPersistPlanDate('),
);
const clientPersist = INDEX.slice(
  INDEX.indexOf('async function _wlPersistPlanDate('),
  INDEX.indexOf('async function wlSetPlanDate('),
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
const workloadPlanRoles = EDGE.slice(
  EDGE.indexOf('const WORKLOAD_PLAN_STAFF_ROLES'),
  EDGE.indexOf('const SAFE_ISSUE_ID'),
);
const workloadPlanRoleValues = [...workloadPlanRoles.matchAll(/"([^"]+)"/g)]
  .map(match => match[1]);
ok(/authorizeStaffKey\(key, WORKLOAD_PLAN_STAFF_ROLES\)/.test(EDGE)
  && /staffAuthFailureStatus\(auth\)/.test(EDGE)
  && workloadPlanRoleValues.join(',') === 'admin,smm',
'global list action is restricted to the exact Admin and SMM feature allowlist');
ok(/authorizeBrowserWrite\([\s\S]{0,180}client,[\s\S]{0,80}"workload-plan"/.test(EDGE)
  && /principal\.kind !== "staff"/.test(EDGE)
  && /!isWorkloadPlanStaffRole\(principal\.role\)/.test(EDGE)
  && /WORKLOAD_PLAN_STAFF_ROLES as readonly string\[\]/.test(EDGE),
'set action uses the same Admin/SMM allowlist and rejects Creative, client, and automation principals');
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
ok(/const \{ data, error \} = await db[\s\S]*?\.from\("workload_plan"\)[\s\S]*?\.upsert\([\s\S]*?\)[\s\S]*?\.select\("issue_id,client,plan_date,updated_at"\)[\s\S]*?const updated = Array\.isArray\(data\) \? data\.length : 0/.test(setPlanSegment)
  && /result\.updated !== 1/.test(EDGE)
  && /error: "short_write"[\s\S]{0,100}updated: result\.updated/.test(EDGE),
'F141 guard selects the written row, derives its actual count, and fails closed on a short write');
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
  && /_syncviewRequireStaffIdentity\('workload-plan'\)/.test(clientWrite)
  && /_syncviewEfHeaders\(\{ 'Content-Type': 'application\/json' \}, WORKLOAD_PLAN_URL\)/.test(clientWrite),
'browser uses only the Admin/SMM-authenticated workload-plan endpoint');
ok(/if \(capability === 'workload-plan'\) return role === 'admin' \|\| role === 'smm';/.test(INDEX)
  && /return wlState\.planStatus === 'ready' && _syncviewStaffCan\('workload-plan'\);/.test(INDEX)
  && /Work-day planning requires an Admin or SMM account/.test(INDEX),
'browser exposes plan reads and editing only to Admin and SMM identities');
ok(/action: 'set'/.test(clientWrite)
  && /issue_id: String\(issue\.id/.test(clientWrite)
  && /client: String\(issue\.clientName/.test(clientWrite)
  && /plan_date: planDate/.test(clientWrite)
  && !/\bdue_date\b/.test(clientWrite),
'browser plan payload contains stable issue, client, and plan_date but never a Linear deadline write');
ok(!/calendar-upsert|sample-review-upsert|webhook|syncview_runtime_flags/.test(clientWrite),
'plan persistence cannot fall back to a frozen writer, webhook, or runtime flag');
ok(/json\.updated !== 1/.test(clientPersist)
  && /String\(saved\.issue_id/.test(clientPersist)
  && /saved\.plan_date/.test(clientPersist)
  && /wlApplyPlanLocal\(issue\.id, previousDate\)/.test(clientPersist)
  && /showNotify\("Couldn't save the work day"/.test(clientPersist),
'browser requires one matching actual write, then reverts and notifies on every mismatch');
ok(/data-wl-plan-drag/.test(INDEX)
  && /data-wl-plan-clear/.test(INDEX)
  && /_svDateHtml\(dateId, workDate/.test(INDEX)
  && /function wlDisplayDate\(/.test(INDEX),
'UX exposes issue-specific drag, branded work-day editing, clear, and due fallback');
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
ok(!INDEX.includes('function wlEffectiveWorkDate(')
  && !INDEX.includes('function scheduleAll(')
  && !INDEX.includes('effectiveWorkDate')
  && !INDEX.includes('scheduledDate'),
'editable plan mode does not restore the automatic scheduler');

if (failures) {
  console.error('\n' + failures + ' workload-plan source check(s) failed');
  process.exit(1);
}
console.log('\nWorkload plan backend source checks passed');
