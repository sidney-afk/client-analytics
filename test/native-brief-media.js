'use strict';
// Complete production-write handler + actual media helper over synthetic SDK.
// Actual browser render functions and local byte-package reconstruction; no live I/O.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { extractFunction } = require('./helpers/extract-function');
if (!process.execArgv.includes('--experimental-strip-types')) {
  const r = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', __filename], { encoding: 'utf8', windowsHide: true });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); process.exit(r.status ?? 1);
}
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-media-test-'));
let handler, tables, signed, reads, failTable, signFail, signHook, groups = 0, external = 0;
const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', ROLE_KEY_ADMIN: 'admin-key', ROLE_KEY_SMM: 'smm-key', ROLE_KEY_CREATIVE: 'creative-key' };
globalThis.Deno = { env: { get: key => env[key] }, serve: fn => { handler = fn; } };
globalThis.fetch = async () => { external++; throw Error('external_refused'); };
const sdk = {
  from(table) {
    let single = false, cap = Infinity; const filters = [];
    const q = { select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
      limit(n) { cap = n; return q; }, maybeSingle() { single = true; return q; },
      then(resolve, reject) { reads.push(table); const rows = (tables[table] || []).filter(r => filters.every(f => f(r))).slice(0, cap);
        return Promise.resolve({ data: single ? structuredClone(rows[0] || null) : structuredClone(rows), error: table === failTable ? { message: 'synthetic' } : null }).then(resolve, reject); } };
    return q;
  },
  storage: { from(bucket) { assert.equal(bucket, 'syncview-native-brief-media'); return { async createSignedUrl(name, ttl) {
    signed++; if (signHook) signHook(); assert.equal(ttl, 300); return signFail ? { error: {} } : { error: null, data: { signedUrl: env.SUPABASE_URL + '/storage/v1/object/sign/' + bucket + '/' + name + '?token=synthetic' } };
  } }; } },
};
globalThis.__briefMediaSdk = sdk;
const brief = '🙂 First ![one](https://uploads.linear.app/synthetic/image.png)\nAgain ![two](https://uploads.linear.app/synthetic/image.png)';
const row = { id: 'fixture-deliverable', client_slug: 'fixture', team: 'video', updated_at: '2026-09-01T00:00:00Z', brief };
async function call(headers = { 'x-syncview-key': 'admin-key', 'x-syncview-actor': 'Fixture Admin' }, extra = {}) {
  const r = await handler(new Request('https://fixture.invalid/read', { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ action: 'description_read', surface: 'production', id: row.id, client_slug: row.client_slug, ...extra }) }));
  return { status: r.status, body: await r.json() };
}
async function check(name, fn) { await fn(); groups++; console.log('PASS ' + name); }
(async () => { try {
  const media = await import(pathToFileURL(path.join(root, 'supabase/functions/_shared/native-brief-media.mjs')).href);
  const pkg = await import(pathToFileURL(path.join(root, 'scripts/native-brief-media-package.mjs')).href);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const contentHash = await media.briefMediaHash(png), refs = media.briefMediaOccurrences(brief), digest = await media.briefMediaHash(brief);
  const copies = await Promise.all(refs.map(async (ref, i) => ({ id: '11111111-1111-4111-8111-11111111111' + i,
    deliverable_id: row.id, client_slug: row.client_slug, team: row.team, source_updated_at: row.updated_at,
    source_kind: 'native_brief', source_entity_id: row.id, source_sha256: digest, source_offset: ref.offset, source_length: ref.length, original_url_sha256: await media.briefMediaHash(ref.url),
    audience: 'staff', state: 'verified', content_sha256: contentHash, readback_sha256: contentHash,
    storage_path: contentHash + '/11111111-1111-4111-8111-11111111111' + i, byte_length: png.length, mime_type: 'image/png', verified_at: row.updated_at })));
  const reset = () => { signed = 0; reads = []; failTable = ''; signFail = false; signHook = null; tables = {
    team_members: [{ id: 'actor', name: 'Fixture Admin', role: 'admin', active: true }, { id: 'creative', name: 'Fixture Editor', role: 'editor', team: 'video', active: true }],
    clients: [{ slug: 'fixture', active: true }], client_access: [{ slug: 'fixture', review_token: 'client-token' }],
    deliverables: [structuredClone(row)], syncview_runtime_flags: [{ key: 'native_brief_media', value: { mode: 'required', contract: 'native_brief_media_v1',
      recovery_contract: 'native_brief_media_recovery_v1', recovery_receipt_sha256: 'a'.repeat(64), coverage_receipt_sha256: 'b'.repeat(64) } }],
    native_brief_media_occurrences: structuredClone(copies),
  }; };
  const entry = path.join(root, 'supabase/functions/production-write/index.ts');
  let source = fs.readFileSync(entry, 'utf8').replace('import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";', 'const createClient=()=>globalThis.__briefMediaSdk; type SupabaseClient=any;');
  source = source.replace(/from "(\.\.?\/[^\"]+)"/g, (_, relative) => 'from ' + JSON.stringify(pathToFileURL(path.resolve(path.dirname(entry), relative)).href));
  const load = path.join(temp, 'handler.mts'); fs.writeFileSync(load, source); await import(pathToFileURL(load).href);
  await check('actual authenticated reader preserves canonical brief and distinct repeated inline occurrences', async () => {
    reset(); const r = await call(); assert.equal(r.status, 200); assert.equal(r.body.row.brief, brief); assert.equal(r.body.media.complete, true);
    assert.equal(signed, 2); assert.equal(r.body.media.occurrences, 2); assert(!r.body.media.render_brief.includes('uploads.linear.app'));
    assert(r.body.media.render_brief.includes(copies[0].id)); assert(r.body.media.render_brief.includes(copies[1].id));
  });
  await check('angle image URLs keep exact parentheses and UTF-16 offsets', async () => {
    reset(); const value = '🙂 ![image](<https://uploads.linear.app/synthetic/image(1).png>)';
    const ref = media.briefMediaOccurrences(value)[0]; assert.equal(value.slice(ref.offset, ref.offset + ref.length), ref.url);
    tables.deliverables[0].brief = value;
    tables.native_brief_media_occurrences = [{ ...copies[0], source_sha256: await media.briefMediaHash(value),
      source_offset: ref.offset, source_length: ref.length, original_url_sha256: await media.briefMediaHash(ref.url) }];
    const r = await call(); assert.equal(r.body.media.complete, true); assert.equal(r.body.row.brief, value);
    assert(r.body.media.render_brief.endsWith('?token=synthetic>)'));
  });
  for (const [name, headers, alter, extra] of [
    ['unsigned', {}, () => {}, {}], ['client', { 'x-syncview-client-token': 'client-token' }, () => {}, {}],
    ['wrong client', undefined, () => {}, { client_slug: 'other' }], ['inactive', undefined, () => { tables.clients[0].active = false; }, {}],
    ['offboarded', undefined, () => { tables.team_members[0].active = false; }, {}],
  ]) await check(name + ' cannot read mapping or sign', async () => { reset(); alter(); assert((await call(headers, extra)).status >= 400); assert.equal(signed, 0); assert(!reads.includes('native_brief_media_occurrences')); });
  await check('existing editor staff access retained', async () => { reset(); assert.equal((await call({ 'x-syncview-key': 'creative-key', 'x-syncview-actor': 'Fixture Editor' })).body.media.complete, true); });
  for (const [name, change] of [
    ['missing flag', () => { tables.syncview_runtime_flags = []; }], ['bad flag', () => { tables.syncview_runtime_flags[0].value = {}; }],
    ['missing recovery binding', () => { delete tables.syncview_runtime_flags[0].value.recovery_receipt_sha256; }],
    ['missing copy', () => { tables.native_brief_media_occurrences.pop(); }], ['duplicate', () => { tables.native_brief_media_occurrences.push(copies[0]); }],
    ['changed brief', () => { tables.deliverables[0].brief += ' edit'; }], ['wrong offset', () => { tables.native_brief_media_occurrences[0].source_offset++; }],
    ['wrong URL hash', () => { tables.native_brief_media_occurrences[0].original_url_sha256 = '0'.repeat(64); }],
    ['bad readback', () => { tables.native_brief_media_occurrences[0].readback_sha256 = '0'.repeat(64); }],
    ['public audience', () => { tables.native_brief_media_occurrences[0].audience = 'public'; }],
    ['missing ledger', () => { failTable = 'native_brief_media_occurrences'; }],
  ]) await check(name + ' holds with zero signing', async () => { reset(); change(); const r = await call(); assert.equal(r.body.media.complete, false); assert.equal(r.body.media.render_brief, null); assert.equal(signed, 0); });
  await check('signing error never returns a partial success', async () => { reset(); signFail = true; assert.equal((await call()).body.media.complete, false); });
  await check('source changes while signing stay held', async () => { reset(); signHook = () => { tables.deliverables[0].brief += ' edited'; }; assert.equal((await call()).body.media.complete, false); });
  await check('status-only timestamp advance retains unchanged copied images', async () => { reset(); tables.deliverables[0].updated_at = '2026-09-02T00:00:00Z'; tables.deliverables[0].status = 'kasper_approval';
    const r = await call(); assert.equal(r.body.media.complete, true); assert.equal(r.body.media.source_updated_at, tables.deliverables[0].updated_at); assert.equal(signed, 2); });
  await check('dormant off preserves canonical text but certifies no independence', async () => { reset(); tables.syncview_runtime_flags[0].value.mode = 'off'; const m = (await call()).body.media; assert.equal(m.mode, 'off'); assert.equal(m.complete, false); assert.equal(signed, 0); });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ctx = { Date, _calEsc: x => String(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), _jsAttrArg: x => JSON.stringify(x) };
  vm.createContext(ctx);
  vm.runInContext(['_prodNormalizeMarkdownLine', '_prodMarkdownBlockish', '_prodLinkifyInline', '_prodLinkify', '_prodDescriptionHTML', '_prodBriefMediaReadHTML'].map(x => extractFunction(html, x)).join('\n'), ctx);
  await check('real browser renderer shows inline private images; expiry/stale/refusal preserve all source text', async () => {
    reset(); const m = (await call()).body.media; const s = { value: brief, hasValue: true, sourceUpdatedAt: row.updated_at, briefMedia: m,
      briefMediaValue: brief, briefMediaRevision: row.updated_at, briefMediaRequired: true };
    const out = ctx._prodBriefMediaReadHTML(s, row.id); assert.equal((out.match(/<img /g) || []).length, 2); assert(!out.includes('uploads.linear.app'));
    const baseline = ctx._prodDescriptionHTML(brief, true, '', true);
    assert.equal((baseline.match(/<img /g) || []).length, 2); assert(baseline.includes('src="https://uploads.linear.app/'), 'unchanged old reader reproduces provider dependency');
    for (const change of [x => { x.briefMedia.expires_at = row.updated_at; }, x => { x.value += ' edit'; }, x => { x.briefMedia.complete = false; }, x => { x.briefMedia = null; }]) {
      const v = structuredClone(s); change(v); const held = ctx._prodBriefMediaReadHTML(v, row.id); assert(held.includes('data-prod-brief-media-held')); assert(!held.includes('<img ')); assert(held.includes('uploads.linear.app'));
    }
    assert.equal(s.value, brief);
  });
  await check('local source receipt -> byte-checked private staging -> object reconstruction; corrupt bytes refuse', async () => {
    const image = path.join(temp, 'source.png'); fs.writeFileSync(image, png);
    const receipt = { contract: 'native_brief_media_source_v1', id: row.id, client_slug: row.client_slug, team: row.team,
      source_updated_at: row.updated_at, brief_sha256: digest, occurrences: copies.map(x => ({ offset: x.source_offset, original_url_sha256: x.original_url_sha256, content_sha256: contentHash })) };
    const rp = path.join(temp, 'source-receipt.json'); fs.writeFileSync(rp, JSON.stringify(receipt));
    const input = path.join(temp, 'input.json'); fs.writeFileSync(input, JSON.stringify({ contract: 'native_brief_media_ingress_v1', documents: [{ row, source_receipt_path: rp, files: refs.map(ref => ({ offset: ref.offset, path: image, mime_type: 'image/png' })) }] }));
    const staged = path.join(temp, 'staged'); await pkg.stage(input, staged); const verified = await pkg.verify(staged);
    assert(verified.rows.every(x => x.state === 'pending')); assert.equal((await pkg.rehearse(staged, path.join(temp, 'restored'))).sql_restored, false);
    const readbackFile = path.join(temp, 'readback.json');
    const readback = { contract: 'native_brief_media_storage_readback_v1', bucket: 'syncview-native-brief-media', public: false,
      observed_at: row.updated_at, recovery_base_sha256: 'a'.repeat(64), documents: [{ ...row, updated_at: '2026-09-02T00:00:00Z' }],
      objects: verified.rows.map(x => ({ storage_path: x.storage_path, path: image })) };
    fs.writeFileSync(readbackFile, JSON.stringify(readback));
    const proposal = path.join(temp, 'proposal'); assert.equal((await pkg.admission(staged, readbackFile, proposal)).installed, false);
    const proposed = await pkg.verify(proposal); assert(proposed.rows.every(x => x.state === 'verified'));
    const extension = { contract: 'native_brief_media_recovery_v1', complete: true, recovery_base_sha256: 'a'.repeat(64),
      row_count: proposed.rows.length, ledger_path: path.join(proposal, 'ledger.private.json'), ledger_sha256: proposed.manifest.files['ledger.private.json'],
      files: Object.entries(proposed.manifest.files).filter(([n]) => n !== 'schema.sql' && n !== 'ledger.private.json').map(([name, sha256]) => ({ name, sha256, path: path.join(proposal, name) })) };
    const extensionFile = path.join(temp, 'extension.json'); fs.writeFileSync(extensionFile, JSON.stringify(extension));
    const capture = path.join(temp, 'capture'); await pkg.capture(extensionFile, capture);
    assert.equal((await pkg.rehearse(capture, path.join(temp, 'recovery-restored'))).kind, 'RECOVERY_CAPTURE');
    readback.documents[0].brief += ' different'; fs.writeFileSync(readbackFile, JSON.stringify(readback));
    await assert.rejects(() => pkg.admission(staged, readbackFile, path.join(temp, 'stale-proposal')));
    extension.recovery_base_sha256 = ''; fs.writeFileSync(extensionFile, JSON.stringify(extension));
    await assert.rejects(() => pkg.capture(extensionFile, path.join(temp, 'unbound-capture')));
    const object = path.join(staged, 'objects', verified.rows[0].storage_path); fs.appendFileSync(object, 'corrupt'); await assert.rejects(() => pkg.verify(staged));
    await assert.rejects(() => pkg.stage(input, path.join(root, 'forbidden-output')));
  });
  assert.equal(external, 0);
  console.log('PASS ' + groups + ' focused groups; actual handler/synthetic SDK + renderer + local bytes; SQL/serving unproven; external calls 0');
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert(path.basename(temp).startsWith('brief-media-test-'));
  fs.rmSync(temp, { recursive: true });
} })().catch(e => { console.error(e); process.exitCode = 1; });
