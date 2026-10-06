// analytics-metrics-collect — the daily metrics job (n8n "CLIENTS METRICS") run
// by our own Edge Function (docs/plans/2026-10-01-n8n-off-analytics.md).
//
// Two modes besides off (switch row analytics_metrics_collect):
//   shadow  scrapes the same sources and applies the same rules as n8n, but writes
//           only to analytics_metrics_shadow and to its own post-tracking state. It
//           never touches analytics_metrics (what the pages read) and never touches a
//           Sheet. Compared with n8n daily by analytics_metrics_shadow_compare().
//   live    (plan section 8b) does everything shadow does AND, in the same database
//           transaction, writes the day's row into analytics_metrics with source "edge".
//           The row is prepared exactly as analytics-write prepares one (slug rule, date
//           check, fingerprint; _shared/analytics-collect-live.mjs). One row per client
//           per day, FIRST WRITER WINS: if analytics_metrics already holds a row for that
//           client and date (n8n's, on the switch-over day), nothing is added. A retry or
//           a second tick never adds a second row. It never touches a Sheet.
//
// How a day runs: pg_cron calls this function every minute from 04:00 to 08:59
// UTC (action "tick"). Each tick seeds today's queue (one row per active
// client), claims `batch` clients (default 1) that nobody holds, works on their
// sources until a time budget is spent, and keeps what it learned in the queue
// row. A scraper still running when the budget ends is picked up by the next
// tick (the Apify run id is saved), so no single call needs to outlive the
// platform's request limit. When every source of a client has answered, the
// row and the post-tracking changes are written in ONE database transaction.
//
// Auth: header X-Analytics-Collect-Key against the secret ANALYTICS_COLLECT_KEY
// (at least 32 characters), checked before anything else. Not browser callable.
// Secrets it reads: APIFY_TOKEN, YOUTUBE_API_KEY (the same values n8n holds as
// credentials). Switch: syncview_runtime_flags row analytics_metrics_collect,
// {"mode": "off" | "shadow" | "live", "clients": [slug...], "batch": 1,
//  "yt_split_clients": [slug...]}. Default off.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import { clientSlug } from "../_shared/sheets-mirror.mjs";
import {
  aggregateInstagram,
  aggregateTikTok,
  classifyShortsLongs,
  computeDiffs,
  computePostGains,
  configured,
  mergeClient,
  toStoredRow,
  trackedPosts,
  youtubeChannel,
} from "../_shared/analytics-metrics-collect.mjs";
import { collectMode, coversEveryClient, liveRecords } from "../_shared/analytics-collect-live.mjs";

type JsonMap = Record<string, unknown>;
const APIFY = "https://api.apify.com/v2";
const TICK_BUDGET_MS = Number(Deno.env.get("ANALYTICS_COLLECT_TICK_BUDGET_MS")) || 100_000; // the override exists for the offline test
const MAX_ATTEMPTS = 8; // on the last attempt whatever has not answered is recorded as failed
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
const clean = (v: unknown) => String(v == null ? "" : v).trim();

function requireKey(req: Request): boolean {
  const secret = Deno.env.get("ANALYTICS_COLLECT_KEY") || "";
  const given = clean(req.headers.get("x-analytics-collect-key"));
  return secret.length >= 32 && !!given && timingSafeEqual(given, secret);
}

async function flagValue(db: SupabaseClient, key: string): Promise<JsonMap> {
  const { data, error } = await db.from("syncview_runtime_flags").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data && typeof data.value === "object" && data.value ? data.value as JsonMap : {};
}

// ---- keep only the fields the rules read (a reel carries megabytes of text) ----
const ERR_KEYS = ["error", "errorDescription", "requestErrorMessages", "statusCode", "httpCode", "isRestrictedProfile"];
function pick(o: JsonMap, keys: string[]): JsonMap {
  const r: JsonMap = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}
