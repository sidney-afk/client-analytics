// Supabase Edge Function: client-token-verify
//
// Track B B0 verifier for SyncView client review links. During the permissive
// window, missing/invalid tokens are logged but allowed so existing links do
// not break. The single rollback/enforcement flip is syncview_runtime_flags
// auth_enforcement: {"mode":"permissive"|"enforced"}.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-client-token",
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

function normalizeClient(s: unknown): string {
  let t = clean(s).toLowerCase();
  try { t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_e) {}
  t = t.replace(/^dr\.?\s+/, "");
  t = t.replace(/\s+(?:and|&)\s+/g, "&");
  return t.replace(/[^a-z0-9&]+/g, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  const aa = TEXT.encode(a || "");
  const bb = TEXT.encode(b || "");
  let diff = aa.length ^ bb.length;
  const max = Math.max(aa.length, bb.length);
  for (let i = 0; i < max; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

function ipFrom(req: Request): string | null {
  const h = req.headers;
  const chain = h.get("x-forwarded-for") || h.get("x-real-ip") || h.get("cf-connecting-ip") || "";
  const first = chain.split(",")[0]?.trim();
  return first || null;
}

function userAgentFrom(req: Request): string | null {
  const ua = clean(req.headers.get("user-agent"));
  return ua ? ua.slice(0, 500) : null;
}

async function authMode(supabase: SupabaseClient): Promise<"permissive" | "enforced"> {
  const { data } = await supabase
    .from("syncview_runtime_flags")
    .select("value")
    .eq("key", "auth_enforcement")
    .maybeSingle();
  const raw = data && typeof data.value === "object" ? data.value as JsonMap : {};
  return clean(raw.mode).toLowerCase() === "enforced" ? "enforced" : "permissive";
}

async function logAttempt(
  supabase: SupabaseClient,
  req: Request,
  slug: string,
  ok: boolean,
  mode: string,
  reason: string,
): Promise<void> {
  await supabase.from("client_access_events").insert({
    slug: slug || null,
    ok,
    mode,
    reason,
    source: "client-token-verify",
    ip: ipFrom(req),
    user_agent: userAgentFrom(req),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ ok: false, error: "server_not_configured" }, 500);

    const body = await req.json().catch(() => ({})) as JsonMap;
    const slug = normalizeClient(body.slug || body.client_slug || body.client);
    const token = clean(body.token || req.headers.get("x-syncview-client-token"));
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const mode = await authMode(supabase);

    if (!slug) {
      const allowed = mode !== "enforced";
      await logAttempt(supabase, req, "", allowed, mode, "missing_slug");
      return json({ ok: allowed, valid: false, mode, reason: "missing_slug" }, allowed ? 200 : 410);
    }

    const { data, error } = await supabase
      .from("client_access")
      .select("slug,review_token")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;

    const stored = clean((data as JsonMap | null)?.review_token);
    const valid = !!stored && !!token && timingSafeEqual(token, stored);
    const reason = valid ? "valid" : (!stored ? "no_token_row" : (!token ? "missing_token" : "invalid_token"));
    const allowed = valid || mode !== "enforced";
    await logAttempt(supabase, req, slug, allowed, mode, reason);

    return json({
      ok: allowed,
      valid,
      mode,
      slug,
      reason,
      error: allowed ? undefined : "fresh_link_required",
    }, allowed ? 200 : 410);
  } catch (e) {
    console.error("client-token-verify failed", e);
    return json({ ok: false, error: "verify_failed" }, 500);
  }
});
