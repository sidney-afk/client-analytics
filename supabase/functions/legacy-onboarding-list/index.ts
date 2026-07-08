// Supabase Edge Function: legacy-onboarding-list
//
// Read API for the dashboard's "Old forms" section. Reads public.legacy_onboarding
// (service role; no anon access) — the historical Notion intake, migrated as-is —
// and returns each client's original question->answer list (`fields`). The
// `credentials` column is NEVER included here; only the Kasper-gated
// `onboarding-full` function returns it. Replaces the n8n `legacy-onboarding-list`
// webhook.
//
// Deploy: supabase functions deploy legacy-onboarding-list --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase
    .from("legacy_onboarding").select("id,slug,first_name,last_name,email,phone,submitted_on,created_at,fields")
    .order("created_at", { ascending: false });
  if (error) return json({ ok: false, error: error.message }, 500);
  const submissions = (data || []).filter((r) => r && r.id).map((r) => ({
    id: r.id,
    slug: r.slug || "",
    first_name: r.first_name || "",
    last_name: r.last_name || "",
    email: r.email || "",
    phone: r.phone || "",
    submitted_on: r.submitted_on || "",
    created_at: r.created_at || "",
    fields: Array.isArray(r.fields) ? r.fields : [],
  }));
  return json({ ok: true, count: submissions.length, submissions });
});
