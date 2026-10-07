// Supabase Edge Function: tiktok-upload
//
// The TikTok side of the TikTok Upload tab, off n8n and off Google Sheets (OPEN_REPAIRS 362), built the way
// instagram-upload is. It holds the Post For Me key, keeps the queue in the table tiktok_uploads, and asks
// Post For Me how each post went. It replaces the n8n webhooks tiktok-upload-url, tiktok-upload-direct,
// tiktok-upload (the old in-band video upload), tiktok-uploads-list and tiktok-upload-status; Cancel is the
// tiktok-upload-cancel function. The page only calls this once syncview_runtime_flags.tiktok_upload_source
// reads {"source":"supabase"}.
//
//   POST { action: "mint" }                         { ok, upload_url, media_url }  one-time Post For Me storage URL
//   POST { action: "create", clientName, socialAccountId, title, options?, scheduledAtUTC?, timezone?,
//          idempotencyKey?, mediaUrl | mediaUrls }   { ok, id, status, scheduled_for, error?, row }
//   POST { action: "list" }                         { ok, rows }   newest first (scheduled time, else sent), 100
//   POST { action: "status", id }                   { ok, row, pfm }   pfm: { state: posted|failed|none|unknown }
//   POST { action: "retry", id }                    { ok, row }    a failed post, sent again from its kept request
//   POST { action: "import_sheet", dry_run? }       { ok, counts }  ADMIN key only: the one-time copy of the
//                                                                   TikTokUpload tab; rows already here are kept
//
// Safety: a staff role key is required; the account must be the one on file for that client (synced Clients
// Info, client_profiles.postforme_account_id) and Post For Me itself must say it is a TikTok account.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POST_FOR_ME_API_KEY, a staff role key secret
// (ROLE_KEY_ADMIN / ROLE_KEY_SMM / ROLE_KEY_CREATIVE). For import_sheet only: a Google service account
// (GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY) that can read the Sheet, and its id
// in TIKTOK_UPLOADS_SHEET_ID (falls back to CLIENTS_INFO_SHEET_ID). No Sheet id is in this repository.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import { googleToken, serviceAccount } from "../_shared/roster-sheet-copy.mjs";
import { sheetRange } from "../_shared/roster-native.mjs";
import { SHEET_TAB } from "../_shared/tiktok-queue.mjs";
import { handleTiktokUpload } from "./handler.mjs";

const PFM = "https://api.postforme.dev/v1";
const PFM_TIMEOUT_MS = 25000;
// Only the columns the queue keeps (sort_at is computed by the database).
const SAVE_COLUMNS = ["status", "upload_post_id", "tiktok_url", "error", "posted_at", "updated_at", "last_checked_at", "scheduled_for", "post_body"];

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

// One call to Post For Me. Never throws: a network failure is reported as { ok:false, status:0 }.
function pfmClient(key: string) {
  return async (method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> => {
    try {
      const resp = await fetch(PFM + path, {
        method,
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(PFM_TIMEOUT_MS),
      });
      const data = await resp.json().catch(() => ({}));
      return { ok: resp.ok, status: resp.status, data };
    } catch {
      return { ok: false, status: 0, data: {} };
    }
  };
}

function tableStore(db: any) {
  const fail = (error: any) => { if (error) throw error; };
  return {
    async get(id: string) {
      const { data, error } = await db.from("tiktok_uploads").select("*").eq("id", id).maybeSingle();
      fail(error);
      return data;
    },
    async insert(row: any) {
      const { error } = await db.from("tiktok_uploads").insert(row);
      fail(error);
    },
    async save(row: any) {
      const patch: Record<string, unknown> = {};
      for (const k of SAVE_COLUMNS) if (k in row) patch[k] = row[k] ?? null;
      const { error } = await db.from("tiktok_uploads").update(patch).eq("id", row.id);
      fail(error);
    },
    async list(limit: number) {
      const { data, error } = await db.from("tiktok_uploads").select("*").order("sort_at", { ascending: false }).limit(limit);
      fail(error);
      return data || [];
    },
    async profiles() {
      const { data, error } = await db.from("client_profiles").select("slug,display_name,postforme_account_id").is("archived_at", null);
      fail(error);
      return data || [];
    },
    async copy(rows: any[]) {
      // Rows already in the table win: they are newer than the Sheet once the page uses the table.
      const { data, error } = await db.from("tiktok_uploads").upsert(rows, { onConflict: "id", ignoreDuplicates: true }).select("id");
      fail(error);
      return (data || []).length;
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const pfmKey = Deno.env.get("POST_FOR_ME_API_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);

  const auth = authorizeStaffKey(clean(req.headers.get("x-syncview-key")), ["admin", "smm", "creative"]);
  if (!auth.ok) return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (clean(body.action) !== "import_sheet" && !pfmKey) return json({ ok: false, error: "Post For Me key is not set on the server (POST_FOR_ME_API_KEY)" }, 500);

  const readSheet = async () => {
    const sa = serviceAccount(Deno.env);
    const sheetId = clean(Deno.env.get("TIKTOK_UPLOADS_SHEET_ID")) || clean(Deno.env.get("CLIENTS_INFO_SHEET_ID"));
    if (!sa || !sheetId) return null;
    const token = await googleToken(sa, fetch);
    const resp = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(sheetId) + "/values/" +
      encodeURIComponent(sheetRange(SHEET_TAB, "A1:Z")) + "?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS",
      { headers: { Authorization: "Bearer " + token } });
    if (!resp.ok) throw new Error("sheet_read_failed_" + resp.status);
    return ((await resp.json()) as any).values || [];
  };

  try {
    const out = await handleTiktokUpload({
      body,
      role: auth.role,
      actor: clean(req.headers.get("x-syncview-actor")) || auth.role || "staff",
      pfm: pfmClient(pfmKey),
      store: tableStore(createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })),
      readSheet,
    });
    return json(out.body, out.status);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
