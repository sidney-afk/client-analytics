// analytics-weekly-posts — step 2 of the weekly client analytics snapshot: the posts of the past
// 7 days per client and platform (views, likes, comments, shares, url, caption, posted_at) into
// analytics_weekly_top_posts, and the client's weekly message built from them into
// analytics_weekly_messages. It NEVER posts to Slack; posting is a later step.
//
// Sources, same as step 1 (analytics-weekly-followers): Scrape Creators for Instagram and TikTok
// (secret SCRAPECREATORS_API_KEY); YouTube Data API for YouTube (secret YOUTUBE_API_KEY) with
// Scrape Creators as the fallback when the API is refused or down. Secrets are checked by name
// only and never printed. About one call per platform per client (YouTube: the uploads list plus
// one statistics read when a video fell in the window).
//
// The window is the 7 days before this week's Monday (UTC): [week_of - 7d, week_of). Followers in
// the message are this Monday's count minus last Monday's, read from analytics_weekly_snapshot
// (step 1 runs 05:00-07:59, this runs 08:00-09:59). A platform that failed is left out of the
// totals and is not mentioned in the client text; its status is recorded for staff in
// analytics_weekly_messages.platform_status. Same queue, claim and lease pattern as step 1.
//
// Actions (POST, header x-analytics-collect-key = the secret ANALYTICS_COLLECT_KEY, at least 32
// characters, the same key the daily collectors use; not browser callable):
//   tick    the cron call.
//   run     {"action":"run","slugs":["<slug>", ...]} up to 3 named clients, processed inside this call.
//   status  counts for this week: messages built, platform statuses, queue states. No text, no names.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import { configured, TRANSIENT, weekOf } from "../_shared/analytics-weekly-followers.mjs";
import { buildMessage, firstNameOf, inWindow, MAX_POSTS, PLATFORMS, readPostsScrapeCreators, readYoutubeUploads, readYoutubeVideos, windowOf } from "../_shared/analytics-weekly-posts.mjs";

type JsonMap = Record<string, unknown>;
type Post = { url: string; title: string | null; views: number | null; likes: number | null; comments: number | null; shares: number | null; posted_at: string };
type Win = { start: string; end: string };
type Read = { posts?: Post[]; error_class?: string };
type Stage = { done: true; status: "ok" | "failed" | "not_configured"; posts: Post[]; error_class: string | null; source: string | null } | { done: false; last_class?: string };

const SC = "https://api.scrapecreators.com";
const MAX_ATTEMPTS = 3;
const FETCH_MS = Number(Deno.env.get("ANALYTICS_WEEKLY_FETCH_MS")) || 20_000;

const clean = (v: unknown) => String(v == null ? "" : v).trim();
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function requireKey(req: Request): boolean {
  const secret = Deno.env.get("ANALYTICS_COLLECT_KEY") || "";
  const given = clean(req.headers.get("x-analytics-collect-key"));
  return secret.length >= 32 && !!given && timingSafeEqual(given, secret);
}

// One provider call: never throws, never returns the URL or key.
async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown; net?: string }> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_MS) });
    let body: unknown = null;
    try { body = await res.json(); } catch (_e) { /* non-JSON answer */ }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, net: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error" };
  }
}

const hasSc = () => (Deno.env.get("SCRAPECREATORS_API_KEY") || "").length > 0;
const hasYt = () => (Deno.env.get("YOUTUBE_API_KEY") || "").length > 0;

async function scrapeCreators(platform: string, id: string): Promise<Read> {
  const key = Deno.env.get("SCRAPECREATORS_API_KEY") || "";
  const handle = encodeURIComponent(id.replace(/^@/, ""));
  const path = platform === "instagram" ? `/v2/instagram/user/posts?handle=${handle}`
    : platform === "tiktok" ? `/v3/tiktok/profile/videos?handle=${handle}&sort_by=latest`
    : `/v1/youtube/channel-videos?channelId=${encodeURIComponent(id)}`;
  const res = await get(`${SC}${path}`, { "x-api-key": key });
  if (res.net) return { error_class: res.net };
  return readPostsScrapeCreators(platform, res.status, res.body) as Read;
}

async function youtubeApi(id: string, win: Win): Promise<Read> {
  const key = encodeURIComponent(Deno.env.get("YOUTUBE_API_KEY") || "");
  // A channel id "UC..." has its uploads in the playlist "UU...".
  if (!/^UC[\w-]+$/.test(id)) return { error_class: "not_found" };
  const list = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent("UU" + id.slice(2))}&key=${key}`);
  if (list.net) return { error_class: list.net };
  const u = readYoutubeUploads(list.status, list.body, win) as { ids?: string[]; error_class?: string };
  if (u.error_class) return { error_class: u.error_class };
  if (!u.ids || !u.ids.length) return { posts: [] };
  const vids = await get(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${u.ids.slice(0, 50).map(encodeURIComponent).join(",")}&key=${key}`);
  if (vids.net) return { error_class: vids.net };
  return readYoutubeVideos(vids.status, vids.body) as Read;
}

