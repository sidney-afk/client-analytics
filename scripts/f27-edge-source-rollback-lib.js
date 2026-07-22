'use strict';

/*
 * Source-exact Edge Function rollback primitives.
 *
 * A capture is one deterministic, length-prefixed, hash-sealed private file.
 * It contains the exact source bytes returned by the provider and one
 * canonical manifest for the complete function set. Restore never trusts a
 * deploy response: it independently reads every active function back through
 * the adapter and requires path/byte, entrypoint, and JWT equality.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA_VERSION = 2;
const PACKAGE_MAGIC = Buffer.from('F27_EDGE_SOURCE_SET_V2\n', 'ascii');
const SEAL_MAGIC = Buffer.from('F27_SHA256_V1\n', 'ascii');
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;

const PUBLIC_FAILURES = Object.freeze({
  BUNDLE_DESTINATION_EXISTS: 'capture destination must not already exist',
  BUNDLE_GIT_REGISTRY_UNAVAILABLE: 'Git worktree registry could not be verified',
  BUNDLE_NOT_REGULAR: 'restore bundle must be one regular file',
  BUNDLE_PARENT_NOT_PRIVATE: 'bundle parent must be an existing private writable directory',
  BUNDLE_PATH_LINKED: 'bundle path cannot contain a symlink or junction',
  BUNDLE_PATH_NOT_ABSOLUTE: 'bundle path must be explicit and absolute',
  BUNDLE_PATH_PERMISSIONS: 'bundle path exposes Unix group or other permissions',
  BUNDLE_PATH_WORKTREE: 'bundle path must be outside every Git worktree',
  CAPTURE_APPLY_FORBIDDEN: 'capture cannot use the mutation confirmation flag',
  RESTORE_APPLY_REQUIRED: 'restore requires the explicit mutation confirmation flag',
  RESTORE_BUNDLE_SHA256_MISMATCH: 'restore bundle sha256 does not match the captured receipt',
  RESTORE_BUNDLE_SHA256_REQUIRED: 'restore requires the exact sealed bundle sha256 from the captured receipt',
  RESTORE_CONFIRMATION_REQUIRED: 'restore confirmation does not match the sealed function set',
  F27_EDGE_ROLLBACK_FAILED: 'operation failed closed without publishing private details',
});

function operatorError(code) {
  const publicCode = Object.prototype.hasOwnProperty.call(PUBLIC_FAILURES, code)
    ? code : 'F27_EDGE_ROLLBACK_FAILED';
  const error = new Error(PUBLIC_FAILURES[publicCode]);
  Object.defineProperty(error, 'f27PublicCode', { value: publicCode, enumerable: false });
  return error;
}

function publicFailure(error) {
  const candidate = error && error.f27PublicCode;
  const code = Object.prototype.hasOwnProperty.call(PUBLIC_FAILURES, candidate)
    ? candidate : 'F27_EDGE_ROLLBACK_FAILED';
  return { code, message: PUBLIC_FAILURES[code] };
}

function comparisonPath(value) {
  const normalized = path.normalize(path.resolve(value));
  const root = path.parse(normalized).root;
  const trimmed = normalized.length > root.length ? normalized.replace(/[\\/]+$/, '') : normalized;
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function registeredGitWorktrees(probeRoots = [process.cwd(), path.resolve(__dirname, '..')]) {
  const worktrees = new Set();
  let verified = false;
  for (const rawProbe of probeRoots) {
    const probe = path.resolve(rawProbe);
    let stat;
    try { stat = fs.statSync(probe); } catch (_) { continue; }
    const cwd = stat.isDirectory() ? probe : path.dirname(probe);
    const result = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain', '-z'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) continue;
    verified = true;
    for (const field of String(result.stdout || '').split('\0')) {
      if (!field.startsWith('worktree ')) continue;
      const rawPath = field.slice('worktree '.length);
      if (!rawPath) continue;
      let canonical = path.resolve(rawPath);
      try { canonical = fs.realpathSync.native(canonical); } catch (_) {}
      worktrees.add(comparisonPath(canonical));
    }
  }
  if (!verified) throw operatorError('BUNDLE_GIT_REGISTRY_UNAVAILABLE');
  return [...worktrees];
}

function assertNoLinkedComponents(absolutePath, allowMissingFinal) {
  const parsed = path.parse(absolutePath);
  const parts = absolutePath.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
  let cursor = parsed.root;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (error) {
      if (error && error.code === 'ENOENT' && allowMissingFinal && index === parts.length - 1) return;
      throw operatorError('BUNDLE_PARENT_NOT_PRIVATE');
    }
    if (stat.isSymbolicLink()) throw operatorError('BUNDLE_PATH_LINKED');
  }
}

function hasContainingGitMarker(absolutePath, targetIsDirectory = false) {
  let cursor = targetIsDirectory ? absolutePath : path.dirname(absolutePath);
  while (true) {
    try {
      fs.lstatSync(path.join(cursor, '.git'));
      return true;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') return true;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

function assertUnixPrivateMode(mode) {
  if ((Number(mode) & 0o077) !== 0) throw operatorError('BUNDLE_PATH_PERMISSIONS');
}

function validatePrivateBundlePath(rawPath, { operation, gitProbeRoots } = {}) {
  if (typeof rawPath !== 'string' || !rawPath.trim() || !path.isAbsolute(rawPath)) {
    throw operatorError('BUNDLE_PATH_NOT_ABSOLUTE');
  }
  if (!['capture', 'restore'].includes(operation)) throw operatorError('F27_EDGE_ROLLBACK_FAILED');
  const absolute = path.normalize(rawPath);
  const capture = operation === 'capture';
  assertNoLinkedComponents(absolute, capture);

  const parent = path.dirname(absolute);
  let parentStat;
  try { parentStat = fs.lstatSync(parent); } catch (_) { throw operatorError('BUNDLE_PARENT_NOT_PRIVATE'); }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw operatorError('BUNDLE_PARENT_NOT_PRIVATE');
  try { fs.accessSync(parent, fs.constants.W_OK); } catch (_) { throw operatorError('BUNDLE_PARENT_NOT_PRIVATE'); }

  let targetStat = null;
  try { targetStat = fs.lstatSync(absolute); } catch (error) {
    if (!capture || !error || error.code !== 'ENOENT') throw operatorError('BUNDLE_NOT_REGULAR');
  }
  if (capture && targetStat) throw operatorError('BUNDLE_DESTINATION_EXISTS');
  if (!capture && (!targetStat || targetStat.isSymbolicLink() || !targetStat.isFile())) {
    throw operatorError(targetStat && targetStat.isSymbolicLink() ? 'BUNDLE_PATH_LINKED' : 'BUNDLE_NOT_REGULAR');
  }

  let canonicalParent;
  try { canonicalParent = fs.realpathSync.native(parent); } catch (_) { throw operatorError('BUNDLE_PARENT_NOT_PRIVATE'); }
  const canonical = capture
    ? path.join(canonicalParent, path.basename(absolute))
    : fs.realpathSync.native(absolute);
  const candidate = comparisonPath(canonical);
  const registered = registeredGitWorktrees(gitProbeRoots);
  if (hasContainingGitMarker(canonical, false)
    || registered.some(worktree => pathInside(candidate, worktree))) {
    throw operatorError('BUNDLE_PATH_WORKTREE');
  }

  if (process.platform !== 'win32') {
    assertUnixPrivateMode(parentStat.mode);
    if (!capture) assertUnixPrivateMode(targetStat.mode);
  }
  return canonical;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function expectedBundleSha256(value) {
  const expected = String(value == null ? '' : value).trim();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw operatorError('RESTORE_BUNDLE_SHA256_REQUIRED');
  return expected;
}

function assertExpectedBundleSha256(actual, expected) {
  const normalizedExpected = expectedBundleSha256(expected);
  const normalizedActual = String(actual == null ? '' : actual).trim();
  if (!/^[0-9a-f]{64}$/.test(normalizedActual)
    || !crypto.timingSafeEqual(Buffer.from(normalizedActual, 'hex'), Buffer.from(normalizedExpected, 'hex'))) {
    throw operatorError('RESTORE_BUNDLE_SHA256_MISMATCH');
  }
  return normalizedExpected;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
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

function assertSlug(value) {
  const slug = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('function slug is invalid');
  return slug;
}

function assertSourcePath(value, slug, label = 'source path') {
  const file = String(value || '').replace(/\\/g, '/');
  if (!file || file.includes('\0') || file.startsWith('/') || /^[a-zA-Z]:\//.test(file)
    || file.split('/').includes('..') || path.posix.normalize(file) !== file) {
    throw new Error(`${label} is unsafe`);
  }
  const allowedPrefix = file.startsWith(`functions/${slug}/`) || file.startsWith('functions/_shared/');
  if (!allowedPrefix || file.endsWith('/')) throw new Error(`${label} is outside the captured function closure`);
  return file;
}

function normalizeFiles(input, slug, allowEmpty = false) {
  const entries = input instanceof Map ? [...input.entries()] : Object.entries(input || {});
  if (!entries.length && !allowEmpty) throw new Error('source closure is empty');
  const files = new Map();
  for (const [rawPath, rawBytes] of entries) {
    const file = assertSourcePath(rawPath, slug);
    if (files.has(file)) throw new Error(`source closure repeats ${file}`);
    if (!(Buffer.isBuffer(rawBytes) || rawBytes instanceof Uint8Array || typeof rawBytes === 'string')) {
      throw new Error(`source closure has unsupported bytes for ${file}`);
    }
    files.set(file, Buffer.from(rawBytes));
  }
  return files;
}

function compareClosures(expected, observed) {
  const expectedPaths = [...expected.keys()].sort();
  const observedPaths = [...observed.keys()].sort();
  const missing = expectedPaths.filter(file => !observed.has(file));
  const extra = observedPaths.filter(file => !expected.has(file));
  const changed = expectedPaths.filter(file => observed.has(file)
    && !Buffer.from(expected.get(file)).equals(Buffer.from(observed.get(file))));
  return { pass: !missing.length && !extra.length && !changed.length, missing, extra, changed };
}

function safeRecord(rawRecord, expectedSlug) {
  if (!rawRecord || typeof rawRecord !== 'object') throw new Error('adapter returned no function record');
  const slug = assertSlug(rawRecord.slug);
  if (slug !== expectedSlug) throw new Error('adapter returned a different function slug');
  const files = normalizeFiles(rawRecord.files, slug);
  const entrypointPath = assertSourcePath(rawRecord.entrypointPath, slug, 'entrypoint path');
  if (!files.has(entrypointPath)) throw new Error('entrypoint is absent from the source closure');
  if (typeof rawRecord.verifyJwt !== 'boolean') throw new Error('adapter omitted the JWT setting');
  const version = String(rawRecord.version == null ? '' : rawRecord.version).trim();
  if (!version) throw new Error('adapter omitted the deployed version');
  const status = String(rawRecord.status || '').toUpperCase();
  if (status !== 'ACTIVE') throw new Error('function is not ACTIVE');
  const provider = rawRecord.provider && typeof rawRecord.provider === 'object'
    ? canonicalValue(rawRecord.provider) : {};
  return {
    slug,
    files,
    entrypointPath,
    verifyJwt: rawRecord.verifyJwt,
    version,
    status,
    provider,
    providerBundleHash: String(rawRecord.providerBundleHash || ''),
  };
}

function uint32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value, 0);
  return output;
}

function uint64(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('package length is invalid');
  const output = Buffer.alloc(8);
  output.writeBigUInt64BE(BigInt(value), 0);
  return output;
}

function aggregateSourceHash(functionManifests) {
  const rows = new Map(functionManifests.map(manifest => [
    manifest.slug,
    Buffer.from(manifest.source_closure_sha256, 'ascii'),
  ]));
  return closureFingerprint(rows);
}

function functionManifest(record) {
  const manifest = {
    artifact_kind: 'source-exact-edge-function',
    rollback_standard: 'source-exact-readback',
    slug: record.slug,
    captured_version: record.version,
    verify_jwt: record.verifyJwt,
    entrypoint_path: record.entrypointPath,
    source_closure_sha256: closureFingerprint(record.files),
    provider_bundle_sha256: record.providerBundleHash || null,
    provider: record.provider,
    files: [...record.files.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, bytes]) => ({ path: file, byte_length: bytes.length, sha256: sha256(bytes) })),
  };
  return { manifest, manifestHash: sha256(Buffer.from(canonicalJson(manifest), 'utf8')) };
}

function packCapture(manifest, closures) {
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  if (manifestBytes.length > MAX_PACKAGE_BYTES) throw new Error('capture manifest exceeds the safety limit');
  const entries = [];
  for (const slug of [...closures.keys()].sort()) {
    for (const [file, bytes] of [...closures.get(slug).entries()].sort(([a], [b]) => a.localeCompare(b))) {
      entries.push({ slug, file, bytes: Buffer.from(bytes) });
    }
  }
  const chunks = [PACKAGE_MAGIC, uint32(manifestBytes.length), manifestBytes, uint32(entries.length)];
  for (const entry of entries) {
    const slugBytes = Buffer.from(entry.slug, 'utf8');
    const pathBytes = Buffer.from(entry.file, 'utf8');
    chunks.push(uint32(slugBytes.length), slugBytes, uint32(pathBytes.length), pathBytes, uint64(entry.bytes.length), entry.bytes);
  }
  const payload = Buffer.concat(chunks);
  const seal = Buffer.from(sha256(payload), 'hex');
  const bundle = Buffer.concat([payload, SEAL_MAGIC, seal]);
  if (bundle.length > MAX_PACKAGE_BYTES) throw new Error('sealed capture exceeds the safety limit');
  return { bundle, manifestBytes, payloadHash: seal.toString('hex') };
}

function unpackCapture(bundleBytes) {
  const bytes = Buffer.from(bundleBytes);
  if (bytes.length > MAX_PACKAGE_BYTES) throw new Error('sealed capture exceeds the safety limit');
  const footerLength = SEAL_MAGIC.length + 32;
  if (bytes.length < PACKAGE_MAGIC.length + 4 + footerLength) throw new Error('sealed capture is truncated');
  const footerAt = bytes.length - footerLength;
  if (!bytes.subarray(footerAt, footerAt + SEAL_MAGIC.length).equals(SEAL_MAGIC)) throw new Error('sealed capture footer is invalid');
  const payload = bytes.subarray(0, footerAt);
  const declaredSeal = bytes.subarray(footerAt + SEAL_MAGIC.length);
  if (!crypto.timingSafeEqual(Buffer.from(sha256(payload), 'hex'), declaredSeal)) throw new Error('sealed capture hash mismatch');
  let cursor = 0;
  function take(length, label) {
    if (!Number.isSafeInteger(length) || length < 0 || cursor + length > payload.length) throw new Error(`sealed capture ${label} is truncated`);
    const output = payload.subarray(cursor, cursor + length);
    cursor += length;
    return output;
  }
  function readU32(label) { return take(4, label).readUInt32BE(0); }
  function readU64(label) {
    const value = take(8, label).readBigUInt64BE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`sealed capture ${label} is too large`);
    return Number(value);
  }
  if (!take(PACKAGE_MAGIC.length, 'header').equals(PACKAGE_MAGIC)) throw new Error('sealed capture header is invalid');
  const manifestBytes = take(readU32('manifest length'), 'manifest');
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch (_) { throw new Error('sealed capture manifest is invalid'); }
  if (!Buffer.from(canonicalJson(manifest), 'utf8').equals(manifestBytes)) throw new Error('sealed capture manifest is not canonical');
  const entryCount = readU32('entry count');
  if (entryCount > 10000) throw new Error('sealed capture contains too many source files');
  const closures = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    const slug = assertSlug(take(readU32('slug length'), 'slug').toString('utf8'));
    const file = assertSourcePath(take(readU32('path length'), 'path').toString('utf8'), slug);
    const content = Buffer.from(take(readU64('source length'), 'source'));
    if (!closures.has(slug)) closures.set(slug, new Map());
    if (closures.get(slug).has(file)) throw new Error('sealed capture repeats a source file');
    closures.get(slug).set(file, content);
  }
  if (cursor !== payload.length) throw new Error('sealed capture has trailing payload bytes');
  return {
    manifest,
    manifestBytes: Buffer.from(manifestBytes),
    closures,
    payloadHash: declaredSeal.toString('hex'),
    bundleHash: sha256(bytes),
  };
}

function validateFunctionCapture(manifest, files) {
  if (!manifest || manifest.artifact_kind !== 'source-exact-edge-function') throw new Error('function capture manifest is invalid');
  const slug = assertSlug(manifest.slug);
  const normalized = normalizeFiles(files, slug);
  if (manifest.rollback_standard !== 'source-exact-readback') {
    throw new Error(`${slug} capture rollback standard is invalid`);
  }
  const entrypointPath = assertSourcePath(manifest.entrypoint_path, slug, 'entrypoint path');
  if (!normalized.has(entrypointPath)) throw new Error(`${slug} captured entrypoint is absent`);
  if (typeof manifest.verify_jwt !== 'boolean' || !String(manifest.captured_version || '')) {
    throw new Error(`${slug} capture metadata is invalid`);
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error(`${slug} capture contains invalid file inventories`);
  }
  const rows = new Map();
  for (const row of manifest.files) {
    const file = assertSourcePath(row && row.path, slug);
    if (rows.has(file)) throw new Error(`${slug} capture repeats ${file}`);
    if (!Number.isSafeInteger(row.byte_length) || row.byte_length < 0 || !/^[0-9a-f]{64}$/.test(String(row.sha256 || ''))) {
      throw new Error(`${slug} capture file metadata is invalid`);
    }
    rows.set(file, row);
  }
  const paths = [...normalized.keys()].sort();
  const expectedPaths = [...rows.keys()].sort();
  if (paths.length !== expectedPaths.length || paths.some((file, index) => file !== expectedPaths[index])) {
    throw new Error(`${slug} capture inventory mismatch`);
  }
  for (const [file, bytes] of normalized) {
    const row = rows.get(file);
    if (bytes.length !== row.byte_length || sha256(bytes) !== row.sha256) throw new Error(`${slug} capture source hash mismatch`);
  }
  if (closureFingerprint(normalized) !== manifest.source_closure_sha256) {
    throw new Error(`${slug} capture closure hash mismatch`);
  }
  return { slug, manifest, files: normalized };
}

function captureReceipt(operation, bundlePath, capture) {
  return {
    result: 'PASS',
    operation,
    rollback_standard: capture.manifest.rollback_standard,
    function_count: capture.manifest.functions.length,
    aggregate_source_sha256: capture.manifest.aggregate_source_sha256,
    bundle_manifest_sha256: sha256(capture.manifestBytes),
    sealed_payload_sha256: capture.payloadHash,
    sealed_bundle_sha256: capture.bundleHash,
    sealed_bundle_byte_length: fs.statSync(bundlePath).size,
    provider_source_exactness: 'PASS',
    functions: capture.functions.map(item => ({
      slug: item.manifest.slug,
      captured_version: item.manifest.captured_version,
      rollback_standard: item.manifest.rollback_standard,
      verify_jwt: item.manifest.verify_jwt,
      source_closure_sha256: item.manifest.source_closure_sha256,
      function_manifest_sha256: item.manifestHash,
      file_count: item.files.size,
      provider_source_file_count: item.files.size,
    })),
  };
}

async function captureFunctions({
  adapter,
  slugs: rawSlugs,
  bundleFile,
  capturedAt = new Date().toISOString(),
}) {
  if (!adapter || typeof adapter.readFunction !== 'function') throw new Error('capture adapter is invalid');
  const slugs = [...new Set((rawSlugs || []).map(assertSlug))].sort();
  if (!slugs.length || slugs.length !== (rawSlugs || []).length) throw new Error('capture slug set is empty or duplicated');
  const records = [];
  for (const slug of slugs) records.push(safeRecord(await adapter.readFunction(slug), slug));
  const closures = new Map(records.map(record => [record.slug, record.files]));
  const functionRows = records.map(record => {
    const built = functionManifest(record);
    return { ...built.manifest, function_manifest_sha256: built.manifestHash };
  });
  const manifest = {
    schema_version: SCHEMA_VERSION,
    artifact_kind: 'source-exact-edge-function-rollback-set',
    rollback_standard: 'source-exact-readback',
    captured_at: String(capturedAt),
    function_count: functionRows.length,
    aggregate_source_sha256: aggregateSourceHash(functionRows),
    functions: functionRows,
  };
  const packed = packCapture(manifest, closures);
  const destination = validatePrivateBundlePath(bundleFile, { operation: 'capture' });
  try {
    fs.writeFileSync(destination, packed.bundle, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error && error.code === 'EEXIST') throw operatorError('BUNDLE_DESTINATION_EXISTS');
    throw operatorError('F27_EDGE_ROLLBACK_FAILED');
  }
  const loaded = loadCapture(destination);
  return captureReceipt('capture', destination, loaded);
}

async function captureFunction({ adapter, slug, bundleFile, bundleDir, capturedAt }) {
  const receipt = await captureFunctions({
    adapter, slugs: [slug], bundleFile: bundleFile || bundleDir, capturedAt,
  });
  return { ...receipt.functions[0], ...receipt, functions: receipt.functions };
}

function loadCapture(bundleFile, { expectedBundleSha256: expected } = {}) {
  const normalizedExpected = expected === undefined ? null : expectedBundleSha256(expected);
  const destination = validatePrivateBundlePath(bundleFile, { operation: 'restore' });
  const stat = fs.lstatSync(destination);
  if (stat.size > MAX_PACKAGE_BYTES) throw new Error('sealed capture exceeds the safety limit');
  let bundleBytes;
  try { bundleBytes = fs.readFileSync(destination); } catch (_) { throw new Error('sealed capture could not be read'); }
  const unpacked = unpackCapture(bundleBytes);
  const manifest = unpacked.manifest;
  if (manifest.schema_version !== SCHEMA_VERSION || manifest.artifact_kind !== 'source-exact-edge-function-rollback-set'
    || !Array.isArray(manifest.functions) || manifest.function_count !== manifest.functions.length || !manifest.functions.length) {
    throw new Error('sealed capture manifest schema is unsupported');
  }
  if (manifest.rollback_standard !== 'source-exact-readback') {
    throw new Error('sealed capture rollback standard is unsupported');
  }
  const functions = [];
  const seen = new Set();
  for (const row of manifest.functions) {
    const manifestHash = String(row.function_manifest_sha256 || '');
    const functionOnly = { ...row };
    delete functionOnly.function_manifest_sha256;
    if (!/^[0-9a-f]{64}$/.test(manifestHash)
      || sha256(Buffer.from(canonicalJson(functionOnly), 'utf8')) !== manifestHash) {
      throw new Error('function manifest hash mismatch');
    }
    const slug = assertSlug(row.slug);
    if (row.rollback_standard !== manifest.rollback_standard) throw new Error('function rollback standard differs from its sealed set');
    if (seen.has(slug)) throw new Error('sealed capture repeats a function slug');
    seen.add(slug);
    const validated = validateFunctionCapture(functionOnly, unpacked.closures.get(slug));
    functions.push({ ...validated, manifestHash });
  }
  const extraSlugs = [...unpacked.closures.keys()].filter(slug => !seen.has(slug));
  if (extraSlugs.length || unpacked.closures.size !== functions.length) throw new Error('sealed capture function inventory mismatch');
  functions.sort((a, b) => a.slug.localeCompare(b.slug));
  if (aggregateSourceHash(functions.map(item => item.manifest)) !== manifest.aggregate_source_sha256) {
    throw new Error('sealed capture aggregate source hash mismatch');
  }
  const capture = {
    bundleFile: destination,
    manifest,
    manifestBytes: unpacked.manifestBytes,
    manifestHash: sha256(unpacked.manifestBytes),
    payloadHash: unpacked.payloadHash,
    bundleHash: unpacked.bundleHash,
    functions,
  };
  if (normalizedExpected !== null) assertExpectedBundleSha256(capture.bundleHash, normalizedExpected);
  return capture;
}

async function restoreOne(adapter, captured) {
  const { manifest, files } = captured;
  await adapter.deployFunction({
    slug: manifest.slug,
    files: new Map([...files].map(([file, bytes]) => [file, Buffer.from(bytes)])),
    entrypointPath: manifest.entrypoint_path,
    verifyJwt: manifest.verify_jwt,
    capturedProvider: canonicalValue(manifest.provider || {}),
  });
  const readback = safeRecord(await adapter.readFunction(manifest.slug), manifest.slug);
  const comparison = compareClosures(files, readback.files);
  const readbackHash = closureFingerprint(readback.files);
  if (!comparison.pass || readbackHash !== manifest.source_closure_sha256
    || readback.entrypointPath !== manifest.entrypoint_path || readback.verifyJwt !== manifest.verify_jwt) {
    const reasons = [];
    if (comparison.missing.length) reasons.push(`missing=${comparison.missing.join(',')}`);
    if (comparison.extra.length) reasons.push(`extra=${comparison.extra.join(',')}`);
    if (comparison.changed.length) reasons.push(`changed=${comparison.changed.join(',')}`);
    if (readbackHash !== manifest.source_closure_sha256) reasons.push('closure_hash');
    if (readback.entrypointPath !== manifest.entrypoint_path) reasons.push('entrypoint');
    if (readback.verifyJwt !== manifest.verify_jwt) reasons.push('verify_jwt');
    throw new Error(`${manifest.slug} post-deploy source-exact readback failed: ${reasons.join('; ')}`);
  }
  return {
    slug: manifest.slug,
    captured_version: String(manifest.captured_version),
    rollback_standard: manifest.rollback_standard,
    restored_active_version: readback.version,
    verify_jwt: readback.verifyJwt,
    source_closure_sha256: readbackHash,
    function_manifest_sha256: captured.manifestHash,
    file_count: files.size,
    provider_source_file_count: files.size,
    deployed_source_readback: 'PASS',
  };
}

async function restoreFunctions({ adapter, bundleFile, bundleDir, capture: preloadedCapture, expectedBundleSha256: expected }) {
  expectedBundleSha256(expected);
  if (!adapter || typeof adapter.deployFunction !== 'function' || typeof adapter.readFunction !== 'function') {
    throw new Error('restore adapter is invalid');
  }
  const capture = preloadedCapture || loadCapture(bundleFile || bundleDir, { expectedBundleSha256: expected });
  assertExpectedBundleSha256(capture.bundleHash, expected);
  const functions = [];
  for (const captured of capture.functions) functions.push(await restoreOne(adapter, captured));
  return {
    result: 'PASS',
    operation: 'restore',
    rollback_standard: capture.manifest.rollback_standard,
    function_count: functions.length,
    aggregate_source_sha256: capture.manifest.aggregate_source_sha256,
    bundle_manifest_sha256: capture.manifestHash,
    sealed_payload_sha256: capture.payloadHash,
    sealed_bundle_sha256: capture.bundleHash,
    deployed_source_readback: 'PASS',
    functions,
  };
}

async function restoreFunction({ adapter, bundleFile, bundleDir, capture, expectedBundleSha256: expected }) {
  const result = await restoreFunctions({
    adapter,
    bundleFile: bundleFile || bundleDir,
    capture,
    expectedBundleSha256: expected,
  });
  if (result.functions.length !== 1) throw new Error('single-function restore received a multi-function capture');
  return { ...result.functions[0], ...result, functions: result.functions };
}

function cloneRecord(record) {
  return {
    ...record,
    provider: canonicalValue(record.provider || {}),
    files: new Map([...record.files].map(([file, bytes]) => [file, Buffer.from(bytes)])),
  };
}

class ThrowawayEdgeAdapter {
  constructor({ readTransform = null } = {}) {
    this.records = new Map();
    this.readTransform = readTransform;
    this.readCount = 0;
    this.deployCount = 0;
  }

  seed(record) {
    const slug = assertSlug(record.slug);
    const normalized = safeRecord({
      provider: { adapter: 'hermetic-throwaway', version: '1' },
      providerBundleHash: '',
      ...record,
      slug,
      status: record.status || 'ACTIVE',
    }, slug);
    this.records.set(slug, normalized);
  }

  async readFunction(rawSlug) {
    const slug = assertSlug(rawSlug);
    const record = this.records.get(slug);
    if (!record) throw new Error('throwaway function is absent');
    this.readCount += 1;
    let output = cloneRecord(record);
    if (this.readTransform && this.deployCount > 0) output = await this.readTransform(output, this.deployCount);
    return output;
  }

  async deployFunction(spec) {
    const slug = assertSlug(spec.slug);
    const current = this.records.get(slug);
    const nextVersion = current && /^\d+$/.test(current.version) ? String(Number(current.version) + 1) : 'restored-1';
    this.deployCount += 1;
    this.records.set(slug, safeRecord({
      slug,
      version: nextVersion,
      status: 'ACTIVE',
      verifyJwt: spec.verifyJwt,
      entrypointPath: spec.entrypointPath,
      files: spec.files,
      provider: { adapter: 'hermetic-throwaway', version: '1' },
      providerBundleHash: '',
    }, slug));
    return { version: nextVersion };
  }
}

async function runHermeticRehearsal({ adapter = new ThrowawayEdgeAdapter(), workDir = null } = {}) {
  const ownsTemp = !workDir;
  const root = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'f27-edge-rollback-rehearsal-'));
  const bundleDir = path.join(root, 'private-capture');
  const slug = 'f27-source-rollback-rehearsal';
  const priorFiles = new Map([
    [`functions/${slug}/index.ts`, Buffer.from([
      'import { marker } from "./marker.ts";',
      'export const handler = () => ({ marker });',
      '',
    ].join('\n'))],
    [`functions/${slug}/marker.ts`, Buffer.from('export const marker = "captured-prior-source";\n')],
  ]);
  const candidateFiles = new Map([
    [`functions/${slug}/index.ts`, Buffer.from('export const handler = () => "candidate";\n')],
  ]);
  try {
    adapter.seed({
      slug,
      version: '7',
      status: 'ACTIVE',
      verifyJwt: false,
      entrypointPath: `functions/${slug}/index.ts`,
      files: priorFiles,
    });
    const capture = await captureFunction({
      adapter,
      slug,
      bundleDir,
      capturedAt: '2026-07-22T00:00:00.000Z',
    });
    await adapter.deployFunction({
      slug,
      verifyJwt: true,
      entrypointPath: `functions/${slug}/index.ts`,
      files: candidateFiles,
      capturedProvider: {},
    });
    const candidate = await adapter.readFunction(slug);
    if (closureFingerprint(candidate.files) === capture.source_closure_sha256) throw new Error('throwaway candidate did not replace prior source');
    const restored = await restoreFunction({
      adapter,
      bundleDir,
      expectedBundleSha256: capture.sealed_bundle_sha256,
    });
    return {
      result: 'PASS',
      rehearsal: 'hermetic-throwaway-source-exact-rollback',
      network_calls: 0,
      live_provider_calls: 0,
      hermetic_provider_reads: adapter.readCount,
      hermetic_provider_deploys: adapter.deployCount,
      captured_version: capture.captured_version,
      restored_active_version: restored.restored_active_version,
      source_closure_sha256: restored.source_closure_sha256,
      bundle_manifest_sha256: restored.bundle_manifest_sha256,
      sealed_bundle_sha256: restored.sealed_bundle_sha256,
      deployed_source_readback: restored.deployed_source_readback,
      jwt_readback: restored.verify_jwt === false ? 'PASS' : 'FAIL',
    };
  } finally {
    if (ownsTemp) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

module.exports = {
  MAX_PACKAGE_BYTES,
  PACKAGE_MAGIC,
  PUBLIC_FAILURES,
  SCHEMA_VERSION,
  SEAL_MAGIC,
  ThrowawayEdgeAdapter,
  assertExpectedBundleSha256,
  assertSourcePath,
  canonicalJson,
  captureFunction,
  captureFunctions,
  closureFingerprint,
  compareClosures,
  loadCapture,
  operatorError,
  packCapture,
  restoreFunction,
  restoreFunctions,
  runHermeticRehearsal,
  publicFailure,
  registeredGitWorktrees,
  sha256,
  assertUnixPrivateMode,
  unpackCapture,
  validatePrivateBundlePath,
};
