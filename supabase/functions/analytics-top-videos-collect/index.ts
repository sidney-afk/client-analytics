// analytics-top-videos-collect: the daily Top Videos job (n8n "TOP VIDEOS") run by our
// own Edge Function (docs/plans/2026-10-01-n8n-off-analytics.md, section 7).
//
// SHADOW ONLY, built the same way as analytics-metrics-collect. It scrapes the same
// sources and applies the same rules as n8n, but writes only to
// analytics_top_videos_shadow. It never touches analytics_top_videos (what the pages
// read) and never touches a Sheet. n8n keeps running untouched; the two are compared
// daily with analytics_top_videos_shadow_compare().
//
// How a day runs: pg_cron calls this function every minute from 08:00 to 12:59 UTC
// (n8n's run starts at 08:00 UTC and takes about an hour). Each tick seeds today's queue
// (one row per active client), claims `batch` clients (default 1) that nobody holds,
// works on their sources until a time budget is spent and keeps what it learned in the
// queue row. A scraper still running when the budget ends is picked up by the next tick
// (the Apify run id is saved). When every source has answered, the client's rows are
// written in ONE database transaction, replacing any earlier shadow rows of that day.
//
// Auth: header X-Analytics-Collect-Key against the secret ANALYTICS_COLLECT_KEY (the
// same key the metrics job uses; at least 32 characters), checked before anything else.
// Not browser callable. Secrets it reads: APIFY_TOKEN, YOUTUBE_API_KEY (the same values
// n8n holds as credentials). Switch: syncview_runtime_flags row
// analytics_top_videos_collect, {"mode": "off" | "shadow", "clients": [slug...],
// "batch": 1}. Default off.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import {
  buildClientRows,
  configured,
  slimReel,
  slimTikTok,
  slimVideo,
  toShadowRecord,
} from "../_shared/analytics-top-videos-collect.mjs";

type JsonMap = Record<string, unknown>;
const APIFY = "https://api.apify.com/v2";
const TICK_BUDGET_MS = Number(Deno.env.get("ANALYTICS_COLLECT_TICK_BUDGET_MS")) || 100_000; // the override exists for the offline test
const MAX_ATTEMPTS = 8; // on the last attempt a scraper that has not answered is recorded as failed
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

// ---- Apify, resumable: start a run, wait in slices, read its dataset ----
// failed = the call itself failed (n8n takes the error output of its node): that platform writes no rows.
type Stage = { done?: boolean; failed?: boolean; run_id?: string; dataset?: string; status?: string; items?: JsonMap[]; last_error?: string };

async function apifyJson(path: string, init: RequestInit = {}): Promise<{ status: number; body: JsonMap }> {
  const token = Deno.env.get("APIFY_TOKEN") || "";
  const res = await fetch(`${APIFY}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  let body: unknown = {};
  try { body = await res.json(); } catch (_e) { /* non-JSON answer */ }
  return { status: res.status, body: (body && typeof body === "object" ? body : { data: body }) as JsonMap };
}

const FAILED: Stage = { done: true, failed: true, items: [] };

async function apifyStage(actor: string, input: JsonMap, st: Stage, deadline: number, slim: (o: JsonMap) => JsonMap): Promise<Stage> {
  if (st.done) return st;
  try {
    let status = clean(st.status);
    if (!st.run_id) {
      const r = await apifyJson(`/acts/${actor}/runs?waitForFinish=40`, { method: "POST", body: JSON.stringify(input) });
      if (r.status >= 400) return FAILED;
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
    st.status = status;
    if (!TERMINAL.has(status)) return st; // still running: the next tick continues
    if (status !== "SUCCEEDED") return FAILED;
    const items = await fetch(`${APIFY}/datasets/${st.dataset}/items?format=json&clean=true`, {
      headers: { Authorization: `Bearer ${Deno.env.get("APIFY_TOKEN") || ""}` },
    });
    if (!items.ok) return FAILED;
    const arr = await items.json();
    return { ...st, done: true, items: (Array.isArray(arr) ? arr : []).map((x: JsonMap) => slim(x || {})) };
  } catch (e) {
    return { ...st, last_error: e instanceof Error ? e.message.slice(0, 120) : "fetch_failed" };
  }
}

// ---- YouTube (not resumable: two quick calls) ----
async function youtubeGet(path: string): Promise<{ ok: boolean; body: JsonMap }> {
  const key = Deno.env.get("YOUTUBE_API_KEY") || "";
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${encodeURIComponent(key)}`);
    const body = await res.json().catch(() => ({})) as JsonMap;
    return { ok: res.status < 400 && !body.error, body };
  } catch (_e) {
    return { ok: false, body: {} };
  }
}

