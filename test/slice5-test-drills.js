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

  const trustedCheckout = stepBlock(workflow, 'Check out trusted main for the provenance gate');
  const provenance = stepBlock(workflow, 'Verify requested commit is an exact ancestor of origin/main');
  const pinnedCheckout = stepBlock(workflow, 'Check out the verified commit');
  const exactHead = stepBlock(workflow, 'Reverify exact checked-out commit');
  const trustedAt = workflow.indexOf('      - name: Check out trusted main for the provenance gate');
  const provenanceAt = workflow.indexOf('      - name: Verify requested commit is an exact ancestor of origin/main');
  const pinnedAt = workflow.indexOf('      - name: Check out the verified commit');
  ok(trustedAt >= 0 && provenanceAt > trustedAt && pinnedAt > provenanceAt,
    'trusted main checkout and ancestry proof precede dispatched-SHA checkout');
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
    'stableJson',
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
    const sendAt = body.indexOf('runtime.fetch(');
    ok(body && guardAt >= 0 && sendAt >= 0 && guardAt < sendAt,
      `${name} revalidates active TEST scope immediately before its send`);
  }
  ok(/WRITE_(?:ADAPTERS|KINDS)/.test(source),
    'the finite mutation-adapter inventory is source-visible for review');

  // Disposable members must be both drill-marked and created by this run.
  const memberGuard = sourceFunction(source, 'assertSyntheticMemberMutationAllowed');
  ok(/runtime\.createdMemberIds\.has\(id\)/.test(memberGuard)
    && /markerPresent\(row\.(?:name|email), runtime\)/.test(memberGuard)
    && /\bassert\(/.test(memberGuard),
  'member writes require the drill marker and the run-created member-id allowlist');
  ok(/(?:DRILL_MEMBER_MARKER|DRILL_MARKER)/.test(source)
    && /new Set\(\)/.test(source),
  'the runner carries an explicit drill marker and disposable-member allowlist');
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
  ok(/launchBrowser\(runtime\)/.test(stalePicker)
    && /openProduction\(page, port, ['"]\/\?prod=1&view=list/.test(stalePicker)
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
  ok(/const OWNERSHIP_STATES = Object\.freeze\(\[['"]own['"], ['"]peer['"], ['"]unassigned['"]\]\)/.test(source)
    && /expected_updated_at:\s*['"]1970-01-01T00:00:00\.000Z['"]/.test(source),
  'the matrix covers own/peer/unassigned rows and sends a deliberately stale CAS');
  const matrixRunner = sourceFunction(source, 'runF136Matrix');
  const matrixCourier = sourceFunction(source, 'browserMatrixStatusAttempt');
  const browserRouter = sourceFunction(source, 'installBrowserRoutes');
  ok(occurrences(matrixRunner, 'openTestProductionPage(runtime, browser') === 2
    && /\/\?prod=1&view=list&issues=all&prodcache=0/.test(matrixRunner)
    && /\/\?prod=1&d=\$\{encodeURIComponent\(runtime\.fixture\.deliverableId\)\}/.test(matrixRunner),
  'F136 opens independent list and exact direct-link browser contexts');
  ok(/browserMatrixStatusAttempt\(runtime, courier/.test(matrixRunner)
    && /attempts % 2 === 0 \? listCourier\.page : directCourier\.page/.test(matrixRunner)
    && /listState\.matrixWrites \+ directState\.matrixWrites === attempts/.test(matrixRunner)
    && /listState\.matrixWrites > 0[\s\S]{0,100}directState\.matrixWrites > 0/.test(matrixRunner),
  'every F136 matrix attempt alternates through and is counted by the two browser couriers');
  ok(/page\.evaluate/.test(matrixCourier)
    && /functions\/v1\/production-write/.test(matrixCourier)
    && /CAL_SUPABASE_ANON_KEY/.test(matrixCourier)
    && !/serviceKey|ROLE_KEY_|roleKeys/.test(matrixCourier),
  'the page-side matrix courier receives no service or role credential');
  ok(/routeState\.allowMatrix === true/.test(browserRouter)
    && /!input\.test_override/.test(browserRouter)
    && /clean\(input\.id\) === runtime\.fixture\.deliverableId/.test(browserRouter)
    && /routeState\.matrixWrites/.test(browserRouter),
  'the Node route admits only non-override status attempts for the run-owned TEST fixture');

  // ---- F37/F95: real browser machinery and bounded recovery --------------
  ok(/require\(['"]playwright['"]\)/.test(source)
    && /\bchromium\b/.test(source),
  'F37/F95 use the established Playwright runtime');
  ok(source.includes('docs/syncview-design/tests/prod-test-utils')
    || source.includes('qa/'),
  'the browser drills reuse the existing Production/QA e2e machinery');
  ok(occurrences(source, '.newContext(') >= 2
    || /for\s*\([^)]*<\s*2[^)]*\)[\s\S]{0,500}\.newContext\(/.test(source),
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
  ok(/cleanup[\s\S]{0,1200}(?:deliverable_events|mirror_outbox)[\s\S]{0,1200}(?:team_members|member)/i.test(source),
    'cleanup covers generated row/event/outbox residue and disposable members');

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
