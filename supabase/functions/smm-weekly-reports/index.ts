// Supabase Edge Function: smm-weekly-reports
//
// Public gateway for SyncView's hidden SMM weekly report form and Kasper viewer.
// Security is intentionally permissive for this v1: no staff key, no JWT.
//
// Actions:
//   GET  ?action=options
//   GET  ?action=reports[&week=YYYY-MM-DD][&smm=...][&client=...]
//   POST { action: "submit", report: {...} }
//   POST { action: "sync_managers", managers: [...] }  // called by n8n Sheet sync
//
// Deploy:
//   supabase functions deploy smm-weekly-reports --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

type JsonMap = Record<string, unknown>;

const OVERALL = ["On track", "Minor friction", "Needs your attention", "Blocked"];
const OBSTACLE = ["Handling it", "Need your input", "Need you to act"];
const MOOD = ["Great", "Fine", "Cooling", "Concerned"];
const SCHEDULE = ["Ahead", "On track", "Slightly behind", "At risk"];
const PERFORMANCE = ["Numbers up", "Flat", "Down", "Too early to tell"];

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function line(v: unknown, max = 500): string {
  return clean(v).replace(/\s+/g, " ").slice(0, max);
}

function normalizeSlug(v: unknown): string {
  let s = clean(v).toLowerCase();
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_e) {}
  s = s.replace(/^dr\.?\s+/, "");
  s = s.replace(/\s+(?:and|&)\s+/g, "&");
  return s.replace(/[^a-z0-9&]+/g, "");
}

function weekStartISO(v: unknown): string {
  const raw = clean(v);
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) d = new Date(raw + "T12:00:00Z");
  else d = new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  const day = d.getUTCDay(); // 0 Sun, 1 Mon
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function requireChoice(name: string, value: unknown, allowed: string[]): string {
  const v = line(value, 80);
  if (!allowed.includes(v)) throw new Error(name + " invalid");
  return v;
}

function requireText(name: string, value: unknown, max = 500): string {
  const v = line(value, max);
  if (!v) throw new Error(name + " required");
  return v;
}

function intCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("content_shipped_count invalid");
  return Math.floor(n);
}

function serializeManager(row: JsonMap): JsonMap {
  return {
    slug: row.slug || "",
    name: row.name || "",
    email: row.email || "",
    active: row.active !== false,
  };
}

function serializeReport(row: JsonMap): JsonMap {
  return {
    id: row.id || "",
    week_start_date: row.week_start_date || "",
    week_end_date: row.week_end_date || "",
    smm_slug: row.smm_slug || "",
    smm_name: row.smm_name || "",
    client_slug: row.client_slug || "",
    client_name: row.client_name || "",
    overall_status: row.overall_status || "",
    what_done: row.what_got_done || "",
    what_got_done: row.what_got_done || "",
    content_count: Number(row.content_shipped_count || 0),
    content_shipped_count: Number(row.content_shipped_count || 0),
    biggest_win: row.biggest_win || "",
    biggest_obstacle: row.biggest_obstacle || "",
    obstacle_support: row.obstacle_support_status || "",
    obstacle_support_status: row.obstacle_support_status || "",
    client_mood: row.client_mood || "",
    client_requests: row.client_requests || "",
    deliverables_schedule: row.deliverables_schedule_status || "",
    deliverables_schedule_status: row.deliverables_schedule_status || "",
    performance_signal: row.performance_signal || "",
    performance_context: row.performance_context || "",
    anything_else: row.extra_notes || "",
    extra_notes: row.extra_notes || "",
    submitted_at: row.submitted_at || "",
  };
}

function db() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) throw new Error("server not configured");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function loadOptions(): Promise<Response> {
  const supabase = db();
  const { data, error } = await supabase
    .from("social_media_managers")
    .select("slug,name,email,active")
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(500);
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({
    ok: true,
    current_week_start: weekStartISO(null),
    managers: (data || []).map(serializeManager),
  });
}

async function listReports(url: URL): Promise<Response> {
  const supabase = db();
  const week = clean(url.searchParams.get("week_start_date") || url.searchParams.get("week"));
  const smm = clean(url.searchParams.get("smm_slug") || url.searchParams.get("smm"));
  const client = clean(url.searchParams.get("client_slug") || url.searchParams.get("client"));

  let q = supabase
    .from("smm_weekly_reports")
    .select("*")
    .order("week_start_date", { ascending: false })
    .order("smm_name", { ascending: true })
    .order("client_name", { ascending: true })
    .limit(1000);
  if (week) q = q.eq("week_start_date", weekStartISO(week));
  if (smm) q = q.eq("smm_slug", normalizeSlug(smm));
  if (client) q = q.eq("client_slug", normalizeSlug(client));

  const [{ data, error }, weekResp] = await Promise.all([
    q,
    supabase
      .from("smm_weekly_reports")
      .select("week_start_date")
      .order("week_start_date", { ascending: false })
      .limit(300),
  ]);
  if (error) return json({ ok: false, error: error.message }, 500);
  const weeks = Array.from(new Set(((weekResp.data || []) as JsonMap[]).map(r => clean(r.week_start_date)).filter(Boolean)));
  return json({
    ok: true,
    current_week_start: weekStartISO(null),
    weeks,
    reports: (data || []).map(serializeReport),
  });
}

