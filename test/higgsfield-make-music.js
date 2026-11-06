'use strict';
/*
 * studio_action make_music (ElevenLabs Music, server-side key) and its hard limits.
 * Logic: supabase/functions/higgsfield-mcp/music.mjs, run here against a fake network and database.
 * No network: nothing here talks to ElevenLabs.
 */
const assert = require('assert');
const path = require('path');
const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');
const stream = (u) => new ReadableStream({ start(c) { c.enqueue(u); c.close(); } });

function harness({ env = { ELEVENLABS_KEY: 'k-not-real' }, outcome = 'reserved', used = 0, api, rpcFails = false } = {}) {
  const calls = { reserve: [], bg: [], upload: [], fetch: [] };
  const rows = new Map();
  const d = {
    env: (k) => env[k], author: 'T', cap: 200, uuid: () => '11111111-2222-3333-4444-555555555555',
    idemKey: async (...a) => JSON.stringify(a), background: (p) => calls.bg.push(p), now: () => new Date('2026-11-06T10:00:00Z'),
    reserveMusic: async (p) => { calls.reserve.push(p); if (rpcFails) return null; if (outcome !== 'reserved') return { outcome, used }; rows.set(1, { id: 1, status: 'submitted', est_cost_usd: p.cost, params: p.params, updated_at: '2026-11-06T09:59:00Z' }); return { outcome: 'reserved', id: 1, spent: 1 }; },
    update: async (id, fields) => { Object.assign(rows.get(id), fields); return 1; },
    upload: async (p, body, type) => { calls.upload.push({ p, type }); },
    sign: async (p) => 'https://storage.test/' + p,
    fetch: async (url, init = {}) => { calls.fetch.push({ url, init }); return api ? api(init) : new Response(stream(new Uint8Array([1, 2, 3])), { status: 200, headers: { 'content-type': 'audio/mpeg' } }); },
  };
  return { d, calls, rows };
}

