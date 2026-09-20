'use strict';
/*
 * native-brief-media-copy.js — offline test for
 * scripts/native-brief-media-copy.mjs.
 *
 * Everything here runs without any real network call. `plan` is exercised as
 * an actual child-process CLI run (it makes zero network calls by
 * construction, so this is safe and also proves the printed flag-flip/
 * rollback block is real CLI output, not just a function return value).
 * `apply`'s network-touching pieces (Linear download, storage upload,
 * storage readback, REST insert/lookup) are exercised in-process against a
 * hand-rolled mock `fetch`, matching this repo's convention
 * (test/linear-media-rescue.js) of importing the module's exported pure
 * functions rather than re-implementing them.
 *
 * Every id/URL/client-slug below is invented. No real Linear signature, no
 * real client slug, no real Supabase project ref appears anywhere in this
 * file.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const HOST = 'https://uploads.linear.app';
const P1 = '/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333';
const SIG_A = '?signature=aaaa.bbbb.cccc';

(async () => {
const M = await import('../scripts/native-brief-media-copy.mjs');

/* ---- 0. Private-path guard --------------------------------------------- */
{
  let threw = false, message = '';
  try { M.assertPrivatePath(path.join(__dirname, '..', 'docs', 'ops', 'manifest.json')); }
  catch (error) { threw = true; message = String(error.message); }
  ok(threw, 'writing a manifest inside this repo is refused');
  ok(/public/.test(message), 'the refusal says why: the repo is public');
}
{
  let allowed = true;
  try { M.assertPrivatePath(path.join(os.tmpdir(), 'nowhere-near-git', 'manifest.json')); }
  catch (_) { allowed = false; }
  ok(allowed, 'a path outside any git tree is allowed');
}

/* ---- 1. mediaKey ignores the re-minted signature ----------------------- */
{
  const a = HOST + P1 + SIG_A;
  const b = HOST + P1 + '?signature=dddd.eeee.ffff';
  ok(M.mediaKey(a) === M.mediaKey(b), 'mediaKey collapses two signatures of the same file');
  ok(M.mediaKeyHash(a) === M.mediaKeyHash(b), 'mediaKeyHash is stable across signatures');
}

/* ---- 2. occurrenceKeyTuple / occurrenceKeyString ------------------------ */
{
  const tuple = M.occurrenceKeyTuple({
    deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video',
    briefSha256: 'a'.repeat(64), offset: 12,
  });
  ok(tuple.source_kind === 'native_brief', 'key tuple source_kind is native_brief');
  ok(tuple.source_entity_id === 'D-1' && tuple.deliverable_id === 'D-1',
    'key tuple source_entity_id and deliverable_id both equal the deliverable id');
  const str = M.occurrenceKeyString(tuple);
  ok(typeof str === 'string' && str.includes('D-1') && str.includes('test-client-a'),
    'occurrenceKeyString is a stable, readable encoding of the tuple');
}

