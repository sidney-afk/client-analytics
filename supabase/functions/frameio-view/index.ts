// Supabase Edge Function: frameio-view
//
// "Watch here" in SyncView: from a card's Frame.io link, a fresh playable video address and the video's comments,
// read from Frame.io's V4 API. Read-only. Replying stays in Frame.io, and nothing is copied into our database.
//
//   POST { link }  header X-Syncview-Key: a staff role key
//     -> 200 { ok:true, video:{ url, expires_at, name, file_id, duration_seconds, fps },
//              comments:[{ id, time_seconds, frame, text, author, guest, created_at, done, replies:[...] }],
//              comments_error, comments_truncated, reply_names_partial, open_url, fetched_at }
//     -> { ok:false, error:<code>, message:<plain sentence> }   unsupported_link 422, link_not_found 404, share_off 404,
//        share_expired 404, empty_share 404, not_video 415, still_processing 409, frameio_login_needed 503,
//        frameio_busy 429, frameio_unavailable 502, timeout 504, unauthorized 401/403, staff_only 403
//
// Staff only: the key must match a staff role key (admin, smm or creative). The browser's public key is not enough,
// and a client review link (X-Syncview-Client-Token) is refused outright. The Adobe access token comes from the
// frameio-token key keeper and is never returned or logged. Nothing is written anywhere.
//
// Env: SUPABASE_URL, the staff role key secrets, FRAMEIO_BROKER_KEY and FRAMEIO_CLIENT_ID (the same secrets
// frameio-token uses). Logs only step names and status codes: never a link, a file name, a comment or an address.

import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import { lookup, tokenSource, ViewError } from "./logic.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};
const clean = (v: unknown): string => String(v == null ? "" : v).trim();
const env = (k: string): string => clean(Deno.env.get(k));
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

let tokens: ReturnType<typeof tokenSource> | null = null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (req.headers.get("x-syncview-client-token")) return json({ ok: false, error: "staff_only" }, 403);

  const auth = authorizeStaffKey(clean(req.headers.get("x-syncview-key")), ["admin", "smm", "creative"]);
  if (!auth.ok) return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));

  const supabaseUrl = env("SUPABASE_URL").replace(/\/+$/, "");
  const brokerKey = env("FRAMEIO_BROKER_KEY");
  const clientId = env("FRAMEIO_CLIENT_ID");
  if (!supabaseUrl || brokerKey.length < 32 || !clientId) {
    return json({ ok: false, error: "not_configured", message: "The Frame.io connection is not set up on the server." }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const link = clean(body && body.link);
  if (!link || link.length > 2000) return json({ ok: false, error: "unsupported_link", message: "Send the card's Frame.io link." }, 400);

  if (!tokens) {
    tokens = tokenSource({ fetchFn: fetch, brokerUrl: supabaseUrl + "/functions/v1/frameio-token", brokerKey });
  }
  try {
    const out = await lookup(link, { fetchFn: fetch, getToken: () => tokens!.get(), dropToken: () => tokens!.drop(), clientId, now: Date.now });
    return json(out, 200);
  } catch (e) {
    if (e instanceof ViewError) {
      console.warn("frameio-view refused", e.code);
      return json({ ok: false, error: e.code, message: e.message }, e.status);
    }
    console.error("frameio-view failed", e instanceof Error ? e.name : "error");
    return json({ ok: false, error: "frameio_unavailable", message: "Frame.io did not answer. Try again in a minute." }, 502);
  }
});