const slimProfile = (o: JsonMap) => pick(o, ["followersCount", ...ERR_KEYS]);
const slimReel = (o: JsonMap) => pick(o, ["id", "shortCode", "url", "videoPlayCount", "playCount", "videoViewCount", "likesCount", "taken_at", "timestamp", "date", ...ERR_KEYS]);
function slimTikTok(o: JsonMap): JsonMap {
  const r = pick(o, ["id", "webVideoUrl", "videoUrl", "shareUrl", "playCount", "createTime", "fans", ...ERR_KEYS]);
  const meta = o.authorMeta as JsonMap | undefined;
  if (meta && typeof meta === "object") r.authorMeta = pick(meta, ["fans", "followers"]);
  return r;
}

// ---- Apify, resumable: start a run, wait in slices, read its dataset ----
type Stage = { done?: boolean; run_id?: string; dataset?: string; items?: JsonMap[]; last_error?: string; [k: string]: unknown };

async function apifyJson(path: string, init: RequestInit = {}): Promise<{ status: number; body: JsonMap }> {
  const token = Deno.env.get("APIFY_TOKEN") || "";
  const res = await fetch(`${APIFY}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  let body: unknown = {};
  try { body = await res.json(); } catch (_e) { /* non-JSON answer */ }
  return { status: res.status, body: (body && typeof body === "object" ? body : { data: body }) as JsonMap };
}

async function apifyStage(actor: string, input: JsonMap, st: Stage, deadline: number, slim: (o: JsonMap) => JsonMap): Promise<Stage> {
  if (st.done) return st;
  try {
    let status = clean((st as JsonMap).status);
    if (!st.run_id) {
      const r = await apifyJson(`/acts/${actor}/runs?waitForFinish=40`, { method: "POST", body: JSON.stringify(input) });
      if (r.status >= 400) return { done: true, items: [{ error: "apify_start_failed", statusCode: r.status }] };
      const d = (r.body.data || {}) as JsonMap;
      st = { ...st, run_id: clean(d.id), dataset: clean(d.defaultDatasetId) };
      status = clean(d.status);
    }
    while (!TERMINAL.has(status) && Date.now() < deadline - 8_000) {
      const wait = Math.max(1, Math.min(40, Math.floor((deadline - Date.now()) / 1000) - 6));
      const r = await apifyJson(`/actor-runs/${st.run_id}?waitForFinish=${wait}`);
      if (r.status >= 400) return { ...st, last_error: `run_status_${r.status}` };
      status = clean(((r.body.data || {}) as JsonMap).status);
    }
    (st as JsonMap).status = status;
    if (!TERMINAL.has(status)) return st; // still running: the next tick continues
    if (status !== "SUCCEEDED") return { ...st, done: true, items: [{ error: `apify_run_${status.toLowerCase()}` }] };
    const items = await fetch(`${APIFY}/datasets/${st.dataset}/items?format=json&clean=true`, {
      headers: { Authorization: `Bearer ${Deno.env.get("APIFY_TOKEN") || ""}` },
    });
    if (!items.ok) return { ...st, done: true, items: [{ error: "apify_dataset_failed", statusCode: items.status }] };
    const arr = await items.json();
    return { ...st, done: true, items: (Array.isArray(arr) ? arr : []).map((x: JsonMap) => slim(x || {})) };
  } catch (e) {
    return { ...st, last_error: e instanceof Error ? e.message.slice(0, 120) : "fetch_failed" };
  }
}

// ---- YouTube (not resumable: two quick calls) ----
async function youtubeGet(path: string): Promise<JsonMap> {
  const key = Deno.env.get("YOUTUBE_API_KEY") || "";
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${encodeURIComponent(key)}`);
    const body = await res.json().catch(() => ({})) as JsonMap;
    return res.status >= 400 && !body.error ? { ...body, statusCode: res.status } : body;
  } catch (_e) {
    return { error: "youtube_fetch_failed" };
  }
}

