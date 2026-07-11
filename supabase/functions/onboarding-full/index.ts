// Supabase Edge Function: onboarding-full  (ADMIN-ONLY)
//
// Full onboarding view for Kasper — returns EVERYTHING across all three
// onboarding sources with NOTHING stripped: names, emails, phones, and the
// account credentials. Because this exposes passwords, it accepts only the admin
// role key, plus the historical onboarding passphrase during migration, sent in
// X-Syncview-Key and checked server-side. The public anon key still can't touch
// these tables; only this service-role function can, and only with an allowed key.
//
// Sources:
//   - public.client_onboarding      (standard funnel) -> full `answers`
//   - public.ai_client_onboarding   (AI funnel)       -> full `answers`
//   - public.legacy_onboarding      (old Notion forms) -> `fields` + `credentials`
//
// Deploy:
//   Keep ONBOARDING_STAFF_KEY/CREDENTIALS_STAFF_KEY unchanged during migration.
//   supabase functions deploy onboarding-full --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key",
  "Cache-Control": "no-store",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Admin role keys are the primary path. Preserve the exact legacy fallback:
  // ONBOARDING_STAFF_KEY wins when configured; otherwise use CREDENTIALS_STAFF_KEY.
  // SMM/creative keys stay denied regardless of any caller-supplied role header.
  const legacyKey = (Deno.env.get("ONBOARDING_STAFF_KEY") || Deno.env.get("CREDENTIALS_STAFF_KEY") || "").trim();
  const given = (req.headers.get("x-syncview-key") || "").trim();
  const auth = authorizeStaffKey(given, ["admin"], [legacyKey]);
  if (!auth.ok) return json({ ok: false, error: auth.role ? "forbidden" : "unauthorized" }, staffAuthFailureStatus(auth));

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [std, ai, legacy] = await Promise.all([
    supabase.from("client_onboarding").select("*").order("created_at", { ascending: false }),
    supabase.from("ai_client_onboarding").select("*").order("created_at", { ascending: false }),
    supabase.from("legacy_onboarding").select("*").order("created_at", { ascending: false }),
  ]);

  const submissions: Record<string, unknown>[] = [];
  (std.data || []).forEach((r) => {
    if (!r || !r.id) return;
    const a = (r.answers && typeof r.answers === "object") ? r.answers : {};
    submissions.push({
      funnel: "standard", id: r.id, slug: r.slug || "",
      first_name: r.first_name || "", last_name: r.last_name || "",
      email: r.email || "", phone: r.phone || a.phone || "",
      ai_avatar: r.ai_avatar || "", status: r.status || "",
      created_at: r.created_at || "", answers: a,
    });
  });
  (ai.data || []).forEach((r) => {
    if (!r || !r.id) return;
    const a = (r.answers && typeof r.answers === "object") ? r.answers : {};
    submissions.push({
      funnel: "ai", id: r.id, slug: r.slug || "",
      first_name: r.first_name || "", last_name: r.last_name || "",
      email: r.email || "", phone: r.phone || a.phone || "",
      ai_avatar: r.ai_avatar || "yes", status: r.status || "",
      created_at: r.created_at || "", answers: a,
    });
  });
  (legacy.data || []).forEach((r) => {
    if (!r || !r.id) return;
    submissions.push({
      funnel: "legacy", id: r.id, slug: r.slug || "",
      first_name: r.first_name || "", last_name: r.last_name || "",
      email: r.email || "", phone: r.phone || "",
      submitted_on: r.submitted_on || "", created_at: r.created_at || "",
      fields: Array.isArray(r.fields) ? r.fields : [],
      credentials: Array.isArray(r.credentials) ? r.credentials : [],
    });
  });

  const warnings = [std.error, ai.error, legacy.error].filter(Boolean).map((e) => e!.message);
  return json({ ok: true, count: submissions.length, submissions, warnings });
});