async function submitReport(req: Request, body: JsonMap): Promise<Response> {
  const supabase = db();
  const raw = ((body.report && typeof body.report === "object") ? body.report : body) as JsonMap;

  try {
    const smmName = requireText("smm_name", raw.smm_name || raw.smmName || raw.name, 120);
    const smmSlug = normalizeSlug(raw.smm_slug || raw.smmSlug || smmName);
    const clientName = requireText("client_name", raw.client_name || raw.clientName, 160);
    const clientSlug = normalizeSlug(raw.client_slug || raw.clientSlug || clientName);
    if (!smmSlug) throw new Error("smm_slug required");
    if (!clientSlug) throw new Error("client_slug required");

    const row = {
      week_start_date: weekStartISO(raw.week_start_date || raw.weekStartDate),
      smm_slug: smmSlug,
      smm_name: smmName,
      client_slug: clientSlug,
      client_name: clientName,
      overall_status: requireChoice("overall_status", raw.overall_status || raw.overallStatus, OVERALL),
      what_got_done: requireText("what_got_done", raw.what_got_done || raw.what_done || raw.whatGotDone, 500),
      content_shipped_count: intCount(raw.content_shipped_count ?? raw.content_count ?? raw.contentShippedCount),
      biggest_win: requireText("biggest_win", raw.biggest_win || raw.biggestWin, 500),
      biggest_obstacle: requireText("biggest_obstacle", raw.biggest_obstacle || raw.biggestObstacle, 500),
      obstacle_support_status: requireChoice("obstacle_support_status", raw.obstacle_support_status || raw.obstacle_support || raw.obstacleSupportStatus, OBSTACLE),
      client_mood: requireChoice("client_mood", raw.client_mood || raw.clientMood, MOOD),
      client_requests: requireText("client_requests", raw.client_requests || raw.clientRequests, 500),
      deliverables_schedule_status: requireChoice("deliverables_schedule_status", raw.deliverables_schedule_status || raw.deliverables_schedule || raw.deliverablesScheduleStatus, SCHEDULE),
      performance_signal: requireChoice("performance_signal", raw.performance_signal || raw.performanceSignal, PERFORMANCE),
      performance_context: line(raw.performance_context || raw.performanceContext, 500),
      extra_notes: requireText("extra_notes", raw.extra_notes || raw.anything_else || raw.extraNotes, 500),
      raw_payload: raw,
      submitted_user_agent: line(req.headers.get("user-agent"), 500),
    };

    const { data, error } = await supabase
      .from("smm_weekly_reports")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505" || /duplicate/i.test(error.message || "")) {
        return json({ ok: false, error: "already_submitted" }, 409);
      }
      return json({ ok: false, error: error.message }, 500);
    }
    return json({ ok: true, report: serializeReport(data as JsonMap) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
}

async function syncManagers(body: JsonMap): Promise<Response> {
  const supabase = db();
  const input = Array.isArray(body.managers) ? body.managers : [];
  const bySlug = new Map<string, JsonMap>();
  const now = new Date().toISOString();

  for (const item of input) {
    const raw = (item && typeof item === "object") ? item as JsonMap : { name: item };
    const name = line(raw.name || raw.social_media_manager || raw.smm_name || raw.smm, 120);
    if (!name) continue;
    const slug = normalizeSlug(raw.slug || name);
    if (!slug) continue;
    const sourceClients = Array.isArray(raw.source_clients) ? raw.source_clients.map(x => line(x, 160)).filter(Boolean) : [];
    const prev = bySlug.get(slug);
    if (prev) {
      const merged = new Set([...(prev.source_clients as string[] || []), ...sourceClients]);
      prev.source_clients = Array.from(merged).sort((a, b) => a.localeCompare(b));
      prev.source_row_count = Number(prev.source_row_count || 0) + Number(raw.source_row_count || 1);
      if (!prev.email && raw.email) prev.email = line(raw.email, 180);
      continue;
    }
    bySlug.set(slug, {
      slug,
      name,
      email: line(raw.email, 180),
      active: raw.active !== false,
      source: line(raw.source || "google_sheet", 80),
      source_row_count: Number(raw.source_row_count || 1),
      source_clients: sourceClients,
      synced_at: now,
      updated_at: now,
    });
  }

  const rows = Array.from(bySlug.values());
  if (rows.length) {
    const { error } = await supabase
      .from("social_media_managers")
      .upsert(rows, { onConflict: "slug" });
    if (error) return json({ ok: false, error: error.message }, 500);
  }

  if (body.replace !== false && rows.length) {
    const slugs = rows.map(r => String(r.slug));
    const { data: existing } = await supabase
      .from("social_media_managers")
      .select("slug")
      .eq("active", true)
      .limit(1000);
    const stale = ((existing || []) as JsonMap[]).map(r => clean(r.slug)).filter(s => s && !slugs.includes(s));
    for (const slug of stale) {
      await supabase.from("social_media_managers").update({ active: false, synced_at: now, updated_at: now }).eq("slug", slug);
    }
  }

  return json({ ok: true, synced: rows.length, managers: rows.map(serializeManager) });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const action = clean(url.searchParams.get("action")) || "reports";
      if (action === "options") return await loadOptions();
      if (action === "reports") return await listReports(url);
      return json({ ok: false, error: "unknown action" }, 400);
    }

    if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
    const body = await req.json().catch(() => ({})) as JsonMap;
    const action = clean(body.action) || "submit";
    if (action === "submit") return await submitReport(req, body);
    if (action === "sync_managers") return await syncManagers(body);
    return json({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
