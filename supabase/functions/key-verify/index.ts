// Supabase Edge Function: key-verify
//
// Track B B0 role-key verifier. The browser stores a role key locally and
// sends it as X-Syncview-Key; this function resolves the chosen team member
// and records verification attempts. Write-time enforcement remains controlled
// by syncview_runtime_flags.auth_enforcement.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { matchingRoleForKey, type StaffRoleKey } from "../_shared/staff-role-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor",
  "Cache-Control": "no-store",
};

type JsonMap = Record<string, unknown>;
type Member = {
  id: string;
  name: string;
  email: string | null;
  role: "admin" | "smm" | "editor" | "designer";
  team: "video" | "graphics" | null;
  active: boolean;
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

function norm(s: unknown): string {
  let t = clean(s).toLowerCase();
  try { t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_e) {}
  return t.replace(/[^a-z0-9@.]+/g, "");
}

function roleCompatible(keyRole: StaffRoleKey, member: Member): boolean {
  if (keyRole === "admin") return member.role === "admin";
  if (keyRole === "smm") return member.role === "smm";
  return member.role === "editor" || member.role === "designer";
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

async function resolveMember(supabase: SupabaseClient, body: JsonMap, req: Request): Promise<Member | null> {
  const raw = body.member && typeof body.member === "object" ? body.member as JsonMap : body;
  const id = clean(raw.id || raw.member_id);
  const name = clean(raw.name || raw.actor || req.headers.get("x-syncview-actor"));
  const email = clean(raw.email);

  let rows: Member[] = [];
  if (id) {
    const { data, error } = await supabase.from("team_members").select("*").eq("id", id).eq("active", true).limit(1);
    if (error) throw error;
    rows = (data || []) as Member[];
  } else {
    const { data, error } = await supabase.from("team_members").select("*").eq("active", true);
    if (error) throw error;
    const targetName = norm(name);
    const targetEmail = norm(email);
    rows = ((data || []) as Member[]).filter(m => {
      if (targetEmail && norm(m.email) === targetEmail) return true;
      return !!targetName && norm(m.name) === targetName;
    });
  }
  return rows[0] || null;
}

async function logAuth(
  supabase: SupabaseClient,
  surface: string,
  actor: string | null,
  role: string | null,
  ok: boolean,
  mode: string,
  reason: string,
  payload?: JsonMap,
): Promise<void> {
  await supabase.from("syncview_auth_events").insert({
    surface,
    actor,
    role,
    ok,
    mode,
    reason,
    source: "key-verify",
    payload: payload || null,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);

    const body = await req.json().catch(() => ({})) as JsonMap;
    const key = clean(req.headers.get("x-syncview-key") || body.key);
    const surface = clean(body.surface) || "syncview";
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const mode = await authMode(supabase);
    const role = matchingRoleForKey(key);
    const member = role ? await resolveMember(supabase, body, req) : null;
    const compatible = !!role && !!member && roleCompatible(role, member);
    const reason = compatible ? "valid" : (!role ? "invalid_key" : (!member ? "member_not_found" : "role_mismatch"));
    const actor = member ? member.name : clean(body.name || body.actor || req.headers.get("x-syncview-actor")) || null;

    await logAuth(supabase, surface, actor, role, compatible, mode, reason, {
      member_id: member ? member.id : null,
      member_role: member ? member.role : null,
      member_team: member ? member.team : null,
    });

    if (!compatible) {
      return json({ ok: false, mode, reason, error: "key_not_valid" }, 401);
    }

    return json({
      ok: true,
      mode,
      role,
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        team: member.team,
      },
    });
  } catch (e) {
    console.error("key-verify failed", e);
    return json({ ok: false, error: "verify_failed" }, 500);
  }
});