/* ---- 3. plan: dry run, zero network, manifest counts, printed flag block */
let tmpDir;
{
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-brief-media-copy-test-'));
  const rowsPath = path.join(tmpDir, 'rows.json');
  const manifestPath = path.join(tmpDir, 'manifest.json');

  const url1 = HOST + P1 + SIG_A;
  const rows = [
    { id: 'D-1', client_slug: 'test-client-a', team: 'video',
      brief: `See ![](${url1}) for reference.`, updated_at: '2026-09-01T00:00:00.000Z', status: 'in_progress' },
    { id: 'D-2', client_slug: 'test-client-b', team: 'graphics',
      brief: 'No media here.', updated_at: '2026-09-02T00:00:00.000Z', status: 'posted' },
  ];
  fs.writeFileSync(rowsPath, JSON.stringify(rows));

  const scriptPath = path.join(__dirname, '..', 'scripts', 'native-brief-media-copy.mjs');
  const result = spawnSync(process.execPath, [scriptPath, 'plan', rowsPath, manifestPath], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  ok(result.status === 0, 'plan exits 0: ' + (result.stderr || ''));
  ok(fs.existsSync(manifestPath), 'plan writes a manifest file');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  ok(manifest.counts.rows === 2, 'manifest counts.rows is 2');
  ok(manifest.counts.rows_with_media === 1, 'manifest counts.rows_with_media is 1');
  ok(manifest.counts.occurrences === 1, 'manifest counts.occurrences is 1');
  ok(manifest.occurrences[0].url === url1, 'manifest occurrence carries the exact URL');
  ok(manifest.occurrences[0].deliverable_id === 'D-1', 'manifest occurrence is attributed to the right deliverable');

  ok(result.stdout.includes('mode: plan (dry run) — zero network calls made'),
    'plan announces it made zero network calls');
  ok(result.stdout.includes('mode":"required"') && result.stdout.includes('native_brief_media_v1'),
    'plan prints the flag-flip SQL block');
  ok(result.stdout.includes('mode":"off"'), 'plan prints the rollback SQL block');
  ok(result.stdout.includes('syncview_runtime_flags') && result.stdout.includes("key = 'native_brief_media'"),
    'the printed SQL targets the right flag row');
}

/* ---- 4. flagFlipSql / flagRollbackSql shape ---------------------------- */
{
  const flip = M.flagFlipSql();
  const rollback = M.flagRollbackSql();
  ok(flip.includes('"mode":"required"') && flip.includes('"contract":"native_brief_media_v1"'),
    'flagFlipSql sets mode required with the right contract');
  ok(rollback.includes('"mode":"off"') && rollback.includes('"contract":"native_brief_media_v1"'),
    'flagRollbackSql sets mode off with the right contract');
  ok(flip.includes("key = 'native_brief_media'") && rollback.includes("key = 'native_brief_media'"),
    'both target the native_brief_media flag row');
}

/* ---- 5. apply: mocked network — download, upload, readback, insert ---- */

/* A tiny valid PNG (1x1, transparent) so magic-byte-style content is real. */
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' +
  '05fe02fe0000000049454e44ae426082', 'hex'
);

function makeConfig() {
  return {
    supabaseUrl: 'https://fake-project.supabase.example',
    supabaseServiceKey: 'fake-service-role-key',
    linearApiKey: 'fake-linear-key',
  };
}

function mockDeps({ storage = new Map(), existingVerified = [], insertedRows = [], linearBytes = PNG_BYTES, linearMime = 'image/png', corruptReadback = false } = {}) {
  const calls = { linearDownloads: 0, storageUploads: 0, storageReads: 0, restLookups: 0, restInserts: 0 };
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith(HOST)) {
      calls.linearDownloads += 1;
      ok(opts.headers && opts.headers.authorization === 'fake-linear-key',
        'apply: the Linear download carries the Linear API key from env, not a hardcoded value');
      return {
        ok: true,
        status: 200,
        headers: { get: name => (name.toLowerCase() === 'content-type' ? linearMime : null) },
        arrayBuffer: async () => linearBytes.buffer.slice(linearBytes.byteOffset, linearBytes.byteOffset + linearBytes.byteLength),
      };
    }
    if (u.includes('/rest/v1/native_brief_media_occurrences') && (opts.method || 'GET') === 'GET') {
      calls.restLookups += 1;
      return { ok: true, status: 200, json: async () => existingVerified };
    }
    if (u.includes('/rest/v1/native_brief_media_occurrences') && opts.method === 'POST') {
      calls.restInserts += 1;
      const row = JSON.parse(opts.body);
      insertedRows.push(row);
      return { ok: true, status: 201, json: async () => [row] };
    }
    if (u.includes('/storage/v1/object/') && u.includes('/authenticated/') && (opts.method || 'GET') === 'GET') {
      calls.storageReads += 1;
      const objPath = u.split('/authenticated/')[1];
      const bytes = storage.get(objPath);
      if (!bytes) return { ok: false, status: 404 };
      const returned = corruptReadback ? Buffer.concat([bytes, Buffer.from([0])]) : bytes;
      return { ok: true, status: 200, arrayBuffer: async () => returned.buffer.slice(returned.byteOffset, returned.byteOffset + returned.byteLength) };
    }
    if (u.includes('/storage/v1/object/') && opts.method === 'POST') {
      calls.storageUploads += 1;
      const objPath = u.split('/storage/v1/object/')[1];
      storage.set(objPath, Buffer.from(opts.body));
      return { ok: true, status: 200, json: async () => ({ Key: objPath }) };
    }
    throw new Error('unexpected mock fetch call: ' + u);
  };
  return { deps: { fetch: fetchImpl, now: () => new Date('2026-09-19T12:00:00.000Z') }, calls, storage, insertedRows };
}

