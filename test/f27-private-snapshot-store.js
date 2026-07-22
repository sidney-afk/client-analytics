'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ARTIFACT_KINDS,
  FILENAME_PREFIX,
  parseArgs,
  publicFailure,
  storePrivateSnapshot,
} = require('../scripts/f27-private-snapshot-store');
const { WINDOWS_PRIVATE_ACL_FORMAT } = require('../scripts/f27-mirror-outbox-snapshot');

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

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-private-drive-'));
const captureDirectory = path.join(tempRoot, 'capture');
const simulatedRepo = path.join(tempRoot, 'public-worktree');
fs.mkdirSync(captureDirectory);
fs.mkdirSync(simulatedRepo);

const secretSentinel = 'fixture row body must never appear in output: token=fixture-private-secret';
const clientSecret = 'fixture-client-secret-never-log';
const refreshToken = 'fixture-refresh-token-never-log';
const snapshotBytes = Buffer.from(`${secretSentinel}\n${'x'.repeat(1024 * 1024 + 29)}`, 'utf8');
const snapshotHash = sha256(snapshotBytes);
const source = path.join(captureDirectory, 'mirror-outbox.private.snapshot');
const folderId = 'fixture-private-folder-id';
const driveId = 'fixture-shared-drive-id';
const uploadedId = 'fixture-uploaded-object-id';
const accessToken = 'fixture-access-token-never-log';
const fileName = `${FILENAME_PREFIX}${snapshotHash}.snapshot`;
const credentialsInput = JSON.stringify({
  client_id: 'fixture-client-id',
  client_secret: clientSecret,
  refresh_token: refreshToken,
  token_uri: 'https://oauth2.googleapis.com/token',
});
fs.writeFileSync(source, snapshotBytes, { mode: 0o600 });

function successfulDriveMock(overrides = {}) {
  const calls = [];
  const expectedName = overrides.fileName || fileName;
  const metadata = {
    id: uploadedId,
    name: expectedName,
    parents: [folderId],
    driveId,
    size: String(snapshotBytes.length),
    md5Checksum: md5(snapshotBytes),
  };
  const folder = {
    id: folderId,
    mimeType: 'application/vnd.google-apps.folder',
    driveId,
    capabilities: { canAddChildren: true, canListChildren: true },
  };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const index = calls.length;
    if (index === 1) return jsonResponse({ access_token: accessToken });
    if (index === 2) return jsonResponse(overrides.folder || folder);
    if (index === 3) return jsonResponse({ files: overrides.preexisting || [] });
    if (index === 4) return jsonResponse(overrides.upload || { id: uploadedId });
    if (index === 5) return jsonResponse(overrides.metadata || metadata);
    if (index === 6) return byteResponse(overrides.remoteBytes || snapshotBytes);
    if (index === 7) return jsonResponse({ files: overrides.published || [{ id: uploadedId, name: expectedName }] });
    throw new Error('unexpected mocked Drive request');
  };
  return { calls, fetchImpl };
}

function options(fetchImpl, overrides = {}) {
  return {
    source,
    expectedSha256: snapshotHash,
    confirmed: true,
    folderId,
    credentialsInput,
    fetchImpl,
    aclPlatform: 'linux',
    worktreeRoots: [simulatedRepo],
    nowMs: Date.parse('2026-07-22T12:00:00.000Z'),
    ...overrides,
  };
}

const FIXTURE_USER_SID = 'S-1-5-21-111-222-333-1001';
function aclProof(overrides = {}) {
  return {
    format: WINDOWS_PRIVATE_ACL_FORMAT,
    action: 'verify-file',
    path_kind: 'file',
    current_user_sid: FIXTURE_USER_SID,
    owner_sid: FIXTURE_USER_SID,
    allowed_sids: [FIXTURE_USER_SID, 'S-1-5-18', 'S-1-5-32-544'].sort(),
    access_rule_count: 3,
    access_rules_protected: false,
    unexpected_access_rule_count: 0,
    deny_rule_count: 0,
    current_user_full_control: true,
    ...overrides,
  };
}

function aclAdapter(overrides = {}) {
  const calls = [];
  return {
    calls,
    run(action, target) {
      calls.push({ action, target });
      return aclProof({ action, ...overrides });
    },
  };
}

