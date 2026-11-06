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
// Once the owner flips client_profiles_authority to "syncview" the database is
// the main copy: an edit skips the Sheet read and write, checks the same
// version, saves through the same transaction (history included) and then
// copies the changed row to the Sheet, which stays a read-only mirror (a copy
// that cannot be made stays queued; the saved edit stands). refresh_from_sheet
// is refused in that state.
//
// Fields kept in client_profiles.extra (the client's Post For Me accounts: postforme_instagram_account_id,
// postforme_facebook_account_id, postforme_youtube_account_id, postforme_linkedin_account_id, and the
// youtube_made_for_kids setting) ride in the same `changes` map. They are saved only while SyncView is
// the main copy: Post For Me must first say each account (the TikTok column postforme_account_id too) is
// on the right network, then the same client_profile_admin_edit transaction saves them in extra with one
// history row each ("extra.<field>"; migrations/2026-10-31-client-facebook-page.sql and
// 2026-11-02-client-postforme-accounts.sql) and queues the usual Sheet copy. One account per client per
// slot is a unique index; its refusal answers postforme_account_taken.
//
// action "status" says whether Sheet writing is configured, and which Google
// account the Sheet must be shared with. It never returns a secret.
//
// The Clients tab's manager picker and history (same admin key and member):
//   list_managers  -- every active social media manager, and which one owns
//                     each client (a client sits on exactly one manager's
//                     source_clients list; the first by slug wins, as in
//                     smm_assign_client);
//   assign_manager -- moves one client to another active manager through the
//                     same smm_assign_client transaction roster-write uses
//                     (role "admin", the member's name as the editor), so the
//                     move lands in smm_assignment_edits and the Sheet copy is
//                     queued. It refuses if the client's manager changed since
//                     the page loaded it (expected_manager_slug), never creates
//                     a manager, and is refused by the database unless SyncView
//                     is the main copy;
//   history        -- the newest edits to one client's details and manager.
//
// action "pfm_accounts_sync" (L1, OPEN_REPAIRS 666) links Post for Me accounts to clients on an exact, unique
// handle match and lists everything else as "needs a person" (_shared/postforme-accounts.mjs has the rules).
// Callable by an admin (the Publishing card's "Check Post for Me accounts") or by the hourly timer, which signs
// with X-Pfm-Link-Key, checked by the database against Vault (public.pfm_account_link_key_ok; Vault holds the
// only copy, the function holds none), and may call this action only. dry_run: true plans and writes
// nothing. Each link saves through client_profile_admin_edit after the Post for Me network check, with the
// actor "Post for Me auto-link"; then one Sheet copy is sent. Raw accounts carry the clients' social tokens:
// only the safe fields are ever kept, and no account body is logged or returned.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey } from "../_shared/staff-role-auth.ts";
import { clientSlug } from "../_shared/sheets-mirror.mjs";
import {
  accountChecks, accountPlatformProblem, EDITABLE_FIELDS, normalizeChanges, planSheetEdit, sheetRange, splitChanges,
} from "../_shared/client-profile-edit.mjs";
import { makeStore } from "../_shared/roster-handlers.mjs";
import { accountChoices, MAX_PAGES, NETWORK_SLOTS, PAGE_SIZE, runAccountSync, safeAccount } from "../_shared/postforme-accounts.mjs";
import { copyToSheet } from "../_shared/roster-sheet-copy.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-pfm-link-key",
  "Cache-Control": "no-store",
};
const TAB = "Clients Info";
const SHEET_ID_SECRET = "CLIENTS_INFO_SHEET_ID";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const ROW_COLUMNS = "slug,display_name,email,competitors,keywords,specific_keywords,content_description,instagram_handle,tiktok_handle,youtube_channel_id,slack_channel_id,creative_channel_id,upload_post_profile,postforme_account_id,extra,source,sheet_synced_at,archived_at,created_at,updated_at,updated_by";
type JsonMap = Record<string, unknown>;
// The Slack person "Notify client" tags (migrations/2026-10-23-client-slack-mention.sql).
// Read only once a probe finds the column, so a save keeps working before that
// migration is applied (saving the field itself is then refused by the
// database function as not editable). A found column is remembered.
let slackMentionColumnSeen = false;
async function rowColumns(supabase: SupabaseClient): Promise<string> {
  if (!slackMentionColumnSeen) {
    const { error } = await supabase.from("client_profiles").select("slack_mention_user_id").limit(1);
    slackMentionColumnSeen = !error;
  }
  return slackMentionColumnSeen ? ROW_COLUMNS + ",slack_mention_user_id" : ROW_COLUMNS;
}

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

