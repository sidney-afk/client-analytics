// MCP OAuth sign-in for apps that will not take a link with ?key= in it (for
// example apps whose "custom MCP server" box only does OAuth).
//
// Nothing new is stored. The person types their existing personal pass once on
// our sign-in page; every value we hand the app (client id, code, tokens) is
// sealed with a key derived from the function's service key, so only this
// function can open it. Turning a person off in hf_team_members, or giving
// them a new pass, ends every sign-in made with the old pass, because each
// request still looks the pass up.
//
// Pure module: no Deno or Supabase imports, so the Node tests load it directly.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const CODE_TTL_S = 5 * 60;
export const ACCESS_TTL_S = 30 * 24 * 3600;
const PREFIX = { client: "smc1.", code: "smk1.", access: "sma1.", refresh: "smr1." };

function b64u(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(text) {
  const s = atob(String(text).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function keysFrom(secret) {
  if (!secret) throw new Error("oauth: no secret");
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  const derive = (info) => crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("syncmate-oauth"), info: enc.encode(info) },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
  return { seal: await derive("seal-v1") };
}

async function seal(keys, prefix, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(prefix) }, keys.seal, enc.encode(JSON.stringify(payload)),
  ));
  return prefix + b64u(iv) + "." + b64u(body);
}

async function open(keys, prefix, token) {
  const t = String(token || "");
  if (!t.startsWith(prefix)) return null;
  const [iv, body] = t.slice(prefix.length).split(".");
  if (!iv || !body) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64u(iv), additionalData: enc.encode(prefix) }, keys.seal, unb64u(body),
    );
    return JSON.parse(dec.decode(plain));
  } catch {
    return null;
  }
}

