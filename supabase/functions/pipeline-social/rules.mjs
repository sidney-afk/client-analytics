// What a filming pipeline pass may ask of ScrapeCreators through pipeline-social.
// Plain JavaScript with no Deno parts, so a unit test can run every rule offline.
//
// One action is one fixed ScrapeCreators endpoint with a short list of
// allowed settings (values checked against ScrapeCreators' own lists). Nothing
// the caller sends can choose a different endpoint, add a paid option (long
// transcription, AI transcription) or point the call at another host.
//
// Reads only. A call counts against a monthly cap (fp_settings key
// scrapecreators_monthly_calls); credits does not.

export const BASE = "https://api.scrapecreators.com";
export const CAP_KEY = "scrapecreators_monthly_calls";
export const CAP_DEFAULT = 2000;
export const CACHE_AGES = ["1d", "3d", "7d", "14d", "30d"];

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = (v, list) => (list.includes(str(v)) ? str(v) : "");
const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/;
const REGION_RE = /^[A-Za-z]{2}$/;
const LANG_RE = /^[A-Za-z]{2}(-[A-Za-z]{2})?$/;
const TIKTOK_HANDLE_RE = /^[A-Za-z0-9_.]{2,40}$/;
const YT_HANDLE_RE = /^[A-Za-z0-9_.-]{3,60}$/;
const YT_CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^[A-Za-z0-9_=.%~+/-]{1,2000}$/;