// Fails closed: a missing, malformed or unreadable flag is never read as
// "sheet", so an edit can never reach the Sheet after authority has moved.
async function authority(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.from("syncview_runtime_flags").select("value").eq("key", "client_profiles_authority").maybeSingle();
  if (error) throw error;
  const v = data && data.value && typeof data.value === "object" ? data.value as JsonMap : null;
  return v ? clean(v.source) : "";
}

const blankToNull = (v: unknown) => (clean(v) === "" ? null : clean(v));

const PFM = "https://api.postforme.dev/v1";
// Post For Me must report each new account id on the expected network (every account slot, the TikTok
// column included). Reads only `platform`; the account body is never passed on or logged.
async function checkAccounts(changes: Record<string, string>): Promise<{ error: string; field?: string }> {
  for (const { field, value, platforms } of accountChecks(changes) as { field: string; value: string; platforms: string[] }[]) {
    const key = clean(Deno.env.get("POST_FOR_ME_API_KEY"));
    if (!key) return { error: "postforme_not_configured", field };
    let resp: Response;
    try {
      resp = await fetch(PFM + "/social-accounts/" + encodeURIComponent(value), {
        headers: { Authorization: "Bearer " + key, Accept: "application/json" }, signal: AbortSignal.timeout(20000),
      });
    } catch (_e) {
      return { error: "postforme_unreachable", field };
    }
    if (resp.status === 404) return { error: "postforme_account_unknown", field };
    if (!resp.ok) return { error: "postforme_unreachable", field };
    const data = await resp.json().catch(() => ({}));
    const problem = accountPlatformProblem(data, platforms);
    if (problem) return { error: problem, field };
  }
  return { error: "" };
}

// The account field in `changes` that another client (archived included) already holds, or null. The unique
// indexes are the real guard; this read lets the Sheet-first lane refuse BEFORE it writes the Sheet.
async function accountTakenBy(supabase: SupabaseClient, slug: string, changes: Record<string, string>): Promise<string | null> {
  for (const { field, value } of accountChecks(changes) as { field: string; value: string }[]) {
    const col = (EDITABLE_FIELDS as readonly string[]).includes(field) ? field : "extra->>" + field;
    const { data, error } = await supabase.from("client_profiles").select("slug").eq(col, value).neq("slug", slug).limit(1);
    if (error) throw error;
    if ((data || []).length) return field;
  }
  return null;
}

// client_profiles_<field>_uniq -> <field>, for the unique index that refused a save.
function takenField(message: string): string | null {
  const m = message.match(/client_profiles_(postforme_[a-z_]+?)_uniq/);
  return m ? m[1] : null;
}

