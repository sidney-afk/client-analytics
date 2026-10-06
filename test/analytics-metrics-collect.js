'use strict';
/*
 * analytics-metrics-collect.js: the Edge Function's port of the n8n workflow
 * "CLIENTS METRICS" must give the SAME answers as the n8n nodes themselves.
 *
 * test/fixtures/n8n-clients-metrics-code.js holds the Code nodes exactly as they
 * ran. This test feeds the same random inputs (reels, TikToks, YouTube answers,
 * stored posts, stored previous rows, error-shaped provider answers, clients
 * with and without each platform) through the n8n code, through small stand-ins
 * for n8n's $input / $('Node') helpers, and through supabase/functions/_shared/
 * analytics-metrics-collect.mjs, then compares the row that would be written and
 * the post-tracking rows. Offline; no network, no database.
 */
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const N8N = require('./fixtures/n8n-clients-metrics-code.js');

const ROOT = path.resolve(__dirname, '..');
const NOW_ISO = '2026-10-02T04:30:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

class FixedDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(NOW_MS); }
  static now() { return NOW_MS; }
}

// n8n's Code-node helpers, reduced to what these nodes call.
function runNode(name, { input = [], nodes = {} }) {
  const wrap = arr => arr.map(json => ({ json }));
  const custom = new Map();
  const $ = nodeName => {
    const n = nodes[nodeName];
    if (!n) throw new Error('Node not run: ' + nodeName);
    return { first: () => (n.all.length ? { json: n.all[0] } : undefined), all: () => wrap(n.all), item: { json: n.item ?? n.all[0] } };
  };
  const $input = { all: () => wrap(input), first: () => (input.length ? { json: input[0] } : undefined) };
  const $execution = { customData: { set: (k, v) => custom.set(k, v), get: k => custom.get(k) } };
  const fn = new Function('$', '$input', '$execution', 'Date', N8N[name]);
  return { out: fn($, $input, $execution, FixedDate).map(i => i.json), custom };
}

// ---- seeded random inputs ----
let seed = 20261002;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = arr => arr[int(0, arr.length - 1)];
const maybe = p => rnd() < p;

function reel(i) {
  const o = { id: maybe(0.8) ? 'r' + i : undefined, shortCode: 'sc' + i, url: 'https://x/' + i, likesCount: int(0, 5000) };
  const k = pick(['videoPlayCount', 'playCount', 'videoViewCount']);
  o[k] = int(0, 3_000_000);
  const when = NOW_MS - int(0, 6) * 86400000 - int(0, 80000) * 1000;
  const f = pick(['taken_at', 'timestamp', 'date']);
  o[f] = maybe(0.9) ? new Date(when).toISOString() : '';
  if (maybe(0.03)) o.error = 'boom';
  return o;
}
function tiktok(i) {
  const o = { id: 't' + i, playCount: int(0, 900000), createTime: Math.floor((NOW_MS - int(0, 5) * 86400000 - int(0, 80000) * 1000) / 1000),
    authorMeta: maybe(0.7) ? { fans: int(100, 900000) } : undefined };
  if (maybe(0.5)) o.webVideoUrl = 'https://t/' + i;
  return o;
}
function providerItems(kind, n) {
  const r = rnd();
  if (r < 0.1) return [{ error: pick(['no_items', 'restricted profile', 'x']), requestErrorMessages: maybe(0.3) ? ['request blocked'] : [] }];
  if (r < 0.15) return [{ statusCode: pick([403, 429, 500]) }];
  if (r < 0.2) return [];
  return Array.from({ length: n }, (_, i) => (kind === 'ig' ? reel(i) : tiktok(i)));
}
function profile() {
  const r = rnd();
  if (r < 0.08) return { error: 'no_items' };
  if (r < 0.12) return { isRestrictedProfile: true };
  if (r < 0.16) return {};
  if (r < 0.2) return { followersCount: 'abc' };
  return { followersCount: int(0, 2_000_000) };
}
function ytChannel() {
  const r = rnd();
  if (r < 0.1) return { error: { code: 403, message: 'quota' } };
  if (r < 0.15) return { statusCode: 500 };
  if (r < 0.2) return { items: [] };
  return { items: [{ statistics: { subscriberCount: String(int(0, 900000)), viewCount: String(int(0, 900_000_000)) } }] };
}
function ytVideos() {
  return Array.from({ length: int(0, 12) }, (_, i) => ({
    id: maybe(0.1) ? 'dup' : 'v' + i,
    snippet: { publishedAt: new Date(NOW_MS - int(0, 50) * 86400000).toISOString() },
    contentDetails: { duration: pick(['PT45S', 'PT3M', 'PT3M1S', 'PT1H2M3S', 'PT0S', 'garbage']) },
    statistics: maybe(0.95) ? { viewCount: String(int(0, 1_000_000)) } : {},
  }));
}

