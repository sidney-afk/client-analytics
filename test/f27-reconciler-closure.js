'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'f27-reconciler-closure.js');
const {
  EXPECTED_CLOSURE_PATHS,
  NONTERMINAL_STATUSES,
  WORKFLOW_API_ID,
  WORKFLOW_PATH,
  ReconcilerClosureError,
  gitChildEnvironment,
  githubChildEnvironment,
  unpackBundle,
  validateRecentRunWindow,
  verifyDisabled,
} = require('../scripts/f27-reconciler-closure');

const temporaryRoots = [];
let passed = 0;

function ok(condition, label) {
  assert.ok(condition, label);
  passed += 1;
}

function command(executable, args, cwd, options = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: options.encoding === null ? null : 'utf8',
    env: options.env || process.env,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (!options.allowFailure && (result.error || result.signal || result.status !== 0)) {
    throw new Error([
      `${executable} ${args.join(' ')} failed`,
      String(result.error && result.error.message || ''),
      String(result.stdout || ''),
      String(result.stderr || ''),
    ].join('\n'));
  }
  return result;
}

function git(repo, args, options = {}) {
  return command('git', args, repo, options);
}

function writeFile(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function commit(repo, message, updateOrigin = true) {
  git(repo, ['add', '--all']);
  git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-m', message]);
  const sha = git(repo, ['rev-parse', 'HEAD']).stdout.trim();
  if (updateOrigin) git(repo, ['update-ref', 'refs/remotes/origin/main', sha]);
  return sha;
}

function syntheticRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-f27-reconciler-test-'));
  temporaryRoots.push(tempRoot);
  const repo = path.join(tempRoot, 'repo');
  const privateDir = path.join(tempRoot, 'private');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(privateDir, { recursive: true });
  for (const relative of EXPECTED_CLOSURE_PATHS) {
    writeFile(
      path.join(repo, ...relative.split('/')),
      git(ROOT, ['show', `HEAD:${relative}`], { encoding: null }).stdout,
    );
  }
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'F27 Test']);
  git(repo, ['config', 'user.email', 'f27-test@example.invalid']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  const releaseSha = commit(repo, 'seed exact reconciler closure');
  return { tempRoot, repo, privateDir, releaseSha };
}

function terminal(result) {
  const stdout = String(result.stdout || '');
  const nonempty = stdout.split(/\r?\n/).filter(Boolean);
  assert.strictEqual(nonempty.length, 1, `expected one JSON terminal, received ${nonempty.length}`);
  let receipt;
  try {
    receipt = JSON.parse(nonempty[0]);
  } catch (error) {
    throw new Error(`terminal was not JSON: ${nonempty[0]}`);
  }
  return { receipt, stdout, stderr: String(result.stderr || '') };
}

function captureCli(fixture, bundleName, env = process.env) {
  const bundlePath = path.join(fixture.privateDir, bundleName);
  const result = command(process.execPath, [
    SCRIPT,
    'capture',
    `--release-sha=${fixture.releaseSha}`,
    `--bundle=${bundlePath}`,
  ], fixture.repo, { allowFailure: true, env });
  return { result, bundlePath, ...terminal(result) };
}

function zeroScan() {
  return Object.fromEntries(NONTERMINAL_STATUSES.map(status => [status, 0]));
}

function recentRunWindow() {
  return {
    total_count: 1,
    workflow_runs: [{
      id: 123,
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-07-30T00:00:00Z',
      updated_at: '2026-07-30T00:01:00Z',
    }],
  };
}

function githubAdapter(
  state,
  scans = [zeroScan(), zeroScan()],
  finalState = state,
  recentWindows = [recentRunWindow(), recentRunWindow()],
) {
  let scanIndex = 0;
  let workflowReadIndex = 0;
  let recentIndex = 0;
  const calls = [];
  return {
    calls,
    async readWorkflow() {
      calls.push('readWorkflow');
      const current = workflowReadIndex === 0 ? state : finalState;
      workflowReadIndex += 1;
      return { path: WORKFLOW_PATH, state: current };
    },
    async scanNonterminal() {
      calls.push('scanNonterminal');
      return scans[Math.min(scanIndex++, scans.length - 1)];
    },
    async readRecentRunWindow() {
      calls.push('readRecentRunWindow');
      return recentWindows[Math.min(recentIndex++, recentWindows.length - 1)];
    },
    async betweenScans() {
      calls.push('betweenScans');
    },
  };
}

