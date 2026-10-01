// Pure logic of the daily metrics job, ported node by node from the n8n workflow
// "CLIENTS METRICS" (docs/plans/2026-10-01-n8n-off-analytics.md, section 1 maps
// each function here to its n8n node). No network and no clock of its own: the
// caller passes `now`, so the same code runs in the Edge Function and in
// test/analytics-metrics-collect.js.
//
// Rules kept exactly as n8n has them, including the odd ones:
//   - dates are UTC;
//   - a post seen for the first time counts 0 gain unless it is an Instagram
//     reel baseline (always 0) or a TikTok published in the last 2 days;
//   - the "this month" columns are cumulative counters that never reset
//     (previous stored value + today's gain), see docs/proposals/2026-10-01-analytics-views-audit.md;
//   - a platform whose provider failed copies the last good row's values, gains 0.

export const METRIC_COLUMNS = Object.freeze(['date', 'client_name', 'ig_followers', 'ig_avg_views', 'ig_avg_likes',
  'tiktok_followers', 'tiktok_avg_plays', 'yt_subscribers', 'yt_total_views', 'ig_views_gained_today',
  'tiktok_plays_gained_today', 'ig_views_this_month', 'tiktok_plays_this_month', 'yt_views_gained_today',
  'yt_shorts_views', 'yt_longs_views', 'analytics_receipt']);

const DAY_MS = 86400 * 1000;

export function configured(value) {
  const normalized = String(value ?? '').trim();
  return Boolean(normalized && normalized.toUpperCase() !== 'N/A');
}

const finite = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const number = value => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };

function receipt(state, itemCount, now, errorClass = null, expected = true, attempted = true) {
  const ok = state === 'success' || state === 'genuinely_empty';
  return {
    expected, attempted, state, item_count: itemCount,
    fetched_at: attempted ? now : null,
    source_date: ok ? now.slice(0, 10) : null,
    used_last_good: false, error_class: errorClass,
  };
}

export const NOT_CONFIGURED = Object.freeze({ expected: false, attempted: false, state: 'not_configured',
  item_count: 0, fetched_at: null, source_date: null, used_last_good: false, error_class: null });

// ---- Aggregate Instagram -------------------------------------------------
// profile: first item of the profile scraper. reelItems: the reel scraper's items.
export function aggregateInstagram(profile, reelItems, now) {
  profile = profile ?? {};
  const hasProviderError = value => {
    const messages = Array.isArray(value?.requestErrorMessages) ? value.requestErrorMessages : [];
    const status = Number(value?.statusCode ?? value?.httpCode ?? 0);
    return Boolean(value?.error || value?.errorDescription || value?.isRestrictedProfile === true || messages.length || (Number.isFinite(status) && status >= 400));
  };
  const profileFailed = hasProviderError(profile);
  const reelError = reelItems.find(hasProviderError);
  const followersNumber = Number(profile.followersCount);
  const reels = reelItems.filter(post => {
    const rawId = String(post?.id ?? post?.shortCode ?? post?.url ?? '').trim();
    return Boolean(rawId) && !hasProviderError(post);
  });
  const reelsFailed = Boolean(reelError) && reels.length === 0;
  const schemaInvalid = !profileFailed && !Number.isFinite(followersNumber);
  const providerFailed = profileFailed || reelsFailed || schemaInvalid;
  let errorClass = null;
  if (providerFailed) {
    const combined = [profile, reelsFailed ? reelError : null].filter(Boolean);
    const blocked = combined.some(value => (value.requestErrorMessages || []).some(message => String(message).toLowerCase().includes('blocked')));
    const status = combined.map(value => Number(value.statusCode ?? value.httpCode ?? 0)).find(value => Number.isFinite(value) && value >= 400);
    const errorCode = String((reelsFailed ? reelError : profile).error ?? '').toLowerCase();
    if (combined.some(value => value?.isRestrictedProfile === true || String(value?.error ?? '').toLowerCase().includes('restricted profile'))) errorClass = 'apify_restricted_profile';
    else if (errorCode === 'no_items') errorClass = 'apify_no_items';
    else if (blocked) errorClass = 'apify_request_blocked';
    else if (status) errorClass = 'apify_http_error';
    else if (schemaInvalid) errorClass = 'apify_schema_invalid';
    else errorClass = 'apify_provider_error';
  }
  const viewsOf = post => finite(post.videoPlayCount ?? post.playCount ?? post.videoViewCount ?? 0);
  if (providerFailed) {
    return { ig_followers: null, ig_avg_likes: null, ig_avg_views: null, ig_total_post_views: null,
      instagram_receipt: receipt('provider_failed', 0, now, errorClass) };
  }
  const avgLikes = reels.length ? Math.round(reels.reduce((s, p) => s + finite(p.likesCount), 0) / reels.length) : 0;
  const avgViews = reels.length ? Math.round(reels.reduce((s, p) => s + viewsOf(p), 0) / reels.length) : 0;
  const totalPostViews = reels.reduce((s, p) => s + viewsOf(p), 0);
  return { ig_followers: followersNumber, ig_avg_likes: avgLikes, ig_avg_views: avgViews, ig_total_post_views: totalPostViews,
    instagram_receipt: receipt(reels.length ? 'success' : 'genuinely_empty', reels.length, now) };
}

