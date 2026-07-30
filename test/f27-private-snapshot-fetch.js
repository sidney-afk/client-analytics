'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  fetchPrivateSnapshot,
  parseArgs,
} = require('../scripts/f27-private-snapshot-fetch');
const { publicFailure } = require('../scripts/f27-private-snapshot-store');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function md5(bytes) {
  return crypto.createHash('md5').update(bytes).digest('hex');
}

function rejectsCode(promise, code) {
  return promise.then(() => false, error => Boolean(error && error.code === code));
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function byteResponse(bytes, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const bundleBytes = Buffer.from(`sealed-provider-source\0${'v39'.repeat(17000)}`, 'utf8');
const bundleSha256 = sha256(bundleBytes);
const folderId = 'fixture-private-folder-id';
const driveId = 'fixture-shared-drive-id';
const objectId = 'fixture-private-object-id';
const accessToken = 'fixture-access-token-never-log';
const clientSecret = 'fixture-client-secret-never-log';
const refreshToken = 'fixture-refresh-token-never-log';
const fileName = `syncview-f27-edge-source-${bundleSha256}.sourcebundle`;
const credentialsInput = JSON.stringify({
  client_id: 'fixture-client-id',
  client_secret: clientSecret,
  refresh_token: refreshToken,
  token_uri: 'https://oauth2.googleapis.com/token',
});

function successfulDriveMock(overrides = {}) {
  const calls = [];
  const bytes = overrides.bytes || bundleBytes;
  const listed = overrides.listed || [{ id: objectId, name: fileName }];
  const metadata = overrides.metadata || {
    id: objectId,
    name: fileName,
    mimeType: 'application/octet-stream',
    parents: [folderId],
    driveId,
    size: String(bytes.length),
    md5Checksum: md5(bytes),
  };
  const folder = overrides.folder || {
    id: folderId,
    mimeType: 'application/vnd.google-apps.folder',
    driveId,
    capabilities: { canAddChildren: true, canListChildren: true },
  };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return jsonResponse({ access_token: accessToken });
    if (calls.length === 2) return jsonResponse(folder);
    if (calls.length === 3) return jsonResponse({ files: listed });
    if (calls.length === 4) return jsonResponse(metadata);
    if (calls.length === 5) return byteResponse(bytes);
    if (calls.length === 6) return jsonResponse({ files: overrides.finalListed || listed });
    throw new Error('unexpected mocked Drive request');
  };
  return { calls, fetchImpl };
}

function options(destination, fetchImpl, overrides = {}) {
  return {
    artifactKind: 'edge-source',
    confirmation: `FETCH_PRIVATE_EDGE_SOURCE:${bundleSha256}`,
    credentialsInput,
    destination,
    expectedByteLength: String(bundleBytes.length),
    expectedSha256: bundleSha256,
    fetchImpl,
    folderId,
    gitProbeRoots: [ROOT],
    nowMs: Date.parse('2026-07-30T12:00:00.000Z'),
    ...overrides,
  };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-private-fetch-'));
  const privateDirectory = path.join(tempRoot, 'private');
  fs.mkdirSync(privateDirectory, { mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(privateDirectory, 0o700);
  try {
    const destination = path.join(privateDirectory, 'v39.sourcebundle');
    const success = successfulDriveMock();
    const receipt = await fetchPrivateSnapshot(options(destination, success.fetchImpl));
    const output = JSON.stringify(receipt);
    ok(receipt.status === 'PASS'
      && receipt.artifact_kind === 'edge-source'
      && receipt.source_bundle_sha256 === bundleSha256
      && receipt.byte_length === bundleBytes.length
      && receipt.independent_private_readback === 'PASS'
      && receipt.local_private_readback === 'PASS'
      && Object.keys(receipt).length === 6,
    'content-addressed fetch emits only the expected hash, byte length, and PASS fields');
    ok(fs.readFileSync(destination).equals(bundleBytes)
      && (process.platform === 'win32' || (fs.statSync(destination).mode & 0o077) === 0),
    'verified bytes are written exactly once to a private local file');
    ok(!output.includes(folderId)
      && !output.includes(driveId)
      && !output.includes(objectId)
      && !output.includes(accessToken)
      && !output.includes(clientSecret)
      && !output.includes(refreshToken)
      && !output.includes(destination)
      && !output.includes('sealed-provider-source'),
    'public receipt contains no credential, source, path, folder, Drive, or object identity');
    ok(success.calls.length === 6 && success.calls.every(call => call.init.redirect === 'error'),
      'fetch performs token, folder, exact-list, metadata, bytes, and final exact-list reads with redirects refused');
    const initialList = new URL(success.calls[2].url);
    const finalList = new URL(success.calls[5].url);
    ok(initialList.searchParams.get('corpora') === 'drive'
      && initialList.searchParams.get('driveId') === driveId
      && initialList.searchParams.get('supportsAllDrives') === 'true'
      && initialList.searchParams.get('includeItemsFromAllDrives') === 'true'
      && initialList.searchParams.get('q').includes(`name = '${fileName}'`)
      && finalList.searchParams.get('q').includes(`name = '${fileName}'`),
    'both uniqueness reads bind the deterministic content-addressed name, folder, and Shared Drive');
    ok(success.calls[3].url.includes(encodeURIComponent(objectId))
      && new URL(success.calls[3].url).searchParams.get('supportsAllDrives') === 'true'
      && success.calls[4].url.includes(encodeURIComponent(objectId))
      && new URL(success.calls[4].url).searchParams.get('alt') === 'media',
    'metadata and byte readback target only the uniquely selected private object');

    const duplicateDestination = path.join(privateDirectory, 'duplicate.sourcebundle');
    const duplicate = successfulDriveMock({
      listed: [
        { id: objectId, name: fileName },
        { id: 'fixture-second-object-id', name: fileName },
      ],
    });
    ok(await rejectsCode(
      fetchPrivateSnapshot(options(duplicateDestination, duplicate.fetchImpl)),
      'OBJECT_NOT_UNIQUE',
    ) && duplicate.calls.length === 3 && !fs.existsSync(duplicateDestination),
    'a missing or non-unique content-addressed object fails before metadata, download, or local write');

    const changedDestination = path.join(privateDirectory, 'changed.sourcebundle');
    const changed = successfulDriveMock({
      finalListed: [{ id: 'fixture-replaced-object-id', name: fileName }],
    });
    ok(await rejectsCode(
      fetchPrivateSnapshot(options(changedDestination, changed.fetchImpl)),
      'OBJECT_NOT_UNIQUE',
    ) && changed.calls.length === 6 && !fs.existsSync(changedDestination),
    'an object identity change during independent readback fails before local write');

    const wrongMetadataDestination = path.join(privateDirectory, 'wrong-metadata.sourcebundle');
    const wrongMetadata = successfulDriveMock({ metadata: {
      id: objectId,
      name: fileName,
      mimeType: 'application/octet-stream',
      parents: [folderId],
      driveId,
      size: String(bundleBytes.length + 1),
      md5Checksum: md5(bundleBytes),
    } });
    ok(await rejectsCode(
      fetchPrivateSnapshot(options(wrongMetadataDestination, wrongMetadata.fetchImpl)),
      'READBACK_MISMATCH',
    ) && wrongMetadata.calls.length === 4 && !fs.existsSync(wrongMetadataDestination),
    'object identity, MIME type, parent, Shared Drive, size, and checksum metadata bind before byte download');

    const corruptBytes = Buffer.from(bundleBytes);
    corruptBytes[0] ^= 1;
    const corruptDestination = path.join(privateDirectory, 'corrupt.sourcebundle');
    const corrupt = successfulDriveMock({ bytes: corruptBytes });
    ok(await rejectsCode(
      fetchPrivateSnapshot(options(corruptDestination, corrupt.fetchImpl)),
      'READBACK_MISMATCH',
    ) && !fs.existsSync(corruptDestination),
    'remote bytes must match the operator-bound SHA-256 and byte length before local write');

    const unconfirmedCalls = [];
    ok(await rejectsCode(fetchPrivateSnapshot(options(
      path.join(privateDirectory, 'unconfirmed.sourcebundle'),
      async (...args) => {
        unconfirmedCalls.push(args);
        throw new Error('must not call');
      },
      { confirmation: 'FETCH_PRIVATE_EDGE_SOURCE:' + '0'.repeat(64) },
    )), 'CONFIRMATION_REQUIRED') && unconfirmedCalls.length === 0,
    'an exact hash-bound confirmation is required before credentials or network access');

    const missingConfigCalls = [];
    ok(await rejectsCode(fetchPrivateSnapshot(options(
      path.join(privateDirectory, 'missing-config.sourcebundle'),
      async (...args) => {
        missingConfigCalls.push(args);
        throw new Error('must not call');
      },
      { folderId: '' },
    )), 'PRIVATE_SOURCE_CONFIG_REQUIRED') && missingConfigCalls.length === 0,
    'missing private Drive configuration fails before any remote call');

    const publicDestination = path.join(ROOT, 'fixture-v39.sourcebundle');
    const publicPathCalls = [];
    ok(await rejectsCode(fetchPrivateSnapshot(options(publicDestination, async (...args) => {
      publicPathCalls.push(args);
      throw new Error('must not call');
    })), 'PRIVATE_DESTINATION_REJECTED')
      && publicPathCalls.length === 0
      && !fs.existsSync(publicDestination),
    'a destination inside the public worktree is rejected before OAuth or Drive access');

    const hostileCredentialCalls = [];
    const hostileCredentials = JSON.stringify({
      client_id: 'fixture-client-id',
      client_secret: clientSecret,
      refresh_token: refreshToken,
      token_uri: 'https://credential-collector.invalid/token',
    });
    ok(await rejectsCode(fetchPrivateSnapshot(options(
      path.join(privateDirectory, 'hostile.sourcebundle'),
      async (...args) => {
        hostileCredentialCalls.push(args);
        throw new Error('must not call');
      },
      { credentialsInput: hostileCredentials },
    )), 'CREDENTIAL_REJECTED') && hostileCredentialCalls.length === 0,
    'a credential-supplied non-Google token endpoint is rejected before a secret can leave the process');

    let duplicateArgRejected = false;
    try {
      parseArgs([
        '--artifact-kind', 'edge-source',
        '--destination', destination,
        '--destination', destination,
        '--expected-sha256', bundleSha256,
        '--expected-byte-length', String(bundleBytes.length),
      ]);
    } catch (error) {
      duplicateArgRejected = Boolean(error && error.code === 'ARGUMENT_REJECTED');
    }
    ok(duplicateArgRejected
      && parseArgs([
        '--artifact-kind', 'edge-source',
        '--destination', destination,
        '--expected-sha256', bundleSha256,
        '--expected-byte-length', String(bundleBytes.length),
      ]).artifactKind === 'edge-source',
    'the CLI accepts only one exact value for every required fetch binder');

    const sanitised = JSON.stringify(publicFailure(new Error(
      `${folderId} ${driveId} ${objectId} ${clientSecret} ${destination} sealed-provider-source`,
    )));
    ok(/UNEXPECTED_FAILURE/.test(sanitised)
      && !sanitised.includes(folderId)
      && !sanitised.includes(driveId)
      && !sanitised.includes(objectId)
      && !sanitised.includes(clientSecret)
      && !sanitised.includes(destination)
      && !sanitised.includes('sealed-provider-source'),
    'unexpected failures collapse to a stable content-, path-, credential-, and identity-free receipt');

    const source = fs.readFileSync(
      path.join(ROOT, 'scripts', 'f27-private-snapshot-fetch.js'),
      'utf8',
    );
    ok(!/console\.(?:log|error|warn)\s*\(/.test(source)
      && !/file_id|folder_id|drive_id/.test(source)
      && /validatePrivateBundlePath\(destination/.test(source)
      && /operation: 'capture'/.test(source)
      && /operation: 'restore'/.test(source),
    'the helper has no raw console/private-identity fields and validates both new-file and restored-file privacy');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (failures) process.exit(1);
  console.log('\nF27 private Shared Drive fetch checks passed');
}

main().catch(error => {
  console.error('FAIL  hermetic F27 private Shared Drive fetch test failed:', error && error.message || String(error));
  process.exit(1);
});
