// Supabase Edge Function: filming-plan-docs-write
//
// Replaces the n8n webhook `filming-plan-docs-update`. The filming plan
// pipeline (synchro-pipelines/filming_plan_write_doc.py) sends it
// { documentId, requests } and it runs Google Docs documents.batchUpdate with
// the Google service account Supabase already holds (GOOGLE_SERVICE_ACCOUNT_JSON,
// or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY), the same one filming-plan-tabs reads with.
//
//   POST { documentId, requests: [ ... ] }   { ok, documentId, replies }
//
// What the n8n flow never had, and this does:
//   - a staff sign-in (X-Syncview-Key, same keys as filming-plan-tabs)
//   - only the request kinds the pipeline sends (docswrite.mjs), at most 3000 per call
//   - only a Doc we own: a registered filming_plans.doc_id, or one listed in the
//     FILMING_PLAN_WRITE_EXTRA_DOC_IDS secret (pipeline test Docs)
//   - a failed registry read HOLDS the write (503), it never writes unchecked
// The service account can only write a Doc that was shared with it as Editor; a
// refusal from Google comes back as { ok:false, error, google_status, reason,
// share_with } (the service account's email, never a key).

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import { isOwnedDoc, MAX_BODY_BYTES, parseExtraDocIds, parseWriteBody } from "./docswrite.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source",
  "Cache-Control": "no-store",
};

const DOCS_SCOPE = "https://www.googleapis.com/auth/documents";
const GOOGLE_TIMEOUT_MS = 120000;
const TOKEN_TIMEOUT_MS = 10000;

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
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
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

function requireStaff(req: Request): Response | null {
  const legacyKeys = [
    clean(Deno.env.get("ONBOARDING_STAFF_KEY")),
    clean(Deno.env.get("CREDENTIALS_STAFF_KEY")),
  ];
  const supplied = clean(req.headers.get("x-syncview-key"));
  const auth = authorizeStaffKey(supplied, ["admin", "smm", "creative"], legacyKeys);
  if (!auth.ok) return json({ ok: false, error: auth.role ? "forbidden" : "unauthorized" }, staffAuthFailureStatus(auth));
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const denied = requireStaff(req);
  if (denied) return denied;

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json({ ok: false, error: "body_too_large" }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch (_) { return json({ ok: false, error: "invalid_body" }, 400); }
  const parsed = parseWriteBody(body);
  if ("error" in parsed) return json({ ok: false, error: parsed.error, kind: (parsed as { kind?: string }).kind }, 400);

  const creds = readCreds();
  if (!creds) return json({ ok: false, error: "service_account_not_configured" }, 503);

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "service_unavailable" }, 503);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // A failed registry read holds the write: never write a Doc nobody checked.
  const { data, error } = await db.from("filming_plans").select("doc_id").eq("doc_id", parsed.documentId).limit(1);
  if (error || !Array.isArray(data)) return json({ ok: false, error: "registry_unavailable" }, 503);
  const registered = data.map((r: { doc_id?: string }) => clean(r.doc_id));
  const extra = parseExtraDocIds(Deno.env.get("FILMING_PLAN_WRITE_EXTRA_DOC_IDS"));
  if (!isOwnedDoc(parsed.documentId, registered, extra)) {
    return json({ ok: false, error: "doc_not_registered" }, 403);
  }

  try {
    const token = await serviceAccountToken(creds);
    const resp = await fetch(
      "https://docs.googleapis.com/v1/documents/" + encodeURIComponent(parsed.documentId) + ":batchUpdate",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: parsed.requests }),
        signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      },
    );
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = (out && out.error) || {};
      const detail = Array.isArray(err.details)
        ? err.details.map((d: Record<string, unknown>) => clean(d && d.reason)).find(Boolean)
        : "";
      return json({
        ok: false,
        error: "google_refused",
        google_status: resp.status,
        reason: clean(detail || err.status),
        share_with: resp.status === 403 || resp.status === 404 ? creds.email : undefined,
      }, 502);
    }
    const replies = Array.isArray(out.replies) ? out.replies.length : 0;
    return json({ ok: true, documentId: parsed.documentId, replies });
  } catch (_) {
    return json({ ok: false, error: "request_failed" }, 502);
  }
});
