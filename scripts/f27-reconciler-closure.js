'use strict';

/*
 * Capture and verify the exact apply-capable Track-B reconciler closure used by
 * the F27 rollback manifest.
 *
 * Capture is repository-read-only and writes one deterministic sealed bundle
 * to an explicit private path outside every Git worktree:
 *
 *   node scripts/f27-reconciler-closure.js capture \
 *     --release-sha=<exact current origin/main SHA> \
 *     --bundle=<absolute new private bundle>
 *
 * verify-disabled is repository/GitHub-read-only. It never disables, enables,
 * cancels, reruns, or dispatches a workflow. The separately authorized
 * operator must first disable the workflow through the reviewed runbook:
 *
 *   node scripts/f27-reconciler-closure.js verify-disabled \
 *     --release-sha=<same exact SHA> \
 *     --bundle=<absolute private bundle> \
 *     --expected-bundle-sha256=<capture receipt> \
 *     --expected-bundle-byte-length=<capture receipt> \
 *     --expected-closure-sha256=<capture receipt>
 *
 * Both success and failure print exactly one bounded, public-safe JSON object.
 * Source bytes, paths outside the public repository, GitHub run identifiers,
 * credentials, and provider responses are never printed.
 */

const crypto = require('crypto');
const fs = require('fs');
const moduleApi = require('module');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKFLOW_PATH = '.github/workflows/linear-deliverables-reconcile.yml';
const WORKFLOW_API_ID = 'linear-deliverables-reconcile.yml';
const GITHUB_REPOSITORY = 'sidney-afk/client-analytics';
const ROLLBACK_ACTION = 'keep_apply_disabled';
const BUNDLE_SCHEMA = 'syncview-f27-reconciler-closure-v1';
const MAGIC = Buffer.from('SYNCVIEW_F27_RECONCILER_CLOSURE_V1\n', 'ascii');
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_WORKFLOW_RUN_INVENTORY = 100000;
const NONTERMINAL_STATUSES = Object.freeze([
  'queued',
  'in_progress',
  'waiting',
  'pending',
  'requested',
]);
const EXPECTED_WORKFLOW_ENTRYPOINTS = Object.freeze([
  'scripts/linear-deliverables-reconcile.js',
  'scripts/linear-reconcile-inbound-pager.js',
  // Added 2026-08-04. The reconcile workflow now also records this lane's
  // heartbeat and runs the dead-man's-switch check, so the workflow genuinely
  // runs a third entrypoint and the pinned inventory has to say so. It is
  // read/alert only: it never reconciles, never applies, and never touches a
  // runtime flag or authority value. Suppressing this drift by hosting the
  // heartbeat somewhere else would leave the reconciler lane unable to report
  // its own liveness, which is the failure this whole change exists to close.
  'scripts/monitoring-watchdog.js',
]);
const EXPECTED_CLOSURE_PATHS = Object.freeze([
  WORKFLOW_PATH,
  'package.json',
  'scripts/b3-linkage-backfill.js',
  'scripts/f200-attribution-plan.js',
  'scripts/f200-attribution.js',
  'scripts/linear-deliverables-reconcile-lib.js',
  'scripts/linear-deliverables-reconcile.js',
  'scripts/linear-reconcile-inbound-pager.js',
  // Entered the closure 2026-08-04: the pager now delivers through the shared
  // alert-relay client instead of its own `postSlack`. Reviewed as part of
  // that change — it performs no filesystem, process or child-process work,
  // reads only alert-relay environment variables, and its only side effect is
  // the outbound page it was always making inline.
  'scripts/monitoring-alert-relay.js',
  // Entered the closure 2026-08-04 with the heartbeat / dead-man's-switch
  // steps. Reads `deliverable_events` and writes only `_system` heartbeat and
  // latch rows; it holds no reconcile, apply, flag or authority path.
  'scripts/monitoring-watchdog.js',
  'scripts/prod-authority-guard.js',
].sort());
const REVIEWED_BLOB_SHA256 = Object.freeze({
  // Re-pinned 2026-08-04 with the monitoring-readiness change: the workflow
  // gained the heartbeat/dead-man steps and the n8n key for delivery receipts;
  // the pager moved to the shared relay client. Both blobs are re-reviewed.
  //
  // Re-pinned again 2026-08-05 for the attribution claim/provenance split. The
  // membership of the closure is UNCHANGED -- no file entered or left, no new
  // dependency, no new entrypoint. Three existing blobs moved:
  //   linear-deliverables-reconcile-lib.js  the comparison itself
  //   linear-deliverables-reconcile.js      the staleness banner + counters
  //   linear-reconcile-inbound-pager.js     the counter as context, not a class
  // Verify with, for each path:
  //   git show HEAD:<path> | sha256sum
  '.github/workflows/linear-deliverables-reconcile.yml':
    'f68282ca573ffce07ec53698b19498bfd6d6d84cdfcaf0f0c9a271bad9946681',
  'package.json':
    '3f0e7d8dd25a3954ab2107764f025613180568fde8ecbeb1d60080a7af7d8c62',
  'scripts/b3-linkage-backfill.js':
    '377b7d9cb98d09145e1060d6f8a3f0163f962299458b3f42a91105e88f2abe15',
  'scripts/f200-attribution-plan.js':
    'e7fa796b0ae9c8826740b9460b7d99c26f330146c26725c386e418d526e8717d',
  'scripts/f200-attribution.js':
    'b4854caa9fcd7d1e4efb26ea2fe4aadfac68a513e5cda8033b88619d2d641cdd',
  'scripts/linear-deliverables-reconcile-lib.js':
    '82217dc7ff03775493e7ac1a187c58a19a6c81ebc63e402272ffac9404359cb6',
  // Re-pinned 2026-08-05 on the rebase onto the monitoring-readiness and
  // attribution-split releases. Neither side's pin is correct after the merge:
  // main pinned d5abd3de (its own edits) and this branch pinned a8c19c4c (the
  // keyset reads), while the merged file carries BOTH sets of changes and
  // therefore hashes to a third value. Recomputed from the merged blob, not
  // chosen from either parent.
  'scripts/linear-deliverables-reconcile.js':
    '50696235e9deece290a16ba79b06a0eb0fe178b185bfc369ee0c123a8a17acce',
  'scripts/linear-reconcile-inbound-pager.js':
    '3113e68ab9aa63f150818bd86e1c20c3d53b061989c1efa438f146755b121e81',
  'scripts/monitoring-alert-relay.js':
    'dd35e38e88232085618144403e77571874aba5a004bc17fae5207671c4490388',
  'scripts/monitoring-watchdog.js':
    '6d71539f0364295f0b2556bb2d3e0b7fdb8692c1a4b91fdd72f003efee3ae5e9',
  'scripts/prod-authority-guard.js':
    '29c52944d4a88c0c7714c59e9cf1bb1781ad476129150512724a48a99a6cbaf6',
});
const HASH_ALGORITHM =
  'sha256(path-byte-length:path\\ncontent-byte-length:raw-git-blob-bytes\\n) over sorted paths';
