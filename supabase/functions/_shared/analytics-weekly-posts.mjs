// Pure rules for analytics-weekly-posts (no I/O, tested offline): reading the providers' post
// lists, and building the weekly client message. A number in the message is a number a provider
// returned; nothing here guesses one.
import { classifyHttp, PLATFORMS } from "./analytics-weekly-followers.mjs";

export { PLATFORMS };
export const MAX_POSTS = 50;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

const at = (o, path) => path.reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);
const count = (n) => {
  if (typeof n === "number") return Number.isInteger(n) && n >= 0 ? n : null;
  if (typeof n === "string" && /^\d{1,15}$/.test(n.trim())) return Number(n.trim());
  return null;
};
const firstCount = (...vals) => { for (const v of vals) { const c = count(v); if (c !== null) return c; } return null; };
const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const iso = (v) => {
  if (typeof v === "number" && v > 0) return new Date(v * (v < 1e11 ? 1000 : 1)).toISOString();
  if (typeof v === "string" && v.trim()) { const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toISOString(); }
  return null;
};

// The window of week_of (a Monday): the 7 days before it, [week_of - 7d, week_of) in UTC.
export function windowOf(weekOf) {
  const end = Date.parse(`${weekOf}T00:00:00Z`);
  return { start: new Date(end - 7 * DAY).toISOString(), end: new Date(end).toISOString() };
}
export function inWindow(posts, win) {
  return posts.filter((p) => p.posted_at && p.posted_at >= win.start && p.posted_at < win.end);
}

function post(url, title, views, likes, comments, shares, posted) {
  return { url, title: title || null, views, likes, comments, shares, posted_at: posted };
}

// Scrape Creators user posts / profile videos / channel videos -> { posts } or { error_class }.
// Posts are whatever the page held; the caller keeps only the window.
export function readPostsScrapeCreators(platform, status, body) {
  if (status >= 400) return { error_class: classifyHttp(status) };
  if (!body || typeof body !== "object") return { error_class: "unexpected_shape" };
  const out = [];
  if (platform === "instagram") {
    const items = Array.isArray(body.items) ? body.items : at(body, ["data", "items"]);
    if (!Array.isArray(items)) return { error_class: body.success === false ? "not_found" : "unexpected_shape" };
    for (const it of items) {
      const code = text(it?.code);
      const posted = iso(it?.taken_at);
      if (!code || !posted) continue;
      const cap = typeof it.caption === "string" ? it.caption : it.caption?.text;
      out.push(post(`https://www.instagram.com/p/${encodeURIComponent(code)}/`, cap, firstCount(it.play_count, it.view_count, it.video_view_count, it.ig_play_count),
        count(it.like_count), count(it.comment_count), null, posted));
    }
  } else if (platform === "tiktok") {
    const items = Array.isArray(body.aweme_list) ? body.aweme_list : null;
    if (!items) return { error_class: body.success === false ? "not_found" : "unexpected_shape" };
    for (const it of items) {
      const posted = iso(it?.create_time);
      const url = text(it?.share_url).replace(/\?.*$/, "");
      if (!url || !posted) continue;
      const s = it.statistics || {};
      out.push(post(url, it.desc, count(s.play_count), count(s.digg_count), count(s.comment_count), count(s.share_count), posted));
    }
  } else if (platform === "youtube") {
    const items = Array.isArray(body.videos) ? body.videos : null;
    if (!items) return { error_class: body.success === false ? "not_found" : "unexpected_shape" };
    for (const it of items) {
      const posted = iso(it?.publishedTime ?? it?.publishedAt ?? it?.publishDate);
      const url = text(it?.url) || (text(it?.id) ? `https://www.youtube.com/watch?v=${encodeURIComponent(text(it.id))}` : "");
      if (!url || !posted) continue;
      out.push(post(url, it.title, firstCount(it.viewCountInt, it.viewCount, it.views), count(it.likeCountInt ?? it.likeCount), count(it.commentCountInt ?? it.commentCount), null, posted));
    }
  } else return { error_class: "unexpected_shape" };
  return { posts: out };
}

