// Supabase Edge Function: instagram-upload
//
// The Instagram twin of the TikTok Upload on n8n, built in Supabase on purpose (owner, 2026-09-30). The page
// (TikTok Upload tab, Instagram side) talks only to this function; it holds the Post For Me key, keeps the queue
// in the table `instagram_uploads`, and asks Post For Me how each post went. No n8n workflow is involved.
//
//   POST { action: "mint" }                          { ok, upload_url, media_url }   one-time Post For Me storage URL
//   POST { action: "create", clientName, socialAccountId, title, mediaUrl, options?, scheduledAtUTC?, timezone?,
//          idempotencyKey? }                          { ok, id, status, scheduled_for, error?, row }
//   POST { action: "list", client? }                 { ok, rows: [...] }    newest first, refreshed from Post For Me
//   POST { action: "status", id }                    { ok, row }
//   POST { action: "cancel", id }                    { ok, row }            only a still-scheduled post
//
// Safety: a staff role key is required; the account must be an Instagram account according to Post For Me itself;
// the account must be the one on file for that client (synced Clients Info); and only the clients in
// INSTAGRAM_UPLOAD_ALLOWED_CLIENTS can post (nobody until it is set; "*" = everyone).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POST_FOR_ME_API_KEY, a staff role key secret
// (ROLE_KEY_ADMIN / ROLE_KEY_SMM / ROLE_KEY_CREATIVE). Optional: INSTAGRAM_UPLOAD_ALLOWED_CLIENTS.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import {
  applyCreateResponse, applyResults, buildCreate, clientAllowed, clientKey, expectedAccountId, needsRefresh,
  platformMismatch, publicRow, refreshCandidates,
} from "./logic.mjs";

const PFM = "https://api.postforme.dev/v1";
const LIST_LIMIT = 100;
const REFRESH_PER_LIST = 10;
const PFM_TIMEOUT_MS = 25000;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source",
  "Cache-Control": "no-store",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const clean = (v: unknown): string => String(v == null ? "" : v).trim();

