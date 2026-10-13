// Supabase Edge Function: frameio-token
//
// The Frame.io key keeper. Adobe's login (Adobe IMS) gives a NEW refresh token on every refresh and refuses
// the old one right after, so a caller that cannot save the new one loses the login within a day. This
// function keeps the one current refresh token in the table frameio_token_keeper
// (migrations/2026-10-13-frameio-token-keeper.sql) and hands out access tokens only.
//
//   POST /frameio-token            header x-broker-key: FRAMEIO_BROKER_KEY
//        -> 200 { access_token, expires_in, expires_at }            (refreshed; the new refresh token is saved)
//        -> 401 { error:"login_needed", login_url }                  (no saved login, or Adobe refused it)
//        -> 502 { error:"adobe_unavailable", message }               (Adobe down; the saved login is unchanged)
//        -> 503 { error:"busy", message }                            (another refresh held the lock too long)
//   GET  /frameio-token/login      sends the browser to Adobe's sign-in (one time, or after login_needed)
//   GET  /frameio-token/callback   Adobe returns here; saves the refresh token, answers "Frame.io connected."
//
// The redirect URI to register on the Adobe credential is <SUPABASE_URL>/functions/v1/frameio-token/callback.
// The refresh token is never returned and never logged. Logic and the table calls are in logic.mjs.
//
// Secrets (Edge Function secrets, never in the repo):
//   FRAMEIO_CLIENT_ID, FRAMEIO_CLIENT_SECRET   the Adobe "OAuth Web App" credential
//   FRAMEIO_BROKER_KEY                         at least 32 characters; callers send it as x-broker-key
//   FRAMEIO_LOGIN_EMAIL                        the Adobe account(s) allowed to connect, comma separated
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import { finishLogin, refreshAccessToken, startLogin, supabaseStore } from "./logic.mjs";

const clean = (v: unknown): string => String(v == null ? "" : v).trim();
const NO_STORE = { "Cache-Control": "no-store" };

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...NO_STORE, "Content-Type": "application/json" } });
}
function text(msg: string, status = 200): Response {
  return new Response(msg + "\n", { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}
function newState(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop() || "";

  if (req.method === "POST" && route === "frameio-token") {
    const brokerKey = clean(Deno.env.get("FRAMEIO_BROKER_KEY"));
    const given = clean(req.headers.get("x-broker-key"));
    if (brokerKey.length < 32 || !given || !timingSafeEqual(given, brokerKey)) return json({ error: "unauthorized" }, 401);
  } else if (!(req.method === "GET" && (route === "login" || route === "callback"))) {
    return json({ error: "not_found" }, 404);
  }

  const clientId = clean(Deno.env.get("FRAMEIO_CLIENT_ID"));
  const clientSecret = clean(Deno.env.get("FRAMEIO_CLIENT_SECRET"));
  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL")).replace(/\/+$/, "");
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!clientId || !clientSecret || !supabaseUrl || !serviceKey) {
    return req.method === "POST"
      ? json({ error: "not_configured", message: "The Frame.io client id or secret is not set on the server." }, 500)
      : text("Not set up yet: the Frame.io client id or secret is missing on the server.", 500);
  }
  const base = supabaseUrl + "/functions/v1/frameio-token";
  const store = supabaseStore(createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }));

  try {
    if (route === "login") {
      const out = await startLogin({ store, clientId, redirectUri: base + "/callback", newState });
      return new Response(null, { status: out.status, headers: { ...NO_STORE, Location: out.location } });
    }
    if (route === "callback") {
      const out = await finishLogin({
        store, fetchFn: fetch, clientId, clientSecret,
        allowedEmails: clean(Deno.env.get("FRAMEIO_LOGIN_EMAIL")), query: url.searchParams,
      });
      if (out.status !== 200) console.warn("frameio-token callback refused", out.status);
      return text(out.text, out.status);
    }
    const out = await refreshAccessToken({
      store, fetchFn: fetch, clientId, clientSecret, loginUrl: base + "/login",
      leaseId: crypto.randomUUID(), sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    });
    const body = out.body as Record<string, unknown>;
    if (out.status !== 200 || body.warning) console.warn("frameio-token refresh", out.status, body.error || body.warning);
    return json(body, out.status);
  } catch (e) {
    // A database failure before Adobe was called: nothing was spent.
    console.error("frameio-token database error", e instanceof Error ? e.message : String(e));
    return req.method === "POST"
      ? json({ error: "database_unavailable", message: "The saved login could not be read. Try again later." }, 503)
      : text("The server could not save the login just now. Open the login link again in a minute.", 503);
  }
});
