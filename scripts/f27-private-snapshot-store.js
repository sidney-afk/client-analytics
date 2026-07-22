'use strict';

/*
 * F27 private artifact upload and independent Shared Drive readback.
 *
 * The destination is the already-provisioned private Track-B backup folder.
 * It is selected only by TRACK_B_BACKUP_DRIVE_FOLDER_ID plus the scoped
 * TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON credential. The folder must resolve
 * to a writable/listable Google Shared Drive. The operator supplies an exact
 * source hash and explicitly confirms the upload. Output contains only the
 * hash, byte length, and PASS state; source paths, file/folder/Drive IDs,
 * credentials, and snapshot bytes are never emitted.
 *
 * Usage:
 *   F27_CONFIRM_PRIVATE_SNAPSHOT_UPLOAD=1 \
 *   node scripts/f27-private-snapshot-store.js \
 *     --artifact-kind mirror-outbox \
 *     --source <absolute-private-snapshot-path> \
 *     --expected-sha256 <64-lowercase-hex>
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  assertDriveFolderContext,
  assertDriveReadback,
  listDriveFiles,
  md5,
  parseDriveCredentials,
  sha256,
} = require('./track-b-backup');
const { assertWindowsPrivateFileAcl } = require('./f27-mirror-outbox-snapshot');

const REPO_ROOT = path.resolve(__dirname, '..');
const HASH_RE = /^[a-f0-9]{64}$/;
const FILENAME_PREFIX = 'syncview-f27-mirror-outbox-';
const ARTIFACT_KINDS = Object.freeze({
  'mirror-outbox': Object.freeze({
    prefix: FILENAME_PREFIX,
    extension: '.snapshot',
    hashField: 'snapshot_sha256',
  }),
  'edge-source': Object.freeze({
    prefix: 'syncview-f27-edge-source-',
    extension: '.sourcebundle',
    hashField: 'source_bundle_sha256',
  }),
});

class SnapshotStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SnapshotStoreError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new SnapshotStoreError(code, message);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`));
}

function lstatOrNull(value) {
  try {
    return fs.lstatSync(value);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail('SOURCE_INSPECTION_FAILED', 'The private snapshot path could not be inspected safely.');
  }
}

function assertNoSymlinkComponents(absolutePath) {
  const parsed = path.parse(absolutePath);
  const tail = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;

  for (const segment of tail) {
    cursor = path.join(cursor, segment);
    const stat = lstatOrNull(cursor);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      fail('SYMLINK_REJECTED', 'The private snapshot path must not contain a symbolic link or junction.');
    }
    let real;
    try {
      real = fs.realpathSync.native(cursor);
    } catch (_) {
      fail('SOURCE_INSPECTION_FAILED', 'The private snapshot path could not be resolved safely.');
    }
    if (normalized(real) !== normalized(cursor)) {
      fail('SYMLINK_REJECTED', 'The private snapshot path must not contain a symbolic link or junction.');
    }
  }
}

function nearestExistingDirectory(value) {
  let cursor = path.resolve(value);
  while (true) {
    const stat = lstatOrNull(cursor);
    if (stat) return stat.isDirectory() ? cursor : path.dirname(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function discoverRegisteredWorktrees(repoRoot = REPO_ROOT) {
  let output;
  try {
    output = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    fail('WORKTREE_DISCOVERY_FAILED', 'Git worktrees could not be enumerated; refusing private input.');
  }
  const roots = output.split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(Boolean);
  if (!roots.length) {
    fail('WORKTREE_DISCOVERY_FAILED', 'Git returned no worktrees; refusing private input.');
  }
  return roots;
}

function containingGitWorktree(value) {
  const existing = nearestExistingDirectory(value);
  if (!existing) return null;
  try {
    return execFileSync('git', ['-C', existing, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch (_) {
    return null;
  }
}

function assertPrivateSource(source, worktreeRoots, privacyOptions = {}) {
  if (!source || !path.isAbsolute(source)) {
    fail('ABSOLUTE_SOURCE_REQUIRED', 'Source must be an explicit absolute private filesystem path.');
  }
  const resolved = path.resolve(source);
  assertNoSymlinkComponents(resolved);
  for (const root of worktreeRoots) {
    if (isWithin(root, resolved)) {
      fail('WORKTREE_PATH_REJECTED', 'The private snapshot must be outside every registered Git worktree.');
    }
  }
  const containingRoot = containingGitWorktree(resolved);
  if (containingRoot && isWithin(containingRoot, resolved)) {
    fail('WORKTREE_PATH_REJECTED', 'The private snapshot must be outside every Git worktree.');
  }
  const stat = lstatOrNull(resolved);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    fail('SOURCE_NOT_REGULAR_FILE', 'Source must be an existing regular private snapshot file.');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail('PRIVATE_PERMISSIONS_REQUIRED', 'The private snapshot must not grant group or other access.');
  }
  try {
    assertWindowsPrivateFileAcl(resolved, privacyOptions);
  } catch (_) {
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The private snapshot ACL permits a broad principal or lacks owner full control.');
  }
  let bytes;
  try {
    bytes = fs.readFileSync(resolved);
  } catch (_) {
    fail('PRIVATE_READ_FAILED', 'The private snapshot could not be read safely.');
  }
  if (!bytes.length) fail('EMPTY_SNAPSHOT_REJECTED', 'An empty private snapshot cannot be stored.');
  return bytes;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--source', '--expected-sha256', '--artifact-kind'].includes(name)) {
      fail('ARGUMENT_REJECTED', 'Only --source, --expected-sha256, and --artifact-kind are accepted.');
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      fail('ARGUMENT_REJECTED', 'Every accepted option requires one value.');
    }
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      fail('ARGUMENT_REJECTED', 'Duplicate options are not accepted.');
    }
    values[name] = next;
    index += 1;
  }
  if (!values['--source'] || !values['--expected-sha256']) {
    fail('ARGUMENT_REJECTED', '--source and --expected-sha256 are both required.');
  }
  return {
    source: values['--source'],
    expectedSha256: values['--expected-sha256'],
    artifactKind: values['--artifact-kind'] || 'mirror-outbox',
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

async function driveAccessToken(account, fetchImpl, nowMs = Date.now()) {
  if (clean(account && account.token_uri) !== 'https://oauth2.googleapis.com/token') {
    fail('CREDENTIAL_REJECTED', 'The configured private Drive credential has a noncanonical token endpoint.');
  }
  let body;
  if (clean(account && account.refresh_token)) {
    body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: account.client_id,
      client_secret: account.client_secret,
      refresh_token: account.refresh_token,
    });
  } else {
    const now = Math.floor(nowMs / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: account.token_uri,
      iat: now,
      exp: now + 3600,
    })).toString('base64url');
    const unsigned = `${header}.${claims}`;
    let signature;
    try {
      signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
    } catch (_) {
      fail('CREDENTIAL_REJECTED', 'The configured private Drive credential could not sign an access request.');
    }
    body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    });
  }

  let response;
  try {
    response = await fetchImpl(account.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
    });
  } catch (_) {
    fail('TOKEN_REQUEST_FAILED', 'The private Drive access request failed closed.');
  }
  const payload = await responseJson(response, 'TOKEN_REQUEST_FAILED', 'The private Drive access request failed closed.');
  if (!clean(payload && payload.access_token)) {
    fail('TOKEN_REQUEST_FAILED', 'The private Drive access request returned no access token.');
  }
  return payload.access_token;
}

async function driveMetadata(token, fileId, fetchImpl) {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,parents,driveId,createdTime,modifiedTime,size,md5Checksum,capabilities(canAddChildren,canListChildren)',
    supportsAllDrives: 'true',
  });
  let response;
  try {
    response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
    });
  } catch (_) {
    fail('DRIVE_METADATA_FAILED', 'Private Drive metadata readback failed closed.');
  }
  return responseJson(response, 'DRIVE_METADATA_FAILED', 'Private Drive metadata readback failed closed.');
}

async function listExactName(token, name, folderId, driveId, fetchImpl) {
  let files;
  try {
    const noRedirectFetch = (url, init = {}) => fetchImpl(url, { ...init, redirect: 'error' });
    files = await listDriveFiles(token, `name = '${name}'`, noRedirectFetch, folderId, driveId);
  } catch (_) {
    fail('DRIVE_LIST_FAILED', 'Private Shared Drive collision check failed closed.');
  }
  if (!Array.isArray(files)) fail('DRIVE_LIST_FAILED', 'Private Shared Drive collision check was incomplete.');
  return files;
}

async function uploadBytes(token, bytes, name, folderId, fetchImpl) {
  const boundary = `f27_${crypto.randomBytes(12).toString('hex')}`;
  const metadata = Buffer.from(JSON.stringify({ name, parents: [folderId] }), 'utf8');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`), metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  let response;
  try {
    response = await fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents,driveId,createdTime,size,md5Checksum', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
      redirect: 'error',
    });
  } catch (_) {
    fail('DRIVE_UPLOAD_FAILED', 'Private Shared Drive upload failed closed.');
  }
  const payload = await responseJson(response, 'DRIVE_UPLOAD_FAILED', 'Private Shared Drive upload failed closed.');
  if (!clean(payload && payload.id)) fail('DRIVE_UPLOAD_FAILED', 'Private Shared Drive upload returned no object identity.');
  return payload;
}

async function downloadBytes(token, fileId, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
    });
  } catch (_) {
    fail('DRIVE_READBACK_FAILED', 'Independent private Shared Drive download failed closed.');
  }
  if (!response || response.ok !== true) {
    fail('DRIVE_READBACK_FAILED', 'Independent private Shared Drive download failed closed.');
  }
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (_) {
    fail('DRIVE_READBACK_FAILED', 'Independent private Shared Drive download was incomplete.');
  }
}

async function storePrivateSnapshot(options) {
  const artifactKind = clean(options && options.artifactKind) || 'mirror-outbox';
  const artifact = ARTIFACT_KINDS[artifactKind];
  if (!artifact) {
    fail('ARTIFACT_KIND_REJECTED', 'Artifact kind must be mirror-outbox or edge-source.');
  }
  const expectedSha256 = clean(options && options.expectedSha256);
  if (!HASH_RE.test(expectedSha256)) {
    fail('EXPECTED_HASH_REQUIRED', 'Expected SHA-256 must be exactly 64 lowercase hexadecimal characters.');
  }
  if (options && options.confirmed !== true) {
    fail('CONFIRMATION_REQUIRED', 'Explicit private snapshot upload confirmation is required.');
  }
  const folderId = clean(options && options.folderId);
  const credentialsInput = clean(options && options.credentialsInput);
  if (!folderId || !credentialsInput) {
    fail('PRIVATE_DESTINATION_CONFIG_REQUIRED', 'The provisioned private Drive folder and credential are both required.');
  }
  const fetchImpl = options && options.fetchImpl;
  if (typeof fetchImpl !== 'function') fail('FETCH_REQUIRED', 'A Drive transport is required.');

  let account;
  try {
    account = parseDriveCredentials(credentialsInput);
  } catch (_) {
    fail('CREDENTIAL_REJECTED', 'The configured private Drive credential is invalid.');
  }
  const worktreeRoots = options.worktreeRoots || discoverRegisteredWorktrees(options.repoRoot || REPO_ROOT);
  const localBytes = assertPrivateSource(
    options && options.source,
    worktreeRoots,
    {
      aclPlatform: options && options.aclPlatform,
      privateAclAdapter: options && options.privateAclAdapter,
    },
  );
  const localSha256 = sha256(localBytes);
  if (localSha256 !== expectedSha256) {
    fail('SOURCE_HASH_MISMATCH', 'Source SHA-256 does not match the operator-provided snapshot hash.');
  }

  const token = await driveAccessToken(account, fetchImpl, options.nowMs);
  const folderMetadata = await driveMetadata(token, folderId, fetchImpl);
  let context;
  try {
    // F27 is stricter than the generic Track-B helper: even an authorized-user
    // credential must resolve the configured folder to a Shared Drive.
    context = assertDriveFolderContext(folderMetadata, folderId, true);
  } catch (_) {
    fail('SHARED_DRIVE_REQUIRED', 'The configured destination is not the expected writable private Shared Drive folder.');
  }
  if (!clean(context && context.driveId)) {
    fail('SHARED_DRIVE_REQUIRED', 'The configured destination has no Shared Drive identity.');
  }

  const name = `${artifact.prefix}${localSha256}${artifact.extension}`;
  const existing = await listExactName(token, name, context.folderId, context.driveId, fetchImpl);
  if (existing.length) {
    fail('OBJECT_EXISTS', 'The immutable content-addressed private object already exists; overwrite refused.');
  }

  const uploaded = await uploadBytes(token, localBytes, name, context.folderId, fetchImpl);
  const uploadedId = clean(uploaded && uploaded.id);
  const metadata = await driveMetadata(token, uploadedId, fetchImpl);
  const remoteBytes = await downloadBytes(token, uploadedId, fetchImpl);

  try {
    assertDriveReadback(
      metadata,
      remoteBytes,
      localBytes,
      name,
      context.folderId,
      uploadedId,
      context.driveId,
    );
  } catch (_) {
    fail('READBACK_MISMATCH', 'Private Shared Drive metadata or byte readback did not match the captured snapshot.');
  }
  if (remoteBytes.length !== localBytes.length
      || sha256(remoteBytes) !== localSha256
      || clean(metadata && metadata.md5Checksum).toLowerCase() !== md5(localBytes)) {
    fail('READBACK_MISMATCH', 'Private Shared Drive SHA-256, length, or checksum readback did not match.');
  }

  // A second exact-name listing is the no-race publication check. The new
  // object must be the sole match in the exact folder and Shared Drive corpus.
  const published = await listExactName(token, name, context.folderId, context.driveId, fetchImpl);
  if (published.length !== 1 || clean(published[0] && published[0].id) !== uploadedId) {
    fail('OBJECT_COLLISION', 'Private Shared Drive publication is not uniquely content-addressed.');
  }

  return {
    status: 'PASS',
    artifact_kind: artifactKind,
    [artifact.hashField]: localSha256,
    byte_length: localBytes.length,
    independent_private_readback: 'PASS',
  };
}

function publicFailure(error) {
  if (error instanceof SnapshotStoreError) {
    return { status: 'FAIL', code: error.code, message: error.message };
  }
  return { status: 'FAIL', code: 'UNEXPECTED_FAILURE', message: 'Private snapshot storage failed closed.' };
}

async function runFromEnvironment(argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch) {
  const args = parseArgs(argv);
  return storePrivateSnapshot({
    ...args,
    confirmed: clean(env.F27_CONFIRM_PRIVATE_SNAPSHOT_UPLOAD) === '1',
    folderId: env.TRACK_B_BACKUP_DRIVE_FOLDER_ID,
    credentialsInput: env.TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON,
    fetchImpl,
  });
}

if (require.main === module) {
  runFromEnvironment().then(receipt => {
    process.stdout.write(`${JSON.stringify(receipt)}${os.EOL}`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}${os.EOL}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ARTIFACT_KINDS,
  FILENAME_PREFIX,
  SnapshotStoreError,
  assertPrivateSource,
  discoverRegisteredWorktrees,
  driveAccessToken,
  parseArgs,
  publicFailure,
  runFromEnvironment,
  storePrivateSnapshot,
};
