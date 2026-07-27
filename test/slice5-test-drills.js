'use strict';
/*
 * Slice 5 TEST-drill lane contract.
 *
 * Offline only: this suite imports pure runner seams and inspects source/YAML.
 * It never supplies credentials, starts a browser, calls a backend, or invokes
 * main(). The live proof remains an owner-dispatched, main-ancestor-only lane.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'slice5-test-drills.js');
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'slice5-test-drills.yml');
const POLICY_PATH = path.join(
  ROOT,
  'supabase',
  'functions',
  'production-write',
  'policy.mjs',
);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function stepBlock(workflow, name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  if (start < 0) return '';
  const next = workflow.indexOf('\n      - ', start + marker.length);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

function sourceFunction(source, name) {
  const match = new RegExp(
    `(?:async\\s+)?function\\s+${name}\\s*\\([\\s\\S]*?\\)\\s*\\{`,
  ).exec(source);
  if (!match) return '';
  const brace = match.index + match[0].length - 1;
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index++;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(match.index, index + 1);
  }
  return '';
}

function publicLeavesAreSafe(value) {
  const safeEnums = new Set([
    'pass',
    'passed',
    'fail',
    'not_run',
    'none',
    'test_only',
    'active_test_only',
    'ready',
    'refused',
    'accepted',
    'degraded',
    'recovered',
    'no_personal_queue',
    'assignee_out_of_scope',
    'assignee_role_incompatible',
    'assignee_mapping_unavailable',
    'assignee_provider_inactive',
    'operation_forbidden',
    'preflight',
    'f94_negative',
    'f94_stale_picker',
    'f136_matrix',
    'f37_identity',
    'f95_convergence',
    'cleanup',
    'flag_invariant',
    'read_rebaseline',
    'report',
  ]);
  const forbiddenKey = /(?:^|_)(?:id|ids|slug|slugs|time|times|timestamp|timestamps|date|dates|error|errors|message|messages|stack|stacks|detail|details|url|urls|path|paths|name|names)(?:_|$)/i;

  function visit(item) {
    if (typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isInteger(item) && item >= 0;
    if (typeof item === 'string') return safeEnums.has(item);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    return Object.entries(item).every(([key, child]) =>
      (!forbiddenKey.test(key) || key === 'error_code') && visit(child));
  }
  return visit(value);
}

(async () => {
  ok(fs.existsSync(SCRIPT_PATH), 'the Slice 5 runner exists');
  ok(fs.existsSync(WORKFLOW_PATH), 'the owner-gated workflow exists');
  if (!fs.existsSync(SCRIPT_PATH) || !fs.existsSync(WORKFLOW_PATH)) {
    process.exit(1);
  }

  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r/g, '');
  const runner = require(SCRIPT_PATH);
  const policy = await import(`${pathToFileURL(POLICY_PATH).href}?slice5-drill-contract`);

  // ---- Workflow: manual, pinned, trusted-main provenance ----------------
  ok(/^on:\n  workflow_dispatch:\n    inputs:\n      commit_sha:/m.test(workflow),
    'workflow_dispatch exposes the required commit_sha input');
  ok(/commit_sha:[\s\S]{0,180}required: true[\s\S]{0,80}type: string/.test(workflow),
    'commit_sha is a required string');
  ok(!/^  (?:push|pull_request|pull_request_target|schedule|workflow_call):/m.test(workflow),
    'the live drill has no push, PR, schedule, or reusable-workflow trigger');
  ok(/^permissions:\n  contents: read$/m.test(workflow)
    && !/contents:\s*write/.test(workflow),
  'workflow permissions are contents-read only');
  ok(/^concurrency:\n  group: slice5-test-drills\n  cancel-in-progress: false$/m.test(workflow),
    'one non-canceling concurrency group serializes TEST fixture use');
  ok(/^    environment: production$/m.test(workflow),
    'the drill job is protected by the production Environment');
  ok(/^    timeout-minutes: 180$/m.test(workflow),
    'the full matrix has enough bounded runner time to reach its own cleanup');
  ok(!/\balways\(\)/.test(workflow), 'the workflow has no always() step');

  const drillClock = stepBlock(workflow, 'Start the bounded drill clock');
  const trustedCheckout = stepBlock(workflow, 'Check out trusted main for the provenance gate');
  const provenance = stepBlock(workflow, 'Verify requested commit is an exact ancestor of origin/main');
  const pinnedCheckout = stepBlock(workflow, 'Check out the verified commit');
  const exactHead = stepBlock(workflow, 'Reverify exact checked-out commit');
  const trustedAt = workflow.indexOf('      - name: Check out trusted main for the provenance gate');
  const clockAt = workflow.indexOf('      - name: Start the bounded drill clock');
  const provenanceAt = workflow.indexOf('      - name: Verify requested commit is an exact ancestor of origin/main');
  const pinnedAt = workflow.indexOf('      - name: Check out the verified commit');
  ok(trustedAt >= 0 && provenanceAt > trustedAt && pinnedAt > provenanceAt,
    'trusted main checkout and ancestry proof precede dispatched-SHA checkout');
  ok(clockAt >= 0 && clockAt < trustedAt
    && /SLICE5_JOB_STARTED_AT_MS=%s/.test(drillClock)
    && /\$GITHUB_ENV/.test(drillClock)
    && !/secrets\./.test(drillClock),
  'a credential-free workflow clock starts before checkout and dependency setup');
  ok(/ref: refs\/heads\/main/.test(trustedCheckout)
    && /fetch-depth: 0/.test(trustedCheckout)
    && /persist-credentials: false/.test(trustedCheckout),
  'the provenance gate begins from a credential-free full-depth main checkout');
  ok(/\^\[0-9a-f\]\{40\}\$/.test(provenance)
    && /git merge-base --is-ancestor "\$RUN_COMMIT" origin\/main/.test(provenance)
    && /git cat-file -e "\$RUN_COMMIT\^\{commit\}"/.test(provenance),
  'the gate requires exact lowercase 40-hex commit shape, existence, and main ancestry');
  ok(/ref: \$\{\{ steps\.provenance\.outputs\.validated_commit \}\}/.test(pinnedCheckout)
    && /fetch-depth: 0/.test(pinnedCheckout)
    && /persist-credentials: false/.test(pinnedCheckout),
  'only the gate output can select the full-depth drill checkout');
  ok(/git rev-parse HEAD/.test(exactHead)
    && /\[ "\$actual" != "\$RUN_COMMIT" \]/.test(exactHead),
  'the checked-out HEAD is reverified against the gated SHA');

  ok(/uses: actions\/setup-node@v4[\s\S]{0,100}node-version: '22'/.test(workflow),
    'the lane uses Node 22');
  ok(/npm install --no-save --package-lock=false/.test(workflow)
    && !/npm ci/.test(workflow),
  'dependencies install without inventing a lockfile in this lockfile-free repository');
  ok(/npx playwright install --with-deps chromium/.test(workflow),
    'the owner lane installs Playwright Chromium');

  const drillStep = stepBlock(workflow, 'Run the guarded TEST-only drill suite');
  const secretNames = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'LINEAR_API_KEY',
    'ROLE_KEY_ADMIN',
    'ROLE_KEY_SMM',
    'ROLE_KEY_CREATIVE',
  ];
  ok(secretNames.every(name =>
    drillStep.includes(`${name}: \${{ secrets.${name} }}`)),
  'all service/provider/role credentials are present under their exact environment-secret names');
  ok(secretNames.every(name => occurrences(workflow, `secrets.${name}`) === 1)
    && occurrences(workflow, 'secrets.') === secretNames.length,
  'all secrets are referenced exactly once and only by the drill step');
  ok(/for name in[\s\S]{0,220}SUPABASE_SERVICE_ROLE_KEY LINEAR_API_KEY[\s\S]{0,120}ROLE_KEY_ADMIN ROLE_KEY_SMM ROLE_KEY_CREATIVE/.test(drillStep)
    && /if \[ -z "\$\{!name\}" \]/.test(drillStep),
  'the credential-bearing step refuses a missing service, provider, or role key before running');
  ok(!workflow.slice(0, workflow.indexOf('    steps:')).includes('secrets.'),
    'no secret is job-scoped');
  ok(drillStep.includes("SLICE5_TEST_DRILLS_CONFIRM: 'SLICE5_TEST_ONLY'")
    && drillStep.includes('SLICE5_TEST_DRILLS_REPORT: artifacts/slice5-test-drills.json')
    && drillStep.includes('SLICE5_TEST_DRILLS_PRIVATE_LOG: ${{ runner.temp }}/slice5-test-drills-private.json'),
  'confirmation, public report, and runner-private failure paths are fixed');
  ok(/> "\$\{RUNNER_TEMP\}\/slice5-test-drills-console\.log" 2>&1/.test(drillStep)
    && !/\btee\b/.test(drillStep),
  'raw drill process output remains runner-private and is never teed to the public log');

  const aggregateStep = stepBlock(workflow, 'Validate the public-safe aggregate');
  const uploadStep = stepBlock(workflow, 'Upload public-safe drill aggregate');
  ok(/forbiddenKey/.test(aggregateStep)
    && /safeEnums/.test(aggregateStep)
    && /'read_rebaseline'/.test(aggregateStep)
    && /unsafe_public_aggregate/.test(aggregateStep),
  'an independent recursive allowlist validates aggregate keys and leaf values');
  ok(/uses: actions\/upload-artifact@v4/.test(uploadStep)
    && /path: artifacts\/slice5-test-drills\.json/.test(uploadStep)
    && /if-no-files-found: error/.test(uploadStep)
    && !/\n\s+if:/.test(uploadStep),
  'only the success-path public aggregate is uploaded');

  // ---- Runner: import-safe, fail-closed TEST target ----------------------
  ok(/if \(require\.main === module\)/.test(source),
    'importing pure test seams cannot start a live drill');
  for (const exportName of [
    'sanitizePublicReport',
    'discoverUniqueActiveTestClient',
    'assertActiveTestWriteTarget',
    'assertSyntheticMemberMutationAllowed',
    'classifyMatrixAttempt',
    'expectedCreativeAcceptedSet',
    'matrixSyntheticStamp',
    'requestDeadlineMs',
    'memberReferenceIds',
    'assertWriteMemberReferencesRunOwned',
    'readCompleteRoster',
    'acquireBoundedResource',
    'installBrowserRoutes',
    'stableJson',
    'liveRequest',
    'writePrivateFailure',
    'main',
  ]) {
    ok(typeof runner[exportName] === 'function', `runner exports pure seam ${exportName}`);
  }
  ok(source.includes('SLICE5_TEST_ONLY')
    && source.includes('SLICE5_TEST_DRILLS_CONFIRM'),
  'main requires the exact fixed TEST-only confirmation');
  ok(/expected exactly one active TEST client/i.test(source)
    || /unique active TEST client/i.test(source),
  'the runner aborts unless exactly one active TEST client is discovered');
  ok(!/sidneylaruel/i.test(source),
    'the active TEST client is discovered rather than hard-coded by slug');

  const activeGuard = sourceFunction(source, 'assertActiveTestWriteTarget');
  ok(/active/i.test(activeGuard) && /\btest\b/i.test(activeGuard)
    && /targetClientSlug/.test(activeGuard)
    && /discoverUniqueActiveTestClient/.test(activeGuard),
  'the pre-send target guard re-reads active TEST client scope');
  ok(/\bassert\(/.test(activeGuard)
    && /write target is not the unique active TEST client/.test(activeGuard),
    'a non-TEST target aborts instead of being skipped');

  const mutationAdapters = runner.WRITE_ADAPTERS;
  ok(Array.isArray(mutationAdapters)
    && JSON.stringify(mutationAdapters) === JSON.stringify([
      'restWrite',
      'edgeWrite',
      'gatewayWrite',
      'guardedBrowserVerifier',
    ]),
    'network mutations are centralized in explicitly guarded write adapters');
  for (const name of mutationAdapters) {
    const body = sourceFunction(source, name);
    const guardAt = body.indexOf('assertActiveTestWriteTarget');
    const sendAt = body.indexOf('liveRequest(');
    ok(body && guardAt >= 0 && sendAt >= 0 && guardAt < sendAt,
      `${name} revalidates active TEST scope immediately before its send`);
  }
  ok(/WRITE_(?:ADAPTERS|KINDS)/.test(source),
    'the finite mutation-adapter inventory is source-visible for review');

  // Disposable members must be both drill-marked and created by this run.
  const memberGuard = sourceFunction(source, 'assertSyntheticMemberMutationAllowed');
  ok(/runtime\.createdMemberIds\.has\(id\)/.test(memberGuard)
    && /!runtime\.readOnlyMemberIds\.has\(id\)/.test(memberGuard)
    && /markerPresent\(row\.(?:name|email), runtime\)/.test(memberGuard)
    && /\bassert\(/.test(memberGuard),
  'member writes require the drill marker/run-created allowlist and reject real roster ids');
  ok(/(?:DRILL_MEMBER_MARKER|DRILL_MARKER)/.test(source)
    && /new Set\(\)/.test(source),
  'the runner carries an explicit drill marker and disposable-member allowlist');
  const realMemberId = 'inactive-real-member';
  const nestedMemberPayload = {
    patch: {
      reviewer_member_id: realMemberId,
      deeper: [{ member_id: realMemberId }],
    },
  };
  ok(JSON.stringify(runner.memberReferenceIds(nestedMemberPayload).sort())
      === JSON.stringify([realMemberId, realMemberId].sort()),
  'the recursive guard discovers nested and generic member references');
  const serializedMemberPayload = {
    patch: JSON.stringify({ nested: { assignee_id: realMemberId } }),
  };
  ok(JSON.stringify(runner.memberReferenceIds(serializedMemberPayload))
      === JSON.stringify([realMemberId])
    && JSON.stringify(runner.postgrestMemberReferenceIds(
      `deliverables?assignee_id=eq.${realMemberId}`,
    )) === JSON.stringify([realMemberId]),
  'the firewall discovers serialized patch and mutation-query member references');
  let guardedFetches = 0;
  const offlineGuardRuntime = {
    runToken: 'slice5-offline',
    client: { slug: 'test-only' },
    config: {
      supabaseUrl: 'https://offline.invalid',
      serviceKey: 'offline',
      publicAnonKey: 'offline',
      roleKeys: { admin: 'offline', smm: 'offline', creative: 'offline' },
    },
    processDeadlineAt: Date.now() + (60 * 60_000),
    cleanupStarted: false,
    activeRequestControllers: new Set(),
    readOnlyMemberIds: new Set([realMemberId]),
    createdMemberIds: new Set([realMemberId]),
    createdDeliverableIds: new Set(),
    createdBatchIds: new Set(),
    createdDedups: new Set(),
    fetch: async () => {
      guardedFetches++;
      throw new Error('offline guard leaked to fetch');
    },
  };
  let readEscapeFetches = 0;
  const readEscapeRuntime = {
    ...offlineGuardRuntime,
    fetch: async () => {
      readEscapeFetches++;
      throw new Error('mutation-shaped read helper leaked to fetch');
    },
  };
  let readEscapeRejects = 0;
  for (const invoke of [
    () => runner.restRead(readEscapeRuntime, 'clients?active=eq.true', {
      method: 'DELETE',
      stage: 'preflight',
    }),
    () => runner.restRead(readEscapeRuntime, 'team_members?id=neq.none', {
      method: 'PATCH',
      stage: 'preflight',
    }),
    () => runner.linearRead(
      readEscapeRuntime,
      'mutation Escape { issueArchive(id: "real") { success } }',
      {},
      'preflight',
    ),
  ]) {
    try {
      await invoke();
    } catch (_error) {
      readEscapeRejects++;
    }
  }
  ok(readEscapeRejects === 3 && readEscapeFetches === 0,
    'read helpers reject mutation-capable HTTP and GraphQL shapes before fetch');
  for (const invoke of [
    () => runner.restWrite(offlineGuardRuntime, 'deliverables?id=eq.offline', {
      method: 'PATCH',
      body: nestedMemberPayload,
      targetClientSlug: 'test-only',
      stage: 'f94_negative',
    }),
    () => runner.edgeWrite(
      offlineGuardRuntime,
      'offline-edge',
      nestedMemberPayload,
      { targetClientSlug: 'test-only', stage: 'f94_negative' },
    ),
    () => runner.gatewayWrite(
      offlineGuardRuntime,
      nestedMemberPayload,
      { targetClientSlug: 'test-only', stage: 'f136_matrix' },
    ),
    () => runner.guardedBrowserVerifier(offlineGuardRuntime, {
      method: () => 'POST',
      url: () => 'https://offline.invalid/functions/v1/key-verify',
      postData: () => JSON.stringify({
        surface: 'staff-login',
        member: { id: realMemberId },
      }),
      headers: () => ({}),
    }, 'offline', {
      targetClientSlug: 'test-only',
      stage: 'f37_identity',
    }),
  ]) {
    let rejected = false;
    try {
      await invoke();
    } catch (_error) {
      rejected = true;
    }
    ok(rejected && guardedFetches === 0,
      'a write adapter aborts an inactive/nested real-member reference before fetch');
  }
  let serializedRejects = 0;
  for (const invoke of [
    () => runner.restWrite(offlineGuardRuntime, 'deliverables?id=eq.offline', {
      method: 'PATCH',
      body: serializedMemberPayload,
      targetClientSlug: 'test-only',
      stage: 'f136_matrix',
    }),
    () => runner.edgeWrite(
      offlineGuardRuntime,
      'offline-edge',
      serializedMemberPayload,
      { targetClientSlug: 'test-only', stage: 'f136_matrix' },
    ),
    () => runner.gatewayWrite(
      offlineGuardRuntime,
      serializedMemberPayload,
      { targetClientSlug: 'test-only', stage: 'f136_matrix' },
    ),
  ]) {
    try {
      await invoke();
    } catch (_error) {
      serializedRejects++;
    }
  }
  let queryRejected = false;
  try {
    await runner.restWrite(
      offlineGuardRuntime,
      `deliverables?assignee_id=eq.${realMemberId}`,
      {
        method: 'PATCH',
        body: { status: 'todo' },
        targetClientSlug: 'test-only',
        stage: 'f136_matrix',
      },
    );
  } catch (_error) {
    queryRejected = true;
  }
  let logicalQueryRejected = false;
  try {
    await runner.restWrite(
      offlineGuardRuntime,
      `deliverables?or=(assignee_id.eq.${realMemberId},status.eq.todo)`,
      {
        method: 'PATCH',
        body: { status: 'todo' },
        targetClientSlug: 'test-only',
        stage: 'f136_matrix',
      },
    );
  } catch (_error) {
    logicalQueryRejected = true;
  }
  ok(serializedRejects === 3
    && queryRejected
    && logicalQueryRejected
    && guardedFetches === 0,
  'every accepting adapter rejects serialized, direct-query, or logical-filter member escapes before fetch');
  let broadTargetFetches = 0;
  const broadTargetRuntime = {
    ...offlineGuardRuntime,
    readOnlyMemberIds: new Set(),
    createdMemberIds: new Set(),
    createdDeliverableIds: new Set(['owned-deliverable']),
    fetch: async () => {
      broadTargetFetches++;
      throw new Error('broad PostgREST target leaked to fetch');
    },
  };
  let broadTargetRejects = 0;
  for (const resource of [
    'deliverables?status=eq.todo',
    'deliverables?id=eq.owned-deliverable',
    'deliverables?id=eq.some-other-row&client_slug=eq.test-only',
    'clients?id=eq.owned-deliverable&client_slug=eq.test-only',
  ]) {
    try {
      await runner.restWrite(broadTargetRuntime, resource, {
        method: 'PATCH',
        body: { status: 'todo' },
        deliverableId: 'owned-deliverable',
        targetClientSlug: 'test-only',
        stage: 'f136_matrix',
      });
    } catch (_error) {
      broadTargetRejects++;
    }
  }
  ok(broadTargetRejects === 4 && broadTargetFetches === 0,
    'PostgREST writes bind the allowed table, exact run-owned id, and active TEST client before fetch');
  let edgeTargetFetches = 0;
  const edgeTargetRuntime = {
    ...broadTargetRuntime,
    createdBatchIds: new Set(['owned-batch']),
    createdDedups: new Set(['owned-dedup']),
    fetch: async () => {
      edgeTargetFetches++;
      throw new Error('mismatched Edge target leaked to fetch');
    },
  };
  let edgeTargetRejects = 0;
  for (const invoke of [
    () => runner.edgeWrite(edgeTargetRuntime, 'deliverable-write', {
      id: 'real-deliverable',
      operation: 'archive',
      patch: {},
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    }, {
      deliverableId: 'owned-deliverable',
      targetClientSlug: 'test-only',
      stage: 'cleanup',
    }),
    () => runner.edgeWrite(edgeTargetRuntime, 'batch-write', {
      id: 'real-batch',
      operation: 'archive',
      patch: {},
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    }, {
      batchId: 'owned-batch',
      targetClientSlug: 'test-only',
      stage: 'cleanup',
    }),
    () => runner.edgeWrite(edgeTargetRuntime, 'unknown-write', {
      id: 'owned-deliverable',
    }, {
      deliverableId: 'owned-deliverable',
      targetClientSlug: 'test-only',
      stage: 'cleanup',
    }),
    () => runner.edgeWrite(edgeTargetRuntime, 'linear-outbound', {
      limit: 1,
      target_dedup_key: 'foreign-dedup',
      test_override: {
        client_slug: 'test-only',
        mode: 'live',
        authority: 'syncview',
      },
      confirm: 'B4_TEST_ONLY',
    }, {
      targetClientSlug: 'test-only',
      stage: 'cleanup',
    }),
  ]) {
    try {
      await invoke();
    } catch (_error) {
      edgeTargetRejects++;
    }
  }
  ok(edgeTargetRejects === 4 && edgeTargetFetches === 0,
    'Edge writes bind function, body target, and outbound dedup before fetch');
  let gatewayTargetFetches = 0;
  const gatewayTargetRuntime = {
    ...edgeTargetRuntime,
    fetch: async () => {
      gatewayTargetFetches++;
      throw new Error('mismatched gateway target leaked to fetch');
    },
  };
  let gatewayTargetRejects = 0;
  for (const body of [
    {
      operation: 'assignee',
      entity: 'deliverable',
      surface: 'production',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'assignee',
      entity: 'deliverable',
      surface: 'production',
      id: 'real-deliverable',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'assignee',
      entity: 'deliverable',
      surface: 'production',
      id: 'owned-deliverable',
      client_slug: 'real-client',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'intake_create',
      entity: 'deliverable',
      surface: 'production',
      id: 'owned-deliverable',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'assignee',
      entity: 'batch',
      surface: 'production',
      id: 'owned-deliverable',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
    {
      operation: 'assignee',
      entity: 'deliverable',
      surface: 'calendar',
      id: 'owned-deliverable',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    },
  ]) {
    try {
      await runner.gatewayWrite(gatewayTargetRuntime, body, {
        targetClientSlug: 'test-only',
        stage: 'f94_negative',
      });
    } catch (_error) {
      gatewayTargetRejects++;
    }
  }
  ok(gatewayTargetRejects === 6 && gatewayTargetFetches === 0,
    'gateway writes bind production surface, operation, entity, body id, and client scope before fetch');
  let assigneeOptionFetches = 0;
  const assigneeOptionsRuntime = {
    ...gatewayTargetRuntime,
    fetch: async (url, init = {}) => {
      assigneeOptionFetches++;
      const href = String(url);
      if (href.includes('/rest/v1/deliverables?')) {
        return new Response(JSON.stringify([{
          id: 'owned-deliverable',
          client_slug: 'test-only',
          title: 'drill slice5-offline fixture',
          brief: 'drill slice5-offline fixture',
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (href.includes('/rest/v1/clients?')) {
        return new Response(JSON.stringify([{
          slug: 'test-only',
          kind: 'test',
          active: true,
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (href.endsWith('/functions/v1/production-write') && init.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          complete: true,
          assignees: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('unexpected offline assignee-options request');
    },
  };
  const assigneeOptionsBody = {
    action: 'assignee_options',
    surface: 'production',
    id: 'owned-deliverable',
    client_slug: 'test-only',
    request_id: 'offline-assignee-options',
    test_override: true,
    confirm: 'B4_TEST_ONLY',
  };
  const assigneeOptionsResponse = await runner.gatewayWrite(
    assigneeOptionsRuntime,
    assigneeOptionsBody,
    { targetClientSlug: 'test-only', stage: 'f94_stale_picker' },
  );
  const assigneeOptionsFetchesAfterSuccess = assigneeOptionFetches;
  let assigneeOptionsMutationShapeRejected = false;
  try {
    await runner.gatewayWrite(assigneeOptionsRuntime, {
      ...assigneeOptionsBody,
      status: 'todo',
    }, {
      targetClientSlug: 'test-only',
      stage: 'f94_stale_picker',
    });
  } catch (_error) {
    assigneeOptionsMutationShapeRejected = true;
  }
  ok(assigneeOptionsResponse.status === 200
      && assigneeOptionsFetchesAfterSuccess === 3
      && assigneeOptionsMutationShapeRejected
      && assigneeOptionFetches === assigneeOptionsFetchesAfterSuccess,
  'the stale-picker assignee-options read has one exact offline courier and rejects mutation fields');
  ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(source),
    'the runner embeds no member, deliverable, or event UUID');

  // ---- Public privacy: a closed projection, not generic redaction --------
  const rawPrivateFixture = {
    schema_version: 1,
    ok: false,
    mode: 'test_only',
    scope: 'active_test_only',
    error_code: 'preflight',
    client_slug: 'private-real-client',
    member_id: 'private-member-id',
    occurred_at: '2026-07-26T00:00:00Z',
    error: { message: 'private backend failure', stack: 'private stack' },
  };
  let rawFixtureRejected = false;
  try {
    runner.sanitizePublicReport(rawPrivateFixture);
  } catch (error) {
    rawFixtureRejected = /public report/.test(String(error && error.message));
  }
  ok(rawFixtureRejected,
    'the public projection rejects rather than redacts a payload containing private strings');
  const sanitized = runner.sanitizePublicReport(runner.emptyReport());
  const publicText = JSON.stringify(sanitized);
  ok(publicLeavesAreSafe(sanitized),
    'the sanitizer emits only finite enums, non-negative counts, and booleans');
  ok(Object.prototype.hasOwnProperty.call(sanitized.f37_identity, 'duplicate_label_ok')
    && !Object.prototype.hasOwnProperty.call(sanitized.f37_identity, 'duplicate_names_ok'),
  'duplicate-display-name evidence is a boolean with no identity-bearing key');
  ok(!Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'route_mode_count')
    && !Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'device_count'),
  'public F136 evidence does not overclaim unexercised route or device paths');
  for (const privateValue of [
    'private-real-client',
    'private-member-id',
    '2026-07-26',
    'private backend failure',
    'private stack',
  ]) {
    ok(!publicText.includes(privateValue), `public payload excludes private fixture value: ${privateValue}`);
  }
  ok(!/"(?:client_slug|member_id|occurred_at|error|message|stack|details?)"\s*:/.test(publicText),
    'public payload contains no raw errors, ids, slugs, times, or details');

  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slice5-drill-private-'));
  const privateLog = path.join(privateDir, 'failure.json');
  ok(runner.writePrivateFailure(
    new Error('private failure detail'),
    'f94_negative',
    privateLog,
    ROOT,
  ), 'raw failure detail can be written only to an explicit runner-private path');
  const privatePayload = JSON.parse(fs.readFileSync(privateLog, 'utf8'));
  ok(privatePayload.message === 'private failure detail'
    && privatePayload.stack.includes('private failure detail'),
  'the runner-private failure file retains diagnostic detail');
  let repoPrivateRejected = false;
  const repoPrivatePath = path.join(ROOT, 'artifacts', 'must-not-exist-private.json');
  try {
    runner.writePrivateFailure(new Error('do not publish'), 'fixture', repoPrivatePath, ROOT);
  } catch (_error) {
    repoPrivateRejected = true;
  }
  ok(repoPrivateRejected && !fs.existsSync(repoPrivatePath),
    'private failure detail is refused anywhere inside the public repository');
  ok(!/console\.(?:log|error)\([^)]*(?:failure|error)\.(?:message|stack)/.test(source)
    && !/\btee\b/.test(source),
  'raw failure bodies are not wired to console output');

  // ---- F94: all four refusals plus exact zero/atomic proofs ---------------
  const refusalEnums = [
    'assignee_out_of_scope',
    'assignee_role_incompatible',
    'assignee_mapping_unavailable',
    'assignee_provider_inactive',
  ];
  ok(refusalEnums.every(value => source.includes(value)),
    'F94 covers every owed refusal enum');
  ok(/F94_REFUSAL_ENUMS/.test(source)
    && refusalEnums.every(value =>
      (source.match(new RegExp(`${value}['"]?\\s*[:,]?[\\s\\S]{0,100}\\b(?:403|409)\\b`))
        || source.match(new RegExp(`\\b(?:403|409)\\b[\\s\\S]{0,100}${value}`)))),
  'F94 refusal enum/status expectations are explicit');
  ok(source.includes('deliverables')
    && source.includes('deliverable_events')
    && source.includes('mirror_outbox'),
  'F94 snapshots the row, event, and outbox stores');
  ok(/assertZeroF94Mutation/.test(source)
    && /(?:before|baseline)/i.test(source)
    && /after/i.test(source),
  'every refusal is proven by before/after zero-mutation evidence');
  ok(/assertEligibleAssignmentBundle/.test(source)
    && /eligible_bundle_count/.test(source),
  'the eligible assignment requires native row, event, and outbox to appear together');
  const f94Baseline = {
    row: { assignee_id: null, updated_at: 'stable-fixture' },
    eventCount: 0,
    outboxCount: 0,
  };
  ok(runner.assertZeroF94Mutation(f94Baseline, {
    row: { assignee_id: null, updated_at: 'stable-fixture' },
    eventCount: 0,
    outboxCount: 0,
  }, 'offline') === true,
  'the zero-mutation oracle accepts an unchanged row with zero event/outbox rows');
  for (const changed of [
    { row: { assignee_id: 'changed', updated_at: 'stable-fixture' }, eventCount: 0, outboxCount: 0 },
    { row: { assignee_id: null, updated_at: 'stable-fixture' }, eventCount: 1, outboxCount: 0 },
    { row: { assignee_id: null, updated_at: 'stable-fixture' }, eventCount: 0, outboxCount: 1 },
  ]) {
    let rejected = false;
    try {
      runner.assertZeroF94Mutation(f94Baseline, changed, 'offline');
    } catch (_error) {
      rejected = true;
    }
    ok(rejected, 'the zero-mutation oracle rejects each row/event/outbox delta independently');
  }
  ok(runner.assertEligibleAssignmentBundle(f94Baseline, {
    row: { assignee_id: 'eligible-member', updated_at: 'changed-fixture' },
    eventCount: 1,
    outboxCount: 1,
  }, 'eligible-member') === true,
  'the eligible oracle requires row, event, and outbox to appear as one bundle');
  ok(/stale[_ -]?picker/i.test(source)
    && /deactivat/i.test(source)
    && /reactivat/i.test(source)
    && /failed_closed/.test(source),
  'the stale-picker leg deactivates out of band, fails closed, and reactivates');
  const stalePicker = sourceFunction(source, 'runF94StalePicker');
  ok(/launchBrowser\(runtime, ['"]f94_stale_picker['"]\)/.test(stalePicker)
    && /openBoundedProduction\([\s\S]{0,160}page, port,[\s\S]{0,80}\/\?prod=1&view=list/.test(stalePicker)
    && /data-prod-assign-pop/.test(stalePicker)
    && /heldCandidate\.click\(\)/.test(stalePicker),
  'F94 stale-picker proof opens and commits through the real browser picker');
  const deactivateAt = stalePicker.indexOf('patchSyntheticMember(runtime, member, { active: false }');
  const commitAt = stalePicker.indexOf('heldCandidate.click()');
  ok(deactivateAt >= 0 && commitAt > deactivateAt
    && /matrixBlockSnapshot\(runtime, ['"]f94_stale_picker['"]\)/.test(stalePicker),
  'the browser holds its candidate before out-of-band deactivation and zero-mutation readback');

  // ---- F136: exact imported 13 x 13 policy, not a copied oracle ----------
  ok(policy.DELIVERABLE_STATUSES.length === 13,
    'the authoritative gateway policy exposes exactly 13 statuses');
  ok(source.includes('supabase/functions/production-write/policy.mjs')
    && /(?:await\s+)?import\(/.test(source),
  'the live matrix imports the gateway policy source directly');
  ok(!/(?:const|let|var)\s+CREATIVE_STATUS_TRANSITIONS\s*=/.test(source),
    'the drill does not copy the creative transition table');
  const expectedCreative = new Set();
  for (const current of policy.DELIVERABLE_STATUSES) {
    for (const next of runner.expectedCreativeAcceptedSet(policy, current, 'own')) {
      expectedCreative.add(`${current}->${next}`);
    }
  }
  const flattenedCreative = new Set();
  for (const [current, nextValues] of Object.entries(policy.CREATIVE_STATUS_TRANSITIONS)) {
    for (const next of nextValues) flattenedCreative.add(`${current}->${next}`);
  }
  ok(expectedCreative.size === flattenedCreative.size
    && [...flattenedCreative].every(value => expectedCreative.has(value)),
  'the expected creative acceptance set is derived exactly from CREATIVE_STATUS_TRANSITIONS');
  ok(policy.DELIVERABLE_STATUSES.every(current =>
    runner.expectedCreativeAcceptedSet(policy, current, 'peer').length === 0
      && runner.expectedCreativeAcceptedSet(policy, current, 'unassigned').length === 0),
  'the creative acceptance oracle remains empty for peer and unassigned rows');
  ok(runner.classifyMatrixAttempt(403, { error: 'operation_forbidden' }) === 'forbidden'
    && runner.classifyMatrixAttempt(409, {
      error: 'team_is_linear_authoritative',
    }) === 'authority_fenced'
    && runner.classifyMatrixAttempt(409, { error: 'write_conflict' }) === 'unexpected',
  'the deployed-policy oracle distinguishes denial, accepted authority fence, and unexpected CAS');
  ok(/for\s*\([^)]*(?:role|keyRole)/.test(source)
    && /for\s*\([^)]*current/.test(source)
    && /for\s*\([^)]*next/.test(source)
    && /operation_forbidden/.test(source),
  'the gateway drill drives role x current x next and expects every non-policy case to refuse');
  ok(/403/.test(source) && /zero_mutation_proofs_count/.test(source),
    'forbidden matrix cases require 403 before any mutation');
  const stale0 = runner.matrixSyntheticStamp(0);
  const stale1 = runner.matrixSyntheticStamp(1);
  ok(/const OWNERSHIP_STATES = Object\.freeze\(\[['"]own['"], ['"]peer['"], ['"]unassigned['"]\]\)/.test(source)
    && stale0 !== stale1
    && stale0.startsWith('2000-01-01T')
    && /matrixSyntheticStamp\(matrixBlockOrdinal\)/.test(source),
  'the matrix covers own/peer/unassigned rows with a unique stale browser CAS per block');
  const matrixRunner = sourceFunction(source, 'runF136Matrix');
  const matrixControl = sourceFunction(source, 'browserMatrixStatusControl');
  const browserProjection = sourceFunction(source, 'browserProjection');
  const browserRouter = sourceFunction(source, 'installBrowserRoutes');
  ok(occurrences(matrixRunner, 'openTestProductionPage(runtime, browser') === 2
    && /\/\?prod=1&view=list&issues=all&prodcache=0/.test(matrixRunner)
    && /\/\?prod=1&d=\$\{encodeURIComponent\(runtime\.fixture\.deliverableId\)\}/.test(matrixRunner),
  'F136 opens independent list and exact direct-link browser contexts');
  ok(/driveSurface\(['"]list['"], listCourier, listState, listStatusSelector\)/.test(matrixRunner)
    && /driveSurface\(['"]direct['"], directCourier, directState, directStatusSelector\)/.test(matrixRunner)
    && /attempts === expectedTuples \* 2/.test(matrixRunner)
    && /listAttempts === expectedTuples/.test(matrixRunner)
    && /directAttempts === expectedTuples/.test(matrixRunner)
    && /controlInteractions === attempts/.test(matrixRunner)
    && /controlDispatches === policyAccepted/.test(matrixRunner)
    && /controlBlocks === forbidden/.test(matrixRunner),
  'every F136 tuple exercises both independent real status-control surfaces');
  ok(Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'list_attempts_count')
    && Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'direct_attempts_count')
    && Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'control_interactions_count')
    && Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'control_dispatches_count')
    && Object.prototype.hasOwnProperty.call(sanitized.f136_matrix, 'control_blocks_count')
    && /list_attempts_count:\s*listAttempts/.test(matrixRunner)
    && /direct_attempts_count:\s*directAttempts/.test(matrixRunner),
  'the public aggregate exposes per-context and status-control matrix counts');
  ok(/creativeObservedList === creativeExpected/.test(matrixRunner)
    && /creativeObservedDirect === creativeExpected/.test(matrixRunner)
    && /assertMatrixBlockUnchanged\(before, after\)/.test(matrixRunner),
  'both routes independently match the creative policy set under one exact zero-mutation snapshot');
  const expectedTuples = 3 * policy.DELIVERABLE_STATUSES.length
    * policy.DELIVERABLE_STATUSES.length * 3;
  const expectedAcceptedPerContext =
    2 * policy.DELIVERABLE_STATUSES.length * policy.DELIVERABLE_STATUSES.length * 3
    + flattenedCreative.size;
  const expectedForbiddenPerContext = expectedTuples - expectedAcceptedPerContext;
  const expectedZeroProofs = 3 * 3 * policy.DELIVERABLE_STATUSES.length + 1;
  ok(expectedTuples * 2 === 3042
    && expectedAcceptedPerContext * 2 === 2052
    && expectedForbiddenPerContext * 2 === 990
    && flattenedCreative.size * 2 === 24
    && expectedZeroProofs === 118
    && /policyAccepted === expectedAcceptedPerContext \* 2/.test(matrixRunner)
    && /forbidden === expectedForbiddenPerContext \* 2/.test(matrixRunner)
    && /zeroProofs === expectedZeroProofs/.test(matrixRunner)
    && /cas_fenced_count:\s*2/.test(matrixRunner),
  'the exact dual-context totals are derived as 3042/2052/990/24/118 plus two UI CAS fences');
  ok(/\.prod-row\[data-prod-row=/.test(matrixRunner)
    && /\.prod-detail\[data-prod-detail=/.test(matrixRunner)
    && /#prodLayer \.prod-pop/.test(matrixControl)
    && /\[data-prod-pick\]/.test(matrixControl)
    && /control\.click\(\)/.test(matrixControl)
    && /target\.click\(\)/.test(matrixControl)
    && /matrix_forbidden_status_was_offered/.test(matrixControl)
    && !/\bfetch\(/.test(matrixControl),
  'F136 opens, inspects, blocks, and dispatches through the real list/detail status controls');
  ok(/routeState\.allowMatrix === true/.test(browserProjection)
    && /kind: ['"]video['"]/.test(browserProjection)
    && /matrixSyntheticStamp/.test(browserProjection)
    && /video: ['"]syncview['"]/.test(browserProjection),
  'the F136-only browser lens enables staff controls and supplies unique stale projection clocks');
  const matrixOraclePatchAt = matrixRunner.indexOf(
    'await setFixtureOracleState(runtime, current',
  );
  const matrixClockHandoffAt = matrixRunner.indexOf(
    'listState.matrixSyntheticStamp = syntheticStamp',
  );
  ok(/clearInterval\(_prodOperationalTimer\)/.test(matrixRunner)
    && /clearInterval\(_prodAuthorityTimer\)/.test(matrixRunner)
    && /matrix_background_refresh_did_not_settle/.test(matrixRunner)
    && matrixOraclePatchAt >= 0
    && matrixClockHandoffAt > matrixOraclePatchAt,
  'F136 freezes background ticks and advances its browser clock only after the TEST oracle patch');
  ok(/routeState\.allowMatrix === true/.test(browserRouter)
    && /!input\.test_override/.test(browserRouter)
    && /clean\(input\.id\) === runtime\.fixture\.deliverableId/.test(browserRouter)
    && /clean\(input\.client_slug\) === runtime\.client\.slug/.test(browserRouter)
    && /lower\(input\.status\) === expected\.next/.test(browserRouter)
    && /clean\(input\.expected_updated_at\) === expected\.syntheticStamp/.test(browserRouter)
    && /matrixCasWrites/.test(browserRouter)
    && /matrixRequestIds\.has\(browserRequestId\)/.test(browserRouter)
    && /routeState\.matrixWrites/.test(browserRouter),
  'the Node route admits only the exact expected UI status/CAS request for the active TEST fixture');

  // ---- F37 real roster: read-only enumeration, local verification --------
  const completeRoster = sourceFunction(source, 'readCompleteRoster');
  const establishRoster = sourceFunction(source, 'establishReadOnlyRoster');
  const rosterInvariant = sourceFunction(source, 'assertPreExistingRosterUnchanged');
  const rosterSnapshot = sourceFunction(source, 'readOnlyActiveRosterSnapshot');
  const rosterProjection = sourceFunction(source, 'buildReadOnlyRosterProjection');
  const f37Runner = sourceFunction(source, 'runF37Identity');
  ok(/team_members\?select=\*&order=id\.asc&limit=\$\{pageSize\}/.test(completeRoster)
    && /id=gt\./.test(completeRoster)
    && /page < 100/.test(completeRoster)
    && /runtime\.readOnlyMemberIds\.add\(clean\(row\.id\)\)/.test(establishRoster)
    && /creatives\.length > 0/.test(establishRoster)
    && /withoutRunRows/.test(rosterInvariant)
    && /runtime\.preExistingRoster/.test(rosterSnapshot),
  'F37 freezes the complete paginated roster before writes and derives a nonempty creative cohort');
  const pagedRoster = Array.from({ length: 501 }, (_unused, index) => ({
    id: `member-${String(index + 1).padStart(4, '0')}`,
    name: `offline-${index + 1}`,
    role: index === 0 ? 'editor' : 'admin',
    active: true,
  }));
  let rosterFetches = 0;
  const rosterRuntime = {
    config: { supabaseUrl: 'https://offline.invalid', serviceKey: 'offline' },
    processDeadlineAt: Date.now() + (60 * 60_000),
    cleanupStarted: false,
    activeRequestControllers: new Set(),
    fetch: async urlValue => {
      rosterFetches++;
      const url = new URL(urlValue);
      const cursor = String(url.searchParams.get('id') || '').replace(/^gt\./, '');
      const start = cursor
        ? pagedRoster.findIndex(row => row.id === cursor) + 1
        : 0;
      const body = pagedRoster.slice(start, start + 500);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  const completeOfflineRoster = await runner.readCompleteRoster(rosterRuntime);
  ok(completeOfflineRoster.length === 501
    && completeOfflineRoster[500].id === 'member-0501'
    && rosterFetches === 2,
  'the roster keyset reader proves completeness beyond one 500-row page');
  let changedRosterRejected = false;
  try {
    await runner.assertPreExistingRosterUnchanged({
      preExistingRoster: [{ id: 'member-0001', name: 'Before', role: 'editor', active: true }],
      createdMemberIds: new Set(),
      config: { supabaseUrl: 'https://offline.invalid', serviceKey: 'offline' },
      processDeadlineAt: Date.now() + (60 * 60_000),
      cleanupStarted: true,
      activeRequestControllers: new Set(),
      fetch: async () => new Response(JSON.stringify([
        { id: 'member-0001', name: 'Changed', role: 'editor', active: true },
      ]), { status: 200, headers: { 'content-type': 'application/json' } }),
    }, 'cleanup');
  } catch (_error) {
    changedRosterRejected = true;
  }
  ok(changedRosterRejected,
    'cleanup rejects any changed field on a pre-existing roster row');
  ok(/production_deliverables_browser_v1/.test(rosterProjection)
    && /assignee_id:\s*member\.id/.test(rosterProjection)
    && /!runtime\.createdDeliverableIds\.has\(clean\(row\.id\)\)/.test(rosterProjection)
    && /markerPresent\(row\.title, runtime\)/.test(rosterProjection),
  'real creatives receive only drill-marked browser clones outside every write allowlist');
  const localVerifierAt = browserRouter.indexOf('if (readOnlyMember)');
  const liveVerifierAt = browserRouter.indexOf('guardedBrowserVerifier(');
  ok(localVerifierAt >= 0 && liveVerifierAt > localVerifierAt
    && /route\.fulfill/.test(browserRouter.slice(localVerifierAt, liveVerifierAt))
    && /!runtime\.createdMemberIds\.has\(memberId\)/.test(
      browserRouter.slice(localVerifierAt, liveVerifierAt),
    )
    && /slice5-drill-browser-placeholder/.test(
      browserRouter.slice(localVerifierAt, liveVerifierAt),
    ),
  'pre-existing creatives complete the exact verifier flow locally and never reach live key-verify');
  ok(/clean\(input\.surface\) === ['"]staff-login['"]/.test(browserRouter)
    && /mode:\s*runtime\.authMode/.test(browserRouter)
    && !/drill_read_only/.test(browserRouter),
  'the local verifier mirrors the deployed staff-login surface and auth-mode response contract');
  const localMember = {
    id: 'real-read-only-creative',
    name: 'Offline Creative',
    email: 'offline@example.invalid',
    role: 'editor',
    team: 'video',
    active: true,
  };
  let routeHandler = null;
  let localFetches = 0;
  let fulfilled = null;
  const localRouteRuntime = {
    runToken: 'slice5-offline-route',
    config: { supabaseUrl: 'https://offline.invalid' },
    authMode: 'enforced',
    readOnlyMemberIds: new Set([localMember.id]),
    createdMemberIds: new Set(),
    createdBatchIds: new Set(),
    createdDeliverableIds: new Set(),
    activeRequestControllers: new Set(),
    processDeadlineAt: Date.now() + (60 * 60_000),
    cleanupStarted: false,
    fetch: async () => {
      localFetches++;
      throw new Error('local verifier reached the network');
    },
  };
  const localRouteState = {
    stage: 'f37_identity',
    readOnlyRosterById: new Map([[localMember.id, localMember]]),
    localRosterVerifications: 0,
    liveVerifierWrites: 0,
    routeError: null,
  };
  await runner.installBrowserRoutes(localRouteRuntime, {
    route: async (_pattern, handler) => { routeHandler = handler; },
  }, localRouteState);
  await routeHandler({
    request: () => ({
      url: () => 'https://offline.invalid/functions/v1/key-verify',
      method: () => 'POST',
      postData: () => JSON.stringify({
        surface: 'staff-login',
        member: { id: localMember.id },
      }),
      headers: () => ({ 'x-syncview-key': 'slice5-drill-browser-placeholder' }),
    }),
    fulfill: async value => { fulfilled = value; },
    abort: async () => { throw new Error('local verifier route aborted'); },
    continue: async () => {},
  });
  const localResponse = JSON.parse(fulfilled.body);
  ok(localFetches === 0
    && !localRouteState.routeError
    && localRouteState.localRosterVerifications === 1
    && localRouteState.liveVerifierWrites === 0
    && localResponse.ok === true
    && localResponse.mode === 'enforced'
    && localResponse.role === 'creative'
    && JSON.stringify(localResponse.member) === JSON.stringify({
      id: localMember.id,
      name: localMember.name,
      email: localMember.email,
      role: localMember.role,
      team: localMember.team,
    }),
  'a real creative is fulfilled locally with the exact response and zero network activity');
  ok(/stableJson\(rosterAfter\) === stableJson\(rosterBefore\)/.test(f37Runner)
    && /routeState\.liveVerifierWrites === liveVerifierBeforeRealRoster/.test(f37Runner)
    && /routeState\.localRosterVerifications === rosterBefore\.creatives\.length/.test(f37Runner),
  'F37 proves the real roster stayed immutable and no real identity produced a live verifier write');
  ok(Object.prototype.hasOwnProperty.call(sanitized.f37_identity,
    'active_creative_roster_count')
    && Object.prototype.hasOwnProperty.call(sanitized.f37_identity,
      'read_only_roster_checks_count')
    && /active_creative_roster_count:\s*rosterBefore\.creatives\.length/.test(f37Runner)
    && /read_only_roster_checks_count:\s*readOnlyRosterChecks/.test(f37Runner),
  'the public aggregate exposes only real-roster counts, never roster identities');

  // ---- Every live request is aborted inside a reserved process budget ----
  const liveRequestSource = sourceFunction(source, 'liveRequest');
  const deadlineSource = sourceFunction(source, 'requestDeadlineMs');
  const directLiveAdapters = [
    'restRead',
    'restWrite',
    'edgeWrite',
    'gatewayWrite',
    'guardedBrowserVerifier',
    'linearRead',
    'guardedBrowserCommentRead',
  ];
  ok(occurrences(source, 'runtime.fetch(') === 1
    && /runtime\.fetch\(/.test(liveRequestSource)
    && directLiveAdapters.every(name => /liveRequest\(/.test(sourceFunction(source, name))),
  'every Node live request is centralized in the bounded request adapter');
  ok(/new AbortController\(\)/.test(liveRequestSource)
    && /setTimeout\([\s\S]*controller\.abort\(\)/.test(liveRequestSource)
    && /signal:\s*controller\.signal/.test(liveRequestSource)
    && /await response\.(?:arrayBuffer|text)\(/.test(liveRequestSource)
    && /clearTimeout\(timer\)/.test(liveRequestSource),
  'the Node abort remains armed through response-body consumption');
  ok(/const DRILL_PROCESS_BUDGET_MS = 170 \* 60_000;/.test(source)
    && /const CLEANUP_RESERVE_MS = 30 \* 60_000;/.test(source)
    && /processDeadline - CLEANUP_RESERVE_MS/.test(deadlineSource)
    && /jobStartedAtMs:\s*Number\(clean\(env\.SLICE5_JOB_STARTED_AT_MS\)\)/.test(source)
    && /processDeadlineAt:\s*startedAt \+ DRILL_PROCESS_BUDGET_MS/.test(source)
    && /runBoundedDrillPhase\(/.test(source)
    && /runtime\.cleanupStarted = true;[\s\S]{0,120}closeBrowsers\(runtime\)/.test(source),
  'the main phase cannot consume the separately reserved 30-minute cleanup window');
  ok(/pageEvaluate\(/.test(matrixControl)
    && /poll\(/.test(matrixControl)
    && /BROWSER_REQUEST_TIMEOUT_MS/.test(matrixControl)
    && /isLoopbackStatic/.test(browserRouter)
    && /route\.abort\(['"]blockedbyclient['"]\)/.test(browserRouter),
  'browser matrix controls remain bounded and unknown external requests are blocked');
  const fakeNow = 1_000_000;
  ok(runner.requestDeadlineMs({
    processDeadlineAt: fakeNow + (30 * 60_000) + 5_000,
    cleanupStarted: false,
  }, 20_000, fakeNow, 'f136_matrix') === 5_000,
  'a drill request is shortened at the edge of the cleanup reserve');
  ok(runner.requestDeadlineMs({
    processDeadlineAt: fakeNow + 5_000,
    cleanupStarted: true,
  }, 20_000, fakeNow, 'cleanup') === 5_000,
  'cleanup requests use only the remaining hard process budget');
  let reserveRejected = false;
  try {
    runner.requestDeadlineMs({
      processDeadlineAt: fakeNow + (30 * 60_000),
      cleanupStarted: false,
    }, 20_000, fakeNow, 'f136_matrix');
  } catch (_error) {
    reserveRejected = true;
  }
  ok(reserveRejected, 'the next drill request is refused once cleanup reserve begins');
  let latePhaseRejected = false;
  try {
    runner.requestDeadlineMs({
      processDeadlineAt: fakeNow + 60_000,
      cleanupStarted: true,
    }, 20_000, fakeNow, 'f95_convergence');
  } catch (_error) {
    latePhaseRejected = true;
  }
  ok(latePhaseRejected,
    'a late browser/route request is refused after cleanup has begun');
  let abortObserved = false;
  const abortStarted = Date.now();
  try {
    await runner.liveRequest({
      processDeadlineAt: Date.now() + (31 * 60_000),
      cleanupStarted: false,
      activeRequestControllers: new Set(),
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          abortObserved = true;
          reject(new Error('offline bounded abort'));
        }, { once: true });
      }),
    }, 'https://offline.invalid/read', {}, {
      stage: 'preflight',
      kind: 'offline_test',
      timeoutMs: 15,
    });
  } catch (_error) {}
  ok(abortObserved && Date.now() - abortStarted < 1_000,
    'the centralized adapter actively aborts a hung fetch within its bound');
  const boundedStarted = Date.now();
  let operationBounded = false;
  try {
    await runner.boundedOperation({
      processDeadlineAt: Date.now() + (31 * 60_000),
      cleanupStarted: false,
    }, 'f95_convergence', 'offline hung browser operation',
    () => new Promise(() => {}), 15);
  } catch (_error) {
    operationBounded = true;
  }
  ok(operationBounded && Date.now() - boundedStarted < 1_000,
    'a hung browser operation yields control before the cleanup reserve');
  let lateRegistered = false;
  let lateDisposed = false;
  let acquisitionTimedOut = false;
  try {
    await runner.acquireBoundedResource({
      processDeadlineAt: Date.now() + (31 * 60_000),
      cleanupStarted: false,
    }, 'f95_convergence', 'offline late resource',
    () => new Promise(resolve => setTimeout(() => resolve({ handle: true }), 35)),
    () => { lateRegistered = true; },
    () => { lateDisposed = true; },
    15);
  } catch (_error) {
    acquisitionTimedOut = true;
  }
  await new Promise(resolve => setTimeout(resolve, 60));
  ok(acquisitionTimedOut && lateDisposed && !lateRegistered,
    'a resource resolving after acquisition timeout is disposed instead of registered late');
  const launchSource = sourceFunction(source, 'launchBrowser');
  const contextCloseSource = sourceFunction(source, 'closeContext');
  const staticStartSource = sourceFunction(source, 'startStaticServer');
  const staticCloseSource = sourceFunction(source, 'closeStaticServer');
  const centralCloseSource = sourceFunction(source, 'closeBrowsers');
  ok(/launchServer\(/.test(launchSource)
    && /browserServers\.add/.test(launchSource)
    && /forceKillBrowserServer/.test(launchSource)
    && /created\.unref\(\)/.test(staticStartSource)
    && /neutralizeStaticServer/.test(staticCloseSource)
    && !/finally[\s\S]*contexts\.delete/.test(contextCloseSource)
    && /Chromium server force kill/.test(centralCloseSource)
    && /late browser operation drain/.test(centralCloseSource),
  'teardown retains failed contexts and force-neutralizes server/process handles');

  // ---- F37/F95: real browser machinery and bounded recovery --------------
  ok(/require\(['"]playwright['"]\)/.test(source)
    && /\bchromium\b/.test(source),
  'F37/F95 use the established Playwright runtime');
  ok(source.includes('docs/syncview-design/tests/prod-test-utils')
    || source.includes('qa/'),
  'the browser drills reuse the existing Production/QA e2e machinery');
  const f95Runner = sourceFunction(source, 'runF95Convergence');
  ok(occurrences(f95Runner, 'openTestProductionPage(runtime, browser') === 2
    && /const \{ context: contextA, page: pageA \}/.test(f95Runner)
    && /const \{ context: contextB, page: pageB \}/.test(f95Runner),
  'F95 creates two independent headless browser contexts');
  ok(source.includes('?prod=1'), 'both browser contexts enter through the Production route');
  const rowConvergence = sourceFunction(source, 'assertContextsConverge');
  const commentConvergence = sourceFunction(source, 'assertContextsObserveComment');
  ok(/const MATRIX_TICK_MS = 30_000;/.test(source)
    && !/MATRIX_TICK_MARGIN/.test(source)
    && [rowConvergence, commentConvergence].every(body =>
      /Date\.now\(\) - started <= MATRIX_TICK_MS/.test(body)
        && /elapsed <= MATRIX_TICK_MS/.test(body)),
  'row and comment convergence are both hard-capped at one 30-second tick');
  ok(source.includes('[data-prod-freshness="degraded"]')
    && source.includes('[data-prod-refresh="1"]'),
  'the forced failure asserts degraded state and recovers through Retry');
  ok(/signed[_ -]?out/i.test(source)
    && /deactivat/i.test(source)
    && /zero[_ -]?row/i.test(source)
    && /duplicate[_ -]?name/i.test(source)
    && /reorder/i.test(source)
    && /account[_ -]?switch/i.test(source),
  'F37 covers signed-out, deactivated, zero-row, duplicate-name, reorder, and account-switch shapes');
  ok(/scroll_preserved/.test(source)
    && /composer_preserved/.test(source)
    && /draft_preserved/.test(source),
  'F95 proves preserved scroll, composer, and draft state');

  // ---- Read-path rebaseline: private delta only, never burst -------------
  const readRebaseline = sourceFunction(source, 'runReadRebaseline');
  ok(/qa\/probes\/prod_read_path_timing\.js/.test(readRebaseline)
    && /spawnSync\(process\.execPath,\s*\[probe,\s*['"]delta['"]\]/.test(readRebaseline),
  'the sixth drill invokes the established read-only probe in delta mode');
  ok(!/['"](?:burst|all)['"]/.test(readRebaseline),
    'the rebaseline cannot invoke the load-generating burst or all modes');
  ok(/FAILED\|ABORTED/.test(readRebaseline)
    && /result\.status\s*===\s*0/.test(readRebaseline),
  'textual FAILED/ABORTED markers fail the drill even when the probe exits zero');
  ok(/wall_med/.test(readRebaseline)
    && /value\s*<=\s*MATRIX_TICK_MS/.test(readRebaseline),
  'the private delta evidence must contain bounded wall medians');
  ok(!/\.\.\.process\.env/.test(readRebaseline)
    && !/SUPABASE_SERVICE_ROLE_KEY|LINEAR_API_KEY|ROLE_KEY_(?:ADMIN|SMM|CREATIVE)/.test(readRebaseline),
  'the read-only child receives no service, provider, or role credential');
  ok(/return\s*\{\s*result:\s*['"]pass['"],\s*mode_count:\s*1,\s*passed:\s*true\s*\}/.test(readRebaseline)
    && /read_rebaseline:\s*\{\s*result:\s*['"]not_run['"],\s*mode_count:\s*0,\s*passed:\s*false\s*\}/.test(source),
  'read-path output is reduced to one enum, one count, and one boolean');

  // ---- Cleanup + invariant proof -----------------------------------------
  ok(/\bfinally\s*\{/.test(source)
    && /cleanup_ok/.test(source)
    && /created_member_count/.test(source)
    && /deleted_member_count/.test(source),
  'cleanup is finally-owned and publicly reports exact aggregate completion');
  ok(source.includes('syncview_runtime_flags')
    && /flagsBefore/.test(source)
    && /flagsAfter/.test(source)
    && /stableJson\(flagsBefore\)\s*===\s*stableJson\(flagsAfter\)/.test(source)
    && /flags_unchanged/.test(source),
  'runtime flags are independently read before/after and must remain byte-stable');
  ok(!/syncview_runtime_flags[\s\S]{0,300}(?:method:\s*['"](?:POST|PATCH|PUT|DELETE)['"])/i.test(source),
    'the runner contains no runtime-flag write path');
  const cleanupRunner = sourceFunction(source, 'cleanup');
  const memberCleanup = sourceFunction(source, 'cleanupSyntheticMembers');
  ok(/deliverable_events/.test(cleanupRunner)
    && /mirror_outbox/.test(cleanupRunner)
    && /cleanupSyntheticMembers\(runtime, deliverableIds\)/.test(cleanupRunner)
    && /for \(const id of memberIds\)/.test(memberCleanup)
    && /catch \(error\)[\s\S]{0,80}capture\(error\)/.test(memberCleanup)
    && /survivors\.length === 0/.test(memberCleanup),
  'cleanup independently attempts row/event/outbox recovery and every disposable member');
  ok(/assertPreExistingRosterUnchanged\(runtime, ['"]cleanup['"]\)/.test(cleanupRunner)
    && /errors\.length === 0/.test(cleanupRunner)
    && /cleanupResult\.ok/.test(source),
  'cleanup_ok requires complete recovery plus a byte-stable pre-existing roster');

  if (failures) {
    console.error(`\nslice5-test-drills: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nslice5-test-drills: owner-gated safety and evidence contract passed');
})().catch(error => {
  // This is an offline source-contract failure; no live/private payload exists.
  console.error(error);
  process.exit(1);
});
