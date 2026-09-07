'use strict';
// Synthetic transport only. No credential lookup, provider calls or SyncView discovery.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), cp = require('node:child_process'), crypto = require('node:crypto');
const { collect, QUERIES } = require('../scripts/linear-raw-export.js');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-raw-export-test-'));
fs.chmodSync(scratch, 0o700);
const PRIVATE = 'synthetic_private_body_token_and_url';
const ORG = 'synthetic-organization';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
let passed = 0, external = 0;
global.fetch = () => { external++; throw Error('unexpected_network'); };
const org = () => ({ organization: { id: ORG, name: PRIVATE } });
const issue = id => ({ id, identifier: 'FIX-' + id, title: PRIVATE, description: PRIVATE,
  url: 'https://example.test/' + PRIVATE, createdAt: '2030-01-01', updatedAt: '2030-01-02', archivedAt: null, team: { id: 'team', key: 'FIX' } });
const comment = id => ({ id, body: PRIVATE, url: 'https://example.test/' + PRIVATE, createdAt: '2030-01-01', updatedAt: '2030-01-02', issue: { id: 'i1' } });
const attachment = id => ({ id, url: 'https://example.test/' + PRIVATE, title: PRIVATE, subtitle: null, issue: { id: 'i1' } });
const conn = (nodes, next = false, cursor = nodes.length ? 'end' : null) => ({ nodes, pageInfo: { hasNextPage: next, endCursor: cursor } });
const reply = data => ({ status: 200, body: Buffer.from(JSON.stringify({ data })) });
// Synthetic verifier only: it attests only this test's freshly created private-* fixtures.
// This is NOT a Windows ACL implementation and cannot authorize real exports.
function fixtureVerifier({ directory }) {
  assert.equal(path.dirname(directory), fs.realpathSync(scratch));
  assert.match(path.basename(directory), /^private-/);
  return { contract: 'linear_raw_export_directory_acl_v1', directory,
    access: 'owner_and_os_admins_only', inherited_acl_checked: true,
    verifier_id: 'synthetic_fixture', evidence_sha256: hash('synthetic fixture only:' + directory) };
}
function transport(rows, calls) {
  return async request => {
    const kind = Object.keys(QUERIES).find(key => QUERIES[key] === request.query);
    assert.ok(kind, 'only exact fixed query documents are offered');
    assert.ok(Object.isFrozen(request) && Object.isFrozen(request.variables));
    calls.push({ kind, variables: { ...request.variables } });
    assert.ok(rows.length, 'no extra request after terminal failure');
    const row = rows.shift();
    return typeof row === 'function' ? row(request) : reply(row);
  };
}
function basic() { return [org(), { issues: conn([issue('i1')]) }, { comments: conn([comment('c1')]) },
  { attachments: conn([attachment('a1')]) }, org()]; }
