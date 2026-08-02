#!/usr/bin/env node
'use strict';

/*
 * Fetch one immutable F27 private artifact from the root of the private
 * "SyncView Backups" Shared Drive by its content-addressed name. This root is
 * intentionally distinct from the "track-b-backups" child folder used by the
 * weekly Track-B backup.
 *
 * The destination must be a new absolute path under a private directory and
 * outside every Git worktree. The remote object must be the sole exact-name
 * match, its metadata must bind the configured Shared Drive/folder, and its
 * bytes, length, MD5, and SHA-256 must all round-trip before PASS is emitted.
 * Output never contains credentials, source bytes, paths, or Drive identities.
 *
 * Usage:
 *   F27_PRIVATE_SHARED_DRIVE_ROOT_ID=<private-root-id> \
 *   F27_CONFIRM_PRIVATE_SNAPSHOT_FETCH=FETCH_PRIVATE_EDGE_SOURCE:<sha256> \
 *   node scripts/f27-private-snapshot-fetch.js \
 *     --artifact-kind edge-source \
 *     --destination <absolute-new-private-path> \
 *     --expected-sha256 <64-lowercase-hex> \
 *     --expected-byte-length <positive-decimal>
 */

const fs = require('fs');
const os = require('os');
const {
  ARTIFACT_KINDS,
  PRIVATE_ARTIFACT_MIME_TYPE,
  SnapshotStoreError,
  driveAccessToken,
  publicFailure,
} = require('./f27-private-snapshot-store');
const {
  assertDriveFolderContext,
  assertDriveReadback,
  listDriveFiles,
  md5,
  parseDriveCredentials,
  sha256,
} = require('./track-b-backup');
const { validatePrivateBundlePath } = require('./f27-edge-source-rollback-lib');

const HASH_RE = /^[a-f0-9]{64}$/;
const BYTE_LENGTH_RE = /^[1-9][0-9]*$/;
const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const FETCH_CONFIRMATION_PREFIXES = Object.freeze({
  'mirror-outbox': 'FETCH_PRIVATE_MIRROR_OUTBOX',
  'edge-source': 'FETCH_PRIVATE_EDGE_SOURCE',
  'reconciler-source': 'FETCH_PRIVATE_RECONCILER_SOURCE',
  'final-verification': 'FETCH_PRIVATE_FINAL_VERIFICATION',
  'post-contract-inventory': 'FETCH_PRIVATE_POST_CONTRACT_INVENTORY',
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function folderIdentitySha256(folderId) {
  const value = clean(folderId);
  return value ? sha256(Buffer.from(value, 'utf8')) : '';
}

function publicFetchFailure(error, folderId) {
  const receipt = publicFailure(error);
  const folderHash = folderIdentitySha256(folderId);
  return folderHash ? { ...receipt, folder_id_sha256: folderHash } : receipt;
}

function fail(code, message) {
  throw new SnapshotStoreError(code, message);
}

function confirmationPrefixForArtifactKind(artifactKind) {
  return FETCH_CONFIRMATION_PREFIXES[artifactKind] || '';
}

function isSupportedArtifactKind(artifactKind) {
  return Object.prototype.hasOwnProperty.call(ARTIFACT_KINDS, artifactKind)
    && Object.prototype.hasOwnProperty.call(FETCH_CONFIRMATION_PREFIXES, artifactKind);
}

function parseArgs(argv) {
  const accepted = new Set([
    '--artifact-kind',
    '--destination',
    '--expected-byte-length',
    '--expected-sha256',
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!accepted.has(name)) {
      fail('ARGUMENT_REJECTED', 'Only the documented private snapshot fetch options are accepted.');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || Object.prototype.hasOwnProperty.call(values, name)) {
      fail('ARGUMENT_REJECTED', 'Every accepted option requires exactly one unambiguous value.');
    }
    values[name] = value;
    index += 1;
  }
  if (!isSupportedArtifactKind(values['--artifact-kind'])
    || !values['--destination']
    || !values['--expected-byte-length']
    || !values['--expected-sha256']) {
    fail('ARGUMENT_REJECTED', 'An exact supported private artifact kind, destination, SHA-256, and byte length are required.');
  }
  return {
    artifactKind: values['--artifact-kind'],
    destination: values['--destination'],
    expectedByteLength: values['--expected-byte-length'],
    expectedSha256: values['--expected-sha256'],
  };
}

async function responseJson(response, code, message) {
  if (!response || response.ok !== true) fail(code, message);
  try {
    return await response.json();
  } catch (_) {
    fail(code, message);
  }
}

async function driveMetadata(token, fileId, fetchImpl) {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,parents,driveId,size,md5Checksum,capabilities(canAddChildren,canListChildren)',
    supportsAllDrives: 'true',
  });
  let response;
  try {
    response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
    });
  } catch (_) {
    fail('DRIVE_METADATA_FAILED', 'Private Shared Drive metadata readback failed closed.');
  }
  return responseJson(response, 'DRIVE_METADATA_FAILED', 'Private Shared Drive metadata readback failed closed.');
}