const SHA_RE = /^[0-9a-f]{40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const SAFE_REPOSITORY_PATH_RE = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const BUILTINS = new Set(moduleApi.builtinModules.flatMap(name => [
  name,
  name.startsWith('node:') ? name.slice(5) : `node:${name}`,
]));
const DYNAMIC_CODE_BUILTINS = new Set([
  'child_process',
  'module',
  'vm',
  'worker_threads',
  'node:child_process',
  'node:module',
  'node:vm',
  'node:worker_threads',
]);

class ReconcilerClosureError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReconcilerClosureError';
    this.code = code;
  }
}

function fail(code) {
  throw new ReconcilerClosureError(code);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [
      key,
      canonicalValue(value[key]),
    ]));
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function uint32(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    fail('BUNDLE_LENGTH_INVALID');
  }
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value, 0);
  return output;
}

function uint64(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('BUNDLE_LENGTH_INVALID');
  const output = Buffer.alloc(8);
  output.writeBigUInt64BE(BigInt(value), 0);
  return output;
}

function readUint32(bytes, cursor) {
  if (cursor.offset + 4 > bytes.length) fail('BUNDLE_FORMAT_INVALID');
  const value = bytes.readUInt32BE(cursor.offset);
  cursor.offset += 4;
  return value;
}

function readUint64(bytes, cursor) {
  if (cursor.offset + 8 > bytes.length) fail('BUNDLE_FORMAT_INVALID');
  const value = bytes.readBigUInt64BE(cursor.offset);
  cursor.offset += 8;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('BUNDLE_LENGTH_INVALID');
  return Number(value);
}

function readSlice(bytes, cursor, length) {
  if (!Number.isSafeInteger(length) || length < 0 || cursor.offset + length > bytes.length) {
    fail('BUNDLE_FORMAT_INVALID');
  }
  const value = bytes.subarray(cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return value;
}

function normalizedFsPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function runProcess(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: null,
    env: options.env || process.env,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return result;
}

function gitChildEnvironment(baseEnv = process.env) {
  const output = {};
  const allowed = new Set([
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'ComSpec',
    'COMSPEC',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
  ]);
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (allowed.has(key) && value != null) output[key] = String(value);
  }
  output.GIT_OPTIONAL_LOCKS = '0';
  output.GIT_TERMINAL_PROMPT = '0';
  output.GIT_PAGER = 'cat';
  output.GIT_CONFIG_NOSYSTEM = '1';
  output.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return output;
}

function defaultGitAdapter(repoRoot) {
  const root = path.resolve(repoRoot);
  function invoke(args, optional = false) {
    const result = runProcess('git', args, {
      cwd: root,
      env: gitChildEnvironment(),
    });
    if (result.error || result.signal || result.status !== 0) {
      if (optional) return null;
      fail('GIT_COMMAND_FAILED');
    }
    return Buffer.from(result.stdout || Buffer.alloc(0));
  }
  return {
    text(args, optional = false) {
      const bytes = invoke(args, optional);
      return bytes === null ? null : bytes.toString('utf8').trim();
    },
    bytes(args, optional = false) {
      return invoke(args, optional);
    },
  };
}

function releaseProof(options) {
  const releaseSha = clean(options.releaseSha);
  if (!SHA_RE.test(releaseSha)) fail('RELEASE_SHA_INVALID');
  const git = options.gitAdapter || defaultGitAdapter(options.repoRoot);
  const head = clean(git.text(['rev-parse', 'HEAD']));
  if (head !== releaseSha) fail('RELEASE_HEAD_MISMATCH');
  const originMain = clean(git.text(['rev-parse', 'refs/remotes/origin/main']));
  if (originMain !== releaseSha) fail('RELEASE_ORIGIN_MAIN_MISMATCH');
  const type = clean(git.text(['cat-file', '-t', `${releaseSha}^{commit}`]));
  if (type !== 'commit') fail('RELEASE_COMMIT_INVALID');
  const dirty = git.text(['status', '--porcelain=v1', '--untracked-files=all']);
  if (dirty !== '') fail('RELEASE_WORKTREE_DIRTY');
  return { releaseSha, git };
}

function safeRepositoryPath(value) {
  const candidate = clean(value).replace(/\\/g, '/');
  if (!candidate
      || candidate.startsWith('/')
      || /^[A-Za-z]:/.test(candidate)
      || candidate.split('/').some(part => part === '' || part === '.' || part === '..')
      || !SAFE_REPOSITORY_PATH_RE.test(candidate)) {
    fail('REPOSITORY_PATH_INVALID');
  }
  return candidate;
}