function verifyOptions(fixture, captureReceipt, bundlePath, adapter) {
  return {
    repoRoot: fixture.repo,
    releaseSha: fixture.releaseSha,
    bundlePath,
    expectedBundleSha256: captureReceipt.sealed_bundle_sha256,
    expectedBundleByteLength: captureReceipt.sealed_bundle_byte_length,
    expectedClosureSha256: captureReceipt.prior_reconciler_closure_sha256,
    githubAdapter: adapter,
  };
}

async function rejectsCode(promiseFactory, code, label) {
  let caught = null;
  try {
    await promiseFactory();
  } catch (error) {
    caught = error;
  }
  ok(caught instanceof ReconcilerClosureError && caught.code === code,
    `${label}: expected ${code}, received ${caught && caught.code}`);
}

function replace(file, before, after) {
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes(before), `fixture replacement source missing: ${before}`);
  fs.writeFileSync(file, source.replace(before, after));
}

async function main() {
  try {
    const fixture = syntheticRepo();
    const first = captureCli(fixture, 'first.reconcilerbundle');
    ok(first.result.status === 0 && first.receipt.status === 'PASS'
      && first.receipt.operation === 'capture',
    'clean synthetic Git CLI capture passes');
    ok(first.stderr === '' && first.receipt.prior_reconciler_sha === fixture.releaseSha
      && /^[0-9a-f]{64}$/.test(first.receipt.prior_reconciler_closure_sha256)
      && /^[0-9a-f]{64}$/.test(first.receipt.sealed_bundle_sha256),
    'capture receipt is source-free hash provenance');
    // Nine until 2026-08-04, when the reconcile workflow began recording this
    // lane's heartbeat and running the dead-man's-switch check. That pulled
    // `monitoring-watchdog.js` and its `monitoring-alert-relay.js` dependency
    // into the reviewed closure. Both are read/alert only; neither reconciles,
    // applies, or touches a runtime flag or authority value.
    ok(first.receipt.reconciler_file_count === 11
      && first.receipt.rollback_action === 'keep_apply_disabled'
      && first.receipt.workflow_apply_default_false === 'PASS'
      && first.receipt.local_private_readback === 'PASS',
    'capture receipt binds the reviewed eleven-file disabled-action contract');
    const bundleRelative = path.relative(fixture.repo, first.bundlePath);
    ok(fs.existsSync(first.bundlePath)
      && (bundleRelative === '..' || bundleRelative.startsWith(`..${path.sep}`)),
    'sealed bundle is outside the Git worktree');

    const second = captureCli(fixture, 'second.reconcilerbundle');
    ok(second.result.status === 0
      && second.receipt.sealed_bundle_sha256 === first.receipt.sealed_bundle_sha256
      && second.receipt.sealed_bundle_byte_length === first.receipt.sealed_bundle_byte_length
      && fs.readFileSync(second.bundlePath).equals(fs.readFileSync(first.bundlePath)),
    'same release produces byte-identical deterministic sealed bundles');

    const unpacked = unpackBundle(fs.readFileSync(first.bundlePath));
    ok(unpacked.manifest.file_count === 11
      && JSON.stringify(unpacked.manifest.files.map(row => row.path))
        === JSON.stringify(EXPECTED_CLOSURE_PATHS)
      && unpacked.manifest.files.every(row =>
        /^[0-9a-f]{64}$/.test(row.sha256) && Number.isSafeInteger(row.byte_length)),
    'sealed manifest contains the exact sorted file inventory, lengths, and hashes');

    const disabledAdapter = githubAdapter('disabled_manually');
    const verified = await verifyDisabled(
      verifyOptions(fixture, first.receipt, first.bundlePath, disabledAdapter),
    );
    ok(verified.status === 'PASS'
      && verified.operation === 'verify-disabled'
      && verified.workflow_state === 'disabled_manually'
      && verified.nonterminal_scan_count === 2
      && verified.nonterminal_run_count === 0
      && verified.reconciler_apply_posture === 'DISABLED',
    'verify-disabled binds the bundle to manual disable plus two zero scans');
    ok(JSON.stringify(disabledAdapter.calls)
      === JSON.stringify([
        'readWorkflow',
        'readRecentRunWindow',
        'scanNonterminal',
        'betweenScans',
        'scanNonterminal',
        'readRecentRunWindow',
        'readWorkflow',
      ]),
    'verify-disabled bookends exactly two scans and stable recent-run windows with disabled-state observations');
    const sanitized = githubChildEnvironment({
      PATH: 'safe-path',
      SystemRoot: 'safe-system-root',
      ComSpec: 'safe-command-shell',
      GH_TOKEN: 'github-token',
      LANG: 'C',
      F27_DATABASE_URL: 'must-not-pass',
      SUPABASE_ACCESS_TOKEN: 'must-not-pass',
      N8N_API_KEY: 'must-not-pass',
      TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON: 'must-not-pass',
    });
    ok(sanitized.PATH === 'safe-path'
      && sanitized.SystemRoot === 'safe-system-root'
      && sanitized.ComSpec === 'safe-command-shell'
      && sanitized.GH_TOKEN === 'github-token'
      && sanitized.LANG === 'C'
      && sanitized.GH_PAGER === 'cat'
      && sanitized.PAGER === 'cat'
      && sanitized.NO_COLOR === '1'
      && !Object.keys(sanitized).some(key =>
        /F27_DATABASE_URL|SUPABASE|N8N|TRACK_B_BACKUP/.test(key)),
    'GitHub child environment allowlists auth/system/locale and strips production credentials');
    const sanitizedGit = gitChildEnvironment({
      PATH: 'safe-path',
      SystemRoot: 'safe-system-root',
      ComSpec: 'safe-command-shell',
      TEMP: 'safe-temp',
      F27_DATABASE_URL: 'must-not-pass',
      SUPABASE_ACCESS_TOKEN: 'must-not-pass',
      N8N_API_KEY: 'must-not-pass',
      TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON: 'must-not-pass',
    });
    ok(sanitizedGit.PATH === 'safe-path'
      && sanitizedGit.SystemRoot === 'safe-system-root'
      && sanitizedGit.ComSpec === 'safe-command-shell'
      && sanitizedGit.TEMP === 'safe-temp'
      && sanitizedGit.GIT_OPTIONAL_LOCKS === '0'
      && sanitizedGit.GIT_TERMINAL_PROMPT === '0'
      && !Object.keys(sanitizedGit).some(key =>
        /F27_DATABASE_URL|SUPABASE|N8N|TRACK_B_BACKUP/.test(key)),
    'Git child environment strips production credentials and disables prompts and optional locks');
    const operatorSource = fs.readFileSync(SCRIPT, 'utf8');
    ok(WORKFLOW_API_ID === 'linear-deliverables-reconcile.yml'
      && operatorSource.includes('actions/workflows/${WORKFLOW_API_ID}')
      && !operatorSource.includes('actions/workflows/${WORKFLOW_PATH}')
      && operatorSource.includes("? ['gh.exe']")
      && !operatorSource.includes("'gh.cmd'"),
    'GitHub REST calls use the filename identifier and Windows requires the native gh.exe');

    await rejectsCode(
      () => verifyDisabled(verifyOptions(
        fixture,
        first.receipt,
        first.bundlePath,
        githubAdapter('active'),
      )),
      'WORKFLOW_NOT_DISABLED',
      'active workflow with zero runs stays red',
    );

    const secondScanActive = zeroScan();
    secondScanActive.pending = 1;
    await rejectsCode(
      () => verifyDisabled(verifyOptions(
        fixture,
        first.receipt,
        first.bundlePath,
        githubAdapter('disabled_manually', [zeroScan(), secondScanActive]),
      )),
      'RECONCILER_RUN_ACTIVE',
      'one nonterminal status in either scan stays red',
    );

    await rejectsCode(
      () => verifyDisabled(verifyOptions(
        fixture,
        first.receipt,
        first.bundlePath,
        githubAdapter('disabled_manually', [zeroScan(), zeroScan()], 'active'),
      )),
      'WORKFLOW_NOT_DISABLED',
      'workflow re-enabled during the observation window stays red',
    );

    const changedWindow = recentRunWindow();
    changedWindow.workflow_runs[0].updated_at = '2026-07-30T00:02:00Z';
    await rejectsCode(
      () => verifyDisabled(verifyOptions(
        fixture,
        first.receipt,
        first.bundlePath,
        githubAdapter(
          'disabled_manually',
          [zeroScan(), zeroScan()],
          'disabled_manually',
          [recentRunWindow(), changedWindow],
        ),
      )),
      'GITHUB_RUN_WINDOW_NOT_QUIESCENT',
    'a run completion or metadata transition between observations stays red',
    );

    let partialWindowRejected = false;
    try {
      validateRecentRunWindow({
        total_count: 2,
        workflow_runs: recentRunWindow().workflow_runs,
      });
    } catch (error) {
      partialWindowRejected = error instanceof ReconcilerClosureError
        && error.code === 'GITHUB_RUN_WINDOW_INVALID';
    }
    ok(partialWindowRejected,
      'an unpaginated or partial workflow-run inventory stays red');

    const malformedScan = zeroScan();
    delete malformedScan.requested;
    await rejectsCode(
      () => verifyDisabled(verifyOptions(
        fixture,
        first.receipt,
        first.bundlePath,
        githubAdapter('disabled_manually', [malformedScan, malformedScan]),
      )),
      'GITHUB_RUN_SCAN_INVALID',
      'GitHub status-schema drift stays red',
    );

    await rejectsCode(
      () => verifyDisabled({
        ...verifyOptions(fixture, first.receipt, first.bundlePath, githubAdapter('disabled_manually')),
        expectedClosureSha256: '0'.repeat(64),
      }),
      'EXPECTED_CLOSURE_SHA256_MISMATCH',
      'wrong expected closure hash stays red',
    );

    const tamperedPath = path.join(fixture.privateDir, 'tampered.reconcilerbundle');
    const tampered = Buffer.from(fs.readFileSync(first.bundlePath));
    tampered[tampered.length - 1] ^= 0x01;
    fs.writeFileSync(tamperedPath, tampered);
    await rejectsCode(
      () => verifyDisabled(verifyOptions(
        fixture,
        first.receipt,
        tamperedPath,
        githubAdapter('disabled_manually'),
      )),
      'BUNDLE_SHA256_MISMATCH',
      'tampered sealed bundle stays red before GitHub reads',
    );

    const dirty = syntheticRepo();
    fs.appendFileSync(path.join(dirty.repo, 'scripts', 'f200-attribution.js'), '\n// dirty\n');
    const dirtyResult = captureCli(dirty, 'dirty.reconcilerbundle');
    ok(dirtyResult.result.status !== 0
      && dirtyResult.receipt.code === 'RELEASE_WORKTREE_DIRTY'
      && !fs.existsSync(dirtyResult.bundlePath),
    'dirty worktree fails before bundle creation');

    const mainMismatch = syntheticRepo();
    fs.appendFileSync(path.join(mainMismatch.repo, 'package.json'), '\n');
    mainMismatch.releaseSha = commit(mainMismatch.repo, 'advance HEAD without origin', false);
    const mainMismatchResult = captureCli(mainMismatch, 'main-mismatch.reconcilerbundle');
    ok(mainMismatchResult.result.status !== 0
      && mainMismatchResult.receipt.code === 'RELEASE_ORIGIN_MAIN_MISMATCH',
    'HEAD and origin/main mismatch fails closed');

    const missing = syntheticRepo();
    fs.rmSync(path.join(missing.repo, 'scripts', 'f200-attribution.js'));
    missing.releaseSha = commit(missing.repo, 'remove a transitive module');
    const missingResult = captureCli(missing, 'missing.reconcilerbundle');
    ok(missingResult.result.status !== 0
      && missingResult.receipt.code === 'GIT_BLOB_MISSING',
    'missing transitive Git blob fails closed');

    const unreviewedBlob = syntheticRepo();
    fs.appendFileSync(
      path.join(unreviewedBlob.repo, 'scripts', 'f200-attribution.js'),
      '\n// unreviewed runtime-byte drift\n',
    );
    unreviewedBlob.releaseSha = commit(unreviewedBlob.repo, 'seed unreviewed runtime byte');
    const unreviewedBlobResult = captureCli(
      unreviewedBlob,
      'unreviewed-blob.reconcilerbundle',
    );
    ok(unreviewedBlobResult.result.status !== 0
      && unreviewedBlobResult.receipt.code === 'REVIEWED_CLOSURE_BLOB_DRIFT'
      && !fs.existsSync(unreviewedBlobResult.bundlePath),
    'any unreviewed byte in the exact eleven-file runtime closure fails closed');

    const dynamic = syntheticRepo();
    replace(
      path.join(dynamic.repo, 'scripts', 'linear-deliverables-reconcile-lib.js'),
      "require('./f200-attribution')",
      "require(resolve('./f200-attribution'))",
    );
    dynamic.releaseSha = commit(dynamic.repo, 'seed dynamic dependency');
    const dynamicResult = captureCli(dynamic, 'dynamic.reconcilerbundle');
    ok(dynamicResult.result.status !== 0
      && dynamicResult.receipt.code === 'DYNAMIC_MODULE_SPECIFIER',
    'dynamic module specifier fails closed');

    const commentedLoader = syntheticRepo();
    fs.appendFileSync(
      path.join(commentedLoader.repo, 'scripts', 'f200-attribution.js'),
      "\nrequire /* comment */ ('./seeded-drift');\n",
    );
    writeFile(
      path.join(commentedLoader.repo, 'scripts', 'seeded-drift.js'),
      Buffer.from("'use strict';\nmodule.exports = {};\n", 'utf8'),
    );
    commentedLoader.releaseSha = commit(commentedLoader.repo, 'seed comment-obscured dependency');
    const commentedLoaderResult = captureCli(
      commentedLoader,
      'commented-loader.reconcilerbundle',
    );
    ok(commentedLoaderResult.result.status !== 0
      && commentedLoaderResult.receipt.code === 'DYNAMIC_MODULE_SPECIFIER'
      && !fs.existsSync(commentedLoaderResult.bundlePath),
    'comment-obscured valid require syntax fails closed instead of hiding a dependency');

    for (const computedLoader of [
      "globalThis[/* comment */'require']('./seeded-drift');",
      "require.main[/* comment */'require']('./seeded-drift');",
      "const hiddenModuleAlias = module; hiddenModuleAlias['requ' + 'ire']('./seeded-drift');",
      "const hiddenGlobalAlias = global; hiddenGlobalAlias['requ' + 'ire']('./seeded-drift');",
      "const hiddenWrapperRequire = arguments[1]; hiddenWrapperRequire('./seeded-drift');",
      "const hiddenApi = process['getBuiltin' + 'Module']('module'); const hiddenCr = hiddenApi['create' + 'Require'](__filename); hiddenCr('./seeded-drift');",
    ]) {
      const computed = syntheticRepo();
      fs.appendFileSync(
        path.join(computed.repo, 'scripts', 'f200-attribution.js'),
        `\n${computedLoader}\n`,
      );
      writeFile(
        path.join(computed.repo, 'scripts', 'seeded-drift.js'),
        Buffer.from("'use strict';\nmodule.exports = {};\n", 'utf8'),
      );
      computed.releaseSha = commit(computed.repo, 'seed computed dependency loader');
      const result = captureCli(computed, 'computed-loader.reconcilerbundle');
      ok(result.result.status !== 0
        && result.receipt.code === 'DYNAMIC_MODULE_SPECIFIER'
        && !fs.existsSync(result.bundlePath),
      `computed loader stays red: ${computedLoader.split('(')[0]}`);
    }

    const escaped = syntheticRepo();
    replace(
      path.join(escaped.repo, 'scripts', 'linear-deliverables-reconcile-lib.js'),
      "require('./f200-attribution')",
      "require('../../outside-repository')",
    );
    escaped.releaseSha = commit(escaped.repo, 'seed path escape');
    const escapedResult = captureCli(escaped, 'escaped.reconcilerbundle');
    ok(escapedResult.result.status !== 0
      && escapedResult.receipt.code === 'LOCAL_MODULE_PATH_ESCAPE',
    'repository-local dependency path escape fails closed');

    const seeded = syntheticRepo();
    fs.appendFileSync(
      path.join(seeded.repo, 'scripts', 'f200-attribution.js'),
      "\nrequire('./seeded-drift');\n",
    );
    writeFile(
      path.join(seeded.repo, 'scripts', 'seeded-drift.js'),
      Buffer.from("'use strict';\nmodule.exports = {};\n", 'utf8'),
    );
    seeded.releaseSha = commit(seeded.repo, 'seed a new transitive dependency');
    const seededFirst = captureCli(seeded, 'seeded-first.reconcilerbundle');
    const seededSecond = captureCli(seeded, 'seeded-second.reconcilerbundle');
    ok(seededFirst.result.status !== 0
      && seededSecond.result.status !== 0
      && seededFirst.receipt.code === 'CLOSURE_INVENTORY_DRIFT'
      && seededSecond.receipt.code === 'CLOSURE_INVENTORY_DRIFT'
      && !fs.existsSync(seededFirst.bundlePath)
      && !fs.existsSync(seededSecond.bundlePath),
    'new transitive dependency is red and remains red without changing the release');

    const applyTrue = syntheticRepo();
    replace(
      path.join(applyTrue.repo, ...WORKFLOW_PATH.split('/')),
      '        default: false',
      '        default: true',
    );
    applyTrue.releaseSha = commit(applyTrue.repo, 'make apply default unsafe');
    const applyTrueResult = captureCli(applyTrue, 'apply-true.reconcilerbundle');
    ok(applyTrueResult.result.status !== 0
      && applyTrueResult.receipt.code === 'WORKFLOW_APPLY_CONTRACT_MISMATCH',
    'workflow APPLY default true fails before bundle creation');

    const privateMarker = 'not-for-public-output-value';
    const hygiene = captureCli(dirty, `${privateMarker}.reconcilerbundle`, {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: privateMarker,
      GH_TOKEN: privateMarker,
    });
    const hygieneText = `${hygiene.stdout}${hygiene.stderr}`;
    ok(hygiene.result.status !== 0
      && hygiene.stdout.split(/\r?\n/).filter(Boolean).length === 1
      && !hygieneText.includes(privateMarker)
      && !hygieneText.includes(dirty.repo)
      && !/token|password|source bytes|row body/i.test(hygieneText),
    'failure terminal is one bounded public-safe JSON object');

    const successText = first.stdout;
    const allowedSuccessKeys = [
      'status',
      'operation',
      'prior_reconciler_sha',
      'prior_reconciler_closure_sha256',
      'sealed_bundle_sha256',
      'sealed_bundle_byte_length',
      'reconciler_file_count',
      'rollback_action',
      'workflow_apply_default_false',
      'local_private_readback',
    ].sort();
    ok(JSON.stringify(Object.keys(first.receipt).sort()) === JSON.stringify(allowedSuccessKeys)
      && !successText.includes(fixture.privateDir)
      && !successText.includes('scripts/')
      && !successText.includes('github.com'),
    'successful public receipt contains only the bounded approved fields');

    const bundleDigest = crypto.createHash('sha256')
      .update(fs.readFileSync(first.bundlePath)).digest('hex');
    ok(bundleDigest === first.receipt.sealed_bundle_sha256
      && fs.statSync(first.bundlePath).size === first.receipt.sealed_bundle_byte_length,
    'receipt bundle hash and byte length match independent local readback');

    console.log(`✓ f27 reconciler closure operator: ${passed} assertions passed`);
  } finally {
    for (const root of temporaryRoots.reverse()) {
      if (root.startsWith(path.join(os.tmpdir(), 'syncview-f27-reconciler-test-'))) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