async function youtubeStage(channelId: string, split: boolean, st: Stage): Promise<Stage> {
  if (st.done) return st;
  const channel = await youtubeGet(`channels?part=statistics&id=${encodeURIComponent(channelId)}`);
  const out: Stage = { done: true, channel };
  if (split) {
    const pl = await youtubeGet(`playlistItems?part=contentDetails&playlistId=${encodeURIComponent("UU" + channelId.slice(2))}&maxResults=50`);
    const ids = ((pl.items as JsonMap[]) || []).map(v => ((v.contentDetails as JsonMap) || {}).videoId).filter(Boolean);
    const vids = pl.error || pl.errorDescription || Number(pl.statusCode ?? 0) >= 400 ? pl
      : ids.length ? await youtubeGet(`videos?part=statistics,contentDetails,snippet&id=${ids.join(",")}`) : {};
    // A failed playlist or video-details call is a provider failure of YouTube
    // (last good values kept), never "no videos" with shorts and longs at 0.
    out.split_failed = Boolean(vids.error || vids.errorDescription || Number(vids.statusCode ?? 0) >= 400);
    out.videos = (vids.items as JsonMap[]) || [];
  }
  return out;
}

// ---- one client ----
type Profile = { slug: string; display_name: string; instagram_handle: string | null; tiktok_handle: string | null; youtube_channel_id: string | null };
type QueueRow = { run_date: string; client_slug: string; attempts: number; stages: Record<string, Stage> | null };

