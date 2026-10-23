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
      return refuse(`The action ${JSON.stringify(action)} is not available. Use tiktok.search, youtube.search, reddit.search, reddit.subreddit, transcript or credits.`);
  }
}

export const ACTIONS = ["tiktok.search", "youtube.search", "reddit.search", "reddit.subreddit", "transcript", "credits"];

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
  const what = action === "transcript" ? (req.site || "video") : str(b.query || b.subreddit).slice(0, 80);
  return { tool: "scrapecreators." + action, summary: `${action}: ${what}` };
}