// n8n: "YouTube Search Shorts" (short videos only, most viewed first, last 30 days, 20) then
// "YouTube Video Stats" for those ids. A failed call on either is the error output (no rows).
// No short in 30 days is a normal answer (the "no new posts" row), measured in n8n's runs.
async function youtubeStage(channelId: string, st: Stage, now: Date): Promise<Stage> {
  if (st.done) return st;
  const after = new Date(now.getTime() - 30 * 86400 * 1000).toISOString();
  const s = await youtubeGet(`search?part=id,snippet&channelId=${encodeURIComponent(channelId)}&type=video&videoDuration=short&order=viewCount&publishedAfter=${encodeURIComponent(after)}&maxResults=20`);
  if (!s.ok || !Array.isArray(s.body.items)) return FAILED;
  let ids: string[];
  try {
    ids = (s.body.items as JsonMap[]).map(v => clean(((v.id as JsonMap) || {}).videoId));
  } catch (_e) { return FAILED; }
  if (ids.some(i => !i)) return FAILED;
  if (!ids.length) return { done: true, items: [] };
  const v = await youtubeGet(`videos?part=statistics,snippet&id=${ids.join(",")}`);
  if (!v.ok) return FAILED;
  return { done: true, items: ((v.body.items as JsonMap[]) || []).map(x => slimVideo(x)) };
}

// ---- one client ----
type Profile = { slug: string; display_name: string; instagram_handle: string | null; tiktok_handle: string | null; youtube_channel_id: string | null };
type QueueRow = { run_date: string; client_slug: string; attempts: number; stages: Record<string, Stage> | null };

async function processClient(db: SupabaseClient, q: QueueRow, deadline: number, runId: string): Promise<string> {
  const { data: p, error: pe } = await db.from("client_profiles").select("slug,display_name,instagram_handle,tiktok_handle,youtube_channel_id")
    .eq("slug", q.client_slug).maybeSingle();
  if (pe) throw pe;
  if (!p) throw new Error("client_profile_missing");
  const prof = p as Profile;
  const hasIg = configured(prof.instagram_handle), hasTt = configured(prof.tiktok_handle), hasYt = configured(prof.youtube_channel_id);
  const stages: Record<string, Stage> = { ...(q.stages || {}) };
  const now = new Date();

  const [ig, tt, yt] = await Promise.all([
    hasIg ? apifyStage("apify~instagram-reel-scraper", { username: [clean(prof.instagram_handle)], resultsLimit: 50 }, stages.ig || {}, deadline, slimReel) : Promise.resolve({ done: true } as Stage),
    hasTt ? apifyStage("clockworks~tiktok-profile-scraper", { profiles: [clean(prof.tiktok_handle)], resultsPerPage: 50 }, stages.tt || {}, deadline, slimTikTok) : Promise.resolve({ done: true } as Stage),
    hasYt ? youtubeStage(clean(prof.youtube_channel_id), stages.yt || {}, now) : Promise.resolve({ done: true } as Stage),
  ]);
  Object.assign(stages, { ig, tt, yt });

  const last = q.attempts >= MAX_ATTEMPTS;
  if ([ig, tt, yt].some(s => !s.done) && !last) {
    const { error } = await db.from("analytics_top_videos_collect_queue").update({ stages, state: "running", lease_until: null, updated_at: new Date().toISOString() })
      .eq("run_date", q.run_date).eq("client_slug", q.client_slug);
    if (error) throw error;
    return "waiting";
  }
  // A scraper that never answered by the last attempt is a provider failure: no rows for it.
  const src = (s: Stage, on: boolean) => (!on ? undefined : s.done ? { failed: Boolean(s.failed), items: (s.items || []) as JsonMap[] } : { failed: true, items: [] as JsonMap[] });
  const built = buildClientRows({ clientName: prof.display_name, ig: src(ig, hasIg), tt: src(tt, hasTt), yt: src(yt, hasYt) }, now);
  const rows = built.rows.map(toShadowRecord);
  const { error: ce } = await db.rpc("analytics_top_videos_collect_commit_shadow", {
    p_run_date: q.run_date, p_client_slug: prof.slug, p_rows: rows, p_states: built.states, p_run_id: runId,
  });
  if (ce) throw ce;
  return "done";
}