async function processClient(db: SupabaseClient, q: QueueRow, flags: JsonMap, deadline: number, runId: string): Promise<string> {
  const { data: p, error: pe } = await db.from("client_profiles").select("slug,display_name,instagram_handle,tiktok_handle,youtube_channel_id")
    .eq("slug", q.client_slug).maybeSingle();
  if (pe) throw pe;
  if (!p) throw new Error("client_profile_missing");
  const prof = p as Profile;
  const client = { client_name: prof.display_name, instagram_handle: prof.instagram_handle, tiktok_handle: prof.tiktok_handle, youtube_channel_id: prof.youtube_channel_id };
  const hasIg = configured(client.instagram_handle), hasTt = configured(client.tiktok_handle), hasYt = configured(client.youtube_channel_id);
  const split = hasYt && ((flags.yt_split_clients as string[]) || []).includes(prof.slug);
  const stages: Record<string, Stage> = { ...(q.stages || {}) };

  const [igp, igr, tt, yt] = await Promise.all([
    hasIg ? apifyStage("apify~instagram-profile-scraper", { usernames: [clean(client.instagram_handle)], resultsLimit: 30 }, stages.ig_profile || {}, deadline, slimProfile) : Promise.resolve({ done: true } as Stage),
    hasIg ? apifyStage("apify~instagram-reel-scraper", { username: [clean(client.instagram_handle)], resultsLimit: 50 }, stages.ig_reels || {}, deadline, slimReel) : Promise.resolve({ done: true } as Stage),
    hasTt ? apifyStage("clockworks~tiktok-profile-scraper", { profiles: [clean(client.tiktok_handle)], resultsPerPage: 30 }, stages.tt || {}, deadline, slimTikTok) : Promise.resolve({ done: true } as Stage),
    hasYt ? youtubeStage(clean(client.youtube_channel_id), split, stages.yt || {}) : Promise.resolve({ done: true } as Stage),
  ]);
  Object.assign(stages, { ig_profile: igp, ig_reels: igr, tt, yt });

  const last = q.attempts >= MAX_ATTEMPTS;
  const pending = [igp, igr, tt, yt].some(s => !s.done);
  if (pending && !last) {
    const { error } = await db.from("analytics_metrics_collect_queue").update({ stages, state: "running", lease_until: null, updated_at: new Date().toISOString() })
      .eq("run_date", q.run_date).eq("client_slug", q.client_slug);
    if (error) throw error;
    return "waiting";
  }
  // A source that never answered by the last attempt is a provider failure, as in n8n.
  const timeout = (s: Stage): JsonMap[] => (s.done ? (s.items || []) : [{ error: "apify_timeout" }]);

  const now = new Date().toISOString();
  const igAgg = hasIg ? aggregateInstagram(timeout(igp)[0] ?? {}, timeout(igr), now) : undefined;
  const ttItems = hasTt ? timeout(tt) : [];
  const ttAgg = hasTt ? aggregateTikTok(ttItems, now) : undefined;
  const ytAgg = hasYt ? youtubeChannel(yt.done && !yt.split_failed ? yt.channel : { error: yt.split_failed ? "youtube_split_failed" : "youtube_timeout" }, now) : undefined;
  const ytSplit = split ? classifyShortsLongs((yt.videos as JsonMap[]) || [], Date.parse(now)) : null;
  const merged = mergeClient(client, { ig: igAgg, tt: ttAgg, yt: ytAgg, ytSplit }, now);
  const igPosts = hasIg ? timeout(igr) : [];
  const ttPosts = ttItems.filter(i => !(i.error || i.errorDescription));
  const newPosts = trackedPosts({ merged, igPosts, ttPosts, tiktokConfigured: hasTt });

  const { data: existing, error: ee } = await db.from("analytics_post_tracking").select("post_id,views_today,first_seen_date").eq("client_slug", prof.slug);
  if (ee) throw ee;
  const gains = computePostGains(newPosts, existing || [], Date.parse(now));
  // "Previous rows" are what n8n stored (analytics_metrics), the same source
  // n8n reads, so a shadow value differs from n8n's only by what was scraped.
  const { data: prev, error: pe2 } = await db.from("analytics_metrics").select("date,ig_followers,ig_avg_views,ig_avg_likes,tiktok_followers,tiktok_avg_plays,yt_subscribers,yt_total_views,yt_shorts_views,yt_longs_views,ig_views_this_month,tiktok_plays_this_month")
    .eq("client_slug", prof.slug).lt("date", now.slice(0, 10)).order("date", { ascending: false }).order("seq", { ascending: true }).limit(3);
  if (pe2) throw pe2;
  const out = computeDiffs(merged, gains, prev || [], now);
  const row = toStoredRow(out);
  const posts = gains.updatedRows.map((r: JsonMap) => ({ ...r, client_slug: prof.slug }));
  if (collectMode(flags) === "live") {
    // The real row, prepared as analytics-write prepares it; the commit adds it only if
    // the client has no row for the day yet (first writer wins, see the header).
    const [record] = await liveRecords("metrics", [row as JsonMap], { runId, clientSlug: prof.slug, runDate: q.run_date });
    const { data: live, error: le } = await db.rpc("analytics_metrics_collect_commit_live", {
      p_run_date: q.run_date, p_client_slug: prof.slug, p_row: row, p_posts: posts, p_run_id: runId,
      p_record: record, p_full_snapshot: coversEveryClient(flags),
    });
    if (le) throw le;
    return (live as JsonMap | null)?.skipped === "existing_rows" ? "done_live_kept_existing" : "done_live";
  }
  const { error: ce } = await db.rpc("analytics_metrics_collect_commit_shadow", {
    p_run_date: q.run_date, p_client_slug: prof.slug, p_row: row, p_posts: posts, p_run_id: runId,
  });
  if (ce) throw ce;
  return "done";
}

