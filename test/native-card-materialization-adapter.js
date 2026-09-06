'use strict';
// Offline source/stream/RPC controls only. Actual HTTP + SQL is a separate lane.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const hash = text => createHash('sha256').update(text).digest('hex');
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS native-card-adapter ' + name); }
function request(bytes, chunkSize = bytes.length || 1, headers = {}) {
  let offset = 0;
  return new Request('http://fixture.invalid/card', { method: 'POST', headers, duplex: 'half',
    body: new ReadableStream({ pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset += chunkSize));
    } }) });
}
const bytes = text => new TextEncoder().encode(text);
const client = 'fictionaltest';
const id = 'fictional-card';
const child = '00000000-0000-4000-8000-000000000001';
const ingress = '00000000-0000-4000-8000-000000000002';

(async () => {
  const adapter = await import(pathToFileURL(path.join(root, 'supabase/functions/_shared/native-card-materialization.mjs')).href);
  const { nativeCardSource, readNativeCardRequest, materializeNativeCard, NATIVE_CARD_MAX_BYTES } = adapter;
  for (const source of ['submission-native', 'calendar-native', 'samples-native']) await check('exact source ' + source, () => {
    assert.equal(nativeCardSource(new Request('http://fixture.invalid', { headers: { 'x-syncview-source': source } })), source);
  });
  for (const source of ['', 'ui', 'calendar-component-fill', 'Submission-Native', 'calendar-native,ui', 'linear', 'import']) await check('ordinary/unknown source ' + (source || 'absent'), () => {
    assert.equal(nativeCardSource(new Request('http://fixture.invalid', { headers: { 'x-syncview-source': source } })), null);
  });
  await check('split multibyte, whitespace and duplicate keys retain exact bytes', async () => {
    const raw = ' \n{"client":"unused","client":"fictionaltest","post":{"id":"fictional-card","name":"é😀"}}\t';
    const result = await readNativeCardRequest(request(bytes(raw), 1));
    assert.equal(result.rawText, raw);
    assert.deepEqual(bytes(result.rawText), bytes(raw));
    assert.equal(result.body.client, client);
  });
  await check('exact byte limit is accepted', async () => {
    const raw = '{"padding":"' + ' '.repeat(NATIVE_CARD_MAX_BYTES - 14) + '"}';
    assert.equal(bytes(raw).length, NATIVE_CARD_MAX_BYTES);
    assert.equal((await readNativeCardRequest(request(bytes(raw), 4093))).rawText, raw);
  });
  await check('one byte above limit is explicitly unretained', async () => {
    const result = await readNativeCardRequest(request(new Uint8Array(NATIVE_CARD_MAX_BYTES + 1).fill(32), 4093));
    assert.equal(result.status, 413); assert.equal(result.body.conserved, false);
  });
  for (const [name, raw] of [
    ['invalid utf8', new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])],
    ['BOM not silently stripped', new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('{}')])],
    ['truncated multibyte', new Uint8Array([0xf0, 0x9f])],
    ['invalid JSON', bytes('{')], ['nonobject', bytes('[]')],
  ]) await check(name, async () => {
    const result = await readNativeCardRequest(request(raw, 1));
    assert.equal(result.status, 400); assert.equal(result.body.conserved, false);
    assert.equal('rawText' in result, false);
  });
  await check('compressed body is not represented as original bytes', async () => {
    const result = await readNativeCardRequest(request(bytes('{}'), 2, { 'content-encoding': 'gzip' }));
    assert.equal(result.body.conserved, false);
  });
  await check('failed stream does not expose raw error', async () => {
    const req = new Request('http://fixture.invalid', { method: 'POST', duplex: 'half', body: new ReadableStream({
      pull() { throw new Error('private fixture error'); },
    }) });
    const result = await readNativeCardRequest(req);
    assert.equal(result.body.conserved, false); assert(!JSON.stringify(result).includes('private fixture'));
  });
  await check('stalled stream has bounded refusal, even if cancellation stalls', async () => {
    const originalSet = global.setTimeout; const originalClear = global.clearTimeout;
    global.setTimeout = fn => { queueMicrotask(fn); return 1; }; global.clearTimeout = () => {};
    try {
      const req = new Request('http://fixture.invalid', { method: 'POST', duplex: 'half', body: new ReadableStream({
        pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); },
      }) });
      const result = await readNativeCardRequest(req);
      assert.equal(result.status, 408); assert.equal(result.body.conserved, false);
    } finally { global.setTimeout = originalSet; global.clearTimeout = originalClear; }
  });

  // Build expected response from independently declared table DDL, not from
  // the adapter's required-field arrays. Every nullable legacy column remains.
  const schema = read('migrations/live-schema-baseline-2026-07-03.sql');
  function row(surface) {
    const table = surface === 'calendar' ? 'calendar_posts' : 'sample_reviews';
    const ddl = schema.match(new RegExp('create table if not exists public\\.' + table + ' \\(([\\s\\S]*?)\\n\\);'))[1];
    const value = Object.fromEntries([...ddl.matchAll(/^  ([a-z_]+) /gm)].map(match => [match[1], null]));
    return Object.assign(value, { client, id, video_deliverable_id: child, graphic_deliverable_id: null,
      order_index: '123', name: 'Later human edit', video_tweaks: '[{"body":"later note"}]' });
  }
  for (const surface of ['calendar', 'samples']) {
    const key = surface === 'calendar' ? 'post' : 'sample';
    const rawText = JSON.stringify({ client, [key]: { id, video_deliverable_id: child, graphic_deliverable_id: '', name: 'Original title', order_index: 1 } });
    const input = { surface, source: 'submission-native', rawText, client, cardId: id };
    const good = { error: null, data: { ok: true, conserved: true, outcome: 'replayed', ingress_id: ingress, [key]: row(surface) } };
    async function invoke(reply, overrides = {}) {
      let calls = 0;
      const result = await materializeNativeCard({ ...input, ...overrides, supabase: { async rpc(name, args) {
        calls++; assert.equal(name, 'production_card_materialize');
        assert.deepEqual(args, { p_surface: surface, p_source: 'submission-native', p_raw_body: rawText });
        if (reply instanceof Error) throw reply;
        return reply;
      } } });
      return { result, calls };
    }
    await check(surface + ' complete nullable current row preserved, receipt private', async () => {
      const { result, calls } = await invoke(good);
      assert.equal(calls, 1); assert.equal(result.status, 200);
      assert.deepEqual(result.body[key], row(surface)); assert.equal(result.body.conserved, true);
      assert.equal('ingress_id' in result.body, false);
    });
    await check(surface + ' known hold is retained without acknowledgement', async () => {
      const { result, calls } = await invoke({ error: null, data: { ok: false, outcome: 'held', reason: 'manifest_unresolved', conserved: true, ingress_id: ingress } });
      assert.equal(calls, 1); assert.equal(result.status, 409); assert.equal(result.body.ok, false); assert.equal(result.body.conserved, true);
    });
    const changed = mutate => { const copy = structuredClone(good); mutate(copy); return copy; };
    for (const [name, reply] of [
      ['transport rejection', new Error('private upstream detail')],
      ['error field', { data: good.data, error: { message: 'private upstream detail' } }],
      ['missing error field', { data: good.data }], ['array reply', []], ['null reply', null],
      ['missing current row', changed(x => delete x.data[key])],
      ['missing nullable field', changed(x => delete x.data[key].asset_url)],
      ['wrong client', changed(x => x.data[key].client = 'other')],
      ['wrong card', changed(x => x.data[key].id = 'other')],
      ['wrong original child', changed(x => x.data[key].video_deliverable_id = ingress)],
      ['missing receipt', changed(x => delete x.data.ingress_id)],
      ['false conservation', changed(x => x.data.conserved = false)],
      ['unrecognized outcome', changed(x => x.data.outcome = 'done')],
      ['wrong nullable field type', changed(x => x.data[key].video_tweaks = [])],
      ['unknown hold reason', { error: null, data: { ok: false, outcome: 'held', reason: 'private unknown reason', conserved: true, ingress_id: ingress } }],
    ]) await check(surface + ' ' + name + ' is unknown, one RPC', async () => {
      const { result, calls } = await invoke(reply);
      assert.equal(calls, 1); assert.equal(result.status, 503); assert.equal(result.body.ok, false); assert.equal(result.body.conserved, null);
      assert(!JSON.stringify(result).includes('private'));
    });
    for (const [name, overrides] of [
      ['different normalized scope', { client: 'other' }], ['generated fallback card', { cardId: 'generated' }],
      ['caller invented surface', { surface: 'outside' }], ['ordinary marker', { source: 'ui' }],
    ]) await check(surface + ' ' + name + ' refuses before RPC', async () => {
      const { result, calls } = await invoke(good, overrides);
      assert.equal(calls, 0); assert.equal(result.body.conserved, false); assert.equal(result.body.ok, false);
    });
  }

  await check('shared authorization bytes unchanged from pinned 8514 source', () => {
    assert.equal(hash(read('supabase/functions/_shared/browser-write-auth.ts')), '5e26152c8e98aa12976247379d16b5725d830c42bf02efa03b3be085159cfa79');
  });
  for (const [slug, surface, expected] of [
    ['calendar-upsert', 'calendar', '1c89f62162f1cc6514c6f40451062a76fe77fdfe1bf71c81d1f9cdd9c63365dd'],
    ['sample-review-upsert', 'samples', '8ccf13e5b6dc1d010d0ad5d26e5502dd1004dc1d24f69fed2cfc05a408b5af04'],
  ]) await check(slug + ' inverse reproduces entire ordinary handler and authorization', () => {
    let source = read('supabase/functions/' + slug + '/index.ts');
    const authAt = source.indexOf('actor = await authorizeBrowserWrite');
    const dispatchAt = source.indexOf('const native = await materializeNativeCard');
    assert(authAt >= 0 && dispatchAt > authAt && dispatchAt < source.indexOf('const existingRead =', authAt));
    source = source.replace(/^import \{ nativeCardSource,.*\n/m, '');
    source = source.replace(/  const nativeSource = nativeCardSource\(req\);[\s\S]*?\n  const now = isoNow\(\);/, `  let body: JsonMap;
  try { body = JSON.parse(await req.text()) as JsonMap; }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }

  const now = isoNow();`);
    source = source.replace(/    if \(nativeSource\) \{\n      nativeAttempted = true;[\s\S]*?      return json\(native.body, native.status\);\n    \}\n/, '');
    source = source.replace(/    if \(nativeSource\) \{\n      const refused = nativeAttempted[\s\S]*?      return json\(refused.body, refused.status\);\n    \}\n/, '');
    source = source.replace(/    if \(nativeSource\) console.log\([^\n]+\n    else console.log/, '    console.log');
    assert.equal(hash(source), expected);
  });
  console.log(JSON.stringify({ classification: 'OFFLINE_TEST', passed, failed: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
