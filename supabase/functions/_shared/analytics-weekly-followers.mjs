// Pure rules for analytics-weekly-followers (no I/O, tested offline).
// A follower count is a number the provider actually returned, or the platform is
// recorded "failed" with a class. Nothing here ever guesses a number.

export const PLATFORMS = ["instagram", "tiktok", "youtube"];
// Classes that may succeed on a later tick; every other class is final for the week.
export const TRANSIENT = new Set(["rate_limited", "timeout", "provider_error", "network_error"]);

export function configured(value) {
  const v = String(value ?? "").trim();
  return Boolean(v && v.toUpperCase() !== "N/A");
}

// Monday (UTC) of the week a date falls in, as YYYY-MM-DD.
export function weekOf(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const isCount = (n) => typeof n === "number" ? Number.isInteger(n) && n >= 0 : typeof n === "string" && /^\d{1,15}$/.test(n.trim());
const toCount = (n) => Number(typeof n === "string" ? n.trim() : n);
const at = (o, path) => path.reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);

export function classifyHttp(status) {
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 402 || status === 403) return "provider_refused";
  if (status >= 500) return "provider_error";
  return "provider_error";
}

// -> { followers } or { error_class }
export function readScrapeCreators(platform, status, body) {
  if (status >= 400) return { error_class: classifyHttp(status) };
  if (!body || typeof body !== "object") return { error_class: "unexpected_shape" };
  if (platform === "instagram") {
    const user = at(body, ["data", "user"]);
    if (!user) return { error_class: body.success === false ? "not_found" : "unexpected_shape" };
    if (user.is_private === true) return { error_class: "private_profile" };
    const n = at(user, ["edge_followed_by", "count"]);
    return isCount(n) ? { followers: toCount(n) } : { error_class: "unexpected_shape" };
  }
  if (platform === "tiktok") {
    if (!body.user) return { error_class: body.success === false ? "not_found" : "unexpected_shape" };
    if (body.user.privateAccount === true) return { error_class: "private_profile" };
    const n = at(body, ["stats", "followerCount"]);
    return isCount(n) ? { followers: toCount(n) } : { error_class: "unexpected_shape" };
  }
  if (platform === "youtube") {
    const n = body.subscriberCount;
    if (isCount(n)) return { followers: toCount(n) };
    return { error_class: body.success === false ? "not_found" : "unexpected_shape" };
  }
  return { error_class: "unexpected_shape" };
}

// YouTube Data API v3 channels?part=statistics
export function readYoutubeApi(status, body) {
  if (status >= 400) {
    const reason = String(at(body, ["error", "errors", 0, "reason"]) || "");
    if (status === 403 && /quota|rateLimit/i.test(reason)) return { error_class: "rate_limited" };
    return { error_class: classifyHttp(status) };
  }
  const item = at(body, ["items", 0]);
  if (!item) return { error_class: "not_found" };
  const s = item.statistics || {};
  if (s.hiddenSubscriberCount === true) return { error_class: "hidden_count" };
  return isCount(s.subscriberCount) ? { followers: toCount(s.subscriberCount) } : { error_class: "unexpected_shape" };
}
