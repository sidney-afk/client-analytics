'use strict';
/*
 * voice_cleanup on the team connector (Auphonic, session Lather 2026-10-17).
 *
 * The logic lives in supabase/functions/higgsfield-mcp/voice.mjs (plain
 * JavaScript) and runs here for real against a fake network, database and
 * storage: the Auphonic settings per strength, the missing-key answer (no
 * charge, no reservation), the price card before go, the reservation against
 * the monthly cap, the job states from Auphonic, the copy into the private
 * bucket and plain-English errors. index.ts is checked for its wiring only.
 * No network: nothing here talks to Auphonic.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dir = path.join(ROOT, 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

// A PCM WAV header (44 bytes) followed by the first few audio bytes.
function wav({ seconds = 60, rate = 48000, channels = 2, bits = 16, dataSize, riff = 'RIFF' } = {}) {
  const byteRate = rate * channels * bits / 8;
  const size = dataSize !== undefined ? dataSize : Math.round(seconds * byteRate);
  const b = Buffer.alloc(44 + 64);
  b.write(riff, 0, 'ascii'); b.writeUInt32LE((36 + size) >>> 0, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(byteRate, 28); b.writeUInt16LE(channels * bits / 8, 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(size >>> 0, 40);
  return { bytes: new Uint8Array(b), total: 44 + size };
}

function stream(bytes) {
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}
function resp(status, { body = null, headers = {}, json } = {}) {
  const h = new Headers(headers);
  if (json !== undefined) return new Response(JSON.stringify(json), { status, headers: h });
  return new Response(body ? stream(body) : null, { status, headers: h });
}

const KEY = 'test-auphonic-key-not-real';
const FILE = 'https://example-cdn.test/uploads/voice.wav';

function harness({ env = { AUPHONIC_KEY: KEY }, file = wav(), cap = 200, reserve, auphonicPost, auphonicGet, download } = {}) {
  const calls = { fetch: [], reserve: [], update: [], upload: [], background: [] };
  const rows = new Map();
  let nextId = 1;
  const d = {
    env: (k) => env[k],
    publicHost: async (u) => u.protocol === 'https:' && !/internal|localhost/.test(u.hostname),
    directLink: (l) => l,
    author: 'Tester',
    cap,
    uuid: () => '11111111-2222-3333-4444-555555555555',
    budget: async () => 'Team budget this month: $1.00 of $200.00 used.',
    idemKey: async (m, model, input) => JSON.stringify([m, model, input]),
    background: (p) => { calls.background.push(p); },
    now: () => new Date('2026-10-17T05:00:00Z'),
    reserve: async (p) => {
      calls.reserve.push(p);
      if (reserve) return reserve(p);
      const id = nextId++;
      rows.set(id, { id, status: 'submitted', est_cost_usd: p.cost, params: p.params, updated_at: '2026-10-17T04:59:00Z', model: p.model });
      return { outcome: 'reserved', id, spent: 1 };
    },
    update: async (id, fields, only) => {
      calls.update.push({ id, fields, only });
      const r = rows.get(id);
      if (!r) return 0;
      if (only && ((only.status && r.status !== only.status) || (only.updated_at && r.updated_at !== only.updated_at))) return 0;
      Object.assign(r, fields);
      return 1;
    },
    byRequest: async (rid) => [...rows.values()].find((r) => r.request_id === rid) || null,
    upload: async (p, body, type) => { calls.upload.push({ p, type, bytes: Buffer.from(await new Response(body).arrayBuffer()) }); },
    sign: async (p, s) => `https://storage.test/sign/voice/${p}?expires=${s}`,
    fetch: async (url, init = {}) => {
      calls.fetch.push({ url, init });
      if (url.startsWith('https://auphonic.com/api/productions.json')) return auphonicPost ? auphonicPost(init) : resp(200, { json: { status_code: 200, data: { uuid: 'AuphUuid22charsXXXXXXX' } } });
      if (url.startsWith('https://auphonic.com/api/production/')) return auphonicGet ? auphonicGet(url) : resp(200, { json: { data: { status: 4, status_string: 'Audio Processing' } } });
      if (url.startsWith('https://auphonic.com/api/download/')) return download ? download(url, init) : resp(200, { body: new Uint8Array([1, 2, 3]), headers: { 'content-length': '3' } });
      if (url === FILE) {
        const range = (init.headers || {}).Range;
        assert.ok(range && /^bytes=0-\d+$/.test(range), 'the length is read with a range request');
        return resp(206, { body: file.bytes, headers: { 'content-type': 'audio/wav', 'content-range': `bytes 0-${file.bytes.length - 1}/${file.total}` } });
      }
      return resp(404);
    },
  };
  return { d, calls, rows };
}

(async () => {
  const v = await import(path.join(dir, 'voice.mjs'));
  const who = await import(path.join(dir, 'who.mjs'));

  // ---- Settings per strength (exact names and values from Auphonic's docs) ----
  const common = { denoise: true, denoisemethod: 'dynamic', deverbamount: -1, leveler: false, normloudness: false, cutter: false, silence_cutter: false };
  assert.deepStrictEqual(v.auphonicAlgorithms('gentle'), { ...common, denoiseamount: 12, filtering: false });
  assert.deepStrictEqual(v.auphonicAlgorithms('strong'), { ...common, denoiseamount: 0, filtering: false });
  assert.deepStrictEqual(v.auphonicAlgorithms('studio'), { ...common, denoiseamount: 12, filtering: true, filtermethod: 'studiovoice' });
  assert.throws(() => v.auphonicAlgorithms('loud'));
  const body = v.productionBody('studio', FILE, '11111111-2222');
  assert.deepStrictEqual(body.output_files, [{ format: 'wav' }], 'WAV out, no sample-rate change asked for');
  assert.strictEqual(body.input_file, FILE);
  assert.strictEqual(body.action, 'start');
  assert.ok(!('preset' in body), 'no stored preset: every setting is in the request');

  // ---- Price: Auphonic's processing time, at least 3 minutes ----
  assert.strictEqual(v.usdPerHour(undefined), 2.4);
  assert.strictEqual(v.usdPerHour('1.44'), 1.44);
  assert.strictEqual(v.usdPerHour('abc'), null);
  assert.strictEqual(v.usdPerHour('0'), null);
  assert.strictEqual(v.priceFor(300, 2.4), 0.2, '5 minutes at $2.40 an hour');
  assert.strictEqual(v.priceFor(60, 2.4), 0.12, 'a 1 minute file is billed as 3 minutes');
  assert.strictEqual(v.priceFor(241, 2.4), 0.17, 'rounded up to the cent');

  // ---- WAV header ----
  const w = wav({ seconds: 150, rate: 44100, channels: 1, bits: 24 });
  const parsed = v.parseWavHeader(w.bytes, w.total);
  assert.strictEqual(Math.round(parsed.seconds), 150);
  assert.deepStrictEqual([parsed.sampleRate, parsed.channels, parsed.bits], [44100, 1, 24]);
  const unfilled = wav({ seconds: 90, dataSize: 0 });
  assert.strictEqual(Math.round(v.parseWavHeader(unfilled.bytes, 44 + 90 * 192000).seconds), 90, 'a size the recorder never filled in falls back to the file size');
  assert.strictEqual(v.parseWavHeader(unfilled.bytes, null).error, 'no-length');
  assert.strictEqual(v.parseWavHeader(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]), 100).error, 'not-wav', 'an MP3 is not taken');
  assert.strictEqual(v.totalBytesOf(206, new Headers({ 'content-range': 'bytes 0-131071/52428844' })), 52428844);
  assert.strictEqual(v.totalBytesOf(200, new Headers({ 'content-length': '1234' })), 1234);

  // ---- Missing key: plain answer, no fetch, no reservation ----
  {
    const h = harness({ env: {} });
    const t1 = await v.voiceCleanup({ file: FILE, strength: 'gentle' }, h.d);
    const t2 = await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, h.d);
    assert.strictEqual(t1, 'Voice clean-up is not switched on yet: the account owner needs to add the Auphonic key.');
    assert.strictEqual(t2, t1);
    assert.strictEqual(h.calls.reserve.length, 0, 'no reservation without the key');
    assert.strictEqual(h.calls.fetch.length, 0, 'nothing is fetched without the key');
    assert.strictEqual(who.outcomeOf('voice_cleanup', t1).ok, false, 'logged as a failure in hf_activity');
  }

  // ---- Price card first: nothing reserved, nothing sent to Auphonic ----
  {
    const h = harness({ file: wav({ seconds: 200 }) });
    const card = await v.voiceCleanup({ file: FILE, strength: 'strong' }, h.d);
    assert.ok(card.startsWith('Plan: voice clean-up (Auphonic)'), card);
    assert.ok(/Strength: strong \(background noise removed fully/.test(card));
    assert.ok(/3\.3 minutes, 48000 Hz, stereo, 16-bit WAV/.test(card));
    assert.ok(/Price: about \$0\.14 /.test(card), card);
    assert.ok(/Say go, or tell me what to change\./.test(card));
    assert.ok(/Team budget this month/.test(card));
    assert.strictEqual(h.calls.reserve.length, 0);
    assert.ok(!h.calls.fetch.some((c) => c.url.startsWith('https://auphonic.com')), 'Auphonic is not called for a price card');
    assert.strictEqual(who.outcomeOf('voice_cleanup', card).ok, true);
  }

  // ---- Refusals before any spending ----
  {
    const h = harness({ file: wav({ seconds: 400 }) });
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, h.d)).startsWith('That file is 6.7 minutes long'));
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'medium' }, h.d)).startsWith('Give the strength'));
    assert.ok((await v.voiceCleanup({ file: 'http://x.test/a.wav', strength: 'gentle' }, h.d)).startsWith('The link must'));
    assert.ok((await v.voiceCleanup({ file: 'https://internal.test/a.wav', strength: 'gentle' }, h.d)).startsWith('That link points somewhere'));
    const big = harness({ file: { bytes: wav({ seconds: 60 }).bytes, total: 250 * 1024 * 1024 } });
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'gentle' }, big.d)).startsWith('That file is over 200 MB'));
    const mp3 = harness({ file: { bytes: new Uint8Array(64).fill(0x49), total: 1000 } });
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'gentle' }, mp3.d)).startsWith('That file is not a WAV'));
    const badRate = harness({ env: { AUPHONIC_KEY: KEY, AUPHONIC_USD_PER_HOUR: 'lots' } });
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'gentle' }, badRate.d)).startsWith('Could not price it'));
    const badCap = harness({ cap: null });
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, badCap.d)).startsWith('The monthly budget setting'));
    assert.strictEqual(h.calls.reserve.length + big.calls.reserve.length + badCap.calls.reserve.length, 0);
  }

  // ---- Go: reserve at the price, start with the exact settings, record the job ----
  const started = harness({ file: wav({ seconds: 270 }) });
  {
    const h = started;
    const t = await v.voiceCleanup({ file: FILE, strength: 'studio', go: true }, h.d);
    assert.ok(t.startsWith('Started: voice clean-up (studio), about $0.18.'), t);
    assert.ok(/job_id: 11111111-2222-3333-4444-555555555555/.test(t));
    assert.strictEqual(h.calls.reserve.length, 1);
    const r = h.calls.reserve[0];
    assert.deepStrictEqual([r.model, r.member, r.cost, r.cap], ['auphonic/voice-cleanup', 'Tester', 0.18, 200]);
    assert.strictEqual(r.params.strength, 'studio');
    const post = h.calls.fetch.find((c) => c.url === 'https://auphonic.com/api/productions.json');
    assert.strictEqual(post.init.method, 'POST');
    assert.strictEqual(post.init.headers.Authorization, 'bearer ' + KEY);
    const sent = JSON.parse(post.init.body);
    assert.deepStrictEqual(sent.algorithms, v.auphonicAlgorithms('studio'));
    const row = h.rows.get(1);
    assert.deepStrictEqual([row.status, row.request_id, row.params.auphonic_uuid], ['in_progress', '11111111-2222-3333-4444-555555555555', 'AuphUuid22charsXXXXXXX']);
    assert.ok(!t.includes(KEY), 'the key is never in an answer');
  }

  // ---- Budget and duplicates come from the reservation ----
  {
    const over = harness({ reserve: () => ({ outcome: 'over_cap', spent: 199.95 }) });
    const t = await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, over.d);
    assert.ok(t.startsWith('Refused: this ($0.12) would pass the team\'s monthly budget of $200.00 ($199.95 already used).'), t);
    assert.ok(!over.calls.fetch.some((c) => c.url.startsWith('https://auphonic.com')), 'over the cap: Auphonic is never called');
    const dup = harness({ reserve: () => ({ outcome: 'duplicate', request_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }) });
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, dup.d)).includes('not charged twice'));
    const down = harness({ reserve: () => null });
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, down.d)).startsWith('Could not start'));
  }

  // ---- Auphonic refusing the start ----
  {
    const bad = harness({ auphonicPost: () => resp(400, { json: { error_message: 'Not enough credits', form_errors: {} } }) });
    const t = await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, bad.d);
    assert.ok(t.startsWith('Refused by Auphonic: the Auphonic account has run out of processing hours'), t);
    assert.strictEqual(bad.rows.get(1).status, 'submit_failed', 'a 4xx frees the reservation');
    const key = harness({ auphonicPost: () => resp(401, { json: {} }) });
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, key.d)).includes('did not accept the key'));
    const gw = harness({ auphonicPost: () => resp(502, { json: {} }) });
    assert.ok((await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, gw.d)).includes('do not send it again'));
    assert.strictEqual(gw.rows.get(1).status, 'submit_unknown', 'a 5xx stays counted (it may have started)');
  }

  // ---- Job states ----
  assert.deepStrictEqual(v.statusOf({ status: 3 }), { state: 'done' });
  assert.deepStrictEqual(v.statusOf({ status: 4, status_string: 'Audio Processing' }), { state: 'working', label: 'audio processing' });
  assert.deepStrictEqual(v.statusOf({ status: 13 }), { state: 'canceled' });
  assert.strictEqual(v.statusOf({ status: 2, error_message: 'Could not download input file' }).state, 'failed');
  assert.ok(/could not download the recording/.test(v.statusOf({ status: 2, error_message: 'Could not download input file' }).error));
  assert.ok(/read the file as audio/.test(v.statusOf({ status: 2, error_message: 'Unsupported audio format' }).error));
  assert.ok(/incomplete/.test(v.statusOf({ status: 9 }).error));
  for (const code of [0, 1, 5, 6, 10, 12, 14]) assert.strictEqual(v.statusOf({ status: code }).state, 'working', 'status ' + code);

  const JOB = '11111111-2222-3333-4444-555555555555';
  {
    const h = started;
    // Working at Auphonic.
    const w1 = await v.voiceCheck(JOB, h.d);
    assert.ok(w1.startsWith('Still working (audio processing).'), w1);
    // Done: actual cost from Auphonic's length, copy claimed once, streamed to the bucket.
    h.d.fetch = ((orig) => async (url, init) => {
      if (url.startsWith('https://auphonic.com/api/production/')) {
        return resp(200, { json: { data: { status: 3, length: 262.5, output_files: [{ format: 'wav', download_url: 'https://auphonic.com/api/download/audio-result/AuphUuid/voice-111.wav' }] } } });
      }
      return orig(url, init);
    })(h.d.fetch);
    const w2 = await v.voiceCheck(JOB, h.d);
    assert.ok(w2.startsWith('Still working (saving the cleaned file)'), w2);
    assert.strictEqual(h.rows.get(1).status, 'storing');
    assert.strictEqual(h.rows.get(1).est_cost_usd, 0.18, 'the actual price (262.5 s) is written back');
    assert.strictEqual(h.calls.background.length, 1);
    // A second check while it saves does not start a second copy.
    h.rows.get(1).updated_at = new Date().toISOString();
    assert.ok((await v.voiceCheck(JOB, h.d)).startsWith('Still working (saving'));
    assert.strictEqual(h.calls.background.length, 1);
    await h.calls.background[0];
    assert.strictEqual(h.calls.upload.length, 1);
    assert.deepStrictEqual([h.calls.upload[0].p, h.calls.upload[0].type], [JOB + '.wav', 'audio/wav']);
    const dl = h.calls.fetch.find((c) => c.url.startsWith('https://auphonic.com/api/download/'));
    assert.strictEqual(dl.init.headers.Authorization, 'bearer ' + KEY, 'the download carries the key in a header');
    assert.deepStrictEqual([h.rows.get(1).status, h.rows.get(1).video_url], ['completed', JOB + '.wav']);
    const done = await v.voiceCheck(JOB, h.d);
    assert.ok(done.startsWith('Done. It cost $0.18. Download the cleaned voice'), done);
    assert.ok(done.includes('https://storage.test/sign/voice/' + JOB + '.wav?expires=3600'), 'a signed link to the private copy, 1 hour');
    assert.ok(!done.includes('auphonic.com'), 'Auphonic\'s own link is never handed out');
  }

  // A failed production: logged as failed (not counted), plain English.
  {
    const h = harness({ auphonicGet: () => resp(200, { json: { data: { status: 2, error_message: 'Could not download input file from URL' } } }) });
    await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, h.d);
    const t = await v.voiceCheck(JOB, h.d);
    assert.ok(t.startsWith('It failed: Auphonic could not download the recording.'), t);
    assert.ok(t.includes('nothing was spent'));
    assert.strictEqual(h.rows.get(1).status, 'failed');
    assert.strictEqual(who.outcomeOf('check_job', t).ok, false);
  }

  // A copy that fails: delivery_failed, error has no link in it, and the next check retries.
  {
    const done = () => resp(200, { json: { data: { status: 3, length: 60, output_files: [{ format: 'wav', download_url: 'https://auphonic.com/api/download/audio-result/X/v.wav' }] } } });
    const h = harness({ auphonicGet: done, download: () => resp(500) });
    await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, h.d);
    await v.voiceCheck(JOB, h.d);
    await h.calls.background[0];
    const row = h.rows.get(1);
    assert.strictEqual(row.status, 'delivery_failed');
    assert.ok(!/https?:/.test(row.error), 'no link (which could carry the key) in the stored error');
    const t = await v.voiceCheck(JOB, h.d);
    assert.ok(t.startsWith('Could not save the cleaned voice yet'), t);
    assert.strictEqual(h.calls.background.length, 2, 'the next check retries the copy');
    // A 401 on the header download retries once with Auphonic's bearer_token parameter.
    const h2 = harness({ auphonicGet: done, download: (url) => /bearer_token=/.test(url) ? resp(200, { body: new Uint8Array([9]) }) : resp(401) });
    await v.voiceCleanup({ file: FILE, strength: 'gentle', go: true }, h2.d);
    await v.voiceCheck(JOB, h2.d);
    await h2.calls.background[0];
    assert.strictEqual(h2.rows.get(1).status, 'completed');
  }

  // Unknown job id.
  {
    const h = harness();
    assert.ok((await v.voiceCheck('99999999-2222-3333-4444-555555555555', h.d)).startsWith('That job_id'));
  }

  // ---- Wiring in index.ts (kept small: Toolkit 2 edits the same file) ----
  const src = read('index.ts');
  assert.ok(/import \{ VOICE_MODEL, VOICE_TOOL, voiceCheck, voiceCleanup \} from "\.\/voice\.mjs";/.test(src));
  const toolsAt = src.indexOf('const TOOLS = [');
  const voiceAt = src.indexOf('\n  VOICE_TOOL,\n');
  assert.ok(toolsAt > 0 && voiceAt > toolsAt && voiceAt < src.indexOf('\n];', toolsAt), 'the tool is in the tool list (so it also gets who and summary)');
  assert.ok(/if \(name === "voice_cleanup"\) return await voiceCleanup\(args, voiceDeps\(author\)\);/.test(src));
  assert.ok(/if \(row && row\.model === VOICE_MODEL\) return await voiceCheck\(jobId, voiceDeps\(""\)\);/.test(src), 'check_job and wait_for_job route voice jobs');
  assert.ok(src.indexOf('row.model === VOICE_MODEL') < src.indexOf('answeredFromLog(String(row.model))'));
  assert.strictEqual(v.VOICE_TOOL.name, 'voice_cleanup');
  assert.deepStrictEqual(v.VOICE_TOOL.inputSchema.required, ['file', 'strength']);
  assert.ok(!/AUPHONIC_KEY/.test(read('voice.ts')), 'the key is read in one place');
  // The output bucket is private and created by a migration with an applied-when probe.
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261017040000_hf_voice_bucket.sql'), 'utf8');
  assert.ok(/^-- ef-auto-deploy-applied-when: select exists \(select 1 from storage\.buckets where id = 'voice' and public = false\)$/m.test(sql));
  assert.ok(/values \('voice', 'voice', false,/.test(sql));
  assert.ok(!/create policy/i.test(sql), 'no storage policy: only the service role reaches the bucket');

  console.log('higgsfield-voice-cleanup: settings per strength, no key = no charge, price before go, cap reservation, Auphonic states, private copy and signed link ✅');
})().catch((e) => { console.error(e); process.exit(1); });
