'use strict';
/*
 * analytics-top-videos-collect-function.js: the Edge Function itself, run offline
 * against an in-memory database and scripted Apify / YouTube answers.
 *
 * Proves what the pure-rules test cannot: auth and the off switch, the queue (one client
 * per tick, a slow scraper resumed on a later tick from its saved run id), the final-attempt
 * timeout path, a failed provider writing no rows, a refused commit leaving the client
 * retryable, the clients list, and that the real table analytics_top_videos is never
 * touched (a sentinel row in it is unchanged after a full day).
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
const TODAY = new Date().toISOString().slice(0, 10);

const env = { ANALYTICS_COLLECT_KEY: KEY, APIFY_TOKEN: 'apify-test', YOUTUBE_API_KEY: 'yt-test', SUPABASE_URL: 'https://example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test', ANALYTICS_COLLECT_TICK_BUDGET_MS: '8100' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { globalThis.__handler = h; } };

const profiles = [
  { slug: 'aaa', display_name: 'Client A', instagram_handle: 'ig_a', tiktok_handle: 'tt_a', youtube_channel_id: 'UCaaa', archived_at: null },
  { slug: 'bbb', display_name: 'Client B', instagram_handle: 'ig_b', tiktok_handle: '', youtube_channel_id: 'N/A', archived_at: null },
  { slug: 'ccc', display_name: 'Client C', instagram_handle: '', tiktok_handle: 'N/A', youtube_channel_id: '', archived_at: null },
];
const resetDb = (extra = {}) => {
  globalThis.__DB = {
    client_profiles: JSON.parse(JSON.stringify(profiles)),
    syncview_runtime_flags: [{ key: 'analytics_top_videos_collect', value: { mode: 'shadow' } }],
    analytics_top_videos: [{ client_slug: 'bbb', scraped_date: '2020-01-01', video_url: 'sentinel' }],
    ...extra,
  };
  globalThis.__DB_FAIL = {};
};

// ---- scripted providers ----
let ttReady = false, ytFails = false, igFails = false, ytEmpty = false;
const calls = [];
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const recent = hours => new Date(Date.now() - hours * 3600000).toISOString();
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  calls.push((init.method || 'GET') + ' ' + url.replace(/\?.*$/, ''));
  if (url.startsWith('https://api.apify.com/v2/acts/')) {
    const actor = url.split('/acts/')[1].split('/')[0];
    if (igFails && actor.startsWith('apify~instagram')) return ok({ error: { type: 'boom' } }, 500);
    const slow = actor.startsWith('clockworks') && !ttReady;
    return ok({ data: { id: 'run~' + actor, status: slow ? 'RUNNING' : 'SUCCEEDED', defaultDatasetId: 'ds~' + actor } });
  }
  if (url.startsWith('https://api.apify.com/v2/actor-runs/')) {
    const slow = url.includes('clockworks') && !ttReady;
    return ok({ data: { status: slow ? 'RUNNING' : 'SUCCEEDED' } });
  }
  if (url.startsWith('https://api.apify.com/v2/datasets/')) {
    const ds = url.split('/datasets/')[1].split('/')[0];
    if (ds.includes('reel-scraper')) return ok([
      { id: 'r1', url: 'https://i/r1', videoPlayCount: 160, likesCount: 10, taken_at: recent(24), caption: 'long  text\nhere' + 'x'.repeat(400), latestComments: ['y'.repeat(1000)] },
      { id: 'r2', url: 'https://i/r2', videoPlayCount: 400, likesCount: 2, taken_at: recent(24 * 20) }]);
    if (ds.includes('tiktok')) return ok([{ id: 't1', webVideoUrl: 'https://t/t1', playCount: 300, createTime: Math.floor(Date.now() / 1000) - 3600, text: 'hi', authorMeta: { fans: 77 } }]);
  }
  if (url.startsWith('https://www.googleapis.com/youtube/v3/search')) {
    if (ytFails) return ok({ error: { code: 403, message: 'quota' } }, 403);
    return ok({ items: ytEmpty ? [] : [{ id: { videoId: 'v1' } }] });
  }
  if (url.startsWith('https://www.googleapis.com/youtube/v3/videos')) {
    return ok({ items: [{ id: 'v1', snippet: { publishedAt: recent(48), title: 'A short', description: 'd'.repeat(900) }, statistics: { viewCount: '100', likeCount: '7', commentCount: '1' } }] });
  }
  throw new Error('unscripted fetch ' + url);
};

const call = async (body, key = KEY) => {
  const res = await globalThis.__handler(new Request('https://example.invalid/fn', { method: 'POST', headers: { 'x-analytics-collect-key': key }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const queue = slug => globalThis.__DB.analytics_top_videos_collect_queue.find(r => r.client_slug === slug);
const shadow = slug => (globalThis.__DB.top_shadow || []).find(r => r.slug === slug);

(async () => {
  await import(pathToFileURL(path.join(ROOT, 'supabase/functions/analytics-top-videos-collect/index.ts')).href);

  // auth and the switch
  resetDb();
  assert.equal((await globalThis.__handler(new Request('https://x/fn', { method: 'GET' }))).status, 405);
  assert.equal((await call({ action: 'tick' }, 'wrong')).status, 401, 'wrong key refused');
  env.ANALYTICS_COLLECT_KEY = 'short';
  assert.equal((await call({ action: 'tick' }, 'short')).status, 401, 'a secret under 32 characters refuses everything');
  env.ANALYTICS_COLLECT_KEY = KEY;
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'off' };
  assert.deepEqual((await call({ action: 'tick' })).body, { ok: true, skipped: 'off' }, 'off does nothing');
  assert.equal(calls.length, 0, 'off never reaches a provider');
  assert.equal(globalThis.__DB.analytics_top_videos_collect_queue, undefined, 'off never seeds the queue');
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'shadow' };
  assert.equal((await call({ action: 'nope' })).status, 400, 'unknown action refused');

  // tick 1: the first client's TikTok is still running -> waiting, state saved
  let t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { waiting: 1 }, 'a slow scraper is waited for on a later tick');
  assert.equal(queue('aaa').stages.tt.run_id, 'run~clockworks~tiktok-profile-scraper', 'the run id is saved');
  assert.equal(queue('aaa').stages.ig.done, true, 'finished sources are kept');
  assert(!shadow('aaa'), 'nothing is written while a source is pending');
  assert.equal(queue('aaa').lease_until, null, 'the client is released for the next tick');
  const stored = JSON.stringify(queue('aaa').stages);
  assert(!stored.includes('latestComments') && !stored.includes('d'.repeat(300)) && !stored.includes('x'.repeat(201)), 'only the fields the rules read are stored, captions cut at 200');

  // tick 2 and 3: clients with fewer attempts go first
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 });
  const b = shadow('bbb');
  assert.deepEqual(b.states, { instagram: 'success', tiktok: 'not_configured', youtube: 'not_configured' });
  assert.deepEqual(b.rows.map(r => [r.platform, r.period, r.rank, r.video_url, r.views]),
    [['instagram', 'week', '1', 'https://i/r1', '160'], ['instagram', 'month', '1', 'https://i/r2', '400'], ['instagram', 'month', '2', 'https://i/r1', '160']],
    'week: only the reel of the last 7 days; month: both, most viewed first');
  assert.equal(b.rows[0].caption.length, 199, 'caption cut at 200 characters, then one whitespace run collapsed');
  assert(!/\s{2}|\n/.test(b.rows[0].caption), 'whitespace runs collapsed');
  t = await call({ action: 'tick' });
  assert.equal(queue('ccc').state, 'done');
  assert.deepEqual(shadow('ccc').rows, [], 'no platform configured: no rows, as n8n writes nothing');
  assert.deepEqual(shadow('ccc').states, { instagram: 'not_configured', tiktok: 'not_configured', youtube: 'not_configured' });

  // tick 4: the TikTok run finished meanwhile -> the first client completes from its saved run
  ttReady = true;
  const before = calls.filter(c => c.startsWith('POST') && c.includes('tiktok')).length;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 });
  assert.equal(calls.filter(c => c.startsWith('POST') && c.includes('tiktok')).length, before, 'the finished run is read, not started again');
  const a = shadow('aaa');
  assert.deepEqual(a.states, { instagram: 'success', tiktok: 'success', youtube: 'success' });
  assert.deepEqual([...new Set(a.rows.map(r => r.platform))], ['instagram', 'tiktok', 'youtube']);
  assert(a.rows.some(r => r.platform === 'youtube' && r.video_url === 'https://www.youtube.com/watch?v=v1' && r.likes === '7' && r.shares === '0'), 'YouTube row from the video stats');
  assert.equal(a.rows.find(r => r.platform === 'tiktok').views, '300');
  assert(a.rows.every(r => r.scraped_date === TODAY && r.client_name === 'Client A'), 'rows carry the run date and the display name');
  assert.equal((await call({ action: 'tick' })).body.claimed, 0, 'nothing left today');

  // the real table is untouched
  assert.deepEqual(globalThis.__DB.analytics_top_videos, [{ client_slug: 'bbb', scraped_date: '2020-01-01', video_url: 'sentinel' }], 'analytics_top_videos untouched');

  // a failed provider writes no rows for that platform (n8n takes the error output); no short in 30 days is the "no new posts" row
  igFails = true; ytEmpty = true; ttReady = true;
  resetDb({ client_profiles: [{ ...profiles[0] }] });
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 });
  const f = shadow('aaa');
  assert.deepEqual(f.states, { instagram: 'provider_failed', tiktok: 'success', youtube: 'success' });
  assert(!f.rows.some(r => r.platform === 'instagram'), 'no Instagram rows after a failed Instagram call');
  assert.deepEqual(f.rows.filter(r => r.platform === 'youtube').map(r => [r.period, r.rank, r.caption, r.video_url]), [['week', '0', 'No new posts in the last 7 days', null]], 'no shorts: the empty-week row');
  igFails = false; ytEmpty = false;

  // a failed YouTube call is a provider failure too
  ytFails = true;
  resetDb({ client_profiles: [{ ...profiles[0], instagram_handle: '', tiktok_handle: '' }] });
  t = await call({ action: 'tick' });
  assert.deepEqual(shadow('aaa').states.youtube, 'provider_failed');
  assert.deepEqual(shadow('aaa').rows, []);
  ytFails = false;

  // the final attempt: a TikTok that never finishes is recorded as a provider failure
  ttReady = false;
  resetDb({ client_profiles: [{ slug: 'aaa', display_name: 'Client A', instagram_handle: '', tiktok_handle: 'tt_a', youtube_channel_id: '', archived_at: null }] });
  const results = [];
  for (let i = 0; i < 9; i++) results.push(Object.keys((await call({ action: 'tick' })).body.results || {})[0] || 'none');
  assert.deepEqual(results, ['waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'done', 'none'], 'seven waits, the eighth attempt gives up, then nothing');
  assert.deepEqual(shadow('aaa').states.tiktok, 'provider_failed');
  assert.deepEqual(shadow('aaa').rows, []);

  // a refused commit leaves the client retryable and says why; on the LAST claim the attempt is given back
  resetDb({ client_profiles: [profiles[2]],
    analytics_top_videos_collect_queue: [{ run_date: TODAY, client_slug: 'ccc', state: 'running', attempts: 7, stages: {}, lease_until: null }] });
  globalThis.__DB_FAIL.commit = true;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { error: 1 });
  assert.equal(queue('ccc').attempts, 7, 'the eighth attempt is given back after an internal error');
  assert.equal(queue('ccc').last_error, 'commit refused');
  assert.equal(queue('ccc').lease_until, null);
  globalThis.__DB_FAIL.commit = false;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 }, 'the next tick finishes it');

  // only listed clients when the flag says so
  resetDb();
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'shadow', clients: ['ccc'] };
  await call({ action: 'tick' });
  assert.deepEqual(globalThis.__DB.analytics_top_videos_collect_queue.map(r => r.client_slug), ['ccc'], 'the clients list limits the queue');

  console.log('ANALYTICS_TOP_VIDEOS_COLLECT_FUNCTION_OK: auth, off switch, queue, resume from a saved run, failed providers write no rows, empty-week row, final-attempt timeout, refused commit, clients list, real table untouched');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
