// Supabase Edge Function: tiktok-upload-cancel
//
// The Cancel button on the TikTok Upload tab. It replaces the n8n webhook tiktok-upload-cancel, which only
// marked the queue row cancelled and never told Post For Me, so the post still went out.
//
//   POST { id }   ->  200 { ok:true,  code:"cancelled" | "already_cancelled", message, row? }
//                     409 { ok:false, code:"already_posted", message:"Already posted, could not cancel." }
//                     502 { ok:false, code:"cancel_failed" | "queue_update_failed", message:"Cancel failed, try again." }
//
// Order (logic.mjs): find the row (the table tiktok_uploads first, then the TikTokUpload Sheet tab for a row the
// table does not have yet), delete the post in Post For Me, read it back to prove it is gone, and only then
// mark that row cancelled. Any doubt leaves the row as it was.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POST_FOR_ME_API_KEY, a staff role key secret
// (ROLE_KEY_ADMIN / ROLE_KEY_SMM / ROLE_KEY_CREATIVE). Optional, for the Sheet fallback: a Google service account
// (GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY) with edit access to the Sheet holding
// the TikTokUpload tab, and that Sheet's id in TIKTOK_UPLOADS_SHEET_ID (falls back to CLIENTS_INFO_SHEET_ID).
// No Sheet id is in this repository.

import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import { googleToken, serviceAccount } from "../_shared/roster-sheet-copy.mjs";
import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { cancelTiktokUpload, firstQueue, sheetQueue, tableQueue } from "./logic.mjs";

const PFM = "https://api.postforme.dev/v1";
const PFM_TIMEOUT_MS = 25000;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source",
  "Cache-Control": "no-store",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const clean = (v: unknown): string => String(v == null ? "" : v).trim();

// One call to Post For Me. Never throws: a network failure or timeout is { ok:false, status:0 }.
function pfmClient(key: string) {
  return async (method: string, path: string): Promise<{ ok: boolean; status: number; data: any }> => {
    try {
      const resp = await fetch(PFM + path, {
        method,
        headers: { Authorization: "Bearer " + key, Accept: "application/json" },
        signal: AbortSignal.timeout(PFM_TIMEOUT_MS),
      });
      const data = await resp.json().catch(() => ({}));
      return { ok: resp.ok, status: resp.status, data };
    } catch {
      return { ok: false, status: 0, data: {} };
    }
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const auth = authorizeStaffKey(clean(req.headers.get("x-syncview-key")), ["admin", "smm", "creative"]);
  if (!auth.ok) return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));

  const pfmKey = clean(Deno.env.get("POST_FOR_ME_API_KEY"));
  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!pfmKey || !supabaseUrl || !serviceKey) {
    return json({ ok: false, code: "not_configured", message: "Cancel is not set up on the server.", missing: { post_for_me: !pfmKey, database: !supabaseUrl || !serviceKey } }, 500);
  }
  // The Sheet is only the fallback for rows the table does not have yet (before the switch to the table).
  const sa = serviceAccount(Deno.env);
  const sheetId = clean(Deno.env.get("TIKTOK_UPLOADS_SHEET_ID")) || clean(Deno.env.get("CLIENTS_INFO_SHEET_ID"));

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const sheet = sa && sheetId ? {
      find: async (rowId: string) => sheetQueue({ sheetId, token: await googleToken(sa, fetch), fetchFn: fetch }).find(rowId),
      markCancelled: async (found: any, nowIso: string) => sheetQueue({ sheetId, token: await googleToken(sa, fetch), fetchFn: fetch }).markCancelled(found, nowIso),
    } : null;
    const out = await cancelTiktokUpload({
      id: body.id,
      pfm: pfmClient(pfmKey),
      queue: firstQueue([tableQueue(db), sheet]),
      nowIso: new Date().toISOString(),
    });
    return json(out.body, out.status);
  } catch (e) {
    // The queue could not be read, so nothing was cancelled anywhere.
    return json({ ok: false, code: "cancel_failed", message: "Cancel failed, try again.", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});
