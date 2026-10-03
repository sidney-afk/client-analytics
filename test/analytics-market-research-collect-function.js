'use strict';
/*
 * analytics-market-research-collect-function.js: the Edge Function itself, run offline against an
 * in-memory database and scripted Apify / video / Whisper / Claude answers.
 *
 * Proves what the pure-rules test cannot: auth and the off switch, the allow-list of clients, the spending
 * cap per day, the stages (searches resumed from a saved Apify run, transcripts only for reels that can reach
 * the brief, the Claude batch polled across ticks), the brief stored in the n8n pieces with the asked-for keywords,
 * a request with no reels, a Claude batch that fails twice, a refused commit leaving the request retryable, and that
 * the real table analytics_market_research_briefs is never touched.
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (process.argv[2] !== 'child') {
  const hook = path.join(__dirname, 'fixtures/metrics-collect-register.mjs');
  const r = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', hook, __filename, 'child'], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

const assert = require('assert/strict');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const KEY = 'k'.repeat(40);

const env = { ANALYTICS_COLLECT_KEY: KEY, APIFY_TOKEN: 'apify-test', OPENAI_KEY: 'openai-test', ANTHROPIC_API_KEY: 'anthropic-test',
  SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ANALYTICS_COLLECT_TICK_BUDGET_MS: '8100' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { globalThis.__handler = h; } };

const SENTINEL = [{ id: 'old', client_slug: 'aaa', date: '2020-01-01', raw_json: '{}' }];
const resetDb = (extra = {}) => {
  globalThis.__DB = {
    client_profiles: [{ slug: 'aaa', display_name: 'Client A', keywords: 'the niche', content_description: 'what they make', archived_at: null },
      { slug: 'zzz', display_name: 'Client Z', keywords: '', content_description: '', archived_at: null }],
    syncview_runtime_flags: [{ key: 'analytics_market_research_collect', value: { mode: 'shadow', clients: ['aaa'], max_new_per_day: 3 } }],
    analytics_market_research_briefs: JSON.parse(JSON.stringify(SENTINEL)),
    analytics_market_research_collect_queue: [],
    ...extra,
  };
  globalThis.__DB_FAIL = {};
};
let n = 0;
const addRequest = (slug = 'aaa', keywords = ['kw one', 'kw two'], over = {}) => {
  const row = { id: 'req' + (++n), client_slug: slug, keywords, state: 'pending', attempts: 0, started_at: null, lease_until: null, stages: {}, outcome: null, created_at: new Date(Date.now() + n).toISOString(), ...over };
  globalThis.__DB.analytics_market_research_collect_queue.push(row);
  return row;
};

// ---- scripted providers ----
const world = { whisperStatus: 200, whisperHits: 0, ttReady: false, igFails: false, ttFails: false, batchPolls: 0, batchEndsAfter: 1, batchResult: 'ok', batchSubmits: 0 };
const calls = [];
const text = (body, status = 200) => ({ ok: status < 400, status, json: async () => JSON.parse(body), text: async () => body });
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const recent = d => new Date(Date.now() - d * 86400000).toISOString();
const video = (size, id) => ({ ok: true, status: 200, headers: { get: h => (h === 'content-length' ? String(size) : null) },
  body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(Math.min(size, 700000)) })), cancel: async () => {} }; }, cancel: async () => {} }, id });
const briefJson = () => JSON.stringify({ clientName: 'Client A', date: '2026-10-02', totalReels: 3, keywords: ['model guess'], landscapeAnalysis: [], filler: 'f'.repeat(60000) });

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  calls.push((init.method || 'GET') + ' ' + url.replace(/\?.*$/, ''));
  if (url.startsWith('https://api.apify.com/v2/acts/')) {
    const actor = url.split('/acts/')[1].split('/')[0];
    if (world.igFails && actor.startsWith('patient')) return ok({ error: {} }, 500);
    if (world.ttFails && actor.startsWith('clockworks')) return ok({ error: {} }, 500);
    const slow = actor.startsWith('clockworks') && !world.ttReady;
    return ok({ data: { id: 'run~' + actor + '~' + JSON.parse(init.body).query + JSON.stringify(JSON.parse(init.body).searchQueries || ''), status: slow ? 'RUNNING' : 'SUCCEEDED', defaultDatasetId: 'ds~' + actor } });
  }
  if (url.startsWith('https://api.apify.com/v2/actor-runs/')) return ok({ data: { status: url.includes('clockworks') && !world.ttReady ? 'RUNNING' : 'SUCCEEDED' } });
  if (url.startsWith('https://api.apify.com/v2/datasets/')) {
    if (url.includes('patient')) return ok([
      { code: 'A1', ig_play_count: 500000, like_count: 10, share_count: 5, user: { username: 'u1' }, caption: { text: 'cap one' }, video_url: 'https://cdn.example/big', taken_at_date: recent(2), junk: 'x'.repeat(5000) },
      { code: 'A2', ig_play_count: 300000, user: { username: 'u2' }, video_url: 'https://cdn.example/small', taken_at_date: recent(3) },
      { code: 'A3', ig_play_count: 2000, user: { username: 'u3' }, video_url: 'https://cdn.example/never', taken_at_date: recent(3) }]);
    return ok([{ id: 'T1', playCount: 400000, webVideoUrl: 'https://www.tiktok.com/@a/video/1', text: 'tt', createTimeISO: recent(1), videoMeta: { subtitleLinks: [{ downloadLink: 'https://cdn.example/subs' }] } }]);
  }
  if (url === 'https://cdn.example/big') return video(3000000);
  if (url === 'https://cdn.example/small') return video(1000);       // under 500 KB: skipped
  if (url === 'https://cdn.example/subs') return video(2000);
  if (url === 'https://cdn.example/never') throw new Error('a reel under 100,000 views must not be downloaded');
  if (url === 'https://api.openai.com/v1/audio/transcriptions') {
    world.whisperHits++;
    if (world.whisperStatus !== 200) return ok({ error: { message: 'x' } }, world.whisperStatus);
    const words = Array.from({ length: 40 }, (_, i) => 'unique' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + ((i * 5) % 26))).join(' ');
    return ok({ language: 'en', text: 'This is the opening line. ' + words + '. And the end.', segments: [{ no_speech_prob: 0.01, avg_logprob: -0.2 }] });
  }
  if (url === 'https://api.anthropic.com/v1/messages/batches') {
    world.batchSubmits++;
    const sent = JSON.parse(init.body);
    world.lastRequest = sent.requests[0];
    return ok({ id: 'batch' + world.batchSubmits });
  }
  if (/^https:\/\/api\.anthropic\.com\/v1\/messages\/batches\/batch\d+$/.test(url)) {
    world.batchPolls++;
    return ok({ processing_status: world.batchPolls > world.batchEndsAfter ? 'ended' : 'in_progress' });
  }
  if (/\/results$/.test(url)) {
    if (world.batchResult === 'errored') return text(JSON.stringify({ custom_id: 'brief', result: { type: 'errored', error: {} } }));
    return text(JSON.stringify({ custom_id: 'brief', result: { type: 'succeeded', message: { content: [{ type: 'text', text: '```json\n' + briefJson() + '\n```' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } } } }));
  }
  throw new Error('unscripted fetch ' + url);
};

const call = async (body, key = KEY) => {
  const res = await globalThis.__handler(new Request('https://example.invalid/fn', { method: 'POST', headers: { 'x-analytics-collect-key': key }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const q = id => globalThis.__DB.analytics_market_research_collect_queue.find(r => r.id === id);

(async () => {
  await import(pathToFileURL(path.join(ROOT, 'supabase/functions/analytics-market-research-collect/index.ts')).href);

  // auth and the switch
  resetDb();
  assert.equal((await globalThis.__handler(new Request('https://x/fn', { method: 'GET' }))).status, 405);
  assert.equal((await call({ action: 'tick' }, 'wrong')).status, 401, 'wrong key refused');
  env.ANALYTICS_COLLECT_KEY = 'short';
  assert.equal((await call({ action: 'tick' }, 'short')).status, 401, 'a secret under 32 characters refuses everything');
  env.ANALYTICS_COLLECT_KEY = KEY;
  const r0 = addRequest();
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'off' };
  assert.deepEqual((await call({ action: 'tick' })).body, { ok: true, skipped: 'off' }, 'off does nothing');
  assert.equal(calls.length, 0, 'off never reaches a provider');
  assert.equal(q(r0.id).attempts, 0, 'off never claims');
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'shadow', clients: ['aaa'], max_new_per_day: 3 };
  assert.equal((await call({ action: 'nope' })).status, 400);

  // a client that is not on the allow-list is refused before any provider is called
  const rz = addRequest('zzz', ['x'], { created_at: '2000-01-01T00:00:00.000Z' });
  let t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { failed: 1 });
  assert.equal(q(rz.id).last_error, 'client_not_allowed');
  assert.equal(calls.length, 0);

  // tick 1: the searches start; TikTok is still running -> waiting, state saved
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { waiting: 1 });
  const sc = q(r0.id).stages.scrape;
  assert.deepEqual(Object.keys(sc).sort(), ['ig0', 'ig1', 'tt0', 'tt1'], 'one search per keyword and platform');
  assert(sc.ig0.done && !sc.tt0.done && sc.tt0.run_id, 'finished searches are kept, a running one keeps its run id');
  assert(!JSON.stringify(sc).includes('xxxxx'), 'only the normalized fields are stored');
  assert.equal(q(r0.id).lease_until, null);

  // tick 2: TikTok done -> ranked, then the transcripts, then the Claude batch is submitted
  world.ttReady = true;
  const startsBefore = calls.filter(c => c.startsWith('POST https://api.apify.com')).length;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { waiting: 1 });
  assert.equal(calls.filter(c => c.startsWith('POST https://api.apify.com')).length, startsBefore, 'a finished run is read, not started again');
  const st = q(r0.id).stages;
  assert(st.ranked && !st.scrape, 'ranked reels kept, raw answers dropped');
  const reasons = Object.values(st.tx).map(o => (o.hookSkipped ? o.skipReason : 'used')).sort();
  assert.deepEqual(reasons, ['file_too_small', 'file_too_small', 'used'], 'three reels reach 100,000 views and have a link: the big video is used, the small video and the TikTok subtitle file are skipped by size');
  assert(!calls.includes('GET https://cdn.example/never'), 'a reel under 100,000 views is never downloaded');
  assert.equal(world.batchSubmits, 1, 'the Claude request goes in as one batch');
  const sent = world.lastRequest;
  assert.equal(sent.custom_id, 'brief');
  assert.equal(sent.params.model, 'claude-opus-4-6');
  assert.equal(sent.params.max_tokens, 32000);
  assert(sent.params.messages[0].content.includes('CLIENT NICHE: the niche') && sent.params.messages[0].content.includes('Keywords used: kw one, kw two'), 'the prompt carries the roster fields and the asked-for keywords');
  assert(sent.params.messages[0].content.includes('Full Transcript: This is the opening line.'), 'the transcript of the one usable video is in the prompt');
  assert.equal(st.claude.batch_id, 'batch1');

  // tick 3: the batch is still running; tick 4: it has ended -> the brief is stored
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { waiting: 1 });
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 });
  assert.equal(world.batchSubmits, 1, 'never submitted again');
  const brief = globalThis.__DB.mr_shadow[0];
  assert.equal(brief.queue_id, r0.id);
  assert.equal(brief.row.client_name, 'Client A');
  assert.equal(brief.row.date, '2026-10-02');
  assert.equal(brief.row.raw_json.length, 45000, 'the first piece is 45,000 characters');
  assert(brief.row.raw_json_2.length > 0 && brief.row.raw_json_3 === '', 'a brief over 45,000 characters goes in two pieces');
  const joined = JSON.parse(brief.row.raw_json + brief.row.raw_json_2);
  assert.deepEqual(joined.keywords, ['kw one', 'kw two'], 'the keywords are the asked-for ones, not the model\'s');
  assert(/^\d{4}-\d{2}-\d{2}T/.test(brief.row.id), 'the id is a timestamp, as n8n writes it');
  assert.equal(brief.outcome.model, 'claude-opus-4-6');
  assert.match(brief.outcome.prompt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(brief.outcome.transcribed, 1);
  assert.equal(q(r0.id).state, 'done');
  assert.deepEqual(globalThis.__DB.analytics_market_research_briefs, SENTINEL, 'analytics_market_research_briefs untouched');
  assert.equal((await call({ action: 'tick' })).body.claimed, 0, 'nothing left');

  // Whisper refusing the key stops the request before any paid Claude call; a busy Whisper is tried again, then counted as a failed transcript
  resetDb();
  const wk = addRequest();
  world.ttReady = true; world.batchSubmits = 0; world.batchPolls = 0; world.whisperStatus = 401;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { failed: 1 });
  assert.equal(q(wk.id).last_error, 'whisper_key_rejected_401');
  assert.equal(world.batchSubmits, 0, 'no paid Claude call after a rejected key');
  resetDb();
  const wb = addRequest();
  world.whisperStatus = 429;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { waiting: 1 }, 'a busy Whisper is tried again later, not recorded as a failed transcript');
  assert.equal(world.batchSubmits, 0);
  assert.deepEqual(Object.values(q(wb.id).stages.tx).map(o => o.skipReason), ['file_too_small', 'file_too_small'], 'only the two videos that fail on size are settled; the one sent to Whisper waits');
  await call({ action: 'tick' }); await call({ action: 'tick' });
  assert.equal(Object.values(q(wb.id).stages.tx).filter(o => o.skipReason === 'transcribe_failed').length > 0, true, 'after three tries a video counts as untranscribable, as in n8n');
  world.whisperStatus = 200;
  resetDb();
  const nk = addRequest();
  const savedKey = env.OPENAI_KEY; delete env.OPENAI_KEY;
  await call({ action: 'tick' });
  assert.equal(q(nk.id).last_error, 'openai_key_missing');
  env.OPENAI_KEY = savedKey;

  // the daily cap: with a cap of 1, a second new request waits while the first has started today
  resetDb();
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'shadow', clients: ['aaa'], max_new_per_day: 1 };
  const c1 = addRequest(), c2 = addRequest();
  world.ttReady = true; world.batchPolls = 0; world.batchSubmits = 0;
  for (let i = 0; i < 6; i++) await call({ action: 'tick' });
  assert.equal(q(c1.id).state, 'done');
  assert.equal(q(c2.id).state, 'pending', 'the second request waits for tomorrow');
  assert.equal(q(c2.id).attempts, 0);

  // every search fails -> no reels, as n8n errors: the request fails, nothing is stored
  resetDb();
  addRequest();
  world.igFails = true; world.ttFails = true;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { failed: 1 });
  const nr = globalThis.__DB.analytics_market_research_collect_queue[0];
  assert.equal(nr.last_error, 'no_reels');
  assert.equal(nr.outcome.scrape_failed, 4);
  assert.equal(globalThis.__DB.mr_shadow, undefined);
  world.igFails = false; world.ttFails = false;

  // one failed keyword search is skipped and the others go on
  resetDb();
  const sk = addRequest();
  world.ttFails = true;
  for (let i = 0; i < 4; i++) await call({ action: 'tick' });
  assert.equal(q(sk.id).state, 'done', 'a platform that failed everywhere still gives a brief from the other');
  assert.equal(q(sk.id).outcome.scrape_failed, 2);
  world.ttFails = false;

  // a Claude batch that errors twice fails the request
  resetDb();
  const bf = addRequest();
  world.batchPolls = 0; world.batchSubmits = 0; world.batchResult = 'errored'; world.batchEndsAfter = 0;
  for (let i = 0; i < 6; i++) await call({ action: 'tick' });
  assert.equal(q(bf.id).state, 'failed');
  assert.equal(q(bf.id).last_error, 'claude_failed');
  assert.equal(world.batchSubmits, 2, 'two tries, as n8n retries its call');
  world.batchResult = 'ok'; world.batchEndsAfter = 1;

  // a refused commit leaves the request retryable and gives the attempt back
  resetDb();
  const rc = addRequest('aaa', ['kw one'], { attempts: 5, started_at: new Date().toISOString(), stages: { claude: { done: true, text: briefJson(), prompt_sha256: 'a'.repeat(64), prompt_chars: 5 }, ranked: [], tx: {} } });
  globalThis.__DB_FAIL.commit = true;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { error: 1 });
  assert.equal(q(rc.id).attempts, 5, 'the attempt is given back after an internal error');
  assert.equal(q(rc.id).last_error, 'commit refused');
  globalThis.__DB_FAIL.commit = false;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 }, 'the next tick finishes it');

  // out of attempts means failed
  resetDb();
  const ex = addRequest('aaa', ['kw one'], { attempts: 240, state: 'running' });
  await call({ action: 'tick' });
  assert.equal(q(ex.id).state, 'failed');
  assert.equal(q(ex.id).last_error, 'attempts_exhausted');

  console.log('ANALYTICS_MARKET_RESEARCH_COLLECT_FUNCTION_OK: auth, off switch, client allow-list, daily cap, resume from a saved run, transcripts only where they can matter, Claude batch across ticks, brief in n8n pieces, no reels, skipped search, failed batch, refused commit, attempts exhausted, real table untouched');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
