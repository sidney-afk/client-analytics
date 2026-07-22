#!/usr/bin/env node
'use strict';

/**
 * F27 reserved-drill operator runner.
 *
 * Live (the default) is deliberately difficult to enter:
 *
 *   SUPABASE_URL=https://PROJECT_REF.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/f27-drill-runner.js \
 *     --confirm=F27_RESERVED_DRILL_ONLY \
 *     --confirm-project=PROJECT_REF \
 *     --actor=f27-install-operator
 *
 * Resume only after a public-safe refusal reports a reserved rollback id:
 *
 *   SUPABASE_URL=https://PROJECT_REF.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/f27-drill-runner.js \
 *     --confirm=F27_RESERVED_DRILL_RESUME \
 *     --confirm-project=PROJECT_REF \
 *     --resume-rollback-id=RESERVED_ROLLBACK_UUID \
 *     --actor=f27-install-operator
 *
 * The live transport uses only Supabase REST/RPC plus the deployed
 * linear-outbound Edge Function. This source-only change never invokes it.
 *
 * Disposable PostgreSQL proof:
 *
 *   PGDATABASE=f27_operator_toolkit node scripts/f27-drill-runner.js \
 *     --transport=psql \
 *     --confirm=F27_DISPOSABLE_DRILL_ONLY \
 *     --confirm-database=f27_operator_toolkit \
 *     --actor=f27-ci
 *
 * Disposable resume uses the same database and actor:
 *
 *   PGDATABASE=f27_operator_toolkit node scripts/f27-drill-runner.js \
 *     --transport=psql \
 *     --confirm=F27_DISPOSABLE_DRILL_RESUME \
 *     --confirm-database=f27_operator_toolkit \
 *     --resume-rollback-id=RESERVED_ROLLBACK_UUID \
 *     --actor=f27-ci
 */

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DRILL_TEAM = '__f27_drill__';
const LIVE_CONFIRM = 'F27_RESERVED_DRILL_ONLY';
const LIVE_RESUME_CONFIRM = 'F27_RESERVED_DRILL_RESUME';
const PSQL_CONFIRM = 'F27_DISPOSABLE_DRILL_ONLY';
const PSQL_RESUME_CONFIRM = 'F27_DISPOSABLE_DRILL_RESUME';
const REPLAY_CONFIRM = 'F27_ROLLBACK_DRILL';
const EXPECTED_AUTHORITY = Object.freeze({ video: 'linear', graphics: 'linear' });
const EXPECTED_OUTBOUND = Object.freeze({ mode: 'off' });
const EXPECTED_PARITY = Object.freeze({ enabled: false });
const HASH_RE = /^[0-9a-f]{64}$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class F27OperatorError extends Error {
  constructor(code, stage = 'operator', recovery = null) {
    super(code);
    this.name = 'F27OperatorError';
    this.code = String(code || 'f27_operator_refused');
    this.stage = String(stage || 'operator');
    this.recovery = recovery;
  }
}

class F27TransportError extends F27OperatorError {
  constructor(code, stage) {
    super(code, stage);
    this.name = 'F27TransportError';
  }
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

// PostgreSQL jsonb orders object keys by UTF-8 byte length, then byte value,
// and emits a space after separators. The reserved row contains only JSON-safe
// integers, strings, booleans and nulls, so this is an independent reproduction
// of `row_sha256 = sha256(row_snapshot::text)` without a database helper.
function postgresJsonbStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(postgresJsonbStringify).join(', ')}]`;
  const keys = Object.keys(value).sort((left, right) => {
    const a = Buffer.from(left, 'utf8');
    const b = Buffer.from(right, 'utf8');
    return a.length - b.length || Buffer.compare(a, b);
  });
  return `{${keys.map(key => `${JSON.stringify(key)}: ${postgresJsonbStringify(value[key])}`).join(', ')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function same(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function requireExact(condition, code, stage) {
  if (!condition) throw new F27OperatorError(code, stage);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index]);
    if (!token.startsWith('--')) throw new F27OperatorError('f27_unknown_argument', 'preflight');
    const equals = token.indexOf('=');
    const name = token.slice(2, equals === -1 ? undefined : equals);
    let value = equals === -1 ? null : token.slice(equals + 1);
    if (value === null && index + 1 < argv.length && !String(argv[index + 1]).startsWith('--')) {
      value = String(argv[index + 1]);
      index += 1;
    }
    options[name] = value === null ? true : value;
  }
  return options;
}

function canonicalProjectUrl(rawUrl, projectRef) {
  const canonical = `https://${projectRef}.supabase.co`;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:'
        || url.username || url.password || url.port
        || url.search || url.hash || url.pathname !== '/'
        || url.hostname !== `${projectRef}.supabase.co`
        || (rawUrl !== canonical && rawUrl !== `${canonical}/`)) return '';
    return canonical;
  } catch (_error) {
    return '';
  }
}

