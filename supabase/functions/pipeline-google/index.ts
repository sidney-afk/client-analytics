// Supabase Edge Function: pipeline-google
//
// The pipeline's one door to Google Docs, Sheets and Drive (Sidney, 2026-09-29:
// edge functions instead of n8n). It sends the pipeline's own Google API
// requests as the service account SyncView already holds, so nobody needs a
// Google login of their own. See GOOGLE_WRITES.md in synchro-pipelines for
// what uses it. Lives here since 2026-10-16 so a merge deploys it.
//
//   POST { action, ... }   header x-pipeline-key: <the pipeline password>
//                       or header x-pipeline-pass: <a filming pipeline pass>
//
//   docs.get          { documentId, includeTabsContent?, fields? }
//   docs.batchUpdate  { documentId, requests }          add tabs, write, edit
//   sheets.get        { spreadsheetId, fields? }
//   sheets.batchUpdate{ spreadsheetId, requests }       add tabs, format
//   sheets.values.get { spreadsheetId, range }
//   sheets.values.update { spreadsheetId, range, values }
//   sheets.values.append { spreadsheetId, range, values }
//   drive.get         { fileId, fields? }                name, type, can it edit (doctor.py)
//   drive.copy        { fileId, name, parentId }         (fails: the account has no Drive storage)
//   drive.folder      { parentId, name }                 find or create a subfolder
//   whoami            {}                                 which account, is it set up
//
// With a pass only (store.mjs; no Google call, no client config needed):
//   files.get         { name? }                          one file, or all of the client's files
//   files.save        { name, expected_version, body }   a stale version answers saved:false
//   batch.take        {}                                 the client's next idea batch number
//   notes.add         { title, body, source, follows? }  a feedback note (chat or sheet)
//   brain.snapshot    { have_commit? }                   the Synchro Brain at main as a signed zip link, inputs/ only inputs/drive/ and four named summaries
//
// Every pass action (store and Google alike) first re-checks that the pass's
// member is still on the filming plan list (users.mjs, fp_settings
// "pipeline_users"), so removing a name stops a pass already handed out. A
// pass from the shared team link is always refused.
//
// The password is PIPELINE_GOOGLE_KEY in Supabase; the pipeline keeps the same
// value in google_relay_key.txt in the private repo (setup_google_relay.py makes
// both). Without it set, every request is refused.
//
// A pass (since 2026-10-16, item 1 PR 1) is the per-person alternative: the
// connector's pipeline_pass tool hands one out for 6 hours, for one client and
// one target (test or client), and only its SHA-256 is stored (fp_passes). It
// is used only when no x-pipeline-key header is sent; the password path is
// unchanged. What a pass may touch is in rules.mjs: that client's own files,
// and writes only inside tabs created through a pass (fp_pass_tabs). Refusals
// are plain-English JSON with status 403.
//
// Service account: GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_CLIENT_EMAIL +
// GOOGLE_PRIVATE_KEY - the same secrets and login code as SyncView's
// filming-plan-tabs. It can only reach files shared with it.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { PASS_HEADER, isPassToken, passHash } from "./pass.mjs";
import { SNAPSHOT_BUCKET, STORE_ACTIONS, snapshotName, storeAction } from "./store.mjs";
import { pipelineGate } from "./users.mjs";
import { WRITE_ACTIONS, allowedFiles, checkDocsBatch, checkFile, checkSheetsBatch, checkValuesRange, clientFiles, createdTabIds } from "./rules.mjs";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
].join(" ");
const DOCS = "https://docs.googleapis.com/v1/documents/";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

