// Supabase Edge Function: templates-save
//
// A4 port of the SyncView Templates settings writer. Browser calls are routed
// here only by the settings_ef_clients runtime flag; the n8n Sheets writer
// remains the fallback/default.
//
// Required env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source",
  "Cache-Control": "no-store",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function actorFrom(req: Request): { actor: string | null; role: string | null; source: string } {
  return {
    actor: clean(req.headers.get("x-syncview-actor")) || null,
    role: clean(req.headers.get("x-syncview-role")) || null,
    source: clean(req.headers.get("x-syncview-source")).toLowerCase() || "settings",
  };
}

function slug(name: unknown): string {
  let s = clean(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/^dr\.?\s+/, "");
  s = s.replace(/\s+(?:and|&)\s+/g, "&");
  s = s.replace(/[^a-z0-9&]+/g, "");
  return s;
}

function patchObject(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!k || k === "client_slug" || k === "updated_at") continue;
    out[k] = String(val == null ? "" : val);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const clientName = clean(body.clientName);
    const clientSlug = slug(clientName);
    if (!clientName || !clientSlug) return json({ ok: false, error: "clientName required" }, 400);

    const patch = patchObject(body.patch);
    const actor = actorFrom(req);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);

    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: existing, error: readError } = await db
      .from("templates")
      .select("data")
      .eq("client_slug", clientSlug)
      .maybeSingle();
    if (readError) throw readError;

    const now = new Date().toISOString();
    const prev = existing && existing.data && typeof existing.data === "object" ? existing.data as Record<string, unknown> : {};
    const next: Record<string, string> = { ...Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, String(v == null ? "" : v)])), client_name: clientName, ...patch };

    const { data: saved, error: saveError } = await db
      .from("templates")
      .upsert({
        client_slug: clientSlug,
        data: next,
        updated_at: now,
        updated_by: actor.actor || "syncview",
      }, { onConflict: "client_slug" })
      .select("data,updated_at")
      .single();
    if (saveError) throw saveError;

    const { error: eventError } = await db.from("settings_events").insert({
      surface: "templates",
      client_slug: clientSlug,
      actor: actor.actor,
      role: actor.role,
      action: "save",
      source: actor.source,
      payload: { changed_keys: Object.keys(patch).sort() },
    });
    if (eventError) throw eventError;

    const data = saved && saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : next;
    return json({ ok: true, template: { ...data, updated_at: saved?.updated_at || now } });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
