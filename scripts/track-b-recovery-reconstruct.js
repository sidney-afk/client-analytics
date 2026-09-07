'use strict';

/*
 * Reconstruct an authenticated Track-B recovery package (schema + data) into a
 * genuinely EMPTY, independently identified scratch database.
 *
 * Required environment:
 *   TRACK_B_RECOVERY_TARGET_URL          scratch-only PostgreSQL URL (restricted restore role)
 *   TRACK_B_RESTORE_EXPECTED_PROJECT_REF exact scratch project ref parsed from that URL
 *   TRACK_B_RECOVERY_CONFIRM             literal EMPTY_SCRATCH_ONLY
 *   TRACK_B_BACKUP_HMAC_KEY              package authentication key
 *
 * The production project ref is refused. The target must contain no public
 * relation, function or type; the tool never truncates, drops or cascades.
 * Nothing here uploads, schedules, alerts, or contacts a provider.
 *
 * THREE OUTCOMES, never conflated:
 *   rolled_back         the transaction failed (prerequisites, DDL, COPY,
 *                       sequence or the IN-TRANSACTION verification). Nothing
 *                       committed according to the observed object counts;
 *                       retry in place additionally requires a proven empty
 *                       public target before and after the attempt.
 *   committed_unverified the transaction committed but the independent
 *                       post-commit read failed or could not be transported.
 *                       The target now HOLDS DATA: it is quarantined, must not
 *                       be retried in place (the empty-target guard will refuse
 *                       it, correctly), and needs a FRESH empty target. The
 *                       failed target is preserved for diagnosis.
 *   verified            committed and independently verified.
 *
 * Deleting the package file is NOT a database rollback. A committed_unverified
 * target is reverted only by discarding that disposable database itself, which
 * is an operator action recorded in the receipt, never automated here.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const backup = require('./track-b-backup');
const recovery = require('./track-b-recovery-package');

const TARGET_URL = String(process.env.TRACK_B_RECOVERY_TARGET_URL || '');
const EXPECTED_REF = String(process.env.TRACK_B_RESTORE_EXPECTED_PROJECT_REF || '').trim();
const CONFIRM = String(process.env.TRACK_B_RECOVERY_CONFIRM || '');
const OUTCOMES = Object.freeze({ ROLLED_BACK: 'rolled_back', COMMITTED_UNVERIFIED: 'committed_unverified', VERIFIED: 'verified' });

function assertRecoveryTarget(url = TARGET_URL, expectedRef = EXPECTED_REF, confirm = CONFIRM) {
  if (!url) throw new Error('TRACK_B_RECOVERY_TARGET_URL is required');
  if (!expectedRef) throw new Error('TRACK_B_RESTORE_EXPECTED_PROJECT_REF is required');
  if (confirm !== 'EMPTY_SCRATCH_ONLY') throw new Error('TRACK_B_RECOVERY_CONFIRM must equal EMPTY_SCRATCH_ONLY');
  if (expectedRef === backup.PRODUCTION_REF) throw new Error('Production project ref is forbidden for recovery reconstruction');
  const actual = backup.connectionProjectRef(url);
  if (!actual || actual !== expectedRef) throw new Error('Recovery target URL does not match the expected scratch project ref');
  return actual;
}

function outcomeError(outcome, stage, result, extra = {}) {
  const error = new Error(`${stage} failed`);
  error.outcome = outcome;
  error.stage = stage;
  error.detail = result && (result.stderr || String(result.error || ''));
  Object.assign(error, extra);
  return error;
}

// Was anything committed? Asked in its own session so a transport failure of
// the verification query is never reported as an empty rollback.
function observeTargetState(env, psql) {
  const probe = spawnSync(psql, ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--command',
    "select json_build_object('public_relations',(select count(*) from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S','f','c','i','I','t')),'public_functions',(select count(*) from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace),'public_types',(select count(*) from pg_catalog.pg_type t where t.typnamespace='public'::regnamespace and t.typtype in ('e','d','r','c')))"],
  { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
  const unknown = { known: false, public_relations: null, public_functions: null, public_types: null };
  if (probe.error || probe.status !== 0) return unknown;
  try {
    const counts = JSON.parse(probe.stdout);
    if (!counts || typeof counts !== 'object' || Array.isArray(counts) ||
      !['public_relations', 'public_functions', 'public_types'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) return unknown;
    return { known: true, public_relations: counts.public_relations, public_functions: counts.public_functions, public_types: counts.public_types };
  } catch (_) { return unknown; }
}

function emptyTarget(state) {
  return state.known && state.public_relations === 0 && state.public_functions === 0 && state.public_types === 0;
}

// Private diagnostic receipt for a failed attempt. Public-safe: counts, digests,
// stage and outcome only. Row content and raw SQL error text never enter it.
function writeDiagnostic(directory, receipt) {
  if (!directory) return null;
  const file = path.join(path.resolve(directory), `recovery-attempt-${receipt.attempt_id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  return file;
}

/*
 * Runs the whole reconstruction with an explicit environment so the local
 * rehearsal can drive it with a disposable role. Returns a public-safe receipt
 * on success; throws an Error carrying `.outcome` on failure.
 */