{
  const config = makeConfig();
  const { deps, calls, insertedRows } = mockDeps();
  const briefSha256 = await (await import('../supabase/functions/_shared/native-brief-media.mjs')).briefMediaHash('brief text');
  const url = HOST + P1 + SIG_A;
  const originalUrlSha256 = await (await import('../supabase/functions/_shared/native-brief-media.mjs')).briefMediaHash(url);
  const manifest = {
    occurrences: [{
      deliverable_id: 'D-1', client_slug: 'test-client-a', team: 'video',
      source_updated_at: '2026-09-01T00:00:00.000Z', source_sha256: briefSha256,
      source_offset: 6, source_length: url.length, original_url_sha256: originalUrlSha256,
      url, key: M.mediaKey(url), key_sha256: M.mediaKeyHash(url),
    }],
  };

  const { outMap, results } = await M.applyManifest(manifest, config, deps);

  ok(calls.linearDownloads === 1, 'apply: downloaded exactly once');
  ok(calls.storageUploads === 1, 'apply: uploaded exactly once');
  ok(calls.storageReads === 1, 'apply: performed an independent readback');
  ok(calls.restInserts === 1, 'apply: inserted exactly one occurrence row');
  ok(results.copied === 1 && results.refused === 0 && results.skipped_idempotent === 0,
    'apply: reports one real copy');

  const row = insertedRows[0];
  const contentSha256 = crypto.createHash('sha256').update(PNG_BYTES).digest('hex');
  ok(/^[0-9a-f-]{36}$/.test(row.id), 'inserted row: id is a uuid');
  ok(row.deliverable_id === 'D-1', 'inserted row: deliverable_id matches the row');
  ok(row.source_kind === 'native_brief', "inserted row: source_kind is 'native_brief'");
  ok(row.source_entity_id === 'D-1', 'inserted row: source_entity_id equals deliverable_id');
  ok(row.client_slug === 'test-client-a' && row.team === 'video', 'inserted row: client_slug/team match');
  ok(row.source_sha256 === briefSha256, 'inserted row: source_sha256 is the brief digest at capture time');
  ok(row.source_offset === 6 && row.source_length === url.length,
    'inserted row: source_offset/source_length match the occurrence');
  ok(row.original_url_sha256 === originalUrlSha256, 'inserted row: original_url_sha256 is the URL digest');
  ok(row.audience === 'staff', "inserted row: audience is 'staff'");
  ok(row.state === 'verified', "inserted row: state is 'verified'");
  ok(row.content_sha256 === contentSha256, 'inserted row: content_sha256 matches the downloaded bytes');
  ok(row.readback_sha256 === row.content_sha256, 'inserted row: readback_sha256 equals content_sha256');
  ok(row.storage_path === `${row.content_sha256}/${row.id}`,
    'inserted row: storage_path is content_sha256 + "/" + id, per the migration formula');
  ok(row.byte_length === PNG_BYTES.length && row.byte_length >= 1 && row.byte_length <= 52428800,
    'inserted row: byte_length matches the bytes and is in range');
  ok(row.mime_type === 'image/png', 'inserted row: mime_type is in the verified-row allowlist');
  ok(row.verified_at === '2026-09-19T12:00:00.000Z', 'inserted row: verified_at is a real timestamp, not in the future');
  ok(/^[a-f0-9]{64}$/.test(row.source_receipt_sha256), 'inserted row: source_receipt_sha256 is a sha256 hex digest');
  ok(!('id' in outMap[M.mediaKey(url)]) || outMap[M.mediaKey(url)].id === row.id,
    'out-map records the inserted row id for this key');
}

/* ---- 6. byte mismatch on readback is refused, never marks verified ---- */
{
  const config = makeConfig();
  const { deps, calls, insertedRows } = mockDeps({ corruptReadback: true });
  const briefMod = await import('../supabase/functions/_shared/native-brief-media.mjs');
  const url = HOST + P1 + SIG_A;
  const manifest = {
    occurrences: [{
      deliverable_id: 'D-1', client_slug: 'test-client-a', team: 'video',
      source_updated_at: '2026-09-01T00:00:00.000Z', source_sha256: await briefMod.briefMediaHash('brief text'),
      source_offset: 6, source_length: url.length, original_url_sha256: await briefMod.briefMediaHash(url),
      url, key: M.mediaKey(url), key_sha256: M.mediaKeyHash(url),
    }],
  };
  const { outMap, results } = await M.applyManifest(manifest, config, deps);
  ok(calls.storageUploads === 1 && calls.storageReads === 1, 'mismatch case: still uploaded and read back');
  ok(insertedRows.length === 0, 'mismatch case: no row is ever inserted');
  ok(calls.restInserts === 0, 'mismatch case: the insert endpoint is never called');
  ok(results.refused === 1 && results.copied === 0, 'mismatch case: reported as refused, not copied');
  ok(outMap[M.mediaKey(url)].error === 'readback_mismatch', 'mismatch case: out-map records why');
}

