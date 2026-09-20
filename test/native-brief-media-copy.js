'use strict';
/*
 * native-brief-media-copy.js — offline test for
 * scripts/native-brief-media-copy.mjs.
 *
 * Everything here runs without any real network call. `plan` is exercised as
 * an actual child-process CLI run (it makes zero network calls by
 * construction, so this is safe and also proves the printed rollback block
 * is real CLI output, not just a function return value). `apply` is
 * exercised in-process, via the exported `cmdApply`, against a hand-rolled
 * mock `fetch` covering all four network surfaces it touches: Linear's
 * GraphQL re-fetch (fresh signature), the Linear asset download, Supabase
 * Storage upload + readback, and PostgREST lookup/insert — matching this
 * repo's convention (test/linear-media-rescue.js) of importing the module's
 * exported functions rather than re-implementing them.
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
const P2 = '/11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555';
const SIG_STALE = '?signature=stale.stale.stale';
const SIG_FRESH = '?signature=fresh.fresh.fresh';
const SIG_FRESH_B = '?signature=freshb.freshb.freshb';

(async () => {
const M = await import('../scripts/native-brief-media-copy.mjs');
const briefMod = await import('../supabase/functions/_shared/native-brief-media.mjs');

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
  const a = HOST + P1 + SIG_STALE;
  const b = HOST + P1 + SIG_FRESH;
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

/* ---- 3. plan: dry run, zero network, manifest counts, printed rollback -- */
let tmpDir;
{
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-brief-media-copy-test-'));
  const rowsPath = path.join(tmpDir, 'rows.json');
  const manifestPath = path.join(tmpDir, 'manifest.json');

  const url1 = HOST + P1 + SIG_STALE;
  const rows = [
    { id: 'D-1', client_slug: 'test-client-a', team: 'video', linear_issue_uuid: 'issue-uuid-1',
      brief: `See ![](${url1}) for reference.`, updated_at: '2026-09-01T00:00:00.000Z', status: 'in_progress' },
    { id: 'D-2', client_slug: 'test-client-b', team: 'graphics', linear_issue_uuid: 'issue-uuid-2',
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
  ok(manifest.occurrences[0].linear_issue_uuid === 'issue-uuid-1',
    'manifest occurrence carries the linear_issue_uuid needed to re-resolve a fresh signature');

  ok(result.stdout.includes('mode: plan (dry run) — zero network calls made'),
    'plan announces it made zero network calls');
  ok(result.stdout.includes('NOT YET ELIGIBLE'),
    'plan (no apply run yet) prints the not-yet-eligible flip notice, never a templated/inert flip');
  ok(!/"mode":"required"/.test(result.stdout),
    'plan never prints a fake "required" flip — recovery/coverage receipts do not exist yet');
  ok(result.stdout.includes('"mode":"off"') && result.stdout.includes('"contract":"native_brief_media_v1"'),
    'plan prints the real, always-valid rollback SQL block');
  ok(result.stdout.includes('syncview_runtime_flags') && result.stdout.includes("key = 'native_brief_media'"),
    'the printed rollback SQL targets the right flag row');
}

/* ---- 4. flagFlipSql / flagRollbackSql / receipt gating ----------------- */
{
  const noReceipts = M.flagFlipSql();
  ok(noReceipts.includes('NOT YET ELIGIBLE'), 'flagFlipSql() with no receipts refuses to print a real flip');
  ok(!/"mode":"required"/.test(noReceipts), 'and never fakes the mode:required JSON');

  const incomplete = M.flagFlipSql({ coverage: { complete: false }, recoveryReceiptSha256: 'a'.repeat(64) });
  ok(incomplete.includes('NOT YET ELIGIBLE'), 'flagFlipSql() with incomplete coverage still refuses');

  const receipts = { coverage: { complete: true, sha256: 'b'.repeat(64) }, recoveryReceiptSha256: 'c'.repeat(64) };
  const flip = M.flagFlipSql(receipts);
  ok(flip.includes('"mode":"required"') && flip.includes('"contract":"native_brief_media_v1"'),
    'flagFlipSql(realReceipts) sets mode required with the right contract');
  ok(flip.includes('"recovery_contract":"native_brief_media_recovery_v1"'),
    'and includes the recovery_contract projectBriefMedia() requires');
  ok(flip.includes(`"recovery_receipt_sha256":"${'c'.repeat(64)}"`),
    'and includes the real recovery_receipt_sha256');
  ok(flip.includes(`"coverage_receipt_sha256":"${'b'.repeat(64)}"`),
    'and includes the real coverage_receipt_sha256');
  ok(flip.includes("key = 'native_brief_media'"), 'flip targets the native_brief_media flag row');

  const rollback = M.flagRollbackSql();
  ok(rollback.includes('"mode":"off"') && rollback.includes('"contract":"native_brief_media_v1"'),
    'flagRollbackSql sets mode off with the right contract');
  ok(!rollback.includes('recovery_contract'),
    'rollback needs no receipts — projectBriefMedia() short-circuits on mode:"off" before reading them');
  ok(rollback.includes("key = 'native_brief_media'"), 'rollback targets the native_brief_media flag row');
}

/* ---- 5. apply infrastructure: mock fetch covering all four surfaces ---- */

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

/**
 * `graphqlIssues`: { [linear_issue_uuid]: description } — the FRESH Linear
 * description text `resolveFreshUrl` re-reads and re-scans for a fresh
 * signature. The mocked GraphQL response never returns the stale URL that
 * was in `brief`; only this fresh description does, proving apply cannot
 * work by GETting the historical URL directly.
 */
function mockDeps({
  storage = new Map(), existingVerified = [], insertedRows = [],
  linearBytes = PNG_BYTES, linearMime = 'image/png', corruptReadback = false,
  graphqlIssues = {},
} = {}) {
  const calls = { graphql: 0, linearDownloads: 0, staleUrlGets: 0, storageUploads: 0, storageReads: 0, restLookups: 0, restInserts: 0 };
  const staleUrls = new Set();
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if (u === 'https://api.linear.app/graphql') {
      calls.graphql += 1;
      ok(opts.headers && opts.headers.authorization === 'fake-linear-key',
        'apply: the GraphQL re-fetch carries the Linear API key from env');
      const body = JSON.parse(opts.body);
      const id = body.variables.id;
      const description = graphqlIssues[id];
      if (!description) return { ok: true, status: 200, json: async () => ({ data: { issue: null } }) };
      return { ok: true, status: 200, json: async () => ({ data: { issue: { id, description } } }) };
    }
    if (u.startsWith(HOST)) {
      if (staleUrls.has(u)) calls.staleUrlGets += 1;
      calls.linearDownloads += 1;
      ok(opts.headers && opts.headers.authorization === 'fake-linear-key',
        'apply: the Linear asset download carries the Linear API key from env');
      return {
        ok: true,
        status: 200,
        headers: { get: name => (name.toLowerCase() === 'content-type' ? linearMime : null) },
        arrayBuffer: async () => linearBytes.buffer.slice(linearBytes.byteOffset, linearBytes.byteOffset + linearBytes.byteLength),
      };
    }
    if (u.includes('/rest/v1/native_brief_media_occurrences') && (opts.method || 'GET') === 'GET') {
      calls.restLookups += 1;
      const params = new URLSearchParams(u.split('?')[1]);
      const matches = existingVerified.filter(row =>
        `eq.${row.deliverable_id}` === params.get('deliverable_id') &&
        `eq.${row.client_slug}` === params.get('client_slug') &&
        `eq.${row.team}` === params.get('team') &&
        `eq.${row.source_sha256}` === params.get('source_sha256') &&
        String(row.source_offset) === params.get('source_offset').replace('eq.', ''));
      return { ok: true, status: 200, json: async () => matches };
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
  return {
    deps: { fetch: fetchImpl, now: () => new Date('2026-09-19T12:00:00.000Z') },
    calls, storage, insertedRows, staleUrls,
  };
}

function makeOccurrence({ deliverableId, clientSlug, team, linearIssueUuid, staleUrl, offset, briefSha256, originalUrlSha256, sourceLength }) {
  return {
    deliverable_id: deliverableId, client_slug: clientSlug, team,
    linear_issue_uuid: linearIssueUuid,
    source_updated_at: '2026-09-01T00:00:00.000Z', source_sha256: briefSha256,
    source_offset: offset, source_length: sourceLength, original_url_sha256: originalUrlSha256,
    url: staleUrl, key: M.mediaKey(staleUrl), key_sha256: M.mediaKeyHash(staleUrl),
  };
}

/* ---- 6. apply resolves a FRESH signed URL through Linear's GraphQL API - */
/*        rather than GETting the historical, already-401 URL in `brief`   */
{
  const config = makeConfig();
  const staleUrl = HOST + P1 + SIG_STALE;
  const freshUrl = HOST + P1 + SIG_FRESH;
  const briefSha256 = await briefMod.briefMediaHash('brief text');
  const originalUrlSha256 = await briefMod.briefMediaHash(staleUrl);

  const { deps, calls, insertedRows, staleUrls } = mockDeps({
    graphqlIssues: { 'issue-uuid-1': `Fresh description ![](${freshUrl}) after re-read.` },
  });
  staleUrls.add(staleUrl); // the mock would flag it as a call if apply ever GETs it directly

  const manifest = {
    occurrences: [makeOccurrence({
      deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video',
      linearIssueUuid: 'issue-uuid-1', staleUrl, offset: 6, briefSha256, originalUrlSha256,
      sourceLength: staleUrl.length,
    })],
  };

  const { outMap, results } = await M.applyManifest(manifest, config, deps);

  ok(calls.graphql === 1, 'apply: re-read the issue through Linear GraphQL exactly once before downloading');
  ok(calls.staleUrlGets === 0, 'apply: NEVER GETs the historical/stale URL stored in brief directly');
  ok(calls.linearDownloads === 1, 'apply: downloaded exactly once, and only the freshly-resolved URL');
  ok(calls.storageUploads === 1 && calls.storageReads === 1, 'apply: uploaded once and read back independently');
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
  ok(row.source_offset === 6 && row.source_length === staleUrl.length,
    'inserted row: source_offset/source_length match the occurrence');
  ok(row.original_url_sha256 === originalUrlSha256, 'inserted row: original_url_sha256 is the (stale) URL digest — the reader hashes the URL as captured');
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

  const tupleKey = M.occurrenceKeyString(M.occurrenceKeyTuple({
    deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video', briefSha256, offset: 6,
  }));
  ok(outMap[tupleKey] && outMap[tupleKey].id === row.id, 'out-map records the inserted row id under its tuple key');
}

/* ---- 6b. a stale signature that can no longer be resolved refuses, does */
/*         not crash, and is reported as refused                          */
{
  const config = makeConfig();
  const staleUrl = HOST + P1 + SIG_STALE;
  const briefSha256 = await briefMod.briefMediaHash('brief text');
  const { deps, calls } = mockDeps({ graphqlIssues: {} /* issue not found / no matching fresh occurrence */ });
  const manifest = {
    occurrences: [makeOccurrence({
      deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video',
      linearIssueUuid: 'issue-uuid-missing', staleUrl, offset: 6, briefSha256,
      originalUrlSha256: await briefMod.briefMediaHash(staleUrl), sourceLength: staleUrl.length,
    })],
  };
  const { outMap, results } = await M.applyManifest(manifest, config, deps);
  ok(calls.linearDownloads === 0, 'unresolvable signature: never falls back to GETting the stale URL');
  ok(results.refused === 1 && results.copied === 0, 'unresolvable signature: reported as refused, not copied, not a crash');
  const tupleKey = M.occurrenceKeyString(M.occurrenceKeyTuple({
    deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video', briefSha256, offset: 6,
  }));
  ok(typeof outMap[tupleKey].error === 'string' && outMap[tupleKey].error.length > 0,
    'and the out-map names why');
}

/* ---- 7. the same file across TWO deliverables gets TWO verified rows -- */
/*        (the reader scopes its lookup per deliverable/client/team), but */
/*        the byte download itself happens only once                     */
{
  const config = makeConfig();
  const staleUrl = HOST + P2 + SIG_STALE;
  const freshUrlA = HOST + P2 + SIG_FRESH;
  const freshUrlB = HOST + P2 + SIG_FRESH_B;
  const briefA = 'brief for deliverable A';
  const briefB = 'brief for deliverable B, different text but the same pasted file';
  const briefSha256A = await briefMod.briefMediaHash(briefA);
  const briefSha256B = await briefMod.briefMediaHash(briefB);
  const originalUrlSha256 = await briefMod.briefMediaHash(staleUrl);

  const { deps, calls, insertedRows } = mockDeps({
    graphqlIssues: {
      'issue-uuid-A': `See ![](${freshUrlA}) here.`,
      'issue-uuid-B': `And ![](${freshUrlB}) here too.`,
    },
  });

  const manifest = {
    occurrences: [
      makeOccurrence({
        deliverableId: 'D-A', clientSlug: 'test-client-a', team: 'video',
        linearIssueUuid: 'issue-uuid-A', staleUrl, offset: 4, briefSha256: briefSha256A,
        originalUrlSha256, sourceLength: staleUrl.length,
      }),
      makeOccurrence({
        deliverableId: 'D-B', clientSlug: 'test-client-b', team: 'graphics',
        linearIssueUuid: 'issue-uuid-B', staleUrl, offset: 4, briefSha256: briefSha256B,
        originalUrlSha256, sourceLength: staleUrl.length,
      }),
    ],
  };

  const { outMap, results } = await M.applyManifest(manifest, config, deps);

  ok(calls.graphql === 1, 'shared file: the GraphQL re-fetch (and its Linear download) happens once, cached by mediaKey');
  ok(calls.linearDownloads === 1, 'shared file: only one Linear asset download for two occurrences of the same file');
  ok(calls.storageUploads === 2 && calls.storageReads === 2,
    'shared file: TWO separate storage writes+readbacks — one per reader-scoped row, since storage_path is tied to the row\'s own id');
  ok(calls.restInserts === 2, 'shared file: TWO separate occurrence rows inserted, one per deliverable');
  ok(results.copied === 2 && results.refused === 0, 'shared file: both occurrences report as copied');
  ok(insertedRows.length === 2, 'shared file: two distinct rows exist');

  const rowA = insertedRows.find(r => r.deliverable_id === 'D-A');
  const rowB = insertedRows.find(r => r.deliverable_id === 'D-B');
  ok(rowA && rowB, 'shared file: one row per deliverable');
  ok(rowA.id !== rowB.id, 'shared file: each row has its own id');
  ok(rowA.storage_path !== rowB.storage_path,
    'shared file: each row has its own storage_path (content_sha256 is the same, id is not)');
  ok(rowA.content_sha256 === rowB.content_sha256, 'shared file: both rows agree on the same downloaded bytes');
  ok(rowA.client_slug === 'test-client-a' && rowB.client_slug === 'test-client-b',
    'shared file: each row keeps its own client_slug — this is exactly what projectBriefMedia() scopes its lookup by');
  ok(rowA.team === 'video' && rowB.team === 'graphics', 'shared file: each row keeps its own team');

  const tupleA = M.occurrenceKeyString(M.occurrenceKeyTuple({
    deliverableId: 'D-A', clientSlug: 'test-client-a', team: 'video', briefSha256: briefSha256A, offset: 4,
  }));
  const tupleB = M.occurrenceKeyString(M.occurrenceKeyTuple({
    deliverableId: 'D-B', clientSlug: 'test-client-b', team: 'graphics', briefSha256: briefSha256B, offset: 4,
  }));
  ok(outMap[tupleA] && outMap[tupleA].id === rowA.id, 'out-map has a distinct entry for deliverable A');
  ok(outMap[tupleB] && outMap[tupleB].id === rowB.id, 'out-map has a distinct entry for deliverable B');
}

/* ---- 8. byte mismatch on readback is refused, never marks verified ---- */
{
  const config = makeConfig();
  const staleUrl = HOST + P1 + SIG_STALE;
  const freshUrl = HOST + P1 + SIG_FRESH;
  const briefSha256 = await briefMod.briefMediaHash('brief text');
  const { deps, calls, insertedRows } = mockDeps({
    corruptReadback: true,
    graphqlIssues: { 'issue-uuid-1': `![](${freshUrl})` },
  });
  const manifest = {
    occurrences: [makeOccurrence({
      deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video',
      linearIssueUuid: 'issue-uuid-1', staleUrl, offset: 6, briefSha256,
      originalUrlSha256: await briefMod.briefMediaHash(staleUrl), sourceLength: staleUrl.length,
    })],
  };
  const { outMap, results } = await M.applyManifest(manifest, config, deps);
  ok(calls.storageUploads === 1 && calls.storageReads === 1, 'mismatch case: still uploaded and read back');
  ok(insertedRows.length === 0, 'mismatch case: no row is ever inserted');
  ok(calls.restInserts === 0, 'mismatch case: the insert endpoint is never called');
  ok(results.refused === 1 && results.copied === 0, 'mismatch case: reported as refused, not copied');
  const tupleKey = M.occurrenceKeyString(M.occurrenceKeyTuple({
    deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video', briefSha256, offset: 6,
  }));
  ok(outMap[tupleKey].error === 'readback_mismatch', 'mismatch case: out-map records why');
}

/* ---- 9. idempotency: an existing verified row for the exact key tuple -- */
/*        is detected and the URL is neither re-resolved, re-downloaded,   */
/*        nor re-inserted                                                  */
{
  const config = makeConfig();
  const staleUrl = HOST + P1 + SIG_STALE;
  const briefSha256 = await briefMod.briefMediaHash('brief text');
  const existingRow = {
    id: '99999999-9999-4999-8999-999999999999',
    deliverable_id: 'D-1', source_kind: 'native_brief', source_entity_id: 'D-1',
    client_slug: 'test-client-a', team: 'video', source_sha256: briefSha256, source_offset: 6,
    state: 'verified', storage_path: 'deadbeef/99999999-9999-4999-8999-999999999999',
  };
  const { deps, calls, insertedRows } = mockDeps({ existingVerified: [existingRow] });
  const manifest = {
    occurrences: [makeOccurrence({
      deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video',
      linearIssueUuid: 'issue-uuid-1', staleUrl, offset: 6, briefSha256,
      originalUrlSha256: await briefMod.briefMediaHash(staleUrl), sourceLength: staleUrl.length,
    })],
  };
  const { outMap, results } = await M.applyManifest(manifest, config, deps);
  ok(calls.restLookups === 1, 'idempotent rerun: looked up the existing verified row');
  ok(calls.graphql === 0, 'idempotent rerun: never re-resolves a fresh signature');
  ok(calls.linearDownloads === 0, 'idempotent rerun: never re-downloaded from Linear');
  ok(calls.storageUploads === 0, 'idempotent rerun: never re-uploaded');
  ok(calls.restInserts === 0, 'idempotent rerun: never re-inserted');
  ok(insertedRows.length === 0, 'idempotent rerun: no new row created');
  ok(results.skipped_idempotent === 1 && results.copied === 0, 'idempotent rerun: reported as skipped');
  const tupleKey = M.occurrenceKeyString(M.occurrenceKeyTuple({
    deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video', briefSha256, offset: 6,
  }));
  ok(outMap[tupleKey].id === existingRow.id && outMap[tupleKey].reused === true,
    'idempotent rerun: out-map points at the pre-existing verified row');
}

/* ---- 10. computeCoverageReceipt / computeRecoveryReceipt --------------- */
{
  const briefSha256 = await briefMod.briefMediaHash('brief text');
  const tuple = M.occurrenceKeyTuple({ deliverableId: 'D-1', clientSlug: 'test-client-a', team: 'video', briefSha256, offset: 6 });
  const tupleKey = M.occurrenceKeyString(tuple);
  const manifest = { occurrences: [{ deliverable_id: 'D-1', client_slug: 'test-client-a', team: 'video', source_sha256: briefSha256, source_offset: 6 }] };

  const incomplete = M.computeCoverageReceipt(manifest, {});
  ok(incomplete.complete === false, 'coverage receipt: empty out-map is not complete');

  const complete = M.computeCoverageReceipt(manifest, { [tupleKey]: { id: 'x', reused: false } });
  ok(complete.complete === true, 'coverage receipt: every tuple resolved without error is complete');
  ok(/^[a-f0-9]{64}$/.test(complete.sha256), 'coverage receipt sha256 is a real sha256 hex digest');

  const withError = M.computeCoverageReceipt(manifest, { [tupleKey]: { error: 'unsupported_mime_type' } });
  ok(withError.complete === false, 'coverage receipt: a refused tuple is not coverage');

  const recovery = M.computeRecoveryReceipt({ [tupleKey]: { id: 'row-1', storage_path: 'aa/row-1', reused: false } });
  ok(/^[a-f0-9]{64}$/.test(recovery), 'recovery receipt is a real sha256 hex digest');
  const recoveryAgain = M.computeRecoveryReceipt({ [tupleKey]: { id: 'row-1', storage_path: 'aa/row-1', reused: false } });
  ok(recovery === recoveryAgain, 'recovery receipt is deterministic over the same out-map');
  const recoveryWithError = M.computeRecoveryReceipt({ [tupleKey]: { error: 'x' } });
  ok(recovery !== recoveryWithError, 'recovery receipt excludes refused entries, so it differs');
}

/* ---- 11. apply CLI end-to-end: a full, zero-gap run prints the REAL --- */
/*         flip with real receipts; an incomplete run prints the notice   */
{
  const staleUrl = HOST + P1 + SIG_STALE;
  const freshUrl = HOST + P1 + SIG_FRESH;
  const rowsPath = path.join(tmpDir, 'apply-rows.json');
  const manifestPath = path.join(tmpDir, 'apply-manifest.json');
  const outMapPath = path.join(tmpDir, 'apply-out-map.json');
  fs.writeFileSync(rowsPath, JSON.stringify([{
    id: 'D-1', client_slug: 'test-client-a', team: 'video', linear_issue_uuid: 'issue-uuid-1',
    brief: `See ![](${staleUrl}) for reference.`, updated_at: '2026-09-01T00:00:00.000Z', status: 'in_progress',
  }]));
  const manifest = await M.buildManifest(JSON.parse(fs.readFileSync(rowsPath, 'utf8')));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const { deps } = mockDeps({ graphqlIssues: { 'issue-uuid-1': `![](${freshUrl})` } });
  const env = { SUPABASE_URL: 'https://fake-project.supabase.example', SUPABASE_SERVICE_ROLE_KEY: 'k', LINEAR_API_KEY: 'fake-linear-key', NATIVE_BRIEF_MEDIA_COPY_CONFIRM: 'COPY_NATIVE_BRIEF_MEDIA' };

  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  let result;
  try {
    result = await M.cmdApply(manifestPath, outMapPath, ['--apply'], env, deps);
  } finally {
    console.log = originalLog;
  }
  const printed = lines.join('\n');

  ok(result.results.copied === 1 && result.results.refused === 0, 'apply CLI: one clean copy, zero refusals');
  ok(result.receipts.coverage.complete === true, 'apply CLI: coverage is complete after a zero-gap run');
  ok(printed.includes('"mode":"required"'), 'apply CLI: prints the REAL flip after a full, zero-gap run');
  ok(printed.includes('"recovery_contract":"native_brief_media_recovery_v1"'),
    'apply CLI: the real flip includes recovery_contract');
  ok(new RegExp('"recovery_receipt_sha256":"' + result.receipts.recoveryReceiptSha256 + '"').test(printed),
    'apply CLI: the real flip includes the actual recovery_receipt_sha256 this run computed');
  ok(new RegExp('"coverage_receipt_sha256":"' + result.receipts.coverage.sha256 + '"').test(printed),
    'apply CLI: the real flip includes the actual coverage_receipt_sha256 this run computed');
  ok(printed.includes('"mode":"off"'), 'apply CLI: also prints the rollback block');
  ok(fs.existsSync(outMapPath), 'apply CLI: writes the out-map file');
}
{
  /* Same shape, but the GraphQL re-fetch never finds a matching fresh
     occurrence — coverage is incomplete, so the flip must stay the notice. */
  const staleUrl = HOST + P1 + SIG_STALE;
  const rowsPath = path.join(tmpDir, 'apply-rows-2.json');
  const manifestPath = path.join(tmpDir, 'apply-manifest-2.json');
  const outMapPath = path.join(tmpDir, 'apply-out-map-2.json');
  fs.writeFileSync(rowsPath, JSON.stringify([{
    id: 'D-2', client_slug: 'test-client-a', team: 'video', linear_issue_uuid: 'issue-uuid-missing',
    brief: `See ![](${staleUrl}) for reference.`, updated_at: '2026-09-01T00:00:00.000Z', status: 'in_progress',
  }]));
  const manifest = await M.buildManifest(JSON.parse(fs.readFileSync(rowsPath, 'utf8')));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const { deps } = mockDeps({ graphqlIssues: {} });
  const env = { SUPABASE_URL: 'https://fake-project.supabase.example', SUPABASE_SERVICE_ROLE_KEY: 'k', LINEAR_API_KEY: 'fake-linear-key', NATIVE_BRIEF_MEDIA_COPY_CONFIRM: 'COPY_NATIVE_BRIEF_MEDIA' };

  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  let result;
  try {
    result = await M.cmdApply(manifestPath, outMapPath, ['--apply'], env, deps);
  } finally {
    console.log = originalLog;
  }
  const printed = lines.join('\n');
  ok(result.results.refused === 1, 'apply CLI (incomplete run): the unresolved occurrence is refused');
  ok(!printed.includes('"mode":"required"'), 'apply CLI (incomplete run): never prints the real flip');
  ok(printed.includes('NOT YET ELIGIBLE'), 'apply CLI (incomplete run): prints the not-yet-eligible notice instead');
}

/* ---- 12. --apply gate: refuses without the flag and without confirmation */
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

/* ---- 13. this suite leaks nothing --------------------------------------- */
{
  const self = fs.readFileSync(__filename, 'utf8');
  const real = self.match(/uploads\.linear\.app\/[0-9a-f]{8}-(?!1111|2222|3333|4444|5555)/gi) || [];
  ok(real.length === 0, 'no real Linear URL is embedded in this test');
  /* Built from parts so this check does not trip over its own pattern. */
  const realClientSlugProbe = new RegExp('sidney' + 'laruel');
  ok(!realClientSlugProbe.test(self.replace(/'sidney' \+ 'laruel'/g, '')),
    'no real client slug is embedded in this test');
}

{
  /* CLI entrypoint guard must compare through pathToFileURL: the string form
     `file://${process.argv[1]}` never matches on Windows (argv[1] is `C:\...`,
     import.meta.url is `file:///C:/...`), so `plan` exited 0 with no output
     when first run live on 2026-09-20. Same guard in linear-media-rescue.mjs. */
  for (const rel of ['native-brief-media-copy.mjs', 'linear-media-rescue.mjs']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', rel), 'utf8');
    ok(src.includes('import.meta.url === pathToFileURL(process.argv[1]).href'),
      `${rel}: entrypoint guard compares via pathToFileURL`);
    ok(!src.includes('import.meta.url === `file://${process.argv[1]}`'),
      `${rel}: no string-concatenated file:// entrypoint compare`);
  }
}

if (failures) {
  console.error(`\n${failures} native brief media copy check(s) failed ❌`);
  process.exit(1);
}
console.log('\nnative brief media copy checks passed');
})();
