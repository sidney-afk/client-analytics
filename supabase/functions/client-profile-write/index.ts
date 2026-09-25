// client-profile-write — an admin's edits to one client's profile, from the
// Kasper > Clients tab (docs/plans/2026-09-24-sheets-to-supabase.md, "Later: a
// Clients admin tab", step 2).
//
// Access: ADMIN staff only. The caller proves it with the admin role key in
// X-Syncview-Key AND names an active admin team member (member_id), who is
// recorded as the editor. SMM and creative keys, client link tokens and the
// n8n mirror key are all refused. The browser never touches the tables.
//
// The Clients Info Sheet stays the main copy while client_profiles_authority
// reads "sheet", and n8n still reads it. So a save:
//   1. re-reads the Supabase row and refuses if it changed since the editor
//      loaded it (updated_at is the version);
//   2. reads the client's Sheet row and refuses if any editable cell no
//      longer matches what the editor loaded (someone edited the Sheet);
//   3. writes ONLY the changed cells to that Sheet row;
//   4. then, in one transaction (client_profile_admin_edit), updates the
//      Supabase row with source='syncview' and appends one history row per
//      changed field.
// If step 3 fails, nothing is saved anywhere. If step 4 fails after the
// Sheet was written, the Sheet has the edit and the daily Sheet copy brings
// Supabase back in line; the page is told exactly that.
//
// action "refresh_from_sheet" copies one client's current Sheet row into
// Supabase (source 'sheet'), so an editor who hit "the Sheet changed" can
// load the newer values and edit on top of them.
// action "status" says whether Sheet writing is configured, and which Google
// account the Sheet must be shared with. It never returns a secret.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey } from "../_shared/staff-role-auth.ts";
import { clientSlug } from "../_shared/sheets-mirror.mjs";
import { EDITABLE_FIELDS, normalizeChanges, planSheetEdit, sheetRange } from "../_shared/client-profile-edit.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key",
  "Cache-Control": "no-store",
};
const TAB = "Clients Info";
const SHEET_ID_SECRET = "CLIENTS_INFO_SHEET_ID";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const ROW_COLUMNS = "slug,display_name,email,competitors,keywords,specific_keywords,content_description,instagram_handle,tiktok_handle,youtube_channel_id,slack_channel_id,creative_channel_id,upload_post_profile,postforme_account_id,extra,source,sheet_synced_at,archived_at,created_at,updated_at,updated_by";
type JsonMap = Record<string, unknown>;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function serviceAccount(): { email: string; key: string; tokenUri: string } | null {
  const raw = clean(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"));
  let c: JsonMap = {};
  if (raw) { try { c = JSON.parse(raw) as JsonMap; } catch (_e) { return null; } }
  else c = { client_email: Deno.env.get("GOOGLE_CLIENT_EMAIL"), private_key: Deno.env.get("GOOGLE_PRIVATE_KEY") };
  const email = clean(c.client_email);
  const key = clean(c.private_key).replace(/\\n/g, "\n");
  if (!email || !key) return null;
  return { email, key, tokenUri: clean(c.token_uri) || "https://oauth2.googleapis.com/token" };
}

async function googleToken(sa: { email: string; key: string; tokenUri: string }): Promise<string> {
  const enc = new TextEncoder();
  const b64url = (s: string | Uint8Array) => {
    const bytes = typeof s === "string" ? enc.encode(s) : s;
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({ iss: sa.email, scope: SHEETS_SCOPE, aud: sa.tokenUri, exp: now + 600, iat: now }));
  const pkcs8 = sa.key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pkcs8), c => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned)));
  const resp = await fetch(sa.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }).toString(),
  });
  const out = await resp.json().catch(() => ({})) as JsonMap;
  if (!resp.ok || !out.access_token) throw new SheetError("sheet_auth_failed", resp.status);
  return String(out.access_token);
}

class SheetError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}

async function readTab(sheetId: string, token: string): Promise<string[][]> {
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(sheetId) + "/values/" +
    encodeURIComponent(sheetRange(TAB, "A1:ZZ")) + "?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (resp.status === 403 || resp.status === 404) throw new SheetError("sheet_not_shared", resp.status);
  if (!resp.ok) throw new SheetError("sheet_read_failed", resp.status);
  const out = await resp.json() as JsonMap;
  return (Array.isArray(out.values) ? out.values : []) as string[][];
}

async function writeCells(sheetId: string, token: string, updates: { range: string; value: string }[]): Promise<void> {
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(sheetId) + "/values:batchUpdate";
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    // RAW: the text goes in exactly as typed, never parsed as a formula.
    body: JSON.stringify({ valueInputOption: "RAW", data: updates.map(u => ({ range: u.range, values: [[u.value]] })) }),
  });
  if (resp.status === 403) throw new SheetError("sheet_not_editable", resp.status);
  if (!resp.ok) throw new SheetError("sheet_write_failed", resp.status);
}

async function adminMember(supabase: SupabaseClient, memberId: string): Promise<{ id: string; name: string } | null> {
  if (!memberId) return null;
  const { data, error } = await supabase.from("team_members").select("id,name,role,active").eq("id", memberId).eq("active", true).maybeSingle();
  if (error) throw error;
  const m = data as JsonMap | null;
  if (!m || clean(m.role) !== "admin" || !clean(m.name)) return null;
  return { id: clean(m.id), name: clean(m.name) };
}

