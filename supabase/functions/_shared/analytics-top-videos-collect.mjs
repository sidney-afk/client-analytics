// Pure logic of the daily Top Videos job, ported node by node from the n8n workflow
// "TOP VIDEOS" (docs/plans/2026-10-01-n8n-off-analytics.md, section 7 maps each
// function here to its n8n node). No network and no clock of its own: the caller
// passes `now` (a Date), so the same code runs in the Edge Function and in
// test/analytics-top-videos-collect.js.
//
// Rules kept exactly as n8n has them, including the odd ones:
//   - dates are UTC; "week" is the last 7 days, "month" the last 30;
//   - Instagram views are videoPlayCount, else playCount, else videoViewCount;
//   - YouTube is the 20 most viewed SHORTS of the last 30 days (the search asks for
//     short videos only), its "month" list is all of them;
//   - a platform with no post in the last 7 days writes ONE row, rank 0, caption
//     "No new posts in the last 7 days", zeros everywhere;
//   - a platform whose provider call failed writes NO rows (n8n takes its error
//     output), while a provider answer that carries no usable post writes the
//     "no new posts" row;
//   - a client with NO Instagram configured still gets the Instagram "no new posts"
//     row (n8n's Instagram branch runs with nothing in it; measured on the live
//     table 2026-10-06: every active client without Instagram has that row from
//     n8n). TikTok and YouTube write nothing when not configured;
//   - captions are cut at 200 characters, then runs of whitespace become one space.

export const EMPTY_CAPTION = 'No new posts in the last 7 days';
const DAY_MS = 86400 * 1000;

export function configured(value) {
  const normalized = String(value ?? '').trim();
  return Boolean(normalized && normalized.toUpperCase() !== 'N/A');
}

// ---- keep only the fields the rules read (a reel or video carries megabytes of text) ----
// The caption is cut here at the same 200 characters the rules cut it at.
/** @returns {Record<string, any>} */
function pick(o, keys) {
  /** @type {Record<string, any>} */
  const r = {};
  for (const k of keys) if (o?.[k] !== undefined) r[k] = o[k];
  return r;
}
const cut = v => String(v || '').substring(0, 200);

/** @returns {Record<string, any>} */
export function slimReel(o) {
  o = o ?? {};
  const r = pick(o, ['id', 'shortCode', 'url', 'webVideoUrl', 'videoPlayCount', 'playCount', 'videoViewCount', 'likesCount',
    'commentsCount', 'sharesCount', 'shareCount', 'taken_at', 'timestamp', 'date']);
  r.caption = cut(o.caption || o.text);
  return r;
}

/** @returns {Record<string, any>} */
export function slimTikTok(o) {
  o = o ?? {};
  const r = pick(o, ['id', 'webVideoUrl', 'playCount', 'diggCount', 'commentCount', 'shareCount', 'createTime', 'createTimestamp']);
  r.text = cut(o.text);
  return r;
}

export function slimVideo(o) {
  o = o ?? {};
  return {
    id: o.id,
    snippet: { publishedAt: o.snippet?.publishedAt, title: cut(o.snippet?.title) },
    statistics: pick(o.statistics ?? {}, ['viewCount', 'likeCount', 'commentCount']),
  };
}

const day = now => now.toISOString().split('T')[0];

function emptyWeekRow(clientName, platform, now) {
  return { scraped_date: day(now), client_name: clientName, platform, period: 'week', rank: 0, caption: EMPTY_CAPTION,
    thumbnail_url: '', video_url: '', views: 0, likes: 0, comments: 0, shares: 0 };
}

// "Process Instagram Top Videos". items: the reel scraper's items.
export function processInstagram(items, clientName, now) {
  const oneWeekAgo = new Date(now - 7 * DAY_MS);
  const oneMonthAgo = new Date(now - 30 * DAY_MS);
  function parseDate(p) {
    const ts = p.taken_at || p.timestamp || p.date;
    if (!ts) return new Date(0);
    let d;
    if (typeof ts === 'number') d = ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
    else d = new Date(ts);
    if (isNaN(d.getTime()) || d < new Date('2015-01-01') || d > new Date(now.getTime() + 86400000)) return new Date(0);
    return d;
  }
  const withDates = items
    .filter(p => p.id || p.shortCode || p.url)
    .map(p => ({ ...p, _date: parseDate(p), _views: p.videoPlayCount || p.playCount || p.videoViewCount || 0 }));
  const weekPosts = withDates.filter(p => p._date.getTime() > 0 && p._date >= oneWeekAgo);
  const monthPosts = withDates.filter(p => p._date.getTime() > 0 && p._date >= oneMonthAgo);
  const byViews = (a, b) => b._views - a._views;
  const top3Week = [...weekPosts].sort(byViews).slice(0, 3);
  const top5Month = [...monthPosts].sort(byViews).slice(0, 5);
  const toRow = (p, period, rank) => ({
    scraped_date: day(now), client_name: clientName, platform: 'instagram', period, rank,
    caption: (p.caption || p.text || '').substring(0, 200),
    thumbnail_url: '', video_url: p.url || p.webVideoUrl || '',
    views: p._views, likes: p.likesCount || 0,
    comments: p.commentsCount || 0, shares: p.sharesCount || p.shareCount || 0,
  });
  const weekRows = top3Week.length > 0 ? top3Week.map((p, i) => toRow(p, 'week', i + 1)) : [emptyWeekRow(clientName, 'instagram', now)];
  return [...weekRows, ...top5Month.map((p, i) => toRow(p, 'month', i + 1))];
}

