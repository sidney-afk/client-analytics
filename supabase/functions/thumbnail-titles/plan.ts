// Reading a client's filming plan for thumbnail titles (session Titlecard, 2026-10-23, OPEN_REPAIRS 481).
//
// First the link reader the connector uses (planTabs: works for a Doc shared "anyone with the link").
// When that finds nothing, the Google Docs API with the service account the filming-plan-tabs function
// already holds (GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY), so a private
// plan works once it is shared with that account (owner decision 6). The token code is the same as
// filming-plan-tabs/index.ts, with the same read-only scope.

import { planTabs } from "../higgsfield-mcp/clientinfo.ts";
import { DOCS_TEXT_FIELDS, docTabsText } from "./manual.mjs";

const DOCS_SCOPE = "https://www.googleapis.com/auth/documents.readonly";
const GOOGLE_TIMEOUT_MS = 15000;

export type PlanTab = { id: string; name: string; text: string };
export type PlanRead = { tabs: PlanTab[]; source: "link" | "service_account" | "none"; shareWith: string; reason: string };

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
    c = { client_email: Deno.env.get("GOOGLE_CLIENT_EMAIL"), private_key: Deno.env.get("GOOGLE_PRIVATE_KEY") };
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
  const claim = b64url(JSON.stringify({ iss: creds.email, scope: DOCS_SCOPE, aud: creds.tokenUri, exp: now + 3600, iat: now }));
  const unsigned = header + "." + claim;
  const pkcs8 = creds.key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  const keyBytes = Uint8Array.from(atob(pkcs8), (ch) => ch.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(unsigned)));
  const resp = await fetch(creds.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }).toString(),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body.access_token) throw new Error("token_failed");
  const seconds = Number(body.expires_in);
  tokenCache = { value: String(body.access_token), expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000 };
  return tokenCache.value;
}

// The reason is Google's own word (PERMISSION_DENIED, NOT_FOUND) or a short code; never a body or token.
async function serviceAccountTabs(docId: string, creds: Creds): Promise<{ tabs: PlanTab[]; reason: string }> {
  try {
    const token = await serviceAccountToken(creds);
    const url = "https://docs.googleapis.com/v1/documents/" + encodeURIComponent(docId)
      + "?includeTabsContent=true&fields=" + encodeURIComponent(DOCS_TEXT_FIELDS);
    const resp = await fetch(url, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = (body && body.error) || {};
      return { tabs: [], reason: clean(err.status) || `http_${resp.status}` };
    }
    return { tabs: docTabsText(body) as PlanTab[], reason: "" };
  } catch (_) {
    return { tabs: [], reason: "request_failed" };
  }
}

export async function readPlanTabs(docId: string): Promise<PlanRead> {
  let tabs: PlanTab[] = [];
  try { tabs = await planTabs(docId); } catch (_e) { tabs = []; }
  // A private Doc's export can answer with Google's sign-in page instead of text: that is not a plan.
  tabs = tabs.filter((t) => !/^\s*<(?:!doctype|html)\b/i.test(t.text));
  if (tabs.length) return { tabs, source: "link", shareWith: "", reason: "" };
  const creds = readCreds();
  if (!creds) return { tabs: [], source: "none", shareWith: "", reason: "service_account_not_configured" };
  const sa = await serviceAccountTabs(docId, creds);
  if (sa.tabs.length) return { tabs: sa.tabs, source: "service_account", shareWith: "", reason: "" };
  return { tabs: [], source: "none", shareWith: creds.email, reason: sa.reason || "empty" };
}