// ---- Aggregate TikTok ----------------------------------------------------
export function aggregateTikTok(rawItems, now) {
  rawItems = rawItems.map(item => item ?? {});
  const isErrorShaped = value => {
    const statusCode = Number(value?.statusCode ?? value?.httpCode ?? 0);
    return Boolean(value?.error || value?.errorDescription ||
      (Array.isArray(value?.requestErrorMessages) && value.requestErrorMessages.length) ||
      (Number.isFinite(statusCode) && statusCode >= 400));
  };
  const errorItem = rawItems.find(isErrorShaped);
  const items = rawItems.filter(value => !isErrorShaped(value) && Object.keys(value).length > 0);
  let errorClass = null;
  if (errorItem) {
    const statusCode = Number(errorItem.statusCode ?? errorItem.httpCode ?? 0);
    const blocked = (errorItem.requestErrorMessages ?? []).some(message => String(message).toLowerCase().includes('blocked'));
    if (String(errorItem.error ?? '').toLowerCase() === 'no_items') errorClass = 'apify_no_items';
    else if (blocked) errorClass = 'apify_request_blocked';
    else if (Number.isFinite(statusCode) && statusCode >= 400) errorClass = 'apify_http_error';
    else errorClass = 'apify_provider_error';
  }
  if (errorItem && items.length === 0) {
    return { tiktok_followers: null, tiktok_avg_plays: null, tiktok_total_post_plays: null,
      tiktok_receipt: receipt('provider_failed', 0, now, errorClass) };
  }
  const first = items[0] ?? {};
  const followers = finite(first.authorMeta?.fans ?? first.authorMeta?.followers ?? first.fans ?? 0);
  const total = items.reduce((s, i) => s + finite(i.playCount), 0);
  const avgPlays = items.length ? Math.round(total / items.length) : 0;
  return { tiktok_followers: followers, tiktok_avg_plays: avgPlays, tiktok_total_post_plays: total,
    tiktok_receipt: receipt(items.length ? 'success' : 'genuinely_empty', items.length, now) };
}

// ---- YouTube: "Edit Fields", "Classify & Sum" -----------------------------
// channelJson: the channels?part=statistics answer (or an error-shaped object).
export function youtubeChannel(channelJson, now) {
  const j = channelJson ?? {};
  const failed = Boolean(j.error || j.errorDescription || Number(j.statusCode ?? 0) >= 400);
  const stats = j.items?.[0]?.statistics;
  const n = j.items?.length ?? 0;
  return {
    yt_subscribers: failed ? null : (stats?.subscriberCount ?? null),
    yt_total_views: failed ? null : (stats?.viewCount ?? null),
    youtube_receipt: receipt(failed ? 'provider_failed' : (n > 0 ? 'success' : 'genuinely_empty'), n, now,
      failed ? 'youtube_provider_error' : null),
  };
}

