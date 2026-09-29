// Supabase Edge Function: filming-plan-tabs
//
// Replaces the n8n webhook `filming-plan-tabs` for Kasper > Filming. Reads a
// client's filming-plan Google Doc tab list with the Google service account
// Supabase already holds (GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_CLIENT_EMAIL +
// GOOGLE_PRIVATE_KEY), keeps a short cache in filming_plan_tabs_cache, and
// answers the same { ok, docId, tabs } shape the n8n flow did.
//
//   GET ?doc=<docId>              one Doc, { ok, docId, tabs }
//   GET ?docs=<id>,<id>,...       many Docs, { ok, docs: { <id>: {...} } }
//   add &refresh=1                skip the cache and re-read from Google
//   GET ?whoami=1                 { ok, configured, service_account_email }
//
// A Doc the service account cannot read falls back to the old n8n webhook for
// that Doc only, and the answer then also carries `share_with` (the service
// account's email, never a key) and `fallback` (per Doc, Google's HTTP status
// and reason) so the owner knows which address to share the Doc or folder with.
//
// Auth: a staff role key (X-Syncview-Key), same as filming-plans reads.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, a staff role key
// secret (ROLE_KEY_ADMIN / ROLE_KEY_SMM / ROLE_KEY_CREATIVE), and the Google
// service account above.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import {
  DOCS_FIELDS,
  buildResponse,
  parseDocIds,
  resolveDocs,
  shapeTabs,
} from "./tabs.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source",
  "Cache-Control": "no-store",
};

const N8N_TABS_URL = "https://synchrosocial.app.n8n.cloud/webhook/filming-plan-tabs";
const DOCS_SCOPE = "https://www.googleapis.com/auth/documents.readonly";
const GOOGLE_TIMEOUT_MS = 10000;
const N8N_TIMEOUT_MS = 10000;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

type Creds = { email: string; key: string; tokenUri: string };

function readCreds(): Creds | null {
  const raw = clean(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"));
  let c: Record<string, unknown>;
  if (raw) {
    try { c = JSON.parse(raw); } catch (_) { return null; }
  } else {
    c = {
      client_email: Deno.env.get("GOOGLE_CLIENT_EMAIL"),
      private_key: Deno.env.get("GOOGLE_PRIVATE_KEY"),
    };
  }
  const email = clean(c.client_email);
  const key = clean(c.private_key).replace(/\\n/g, "\n");
  if (!email || !key) return null;
  return { email, key, tokenUri: clean(c.token_uri) || "https://oauth2.googleapis.com/token" };
}

let tokenCache: { value: string; expiresAt: number } | null = null;

async function serviceAccountToken(creds: Creds): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.value;
  const enc = new TextEncoder();
  const b64url = (s: string | Uint8Array) => {
    const bytes = typeof s === "string" ? enc.encode(s) : s;
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: creds.email,
    scope: DOCS_SCOPE,
    aud: creds.tokenUri,
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = header + "." + claim;
  const pkcs8 = creds.key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const keyBytes = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(unsigned)));
  const resp = await fetch(creds.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + b64url(sig),
    }).toString(),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body.access_token) throw new Error("token_failed");
  const seconds = Number(body.expires_in);
  tokenCache = {
    value: String(body.access_token),
    expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
  };
  return tokenCache.value;
}

// Result carries only an HTTP status and Google's own reason word (for example
// PERMISSION_DENIED or SERVICE_DISABLED). Never a token, key, or response body.
async function googleTabs(docId: string) {
  const creds = readCreds();
  if (!creds) return { ok: false, status: 0, reason: "service_account_not_configured" };
  try {
    const token = await serviceAccountToken(creds);
    const url = "https://docs.googleapis.com/v1/documents/" + encodeURIComponent(docId)
      + "?includeTabsContent=true&fields=" + encodeURIComponent(DOCS_FIELDS);
    const resp = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = (body && body.error) || {};
      const detail = Array.isArray(err.details)
        ? err.details.map((d: Record<string, unknown>) => clean(d && d.reason)).find(Boolean)
        : "";
      return { ok: false, status: resp.status, reason: clean(detail || err.status) };
    }
    return { ok: true, tabs: shapeTabs(docId, body) };
  } catch (_) {
    return { ok: false, status: 0, reason: "request_failed" };
  }
}

async function n8nTabs(docId: string) {
  try {
    const resp = await fetch(N8N_TABS_URL + "?doc=" + encodeURIComponent(docId) + "&_t=" + Date.now(), {
      signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
    });
    if (!resp.ok) return { ok: false };
    const body = await resp.json();
    if (!body || body.ok === false || !Array.isArray(body.tabs)) return { ok: false };
    return { ok: true, tabs: body.tabs };
  } catch (_) {
    return { ok: false };
  }
}

function requireStaff(req: Request): Response | null {
  const legacyKey = clean(Deno.env.get("ONBOARDING_STAFF_KEY"));
  const supplied = clean(req.headers.get("x-syncview-key"));
  const auth = authorizeStaffKey(supplied, ["admin", "smm", "creative"], [legacyKey]);
  if (!auth.ok) return json({ ok: false, error: auth.role ? "forbidden" : "unauthorized" }, staffAuthFailureStatus(auth));
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const denied = requireStaff(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const creds = readCreds();

  if (url.searchParams.get("whoami")) {
    return json({ ok: true, configured: !!creds, service_account_email: creds ? creds.email : "" });
  }

  const parsed = parseDocIds(url.searchParams);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "service_unavailable" }, 503);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const deps = {
    async cacheRead(ids: string[]) {
      const out = new Map();
      const { data, error } = await db
        .from("filming_plan_tabs_cache")
        .select("doc_id,tabs,fetched_at")
        .in("doc_id", ids);
      if (error || !Array.isArray(data)) return out;
      for (const row of data) out.set(row.doc_id, { tabs: row.tabs, fetched_at: row.fetched_at });
      return out;
    },
    async cacheWrite(id: string, tabs: unknown, source: string) {
      // A failed cache write never fails the read.
      await db.from("filming_plan_tabs_cache").upsert(
        { doc_id: id, tabs, source, fetched_at: new Date().toISOString() },
        { onConflict: "doc_id" },
      );
    },
    googleTabs,
    n8nTabs,
  };

  const refresh = clean(url.searchParams.get("refresh")) === "1";
  const result = await resolveDocs(parsed.ids, deps, { refresh });
  const out = buildResponse(parsed.ids, parsed.bulk, result, creds ? creds.email : "");
  return json(out.body, out.status);
});
