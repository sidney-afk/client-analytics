import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeBrowserWrite, normalizeBrowserWriteClient } from "../_shared/browser-write-auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const slug = normalizeBrowserWriteClient(body.client || body.slug);
    if (!slug) return json({ ok: false, error: "invalid_client" }, 400);
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ ok: false, error: "service_unavailable" }, 503);
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const principal = await authorizeBrowserWrite(supabase, req, slug, "client-review-link");
    if (principal.kind !== "staff") return json({ ok: false, error: "staff_required" }, 403);
    const { data: client, error: clientError } = await supabase.from("clients").select("slug,active").eq("slug", slug).maybeSingle();
    if (clientError) return json({ ok: false, error: "authorization_unavailable" }, 503);
    if (!client || client.active !== true) return json({ ok: false, error: "inactive_client" }, 410);
    const { data, error } = await supabase.from("client_access").select("review_token").eq("slug", slug).maybeSingle();
    if (error) return json({ ok: false, error: "authorization_unavailable" }, 503);
    const token = String(data?.review_token || "").trim();
    if (!token) return json({ ok: false, error: "review_token_missing" }, 409);
    return json({ ok: true, client: slug, token });
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 500);
    const code = String((error as { code?: string })?.code || "request_failed");
    return json({ ok: false, error: code }, status);
  }
});