async function tick(db: SupabaseClient, flags: JsonMap): Promise<JsonMap> {
  const started = Date.now();
  const deadline = started + TICK_BUDGET_MS;
  const runDate = new Date().toISOString().slice(0, 10);
  const runId = `collect-${runDate}`;
  const allow = ((flags.clients as string[]) || []).map(clean).filter(Boolean);

  let pq = db.from("client_profiles").select("slug,instagram_handle,tiktok_handle,youtube_channel_id").is("archived_at", null);
  if (allow.length) pq = pq.in("slug", allow);
  const { data: clients, error: ce } = await pq;
  if (ce) throw ce;
  const seed = (clients || []).map((c: JsonMap) => ({ run_date: runDate, client_slug: c.slug as string }));
  if (seed.length) {
    const { error } = await db.from("analytics_metrics_collect_queue").upsert(seed, { onConflict: "run_date,client_slug", ignoreDuplicates: true });
    if (error) throw error;
  }
  const batch = Math.max(1, Math.min(4, Number(flags.batch) || 1));
  const { data: claimed, error: ke } = await db.rpc("analytics_metrics_collect_claim", { p_run_date: runDate, p_limit: batch, p_lease_seconds: 170, p_max_attempts: MAX_ATTEMPTS });
  if (ke) throw ke;
  const results: Record<string, string> = {};
  await Promise.all(((claimed || []) as QueueRow[]).map(async (q) => {
    try {
      results[q.client_slug] = await processClient(db, q, flags, deadline, runId);
    } catch (e) {
      results[q.client_slug] = "error";
      // Never log handles or payloads: the error text only.
      console.error("collect client failed", q.client_slug.length, e instanceof Error ? e.message : String(e));
      // An internal error (database, profile, commit) is not the providers' fault, so it must
      // not use up their 8-attempt budget: give the attempt back, or a failure on the last
      // claim would leave the client unclaimable with no row. Exception: a live row the
      // preparation refused (live_row_*) is refused the same way every time, so it keeps
      // the attempt: at most 8 tries, then the daily check reports the missing result.
      const permanent = e instanceof Error && e.message.startsWith("live_row_");
      await db.from("analytics_metrics_collect_queue").update({ attempts: permanent ? q.attempts : Math.max(0, q.attempts - 1), last_error: (e instanceof Error ? e.message : String(e)).slice(0, 200), lease_until: null, updated_at: new Date().toISOString() })
        .eq("run_date", q.run_date).eq("client_slug", q.client_slug);
    }
  }));
  const counts = Object.values(results).reduce((m: Record<string, number>, s) => { m[s] = (m[s] || 0) + 1; return m; }, {});
  return { ok: true, run_date: runDate, claimed: (claimed || []).length, results: counts };
}

// One-time (or repeat before the first run of a day) copy of the PostTracking
// tab, so shadow starts from the same "yesterday" as n8n.
async function seedPostTracking(db: SupabaseClient, rows: JsonMap[]): Promise<JsonMap> {
  const runDate = new Date().toISOString().slice(0, 10);
  const { count, error: be } = await db.from("analytics_metrics_collect_queue").select("client_slug", { count: "exact", head: true })
    .eq("run_date", runDate).in("state", ["running", "done"]);
  if (be) throw be;
  if ((count || 0) > 0) return { ok: false, error: "run_in_progress" };
  const recs = rows.map(r => ({
    post_id: clean(r.post_id), client_name: clean(r.client_name), client_slug: clientSlug(r.client_name), platform: clean(r.platform),
    first_seen_date: clean(r.first_seen_date), views_yesterday: Math.round(Number(r.views_yesterday) || 0),
    views_today: Math.round(Number(r.views_today) || 0), views_gained_today: Math.round(Number(r.views_gained_today) || 0),
  })).filter(r => r.post_id && r.client_slug);
  for (let i = 0; i < recs.length; i += 500) {
    const { error } = await db.from("analytics_post_tracking").upsert(recs.slice(i, i + 500), { onConflict: "post_id" });
    if (error) throw error;
  }
  return { ok: true, received: rows.length, written: recs.length };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!requireKey(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);
  try {
    const raw = await req.text();
    if (raw.length > 4_000_000) return json({ ok: false, error: "body_too_large" }, 413);
    let body: JsonMap = {};
    try { body = raw ? JSON.parse(raw) as JsonMap : {}; } catch (_e) { return json({ ok: false, error: "bad_json" }, 400); }
    const action = clean(body.action) || "tick";
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const flags = await flagValue(db, "analytics_metrics_collect");
    if (collectMode(flags) === "off") return json({ ok: true, skipped: "off" });
    if (action === "tick") return json(await tick(db, flags));
    if (action === "seed_post_tracking") {
      if (!Array.isArray(body.rows)) return json({ ok: false, error: "missing_rows" }, 400);
      return json(await seedPostTracking(db, body.rows as JsonMap[]));
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("analytics-metrics-collect failed", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "collect_failed" }, 500);
  }
});