// The database is the main copy (client_profiles_authority = "syncview").
async function nativeUpdate(supabase: SupabaseClient, body: JsonMap, member: { id: string; name: string }): Promise<Response> {
  const slug = clientSlug(body.slug);
  if (!slug) return json({ ok: false, error: "missing_client" }, 400);
  const { data: row, error: rowErr } = await supabase.from("client_profiles").select(await rowColumns(supabase)).eq("slug", slug).maybeSingle();
  if (rowErr) throw rowErr;
  const current = row as JsonMap | null;
  if (!current) return json({ ok: false, error: "client_profile_missing" }, 404);
  if (current.archived_at) return json({ ok: false, error: "client_profile_archived" }, 409);
  if (clean(body.expected_updated_at) !== clean(current.updated_at) &&
      Date.parse(clean(body.expected_updated_at)) !== Date.parse(clean(current.updated_at))) {
    return json({ ok: false, error: "client_profile_version_conflict", row: current }, 409);
  }
  const norm = normalizeChanges(body.changes);
  if (!norm.ok) return json({ ok: false, error: norm.error, field: norm.field || null }, 400);
  const split = splitChanges(norm.changes) as { columns: Record<string, string>; extra: Record<string, string> };
  const check = await checkAccounts(norm.changes as Record<string, string>);
  if (check.error) return json({ ok: false, error: check.error, field: check.field || null }, check.error === "postforme_unreachable" ? 502 : check.error === "postforme_not_configured" ? 503 : 400);
  const dbChanges: JsonMap = {};
  for (const [f, v] of Object.entries(norm.changes as Record<string, string>)) dbChanges[f] = blankToNull(v);
  const requestId = crypto.randomUUID();
  const { data: saved, error: rpcErr } = await supabase.rpc("client_profile_admin_edit", {
    p_slug: slug,
    p_changes: dbChanges,
    p_expected_updated_at: clean(current.updated_at),
    p_actor: member.name,
    p_role: "admin",
    p_member_id: member.id,
    p_sheet_row: null,
    p_request_id: requestId,
  });
  if (rpcErr) {
    if (String(rpcErr.message).includes("client_profile_version_conflict")) return json({ ok: false, error: "client_profile_version_conflict", row: current }, 409);
    // A field the database cannot take yet (the Slack person or the Facebook Page, before its migration).
    if (String(rpcErr.message).includes("client_profile_edit_field_not_editable")) {
      const m = String(rpcErr.message).match(/not_editable:\s*([a-z_]+)/);
      return json({ ok: false, error: "field_not_editable", field: m ? m[1] : null }, 400);
    }
    if (String(rpcErr.message).includes("client_profile_edit_bad_value")) return json({ ok: false, error: "bad_value", field: null }, 400);
    // One Post For Me account on two clients: refused by a unique index per slot
    // (migrations/2026-11-02-client-postforme-accounts.sql). The index name says which slot.
    if ((rpcErr as { code?: string }).code === "23505") {
      const field = takenField(String(rpcErr.message));
      return json({ ok: false, error: "postforme_account_taken", field }, 409);
    }
    console.error("client-profile-write: native save failed", rpcErr.message);
    return json({ ok: false, error: "write_failed" }, 500);
  }
  const result = saved as JsonMap;
  const savedRow = result.row as JsonMap;
  const extraOf = (r: JsonMap) => (r.extra && typeof r.extra === "object" ? r.extra : {}) as JsonMap;
  const fields = Object.keys(split.columns).filter(f => savedRow[f] !== (current as JsonMap)[f])
    .concat(Object.keys(split.extra).filter(f => clean(extraOf(savedRow)[f]) !== clean(extraOf(current as JsonMap)[f])));
  // Best effort: never turns a saved edit into a failure.
  const sheetCopy = await copyToSheet({ store: makeStore(supabase), env: Deno.env, fetchFn: fetch });
  return json({ ok: true, native: true, fields, request_id: requestId, row: result.row, sheet_copy: sheetCopy });
}

const AUTO_LINK_ACTOR = "Post for Me auto-link";
const LINK_PROFILE_COLUMNS = "slug,instagram_handle,tiktok_handle,youtube_channel_id,postforme_account_id,extra,archived_at,updated_at";

// The hourly timer's key. Vault holds the only copy: the database compares it (sha256 digests, a 32+ character
// secret) in public.pfm_account_link_key_ok, and this function never sees or stores the value. Any error is a no.
async function scheduledCaller(supabase: SupabaseClient, given: string): Promise<boolean> {
  if (!given) return false;
  const { data, error } = await supabase.rpc("pfm_account_link_key_ok", { p_key: given });
  return !error && data === true;
}