// One call to Post For Me. Never throws: a network failure is reported as { ok:false, status:0 }.
async function pfm(key: string, method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const resp = await fetch(PFM + path, {
      method,
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(PFM_TIMEOUT_MS),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const pfmKey = Deno.env.get("POST_FOR_ME_API_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);

  const auth = authorizeStaffKey(clean(req.headers.get("x-syncview-key")), ["admin", "smm", "creative"]);
  if (!auth.ok) return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));
  if (!pfmKey) return json({ ok: false, error: "Post For Me key is not set on the server (POST_FOR_ME_API_KEY)" }, 500);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = clean(body.action);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const actor = clean(req.headers.get("x-syncview-actor")) || auth.role || "staff";

  // Asks Post For Me how a not-yet-finished post went and saves the answer.
  const refresh = async (row: any) => {
    if (!needsRefresh(row)) return row;
    const r = await pfm(pfmKey, "GET", "/social-post-results?post_id=" + encodeURIComponent(row.post_id));
    const nowIso = new Date().toISOString();
    if (!r.ok) return row;
    const next = applyResults(row, r.data, nowIso);
    const { error } = await db.from("instagram_uploads").update({
      status: next.status, instagram_url: next.instagram_url, error: next.error, posted_at: next.posted_at,
      updated_at: next === row ? row.updated_at : next.updated_at, last_checked_at: nowIso,
    }).eq("id", row.id);
    return error || next === row ? row : next;
  };

  try {
    if (action === "mint") {
      const r = await pfm(pfmKey, "POST", "/media/create-upload-url");
      const uploadUrl = clean(r.data?.upload_url), mediaUrl = clean(r.data?.media_url);
      if (!r.ok || !uploadUrl || !mediaUrl) return json({ ok: false, error: "Post For Me did not return an upload url" }, 502);
      return json({ ok: true, upload_url: uploadUrl, media_url: mediaUrl });
    }

    if (action === "create") {
      const built = buildCreate(body, Date.now(), actor);
      if (!built.ok) return json({ ok: false, error: built.error }, 400);
      const row = built.row!;
      const postBody = built.postBody!;
      if (!clientAllowed(row.client, Deno.env.get("INSTAGRAM_UPLOAD_ALLOWED_CLIENTS"))) {
        return json({ ok: false, error: "Instagram posting is not switched on for this client yet." }, 403);
      }
      // Same idempotency key twice = the same post, never two.
      const { data: existing, error: exErr } = await db.from("instagram_uploads").select("*").eq("id", row.id).maybeSingle();
      if (exErr) throw exErr;
      if (existing && existing.post_id) return json({ ok: existing.status !== "failed", id: existing.id, status: existing.status, scheduled_for: existing.scheduled_for, row: publicRow(existing) });

      // The account must be the one on file for this client: a caller cannot swap in another client's account.
      const { data: profile, error: pErr } = await db.from("client_profiles").select("extra").eq("slug", clientKey(row.client)).is("archived_at", null).maybeSingle();
      if (pErr) throw pErr;
      const expected = expectedAccountId(profile);
      if (!expected) return json({ ok: false, error: "The synced Clients Info copy has no Instagram account for this client yet. It refreshes daily; run the Sheets copy lane to refresh it now." }, 409);
      if (expected !== row.account_id) return json({ ok: false, error: "That account is not the one on file for this client." }, 403);

      // Post For Me must say this account is an Instagram one. Fail closed on anything else.
      const acct = await pfm(pfmKey, "GET", "/social-accounts/" + encodeURIComponent(row.account_id));
      if (!acct.ok) {
        return json({ ok: false, error: acct.status === 404 ? "Post For Me does not know that account id." : "Could not check the account with Post For Me. Try again." }, acct.status === 404 ? 400 : 502);
      }
      const mismatch = platformMismatch(acct.data);
      if (mismatch) return json({ ok: false, error: mismatch }, 400);

      if (existing) {
        // An earlier attempt with this key never got a post id back. If Post For Me did accept it, adopt it: never a second post.
        const found = await pfm(pfmKey, "GET", "/social-posts?external_id=" + encodeURIComponent(row.id));
        const hit = Array.isArray(found.data?.data) ? found.data.data.find((x: any) => x && x.id && (!x.external_id || String(x.external_id) === row.id)) : null;
        if (hit) {
          const adopted = applyCreateResponse({ ...existing }, hit, new Date().toISOString());
          await db.from("instagram_uploads").update({ status: adopted.status, post_id: adopted.post_id, error: "", updated_at: adopted.updated_at }).eq("id", row.id);
          return json({ ok: true, id: adopted.id, status: adopted.status, scheduled_for: adopted.scheduled_for, row: publicRow(adopted) });
        }
        const { error: rErr } = await db.from("instagram_uploads").update({ status: row.status, error: "", updated_at: row.updated_at }).eq("id", row.id);
        if (rErr) throw rErr;
      } else {
        const { error: insErr } = await db.from("instagram_uploads").insert(row);
        if (insErr) throw insErr;
      }
      const created = await pfm(pfmKey, "POST", "/social-posts", postBody);
      const next = applyCreateResponse(row, created.ok ? created.data : { message: created.data?.message || created.data?.error || ("Post For Me answered " + created.status) }, new Date().toISOString());
      const { error: upErr } = await db.from("instagram_uploads").update({
        status: next.status, post_id: next.post_id, error: next.error, posted_at: next.posted_at, updated_at: next.updated_at,
      }).eq("id", row.id);
      if (upErr) throw upErr;
      return json({ ok: next.status !== "failed", id: next.id, status: next.status, scheduled_for: next.scheduled_for, error: next.error || undefined, row: publicRow(next) });
    }

    if (action === "list") {
      const client = clean(body.client);
      let q = db.from("instagram_uploads").select("*").order("created_at", { ascending: false }).limit(LIST_LIMIT);
      if (client) q = q.eq("client", client);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      const stale = refreshCandidates(rows, Date.now(), REFRESH_PER_LIST);
      const fresh = new Map<string, any>();
      await Promise.all(stale.map(async (r: any) => { fresh.set(r.id, await refresh(r)); }));
      return json({ ok: true, rows: rows.map((r: any) => publicRow(fresh.get(r.id) || r)) });
    }

    if (action === "status" || action === "cancel") {
      const id = clean(body.id);
      if (!id) return json({ ok: false, error: "id required" }, 400);
      const { data: row, error } = await db.from("instagram_uploads").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!row) return json({ ok: false, error: "not found" }, 404);
      if (action === "status") return json({ ok: true, row: publicRow(await refresh(row)) });
      if (row.status !== "scheduled" || !row.post_id) return json({ ok: false, error: "Only a scheduled post can be cancelled." }, 409);
      const del = await pfm(pfmKey, "DELETE", "/social-posts/" + encodeURIComponent(row.post_id));
      if (!del.ok && del.status !== 404) return json({ ok: false, error: "Post For Me did not cancel the post. Try again." }, 502);
      const nowIso = new Date().toISOString();
      const { error: upErr } = await db.from("instagram_uploads").update({ status: "cancelled", updated_at: nowIso }).eq("id", id);
      if (upErr) throw upErr;
      return json({ ok: true, row: publicRow({ ...row, status: "cancelled", updated_at: nowIso }) });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
