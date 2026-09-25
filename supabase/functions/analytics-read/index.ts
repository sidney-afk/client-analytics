// analytics-read — one client's analytics rows from the Supabase mirror of the
// Sheets (docs/plans/2026-09-24-sheets-to-supabase.md, Phase 1).
//
// NOT YET USED BY THE PAGE. Phase 2 switches the site to it behind a flag.
//
// Access (owner decision 2026-09-25): the caller is either a staff member,
// proven by a role key in X-Syncview-Key, or a client, proven by the link
// token for exactly that client (client_access.review_token, active client
// only, strict: no permissive fallback). Either way the answer holds ONE
// client's rows. The tables have RLS on with no policies and no browser
// grants, so this function (service_role) is the only reader.
//
// Staff reads work while analytics_mirror_read_enabled is off, so parity and
// timing can be checked before any client depends on it; client-link reads
// need the flag on.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, timingSafeEqual } from "../_shared/staff-role-auth.ts";
import {
  clientSlug,
  profileForClientLink,
  topVideosCutoff,
} from "../_shared/sheets-mirror.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-client-token",
  "Cache-Control": "no-store",
};

const PAGE = 1000; // PostgREST returns at most this many rows per request
const READ_DATASETS = ["metrics", "top_videos", "market_research_briefs", "content_summaries", "client_profile"] as const;
type ReadDataset = typeof READ_DATASETS[number];
type JsonMap = Record<string, unknown>;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

async function flagOn(supabase: SupabaseClient, key: string): Promise<boolean> {
  const { data } = await supabase.from("syncview_runtime_flags").select("value").eq("key", key).maybeSingle();
  const v = data && typeof data.value === "object" ? data.value as JsonMap : {};
  return v.enabled === true;
}

// Pages through a query until a short page comes back.
async function readAll(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function latestReceipts(supabase: SupabaseClient): Promise<JsonMap> {
  const names = ["metrics", "top_videos", "market_research_briefs", "content_summaries", "client_profiles"];
  const found = await Promise.all(names.map(async (dataset) => {
    const { data, error } = await supabase
      .from("analytics_ingest_receipts")
      .select("source,run_id,rows_received,rows_written,complete,created_at")
      .eq("dataset", dataset)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return [dataset, data || null] as const;
  }));
  return Object.fromEntries(found);
}

async function clientTokenValid(supabase: SupabaseClient, slug: string, token: string): Promise<boolean> {
  if (!slug || !token) return false;
  const { data, error } = await supabase
    .from("client_access")
    .select("slug,review_token,client:clients!inner(slug,active)")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  const raw = (data as JsonMap | null)?.client;
  const client = (Array.isArray(raw) ? raw[0] : raw) as JsonMap | null | undefined;
  const stored = clean((data as JsonMap | null)?.review_token);
  const active = !!client && client.active === true && clean(client.slug) === slug;
  return active && !!stored && timingSafeEqual(token, stored);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const started = performance.now();
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);

    const body = await req.json().catch(() => ({})) as JsonMap;
    const slug = clientSlug(body.slug || body.client_slug || body.client);
    if (!slug) return json({ ok: false, error: "missing_client" }, 400);
    const asked = Array.isArray(body.datasets) ? body.datasets.map(clean) : [...READ_DATASETS];
    const datasets = asked.filter((d): d is ReadDataset => (READ_DATASETS as readonly string[]).includes(d));
    if (!datasets.length) return json({ ok: false, error: "no_known_dataset" }, 400);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Who is asking. A staff key wins; otherwise the client's own link token.
    const staffKey = clean(req.headers.get("x-syncview-key"));
    let principal: "staff" | "client" | null = null;
    if (staffKey) {
      const auth = authorizeStaffKey(staffKey, ["admin", "smm", "creative"]);
      if (!auth.ok) return json({ ok: false, error: "unauthorized" }, 401);
      principal = "staff";
    } else {
      const token = clean(req.headers.get("x-syncview-client-token") || body.token);
      if (!(await flagOn(supabase, "analytics_mirror_read_enabled"))) {
        return json({ ok: false, error: "mirror_read_disabled" }, 503);
      }
      if (!(await clientTokenValid(supabase, slug, token))) {
        return json({ ok: false, error: "fresh_link_required" }, 410);
      }
      principal = "client";
    }

    // The datasets are independent: fetch them, and the receipts, at once.
    const out: JsonMap = {};
    const cutoff = topVideosCutoff();
    const readers: Record<ReadDataset, () => Promise<unknown>> = {
      metrics: () => readAll((a, b) => supabase.from("analytics_metrics")
        .select("date,client_name,ig_followers,ig_avg_views,ig_avg_likes,tiktok_followers,tiktok_avg_plays,yt_subscribers,yt_total_views,ig_views_gained_today,tiktok_plays_gained_today,ig_views_this_month,tiktok_plays_this_month,yt_views_gained_today,yt_shorts_views,yt_longs_views,analytics_receipt")
        .eq("client_slug", slug).order("date").order("seq").range(a, b)),
      top_videos: () => readAll((a, b) => supabase.from("analytics_top_videos")
        .select("scraped_date,client_name,platform,period,rank,caption,video_url,views,likes,comments,shares")
        .eq("client_slug", slug).gte("scraped_date", cutoff).order("scraped_date").order("seq").range(a, b)),
      market_research_briefs: () => readAll((a, b) => supabase.from("analytics_market_research_briefs")
        .select("id,client_name,date,raw_json,raw_json_2,raw_json_3")
        .eq("client_slug", slug).order("id").range(a, b)),
      content_summaries: () => readAll((a, b) => supabase.from("analytics_content_summaries")
        .select("date,client_name,bullets")
        .eq("client_slug", slug).order("seq").range(a, b)),
      client_profile: async () => {
        const { data, error } = await supabase.from("client_profiles").select("*")
          .eq("slug", slug).is("archived_at", null).maybeSingle();
        if (error) throw error;
        return principal === "staff" ? (data || null) : profileForClientLink(data as JsonMap | null);
      },
    };
    const [values, receipts] = await Promise.all([
      Promise.all(datasets.map((d) => readers[d]())),
      latestReceipts(supabase),
    ]);
    datasets.forEach((d, i) => { out[d] = values[i]; });

    return json({
      ok: true,
      slug,
      principal,
      top_videos_since: datasets.includes("top_videos") ? cutoff : undefined,
      // A read with zero rows is a real "no rows" only when the dataset's
      // latest receipt is complete; the page decides from this (plan, Phase 2).
      receipts,
      data: out,
      elapsed_ms: Math.round(performance.now() - started),
    });
  } catch (e) {
    console.error("analytics-read failed", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "read_failed" }, 500);
  }
});
