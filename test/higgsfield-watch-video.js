#!/usr/bin/env node
// studio_action "watch_video" (watchvideo.mjs). Offline: Google and the video host are fakes.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');

(async () => {
  const sa = await import(path.join(dir, 'studioaction.mjs'));
  const wv = await import(path.join(dir, 'watchvideo.mjs'));
  assert.ok(sa.ACTION_NAMES.includes('watch_video'), 'listed as an action');
  assert.ok(!/name: "watch_video"/.test(fs.readFileSync(path.join(dir, 'index.ts'), 'utf8')), 'no new top-level tool');
  assert.strictEqual(wv.GEMINI_MODEL, 'gemini-3.5-flash-lite');

  // Price: 10 minutes at about 100 tokens a second, 1,000 tokens out.
  const p = wv.priceOf({ promptTokenCount: 60000, candidatesTokenCount: 800, thoughtsTokenCount: 200 });
  assert.strictEqual(p.usd, 0.0205);

  function make(opts = {}) {
    const rows = [];
    const calls = [];
    const env = { GEMINI_API_KEY: 'k', ...(opts.env || {}) };
    const resp = (status, body, headers = {}) => ({
      ok: status >= 200 && status < 300, status,
      headers: { get: (h) => headers[h.toLowerCase()] ?? null },
      body: { cancel: async () => {} },
      json: async () => body,
    });
    const d = {
      env: (k) => env[k], publicHost: async (u) => !/internal/.test(u.hostname), directLink: (l) => l, author: 'Ana',
      uuid: () => 'u' + rows.length, sleep: async () => {},
      geminiSpent: async () => opts.spent || 0,
      reserve: async (r) => { rows.push({ id: rows.length + 1, ...r, est_cost_usd: r.cost, status: 'queued' }); return { outcome: 'reserved', id: rows.length, spent: 0 }; },
      settle: async (id, f) => Object.assign(rows[id - 1], f),
      fetch: async (url, init = {}) => {
        calls.push([url, init.method || 'GET']);
        if (url.startsWith('https://videos.example.com/')) return resp(200, null, { 'content-length': opts.len || '1000', 'content-type': opts.type || 'video/mp4' });
        if (url.endsWith('/upload/v1beta/files')) return resp(200, {}, { 'x-goog-upload-url': 'https://up.example.com/x' });
        if (url === 'https://up.example.com/x') return resp(200, { file: { uri: 'gs-uri', name: 'files/abc', state: 'PROCESSING' } });
        if (url.endsWith('/v1beta/files/abc') && (init.method || 'GET') === 'GET') return resp(200, { state: 'ACTIVE' });
        if (url.includes(':generateContent')) {
          const b = JSON.parse(init.body);
          assert.ok(b.contents[0].parts[0].file_data.file_uri, 'video passed by uri');
          return resp(200, { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'Hook at 0:02 is slow.' }] } }], usageMetadata: { promptTokenCount: 60000, candidatesTokenCount: 1000 } });
        }
        return resp(200, {});
      },
    };
    return { d, rows, calls, run: (args) => sa.studioAction({ watch: () => d }, 'watch video', args) };
  }

  let t = make();
  let out = await t.run({ video: 'https://videos.example.com/cut.mp4', client: 'Test' });
  assert.ok(/^Hook at 0:02 is slow\./.test(out), out);
  assert.ok(!/thinking/.test(out), 'thought parts are not shown');
  assert.ok(/Cost \$0\.021/.test(out), out);
  assert.strictEqual(t.rows[0].status, 'completed');
  assert.strictEqual(t.rows[0].est_cost_usd, 0.0205, 'settled to the exact price');
  assert.strictEqual(t.rows[0].model, 'google/gemini-3.5-flash-lite');
  assert.ok(t.calls.some(([u, m]) => u.endsWith('/v1beta/files/abc') && m === 'DELETE'), 'Google copy deleted');

  t = make({ env: { GEMINI_API_KEY: '' } });
  assert.strictEqual(await t.run({ video: 'https://videos.example.com/a.mp4' }), wv.NO_KEY_TEXT);
  assert.strictEqual(t.rows.length, 0);

  t = make({ env: { GEMINI_API_KEY: '', GOOGLE_AI_KEY: 'g' } });
  assert.ok(/^Hook/.test(await t.run({ video: 'https://videos.example.com/a.mp4' })), 'GOOGLE_AI_KEY also works');

  t = make({ spent: 49.5 });
  assert.ok(/^Refused: the team's Gemini budget this month is \$50\.00/.test(await t.run({ video: 'https://videos.example.com/a.mp4' })));
  assert.strictEqual(t.rows.length, 0, 'nothing booked over the cap');

  t = make({ env: { GEMINI_MONTHLY_CAP_USD: 'lots' } });
  assert.ok(/not a valid dollar amount/.test(await t.run({ video: 'https://videos.example.com/a.mp4' })));

  t = make({ type: 'text/html' });
  assert.ok(/is not a video/.test(await t.run({ video: 'https://videos.example.com/page' })));
  assert.strictEqual(t.rows[0].status, 'failed');
  assert.strictEqual(t.rows[0].est_cost_usd, 0, 'a failure costs nothing');

  t = make({ len: String(2 * 1024 * 1024 * 1024) });
  assert.ok(/over 1 GB/.test(await t.run({ video: 'https://videos.example.com/big.mp4' })));

  t = make();
  assert.ok(/not a public https address/.test(await t.run({ video: 'https://internal.example.com/a.mp4' })));

  t = make();
  out = await t.run({ video: 'https://www.youtube.com/watch?v=abc', question: 'What is said first?', detail: 'high' });
  assert.ok(/^Hook/.test(out));
  assert.ok(!t.calls.some(([u]) => u.includes('/upload/')), 'YouTube is passed straight to Gemini');

  t = make();
  const f0 = t.d.fetch;
  t.d.fetch = async (u, i) => { if (u.includes(':generateContent')) throw new Error('timed out'); return f0(u, i); };
  assert.ok(/stays booked/.test(await t.run({ video: 'https://videos.example.com/a.mp4' })));
  assert.strictEqual(t.rows[0].status, 'unknown');
  assert.strictEqual(t.rows[0].est_cost_usd, wv.HOLD_USD, 'hold kept when Google may have charged');

  assert.ok(/Give video/.test(await make().run({})));
  console.log('higgsfield-watch-video: ok');
})().catch((e) => { console.error(e); process.exit(1); });