(async () => {
  const m = await import(path.join(dir, 'music.mjs'));
  const act = await import(path.join(dir, 'studioaction.mjs'));
  assert.ok(act.ACTION_NAMES.includes('make_music'));

  // No key, no prompt, bad length: nothing reserved.
  { const h = harness({ env: {} }); assert.strictEqual(await m.makeMusic(h.d, { prompt: 'calm', go: true }), m.NO_KEY_TEXT); }
  { const h = harness(); assert.ok((await m.makeMusic(h.d, {})).startsWith('Give a prompt')); }
  for (const s of [2, 301, 600, 'abc']) { const h = harness(); const t = await m.makeMusic(h.d, { prompt: 'calm', seconds: s, go: true }); assert.ok(t.includes('5 minutes'), t); assert.strictEqual(h.calls.reserve.length, 0); }
  { const h = harness({ env: { ELEVENLABS_KEY: 'k', ELEVENLABS_MUSIC_DAY_USD: 'lots' } }); assert.ok((await m.makeMusic(h.d, { prompt: 'calm', go: true })).includes('not a valid number')); }

  // Card first, nothing reserved or sent.
  { const h = harness(); const t = await m.makeMusic(h.d, { prompt: 'calm piano', seconds: 20 });
    assert.ok(t.includes('20 seconds') && t.includes('Say go') && t.includes('Instrumental'), t);
    assert.strictEqual(h.calls.reserve.length, 0); assert.strictEqual(h.calls.fetch.length, 0); }

  // Hard limits are decided inside the one serialized reserve step; each refusal starts nothing.
  { const h = harness({ outcome: 'day_budget', used: 29 }); assert.ok((await m.makeMusic(h.d, { prompt: 'x', seconds: 300, go: true })).includes("music limit for today")); assert.strictEqual(h.calls.fetch.length, 0); }
  { const h = harness({ outcome: 'month_budget', used: 149 }); assert.ok((await m.makeMusic(h.d, { prompt: 'x', seconds: 300, go: true })).includes('monthly music budget')); assert.strictEqual(h.calls.fetch.length, 0); }
  { const h = harness({ rpcFails: true }); assert.ok((await m.makeMusic(h.d, { prompt: 'x', go: true })).includes('nothing was started')); assert.strictEqual(h.calls.bg.length, 0); assert.strictEqual(h.calls.fetch.length, 0); }
  { const h = harness({ outcome: 'something_new' }); assert.ok((await m.makeMusic(h.d, { prompt: 'x', go: true })).includes('nothing was started')); assert.strictEqual(h.calls.fetch.length, 0); }
  // The limits sent to the database come from the owner's settings, never from arguments.
  { const h = harness(); await m.makeMusic(h.d, { prompt: 'x', go: true, day: 9999, month: 9999 });
    assert.deepStrictEqual([h.calls.reserve[0].day, h.calls.reserve[0].month], [30, 150]); }
  { const h = harness({ env: { ELEVENLABS_KEY: 'k', ELEVENLABS_MUSIC_DAY_USD: '7', ELEVENLABS_MUSIC_MONTH_USD: '9' } }); await m.makeMusic(h.d, { prompt: 'x', go: true });
    assert.deepStrictEqual([h.calls.reserve[0].day, h.calls.reserve[0].month], [7, 9]); }
  // A 5 minute track reserves a 5 dollar ceiling; a 61 second one counts as 2 minutes.
  { const h = harness(); await m.makeMusic(h.d, { prompt: 'x', seconds: 300, go: true }); assert.strictEqual(h.calls.reserve[0].cost, 5); }
  { const h = harness(); await m.makeMusic(h.d, { prompt: 'x', seconds: 61, go: true }); assert.strictEqual(h.calls.reserve[0].cost, 2); }

  // Go: reserved at the ceiling price, started in the background, stored as mp3, signed link.
  { const h = harness(); const t = await m.makeMusic(h.d, { prompt: 'calm piano', seconds: 30, go: true });
    assert.ok(t.includes('job_id: 11111111-2222-3333-4444-555555555555'), t);
    assert.strictEqual(h.calls.reserve[0].cost, 1);
    assert.strictEqual(h.rows.get(1).status, 'in_progress');
    await Promise.all(h.calls.bg);
    const sent = JSON.parse(h.calls.fetch[0].init.body);
    assert.strictEqual(sent.music_length_ms, 30000); assert.strictEqual(sent.force_instrumental, true);
    assert.strictEqual(h.calls.fetch[0].init.headers['xi-api-key'], 'k-not-real');
    assert.strictEqual(h.rows.get(1).status, 'completed'); assert.strictEqual(h.calls.upload[0].type, 'audio/mpeg');
    assert.ok((await m.musicCheck(h.rows.get(1), h.d)).includes('https://storage.test/11111111-2222-3333-4444-555555555555.mp3')); }

  // Failures: a refusal costs nothing; text instead of audio and no answer are counted.
  { const h = harness({ api: () => new Response('{"detail":"bad"}', { status: 401 }) }); await m.makeMusic(h.d, { prompt: 'x', go: true }); await Promise.all(h.calls.bg);
    assert.strictEqual(h.rows.get(1).status, 'failed'); assert.ok((await m.musicCheck(h.rows.get(1), h.d)).includes('Nothing was spent')); }
  { const h = harness({ api: () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }); await m.makeMusic(h.d, { prompt: 'x', go: true }); await Promise.all(h.calls.bg);
    assert.strictEqual(h.rows.get(1).status, 'failed_charged'); }
  { const h = harness({ api: () => { throw new Error('boom'); } }); await m.makeMusic(h.d, { prompt: 'x', go: true }); await Promise.all(h.calls.bg);
    assert.strictEqual(h.rows.get(1).status, 'failed_charged'); }

  // A stale running job is closed as counted, never left open.
  { const h = harness(); const row = { id: 1, status: 'in_progress', est_cost_usd: 1, updated_at: '2026-11-06T09:00:00Z' }; h.rows.set(1, row);
    assert.ok((await m.musicCheck(row, h.d)).includes('never finished')); assert.strictEqual(row.status, 'failed_charged'); }

  console.log('higgsfield-make-music: ok');
})().catch((e) => { console.error(e); process.exit(1); });