const clean = (v: unknown) => String(v == null ? "" : v).trim();
const json = (obj: unknown, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

function sameText(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function readCreds() {
  const raw = clean(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"));
  let c: Record<string, unknown>;
  if (raw) {
    try { c = JSON.parse(raw); } catch (_) { return null; }
  } else {
    c = { client_email: Deno.env.get("GOOGLE_CLIENT_EMAIL"), private_key: Deno.env.get("GOOGLE_PRIVATE_KEY") };
  }
  const email = clean(c.client_email);
  const key = clean(c.private_key).replace(/\\n/g, "\n");
  if (!email || !key) return null;
  return { email, key, tokenUri: clean(c.token_uri) || "https://oauth2.googleapis.com/token" };
}

let cached: { value: string; until: number } | null = null;

async function token(creds: { email: string; key: string; tokenUri: string }) {
  if (cached && cached.until - 60_000 > Date.now()) return cached.value;
  const enc = new TextEncoder();
  const b64url = (s: string | Uint8Array) => {
    const bytes = typeof s === "string" ? enc.encode(s) : s;
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({ iss: creds.email, scope: SCOPES, aud: creds.tokenUri, exp: now + 3600, iat: now }));
  const pkcs8 = creds.key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  const k = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, enc.encode(unsigned)));
  const resp = await fetch(creds.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body.access_token) throw new Error("google_login_failed");
  cached = { value: String(body.access_token), until: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  return cached.value;
}

// Google's answer is passed back as is, except that an error carries only its
// status and Google's own message - never a token or key.
async function google(tok: string, method: string, url: string, payload?: unknown) {
  const resp = await fetch(url, {
    method,
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await resp.json().catch(() => ({}));
  if (resp.ok) return json({ ok: true, result: body });
  return json({ ok: false, status: resp.status, error: clean((body.error || {}).message) || resp.statusText }, resp.status);
}

function need(b: Record<string, unknown>, ...keys: string[]) {
  for (const k of keys) {
    if (b[k] === undefined || b[k] === null || b[k] === "") return "missing " + k;
    if (k.endsWith("Id") && !ID_RE.test(clean(b[k]))) return "bad " + k;
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "use POST" }, 405);
  // A filming pipeline pass, only when no password is sent: the password path
  // below is exactly as before.
  const pass = clean(req.headers.get(PASS_HEADER));
  if (pass && !clean(req.headers.get("x-pipeline-key"))) return await withPass(req, pass);
  const secret = clean(Deno.env.get("PIPELINE_GOOGLE_KEY"));
  if (!secret) return json({ ok: false, error: "not set up: PIPELINE_GOOGLE_KEY is missing (run setup_google_relay.py)" }, 503);
  if (!sameText(clean(req.headers.get("x-pipeline-key")), secret)) return json({ ok: false, error: "wrong or missing x-pipeline-key" }, 401);

  const b = await req.json().catch(() => ({})) as Record<string, any>;
  const action = clean(b.action);
  const creds = readCreds();
  if (!creds) return json({ ok: false, error: "the Google service account is not set up in Supabase" }, 503);
  if (action === "whoami") return json({ ok: true, account: creds.email });

  let tok: string;
  try { tok = await token(creds); } catch (_) { return json({ ok: false, error: "Google login failed" }, 502); }
  return await perform(tok, action, b);
});

// One Google call for an action whose caller is already let in.
// deno-lint-ignore no-explicit-any
async function perform(tok: string, action: string, b: Record<string, any>): Promise<Response> {
  const q = (params: Record<string, unknown>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
    const s = u.toString();
    return s ? "?" + s : "";
  };
  const bad = (msg: string) => json({ ok: false, error: msg }, 400);
  let m: string;

  switch (action) {
    case "docs.get":
      if ((m = need(b, "documentId"))) return bad(m);
      return google(tok, "GET", DOCS + b.documentId + q({ includeTabsContent: b.includeTabsContent ? "true" : "", fields: b.fields }));
    case "docs.batchUpdate":
      if ((m = need(b, "documentId", "requests"))) return bad(m);
      return google(tok, "POST", DOCS + b.documentId + ":batchUpdate", { requests: b.requests });
    case "sheets.get":
      if ((m = need(b, "spreadsheetId"))) return bad(m);
      return google(tok, "GET", SHEETS + b.spreadsheetId + q({ fields: b.fields }));
    case "sheets.batchUpdate":
      if ((m = need(b, "spreadsheetId", "requests"))) return bad(m);
      return google(tok, "POST", SHEETS + b.spreadsheetId + ":batchUpdate", { requests: b.requests });
    case "sheets.values.get":
      if ((m = need(b, "spreadsheetId", "range"))) return bad(m);
      return google(tok, "GET", SHEETS + b.spreadsheetId + "/values/" + encodeURIComponent(b.range));
    case "sheets.values.update":
      if ((m = need(b, "spreadsheetId", "range", "values"))) return bad(m);
      return google(tok, "PUT", SHEETS + b.spreadsheetId + "/values/" + encodeURIComponent(b.range) + "?valueInputOption=RAW",
        { values: b.values });
    case "sheets.values.append":
      if ((m = need(b, "spreadsheetId", "range", "values"))) return bad(m);
      return google(tok, "POST", SHEETS + b.spreadsheetId + "/values/" + encodeURIComponent(b.range) +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", { values: b.values });
    case "drive.copy":
      if ((m = need(b, "fileId", "name", "parentId"))) return bad(m);
      return google(tok, "POST", DRIVE + "/" + b.fileId + "/copy?supportsAllDrives=true&fields=id,name,webViewLink",
        { name: b.name, parents: [b.parentId] });
    case "drive.get":
      // doctor.py: can the service account open and edit this file or folder?
      if ((m = need(b, "fileId"))) return bad(m);
      return google(tok, "GET", DRIVE + "/" + b.fileId + q({ supportsAllDrives: "true",
        fields: b.fields || "id,name,mimeType,capabilities(canEdit)" }));
    case "drive.folder": {
      if ((m = need(b, "parentId", "name"))) return bad(m);
      const name = clean(b.name).replace(/'/g, "\\'");
      const search = await fetch(DRIVE + q({
        q: `'${b.parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id,name,webViewLink)", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      }), { headers: { Authorization: "Bearer " + tok } });
      const found = await search.json().catch(() => ({}));
      if (search.ok && Array.isArray(found.files) && found.files.length) return json({ ok: true, result: found.files[0], created: false });
      const made = await google(tok, "POST", DRIVE + "?supportsAllDrives=true&fields=id,name,webViewLink",
        { name: b.name, parents: [b.parentId], mimeType: "application/vnd.google-apps.folder" });
      return made;
    }
    default:
      return bad("unknown action " + JSON.stringify(action));
  }
}

// ---- Filming pipeline passes ------------------------------------------------

function db() {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

const refused = (error: string, status = 403) => json({ ok: false, error }, status);

// What a rule in rules.mjs answers: ok, or a refusal with its message and status.
type Verdict = { ok: boolean; status?: number; error?: string; fileId?: string; adds?: number };
const refusal = (v: Verdict) => refused(String(v.error || "refused"), v.status || 403);

// The tab ids created through a pass in this file for this client.
async function passTabs(sb: NonNullable<ReturnType<typeof db>>, fileId: string, client: string): Promise<string[] | null> {
  const { data, error } = await sb.from("fp_pass_tabs").select("tab_id").eq("file_id", fileId).eq("client_slug", client);
  if (error) return null;
  return (data || []).map((r: { tab_id: string }) => String(r.tab_id));
}

async function withPass(req: Request, raw: string): Promise<Response> {
  // The token is never echoed, logged or stored; only its hash is looked up.
  if (!isPassToken(raw)) return refused("That pipeline pass is not valid. Ask the connector for a new one (pipeline_pass).", 401);
  const sb = db();
  if (!sb) return refused("not set up: the database connection is missing", 503);
  const { data: rows, error: useError } = await sb.rpc("fp_pass_use", { p_token_hash: await passHash(raw) });
  if (useError) return refused("Could not check the pipeline pass (the pass tables may not be set up yet).", 503);
  const pass = Array.isArray(rows) ? rows[0] : null;
  if (!pass) return refused("That pipeline pass is not known. Ask the connector for a new one (pipeline_pass).", 401);
  if (pass.expired) {
    return refused(`That pipeline pass ran out at ${String(pass.expires_at)}. Ask the connector for a new one (pipeline_pass).`, 401);
  }

  // Only the people on the filming plan list, read now, never the team link.
  const gate = await pipelineGate(readSetting(sb), { member: String(pass.member ?? ""), teamLink: pass.via !== "personal" });
  if (gate) return refused(gate.text, gate.status);

  // deno-lint-ignore no-explicit-any
  const b = await req.json().catch(() => ({})) as Record<string, any>;
  const action = clean(b.action);
  const client = String(pass.client_slug);
  const target = String(pass.target);

  // The pipeline's own data (file store, batch numbers, notes, brain snapshot):
  // the pass's member and client decide everything; no Google file is involved.
  if (STORE_ACTIONS.has(action)) {
    const out = await storeAction(action, b, pass, storeDeps(sb));
    return json(out.body, out.status);
  }

  // The client's own files come from its config.json in the file store; the
  // TEST Sheet from fp_settings. Nothing is hardcoded here.
  const cfg = await sb.from("fp_files").select("body").eq("client_slug", client).eq("name", "config.json").maybeSingle();
  if (cfg.error) return refused("Could not read the client's config from the file store.", 503);
  if (!cfg.data) return refused("This client has no config.json in the file store yet, so a pass cannot reach its files.");
  let config: unknown;
  try { config = JSON.parse(String(cfg.data.body)); } catch (_) { return refused("This client's config.json in the file store is not valid JSON.", 500); }
  let testSheet: unknown = "";
  if (target === "test") {
    const s = await sb.from("fp_settings").select("value").eq("key", "test_sheet").maybeSingle();
    if (s.error) return refused("Could not read the TEST Sheet setting.", 503);
    testSheet = s.data ? s.data.value : "";
  }
  const allowed = allowedFiles(target, clientFiles(config), testSheet);
  const file = checkFile(action, b, allowed, target) as Verdict;
  if (!file.ok) return refusal(file);
  const fileId = String(file.fileId);

  const creds = readCreds();
  if (!creds) return refused("the Google service account is not set up in Supabase", 503);
  if (action === "whoami") return json({ ok: true, account: creds.email });
  let tok: string;
  try { tok = await token(creds); } catch (_) { return refused("Google login failed", 502); }

  if (!WRITE_ACTIONS.has(action)) return await perform(tok, action, b);

  const tabs = await passTabs(sb, fileId, client);
  if (tabs === null) return refused("Could not read which tabs were created through a pass.", 503);
  let adds = 0;
  if (action === "docs.batchUpdate" || action === "sheets.batchUpdate") {
    const check = (action === "docs.batchUpdate" ? checkDocsBatch(b.requests, tabs) : checkSheetsBatch(b.requests, tabs)) as Verdict;
    if (!check.ok) return refusal(check);
    adds = check.adds || 0;
  } else {
    // values.update / values.append: the range's tab, by title, must be a pass tab.
    const list = await fetch(SHEETS + fileId + "?fields=" + encodeURIComponent("sheets.properties(sheetId,title)"),
      { headers: { Authorization: "Bearer " + tok } });
    const listed = await list.json().catch(() => ({}));
    if (!list.ok) return json({ ok: false, status: list.status, error: clean((listed.error || {}).message) || list.statusText }, list.status);
    // deno-lint-ignore no-explicit-any
    const sheetTabs = (Array.isArray(listed.sheets) ? listed.sheets : []).map((x: any) => (x && x.properties) || {});
    const check = checkValuesRange(b.range, sheetTabs, tabs) as Verdict;
    if (!check.ok) return refusal(check);
  }

  const resp = await perform(tok, action, b);
  if (!adds || !resp.ok) return resp;
  // Record the new tabs so this and later passes for this client may write in them.
  const out = await resp.clone().json().catch(() => ({}));
  const ids = createdTabIds(action === "docs.batchUpdate" ? "docs" : "sheets", out.result);
  if (!ids.length) return resp;
  const { error: tabError } = await sb.from("fp_pass_tabs").insert(ids.map((tab_id: string) =>
    ({ file_id: fileId, tab_id, client_slug: client, pass_id: pass.pass_id })));
  if (tabError) {
    return json({ ...out, warning: "The tab was made, but it could not be recorded, so this pass cannot write in it. Tell the Connector supervisor." }, resp.status);
  }
  return resp;
}

// ---- The pipeline's own data, for store.mjs -----------------------------------

// One fp_settings value, or null when the key is not set.
function readSetting(sb: NonNullable<ReturnType<typeof db>>) {
  return async (key: string) => {
    const { data, error } = await sb.from("fp_settings").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`the settings: ${error.message || "no answer"}`);
    return data ? data.value : null;
  };
}

// The Synchro Brain repository, read with the same token and settings the
// connector's client_brain uses. The token never leaves this function.
function brainGh(path: string, accept: string): Promise<Response> {
  const repo = clean(Deno.env.get("BRAIN_REPO")) || "sidney-afk/synchro-brain";
  return fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: {
      Authorization: `Bearer ${clean(Deno.env.get("BRAIN_GITHUB_TOKEN"))}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "syncview-pipeline-google",
    },
  });
}

function storeDeps(sb: NonNullable<ReturnType<typeof db>>) {
  const fail = (what: string, e: { message?: string } | null) => new Error(`${what}: ${e?.message || "no answer"}`);
  const snapshots = () => sb.storage.from(SNAPSHOT_BUCKET);
  const zipName = (commit: string) => snapshotName(commit);
  return {
    getFiles: async (client: string, name: string | null) => {
      let q = sb.from("fp_files").select("name,version,body,updated_by,updated_at").eq("client_slug", client);
      if (name) q = q.eq("name", name);
      const { data, error } = await q.order("name");
      if (error) throw fail("the file store", error);
      return data || [];
    },
    saveFile: async (client: string, name: string, v: number, body: string, member: string) => {
      const { data, error } = await sb.rpc("fp_file_save", { p_client: client, p_name: name, p_expected_version: v, p_body: body, p_member: member });
      if (error) throw fail("the file store", error);
      return Array.isArray(data) ? data[0] : data;
    },
    isPublisher: async (member: string) => {
      const { data, error } = await sb.from("fp_publishers").select("member").eq("member", member).maybeSingle();
      if (error) throw fail("the publish list", error);
      return !!data;
    },
    setting: readSetting(sb),
    takeBatch: async (client: string) => {
      const { data, error } = await sb.rpc("fp_take_batch", { p_client: client });
      if (error) throw fail("the batch counter", error);
      return Number(data);
    },
    noteExists: async (id: string) => {
      const { data, error } = await sb.from("fp_feedback_notes").select("id").eq("id", id).maybeSingle();
      if (error) throw fail("the notes", error);
      return !!data;
    },
    addNote: async (row: Record<string, unknown>) => {
      const { data, error } = await sb.from("fp_feedback_notes").insert(row).select("id,created_at").single();
      if (error || !data) throw fail("the notes", error);
      return data;
    },
    brainHead: async () => {
      if (!clean(Deno.env.get("BRAIN_GITHUB_TOKEN"))) throw new Error("the Synchro Brain is not connected on the server");
      const branch = encodeURIComponent(clean(Deno.env.get("BRAIN_BRANCH")) || "main");
      const r = await brainGh(`commits/${branch}`, "application/vnd.github.sha");
      if (!r.ok) throw new Error(`the Synchro Brain answered ${r.status}`);
      return (await r.text()).trim();
    },
    snapshotSize: async (commit: string) => {
      const { data, error } = await snapshots().list("", { search: zipName(commit), limit: 10 });
      if (error) throw fail("the brain-snapshots bucket", error);
      const hit = (data || []).find((o) => o.name === zipName(commit));
      return hit ? Number((hit.metadata || {}).size) || 0 : null;
    },
    snapshotFetch: async (commit: string) => {
      // GitHub answers with a redirect to a short-lived download address.
      const r = await brainGh(`zipball/${commit}`, "application/vnd.github+json");
      if (!r.ok) throw new Error(`the Synchro Brain zip answered ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    snapshotStore: async (commit: string, bytes: Uint8Array) => {
      // upsert: two pipelines asking at once store the same bytes twice, harmlessly.
      const { error } = await snapshots().upload(zipName(commit), bytes, { contentType: "application/zip", upsert: true });
      if (error) throw fail("the brain-snapshots bucket", error);
    },
    snapshotSign: async (commit: string, seconds: number) => {
      const { data, error } = await snapshots().createSignedUrl(zipName(commit), seconds, { download: `synchro-brain-${commit.slice(0, 12)}.zip` });
      if (error || !data?.signedUrl) throw fail("the brain-snapshots bucket", error);
      return data.signedUrl;
    },
  };
}
