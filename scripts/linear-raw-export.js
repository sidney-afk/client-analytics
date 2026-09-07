'use strict';

// Foundation only: no credential lookup, network adapter, SyncView input or live CLI.
// The caller injects a reviewed transport that sends only the supplied query.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const QUERIES = Object.freeze({
  organization: 'query RawExportOrganization { organization { id name } }',
  issues: `query RawExportIssues($first: Int!, $after: String) {
    issues(first: $first, after: $after, includeArchived: true, orderBy: createdAt) {
      nodes { id identifier title description url createdAt updatedAt archivedAt team { id key } }
      pageInfo { hasNextPage endCursor }
    }
  }`,
  comments: `query RawExportComments($first: Int!, $after: String) {
    comments(first: $first, after: $after, includeArchived: true, orderBy: createdAt) {
      nodes { id body url createdAt updatedAt issue { id } }
      pageInfo { hasNextPage endCursor }
    }
  }`,
  attachments: `query RawExportAttachments($first: Int!, $after: String) {
    attachments(first: $first, after: $after, includeArchived: true, orderBy: createdAt) {
      nodes { id url title subtitle issue { id } }
      pageInfo { hasNextPage endCursor }
    }
  }`,
});
const LIMITS = Object.freeze({ pageSize: 100, maxRequests: 1000, maxNodes: 100000,
  maxPageBytes: 4 * 1024 * 1024, maxBytes: 64 * 1024 * 1024,
  requestTimeoutMs: 30000, maxDurationMs: 600000 });
const CODES = new Set(['configuration_invalid', 'private_path_required', 'private_path_unsafe',
  'private_directory_unconfirmed', 'private_permissions_required', 'private_verifier_required',
  'private_verifier_refused', 'transport_failed', 'transport_timeout',
  'response_invalid', 'response_encoding_invalid', 'http_failed', 'graphql_failed', 'json_invalid',
  'scope_mismatch', 'node_invalid', 'duplicate_id', 'pagination_invalid', 'cursor_repeated',
  'request_budget', 'node_budget', 'byte_budget', 'duration_budget', 'storage_failed']);
const INCOMPLETE_REASONS = Object.freeze([
  'Selected fields and credential-visible global issue/comment/attachment connections only; no exhaustive workspace or asset claim.',
  'includeArchived is requested for all three collections; deleted, inaccessible and API-omitted records are unproven.',
  'Pagination is not a transactional snapshot; concurrent edits/deletes and visibility changes can cause omissions.',
  'Projects/documents/cycles/history/reactions/users/custom entities and attachment bytes are not collected.',
  'Attachment metadata is limited to id/url/title/subtitle; opaque metadata and comment attachments are not enumerated.',
  'Provider schema/permission semantics, live pagination and an independent occurrence adapter remain unverified.',
  'No HMAC, source attestation, occurrence certification, asset rescue or retirement permission is created.',
]);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.length > 0 && value.length <= 4096; }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function within(base, candidate) {
  const rel = path.relative(base, candidate);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function privateRoot(value, confirmed, verifier) {
  if (confirmed !== true) fail('private_directory_unconfirmed');
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('private_path_required');
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root || within(path.resolve(__dirname, '..'), resolved)) fail('private_path_unsafe');
  try {
    // Reject repository ancestors and junction/symlink routing, including other worktrees.
    for (let current = resolved;; current = path.dirname(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory() || fs.existsSync(path.join(current, '.git'))) fail('private_path_unsafe');
      if (current === path.dirname(current)) break;
    }
    const real = fs.realpathSync(resolved);
    if (within(path.resolve(__dirname, '..'), real)) fail('private_path_unsafe');
    const stat = fs.statSync(real);
    if (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) fail('private_permissions_required');
    let verification = { basis: 'POSIX_OWNER_UID_AND_MODE', acl_verifier: null };
    if (process.platform === 'win32' && typeof verifier !== 'function') fail('private_verifier_required');
    if (verifier !== undefined) {
      if (typeof verifier !== 'function') fail('private_verifier_refused');
      let receipt;
      try { receipt = verifier(Object.freeze({ directory: real, platform: process.platform })); }
      catch { fail('private_verifier_refused'); }
      if (!object(receipt) || receipt.contract !== 'linear_raw_export_directory_acl_v1'
          || receipt.directory !== real || receipt.access !== 'owner_and_os_admins_only'
          || receipt.inherited_acl_checked !== true || !/^[a-f0-9]{64}$/.test(receipt.evidence_sha256)
          || !/^[a-z0-9_-]{1,80}$/.test(receipt.verifier_id)) fail('private_verifier_refused');
      verification = { basis: 'INJECTED_VERIFIER_ATTESTED_NOT_ENGINE_VERIFIED',
        acl_verifier: { contract: receipt.contract, directory: real, verifier_id: receipt.verifier_id,
          function_sha256: hash(String(verifier)), evidence_sha256: receipt.evidence_sha256,
          access: receipt.access, inherited_acl_checked: true } };
    }
    return { directory: real, verification };
  } catch (error) { if (CODES.has(error.code)) throw error; fail('private_path_unsafe'); }
}
function exclusiveFile(directory, name, bytes) {
  let fd;
  try {
    fd = fs.openSync(path.join(directory, name), 'wx', 0o600);
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.chmodSync(path.join(directory, name), 0o400);
  } catch { fail('storage_failed'); }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}
