// Supabase Edge Function: syncview-session
//
// SyncView v2 sign-in. Design record: docs/ops/SYNCVIEW_SESSION.md.
// The project signs access tokens with asymmetric keys, so this function never
// signs anything itself. The browser first gets a Supabase guest (anonymous)
// login, then calls this function with that login plus exactly one SyncView
// credential: a staff role key (X-Syncview-Key) or a client share-link token
// (X-Syncview-Client-Token, body.client). Both are checked with the same shared
// code every writer uses. On success the guest's app_metadata is stamped with
// svc_scope / svc_client / svc_role; the browser refreshes its session and
// Supabase issues a token that carries them.
//
// v1 does not call this function, and it changes no table, rule or link. It
// writes one thing: that guest's row in auth.users (app_metadata).

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeBrowserWrite,
  browserWriteAuthResponse,
  normalizeBrowserWriteClient,
} from "../_shared/browser-write-auth.ts";
import { matchingRoleForKey } from "../_shared/staff-role-auth.ts";
import { bearerToken, guestRefusal, sessionClaims } from "../_shared/syncview-session-policy.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-client-token",
  "Cache-Control": "no-store",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return json({ ok: false, error: "service_unavailable" }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. The caller's own guest login.
  const jwt = bearerToken(req.headers.get("authorization"));
  if (!jwt) return json({ ok: false, error: "session_required" }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError) return json({ ok: false, error: "session_required" }, 401);
  const refusal = guestRefusal(userData?.user);
  if (refusal) return json({ ok: false, error: refusal }, refusal === "session_required" ? 401 : 403);
  const user = userData!.user!;

  // 2. Exactly one SyncView credential, checked by the shared writer auth.
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const hasStaffKey = !!String(req.headers.get("x-syncview-key") || "").trim();
  let principal: { kind: "staff" | "client"; role?: string; slug?: string };
  try {
    if (hasStaffKey) {
      // authorizeBrowserWrite needs a target client only for client tokens; for
      // a staff key any valid slug shape passes, so use a fixed placeholder.
      await authorizeBrowserWrite(admin, req, "session", "syncview-session");
      const role = matchingRoleForKey(String(req.headers.get("x-syncview-key") || "").trim());
      if (!role) return json({ ok: false, error: "invalid_staff_key" }, 401);
      principal = { kind: "staff", role };
    } else {
      const client = String(body.client || "").trim();
      await authorizeBrowserWrite(admin, req, client, "syncview-session");
      principal = { kind: "client", slug: normalizeBrowserWriteClient(client) };
    }
  } catch (error) {
    const mapped = browserWriteAuthResponse(error);
    if (mapped) return json({ ok: false, error: mapped.code }, mapped.status);
    return json({ ok: false, error: "authorization_unavailable" }, 503);
  }

  // 3. Stamp the guest. app_metadata is writable only with the service role.
  const claims = sessionClaims(principal, Date.now());
  if (!claims) return json({ ok: false, error: "authorization_unavailable" }, 503);
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { app_metadata: claims });
  if (updateError) return json({ ok: false, error: "session_unavailable" }, 503);

  return json({ ok: true, scope: claims.svc_scope, client: claims.svc_client || null, role: claims.svc_role || null, expires_at: claims.svc_expires_at, refresh: true });
});
