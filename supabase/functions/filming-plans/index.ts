// Supabase Edge Function: filming-plans
//
// Source-of-truth gateway for client master filming-plan Google Docs.
// Reads are public through RLS, but writes require the onboarding staff
// passphrase in X-Syncview-Key. Do not accept CREDENTIALS_STAFF_KEY here:
// only Sidney/Kasper onboarding staff should change master-doc links.
//
// Required env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ONBOARDING_STAFF_KEY

import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};

const TEXT = new TextEncoder();

type JsonMap = Record<string, unknown>;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function slug(name: unknown): string {
  let s = clean(name).toLowerCase();
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_e) {}
  s = s.replace(/^dr\.?\s+/, "");
  s = s.replace(/\s+(?:and|&)\s+/g, "&");
  return s.replace(/[^a-z0-9&]+/g, "");
}

function docId(url: string): string {
  const m = clean(url).match(/\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : "";
}

function timingSafeEqual(a: string, b: string): boolean {
  const aa = TEXT.encode(a || "");
  const bb = TEXT.encode(b || "");
  let diff = aa.length ^ bb.length;
  const max = Math.max(aa.length, bb.length);
  for (let i = 0; i < max; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

function requireOnboardingKey(req: Request): Response | null {
  const expected = clean(Deno.env.get("ONBOARDING_STAFF_KEY"));
  if (!expected) return json({ ok: false, error: "onboarding key not configured" }, 500);
  const supplied = clean(req.headers.get("x-syncview-key"));
  if (!supplied || !timingSafeEqual(supplied, expected)) return json({ ok: false, error: "unauthorized" }, 401);
  return null;
}

function serialize(row: JsonMap): JsonMap {
  return {
    client_slug: row.client_slug || "",
    client_name: row.client_name || "",
    doc_url: row.doc_url || "",
    doc_id: row.doc_id || "",
    notes: row.notes || "",
    plan_months: row.plan_months || "",
    updated_at: row.updated_at || "",
    updated_by: row.updated_by || "",
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);

    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    if (req.method === "GET") {
      const { data, error } = await db
        .from("filming_plans")
        .select("client_slug,client_name,doc_url,doc_id,notes,plan_months,updated_at,updated_by")
        .order("client_name", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return json({ ok: true, plans: (data || []).map(serialize) });
    }

    const authError = requireOnboardingKey(req);
    if (authError) return authError;

    const body = await req.json().catch(() => ({})) as JsonMap;
    const clientName = clean(body.clientName || body.client_name);
    const clientSlug = slug(body.clientSlug || body.client_slug || clientName);
    const docUrl = clean(body.docUrl || body.doc_url);
    const notes = clean(body.notes);
    const planMonths = clean(body.planMonths || body.plan_months);
    const actor = clean(req.headers.get("x-syncview-actor")) || clean(body.actor) || "onboarding-staff";

    if (!clientName || !clientSlug) return json({ ok: false, error: "clientName required" }, 400);
    if (!docUrl) return json({ ok: false, error: "docUrl required" }, 400);
    if (!/^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+/i.test(docUrl)) {
      return json({ ok: false, error: "Use a Google Docs document link" }, 400);
    }

    const now = new Date().toISOString();
    const { data, error } = await db
      .from("filming_plans")
      .upsert({
        client_slug: clientSlug,
        client_name: clientName,
        doc_url: docUrl,
        doc_id: docId(docUrl),
        notes,
        plan_months: planMonths,
        updated_at: now,
        updated_by: actor,
      }, { onConflict: "client_slug" })
      .select("client_slug,client_name,doc_url,doc_id,notes,plan_months,updated_at,updated_by")
      .single();
    if (error) throw error;

    return json({ ok: true, plan: serialize(data as JsonMap) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
