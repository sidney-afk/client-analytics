// Supabase Edge Function: client-review-link
//
// Returns one client-scoped review token to a currently authenticated Admin or
// SMM at the moment they copy a client link. Review tokens remain readable only
// with the service role; they must never transit the public Clients Info CSV.
// Do not log request/response bodies here: the successful response is secret.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { matchingRoleForKey, type StaffRoleKey } from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-syncview-key, x-syncview-actor",
  "Cache-Control": "no-store, private",
  "Pragma": "no-cache",
};

type JsonMap = Record<string, unknown>;
type Member = {
  id: string;
  name: string;
  role: string;
  active: boolean;
};

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function normalizeClient(value: unknown): string {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_error) {}
  text = text.replace(/^dr\.?\s+/, "");
  text = text.replace(/\s+(?:and|&)\s+/g, "&");
  return text.replace(/[^a-z0-9&]+/g, "");
}

function normalizeActor(value: unknown): string {
  let text = clean(value).toLowerCase();
  try { text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_error) {}
  return text.replace(/[^a-z0-9]+/g, "");
}

function roleCompatible(role: StaffRoleKey, member: Member): boolean {
  if (role === "admin") return clean(member.role).toLowerCase() === "admin";
  if (role === "smm") return clean(member.role).toLowerCase() === "smm";
  return false;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const url = clean(Deno.env.get("SUPABASE_URL"));
    const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);

    const body = await req.json().catch(() => ({})) as JsonMap;
    const key = clean(req.headers.get("x-syncview-key"));
    const actor = clean(req.headers.get("x-syncview-actor"));
    const memberId = clean(body.member_id);
    const slug = normalizeClient(body.slug || body.client);
    if (!key) return json({ ok: false, error: "credentials_required" }, 401);

    const keyRole = matchingRoleForKey(key);
    if (!keyRole) return json({ ok: false, error: "invalid_staff_key" }, 401);
    if (keyRole !== "admin" && keyRole !== "smm") {
      return json({ ok: false, error: "staff_role_forbidden" }, 403);
    }
    if (!actor || !memberId) return json({ ok: false, error: "roster_actor_required" }, 403);
    if (!slug) return json({ ok: false, error: "client_required" }, 400);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: memberData, error: memberError } = await supabase.from("team_members")
      .select("id,name,role,active")
      .eq("id", memberId)
      .eq("active", true)
      .maybeSingle();
    if (memberError) return json({ ok: false, error: "roster_lookup_unavailable" }, 503);
    const member = memberData as Member | null;
    if (!member || normalizeActor(member.name) !== normalizeActor(actor) || !roleCompatible(keyRole, member)) {
      return json({ ok: false, error: "roster_actor_mismatch" }, 403);
    }

    const { data: clientData, error: clientError } = await supabase.from("clients")
      .select("slug,active")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();
    if (clientError) return json({ ok: false, error: "client_lookup_unavailable" }, 503);
    if (!clientData) return json({ ok: false, error: "client_not_found" }, 404);

    const { data: accessData, error: accessError } = await supabase.from("client_access")
      .select("review_token")
      .eq("slug", slug)
      .maybeSingle();
    if (accessError) return json({ ok: false, error: "token_lookup_unavailable" }, 503);
    const token = clean((accessData as JsonMap | null)?.review_token);
    if (!token) return json({ ok: false, error: "review_token_missing" }, 404);

    return json({ ok: true, slug, token });
  } catch (_error) {
    // Never include the exception or request body in logs: either can contain
    // sensitive request context. The caller receives only an opaque code.
    return json({ ok: false, error: "review_link_failed" }, 500);
  }
});