// "Process TikTok Top Videos". items: the profile scraper's dataset.
export function processTikTok(items, clientName, now) {
  const oneWeekAgo = new Date(now - 7 * DAY_MS);
  const oneMonthAgo = new Date(now - 30 * DAY_MS);
  const posts = items.filter(p => p.id);
  const withDates = posts.map(p => {
    const rawTime = p.createTime || p.createTimestamp || 0;
    let _date = new Date(0);
    if (rawTime) {
      _date = rawTime > 1e12 ? new Date(rawTime) : new Date(rawTime * 1000);
      if (isNaN(_date.getTime()) || _date < new Date('2015-01-01') || _date > new Date(now.getTime() + 86400000)) _date = new Date(0);
    }
    return { ...p, _date };
  });
  const weekPosts = withDates.filter(p => p._date.getTime() > 0 && p._date >= oneWeekAgo);
  const monthPosts = withDates.filter(p => p._date.getTime() > 0 && p._date >= oneMonthAgo);
  const byPlays = (a, b) => (b.playCount || 0) - (a.playCount || 0);
  const top3Week = [...weekPosts].sort(byPlays).slice(0, 3);
  const top5Month = [...monthPosts].sort(byPlays).slice(0, 5);
  const toRow = (p, period, rank) => ({
    scraped_date: day(now), client_name: clientName, platform: 'tiktok', period, rank,
    caption: (p.text || '').substring(0, 200),
    thumbnail_url: '', video_url: p.webVideoUrl || '',
    views: p.playCount || 0, likes: p.diggCount || 0,
    comments: p.commentCount || 0, shares: p.shareCount || 0,
  });
  const weekRows = top3Week.length > 0 ? top3Week.map((p, i) => toRow(p, 'week', i + 1)) : [emptyWeekRow(clientName, 'tiktok', now)];
  return [...weekRows, ...top5Month.map((p, i) => toRow(p, 'month', i + 1))];
}

// "Process YouTube Top Videos". videos: the items of videos?part=statistics,snippet.
export function processYouTube(videos, clientName, now) {
  const oneWeekAgo = new Date(now - 7 * DAY_MS);
  const withDates = videos.map(v => ({
    ...v,
    _date: new Date((v.snippet && v.snippet.publishedAt) || 0),
    _views: parseInt((v.statistics && v.statistics.viewCount) || 0),
  }));
  const weekPosts = withDates.filter(v => v._date >= oneWeekAgo);
  const byViews = (a, b) => b._views - a._views;
  const top3Week = [...weekPosts].sort(byViews).slice(0, 3);
  const top5Month = [...withDates].sort(byViews).slice(0, 5);
  const toRow = (v, period, rank) => ({
    scraped_date: day(now), client_name: clientName, platform: 'youtube', period, rank,
    caption: ((v.snippet && v.snippet.title) || '').substring(0, 200),
    thumbnail_url: '', video_url: 'https://www.youtube.com/watch?v=' + v.id,
    views: parseInt((v.statistics && v.statistics.viewCount) || 0),
    likes: parseInt((v.statistics && v.statistics.likeCount) || 0),
    comments: parseInt((v.statistics && v.statistics.commentCount) || 0), shares: 0,
  });
  const weekRows = top3Week.length > 0 ? top3Week.map((v, i) => toRow(v, 'week', i + 1)) : [emptyWeekRow(clientName, 'youtube', now)];
  return [...weekRows, ...top5Month.map((v, i) => toRow(v, 'month', i + 1))];
}

// "Unpack Rows": a client's rows, captions with whitespace collapsed; none at all means
// n8n writes nothing for the client.
export function unpackRows(rows, clientName) {
  const all = rows.filter(r => r.client_name === clientName);
  return all.map(r => ({ ...r, caption: (r.caption || '').replace(/\s+/g, ' ').trim() }));
}

// One client. Each source is undefined (platform not configured) or
// { failed: boolean, items: [...] }: failed = n8n would have taken the node's error
// output (the provider call itself failed), so that platform writes no rows.
// states: not_configured | provider_failed | success (rows written, which includes
// the "no new posts" row).
export function buildClientRows({ clientName, ig, tt, yt }, now) {
  const rows = [];
  const states = {};
  const run = (name, src, fn) => {
    if (!src) {
      states[name] = 'not_configured';
      if (name === 'instagram') rows.push(...fn([], clientName, now));
      return;
    }
    if (src.failed) { states[name] = 'provider_failed'; return; }
    states[name] = 'success';
    rows.push(...fn(src.items, clientName, now));
  };
  run('instagram', ig, processInstagram);
  run('tiktok', tt, processTikTok);
  run('youtube', yt, processYouTube);
  return { rows: unpackRows(rows, clientName), states };
}

// What the mirror stores for a row (the same text the real table holds: the value
// trimmed, empty as null, a number that JSON cannot carry as nothing).
const text = v => {
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  const t = String(v == null ? '' : v).trim();
  return t === '' ? null : t;
};
export function toShadowRecord(r) {
  return { scraped_date: text(r.scraped_date), client_name: text(r.client_name), platform: text(r.platform), period: text(r.period),
    rank: text(r.rank), caption: text(r.caption), video_url: text(r.video_url), views: text(r.views), likes: text(r.likes),
    comments: text(r.comments), shares: text(r.shares) };
}
