'use strict';
/*
 * analytics-weekly-posts: the Edge Function run offline against an in-memory database and scripted
 * providers. Proves: auth, a normal client (three platforms, followers from the snapshot, the message
 * built), no posts in the week, a failed platform (left out of the client text, recorded for staff), a
 * client with one platform, week one with no previous count, a tie on views, the 7-day window, the
 * YouTube API -> Scrape Creators fallback, retry on a later tick, secrets by name, re-run without
 * duplicates and without replacing a better message, and no secret, handle or name in any output.
 * It never touches Slack: no fetch goes anywhere but the two providers.
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (process.argv[2] !== 'child') {
  const hook = path.join(__dirname, 'fixtures/weekly-posts-register.mjs');
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

const monday = (back = 0) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - back); return d; };
const WEEK = monday().toISOString().slice(0, 10), PREV = monday(7).toISOString().slice(0, 10);
const inWeek = (days, hour = 12) => Math.floor((monday(7).getTime() + days * 86400000 + hour * 3600000) / 1000); // unix seconds, days after last Monday
const isoOf = s => new Date(s * 1000).toISOString();

const clients = [
  { slug: 'aaa', kind: 'client', active: true }, { slug: 'bbb', kind: 'client', active: true },
  { slug: 'ccc', kind: 'client', active: true }, { slug: 'ddd', kind: 'client', active: true },
  { slug: 'eee', kind: 'client', active: true }, { slug: 'fff', kind: 'client', active: false },
  { slug: 'sidneylaruel', kind: 'test', active: true },
];
const profiles = [
  { slug: 'aaa', display_name: 'Dana Example', instagram_handle: 'h_aaa', tiktok_handle: 't_aaa', youtube_channel_id: 'UCaaa' },
  { slug: 'bbb', display_name: 'Bo Quiet', instagram_handle: 'h_quiet', tiktok_handle: 'N/A', youtube_channel_id: '' },
  { slug: 'ccc', display_name: 'Cy Down', instagram_handle: 'h_ok', tiktok_handle: 't_gone', youtube_channel_id: 'n/a' },
  { slug: 'ddd', display_name: 'Di Flaky', instagram_handle: 'h_flaky', tiktok_handle: '', youtube_channel_id: 'UCquota' },
  { slug: 'eee', display_name: 'Ed Tied', instagram_handle: 'h_tie', tiktok_handle: 't_tie', youtube_channel_id: '' },
  { slug: 'fff', display_name: 'Off Boarded', instagram_handle: 'h_fff', tiktok_handle: '', youtube_channel_id: '' },
  { slug: 'sidneylaruel', display_name: 'Sidney Test', instagram_handle: 'h_test', tiktok_handle: 'N/A', youtube_channel_id: 'N/A' },
];
const snapshot = (slug, platform, week, followers) => ({ client_slug: slug, platform, week_of: week, followers, status: 'ok' });
const seedSnapshots = () => [
  snapshot('aaa', 'instagram', WEEK, 1100), snapshot('aaa', 'instagram', PREV, 1000),
  snapshot('aaa', 'tiktok', WEEK, 520), snapshot('aaa', 'tiktok', PREV, 500),
  snapshot('aaa', 'youtube', WEEK, 90), snapshot('aaa', 'youtube', PREV, 95),
  snapshot('bbb', 'instagram', WEEK, 300), snapshot('bbb', 'instagram', PREV, 280),
  snapshot('ccc', 'instagram', WEEK, 50), // week one: no previous count
  { client_slug: 'ccc', platform: 'tiktok', week_of: WEEK, followers: null, status: 'failed', error_class: 'not_found' },
];
const reset = () => {
  globalThis.__DB = { clients: JSON.parse(JSON.stringify(clients)), client_profiles: JSON.parse(JSON.stringify(profiles)), analytics_weekly_snapshot: seedSnapshots() };
  globalThis.__DB_FAIL = {};
};

let flakyCalls = 0, scDown = false;
const calls = [];
const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const igPost = (code, views, likes, comments, days, caption) => ({ code, caption: { text: caption }, taken_at: inWeek(days), play_count: views, like_count: likes, comment_count: comments });
const ttPost = (id, views, comments, days, desc) => ({ create_time: inWeek(days), share_url: `https://www.tiktok.com/@x/video/${id}?utm=1`, desc, statistics: { play_count: views, digg_count: 1, comment_count: comments, share_count: 2 } });
globalThis.fetch = async (url) => {
  url = String(url);
  calls.push(url.replace(/\?.*$/, ''));
  const q = new URL(url).searchParams;
  if (url.startsWith('https://www.googleapis.com/youtube/v3/playlistItems')) {
    const pl = q.get('playlistId');
    if (pl === 'UUquota') return res({ error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }, 403);
    return res({ items: [{ contentDetails: { videoId: 'vin', videoPublishedAt: isoOf(inWeek(2)) } }, { contentDetails: { videoId: 'vold', videoPublishedAt: isoOf(inWeek(-30)) } }] });
  }
  if (url.startsWith('https://www.googleapis.com/youtube/v3/videos')) {
    return res({ items: [{ id: 'vin', snippet: { title: 'Long video', publishedAt: isoOf(inWeek(2)) }, statistics: { viewCount: '800', likeCount: '20', commentCount: '6' } }] });
  }
  if (url.startsWith('https://api.scrapecreators.com/')) {
    if (scDown) return res({}, 503);
    const p = url.split('.com')[1].split('?')[0];
    const h = q.get('handle') || q.get('channelId');
    if (p === '/v2/instagram/user/posts') {
      if (h === 'h_aaa') return res({ items: [igPost('A1', 1200, 50, 8, 1, 'Best hook ever\nsecond line'), igPost('A2', 300, 5, 1, 3, 'meh'), igPost('AOLD', 99999, 9, 9, -20, 'last month')] });
      if (h === 'h_quiet') return res({ items: [igPost('QOLD', 5000, 1, 1, -40, 'ancient')] });
      if (h === 'h_ok') return res({ items: [igPost('C1', 40, 1, 0, 2, 'ccc post')] });
      if (h === 'h_flaky') { if (++flakyCalls <= 1) return res({}, 429); return res({ items: [igPost('D1', 70, 2, 3, 4, 'flaky post')] }); }
      if (h === 'h_tie') return res({ items: [igPost('T1', 500, 1, 4, 3, 'tie IG')] });
      if (h === 'h_test') return res({ items: [igPost('S1', 10, 1, 1, 1, 'test post')] });
    }
    if (p === '/v3/profile/videos') {
      if (h === 't_gone') return res({ success: false }, 404);
      if (h === 't_aaa') return res({ aweme_list: [ttPost('T-A', 3000, 40, 2, 'TikTok winner')] });
      if (h === 't_tie') return res({ aweme_list: [ttPost('T-T', 500, 9, 1, 'tie TikTok')] });
    }
    if (p === '/v1/youtube/channel-videos') return res({ videos: [{ id: 'fb1', title: 'Fallback video', viewCountInt: 250, publishedTime: isoOf(inWeek(2)) }] });
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
const msg = slug => (globalThis.__DB.analytics_weekly_messages || []).find(r => r.client_slug === slug && r.week_of === WEEK);
const posts = (slug, pf) => (globalThis.__DB.analytics_weekly_top_posts || []).filter(r => r.client_slug === slug && (!pf || r.platform === pf));
const queue = slug => globalThis.__DB.analytics_weekly_posts_queue.find(r => r.client_slug === slug);
const END = monday(), START = monday(7);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HEAD = first => `${first}, here's your week on social (${MONTHS[START.getUTCMonth()]} ${START.getUTCDate()} to ${MONTHS[END.getUTCMonth()]} ${END.getUTCDate()})`;

(async () => {
  await import(pathToFileURL(path.join(ROOT, 'supabase/functions/analytics-weekly-posts/index.ts')).href);

  // auth
  reset();
  assert.equal((await globalThis.__handler(new Request('https://x/fn', { method: 'GET' }))).status, 405);
  assert.equal((await call({ action: 'tick' }, 'wrong')).status, 401);
  env.ANALYTICS_COLLECT_KEY = 'short';
  assert.equal((await call({ action: 'tick' }, 'short')).status, 401, 'a key under 32 characters refuses everything');
  env.ANALYTICS_COLLECT_KEY = KEY;
  assert.equal(calls.length, 0, 'a refused call reaches no provider');
  assert.equal((await call({ action: 'nope' })).status, 400);

  // tick 1 (aaa): three platforms, followers from the snapshot, the top post is the most viewed across ALL platforms
  let t = await call({ action: 'tick' });
  assert.deepEqual(t.body, { ok: true, week_of: WEEK, claimed: 1, results: { done: 1 } });
  assert.deepEqual(globalThis.__DB.analytics_weekly_posts_queue.map(r => r.client_slug).sort(), ['aaa', 'bbb', 'ccc', 'ddd', 'eee'], 'only active clients are seeded by the timer');
  assert.equal(msg('aaa').text, [
    HEAD('Dana'),
    'New followers: +115 (Instagram +100 · TikTok +20 · YouTube -5)'.replace('+115', '+115'),
    'Views: 5,300',
    'Top post: "TikTok winner" 3,000 views · 40 comments',
    'https://www.tiktok.com/@x/video/T-A'].join('\n'));
  assert.deepEqual(posts('aaa').map(p => p.url).sort(), ['https://www.instagram.com/p/A1/', 'https://www.instagram.com/p/A2/', 'https://www.tiktok.com/@x/video/T-A', 'https://www.youtube.com/watch?v=vin']);
  assert(!posts('aaa').some(p => p.url.includes('AOLD')), 'a post from before the 7 days is not stored');
  assert.deepEqual(msg('aaa').platform_status, { instagram: 'ok', tiktok: 'ok', youtube: 'ok' });
  assert.equal(calls.filter(c => c.includes('googleapis')).length, 2, 'YouTube: the uploads list plus one statistics read');
  assert.equal(calls.filter(c => c.includes('scrapecreators')).length, 2, 'one Scrape Creators call each for Instagram and TikTok');

  // tick 2 (bbb): one platform, no posts in the week -> a real 0, no top post, no link
  await call({ action: 'tick' });
  assert.equal(msg('bbb').text, `${HEAD('Bo')}\nNew followers: +20 (Instagram +20)\nViews: 0`);
  assert.equal(posts('bbb').length, 0, 'an old post is not stored');

  // tick 3 (ccc): TikTok failed (not found), Instagram ok and week one (no previous count)
  await call({ action: 'tick' });
  assert.equal(msg('ccc').text, `${HEAD('Cy')}\nViews: 40\nTop post: "ccc post" 40 views · 0 comments\nhttps://www.instagram.com/p/C1/`, 'week one: no followers line, and the failed platform is not mentioned');
  assert.deepEqual(msg('ccc').platform_status, { instagram: 'ok', tiktok: 'failed:not_found' }, 'the failure is recorded for staff');
  assert(!/tiktok|failed|not_found/i.test(msg('ccc').text));
  assert.equal(posts('ccc', 'tiktok').length, 0);

  // tick 4 (ddd): Instagram rate limited -> waiting, nothing written; the YouTube API quota falls back to Scrape Creators
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { waiting: 1 });
  assert.equal(msg('ddd'), undefined, 'nothing is written while a platform is pending');
  assert.equal(queue('ddd').stages.youtube.source, 'scrapecreators');
  // the next tick takes the client with fewest attempts (eee, a tie on views), then the retry reads only what is pending
  await call({ action: 'tick' });
  assert.equal(msg('eee').text.split('\n')[2], 'Top post: "tie TikTok" 500 views \u00b7 9 comments', 'tie: more comments wins');
  const ytMid = calls.filter(c => c.includes('googleapis') || c.includes('channel-videos')).length;
  t = await call({ action: 'tick' });
  assert.deepEqual(t.body.results, { done: 1 });
  assert.equal(calls.filter(c => c.includes('googleapis') || c.includes('channel-videos')).length, ytMid, 'a platform that answered is not read again');
  assert.equal(msg('ddd').text, `${HEAD('Di')}\nViews: 320\nTop post: "Fallback video" 250 views\nhttps://www.youtube.com/watch?v=fb1`, 'fallback YouTube has no comment count: that part is left out');

  // tick 6 (eee): a tie on views goes to more comments
  await call({ action: 'tick' });
  assert.equal(msg('eee').text.split('\n')[2], 'Top post: "tie TikTok" 500 views · 9 comments', 'tie: more comments wins');
  assert.equal((await call({ action: 'tick' })).body.claimed, 0);

  // re-run: updates, never duplicates
  const n = posts('aaa').length;
  await call({ action: 'run', slugs: ['aaa'] });
  assert.equal(posts('aaa').length, n);
  assert.equal(globalThis.__DB.analytics_weekly_messages.filter(r => r.client_slug === 'aaa').length, 1);
  // a re-run where every platform fails does not replace the good message
  const good = msg('aaa').text;
  scDown = true;
  for (let i = 0; i < 3; i++) await call({ action: 'run', slugs: ['aaa'] });
  assert.equal(msg('aaa').text, good, 'a worse re-run never overwrites a better message');
  assert.equal(posts('aaa').length, n, 'and keeps the stored posts');
  scDown = false;

  // every platform failed on a fresh week: the row says why, with no text
  reset(); scDown = true; env.YOUTUBE_API_KEY = '';
  for (let i = 0; i < 3; i++) await call({ action: 'run', slugs: ['bbb'] });
  assert.equal(msg('bbb').text, null);
  assert.deepEqual(msg('bbb').platform_status, { instagram: 'failed:provider_error' });
  scDown = false; env.YOUTUBE_API_KEY = YT_KEY;

  // run: slug rules, the test client by name
  reset();
  assert.equal((await call({ action: 'run', slugs: [] })).status, 400);
  assert.equal((await call({ action: 'run', slugs: ['a', 'b', 'c', 'd'] })).status, 400);
  assert.equal((await call({ action: 'run', slugs: ['Bad Slug'] })).status, 400);
  assert.deepEqual((await call({ action: 'run', slugs: ['sidneylaruel'] })).body.results, { done: 1 });
  assert(msg('sidneylaruel').text.startsWith(HEAD('Sidney')));

  // a refused commit keeps the client retryable and gives the attempt back
  reset(); globalThis.__DB_FAIL.commit = true;
  assert.deepEqual((await call({ action: 'run', slugs: ['bbb'] })).body.results, { error: 1 });
  assert.equal(queue('bbb').attempts, 0);
  globalThis.__DB_FAIL.commit = false; queue('bbb').lease_until = null;
  assert.deepEqual((await call({ action: 'tick' })).body.results, { done: 1 });

  // secrets by name only: missing -> not_configured, no provider call, no message text
  reset(); delete env.SCRAPECREATORS_API_KEY; delete env.YOUTUBE_API_KEY; calls.length = 0;
  await call({ action: 'run', slugs: ['aaa'] });
  assert.equal(calls.length, 0);
  assert.equal(msg('aaa').text, null);
  assert.deepEqual(msg('aaa').platform_status, { instagram: 'not_configured:secret_missing', tiktok: 'not_configured:secret_missing', youtube: 'not_configured:secret_missing' });
  env.SCRAPECREATORS_API_KEY = SC_KEY; env.YOUTUBE_API_KEY = YT_KEY;

  // status: counts only
  const st = await call({ action: 'status' });
  assert.equal(st.body.ok, true);
  assert.equal(typeof st.body.messages.built, 'number');

  // nothing leaves for anywhere but the two providers; no secret, handle, name or channel in any output
  assert(calls.every(c => /^https:\/\/(www\.googleapis\.com\/youtube\/v3|api\.scrapecreators\.com)\//.test(c)), 'no Slack call, no other host');
  const everything = outputs.join('\n') + '\n' + logged.join('\n');
  for (const s of [SC_KEY, YT_KEY, KEY, 'h_aaa', 't_aaa', 'UCaaa', 'Dana', 'TikTok winner']) assert(!everything.includes(s), 'leaked: ' + s.slice(0, 3));
  console.error = origErr;
  console.log('analytics-weekly-posts function: all checks passed ✅');
})().catch(e => { console.error = origErr; console.error(e); process.exit(1); });