function validateLiveConfig(options, env = process.env) {
  const rawUrl = clean(env.SUPABASE_URL);
  const confirmedProject = clean(options['confirm-project']);
  const actor = clean(options.actor);
  const confirmation = clean(options.confirm);
  const resumeRollbackId = clean(options['resume-rollback-id']);
  const operation = confirmation === LIVE_RESUME_CONFIRM || resumeRollbackId ? 'resume' : 'start';
  requireExact(operation === 'resume' ? confirmation === LIVE_RESUME_CONFIRM : confirmation === LIVE_CONFIRM,
    operation === 'resume' ? 'f27_live_resume_confirmation_required' : 'f27_live_confirmation_required',
    'preflight');
  requireExact(PROJECT_REF_RE.test(confirmedProject), 'f27_project_confirmation_invalid', 'preflight');
  const url = canonicalProjectUrl(rawUrl, confirmedProject);
  requireExact(url, 'f27_live_url_project_mismatch', 'preflight');
  if (operation === 'resume') {
    requireExact(UUID_V4_RE.test(resumeRollbackId), 'f27_resume_rollback_id_invalid', 'preflight');
  } else {
    requireExact(!resumeRollbackId, 'f27_resume_confirmation_required', 'preflight');
  }
  const serviceKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  requireExact(serviceKey, 'f27_live_credentials_required', 'preflight');
  requireExact(actor, 'f27_actor_required', 'preflight');
  return {
    url,
    serviceKey,
    projectRef: confirmedProject,
    actor,
    operation,
    resumeRollbackId,
    resumeConfirmation: LIVE_RESUME_CONFIRM,
  };
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function safeDatabaseName(value) {
  return /^[a-zA-Z_][a-zA-Z0-9_$-]*$/.test(clean(value));
}

function validatePsqlConfig(options, env = process.env) {
  const database = clean(env.PGDATABASE);
  const confirmedDatabase = clean(options['confirm-database']);
  const actor = clean(options.actor);
  const confirmation = clean(options.confirm);
  const resumeRollbackId = clean(options['resume-rollback-id']);
  const operation = confirmation === PSQL_RESUME_CONFIRM || resumeRollbackId ? 'resume' : 'start';
  requireExact(operation === 'resume' ? confirmation === PSQL_RESUME_CONFIRM : confirmation === PSQL_CONFIRM,
    operation === 'resume' ? 'f27_disposable_resume_confirmation_required' : 'f27_disposable_confirmation_required',
    'preflight');
  requireExact(database && safeDatabaseName(database), 'f27_disposable_database_required', 'preflight');
  requireExact(database === confirmedDatabase, 'f27_disposable_database_mismatch', 'preflight');
  if (operation === 'resume') {
    requireExact(UUID_V4_RE.test(resumeRollbackId), 'f27_resume_rollback_id_invalid', 'preflight');
  } else {
    requireExact(!resumeRollbackId, 'f27_resume_confirmation_required', 'preflight');
  }
  requireExact(actor, 'f27_actor_required', 'preflight');
  return {
    database,
    actor,
    env,
    operation,
    resumeRollbackId,
    resumeConfirmation: PSQL_RESUME_CONFIRM,
  };
}

function pageHash(rows, sorter) {
  const ordered = [...rows].sort(sorter || ((a, b) => stableStringify(a).localeCompare(stableStringify(b))));
  return { count: ordered.length, sha256: sha256(stableStringify(ordered)) };
}

async function expectRefusal(action, expectedCode, stage) {
  try {
    await action();
  } catch (error) {
    requireExact(error && error.code === expectedCode, `${expectedCode}_not_exact`, stage);
    return;
  }
  throw new F27OperatorError(`${expectedCode}_unexpectedly_succeeded`, stage);
}

function validateGuardPosture(guard, stage, { openDrills = 0 } = {}) {
  requireExact(same(guard.authority, EXPECTED_AUTHORITY), 'f27_authority_not_linear_linear', stage);
  requireExact(same(guard.outbound, EXPECTED_OUTBOUND), 'f27_outbound_not_off', stage);
  requireExact(same(guard.parity, EXPECTED_PARITY), 'f27_parity_not_false', stage);
  requireExact(Number(guard.openRealRollbacks) === 0, 'f27_open_real_rollback_present', stage);
  requireExact(Number(guard.openDrills) === openDrills,
    openDrills === 0 ? 'f27_open_drill_present' : 'f27_resume_open_drill_count_invalid', stage);
  for (const key of ['realOutbox', 'realFences', 'runtimeFlags', 'flagFlips']) {
    requireExact(guard[key] && Number.isInteger(Number(guard[key].count))
      && HASH_RE.test(clean(guard[key].sha256)), `f27_${key}_guard_invalid`, stage);
  }
}

function validateBegin(begin) {
  const stage = 'begin_drill';
  requireExact(begin && begin.ok === true && begin.type === 'f27_drill_snapshot_terminal',
    'f27_drill_begin_terminal_invalid', stage);
  requireExact(begin.team === DRILL_TEAM && begin.is_drill === true,
    'f27_drill_scope_invalid', stage);
  requireExact(clean(begin.rollback_id) && clean(begin.correlation_id) && clean(begin.outbox_id),
    'f27_drill_identity_missing', stage);
  requireExact(Number(begin.snapshot_count) === 1, 'f27_drill_snapshot_count_invalid', stage);
  requireExact(HASH_RE.test(clean(begin.row_sha256)) && HASH_RE.test(clean(begin.snapshot_sha256)),
    'f27_drill_snapshot_hash_invalid', stage);
  requireExact(same(begin.authority, EXPECTED_AUTHORITY)
    && same(begin.normal_outbound, EXPECTED_OUTBOUND)
    && same(begin.legacy_parity, EXPECTED_PARITY), 'f27_drill_controls_invalid', stage);
}

function validateSnapshot(view, begin, { state = 'open' } = {}) {
  const stage = 'snapshot_readback';
  const rollback = view && view.rollback;
  const intent = view && view.intent;
  const outbox = view && view.outbox;
  requireExact(rollback && intent && outbox, 'f27_drill_readback_missing', stage);
  requireExact(clean(rollback.id) === clean(begin.rollback_id)
    && clean(rollback.correlation_id) === clean(begin.correlation_id)
    && rollback.team === DRILL_TEAM && rollback.is_drill === true && rollback.state === state,
  'f27_drill_rollback_binding_invalid', stage);
  requireExact(same(rollback.expected_authority, EXPECTED_AUTHORITY)
    && same(rollback.prior_outbound, EXPECTED_OUTBOUND)
    && same(rollback.prior_parity, EXPECTED_PARITY)
    && rollback.fence_generation == null, 'f27_drill_rollback_controls_invalid', stage);
  requireExact(Number(rollback.snapshot_count) === 1
    && rollback.snapshot_sha256 === begin.snapshot_sha256,
  'f27_drill_snapshot_aggregate_mismatch', stage);
  requireExact(clean(intent.rollback_id) === clean(begin.rollback_id)
    && clean(intent.outbox_id) === clean(begin.outbox_id), 'f27_drill_intent_binding_invalid', stage);
  requireExact(intent.row_snapshot && typeof intent.row_snapshot === 'object'
    && !Array.isArray(intent.row_snapshot), 'f27_drill_snapshot_body_missing', stage);
  const independentRowHash = sha256(postgresJsonbStringify(intent.row_snapshot));
  requireExact(independentRowHash === intent.row_sha256
    && independentRowHash === begin.row_sha256, 'f27_drill_row_hash_mismatch', stage);
  requireExact(sha256(intent.row_sha256) === rollback.snapshot_sha256,
    'f27_drill_aggregate_hash_mismatch', stage);
  requireExact(clean(outbox.id) === clean(begin.outbox_id)
    && outbox.team === DRILL_TEAM && outbox.client_slug === DRILL_TEAM
    && outbox.test_only === true && outbox.legacy_parity === false
    && Number(outbox.authority_generation) === 0
    && clean(outbox.f27_drill_rollback_id) === clean(begin.rollback_id)
    && outbox.entity === 'deliverable' && outbox.operation === 'status'
    && outbox.payload && outbox.payload.f27_drill === true,
  'f27_drill_outbox_scope_invalid', stage);
  requireExact(clean(outbox.dedup_key) === `f27-drill:${clean(begin.rollback_id)}`,
    'f27_drill_dedup_binding_invalid', stage);
  requireExact(clean(intent.row_snapshot.id) === clean(begin.outbox_id)
    && intent.row_snapshot.team === DRILL_TEAM
    && intent.row_snapshot.client_slug === DRILL_TEAM
    && clean(intent.row_snapshot.f27_drill_rollback_id) === clean(begin.rollback_id),
  'f27_drill_immutable_snapshot_scope_invalid', stage);
}

function validateUnclassified(view) {
  const intent = view.intent;
  requireExact(intent.classification == null && intent.terminal_receipt == null
    && Array.isArray(intent.classification_history)
    && intent.classification_history.length === 0,
  'f27_drill_negative_classification_mutated_ledger', 'classification_refusals');
}

function validateClassified(view, actor) {
  const intent = view.intent;
  const outbox = view.outbox;
  requireExact(intent.classification === 'replay' && intent.reason === 'reserved drill replay'
    && intent.classified_by === actor && intent.terminal_receipt == null,
  'f27_drill_replay_classification_invalid', 'classify_replay');
  requireExact(Array.isArray(intent.classification_history)
    && intent.classification_history.length === 1
    && intent.classification_history[0].to === 'replay',
  'f27_drill_classification_history_invalid', 'classify_replay');
  const unlocked = outbox.lock_token == null && outbox.locked_at == null;
  const coherentlyLocked = UUID_V4_RE.test(clean(outbox.lock_token))
    && Number.isFinite(Date.parse(clean(outbox.locked_at)));
  requireExact(outbox.status === 'skipped' && (unlocked || coherentlyLocked),
    'f27_drill_replay_not_claimable', 'classify_replay');
}

function validateReplayReceipt(receipt, begin, view) {
  const stage = 'replay';
  const input = receipt && receipt.expected && receipt.expected.input;
  requireExact(receipt && receipt.ok === true
    && receipt.type === 'f27_drill_replay_terminal'
    && receipt.f27_drill === true && receipt.f27_preflight === true
    && receipt.no_external_call === true && receipt.mutation === 'f27DrillNoop',
  'f27_drill_replay_terminal_invalid', stage);
  requireExact(receipt.issue_id === `${DRILL_TEAM}:${clean(begin.rollback_id)}`
    && same(receipt.expected, { input: { stateId: DRILL_TEAM } })
    && input && input.stateId === DRILL_TEAM, 'f27_drill_noop_contract_invalid', stage);
  requireExact(clean(receipt.rollback_id) === clean(begin.rollback_id)
    && clean(receipt.outbox_id) === clean(begin.outbox_id)
    && clean(receipt.correlation_id) === clean(begin.correlation_id)
    && clean(receipt.dedup_key) === clean(view.outbox.dedup_key)
    && clean(receipt.operation) === clean(view.outbox.operation)
    && receipt.intent_snapshot_sha256 === view.intent.row_sha256,
  'f27_drill_replay_binding_invalid', stage);
  requireExact(HASH_RE.test(clean(receipt.linear_result_sha256)),
    'f27_drill_linear_result_hash_invalid', stage);
}

function validateReplayReadback(view, receipt) {
  const stage = 'replay_readback';
  requireExact(view.intent.classification === 'replay'
    && same(view.intent.terminal_receipt, receipt), 'f27_drill_ledger_receipt_mismatch', stage);
  requireExact(view.outbox.status === 'written'
    && view.outbox.lock_token == null && view.outbox.locked_at == null
    && view.outbox.linear_result && view.outbox.linear_result.no_external_call === true,
  'f27_drill_outbox_terminal_invalid', stage);
  requireExact(sha256(postgresJsonbStringify(view.outbox.linear_result))
    === receipt.linear_result_sha256, 'f27_drill_linear_result_hash_mismatch', stage);
}

function validateRecordTerminal(result) {
  requireExact(result && result.ok === true && result.type === 'f27_replay_terminal'
    && result.is_drill === true && result.idempotent === true,
  'f27_drill_record_terminal_not_idempotent', 'record_terminal');
}

function validateFinalReceipt(receipt, begin) {
  const stage = 'finalize_drill';
  requireExact(receipt && receipt.ok === true && receipt.type === 'f27_drill_terminal'
    && receipt.team === DRILL_TEAM && receipt.is_drill === true,
  'f27_drill_final_receipt_invalid', stage);
  requireExact(clean(receipt.rollback_id) === clean(begin.rollback_id)
    && clean(receipt.correlation_id) === clean(begin.correlation_id)
    && Number(receipt.snapshot_count) === 1
    && receipt.snapshot_sha256 === begin.snapshot_sha256,
  'f27_drill_final_binding_invalid', stage);
  requireExact(Number(receipt.unclassified) === 0
    && Number(receipt.unreceipted_replays) === 0
    && Number(receipt.replay_intents) === 1
    && Number(receipt.exact_terminal_replays) === 1
    && Number(receipt.active_drill_rows) === 0,
  'f27_drill_not_zero', stage);
  requireExact(receipt.authority_cas === 'refused'
    && receipt.authority_cas_reason === 'f27_drill_authority_cas_refused'
    && same(receipt.authority_before, EXPECTED_AUTHORITY)
    && same(receipt.authority_after, EXPECTED_AUTHORITY)
    && same(receipt.normal_outbound, EXPECTED_OUTBOUND)
    && same(receipt.legacy_parity, EXPECTED_PARITY)
    && receipt.audit_history_retained === true,
  'f27_drill_safe_final_state_invalid', stage);
}

function validateAudit(view, finalReceipt) {
  const stage = 'audit_readback';
  requireExact(view.rollback.state === 'complete'
    && view.rollback.completed_at
    && same(view.rollback.terminal_receipt, finalReceipt),
  'f27_drill_audit_not_retained', stage);
  requireExact(view.intent.classification === 'replay'
    && Array.isArray(view.intent.classification_history)
    && view.intent.classification_history.length === 1
    && view.intent.terminal_receipt
    && view.intent.terminal_receipt.type === 'f27_drill_replay_terminal',
  'f27_drill_ledger_audit_not_retained', stage);
  requireExact(view.outbox.status === 'written'
    && view.outbox.f27_drill_rollback_id === view.rollback.id
    && view.outbox.linear_result
    && view.outbox.linear_result.no_external_call === true,
  'f27_drill_outbox_audit_not_retained', stage);
}

function validateGuardsUnchanged(before, after) {
  validateGuardPosture(after, 'post_guard');
  for (const key of ['realOutbox', 'realFences', 'runtimeFlags', 'flagFlips']) {
    requireExact(Number(after[key].count) === Number(before[key].count)
      && after[key].sha256 === before[key].sha256,
    `f27_${key}_changed`, 'post_guard');
  }
}

function syntheticRecovery(candidate, resumeConfirmation) {
  const rollbackId = clean(candidate && (candidate.rollback_id || candidate.id));
  const confirmation = clean(resumeConfirmation);
  if (!candidate || candidate.team !== DRILL_TEAM || !UUID_V4_RE.test(rollbackId)
      || ![LIVE_RESUME_CONFIRM, PSQL_RESUME_CONFIRM].includes(confirmation)) return null;
  return {
    team: DRILL_TEAM,
    rollback_id: rollbackId,
    resume_confirmation: confirmation,
  };
}

function attachRecovery(error, candidate, resumeConfirmation) {
  const safe = error instanceof F27OperatorError
    ? error
    : new F27OperatorError('f27_operator_internal_error');
  safe.recovery = syntheticRecovery(candidate, resumeConfirmation);
  return safe;
}

function beginFromView(view) {
  const rollback = view && view.rollback;
  const intent = view && view.intent;
  const outbox = view && view.outbox;
  requireExact(rollback && intent && outbox, 'f27_resume_readback_missing', 'resume_bind');
  const begin = {
    ok: true,
    type: 'f27_drill_snapshot_terminal',
    rollback_id: rollback.id,
    correlation_id: rollback.correlation_id,
    team: rollback.team,
    is_drill: rollback.is_drill,
    outbox_id: intent.outbox_id,
    snapshot_count: rollback.snapshot_count,
    row_sha256: intent.row_sha256,
    snapshot_sha256: rollback.snapshot_sha256,
    normal_outbound: rollback.prior_outbound,
    legacy_parity: rollback.prior_parity,
    authority: rollback.expected_authority,
  };
  validateBegin(begin);
  return begin;
}

function terminalResult(transport, before, begin, { resumed = false, recoveredStage = null } = {}) {
  return {
    ok: true,
    type: 'f27_drill_operator_terminal',
    terminal: 'F27_DRILL_RUNNER_OK',
    transport: clean(transport.kind),
    team: DRILL_TEAM,
    resumed,
    ...(recoveredStage ? { recovered_stage: recoveredStage } : {}),
    snapshot: { count: 1, sha256: begin.snapshot_sha256 },
    guards: {
      real_outbox: before.realOutbox,
      real_fences: before.realFences,
      runtime_flags: before.runtimeFlags,
      flag_flips: before.flagFlips,
    },
    authority_cas: 'refused',
    authority_cas_reason: 'f27_drill_authority_cas_refused',
    audit_history_retained: true,
    dormant: true,
    assertions: [
      'reserved_scope_only',
      'snapshot_row_hash_exact',
      'snapshot_aggregate_hash_exact',
      'non_replay_classifications_refused',
      'replay_ledger_bound',
      'replay_no_external_call',
      'correlated_terminal_receipt_exact',
      'record_terminal_idempotent',
      'ordinary_authority_cas_refused',
      'drill_audit_history_retained',
      'real_outbox_unchanged',
      'real_fences_unchanged',
      'runtime_flags_unchanged',
      'flag_flips_unchanged',
      'no_open_rollback',
    ],
  };
}

async function proveClassificationRefusals(transport, begin, actor) {
  for (const classification of ['quarantine', 'discard', 'already_reflected']) {
    await expectRefusal(
      () => transport.classify(begin.rollback_id, begin.outbox_id, classification, actor),
      'f27_drill_replay_classification_required',
      'classification_refusals',
    );
  }
}

async function classifyReplay(transport, begin, actor) {
  const classification = await transport.classify(
    begin.rollback_id, begin.outbox_id, 'replay', actor,
  );
  requireExact(classification && classification.ok === true
    && classification.type === 'f27_classification_terminal'
    && classification.classification === 'replay',
  'f27_drill_classification_terminal_invalid', 'classify_replay');
}

async function runF27Drill(transport, { actor }) {
  const before = await transport.guardState();
  try {
    validateGuardPosture(before, 'pre_guard');
  } catch (error) {
    throw attachRecovery(error, before.openDrillRecovery, transport.resumeConfirmation);
  }

  const begin = await transport.beginDrill(EXPECTED_AUTHORITY, actor);
  validateBegin(begin);
  let view = await transport.readDrill(begin.rollback_id, begin.outbox_id);
  validateSnapshot(view, begin);
  validateUnclassified(view);

  await proveClassificationRefusals(transport, begin, actor);
  view = await transport.readDrill(begin.rollback_id, begin.outbox_id);
  validateUnclassified(view);

  await classifyReplay(transport, begin, actor);
  view = await transport.readDrill(begin.rollback_id, begin.outbox_id);
  validateClassified(view, actor);

  const replayReceipt = await transport.executeReplay(begin, view);
  validateReplayReceipt(replayReceipt, begin, view);
  view = await transport.readDrill(begin.rollback_id, begin.outbox_id);
  validateReplayReadback(view, replayReceipt);

  validateRecordTerminal(await transport.recordTerminal(
    begin.rollback_id, begin.outbox_id, replayReceipt,
  ));
  await expectRefusal(
    () => transport.finalizeOrdinary(begin.rollback_id, EXPECTED_AUTHORITY, actor),
    'f27_drill_authority_cas_refused',
    'authority_cas_refusal',
  );

  const finalReceipt = await transport.finalizeDrill(
    begin.rollback_id, EXPECTED_AUTHORITY, actor,
  );
  validateFinalReceipt(finalReceipt, begin);
  view = await transport.readDrill(begin.rollback_id, begin.outbox_id);
  validateAudit(view, finalReceipt);

  const after = await transport.guardState();
  validateGuardsUnchanged(before, after);

  return terminalResult(transport, before, begin);
}

async function runF27DrillResume(transport, { actor, rollbackId }) {
  const before = await transport.guardState();
  const openDrills = Number(before.openDrills);
  requireExact(openDrills === 0 || openDrills === 1,
    'f27_resume_open_drill_count_invalid', 'resume_guard');
  validateGuardPosture(before, 'resume_guard', { openDrills });
  if (openDrills === 1) {
    const recovery = syntheticRecovery(before.openDrillRecovery, transport.resumeConfirmation);
    requireExact(recovery && recovery.rollback_id === rollbackId,
      'f27_resume_rollback_id_mismatch', 'resume_guard');
  }

  let view = await transport.readDrillByRollbackId(rollbackId);
  requireExact(view.rollback.team === DRILL_TEAM && view.rollback.is_drill === true,
    'f27_resume_scope_mismatch', 'resume_bind');
  requireExact(view.rollback.actor === actor, 'f27_resume_actor_mismatch', 'resume_bind');
  requireExact(view.rollback.state === (openDrills === 1 ? 'open' : 'complete'),
    'f27_resume_state_mismatch', 'resume_bind');
  const begin = beginFromView(view);
  validateSnapshot(view, begin, { state: view.rollback.state });

  if (view.rollback.state === 'complete') {
    const finalReceipt = view.rollback.terminal_receipt;
    validateFinalReceipt(finalReceipt, begin);
    validateAudit(view, finalReceipt);
    const after = await transport.guardState();
    validateGuardsUnchanged(before, after);
    return terminalResult(transport, before, begin, {
      resumed: true,
      recoveredStage: 'finalized',
    });
  }

  let recoveredStage;
  if (view.intent.classification == null && view.intent.terminal_receipt == null) {
    recoveredStage = 'unclassified';
    validateUnclassified(view);
    await proveClassificationRefusals(transport, begin, actor);
    view = await transport.readDrill(begin.rollback_id, begin.outbox_id);
    validateUnclassified(view);
    await classifyReplay(transport, begin, actor);
    view = await transport.readDrill(begin.rollback_id, begin.outbox_id);
    validateClassified(view, actor);
  } else {
    requireExact(view.intent.classification === 'replay',
      'f27_resume_classification_invalid', 'resume_stage');
    if (view.intent.terminal_receipt == null) {
      recoveredStage = 'classified';
      validateClassified(view, actor);
    } else {
      recoveredStage = 'terminal';
      validateReplayReceipt(view.intent.terminal_receipt, begin, view);
      validateReplayReadback(view, view.intent.terminal_receipt);
    }
  }

  let replayReceipt = view.intent.terminal_receipt;
  if (!replayReceipt) {
    replayReceipt = await transport.executeReplay(begin, view);
    validateReplayReceipt(replayReceipt, begin, view);
    view = await transport.readDrill(begin.rollback_id, begin.outbox_id);
    validateReplayReadback(view, replayReceipt);
  }

  validateRecordTerminal(await transport.recordTerminal(
    begin.rollback_id, begin.outbox_id, replayReceipt,
  ));
  await expectRefusal(
    () => transport.finalizeOrdinary(begin.rollback_id, EXPECTED_AUTHORITY, actor),
    'f27_drill_authority_cas_refused',
    'authority_cas_refusal',
  );
  const finalReceipt = await transport.finalizeDrill(
    begin.rollback_id, EXPECTED_AUTHORITY, actor,
  );
  validateFinalReceipt(finalReceipt, begin);
  view = await transport.readDrill(begin.rollback_id, begin.outbox_id);
  validateAudit(view, finalReceipt);
  const after = await transport.guardState();
  validateGuardsUnchanged(before, after);
  return terminalResult(transport, before, begin, { resumed: true, recoveredStage });
}

function postgrestErrorCode(body, fallback) {
  const message = clean(body && body.message);
  return /^f27_[a-z0-9_:.-]+$/i.test(message) ? message : fallback;
}

class LiveRestEdgeTransport {
  constructor(config, fetchImpl = globalThis.fetch) {
    requireExact(typeof fetchImpl === 'function', 'f27_fetch_unavailable', 'preflight');
    requireExact(PROJECT_REF_RE.test(clean(config.projectRef)),
      'f27_project_confirmation_invalid', 'preflight');
    const safeUrl = canonicalProjectUrl(clean(config.url), clean(config.projectRef));
    requireExact(safeUrl, 'f27_live_url_project_mismatch', 'preflight');
    this.kind = 'live-rest-edge';
    this.url = safeUrl;
    this.key = config.serviceKey;
    this.projectRef = config.projectRef;
    this.resumeConfirmation = config.resumeConfirmation;
    this.fetch = fetchImpl;
  }

  headers(extra = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      Accept: 'application/json',
      ...extra,
    };
  }

  async request(path, options = {}, stage = 'rest') {
    let response;
    try {
      response = await this.fetch(`${this.url}${path}`, {
        ...options,
        redirect: 'error',
        headers: this.headers(options.headers || {}),
      });
    } catch (_error) {
      throw new F27TransportError('f27_transport_unavailable', stage);
    }
    let body = null;
    let text;
    try {
      text = await response.text();
    } catch (_error) {
      throw new F27TransportError('f27_transport_response_lost', stage);
    }
    if (text) {
      try { body = JSON.parse(text); } catch (_error) { body = null; }
    }
    if (!response.ok) {
      throw new F27TransportError(postgrestErrorCode(body, 'f27_rest_request_refused'), stage);
    }
    return { body, response };
  }

  async rows(table, query, stage) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { body } = await this.request(
        `/rest/v1/${table}?${query}&limit=${pageSize}&offset=${offset}`,
        {},
        stage,
      );
      requireExact(Array.isArray(body), 'f27_rest_rows_invalid', stage);
      rows.push(...body);
      if (body.length < pageSize) break;
    }
    return rows;
  }

  async one(table, query, stage) {
    const rows = await this.rows(table, query, stage);
    requireExact(rows.length === 1, 'f27_rest_single_row_required', stage);
    return rows[0];
  }

  async rpc(name, args, stage) {
    const { body } = await this.request(`/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }, stage);
    requireExact(body && typeof body === 'object' && !Array.isArray(body),
      'f27_rpc_terminal_invalid', stage);
    return body;
  }

  async guardState() {
    const flags = await this.rows('syncview_runtime_flags',
      'select=key,value,updated_at,updated_by&key=in.(prod_authority,linear_outbound_enabled,linear_legacy_parity_enabled)&order=key.asc',
      'guard_flags');
    const flagMap = Object.fromEntries(flags.map(row => [row.key, row.value]));
    const realRows = await this.rows('mirror_outbox',
      'select=*&team=in.(video,graphics)&order=id.asc', 'guard_real_outbox');
    const fences = await this.rows('track_b_f27_team_fences',
      'select=team,generation,updated_at,updated_by&order=team.asc', 'guard_fences');
    const flips = await this.rows('flag_flips',
      'select=id,key,old_value,new_value,ts,actor&order=id.asc', 'guard_flag_flips');
    const open = await this.rows('track_b_team_rollbacks',
      'select=id,team,is_drill,state&state=eq.open&order=team.asc', 'guard_rollbacks');
    const openDrill = open.filter(row => row.is_drill === true && row.team === DRILL_TEAM);
    return {
      authority: flagMap.prod_authority,
      outbound: flagMap.linear_outbound_enabled,
      parity: flagMap.linear_legacy_parity_enabled,
      realOutbox: pageHash(realRows, (a, b) => Number(a.id) - Number(b.id)),
      realFences: pageHash(fences, (a, b) => clean(a.team).localeCompare(clean(b.team))),
      runtimeFlags: pageHash(flags, (a, b) => clean(a.key).localeCompare(clean(b.key))),
      flagFlips: pageHash(flips, (a, b) => Number(a.id) - Number(b.id)),
      openRealRollbacks: open.filter(row => row.is_drill !== true).length,
      openDrills: open.filter(row => row.is_drill === true).length,
      openDrillRecovery: openDrill.length === 1
        ? { team: DRILL_TEAM, rollback_id: clean(openDrill[0].id) }
        : null,
    };
  }

  async beginDrill(authority, actor) {
    const begin = await this.rpc('track_b_f27_begin_drill', {
      p_expected_authority: authority,
      p_actor: actor,
    }, 'begin_drill');
    this.lastRecovery = syntheticRecovery(begin, this.resumeConfirmation);
    return begin;
  }

  async readDrill(rollbackId, outboxId) {
    const rollback = await this.one('track_b_team_rollbacks',
      `select=*&id=eq.${encodeURIComponent(rollbackId)}`, 'read_drill_rollback');
    const intent = await this.one('track_b_team_rollback_intents',
      `select=*&rollback_id=eq.${encodeURIComponent(rollbackId)}&outbox_id=eq.${encodeURIComponent(outboxId)}`,
      'read_drill_intent');
    const outbox = await this.one('mirror_outbox',
      `select=*&id=eq.${encodeURIComponent(outboxId)}`, 'read_drill_outbox');
    return { rollback, intent, outbox };
  }

  async readDrillByRollbackId(rollbackId) {
    const rollback = await this.one('track_b_team_rollbacks',
      `select=*&id=eq.${encodeURIComponent(rollbackId)}&team=eq.${encodeURIComponent(DRILL_TEAM)}&is_drill=eq.true`,
      'resume_read_rollback');
    const intents = await this.rows('track_b_team_rollback_intents',
      `select=*&rollback_id=eq.${encodeURIComponent(rollbackId)}`, 'resume_read_intent');
    requireExact(intents.length === 1, 'f27_resume_intent_count_invalid', 'resume_bind');
    const intent = intents[0];
    const outbox = await this.one('mirror_outbox',
      `select=*&id=eq.${encodeURIComponent(intent.outbox_id)}&f27_drill_rollback_id=eq.${encodeURIComponent(rollbackId)}`,
      'resume_read_outbox');
    return { rollback, intent, outbox };
  }

  async discoverOpenDrill() {
    const rows = await this.rows('track_b_team_rollbacks',
      `select=id,team,is_drill,state&state=eq.open&team=eq.${encodeURIComponent(DRILL_TEAM)}&is_drill=eq.true`,
      'recovery_discovery');
    return rows.length === 1
      ? { team: DRILL_TEAM, rollback_id: clean(rows[0].id) }
      : null;
  }

  classify(rollbackId, outboxId, classification, actor) {
    return this.rpc('track_b_f27_classify', {
      p_rollback_id: rollbackId,
      p_outbox_id: Number(outboxId),
      p_classification: classification,
      p_reason: classification === 'replay' ? 'reserved drill replay' : 'reserved drill refusal proof',
      p_actor: actor,
      p_reflected_receipt: null,
    }, 'classify');
  }

  async executeReplay(begin) {
    const { body } = await this.request('/functions/v1/linear-outbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rollback_id: begin.rollback_id,
        target_dedup_key: `f27-drill:${begin.rollback_id}`,
        confirm: REPLAY_CONFIRM,
      }),
    }, 'replay');
    requireExact(body && body.ok === true && body.f27_drill_receipt,
      'f27_drill_edge_terminal_invalid', 'replay');
    return body.f27_drill_receipt;
  }

  recordTerminal(rollbackId, outboxId, receipt) {
    return this.rpc('track_b_f27_record_terminal', {
      p_rollback_id: rollbackId,
      p_outbox_id: Number(outboxId),
      p_receipt: receipt,
    }, 'record_terminal');
  }

  finalizeOrdinary(rollbackId, authority, actor) {
    return this.rpc('track_b_f27_finalize', {
      p_rollback_id: rollbackId,
      p_expected_authority: authority,
      p_actor: actor,
    }, 'authority_cas_refusal');
  }

  finalizeDrill(rollbackId, authority, actor) {
    return this.rpc('track_b_f27_finalize_drill', {
      p_rollback_id: rollbackId,
      p_expected_authority: authority,
      p_actor: actor,
    }, 'finalize_drill');
  }
}

class PsqlDisposableTransport {
  constructor(config, spawn = spawnSync) {
    this.kind = 'disposable-postgresql';
    this.database = config.database;
    this.env = config.env;
    this.resumeConfirmation = config.resumeConfirmation;
    this.spawn = spawn;
    const current = this.scalar('select current_database()', 'psql_preflight');
    requireExact(current === this.database, 'f27_disposable_database_mismatch', 'psql_preflight');
    const marker = this.scalar(
      "select coalesce((select marker from f27_operator_fixture.identity where singleton = true), '')",
      'psql_preflight',
    );
    requireExact(marker === 'F27_DISPOSABLE_OPERATOR_FIXTURE',
      'f27_disposable_marker_missing', 'psql_preflight');
  }

  scalar(sql, stage) {
    const result = this.spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', sql], {
      env: this.env,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      const safe = `${clean(result.stderr)}\n${clean(result.stdout)}`.match(/f27_[a-z0-9_:.-]+/i);
      throw new F27TransportError(safe ? safe[0] : 'f27_psql_request_refused', stage);
    }
    const lines = clean(result.stdout).split(/\r?\n/).filter(Boolean);
    requireExact(lines.length === 1, 'f27_psql_scalar_invalid', stage);
    return lines[0];
  }

  json(sql, stage) {
    const value = this.scalar(sql, stage);
    try {
      const parsed = JSON.parse(value);
      requireExact(parsed && typeof parsed === 'object' && !Array.isArray(parsed),
        'f27_psql_json_invalid', stage);
      return parsed;
    } catch (error) {
      if (error instanceof F27OperatorError) throw error;
      throw new F27TransportError('f27_psql_json_invalid', stage);
    }
  }

  guardState() {
    return Promise.resolve(this.json(`
      with relevant_flags as (
        select key, value, updated_at, updated_by
        from public.syncview_runtime_flags
        where key in ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')
      ), real_rows as (
        select id, encode(extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex') row_hash
        from public.mirror_outbox o where team in ('video','graphics')
      ), fences as (
        select team, encode(extensions.digest(convert_to(to_jsonb(f)::text, 'UTF8'), 'sha256'), 'hex') row_hash
        from public.track_b_f27_team_fences f
      ), flips as (
        select id, encode(extensions.digest(convert_to(to_jsonb(x)::text, 'UTF8'), 'sha256'), 'hex') row_hash
        from public.flag_flips x
      )
      select jsonb_build_object(
        'authority', (select value from relevant_flags where key='prod_authority'),
        'outbound', (select value from relevant_flags where key='linear_outbound_enabled'),
        'parity', (select value from relevant_flags where key='linear_legacy_parity_enabled'),
        'realOutbox', jsonb_build_object(
          'count', (select count(*) from real_rows),
          'sha256', encode(extensions.digest(convert_to(coalesce((select string_agg(row_hash, '' order by id) from real_rows), ''), 'UTF8'), 'sha256'), 'hex')
        ),
        'realFences', jsonb_build_object(
          'count', (select count(*) from fences),
          'sha256', encode(extensions.digest(convert_to(coalesce((select string_agg(row_hash, '' order by team) from fences), ''), 'UTF8'), 'sha256'), 'hex')
        ),
        'runtimeFlags', jsonb_build_object(
          'count', (select count(*) from relevant_flags),
          'sha256', encode(extensions.digest(convert_to(coalesce((select string_agg(encode(extensions.digest(convert_to(to_jsonb(f)::text, 'UTF8'), 'sha256'), 'hex'), '' order by key) from relevant_flags f), ''), 'UTF8'), 'sha256'), 'hex')
        ),
        'flagFlips', jsonb_build_object(
          'count', (select count(*) from flips),
          'sha256', encode(extensions.digest(convert_to(coalesce((select string_agg(row_hash, '' order by id) from flips), ''), 'UTF8'), 'sha256'), 'hex')
        ),
        'openRealRollbacks', (select count(*) from public.track_b_team_rollbacks where state='open' and is_drill=false),
        'openDrills', (select count(*) from public.track_b_team_rollbacks where state='open' and is_drill=true),
        'openDrillRecovery', (
          select jsonb_build_object('team', team, 'rollback_id', id)
          from public.track_b_team_rollbacks
          where state='open' and is_drill=true and team='__f27_drill__'
        )
      )::text
    `, 'guard'));
  }

  beginDrill(authority, actor) {
    const begin = this.json(
      `select public.track_b_f27_begin_drill(${sqlLiteral(JSON.stringify(authority))}::jsonb, ${sqlLiteral(actor)})::text`,
      'begin_drill',
    );
    this.lastRecovery = syntheticRecovery(begin, this.resumeConfirmation);
    return Promise.resolve(begin);
  }

  readDrill(rollbackId, outboxId) {
    return Promise.resolve(this.json(`
      select jsonb_build_object(
        'rollback', to_jsonb(r),
        'intent', to_jsonb(i),
        'outbox', to_jsonb(o)
      )::text
      from public.track_b_team_rollbacks r
      join public.track_b_team_rollback_intents i on i.rollback_id = r.id
      join public.mirror_outbox o on o.id = i.outbox_id
      where r.id = ${sqlLiteral(rollbackId)}::uuid
        and i.outbox_id = ${sqlLiteral(outboxId)}::bigint
    `, 'read_drill'));
  }

  readDrillByRollbackId(rollbackId) {
    return Promise.resolve(this.json(`
      select jsonb_build_object(
        'rollback', to_jsonb(r),
        'intent', to_jsonb(i),
        'outbox', to_jsonb(o)
      )::text
      from public.track_b_team_rollbacks r
      join public.track_b_team_rollback_intents i on i.rollback_id = r.id
      join public.mirror_outbox o
        on o.id = i.outbox_id and o.f27_drill_rollback_id = r.id
      where r.id = ${sqlLiteral(rollbackId)}::uuid
        and r.team = '__f27_drill__'
        and r.is_drill = true
        and (select count(*) from public.track_b_team_rollback_intents x where x.rollback_id = r.id) = 1
    `, 'resume_read_drill'));
  }

  discoverOpenDrill() {
    return Promise.resolve(this.json(`
      select coalesce((
        select jsonb_build_object('team', team, 'rollback_id', id)
        from public.track_b_team_rollbacks
        where state='open' and is_drill=true and team='__f27_drill__'
      ), '{}'::jsonb)::text
    `, 'recovery_discovery'));
  }

  classify(rollbackId, outboxId, classification, actor) {
    const reason = classification === 'replay' ? 'reserved drill replay' : 'reserved drill refusal proof';
    return Promise.resolve(this.json(`
      select public.track_b_f27_classify(
        ${sqlLiteral(rollbackId)}::uuid,
        ${sqlLiteral(outboxId)}::bigint,
        ${sqlLiteral(classification)},
        ${sqlLiteral(reason)},
        ${sqlLiteral(actor)},
        null
      )::text
    `, 'classify'));
  }

  executeReplay(begin) {
    return Promise.resolve(this.json(`
      with token as (select gen_random_uuid() as value),
      claimed as (
        update public.mirror_outbox o
        set lock_token = token.value,
            locked_at = now(),
            updated_at = now()
        from token
        where o.id = ${sqlLiteral(begin.outbox_id)}::bigint
          and o.status = 'skipped'
          and (o.lock_token is null or o.locked_at < now() - interval '10 minutes')
        returning o.lock_token
      )
      select public.track_b_f27_execute_drill_replay(
        ${sqlLiteral(begin.rollback_id)}::uuid,
        ${sqlLiteral(begin.outbox_id)}::bigint,
        (select lock_token from claimed)
      )::text
    `, 'replay'));
  }

  recordTerminal(rollbackId, outboxId, receipt) {
    return Promise.resolve(this.json(`
      select public.track_b_f27_record_terminal(
        ${sqlLiteral(rollbackId)}::uuid,
        ${sqlLiteral(outboxId)}::bigint,
        ${sqlLiteral(JSON.stringify(receipt))}::jsonb
      )::text
    `, 'record_terminal'));
  }

  finalizeOrdinary(rollbackId, authority, actor) {
    return Promise.resolve(this.json(`
      select public.track_b_f27_finalize(
        ${sqlLiteral(rollbackId)}::uuid,
        ${sqlLiteral(JSON.stringify(authority))}::jsonb,
        ${sqlLiteral(actor)}
      )::text
    `, 'authority_cas_refusal'));
  }

  finalizeDrill(rollbackId, authority, actor) {
    return Promise.resolve(this.json(`
      select public.track_b_f27_finalize_drill(
        ${sqlLiteral(rollbackId)}::uuid,
        ${sqlLiteral(JSON.stringify(authority))}::jsonb,
        ${sqlLiteral(actor)}
      )::text
    `, 'finalize_drill'));
  }
}

async function executeConfigured(transport, config) {
  try {
    return config.operation === 'resume'
      ? await runF27DrillResume(transport, {
        actor: config.actor,
        rollbackId: config.resumeRollbackId,
      })
      : await runF27Drill(transport, { actor: config.actor });
  } catch (error) {
    if (error instanceof F27OperatorError && error.recovery) throw error;
    let candidate = config.operation === 'resume'
      ? { team: DRILL_TEAM, rollback_id: config.resumeRollbackId }
      : transport.lastRecovery;
    if (!candidate) {
      try { candidate = await transport.discoverOpenDrill(); } catch (_discoveryError) { candidate = null; }
    }
    throw attachRecovery(error, candidate, config.resumeConfirmation);
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const transportName = clean(options.transport || 'live').toLowerCase();
  let transport;
  let config;
  if (transportName === 'live') {
    config = validateLiveConfig(options, env);
    transport = new LiveRestEdgeTransport(config);
  } else if (transportName === 'psql') {
    config = validatePsqlConfig(options, env);
    transport = new PsqlDisposableTransport(config);
  } else {
    throw new F27OperatorError('f27_transport_invalid', 'preflight');
  }
  return executeConfigured(transport, config);
}

function publicFailure(error) {
  const safe = error instanceof F27OperatorError
    ? error
    : new F27OperatorError('f27_operator_internal_error');
  const recovery = syntheticRecovery(
    safe.recovery,
    safe.recovery && safe.recovery.resume_confirmation,
  );
  return {
    ok: false,
    type: 'f27_drill_operator_refused',
    stage: safe.stage,
    error: safe.code,
    ...(recovery ? { recovery } : {}),
  };
}

if (require.main === module) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DRILL_TEAM,
  EXPECTED_AUTHORITY,
  EXPECTED_OUTBOUND,
  EXPECTED_PARITY,
  F27OperatorError,
  F27TransportError,
  LiveRestEdgeTransport,
  PsqlDisposableTransport,
  parseArgs,
  validateLiveConfig,
  validatePsqlConfig,
  stableStringify,
  postgresJsonbStringify,
  sha256,
  runF27Drill,
  runF27DrillResume,
  syntheticRecovery,
  publicFailure,
  executeConfigured,
  main,
};
