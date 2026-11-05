'use strict';
/*
 * voice_cleanup with engine elevenlabs (Voice Isolator through the team's server-side key).
 * Logic: supabase/functions/higgsfield-mcp/isolate.mjs, run here against a fake network, database and storage.
 * No network: nothing here talks to ElevenLabs.
 */
const assert = require('assert');
const path = require('path');
const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');
const FILE = 'https://example-cdn.test/uploads/voice.wav';

function wav(seconds) {
  const rate = 48000, ch = 1, bits = 16, br = rate * ch * bits / 8, size = Math.round(seconds * br);
  const b = Buffer.alloc(44 + 16);
  b.write('RIFF', 0); b.writeUInt32LE(36 + size, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(br, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36); b.writeUInt32LE(size, 40);
  return { bytes: new Uint8Array(b), total: 44 + size };
}
const stream = (u) => new ReadableStream({ start(c) { c.enqueue(u); c.close(); } });

function harness({ env = { ELEVENLABS_KEY: 'k-not-real' }, seconds = 120, iso } = {}) {
  const calls = { reserve: [], bg: [], upload: [], fetch: [] };
  const rows = new Map();
  const f = wav(seconds);
  const d = {
    env: (k) => env[k], publicHost: async () => true, directLink: (l) => l, author: 'T', cap: 200,
    uuid: () => '11111111-2222-3333-4444-555555555555', budget: async () => 'Budget ok.', idemKey: async (...a) => JSON.stringify(a),
    background: (p) => calls.bg.push(p), now: () => new Date('2026-11-05T10:00:00Z'),
    reserve: async (p) => { calls.reserve.push(p); rows.set(1, { id: 1, status: 'submitted', est_cost_usd: p.cost, params: p.params, updated_at: '2026-11-05T09:59:00Z' }); return { outcome: 'reserved', id: 1, spent: 1 }; },
    update: async (id, fields) => { Object.assign(rows.get(id), fields); return 1; },
    upload: async (p, body, type) => { calls.upload.push({ p, type, n: (await new Response(body).arrayBuffer()).byteLength }); },
    sign: async (p) => 'https://storage.test/' + p,
    fetch: async (url, init = {}) => {
      calls.fetch.push({ url, init });
      if (url === FILE && init.headers && init.headers.Range) return new Response(stream(f.bytes), { status: 206, headers: { 'content-type': 'audio/wav', 'content-range': `bytes 0-${f.bytes.length - 1}/${f.total}` } });
      if (url === FILE) return new Response(Buffer.alloc(1000), { status: 200 });
      if (url === 'https://api.elevenlabs.io/v1/audio-isolation') return iso ? iso(init) : new Response(stream(new Uint8Array([1, 2, 3])), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
      return new Response(null, { status: 404 });
    },
  };
  return { d, calls, rows };
}

(async () => {
  const v = await import(path.join(dir, 'voice.mjs'));
  const iso = await import(path.join(dir, 'isolate.mjs'));

  assert.strictEqual(iso.isolatePrice(120, 0.12), 0.24);
  assert.strictEqual(iso.isolatePrice(121, 0.12), 0.36, 'a started minute counts');
  assert.strictEqual(iso.usdPerMinute(''), 0.12);
  assert.strictEqual(iso.usdPerMinute('x'), null);
  assert.strictEqual(iso.extFor('audio/mpeg'), 'mp3');
  assert.strictEqual(iso.extFor('audio/wav'), 'wav');

  // No key: nothing reserved.
  { const h = harness({ env: {} }); assert.strictEqual(await v.voiceCleanup({ file: FILE, engine: 'elevenlabs', go: true }, h.d), iso.NO_KEY_TEXT); assert.strictEqual(h.calls.reserve.length, 0); }

  // Price card first, nothing reserved, no strength needed.
  { const h = harness(); const t = await v.voiceCleanup({ file: FILE, engine: 'elevenlabs' }, h.d);
    assert.ok(t.includes('ElevenLabs Voice Isolator') && t.includes('$0.24') && t.includes('Say go'), t);
    assert.strictEqual(h.calls.reserve.length, 0); }

  // Go: reserved against the cap, job started in the background, result stored and signed.
  { const h = harness(); const t = await v.voiceCleanup({ file: FILE, engine: 'elevenlabs', go: true }, h.d);
    assert.ok(t.includes('job_id: 11111111-2222-3333-4444-555555555555'), t);
    assert.strictEqual(h.calls.reserve[0].model, v.VOICE_MODEL);
    assert.strictEqual(h.calls.reserve[0].params.engine, 'elevenlabs');
    assert.strictEqual(h.rows.get(1).status, 'in_progress');
    await Promise.all(h.calls.bg);
    const post = h.calls.fetch.find((c) => c.url.includes('audio-isolation'));
    assert.strictEqual(post.init.headers['xi-api-key'], 'k-not-real');
    assert.strictEqual(h.rows.get(1).status, 'completed');
    assert.deepStrictEqual(h.calls.upload.map((u) => [u.p, u.type]), [['11111111-2222-3333-4444-555555555555.mp3', 'audio/mpeg']]);
    const done = await v.voiceCheck('11111111-2222-3333-4444-555555555555', { ...h.d, byRequest: async () => h.rows.get(1) });
    assert.ok(done.startsWith('Done.') && done.includes('.mp3'), done); }

  // ElevenLabs refuses: failed, not charged.
  { const h = harness({ iso: () => new Response('bad', { status: 401 }) }); await v.voiceCleanup({ file: FILE, engine: 'elevenlabs', go: true }, h.d); await Promise.all(h.calls.bg);
    assert.strictEqual(h.rows.get(1).status, 'failed'); }
  // Text instead of audio: counted as charged.
  { const h = harness({ iso: () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }); await v.voiceCleanup({ file: FILE, engine: 'elevenlabs', go: true }, h.d); await Promise.all(h.calls.bg);
    assert.strictEqual(h.rows.get(1).status, 'failed_charged'); }
  // Over 5 minutes refused before anything.
  { const h = harness({ seconds: 400 }); assert.ok((await v.voiceCleanup({ file: FILE, engine: 'elevenlabs', go: true }, h.d)).includes('up to 5 minutes')); assert.strictEqual(h.calls.reserve.length, 0); }
  // Stale running job.
  { const h = harness(); const row = { id: 1, status: 'in_progress', est_cost_usd: 0.24, updated_at: '2026-11-05T09:00:00Z', params: { engine: 'elevenlabs' } }; h.rows.set(1, row);
    assert.ok((await iso.isolateCheck(row, h.d)).includes('never finished')); assert.strictEqual(row.status, 'failed_charged'); }

  // Auphonic stays the default.
  assert.deepStrictEqual(v.VOICE_TOOL.inputSchema.properties.engine.enum, ['auphonic', 'elevenlabs']);
  console.log('higgsfield-voice-isolate: price card, reserve, background run, stored result, failures ✅');
})().catch((e) => { console.error(e); process.exit(1); });