function durSec(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

// videos: items of the videos?part=statistics,contentDetails,snippet answer.
export function classifyShortsLongs(videos, nowMs) {
  const cutoffMs = nowMs - 30 * DAY_MS;
  let shorts = 0, longs = 0;
  const seen = new Set();
  for (const v of videos || []) {
    if (v.id && seen.has(v.id)) continue;
    if (v.id) seen.add(v.id);
    const pub = new Date((v.snippet && v.snippet.publishedAt) || 0).getTime();
    if (Number.isNaN(pub) || pub < cutoffMs) continue;
    const sec = durSec(v.contentDetails && v.contentDetails.duration);
    const views = Number((v.statistics && v.statistics.viewCount) || 0);
    if (sec > 0 && sec <= 180) shorts += views; else longs += views;
  }
  return { shorts, longs };
}

// ---- Merge Data3 -----------------------------------------------------------
// client: Clients Info fields (client_name, *_handle, youtube_channel_id).
// ig/tt/yt: the outputs above, or undefined for a platform that is not configured.
// ytSplit: null (this client has no shorts/longs split: n8n writes '""' which
// the mirror stores as empty) or { shorts, longs }.
export function mergeClient(client, { ig, tt, yt, ytSplit }, now) {
  const today = now.slice(0, 10);
  const hasInstagram = configured(client.instagram_handle);
  const hasTikTok = configured(client.tiktok_handle);
  const hasYouTube = configured(client.youtube_channel_id);
  const missing = errorClass => ({ expected: true, attempted: true, state: 'provider_failed', item_count: 0,
    fetched_at: now, source_date: null, used_last_good: false, error_class: errorClass });
  const norm = (candidate, fallback) => {
    const v = candidate && typeof candidate === 'object' ? candidate : fallback;
    return { expected: Boolean(v.expected), attempted: Boolean(v.attempted), state: v.state,
      item_count: Number(v.item_count ?? 0), fetched_at: v.fetched_at ?? null, source_date: v.source_date ?? null,
      used_last_good: Boolean(v.used_last_good ?? false), error_class: v.error_class ?? null };
  };
  const igData = hasInstagram ? (ig ?? {}) : {};
  const ttData = hasTikTok ? (tt ?? {}) : {};
  const ytData = hasYouTube ? { ...(yt ?? {}), ...(ytSplit ? { yt_shorts_views: ytSplit.shorts, yt_longs_views: ytSplit.longs } : { yt_shorts_views: '', yt_longs_views: '' }) }
    : { yt_total_views: '0', yt_subscribers: '0', yt_shorts_views: '0', yt_longs_views: '0' };
  return {
    date: today,
    client_name: client.client_name,
    ig_followers: igData.ig_followers ?? null,
    ig_avg_likes: igData.ig_avg_likes ?? null,
    ig_avg_views: igData.ig_avg_views ?? null,
    ig_total_post_views: igData.ig_total_post_views ?? null,
    tiktok_followers: hasTikTok ? (ttData.tiktok_followers ?? null) : '0',
    tiktok_avg_plays: hasTikTok ? (ttData.tiktok_avg_plays ?? null) : '0',
    tiktok_total_post_plays: hasTikTok ? (ttData.tiktok_total_post_plays ?? null) : '0',
    yt_subscribers: ytData.yt_subscribers ?? null,
    yt_total_views: ytData.yt_total_views ?? null,
    yt_shorts_views: ytData.yt_shorts_views ?? '',
    yt_longs_views: ytData.yt_longs_views ?? '',
    analytics_receipt: {
      schema: 'syncview.analytics.receipt.v1',
      client_name: client.client_name,
      run_date: today,
      terminal: false,
      metrics_written: false,
      result: 'processing',
      platforms: {
        instagram: norm(igData.instagram_receipt, hasInstagram ? missing('receipt_missing') : NOT_CONFIGURED),
        tiktok: norm(hasTikTok ? ttData.tiktok_receipt : undefined, hasTikTok ? missing('receipt_missing') : NOT_CONFIGURED),
        youtube: norm(hasYouTube ? ytData.youtube_receipt : undefined, hasYouTube ? missing('receipt_missing') : NOT_CONFIGURED),
      },
    },
  };
}

// ---- Update Post Tracking + Compute Post Gains ----------------------------
// igPosts: reel scraper items; ttPosts: TikTok dataset items (already
// filtered to error-free items by the caller, as n8n does).
export function trackedPosts({ merged, igPosts, ttPosts, tiktokConfigured }) {
  const receipt_ = merged.analytics_receipt ?? { platforms: {} };
  const ok = s => ['success', 'genuinely_empty'].includes(s);
  const today = merged.date;
  const rows = [];
  if (ok(receipt_.platforms?.instagram?.state)) {
    for (const post of igPosts) {
      const rawId = String(post.id ?? post.shortCode ?? post.url ?? '').trim();
      if (!rawId || post.error || post.errorDescription) continue;
      rows.push({ post_id: 'igr_' + rawId, client_name: merged.client_name, platform: 'instagram', first_seen_date: today,
        views_today: post.videoPlayCount ?? post.playCount ?? post.videoViewCount ?? 0,
        timestamp: post.taken_at ?? post.timestamp ?? post.date ?? '' });
    }
  }
  if (tiktokConfigured && ok(receipt_.platforms?.tiktok?.state)) {
    for (const post of ttPosts) {
      if (post.error || post.errorDescription) continue;
      const rawId = String(post.id ?? post.webVideoUrl ?? post.videoUrl ?? post.shareUrl ?? '').trim();
      if (!rawId) continue;
      rows.push({ post_id: 'tt_' + rawId, client_name: merged.client_name, platform: 'tiktok', first_seen_date: today,
        views_today: post.playCount ?? 0,
        timestamp: post.createTime ? new Date(post.createTime * 1000).toISOString() : '' });
    }
  }
  return rows;
}

// existingPosts: stored rows for this client BEFORE this run (post_id, views_today, first_seen_date).
export function computePostGains(newPosts, existingPosts, nowMs) {
  const existingMap = {};
  for (const post of existingPosts) existingMap[String(post.post_id).trim()] = post;
  let ig = 0, tt = 0;
  const updatedRows = newPosts.map(post => {
    const existing = existingMap[String(post.post_id).trim()];
    const viewsYesterday = existing ? Number(existing.views_today ?? 0) : 0;
    const viewsToday = Number(post.views_today ?? 0);
    const isFirstDay = !existing;
    const publishedMs = Date.parse(post.timestamp || '');
    const isBrandNew = Boolean(publishedMs && publishedMs >= nowMs - 2 * DAY_MS);
    const isReelsBaseline = post.platform === 'instagram' && String(post.post_id).startsWith('igr_') && isFirstDay;
    const gained = isReelsBaseline ? 0 : (isFirstDay ? (isBrandNew ? viewsToday : 0) : Math.max(0, viewsToday - viewsYesterday));
    if (post.platform === 'instagram') ig += gained;
    if (post.platform === 'tiktok') tt += gained;
    return { post_id: String(post.post_id).trim(), client_name: post.client_name, platform: post.platform,
      first_seen_date: existing ? existing.first_seen_date : post.first_seen_date,
      views_yesterday: viewsYesterday, views_today: viewsToday, views_gained_today: gained };
  });
  return { updatedRows, ig_views_gained_today: ig, tiktok_plays_gained_today: tt };
}

// ---- Compute Diffs ---------------------------------------------------------
// previousRows: this client's stored metric rows (any order). gains: from computePostGains.
export function computeDiffs(merged, gains, previousRows, now) {
  const today = now.slice(0, 10);
  const output = { ...merged, ig_views_gained_today: gains.ig_views_gained_today, tiktok_plays_gained_today: gains.tiktok_plays_gained_today };
  const rcpt = JSON.parse(JSON.stringify(merged.analytics_receipt));
  const previous = previousRows
    .filter(row => row.date && String(row.date) < today)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] ?? null;
  const copyLastGood = (platform, fields) => {
    const pr = rcpt.platforms?.[platform];
    if (pr?.state !== 'provider_failed') return false;
    for (const field of fields) output[field] = previous ? previous[field] ?? null : null;
    pr.used_last_good = Boolean(previous);
    pr.source_date = previous?.date ?? null;
    return true;
  };
  const instagramFailed = copyLastGood('instagram', ['ig_followers', 'ig_avg_views', 'ig_avg_likes']);
  const tiktokFailed = copyLastGood('tiktok', ['tiktok_followers', 'tiktok_avg_plays']);
  const youtubeFailed = copyLastGood('youtube', ['yt_subscribers', 'yt_total_views', 'yt_shorts_views', 'yt_longs_views']);
  const prevIg = number(previous?.ig_views_this_month);
  const prevTt = number(previous?.tiktok_plays_this_month);
  const prevYt = number(previous?.yt_total_views);
  output.ig_views_gained_today = instagramFailed ? 0 : number(gains.ig_views_gained_today);
  output.tiktok_plays_gained_today = tiktokFailed ? 0 : number(gains.tiktok_plays_gained_today);
  output.ig_views_this_month = instagramFailed ? (previous ? prevIg : null) : prevIg + output.ig_views_gained_today;
  output.tiktok_plays_this_month = tiktokFailed ? (previous ? prevTt : null) : prevTt + output.tiktok_plays_gained_today;
  output.yt_views_gained_today = youtubeFailed ? 0 : Math.max(0, number(output.yt_total_views) - prevYt);
  const degraded = Object.values(rcpt.platforms ?? {}).some(p => p?.state === 'provider_failed');
  rcpt.terminal = true;
  rcpt.metrics_written = true;
  rcpt.result = degraded ? 'degraded' : 'success';
  rcpt.completed_at = now;
  output.analytics_receipt = rcpt;
  return output;
}

// The text cells exactly as the Sheet (and the mirror) holds them: null is an
// empty cell, the receipt is its JSON text.
export function toStoredRow(output) {
  const cell = v => (v == null ? '' : String(v));
  const row = {};
  for (const c of METRIC_COLUMNS) row[c] = c === 'analytics_receipt' ? JSON.stringify(output.analytics_receipt) : cell(output[c]);
  return row;
}
