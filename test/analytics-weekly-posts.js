'use strict';
/* analytics-weekly-posts: the pure rules (provider readers, message builder) and the migration's promises, read offline. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const m = await import(path.join(ROOT, 'supabase/functions/_shared/analytics-weekly-posts.mjs'));
  const W = '2026-11-09';
  const post = (url, views, comments, title = 't', posted = '2026-11-05T10:00:00.000Z') => ({ url, title, views, likes: 1, comments, shares: null, posted_at: posted });
  const ok = (posts) => ({ status: 'ok', posts });

  // window: the 7 days before the Monday
  assert.deepEqual(m.windowOf(W), { start: '2026-11-02T00:00:00.000Z', end: '2026-11-09T00:00:00.000Z' });
  assert.deepEqual(m.inWindow([post('a', 1, 1, 't', '2026-11-01T23:59:59.000Z'), post('b', 1, 1, 't', '2026-11-02T00:00:00.000Z'), post('c', 1, 1, 't', '2026-11-09T00:00:00.000Z')], m.windowOf(W)).map(p => p.url), ['b']);

  // Scrape Creators readers
  const ig = m.readPostsScrapeCreators('instagram', 200, { items: [{ code: 'AbC', caption: { text: 'Hello\nworld' }, taken_at: 1783000000, play_count: 900, like_count: 5, comment_count: 2 }, { code: 'img', taken_at: 1783000100, like_count: 3 }, { taken_at: 1 }] });
  assert.equal(ig.posts.length, 2, 'a post without a code is dropped');
  assert.deepEqual([ig.posts[0].url, ig.posts[0].views, ig.posts[0].comments, ig.posts[1].views], ['https://www.instagram.com/p/AbC/', 900, 2, null], 'an image post has no views, never a guessed one');
  const tt = m.readPostsScrapeCreators('tiktok', 200, { aweme_list: [{ desc: 'd', create_time: 1783000000, share_url: 'https://www.tiktok.com/@h/video/1?x=1', statistics: { play_count: 10, digg_count: 2, comment_count: 1, share_count: 4 } }] });
  assert.deepEqual([tt.posts[0].url, tt.posts[0].views, tt.posts[0].shares], ['https://www.tiktok.com/@h/video/1', 10, 4]);
  const yt = m.readPostsScrapeCreators('youtube', 200, { videos: [{ id: 'v1', title: 'T', viewCountInt: 77, publishedTime: '2026-11-05T10:00:00Z' }] });
  assert.deepEqual([yt.posts[0].url, yt.posts[0].views, yt.posts[0].comments], ['https://www.youtube.com/watch?v=v1', 77, null]);
  for (const pf of ['instagram', 'tiktok', 'youtube']) {
    assert.deepEqual(m.readPostsScrapeCreators(pf, 200, {}), { error_class: 'unexpected_shape' });
    assert.deepEqual(m.readPostsScrapeCreators(pf, 200, { success: false }), { error_class: 'not_found' });
    assert.deepEqual(m.readPostsScrapeCreators(pf, 429, {}), { error_class: 'rate_limited' });
    assert.deepEqual(m.readPostsScrapeCreators(pf, 200, null), { error_class: 'unexpected_shape' });
    assert.deepEqual(m.readPostsScrapeCreators(pf, 200, pf === 'instagram' ? { items: [] } : pf === 'tiktok' ? { aweme_list: [] } : { videos: [] }), { posts: [] }, 'no posts is an answer, not an error');
  }
  // YouTube Data API
  const win = m.windowOf(W);
  assert.deepEqual(m.readYoutubeUploads(200, { items: [{ contentDetails: { videoId: 'in', videoPublishedAt: '2026-11-03T00:00:00Z' } }, { contentDetails: { videoId: 'old', videoPublishedAt: '2026-10-01T00:00:00Z' } }] }, win), { ids: ['in'] });
  assert.deepEqual(m.readYoutubeUploads(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }, win), { error_class: 'rate_limited' });
  assert.deepEqual(m.readYoutubeUploads(404, {}, win), { error_class: 'not_found' });
  assert.deepEqual(m.readYoutubeUploads(200, {}, win), { error_class: 'unexpected_shape' });
  const yv = m.readYoutubeVideos(200, { items: [{ id: 'in', snippet: { title: 'Hi', publishedAt: '2026-11-03T00:00:00Z' }, statistics: { viewCount: '1500', likeCount: '9', commentCount: '3' } }] });
  assert.deepEqual([yv.posts[0].views, yv.posts[0].likes, yv.posts[0].comments, yv.posts[0].title], [1500, 9, 3, 'Hi']);

  // hook
  assert.equal(m.hook('First line\nsecond'), 'First line');
  assert.equal(m.hook('Say "hi" “now”'), "Say 'hi' 'now'");
  assert.equal(m.hook('x'.repeat(100)).length, 80);
  assert.equal(m.hook(null), '');
  assert.equal(m.firstNameOf('  Dana Q. Smith '), 'Dana');

  // top post: most views across ALL platforms; a tie goes to more comments, then the earlier post, then the url
  assert.equal(m.pickTopPost([post('a', 10, 1), post('b', 50, 0), post('c', 20, 99)]).url, 'b');
  assert.equal(m.pickTopPost([post('a', 50, 1), post('b', 50, 4)]).url, 'b', 'tie on views: more comments');
  assert.equal(m.pickTopPost([post('a', 50, 4, 't', '2026-11-06T00:00:00Z'), post('b', 50, 4, 't', '2026-11-04T00:00:00Z')]).url, 'b', 'then the earlier post');
  assert.equal(m.pickTopPost([post('z', 50, 4), post('y', 50, 4)]).url, 'y', 'then the url: stable');
  assert.equal(m.pickTopPost([post('a', null, 3)]), null, 'a post without a view count cannot be the top post');
  assert.equal(m.pickTopPost([]), null);

  // the message, all three platforms, followers known both weeks
  const full = m.buildMessage({ firstName: 'Dana', weekOf: W, platforms: { instagram: ok([post('https://i/1', 1200, 8, 'Best hook\nmore')]), tiktok: ok([post('https://t/1', 3000, 40, 'TikTok one')]), youtube: ok([post('https://y/1', 300, 2)]) },
    followers: { this: { instagram: 110, tiktok: 520, youtube: 70 }, last: { instagram: 100, tiktok: 500, youtube: 75 } } });
  assert.equal(full, [
    "Dana, here's your week on social (Nov 2 to Nov 9)",
    'New followers: +25 (Instagram +10 · TikTok +20 · YouTube -5)',
    'Views: 4,500',
    'Top post: "TikTok one" 3,000 views · 40 comments',
    'https://t/1'].join('\n'));
  assert(!/%|engagement|reach|saves|rate/i.test(full), 'nothing else: no engagement rate, percentages, reach or saves');

  // week one: no previous count -> no followers line at all, the rest is real
  const wk1 = m.buildMessage({ firstName: 'Dana', weekOf: W, platforms: { instagram: ok([post('https://i/1', 12, 1, 'Hi')]) }, followers: { this: { instagram: 110 }, last: {} } });
  assert(!wk1.includes('New followers'));
  assert(wk1.includes('Views: 12') && wk1.includes('Top post: "Hi" 12 views · 1 comment\n'));
  // a platform with no previous count is left out of the followers total, the others stay
  const part = m.buildMessage({ firstName: 'D', weekOf: W, platforms: { instagram: ok([]), tiktok: ok([]) }, followers: { this: { instagram: 110, tiktok: 5 }, last: { instagram: 100 } } });
  assert(part.includes('New followers: +10 (Instagram +10)'));
  // one platform
  const one = m.buildMessage({ firstName: 'D', weekOf: W, platforms: { tiktok: ok([post('https://t/9', 1, 0, 'x')]) }, followers: { this: { tiktok: 9 }, last: { tiktok: 9 } } });
  assert(one.includes('New followers: +0 (TikTok +0)') && one.includes('1 view · 0 comments'), 'a slow week still shows its real numbers');
  // no posts in the week: Views 0, no top post, no link
  const none = m.buildMessage({ firstName: 'D', weekOf: W, platforms: { instagram: ok([]) }, followers: { this: {}, last: {} } });
  assert.equal(none, "D, here's your week on social (Nov 2 to Nov 9)\nViews: 0");
  // a failed platform: out of the totals, never mentioned
  const failed = m.buildMessage({ firstName: 'D', weekOf: W, platforms: { instagram: ok([post('https://i/1', 100, 1, 'a')]), tiktok: { status: 'failed', posts: [] } },
    followers: { this: { instagram: 11, tiktok: 99 }, last: { instagram: 10, tiktok: 1 } } });
  assert(failed.includes('New followers: +1 (Instagram +1)') && failed.includes('Views: 100'));
  assert(!/tiktok|failed|couldn|unavailable/i.test(failed));
  // every platform failed: nothing true to say, no message
  assert.equal(m.buildMessage({ firstName: 'D', weekOf: W, platforms: { instagram: { status: 'failed', posts: [] } }, followers: {} }), null);
  // a post without comments data omits the comments part
  assert(m.buildMessage({ firstName: 'D', weekOf: W, platforms: { youtube: ok([{ ...post('https://y/1', 5, null), comments: null }]) }, followers: {} }).includes('Top post: "t" 5 views\n'));

  // the migration's promises
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/2026-11-04-analytics-weekly-posts.sql'), 'utf8');
  assert.equal((sql.match(/^-- ef-auto-deploy-applied-when:/gm) || []).length, 1);
  assert(/^-- ef-auto-deploy-applied-when: select .*analytics_weekly_messages.*analytics_weekly_posts_commit\(date,text,jsonb,text,jsonb\)/m.test(sql), 'says how to tell it is applied');
  assert(sql.includes('revoke all on table public.%I from public, anon, authenticated, service_role'), 'tables revoked from all four');
  assert.equal((sql.match(/from public, anon, authenticated, service_role/g) || []).length, 2, 'tables and functions both name all four roles');
  assert(!/grant [^;]*\b(anon|authenticated)\b/i.test(sql.replace(/revoke[^;]*;/gi, '')), 'no grant to a browser role');
  assert(!/grant [^;]*\b(insert|update|delete)\b[^;]*analytics_weekly_(messages|top_posts)/i.test(sql), 'posts and messages are written only through the commit function');
  assert(!/grant [^;]*analytics_weekly_top_posts/i.test(sql), 'top-post table needs no grant');
  assert(sql.includes("'* 8-9 * * 1'"), 'after the followers window, Mondays UTC');
  assert(sql.includes('step 1 is not applied'), 'refuses to run before step 1');
  assert(!/slack/i.test(sql.replace(/^--.*$/gm, '')), 'nothing posts to Slack');
  console.log('analytics-weekly-posts rules and migration: all checks passed ✅');
})().catch(e => { console.error(e); process.exit(1); });