async function authority(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from("syncview_runtime_flags").select("value").eq("key", "client_profiles_authority").maybeSingle();
  const v = data && typeof data.value === "object" ? data.value as JsonMap : {};
  return clean(v.source) || "sheet";
}

const blankToNull = (v: unknown) => (clean(v) === "" ? null : clean(v));

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const staffKey = clean(req.headers.get("x-syncview-key"));
  const auth = staffKey ? authorizeStaffKey(staffKey, ["admin"]) : { ok: false, role: null };
  if (!auth.ok || auth.role !== "admin") return json({ ok: false, error: "unauthorized" }, auth.role ? 403 : 401);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);
    const raw = await req.text();
    if (raw.length > 200_000) return json({ ok: false, error: "body_too_large" }, 413);
    let body: JsonMap;
    try { body = JSON.parse(raw || "{}") as JsonMap; } catch (_e) { return json({ ok: false, error: "bad_json" }, 400); }
    const action = clean(body.action);
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const sa = serviceAccount();
    const sheetId = clean(Deno.env.get(SHEET_ID_SECRET));

    if (action === "status") {
      return json({ ok: true, sheet_configured: !!(sa && sheetId), service_account: sa ? sa.email : null, sheet_id_secret: SHEET_ID_SECRET });
    }
    if (action !== "update_client_profile" && action !== "refresh_from_sheet") return json({ ok: false, error: "unknown_action" }, 400);

    const member = await adminMember(supabase, clean(body.member_id));
    if (!member) return json({ ok: false, error: "admin_member_required" }, 403);
    if (await authority(supabase) !== "sheet") return json({ ok: false, error: "authority_not_sheet" }, 409);
    if (!sa || !sheetId) return json({ ok: false, error: "sheet_not_configured", service_account: sa ? sa.email : null, sheet_id_secret: SHEET_ID_SECRET }, 503);

    const slug = clientSlug(body.slug);
    if (!slug) return json({ ok: false, error: "missing_client" }, 400);
    const { data: row, error: rowErr } = await supabase.from("client_profiles").select(ROW_COLUMNS).eq("slug", slug).maybeSingle();
    if (rowErr) throw rowErr;
    const current = row as JsonMap | null;
    if (!current) return json({ ok: false, error: "client_profile_missing" }, 404);
    if (current.archived_at) return json({ ok: false, error: "client_profile_archived" }, 409);

    const token = await googleToken(sa);
    const values = await readTab(sheetId, token);

    if (action === "refresh_from_sheet") {
      const plan = planSheetEdit(values, slug, current, {}, TAB);
      const sheetValues = (plan as JsonMap).sheet_values as JsonMap | undefined;
      if (!sheetValues) return json({ ok: false, error: (plan as JsonMap).error || "sheet_row_missing" }, 409);
      const patch: JsonMap = {};
      for (const f of EDITABLE_FIELDS) if (f in sheetValues) patch[f] = blankToNull(sheetValues[f]);
      const now = new Date().toISOString();
      const { data: fresh, error: e } = await supabase.from("client_profiles")
        .update({ ...patch, source: "sheet", sheet_synced_at: now, updated_at: now, updated_by: "sheet-refresh:" + member.name })
        .eq("slug", slug).select(ROW_COLUMNS).maybeSingle();
      if (e) throw e;
      return json({ ok: true, row: fresh });
    }

    if (clean(body.expected_updated_at) !== clean(current.updated_at) &&
        Date.parse(clean(body.expected_updated_at)) !== Date.parse(clean(current.updated_at))) {
      return json({ ok: false, error: "client_profile_version_conflict", row: current }, 409);
    }
    const norm = normalizeChanges(body.changes);
    if (!norm.ok) return json({ ok: false, error: norm.error, field: norm.field || null }, 400);
    const changes = norm.changes as Record<string, string>;

    const plan = planSheetEdit(values, slug, current, changes, TAB) as JsonMap;
    if (!plan.ok) {
      const status = plan.error === "sheet_changed" ? 409 : 422;
      return json({ ok: false, error: plan.error, fields: plan.fields || null, field: plan.field || null, sheet_row: plan.sheet_row || null, sheet_values: plan.sheet_values || null }, status);
    }
    const updates = plan.updates as { field: string; range: string; value: string }[];
    if (!updates.length) return json({ ok: false, error: "no_changes" }, 400);
    await writeCells(sheetId, token, updates);

    const dbChanges: JsonMap = {};
    for (const u of updates) dbChanges[u.field] = blankToNull(u.value);
    const requestId = crypto.randomUUID();
    const { data: saved, error: rpcErr } = await supabase.rpc("client_profile_admin_edit", {
      p_slug: slug,
      p_changes: dbChanges,
      p_expected_updated_at: clean(current.updated_at),
      p_actor: member.name,
      p_role: "admin",
      p_member_id: member.id,
      p_sheet_row: plan.sheet_row as number,
      p_request_id: requestId,
    });
    if (rpcErr) {
      console.error("client-profile-write: Sheet written, Supabase update failed", rpcErr.message);
      return json({ ok: false, error: "saved_to_sheet_only", sheet_written: true, fields: updates.map(u => u.field) }, 500);
    }
    return json({ ok: true, sheet_row: plan.sheet_row, fields: updates.map(u => u.field), request_id: requestId, row: (saved as JsonMap).row });
  } catch (e) {
    if (e instanceof SheetError) {
      console.error("client-profile-write sheet error", e.code, e.status);
      return json({ ok: false, error: e.code }, 502);
    }
    console.error("client-profile-write failed", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "write_failed" }, 500);
  }
});
