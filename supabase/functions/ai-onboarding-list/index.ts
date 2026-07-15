// Supabase Edge Function: ai-onboarding-list
//
// Read API for the dashboard's onboarding inbox (AI-avatar funnel). Reads
// public.ai_client_onboarding (service role; no anon access) and returns
// submissions with the account-credential fields STRIPPED. Contact and
// questionnaire data remains private behind the same admin-key gate as
// onboarding-full. Replaces the n8n `ai-onboarding-list` webhook.
//
// Deploy: supabase functions deploy ai-onboarding-list --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key",
  "Cache-Control": "no-store",
};

const STRIP = ["instagram", "instagram_backup", "tiktok", "facebook", "linkedin", "youtube"];

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function stripAnswers(a: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = (a && typeof a === "object") ? { ...(a as Record<string, unknown>) } : {};
  for (const k of STRIP) delete out[k];
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Keep this reader's authorization identical to onboarding-full. The
  // service-role client must never exist on an unauthenticated request path.
  const legacyKey = (Deno.env.get("ONBOARDING_STAFF_KEY") || Deno.env.get("CREDENTIALS_STAFF_KEY") || "").trim();
  const given = (req.headers.get("x-syncview-key") || "").trim();
  const auth = authorizeStaffKey(given, ["admin"], [legacyKey]);
  if (!auth.ok) return json({ ok: false, error: auth.role ? "forbidden" : "unauthorized" }, staffAuthFailureStatus(auth));

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase
    .from("ai_client_onboarding").select("*").order("created_at", { ascending: false });
  if (error) return json({ ok: false, error: error.message }, 500);
  const submissions = (data || []).filter((r) => r && r.id).map((r) => ({
    id: r.id,
    slug: r.slug || "",
    first_name: r.first_name || "",
    last_name: r.last_name || "",
    email: r.email || "",
    ai_avatar: r.ai_avatar || "yes",
    funnel: r.funnel || "ai",
    status: r.status || "",
    created_at: r.created_at || "",
    answers: stripAnswers(r.answers),
  }));
  return json({ ok: true, count: submissions.length, submissions });
});