async function sha256b64u(text) {
  return b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

export function redirectAllowed(uri) {
  let u;
  try { u = new URL(String(uri)); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// True for a token this module made (so the caller sends it here, not to the pass lookup).
export function isOAuthToken(token) {
  return String(token || "").startsWith(PREFIX.access);
}

// deps: { secret, baseUrl (public URL of the function, no trailing slash),
//         checkPass(pass) -> Promise<boolean>, now?() -> seconds }
export function makeOAuth(deps) {
  const now = deps.now || (() => Math.floor(Date.now() / 1000));
  const base = String(deps.baseUrl).replace(/\/+$/, "");
  let keysP;
  const keys = () => (keysP ||= keysFrom(deps.secret));
  const json = (status, body, extra = {}) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
  const oauthError = (error, description, status = 400) => json(status, { error, error_description: description });

  const serverMeta = () => ({
    issuer: base,
    authorization_endpoint: base + "/oauth/authorize",
    token_endpoint: base + "/oauth/token",
    registration_endpoint: base + "/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  });

  const resourceMeta = () => ({
    resource: base,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_name: "SyncMate (Synchro Social)",
  });

  async function client(clientId) {
    const c = await open(await keys(), PREFIX.client, clientId);
    return c && Array.isArray(c.r) ? c : null;
  }

  async function register(req) {
    let body;
    try { body = await req.json(); } catch { return oauthError("invalid_client_metadata", "Body must be JSON."); }
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10 || !uris.every(redirectAllowed)) {
      return oauthError("invalid_redirect_uri", "redirect_uris must be https (or http on localhost).");
    }
    const name = String(body.client_name || "").slice(0, 80);
    const clientId = await seal(await keys(), PREFIX.client, { r: uris, n: name });
    return json(201, {
      client_id: clientId,
      client_id_issued_at: now(),
      client_name: name || undefined,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  }

  function page(p, message) {
    const host = (() => { try { return new URL(p.redirect_uri).host; } catch { return ""; } })();
    const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"]
      .map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to SyncMate</title><style>
body{font:16px/1.5 system-ui,sans-serif;background:#f5f5f4;color:#1c1917;margin:0;display:grid;place-items:center;min-height:100vh}
main{background:#fff;max-width:420px;width:calc(100% - 32px);padding:28px;border-radius:14px;box-shadow:0 2px 12px #0001}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 14px;color:#57534e}.app{font-weight:600;color:#1c1917}
input[type=password]{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border:1px solid #d6d3d1;border-radius:8px}
button{margin-top:14px;width:100%;padding:11px;font-size:16px;border:0;border-radius:8px;background:#1c1917;color:#fff;cursor:pointer}
.err{color:#b91c1c}</style></head><body><main>
<h1>Sign in to SyncMate</h1>
<p><span class="app">${esc(p.client_name || "An app")}</span> wants to use SyncMate as you. After you sign in you go back to <span class="app">${esc(host)}</span>. Only continue if you started this yourself.</p>
${message ? `<p class="err">${esc(message)}</p>` : ""}
<form method="post" action="${esc(base)}/oauth/authorize">${hidden}
<label for="pass">Your personal pass (the part after <code>key=</code> in your SyncMate link)</label>
<input id="pass" name="pass" type="password" autocomplete="off" required autofocus>
<button type="submit">Sign in</button></form></main></body></html>`;
    return new Response(html, {
      status: message ? 401 : 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' " + new URL(base).origin + "; frame-ancestors 'none'" },
    });
  }

  async function authParams(p) {
    if (p.response_type !== undefined && p.response_type !== "code") return "Only response_type=code is supported.";
    const c = await client(p.client_id);
    if (!c) return "This app is not registered. Remove the connector in the app and add it again.";
    if (!c.r.includes(p.redirect_uri)) return "The app's return address does not match its registration.";
    if (!p.code_challenge || (p.code_challenge_method || "S256") !== "S256") return "The app must use PKCE (S256).";
    p.client_name = c.n;
    return "";
  }

  async function authorize(req, url) {
    if (req.method === "GET") {
      const p = Object.fromEntries(url.searchParams);
      const problem = await authParams(p);
      if (problem) return new Response(problem, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      return page(p, "");
    }
    const form = Object.fromEntries(new URLSearchParams(await req.text()));
    const problem = await authParams(form);
    if (problem) return new Response(problem, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const pass = String(form.pass || "").trim();
    if (!(await deps.checkPass(pass))) return page(form, "That pass was not recognised. Check it and try again.");
    const code = await seal(await keys(), PREFIX.code, {
      p: pass, c: form.client_id, r: form.redirect_uri, x: form.code_challenge, e: now() + CODE_TTL_S,
    });
    const back = new URL(form.redirect_uri);
    back.searchParams.set("code", code);
    if (form.state) back.searchParams.set("state", form.state);
    return new Response(null, { status: 302, headers: { Location: back.toString(), "Cache-Control": "no-store" } });
  }

  async function tokens(pass, clientId) {
    const k = await keys();
    return json(200, {
      access_token: await seal(k, PREFIX.access, { p: pass, e: now() + ACCESS_TTL_S }),
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: await seal(k, PREFIX.refresh, { p: pass, c: clientId }),
      scope: "mcp",
    });
  }

  async function token(req) {
    const type = req.headers.get("content-type") || "";
    let f;
    try {
      f = type.includes("application/json") ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text()));
    } catch { return oauthError("invalid_request", "Unreadable body."); }
    const k = await keys();
    if (f.grant_type === "authorization_code") {
      const code = await open(k, PREFIX.code, f.code);
      if (!code || code.e < now()) return oauthError("invalid_grant", "Code is invalid or expired.");
      if (f.client_id && f.client_id !== code.c) return oauthError("invalid_grant", "Code was issued to another app.");
      if (f.redirect_uri && f.redirect_uri !== code.r) return oauthError("invalid_grant", "redirect_uri does not match.");
      if (!f.code_verifier || (await sha256b64u(String(f.code_verifier))) !== code.x) return oauthError("invalid_grant", "PKCE check failed.");
      if (!(await deps.checkPass(code.p))) return oauthError("invalid_grant", "This pass is no longer active.");
      return tokens(code.p, code.c);
    }
    if (f.grant_type === "refresh_token") {
      const r = await open(k, PREFIX.refresh, f.refresh_token);
      if (!r) return oauthError("invalid_grant", "Refresh token is invalid.");
      if (f.client_id && f.client_id !== r.c) return oauthError("invalid_grant", "Refresh token was issued to another app.");
      if (!(await deps.checkPass(r.p))) return oauthError("invalid_grant", "This pass is no longer active.");
      return tokens(r.p, r.c);
    }
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }

  return {
    // The personal pass inside a token this module issued, or null if it is not valid now.
    async passFromToken(token) {
      const a = await open(await keys(), PREFIX.access, token);
      return a && a.e >= now() && typeof a.p === "string" ? a.p : null;
    },
    // 401 that tells an OAuth app where to sign in.
    challenge(headers = {}) {
      return new Response(JSON.stringify({ error: "invalid_token", error_description: "Sign in to SyncMate first." }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json", "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="mcp"` },
      });
    },
    // Handles the OAuth paths; returns null for anything else. `sub` is the
    // path after the function name ("" for the MCP endpoint itself).
    async handle(req, sub, url) {
      if (req.method === "GET" && /^\/\.well-known\/oauth-protected-resource(\/.*)?$/.test(sub)) return json(200, resourceMeta());
      if (req.method === "GET" && /^\/\.well-known\/(oauth-authorization-server|openid-configuration)$/.test(sub)) return json(200, serverMeta());
      if (sub === "/oauth/register" && req.method === "POST") return register(req);
      if (sub === "/oauth/authorize" && (req.method === "GET" || req.method === "POST")) return authorize(req, url);
      if (sub === "/oauth/token" && req.method === "POST") return token(req);
      return null;
    },
  };
}
