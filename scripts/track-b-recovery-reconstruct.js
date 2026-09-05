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

function assertRecoveryTarget(url = TARGET_URL, expectedRef = EXPECTED_REF, confirm = CONFIRM) {
  if (!url) throw new Error('TRACK_B_RECOVERY_TARGET_URL is required');
  if (!expectedRef) throw new Error('TRACK_B_RESTORE_EXPECTED_PROJECT_REF is required');
  if (confirm !== 'EMPTY_SCRATCH_ONLY') throw new Error('TRACK_B_RECOVERY_CONFIRM must equal EMPTY_SCRATCH_ONLY');
  if (expectedRef === backup.PRODUCTION_REF) throw new Error('Production project ref is forbidden for recovery reconstruction');
  const actual = backup.connectionProjectRef(url);
  if (!actual || actual !== expectedRef) throw new Error('Recovery target URL does not match the expected scratch project ref');
  return actual;
}

function opaque(stage, result) {
  const error = new Error(`${stage} failed`);
  error.detail = result && (result.stderr || String(result.error || ''));
  return error;
}

// Runs the whole reconstruction with an explicit environment so the local
// rehearsal can drive it with a disposable role. Returns a public-safe receipt.
function reconstruct(pkg, env, { psql = 'psql', tempDir = null } = {}) {
  const started = Date.now();
  const dir = tempDir || fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'track-b-reconstruct-'));
  const restoreFile = path.join(dir, 'reconstruct.sql');
  const verifyFile = path.join(dir, 'verify.sql');
  try {
    fs.writeFileSync(restoreFile, recovery.reconstructSql(pkg), { mode: 0o600 });
    fs.writeFileSync(verifyFile, recovery.verificationSql(pkg.manifest), { mode: 0o600 });
    const applied = spawnSync(psql, ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--file', restoreFile], { encoding: 'utf8', env, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    if (applied.error || applied.status !== 0) throw opaque('Track-B recovery reconstruction', applied);
    const verified = spawnSync(psql, ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--file', verifyFile], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    if (verified.error || verified.status !== 0) throw opaque('Track-B recovery verification', verified);
    const receipt = recovery.verifyReconstruction(pkg.manifest, recovery.parseVerification(verified.stdout));
    return { ok: true, ...receipt, package_binding: pkg.manifest.binding, source_generated_at: pkg.manifest.generated_at, elapsed_seconds: Math.round((Date.now() - started) / 1000) };
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
  const receipt = reconstruct(pkg, backup.postgresEnvironment(TARGET_URL, 'syncview-track-b-recovery-reconstruct'));
  console.log(JSON.stringify({ ...receipt, target_project_ref: targetRef }));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Track-B recovery reconstruction\n\n- Target: scratch project \`${targetRef}\`\n- Result: verified\n- Corpus: ${receipt.corpus}\n- Schema fingerprint match: ${receipt.schema_fingerprint_match}\n- Elapsed: ${receipt.elapsed_seconds}s\n`);
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { assertRecoveryTarget, reconstruct };
