// Supabase Edge Function: quiz-leads-list
//
// Read API for the Kasper "Quiz Leads" tab. Reads public.quiz_responses
// (service role; the table has no anon access) and returns every response,
// newest first. Admin-only (decision log, 2026-08-24) — quiz answers carry
// less sensitivity than onboarding's stored credentials, but access is
// still scoped the same way Time Off's pto-admin capability is, not opened
// to every role like the Onboarding inbox.
//
// Deploy: supabase functions deploy quiz-leads-list --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected; no secrets needed.)

import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const given = (req.headers.get("x-syncview-key") || "").trim();
  const auth = authorizeStaffKey(given, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.role ? "forbidden" : "unauthorized" }, staffAuthFailureStatus(auth));

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase
    .from("quiz_responses").select("*").order("created_at", { ascending: false });
  if (error) return json({ ok: false, error: error.message }, 500);

  const leads = (data || []).filter((r) => r && r.response_id).map((r) => ({
    response_id: r.response_id,
    quiz_slug: r.quiz_slug || "",
    contact_name: r.contact_name || "",
    contact_email: r.contact_email || "",
    answers: r.answers || {},
    result_category: r.result_category || "",
    result_scores: r.result_scores || {},
    headline_variant: r.headline_variant || "",
    utm_source: r.utm_source || "",
    utm_medium: r.utm_medium || "",
    utm_campaign: r.utm_campaign || "",
    utm_content: r.utm_content || "",
    utm_term: r.utm_term || "",
    fbclid: r.fbclid || "",
    referrer: r.referrer || "",
    created_at: r.created_at || "",
  }));
  return json({ ok: true, count: leads.length, leads });
});
