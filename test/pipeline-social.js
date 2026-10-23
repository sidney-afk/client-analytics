#!/usr/bin/env node
// pipeline-social: the filming pipeline's door to ScrapeCreators. Offline: the
// pure rules in pipeline-social/rules.mjs are run directly, and the wiring in
// index.ts is read as source. No key, no network.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'pipeline-social');
const src = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');

let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; };
const eq = (a, b, label) => { assert.deepStrictEqual(a, b, label); passed++; };

(async () => {
  const r = await import(path.join(dir, 'rules.mjs'));

  // ---- Each action is one fixed endpoint -------------------------------------
  const tt = r.buildRequest('tiktok.search', { query: 'morning routine', sort_by: 'most-liked', date_posted: 'this-month', region: 'us' });
  eq([tt.ok, tt.path, tt.counts], [true, '/v1/tiktok/search/keyword', true], 'tiktok.search goes to the keyword search');
  eq(tt.query, { query: 'morning routine', trim: 'true', date_posted: 'this-month', sort_by: 'most-liked', region: 'us' }, 'tiktok.search sends only the allowed settings, trimmed');
  const yt = r.buildRequest('youtube.search', { query: 'dentist tips' });
  eq([yt.path, yt.query.type, yt.query.includeExtras], ['/v1/youtube/search', 'shorts', 'true'], 'youtube.search defaults to Shorts with like and comment counts');
  eq(r.buildRequest('youtube.search', { query: 'x', type: 'channels' }).ok, false, 'youtube.search refuses a type that is not videos or shorts');
  const rs = r.buildRequest('reddit.search', { query: 'weight loss', sort: 'relevance' });
  eq([rs.path, rs.query.sort], ['/v1/reddit/search', 'relevance'], 'reddit.search by relevance');
  const sub = r.buildRequest('reddit.subreddit', { subreddit: 'r/Fitness', sort: 'top', timeframe: 'month' });
  eq([sub.path, sub.query.subreddit, sub.query.sort, sub.query.timeframe], ['/v1/reddit/subreddit', 'Fitness', 'top', 'month'], 'a subreddit\'s own top posts, r/ stripped');
  eq(r.buildRequest('reddit.subreddit', { subreddit: 'a/b?x=1' }).ok, false, 'a subreddit name cannot carry a path or query');
  const cr = r.buildRequest('credits', {});
  eq([cr.ok, cr.path, cr.counts], [true, '/v1/account/credit-balance', false], 'credits is the balance and does not count against the cap');

  // ---- Transcripts: the site picks the endpoint, only video links ------------
  eq(r.buildRequest('transcript', { url: 'https://www.tiktok.com/@a/video/123' }).path, '/v1/tiktok/video/transcript', 'a TikTok link');
  eq(r.buildRequest('transcript', { url: 'https://vm.tiktok.com/abc/' }).path, '/v1/tiktok/video/transcript', 'a short TikTok link');
  eq(r.buildRequest('transcript', { url: 'https://www.instagram.com/reel/abc/' }).path, '/v2/instagram/media/transcript', 'an Instagram link');
  eq(r.buildRequest('transcript', { url: 'https://youtu.be/abc' }).path, '/v1/youtube/video/transcript', 'a short YouTube link');
  for (const bad of ['http://www.tiktok.com/@a/video/1', 'https://evil.example/tiktok.com', 'https://tiktok.com.evil.example/x', 'https://user:pw@www.tiktok.com/x', 'https://www.tiktok.com:8443/x', 'ftp://tiktok.com/x', '', 'not a link']) {
    eq(r.buildRequest('transcript', { url: bad }).ok, false, `transcript refuses ${JSON.stringify(bad)}`);
  }

  // ---- Nothing paid or free-form gets through ---------------------------------
  const sneaky = r.buildRequest('transcript', { url: 'https://www.tiktok.com/@a/video/1', allow_long_transcription: 'true', use_ai_as_fallback: 'true', language: 'en' });
  eq(sneaky.query, { url: 'https://www.tiktok.com/@a/video/1', language: 'en' }, 'long and AI transcription are never sent');
  ok(!JSON.stringify(r.buildRequest('tiktok.search', { query: 'a', path: '/v1/other', url: 'https://x.example' })).includes('other'), 'a caller cannot choose the path');
  eq(r.buildRequest('tiktok.search', { query: 'a', sort_by: 'bogus' }).ok, false, 'a setting outside ScrapeCreators\' list is refused');
  eq(r.buildRequest('tiktok.search', { query: '' }).ok, false, 'a search needs words');
  eq(r.buildRequest('tiktok.search', { query: 'x'.repeat(201) }).ok, false, 'a very long search is refused');
  eq(r.buildRequest('tiktok.search', { query: 'a', cursor: '1&x=2' }).ok, false, 'a paging value cannot carry extra settings');
  eq(r.buildRequest('facebook.search', { query: 'a' }).ok, false, 'Facebook is not offered (no view data)');
  eq(r.buildRequest('', null).ok, false, 'no action is refused');

  // ---- Cap and log ------------------------------------------------------------
  eq([r.capFrom(500), r.capFrom('300'), r.capFrom('"250"'), r.capFrom(null), r.capFrom('x'), r.capFrom(-1)], [500, 300, 250, 2000, 2000, 2000], 'the monthly cap reads a number and falls back to the default');
  eq(r.monthStart(new Date(Date.UTC(2026, 9, 23, 18, 0))), '2026-10-01T00:00:00.000Z', 'the cap counts from the first of the month, UTC');
  const line = r.logLine('tiktok.search', tt, { query: 'morning routine' });
  eq(line, { tool: 'scrapecreators.tiktok.search', summary: 'tiktok.search: morning routine' }, 'the log line names the tool and the search');
  eq(r.logLine('transcript', { site: 'youtube' }, { url: 'https://youtu.be/secretish' }).summary, 'transcript: youtube', 'a transcript is logged by site, not by link');

  // ---- TikTok answers are slimmed ---------------------------------------------
  const big = { success: true, credits_remaining: 5, cursor: 30, search_item_list: [{
    aweme_id: '1', url: 'https://www.tiktok.com/@a/video/1', desc: 'hi #x', region: 'US', create_time_utc: '2026-10-20T15:47:09.000Z', is_ad: false,
    statistics: { play_count: 100, digg_count: 7, comment_count: 2, share_count: 1, collect_count: 3, download_count: 9 },
    video: { duration: 9000, download_addr: { url_list: ['https://x'.repeat(500)] } }, author: { unique_id: 'a', nickname: 'A', follower_count: 50, avatar_larger: { url_list: ['y'] } } }] };
  const slim = r.slimResult('tiktok.search', big);
  eq(slim.search_item_list[0], { aweme_id: '1', url: 'https://www.tiktok.com/@a/video/1', desc: 'hi #x', region: 'US', create_time_utc: '2026-10-20T15:47:09.000Z', is_ad: false, duration_ms: 9000,
    statistics: { play_count: 100, digg_count: 7, comment_count: 2, share_count: 1, collect_count: 3 }, author: { unique_id: 'a', nickname: 'A', follower_count: 50 } }, 'a TikTok video keeps the words, link, date, counts (views) and poster only');
  eq([slim.cursor, slim.credits_remaining], [30, 5], 'paging and credit fields are kept');
  ok(JSON.stringify(slim).length < JSON.stringify(big).length / 3, 'the slim answer is much smaller');
  eq(r.slimResult('reddit.search', big), big, 'other actions are passed through unchanged');
  eq(r.slimResult('tiktok.search', 'not json'), 'not json', 'an answer that is not the expected shape passes through');

  // ---- The wiring in index.ts -------------------------------------------------
  ok(/isPassToken\(raw\)/.test(src) && /fp_pass_use/.test(src), 'a pass is required and looked up by its hash');
  ok(/slimResult\(action/.test(src), 'the answer goes through slimResult');
  ok(/pipelineGate\(/.test(src), 'the filming plan list gate runs for every call');
  ok(/pass\.via !== "personal"/.test(src), 'the shared team link is refused');
  ok(/Deno\.env\.get\("SCRAPECREATORS_API_KEY"\)/.test(src) && !/fp_[a-z]+.*SCRAPECREATORS/.test(src), 'the key comes only from the Supabase secret');
  ok(/"x-api-key": key/.test(src) || /"x-api-key":\s*key/.test(src), 'the key goes only in the request header to ScrapeCreators');
  ok(!/json\([^)]*\bkey\b/.test(src), 'the key is never put in an answer');
  ok(/scrapecreators\.%/.test(src) && /hf_activity/.test(src), 'every call is logged in hf_activity and counted for the cap');
  ok(/monthStart\(\)/.test(src) && /CAP_KEY/.test(src), 'the cap is checked before each counted call');
  ok(src.indexOf('.insert({ ...row, ok: true') > 0 && src.indexOf('.insert({ ...row, ok: true') < src.indexOf('await fetch(url'), 'the call is written down before ScrapeCreators is called');
  ok(src.indexOf('.insert({ ...row, ok: true') < src.indexOf('count: "exact"'), 'the count is taken after the call is written down (parallel calls cannot overshoot the cap)');
  ok(/Could not write the call down, so it was not made/.test(src), 'a call whose row cannot be written is not made');
  ok(/\(used\.count \?\? 0\) > cap/.test(src), 'the count includes the call itself');
  ok(!/x-pipeline-key/.test(src), 'there is no password path, only passes');
  ok(/\[functions\.pipeline-social\]\s*verify_jwt = false/.test(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8')), 'config.toml: JWT off (the pass is the login)');

  console.log(`pipeline-social: ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
