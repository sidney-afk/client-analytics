// Supabase Edge Function: pipeline-google
//
// The pipeline's one door to Google Docs, Sheets and Drive (Sidney, 2026-09-29:
// edge functions instead of n8n). It sends the pipeline's own Google API
// requests as the service account SyncView already holds, so nobody needs a
// Google login of their own. See GOOGLE_WRITES.md in synchro-pipelines for
// what uses it. Lives here since 2026-10-16 so a merge deploys it.
//
//   POST { action, ... }   header x-pipeline-key: <the pipeline password>
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
// The password is PIPELINE_GOOGLE_KEY in Supabase; the pipeline keeps the same
// value in google_relay_key.txt in the private repo (setup_google_relay.py makes
// both). Without it set, every request is refused.
//
// Service account: GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_CLIENT_EMAIL +
// GOOGLE_PRIVATE_KEY - the same secrets and login code as SyncView's
// filming-plan-tabs. It can only reach files shared with it.

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
});

// measurement edit, session Turbo; this branch is never merged
