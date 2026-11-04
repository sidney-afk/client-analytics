'use strict';
/*
 * analytics-weekly-followers: the Edge Function run offline against an in-memory database and
 * scripted providers. Proves: auth, which clients are seeded (active kind='client' only), "N/A"
 * and empty handles skipped, one client per tick, private / missing / hidden / failed profiles
 * recorded as failed with a class and no number, a transient failure retried on a later tick and
 * recorded failed on the last, YouTube API -> Scrape Creators fallback, secrets checked by name
 * (missing -> not_configured), re-run updates without duplicating and never replaces a good
 * number with a failure, a refused commit retryable, and no secret or handle in any output.
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (process.argv[2] !== 'child') {
  const hook = path.join(__dirname, 'fixtures/weekly-followers-register.mjs');
  const r = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', hook, __filename, 'child'], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

const assert = require('assert/strict');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const KEY = 'k'.repeat(40);
const SC_KEY = 'sc-secret-value', YT_KEY = 'yt-secret-value';
const env = { ANALYTICS_COLLECT_KEY: KEY, SCRAPECREATORS_API_KEY: SC_KEY, YOUTUBE_API_KEY: YT_KEY, SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { globalThis.__handler = h; } };

const WEEK = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();

const clients = [
  { slug: 'aaa', kind: 'client', active: true }, { slug: 'bbb', kind: 'client', active: true },
  { slug: 'ccc', kind: 'client', active: true }, { slug: 'ddd', kind: 'client', active: true },
  { slug: 'eee', kind: 'client', active: false }, { slug: 'sidneylaruel', kind: 'test', active: true },
];
const profiles = [
  { slug: 'aaa', instagram_handle: 'h_aaa', tiktok_handle: 't_aaa', youtube_channel_id: 'UCaaa' },
  { slug: 'bbb', instagram_handle: 'h_bbb', tiktok_handle: 'N/A', youtube_channel_id: '' },
  { slug: 'ccc', instagram_handle: 'h_priv', tiktok_handle: 't_gone', youtube_channel_id: 'UChidden' },
  { slug: 'ddd', instagram_handle: 'h_flaky', tiktok_handle: 'n/a', youtube_channel_id: 'UCquota' },
  { slug: 'eee', instagram_handle: 'h_eee', tiktok_handle: '', youtube_channel_id: '' },
  { slug: 'sidneylaruel', instagram_handle: 'h_test', tiktok_handle: 'N/A', youtube_channel_id: 'N/A' },
];
const reset = () => { globalThis.__DB = { clients: JSON.parse(JSON.stringify(clients)), client_profiles: JSON.parse(JSON.stringify(profiles)) }; globalThis.__DB_FAIL = {}; };

let flakyCalls = 0, scDown = false;
const calls = [];
const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
globalThis.fetch = async (url) => {
  url = String(url);
  calls.push(url.replace(/\?.*$/, ''));
  const q = new URL(url).searchParams;
  if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
    const id = q.get('id');
    if (id === 'UCquota') return res({ error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }, 403);
    if (id === 'UChidden') return res({ items: [{ statistics: { hiddenSubscriberCount: true } }] });
    return res({ items: [{ statistics: { subscriberCount: '9100', hiddenSubscriberCount: false } }] });
  }
  if (url.startsWith('https://api.scrapecreators.com/v1/')) {
    if (scDown) return res({}, 503);
    const p = url.split('/v1/')[1].split('?')[0];
    const h = q.get('handle') || q.get('channelId');
    if (p === 'youtube/channel') return res({ subscriberCount: 4200 });
    if (p === 'instagram/profile') {
      if (h === 'h_priv') return res({ data: { user: { is_private: true, edge_followed_by: { count: 5 } } } });
      if (h === 'h_flaky' && ++flakyCalls <= 1) return res({}, 429);
      return res({ data: { user: { is_private: false, edge_followed_by: { count: h === 'h_flaky' ? 700 : 1200 } } } });
    }
    if (p === 'tiktok/profile') {
      if (h === 't_gone') return res({ success: false }, 404);
      return res({ user: { privateAccount: false }, stats: { followerCount: 3300 } });
    }
  }
  throw new Error('unscripted fetch ' + url);
};

const logged = [];
const origErr = console.error; console.error = (...a) => { logged.push(a.join(' ')); };
const outputs = [];
const call = async (body, key = KEY) => {
  const r = await globalThis.__handler(new Request('https://example.invalid/fn', { method: 'POST', headers: { 'x-analytics-collect-key': key }, body: JSON.stringify(body) }));
  const b = await r.json(); outputs.push(JSON.stringify(b));
  return { status: r.status, body: b };
};
const snap = () => globalThis.__DB.analytics_weekly_snapshot || [];
const row = (slug, pf) => snap().find(r => r.client_slug === slug && r.platform === pf);
const queue = slug => globalThis.__DB.analytics_weekly_followers_queue.find(r => r.client_slug === slug);

(async () => {
  await import(pathToFileURL(path.join(ROOT, 'supabase/functions/analytics-weekly-followers/index.ts')).href);

  // auth
  reset();
  assert.equal((await globalThis.__handler(new Request('https://x/fn', { method: 'GET' }))).status, 405);
  assert.equal((await call({ action: 'tick' }, 'wrong')).status, 401);
  env.ANALYTICS_COLLECT_KEY = 'short';
  assert.equal((await call({ action: 'tick' }, 'short')).status, 401, 'a key under 32 characters refuses everything');
  env.ANALYTICS_COLLECT_KEY = KEY;
  assert.equal(calls.length, 0, 'a refused call reaches no provider');
  assert.equal((await call({ action: 'nope' })).status, 400);

  // tick 1: seeds active clients only, claims ONE (fewest attempts, then slug order)
  let t = await call({ action: 'tick' });
  assert.deepEqual(t.body, { ok: true, week_of: WEEK, claimed: 1, results: { done: 1 } });
  assert.deepEqual(globalThis.__DB.analytics_weekly_followers_queue.map(r => r.client_slug).sort(), ['aaa', 'bbb', 'ccc', 'ddd'], 'inactive clients and the test client are not seeded by the timer');
  assert.deepEqual(['instagram', 'tiktok', 'youtube'].map(p => [row('aaa', p).status, row('aaa', p).followers, row('aaa', p).source]),
    [['ok', 1200, 'scrapecreators'], ['ok', 3300, 'scrapecreators'], ['ok', 9100, 'youtube_data_api']]);
  assert.equal(snap().length, 3);

  // tick 2: bbb has only Instagram; N/A and empty handles leave no row
  await call({ action: 'tick' });
  assert.deepEqual(snap().filter(r => r.client_slug === 'bbb').map(r => r.platform), ['instagram'], 'N/A and empty handles are skipped, not recorded');

  // tick 3: private, not found, hidden: failed with a class and NO number
  await call({ action: 'tick' });
  for (const [pf, cls] of [['instagram', 'private_profile'], ['tiktok', 'not_found'], ['youtube', 'hidden_count']]) {
    assert.equal(row('ccc', pf).status, 'failed');
    assert.equal(row('ccc', pf).followers, null, 'a failed profile never carries a number');
    assert.equal(row('ccc', pf).error_class, cls);
  }

  // tick 4: ddd's Instagram is rate limited: waiting, nothing written for it; YouTube API quota -> Scrape Creators fallback is kept in the stage
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { waiting: 1 });
  assert.equal(snap().filter(r => r.client_slug === 'ddd').length, 0, 'nothing is written while a platform is pending');
  assert.equal(queue('ddd').stages.youtube.source, 'scrapecreators', 'quota refused: Scrape Creators answers YouTube');
  assert.equal(queue('ddd').stages.youtube.followers, 4200);
  assert.equal(queue('ddd').lease_until, null, 'released for the next tick');
  // tick 5: the retry reads only the pending platform
  const ytCallsBefore = calls.filter(c => c.includes('googleapis')).length;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 });
  assert.equal(calls.filter(c => c.includes('googleapis')).length, ytCallsBefore, 'a platform that answered is not read again');
  assert.equal(row('ddd', 'instagram').followers, 700);
  assert.equal(row('ddd', 'youtube').source, 'scrapecreators');
  // nothing left: a further tick claims nothing
  assert.equal((await call({ action: 'tick' })).body.claimed, 0);
  assert.equal(snap().length, 3 + 1 + 3 + 2);

  // re-running the same week updates, never duplicates
  await call({ action: 'run', slugs: ['aaa'] });
  assert.equal(snap().filter(r => r.client_slug === 'aaa').length, 3, 'one row per client, platform and week');
  // ... and a failed re-run does not replace a good number
  scDown = true;
  env.ANALYTICS_WEEKLY_FETCH_MS = '1000';
  let r = await call({ action: 'run', slugs: ['aaa'] });
  assert.deepEqual(r.body.results, { waiting: 1 }, 'a provider 5xx is transient');
  // the last attempt of a client that already holds a good number: the failure is recorded for the
  // platform but the earlier good value of the SAME week is not replaced (commit rule)
  queue('aaa').attempts = 2; queue('aaa').stages = {}; queue('aaa').lease_until = null; queue('aaa').state = 'running';
  assert.deepEqual((await call({ action: 'tick' })).body.results, { done: 1 });
  scDown = false;
  assert.equal(row('aaa', 'instagram').status, 'ok', 'a failed re-run of the same week keeps the earlier good number');
  assert.equal(row('aaa', 'instagram').followers, 1200);
  assert.equal(row('aaa', 'tiktok').followers, 3300);

  // run: slug rules, the test client is allowed by name only
  assert.equal((await call({ action: 'run', slugs: [] })).status, 400);
  assert.equal((await call({ action: 'run', slugs: ['a', 'b', 'c', 'd'] })).status, 400);
  assert.equal((await call({ action: 'run', slugs: ['Bad Slug'] })).status, 400);
  r = await call({ action: 'run', slugs: ['sidneylaruel'] });
  assert.deepEqual(r.body.results, { done: 1 });
  assert.equal(row('sidneylaruel', 'instagram').followers, 1200);
  assert.equal(snap().filter(x => x.client_slug === 'sidneylaruel').length, 1, 'N/A platforms of the test client are skipped too');

  // last attempt: a transient failure is recorded failed with its class, never a number
  reset(); scDown = true;
  await call({ action: 'run', slugs: ['bbb'] });
  queue('bbb').attempts = 2; queue('bbb').lease_until = null; queue('bbb').state = 'running';
  for (const slug of ['aaa', 'ccc', 'ddd']) globalThis.__DB.analytics_weekly_followers_queue.push({ week_of: WEEK, client_slug: slug, state: 'done', attempts: 1, stages: {}, lease_until: null });
  await call({ action: 'tick' });
  assert.equal(row('bbb', 'instagram').status, 'failed');
  assert.equal(row('bbb', 'instagram').error_class, 'provider_error');
  assert.equal(row('bbb', 'instagram').followers, null);
  scDown = false;

  // a refused commit keeps the client retryable and gives the attempt back
  reset(); globalThis.__DB_FAIL.commit = true;
  r = await call({ action: 'run', slugs: ['bbb'] });
  assert.deepEqual(r.body.results, { error: 1 });
  assert.equal(queue('bbb').attempts, 0, 'an internal error does not use up the providers\' attempts');
  assert.equal(queue('bbb').state, 'running');
  globalThis.__DB_FAIL.commit = false;
  queue('bbb').lease_until = null;
  assert.deepEqual((await call({ action: 'tick' })).body.results, { done: 1 });

  // secrets by name only: missing -> not_configured, no provider call
  reset(); delete env.SCRAPECREATORS_API_KEY; delete env.YOUTUBE_API_KEY;
  calls.length = 0;
  await call({ action: 'run', slugs: ['aaa'] });
  assert.deepEqual(['instagram', 'tiktok', 'youtube'].map(p => [row('aaa', p).status, row('aaa', p).error_class, row('aaa', p).followers]),
    [['not_configured', 'secret_missing', null], ['not_configured', 'secret_missing', null], ['not_configured', 'secret_missing', null]]);
  assert.equal(calls.length, 0, 'without a secret nothing is requested');
  // YouTube alone: only the Scrape Creators key present -> it answers YouTube directly
  reset(); env.SCRAPECREATORS_API_KEY = SC_KEY;
  await call({ action: 'run', slugs: ['aaa'] });
  assert.equal(row('aaa', 'youtube').source, 'scrapecreators');
  env.YOUTUBE_API_KEY = YT_KEY;

  // status: counts only
  const st = await call({ action: 'status' });
  assert.equal(st.body.ok, true);
  assert(Object.keys(st.body.snapshot).every(k => /^(instagram|tiktok|youtube):/.test(k)));

  // no secret value and no handle anywhere in what the function says
  const everything = outputs.join('\n') + '\n' + logged.join('\n');
  for (const s of [SC_KEY, YT_KEY, KEY, 'h_aaa', 'h_priv', 't_aaa', 'UCaaa']) assert(!everything.includes(s), 'leaked: ' + s.slice(0, 3));
  console.error = origErr;
  console.log('analytics-weekly-followers function: all checks passed ✅');
})().catch(e => { console.error = origErr; console.error(e); process.exit(1); });