function reconstruct(pkg, env, { psql = 'psql', tempDir = null, diagnosticDir = null, targetRef = null } = {}) {
  const started = Date.now();
  const attemptId = `${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${Math.random().toString(16).slice(2, 10)}`;
  const dir = tempDir || fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'track-b-reconstruct-'));
  const restoreFile = path.join(dir, 'reconstruct.sql');
  const verifyFile = path.join(dir, 'verify.sql');
  const base = { attempt_id: attemptId, target_project_ref: targetRef, package_binding: pkg.manifest.binding,
    source_generated_at: pkg.manifest.generated_at, corpus: pkg.manifest.corpus, recovery_version: pkg.manifest.recovery_version };
  // Observed BEFORE the attempt. "Did this attempt commit anything?" is a
  // comparison against this, not "is the target empty" — a pre-DDL refusal on
  // an already-populated target is still a rollback, not a commit.
  const stateBefore = observeTargetState(env, psql);
  try {
    fs.writeFileSync(restoreFile, recovery.reconstructSql(pkg), { mode: 0o600 });
    fs.writeFileSync(verifyFile, recovery.verificationSql(pkg.manifest), { mode: 0o600 });
    const applied = spawnSync(psql, ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--file', restoreFile], { encoding: 'utf8', env, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    if (applied.error || applied.status !== 0) {
      // The whole reconstruction is one transaction, so a non-zero exit means it
      // rolled back. Confirm that by comparing with the pre-attempt observation
      // rather than assuming, so a transport failure is never read as a rollback.
      const state = observeTargetState(env, psql);
      const rolledBack = state.known && stateBefore.known && ['public_relations', 'public_functions', 'public_types'].every(key => state[key] === stateBefore[key]);
      const receipt = { ...base, ok: false, outcome: rolledBack ? OUTCOMES.ROLLED_BACK : OUTCOMES.COMMITTED_UNVERIFIED,
        stage: 'reconstruction', target_state_known: state.known && stateBefore.known,
        target_public_relations_before: stateBefore.public_relations, target_public_relations: state.public_relations,
        target_public_functions_before: stateBefore.public_functions, target_public_functions: state.public_functions,
        target_public_types_before: stateBefore.public_types, target_public_types: state.public_types,
        target_was_empty_before: emptyTarget(stateBefore),
        retry_in_place_allowed: rolledBack && emptyTarget(stateBefore) && emptyTarget(state),
        quarantine_required: !rolledBack, elapsed_seconds: Math.round((Date.now() - started) / 1000) };
      receipt.diagnostic_file = writeDiagnostic(diagnosticDir, receipt);
      throw outcomeError(receipt.outcome, 'Track-B recovery reconstruction', applied, { receipt });
    }
    const verified = spawnSync(psql, ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--file', verifyFile], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    if (verified.error || verified.status !== 0) {
      const receipt = { ...base, ok: false, outcome: OUTCOMES.COMMITTED_UNVERIFIED, stage: 'post_commit_verification_transport',
        target_state_known: true, retry_in_place_allowed: false, quarantine_required: true,
        elapsed_seconds: Math.round((Date.now() - started) / 1000) };
      receipt.diagnostic_file = writeDiagnostic(diagnosticDir, receipt);
      throw outcomeError(OUTCOMES.COMMITTED_UNVERIFIED, 'Track-B recovery verification', verified, { receipt });
    }
    let observed;
    try {
      observed = recovery.verifyReconstruction(pkg.manifest, recovery.parseVerification(verified.stdout));
    } catch (error) {
      const receipt = { ...base, ok: false, outcome: OUTCOMES.COMMITTED_UNVERIFIED, stage: 'post_commit_verification',
        mismatch: error.message, target_state_known: true, retry_in_place_allowed: false, quarantine_required: true,
        elapsed_seconds: Math.round((Date.now() - started) / 1000) };
      receipt.diagnostic_file = writeDiagnostic(diagnosticDir, receipt);
      throw outcomeError(OUTCOMES.COMMITTED_UNVERIFIED, 'Track-B recovery verification', { stderr: error.message }, { receipt });
    }
    return { ok: true, outcome: OUTCOMES.VERIFIED, ...base, ...observed,
      in_transaction_verification: 'passed before commit', elapsed_seconds: Math.round((Date.now() - started) / 1000) };
  } finally {
    for (const file of [restoreFile, verifyFile]) fs.rmSync(file, { force: true });
    if (!tempDir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const targetRef = assertRecoveryTarget();
  const packagePath = path.resolve(process.argv[2] || '');
  if (!packagePath || !fs.existsSync(packagePath)) throw new Error('Recovery package path is required');
  const pkg = recovery.readRecoveryPackage(fs.readFileSync(packagePath), process.env.TRACK_B_BACKUP_HMAC_KEY);
  const receipt = reconstruct(pkg, backup.postgresEnvironment(TARGET_URL, 'syncview-track-b-recovery-reconstruct'), {
    diagnosticDir: process.env.TRACK_B_RECOVERY_DIAGNOSTIC_DIR || null, targetRef,
  });
  console.log(JSON.stringify(receipt));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Track-B recovery reconstruction\n\n- Target: scratch project \`${targetRef}\`\n- Outcome: ${receipt.outcome}\n- Corpus: ${receipt.corpus}\n- Schema fingerprint match: ${receipt.schema_fingerprint_match}\n- Elapsed: ${receipt.elapsed_seconds}s\n`);
  }
}

function failureResponse(error) {
  const outcome = error.outcome || 'failed';
  const retryEmpty = outcome === OUTCOMES.ROLLED_BACK && error.receipt && error.receipt.retry_in_place_allowed === true;
  return { ok: false, outcome, stage: error.stage || null, message: error.message,
    quarantine_required: outcome === OUTCOMES.COMMITTED_UNVERIFIED,
    operator_action: outcome === OUTCOMES.COMMITTED_UNVERIFIED
      ? 'target may hold committed data: quarantine it and use a FRESH empty target after review; deleting the package is not a database rollback'
      : retryEmpty ? 'transaction rollback and empty target confirmed: the same empty target may be retried'
        : outcome === OUTCOMES.ROLLED_BACK ? 'attempt rolled back; retry in place is not authorized by this receipt: review target state and prerequisites'
          : 'validation failed or target outcome is unverified: review the failure and prerequisites; no rollback or retry-in-place claim is established',
    diagnostic_file: (error.receipt && error.receipt.diagnostic_file) || null };
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(JSON.stringify(failureResponse(error)));
    process.exitCode = 1;
  }
}

module.exports = { OUTCOMES, assertRecoveryTarget, observeTargetState, reconstruct, failureResponse };