// The link of a video, by site. Only these hosts, https only, no credentials.
const SITES = [
  { site: "tiktok", hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"], path: "/v1/tiktok/video/transcript" },
  { site: "instagram", hosts: ["instagram.com"], path: "/v2/instagram/media/transcript" },
  { site: "youtube", hosts: ["youtube.com", "youtu.be", "m.youtube.com"], path: "/v1/youtube/video/transcript" },
];

export function videoSite(link) {
  let u;
  try { u = new URL(str(link)); } catch (_e) { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  return SITES.find((s) => s.hosts.includes(host)) || null;
}

const refuse = (error) => ({ ok: false, error });

function pick(b, spec) {
  const q = {};
  for (const [name, kind] of Object.entries(spec)) {
    if (b[name] === undefined || b[name] === null || b[name] === "") continue;
    let v = "";
    if (Array.isArray(kind)) {
      v = oneOf(b[name], kind);
      if (!v) return refuse(`${name} must be one of: ${kind.join(", ")}.`);
    } else if (kind === "region") {
      v = str(b[name]);
      if (!REGION_RE.test(v)) return refuse(`${name} must be a 2 letter country code.`);
    } else if (kind === "lang") {
      v = str(b[name]);
      if (!LANG_RE.test(v)) return refuse(`${name} must be a language code such as en.`);
    } else if (kind === "token") {
      v = str(b[name]);
      if (!TOKEN_RE.test(v)) return refuse(`${name} must be the value from the previous answer.`);
    }
    q[name] = v;
  }
  return { ok: true, q };
}

function query(b) {
  const v = str(b.query);
  if (!v) return refuse("Give query: the words to search for.");
  if (v.length > 200) return refuse("query is too long (200 characters at most).");
  return { ok: true, v };
}

function tiktokHandle(b) {
  const v = str(b.handle).replace(/^@/, "");
  return TIKTOK_HANDLE_RE.test(v) ? { ok: true, v } : refuse("Give handle: the TikTok account name without @, letters, numbers, dots and underscores.");
}

// A YouTube channel by handle (without @) or by its channel id (UC and 22 more characters).
function youtubeChannel(b) {
  const id = str(b.channelId);
  if (id) return YT_CHANNEL_RE.test(id) ? { ok: true, q: { channelId: id } } : refuse("channelId must be the channel id that starts with UC.");
  const v = str(b.handle).replace(/^@/, "");
  return YT_HANDLE_RE.test(v) ? { ok: true, q: { handle: v } } : refuse("Give handle (the channel name without @) or channelId.");
}

// The request for an action: { ok, path, query, counts } or a refusal.
// counts: false only for the credit balance.
export function buildRequest(action, body) {
  const b = isObj(body) ? body : {};
  switch (action) {
    case "tiktok.search": {
      const t = query(b); if (!t.ok) return t;
      const p = pick(b, { date_posted: ["yesterday", "this-week", "this-month", "last-3-months", "last-6-months", "all-time"],
        sort_by: ["relevance", "most-liked", "date-posted"], region: "region", cursor: "token" });
      if (!p.ok) return p;
      return { ok: true, path: "/v1/tiktok/search/keyword", query: { query: t.v, trim: "true", ...p.q }, counts: true };
    }
    case "youtube.search": {
      const t = query(b); if (!t.ok) return t;
      const p = pick(b, { type: ["videos", "shorts"], uploadDate: ["today", "this_week", "this_month", "this_year"],
        sortBy: ["relevance", "popular"], region: "region", continuationToken: "token" });
      if (!p.ok) return p;
      return { ok: true, path: "/v1/youtube/search", query: { query: t.v, type: "shorts", includeExtras: "true", ...p.q }, counts: true };
    }
    case "reddit.search": {
      const t = query(b); if (!t.ok) return t;
      const p = pick(b, { filter: ["posts", "comments"], sort: ["relevance", "new", "top", "comment_count"],
        timeframe: ["all", "day", "week", "month", "year"], after: "token" });
      if (!p.ok) return p;
      return { ok: true, path: "/v1/reddit/search", query: { query: t.v, trim: "true", ...p.q }, counts: true };
    }
    case "reddit.subreddit": {
      const name = str(b.subreddit).replace(/^\/?r\//i, "");
      if (!SUBREDDIT_RE.test(name)) return refuse("Give subreddit: the name without r/, letters, numbers and underscores.");
      const p = pick(b, { sort: ["best", "hot", "new", "top", "rising"], timeframe: ["all", "day", "week", "month", "year"],
        cache_max_age: CACHE_AGES, after: "token" });
      if (!p.ok) return p;
      return { ok: true, path: "/v1/reddit/subreddit", query: { subreddit: name, trim: "true", ...p.q }, counts: true };
    }
    case "tiktok.profile": {
      const h = tiktokHandle(b); if (!h.ok) return h;
      const p = pick(b, { cache_max_age: CACHE_AGES });
      if (!p.ok) return p;
      return { ok: true, path: "/v1/tiktok/profile", query: { handle: h.v, ...p.q }, counts: true };
    }
    case "tiktok.videos": {
      const h = tiktokHandle(b); if (!h.ok) return h;
      const p = pick(b, { sort_by: ["latest", "popular"], region: "region", max_cursor: "token" });
      if (!p.ok) return p;
      return { ok: true, path: "/v3/tiktok/profile/videos", query: { handle: h.v, trim: "true", ...p.q }, counts: true };
    }
    case "youtube.channel": {
      const c = youtubeChannel(b); if (!c.ok) return c;
      const p = pick(b, { cache_max_age: CACHE_AGES });
      if (!p.ok) return p;
      return { ok: true, path: "/v1/youtube/channel", query: { ...c.q, ...p.q }, counts: true };
    }
    case "youtube.channel_videos": {
      const c = youtubeChannel(b); if (!c.ok) return c;
      const kind = str(b.type) || "shorts";
      if (kind !== "videos" && kind !== "shorts") return refuse("type must be one of: videos, shorts.");
      const p = pick(b, { sort: kind === "shorts" ? ["newest", "popular"] : ["latest", "popular"], continuationToken: "token" });
      if (!p.ok) return p;
      return kind === "shorts"
        ? { ok: true, path: "/v1/youtube/channel/shorts", query: { ...c.q, ...p.q }, counts: true }
        : { ok: true, path: "/v1/youtube/channel-videos", query: { ...c.q, includeExtras: "true", ...p.q }, counts: true };
    }
    case "youtube.video": {
      const site = videoSite(b.url);
      if (!site || site.site !== "youtube") return refuse("Give url: the https link of a YouTube video or Short.");
      const p = pick(b, { cache_max_age: CACHE_AGES });
      if (!p.ok) return p;
      return { ok: true, path: "/v1/youtube/video", query: { url: str(b.url), ...p.q }, counts: true };
    }
    case "transcript": {
      const site = videoSite(b.url);
      if (!site) return refuse("Give url: the https link of a TikTok, Instagram or YouTube video.");
      const p = pick(b, site.site === "instagram" ? { cache_max_age: CACHE_AGES }
        : site.site === "youtube" ? { language: "lang", cache_max_age: CACHE_AGES } : { language: "lang" });
      if (!p.ok) return p;
      return { ok: true, path: site.path, query: { url: str(b.url), ...p.q }, counts: true, site: site.site };
    }
    case "credits":
      return { ok: true, path: "/v1/account/credit-balance", query: {}, counts: false };
    default:
      return refuse(`The action ${JSON.stringify(action)} is not available. Use tiktok.search, tiktok.profile, tiktok.videos, youtube.search, youtube.channel, youtube.channel_videos, youtube.video, reddit.search, reddit.subreddit, transcript or credits.`);
  }
}

export const ACTIONS = ["tiktok.search", "tiktok.profile", "tiktok.videos", "youtube.search", "youtube.channel", "youtube.channel_videos", "youtube.video", "reddit.search", "reddit.subreddit", "transcript", "credits"];

// The monthly cap from the setting (a number, or text of one); a bad value is the default.
export function capFrom(value) {
  if (value === null || value === undefined || value === "") return CAP_DEFAULT;
  const n = Number(typeof value === "string" ? value.trim().replace(/^"|"$/g, "") : value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : CAP_DEFAULT;
}

// First instant of this month, UTC, as ISO text (the cap counts calls since then).
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// The line logged for a call: the tool name, and a summary with the search
// words or the link host, never the key.
export function logLine(action, req, body) {
  const b = isObj(body) ? body : {};
  const what = action === "transcript" ? (req.site || "video") : str(b.query || b.subreddit || b.handle || b.channelId).slice(0, 80);
  return { tool: "scrapecreators." + action, summary: `${action}: ${what}` };
}

const num = (v) => (typeof v === "number" ? v : null);

// One TikTok video, cut down to the words, link, date, counts (views included) and poster.
function slimTiktokVideo(it) {
  const x = isObj(it) ? it : {};
  const st = isObj(x.statistics) ? x.statistics : {};
  const au = isObj(x.author) ? x.author : {};
  const vi = isObj(x.video) ? x.video : {};
  return {
    aweme_id: x.aweme_id, url: x.url, desc: x.desc, region: x.region, create_time_utc: x.create_time_utc, is_ad: x.is_ad,
    duration_ms: num(vi.duration),
    statistics: { play_count: num(st.play_count), digg_count: num(st.digg_count), comment_count: num(st.comment_count),
      share_count: num(st.share_count), collect_count: num(st.collect_count) },
    author: { unique_id: au.unique_id, nickname: au.nickname, follower_count: num(au.follower_count) },
  };
}

// TikTok answers about 45 KB per video (every video address, avatar and ad
// field), over a megabyte for a page. The pipeline needs the words, the link,
// the date, the counts (views included) and who posted it. The account and
// video-detail answers are cut to the fields the pipeline reads.
export function slimResult(action, result) {
  if (!isObj(result)) return result;
  if (action === "tiktok.search" && Array.isArray(result.search_item_list)) {
    const { search_item_list: items, ...rest } = result;
    return { ...rest, search_item_list: items.map(slimTiktokVideo) };
  }
  if (action === "tiktok.videos" && Array.isArray(result.aweme_list)) {
    const { aweme_list: items, ...rest } = result;
    return { ...rest, aweme_list: items.map(slimTiktokVideo) };
  }
  if (action === "tiktok.profile" && isObj(result.user)) {
    const u = result.user;
    const keep = (o, keys) => Object.fromEntries(keys.map((k) => [k, isObj(o) ? o[k] : undefined]));
    const { user: _u, stats, statsV2, ...rest } = result;
    return {
      ...rest,
      user: keep(u, ["id", "uniqueId", "nickname", "signature", "verified", "createTime", "privateAccount"]),
      stats: keep(stats, ["followerCount", "followingCount", "heartCount", "videoCount", "diggCount", "friendCount"]),
      statsV2: keep(statsV2, ["followerCount", "followingCount", "heartCount", "videoCount", "diggCount", "friendCount"]),
    };
  }
  if (action === "youtube.video") {
    const { watchNextVideos: _w, descriptionLinks: _d, chapters: _c, ...rest } = result;
    return rest;
  }
  if (action === "youtube.channel") {
    const { avatar: _a, banner: _b, ...rest } = result;
    return rest;
  }
  return result;
}
