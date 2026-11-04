// analytics-weekly-followers — step 1 of the weekly client analytics snapshot:
// followers per client per platform, once a week, into analytics_weekly_snapshot.
//
// Sources: Scrape Creators for Instagram and TikTok (secret SCRAPECREATORS_API_KEY);
// YouTube Data API for YouTube (secret YOUTUBE_API_KEY) with Scrape Creators as the
// fallback when the API is refused or down. Secrets are checked by name only and never
// printed. A private, missing or failed profile is recorded "failed" with a class, never a
// guessed number. A handle or channel of "N/A" or empty is skipped (no row). A missing
// secret records "not_configured". Week one is the baseline: nothing is compared here.
//
// How a week runs: pg_cron calls "tick" every minute early on Monday UTC. A tick seeds the
// week's queue (one row per active kind='client' client), claims ONE client nobody holds,
// reads its platforms in parallel, and commits all its rows plus "done" in one database
// transaction. A transient failure (rate limit, timeout, provider 5xx) keeps the platform
// pending for a later tick; on the last attempt it is recorded as failed. The upsert key is
// client + platform + week, so a re-run updates and never duplicates, and a failed re-run
// never overwrites an earlier good number of the same week.
//
// Actions (POST, header x-analytics-collect-key = the secret ANALYTICS_COLLECT_KEY, at least
// 32 characters, the same key the daily collectors use; not browser callable):
//   tick    the cron call.
//   run     {"action":"run","slugs":["<slug>", ...]} up to 3 named clients (a client or the test
//           client), reset for this week and processed inside this call. The manual run.
//   status  counts for this week by platform, status and error class. No values, no handles.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import { configured, PLATFORMS, readScrapeCreators, readYoutubeApi, TRANSIENT, weekOf } from "../_shared/analytics-weekly-followers.mjs";

type JsonMap = Record<string, unknown>;
type Result = { status: "ok" | "failed" | "not_configured"; followers: number | null; error_class: string | null; source: string | null };
type Stage = Result & { done: true } | { done: false; last_class?: string };

const SC = "https://api.scrapecreators.com/v1";
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

async function scrapeCreators(platform: string, id: string): Promise<{ r: { followers?: number; error_class?: string } }> {
  const key = Deno.env.get("SCRAPECREATORS_API_KEY") || "";
  const q = platform === "youtube" ? `channelId=${encodeURIComponent(id)}` : `handle=${encodeURIComponent(id.replace(/^@/, ""))}`;
  const res = await get(`${SC}/${platform}/${platform === "youtube" ? "channel" : "profile"}?${q}`, { "x-api-key": key });
  if (res.net) return { r: { error_class: res.net } };
  return { r: readScrapeCreators(platform, res.status, res.body) };
}