const notConfigured = (): Stage => ({ done: true, status: "not_configured", posts: [], error_class: "secret_missing", source: null });

async function readPlatform(platform: string, id: string, win: Win, last: boolean): Promise<Stage> {
  let source = "scrapecreators";
  let r: Read;
  if (platform === "youtube") {
    if (!hasYt() && !hasSc()) return notConfigured();
    if (hasYt()) {
      source = "youtube_data_api";
      r = await youtubeApi(id, win);
      if (r.error_class && !["not_found", "hidden_count"].includes(r.error_class) && hasSc()) {
        source = "scrapecreators";
        r = await scrapeCreators("youtube", id);
      }
    } else r = await scrapeCreators("youtube", id);
  } else {
    if (!hasSc()) return notConfigured();
    r = await scrapeCreators(platform, id);
  }
  if (r.posts) {
    const kept = (inWindow(r.posts, win) as Post[]).sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, MAX_POSTS);
    return { done: true, status: "ok", posts: kept, error_class: null, source };
  }
  const cls = r.error_class || "provider_error";
  if (TRANSIENT.has(cls) && !last) return { done: false, last_class: cls };
  return { done: true, status: "failed", posts: [], error_class: cls, source };
}

type QueueRow = { week_of: string; client_slug: string; attempts: number; stages: Record<string, Stage> | null };

