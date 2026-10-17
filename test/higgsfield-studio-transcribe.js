'use strict';
/*
 * studio_transcribe on the team connector (ElevenLabs Speech-to-Text, session
 * Quill 2026-10-17).
 *
 * The logic lives in supabase/functions/higgsfield-mcp/transcribe.mjs (plain
 * JavaScript) and runs here for real against a fake network, database and
 * storage: the exact ElevenLabs request, the key names, the missing-key
 * answer (no charge, no reservation), the price card before go, the
 * reservation against the monthly cap, the background job, the transcript
 * stored unchanged and handed back as a signed link, the free cache hit, the
 * length guard and plain-English errors. index.ts is checked for its wiring
 * only. No network: nothing here talks to ElevenLabs.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dir = path.join(ROOT, 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

// A PCM WAV: the 44 byte header and enough audio bytes for the head and tail reads.
function wav({ seconds = 120, rate = 48000, channels = 1, bits = 16, fill = 7 } = {}) {
  const byteRate = rate * channels * bits / 8;
  const size = Math.round(seconds * byteRate);
  const b = Buffer.alloc(44 + size, fill);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE((36 + size) >>> 0, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(byteRate, 28); b.writeUInt16LE(channels * bits / 8, 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(size >>> 0, 40);
  return new Uint8Array(b);
}

function resp(status, { body = null, headers = {}, text } = {}) {
  const h = new Headers(headers);
  if (text !== undefined) return new Response(text, { status, headers: h });
  return new Response(body, { status, headers: h });
}

// A file server that honours Range like CloudFront does.
function serve(bytes, range, { ignoreRange = false } = {}) {
  const total = bytes.length;
  if (ignoreRange || !range) return resp(200, { body: bytes, headers: { 'content-type': 'audio/wav', 'content-length': String(total) } });
  let from; let to;
  const m = /^bytes=(\d+)-(\d+)$/.exec(range);
  const tail = /^bytes=-(\d+)$/.exec(range);
  if (m) { from = Number(m[1]); to = Math.min(total - 1, Number(m[2])); } else if (tail) { from = Math.max(0, total - Number(tail[1])); to = total - 1; } else throw new Error('bad range ' + range);
  return resp(206, { body: bytes.slice(from, to + 1), headers: { 'content-type': 'audio/wav', 'content-range': `bytes ${from}-${to}/${total}` } });
}

const KEY = 'test-elevenlabs-key-not-real';
const FILE = 'https://example-cdn.test/uploads/take.wav';
const JOB = '11111111-2222-3333-4444-555555555555';
const TRANSCRIPT = '{"language_code":"eng","language_probability":0.99,"text":"Hello there.","words":[{"text":"Hello","start":0.1,"end":0.5,"type":"word","speaker_id":"speaker_0"},{"text":" ","start":0.5,"end":0.6,"type":"spacing","speaker_id":"speaker_0"},{"text":"there.","start":0.6,"end":1.0,"type":"word","speaker_id":"speaker_0"}],"audio_duration_secs":120.0}';

function harness({ env = { ELEVENLABS_KEY: KEY }, file = wav(), whole, cap = 200, reserve, stt, ignoreRange = false, uploadFails = false, rows: preset, clockStep = 0 } = {}) {
  const calls = { fetch: [], reserve: [], update: [], upload: [], background: [], stt: [], sourceUpload: [], removed: [] };
  const rows = preset || new Map();
  const store = new Map();
  const sources = new Map();
  let tick = 0;
  let nextId = 100;
  const d = {
    env: (k) => env[k],
    publicHost: async (u) => u.protocol === 'https:' && !/internal|localhost/.test(u.hostname),
    directLink: (l) => l,
    author: 'Tester',
    cap,
    uuid: () => JOB,
    budget: async () => 'Team budget this month: $1.00 of $200.00 used.',
    digest: async (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest().buffer,
    idemKey: async (m, model, input) => JSON.stringify([m, model, input]),
    background: (p) => { calls.background.push(p); },
    timeout: (ms) => ({ ms }),
    now: () => new Date(Date.parse('2026-10-17T16:00:00Z') + (tick++) * clockStep),
    reserve: async (p) => {
      calls.reserve.push(p);
      if (reserve) return reserve(p);
      const id = nextId++;
      rows.set(id, { id, model: p.model, status: 'submitted', est_cost_usd: p.cost, params: p.params, updated_at: '2026-10-17T15:59:00Z', created_at: '2026-10-17T15:59:00Z' });
      return { outcome: 'reserved', id, spent: 1 };
    },
    update: async (id, fields, only) => {
      calls.update.push({ id, fields, only });
      const r = rows.get(id);
      if (!r) return 0;
      if (only && only.status && r.status !== only.status) return 0;
      Object.assign(r, fields);
      return 1;
    },
    byRequest: async (rid) => [...rows.values()].find((r) => r.request_id === rid) || null,
    cached: async (key) => [...rows.values()].reverse().find((r) => r.model === 'elevenlabs/scribe_v2' && r.status === 'completed' && r.video_url && r.params && r.params.source_hash === key && r.params.cache_ok === true) || null,
    upload: async (p, text) => { if (uploadFails) throw new Error('Bucket not found'); calls.upload.push({ p, text }); store.set(p, text); },
    exists: async (p) => store.has(p),
    sign: async (p, s) => { if (!store.has(p)) throw new Error('Object not found'); return `https://storage.test/sign/transcripts/${p}?expires=${s}`; },
    uploadSource: async (p, body) => {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      calls.sourceUpload.push({ p, size: bytes.length });
      sources.set(p, bytes);
    },
    signSource: async (p, s) => { if (!sources.has(p)) throw new Error('Object not found'); return `https://storage.test/sign/transcribe-sources/${p}?expires=${s}`; },
    removeSource: async (p) => { calls.removed.push(p); sources.delete(p); },
    fetch: async (url, init = {}) => {
      calls.fetch.push({ url, init });
      if (url === 'https://api.elevenlabs.io/v1/speech-to-text') {
        calls.stt.push(init);
        return stt ? stt(init) : resp(200, { text: TRANSCRIPT, headers: { 'content-type': 'application/json' } });
      }
      if (url === FILE) {
        const range = (init.headers || {}).Range;
        // whole: what the link serves to a plain download (a swap after pricing).
        return serve(!range && whole ? whole : file, range, { ignoreRange });
      }
      const m = /^https:\/\/storage\.test\/sign\/transcribe-sources\/([^?]+)\?/.exec(url);
      if (m && sources.has(m[1])) return serve(sources.get(m[1]), (init.headers || {}).Range);
      return resp(404);
    },
  };
  return { d, calls, rows, store };
}

(async () => {
  const t = await import(path.join(dir, 'transcribe.mjs'));
  const who = await import(path.join(dir, 'who.mjs'));

  // ---- The request: the studio's own settings, the link as source_url ----
  assert.deepStrictEqual(t.sttForm(FILE), [['model_id', 'scribe_v2'], ['diarize', 'true'], ['timestamps_granularity', 'word'], ['source_url', FILE]]);
  assert.strictEqual(t.ELEVENLABS_STT_URL, 'https://api.elevenlabs.io/v1/speech-to-text');

  // ---- The key: ELEVENLABS_KEY first, then ELEVENLABS_API_KEY ----
  assert.deepStrictEqual(t.SECRET_NAMES, ['ELEVENLABS_KEY', 'ELEVENLABS_API_KEY']);
  assert.strictEqual(t.elevenKey((k) => ({ ELEVENLABS_KEY: 'a', ELEVENLABS_API_KEY: 'b' })[k]), 'a');
  assert.strictEqual(t.elevenKey((k) => ({ ELEVENLABS_API_KEY: ' b ' })[k]), 'b');
  assert.strictEqual(t.elevenKey((k) => ({ ELEVENLABS_KEY: '  ' })[k]), '');

  // ---- Price: by the audio's length ----
  assert.strictEqual(t.usdPerHour(undefined), 6);
  assert.strictEqual(t.usdPerHour('0.22'), 0.22);
  assert.strictEqual(t.usdPerHour('abc'), null);
  assert.strictEqual(t.usdPerHour('0'), null);
  assert.strictEqual(t.priceFor(120, 6), 0.2, '2 minutes at $6 an hour');
  assert.strictEqual(t.priceFor(1800, 0.22), 0.11, '30 minutes at the API price');
  assert.strictEqual(t.priceFor(10, 0.22), 0.01, 'at least one cent');
  assert.strictEqual(t.priceFor(121, 6), 0.21, 'rounded up to the cent');

  // ---- Length guard ----
  assert.strictEqual(t.tooLong(124, 120), false, 'a few seconds over is let through');
  assert.strictEqual(t.tooLong(126, 120), true);
  assert.strictEqual(t.tooLong(1830, 1800), false, '2% of a long take is let through');
  assert.strictEqual(t.tooLong(1840, 1800), true);
  assert.strictEqual(t.tooLong(undefined, 120), false, 'no reported length is not a mismatch');

  // ---- Errors in plain English ----
  assert.ok(t.elevenErrorText(401, {}).includes('did not accept the key'));
  assert.ok(t.elevenErrorText(400, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota' } }).includes('run out of credits'));
  assert.ok(t.elevenErrorText(400, { detail: { message: 'Could not download file from source_url' } }).startsWith('ElevenLabs could not download the recording'));
  assert.ok(t.elevenErrorText(422, { detail: [{ msg: 'Unsupported audio format' }] }).startsWith('ElevenLabs could not read the file as audio'));
  assert.ok(t.elevenErrorText(429, {}).includes('busy'));

  // ---- Missing key: plain answer, no fetch, no reservation ----
  {
    const h = harness({ env: {} });
    const a = await t.studioTranscribe({ file: FILE }, h.d);
    const b = await t.studioTranscribe({ file: FILE, go: true }, h.d);
    assert.strictEqual(a, 'Transcription is not switched on yet: the account owner needs to add the ElevenLabs key.');
    assert.strictEqual(b, a);
    assert.strictEqual(h.calls.reserve.length, 0, 'no reservation without the key');
    assert.strictEqual(h.calls.fetch.length, 0, 'nothing is fetched without the key');
    assert.strictEqual(who.outcomeOf('studio_transcribe', a).ok, false, 'logged as a failure in hf_activity');
    // The fallback name is read too.
    const h2 = harness({ env: { ELEVENLABS_API_KEY: KEY } });
    assert.ok((await t.studioTranscribe({ file: FILE }, h2.d)).startsWith('Plan: transcribe a take'));
  }

  // ---- Price card first: nothing reserved, nothing sent to ElevenLabs ----
  {
    const h = harness();
    const card = await t.studioTranscribe({ file: FILE }, h.d);
    assert.ok(card.startsWith('Plan: transcribe a take (ElevenLabs Speech-to-Text, Scribe v2)'), card);
    assert.ok(card.includes('- File: 2.0 minutes, 48000 Hz, mono, 16-bit WAV'));
    assert.ok(card.includes('- Price: about $0.20 (ElevenLabs bills by the audio\'s length, $6.00 an hour)'));
    assert.ok(card.includes('Team budget this month'));
    assert.ok(card.includes('Say go, or tell me what to change.'));
    assert.strictEqual(h.calls.reserve.length, 0);
    assert.strictEqual(h.calls.stt.length, 0);
    const ranges = h.calls.fetch.map((c) => c.init.headers.Range);
    assert.strictEqual(ranges[0], 'bytes=0-262143', 'the header read comes first');
    assert.strictEqual(ranges.length, 10, 'head, eight samples in between and tail');
    assert.ok(ranges.includes('bytes=-262144'));
    assert.strictEqual(ranges.filter((r) => /^bytes=\d+-\d+$/.test(r) && r !== 'bytes=0-262143').length, 8);
    assert.deepStrictEqual(t.samplePoints(11520044), [1280004, 2560009, 3840014, 5120019, 6400024, 7680029, 8960034, 10240039]);
    assert.deepStrictEqual(t.samplePoints(400000), [], 'a file the two ends cover needs no samples');
    assert.strictEqual(who.outcomeOf('studio_transcribe', card).ok, true);
    // The rate setting is used, and a bad one stops pricing.
    const h2 = harness({ env: { ELEVENLABS_KEY: KEY, ELEVENLABS_USD_PER_HOUR: '0.22' } });
    assert.ok((await t.studioTranscribe({ file: FILE }, h2.d)).includes('about $0.01 (ElevenLabs bills by the audio\'s length, $0.22 an hour)'));
    const h3 = harness({ env: { ELEVENLABS_KEY: KEY, ELEVENLABS_USD_PER_HOUR: 'six' } });
    assert.ok((await t.studioTranscribe({ file: FILE }, h3.d)).startsWith('Could not price it'));
  }

  // ---- Bad files: plain English, nothing reserved ----
  {
    const page = harness();
    page.d.fetch = async () => resp(206, { body: new TextEncoder().encode('<html>'), headers: { 'content-type': 'text/html', 'content-range': 'bytes 0-5/6' } });
    assert.ok((await t.studioTranscribe({ file: FILE, go: true }, page.d)).startsWith('That link opened a web page'));
    const mp3 = harness({ file: new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]) });
    assert.ok((await t.studioTranscribe({ file: FILE, go: true }, mp3.d)).startsWith('That file is not a WAV recording'));
    const long = harness({ file: wav({ seconds: 31 * 60, rate: 8000 }) });
    assert.ok((await t.studioTranscribe({ file: FILE, go: true }, long.d)).startsWith('That file is 31.0 minutes long; transcription takes up to 30 minutes.'));
    const priv = harness();
    assert.ok((await t.studioTranscribe({ file: 'https://db.internal/take.wav', go: true }, priv.d)).startsWith('That link points somewhere that is not a public'));
    assert.ok((await t.studioTranscribe({ file: 'http://example.test/a.wav', go: true }, priv.d)).startsWith('The link must start with https://'));
    for (const h of [page, mp3, long, priv]) assert.strictEqual(h.calls.reserve.length, 0);
  }

  // ---- go: reserved against the cap, background job, stored unchanged, signed link ----
  {
    const h = harness();
    const started = await t.studioTranscribe({ file: FILE, go: true }, h.d);
    assert.ok(started.startsWith('Started: transcription of a 2.0 minute take, about $0.20.'), started);
    assert.ok(started.includes(`job_id: ${JOB}`));
    assert.strictEqual(h.calls.reserve.length, 1);
    const r = h.calls.reserve[0];
    assert.strictEqual(r.model, 'elevenlabs/scribe_v2');
    assert.strictEqual(r.cost, 0.2);
    assert.strictEqual(r.cap, 200);
    assert.strictEqual(r.member, 'Tester');
    assert.ok(/^[0-9a-f]{64}$/.test(r.params.source_hash), 'the cache key is a SHA-256');
    assert.strictEqual(r.params.cache_ok, false, 'not cacheable until the transcript is stored');
    assert.strictEqual(h.rows.get(100).request_id, JOB);
    // While the job runs, check_job says still working (wait_for_job keeps waiting on that wording).
    assert.ok((await t.transcribeCheck(JOB, h.d)).startsWith('Still working'));
    await h.calls.background[0];
    // The file was copied into the private bucket first, and ElevenLabs read only the copy.
    assert.deepStrictEqual(h.calls.sourceUpload, [{ p: `${JOB}.wav`, size: wav().length }]);
    const statuses = h.calls.update.filter((u) => u.id === 100).map((u) => u.fields.status);
    assert.deepStrictEqual(statuses, ['copying', 'copied', 'in_progress', 'completed']);
    // Every read of the person's link has a time limit: 30 s for a range read, 330 s for the whole copy.
    const linkReads = h.calls.fetch.filter((c) => c.url === FILE);
    assert.ok(linkReads.every((c) => c.init.signal && c.init.signal.ms > 0), 'no read of the link without a time limit');
    assert.deepStrictEqual(linkReads.filter((c) => !c.init.headers.Range).map((c) => c.init.signal.ms), [330000], 'the copy download gets 330 s');
    assert.ok(linkReads.filter((c) => c.init.headers.Range).every((c) => c.init.signal.ms === 30000));
    assert.deepStrictEqual(h.calls.removed, [`${JOB}.wav`], 'the audio copy is deleted when the job ends');
    // The exact request.
    assert.strictEqual(h.calls.stt.length, 1);
    const init = h.calls.stt[0];
    assert.strictEqual(init.method, 'POST');
    assert.strictEqual(init.headers['xi-api-key'], KEY);
    assert.deepStrictEqual([...init.body.entries()], [['model_id', 'scribe_v2'], ['diarize', 'true'], ['timestamps_granularity', 'word'], ['source_url', `https://storage.test/sign/transcribe-sources/${JOB}.wav?expires=900`]], 'ElevenLabs gets a 15 minute link to our copy, never the person\'s link');
    assert.deepStrictEqual(init.signal, { ms: 300000 }, 'the request is given a time limit that leaves room before the 400 s background limit');
    // Stored byte for byte.
    assert.deepStrictEqual(h.calls.upload, [{ p: `${JOB}.json`, text: TRANSCRIPT }]);
    const row = h.rows.get(100);
    assert.strictEqual(row.status, 'completed');
    assert.strictEqual(row.video_url, `${JOB}.json`);
    assert.strictEqual(row.est_cost_usd, 0.2, 'real cost from ElevenLabs\' reported length');
    assert.strictEqual(row.params.audio_seconds, 120);
    assert.strictEqual(row.params.cache_ok, true);
    const done = await t.transcribeCheck(JOB, h.d);
    assert.ok(done.startsWith('Done. It cost $0.20. Download the transcript (ElevenLabs JSON, unchanged'), done);
    assert.ok(done.includes(`https://storage.test/sign/transcripts/${JOB}.json?expires=3600`), 'a signed link to the private copy, 1 hour');
    assert.ok(!done.includes(KEY));
    assert.strictEqual(who.outcomeOf('check_job', done).ok, true);

    // ---- Cache: the same take again is free, before and after go ----
    const again = await t.studioTranscribe({ file: FILE }, h.d);
    assert.ok(again.startsWith('This take was transcribed before, so it is free this time'), again);
    assert.ok(again.includes(`job_id: ${JOB}`));
    const againGo = await t.studioTranscribe({ file: FILE, go: true }, h.d);
    assert.ok(againGo.startsWith('This take was transcribed before'));
    assert.strictEqual(h.calls.reserve.length, 1, 'no new reservation for a cached take');
    assert.strictEqual(h.calls.stt.length, 1, 'ElevenLabs is not asked again');
  }

  // A different take of the same length and size is not a cache hit (the audio differs).
  {
    const h = harness();
    await t.studioTranscribe({ file: FILE, go: true }, h.d);
    await h.calls.background[0];
    const other = harness({ file: wav({ fill: 9 }), rows: h.rows });
    other.d.exists = h.d.exists;
    const card = await t.studioTranscribe({ file: FILE }, other.d);
    assert.ok(card.startsWith('Plan: transcribe a take'), card);
    // Same size, same first and last 256 KB, different audio in the middle: not a hit (Codex on #2150).
    const mid = wav();
    mid.fill(3, 3000000, 9000000);
    const middle = harness({ file: mid, rows: h.rows });
    middle.d.exists = h.d.exists;
    assert.ok((await t.studioTranscribe({ file: FILE }, middle.d)).startsWith('Plan: transcribe a take'), 'a take that differs only in the middle is priced, not served from the cache');
    // A cached row whose file is gone from the bucket is not served.
    const gone = harness({ rows: h.rows });
    assert.ok((await t.studioTranscribe({ file: FILE }, gone.d)).startsWith('Plan: transcribe a take'));
  }

  // A server that ignores Range: priced from the header with no cache key; the
  // key then comes from our own copy (the bytes ElevenLabs reads), so a later
  // link to the same file can still be served free.
  {
    const h = harness({ ignoreRange: true });
    const card = await t.studioTranscribe({ file: FILE, go: true }, h.d);
    assert.ok(card.startsWith('Started:'), card);
    assert.strictEqual(h.calls.reserve[0].params.source_hash, null);
    await h.calls.background[0];
    assert.strictEqual(h.rows.get(100).params.cache_ok, true);
    const ranged = harness({ rows: h.rows });
    ranged.d.exists = h.d.exists;
    assert.ok((await t.studioTranscribe({ file: FILE }, ranged.d)).startsWith('This take was transcribed before'), 'the copy\'s key matches the same file read with ranges');
    // A different file at the same link (no cache key) is not taken for the one already started.
    const other = harness({ ignoreRange: true, file: wav({ seconds: 90 }) });
    await t.studioTranscribe({ file: FILE, go: true }, other.d);
    assert.notStrictEqual(other.calls.reserve[0].idemKey, h.calls.reserve[0].idemKey, 'the duplicate check sees the file changed');
    const same = harness({ ignoreRange: true });
    await t.studioTranscribe({ file: FILE, go: true }, same.d);
    assert.strictEqual(same.calls.reserve[0].idemKey, h.calls.reserve[0].idemKey, 'the same file at the same link is still a duplicate');
  }

  // ---- The file behind the link changes after pricing (SyncView supervisor on #2150) ----
  {
    // The price check sees 2 minutes; a plain download gets 10 minutes.
    const h = harness({ whole: wav({ seconds: 600 }) });
    const started = await t.studioTranscribe({ file: FILE, go: true }, h.d);
    assert.ok(started.startsWith('Started:'), started);
    await h.calls.background[0];
    assert.strictEqual(h.calls.stt.length, 0, 'ElevenLabs is never asked');
    const row = h.rows.get(100);
    assert.strictEqual(row.status, 'failed', 'failed leaves the monthly budget: nothing was spent');
    assert.ok(row.error.startsWith('the file at the link is bigger than the one that was priced'), row.error);
    assert.deepStrictEqual(h.calls.removed, [`${JOB}.wav`]);
    const msg = await t.transcribeCheck(JOB, h.d);
    assert.ok(msg.startsWith('It failed: the file at the link is bigger') && msg.includes('nothing was spent'), msg);
    assert.strictEqual(who.outcomeOf('wait_for_job', msg).ok, false);
  }
  {
    // A server that gives no size: the copy stops at the header's audio plus 1 MB.
    const h = harness({ ignoreRange: true, whole: wav({ seconds: 600 }) });
    h.d.fetch = ((orig) => async (url, init = {}) => {
      const r = await orig(url, init);
      if (url === FILE) r.headers.delete('content-length');
      return r;
    })(h.d.fetch);
    await t.studioTranscribe({ file: FILE, go: true }, h.d);
    assert.strictEqual(h.calls.reserve[0].params.total_bytes, null);
    await h.calls.background[0];
    assert.strictEqual(h.calls.stt.length, 0);
    assert.strictEqual(h.rows.get(100).status, 'failed');
    assert.strictEqual(t.copyLimit({ total_bytes: null, audio_bytes: 1000 }), 1000 + 1024 * 1024);
    assert.strictEqual(t.copyLimit({ total_bytes: 5000, audio_bytes: 1000 }), 5000);
    assert.strictEqual(t.copyLimit({ total_bytes: 10 * 1024 * 1024 * 1024 }), 400 * 1024 * 1024);
  }
  {
    // A header that claims 10 seconds of audio in a 2 minute file.
    const f = wav();
    Buffer.from(f.buffer).writeUInt32LE(10 * 96000, 40);
    const h = harness({ file: f });
    const card = await t.studioTranscribe({ file: FILE }, h.d);
    assert.ok(card.includes('0.2 minutes'), card);
    await t.studioTranscribe({ file: FILE, go: true }, h.d);
    await h.calls.background[0];
    assert.strictEqual(h.calls.stt.length, 0);
    assert.ok(h.rows.get(100).error.startsWith('the file holds more than the audio its header describes'), h.rows.get(100).error);
  }
  {
    // A slow copy: the request is started by the next check_job, once.
    const h = harness({ clockStep: 61 * 1000 });
    await t.studioTranscribe({ file: FILE, go: true }, h.d);
    await h.calls.background[0];
    assert.strictEqual(h.rows.get(100).status, 'copied');
    assert.strictEqual(h.calls.stt.length, 0);
    const w = await t.transcribeCheck(JOB, h.d);
    assert.ok(w.startsWith('Still working'), w);
    assert.strictEqual(h.calls.background.length, 2);
    await h.calls.background[1];
    assert.strictEqual(h.calls.stt.length, 1);
    assert.strictEqual(h.rows.get(100).status, 'completed');
    // A copy that never finished is failed (nothing spent), not left running.
    const s2 = harness();
    s2.rows.set(8, { id: 8, model: 'elevenlabs/scribe_v2', request_id: JOB, status: 'copying', est_cost_usd: 0.2, params: {}, updated_at: '2026-10-17T15:30:00Z' });
    const m = await t.transcribeCheck(JOB, s2.d);
    assert.ok(m.startsWith('It failed: copying the file did not finish'), m);
    assert.strictEqual(s2.rows.get(8).status, 'failed');
    assert.deepStrictEqual(s2.calls.removed, [`${JOB}.wav`], 'a half-made copy is deleted too (SyncView supervisor on #2150)');
  }

  // ---- A compressed stream inside a WAV is never priced or sent (SyncView supervisor on #2150, #2156) ----
  {
    const mp3 = wav();
    Buffer.from(mp3.buffer).writeUInt16LE(0x55, 20);
    const h = harness({ file: mp3 });
    const card = await t.studioTranscribe({ file: FILE }, h.d);
    assert.ok(card.startsWith('That WAV is compressed, not a plain recording.'), card);
    assert.ok((await t.studioTranscribe({ file: FILE, go: true }, h.d)).startsWith('That WAV is compressed'));
    assert.strictEqual(h.calls.reserve.length, 0, 'nothing reserved');
    assert.strictEqual(who.outcomeOf('studio_transcribe', card).ok, false, 'logged as a failure in hf_activity');
    // Priced as plain PCM, but the link then serves a compressed file of the same size: the copy is refused.
    const swapped = harness({ whole: mp3 });
    await t.studioTranscribe({ file: FILE, go: true }, swapped.d);
    await swapped.calls.background[0];
    assert.strictEqual(swapped.calls.stt.length, 0, 'ElevenLabs is never asked');
    assert.strictEqual(swapped.rows.get(100).status, 'failed');
    assert.ok(swapped.rows.get(100).error.startsWith('the copied file could not be read: That WAV is compressed'), swapped.rows.get(100).error);
    assert.deepStrictEqual(swapped.calls.removed, [`${JOB}.wav`]);
  }

  // ---- Budget and duplicates ----
  {
    const over = harness({ reserve: () => ({ outcome: 'over_cap', spent: 199.95 }) });
    const tx = await t.studioTranscribe({ file: FILE, go: true }, over.d);
    assert.strictEqual(tx, 'Refused: this ($0.20) would pass the team\'s monthly budget of $200.00 ($199.95 already used). Ask the account owner.');
    assert.strictEqual(over.calls.stt.length, 0);
    assert.strictEqual(over.calls.background.length, 0);
    const dup = harness({ reserve: () => ({ outcome: 'duplicate', request_id: 'abc' }) });
    assert.ok((await t.studioTranscribe({ file: FILE, go: true }, dup.d)).includes('not charged twice'));
    const nocap = harness({ cap: null });
    assert.ok((await t.studioTranscribe({ file: FILE, go: true }, nocap.d)).startsWith('The monthly budget setting'));
    assert.strictEqual(nocap.calls.reserve.length, 0);
    const nolog = harness({ reserve: () => null });
    assert.strictEqual(await t.studioTranscribe({ file: FILE, go: true }, nolog.d), 'Could not start: the log is unavailable, so nothing was spent.');
  }

  // ---- Length guard: ElevenLabs read more than was priced ----
  {
    const longer = TRANSCRIPT.replace('"audio_duration_secs":120.0', '"audio_duration_secs":600.0');
    const h = harness({ stt: () => resp(200, { text: longer }) });
    await t.studioTranscribe({ file: FILE, go: true }, h.d);
    await h.calls.background[0];
    const row = h.rows.get(100);
    assert.strictEqual(row.status, 'refused_length', 'kept in the budget (ElevenLabs charged it), not "failed"');
    assert.strictEqual(row.est_cost_usd, 1, 'the real cost of 10 minutes is written back');
    assert.strictEqual(h.calls.upload.length, 0, 'the transcript of the wrong file is not kept or cached');
    const msg = await t.transcribeCheck(JOB, h.d);
    assert.ok(msg.startsWith('Refused: ElevenLabs read 10.0 minutes of audio, more than the 2.0 minutes priced'), msg);
    assert.strictEqual(who.outcomeOf('wait_for_job', msg).ok, false);
  }

  // ---- ElevenLabs refuses or does not answer ----
  {
    const refused = harness({ stt: () => resp(401, { text: '{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}' }) });
    await t.studioTranscribe({ file: FILE, go: true }, refused.d);
    await refused.calls.background[0];
    assert.strictEqual(refused.rows.get(100).status, 'failed', 'a 4xx is a refusal: not counted');
    const m1 = await t.transcribeCheck(JOB, refused.d);
    assert.ok(m1.startsWith('It failed: ElevenLabs did not accept the key'), m1);
    assert.ok(m1.includes('nothing was spent'));

    const down = harness({ stt: () => resp(503, { text: 'Service Unavailable' }) });
    await t.studioTranscribe({ file: FILE, go: true }, down.d);
    await down.calls.background[0];
    assert.strictEqual(down.rows.get(100).status, 'submit_unknown', 'a 5xx may have been billed: stays in the budget');
    assert.ok((await t.transcribeCheck(JOB, down.d)).startsWith('Could not confirm the transcription'));

    const silent = harness({ stt: () => { throw new Error('The signal has been aborted'); } });
    await t.studioTranscribe({ file: FILE, go: true }, silent.d);
    await silent.calls.background[0];
    assert.strictEqual(silent.rows.get(100).status, 'submit_unknown');

    const nowords = harness({ stt: () => resp(200, { text: '{"text":"hi"}' }) });
    await t.studioTranscribe({ file: FILE, go: true }, nowords.d);
    await nowords.calls.background[0];
    assert.strictEqual(nowords.rows.get(100).status, 'delivery_failed');

    const nostore = harness({ uploadFails: true });
    await t.studioTranscribe({ file: FILE, go: true }, nostore.d);
    await nostore.calls.background[0];
    assert.strictEqual(nostore.rows.get(100).status, 'delivery_failed');
    const m2 = await t.transcribeCheck(JOB, nostore.d);
    assert.ok(m2.startsWith('Could not save the transcript: could not store the transcript: Bucket not found. It was made and charged ($0.20).'), m2);

    // A job whose background request never came back (the server stopped it).
    const stale = harness();
    stale.rows.set(7, { id: 7, model: 'elevenlabs/scribe_v2', request_id: JOB, status: 'in_progress', est_cost_usd: 0.2, params: {}, updated_at: '2026-10-17T15:30:00Z' });
    const m3 = await t.transcribeCheck(JOB, stale.d);
    assert.ok(m3.startsWith('Could not confirm the transcription with ElevenLabs (no answer'), m3);
    assert.strictEqual(stale.rows.get(7).status, 'submit_unknown');

    assert.ok((await t.transcribeCheck('99999999-2222-3333-4444-555555555555', stale.d)).startsWith('That job_id'));
  }

  // ---- Wiring in index.ts (kept small: other sessions edit the same file) ----
  const src = read('index.ts');
  assert.ok(src.includes('import { STT_MODEL, STT_TOOL, studioTranscribe, transcribeCheck } from "./transcribe.mjs";'));
  assert.ok(src.includes('import { transcribeStore } from "./transcribe.ts";'));
  const toolsAt = src.indexOf('const TOOLS = [');
  const toolAt = src.indexOf('\n  STT_TOOL,\n');
  assert.ok(toolsAt > 0 && toolAt > toolsAt && toolAt < src.indexOf('\n];', toolsAt), 'the tool is in the tool list (so it also gets who and summary)');
  assert.ok(src.includes('if (name === "studio_transcribe") return await studioTranscribe(args, transcribeDeps(author));'));
  assert.ok(src.includes('if (row && row.model === STT_MODEL) return await transcribeCheck(jobId, transcribeDeps(""));'), 'check_job and wait_for_job route transcription jobs');
  assert.ok(src.indexOf('row.model === STT_MODEL') > src.indexOf('async function checkJob('));
  assert.ok(src.indexOf('row.model === STT_MODEL') < src.indexOf('requests/${jobId}/status'), 'routed before the Higgsfield status call');
  assert.strictEqual(t.STT_TOOL.name, 'studio_transcribe');
  assert.deepStrictEqual(t.STT_TOOL.inputSchema.required, ['file']);
  assert.ok(!/ELEVENLABS/.test(read('transcribe.ts')), 'the key is read in one place');
  assert.ok(!/ELEVENLABS/.test(src.replace(/\/\/[^\n]*/g, '')), 'index.ts reads no ElevenLabs secret itself');
  // The transcript bucket is private, JSON only, and created by a migration with an applied-when probe.
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261017160000_hf_transcripts_bucket.sql'), 'utf8');
  assert.ok(/^-- ef-auto-deploy-applied-when: select \(select count\(\*\) from storage\.buckets where id in \('transcripts', 'transcribe-sources'\) and public = false\) = 2$/m.test(sql));
  assert.ok(/values \('transcribe-sources', 'transcribe-sources', false, 419430400, array\['audio\/wav', 'audio\/x-wav', 'audio\/wave'\]\)/.test(sql), 'the audio copies: private, WAV only, 400 MB');
  assert.ok(/values \('transcripts', 'transcripts', false, 52428800, array\['application\/json'\]\)/.test(sql));
  assert.ok(!/create policy/i.test(sql), 'no storage policy: only the service role reaches the bucket');

  console.log('higgsfield-studio-transcribe: studio request, key names, no key = no charge, price before go, cap reservation, stored unchanged + signed link, free cache hit, length guard, plain errors ✅');
})().catch((e) => { console.error(e); process.exit(1); });