async function main() {
  try {
    const success = successfulDriveMock();
    const sourceAcl = aclAdapter();
    const receipt = await storePrivateSnapshot(options(success.fetchImpl, {
      aclPlatform: 'win32',
      privateAclAdapter: sourceAcl,
    }));
    const output = JSON.stringify(receipt);
    ok(receipt.status === 'PASS'
      && receipt.artifact_kind === 'mirror-outbox'
      && receipt.snapshot_sha256 === snapshotHash
      && receipt.byte_length === snapshotBytes.length
      && receipt.independent_private_readback === 'PASS'
      && Object.keys(receipt).length === 5,
    'round trip emits only SHA-256, byte length, and PASS state');
    ok(sourceAcl.calls.length === 1
        && sourceAcl.calls[0].action === 'verify-file'
        && sourceAcl.calls[0].target === path.resolve(source),
    'private-store input proves its Windows owner/full-control allowlist before uploading row-body bytes');
    ok(!output.includes(secretSentinel)
      && !output.includes(source)
      && !output.includes(folderId)
      && !output.includes(driveId)
      && !output.includes(uploadedId)
      && !output.includes(clientSecret)
      && !output.includes(refreshToken)
      && !output.includes(accessToken),
    'public receipt contains no row body, path, credential, folder, Drive, or remote object identity');

    ok(success.calls.length === 7 && success.calls.every(call => call.init.redirect === 'error'),
      'proof performs token, folder, preflight list, upload, metadata, byte readback, and postflight list requests with redirects refused');

    const unsafeAcl = aclAdapter({
      allowed_sids: [FIXTURE_USER_SID, 'S-1-1-0', 'S-1-5-18', 'S-1-5-32-544'].sort(),
      access_rule_count: 4,
      unexpected_access_rule_count: 1,
    });
    const unsafeAclNetworkCalls = [];
    ok(await rejectsCode(storePrivateSnapshot(options(async (...args) => {
      unsafeAclNetworkCalls.push(args);
      throw new Error('must not call');
    }, {
      aclPlatform: 'win32',
      privateAclAdapter: unsafeAcl,
    })), 'WINDOWS_PRIVATE_ACL_REQUIRED')
        && unsafeAcl.calls.length === 1
        && unsafeAclNetworkCalls.length === 0,
    'a private source readable by a broad Windows principal is refused before OAuth or Drive access');
    const tokenCall = success.calls[0];
    ok(tokenCall.url === 'https://oauth2.googleapis.com/token'
      && tokenCall.init.method === 'POST'
      && String(tokenCall.init.body).includes('grant_type=refresh_token'),
    'existing authorized-user backup credential obtains a scoped access token');
    const folderCall = success.calls[1];
    ok(folderCall.url.includes(encodeURIComponent(folderId))
      && new URL(folderCall.url).searchParams.get('supportsAllDrives') === 'true',
    'destination preflight reads the exact configured folder with Shared Drive support');
    const preflightList = new URL(success.calls[2].url);
    ok(preflightList.searchParams.get('corpora') === 'drive'
      && preflightList.searchParams.get('driveId') === driveId
      && preflightList.searchParams.get('supportsAllDrives') === 'true'
      && preflightList.searchParams.get('includeItemsFromAllDrives') === 'true'
      && preflightList.searchParams.get('q').includes(`name = '${fileName}'`),
    'collision check is exact-name scoped to the resolved Shared Drive and folder');
    const uploadCall = success.calls[3];
    ok(uploadCall.url.includes('uploadType=multipart')
      && uploadCall.url.includes('supportsAllDrives=true')
      && uploadCall.init.method === 'POST'
      && Buffer.isBuffer(uploadCall.init.body)
      && uploadCall.init.body.includes(snapshotBytes),
    'upload creates a new content-addressed object in the provisioned private folder');
    const metadataCall = success.calls[4];
    const downloadCall = success.calls[5];
    ok(metadataCall.url.includes(encodeURIComponent(uploadedId))
      && new URL(metadataCall.url).searchParams.get('supportsAllDrives') === 'true'
      && downloadCall.url.includes(encodeURIComponent(uploadedId))
      && new URL(downloadCall.url).searchParams.get('alt') === 'media'
      && new URL(downloadCall.url).searchParams.get('supportsAllDrives') === 'true',
    'independent proof re-fetches exact metadata and bytes with Shared Drive support');
    const postflightList = new URL(success.calls[6].url);
    ok(postflightList.searchParams.get('driveId') === driveId
      && postflightList.searchParams.get('q').includes(`name = '${fileName}'`),
    'postflight requires the uploaded ID to be the sole exact content-addressed match');

    const edgeName = `${ARTIFACT_KINDS['edge-source'].prefix}${snapshotHash}${ARTIFACT_KINDS['edge-source'].extension}`;
    const edge = successfulDriveMock({ fileName: edgeName });
    const edgeReceipt = await storePrivateSnapshot(options(edge.fetchImpl, { artifactKind: 'edge-source' }));
    ok(edgeReceipt.status === 'PASS'
      && edgeReceipt.artifact_kind === 'edge-source'
      && edgeReceipt.source_bundle_sha256 === snapshotHash
      && !Object.prototype.hasOwnProperty.call(edgeReceipt, 'snapshot_sha256')
      && new URL(edge.calls[2].url).searchParams.get('q').includes(`name = '${edgeName}'`),
    'the same private round-trip stores sealed Edge source bundles under a distinct content-addressed kind');

    const noConfigCalls = [];
    ok(await rejectsCode(storePrivateSnapshot(options(async (...args) => {
      noConfigCalls.push(args);
      throw new Error('must not call');
    }, { folderId: '' })), 'PRIVATE_DESTINATION_CONFIG_REQUIRED')
      && noConfigCalls.length === 0,
    'missing configured private destination fails before any remote call');

    const hostileTokenCalls = [];
    const hostileTokenCredential = JSON.stringify({
      client_id: 'fixture-client-id',
      client_secret: clientSecret,
      refresh_token: refreshToken,
      token_uri: 'https://credential-collector.invalid/token',
    });
    ok(await rejectsCode(storePrivateSnapshot(options(async (...args) => {
      hostileTokenCalls.push(args);
      throw new Error('must not call');
    }, { credentialsInput: hostileTokenCredential })), 'CREDENTIAL_REJECTED')
      && hostileTokenCalls.length === 0,
    'a credential-supplied non-Google token endpoint is rejected before secrets can leave the process');

    const unconfirmedCalls = [];
    ok(await rejectsCode(storePrivateSnapshot(options(async (...args) => {
      unconfirmedCalls.push(args);
      throw new Error('must not call');
    }, { confirmed: false })), 'CONFIRMATION_REQUIRED')
      && unconfirmedCalls.length === 0,
    'missing explicit upload confirmation fails before reading credentials or calling Drive');

    const myDrive = successfulDriveMock({ folder: {
      id: folderId,
      mimeType: 'application/vnd.google-apps.folder',
      capabilities: { canAddChildren: true, canListChildren: true },
    } });
    ok(await rejectsCode(storePrivateSnapshot(options(myDrive.fetchImpl)), 'SHARED_DRIVE_REQUIRED')
      && myDrive.calls.length === 2,
    'a writable My Drive folder is refused; F27 requires a nonempty Shared Drive identity');

    const collision = successfulDriveMock({ preexisting: [{ id: 'existing-object', name: fileName }] });
    ok(await rejectsCode(storePrivateSnapshot(options(collision.fetchImpl)), 'OBJECT_EXISTS')
      && collision.calls.length === 3,
    'an exact filename collision refuses overwrite before upload');

    const corruptBytes = Buffer.from(snapshotBytes);
    corruptBytes[corruptBytes.length - 1] ^= 1;
    const corrupt = successfulDriveMock({ remoteBytes: corruptBytes });
    ok(await rejectsCode(storePrivateSnapshot(options(corrupt.fetchImpl)), 'READBACK_MISMATCH')
      && corrupt.calls.length === 6,
    'a byte or SHA-256 mismatch fails before publication can pass');

    const wrongMetadata = successfulDriveMock({ metadata: {
      id: uploadedId,
      name: fileName,
      parents: [folderId],
      driveId: 'wrong-drive',
      size: String(snapshotBytes.length),
      md5Checksum: md5(snapshotBytes),
    } });
    ok(await rejectsCode(storePrivateSnapshot(options(wrongMetadata.fetchImpl)), 'READBACK_MISMATCH'),
      'readback metadata must bind the exact folder, Shared Drive, ID, name, length, and MD5');

    const raced = successfulDriveMock({ published: [
      { id: uploadedId, name: fileName },
      { id: 'concurrent-object', name: fileName },
    ] });
    ok(await rejectsCode(storePrivateSnapshot(options(raced.fetchImpl)), 'OBJECT_COLLISION'),
      'a concurrent same-name publication is detected and cannot produce PASS');

    ok(await rejectsCode(storePrivateSnapshot(options(async () => {
      throw new Error('must not call');
    }, { expectedSha256: '0'.repeat(64) })), 'SOURCE_HASH_MISMATCH'),
    'operator-provided SHA-256 must match before token or Drive access');
    ok(await rejectsCode(storePrivateSnapshot(options(async () => {
      throw new Error('must not call');
    }, { source: path.join(__dirname, 'private.snapshot') })), 'WORKTREE_PATH_REJECTED'),
    'a source in the public repository is rejected before remote access');

    let symlinkExercised = false;
    const linkedCapture = path.join(tempRoot, 'linked-capture');
    try {
      fs.symlinkSync(captureDirectory, linkedCapture, process.platform === 'win32' ? 'junction' : 'dir');
      symlinkExercised = true;
      ok(await rejectsCode(storePrivateSnapshot(options(async () => {
        throw new Error('must not call');
      }, { source: path.join(linkedCapture, path.basename(source)) })), 'SYMLINK_REJECTED'),
      'a symlinked or junction-backed private source is rejected');
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error && error.code)) throw error;
    }
    if (!symlinkExercised) console.log('  ok  source-symlink rejection is source-pinned (host disallows hermetic link creation)');

    const sanitised = JSON.stringify(publicFailure(new Error(
      `${secretSentinel} ${source} ${clientSecret} ${folderId} ${uploadedId}`,
    )));
    ok(!sanitised.includes(secretSentinel)
      && !sanitised.includes(source)
      && !sanitised.includes(clientSecret)
      && !sanitised.includes(folderId)
      && !sanitised.includes(uploadedId)
      && /UNEXPECTED_FAILURE/.test(sanitised),
    'unexpected failures are reduced to a stable content-, path-, credential-, and ID-free receipt');

    let duplicateRejected = false;
    try { parseArgs(['--source', source, '--source', source, '--expected-sha256', snapshotHash]); }
    catch (error) { duplicateRejected = error && error.code === 'ARGUMENT_REJECTED'; }
    ok(duplicateRejected, 'ambiguous or duplicate CLI options are rejected');
    ok(parseArgs(['--artifact-kind', 'edge-source', '--source', source, '--expected-sha256', snapshotHash]).artifactKind === 'edge-source',
      'the CLI accepts the explicit Edge source artifact kind');
    ok(await rejectsCode(storePrivateSnapshot(options(async () => {
      throw new Error('must not call');
    }, { artifactKind: 'unknown-kind' })), 'ARTIFACT_KIND_REJECTED'),
    'an unknown artifact kind fails before any remote call');

    const sourceText = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'f27-private-snapshot-store.js'), 'utf8');
    ok(!/console\.(?:log|error|warn)\s*\(/.test(sourceText)
      && !/file_id|folder_id|drive_id/.test(sourceText),
    'operator implementation has no raw console or private identity receipt fields');
    ok(/assertDriveFolderContext\(folderMetadata, folderId, true\)/.test(sourceText)
      && /assertDriveReadback\(/.test(sourceText)
      && /const remoteBytes = await downloadBytes/.test(sourceText)
      && /sha256\(remoteBytes\) !== localSha256/.test(sourceText),
    'source pins Shared Drive context plus independent metadata, byte, SHA-256, length, and checksum proof');
    ok(success.calls.every(call => call.url.startsWith('https://oauth2.googleapis.com/')
      || call.url.startsWith('https://www.googleapis.com/')),
    'hermetic mock observed the complete intended endpoint set without making a network call');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (failures) process.exit(1);
  console.log('\nF27 private Shared Drive snapshot checks passed');
}

main().catch(error => {
  console.error('FAIL  hermetic F27 private Shared Drive test failed:', error && error.message || String(error));
  process.exit(1);
});