async function listExactName(token, name, folderId, driveId, fetchImpl) {
  try {
    const noRedirectFetch = (url, init = {}) => fetchImpl(url, { ...init, redirect: 'error' });
    const files = await listDriveFiles(
      token,
      `name = '${name}'`,
      noRedirectFetch,
      folderId,
      driveId,
    );
    if (!Array.isArray(files)) throw new Error('incomplete listing');
    return files;
  } catch (_) {
    fail('DRIVE_LIST_FAILED', 'Private Shared Drive exact-name lookup failed closed.');
  }
}

async function downloadBytes(token, fileId, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
      },
    );
  } catch (_) {
    fail('DRIVE_DOWNLOAD_FAILED', 'Private Shared Drive byte download failed closed.');
  }
  if (!response || response.ok !== true) {
    fail('DRIVE_DOWNLOAD_FAILED', 'Private Shared Drive byte download failed closed.');
  }
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (_) {
    fail('DRIVE_DOWNLOAD_FAILED', 'Private Shared Drive byte download was incomplete.');
  }
}

function writePrivateFile(destination, bytes) {
  let descriptor;
  try {
    descriptor = fs.openSync(destination, 'wx', 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } catch (_) {
    fail('PRIVATE_WRITE_FAILED', 'The verified private bundle could not be written safely.');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
  }
  if (process.platform !== 'win32') {
    try { fs.chmodSync(destination, 0o600); } catch (_) {
      try { fs.rmSync(destination, { force: true }); } catch (_) {}
      fail('PRIVATE_WRITE_FAILED', 'The verified private bundle permissions could not be restricted.');
    }
  }
}

async function fetchPrivateSnapshot(options) {
  const artifactKind = clean(options && options.artifactKind);
  if (!isSupportedArtifactKind(artifactKind)) {
    fail('ARTIFACT_KIND_REJECTED', 'Only registered sealed F27 private artifacts may be fetched.');
  }
  const artifact = ARTIFACT_KINDS[artifactKind];
  const expectedSha256 = clean(options && options.expectedSha256);
  const rawByteLength = clean(options && options.expectedByteLength);
  if (!HASH_RE.test(expectedSha256)) {
    fail('EXPECTED_HASH_REQUIRED', 'Expected SHA-256 must be exactly 64 lowercase hexadecimal characters.');
  }
  if (!BYTE_LENGTH_RE.test(rawByteLength)) {
    fail('EXPECTED_LENGTH_REQUIRED', 'Expected byte length must be a positive canonical decimal integer.');
  }
  const expectedByteLength = Number(rawByteLength);
  if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength > MAX_BUNDLE_BYTES) {
    fail('EXPECTED_LENGTH_REQUIRED', 'Expected byte length is outside the private bundle safety limit.');
  }
  const confirmationPrefix = confirmationPrefixForArtifactKind(artifactKind);
  if (clean(options && options.confirmation) !== `${confirmationPrefix}:${expectedSha256}`) {
    fail('CONFIRMATION_REQUIRED', 'Exact content-addressed private snapshot fetch confirmation is required.');
  }
  const folderId = clean(options && options.folderId);
  const credentialsInput = clean(options && options.credentialsInput);
  if (!folderId || !credentialsInput) {
    fail('PRIVATE_SOURCE_CONFIG_REQUIRED', 'The provisioned private Drive folder and credential are both required.');
  }
  const fetchImpl = options && options.fetchImpl;
  if (typeof fetchImpl !== 'function') fail('FETCH_REQUIRED', 'A Drive transport is required.');

  let destination;
  try {
    destination = validatePrivateBundlePath(options && options.destination, {
      operation: 'capture',
      gitProbeRoots: options && options.gitProbeRoots,
    });
  } catch (_) {
    fail('PRIVATE_DESTINATION_REJECTED', 'Destination must be a new private file outside every Git worktree.');
  }

  let account;
  try {
    account = parseDriveCredentials(credentialsInput);
  } catch (_) {
    fail('CREDENTIAL_REJECTED', 'The configured private Drive credential is invalid.');
  }
  const token = await driveAccessToken(account, fetchImpl, options && options.nowMs);
  const folderMetadata = await driveMetadata(token, folderId, fetchImpl);
  let context;
  try {
    context = assertDriveFolderContext(folderMetadata, folderId, true);
  } catch (_) {
    fail('SHARED_DRIVE_REQUIRED', 'The configured source is not the expected listable private Shared Drive folder.');
  }
  if (!clean(context && context.driveId)) {
    fail('SHARED_DRIVE_REQUIRED', 'The configured source has no Shared Drive identity.');
  }

  const name = `${artifact.prefix}${expectedSha256}${artifact.extension}`;
  const initial = await listExactName(token, name, context.folderId, context.driveId, fetchImpl);
  if (initial.length === 0) {
    fail('OBJECT_MISSING', 'The content-addressed private object was missing.');
  }
  if (initial.length !== 1 || !clean(initial[0] && initial[0].id)) {
    fail('OBJECT_NOT_UNIQUE', 'The content-addressed private object was not unique.');
  }
  const objectId = clean(initial[0].id);
  const metadata = await driveMetadata(token, objectId, fetchImpl);
  if (clean(metadata && metadata.id) !== objectId
    || clean(metadata && metadata.name) !== name
    || clean(metadata && metadata.mimeType) !== PRIVATE_ARTIFACT_MIME_TYPE
    || !Array.isArray(metadata && metadata.parents)
    || metadata.parents.length !== 1
    || clean(metadata.parents[0]) !== context.folderId
    || clean(metadata && metadata.driveId) !== context.driveId
    || Number(metadata && metadata.size) !== expectedByteLength
    || !/^[a-f0-9]{32}$/.test(clean(metadata && metadata.md5Checksum).toLowerCase())) {
    fail('READBACK_MISMATCH', 'Private Shared Drive object metadata did not match the sealed source binder.');
  }
  const remoteBytes = await downloadBytes(token, objectId, fetchImpl);
  const final = await listExactName(token, name, context.folderId, context.driveId, fetchImpl);
  if (final.length === 0) {
    fail('OBJECT_MISSING', 'The content-addressed private object disappeared during readback.');
  }
  if (final.length !== 1 || clean(final[0] && final[0].id) !== objectId) {
    fail('OBJECT_NOT_UNIQUE', 'The content-addressed private object was not uniquely stable during readback.');
  }

  try {
    assertDriveReadback(
      metadata,
      remoteBytes,
      remoteBytes,
      name,
      context.folderId,
      objectId,
      context.driveId,
    );
  } catch (_) {
    fail('READBACK_MISMATCH', 'Private Shared Drive metadata or byte readback did not match.');
  }
  if (remoteBytes.length !== expectedByteLength
    || sha256(remoteBytes) !== expectedSha256
    || clean(metadata && metadata.md5Checksum).toLowerCase() !== md5(remoteBytes)) {
    fail('READBACK_MISMATCH', 'Private Shared Drive SHA-256, length, or checksum readback did not match.');
  }

  try {
    writePrivateFile(destination, remoteBytes);
    validatePrivateBundlePath(destination, {
      operation: 'restore',
      gitProbeRoots: options && options.gitProbeRoots,
    });
    const localBytes = fs.readFileSync(destination);
    if (localBytes.length !== expectedByteLength || sha256(localBytes) !== expectedSha256) {
      fail('LOCAL_READBACK_MISMATCH', 'Private local byte/hash readback did not match.');
    }
  } catch (error) {
    try { fs.rmSync(destination, { force: true }); } catch (_) {}
    if (error instanceof SnapshotStoreError) throw error;
    fail('LOCAL_READBACK_MISMATCH', 'Private local byte/hash readback failed closed.');
  }

  return {
    status: 'PASS',
    artifact_kind: artifactKind,
    [artifact.hashField]: expectedSha256,
    byte_length: expectedByteLength,
    folder_id_sha256: folderIdentitySha256(folderId),
    independent_private_readback: 'PASS',
    local_private_readback: 'PASS',
  };
}

async function runFromEnvironment(argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch) {
  const args = parseArgs(argv);
  return fetchPrivateSnapshot({
    ...args,
    confirmation: env.F27_CONFIRM_PRIVATE_SNAPSHOT_FETCH,
    folderId: env.F27_PRIVATE_SHARED_DRIVE_ROOT_ID,
    credentialsInput: env.TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON,
    fetchImpl,
  });
}

if (require.main === module) {
  runFromEnvironment().then(receipt => {
    process.stdout.write(`${JSON.stringify(receipt)}${os.EOL}`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify(publicFetchFailure(
      error,
      process.env.F27_PRIVATE_SHARED_DRIVE_ROOT_ID,
    ))}${os.EOL}`);
    process.exitCode = 1;
  });
}

module.exports = {
  confirmationPrefixForArtifactKind,
  fetchPrivateSnapshot,
  folderIdentitySha256,
  parseArgs,
  publicFetchFailure,
  runFromEnvironment,
  writePrivateFile,
};
