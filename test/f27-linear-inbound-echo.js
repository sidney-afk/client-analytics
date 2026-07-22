'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const INBOUND = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/linear-inbound/index.ts'),
  'utf8',
);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('PASS:', message);
  else {
    failures++;
    console.error('FAIL f27-linear-inbound-echo:', message);
  }
}

function realOutboundValueMatcher() {
  const source = INBOUND.match(/function outboundValueMatches\([^]*?\n\}/);
  if (!source) throw new Error('missing outboundValueMatches');
  const context = {
    clean: value => String(value == null ? '' : value).trim(),
    lower: value => String(value == null ? '' : value).trim().toLowerCase(),
    objectAt: value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
    payloadAction: payload => String(payload && payload.action || '').toLowerCase(),
    outboundExpected: row => row.linear_result.expected.input,
    outboundMarker: () => '',
  };
  vm.createContext(context);
  vm.runInContext(source[0].replace(
    /function outboundValueMatches\([^\n]+\): boolean \{/,
    'function outboundValueMatches(row, payload, issue, comment) {',
  ), context);
  return context.outboundValueMatches;
}

(async () => {
  const helperPath = path.join(
    ROOT,
    'supabase',
    'functions',
    'linear-inbound',
    'f27-echo.mjs',
  );
  const { f27PreflightIdentity, outboundEchoIdentityProof } = await import(pathToFileURL(helperPath).href);
  const valueMatches = realOutboundValueMatcher();

  // Regression fixture for #894's post-merge P1: the rollback writer has
  // persisted its exact binder before the Linear request, but the webhook does
  // not expose a usable actor and the outbox row is intentionally still skipped.
  const row = {
    id: 71,
    team: 'graphics',
    status: 'skipped',
    processed_at: null,
    operation: 'status',
    dedup_key: 'f27:test:actorless-echo',
  };
  const result = {
    f27_preflight: true,
    rollback_id: '00000000-0000-4000-8000-000000000027',
    correlation_id: '00000000-0000-4000-8000-000000000028',
    outbox_id: String(row.id),
    dedup_key: row.dedup_key,
    operation: row.operation,
    issue_id: '00000000-0000-4000-8000-000000000029',
    mirror_actor_id: 'api-viewer',
    expected: { input: { stateId: 'state-approved' } },
  };
  row.linear_result = result;
  const payload = {
    type: 'Issue',
    action: 'update',
    data: { id: result.issue_id, state: { id: 'state-approved' } },
  };
  const webhookActorId = '';
  const openRollback = {
    id: result.rollback_id,
    correlation_id: result.correlation_id,
    team: row.team,
    state: 'open',
  };

  const exactIssue = result.issue_id === payload.data.id;
  const exactValue = valueMatches(row, payload, payload.data, {});
  const actorMatches = !!webhookActorId && result.mirror_actor_id === webhookActorId;
  const terminalValueProof = row.status === 'written' && !!row.processed_at;
  const oldGateAccepts = exactIssue && exactValue && (actorMatches || terminalValueProof);
  const fixedProof = outboundEchoIdentityProof(row, result, webhookActorId, [openRollback]);

  ok(exactIssue && exactValue, 'fixture carries the exact issue and intended value through the real matcher');
  ok(!actorMatches && !terminalValueProof && !oldGateAccepts,
    'fixture reproduces the actorless skipped-state false foreign-write classification');
  ok(fixedProof.accepted && fixedProof.openF27PreflightProof,
    'exact preflight is accepted while its rollback identity remains open');

  const accepts = (candidateRow, candidateResult, actorId, rollbacks, candidatePayload = payload) => {
    const issue = candidatePayload.data;
    return candidateResult.issue_id === issue.id
      && valueMatches({ ...candidateRow, linear_result: candidateResult }, candidatePayload, issue, {})
      && outboundEchoIdentityProof(candidateRow, candidateResult, actorId, rollbacks).accepted;
  };

  ok(!accepts(row, result, '', [], payload)
    && !accepts(row, result, '', [{ ...openRollback, state: 'complete' }], payload),
  'missing or closed rollback cannot authorize an actorless preflight echo');
  ok(!accepts(row, result, '', [{ ...openRollback, correlation_id: 'wrong-correlation' }], payload)
    && !accepts(row, result, '', [{ ...openRollback, team: 'wrong-team' }], payload),
  'rollback correlation and team must match the persisted preflight binder');

  for (const [field, value] of [
    ['outbox_id', '72'],
    ['dedup_key', 'wrong-dedup'],
    ['operation', 'due'],
    ['correlation_id', 'wrong-correlation'],
    ['rollback_id', '00000000-0000-4000-8000-000000000099'],
    ['f27_preflight', false],
  ]) {
    ok(!outboundEchoIdentityProof(row, { ...result, [field]: value }, '', [openRollback]).accepted,
      `tampered ${field} cannot authorize the F27 preflight proof`);
  }
  ok(f27PreflightIdentity(row, result).rollbackId === result.rollback_id,
    'preflight identity retains the exact rollback binder');

  const wrongIssuePayload = { ...payload, data: { ...payload.data, id: 'wrong-issue' } };
  const wrongValuePayload = {
    ...payload,
    data: { ...payload.data, state: { id: 'state-tweak' } },
  };
  ok(!accepts(row, result, '', [openRollback], wrongIssuePayload)
    && !accepts(row, result, '', [openRollback], wrongValuePayload),
  'an open rollback never weakens exact issue and exact value matching');

  const ordinaryResult = {
    issue_id: result.issue_id,
    mirror_actor_id: 'api-viewer',
    expected: result.expected,
  };
  const pending = { ...row, status: 'pending', processed_at: null };
  const written = { ...row, status: 'written', processed_at: '2026-07-21T00:00:00Z' };
  const ordinarySkipped = { ...row, status: 'skipped', processed_at: null };
  ok(accepts(pending, ordinaryResult, 'api-viewer', [openRollback])
    && !accepts(pending, ordinaryResult, '', [openRollback]),
  'ordinary pending echoes still require the exact actor even when a rollback is open');
  ok(accepts(written, ordinaryResult, '', [openRollback]),
    'ordinary written terminal exact-value echoes remain actor-independent');
  ok(!accepts(ordinarySkipped, ordinaryResult, 'api-viewer', [openRollback]),
    'ordinary skipped rows remain ineligible even with a matching actor');
  ok(accepts(pending, ordinaryResult, 'api-viewer', [])
    && accepts(written, ordinaryResult, '', []),
  'no rollback rows preserves the established ordinary actor and terminal proofs');

  ok(/if \(rollbackIds\.length\) \{[\s\S]*?from\("track_b_team_rollbacks"\)/.test(INBOUND),
    'rollback lookup occurs only when an exact F27 preflight candidate exists');
  ok(/catch \(_e\) \{\s*openF27Rollbacks = \[\];\s*\}/.test(INBOUND),
    'rollback lookup errors fail closed for the F27 proof');
  ok(/if \(!actorMatches && !terminalValueProof && !openF27PreflightProof\) continue/.test(INBOUND),
    'recentOutboundEcho wires the narrow open-preflight proof beside the unchanged proofs');

  if (failures) process.exit(1);
  console.log('F27 inbound actorless replay echo regression passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