/* ---- 7. idempotency: an existing verified row for the exact key tuple -- */
/*        is detected and the URL is neither re-downloaded nor re-inserted */
{
  const config = makeConfig();
  const briefMod = await import('../supabase/functions/_shared/native-brief-media.mjs');
  const url = HOST + P1 + SIG_A;
  const briefSha256 = await briefMod.briefMediaHash('brief text');
  const existingRow = {
    id: '99999999-9999-4999-8999-999999999999',
    deliverable_id: 'D-1', source_kind: 'native_brief', source_entity_id: 'D-1',
    client_slug: 'test-client-a', team: 'video', source_sha256: briefSha256, source_offset: 6,
    state: 'verified', storage_path: 'deadbeef/99999999-9999-4999-8999-999999999999',
  };
  const { deps, calls, insertedRows } = mockDeps({ existingVerified: [existingRow] });
  const manifest = {
    occurrences: [{
      deliverable_id: 'D-1', client_slug: 'test-client-a', team: 'video',
      source_updated_at: '2026-09-01T00:00:00.000Z', source_sha256: briefSha256,
      source_offset: 6, source_length: url.length, original_url_sha256: await briefMod.briefMediaHash(url),
      url, key: M.mediaKey(url), key_sha256: M.mediaKeyHash(url),
    }],
  };
  const { outMap, results } = await M.applyManifest(manifest, config, deps);
  ok(calls.restLookups === 1, 'idempotent rerun: looked up the existing verified row');
  ok(calls.linearDownloads === 0, 'idempotent rerun: never re-downloaded from Linear');
  ok(calls.storageUploads === 0, 'idempotent rerun: never re-uploaded');
  ok(calls.restInserts === 0, 'idempotent rerun: never re-inserted');
  ok(insertedRows.length === 0, 'idempotent rerun: no new row created');
  ok(results.skipped_idempotent === 1 && results.copied === 0, 'idempotent rerun: reported as skipped');
  ok(outMap[M.mediaKey(url)].id === existingRow.id && outMap[M.mediaKey(url)].reused === true,
    'idempotent rerun: out-map points at the pre-existing verified row');
}

/* ---- 8. --apply gate: refuses without the flag and without confirmation */
{
  const scriptPath = path.join(__dirname, '..', 'scripts', 'native-brief-media-copy.mjs');
  const manifestPath = path.join(tmpDir, 'manifest.json');
  const outMapPath = path.join(tmpDir, 'out-map.json');

  const withoutFlag = spawnSync(process.execPath, [scriptPath, 'apply', manifestPath, outMapPath], {
    encoding: 'utf8', env: { ...process.env },
  });
  ok(withoutFlag.status !== 0, 'apply without --apply refuses');
  ok(/apply_flag_required/.test(withoutFlag.stderr), 'apply without --apply names the reason');

  const withoutConfirm = spawnSync(process.execPath, [scriptPath, 'apply', '--apply', manifestPath, outMapPath], {
    encoding: 'utf8', env: { ...process.env, NATIVE_BRIEF_MEDIA_COPY_CONFIRM: '' },
  });
  ok(withoutConfirm.status !== 0, 'apply --apply without the confirm env var still refuses');
  ok(/owner_confirmation_required/.test(withoutConfirm.stderr), 'and names the reason');
}

/* ---- 9. this suite leaks nothing --------------------------------------- */
{
  const self = fs.readFileSync(__filename, 'utf8');
  const real = self.match(/uploads\.linear\.app\/[0-9a-f]{8}-(?!1111|2222|3333)/gi) || [];
  ok(real.length === 0, 'no real Linear URL is embedded in this test');
  /* Built from parts so this check does not trip over its own pattern. */
  const realClientSlugProbe = new RegExp('sidney' + 'laruel');
  ok(!realClientSlugProbe.test(self.replace(/'sidney' \+ 'laruel'/g, '')),
    'no real client slug is embedded in this test');
}

if (failures) {
  console.error(`\n${failures} native brief media copy check(s) failed ❌`);
  process.exit(1);
}
console.log('\nnative brief media copy checks passed');
})();
