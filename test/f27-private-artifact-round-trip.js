'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ARTIFACT_KINDS,
  PRIVATE_ARTIFACT_MIME_TYPE,
  storePrivateSnapshot,
} = require('../scripts/f27-private-snapshot-store');
const {
  confirmationPrefixForArtifactKind,
  fetchPrivateSnapshot,
} = require('../scripts/f27-private-snapshot-fetch');

let failures = 0;
const ROOT = path.resolve(__dirname, '..');
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

function parseMultipartUpload(init) {
  const contentType = String(init.headers && init.headers['Content-Type'] || '');
  const boundaryMatch = contentType.match(/^multipart\/related; boundary=(f27_[a-f0-9]+)$/);
  if (!boundaryMatch || !Buffer.isBuffer(init.body)) throw new Error('invalid multipart upload');
  const boundary = boundaryMatch[1];
  const firstHeadersEnd = init.body.indexOf(Buffer.from('\r\n\r\n'));
  const secondBoundary = Buffer.from(`\r\n--${boundary}\r\n`);
  const metadataStart = firstHeadersEnd + 4;
  const metadataEnd = init.body.indexOf(secondBoundary, metadataStart);
  const secondHeadersStart = metadataEnd + secondBoundary.length;
  const secondHeadersEnd = init.body.indexOf(Buffer.from('\r\n\r\n'), secondHeadersStart);
  const bytesStart = secondHeadersEnd + 4;
  const finalBoundary = Buffer.from(`\r\n--${boundary}--\r\n`);
  const bytesEnd = init.body.indexOf(finalBoundary, bytesStart);
  if ([firstHeadersEnd, metadataEnd, secondHeadersEnd, bytesEnd].some(index => index < 0)) {
    throw new Error('incomplete multipart upload');
  }
  return {
    metadata: JSON.parse(init.body.subarray(metadataStart, metadataEnd).toString('utf8')),
    mediaHeaders: init.body.subarray(secondHeadersStart, secondHeadersEnd).toString('utf8'),
    bytes: init.body.subarray(bytesStart, bytesEnd),
  };
}

