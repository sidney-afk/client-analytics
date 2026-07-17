'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  readVisualReviewFile,
  validatePublicEvidence,
  writeReviewArtifacts,
} = require('./review');

const ROOT = path.join(__dirname, '..', '..');
const args = new Set(process.argv.slice(2));
const updatePublic = args.has('--update-public');
const validatePublic = args.has('--validate-public-evidence');
const headed = args.has('--headed');
const privateRoot = path.join(ROOT, '.codex-tmp', 'pto-lifecycle');
const publicArtifactDir = path.join(ROOT, 'docs', 'audits', '2026-07-17-pto-lifecycle-simulation');
const defaultArtifactDir = path.join(privateRoot, 'latest');
const publicStageDir = path.join(privateRoot, 'public-stage');
const artifactDir = updatePublic ? publicStageDir : defaultArtifactDir;
const screenshotDir = path.join(artifactDir, 'screenshots');
const visualReviewFile = path.join(ROOT, 'qa', 'pto-lifecycle', 'visual-review.json');
const GENERATED_PUBLIC_ENTRIES = new Set([
  'screenshots',
  'manifest.json',
  'gallery.html',
  'VISUAL_REVIEW.md',
]);

if (validatePublic && (updatePublic || headed)) {
  throw new Error('--validate-public-evidence cannot be combined with browser-run options');
}

function assertSafePrivatePath(target) {
  const resolved = path.resolve(target);
  const allowed = path.resolve(privateRoot);
  if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) {
    throw new Error('Refusing to replace a path outside the private PTO lifecycle staging root');
  }
}

function cleanPrivateDirectory(target) {
  assertSafePrivatePath(target);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function sourceCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}

function sourceTreeFingerprint() {
  const files = [
    'index.html',
    'package.json',
    'supabase/functions/pto/policy.js',
    ...fs.readdirSync(path.join(ROOT, 'qa', 'pto-lifecycle'))
      .filter(file => /\.(?:js|json)$/.test(file))
      .map(file => `qa/pto-lifecycle/${file}`),
  ].sort();
  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    const full = path.join(ROOT, relative);
    if (!fs.existsSync(full)) continue;
    hash.update(relative.replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(full));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function visualVerdicts() {
  return readVisualReviewFile(visualReviewFile);
}

function copyAuthoredPublicEntries(destination) {
  if (!fs.existsSync(publicArtifactDir)) return;
  for (const entry of fs.readdirSync(publicArtifactDir, { withFileTypes: true })) {
    if (GENERATED_PUBLIC_ENTRIES.has(entry.name)) continue;
    fs.cpSync(
      path.join(publicArtifactDir, entry.name),
      path.join(destination, entry.name),
      { recursive: entry.isDirectory() },
    );
  }
}

function publishStagedEvidence(stageDir, sourceTreeSha256) {
  const publishDir = path.join(privateRoot, `public-publish-${process.pid}`);
  const backupDir = path.join(privateRoot, `public-backup-${process.pid}`);
  assertSafePrivatePath(publishDir);
  fs.rmSync(publishDir, { recursive: true, force: true });
  fs.cpSync(stageDir, publishDir, { recursive: true });
  copyAuthoredPublicEntries(publishDir);
  validatePublicEvidence(publishDir, {
    sourceTreeSha256,
    visualReviewFile,
  });

  assertSafePrivatePath(backupDir);
  fs.rmSync(backupDir, { recursive: true, force: true });
  const hadPublicPacket = fs.existsSync(publicArtifactDir);
  if (hadPublicPacket) fs.renameSync(publicArtifactDir, backupDir);
  try {
    fs.renameSync(publishDir, publicArtifactDir);
  } catch (error) {
    if (hadPublicPacket && !fs.existsSync(publicArtifactDir) && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, publicArtifactDir);
    }
    throw error;
  }
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.rmSync(stageDir, { recursive: true, force: true });
}

function packetMetadata(result, sourceTreeSha256, verdicts) {
  return {
    sourceCommit: sourceCommit(),
    sourceTreeSha256,
    coverage: result.coverage,
    visualVerdicts: verdicts,
  };
}

async function runBrowserLane() {
  const { createMockBackend } = require('./mock-backend');
  const { LifecycleHarness } = require('./harness');
  const { runMockedScenarios } = require('./scenarios');
  const verdicts = visualVerdicts();
  const sourceTreeSha256 = sourceTreeFingerprint();

  cleanPrivateDirectory(artifactDir);
  const backend = await createMockBackend();
  const harness = new LifecycleHarness(backend, {
    outputDir: screenshotDir,
    publicOutput: updatePublic,
    headless: !headed,
  });
  let result = { coverage: [] };
  let packetWritten = false;
  await harness.start();
  try {
    result = await runMockedScenarios(harness);
    const packet = writeReviewArtifacts(
      harness.shots,
      artifactDir,
      packetMetadata(result, sourceTreeSha256, verdicts),
    );
    packetWritten = true;

    if (updatePublic) {
      if (!packet.manifest.visual_review_complete
        || Number(packet.manifest.visual_verdict_counts.pending_visual_review || 0) > 0
        || Number(packet.manifest.visual_verdict_counts.broken || 0) > 0) {
        throw new Error(
          'Public PTO evidence was staged but not published: complete the hash-bound visual review and rerun --update-public',
        );
      }
      publishStagedEvidence(artifactDir, sourceTreeSha256);
      console.log(`PTO lifecycle public evidence updated atomically: ${harness.shots.length} reviewed screenshots.`);
      console.log(`Artifacts: ${path.relative(ROOT, publicArtifactDir).replace(/\\/g, '/')}`);
    } else {
      console.log(`PTO lifecycle mocked lane passed: ${harness.shots.length} action/result screenshots; ${result.coverage.length} coverage gates.`);
      console.log(`Artifacts: ${path.relative(ROOT, artifactDir).replace(/\\/g, '/')}`);
    }
  } catch (error) {
    if (harness.shots.length && !packetWritten) {
      try {
        writeReviewArtifacts(
          harness.shots,
          artifactDir,
          packetMetadata(result, sourceTreeSha256, {}),
        );
      } catch (_) {
        // Preserve the original browser/review failure. Screenshots remain in
        // private staging even if a partial manifest cannot be written.
      }
    }
    throw error;
  } finally {
    await harness.close();
  }
}

async function main() {
  if (validatePublic) {
    const result = validatePublicEvidence(publicArtifactDir, {
      sourceTreeSha256: sourceTreeFingerprint(),
      visualReviewFile,
    });
    console.log(`PTO public evidence passed without a browser: ${result.screenshotCount} reviewed screenshots; current source fingerprint and hashes match.`);
    return;
  }
  await runBrowserLane();
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
