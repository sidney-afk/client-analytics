'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(ROOT, 'supabase/functions/production-write/policy.mjs');
const STAFF_AUTH_PATH = path.join(ROOT, 'supabase/functions/_shared/staff-role-auth.ts');
const EDGE_PATH = path.join(ROOT, 'supabase/functions/production-write/index.ts');
const edge = fs.readFileSync(EDGE_PATH, 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function matrixEqual(actual, expected, message) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${message} (got ${JSON.stringify(actual)})`);
}

(async () => {
  const policy = await import(pathToFileURL(POLICY_PATH).href + '?auth-matrix');
  const operations = ['status', 'comment', 'due', 'assignee', 'labels', 'description', 'intake_create'];

  for (const role of ['admin', 'smm']) {
    const allowed = Object.fromEntries(operations.map(operation => [
      operation,
      policy.staffOperationAllowed(role, operation, 'video', 'graphics', 'approved'),
    ]));
    matrixEqual(allowed, {
      status: true,
      comment: true,
      due: true,
      assignee: true,
      labels: true,
      description: true,
      intake_create: true,
    }, `${role} may perform all seven gateway operations`);
  }

  const creativeOwnTeam = Object.fromEntries(operations.map(operation => [
    operation,
    policy.staffOperationAllowed('creative', operation, 'VID', 'video', 'in_progress'),
  ]));
  matrixEqual(creativeOwnTeam, {
    status: true,
    comment: true,
    due: false,
    assignee: false,
    labels: false,
    description: false,
    intake_create: false,
  }, 'creative may change an own-team legal status or comment, but not due, assignee, labels, description, or intake');

  const creativeStatuses = Object.fromEntries(policy.DELIVERABLE_STATUSES.map(status => [
    status,
    policy.staffOperationAllowed('creative', 'status', 'graphics', 'GRA', status),
  ]));
  matrixEqual(creativeStatuses, {
    triage: true,
    backlog: true,
    todo: true,
    in_progress: true,
    smm_approval: true,
    kasper_approval: false,
    client_approval: false,
    tweak: true,
    approved: false,
    scheduled: false,
    posted: false,
    canceled: true,
    duplicate: true,
  }, 'creative status allowlist is exhaustive and cannot advance approval or publishing stages');
  ok(!policy.staffOperationAllowed('creative', 'status', 'video', 'graphics', 'in_progress')
    && !policy.staffOperationAllowed('creative', 'comment', 'video', 'graphics'),
  'creative is denied status and comment writes across teams');

  const clientAtApproval = Object.fromEntries(operations.map(operation => [
    operation,
    policy.clientOperationAllowed(operation, 'client_approval',
      operation === 'status' ? 'approved' : ''),
  ]));
  matrixEqual(clientAtApproval, {
    status: true,
    comment: true,
    due: false,
    assignee: false,
    labels: false,
    description: false,
    intake_create: false,
  }, 'client token may approve or comment but cannot set due, assignee, labels, description, or create intake');
  ok(policy.clientOperationAllowed('status', 'client_approval', 'tweak')
    && policy.clientOperationAllowed('status', 'tweak', 'approved')
    && policy.clientOperationAllowed('status', 'tweak', 'tweak'),
  'client token may select either legal client decision from client-approval or tweak');
  for (const current of policy.DELIVERABLE_STATUSES.filter(status => !['client_approval', 'tweak'].includes(status))) {
    ok(!policy.clientOperationAllowed('status', current, 'approved')
      && !policy.clientOperationAllowed('status', current, 'tweak'),
    `client status is denied from non-client stage ${current}`);
  }
  ok(!policy.clientOperationAllowed('status', 'client_approval', 'posted')
    && policy.clientOperationAllowed('comment', 'posted', ''),
  'client status values stay closed while own-thread comment permission is status-independent');
  ok(policy.clientScopeAllowed('client-a', 'client-a')
    && !policy.clientScopeAllowed('client-a', 'client-b')
    && !policy.clientScopeAllowed('', 'client-a'),
  'client token scope requires the exact non-empty target client slug');

  matrixEqual([
    policy.credentialMode('', ''),
    policy.credentialMode('staff', ''),
    policy.credentialMode('', 'client'),
    policy.credentialMode('staff', 'client'),
  ], ['none', 'staff', 'client', 'ambiguous'],
  'credential source selection rejects mixed staff and client credentials');
  ok(policy.serviceTestOverrideAllowed('', '', 'B4_TEST_ONLY', true)
    && !policy.serviceTestOverrideAllowed('staff', '', 'B4_TEST_ONLY', true)
    && !policy.serviceTestOverrideAllowed('', 'client', 'B4_TEST_ONLY', true)
    && !policy.serviceTestOverrideAllowed('', '', 'wrong', true)
    && !policy.serviceTestOverrideAllowed('', '', 'B4_TEST_ONLY', false),
  'service TEST override requires no browser credential, exact confirmation, and service authentication');
  ok(policy.isCanonicalActiveTestClient(true, 'test')
    && policy.isCanonicalActiveTestClient(true, 'TEST')
    && !policy.isCanonicalActiveTestClient(false, 'test')
    && !policy.isCanonicalActiveTestClient(true, 'client'),
  'TEST scope is derived only from the canonical active TEST client row');

  const staffHelperUrl = pathToFileURL(STAFF_AUTH_PATH).href + '?production-write-auth-matrix';
  const runner = `
    const { matchingRoleForKey } = await import(${JSON.stringify(staffHelperUrl)});
    const secrets = {
      ROLE_KEY_ADMIN: 'dummy-admin',
      ROLE_KEY_SMM: 'dummy-smm',
      ROLE_KEY_CREATIVE: 'dummy-creative',
    };
    const getSecret = name => secrets[name];
    console.log(JSON.stringify({
      admin: matchingRoleForKey('dummy-admin', getSecret),
      smm: matchingRoleForKey('dummy-smm', getSecret),
      creative: matchingRoleForKey('dummy-creative', getSecret),
      garbage: matchingRoleForKey('dummy-garbage', getSecret),
      empty: matchingRoleForKey('', getSecret),
    }));
  `;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', runner], {
    encoding: 'utf8',
  });
  ok(child.status === 0, `actual staff secret helper executes offline (${(child.stderr || '').trim()})`);
  if (child.status === 0) {
    matrixEqual(JSON.parse(child.stdout.trim()), {
      admin: 'admin', smm: 'smm', creative: 'creative', garbage: null, empty: null,
    }, 'garbage and empty staff keys are rejected by the production secret resolver');
  }

  ok(/const credentials = credentialMode\(key, token\)/.test(edge)
    && /credentials === "ambiguous"[\s\S]{0,80}GatewayError\(401, "ambiguous_credentials"\)/.test(edge)
    && /GatewayError\(401, "invalid_staff_key"\)/.test(edge)
    && /GatewayError\(401, "invalid_client_token"\)/.test(edge)
    && /GatewayError\(401, "credentials_required"\)/.test(edge),
  'gateway executes the tested credential-source decision and returns 401 for mixed, garbage, or missing credentials');
  ok(/clientScopeAllowed\(matchedSlug, targetClientSlug\)/.test(edge)
    && /GatewayError\(403, "client_scope_mismatch"\)/.test(edge)
    && /GatewayError\(403, "operation_forbidden"\)/.test(edge),
  'gateway executes the tested exact client scope and returns 403 for cross-client or forbidden operations');
  ok(/browserCredentialTestOverride\(body\.test_override, key, token\)/.test(edge)
    && /serviceTestOverrideAllowed\(key, token, body\.confirm, await serviceRoleRequest\(req\)\)/.test(edge)
    && /isCanonicalActiveTestClient\(client\.active, client\.kind\)/.test(edge)
    && /GatewayError\(401, "invalid_test_override"\)/.test(edge)
    && /GatewayError\(403, "test_client_scope_required"\)/.test(edge)
    && !/deriveBrowserTestScope/.test(edge)
    && !/testOnly: canonicalTest/.test(edge),
  'gateway executes service-only TEST rules while browser credentials remain unable to enter TEST scope');
  ok(/GatewayError\(403, "roster_actor_required"\)/.test(edge)
    && /GatewayError\(403, "roster_actor_not_unique"\)/.test(edge),
  'valid staff secrets still require one exact compatible active roster actor (403 otherwise)');
  ok(!/req\.headers\.get\(["']x-syncview-role["']\)/i.test(edge),
    'caller role headers cannot elevate the gateway principal');

  const entityHandlerStart = edge.indexOf('async function handleEntityOperation(');
  const entityHandlerEnd = edge.indexOf('\nasync function ensureBatch(', entityHandlerStart);
  const entityHandler = edge.slice(entityHandlerStart, entityHandlerEnd);
  const reconcileStart = edge.indexOf('async function reconcileEntityOperation(');
  const reconcileEnd = edge.indexOf('\nfunction configuredTestProjectIds(', reconcileStart);
  const reconcile = edge.slice(reconcileStart, reconcileEnd);
  const authPosition = entityHandler.indexOf('const principal = await authenticate(');
  const staffPermissionPosition = entityHandler.indexOf('staffOperationAllowed(');
  const reconcilePosition = entityHandler.indexOf('body.reconcile_only === true');
  ok(authPosition >= 0
    && staffPermissionPosition > authPosition
    && reconcilePosition > staffPermissionPosition
    && /principal\.kind === "client"[\s\S]{0,120}clientOperationAllowed\("status", "client_approval", nextStatus\)/.test(reconcile)
    && /operation === "description"[\s\S]{0,180}principal\.kind === "client"[\s\S]{0,100}operation_forbidden/.test(reconcile),
  'reconcile-only receipts remain behind credential, client-scope, roster, and operation-permission checks');

  if (failures) {
    console.error(`\n${failures} production-write auth matrix check(s) failed`);
    process.exit(1);
  }
  console.log('\nProduction-write executable auth matrix checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
