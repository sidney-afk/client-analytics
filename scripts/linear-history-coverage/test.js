#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { scan, hash, textUrls, providerUrl } = require('./scan');
const { ROOT, readerHelpers } = require('./reader-helpers');
const { makeFixture, AT, url } = require('./fixtures/synthetic');
const key = Buffer.alloc(32, 17);
const run = f => scan(f, { key });
const locator = { table: 'calendar_posts', client_scope: 'fictional-a', row_id: 'card-a', field: 'asset_url', ordinal: 0 };
const mapping = () => ({ locator, source_url: url('video'), target_url: 'https://objects.example.test/private-copy',
  mapping_observation: { observed_at: AT, evidence_sha256: hash('fictional-mapping-receipt') },
  storage: { provider_independent: true, source_sha256: hash('fictional-bytes'), readback_sha256: hash('fictional-bytes'), byte_length: 15, observed_at: AT, evidence_sha256: hash('fictional-readback-receipt') } });
const observation = () => ({ locator, url: url('video'), principal: 'anonymous_client', observed_at: AT,
  result: 'failure', reason: 'permission_denied', evidence_sha256: hash('fictional-observation') });
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('independent denominators cover every category and duplicates', async () => {
  const r = await run(makeFixture());
  assert.equal(r.status, 'bounded_inventory');
  assert.deepEqual(r.category_counts, { card_media: 4, card_text: 2, comment_body: 16, attachment: 3, deliverable_brief: 1, archive_reference: 2, thumbnail_storage: 2, unsupported_field: 0 });
  assert.equal(r.supplied_reference_occurrences, 30);
  assert.equal(r.supplied_unique_resources, 29);
  assert.deepEqual(r.counts, { independently_stored: 0, provider_dependent: 26, inaccessible: 0, unsupported: 0, unproven: 4 });
  assert.equal(r.estate_total_references, null);
  assert.equal(r.full_linear_independence, 'UNPROVEN');
});
test('real audience and thread helpers preserve replies and resolved history', async () => {
  const r = await run(makeFixture());
  assert.deepEqual(r.thread_counts, { client_card_rows: 7, client_canonical_candidates: 2, staff_internal_rows: 4,
    archived_card_rows: 0, hidden_or_deleted_rows: 3, orphan_reply_rows: 0, resolved_roots: 2, reply_rows: 3 });
  assert.equal(r.references.filter(x => x.scope === 'client_card_candidate' && x.lifecycle === 'resolved_history').length, 3);
  assert.equal(r.references.filter(x => x.scope === 'hidden_or_deleted').length, 4);
});
test('real public projection strips deleted bodies and attachments and internal audience', async () => {
  const p = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/production-comments/policy.mjs')).href);
  const f = makeFixture();
  assert.equal(p.publicComment(f.data.production_comments[2], 'client'), null);
  const deleted = p.publicComment(f.data.production_comments[3], 'client');
  assert.equal(deleted.body, 'Comment deleted.'); assert.deepEqual(deleted.attachments, []);
  assert.equal(p.clientSurfaceTargetAllowed({ source_surface: 'calendar', card_id: 'card-a', component: 'video' }, { origin: 'calendar', card_id: 'card-a', team: 'video' }), false);
  assert.equal(p.clientSurfaceTargetAllowed({ source_surface: 'sxr', card_id: 'card-b', component: 'video' }, { origin: 'samples', card_id: 'card-b', team: 'video' }), true);
});
test('real canonical gate preserves calendar fallback, Samples hold and exact binding', () => {
  const h = readerHelpers();
  h._writeUiNativeId = () => 'd';
  h._prodCrosswalkVerdict = () => ({ state: 'valid' });
  h._prodVerifiedClientCommentSurfaceContext = () => null;
  h._prodClientCommentSurfaceKey = x => JSON.stringify(x);
  const post = { _canonicalCommentReads: { d: { status: 'ready', client: true, clientSurface: { card: 'a' } } } };
  assert.equal(h._prodCanonicalCommentGate(post, 'video').linked, false);
  h._prodVerifiedClientCommentSurfaceContext = () => ({ card: 'a' });
  assert.equal(h._prodCanonicalCommentGate(post, 'video').ready, true);
  h._prodVerifiedClientCommentSurfaceContext = () => ({ card: 'b' });
  assert.equal(h._prodCanonicalCommentGate(post, 'video').ready, false);
  post._canonicalCommentReads.d.status = 'legacy_retained';
  assert.equal(h._prodCanonicalCommentGate(post, 'video').linked, false);
  h._prodCrosswalkVerdict = () => ({ state: 'invalid' });
  assert.equal(h._prodCanonicalCommentGate(post, 'video').linked, false);
});
test('Markdown inline images, reference links and balanced URL parentheses', () => {
  assert.deepEqual(textUrls('![x](https://uploads.linear.app/a(b)) <https://example.test/a>\n[x]: https://linear.app/team/issue.'),
    ['https://uploads.linear.app/a(b)', 'https://example.test/a', 'https://linear.app/team/issue']);
  assert.equal(providerUrl('https://linear.app.evil.test/a'), false);
  assert.equal(providerUrl('https://uploads.linear.app/a'), true);
});
test('mapping plus independent byte readback does not establish client access', async () => {
  const f = makeFixture(); f.mappings = [mapping()];
  const r = await run(f);
  assert.equal(r.counts.independently_stored, 1);
  assert.equal(r.references.find(x => x.classification === 'independently_stored').client_accessibility, 'unproven');
});
test('missing, mismatched and conflicting mappings remain unproven', async () => {
  for (const mutate of [m => { delete m.storage; }, m => { m.storage.readback_sha256 = hash('wrong'); }, m => { m.mapping_observation.observed_at = '2099-01-01T00:00:00Z'; }]) {
    const f = makeFixture(), m = mapping(); mutate(m); f.mappings = [m];
    assert.equal((await run(f)).counts.independently_stored, 0);
    assert.equal((await run(f)).counts.unproven, 5);
  }
  const f = makeFixture(); f.mappings = [mapping(), mapping()]; assert.equal((await run(f)).counts.independently_stored, 0);
});
test('observed inaccessible original can coexist with independent storage', async () => {
  const f = makeFixture(); f.mappings = [mapping()]; f.observations = [observation()];
  const r = await run(f); assert.equal(r.counts.inaccessible, 1);
  const row = r.references.find(x => x.classification === 'inaccessible');
  assert.equal(row.storage_independence, 'supplied_mapping_and_readback');
});
test('inaccessible mapped object is distinct from the original client path', async () => {
  const f = makeFixture(); f.mappings = [mapping()]; f.observations = [{ ...observation(), url: mapping().target_url }];
  const r = await run(f);
  assert.equal(r.references[0].storage_independence, 'supplied_mapping_and_readback');
  assert.equal(r.references[0].client_accessibility, 'unproven');
  assert.equal(r.references[0].mapped_copy_accessibility, 'supplied_failure');
});
test('signed URL semantics are never inferred; supplied expired observation counts', async () => {
  const f = makeFixture(); const signed = f.data.sample_reviews[0].asset_url;
  assert.equal((await run(f)).counts.inaccessible, 0);
  f.observations = [{ ...observation(), locator: { table: 'sample_reviews', client_scope: 'fictional-b', row_id: 'card-b', field: 'asset_url', ordinal: 0 }, url: signed, reason: 'expired_signed_url' }];
  assert.equal((await run(f)).counts.inaccessible, 1);
});
test('observations cannot transfer across principals, locations, URLs or future dates', async () => {
  for (const patch of [{ principal: 'staff' }, { locator: { ...locator, row_id: 'wrong' } }, { locator: { ...locator, client_scope: 'wrong' } }, { url: url('wrong') }, { observed_at: '2099-01-01T00:00:00Z' }, { evidence_sha256: '' }]) {
    const f = makeFixture(); f.observations = [{ ...observation(), ...patch }]; assert.equal((await run(f)).counts.inaccessible, 0);
  }
});
test('HTTP success alone is not visual retrieval; conflict remains unresolved', async () => {
  const f = makeFixture(); f.observations = [{ ...observation(), result: 'retrieved' }];
  assert.equal((await run(f)).references[0].client_accessibility, 'unproven');
  f.observations[0].content_sha256 = hash('bytes'); f.observations[0].rendered_correct = true;
  assert.equal((await run(f)).references[0].client_accessibility, 'supplied_retrieval_and_render_observation');
  f.observations.push(observation());
  assert.equal((await run(f)).references[0].client_accessibility, 'conflicting_observations');
});
test('missing metadata/table/field/pagination/omissions never means complete', async () => {
  for (const mutate of [f => delete f.metadata, f => delete f.data.calendar_posts, f => delete f.data.calendar_posts[0].graphic_tweaks,
    f => { f.metadata.tables.calendar_posts.pagination.complete = false; }, f => { f.metadata.tables.calendar_posts.pagination.next_cursor = 'private-next'; },
    f => { f.metadata.tables.calendar_posts.pagination.expected_rows = 500; }, f => { f.metadata.known_omissions = ['private omission']; },
    f => { f.metadata.tables.calendar_posts.fields = ['id']; }, f => { delete f.mappings; }]) {
    const f = makeFixture(); mutate(f); const r = await run(f); assert.equal(r.status, 'incomplete'); assert.equal(r.estate_total_references, null);
  }
});
test('empty partial snapshot is incomplete with unknown estate denominator', async () => {
  const r = await run({ contract: makeFixture().contract, data: {} });
  assert.equal(r.status, 'incomplete'); assert.equal(r.supplied_reference_occurrences, 0); assert.equal(r.estate_total_references, null);
});
test('unsupported JSON body, rich HTML, data image and invalid legacy JSON remain gaps', async () => {
  for (const body of [{ type: 'doc', content: [{ url: url('rich') }] }, '<img src="' + url('html') + '">', '![x](data:image/png;base64,AAAA)']) {
    const f = makeFixture(); f.data.production_comments[0].body = body;
    if (typeof body === 'string' && body.startsWith('<img')) f.data.production_comments[0].body_format = 'html';
    const r = await run(f); assert.equal(r.status, 'incomplete'); assert.ok(r.counts.unsupported > 0);
  }
  const f = makeFixture(); f.data.calendar_posts[0].video_tweaks = '[broken private body';
  assert.ok((await run(f)).extraction_gaps.some(g => g.code === 'legacy_comment_parse_incomplete'));
});
test('orphan reply and attachment overflow cannot disappear as success', async () => {
  const f = makeFixture(); f.data.calendar_posts[0].graphic_tweaks = JSON.stringify([{ id: 'orphan', parent_id: 'absent', body: url('orphan'), audience: 'client' }]);
  assert.equal((await run(f)).thread_counts.orphan_reply_rows, 1);
  f.data.production_comments[0].attachments = Array.from({ length: 21 }, () => ({ url: url('attachment') }));
  assert.ok((await run(f)).extraction_gaps.some(g => g.code === 'attachment_beyond_canonical_reader_limit'));
});
test('mapping is occurrence-specific even for duplicated resource URLs', async () => {
  const f = makeFixture(); f.data.calendar_posts[0].thumbnail_url = url('video'); f.mappings = [mapping()];
  const r = await run(f); assert.equal(r.counts.independently_stored, 1); assert.equal(r.references[1].classification, 'provider_dependent');
});
test('output is an allowlist: metadata, bodies, identifiers, names and tokens never echo', async () => {
  const f = makeFixture(); f.metadata.source.description = 'SECRET-NAME'; f.metadata.known_omissions = ['SECRET-OMISSION'];
  f.data.calendar_posts[0].id = 'SECRET-CLIENT-ID'; f.data.calendar_posts[0].asset_url = url('private?token=SECRET-TOKEN');
  f.data.linear_archive[0].raw = { 'SECRET-KEY': { body: url('SECRET-URL') } };
  const output = JSON.stringify(await run(f));
  for (const secret of ['SECRET-', 'https://', 'fictional-a', 'fictional-b', 'Fictional file', 'card-a', 'card-b']) assert.equal(output.includes(secret), false);
});
test('per-run opaque handles resist predictable identifier hashing', async () => {
  const f = makeFixture(); const a = await scan(f), b = await scan(f);
  assert.notEqual(a.references[0].reference_hash, b.references[0].reference_hash);
  assert.equal(a.snapshot_digest, b.snapshot_digest);
});
test('CLI accepts only local input, redacts failures and returns incomplete exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-coverage-test-'));
  try {
    const file = path.join(dir, 'SECRET-input.json');
    fs.writeFileSync(file, JSON.stringify({ contract: makeFixture().contract, data: {} }));
    const cli = args => spawnSync(process.execPath, [path.join(__dirname, 'scan.js'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
    const incomplete = cli(['--input', file]); assert.equal(incomplete.status, 2); assert.equal(JSON.parse(incomplete.stdout).status, 'incomplete');
    fs.writeFileSync(file, '{SECRET-invalid-json');
    const invalid = cli(['--input', file]); assert.equal(invalid.status, 1); assert.equal((invalid.stdout + invalid.stderr).includes('SECRET'), false);
    assert.equal(cli(['--input', file, '--apply']).status, 1);
  } finally {
    const expectedParent = fs.realpathSync(os.tmpdir());
    const resolved = fs.realpathSync(dir);
    assert.equal(path.dirname(resolved), expectedParent);
    assert.ok(path.basename(resolved).startsWith('history-coverage-test-'));
    fs.rmSync(resolved, { recursive: true });
  }
});
test('scanner path has no network or operational module entrypoint', async () => {
  const original = global.fetch; global.fetch = () => { throw new Error('network forbidden'); };
  try { assert.equal((await run(makeFixture())).supplied_reference_occurrences, 30); }
  finally { global.fetch = original; }
  const source = fs.readFileSync(path.join(__dirname, 'scan.js'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|require\(['"](?:https?|net|child_process)|process\.env|\.writeFile/);
});
test('real Samples parser does not borrow Calendar legacy text seeding', async () => {
  const f = makeFixture(); f.data.sample_reviews[0].video_tweaks = 'legacy prose ' + url('legacy');
  const r = await run(f);
  assert.equal(r.status, 'incomplete');
  assert.ok(r.extraction_gaps.some(g => g.table === 'sample_reviews' && g.code === 'legacy_comment_parse_incomplete'));
  f.data.calendar_posts[0].video_tweaks = 'legacy prose ' + url('legacy');
  const a = await run(f);
  assert.ok(a.references.some(x => x.table === 'calendar_posts' && x.category === 'comment_body' && x.scope === 'staff_internal'));
});
test('a sidecar alternative prevents an only-known-Linear-path claim without proving storage', async () => {
  const f = makeFixture(); f.data.linear_archive_asset_refs = [{ ref_id: 'ref-a', original_url: url('video'), rescued_url: 'https://drive.example.test/copy', state: 'rescued' }];
  const r = await run(f);
  assert.equal(r.references[0].classification, 'unproven');
  assert.equal(r.counts.independently_stored, 0);
});
test('future fields, duplicate row identities and derived media identifiers are not silently complete', async () => {
  const f = makeFixture(); f.data.calendar_posts[0].future_asset = { url: url('future') };
  let r = await run(f); assert.equal(r.status, 'incomplete'); assert.equal(r.category_counts.unsupported_field, 1);
  delete f.data.calendar_posts[0].future_asset;
  f.data.calendar_posts[0].thumbnail_file_id = 'fictional-drive-id';
  r = await run(f); assert.equal(r.counts.unsupported, 1);
  f.data.calendar_posts[0].thumbnail_file_id = null;
  f.data.calendar_posts.push({ ...f.data.calendar_posts[0] }); f.mappings = [mapping()];
  f.metadata.tables.calendar_posts.pagination.expected_rows = 2; f.metadata.tables.calendar_posts.pagination.returned_rows = 2;
  r = await run(f); assert.equal(r.status, 'incomplete'); assert.equal(r.counts.independently_stored, 0);
});
test('archived card references stay outside current client card candidates', async () => {
  const f = makeFixture(); f.data.calendar_posts[0].status = 'Archived';
  const r = await run(f);
  assert.equal(r.references.filter(x => x.table === 'calendar_posts' && x.scope === 'client_card_candidate').length, 0);
  assert.equal(r.thread_counts.archived_card_rows, 9);
  assert.equal(r.supplied_reference_occurrences, 30);
});

async function main() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const sources = ['index.html', 'scripts/f34-linear-asset-rescue.js', 'supabase/functions/production-comments/policy.mjs',
    'test/helpers/extract-function.js', 'scripts/linear-history-coverage/scan.js', 'scripts/linear-history-coverage/reader-helpers.js',
    'scripts/linear-history-coverage/test.js', 'scripts/linear-history-coverage/fixtures/synthetic.js'];
  console.log(JSON.stringify({ evidence_class: 'OFFLINE_TEST', started_at: new Date().toISOString(), head: head.status === 0 ? head.stdout.trim() : null,
    source_sha256: Object.fromEntries(sources.map(f => [f, hash(fs.readFileSync(path.join(ROOT, f)))])) }));
  let failures = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('PASS ' + name); }
    catch (error) { failures++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(JSON.stringify({ evidence_class: 'OFFLINE_TEST', passed: tests.length - failures, failed: failures }));
  process.exitCode = failures ? 1 : 0;
}
if (require.main === module) main().catch(() => { console.error('FAIL test harness'); process.exitCode = 1; });