function optionsFor(options) {
  if (!object(options) || typeof options.transport !== 'function' || !text(options.expectedOrganizationId)) fail('configuration_invalid');
  if (options.limits !== undefined && !object(options.limits)) fail('configuration_invalid');
  const limits = { ...LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!own(LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > LIMITS[key]) fail('configuration_invalid');
  }
  return { limits, root: privateRoot(options.privateDirectory, options.privateDirectoryConfirmed, options.privateDirectoryVerifier) };
}

async function collect(options) {
  let run, manifest, limits, expectedOrganizationId, transport, completed = false;
  const started = Date.now();
  const counts = { requests: 0, pages: 0, nodes: 0, bytes: 0, issues: 0, comments: 0, attachments: 0, scope_gaps: 0 };
  try {
    const checked = optionsFor(options); limits = checked.limits;
    expectedOrganizationId = options.expectedOrganizationId; transport = options.transport;
    const exportId = crypto.randomUUID();
    try { run = fs.mkdtempSync(path.join(checked.root.directory, 'linear-raw-')); fs.chmodSync(run, 0o700); }
    catch { fail('storage_failed'); }
    manifest = {
      contract: 'syncview_linear_raw_export_foundation_v1', export_id: exportId,
      generator: { name: 'linear-raw-export.js', sha256: hash(fs.readFileSync(__filename)) },
      source: { system: 'linear', expected_organization_id: expectedOrganizationId, transport_provenance: 'INJECTED_NOT_ATTESTED' },
      started_at: new Date(started).toISOString(), complete: false, inventory_certified: false,
      collection_completed: false, status: 'FAILED_INCOMPLETE', limits,
      query_documents: QUERIES, pages: [], completed_connections: [], scope_gaps: [],
      incomplete_reasons: INCOMPLETE_REASONS,
      filesystem_privacy: checked.root.verification,
    };
    const globalSeen = { issues: new Set(), comments: new Set(), attachments: new Set() };
    const budget = () => { if (Date.now() - started >= limits.maxDurationMs) fail('duration_budget'); };
    async function request(kind, variables) {
      budget();
      if (counts.requests >= limits.maxRequests) fail('request_budget');
      counts.requests++;
      const controller = new AbortController(); let timer;
      let response;
      try {
        response = await Promise.race([
          Promise.resolve().then(() => transport(Object.freeze({
            query: QUERIES[kind], variables: Object.freeze({ ...variables }), signal: controller.signal,
          }))),
          new Promise((_, reject) => { timer = setTimeout(() => {
            controller.abort(); const error = new Error('transport_timeout'); error.code = 'transport_timeout'; reject(error);
          }, Math.min(limits.requestTimeoutMs, limits.maxDurationMs - (Date.now() - started))); }),
        ]);
      } catch (error) { fail(error && error.code === 'transport_timeout' ? 'transport_timeout' : 'transport_failed'); }
      finally { clearTimeout(timer); }
      if (!object(response) || !Number.isInteger(response.status) || response.status < 100 || response.status > 599
          || !(response.body instanceof Uint8Array)) fail('response_invalid');
      const bytes = Buffer.from(response.body);
      if (bytes.length > limits.maxPageBytes || counts.bytes + bytes.length > limits.maxBytes) fail('byte_budget');
      const digest = hash(bytes), file = String(counts.requests).padStart(6, '0') + '-' + digest + '.response';
      exclusiveFile(run, file, bytes);
      counts.bytes += bytes.length; counts.pages++;
      manifest.pages.push({ request: counts.requests, operation: kind, variables,
        query_sha256: hash(QUERIES[kind]), http_status: response.status, file, sha256: digest, byte_length: bytes.length });
      budget();
      if (response.status < 200 || response.status >= 300) fail('http_failed');
      let decoded, json;
      try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { fail('response_encoding_invalid'); }
      try { json = JSON.parse(decoded); } catch { fail('json_invalid'); }
      if (!object(json)) fail('response_invalid');
      if (own(json, 'errors') && (!Array.isArray(json.errors) || json.errors.length !== 0)) fail('graphql_failed');
      if (!object(json.data)) fail('response_invalid');
      return json.data;
    }
    async function organization() {
      const data = await request('organization', {});
      if (!object(data.organization) || data.organization.id !== expectedOrganizationId || typeof data.organization.name !== 'string') fail('scope_mismatch');
    }
    function validNode(kind, node) {
      if (!object(node) || !text(node.id)) fail('node_invalid');
      const required = kind === 'issues' ? ['identifier', 'title', 'description', 'url', 'createdAt', 'updatedAt', 'archivedAt']
        : kind === 'comments' ? ['body', 'url', 'createdAt', 'updatedAt'] : ['url', 'title', 'subtitle'];
      for (const key of required) {
        if (!own(node, key) || (typeof node[key] !== 'string' && node[key] !== null)) fail('node_invalid');
      }
      if (kind === 'comments' && typeof node.body !== 'string') fail('node_invalid');
      if (kind === 'issues' && (!object(node.team) || !text(node.team.id) || !text(node.team.key))) fail('node_invalid');
      if (kind !== 'issues' && (!own(node, 'issue') || (node.issue !== null && (!object(node.issue) || !text(node.issue.id))))) fail('node_invalid');
    }
    async function connection(kind) {
      let after = null, pages = 0, nodes = 0;
      const cursors = new Set();
      while (true) {
        const variables = { first: limits.pageSize, after };
        const data = await request(kind, variables);
        const conn = data[kind];
        if (!object(conn) || !Array.isArray(conn.nodes) || conn.nodes.length > limits.pageSize
            || !object(conn.pageInfo) || typeof conn.pageInfo.hasNextPage !== 'boolean'
            || !own(conn.pageInfo, 'endCursor')) fail('pagination_invalid');
        const { hasNextPage, endCursor } = conn.pageInfo;
        if (endCursor !== null && !text(endCursor)) fail('pagination_invalid');
        if ((hasNextPage || conn.nodes.length > 0) && !text(endCursor)) fail('pagination_invalid');
        if (hasNextPage && conn.nodes.length === 0) fail('pagination_invalid');
        if (endCursor !== null && cursors.has(endCursor)) fail('cursor_repeated');
        if (endCursor !== null) cursors.add(endCursor);
        for (const node of conn.nodes) {
          validNode(kind, node);
          if (globalSeen[kind].has(node.id)) fail('duplicate_id');
          if (counts.nodes >= limits.maxNodes) fail('node_budget');
          globalSeen[kind].add(node.id); counts.nodes++; counts[kind]++; nodes++;
          if (kind !== 'issues' && (!node.issue || !globalSeen.issues.has(node.issue.id))) {
            counts.scope_gaps++;
            manifest.scope_gaps.push({ kind, node_id: node.id, issue_id: node.issue ? node.issue.id : null,
              reason: node.issue ? 'issue_not_in_observed_collection' : 'issue_link_unavailable' });
          }
        }
        pages++;
        if (!hasNextPage) break;
        after = endCursor;
      }
      manifest.completed_connections.push({ kind, pages, nodes, terminal_cursor_observed: true });
    }
    await organization();
    for (const kind of ['issues', 'comments', 'attachments']) await connection(kind);
    await organization();
    completed = true;
  } catch (error) {
    const code = error && CODES.has(error.code) ? error.code : 'unexpected_failure';
    if (!manifest) return { status: 'REFUSED', code, complete: false, collection_completed: false, artifact_sha256: null };
    manifest.failure_code = code;
  }
  manifest.collection_completed = completed;
  manifest.status = completed ? 'COLLECTED_INCOMPLETE' : 'FAILED_INCOMPLETE';
  manifest.finished_at = new Date().toISOString(); manifest.counts = counts;
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), digest = hash(bytes);
  try { exclusiveFile(run, 'manifest-' + digest + '.json', bytes); }
  catch { return { status: 'FAILED_UNRECORDED', code: 'storage_failed', complete: false,
    collection_completed: false, artifact_sha256: null, counts }; }
  // Public-safe summary only. Private paths, raw provider errors and identities never escape here.
  return { status: manifest.status, code: manifest.failure_code || null, complete: false,
    collection_completed: completed, artifact_sha256: digest, counts };
}

module.exports = { collect, QUERIES, LIMITS };
if (require.main === module) {
  process.stdout.write(JSON.stringify({ status: 'REFUSED', code: 'injected_transport_required', complete: false }) + '\n');
  process.exitCode = 2;
}
