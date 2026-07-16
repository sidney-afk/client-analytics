'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SPA_PATH = path.join(ROOT, 'index.html');
const POLICY_PATH = path.join(ROOT, 'supabase/functions/production-write/policy.mjs');
const EDGE_PATH = path.join(ROOT, 'supabase/functions/production-write/index.ts');
const DRILL_PATH = path.join(ROOT, 'scripts/production-write-drill.js');
const spa = fs.readFileSync(SPA_PATH, 'utf8');
const edge = fs.readFileSync(EDGE_PATH, 'utf8');
const drill = fs.readFileSync(DRILL_PATH, 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extractFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw new Error(`missing ${name}`);
  const start = match.index;
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const SERVICE_ONLY_TEST_CONTRACT = Object.freeze({
  testOverride: true,
  confirm: 'B4_TEST_ONLY',
  staffKey: '',
  clientToken: '',
  serviceAuthenticated: true,
});

(async () => {
  const policy = await import(pathToFileURL(POLICY_PATH).href + '?test-contract');

  function policyAllows(request) {
    return request.testOverride === true
      && !policy.browserCredentialTestOverride(
        request.testOverride,
        request.staffKey,
        request.clientToken,
      )
      && policy.serviceTestOverrideAllowed(
        request.staffKey,
        request.clientToken,
        request.confirm,
        request.serviceAuthenticated,
      );
  }

  ok(policyAllows(SERVICE_ONLY_TEST_CONTRACT),
    'the one canonical TEST contract is accepted: service role, exact confirmation, and no browser credential');

  const independentlyLoosenedCases = [
    ['missing service authentication', { serviceAuthenticated: false }],
    ['missing confirmation', { confirm: '' }],
    ['different confirmation', { confirm: 'b4_test_only' }],
    ['staff browser credential', { staffKey: 'staff-role-key' }],
    ['client browser credential', { clientToken: 'client-review-token' }],
    ['mixed browser credentials', { staffKey: 'staff-role-key', clientToken: 'client-review-token' }],
  ];
  for (const [label, change] of independentlyLoosenedCases) {
    const request = { ...SERVICE_ONLY_TEST_CONTRACT, ...change };
    ok(!policyAllows(request), `the shared contract rejects ${label}`);
  }

  ok(policy.browserCredentialTestOverride(true, 'staff-role-key', '')
    && policy.browserCredentialTestOverride(true, '', 'client-review-token')
    && policy.browserCredentialTestOverride(true, 'staff-role-key', 'client-review-token')
    && !policy.browserCredentialTestOverride(true, '', ''),
  'browserCredentialTestOverride independently rejects either or both browser credentials');
  ok(!policy.serviceTestOverrideAllowed('staff-role-key', '', SERVICE_ONLY_TEST_CONTRACT.confirm, true)
    && !policy.serviceTestOverrideAllowed('', 'client-review-token', SERVICE_ONLY_TEST_CONTRACT.confirm, true)
    && !policy.serviceTestOverrideAllowed('staff-role-key', 'client-review-token', SERVICE_ONLY_TEST_CONTRACT.confirm, true)
    && !policy.serviceTestOverrideAllowed('', '', '', true)
    && !policy.serviceTestOverrideAllowed('', '', SERVICE_ONLY_TEST_CONTRACT.confirm, false),
  'serviceTestOverrideAllowed independently requires zero browser credentials, exact confirmation, and service authentication');

  const drillGateway = extractFunction(drill, 'gateway');
  ok(/SUPA_KEY\s*=\s*String\(process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(drill)
    && /Authorization:\s*`Bearer \$\{SUPA_KEY\}`/.test(drillGateway)
    && /test_override:\s*true/.test(drillGateway)
    && /confirm:\s*['"]B4_TEST_ONLY['"]/.test(drillGateway)
    && !/X-Syncview-(?:Key|Client-Token)/i.test(drillGateway)
    && policyAllows(SERVICE_ONLY_TEST_CONTRACT),
  'the real TEST drill producer and gateway policy share the one service-role/no-browser/exact-confirm contract');

  let captured = null;
  const context = {
    CAL_SUPABASE_URL: 'https://example.supabase.co',
    CAL_SUPABASE_ANON_KEY: 'browser-anon-key',
    PROD_WRITE_EF_URL: 'https://example.supabase.co/functions/v1/production-write',
    _isClientLink: false,
    _prodState: { writes: new Map() },
    _prodCanWrite: () => true,
    _prodRender: () => {},
    _prodWriteRequestId: () => 'prod:test-contract:0001',
    _prodApplyGatewayRow: () => {},
    _prodRefreshAuthority: () => {},
    _syncviewStaffIdentityForHeaders: () => ({
      key: 'browser-staff-key',
      role: 'smm',
      member: { name: 'Contract Tester' },
    }),
    _syncviewClientWriteToken: () => '',
    _prodClient: () => ({ raw: { active: true, kind: 'test' } }),
    document: { getElementById: () => null },
    fetch: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, native_committed: true }),
      };
    },
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction(spa, '_syncviewEfHeaders'),
    extractFunction(spa, '_prodTestWriteOverride'),
    extractFunction(spa, '_prodGatewayWrite'),
  ].join('\n'), context);

  await context._prodGatewayWrite({
    id: 'deliverable-test-contract',
    project: 'test-client',
    updatedRaw: '2026-07-15T00:00:00.000Z',
    sourceStatus: 'in_progress',
  }, 'status', { status: 'smm_approval' }, 'prod:test-contract:0001');

  const browserBody = JSON.parse(captured.options.body);
  const browserHeaders = captured.options.headers;
  const browserRequest = {
    testOverride: browserBody.test_override,
    confirm: browserBody.confirm,
    staffKey: browserHeaders['X-Syncview-Key'] || '',
    clientToken: browserHeaders['X-Syncview-Client-Token'] || '',
    serviceAuthenticated: false,
  };
  ok(browserBody.test_override === SERVICE_ONLY_TEST_CONTRACT.testOverride,
    'the SPA marks an active TEST target, so the gateway must apply the TEST contract');
  ok(!Object.prototype.hasOwnProperty.call(browserBody, 'confirm')
    && browserHeaders.Authorization === 'Bearer browser-anon-key'
    && browserHeaders['X-Syncview-Key'] === 'browser-staff-key',
  'the SPA request remains browser-credentialed and cannot impersonate the service TEST drill');
  ok(policy.browserCredentialTestOverride(
    browserRequest.testOverride,
    browserRequest.staffKey,
    browserRequest.clientToken,
  ) && !policy.serviceTestOverrideAllowed(
    browserRequest.staffKey,
    browserRequest.clientToken,
    browserRequest.confirm,
    browserRequest.serviceAuthenticated,
  ) && !policyAllows(browserRequest),
  'the actual SPA request shape is rejected by both independent service-only policy boundaries');

  context._prodClient = () => ({ raw: { active: false, kind: 'test' } });
  await context._prodGatewayWrite({
    id: 'deliverable-inactive-test', project: 'inactive-test', updatedRaw: '2026-07-15T00:00:00.000Z', sourceStatus: 'in_progress',
  }, 'status', { status: 'smm_approval' }, 'prod:test-contract:0002');
  const inactiveBody = JSON.parse(captured.options.body);
  context._prodClient = () => ({ raw: { active: true, kind: 'client' } });
  await context._prodGatewayWrite({
    id: 'deliverable-normal-client', project: 'normal-client', updatedRaw: '2026-07-15T00:00:00.000Z', sourceStatus: 'in_progress',
  }, 'status', { status: 'smm_approval' }, 'prod:test-contract:0003');
  const normalBody = JSON.parse(captured.options.body);
  ok(!Object.prototype.hasOwnProperty.call(inactiveBody, 'test_override')
    && !Object.prototype.hasOwnProperty.call(normalBody, 'test_override'),
  'the SPA marks only a canonical active TEST target for the fail-closed browser boundary');

  const browserGuard = edge.indexOf('browserCredentialTestOverride(body.test_override, key, token)');
  const serviceGuard = edge.indexOf('serviceTestOverrideAllowed(key, token, body.confirm, await serviceRoleRequest(req))');
  const staffPrincipal = edge.indexOf('if (credentials === "staff") {');
  const clientPrincipal = edge.indexOf('if (credentials === "client") {');
  ok(browserGuard > 0
    && serviceGuard > browserGuard
    && staffPrincipal > serviceGuard
    && clientPrincipal > staffPrincipal
    && /browserCredentialTestOverride\(body\.test_override, key, token\)[\s\S]{0,120}invalid_test_override/.test(edge)
    && /serviceTestOverrideAllowed\(key, token, body\.confirm, await serviceRoleRequest\(req\)\)[\s\S]{0,120}invalid_test_override/.test(edge),
  'the deployed gateway consumes both policy halves before any browser principal can be authenticated');

  if (failures) {
    console.error(`\n${failures} production-write TEST contract check(s) failed`);
    process.exit(1);
  }
  console.log('\nProduction-write cross-boundary TEST contract checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
