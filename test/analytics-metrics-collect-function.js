'use strict';
/*
 * analytics-metrics-collect-function.js: the Edge Function itself, run offline
 * against an in-memory database and scripted Apify / YouTube answers.
 *
 * Proves what the pure-rules test cannot: auth and the off switch, the queue
 * (one client per tick, a slow scraper resumed on a later tick from its saved
 * run id), the final-attempt timeout path, a refused commit leaving the client
 * retryable, the post-tracking seed refusing once a run has started, and that
 * the real table analytics_metrics is only ever read.
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
    syncview_runtime_flags: [{ key: 'analytics_metrics_collect', value: { mode: 'shadow', yt_split_clients: ['aaa'] } }],
    analytics_metrics: [{ client_slug: 'bbb', date: '2020-01-01', seq: 1, ig_followers: '400', ig_avg_views: '90', ig_avg_likes: '5', ig_views_this_month: '1000', tiktok_plays_this_month: '0', yt_total_views: '0' },
      { client_slug: 'aaa', date: '2020-01-01', seq: 2, ig_followers: '1', ig_avg_views: '1', ig_avg_likes: '1', tiktok_followers: '55', tiktok_avg_plays: '66', ig_views_this_month: '0', tiktok_plays_this_month: '10', yt_total_views: '4000' }],
    analytics_post_tracking: [{ post_id: 'igr_r1', client_slug: 'bbb', views_today: 100, first_seen_date: '2019-12-31' }],
    ...extra,
  };
  globalThis.__DB_FAIL = {};
};

// ---- scripted providers ----
let ttReady = false;
let ytSplitFails = false;
const calls = [];
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  calls.push((init.method || 'GET') + ' ' + url.replace(/\?.*$/, ''));
  if (url.startsWith('https://api.apify.com/v2/acts/')) {
    const actor = url.split('/acts/')[1].split('/')[0];
    const slow = actor.startsWith('clockworks') && !ttReady;
    return ok({ data: { id: 'run~' + actor, status: slow ? 'RUNNING' : 'SUCCEEDED', defaultDatasetId: 'ds~' + actor } });
  }
  if (url.startsWith('https://api.apify.com/v2/actor-runs/')) {
    const slow = url.includes('clockworks') && !ttReady;
    return ok({ data: { status: slow ? 'RUNNING' : 'SUCCEEDED' } });
  }
  if (url.startsWith('https://api.apify.com/v2/datasets/')) {
    const ds = url.split('/datasets/')[1].split('/')[0];
    if (ds.includes('instagram-profile-scraper')) return ok([{ followersCount: 500, latestPosts: ['x'.repeat(1000)] }]);
    if (ds.includes('reel-scraper')) return ok([
      { id: 'r1', videoPlayCount: 160, likesCount: 10, taken_at: '2020-01-01T00:00:00Z', caption: 'long text' },
      { id: 'r2', videoPlayCount: 40, likesCount: 2, taken_at: '2020-01-01T00:00:00Z' }]);
    if (ds.includes('tiktok')) return ok([{ id: 't1', playCount: 300, createTime: Math.floor(Date.now() / 1000) - 3600, authorMeta: { fans: 77, extra: 'x' } }]);
  }
  if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) return ok({ items: [{ statistics: { subscriberCount: '9', viewCount: '5000' } }] });
  if (url.startsWith('https://www.googleapis.com/youtube/v3/playlistItems')) return ytSplitFails ? ok({ error: { code: 403, message: 'quota' } }, 403) : ok({ items: [{ contentDetails: { videoId: 'v1' } }] });
  if (url.startsWith('https://www.googleapis.com/youtube/v3/videos')) {
    return ok({ items: [{ id: 'v1', snippet: { publishedAt: new Date(Date.now() - 86400000).toISOString() }, contentDetails: { duration: 'PT30S' }, statistics: { viewCount: '100' } }] });
  }
  throw new Error('unscripted fetch ' + url);
};

const call = async (body, key = KEY) => {
  const res = await globalThis.__handler(new Request('https://example.invalid/fn', { method: 'POST', headers: { 'x-analytics-collect-key': key }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const queue = slug => globalThis.__DB.analytics_metrics_collect_queue.find(r => r.client_slug === slug);
const shadow = slug => (globalThis.__DB.shadow || []).find(r => r.slug === slug);

(async () => {
  await import(pathToFileURL(path.join(ROOT, 'supabase/functions/analytics-metrics-collect/index.ts')).href);

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
  assert.equal(globalThis.__DB.analytics_metrics_collect_queue, undefined, 'off never seeds the queue');
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'shadow', yt_split_clients: ['aaa'] };

  // seed the post tracking before the first run of the day: accepted; after: refused
  const seedBody = { action: 'seed_post_tracking', rows: [{ post_id: 'tt_old', client_name: 'Client A', platform: 'tiktok', first_seen_date: '2020-01-01', views_yesterday: '1', views_today: '2', views_gained_today: '3' }, { post_id: '', client_name: 'x' }] };
  const seeded = await call(seedBody);
  assert.deepEqual(seeded.body, { ok: true, received: 2, written: 1 }, 'seed keeps valid rows only');
  assert.equal(globalThis.__DB.analytics_post_tracking.find(r => r.post_id === 'tt_old').client_slug, 'clienta', 'the seed derives the client slug from the name');

  // tick 1: the first client's TikTok is still running -> waiting, state saved
  let t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { waiting: 1 }, 'a slow scraper is waited for on a later tick');
  assert.equal(queue('aaa').stages.tt.run_id, 'run~clockworks~tiktok-profile-scraper', 'the run id is saved');
  assert.equal(queue('aaa').stages.ig_reels.done, true, 'finished sources are kept');
  assert(!shadow('aaa'), 'nothing is written while a source is pending');
  assert.equal(queue('aaa').lease_until, null, 'the client is released for the next tick');
  assert(!JSON.stringify(queue('aaa').stages).includes('latestPosts') && !JSON.stringify(queue('aaa').stages).includes('long text'), 'only the fields the rules read are stored');

  // tick 2 and 3: clients with fewer attempts go first
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 });
  assert.equal(queue('bbb').state, 'done');
  const b = shadow('bbb').row;
  assert.equal(b.ig_views_gained_today, '60', 'a known reel gains the difference (100 to 160); the new reel is a baseline');
  assert.equal(b.ig_views_this_month, '1060', 'previous counter plus the gain, previous read from analytics_metrics');
  assert.equal(b.ig_avg_views, '100');
  assert.equal(b.tiktok_followers, '0', 'no TikTok handle: 0, as n8n writes');
  assert.equal(b.yt_total_views, '0');
  assert.equal(JSON.parse(b.analytics_receipt).platforms.youtube.state, 'not_configured');
  t = await call({ action: 'tick' });
  assert.equal(queue('ccc').state, 'done');
  assert.equal(shadow('ccc').row.ig_followers, '', 'no Instagram handle: empty cells');

  // tick 4: the TikTok run finished meanwhile -> the first client completes from its saved run
  ttReady = true;
  const before = calls.filter(c => c.startsWith('POST') && c.includes('tiktok')).length;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 });
  assert.equal(calls.filter(c => c.startsWith('POST') && c.includes('tiktok')).length, before, 'the finished run is read, not started again');
  const a = shadow('aaa').row;
  assert.equal(a.tiktok_followers, '77');
  assert.equal(a.tiktok_plays_gained_today, '300', 'a brand-new TikTok counts all its views');
  assert.equal(a.tiktok_plays_this_month, '310', 'previous counter 10 plus 300');
  assert.equal(a.yt_shorts_views, '100', 'the shorts split runs for a client named in yt_split_clients');
  assert.equal(a.yt_views_gained_today, '1000', 'YouTube gain is today total minus the previous total (5000 - 4000)');
  assert.equal(a.ig_followers, '500');
  const rc = JSON.parse(a.analytics_receipt);
  assert.equal(rc.result, 'success');
  assert(globalThis.__DB.analytics_post_tracking.some(r => r.post_id === 'tt_t1'), 'post tracking written with the row');
  assert.equal((await call({ action: 'tick' })).body.claimed, 0, 'nothing left today');
  assert.deepEqual((await call(seedBody)).body, { ok: false, error: 'run_in_progress' }, 'no seeding once today has started');

  // the real table is only read
  assert.equal(globalThis.__DB.analytics_metrics.length, 2, 'analytics_metrics untouched');

  // the final attempt: a TikTok that never finishes is recorded as a provider failure, last good values kept
  ttReady = false;
  resetDb({ client_profiles: [{ slug: 'aaa', display_name: 'Client A', instagram_handle: '', tiktok_handle: 'tt_a', youtube_channel_id: '', archived_at: null }] });
  const results = [];
  for (let i = 0; i < 9; i++) results.push(Object.keys((await call({ action: 'tick' })).body.results || {})[0] || 'none');
  assert.deepEqual(results, ['waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'done', 'none'], 'seven waits, the eighth attempt gives up, then nothing');
  const slow = shadow('aaa').row;
  const slowRc = JSON.parse(slow.analytics_receipt);
  assert.equal(slowRc.platforms.tiktok.state, 'provider_failed');
  assert.equal(slowRc.platforms.tiktok.used_last_good, true);
  assert.equal(slowRc.result, 'degraded');
  assert.equal(slow.tiktok_followers, '55', 'last good followers copied');
  assert.equal(slow.tiktok_plays_gained_today, '0');
  assert.equal(slow.tiktok_plays_this_month, '10', 'counter kept');

  // a refused commit leaves the client retryable and says why
  resetDb({ client_profiles: [profiles[2]] });
  globalThis.__DB_FAIL.commit = true;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { error: 1 });
  assert.equal(queue('ccc').state, 'running');
  assert.equal(queue('ccc').lease_until, null);
  assert.equal(queue('ccc').last_error, 'commit refused');
  globalThis.__DB_FAIL.commit = false;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 }, 'the next tick finishes it');

  // a refused commit on the LAST claim must not strand the client: errors give the attempt back
  resetDb({ client_profiles: [profiles[2]],
    analytics_metrics_collect_queue: [{ run_date: TODAY, client_slug: 'ccc', state: 'running', attempts: 7, stages: {}, lease_until: null }] });
  globalThis.__DB_FAIL.commit = true;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { error: 1 });
  assert.equal(queue('ccc').attempts, 7, 'the eighth attempt is given back after an internal error');
  globalThis.__DB_FAIL.commit = false;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 }, 'so the client is claimed again and gets its row');

  // a failed split call (playlist or video details) is a YouTube provider failure, not "0 shorts, 0 longs"
  ytSplitFails = true;
  resetDb({ client_profiles: [{ slug: 'aaa', display_name: 'Client A', instagram_handle: '', tiktok_handle: '', youtube_channel_id: 'UCaaa', archived_at: null }] });
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 });
  const yf = shadow('aaa').row;
  const yfRc = JSON.parse(yf.analytics_receipt);
  assert.equal(yfRc.platforms.youtube.state, 'provider_failed', 'a failed split call marks YouTube failed');
  assert.equal(yfRc.platforms.youtube.used_last_good, true);
  assert.equal(yfRc.result, 'degraded');
  assert.equal(yf.yt_total_views, '4000', 'last good total kept');
  assert.equal(yf.yt_views_gained_today, '0');
  assert.equal(yf.yt_shorts_views, '', 'shorts are not replaced by 0');
  ytSplitFails = false;

  // only listed clients when the flag says so
  resetDb();
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'shadow', clients: ['ccc'] };
  await call({ action: 'tick' });
  assert.deepEqual(globalThis.__DB.analytics_metrics_collect_queue.map(r => r.client_slug), ['ccc'], 'the clients list limits the queue');

  // ---- shadow never writes the real table, whatever happens in a day ----
  assert(!(globalThis.__DB.analytics_metrics || []).some(r => r.source === 'edge'), 'shadow wrote no real row');
  assert.equal(globalThis.__DB.analytics_ingest_receipts, undefined, 'shadow wrote no receipt');

  // ---- live (plan section 8b) ----
  const { prepareRows } = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/sheets-mirror.mjs')).href);
  const liveProfiles = [
    { slug: 'probelive', display_name: 'Probe Live', instagram_handle: 'ig_l', tiktok_handle: '', youtube_channel_id: '', archived_at: null },
    { slug: 'probequiet', display_name: 'Probe Quiet', instagram_handle: '', tiktok_handle: 'N/A', youtube_channel_id: '', archived_at: null },
  ];
  const liveRows = slug => (globalThis.__DB.analytics_metrics || []).filter(r => r.client_slug === slug && r.date === TODAY);
  resetDb({ client_profiles: JSON.parse(JSON.stringify(liveProfiles)) });
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'LIVE' };
  assert.deepEqual((await call({ action: 'tick' })).body, { ok: true, skipped: 'off' }, 'a mode that is not exactly "live" or "shadow" is off');
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'live' };
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done_live: 1 }, 'live: the first client is written');
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done_live: 1 });
  for (const slug of ['probelive', 'probequiet']) {
    const rows = liveRows(slug);
    assert.equal(rows.length, 1, 'live writes exactly one real row per client per day: ' + slug);
    assert.equal(rows[0].source, 'edge', 'with the new source');
    assert.equal(rows[0].run_id, 'collect-' + TODAY);
    assert.equal(rows[0].row_occurrence, 1);
    assert(shadow(slug), 'and the shadow row too, for the comparison');
    const sh = shadow(slug).row;
    const { records } = await prepareRows('metrics', [sh], { source: 'edge', runId: 'x' });
    assert.equal(rows[0].row_hash, records[0].row_hash, 'the fingerprint is the one analytics-write computes for the same row');
    assert.equal(rows[0].ig_followers, sh.ig_followers === '' ? null : sh.ig_followers, 'stored as analytics-write stores it (empty as null)');
  }
  assert.equal(liveRows('probelive')[0].ig_avg_views, '100', 'the live row carries the day\'s numbers');
  assert(globalThis.__DB.analytics_ingest_receipts.every(r => r.source === 'edge' && r.p_full_snapshot === true), 'no clients list: the run may vouch for the whole dataset');

  // a second run of the day (a retry, a tick after a reset) adds nothing
  for (const r of globalThis.__DB.analytics_metrics_collect_queue) Object.assign(r, { state: 'pending', attempts: 0 });
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done_live_kept_existing: 1 }, 'a second run keeps the row already there');
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done_live_kept_existing: 1 });
  assert.equal(liveRows('probelive').length + liveRows('probequiet').length, 2, 'still one row per client');

  // a refused commit, then the retry: still exactly one row
  resetDb({ client_profiles: [JSON.parse(JSON.stringify(liveProfiles[1]))] });
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'live', clients: ['probequiet'] };
  globalThis.__DB_FAIL.commit = true;
  assert.deepEqual((await call({ action: 'tick' })).body.results, { error: 1 });
  assert.equal(liveRows('probequiet').length, 0, 'a refused commit writes nothing');
  globalThis.__DB_FAIL.commit = false;
  assert.deepEqual((await call({ action: 'tick' })).body.results, { done_live: 1 });
  assert.equal(liveRows('probequiet').length, 1, 'the retry writes it once');
  assert.equal(globalThis.__DB.analytics_ingest_receipts[0].p_full_snapshot, false, 'a clients list never vouches for the whole dataset');

  // the transition day: n8n already mirrored this client today -> its row stays, nothing added
  resetDb({ client_profiles: [JSON.parse(JSON.stringify(liveProfiles[1]))],
    analytics_metrics: [{ client_slug: 'probequiet', date: TODAY, seq: 7, source: 'n8n', run_id: 'n8n-1', ig_followers: '1' }] });
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'live' };
  assert.deepEqual((await call({ action: 'tick' })).body.results, { done_live_kept_existing: 1 }, 'n8n\'s row of the day wins');
  assert.deepEqual(liveRows('probequiet').map(r => r.source), ['n8n'], 'only n8n\'s row for the day');
  assert.equal(queue('probequiet').state, 'done', 'the client is done for the day');

  // a row the shared preparation refuses (here: the profile name gives another slug) is never written,
  // and it keeps its attempt so it cannot loop all morning
  resetDb({ client_profiles: [profiles[2]] });
  globalThis.__DB.syncview_runtime_flags[0].value = { mode: 'live' };
  assert.deepEqual((await call({ action: 'tick' })).body.results, { error: 1 });
  assert.equal(queue('ccc').last_error, 'live_row_slug_mismatch');
  assert.equal(queue('ccc').attempts, 1, 'the attempt is kept');
  assert.equal((globalThis.__DB.analytics_metrics || []).filter(r => r.date === TODAY).length, 0, 'nothing written');

  console.log('ANALYTICS_METRICS_COLLECT_FUNCTION_OK: auth, off switch, queue, resume from a saved run, final-attempt timeout, refused commit, seed guard, clients list, shadow never writes the real table, live writes once with source edge, retries idempotent, transition-day rule');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
