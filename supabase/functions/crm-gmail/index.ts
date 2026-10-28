// crm-gmail: reads who one company mailbox has emailed, for the Leads CRM
// (docs/features/CRM_LEADS.md, "Gmail"). Read only: Gmail scope is
// gmail.metadata (headers only; Google refuses bodies with it), through the Google service account with Workspace
// domain-wide delegation. Server key only (same check as crm-leads).
// Never logs an address, a subject or a body; returns headers only.
//
//   probe            { }                     -> { ok, client_id, messages_total? , error? }
//   sent_recipients  { after?, max_messages? } -> { ok, recipients: [{ email, name, count, first, last }] }
//
// The mailbox is the MAILBOX constant only.

const SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const OWN_DOMAIN = "synchrosocial.com";
const MAX_MESSAGES = 5000;
// The one mailbox this function may act as. Domain-wide delegation would let the
// service account act as anyone in the Workspace, so this is a constant, never
// a request field or a secret someone could change.
const MAILBOX = "kasper@" + OWN_DOMAIN;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function clean(v: unknown) { return String(v == null ? "" : v).trim(); }
function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a || ""), y = new TextEncoder().encode(b || "");
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** Service-role key only: the legacy env key, or a newer secret key checked
 *  with b4_service_role_probe (executable by service_role only). */
async function serverKeyOk(req: Request): Promise<boolean> {
  const service = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const bearer = clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  if (service && timingSafeEqual(bearer, service)) return true;
  const url = clean(Deno.env.get("SUPABASE_URL"));
  if (!url) return false;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/b4_service_role_probe`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, apikey: bearer, "content-type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch (_e) {
    return false;
  }
}

function readCreds() {
  let c: Record<string, unknown>;
  try { c = JSON.parse(clean(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")) || "{}"); } catch (_e) { return null; }
  const email = clean(c.client_email);
  const key = clean(c.private_key).replace(/\\n/g, "\n");
  if (!email || !key) return null;
  return { email, key, clientId: clean(c.client_id), tokenUri: clean(c.token_uri) || "https://oauth2.googleapis.com/token" };
}

async function token(creds: { email: string; key: string; tokenUri: string }, subject: string): Promise<string> {
  const enc = new TextEncoder();
  const b64url = (s: string | Uint8Array) => {
    const bytes = typeof s === "string" ? enc.encode(s) : s;
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({ iss: creds.email, sub: subject, scope: SCOPE, aud: creds.tokenUri, exp: now + 3600, iat: now }));
  const pkcs8 = creds.key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  const k = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pkcs8), (ch) => ch.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, enc.encode(unsigned)));
  const resp = await fetch(creds.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body.access_token) throw new Error("google_login_failed:" + clean(body.error || resp.status));
  return String(body.access_token);
}

async function gmail(tok: string, path: string): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(GMAIL + path, { headers: { Authorization: "Bearer " + tok } });
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1))); continue; }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("gmail_" + r.status);
    return body;
  }
  throw new Error("gmail_busy");
}

/** "Name <a@b.c>, d@e.f" -> [{ email, name }] */
export function parseAddresses(header: string): { email: string; name: string }[] {
  const out: { email: string; name: string }[] = [];
  for (const part of String(header || "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const m = part.match(/<([^>]+)>/);
    const email = clean(m ? m[1] : part).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    const name = m ? clean(part.slice(0, part.indexOf("<"))).replace(/^"|"$/g, "") : "";
    out.push({ email, name });
  }
  return out;
}

async function sentRecipients(tok: string, body: Record<string, unknown>) {
  const after = /^\d{4}\/\d{2}\/\d{2}$/.test(clean(body.after)) ? clean(body.after) : "";
  const cap = Math.min(MAX_MESSAGES, Math.max(1, Number(body.max_messages) || MAX_MESSAGES));
  const afterMs = after ? Date.parse(after.replace(/\//g, "-") + "T00:00:00Z") : 0;
  const ids: string[] = [];
  let pageToken = "";
  while (ids.length < cap) {
    const page = await gmail(tok, `/messages?labelIds=SENT&maxResults=500${pageToken ? "&pageToken=" + pageToken : ""}`);
    for (const m of page.messages || []) ids.push(String(m.id));
    pageToken = clean(page.nextPageToken);
    if (!pageToken) break;
  }
  const people = new Map<string, { email: string; name: string; count: number; first: string; last: string }>();
  const list = ids.slice(0, cap);
  let failed = 0;
  for (let i = 0; i < list.length; i += 20) {
    const batch = await Promise.all(list.slice(i, i + 20).map((id) =>
      gmail(tok, `/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`).catch(() => null)));
    for (const m of batch) {
      if (!m) { failed++; continue; }
      if (afterMs && (Number(m.internalDate) || 0) < afterMs) continue;
      const when = new Date(Number(m.internalDate) || 0).toISOString();
      const hs: any[] = (m.payload && m.payload.headers) || [];
      for (const h of hs) {
        for (const a of parseAddresses(h.value)) {
          if (a.email.endsWith("@" + OWN_DOMAIN)) continue;
          const p = people.get(a.email) || { email: a.email, name: a.name, count: 0, first: when, last: when };
          p.count++;
          if (!p.name && a.name) p.name = a.name;
          if (when < p.first) p.first = when;
          if (when > p.last) p.last = when;
          people.set(a.email, p);
        }
      }
    }
  }
  return { ok: true, messages: list.length, failed, complete: failed === 0 && ids.length < cap, truncated: ids.length >= cap, recipients: [...people.values()].sort((a, b) => b.last.localeCompare(a.last)) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "use POST" }, 405);
  if (!(await serverKeyOk(req))) return json({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = clean(body.action);
  const creds = readCreds();
  if (!creds) return json({ ok: false, error: "google_not_configured" }, 503);
  const mailbox = MAILBOX;
  let tok: string;
  try {
    tok = await token(creds, mailbox);
  } catch (e) {
    // unauthorized_client here means the Workspace admin has not approved this
    // client id for the gmail.metadata scope yet.
    return json({ ok: false, error: String((e as Error).message), client_id: creds.clientId, scope: SCOPE }, 502);
  }
  try {
    if (action === "probe") {
      const p = await gmail(tok, "/profile");
      return json({ ok: true, client_id: creds.clientId, messages_total: p.messagesTotal || 0 });
    }
    if (action === "sent_recipients") return json(await sentRecipients(tok, body));
    return json({ ok: false, error: "bad_action" }, 400);
  } catch (e) {
    console.log(JSON.stringify({ fn: "crm-gmail", action, error: String((e as Error).message) }));
    return json({ ok: false, error: String((e as Error).message) }, 502);
  }
});
