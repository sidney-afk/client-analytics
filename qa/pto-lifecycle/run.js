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
const artifactDir = defaultArtifactDir;
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
if (updatePublic && headed) {
  throw new Error('--update-public publishes the already-reviewed private candidate and cannot be headed');
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

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sourceTreeFingerprint() {
  const files = [
    'index.html',
    'package.json',
    'supabase/functions/pto/policy.js',
    ...fs.readdirSync(path.join(ROOT, 'qa', 'pto-lifecycle'))
      .filter(file => /\.(?:js|json)$/.test(file) && file !== 'visual-review.json')
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

function reviewedCandidate(sourceTreeSha256) {
  const manifestFile = path.join(defaultArtifactDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error('No private PTO lifecycle candidate exists; run npm run test:pto-lifecycle first');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (_) {
    throw new Error('Private PTO lifecycle candidate manifest is invalid; rerun npm run test:pto-lifecycle');
  }
  if (manifest.source_tree_sha256 !== sourceTreeSha256) {
    throw new Error('Private PTO lifecycle candidate is stale for the current source; rerun npm run test:pto-lifecycle');
  }
  const flows = Array.isArray(manifest.flows) ? manifest.flows : [];
  const expectedFiles = new Set();
  const shots = [];
  for (const flow of flows) {
    if (!flow || typeof flow.scenario !== 'string' || !Array.isArray(flow.shots)) {
      throw new Error('Private PTO lifecycle candidate has an invalid flow inventory');
    }
    for (const shot of flow.shots) {
      const relative = String(shot && shot.file || '').replace(/\\/g, '/');
      const file = path.basename(relative);
      if (!/^[a-z0-9][a-z0-9.-]*\.jpg$/i.test(file)
        || relative !== `screenshots/${file}` || expectedFiles.has(file)) {
        throw new Error('Private PTO lifecycle candidate has an unsafe or duplicate screenshot path');
      }
      const full = path.join(defaultArtifactDir, 'screenshots', file);
      if (!fs.existsSync(full) || sha256(full) !== shot.sha256) {
        throw new Error(`Private PTO lifecycle candidate screenshot hash is invalid: ${file}`);
      }
      expectedFiles.add(file);
      shots.push({
        scenario: flow.scenario,
        step: shot.step,
        action: shot.action,
        expected: shot.expected_visible_result,
        persona: shot.persona,
        profile: shot.profile,
        viewport: shot.viewport,
        file,
        path: full,
        sha256: shot.sha256,
        verdict: 'pending_visual_review',
      });
    }
  }
  const actualFiles = fs.readdirSync(path.join(defaultArtifactDir, 'screenshots'))
    .filter(file => /\.jpg$/i.test(file)).sort();
  if (!shots.length || Number(manifest.screenshot_count) !== shots.length
    || actualFiles.length !== expectedFiles.size
    || actualFiles.some(file => !expectedFiles.has(file))) {
    throw new Error('Private PTO lifecycle candidate screenshot inventory is incomplete or contains extras');
  }
  return {
    shots,
    coverage: Array.isArray(manifest.coverage) ? manifest.coverage : [],
  };
}

function publishReviewedCandidate() {
  const sourceTreeSha256 = sourceTreeFingerprint();
  const candidate = reviewedCandidate(sourceTreeSha256);
  const verdicts = visualVerdicts();
  cleanPrivateDirectory(publicStageDir);
  const stagedScreenshots = path.join(publicStageDir, 'screenshots');
  fs.mkdirSync(stagedScreenshots, { recursive: true });
  const stagedShots = candidate.shots.map(shot => {
    const stagedPath = path.join(stagedScreenshots, shot.file);
    fs.copyFileSync(shot.path, stagedPath);
    return { ...shot, path: stagedPath };
  });
  const packet = writeReviewArtifacts(
    stagedShots,
    publicStageDir,
    packetMetadata({ coverage: candidate.coverage }, sourceTreeSha256, verdicts),
  );
  if (!packet.manifest.visual_review_complete
    || Number(packet.manifest.visual_verdict_counts.pending_visual_review || 0) > 0
    || Number(packet.manifest.visual_verdict_counts.broken || 0) > 0) {
    throw new Error(
      'Public PTO evidence was staged but not published: review every hash in the current private candidate',
    );
  }
  publishStagedEvidence(publicStageDir, sourceTreeSha256);
  console.log(`PTO lifecycle public evidence updated atomically: ${stagedShots.length} reviewed screenshots.`);
  console.log(`Artifacts: ${path.relative(ROOT, publicArtifactDir).replace(/\\/g, '/')}`);
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
    console.log(`PTO lifecycle mocked lane passed: ${harness.shots.length} action/result screenshots; ${result.coverage.length} coverage gates.`);
    console.log(`Artifacts: ${path.relative(ROOT, artifactDir).replace(/\\/g, '/')}`);
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
  if (updatePublic) {
    publishReviewedCandidate();
    return;
  }
  await runBrowserLane();
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