function gitBlob(git, releaseSha, repositoryPath, optional = false) {
  const file = safeRepositoryPath(repositoryPath);
  const tree = git.text(['ls-tree', releaseSha, '--', file], optional);
  if (tree === null || tree === '') {
    if (optional) return null;
    fail('GIT_BLOB_MISSING');
  }
  const match = tree.match(/^([0-9]{6})\s+(\S+)\s+([0-9a-f]+)\t(.+)$/);
  if (!match || match[2] !== 'blob' || !['100644', '100755'].includes(match[1])
      || match[4].replace(/\\/g, '/') !== file) {
    fail('GIT_BLOB_TYPE_INVALID');
  }
  const bytes = git.bytes(['show', `${releaseSha}:${file}`], optional);
  if (bytes === null) {
    if (optional) return null;
    fail('GIT_BLOB_MISSING');
  }
  return Buffer.from(bytes);
}

function workflowContract(bytes) {
  const source = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
  const applyBlock = source.match(
    /^ {6}apply:\s*\r?\n((?:^ {8,}.*\r?\n?)*)/m,
  );
  if (!applyBlock
      || !/^ {8}type:\s*boolean\s*$/m.test(applyBlock[1])
      || !/^ {8}default:\s*false\s*$/m.test(applyBlock[1])
      || /^ {8}default:\s*true\s*$/m.test(applyBlock[1])) {
    fail('WORKFLOW_APPLY_CONTRACT_MISMATCH');
  }
  if (!/^ {6}APPLY:\s*\$\{\{\s*github\.event\.inputs\.apply\s*==\s*['"]true['"]\s*\}\}\s*$/m
    .test(source)) {
    fail('WORKFLOW_APPLY_CONTRACT_MISMATCH');
  }
  if (!/^\s+node-version:\s*['"]?22['"]?\s*$/m.test(source)) {
    fail('WORKFLOW_NODE_RUNTIME_MISMATCH');
  }
  if (/^\s+uses:\s*\.\//m.test(source)) fail('WORKFLOW_LOCAL_ACTION_UNSUPPORTED');

  const entrypoints = new Set();
  const nodeTokens = [...source.matchAll(/\bnode[ \t]+([^\s]+)/g)];
  if (!nodeTokens.length) fail('WORKFLOW_ENTRYPOINT_MISSING');
  for (const match of nodeTokens) {
    const token = String(match[1] || '').replace(/^['"]|['"]$/g, '');
    if (!/^scripts\/[A-Za-z0-9._/-]+\.js$/.test(token)) {
      fail('WORKFLOW_DYNAMIC_ENTRYPOINT_UNSUPPORTED');
    }
    entrypoints.add(safeRepositoryPath(token));
  }
  const actual = [...entrypoints].sort();
  if (JSON.stringify(actual) !== JSON.stringify([...EXPECTED_WORKFLOW_ENTRYPOINTS].sort())) {
    fail('WORKFLOW_ENTRYPOINT_INVENTORY_DRIFT');
  }
  return {
    applyDefaultFalse: true,
    nodeMajor: '22',
    entrypoints: actual,
  };
}

function packageContract(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (_) {
    fail('PACKAGE_MANIFEST_INVALID');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('PACKAGE_MANIFEST_INVALID');
  }
  if (manifest.type !== undefined && manifest.type !== 'commonjs') {
    fail('PACKAGE_MODULE_MODE_MISMATCH');
  }
  return { moduleMode: 'commonjs' };
}

function maskCommentsAndStrings(source) {
  const output = [...source];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '/' && next === '/') {
      output[index] = ' ';
      output[index + 1] = ' ';
      index += 2;
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
        output[index] = ' ';
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      output[index] = ' ';
      output[index + 1] = ' ';
      index += 2;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          output[index] = ' ';
          output[index + 1] = ' ';
          index += 2;
          closed = true;
          break;
        }
        if (source[index] !== '\n' && source[index] !== '\r') output[index] = ' ';
        index += 1;
      }
      if (!closed) fail('DYNAMIC_MODULE_SPECIFIER');
      continue;
    }
    if (character === "'" || character === '"') {
      const quote = character;
      output[index] = ' ';
      index += 1;
      let closed = false;
      while (index < source.length) {
        const value = source[index];
        if (value === '\\') {
          output[index] = ' ';
          if (index + 1 < source.length
              && source[index + 1] !== '\n' && source[index + 1] !== '\r') {
            output[index + 1] = ' ';
          }
          index += 2;
          continue;
        }
        if (value === quote) {
          output[index] = ' ';
          index += 1;
          closed = true;
          break;
        }
        if (value !== '\n' && value !== '\r') output[index] = ' ';
        index += 1;
      }
      if (!closed) fail('DYNAMIC_MODULE_SPECIFIER');
      continue;
    }
    if (character === '`') {
      const start = index;
      output[index] = ' ';
      index += 1;
      let closed = false;
      while (index < source.length) {
        const value = source[index];
        if (value === '\\') {
          output[index] = ' ';
          if (index + 1 < source.length
              && source[index + 1] !== '\n' && source[index + 1] !== '\r') {
            output[index + 1] = ' ';
          }
          index += 2;
          continue;
        }
        if (value === '`') {
          output[index] = ' ';
          index += 1;
          closed = true;
          break;
        }
        if (value !== '\n' && value !== '\r') output[index] = ' ';
        index += 1;
      }
      if (!closed
          || /\b(?:require|import|createRequire|getBuiltinModule|eval|Function)\b/
            .test(source.slice(start, index))) {
        fail('DYNAMIC_MODULE_SPECIFIER');
      }
      continue;
    }
    index += 1;
  }
  return output.join('');
}

function literalCallSpecifiers(source, code, callee) {
  const specifiers = [];
  const invocationCount = [...code.matchAll(new RegExp(`\\b${callee}\\s*\\(`, 'g'))].length;
  const pattern = new RegExp(`\\b${callee}\\s*\\(([^()\\r\\n]*)\\)`, 'g');
  let match;
  while ((match = pattern.exec(source))) {
    const expression = clean(match[1]);
    const literal = expression.match(/^(['"])([^'"]+)\1$/);
    if (!literal) fail('DYNAMIC_MODULE_SPECIFIER');
    specifiers.push(literal[2]);
  }
  if (specifiers.length !== invocationCount) fail('DYNAMIC_MODULE_SPECIFIER');
  return specifiers;
}

function moduleSpecifiers(bytes) {
  const source = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
  const code = maskCommentsAndStrings(source);
  if (/[A-Za-z_$][A-Za-z0-9_$]*\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})/
      .test(code)
      || /\b(?:createRequire|getBuiltinModule|eval|Function)\b/.test(code)
      || /\bprocess\s*\.\s*mainModule\b/.test(code)
      || /\.\s*constructor\b/.test(code)
      || /\bprocess\s*\.\s*(?:binding|_linkedBinding|dlopen|getBuiltinModule)\b/.test(code)
      || /\bReflect\s*\.\s*(?:get|apply)\b/.test(code)
      || /\b_?load\b/.test(code)
      || /\b(?:global|globalThis|module|process|require\s*\.\s*main)\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$)|\s)*\[/
        .test(source)
      || /\[(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$)|\s)*(['"])require\1(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$)|\s)*\]/
        .test(source)) {
    fail('DYNAMIC_MODULE_SPECIFIER');
  }
  const requireSpecifiers = literalCallSpecifiers(source, code, 'require');
  const importSpecifiers = literalCallSpecifiers(source, code, 'import');
  const requireTokens = [...code.matchAll(/\brequire\b/g)].length;
  const requireMainGuards =
    [...code.matchAll(/\brequire\s*\.\s*main\s*===\s*module\b/g)].length;
  const importTokens = [...code.matchAll(/\bimport\b/g)].length;
  const moduleTokens = [...code.matchAll(/\bmodule\b/g)].length;
  const moduleExportAssignments =
    [...code.matchAll(/\bmodule\s*\.\s*exports\s*=/g)].length;
  const globalTokens = [...code.matchAll(/\bglobal\b/g)].length;
  const globalFetchTokens = [...code.matchAll(/\bglobal\s*\.\s*fetch\b/g)].length;
  const globalThisTokens = [...code.matchAll(/\bglobalThis\b/g)].length;
  const commonJsArgumentsTokens = [...code.matchAll(/\barguments\b/g)].length;
  const processTokens = [...code.matchAll(/\bprocess\b/g)].length;
  const reviewedProcessPropertyTokens =
    [...code.matchAll(/\bprocess\s*\.\s*(?:argv|env|exit|stdout|pid)\b/g)].length;
  if (requireTokens !== requireSpecifiers.length + requireMainGuards
      || importTokens !== importSpecifiers.length
      || moduleTokens !== moduleExportAssignments + requireMainGuards
      || globalTokens !== globalFetchTokens
      || globalThisTokens !== 0
      || commonJsArgumentsTokens !== 0
      || processTokens !== reviewedProcessPropertyTokens) {
    fail('DYNAMIC_MODULE_SPECIFIER');
  }
  const specifiers = [...requireSpecifiers, ...importSpecifiers];

  for (const specifier of specifiers) {
    if (DYNAMIC_CODE_BUILTINS.has(specifier)) {
      fail('DYNAMIC_MODULE_SPECIFIER');
    }
    if (!specifier.startsWith('.') && !BUILTINS.has(specifier)) {
      fail('EXTERNAL_RUNTIME_DEPENDENCY_UNSEALED');
    }
  }
  return [...new Set(specifiers)];
}

function resolveLocalSpecifier(git, releaseSha, importer, rawSpecifier) {
  const specifier = clean(rawSpecifier).split(/[?#]/, 1)[0].replace(/\\/g, '/');
  if (!specifier.startsWith('.')) return null;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  if (!joined || joined === '..' || joined.startsWith('../') || path.posix.isAbsolute(joined)) {
    fail('LOCAL_MODULE_PATH_ESCAPE');
  }
  const candidates = path.posix.extname(joined)
    ? [joined]
    : [`${joined}.js`, `${joined}/index.js`];
  for (const candidate of candidates) {
    const safe = safeRepositoryPath(candidate);
    if (gitBlob(git, releaseSha, safe, true) !== null) return safe;
  }
  fail('GIT_BLOB_MISSING');
}

function closureFingerprint(files) {
  const hash = crypto.createHash('sha256');
  for (const [file, content] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = Buffer.from(content);
    hash.update(`${Buffer.byteLength(file, 'utf8')}:`);
    hash.update(file, 'utf8');
    hash.update(`\n${bytes.length}:`);
    hash.update(bytes);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function exactClosure(options) {
  const proof = releaseProof(options);
  const workflowBytes = gitBlob(proof.git, proof.releaseSha, WORKFLOW_PATH);
  const packageBytes = gitBlob(proof.git, proof.releaseSha, 'package.json');
  const workflow = workflowContract(workflowBytes);
  const packageInfo = packageContract(packageBytes);
  const files = new Map([
    [WORKFLOW_PATH, workflowBytes],
    ['package.json', packageBytes],
  ]);
  const pending = [...workflow.entrypoints];
  while (pending.length) {
    const current = pending.shift();
    if (files.has(current)) continue;
    const bytes = gitBlob(proof.git, proof.releaseSha, current);
    files.set(current, bytes);
    for (const specifier of moduleSpecifiers(bytes)) {
      const dependency = resolveLocalSpecifier(
        proof.git,
        proof.releaseSha,
        current,
        specifier,
      );
      if (dependency && !files.has(dependency) && !pending.includes(dependency)) {
        pending.push(dependency);
      }
    }
  }
  const inventory = [...files.keys()].sort();
  if (JSON.stringify(inventory) !== JSON.stringify(EXPECTED_CLOSURE_PATHS)) {
    fail('CLOSURE_INVENTORY_DRIFT');
  }
  for (const file of inventory) {
    if (sha256(files.get(file)) !== REVIEWED_BLOB_SHA256[file]) {
      fail('REVIEWED_CLOSURE_BLOB_DRIFT');
    }
  }
  const closureSha256 = closureFingerprint(files);
  const fileRows = inventory.map(file => {
    const bytes = files.get(file);
    return {
      path: file,
      byte_length: bytes.length,
      sha256: sha256(bytes),
    };
  });
  return {
    releaseSha: proof.releaseSha,
    git: proof.git,
    files,
    fileRows,
    closureSha256,
    workflow,
    packageInfo,
  };
}

function discoverWorktrees(git) {
  const output = git.bytes(['worktree', 'list', '--porcelain', '-z']).toString('utf8');
  const roots = [];
  for (const token of output.split('\0')) {
    if (token.startsWith('worktree ')) roots.push(path.resolve(token.slice('worktree '.length)));
  }
  if (!roots.length) fail('WORKTREE_DISCOVERY_FAILED');
  return roots;
}

function assertPrivateBundleTarget(bundlePath, worktreeRoots, operation) {
  const value = clean(bundlePath);
  if (!value || !path.isAbsolute(value)) fail('BUNDLE_PATH_MUST_BE_ABSOLUTE');
  const target = path.resolve(value);
  const parent = path.dirname(target);
  let parentStat;
  try {
    parentStat = fs.lstatSync(parent);
  } catch (_) {
    fail('BUNDLE_PARENT_MISSING');
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    fail('BUNDLE_PARENT_INVALID');
  }
  let realParent;
  try {
    realParent = fs.realpathSync(parent);
  } catch (_) {
    fail('BUNDLE_PARENT_INVALID');
  }
  if (normalizedFsPath(realParent) !== normalizedFsPath(parent)) {
    fail('BUNDLE_PARENT_SYMLINK');
  }
  const canonical = path.join(realParent, path.basename(target));
  for (const root of worktreeRoots) {
    let realRoot;
    try {
      realRoot = fs.realpathSync(root);
    } catch (_) {
      fail('WORKTREE_DISCOVERY_FAILED');
    }
    if (isInside(normalizedFsPath(realRoot), normalizedFsPath(canonical))) {
      fail('BUNDLE_INSIDE_WORKTREE');
    }
  }
  if (operation === 'capture') {
    if (fs.existsSync(canonical)) fail('BUNDLE_DESTINATION_EXISTS');
  } else {
    let stat;
    try {
      stat = fs.lstatSync(canonical);
    } catch (_) {
      fail('BUNDLE_MISSING');
    }
    if (!stat.isFile() || stat.isSymbolicLink()) fail('BUNDLE_FILE_INVALID');
  }
  return canonical;
}

function manifestForClosure(closure) {
  return {
    schema: BUNDLE_SCHEMA,
    artifact_kind: 'f27-apply-capable-reconciler-closure',
    prior_reconciler_sha: closure.releaseSha,
    workflow_path: WORKFLOW_PATH,
    workflow_apply_default_false: true,
    node_major: closure.workflow.nodeMajor,
    package_module_mode: closure.packageInfo.moduleMode,
    rollback_action: ROLLBACK_ACTION,
    closure_algorithm: HASH_ALGORITHM,
    prior_reconciler_closure_sha256: closure.closureSha256,
    file_count: closure.fileRows.length,
    files: closure.fileRows,
  };
}

function packBundle(manifest, files) {
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  const entries = [...files.entries()].sort(([a], [b]) => a.localeCompare(b));
  const chunks = [
    MAGIC,
    uint64(manifestBytes.length),
    manifestBytes,
    uint32(entries.length),
  ];
  for (const [file, content] of entries) {
    const fileBytes = Buffer.from(file, 'utf8');
    const sourceBytes = Buffer.from(content);
    chunks.push(
      uint32(fileBytes.length),
      fileBytes,
      uint64(sourceBytes.length),
      sourceBytes,
    );
  }
  const bundle = Buffer.concat(chunks);
  if (bundle.length > MAX_BUNDLE_BYTES) fail('BUNDLE_TOO_LARGE');
  return bundle;
}

function unpackBundle(bundleBytes) {
  const bytes = Buffer.from(bundleBytes);
  if (bytes.length > MAX_BUNDLE_BYTES || bytes.length < MAGIC.length + 12) {
    fail('BUNDLE_FORMAT_INVALID');
  }
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) fail('BUNDLE_FORMAT_INVALID');
  const cursor = { offset: MAGIC.length };
  const manifestLength = readUint64(bytes, cursor);
  const manifestBytes = readSlice(bytes, cursor, manifestLength);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (_) {
    fail('BUNDLE_MANIFEST_INVALID');
  }
  if (!Buffer.from(canonicalJson(manifest), 'utf8').equals(manifestBytes)) {
    fail('BUNDLE_MANIFEST_NOT_CANONICAL');
  }
  const count = readUint32(bytes, cursor);
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    const fileLength = readUint32(bytes, cursor);
    const file = readSlice(bytes, cursor, fileLength).toString('utf8');
    const safe = safeRepositoryPath(file);
    if (safe !== file || files.has(file)) fail('BUNDLE_FILE_INVENTORY_INVALID');
    const sourceLength = readUint64(bytes, cursor);
    files.set(file, Buffer.from(readSlice(bytes, cursor, sourceLength)));
  }
  if (cursor.offset !== bytes.length) fail('BUNDLE_TRAILING_BYTES');
  validateBundleManifest(manifest, files);
  return { manifest, files, manifestBytes };
}

function validateBundleManifest(manifest, files) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || manifest.schema !== BUNDLE_SCHEMA
      || manifest.artifact_kind !== 'f27-apply-capable-reconciler-closure'
      || !SHA_RE.test(clean(manifest.prior_reconciler_sha))
      || manifest.workflow_path !== WORKFLOW_PATH
      || manifest.workflow_apply_default_false !== true
      || manifest.node_major !== '22'
      || manifest.package_module_mode !== 'commonjs'
      || manifest.rollback_action !== ROLLBACK_ACTION
      || manifest.closure_algorithm !== HASH_ALGORITHM
      || !HASH_RE.test(clean(manifest.prior_reconciler_closure_sha256))
      || manifest.file_count !== EXPECTED_CLOSURE_PATHS.length
      || !Array.isArray(manifest.files)
      || manifest.files.length !== EXPECTED_CLOSURE_PATHS.length
      || files.size !== EXPECTED_CLOSURE_PATHS.length) {
    fail('BUNDLE_MANIFEST_INVALID');
  }
  const paths = [...files.keys()].sort();
  if (JSON.stringify(paths) !== JSON.stringify(EXPECTED_CLOSURE_PATHS)) {
    fail('BUNDLE_FILE_INVENTORY_INVALID');
  }
  const manifestPaths = manifest.files.map(row => row && row.path);
  if (JSON.stringify(manifestPaths) !== JSON.stringify(EXPECTED_CLOSURE_PATHS)) {
    fail('BUNDLE_FILE_INVENTORY_INVALID');
  }
  for (let index = 0; index < EXPECTED_CLOSURE_PATHS.length; index++) {
    const file = EXPECTED_CLOSURE_PATHS[index];
    const row = manifest.files[index];
    const content = files.get(file);
    if (!row
        || row.path !== file
        || row.byte_length !== content.length
        || row.sha256 !== sha256(content)) {
      fail('BUNDLE_FILE_HASH_MISMATCH');
    }
  }
  if (closureFingerprint(files) !== manifest.prior_reconciler_closure_sha256) {
    fail('BUNDLE_CLOSURE_HASH_MISMATCH');
  }
  workflowContract(files.get(WORKFLOW_PATH));
  packageContract(files.get('package.json'));
}

function expectedHash(value, code) {
  const hash = clean(value);
  if (!HASH_RE.test(hash)) fail(code);
  return hash;
}

function expectedLength(value) {
  const text = clean(value);
  if (!/^[1-9][0-9]{0,8}$/.test(text)) fail('EXPECTED_BUNDLE_BYTE_LENGTH_INVALID');
  const length = Number(text);
  if (!Number.isSafeInteger(length) || length > MAX_BUNDLE_BYTES) {
    fail('EXPECTED_BUNDLE_BYTE_LENGTH_INVALID');
  }
  return length;
}

function readAndVerifyBundle(options, git) {
  const roots = discoverWorktrees(git);
  const bundlePath = assertPrivateBundleTarget(options.bundlePath, roots, 'read');
  const expectedBundleHash = expectedHash(
    options.expectedBundleSha256,
    'EXPECTED_BUNDLE_SHA256_INVALID',
  );
  const expectedBundleLength = expectedLength(options.expectedBundleByteLength);
  let first;
  let second;
  try {
    first = fs.readFileSync(bundlePath);
    second = fs.readFileSync(bundlePath);
  } catch (_) {
    fail('BUNDLE_READ_FAILED');
  }
  if (!first.equals(second)) fail('BUNDLE_PRIVATE_READBACK_MISMATCH');
  if (first.length !== expectedBundleLength) fail('BUNDLE_BYTE_LENGTH_MISMATCH');
  if (sha256(first) !== expectedBundleHash) fail('BUNDLE_SHA256_MISMATCH');
  const unpacked = unpackBundle(first);
  return {
    ...unpacked,
    bundleSha256: expectedBundleHash,
    bundleByteLength: expectedBundleLength,
  };
}

function capture(options) {
  const closure = exactClosure(options);
  const roots = discoverWorktrees(closure.git);
  const destination = assertPrivateBundleTarget(options.bundlePath, roots, 'capture');
  const manifest = manifestForClosure(closure);
  const bundleBytes = packBundle(manifest, closure.files);
  try {
    fs.writeFileSync(destination, bundleBytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error && error.code === 'EEXIST') fail('BUNDLE_DESTINATION_EXISTS');
    fail('BUNDLE_WRITE_FAILED');
  }
  const bundleSha256 = sha256(bundleBytes);
  const verified = readAndVerifyBundle({
    bundlePath: destination,
    expectedBundleSha256: bundleSha256,
    expectedBundleByteLength: bundleBytes.length,
  }, closure.git);
  if (verified.manifest.prior_reconciler_sha !== closure.releaseSha
      || verified.manifest.prior_reconciler_closure_sha256 !== closure.closureSha256) {
    fail('BUNDLE_PRIVATE_READBACK_MISMATCH');
  }
  return {
    status: 'PASS',
    operation: 'capture',
    prior_reconciler_sha: closure.releaseSha,
    prior_reconciler_closure_sha256: closure.closureSha256,
    sealed_bundle_sha256: bundleSha256,
    sealed_bundle_byte_length: bundleBytes.length,
    reconciler_file_count: closure.fileRows.length,
    rollback_action: ROLLBACK_ACTION,
    workflow_apply_default_false: 'PASS',
    local_private_readback: 'PASS',
  };
}

function resolveGhExecutable() {
  return process.platform === 'win32'
    ? ['gh.exe']
    : ['gh'];
}

function githubChildEnvironment(baseEnv = process.env) {
  const output = {};
  const allowed = new Set([
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'ComSpec',
    'COMSPEC',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
  ]);
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (allowed.has(key) && value != null) output[key] = String(value);
  }
  output.GH_PAGER = 'cat';
  output.PAGER = 'cat';
  output.NO_COLOR = '1';
  return output;
}

function ghJson(args) {
  let result = null;
  for (const executable of resolveGhExecutable()) {
    result = runProcess(executable, args, {
      env: githubChildEnvironment(),
    });
    if (!(result.error && result.error.code === 'ENOENT')) break;
  }
  if (!result || result.error || result.signal || result.status !== 0) {
    fail('GITHUB_READ_FAILED');
  }
  try {
    return JSON.parse(Buffer.from(result.stdout || Buffer.alloc(0)).toString('utf8'));
  } catch (_) {
    fail('GITHUB_RESPONSE_INVALID');
  }
}

function defaultGitHubAdapter() {
  return {
    async readWorkflow() {
      return ghJson([
        'api',
        `repos/${GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW_API_ID}`,
      ]);
    },
    async scanNonterminal() {
      const counts = {};
      for (const status of NONTERMINAL_STATUSES) {
        const response = ghJson([
          'api',
          `repos/${GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW_API_ID}`
            + `/runs?status=${status}&per_page=1`,
        ]);
        counts[status] = response && response.total_count;
      }
      return counts;
    },
    async readRecentRunWindow() {
      const workflowRuns = [];
      let totalCount = null;
      for (let page = 1; page <= 1000; page += 1) {
        const response = ghJson([
          'api',
          `repos/${GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW_API_ID}`
            + `/runs?per_page=100&page=${page}`,
        ]);
        if (!response || !Number.isSafeInteger(response.total_count)
            || response.total_count < 0
            || response.total_count > MAX_WORKFLOW_RUN_INVENTORY
            || !Array.isArray(response.workflow_runs)
            || response.workflow_runs.length > 100
            || (totalCount !== null && response.total_count !== totalCount)) {
          fail('GITHUB_RUN_WINDOW_INVALID');
        }
        totalCount = response.total_count;
        workflowRuns.push(...response.workflow_runs);
        if (workflowRuns.length >= totalCount) break;
        if (response.workflow_runs.length !== 100) fail('GITHUB_RUN_WINDOW_INVALID');
      }
      if (totalCount === null || workflowRuns.length !== totalCount) {
        fail('GITHUB_RUN_WINDOW_INVALID');
      }
      return { total_count: totalCount, workflow_runs: workflowRuns };
    },
    async betweenScans() {
      await new Promise(resolve => setTimeout(resolve, 2000));
    },
  };
}

function validateRunScan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...NONTERMINAL_STATUSES].sort())) {
    fail('GITHUB_RUN_SCAN_INVALID');
  }
  let total = 0;
  for (const status of NONTERMINAL_STATUSES) {
    const count = value[status];
    if (!Number.isSafeInteger(count) || count < 0) fail('GITHUB_RUN_SCAN_INVALID');
    total += count;
  }
  if (!Number.isSafeInteger(total)) fail('GITHUB_RUN_SCAN_INVALID');
  return total;
}