async function youtubeApi(id: string): Promise<{ followers?: number; error_class?: string }> {
  const key = Deno.env.get("YOUTUBE_API_KEY") || "";
  const res = await get(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
  if (res.net) return { error_class: res.net };
  return readYoutubeApi(res.status, res.body);
}

const hasSc = () => (Deno.env.get("SCRAPECREATORS_API_KEY") || "").length > 0;
const hasYt = () => (Deno.env.get("YOUTUBE_API_KEY") || "").length > 0;
const notConfigured = (): Stage => ({ done: true, status: "not_configured", followers: null, error_class: "secret_missing", source: null });

// -> a finished Result, or { done:false } when the failure is transient and attempts remain.
async function readPlatform(platform: string, id: string, last: boolean): Promise<Stage> {
  let source = "scrapecreators";
  let r: { followers?: number; error_class?: string };
  if (platform === "youtube") {
    if (!hasYt() && !hasSc()) return notConfigured();
    if (hasYt()) {
      source = "youtube_data_api";
      r = await youtubeApi(id);
      // The API refused or is down: Scrape Creators is the fallback. A missing or hidden
      // channel is final, the fallback would only say the same.
      if (r.error_class && !["not_found", "hidden_count"].includes(r.error_class) && hasSc()) {
        source = "scrapecreators";
        r = (await scrapeCreators("youtube", id)).r;
      }
    } else r = (await scrapeCreators("youtube", id)).r;
  } else {
    if (!hasSc()) return notConfigured();
    r = (await scrapeCreators(platform, id)).r;
  }
  if (r.followers !== undefined) return { done: true, status: "ok", followers: r.followers, error_class: null, source };
  const cls = r.error_class || "provider_error";
  if (TRANSIENT.has(cls) && !last) return { done: false, last_class: cls };
  return { done: true, status: "failed", followers: null, error_class: cls, source };
}

type QueueRow = { week_of: string; client_slug: string; attempts: number; stages: Record<string, Stage> | null };

async function processClient(db: SupabaseClient, q: QueueRow): Promise<string> {
  const { data: p, error: pe } = await db.from("client_profiles").select("instagram_handle,tiktok_handle,youtube_channel_id").eq("slug", q.client_slug).maybeSingle();
  if (pe) throw pe;
  if (!p) throw new Error("client_profile_missing");
  const ids: Record<string, string> = { instagram: clean(p.instagram_handle), tiktok: clean(p.tiktok_handle), youtube: clean(p.youtube_channel_id) };
  const last = q.attempts >= MAX_ATTEMPTS;
  const stages: Record<string, Stage> = { ...(q.stages || {}) };
  await Promise.all(PLATFORMS.map(async (pf: string) => {
    if (!configured(ids[pf])) { delete stages[pf]; return; } // skipped: no row
    if (stages[pf]?.done) return; // answered on an earlier tick
    stages[pf] = await readPlatform(pf, ids[pf], last);
  }));
  const pending = Object.values(stages).some((s) => !s.done);
  if (pending) {
    const { error } = await db.from("analytics_weekly_followers_queue").update({ stages, state: "running", lease_until: null, updated_at: new Date().toISOString() })
      .eq("week_of", q.week_of).eq("client_slug", q.client_slug);
    if (error) throw error;
    return "waiting";
  }
  const rows = Object.entries(stages).map(([platform, s]) => {
    const r = s as Result;
    return { platform, status: r.status, followers: r.followers, error_class: r.error_class, source: r.source };
  });
  const { error } = await db.rpc("analytics_weekly_followers_commit", { p_week_of: q.week_of, p_client_slug: q.client_slug, p_rows: rows });
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
    // Manual run: a finished client starts over for this week, an UNFINISHED one resumes with
    // its attempts and answered platforms, so repeated runs against a failing provider reach
    // the last attempt and record the failure instead of restarting at attempt 1 every time.
    const { data: have, error: he } = await db.from("analytics_weekly_followers_queue").select("client_slug,state").eq("week_of", week).in("client_slug", slugs);
    if (he) throw he;
    const open = new Set(((have || []) as JsonMap[]).filter((r) => r.state !== "done").map((r) => r.client_slug as string));
    const fresh = rows.filter((r) => !open.has(r.client_slug)).map((r) => ({ ...r, state: "pending", attempts: 0, stages: {}, lease_until: null }));
    if (fresh.length) {
      const { error: ue } = await db.from("analytics_weekly_followers_queue").upsert(fresh, { onConflict: "week_of,client_slug" });
      if (ue) throw ue;
    }
    return;
  }
  const { error: se } = await db.from("analytics_weekly_followers_queue").upsert(rows, { onConflict: "week_of,client_slug", ignoreDuplicates: true });
  if (se) throw se;
}

async function work(db: SupabaseClient, week: string, limit: number, slugs: string[] | null): Promise<JsonMap> {
  const { data: claimed, error } = await db.rpc("analytics_weekly_followers_claim", { p_week_of: week, p_limit: limit, p_lease_seconds: 120, p_max_attempts: MAX_ATTEMPTS, p_slugs: slugs });
  if (error) throw error;
  const results: Record<string, number> = {};
  const bump = (k: string) => { results[k] = (results[k] || 0) + 1; };
  await Promise.all(((claimed || []) as QueueRow[]).map(async (q) => {
    try { bump(await processClient(db, q)); } catch (e) {
      bump("error");
      // Never log slugs, handles or payloads: the error text only. An internal error is not the
      // providers' fault, so the attempt is given back.
      console.error("weekly followers client failed", e instanceof Error ? e.message : String(e));
      await db.from("analytics_weekly_followers_queue").update({ attempts: Math.max(0, q.attempts - 1), last_error: (e instanceof Error ? e.message : String(e)).slice(0, 200), lease_until: null, updated_at: new Date().toISOString() })
        .eq("week_of", q.week_of).eq("client_slug", q.client_slug);
    }
  }));
  return { ok: true, week_of: week, claimed: (claimed || []).length, results };
}

async function status(db: SupabaseClient, week: string): Promise<JsonMap> {
  const { data: snaps, error } = await db.from("analytics_weekly_snapshot").select("platform,status,error_class").eq("week_of", week);
  if (error) throw error;
  const { data: qs, error: qe } = await db.from("analytics_weekly_followers_queue").select("state").eq("week_of", week);
  if (qe) throw qe;
  const tally = (rows: JsonMap[], f: (r: JsonMap) => string) => rows.reduce((m: Record<string, number>, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    ok: true, week_of: week,
    snapshot: tally((snaps || []) as JsonMap[], (r) => `${r.platform}:${r.status}${r.error_class ? ":" + r.error_class : ""}`),
    queue: tally((qs || []) as JsonMap[], (r) => String(r.state)),
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
      // Transient failures wait for a later tick; the manual run reports what is still pending.
      return json(await work(db, week, slugs.length, slugs));
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("analytics-weekly-followers failed", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "weekly_followers_failed" }, 500);
  }
});