function statefulDrive(bytes, folderId, driveId) {
  const objectId = 'fixture-private-object-id';
  const folder = {
    id: folderId,
    mimeType: 'application/vnd.google-apps.folder',
    driveId,
    capabilities: { canAddChildren: true, canListChildren: true },
  };
  let object = null;
  let uploadedMetadata = null;
  const calls = [];
  const fetchImpl = async (urlInput, init = {}) => {
    const url = new URL(String(urlInput));
    calls.push({ url: String(url), init });
    if (url.origin === 'https://oauth2.googleapis.com') {
      return jsonResponse({ access_token: 'fixture-access-token-never-log' });
    }
    if (url.pathname === `/drive/v3/files/${encodeURIComponent(folderId)}`) {
      return jsonResponse(folder);
    }
    if (url.pathname === '/upload/drive/v3/files') {
      const upload = parseMultipartUpload(init);
      if (!upload.bytes.equals(bytes)) throw new Error('store did not upload exact bytes');
      if (upload.mediaHeaders !== `Content-Type: ${PRIVATE_ARTIFACT_MIME_TYPE}`) {
        throw new Error('store did not pin binary media MIME');
      }
      uploadedMetadata = upload.metadata;
      object = {
        id: objectId,
        name: upload.metadata.name,
        mimeType: upload.metadata.mimeType,
        parents: upload.metadata.parents,
        driveId,
        size: String(bytes.length),
        md5Checksum: md5(bytes),
      };
      return jsonResponse({ id: objectId });
    }
    if (url.pathname === '/drive/v3/files') {
      const query = String(url.searchParams.get('q') || '');
      const files = object && query.includes(`name = '${object.name}'`) ? [object] : [];
      return jsonResponse({ files });
    }
    if (url.pathname === `/drive/v3/files/${encodeURIComponent(objectId)}`
        && url.searchParams.get('alt') === 'media') {
      return byteResponse(bytes);
    }
    if (url.pathname === `/drive/v3/files/${encodeURIComponent(objectId)}`) {
      return jsonResponse(object);
    }
    throw new Error('unexpected mocked Drive request');
  };
  return {
    calls,
    fetchImpl,
    uploadedMetadata: () => uploadedMetadata,
  };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-all-artifact-round-trip-'));
  const privateDirectory = path.join(tempRoot, 'private');
  const simulatedRepo = path.join(tempRoot, 'public-worktree');
  fs.mkdirSync(privateDirectory, { mode: 0o700 });
  fs.mkdirSync(simulatedRepo);
  if (process.platform !== 'win32') fs.chmodSync(privateDirectory, 0o700);
  const bytes = Buffer.from(`f27-private-artifact\0${'opaque'.repeat(2048)}`, 'utf8');
  const expectedSha256 = sha256(bytes);
  const source = path.join(privateDirectory, 'source.privateartifact');
  fs.writeFileSync(source, bytes, { mode: 0o600 });
  const folderId = 'fixture-private-folder-id';
  const driveId = 'fixture-shared-drive-id';
  const credentialsInput = JSON.stringify({
    client_id: 'fixture-client-id',
    client_secret: 'fixture-client-secret-never-log',
    refresh_token: 'fixture-refresh-token-never-log',
    token_uri: 'https://oauth2.googleapis.com/token',
  });

  try {
    for (const [artifactKind, artifact] of Object.entries(ARTIFACT_KINDS)) {
      const drive = statefulDrive(bytes, folderId, driveId);
      const stored = await storePrivateSnapshot({
        artifactKind,
        source,
        expectedSha256,
        confirmed: true,
        folderId,
        credentialsInput,
        fetchImpl: drive.fetchImpl,
        aclPlatform: 'linux',
        worktreeRoots: [simulatedRepo],
        nowMs: Date.parse('2026-08-02T12:00:00.000Z'),
      });
      const destination = path.join(
        privateDirectory,
        artifactKind === 'post-contract-inventory'
          ? 'fetched-post-contract.inventory.json'
          : `fetched-${artifactKind}${artifact.extension}`,
      );
      const fetched = await fetchPrivateSnapshot({
        artifactKind,
        confirmation: `${confirmationPrefixForArtifactKind(artifactKind)}:${expectedSha256}`,
        credentialsInput,
        destination,
        expectedByteLength: String(bytes.length),
        expectedSha256,
        fetchImpl: drive.fetchImpl,
        folderId,
        gitProbeRoots: [ROOT],
        nowMs: Date.parse('2026-08-02T12:00:00.000Z'),
      });
      const expectedName = `${artifact.prefix}${expectedSha256}${artifact.extension}`;
      const storedOutput = JSON.stringify(stored);
      const fetchedOutput = JSON.stringify(fetched);
      ok(stored.status === 'PASS'
        && fetched.status === 'PASS'
        && stored[artifact.hashField] === expectedSha256
        && fetched[artifact.hashField] === expectedSha256
        && stored.byte_length === bytes.length
        && fetched.byte_length === bytes.length
        && stored.folder_id_sha256 === fetched.folder_id_sha256
        && stored.independent_private_readback === 'PASS'
        && fetched.independent_private_readback === 'PASS'
        && fetched.local_private_readback === 'PASS'
        && Object.keys(stored).sort().join(',') === [
          'artifact_kind', 'byte_length', artifact.hashField, 'folder_id_sha256',
          'independent_private_readback', 'status',
        ].sort().join(',')
        && Object.keys(fetched).sort().join(',') === [
          'artifact_kind', 'byte_length', artifact.hashField, 'folder_id_sha256',
          'independent_private_readback', 'local_private_readback', 'status',
        ].sort().join(',')
        && drive.uploadedMetadata().name === expectedName
        && drive.uploadedMetadata().mimeType === PRIVATE_ARTIFACT_MIME_TYPE
        && drive.uploadedMetadata().parents.length === 1
        && fs.readFileSync(destination).equals(bytes)
        && !storedOutput.includes(folderId)
        && !storedOutput.includes(driveId)
        && !storedOutput.includes('fixture-private-object-id')
        && !storedOutput.includes(source)
        && !fetchedOutput.includes(folderId)
        && !fetchedOutput.includes(driveId)
        && !fetchedOutput.includes('fixture-private-object-id')
        && !fetchedOutput.includes(destination)
        && !fetchedOutput.includes('f27-private-artifact'),
      `${artifactKind} store output is accepted byte-for-byte by the strict private fetcher`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (failures) process.exit(1);
  console.log('\nF27 all-artifact private store/fetch round trips passed');
}

main().catch(error => {
  console.error('FAIL  hermetic F27 all-artifact round trip failed:', error && error.message || String(error));
  process.exit(1);
});