function validateRecentRunWindow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Number.isSafeInteger(value.total_count) || value.total_count < 0
      || value.total_count > MAX_WORKFLOW_RUN_INVENTORY
      || !Array.isArray(value.workflow_runs)
      || value.workflow_runs.length !== value.total_count) {
    fail('GITHUB_RUN_WINDOW_INVALID');
  }
  const seen = new Set();
  const rows = value.workflow_runs.map(run => {
    const id = clean(run && run.id);
    const status = clean(run && run.status);
    const conclusion = clean(run && run.conclusion);
    const createdAt = clean(run && run.created_at);
    const updatedAt = clean(run && run.updated_at);
    if (!/^[1-9][0-9]*$/.test(id) || seen.has(id)
        || status !== 'completed' || !conclusion
        || !/^\d{4}-\d{2}-\d{2}T/.test(createdAt)
        || !/^\d{4}-\d{2}-\d{2}T/.test(updatedAt)) {
      fail('GITHUB_RUN_WINDOW_NOT_QUIESCENT');
    }
    seen.add(id);
    return { id, status, conclusion, created_at: createdAt, updated_at: updatedAt };
  });
  return rows;
}

async function verifyDisabled(options) {
  const closure = exactClosure(options);
  const expectedClosure = expectedHash(
    options.expectedClosureSha256,
    'EXPECTED_CLOSURE_SHA256_INVALID',
  );
  if (closure.closureSha256 !== expectedClosure) fail('EXPECTED_CLOSURE_SHA256_MISMATCH');
  const bundle = readAndVerifyBundle(options, closure.git);
  if (bundle.manifest.prior_reconciler_sha !== closure.releaseSha
      || bundle.manifest.prior_reconciler_closure_sha256 !== closure.closureSha256
      || bundle.manifest.rollback_action !== ROLLBACK_ACTION
      || bundle.manifest.workflow_apply_default_false !== true) {
    fail('BUNDLE_RELEASE_BINDING_MISMATCH');
  }

  const github = options.githubAdapter || defaultGitHubAdapter();
  if (!github
      || typeof github.readWorkflow !== 'function'
      || typeof github.scanNonterminal !== 'function'
      || typeof github.readRecentRunWindow !== 'function') {
    fail('GITHUB_ADAPTER_INVALID');
  }
  let workflowBefore;
  let workflowAfter;
  try {
    workflowBefore = await github.readWorkflow();
  } catch (error) {
    if (error instanceof ReconcilerClosureError) throw error;
    fail('GITHUB_READ_FAILED');
  }
  if (!workflowBefore || typeof workflowBefore !== 'object' || Array.isArray(workflowBefore)
      || workflowBefore.path !== WORKFLOW_PATH
      || workflowBefore.state !== 'disabled_manually') {
    fail('WORKFLOW_NOT_DISABLED');
  }

  let first;
  let second;
  let recentBefore;
  let recentAfter;
  try {
    recentBefore = validateRecentRunWindow(await github.readRecentRunWindow());
    first = await github.scanNonterminal();
    if (typeof github.betweenScans === 'function') await github.betweenScans();
    second = await github.scanNonterminal();
    recentAfter = validateRecentRunWindow(await github.readRecentRunWindow());
    workflowAfter = await github.readWorkflow();
  } catch (error) {
    if (error instanceof ReconcilerClosureError) throw error;
    fail('GITHUB_READ_FAILED');
  }
  const firstTotal = validateRunScan(first);
  const secondTotal = validateRunScan(second);
  if (firstTotal !== 0 || secondTotal !== 0) fail('RECONCILER_RUN_ACTIVE');
  if (JSON.stringify(recentBefore) !== JSON.stringify(recentAfter)) {
    fail('GITHUB_RUN_WINDOW_NOT_QUIESCENT');
  }
  if (!workflowAfter || typeof workflowAfter !== 'object' || Array.isArray(workflowAfter)
      || workflowAfter.path !== WORKFLOW_PATH
      || workflowAfter.state !== 'disabled_manually') {
    fail('WORKFLOW_NOT_DISABLED');
  }

  return {
    status: 'PASS',
    operation: 'verify-disabled',
    prior_reconciler_sha: closure.releaseSha,
    prior_reconciler_closure_sha256: closure.closureSha256,
    sealed_bundle_sha256: bundle.bundleSha256,
    sealed_bundle_byte_length: bundle.bundleByteLength,
    reconciler_file_count: closure.fileRows.length,
    rollback_action: ROLLBACK_ACTION,
    workflow_apply_default_false: 'PASS',
    workflow_state: 'disabled_manually',
    nonterminal_scan_count: 2,
    nonterminal_run_count: 0,
    reconciler_apply_posture: 'DISABLED',
    local_private_readback: 'PASS',
  };
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || !argv.length) fail('OPERATION_REQUIRED');
  const operation = clean(argv[0]);
  if (!['capture', 'verify-disabled'].includes(operation)) fail('OPERATION_INVALID');
  const args = {};
  for (let index = 1; index < argv.length; index++) {
    const token = clean(argv[index]);
    const match = token.match(/^--([a-z0-9-]+)=(.*)$/);
    if (!match) fail('ARGUMENT_INVALID');
    if (Object.prototype.hasOwnProperty.call(args, match[1])) fail('ARGUMENT_DUPLICATED');
    args[match[1]] = match[2];
  }
  const required = operation === 'capture'
    ? ['release-sha', 'bundle']
    : [
      'release-sha',
      'bundle',
      'expected-bundle-sha256',
      'expected-bundle-byte-length',
      'expected-closure-sha256',
    ];
  const allowed = new Set(required);
  if (Object.keys(args).some(key => !allowed.has(key))
      || required.some(key => !Object.prototype.hasOwnProperty.call(args, key))) {
    fail('ARGUMENT_SET_INVALID');
  }
  return {
    operation,
    options: {
      repoRoot: process.cwd(),
      releaseSha: args['release-sha'],
      bundlePath: args.bundle,
      expectedBundleSha256: args['expected-bundle-sha256'],
      expectedBundleByteLength: args['expected-bundle-byte-length'],
      expectedClosureSha256: args['expected-closure-sha256'],
    },
  };
}

