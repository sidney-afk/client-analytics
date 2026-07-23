'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const edge = read('supabase/functions/production-write/index.ts');
const lowLevel = read('supabase/functions/_shared/b4-write.ts');
const dataModel = read('migrations/2026-07-06-b1-linear-data-model.sql');
const migration = read('migrations/2026-07-12-write-ui-outbox-parity.sql');
const descriptionMigration = read('migrations/2026-07-23-f202-production-descriptions.sql');
const createMigration = read('migrations/2026-07-23-f203-production-issue-create.sql');
const fixPackFlags = read('migrations/2026-07-13-write-ui-fix-pack-flags.sql');
const inbound = read('supabase/functions/linear-inbound/index.ts');
const inboundEchoProof = read('supabase/functions/linear-inbound/f27-echo.mjs');
const selectedLabelPagesSource = read('supabase/functions/production-write/selected-label-pages.mjs');
const linearOutbound = read('supabase/functions/linear-outbound/index.ts');
const config = read('supabase/config.toml');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  let start = edge.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (edge.slice(start - 6, start) === 'async ') start -= 6;
  const brace = edge.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let index = brace; index < edge.length; index++) {
    const char = edge[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return edge.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT,
    'supabase',
    'functions',
    'production-write',
    'policy.mjs',
  )).href);
  const selectedPages = await import(pathToFileURL(path.join(
    ROOT,
    'supabase',
    'functions',
    'production-write',
    'selected-label-pages.mjs',
  )).href);
  const linearCreateIds = await import(pathToFileURL(path.join(
    ROOT,
    'supabase',
    'functions',
    '_shared',
    'linear-create-id.mjs',
  )).href);

  ok(policy.normalizeOperation('status') === 'status'
    && policy.normalizeOperation('comment') === 'comment'
    && policy.normalizeOperation('due') === 'due'
    && policy.normalizeOperation('assignee') === 'assignee'
    && policy.normalizeOperation('labels') === 'labels'
    && policy.normalizeOperation('description') === 'description'
    && policy.normalizeOperation('create') === 'create'
    && policy.normalizeOperation('intake_create') === 'intake_create'
    && policy.normalizeOperation('archive') === '',
  'gateway exposes the existing operations plus F201 labels, F202 descriptions, and F203 create');

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
    && !policy.staffOperationAllowed('creative', 'labels', 'video', 'video')
    && !policy.staffOperationAllowed('creative', 'description', 'video', 'video')
    && !policy.staffOperationAllowed('creative', 'create', 'video', 'video')
    && !policy.staffOperationAllowed('creative', 'comment', 'video', 'graphics'),
  'creative writes are limited to own-team work/status/comment and cannot change labels, descriptions, or create issues');

  ok(policy.clientOperationAllowed('comment', 'client_approval', '')
    && policy.clientOperationAllowed('status', 'client_approval', 'approved')
    && policy.clientOperationAllowed('status', 'tweak', 'tweak')
    && !policy.clientOperationAllowed('status', 'smm_approval', 'approved')
    && !policy.clientOperationAllowed('labels', 'client_approval', '')
    && !policy.clientOperationAllowed('description', 'client_approval', '')
    && !policy.clientOperationAllowed('create', 'client_approval', '')
    && !policy.clientOperationAllowed('due', 'client_approval', ''),
  'client token permits only own-thread comments and client-legal transitions, never labels, descriptions, or create');

  ok(policy.legacyParityAllowed('calendar', 'status')
    && policy.legacyParityAllowed('calendar', 'comment')
    && policy.legacyParityAllowed('calendar', 'intake_create')
    && policy.legacyParityAllowed('sxr', 'status')
    && policy.legacyParityAllowed('submission', 'intake_create')
    && !policy.legacyParityAllowed('production', 'status')
    && !policy.legacyParityAllowed('calendar', 'due')
    && !policy.legacyParityAllowed('sxr', 'intake_create'),
  'legacy parity is a closed surface/operation allowlist');

  ok(policy.browserCredentialTestOverride(true, 'staff-role-key', '')
    && policy.browserCredentialTestOverride(true, '', 'client-review-token')
    && !policy.browserCredentialTestOverride(true, '', '')
    && !policy.browserCredentialTestOverride(false, 'staff-role-key', 'client-review-token'),
  'staff keys and client tokens cannot request the service-only TEST override');

  ok(JSON.stringify(policy.projectIdsForTeam({ video: 'project-v', graphics: { id: 'project-g' } }, 'VID'))
      === JSON.stringify(['project-v'])
    && JSON.stringify(policy.projectIdsForTeam([{ team: 'GRA', project_id: 'project-g' }], 'graphics'))
      === JSON.stringify(['project-g'])
    && policy.projectIdsForTeam(['legacy-a', 'legacy-b'], 'video').length === 0
    && policy.projectIdsForTeam({ video: { backup: 'metadata-project' } }, 'video').length === 0
    && JSON.stringify(policy.projectIdsForTeam({ video: { id: 'project-v', note: 'metadata-project' } }, 'video')) === JSON.stringify(['project-v'])
    && JSON.stringify(policy.projectIdsForTeam({ video: { id: 'project-a', project_id: 'project-b' } }, 'video')) === JSON.stringify(['project-a', 'project-b'])
    && policy.projectIdsForTeam({ team: 'video', metadata: 'metadata-project' }, 'video').length === 0,
  'only tagged native project mappings are accepted, and conflicting aliases stay ambiguous');

  const id1 = await policy.deterministicNativeId('del', 'request-123', 'video:0');
  const id2 = await policy.deterministicNativeId('del', 'request-123', 'video:0');
  const id3 = await policy.deterministicNativeId('del', 'request-123', 'video:1');
  ok(id1 === id2 && id1 !== id3 && /^del_[0-9a-f-]{36}$/.test(id1),
    'native ids are deterministic per request/item without minting a human identifier');
  const linearCreateId1 = await linearCreateIds.deterministicLinearCreateId('write-ui:create:fixture');
  const linearCreateId2 = await linearCreateIds.deterministicLinearCreateId('write-ui:create:fixture');
  ok(linearCreateId1 === linearCreateId2
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(linearCreateId1)
    && /deterministicLinearCreateId/.test(edge)
    && /deterministicLinearCreateId/.test(linearOutbound),
  'gateway and outbound share one deterministic Linear create UUID implementation');

  ok(policy.validRequestId('epoch-write-0001') === 'epoch-write-0001'
    && policy.validRequestId('short') === ''
    && policy.validRequestId('../unsafe-value') === '',
  'dedup request ids are bounded and syntax checked');
  ok(policy.validDateOrNull('2026-02-28')
    && policy.validDateOrNull('2024-02-29')
    && !policy.validDateOrNull('2026-02-29')
    && !policy.validDateOrNull('2026-02-31'),
  'due dates must be real UTC calendar dates');
  ok(JSON.stringify(policy.canonicalLabelIds(['label-z', 'label-a', 'label-z']))
      === JSON.stringify(['label-a', 'label-z'])
    && JSON.stringify(policy.canonicalLabelIds([])) === JSON.stringify([])
    && policy.canonicalLabelIds('label-a') === null
    && policy.canonicalLabelIds(['../unsafe']) === null
    && policy.canonicalLabelIds(['label-a', 7]) === null,
  'label replacement accepts only one canonical, sorted, complete Linear-ID set');
  const markdownDescription = '  # Heading\n\n- exact whitespace  \n';
  ok(policy.canonicalDescription(markdownDescription) === markdownDescription
    && policy.canonicalDescription('') === ''
    && policy.canonicalDescription(7) === null
    && policy.canonicalDescription(null) === null
    && policy.canonicalDescription('before\0after') === null
    && policy.canonicalDescription('x'.repeat(policy.MAX_DESCRIPTION_LENGTH + 1)) === null,
  'description validation preserves exact Markdown and accepts only bounded PostgreSQL-safe strings, including an empty clear');

  const selectedLabel = (id, name = id, teamId = 'team-video') => ({
    id,
    name,
    color: '#123456',
    description: null,
    archivedAt: null,
    isGroup: false,
    team: { id: teamId },
  });
  const selectedPage = (nodes, hasNextPage, endCursor, issueId = 'issue-1', teamId = 'team-video') => ({
    issue: {
      id: issueId,
      team: { id: teamId },
      labels: { nodes, pageInfo: { hasNextPage, endCursor } },
    },
  });
  const firstHundredLabels = Array.from(
    { length: 100 },
    (_, index) => selectedLabel(`label-${String(index).padStart(3, '0')}`),
  );
  const selectedCalls = [];
  const completeSelected = await selectedPages.collectCompleteSelectedLabels({
    issueId: 'issue-1',
    expectedTeamId: 'team-video',
    maxPages: 5,
    fetchPage: async after => {
      selectedCalls.push(after);
      if (after == null) return selectedPage(firstHundredLabels, true, 'cursor-1');
      if (after === 'cursor-1') return selectedPage([selectedLabel('label-100')], false, null);
      throw new Error('unexpected cursor');
    },
  });
  ok(completeSelected.labels.length === 101
    && completeSelected.ids[0] === 'label-000'
    && completeSelected.ids[100] === 'label-100'
    && JSON.stringify(selectedCalls) === JSON.stringify([null, 'cursor-1']),
  'selected labels merge more than one independent page into one complete canonical set');

  async function selectedPageErrorKind(work) {
    try {
      await work();
      return '';
    } catch (error) {
      return error instanceof selectedPages.SelectedLabelPageError ? error.kind : 'unexpected';
    }
  }
  const truncatedKind = await selectedPageErrorKind(() =>
    selectedPages.collectCompleteSelectedLabels({
      issueId: 'issue-1',
      expectedTeamId: 'team-video',
      maxPages: 1,
      fetchPage: async () => selectedPage([selectedLabel('label-a')], true, 'cursor-1'),
    }));
  const malformedKind = await selectedPageErrorKind(() =>
    selectedPages.collectCompleteSelectedLabels({
      issueId: 'issue-1',
      expectedTeamId: 'team-video',
      maxPages: 2,
      fetchPage: async () => selectedPage([{ ...selectedLabel('label-a'), name: '' }], false, null),
    }));
  const emptyCursorKind = await selectedPageErrorKind(() =>
    selectedPages.collectCompleteSelectedLabels({
      issueId: 'issue-1',
      expectedTeamId: 'team-video',
      maxPages: 2,
      fetchPage: async () => selectedPage([selectedLabel('label-a')], true, ''),
    }));
  const repeatedCursorKind = await selectedPageErrorKind(() =>
    selectedPages.collectCompleteSelectedLabels({
      issueId: 'issue-1',
      expectedTeamId: 'team-video',
      maxPages: 3,
      fetchPage: async after => after == null
        ? selectedPage([selectedLabel('label-a')], true, 'cursor-1')
        : selectedPage([selectedLabel('label-b')], true, 'cursor-1'),
    }));
  const changedIdentityKind = await selectedPageErrorKind(() =>
    selectedPages.collectCompleteSelectedLabels({
      issueId: 'issue-1',
      expectedTeamId: 'team-video',
      maxPages: 3,
      fetchPage: async after => after == null
        ? selectedPage([selectedLabel('label-a')], true, 'cursor-1')
        : selectedPage([selectedLabel('label-b', 'B', 'team-other')], false, null, 'issue-1', 'team-other'),
    }));
  const duplicateKind = await selectedPageErrorKind(() =>
    selectedPages.collectCompleteSelectedLabels({
      issueId: 'issue-1',
      expectedTeamId: 'team-video',
      maxPages: 3,
      fetchPage: async after => after == null
        ? selectedPage([selectedLabel('label-a')], true, 'cursor-1')
        : selectedPage([selectedLabel('label-a')], false, null),
    }));
  const ambiguousPageKind = await selectedPageErrorKind(() =>
    selectedPages.collectCompleteSelectedLabels({
      issueId: 'issue-1',
      expectedTeamId: 'team-video',
      maxPages: 2,
      fetchPage: async () => selectedPage([selectedLabel('label-a')], 'false', null),
    }));
  ok(truncatedKind === 'incomplete'
    && malformedKind === 'invalid'
    && emptyCursorKind === 'incomplete'
    && repeatedCursorKind === 'incomplete'
    && changedIdentityKind === 'identity'
    && duplicateKind === 'invalid'
    && ambiguousPageKind === 'incomplete',
  'selected-label pagination returns no partial success for truncation, malformed nodes, cursor faults, identity drift, duplicates, or ambiguous page state');
  ok(/for \(let page = 0; page < maxPages; page\+\+\)/.test(selectedLabelPagesSource)
    && /pageInfo\.hasNextPage === false/.test(selectedLabelPagesSource)
    && /pageInfo\.hasNextPage !== true/.test(selectedLabelPagesSource)
    && /cursors\.has\(cursor\)/.test(selectedLabelPagesSource)
    && /byId\.has\(label\.id\)/.test(selectedLabelPagesSource),
  'selected-label collector is bounded and fails closed on every incomplete or duplicate page envelope');

  const legacyNow = Date.UTC(2026, 6, 13, 23, 59, 59);
  ok(policy.overdueStatusBumpDate('2026-07-01', legacyNow) === '2026-07-15'
    && policy.overdueStatusBumpDate('2026-07-13', legacyNow) === ''
    && policy.overdueStatusBumpDate('2026-07-14', legacyNow) === ''
    && policy.overdueStatusBumpDate('invalid', legacyNow) === '',
  'overdue bump matches the legacy UTC today-plus-two rule, not prior-due-plus-two');
  ok(policy.overdueStatusBumpEnabled({ enabled: false }) === false
    && policy.overdueStatusBumpEnabled({ enabled: true }) === true
    && policy.overdueStatusBumpEnabled({}) === true
    && policy.overdueStatusBumpEnabled({ enabled: 'false' }) === true
    && policy.overdueStatusBumpEnabled(false) === true
    && policy.overdueStatusBumpEnabled(null) === true,
  'overdue bump is default-on and only exact object enabled:false disables it');

  const overdueReaderContext = {
    OVERDUE_STATUS_BUMP_FLAG: 'write_ui_overdue_due_bump',
    overdueStatusBumpPolicyEnabled: policy.overdueStatusBumpEnabled,
  };
  vm.createContext(overdueReaderContext);
  vm.runInContext(extractFunction('overdueStatusBumpEnabled')
    .replace('supabase: SupabaseClient', 'supabase')
    .replace(': Promise<boolean>', '')
    .replace(/\(data as JsonMap\)/g, 'data'), overdueReaderContext);
  const flagClient = (result, thrown) => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => { if (thrown) throw thrown; return result; } }),
      }),
    }),
  });
  ok(await overdueReaderContext.overdueStatusBumpEnabled(flagClient({ data: { value: { enabled: false } }, error: null })) === false
    && await overdueReaderContext.overdueStatusBumpEnabled(flagClient({ data: { value: { enabled: true } }, error: null })) === true
    && await overdueReaderContext.overdueStatusBumpEnabled(flagClient({ data: { value: 'malformed' }, error: null })) === true
    && await overdueReaderContext.overdueStatusBumpEnabled(flagClient({ data: null, error: { message: 'offline' } })) === true
    && await overdueReaderContext.overdueStatusBumpEnabled(flagClient(null, new Error('network down'))) === true,
  'missing, malformed, read-error, and thrown flag reads keep the overdue bump on without rejecting status writes');
  ok(/write_ui_overdue_due_bump/.test(fixPackFlags)
    && /\{"enabled":true\}/.test(fixPackFlags)
    && /linear_outbound_pending_age_alert/.test(fixPackFlags)
    && /\{"minutes":30\}/.test(fixPackFlags)
    && /on conflict \(key\) do nothing/.test(fixPackFlags),
  'fix-pack runtime controls seed additively with bump on and a 30-minute age threshold');

  ok(/credentialMode\(key, token\)/.test(edge)
    && /credentials === "ambiguous"[\s\S]{0,80}ambiguous_credentials/.test(edge),
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
  const browserOverrideGuardPos = edge.indexOf('browserCredentialTestOverride(body.test_override, key, token)');
  const staffPrincipalPos = edge.indexOf('if (credentials === "staff") {');
  const clientPrincipalPos = edge.indexOf('if (credentials === "client") {');
  const authorityBypassPos = edge.indexOf('const authority = principal.testOnly ? "syncview"');
  ok(browserOverrideGuardPos > 0
    && /browserCredentialTestOverride\(body\.test_override, key, token\)[\s\S]{0,120}invalid_test_override/.test(edge)
    && browserOverrideGuardPos < staffPrincipalPos
    && browserOverrideGuardPos < clientPrincipalPos
    && staffPrincipalPos < clientPrincipalPos
    && clientPrincipalPos < authorityBypassPos
    && !/deriveBrowserTestScope/.test(edge),
  'staff/client TEST override is rejected before principal auth and cannot reach the authority bypass');
  ok(/body\.test_override === true[\s\S]{0,320}serviceTestOverrideAllowed\(key, token, body\.confirm, await serviceRoleRequest\(req\)\)/.test(edge)
    && /isCanonicalActiveTestClient\(client\.active, client\.kind\)/.test(edge)
    && /uniqueActiveTestClient/.test(edge),
  'legitimate TEST mode requires service authentication, explicit confirmation, and an active TEST client');
  ok(/B4_TEST_PROJECT_BY_TEAM/.test(edge)
    && /parseJson\(raw \|\| "\{\}"\)/.test(edge)
    && /raw\.split\(","\)/.test(edge)
    && /if \(!projectId\)/.test(edge)
    && /if \(!allowlist\.has\(projectId\)\)/.test(edge)
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
  ok(/\.rpc\("track_b_f27_write_authorization", \{[\s\S]{0,80}p_team: normalizedTeam/.test(edge)
    && /authorization\.ok !== true/.test(edge)
    && /Number\.isSafeInteger\(generation\)/.test(edge)
    && /generationByTeam\[team\] = await f27WriteAuthorizationGeneration\(supabase, team\)/.test(edge),
  'normal, parity, mixed-intake, and TEST writes require a valid per-team F27 generation');
  ok((edge.match(/f27FencedPayload\(/g) || []).length >= 6
    && /\.\.\.payload,[\s\S]{0,100}_f27_authority_generation: generation,[\s\S]{0,100}_f27_legacy_parity: legacyParity/.test(edge),
  'every Production enqueue carries server-owned generation and lane markers after caller payload fields');
  ok(/\.rpc\("track_b_f27_write_authorization", \{[\s\S]{0,80}p_team: normalizedTeam/.test(lowLevel)
    && /_f27_authority_generation: authorityGeneration/.test(lowLevel)
    && /_f27_legacy_parity: false/.test(lowLevel)
    && /\.\.\.outboundPayload\(operation, patch, suppliedPayload\)/.test(lowLevel),
  'service-only low-level writers also overwrite reserved fence fields with server values');

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
  ok(/target_dedup_key: dedup[\s\S]{0,120}syncview_live: true[\s\S]{0,120}WRITE_UI_SYNCVIEW_LIVE/.test(edge)
    && /authority === "syncview"[\s\S]{0,180}outboundLiveForDrain\(supabase\)/.test(edge)
    && /waitUntil\(\(async \(\) =>/.test(edge),
  'flipped live writes schedule the third exact-dedup drain shape in EdgeRuntime background work');
  ok(/const shouldDrain = legacyParity \|\| principal\.testOnly \|\| syncviewLiveDrain/.test(edge)
    && /mirrorPending && awaitedDrain \? 202 : 200/.test(edge),
  'background drains extend shouldDrain without turning a durable native success into a pending HTTP response');
  ok(/overdueStatusBumpDate\(existing\.due_date\)/.test(edge)
    && /overdueStatusBumpEnabled\(supabase\)/.test(edge)
    && !/overdue_bump_gate_unavailable/.test(edge)
    && /payload\.due_date = bumpedDueDate/.test(edge)
    && /fingerprintPatch = \{ \.\.\.patch \}/.test(edge),
  'status writes atomically carry the flag-gated server-derived bump while retries retain the caller fingerprint');
  ok(/if \(!Object\.prototype\.hasOwnProperty\.call\(expected, "stateId"\)\) return false;/.test(inbound)
    && /clean\(objectAt\(issue\.state\)\.id\) === clean\(expected\.stateId\)/.test(inbound)
    && /hasOwnProperty\.call\(expected, "dueDate"\)/.test(inbound),
    'inbound echo proof requires both fields for a combined status and due bump');
  ok(/const target = parseJson\(result\.target\)/.test(edge)
    && /targetStatus === "written"/.test(edge)
    && /already_applied/.test(edge)
    && /acknowledged: response\.ok && result\.ok === true && terminal/.test(edge),
  'targeted drain acknowledges only a proven terminal target');
  ok(/mirror_pending: mirrorPending/.test(edge) && /native_committed: true/.test(edge),
    'a committed native write reports mirror-pending state explicitly');
  ok(/lower\(body\.action\) === "labels_read"[\s\S]{0,100}handleLabelsRead/.test(edge)
    && /issueLabels\(first: \$\{LABEL_PAGE_SIZE\}, after: \$after\)/.test(edge)
    && /nodes \{ id name color description archivedAt isGroup team \{ id \} \}/.test(edge)
    && /pageInfo\.hasNextPage === false/.test(edge)
    && /pageInfo\.hasNextPage !== true[\s\S]{0,100}label_catalog_incomplete/.test(edge)
    && /SyncViewProductionSelectedLabels\(\$id: String!, \$selectedAfter: String\)/.test(edge)
    && /labels\(first: \$\{LABEL_PAGE_SIZE\}, after: \$selectedAfter, includeArchived: true\)/.test(edge)
    && /collectCompleteSelectedLabels\(\{[\s\S]{0,220}maxPages: MAX_LABEL_PAGES/.test(edge)
    && /complete: true/.test(edge),
  'protected labels_read paginates catalog and selection independently and exposes data only after both prove completeness');
  ok(/principal\.kind === "client"[\s\S]{0,80}operation_forbidden/.test(extractFunction('handleLabelsRead'))
    && /authority === "syncview"[\s\S]{0,100}nativeLabelSnapshot\(existing\) \|\| \(principal\.testOnly \? linearSelected : null\)/.test(extractFunction('handleLabelsRead'))
    && /native_label_state_incomplete/.test(extractFunction('handleLabelsRead'))
    && /mergeLabelCatalog\(snapshot\.catalog, selected\.labels\)/.test(extractFunction('handleLabelsRead')),
  'label reads deny clients and require native selected state after authority flips, with only service TEST allowed to bootstrap from complete Linear selection');
  const nativeLabelsStart = edge.indexOf('function nativeLabelSnapshot(');
  const nativeLabelsEnd = edge.indexOf('\nfunction mergeLabelCatalog(', nativeLabelsStart);
  const nativeLabels = edge.slice(nativeLabelsStart, nativeLabelsEnd);
  ok(/labels\.length !== nodes\.length/.test(nativeLabels)
    && /hasOwnProperty\.call\(issue, "labelIds"\)/.test(nativeLabels)
    && /issueIds\.length !== rawIds\.length/.test(nativeLabels)
    && /clean\(value\) !== value/.test(nativeLabels)
    && /JSON\.stringify\(issueIds\) !== JSON\.stringify\(nodeIds\)/.test(nativeLabels),
  'native label state is complete only for unique valid nodes and an exact canonical labelIds/node-ID relation');
  ok(/operation === "labels"[\s\S]{0,220}canonicalLabelIds\(body\.label_ids\)/.test(edge)
    && /label_ids: labelIds, _intent_fingerprint: fingerprint/.test(edge)
    && /raw\.issue = \{[\s\S]{0,240}labelIds,[\s\S]{0,120}labels: \{[\s\S]{0,80}nodes: selectedLabels/.test(edge)
    && /event\.expected_updated_at = clean\(body\.expected_updated_at\)/.test(edge)
    && /labelsReceipt = selectedLabelReceipt/.test(edge),
  'guarded labels write fingerprints one full set, commits canonical native nodes with CAS, and returns that selected set');
  const labelsWriteStart = edge.indexOf('} else if (operation === "labels") {');
  const labelsWriteEnd = edge.indexOf('\n  } else {', labelsWriteStart);
  const labelsWrite = edge.slice(labelsWriteStart, labelsWriteEnd);
  ok(/const native = nativeLabelSnapshot\(existing\) \|\| \(principal\.testOnly \? \{[\s\S]{0,120}labels: snapshot\.selectedLabels,[\s\S]{0,80}ids: snapshot\.selectedLabelIds,[\s\S]{0,40}\} : null\)/.test(labelsWrite)
    && /if \(!native\)[\s\S]{0,100}native_label_state_incomplete/.test(labelsWrite)
    && /\[\.\.\.native\.labels, \.\.\.snapshot\.catalog\]/.test(labelsWrite)
    && /browserCredentialTestOverride\(body\.test_override, key, token\)[\s\S]{0,100}invalid_test_override/.test(extractFunction('authenticate')),
  'normal label replacement fails closed on incomplete native state while only service TEST may preserve arbitrary selected Linear labels during bootstrap');

  const descriptionWriteStart = edge.lastIndexOf('} else if (operation === "description") {');
  const descriptionWriteEnd = edge.indexOf('\n    } else {', descriptionWriteStart);
  const descriptionWrite = edge.slice(descriptionWriteStart, descriptionWriteEnd);
  ok(descriptionWriteStart > 0
    && /body\.description !== undefined[\s\S]{0,120}parseJson\(body\.patch\)\.description/.test(descriptionWrite)
    && /canonicalDescription\(descriptionValue\)/.test(descriptionWrite)
    && /patch = \{ brief: description \}/.test(descriptionWrite)
    && /payload = \{ description \}/.test(descriptionWrite)
    && /fingerprintPatch = patch/.test(descriptionWrite)
    && !/\bclean\(|\.trim\(/.test(descriptionWrite),
  'guarded description writes preserve the exact Markdown string in native patch, outbox payload, and fingerprint');
  ok(/nullif\(v_row->>'brief', ''\)/.test(dataModel)
    && /brief = case when v_row \? 'brief' then excluded\.brief else d\.brief end/.test(dataModel)
    && !/btrim\(v_row->>'brief'\)/.test(dataModel),
  'the existing native deliverable RPC stores non-empty Markdown without trimming and treats only the exact empty string as clear');
  ok(/entity === "batch" && operation !== "comment"[\s\S]{0,100}unsupported_batch_operation/.test(edge)
    && /surface === "production" && operation !== "comment"[\s\S]{0,140}expected_updated_at/.test(edge)
    && /action: operation === "create" \|\| operation === "intake_create" \? "create" : `\$\{operation\}_change`/.test(edge)
    && /function publicDescriptionRow[\s\S]{0,180}brief: typeof row\.brief === "string" \? row\.brief : null/.test(edge),
  'description stays deliverable-only, requires Production CAS, emits description_change audit, and has an exact brief response shape');
  ok(/create policy "protect production description event bodies"[\s\S]*as restrictive[\s\S]*for select[\s\S]*to anon, authenticated[\s\S]*using \(action is distinct from 'description_change'\)/.test(descriptionMigration)
    && /service-role-only mirror_outbox payload/.test(descriptionMigration)
    && /exact outbox payload remain unchanged/.test(descriptionMigration),
  'description_change audit rows retain the exact service-side handoff but are excluded from anon/authenticated reads');

  const createPrincipalScope = extractFunction('productionCreatePrincipalScope');
  const createScope = extractFunction('productionCreateScope');
  const createOptions = extractFunction('handleCreateOptions');
  const createParentRoute = extractFunction('productionCreateParentRoute');
  const createHandler = extractFunction('handleProductionCreate');
  const createReplayStart = edge.indexOf('async function productionCreateReplay(');
  const createReplayEnd = edge.indexOf('\nasync function handleCreateOptions(', createReplayStart);
  const createReplay = edge.slice(createReplayStart, createReplayEnd);
  const createFieldsStart = edge.indexOf('const PRODUCTION_CREATE_FIELDS = new Set([');
  const createFieldsEnd = edge.indexOf(']);', createFieldsStart);
  const createFields = edge.slice(createFieldsStart, createFieldsEnd);

  ok(/lower\(body\.action\) === "create_options"[\s\S]{0,100}handleCreateOptions/.test(edge)
    && /surfaceFor\(body\) !== "production"/.test(createOptions)
    && /productionCreateScope\(supabase, req, body\)/.test(createOptions)
    && /ok: true,[\s\S]{0,80}complete: true,[\s\S]{0,80}authority: scope\.authority,[\s\S]{0,80}catalog/.test(createOptions)
    && /staffOperationAllowed\(principal\.keyRole, "create", principal\.memberTeam, team\)/.test(createPrincipalScope)
    && /client\.active !== true/.test(createPrincipalScope)
    && /lower\(client\.kind\) === "test" && !principal\.testOnly/.test(createPrincipalScope)
    && /test_scope_service_only/.test(createPrincipalScope),
  'create_options is a protected Production-only complete catalog for an active Admin/SMM or exact service TEST scope');

  const principalPosition = createHandler.indexOf('productionCreatePrincipalScope(');
  const replayPosition = createHandler.indexOf('productionCreateReplay(');
  const readinessPosition = createHandler.indexOf('productionCreateScope(');
  const foreignPosition = createHandler.indexOf('linearStateIdForCreate(');
  const writePosition = createHandler.indexOf('rpc(supabase, "production_issue_create"');
  ok(principalPosition >= 0
    && replayPosition > principalPosition
    && readinessPosition > replayPosition
    && foreignPosition > readinessPosition
    && writePosition > foreignPosition
    && !/\b(linearRead|linearLabelsRequest|linearLabelCatalog|linearStateIdForCreate|authorityFor|authorityLane|f27WriteAuthorizationGeneration|targetedDrain|scheduleSyncviewLiveDrains|outboundLiveForDrain|fetch)\b/.test(createReplay)
    && !/\.(?:insert|update|upsert|delete)\(|\brpc\(/.test(createReplay),
  'an authenticated exact create replay returns before foreign/readiness checks and performs native reads only, with no drain or write');

  ok(/payload\.description !== intent\.description/.test(createReplay)
    && /JSON\.stringify\(payload\.label_ids\) !== JSON\.stringify\(intent\.labelIds\)/.test(createReplay)
    && /receiptPayload\.parent_deliverable_id/.test(createReplay)
    && /sameInstant\(outbox\.source_edited_at, intent\.sourceEditedAt\)/.test(createReplay)
    && /eventPayload\.actor_key\) === scope\.principal\.actorKey/.test(createReplay)
    && /redacted\.intent_fingerprint\) === fingerprint/.test(createReplay)
    && !/\brow\.(?:title|brief|status|status_at|assignee_id|due_date|updated_at)\b/.test(createReplay)
    && /row\.batch_id/.test(createReplay)
    && /row\.created_by/.test(createReplay)
    && /row\.linear_issue_uuid/.test(createReplay),
  'lost-response replay rejects body/receipt drift but permits later title, description, status, assignee, due-date, and updated-at edits');

  ok(/parentIdsForTeam\(batch\.linear_parent_ids, scope\.team\)/.test(createReplay)
    && /production_issue_container_create/.test(createReplay)
    && /eventPayload\.structural_only === true/.test(createReplay)
    && /currentLinearParentIssueId\(row\)/.test(createReplay)
    && /parentLinearIssueId\(parent\)/.test(createReplay)
    && /currentLinearParentIssueId\(parent\)/.test(createReplay)
    && /rowParentLinearId !== parentLinearId/.test(createReplay)
    && /outbox\.depends_on_id/.test(createReplay)
    && /mirror_pending: !acknowledged/.test(createReplay)
    && /attempted: false/.test(createReplay),
  'early replay proves root or child native structure and reports the durable mirror receipt without re-draining');
  ok(/targetStatus === "skipped" && lower\(conflict\.decision\) === "idempotency_conflict"/.test(createReplay)
    && /new GatewayError\(409, "idempotency_conflict"/.test(createReplay)
    && /native_committed: true/.test(createReplay)
    && /terminal_conflict: true/.test(createReplay),
  'exact create polling exposes a terminal deterministic Linear conflict with the already-committed native receipt');

  ok(/Object\.keys\(body\)\.some\(key => !PRODUCTION_CREATE_FIELDS\.has\(key\)\)/.test(createHandler)
    && !/"(?:origin|card_id|calendar|sample|batch_id|kind)"/.test(createFields)
    && /canonicalDescription\(body\.description\)/.test(createHandler)
    && /canonicalLabelIds\(body\.label_ids\)/.test(createHandler)
    && /validDateOrNull\(dueDate\)/.test(createHandler)
    && /linearStateIdForCreate\(scope\.teamId, scope\.team, status\)/.test(createHandler)
    && /linearLabelCatalog\(scope\.teamId, scope\.team\)/.test(createHandler)
    && /validateCreateAssignee\(supabase, assigneeId, scope\.team\)/.test(createHandler),
  'first-time create accepts only the ratified issue fields and validates the exact status, date, full labels, and mapped same-team assignee before commit');

  ok(/attribution:[\s\S]*state: "resolved"/.test(createHandler)
    && /kind: "other"/.test(createHandler)
    && /origin: "manual"/.test(createHandler)
    && /card_id: null/.test(createHandler)
    && /linear_parent_ids:[\s\S]{0,180}uuid: plannedLinearIssueId/.test(createHandler)
    && /parent_deliverable_id: parentId \|\| null/.test(createHandler)
    && /depends_on_id: parentRoute\.dependsOnId/.test(createHandler)
    && /productionCreateParentRoute\(supabase, parentId, scope\)/.test(createHandler)
    && /production_create_parent_nested/.test(createParentRoute)
    && /batchParentIds\.length !== 1/.test(createParentRoute)
    && (createParentRoute.match(/validateLinearBatchParent\(linearIssueId, scope\.team, scope\.projectId, true\)/g) || []).length === 2,
  'parent create gets one structural batch, child create reuses one current Linear-validated root/dependency, and neither path can imply Calendar or Samples linkage');

  ok(/payload: f27FencedPayload\(\{[\s\S]*team_id: scope\.teamId[\s\S]*project_id: scope\.projectId[\s\S]*title,[\s\S]*description,[\s\S]*status,[\s\S]*state_id: stateId[\s\S]*due_date: dueDate[\s\S]*linear_user_id:[\s\S]*parent_linear_issue_id:[\s\S]*label_ids: labelIds[\s\S]*planned_linear_issue_id: plannedLinearIssueId/.test(createHandler)
    && /rpc\(supabase, "production_issue_create", \{[\s\S]{0,140}p_batch: batchRow \|\| \{\},[\s\S]{0,80}p_row: row,[\s\S]{0,80}p_event: event/.test(createHandler)
    && /native_committed: true/.test(createHandler)
    && /publicDescriptionRow\(currentRow\)/.test(createHandler)
    && /selectedLabelReceipt\(currentRow\)/.test(createHandler),
  'the guarded create RPC receives one complete canonical Linear intent and returns refreshed Markdown plus complete selected-label state');
  ok(/terminalConflict = mirror\.some/.test(createHandler)
    && /item\.terminal_conflict === true/.test(createHandler)
    && /new GatewayError\(409, "idempotency_conflict"/.test(createHandler),
  'a synchronous targeted create drain returns the same terminal conflict contract instead of a catching-up success');

  const migrationReplayStart = createMigration.indexOf('if v_replay then');
  const migrationReplayEnd = createMigration.indexOf(
    '\n\n  perform public.production_assert_authority(',
    migrationReplayStart,
  );
  const migrationReplay = createMigration.slice(migrationReplayStart, migrationReplayEnd);
  ok(/production_outbox_replay\(/.test(createMigration)
    && /o\.payload->>'_intent_fingerprint' = v_fingerprint/.test(migrationReplay)
    && /o\.source_edited_at is not distinct from nullif\(v_event->>'ts', ''\)::timestamptz/.test(migrationReplay)
    && /e\.payload->'outbound_redacted'->>'intent_fingerprint' = v_fingerprint/.test(migrationReplay)
    && /e\.payload->>'actor_key' = v_event->>'actor_key'/.test(migrationReplay)
    && /e\.payload->>'auth_kind' = v_event->>'auth_kind'/.test(migrationReplay)
    && /production_batch_parent_ids_for_team/.test(migrationReplay)
    && /production_issue_container_create/.test(migrationReplay)
    && /v_result\.linear_raw->'issue'->'parent'->>'id'/.test(migrationReplay)
    && /v_result\.linear_raw->'issue'->>'parentId'/.test(migrationReplay)
    && /v_parent\.linear_raw->'issue'->'parent'->>'id'/.test(migrationReplay)
    && !/v_result\.(?:title|brief|status|status_at|assignee_id|due_date|updated_at)/.test(migrationReplay),
  'database replay proves the original outbox/event fingerprint and immutable structure while allowing later mutable row edits');
  [
    ['title', /v_result\.title/],
    ['description', /v_result\.brief/],
    ['status', /v_result\.(?:status|status_at)/],
    ['due date', /v_result\.due_date/],
    ['assignee', /v_result\.assignee_id/],
    ['labels', /v_result\.linear_raw->'issue'->'(?:labelIds|labels)'/],
  ].forEach(([field, pattern]) => ok(!pattern.test(migrationReplay),
    `database exact replay remains valid after a later ${field} edit`));

  const createLockPosition = createMigration.indexOf("pg_advisory_xact_lock(hashtextextended('production-deliverable:'");
  const createBatchLockPosition = createMigration.indexOf("pg_advisory_xact_lock(hashtextextended('production-batch:'");
  const createReplayLookupPosition = createMigration.indexOf('v_replay := public.production_outbox_replay(');
  const createAuthorityPosition = createMigration.indexOf('perform public.production_assert_authority(');
  ok(/begin;/.test(createMigration)
    && /create or replace function public\.production_issue_create/.test(createMigration)
    && /grant execute on function public\.production_issue_create\(jsonb, jsonb, jsonb\)[\s\S]{0,40}to service_role/.test(createMigration)
    && !/\balter table\b|\bdrop constraint\b|\bcreate trigger\b/i.test(createMigration)
    && /v_result := public\.production_deliverable_write\(v_row, v_event\)/.test(createMigration)
    && /v_count <> 1 or v_outbox_id is null/.test(createMigration)
    && /production_create_batch_outbox_forbidden/.test(createMigration)
    && createMigration.indexOf('production_deliverable_write(v_row, v_event)') < createMigration.indexOf('update public.deliverable_events e')
    && /update public\.deliverable_events e[\s\S]{0,140}'outbound_redacted'/.test(createMigration)
    && /jsonb_typeof\(v_issue->'labels'->'nodes'\) is distinct from 'array'/.test(createMigration)
    && /select distinct node->>'id' as label[\s\S]{0,180}is distinct from v_payload->'label_ids'/.test(createMigration)
    && createLockPosition > 0
    && createBatchLockPosition > createLockPosition
    && createReplayLookupPosition > createBatchLockPosition
    && createAuthorityPosition > migrationReplayEnd
    && /not \(e\.payload \? 'outbound'\)/.test(migrationReplay),
  'F203 migration serializes exact retries, replays before authority, requires exact label nodes, enqueues one deliverable create only, and redacts public audit after enqueue');

  const reconcile = extractFunction('reconcileEntityOperation');
  const receiptReader = extractFunction('readOutboxReceipt');
  const entityHandlerStart = edge.indexOf('async function handleEntityOperation(');
  const entityHandlerEnd = edge.indexOf('\nasync function ensureBatch(', entityHandlerStart);
  const entityHandler = edge.slice(entityHandlerStart, entityHandlerEnd);
  const identityGuard = extractFunction('assertDeliverableIdentityWritable');
  const identityGuardPosition = entityHandler.indexOf('assertDeliverableIdentityWritable(supabase, existing)');
  const entityOperationBranchPosition = entityHandler.indexOf('if (operation === "comment")');
  ok(/identity_repair/.test(identityGuard)
    && /repairState === "resolved"/.test(identityGuard)
    && /resolved_linear_issue_id/.test(identityGuard)
    && /\.eq\("operation", "create"\)/.test(identityGuard)
    && /lower\(conflict\.decision\) === "idempotency_conflict"/.test(identityGuard)
    && /new GatewayError\(409, "identity_repair_required"/.test(identityGuard)
    && /read_only: true/.test(identityGuard)
    && identityGuardPosition > entityHandler.indexOf('authenticate(supabase, req, body, targetClientSlug)')
    && identityGuardPosition < entityOperationBranchPosition
    && identityGuardPosition < entityHandler.indexOf('f27WriteAuthorizationGeneration(')
    && /await assertDeliverableIdentityWritable\(supabase, parent\)/.test(createParentRoute),
  'one authenticated fail-closed identity guard blocks every deliverable operation and child route before enqueue or foreign Linear work');
  ok(/sync_state: clean\(row\.sync_state\)/.test(extractFunction('publicRow'))
    && /identity_repair_state: clean\(repair\.state\)/.test(extractFunction('publicRow'))
    && /identity_repair_reason: clean\(repair\.reason\)/.test(extractFunction('publicRow')),
  'gateway receipts expose only the public read-only repair state needed to quarantine the saved row');

  const quarantineStart = createMigration.indexOf(
    'create or replace function public.production_issue_create_quarantine(',
  );
  const quarantineEnd = createMigration.indexOf('\ncommit;', quarantineStart);
  const quarantineMigration = createMigration.slice(quarantineStart, quarantineEnd);
  ok(quarantineStart > 0
    && /pg_advisory_xact_lock\(hashtextextended\('production-deliverable:'/.test(quarantineMigration)
    && /v_outbox\.operation is distinct from 'create'/.test(quarantineMigration)
    && /v_outbox\.linear_result->'conflict'->>'decision'[\s\S]{0,80}'idempotency_conflict'/.test(quarantineMigration)
    && /'syncview_create_identity_repair_v1'/.test(quarantineMigration)
    && /set sync_state = 'error'/.test(quarantineMigration)
    && /jsonb_set\(v_raw, '\{identity_repair\}', v_marker, true\)/.test(quarantineMigration)
    && /production_create_identity_quarantined/.test(quarantineMigration)
    && /grant execute on function public\.production_issue_create_quarantine\(text, bigint\)[\s\S]{0,40}to service_role/.test(quarantineMigration)
    && !/set[\s\S]{0,120}linear_issue_uuid\s*=|set[\s\S]{0,120}linear_identifier\s*=|set[\s\S]{0,120}linear_issue_url\s*=/.test(quarantineMigration),
  'the additive F203 quarantine locks and marks only the one conflicted native identity, audits it, and cannot relink or erase the saved row');
  ok(/body\.reconcile_only === true/.test(entityHandler)
    && entityHandler.indexOf('reconcileEntityOperation(') < entityHandler.indexOf('const authority = principal.testOnly')
    && /historicalLegacyParity = body\.legacy_parity === true/.test(reconcile)
    && /authority = principal\.testOnly \? "syncview" : await authorityFor/.test(reconcile),
  'read-only reconciliation authenticates first, preserves the historical lane, and may report opposite current authority');
  ok(!/authorityLane\(|assertLegacyParityEnabled\(|targetedDrain\(|\brpc\(|linearRead\(/.test(reconcile)
    && !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(reconcile + receiptReader + extractFunction('findReceiptComment') + extractFunction('currentEntityRow')),
  'reconcile-only path contains reads only and cannot invoke authority gates, RPCs, drainers, or mutations');
  ok(/"committed_exact" \| "absent" \| "conflict"/.test(edge)
    && /outcome: receipt\.outcome/.test(reconcile)
    && /receipt\.outcome === "conflict" \? 409 : 200/.test(reconcile)
    && /comment: receipt\.outcome === "committed_exact"/.test(reconcile)
    && /canonicalCommentMatchesReceipt\([\s\S]{0,120}canonicalComment,[\s\S]{0,120}expectedComment,[\s\S]{0,120}receipt\.row\?\.comment_id/.test(reconcile),
  'receipt contract is explicit tri-state and returns canonical comments only for an exact commit');
  ok(/stable actorKey/.test(receiptReader)
    && /expected\.actor_key/.test(receiptReader)
    && /payload\._intent_fingerprint/.test(receiptReader)
    && /entity_id,comment_id,operation/.test(receiptReader)
    && !/row\.actor|row\.role/.test(receiptReader)
    && /operationPayloadMatches/.test(receiptReader),
  'receipt exactness binds the stable actor fingerprint and persisted operation payload, not mutable actor labels');
  ok(/operation !== "status" && operation !== "description" && operation !== "comment"/.test(reconcile)
    && /operation === "description"[\s\S]{0,700}patch: \{ brief: description \}[\s\S]{0,160}expectedOperationPayload = \{ description \}/.test(reconcile)
    && /operation === "description"[\s\S]{0,400}payload\.description === expectedPayload\.description/.test(receiptReader),
  'read-only reconciliation reconstructs the exact description fingerprint and compares the persisted Markdown payload without normalization');
  let executableIdentityRepair = extractFunction('identityRepair')
    .replace('value: unknown', 'value')
    .replace(': JsonMap', '');
  let executablePublicRow = extractFunction('publicRow')
    .replace('value: unknown', 'value')
    .replace(': JsonMap', '');
  let executablePublicDescriptionRow = extractFunction('publicDescriptionRow')
    .replace('value: unknown', 'value')
    .replace(': JsonMap', '');
  const publicRowContext = {
    parseJson: value => value && typeof value === 'object' ? value : {},
    clean: value => String(value == null ? '' : value).trim(),
    normalizeTeam: value => ({ video: 'video', graphics: 'graphics' })[String(value || '').toLowerCase()] || '',
  };
  vm.createContext(publicRowContext);
  vm.runInContext(executableIdentityRepair, publicRowContext);
  vm.runInContext(executablePublicRow, publicRowContext);
  vm.runInContext(executablePublicDescriptionRow, publicRowContext);
  const ordinaryPublicRow = publicRowContext.publicRow({
    id: 'deliverable-root',
    client_slug: 'test-client',
    team: 'video',
    title: 'Root',
    brief: markdownDescription,
  });
  ok(!Object.prototype.hasOwnProperty.call(ordinaryPublicRow, 'brief')
    && publicRowContext.publicDescriptionRow({
      id: 'deliverable-root',
      client_slug: 'test-client',
      team: 'video',
      title: 'Root',
      brief: markdownDescription,
    }).brief === markdownDescription
    && publicRowContext.publicDescriptionRow({
      id: 'deliverable-child',
      client_slug: 'test-client',
      team: 'graphics',
      title: 'Child',
      brief: null,
    }).brief === null,
  'ordinary status/comment/client rows do not expose brief while F202 rows preserve exact root/child Markdown and null clears');
  publicRowContext.GatewayError = class GatewayError extends Error {
    constructor(status, code, details) {
      super(code);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  };
  const executableAssertCas = extractFunction('assertCas')
    .replace('body: JsonMap', 'body')
    .replace('existing: JsonMap', 'existing')
    .replace(': void', '');
  vm.runInContext(executableAssertCas, publicRowContext);
  const casConflict = includeDescription => {
    try {
      publicRowContext.assertCas(
        { expected_updated_at: 'old' },
        {
          id: 'deliverable-cas',
          client_slug: 'test-client',
          team: 'video',
          title: 'CAS',
          brief: markdownDescription,
          updated_at: 'new',
        },
        includeDescription,
      );
      return null;
    } catch (error) {
      return error.details;
    }
  };
  const ordinaryCas = casConflict(false);
  const descriptionCas = casConflict(true);
  ok(ordinaryCas && !Object.prototype.hasOwnProperty.call(ordinaryCas.row, 'brief')
    && descriptionCas && descriptionCas.row.brief === markdownDescription,
  'pre-CAS conflicts expose brief only for the authenticated F202 operation');
  ok(/assertCas\(body, existing, operation === "description"\)/.test(entityHandler)
    && /row: operation === "description"[\s\S]{0,80}publicDescriptionRow\(result\)[\s\S]{0,100}operation === "comment"[\s\S]{0,80}publicRow\(existing\)/.test(entityHandler)
    && /row: operation === "description"[\s\S]{0,100}publicDescriptionRow\(current \|\| existing\)[\s\S]{0,100}publicRow\(current \|\| existing\)/.test(entityHandler)
    && /row: operation === "description" \? publicDescriptionRow\(current\) : publicRow\(current\)/.test(reconcile)
    && /\(operation === "labels" \|\| operation === "description"\) && principal\.kind === "client"/.test(entityHandler)
    && !/\bbrief\b/.test(extractFunction('publicRow')),
  'brief is gated to authenticated description success, DB-race conflict, and reconcile envelopes and cannot leak through client or ordinary public rows');
  const publicComment = extractFunction('publicComment');
  ok(publicComment.includes('"native_comment_id"')
    && publicComment.includes('"author_key"')
    && publicComment.includes('"body"')
    && publicComment.includes('"edited_at", "deleted_at"')
    && publicComment.includes('"resolved_at"'),
    'reconcile receipt exposes the canonical comment identity and edit/delete/resolve lifecycle fields');

  let executableReceipt = receiptReader
    .replace(/async function readOutboxReceipt\([\s\S]*?\): Promise<OutboxReceipt> \{/, 'async function readOutboxReceipt(supabase, dedup, expected) {')
    .replace(/ as JsonMap/g, '');
  const receiptContext = {
    GatewayError: class GatewayError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } },
    parseJson: value => value && typeof value === 'object' ? value : {},
    clean: value => String(value == null ? '' : value).trim(),
    lower: value => String(value == null ? '' : value).trim().toLowerCase(),
    normalizeTeam: value => ({ vid: 'video', video: 'video', gra: 'graphics', graphics: 'graphics' })[String(value || '').toLowerCase()] || '',
    Date, Number,
  };
  vm.createContext(receiptContext);
  vm.runInContext(executableReceipt, receiptContext);
  const receiptExpected = {
    entity: 'deliverable', entity_id: 'del-1', operation: 'status', client_slug: 'client-a', team: 'video',
    actor: 'Current Actor Label', role: 'smm', actor_key: 'member-stable-1',
    source_edited_at: '2026-07-12T00:00:00.000Z', legacy_parity: true, test_only: false,
    intent_fingerprint: 'fingerprint-1', payload: { status: 'approved' },
  };
  const receiptRow = {
    ...receiptExpected,
    actor: 'Historical Actor Label',
    role: 'creative',
    source_edited_at: '2026-07-12T00:00:00+00:00',
    payload: { status: 'approved', _intent_fingerprint: 'fingerprint-1' },
  };
  const receiptSupabase = data => ({
    from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data, error: null }; } }),
  });
  const exactReceipt = await receiptContext.readOutboxReceipt(receiptSupabase(receiptRow), 'dedup-1', receiptExpected);
  const absentReceipt = await receiptContext.readOutboxReceipt(receiptSupabase(null), 'dedup-1', receiptExpected);
  const conflictReceipt = await receiptContext.readOutboxReceipt(receiptSupabase({ ...receiptRow, legacy_parity: false }), 'dedup-1', receiptExpected);
  const corruptPayloadReceipt = await receiptContext.readOutboxReceipt(receiptSupabase({
    ...receiptRow,
    payload: { status: 'posted', _intent_fingerprint: 'fingerprint-1' },
  }), 'dedup-1', receiptExpected);
  const differentActorReceipt = await receiptContext.readOutboxReceipt(
    receiptSupabase(receiptRow),
    'dedup-1',
    { ...receiptExpected, actor_key: 'member-stable-2', intent_fingerprint: 'fingerprint-2' },
  );
  const commentReceiptExpected = {
    ...receiptExpected,
    entity: 'comment', operation: 'comment', intent_fingerprint: 'fingerprint-comment-1',
    payload: { body: 'Original comment body' },
  };
  const commentReceiptRow = {
    ...commentReceiptExpected,
    comment_id: 'comment-1',
    payload: { body: 'Original comment body', _intent_fingerprint: 'fingerprint-comment-1' },
  };
  const exactCommentPayloadReceipt = await receiptContext.readOutboxReceipt(
    receiptSupabase(commentReceiptRow), 'dedup-comment-1', commentReceiptExpected,
  );
  const corruptCommentPayloadReceipt = await receiptContext.readOutboxReceipt(receiptSupabase({
    ...commentReceiptRow,
    payload: { body: 'Corrupted original body', _intent_fingerprint: 'fingerprint-comment-1' },
  }), 'dedup-comment-1', commentReceiptExpected);
  const descriptionReceiptExpected = {
    ...receiptExpected,
    operation: 'description',
    intent_fingerprint: 'fingerprint-description-1',
    payload: { description: markdownDescription },
  };
  const descriptionReceiptRow = {
    ...descriptionReceiptExpected,
    payload: {
      description: markdownDescription,
      _intent_fingerprint: 'fingerprint-description-1',
    },
  };
  const exactDescriptionReceipt = await receiptContext.readOutboxReceipt(
    receiptSupabase(descriptionReceiptRow), 'dedup-description-1', descriptionReceiptExpected,
  );
  const whitespaceChangedDescriptionReceipt = await receiptContext.readOutboxReceipt(
    receiptSupabase({
      ...descriptionReceiptRow,
      payload: {
        description: markdownDescription.trim(),
        _intent_fingerprint: 'fingerprint-description-1',
      },
    }),
    'dedup-description-1',
    descriptionReceiptExpected,
  );
  const clearDescriptionReceipt = await receiptContext.readOutboxReceipt(
    receiptSupabase({
      ...descriptionReceiptRow,
      payload: { description: '', _intent_fingerprint: 'fingerprint-description-clear' },
    }),
    'dedup-description-clear',
    {
      ...descriptionReceiptExpected,
      intent_fingerprint: 'fingerprint-description-clear',
      payload: { description: '' },
    },
  );
  ok(exactReceipt.outcome === 'committed_exact'
    && absentReceipt.outcome === 'absent'
    && conflictReceipt.outcome === 'conflict'
    && corruptPayloadReceipt.outcome === 'conflict'
    && differentActorReceipt.outcome === 'conflict'
    && exactCommentPayloadReceipt.outcome === 'committed_exact'
    && corruptCommentPayloadReceipt.outcome === 'conflict'
    && exactDescriptionReceipt.outcome === 'committed_exact'
    && whitespaceChangedDescriptionReceipt.outcome === 'conflict'
    && clearDescriptionReceipt.outcome === 'committed_exact',
  'receipt classifier keeps exact description/clear payloads and rejects Markdown whitespace drift alongside status/comment corruption');

  let executableCanonicalComment = extractFunction('canonicalCommentMatchesReceipt')
    .replace(/function canonicalCommentMatchesReceipt\([\s\S]*?\): boolean \{/, 'function canonicalCommentMatchesReceipt(value, expected, outboxCommentId) {');
  ok(!/expected\.id(?![A-Za-z0-9_])/.test(executableCanonicalComment),
    'canonical receipt trusts the atomic outbox comment id rather than a recomputed requested id');
  vm.runInContext(executableCanonicalComment, receiptContext);
  const expectedCanonicalComment = {
    id: 'comment-1', idempotency_key: 'dedup-comment-1', deliverable_id: 'del-1', batch_id: null,
    client_slug: 'client-a', team: 'video', author_key: 'member-stable-1',
    native_comment_id: 'native-comment-1', body: 'Exact body', audience: 'internal',
    component: 'caption', parent_id: 'parent-1', is_tweak: true, round: 2,
  };
  const canonicalComment = { ...expectedCanonicalComment };
  const adoptedCanonicalComment = { ...canonicalComment, id: 'existing-comment-9' };
  const adoptedRequestExpectation = { ...expectedCanonicalComment, id: 'requested-comment-9' };
  const editedCanonicalComment = {
    ...canonicalComment,
    body: 'Edited current body',
    audience: 'client',
    component: 'thumbnail',
    parent_id: 'parent-2',
    is_tweak: false,
    round: 3,
    edited_at: '2026-07-13T00:00:00Z',
    deleted_at: '2026-07-14T00:00:00Z',
    resolved_at: '2026-07-15T00:00:00Z',
  };
  const corruptImmutableFields = [
    ['id', 'comment-2'],
    ['native_comment_id', 'native-comment-2'],
    ['author_key', 'member-stable-2'],
    ['deliverable_id', 'del-2'],
    ['idempotency_key', 'dedup-comment-2'],
  ];
  ok(receiptContext.canonicalCommentMatchesReceipt(editedCanonicalComment, expectedCanonicalComment, 'comment-1')
    && receiptContext.canonicalCommentMatchesReceipt(
      adoptedCanonicalComment,
      adoptedRequestExpectation,
      'existing-comment-9',
    )
    && corruptImmutableFields.every(([field, value]) => !receiptContext.canonicalCommentMatchesReceipt(
      { ...canonicalComment, [field]: value },
      expectedCanonicalComment,
      'comment-1',
    ))
    && !receiptContext.canonicalCommentMatchesReceipt(canonicalComment, expectedCanonicalComment, 'comment-2')
    && !receiptContext.canonicalCommentMatchesReceipt(canonicalComment, expectedCanonicalComment, null),
  'canonical association accepts edited or atomically adopted rows but rejects immutable identity drift or wrong/missing outbox comment id');

  const validationPos = edge.indexOf('await projectForIntake(client, team, principal)');
  const firstWritePos = edge.indexOf('const batch = await ensureBatch(');
  ok(/project\(id: \$id\) \{ id name teams \{ nodes \{ id key \} \} \}/.test(edge)
    && /projectIdsForTeam\(client\.linear_project_ids, team\)/.test(edge)
    && validationPos > 0 && firstWritePos > validationPos,
  'team-tagged projects are read-only validated by Linear team before any native write');
  ok(/tagged\.length > 1/.test(edge) && /project_mapping_ambiguous/.test(edge)
    && /throw new GatewayError\(409, "project_mapping_missing"\)/.test(edge)
    && !/matching = projects\.filter/.test(edge.slice(edge.indexOf('async function projectForIntake'), edge.indexOf('function teamIdFor'))),
  'missing, ambiguous, or untagged real-client mappings fail closed without exact-name create fallback');
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
  ok(/row: operation === "description"[\s\S]{0,80}publicDescriptionRow\(result\)[\s\S]{0,100}operation === "comment"[\s\S]{0,80}publicRow\(existing\)[\s\S]{0,80}publicRow\(result\)/.test(edge)
    && /operation === "comment" \? \{ comment: parseJson\(result\) \}/.test(edge),
  'comment success preserves the target entity CAS row and returns the durable comment separately');
  ok(/terminalValueProof/.test(inboundEchoProof)
    && /const isCommentEvent = resource\.includes\("comment"\)/.test(inbound)
    && /: issueFromPayload\(payload\)/.test(inbound)
    && /if \(!issueId\) return null/.test(inbound)
    && /lower\(row\.status\) === "written"/.test(inboundEchoProof)
    && /if \(!actorMatches && !terminalValueProof && !openF27PreflightProof\) continue/.test(inbound),
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
  ok(/if \(!replay\)[\s\S]{0,300}assertCas\(body, existing, operation === "description"\)/.test(edge),
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
  ok(/linear_identifier: clean\(row\.linear_identifier\)/.test(edge)
    && /linear_issue_url: clean\(row\.linear_issue_url\)/.test(edge),
  'intake response returns transitional Linear linkage alongside native identity');
  ok(/origin: "calendar"/.test(edge)
    && /clean\(existing\.card_id\) !== clean\(row\.card_id\)/.test(edge),
  'submission deliverables use the canonical Calendar card-slot identity and protect it on replay');
  ok(/browserCredentialTestOverride\(body\.test_override, key, token\)/.test(edge)
    && /serviceTestOverrideAllowed\(key, token, body\.confirm, await serviceRoleRequest\(req\)\)/.test(edge)
    && !/deriveBrowserTestScope/.test(edge)
    && !/testOnly: canonicalTest/.test(edge),
  'canonical TEST rows enter bounded TEST scope only through the service-authenticated override');
  ok(/comment_parent_forbidden/.test(edge)
    && /clean\(parent\.audience\) !== "client"/.test(edge)
    && /native_comment_id/.test(edge),
  'client replies cannot enter internal threads and legacy native comment ids are retained');
  ok(/dedupKey\("comment", entity, id, `native:\$\{suppliedNativeId\}`\)/.test(edge)
    && /deterministicNativeId\("pc", `\$\{entity\}:\$\{id\}`, suppliedNativeId\)/.test(edge)
    && /v_existing_native_dedup is distinct from v_dedup_key/.test(migration),
  'a stable Calendar/SXR native comment id owns exactly one semantic outbox intent across request-id retries');
  ok(/const row = includeDescription \? publicDescriptionRow\(existing\) : publicRow\(existing\)/.test(edge)
    && /conflict: true, row \}/.test(edge)
    && /error\.code === "write_conflict"/.test(edge)
    && /row: operation === "description"[\s\S]{0,100}publicDescriptionRow\(current \|\| existing\)[\s\S]{0,100}publicRow\(current \|\| existing\)/.test(edge),
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