async function tick(db: SupabaseClient, flags: JsonMap): Promise<JsonMap> {
  const started = Date.now();
  const deadline = started + TICK_BUDGET_MS;
  const runDate = new Date().toISOString().slice(0, 10);
  const runId = `top-videos-collect-${runDate}`;
  const allow = ((flags.clients as string[]) || []).map(clean).filter(Boolean);

  let pq = db.from("client_profiles").select("slug").is("archived_at", null);
  if (allow.length) pq = pq.in("slug", allow);
  const { data: clients, error: ce } = await pq;
  if (ce) throw ce;
  const seed = (clients || []).map((c: JsonMap) => ({ run_date: runDate, client_slug: c.slug as string }));
  if (seed.length) {
    const { error } = await db.from("analytics_top_videos_collect_queue").upsert(seed, { onConflict: "run_date,client_slug", ignoreDuplicates: true });
    if (error) throw error;
  }
  const batch = Math.max(1, Math.min(4, Number(flags.batch) || 1));
  const { data: claimed, error: ke } = await db.rpc("analytics_top_videos_collect_claim", { p_run_date: runDate, p_limit: batch, p_lease_seconds: 170, p_max_attempts: MAX_ATTEMPTS });
  if (ke) throw ke;
  const results: Record<string, string> = {};
  await Promise.all(((claimed || []) as QueueRow[]).map(async (q) => {
    try {
      results[q.client_slug] = await processClient(db, q, deadline, runId);
    } catch (e) {
      results[q.client_slug] = "error";
      // Never log handles or payloads: the error text only.
      console.error("top videos collect client failed", q.client_slug.length, e instanceof Error ? e.message : String(e));
      // An internal error (database, profile, commit) is not the providers' fault, so it must
      // not use up their 8-attempt budget: give the attempt back.
      await db.from("analytics_top_videos_collect_queue").update({ attempts: Math.max(0, q.attempts - 1), last_error: (e instanceof Error ? e.message : String(e)).slice(0, 200), lease_until: null, updated_at: new Date().toISOString() })
        .eq("run_date", q.run_date).eq("client_slug", q.client_slug);
    }
  }));
  const counts = Object.values(results).reduce((m: Record<string, number>, s) => { m[s] = (m[s] || 0) + 1; return m; }, {});
  return { ok: true, run_date: runDate, claimed: (claimed || []).length, results: counts };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!requireKey(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);
  try {
    const raw = await req.text();
    if (raw.length > 100_000) return json({ ok: false, error: "body_too_large" }, 413);
    let body: JsonMap = {};
    try { body = raw ? JSON.parse(raw) as JsonMap : {}; } catch (_e) { return json({ ok: false, error: "bad_json" }, 400); }
    const action = clean(body.action) || "tick";
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const flags = await flagValue(db, "analytics_top_videos_collect");
    if (flags.mode !== "shadow") return json({ ok: true, skipped: "off" });
    if (action === "tick") return json(await tick(db, flags));
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("analytics-top-videos-collect failed", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "collect_failed" }, 500);
  }
});