function publicFailure(operation, error) {
  return {
    status: 'FAIL',
    operation: ['capture', 'verify-disabled'].includes(operation) ? operation : 'unknown',
    code: error instanceof ReconcilerClosureError && /^[A-Z0-9_]+$/.test(clean(error.code))
      ? error.code
      : 'F27_RECONCILER_CLOSURE_FAILED',
  };
}

async function main() {
  let operation = 'unknown';
  let receipt;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    operation = parsed.operation;
    receipt = operation === 'capture'
      ? capture(parsed.options)
      : await verifyDisabled(parsed.options);
  } catch (error) {
    receipt = publicFailure(operation, error);
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    BUNDLE_SCHEMA,
    EXPECTED_CLOSURE_PATHS,
    EXPECTED_WORKFLOW_ENTRYPOINTS,
    GITHUB_REPOSITORY,
    HASH_ALGORITHM,
    NONTERMINAL_STATUSES,
    REVIEWED_BLOB_SHA256,
    ROLLBACK_ACTION,
    WORKFLOW_PATH,
    WORKFLOW_API_ID,
    ReconcilerClosureError,
    canonicalJson,
    capture,
    closureFingerprint,
    exactClosure,
    gitChildEnvironment,
    githubChildEnvironment,
    manifestForClosure,
    packBundle,
    parseArgs,
    publicFailure,
    unpackBundle,
    validateRecentRunWindow,
    validateRunScan,
    verifyDisabled,
    workflowContract,
  };
}