async function run(rows, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(scratch, 'private-')); fs.chmodSync(directory, 0o700);
  const calls = [];
  const result = await collect({ transport: transport(rows, calls), privateDirectory: directory,
    privateDirectoryConfirmed: true, privateDirectoryVerifier: fixtureVerifier, expectedOrganizationId: ORG, ...overrides });
  assert.equal(JSON.stringify(result).includes(PRIVATE), false, 'public result excludes private literals');
  assert.equal(JSON.stringify(result).includes(ORG), false, 'public result excludes organization identity');
  assert.equal(JSON.stringify(result).includes(directory), false, 'public result excludes private path');
  assert.equal(result.complete, false, 'never a certified complete export');
  const runs = fs.readdirSync(directory).filter(f => f.startsWith('linear-raw-'));
  let manifest, folder;
  if (result.artifact_sha256) {
    assert.equal(runs.length, 1); folder = path.join(directory, runs[0]);
    const file = path.join(folder, 'manifest-' + result.artifact_sha256 + '.json');
    const bytes = fs.readFileSync(file); assert.equal(hash(bytes), result.artifact_sha256);
    manifest = JSON.parse(bytes); assert.equal(manifest.complete, false); assert.equal(manifest.inventory_certified, false);
    for (const page of manifest.pages) {
      const raw = fs.readFileSync(path.join(folder, page.file));
      assert.equal(hash(raw), page.sha256); assert.equal(raw.length, page.byte_length);
      assert.equal(hash(QUERIES[page.operation]), page.query_sha256);
    }
  }
  return { result, calls, directory, manifest, folder };
}
async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function main() {
  await check('all fixed queries are reads with explicit collection scope', async () => {
    assert.equal(Object.keys(QUERIES).length, 4);
    for (const query of Object.values(QUERIES)) { assert.match(query, /^query /); assert.doesNotMatch(query, /\bmutation\b|\bsubscription\b/); }
    assert.match(QUERIES.issues, /includeArchived: true/); assert.match(QUERIES.issues, /description/);
    assert.match(QUERIES.comments, /body/); assert.match(QUERIES.attachments, /id url title subtitle/);
    assert.doesNotMatch(QUERIES.issues, /filter:|children\(/);
    for (const kind of ['issues', 'comments', 'attachments']) {
      assert.match(QUERIES[kind], /includeArchived: true, orderBy: createdAt/);
      assert.doesNotMatch(QUERIES[kind], /\$id|issue\(id:/);
    }
    for (const kind of ['comments', 'attachments']) assert.match(QUERIES[kind], /issue \{ id \}/);
  });
  await check('terminal collections retain raw bytes but never certify workspace/assets', async () => {
    const raw = Buffer.from('{ "data" : ' + JSON.stringify(org()) + ', "extensions":{"numeric":9007199254740993} }\n');
    const rows = basic(); rows[0] = () => ({ status: 200, body: raw });
    const r = await run(rows);
    assert.equal(r.result.status, 'COLLECTED_INCOMPLETE'); assert.equal(r.result.collection_completed, true);
    assert.deepEqual(r.result.counts, { requests: 5, pages: 5, nodes: 3, bytes: r.result.counts.bytes, issues: 1, comments: 1, attachments: 1, scope_gaps: 0 });
    assert.deepEqual(fs.readFileSync(path.join(r.folder, r.manifest.pages[0].file)), raw);
    assert.equal(r.manifest.completed_connections.length, 3); assert.ok(r.manifest.incomplete_reasons.length >= 7);
    assert.ok(fs.readFileSync(path.join(r.folder, r.manifest.pages[1].file), 'utf8').includes(PRIVATE));
  });
  await check('independent issue/comment/attachment cursors are exhausted', async () => {
    const rows = [org(), { issues: conn([issue('i1')], true, 'issue-next') }, { issues: conn([issue('i2')], false, 'issue-last') },
      { comments: conn([comment('c1')], true, 'comment-next') }, { comments: conn([comment('c2')], false, 'comment-last') },
      { attachments: conn([attachment('a1')], true, 'attachment-next') }, { attachments: conn([attachment('a2')], false, 'attachment-last') }, org()];
    const r = await run(rows, { limits: { pageSize: 1 } });
    assert.equal(r.result.collection_completed, true); assert.equal(r.result.counts.nodes, 6);
    assert.deepEqual(r.calls.filter(x => x.variables.after).map(x => x.variables.after), ['issue-next', 'comment-next', 'attachment-next']);
    assert.equal(r.manifest.completed_connections.length, 3); assert.equal(r.calls.length, 8);
  });
  await check('zero visible issues still reads both global relations and remains incomplete', async () => {
    const r = await run([org(), { issues: conn([]) }, { comments: conn([]) }, { attachments: conn([]) }, org()]);
    assert.equal(r.result.collection_completed, true); assert.equal(r.calls.length, 5); assert.equal(r.result.counts.nodes, 0);
  });
  for (const kind of ['issues', 'comments', 'attachments']) {
    await check(kind + ' duplicate IDs refuse with partial pages retained', async () => {
      const rows = basic(), at = { issues: 1, comments: 2, attachments: 3 }[kind];
      const node = { issues: issue, comments: comment, attachments: attachment }[kind]('duplicate');
      rows[at] = { [kind]: conn([node, node]) };
      const r = await run(rows);
      assert.equal(r.result.code, 'duplicate_id'); assert.equal(r.calls.length, at + 1); assert.equal(r.manifest.pages.length, at + 1);
    });
  }
  await check('duplicate issue across pages refuses rather than deduplicating away drift', async () => {
    const r = await run([org(), { issues: conn([issue('i1')], true, 'a') }, { issues: conn([issue('i1')], false, 'b') }]);
    assert.equal(r.result.code, 'duplicate_id');
  });
  for (const [name, bad, code] of [
    ['missing pageInfo', { nodes: [] }, 'pagination_invalid'],
    ['truthy hasNextPage', { nodes: [], pageInfo: { hasNextPage: 'false', endCursor: null } }, 'pagination_invalid'],
    ['missing terminal cursor field', { nodes: [], pageInfo: { hasNextPage: false } }, 'pagination_invalid'],
    ['empty continuing page', conn([], true, 'x'), 'pagination_invalid'],
    ['nonempty missing cursor', conn([issue('i1')], true, null), 'pagination_invalid'],
    ['missing requested body', conn([{ ...issue('i1'), description: undefined }]), 'node_invalid'],
  ]) await check(name + ' refuses', async () => { const r = await run([org(), { issues: bad }]); assert.equal(r.result.code, code); });
  await check('repeated cursor refuses even if final page uses different IDs', async () => {
    const r = await run([org(), { issues: conn([issue('i1')], true, 'same') }, { issues: conn([issue('i2')], false, 'same') }]);
    assert.equal(r.result.code, 'cursor_repeated');
  });
  await check('response larger than requested page refuses', async () => {
    const r = await run([org(), { issues: conn([issue('i1'), issue('i2')]) }], { limits: { pageSize: 1 } });
    assert.equal(r.result.code, 'pagination_invalid');
  });
  for (const [name, failure, code] of [
    ['HTTP refusal', () => ({ status: 429, body: Buffer.from(PRIVATE) }), 'http_failed'],
    ['GraphQL partial data', () => ({ status: 200, body: Buffer.from(JSON.stringify({ data: { issues: conn([]) }, errors: [{ message: PRIVATE }] })) }), 'graphql_failed'],
    ['GraphQL malformed errors', () => ({ status: 200, body: Buffer.from(JSON.stringify({ data: {}, errors: PRIVATE })) }), 'graphql_failed'],
    ['transport exception', () => { throw Error(PRIVATE); }, 'transport_failed'],
    ['invalid JSON', () => ({ status: 200, body: Buffer.from(PRIVATE) }), 'json_invalid'],
    ['invalid encoding', () => ({ status: 200, body: Buffer.from([0xc3, 0x28]) }), 'response_encoding_invalid'],
    ['body not raw bytes', () => ({ status: 200, body: PRIVATE }), 'response_invalid'],
  ]) await check(name + ' is sanitized and stops after partial capture', async () => {
    const r = await run([org(), failure]); assert.equal(r.result.code, code); assert.equal(r.calls.length, 2);
    assert.equal(r.result.collection_completed, false); assert.ok(r.manifest.pages.length >= 1);
  });
  await check('BOM is retained exactly and refused, not silently normalized', async () => {
    const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), reply(org()).body]);
    const r = await run([() => ({ status: 200, body: raw })]); assert.equal(r.result.code, 'json_invalid');
    assert.deepEqual(fs.readFileSync(path.join(r.folder, r.manifest.pages[0].file)), raw);
  });
  await check('both organization observations bind immutable expected identity', async () => {
    const rows = basic(); rows[4] = { organization: { id: 'different', name: PRIVATE } };
    const r = await run(rows); assert.equal(r.result.code, 'scope_mismatch'); assert.equal(r.result.collection_completed, false);
    const first = await run([{ organization: { id: 'different', name: PRIVATE } }]); assert.equal(first.calls.length, 1);
  });
  await check('global records with null or unknown issue membership remain as explicit scope gaps', async () => {
    const rows = basic(); rows[2].comments.nodes[0].issue = null; rows[3].attachments.nodes[0].issue = { id: 'different' };
    const r = await run(rows); assert.equal(r.result.collection_completed, true); assert.equal(r.result.counts.scope_gaps, 2);
    assert.deepEqual(r.manifest.scope_gaps.map(x => x.reason), ['issue_link_unavailable', 'issue_not_in_observed_collection']);
    assert.equal(r.result.counts.comments, 1); assert.equal(r.result.counts.attachments, 1);
    assert.equal(r.manifest.scope_gaps[1].issue_id, 'different');
  });
  for (const [limits, code] of [ [{ maxRequests: 2 }, 'request_budget'], [{ maxNodes: 1 }, 'node_budget'],
    [{ maxPageBytes: 2 }, 'byte_budget'], [{ maxBytes: 2 }, 'byte_budget'] ]) {
    await check(Object.keys(limits)[0] + ' budget leaves collection incomplete', async () => {
      const r = await run(basic(), { limits }); assert.equal(r.result.code, code); assert.equal(r.result.collection_completed, false);
    });
  }
  await check('timeout aborts and cannot adopt a later response or start a second call', async () => {
    let signal;
    const r = await run([request => { signal = request.signal; return new Promise(resolve => setTimeout(() => resolve(reply(org())), 20)); }], { limits: { requestTimeoutMs: 2 } });
    assert.equal(r.result.code, 'transport_timeout'); assert.equal(signal.aborted, true); assert.equal(r.calls.length, 1);
    assert.equal(r.manifest.pages.length, 0);
  });
  await check('duration budget refuses a returned page after the deadline', async () => {
    const now = Date.now;
    try {
      const r = await run([() => { Date.now = () => now() + 100; return reply(org()); }], { limits: { maxDurationMs: 50 } });
      assert.equal(r.result.code, 'duration_budget'); assert.equal(r.calls.length, 1);
    } finally { Date.now = now; }
  });
  await check('late global comment-page failure preserves earlier bodies without completing that connection', async () => {
    const r = await run([org(), { issues: conn([issue('i1')]) },
      { comments: conn([comment('c1')], true, 'next-comment') },
      () => { throw Error(PRIVATE); }]);
    assert.equal(r.result.code, 'transport_failed'); assert.equal(r.calls.length, 4);
    assert.equal(r.manifest.pages.length, 3); assert.equal(r.result.counts.comments, 1);
    assert.deepEqual(r.manifest.completed_connections.map(x => x.kind), ['issues']);
  });
  await check('missing or malformed ACL evidence cannot authorize Windows raw output', async () => {
    if (process.platform === 'win32') {
      const r = await run([], { privateDirectoryVerifier: undefined });
      assert.equal(r.result.code, 'private_verifier_required'); assert.equal(r.calls.length, 0);
    }
    for (const change of [() => false, () => ({ directory: 'wrong' }), input => ({ ...fixtureVerifier(input), directory: 'wrong' }),
      input => ({ ...fixtureVerifier(input), inherited_acl_checked: false }), input => ({ ...fixtureVerifier(input), evidence_sha256: null }),
      input => ({ ...fixtureVerifier(input), verifier_id: '' })]) {
      const r = await run([], { privateDirectoryVerifier: change }); assert.equal(r.result.code, 'private_verifier_refused'); assert.equal(r.calls.length, 0);
    }
    const shared = fs.mkdtempSync(path.join(scratch, 'public-shared-'));
    const r = await run([], { privateDirectory: shared });
    assert.equal(r.result.code, 'private_verifier_refused'); assert.equal(r.calls.length, 0);
  });
  await check('configuration and unsafe destinations refuse before any transport', async () => {
    const gitRoot = fs.mkdtempSync(path.join(scratch, 'repo-')); fs.mkdirSync(path.join(gitRoot, '.git'));
    const linked = path.join(scratch, 'linked-repository'); fs.symlinkSync(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
    for (const overrides of [{ privateDirectoryConfirmed: false }, { privateDirectory: 'relative' },
      { privateDirectory: root }, { privateDirectory: gitRoot }, { privateDirectory: linked },
      { privateDirectory: __filename }, { privateDirectory: path.parse(scratch).root },
      { limits: { pageSize: 101 } }, { limits: { unknown: 1 } }, { limits: { maxNodes: 0 } }]) {
      const r = await run([], overrides); assert.equal(r.result.status, 'REFUSED'); assert.equal(r.calls.length, 0);
    }
  });
  await check('repeat collection creates a new artifact and never overwrites prior raw bytes', async () => {
    const a = await run(basic()); const before = fs.readFileSync(path.join(a.folder, a.manifest.pages[0].file));
    const calls = []; const b = await collect({ transport: transport(basic(), calls), privateDirectory: a.directory,
      privateDirectoryConfirmed: true, privateDirectoryVerifier: fixtureVerifier, expectedOrganizationId: ORG });
    assert.equal(b.collection_completed, true); assert.notEqual(b.artifact_sha256, a.result.artifact_sha256);
    assert.deepEqual(fs.readFileSync(path.join(a.folder, a.manifest.pages[0].file)), before);
    assert.equal(fs.readdirSync(a.directory).length, 2);
  });
  await check('CLI is inert and emits no private arguments, environment or raw errors', async () => {
    const r = cp.spawnSync(process.execPath, [path.join(root, 'scripts/linear-raw-export.js'), PRIVATE],
      { env: { ...process.env, LINEAR_API_KEY: PRIVATE }, encoding: 'utf8' });
    assert.equal(r.status, 2); assert.equal(r.stderr, ''); assert.equal(r.stdout.includes(PRIVATE), false);
    assert.equal(JSON.parse(r.stdout).code, 'injected_transport_required');
  });
  assert.equal(external, 0);
  console.log(JSON.stringify({ passed, external_requests: external, classification: 'SYNTHETIC_TRANSPORT_ONLY', live_schema: 'UNPROVEN', inventory_certified: false }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