async function main() {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/analytics-metrics-collect.mjs')).href);
  let compared = 0, degraded = 0, withGain = 0;
  const strip = r => { const c = JSON.parse(JSON.stringify(r)); delete c.client_key; delete c.row_number; if (c.analytics_receipt) { delete c.analytics_receipt.client_key; delete c.analytics_receipt.row_number; } return c; };

  for (let n = 0; n < 600; n++) {
    const client = {
      client_name: 'Client ' + n,
      instagram_handle: pick(['handle', 'handle', 'handle', '', 'N/A', ' n/a ']),
      tiktok_handle: pick(['tt', 'tt', '', 'N/A']),
      youtube_channel_id: pick(['UCabc', 'UCabc', '', 'N/A']),
      __analytics_client_key: 'row:' + n, row_number: n,
    };
    const hasIg = L.configured(client.instagram_handle), hasTt = L.configured(client.tiktok_handle), hasYt = L.configured(client.youtube_channel_id);
    const split = hasYt && maybe(0.3);
    const nowIso = NOW_ISO;

    // --- sources
    const prof = hasIg ? profile() : null;
    const reels = hasIg ? providerItems('ig', int(0, 50)) : [];
    const tts = hasTt ? providerItems('tt', int(0, 30)) : [];
    const ch = hasYt ? ytChannel() : null;
    const vids = split ? ytVideos() : [];

    // --- n8n: aggregates
    const nodes = { 'Loop Over Items': { all: [client], item: client } };
    let igN, ttN, ytN;
    if (hasIg) {
      nodes['Apify Instagram'] = { all: [prof] };
      igN = runNode('Aggregate Instagram', { input: reels, nodes }).out[0];
      nodes['Aggregate Instagram'] = { all: [igN] };
    } else {
      nodes['Instagram Not Configured'] = { all: [{ ig_followers: null, ig_avg_likes: null, ig_avg_views: null, ig_total_post_views: null,
        instagram_receipt: { expected: false, attempted: false, state: 'not_configured', item_count: 0, fetched_at: null, source_date: null, used_last_good: false, error_class: null } }] };
    }
    if (hasTt) {
      ttN = runNode('Aggregate TikTok', { input: tts, nodes }).out[0];
      nodes['Aggregate TikTok'] = { all: [ttN] };
    } else {
      nodes['Empty TikTok'] = { all: [{ tiktok_followers: '0', tiktok_avg_plays: '0', tiktok_total_post_plays: '0',
        tiktok_receipt: { expected: false, attempted: false, state: 'not_configured', item_count: 0, fetched_at: null, source_date: null, used_last_good: false, error_class: null } }] };
    }
    let ytInput;
    if (hasYt) {
      // "Edit Fields" is an expression node; the port is checked against its rule here.
      const failed = Boolean(ch.error || ch.errorDescription || Number(ch.statusCode ?? 0) >= 400);
      const editFields = {
        yt_subscribers: failed ? null : (ch.items?.[0]?.statistics?.subscriberCount ?? null),
        yt_total_views: failed ? null : (ch.items?.[0]?.statistics?.viewCount ?? null),
        youtube_receipt: { expected: true, attempted: true, state: failed ? 'provider_failed' : ((ch.items?.length ?? 0) > 0 ? 'success' : 'genuinely_empty'),
          item_count: ch.items?.length ?? 0, fetched_at: nowIso, source_date: failed ? null : nowIso.slice(0, 10), used_last_good: false, error_class: failed ? 'youtube_provider_error' : null },
      };
      nodes['Edit Fields'] = { all: [editFields] };
      assert.deepEqual(L.youtubeChannel(ch, nowIso), editFields, 'youtubeChannel matches Edit Fields');
      ytInput = split ? runNode('Classify & Sum', { input: [{ items: vids }], nodes }).out[0] : { ...editFields, yt_shorts_views: '""', yt_longs_views: '""' };
      if (split) {
        const c = L.classifyShortsLongs(vids, NOW_MS);
        assert.equal(c.shorts, ytInput.yt_shorts_views, 'shorts');
        assert.equal(c.longs, ytInput.yt_longs_views, 'longs');
      }
    } else {
      ytInput = { yt_total_views: '0', yt_subscribers: '0', yt_shorts_views: '0', yt_longs_views: '0',
        youtube_receipt: { expected: false, attempted: false, state: 'not_configured', item_count: 0, fetched_at: null, source_date: null, used_last_good: false, error_class: null } };
    }
    const mergedN = runNode('Merge Data3', { input: [ytInput], nodes }).out[0];

    // --- port: aggregates and merge
    const igP = hasIg ? L.aggregateInstagram(prof, reels, nowIso) : undefined;
    const ttP = hasTt ? L.aggregateTikTok(tts, nowIso) : undefined;
    const ytP = hasYt ? L.youtubeChannel(ch, nowIso) : undefined;
    const ytSplit = split ? L.classifyShortsLongs(vids, NOW_MS) : null;
    const mergedP = L.mergeClient(client, { ig: igP, tt: ttP, yt: ytP, ytSplit }, nowIso);
    const norm = o => { const c = strip(o); if (c.yt_shorts_views === '""') c.yt_shorts_views = ''; if (c.yt_longs_views === '""') c.yt_longs_views = ''; return c; };
    assert.deepEqual(norm(mergedP), norm(mergedN), 'merged client row #' + n);

    // --- n8n: tracked posts and gains
    nodes['Merge Data3'] = { all: [mergedN] };
    nodes['Fetch Instagram Reels'] = { all: reels };
    nodes['Fetch TikTok Dataset'] = { all: tts };
    const upN = runNode('Update Post Tracking', { input: [mergedN], nodes }).out;
    nodes['Update Post Tracking'] = { all: upN };
    const trackedN = upN.filter(r => !r.__skip_post_tracking);
    const igP2 = hasIg ? reels : [];
    const trackedP = L.trackedPosts({ merged: mergedP, igPosts: igP2, ttPosts: tts.filter(i => !(i.error || i.errorDescription)), tiktokConfigured: hasTt });
    const key = r => ({ post_id: r.post_id, client_name: r.client_name, platform: r.platform, first_seen_date: r.first_seen_date, views_today: r.views_today, timestamp: r.timestamp });
    assert.deepEqual(trackedP.map(key), trackedN.map(key), 'tracked posts #' + n);

    // stored posts: some of today's ids already known, some not
    const existing = [];
    for (const p of trackedN) if (maybe(0.7)) existing.push({ post_id: p.post_id, views_today: int(0, 3_000_000), first_seen_date: '2026-09-' + String(int(10, 30)) });
    nodes['Read Post Tracking'] = { all: existing };
    const gainsN = runNode('Compute Post Gains', { nodes }).out[0];
    const gainsP = L.computePostGains(trackedP, existing, NOW_MS);
    assert.deepEqual(gainsP, gainsN, 'post gains #' + n);

    // --- n8n: restore gains + diffs
    nodes['Split Post Rows'] = { all: [{}] };
    const restoreCtx = { nodes };
    const restoreRun = (() => {
      const r = runNode('Split Post Rows', { input: [gainsN], nodes: { 'Merge Data3': { all: [mergedN] } } });
      const custom = r.custom;
      const fn = new Function('$', '$input', '$execution', 'Date', N8N['Restore Gains']);
      const $ = nm => ({ first: () => ({ json: restoreCtx.nodes[nm].all[0] }) });
      const $execution = { customData: { get: k => custom.get(k) } };
      return fn($, { all: () => [] }, $execution, FixedDate)[0].json;
    })();
    nodes['Restore Gains'] = { all: [restoreRun] };
    const previous = [];
    const days = int(0, 4);
    for (let d = 1; d <= days; d++) {
      previous.push({ date: new Date(NOW_MS - d * 86400000).toISOString().slice(0, 10), ig_followers: String(int(0, 1e6)), ig_avg_views: String(int(0, 1e6)),
        ig_avg_likes: String(int(0, 1e4)), tiktok_followers: String(int(0, 1e6)), tiktok_avg_plays: String(int(0, 1e6)), yt_subscribers: String(int(0, 1e6)),
        yt_total_views: String(int(0, 1e9)), yt_shorts_views: maybe(0.5) ? '' : String(int(0, 1e6)), yt_longs_views: String(int(0, 1e6)),
        ig_views_this_month: String(int(0, 1e8)), tiktok_plays_this_month: String(int(0, 1e8)) });
    }
    if (maybe(0.2)) previous.push({ date: NOW_ISO.slice(0, 10), ig_views_this_month: '999999999', yt_total_views: '999999999' }); // today's own row is ignored
    nodes['Get Previous Rows'] = { all: previous.slice().reverse() };
    const diffN = runNode('Compute Diffs', { nodes }).out[0];
    const diffP = L.computeDiffs(mergedP, gainsP, previous.slice().reverse(), nowIso);
    // n8n's receipt carries client_key/row_number, and completed_at is its own clock; both fixed here.
    const cell = r => { const o = L.toStoredRow(r); const rc = JSON.parse(o.analytics_receipt); return { ...o, analytics_receipt: rc }; };
    const diffNs = { ...diffN, analytics_receipt: strip(diffN.analytics_receipt) };
    if (diffNs.yt_shorts_views === '""') diffNs.yt_shorts_views = '';
    if (diffNs.yt_longs_views === '""') diffNs.yt_longs_views = '';
    assert.deepEqual(cell(diffP), cell(diffNs), 'final stored row #' + n);
    compared++;
    if (diffP.analytics_receipt.result === 'degraded') degraded++;
    if (Number(diffP.ig_views_gained_today) > 0) withGain++;
  }
  assert(degraded > 40 && degraded < 560, 'the random inputs reach degraded rows: ' + degraded);
  assert(withGain > 50, 'the random inputs reach rows with a gain: ' + withGain);

  // ---- hand-checked rules (so the equivalence test cannot agree on a wrong shared idea) ----
  const g = L.computePostGains(
    [{ post_id: 'igr_a', platform: 'instagram', views_today: 100, timestamp: '', client_name: 'c', first_seen_date: '2026-10-02' },
     { post_id: 'igr_b', platform: 'instagram', views_today: 100, timestamp: NOW_ISO, client_name: 'c', first_seen_date: '2026-10-02' },
     { post_id: 'tt_c', platform: 'tiktok', views_today: 80, timestamp: NOW_ISO, client_name: 'c', first_seen_date: '2026-10-02' },
     { post_id: 'tt_d', platform: 'tiktok', views_today: 80, timestamp: '2026-01-01T00:00:00Z', client_name: 'c', first_seen_date: '2026-10-02' },
     { post_id: 'igr_e', platform: 'instagram', views_today: 50, timestamp: '', client_name: 'c', first_seen_date: '2026-10-02' }],
    [{ post_id: 'igr_a', views_today: 60, first_seen_date: '2026-09-01' }, { post_id: 'igr_e', views_today: 90, first_seen_date: '2026-09-01' }], NOW_MS);
  assert.equal(g.ig_views_gained_today, 40, 'a known reel gains the difference; a new reel is a baseline (0); a drop counts 0');
  assert.equal(g.tiktok_plays_gained_today, 80, 'a brand-new TikTok counts all its views, an old new one 0');
  const failed = L.computeDiffs(
    { ...L.mergeClient({ client_name: 'c', instagram_handle: 'h' }, { ig: L.aggregateInstagram({}, [], NOW_ISO) }, NOW_ISO) },
    { ig_views_gained_today: 7, tiktok_plays_gained_today: 0 },
    [{ date: '2026-10-01', ig_followers: '123', ig_avg_views: '4', ig_avg_likes: '5', ig_views_this_month: '1000' }], NOW_ISO);
  assert.equal(failed.ig_followers, '123', 'a failed platform copies the last good row');
  assert.equal(failed.ig_views_gained_today, 0, 'and gains 0');
  assert.equal(failed.ig_views_this_month, 1000, 'and keeps the counter');
  assert.equal(failed.analytics_receipt.result, 'degraded');

  // The function file wires the same module and never touches the real table.
  const fnSrc = fs.readFileSync(path.join(ROOT, 'supabase/functions/analytics-metrics-collect/index.ts'), 'utf8');
  assert(fnSrc.includes('../_shared/analytics-metrics-collect.mjs'), 'function uses the shared rules');
  assert(!/from\("analytics_metrics"\)\s*\.(insert|upsert|update|delete)/.test(fnSrc.replace(/\s+/g, ' ')), 'never writes analytics_metrics directly (live mode writes it only through the commit function)');
  assert(!/docs\.google|googleapis\.com\/(upload|auth)|spreadsheets/.test(fnSrc), 'never touches a Sheet');
  assert(fnSrc.includes('collectMode(flags) === "off") return json({ ok: true, skipped: "off" })'), 'does nothing unless the flag says shadow or live');
  const liveAt = fnSrc.indexOf('if (collectMode(flags) === "live") {');
  assert(liveAt > 0 && fnSrc.split('analytics_metrics_collect_commit_live').length === 2 && fnSrc.indexOf('analytics_metrics_collect_commit_live') > liveAt
    && fnSrc.indexOf('analytics_metrics_collect_commit_live') < fnSrc.indexOf('analytics_metrics_collect_commit_shadow", {'), 'the real table is written only inside the live branch');
  console.log('ANALYTICS_METRICS_COLLECT_OK: ' + compared + ' random clients identical to the n8n nodes (' + degraded + ' degraded, ' + withGain + ' with Instagram gain), rules hand-checked');
}
main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
