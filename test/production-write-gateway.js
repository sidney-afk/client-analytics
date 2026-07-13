'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const edge = read('supabase/functions/production-write/index.ts');
const lowLevel = read('supabase/functions/_shared/b4-write.ts');
const migration = read('migrations/2026-07-12-write-ui-outbox-parity.sql');
const inbound = read('supabase/functions/linear-inbound/index.ts');
const config = read('supabase/config.toml');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT,
    'supabase',
    'functions',
    'production-write',
    'policy.mjs',
  )).href);

  ok(policy.normalizeOperation('status') === 'status'
    && policy.normalizeOperation('comment') === 'comment'
    && policy.normalizeOperation('due') === 'due'
    && policy.normalizeOperation('assignee') === 'assignee'
    && policy.normalizeOperation('intake_create') === 'intake_create'
    && policy.normalizeOperation('archive') === '',
  'gateway exposes only the five epoch operations');

  ok(policy.roleCompatible('admin', 'admin')
    && policy.roleCompatible('smm', 'smm')
    && policy.roleCompatible('creative', 'editor')
    && policy.roleCompatible('creative', 'designer')
    && !policy.roleCompatible('smm', 'admin'),
  'staff key family must match the active roster role');

  ok(policy.staffOperationAllowed('creative', 'comment', 'VID', 'video')
    && policy.staffOperationAllowed('creative', 'status', 'video', 'VID', 'smm_approval')
    && !policy.staffOperationAllowed('creative', 'status', 'video', 'video', 'client_approval')
    && !policy.staffOperationAllowed('creative', 'assignee', 'video', 'video')
    && !policy.staffOperationAllowed('creative', 'comment', 'video', 'graphics'),
  'creative writes are limited to own-team work/status/comment');

  ok(policy.clientOperationAllowed('comment', 'client_approval', '')
    && policy.clientOperationAllowed('status', 'client_approval', 'approved')
    && policy.clientOperationAllowed('status', 'tweak', 'tweak')
    && !policy.clientOperationAllowed('status', 'smm_approval', 'approved')
    && !policy.clientOperationAllowed('due', 'client_approval', ''),
  'client token permits only own-thread comments and client-legal transitions');

  ok(policy.legacyParityAllowed('calendar', 'status')
    && policy.legacyParityAllowed('calendar', 'comment')
    && policy.legacyParityAllowed('sxr', 'status')
    && policy.legacyParityAllowed('submission', 'intake_create')
    && !policy.legacyParityAllowed('production', 'status')
    && !policy.legacyParityAllowed('calendar', 'due'),
  'legacy parity is a closed surface/operation allowlist');

  ok(JSON.stringify(policy.projectIdsForTeam({ video: 'project-v', graphics: { id: 'project-g' } }, 'VID'))
      === JSON.stringify(['project-v'])
    && JSON.stringify(policy.projectIdsForTeam([{ team: 'GRA', project_id: 'project-g' }], 'graphics'))
      === JSON.stringify(['project-g'])
    && policy.projectIdsForTeam(['legacy-a', 'legacy-b'], 'video').length === 0,
  'only tagged native project mappings are accepted without Linear validation');

  ok(JSON.stringify(policy.configuredProjectIds(['legacy-a', { id: 'legacy-b' }]))
      === JSON.stringify(['legacy-a', 'legacy-b']),
  'legacy untagged native project ids remain discoverable for read-only validation');

  const id1 = await policy.deterministicNativeId('del', 'request-123', 'video:0');
  const id2 = await policy.deterministicNativeId('del', 'request-123', 'video:0');
  const id3 = await policy.deterministicNativeId('del', 'request-123', 'video:1');
  ok(id1 === id2 && id1 !== id3 && /^del_[0-9a-f-]{36}$/.test(id1),
    'native ids are deterministic per request/item without minting a human identifier');

  ok(policy.validRequestId('epoch-write-0001') === 'epoch-write-0001'
    && policy.validRequestId('short') === ''
    && policy.validRequestId('../unsafe-value') === '',
  'dedup request ids are bounded and syntax checked');
  ok(policy.validDateOrNull('2026-02-28')
    && policy.validDateOrNull('2024-02-29')
    && !policy.validDateOrNull('2026-02-29')
    && !policy.validDateOrNull('2026-02-31'),
  'due dates must be real UTC calendar dates');

  ok(/if \(key && token\) throw new GatewayError\(401, "ambiguous_credentials"\)/.test(edge),
    'both-auth-header ambiguity is rejected');
  ok(/matchingRoleForKey\(key\)/.test(edge)
    && /normalizeActor\(req\.headers\.get\("x-syncview-actor"\)\)/.test(edge)
    && /matches\.length !== 1/.test(edge)
    && !/body\.(actor|member_id)/.test(edge),
  'staff auth uses the secret family plus one exact compatible active roster actor only');
  ok(/\.from\("client_access"\)[\s\S]{0,180}\.select\("slug,review_token"\)/.test(edge)
    && /timingSafeEqual\(token, stored\)/.test(edge)
    && /client_scope_mismatch/.test(edge),
  'client tokens are timing-safe and scoped to the target client');
  ok(/actorName: clean\(client\.display_name\)/.test(edge)
    && /actorKey: `client:\$\{client\.slug\}`/.test(edge)
    && /author_name: principal\.actorName/.test(edge)
    && /author_key: principal\.actorKey/.test(edge),
  'client comments use a stable server-side client principal, never free text or transport');
  ok(!/auth_enforcement/.test(edge),
    'global permissive auth cannot weaken the fail-closed gateway');
  ok(/deriveBrowserTestScope/.test(edge)
    && /lower\(client\.kind\) !== "test"/.test(edge)
    && /uniqueActiveTestClient/.test(edge),
  'staff/client TEST mode is derived from an active TEST client and service drills can resolve the unique TEST row');
  ok(/B4_TEST_PROJECT_BY_TEAM/.test(edge)
    && /!projectId \|\| !allowlist\.has\(projectId\)/.test(edge)
    && /test_project_mapping_unavailable/.test(edge),
  'TEST intake uses one secret-selected allowlisted project per team and fails closed when absent');

  ok(/\.eq\("key", "prod_authority"\)/.test(edge)
    && /authority_unavailable/.test(edge)
    && /surface === "production"[\s\S]{0,100}team_is_linear_authoritative/.test(edge),
  'server authority is mandatory and Production stays blocked under Linear authority');
  ok(/body\.legacy_parity === true/.test(edge)
    && /legacyParityAllowed\(surface, operation\)/.test(edge)
    && /legacy_parity: legacyParity/.test(edge),
  'legacy parity is requested by the caller but derived and stamped by the server');
  ok(/requestedParity[\s\S]{0,260}authority !== "linear"[\s\S]{0,100}legacy_parity_not_allowed/.test(edge)
    && /linear_legacy_parity_enabled/.test(edge),
  'stale parity requests are rejected after flip and the independent parity gate fails closed');

  ok(/rpc\(supabase, "production_deliverable_write"/.test(edge)
    && /rpc\(supabase, "production_batch_write"/.test(edge)
    && /rpc\(supabase, "production_comment_write"/.test(edge),
  'all native changes use the ledger/outbox RPC family');
  ok(/actor: principal\.actorName/.test(edge)
    && /role: principal\.actorRole/.test(edge)
    && /ts: sourceEditedAt/.test(edge)
    && /source: "ui"/.test(edge),
  'events persist the authenticated actor, roster role, source, and edit clock');
  ok(/transport_actor: "production-write"/.test(edge)
    && /transport_role: "gateway"/.test(edge)
    && /production_comment_write/.test(edge),
  'comment transport identity stays separate from the stable author snapshot');

  ok(/target_dedup_key: dedup[\s\S]{0,120}legacy_parity: true[\s\S]{0,120}WRITE_UI_LEGACY_PARITY/.test(edge)
    && /target_dedup_key: dedup[\s\S]{0,180}test_override:[\s\S]{0,140}B4_TEST_ONLY/.test(edge),
  'parity and TEST writes invoke only the targeted service-authenticated drainer forms');
  ok(/const target = parseJson\(result\.target\)/.test(edge)
    && /targetStatus === "written"/.test(edge)
    && /already_applied/.test(edge)
    && /acknowledged: response\.ok && result\.ok === true && terminal/.test(edge),
  'targeted drain acknowledges only a proven terminal target');
  ok(/mirror_pending: mirrorPending/.test(edge) && /native_committed: true/.test(edge),
    'a committed native write reports mirror-pending state explicitly');

  const validationPos = edge.indexOf('await projectForIntake(client, team, principal)');
  const firstWritePos = edge.indexOf('const batch = await ensureBatch(');
  ok(/project\(id: \$id\) \{ id name teams \{ nodes \{ id key \} \} \}/.test(edge)
    && /projects\(first: 100, after: \$after/.test(edge)
    && /configuredProjectIds\(client\.linear_project_ids\)/.test(edge)
    && validationPos > 0 && firstWritePos > validationPos,
  'untagged configured projects are read-only validated by Linear team before any native write');
  ok(/matching\.length !== 1/.test(edge) && /project_mapping_ambiguous/.test(edge),
    'missing or ambiguous project/team mappings fail closed');
  ok(/LINEAR_VIDEO_TEAM_ID/.test(edge) && /LINEAR_GRAPHICS_TEAM_ID/.test(edge),
    'optional team UUIDs come from Edge secrets, never source literals');
  ok(/identifier: null/.test(edge)
    && !/production_identifier_next|VID-\$|GRA-\$/.test(edge),
  'Part 2 intake does not invent the deferred native human identifier');
  ok(/deterministicNativeId\("bat"/.test(edge)
    && /deterministicNativeId\("del"/.test(edge)
    && /childOutbound\.depends_on_id = parentOutboxByTeam\[itemTeam\]/.test(edge),
  'intake is idempotent and preserves parent-before-child outbox dependency');
  ok(/autoAssigneeForIntake/.test(edge)
    && /\.neq\("status", "duplicate"\)/.test(edge)
    && /default_for_team/.test(edge)
    && /intake_assignee_override_not_allowed/.test(edge),
  'intake uses server-side video load balancing and the unique graphics default');
  ok(/team: teamList\.length === 1 \? teamList\[0\] : null/.test(edge)
    && /const parentPlans: JsonMap\[\]/.test(edge)
    && /production_batch_intent_write/.test(edge)
    && /parityByTeam\[team\] = !principal\.testOnly && authorityByTeam\[team\] === "linear"/.test(edge)
    && /parentOutboxByTeam\[itemTeam\]/.test(edge),
  'mixed intake creates one nullable-team batch with independent team parents and child dependencies');
  ok(/post-linkage version/.test(edge)
    && /currentItemsById/.test(edge)
    && /items: currentResponseItems/.test(edge),
  'intake returns post-linkage updated_at values for the caller first CAS');
  ok(/row: operation === "comment" \? publicRow\(existing\) : publicRow\(result\)/.test(edge)
    && /operation === "comment" \? \{ comment: parseJson\(result\) \}/.test(edge),
  'comment success preserves the target entity CAS row and returns the durable comment separately');
  ok(/terminalValueProof/.test(inbound)
    && /const isCommentEvent = resource\.includes\("comment"\)/.test(inbound)
    && /: issueFromPayload\(payload\)/.test(inbound)
    && /if \(!issueId\) return null/.test(inbound)
    && /lower\(row\.status\) === "written"/.test(inbound)
    && /if \(!actorMatches && !terminalValueProof\) continue/.test(inbound),
  'terminal exact-value Linear echoes are dropped even when the webhook omits the API viewer actor');
  ok(/GRAPHIC_TITLE_API_KEY/.test(edge)
    && /GRAPHIC_TITLE_MODEL/.test(edge)
    && /GRAPHIC_TITLE_PROMPT/.test(edge)
    && /filmingPlan = \(await response\.text\(\)\)\.slice\(0, 20_000\)/.test(edge)
    && /text\.indexOf\("\["\)/.test(edge)
    && /typeof number !== "number"/.test(edge)
    && /if \(!firstByNumber\.has\(number\)\)/.test(edge)
    && /const fallbackTitle = `Video \$\{videoNumber\}`/.test(edge),
  'graphics descriptions use secret-configured generation, array extraction, strict number matching, and per-item fallback');
  ok(/graphic_generation_unavailable/.test(edge)
    && /graphic_generation_failed/.test(edge)
    && /skip_graphic_generation_forbidden/.test(edge)
    && /principal\.kind !== "test"/.test(edge),
  'missing/provider-failed generation fails before native writes and only the service TEST drill may skip it');
  ok(/graphics_brief_server_owned/.test(edge)
    && /sourceBrief = team === "graphics" \? "" : clean\(item\.brief\)/.test(edge),
  'browser graphics briefs cannot bypass the server-owned description generator');
  ok(!/claude-[0-9]|GRAPHIC_TITLE_API_KEY\s*=|sk-ant/i.test(edge),
    'graphics generation contains no provider key or model id literal');
  ok(edge.indexOf('invalid_intake_video_number') < edge.indexOf('await graphicDescriptions(')
    && edge.indexOf('const plannedItems: JsonMap[]') < edge.indexOf('const batch = await ensureBatch(')
    && /sortKey < 0/.test(edge),
  'item numbers and caller-owned fields are validated before generation and every row is planned before the first RPC');

  ok(/_intent_fingerprint/.test(edge)
    && /assertDedupIntent/.test(edge)
    && /idempotency_conflict/.test(edge)
    && /pg_advisory_xact_lock\(hashtextextended\(p_dedup_key, 0\)\)/.test(migration)
    && /production_deliverable_write/.test(migration)
    && /production_batch_write/.test(migration),
  'semantic idempotency is locked and enforced inside the row/event/outbox transaction');
  ok(/if \(!replay\)[\s\S]{0,300}assertCas\(body, existing\)/.test(edge),
    'an exact retry is recognized before stale CAS values can reject it');
  ok(/cas_required/.test(edge)
    && /expected_status/.test(migration)
    && /expected_updated_at/.test(migration)
    && /production-deliverable:/.test(migration),
  'Production scalars require CAS and the database serializes competing request ids');
  ok(/linear_legacy_parity_enabled/.test(edge)
    && /linear_legacy_parity_enabled/.test(migration)
    && /legacy_parity_gate_unavailable/.test(edge + migration),
  'both Edge and transactional RPC enforce the independent parity kill gate');
  ok(/linear_issue_url/.test(edge) && /linear_issue_uuid", "linear_identifier/.test(edge)
    && /legacy_link_ambiguous/.test(edge),
  'legacy queue issue links resolve to exactly one native deliverable only on parity surfaces');
  ok(/comment_parent_forbidden/.test(edge)
    && /clean\(parent\.audience\) !== "client"/.test(edge)
    && /native_comment_id/.test(edge),
  'client replies cannot enter internal threads and legacy native comment ids are retained');
  ok(/dedupKey\("comment", entity, id, `native:\$\{suppliedNativeId\}`\)/.test(edge)
    && /deterministicNativeId\("pc", `\$\{entity\}:\$\{id\}`, suppliedNativeId\)/.test(edge)
    && /v_existing_native_dedup is distinct from v_dedup_key/.test(migration),
  'a stable Calendar/SXR native comment id owns exactly one semantic outbox intent across request-id retries');
  ok(/conflict: true, row: publicRow\(existing\)/.test(edge)
    && /error\.code === "write_conflict"/.test(edge)
    && /row: current \? publicRow/.test(edge),
  'CAS precheck and database-race conflicts return the current-row conflict envelope');
  ok(/echo && existingComment/.test(inbound)
    && /"author_key", "author_member_id", "author_name", "role", "audience"/.test(inbound)
    && /"origin", "source", "parent_id", "thread_root_id"/.test(inbound),
  'Linear echo linkage preserves the native human author, audience, origin, body, and thread');

  const lowLevelGuard = lowLevel.indexOf('error: "gateway_required"');
  const lowLevelBody = lowLevel.indexOf('await req.json()');
  ok(lowLevelGuard > 0 && lowLevelBody > lowLevelGuard
    && /if \(!\(await serviceRoleRequest\(req\)\)\)/.test(lowLevel),
  'old deliverable/batch HTTP wrappers require service auth before parsing member/header claims');
  ok(/\[functions\.production-write\][\s\S]{0,40}verify_jwt = false/.test(config),
    'Edge config exposes production-write for custom fail-closed browser auth');

  if (failures) {
    console.error(`\n${failures} production-write gateway check(s) failed`);
    process.exit(1);
  }
  console.log('\nProduction-write gateway checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