// One page of Post for Me accounts, or null. The raw body never leaves runAccountSync (it is projected to safe
// fields there) and is never logged.
async function fetchAccountPage(offset: number, limit: number): Promise<unknown[] | null> {
  const key = clean(Deno.env.get("POST_FOR_ME_API_KEY"));
  if (!key) return null;
  try {
    const resp = await fetch(`${PFM}/social-accounts?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: "Bearer " + key, Accept: "application/json" }, signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null) as unknown;
    if (Array.isArray(data)) return data;
    const list = data && typeof data === "object" ? (data as JsonMap).data : null;
    return Array.isArray(list) ? list : null;
  } catch (_e) {
    return null;
  }
}

async function pfmAccountsSync(supabase: SupabaseClient, body: JsonMap, member: { id: string; name: string } | null): Promise<Response> {
  if (await authority(supabase) !== "syncview") return json({ ok: false, error: "authority_not_syncview" }, 409);
  if (!clean(Deno.env.get("POST_FOR_ME_API_KEY"))) return json({ ok: false, error: "postforme_not_configured" }, 503);
  const result = await runAccountSync({
    fetchPage: fetchAccountPage,
    readProfiles: async () => {
      const { data, error } = await supabase.from("client_profiles").select(LINK_PROFILE_COLUMNS);
      if (error) throw error;
      return data || [];
    },
    saveClient: async (row: JsonMap, changes: Record<string, string>) => {
      const check = await checkAccounts(changes);
      if (check.error) return { ok: false, error: check.error };
      const { error } = await supabase.rpc("client_profile_admin_edit", {
        p_slug: row.slug,
        p_changes: changes,
        p_expected_updated_at: clean(row.updated_at),
        p_actor: AUTO_LINK_ACTOR,
        p_role: "admin",
        p_member_id: member ? member.id : null,
        p_sheet_row: null,
        p_request_id: crypto.randomUUID(),
      });
      if (!error) return { ok: true };
      const msg = String(error.message);
      if ((error as { code?: string }).code === "23505") return { ok: false, error: "postforme_account_taken" };
      if (msg.includes("client_profile_version_conflict")) return { ok: false, error: "client_profile_version_conflict" };
      if (msg.includes("client_profile_edit_field_not_editable")) return { ok: false, error: "field_not_editable" };
      console.error("client-profile-write: auto-link save failed", msg);
      return { ok: false, error: "write_failed" };
    },
    copySheet: () => copyToSheet({ store: makeStore(supabase), env: Deno.env, fetchFn: fetch }),
  }, { dryRun: body.dry_run === true }) as JsonMap;
  // Best effort: the run log (migrations/2026-11-02-pfm-account-link-runs.sql) is where the watcher reads what
  // needs a person. Its record function keeps only the named fields of each entry.
  const { error: logErr } = await supabase.rpc("pfm_account_link_run_record", { p_run: {
    trigger: member ? "admin" : "timer", dry_run: body.dry_run === true, ok: result.ok === true, error: result.error || null,
    accounts: result.accounts || 0, already_linked: result.already_linked || 0, linked: result.linked || [], needs_person: result.needs_person || [],
  } });
  if (logErr) console.error("client-profile-write: the account-link run was not recorded", logErr.code || "");
  return json(result, result.ok ? 200 : result.error === "postforme_unreachable" || result.error === "postforme_list_incomplete" ? 502 : 500);
}

const MANAGER_SLUG = /^[a-z0-9&]+$/;
type Roster = { managers: { slug: string; name: string }[]; byName: Map<string, string> };

// Active managers, and client name (lower case) -> manager slug. Ordered by
// slug so a client wrongly on two lists resolves the way smm_assign_client does.
async function managerRoster(supabase: SupabaseClient): Promise<Roster> {
  const { data, error } = await supabase.from("social_media_managers").select("slug,name,source_clients").eq("active", true).order("slug");
  if (error) throw error;
  const byName = new Map<string, string>();
  const managers: { slug: string; name: string }[] = [];
  for (const m of (data || []) as JsonMap[]) {
    const slug = clean(m.slug);
    if (!slug) continue;
    managers.push({ slug, name: clean(m.name) || slug });
    for (const c of Array.isArray(m.source_clients) ? m.source_clients : []) {
      const k = clean(c).toLowerCase();
      if (k && !byName.has(k)) byName.set(k, slug);
    }
  }
  return { managers, byName };
}

async function listManagers(supabase: SupabaseClient): Promise<Response> {
  const roster = await managerRoster(supabase);
  const { data, error } = await supabase.from("client_profiles").select("slug,display_name").limit(2000);
  if (error) throw error;
  const assignments: Record<string, string> = {};
  for (const r of (data || []) as JsonMap[]) {
    const m = roster.byName.get(clean(r.display_name).toLowerCase());
    if (m) assignments[clean(r.slug)] = m;
  }
  return json({ ok: true, managers: roster.managers, assignments });
}

async function assignManager(supabase: SupabaseClient, body: JsonMap, member: { id: string; name: string }): Promise<Response> {
  const slug = clientSlug(body.slug);
  if (!slug) return json({ ok: false, error: "missing_client" }, 400);
  const managerSlug = clean(body.manager_slug);
  if (!MANAGER_SLUG.test(managerSlug)) return json({ ok: false, error: "bad_manager" }, 400);
  const { data: row, error: rowErr } = await supabase.from("client_profiles").select("slug,display_name,archived_at").eq("slug", slug).maybeSingle();
  if (rowErr) throw rowErr;
  const profile = row as JsonMap | null;
  if (!profile) return json({ ok: false, error: "client_profile_missing" }, 404);
  if (profile.archived_at) return json({ ok: false, error: "client_profile_archived" }, 409);
  const roster = await managerRoster(supabase);
  const target = roster.managers.find(m => m.slug === managerSlug);
  if (!target) return json({ ok: false, error: "bad_manager" }, 400);
  const current = roster.byName.get(clean(profile.display_name).toLowerCase()) || "";
  if ("expected_manager_slug" in body && clean(body.expected_manager_slug) !== current) {
    return json({ ok: false, error: "manager_changed", manager_slug: current || null }, 409);
  }
  if (current === managerSlug) return json({ ok: true, unchanged: true, manager_slug: current });
  const { data, error: rpcErr } = await supabase.rpc("smm_assign_client", {
    p_client_slug: slug,
    p_client_name: clean(profile.display_name),
    p_manager_slug: target.slug,
    p_manager_name: target.name,
    p_slack_profile_url: "",
    p_actor: member.name,
    p_role: "admin",
    p_request_id: crypto.randomUUID(),
  });
  if (rpcErr) {
    if (String(rpcErr.message).includes("roster_authority_not_syncview")) return json({ ok: false, error: "authority_not_syncview" }, 409);
    console.error("client-profile-write: assign_manager failed", rpcErr.message);
    return json({ ok: false, error: "write_failed" }, 500);
  }
  // Best effort: never turns a saved move into a failure.
  const sheetCopy = await copyToSheet({ store: makeStore(supabase), env: Deno.env, fetchFn: fetch });
  const out = (data || {}) as JsonMap;
  return json({ ok: true, manager_slug: target.slug, old_manager_slug: out.old_manager_slug || null, sheet_copy: sheetCopy });
}

async function history(supabase: SupabaseClient, body: JsonMap): Promise<Response> {
  const slug = clientSlug(body.slug);
  if (!slug) return json({ ok: false, error: "missing_client" }, 400);
  const { data: row, error: rowErr } = await supabase.from("client_profiles").select("display_name").eq("slug", slug).maybeSingle();
  if (rowErr) throw rowErr;
  if (!row) return json({ ok: false, error: "client_profile_missing" }, 404);
  const [edits, moves] = await Promise.all([
    supabase.from("client_profile_edits").select("field,old_value,new_value,edited_by,edited_at").eq("slug", slug).order("edited_at", { ascending: false }).limit(25),
    supabase.from("smm_assignment_edits").select("old_manager_slug,new_manager_slug,edited_by,edited_at").eq("client_name", clean((row as JsonMap).display_name)).order("edited_at", { ascending: false }).limit(10),
  ]);
  if (edits.error) throw edits.error;
  if (moves.error) throw moves.error;
  return json({ ok: true, edits: edits.data || [], manager_moves: moves.data || [] });
}

// The account pick for every network on the Post tab (OPEN_REPAIRS 712, behind the page's post_account_pick_v1 switch).
// pfm_account_choices { slug, network } answers { saved_id, accounts: [{ id, name, handle, connected, saved }], updated_at }:
// safe fields only, never a token. pfm_account_pick { slug, network, account_id, expected_updated_at } saves ONE of those
// accounts through the same client_profile_admin_edit path the Clients tab uses, and refuses any id the list did not
// offer. The list is the saved account plus unlinked connected accounts of that network whose display name contains the
// client's full display name. Nothing here ever links an account by itself.
const PICK_COLUMNS = LINK_PROFILE_COLUMNS + ",display_name";
async function accountChoicesFor(supabase: SupabaseClient, slug: string, network: string): Promise<{ error?: string; choices?: JsonMap; row?: JsonMap }> {
  if (!Object.prototype.hasOwnProperty.call(NETWORK_SLOTS, network)) return { error: "unknown_network" };
  const accounts: JsonMap[] = [];
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const raw = await fetchAccountPage(page * PAGE_SIZE, PAGE_SIZE);
    if (raw === null) return { error: "postforme_unreachable" };
    for (const a of raw) { const s = safeAccount(a); if (s) accounts.push(s as JsonMap); }
    if (raw.length < PAGE_SIZE) { complete = true; break; }
  }
  if (!complete) return { error: "postforme_list_incomplete" };
  const { data, error } = await supabase.from("client_profiles").select(PICK_COLUMNS);
  if (error) throw error;
  const rows = (data || []) as unknown as JsonMap[];
  const row = rows.find(r => r.slug === slug);
  if (!row) return { error: "client_profile_missing" };
  if (row.archived_at) return { error: "client_profile_archived" };
  return { choices: accountChoices(accounts, rows, slug, network) as JsonMap, row };
}
const choiceStatus = (e: string) => e === "client_profile_missing" ? 404 : e === "client_profile_archived" ? 409 : e === "unknown_network" ? 400 : 502;

async function pfmAccountChoices(supabase: SupabaseClient, body: JsonMap): Promise<Response> {
  const slug = clientSlug(body.slug);
  if (!slug) return json({ ok: false, error: "missing_client" }, 400);
  if (!clean(Deno.env.get("POST_FOR_ME_API_KEY"))) return json({ ok: false, error: "postforme_not_configured" }, 503);
  const r = await accountChoicesFor(supabase, slug, clean(body.network));
  if (r.error) return json({ ok: false, error: r.error }, choiceStatus(r.error));
  return json({ ok: true, ...(r.choices as JsonMap), updated_at: clean((r.row as JsonMap).updated_at) });
}

async function pfmAccountPick(supabase: SupabaseClient, body: JsonMap, member: { id: string; name: string }): Promise<Response> {
  if (await authority(supabase) !== "syncview") return json({ ok: false, error: "authority_not_syncview" }, 409);
  const slug = clientSlug(body.slug);
  const network = clean(body.network);
  const accountId = clean(body.account_id);
  if (!slug) return json({ ok: false, error: "missing_client" }, 400);
  if (!clean(Deno.env.get("POST_FOR_ME_API_KEY"))) return json({ ok: false, error: "postforme_not_configured" }, 503);
  const r = await accountChoicesFor(supabase, slug, network);
  if (r.error) return json({ ok: false, error: r.error }, choiceStatus(r.error));
  const offered = ((r.choices as JsonMap).accounts || []) as JsonMap[];
  if (!offered.some(p => p.id === accountId && p.connected === true)) return json({ ok: false, error: "account_not_offered" }, 400);
  const field = (NETWORK_SLOTS as Record<string, { field: string }>)[network].field;
  const current = r.row as JsonMap;
  if (clean(body.expected_updated_at) && Date.parse(clean(body.expected_updated_at)) !== Date.parse(clean(current.updated_at))) {
    return json({ ok: false, error: "client_profile_version_conflict" }, 409);
  }
  const check = await checkAccounts({ [field]: accountId });
  if (check.error) return json({ ok: false, error: check.error }, check.error === "postforme_unreachable" ? 502 : 400);
  const { error } = await supabase.rpc("client_profile_admin_edit", {
    p_slug: slug,
    p_changes: { [field]: accountId },
    p_expected_updated_at: clean(current.updated_at),
    p_actor: member.name,
    p_role: "admin",
    p_member_id: member.id,
    p_sheet_row: null,
    p_request_id: crypto.randomUUID(),
  });
  if (error) {
    const msg = String(error.message);
    if (msg.includes("client_profile_version_conflict")) return json({ ok: false, error: "client_profile_version_conflict" }, 409);
    if ((error as { code?: string }).code === "23505") return json({ ok: false, error: "postforme_account_taken" }, 409);
    console.error("client-profile-write: account pick failed", msg);
    return json({ ok: false, error: "write_failed" }, 500);
  }
  // Best effort, as every save here: the Sheet copy is sent after the save and never fails it.
  const sheetCopy = await copyToSheet({ store: makeStore(supabase), env: Deno.env, fetchFn: fetch });
  return json({ ok: true, saved_id: accountId, sheet_copy: sheetCopy });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  // The hourly timer may call pfm_accounts_sync only; its key is checked against Vault once the client exists.
  const linkKey = clean(req.headers.get("x-pfm-link-key"));
  const staffKey = clean(req.headers.get("x-syncview-key"));
  const auth = staffKey ? authorizeStaffKey(staffKey, ["admin"]) : { ok: false, role: null };
  const admin = auth.ok && auth.role === "admin";
  if (!linkKey && !admin) return json({ ok: false, error: "unauthorized" }, auth.role ? 403 : 401);
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
    if (!admin) {
      if (!(await scheduledCaller(supabase, linkKey))) return json({ ok: false, error: "unauthorized" }, 401);
      if (action !== "pfm_accounts_sync") return json({ ok: false, error: "unauthorized" }, 403);
      return await pfmAccountsSync(supabase, body, null);
    }
    const sa = serviceAccount();
    const sheetId = clean(Deno.env.get(SHEET_ID_SECRET));

    if (action === "status") {
      return json({ ok: true, sheet_configured: !!(sa && sheetId), service_account: sa ? sa.email : null, sheet_id_secret: SHEET_ID_SECRET });
    }
    const PICKER_ACTIONS = ["list_managers", "assign_manager", "history", "pfm_accounts_sync", "pfm_account_choices", "pfm_account_pick"];
    if (action !== "update_client_profile" && action !== "refresh_from_sheet" && !PICKER_ACTIONS.includes(action)) return json({ ok: false, error: "unknown_action" }, 400);

    const member = await adminMember(supabase, clean(body.member_id));
    if (!member) return json({ ok: false, error: "admin_member_required" }, 403);
    if (action === "list_managers") return await listManagers(supabase);
    if (action === "assign_manager") return await assignManager(supabase, body, member);
    if (action === "history") return await history(supabase, body);
    if (action === "pfm_accounts_sync") return await pfmAccountsSync(supabase, body, member);
    if (action === "pfm_account_choices") return await pfmAccountChoices(supabase, body);
    if (action === "pfm_account_pick") return await pfmAccountPick(supabase, body, member);
    const mode = await authority(supabase);
    if (mode === "syncview" && action === "update_client_profile") return await nativeUpdate(supabase, body, member);
    if (mode !== "sheet") return json({ ok: false, error: "authority_not_sheet" }, 409);
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
    // A field kept in extra is not a Sheet column: it can only be saved once SyncView is the main copy.
    const extraKeys = Object.keys(splitChanges(norm.changes).extra);
    if (extraKeys.length) return json({ ok: false, error: "authority_not_syncview", field: extraKeys[0] }, 409);
    const heldField = await accountTakenBy(supabase, slug, norm.changes as Record<string, string>);
    if (heldField) return json({ ok: false, error: "postforme_account_taken", field: heldField }, 409);
    const accountCheck = await checkAccounts(norm.changes as Record<string, string>);
    if (accountCheck.error) return json({ ok: false, error: accountCheck.error, field: accountCheck.field || null }, accountCheck.error === "postforme_unreachable" ? 502 : accountCheck.error === "postforme_not_configured" ? 503 : 400);
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