async function followersOf(db: SupabaseClient, slug: string, week: string): Promise<{ this: Record<string, number>; last: Record<string, number> }> {
  const lastWeek = new Date(Date.parse(`${week}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db.from("analytics_weekly_snapshot").select("platform,week_of,followers,status").eq("client_slug", slug).in("week_of", [week, lastWeek]);
  if (error) throw error;
  const out = { this: {} as Record<string, number>, last: {} as Record<string, number> };
  for (const r of (data || []) as JsonMap[]) {
    if (r.status !== "ok" || typeof r.followers !== "number") continue;
    (r.week_of === week ? out.this : out.last)[r.platform as string] = r.followers;
  }
  return out;
}

async function processClient(db: SupabaseClient, q: QueueRow): Promise<string> {
  const { data: p, error: pe } = await db.from("client_profiles").select("display_name,instagram_handle,tiktok_handle,youtube_channel_id").eq("slug", q.client_slug).maybeSingle();
  if (pe) throw pe;
  if (!p) throw new Error("client_profile_missing");
  const ids: Record<string, string> = { instagram: clean(p.instagram_handle), tiktok: clean(p.tiktok_handle), youtube: clean(p.youtube_channel_id) };
  const win = windowOf(q.week_of) as Win;
  const last = q.attempts >= MAX_ATTEMPTS;
  const stages: Record<string, Stage> = { ...(q.stages || {}) };
  await Promise.all(PLATFORMS.map(async (pf: string) => {
    if (!configured(ids[pf])) { delete stages[pf]; return; } // not on this platform: no row, no mention
    if (stages[pf]?.done) return; // answered on an earlier tick
    stages[pf] = await readPlatform(pf, ids[pf], win, last);
  }));
  if (Object.values(stages).some((s) => !s.done)) {
    const { error } = await db.from("analytics_weekly_posts_queue").update({ stages, state: "running", lease_until: null, updated_at: new Date().toISOString() })
      .eq("week_of", q.week_of).eq("client_slug", q.client_slug);
    if (error) throw error;
    return "waiting";
  }
  const done = Object.entries(stages) as [string, Extract<Stage, { done: true }>][];
  const platforms: Record<string, { status: string; posts: Post[] }> = {};
  for (const [pf, s] of done) platforms[pf] = { status: s.status === "ok" ? "ok" : "failed", posts: s.posts };
  const text = buildMessage({ firstName: firstNameOf(p.display_name) || "Hi", weekOf: q.week_of, platforms, followers: await followersOf(db, q.client_slug, q.week_of) }) as string | null;
  const rows = done.map(([platform, s]) => ({ platform, status: s.status, error_class: s.error_class, source: s.source, posts: s.status === "ok" ? s.posts : [] }));
  const platformStatus = Object.fromEntries(done.map(([pf, s]) => [pf, s.status === "ok" ? "ok" : `${s.status}:${s.error_class}`]));
  const { error } = await db.rpc("analytics_weekly_posts_commit", { p_week_of: q.week_of, p_client_slug: q.client_slug, p_platforms: rows, p_text: text, p_platform_status: platformStatus });
  if (error) throw error;
  return "done";
}

async function seed(db: SupabaseClient, week: string, slugs: string[] | null): Promise<void> {
  let cq = db.from("clients").select("slug,kind,active");
  cq = slugs ? cq.in("slug", slugs).in("kind", ["client", "test"]) : cq.eq("kind", "client").eq("active", true);
  const { data, error } = await cq;
  if (error) throw error;
  const rows = (data || []).map((c: JsonMap) => ({ week_of: week, client_slug: c.slug as string }));
  if (!rows.length) return;
  if (slugs) {
    // Manual run: a finished client starts over, an unfinished one resumes (same rule as step 1).
    const { data: have, error: he } = await db.from("analytics_weekly_posts_queue").select("client_slug,state").eq("week_of", week).in("client_slug", slugs);
    if (he) throw he;
    const open = new Set(((have || []) as JsonMap[]).filter((r) => r.state !== "done").map((r) => r.client_slug as string));
    const fresh = rows.filter((r) => !open.has(r.client_slug)).map((r) => ({ ...r, state: "pending", attempts: 0, stages: {}, lease_until: null }));
    if (fresh.length) {
      const { error: ue } = await db.from("analytics_weekly_posts_queue").upsert(fresh, { onConflict: "week_of,client_slug" });
      if (ue) throw ue;
    }
    return;
  }
  const { error: se } = await db.from("analytics_weekly_posts_queue").upsert(rows, { onConflict: "week_of,client_slug", ignoreDuplicates: true });
  if (se) throw se;
}

async function work(db: SupabaseClient, week: string, limit: number, slugs: string[] | null): Promise<JsonMap> {
  const { data: claimed, error } = await db.rpc("analytics_weekly_posts_claim", { p_week_of: week, p_limit: limit, p_lease_seconds: 120, p_max_attempts: MAX_ATTEMPTS, p_slugs: slugs });
  if (error) throw error;
  const results: Record<string, number> = {};
  const bump = (k: string) => { results[k] = (results[k] || 0) + 1; };
  await Promise.all(((claimed || []) as QueueRow[]).map(async (q) => {
    try { bump(await processClient(db, q)); } catch (e) {
      bump("error");
      // Never log slugs, handles or payloads: the error text only. An internal error is not the
      // providers' fault, so the attempt is given back.
      console.error("weekly posts client failed", e instanceof Error ? e.message : String(e));
      await db.from("analytics_weekly_posts_queue").update({ attempts: Math.max(0, q.attempts - 1), last_error: (e instanceof Error ? e.message : String(e)).slice(0, 200), lease_until: null, updated_at: new Date().toISOString() })
        .eq("week_of", q.week_of).eq("client_slug", q.client_slug);
    }
  }));
  return { ok: true, week_of: week, claimed: (claimed || []).length, results };
}

async function status(db: SupabaseClient, week: string): Promise<JsonMap> {
  const { data: msgs, error } = await db.from("analytics_weekly_messages").select("text,platform_status").eq("week_of", week);
  if (error) throw error;
  const { data: qs, error: qe } = await db.from("analytics_weekly_posts_queue").select("state").eq("week_of", week);
  if (qe) throw qe;
  const tally = (rows: JsonMap[], f: (r: JsonMap) => string[]) => rows.reduce((m: Record<string, number>, r) => { for (const k of f(r)) m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    ok: true, week_of: week,
    messages: { built: ((msgs || []) as JsonMap[]).filter((m) => m.text).length, not_built: ((msgs || []) as JsonMap[]).filter((m) => !m.text).length },
    platforms: tally((msgs || []) as JsonMap[], (r) => Object.entries((r.platform_status || {}) as Record<string, string>).map(([pf, s]) => `${pf}:${s}`)),
    queue: tally((qs || []) as JsonMap[], (r) => [String(r.state)]),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!requireKey(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);
  try {
    let body: JsonMap = {};
    try { const raw = await req.text(); body = raw ? JSON.parse(raw) as JsonMap : {}; } catch (_e) { return json({ ok: false, error: "bad_json" }, 400); }
    const action = clean(body.action) || "tick";
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const week = weekOf();
    if (action === "status") return json(await status(db, week));
    if (action === "tick") {
      await seed(db, week, null);
      return json(await work(db, week, 1, null));
    }
    if (action === "run") {
      const slugs = Array.isArray(body.slugs) ? (body.slugs as unknown[]).map(clean).filter(Boolean) : [];
      if (!slugs.length || slugs.length > 3 || slugs.some((s) => !/^[a-z0-9&]+$/.test(s))) return json({ ok: false, error: "slugs_1_to_3_required" }, 400);
      await seed(db, week, slugs);
      return json(await work(db, week, slugs.length, slugs));
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("analytics-weekly-posts failed", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "weekly_posts_failed" }, 500);
  }
});
