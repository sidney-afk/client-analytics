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
//   POST { action: "refresh_due" }                  { ok, checked, still_open, posted, failed }   the safety net, on demand
//   POST { action: "webhook_status" | "webhook_register" | "webhook_remove", id? }   ADMIN key only: Post For Me's
//                                                   webhooks (ids, urls, events; never secrets)
//   POST ?pfm_webhook=1  { event_type, data }       Post For Me's result webhook: NO staff key; the header
//                                                   Post-For-Me-Webhook-Secret must match (OPEN_REPAIRS 370)
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
import { OPEN, SHEET_TAB, WEBHOOK_HEADER, webhookFor } from "../_shared/tiktok-queue.mjs";
import { handleResultWebhook, handleTiktokUpload } from "./handler.mjs";

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
    async dueOpen(limit: number) {
      // Open rows whose time has come (or that have no time), least recently asked first.
      const { data, error } = await db.from("tiktok_uploads").select("*").in("status", OPEN)
        .or("scheduled_for.is.null,scheduled_for.lte." + new Date().toISOString())
        .order("last_checked_at", { ascending: true, nullsFirst: true }).limit(limit);
      fail(error);
      return data || [];
    },
    async byPostId(postId: string) {
      const { data, error } = await db.from("tiktok_uploads").select("*").eq("upload_post_id", postId).limit(1);
      fail(error);
      return (data && data[0]) || null;
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

// The secret Post For Me holds for this function's webhook. TIKTOK_PFM_WEBHOOK_SECRET wins when set; otherwise
// it is read from Post For Me (GET /v1/webhooks, the entry whose url is ours) with the key the function already
// holds, so no secret has to be copied by hand. Kept for 10 minutes; a miss is retried after 1.
let webhookSecretCache: { at: number; value: string | null } | null = null;
async function expectedWebhookSecret(pfmKey: string, url: string): Promise<string | null> {
  const fromEnv = clean(Deno.env.get("TIKTOK_PFM_WEBHOOK_SECRET"));
  if (fromEnv) return fromEnv;
  const ttl = webhookSecretCache && webhookSecretCache.value ? 600000 : 60000;
  if (webhookSecretCache && Date.now() - webhookSecretCache.at < ttl) return webhookSecretCache.value;
  const r = await pfmClient(pfmKey)("GET", "/webhooks");
  const mine = r.ok ? webhookFor(r.data, url) : null;
  webhookSecretCache = { at: Date.now(), value: mine && mine.secret ? String(mine.secret) : null };
  return webhookSecretCache.value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const pfmKey = Deno.env.get("POST_FOR_ME_API_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);
  // Where Post For Me sends results. The query string only routes; the secret is what proves the sender.
  const webhookUrl = supabaseUrl.replace(/\/+$/, "") + "/functions/v1/tiktok-upload?pfm_webhook=1";
  const store = () => tableStore(createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }));

  // Post For Me's result webhook: no staff key, its own secret instead (OPEN_REPAIRS 370).
  const reqUrl = new URL(req.url);
  const webhookSecret = req.headers.get(WEBHOOK_HEADER);
  if (reqUrl.searchParams.get("pfm_webhook") === "1" || webhookSecret !== null) {
    if (!pfmKey && !clean(Deno.env.get("TIKTOK_PFM_WEBHOOK_SECRET"))) return json({ ok: false, error: "webhook_not_configured" }, 503);
    try {
      const out = await handleResultWebhook({
        secret: webhookSecret || "",
        body: await req.json().catch(() => ({})),
        expectedSecret: () => expectedWebhookSecret(pfmKey, webhookUrl),
        store: store(),
      });
      return json(out.body, out.status);
    } catch (e) {
      // A 5xx makes Post For Me retry (about 8 times over a day), which is what a database hiccup needs.
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

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
      store: store(),
      readSheet,
      webhookUrl,
    });
    return json(out.body, out.status);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