// YouTube Data API: playlistItems on the channel's uploads playlist -> the videos in the window.
export function readYoutubeUploads(status, body, win) {
  if (status >= 400) {
    const reason = String(at(body, ["error", "errors", 0, "reason"]) || "");
    if (status === 403 && /quota|rateLimit/i.test(reason)) return { error_class: "rate_limited" };
    return { error_class: classifyHttp(status) };
  }
  const items = at(body, ["items"]);
  if (!Array.isArray(items)) return { error_class: "unexpected_shape" };
  const ids = [];
  for (const it of items) {
    const id = text(it?.contentDetails?.videoId);
    const posted = iso(it?.contentDetails?.videoPublishedAt ?? it?.snippet?.publishedAt);
    if (id && posted && posted >= win.start && posted < win.end) ids.push(id);
  }
  return { ids };
}
// YouTube Data API: videos?part=statistics,snippet -> posts.
export function readYoutubeVideos(status, body) {
  if (status >= 400) {
    const reason = String(at(body, ["error", "errors", 0, "reason"]) || "");
    if (status === 403 && /quota|rateLimit/i.test(reason)) return { error_class: "rate_limited" };
    return { error_class: classifyHttp(status) };
  }
  const items = at(body, ["items"]);
  if (!Array.isArray(items)) return { error_class: "unexpected_shape" };
  const out = [];
  for (const it of items) {
    const id = text(it?.id);
    const posted = iso(it?.snippet?.publishedAt);
    if (!id || !posted) continue;
    const s = it.statistics || {};
    out.push(post(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, it.snippet?.title, count(s.viewCount), count(s.likeCount), count(s.commentCount), null, posted));
  }
  return { posts: out };
}

const num = (n) => Number(n).toLocaleString("en-US");
const plural = (n, one) => `${num(n)} ${one}${n === 1 ? "" : "s"}`;
const md = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

// First line of the caption (or the title), no quote marks, at most 80 characters.
export function hook(title) {
  const first = String(title ?? "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).find(Boolean) || "";
  const t = first.replace(/["“”]/g, "'");
  return t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t;
}

// The top post: most views across all platforms. A tie goes to more comments, then the earlier post,
// then the url, so the same week always names the same post.
export function pickTopPost(posts) {
  const withViews = posts.filter((p) => p.views !== null && p.views !== undefined);
  withViews.sort((a, b) => b.views - a.views || (b.comments ?? -1) - (a.comments ?? -1)
    || String(a.posted_at).localeCompare(String(b.posted_at)) || String(a.url).localeCompare(String(b.url)));
  return withViews[0] || null;
}

// platforms: { instagram: { status: 'ok' | 'failed', posts: [...] }, ... } for the platforms on file.
// followers: { this: { pf: n }, last: { pf: n } } from the snapshot (ok rows only).
// -> the client text, or null when no platform could be read (nothing true to say).
export function buildMessage({ firstName, weekOf, platforms, followers }) {
  const ok = PLATFORMS.filter((p) => platforms[p]?.status === "ok");
  if (!ok.length) return null;
  const end = new Date(`${weekOf}T00:00:00Z`);
  const start = new Date(end.getTime() - 7 * DAY);
  const lines = [`${firstName}, here's your week on social (${md(start)} to ${md(end)})`];

  // Followers: this Monday minus last Monday, only where both are real counts.
  const parts = [];
  let total = 0;
  for (const p of PLATFORMS) {
    if (platforms[p]?.status !== "ok") continue; // a failed platform is left out of every total
    const a = followers?.this?.[p], b = followers?.last?.[p];
    if (typeof a !== "number" || typeof b !== "number") continue;
    const d = a - b;
    total += d;
    parts.push(`${p === "instagram" ? "Instagram" : p === "tiktok" ? "TikTok" : "YouTube"} ${d < 0 ? "-" : "+"}${num(Math.abs(d))}`);
  }
  const sign = (d) => `${d < 0 ? "-" : "+"}${num(Math.abs(d))}`;
  if (parts.length) lines.push(`New followers: ${sign(total)} (${parts.join(" · ")})`);

  const posts = ok.flatMap((p) => platforms[p].posts || []);
  lines.push(`Views: ${num(posts.reduce((s, x) => s + (x.views || 0), 0))}`);
  const top = pickTopPost(posts);
  if (top) {
    const h = hook(top.title);
    const tail = top.comments !== null && top.comments !== undefined ? ` · ${plural(top.comments, "comment")}` : "";
    lines.push(`Top post: ${h ? `"${h}" ` : ""}${plural(top.views, "view")}${tail}`);
    lines.push(top.url);
  }
  return lines.join("\n");
}

export function firstNameOf(displayName) {
  return String(displayName ?? "").trim().split(/\s+/)[0] || "";
}
