// Supabase Edge Function: onboarding-capture
//
// Backup capture endpoint for the SyncView onboarding forms (see
// ONBOARDING_FALLBACK.md). The form calls this when the primary n8n submit
// webhook fails, for throttled draft backups, and with a `submitted` marker
// after a primary success. Runs on Supabase's edge — different infrastructure
// and domain than n8n, so it survives n8n outages and *.n8n.cloud adblock
// rules. Writes to public.onboarding_fallback (service role; the table has no
// anon access — run onboarding-fallback-supabase-migration.sql first).
//
// Deploy:  supabase functions deploy onboarding-capture --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected; no secrets needed.
//  Optional: `supabase secrets set SLACK_ALERT_WEBHOOK=<slack incoming-webhook url>`
//  to get pinged when a real fallback capture lands here.)

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  // Accepts application/json fetches AND text/plain sendBeacon bodies.
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(await req.text());
  } catch (_e) {
    body = null;
  }
  if (!body || typeof body !== "object") return json({ ok: false, error: "invalid body" }, 400);

  const p = (body.submission || body.draft || {}) as Record<string, unknown>;
  const id = String(body.id || p.id || "").trim();
  if (!id) return json({ ok: false, error: "id required" }, 400);

  let kind = String(body.kind || "").trim();
  if (!kind) kind = body.submission ? "submit-fallback" : (body.draft ? "draft" : "unknown");
  const answers = (p.answers && typeof p.answers === "object")
    ? p.answers as Record<string, unknown>
    : (body.draft ? p : {});
  const funnel = String(body.funnel || p.funnel || "").trim();
  const first = String(p.first_name || answers.first_name || "").trim();
  const last = String(p.last_name || answers.last_name || "").trim();
  const email = String(p.email || answers.email || "").trim();
  const hasPayload = !!((body.submission && typeof body.submission === "object") ||
    (body.draft && typeof body.draft === "object"));
  const now = new Date().toISOString();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase.from("onboarding_fallback").upsert({
    id,
    kind,
    funnel,
    client_name: (first + " " + last).trim(),
    email,
    payload: hasPayload ? p : null,
    note: String(body.note || ""),
    created_at: now,
    updated_at: now,
  }, { onConflict: "id" });
  if (error) return json({ ok: false, error: error.message }, 500);

  if (kind === "submit-fallback") {
    const hook = Deno.env.get("SLACK_ALERT_WEBHOOK");
    if (hook) {
      try {
        await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: "🛟 Onboarding fallback capture (edge): " + (first + " " + last).trim() +
              " <" + email + "> funnel=" + funnel + " id=" + id +
              " — full answers are in Supabase onboarding_fallback. " + String(body.note || ""),
          }),
        });
      } catch (_e) { /* alert is fail-soft — the capture is already stored */ }
    }
  }

  return json({ ok: true, id, kind }, 200);
});
