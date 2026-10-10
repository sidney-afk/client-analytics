// Supabase Edge Function: calendar-auto-posted
//
// Turns a Calendar post from "Scheduled" to "Posted" once its scheduled day has
// ended in US Eastern time (rule, path and history in ./logic.mjs; OPEN_REPAIRS
// 394). Called only by the pg_cron job calendar-auto-posted-tick every 15
// minutes (migrations/2026-10-10-calendar-auto-posted.sql), never by a browser.
//
// Off unless the runtime flag calendar_auto_posted lists the client ("*" = all);
// the database's calendar_auto_posted_due() returns nothing for a client that is
// off, so an off client is never read further, let alone written.
//
// Writes go through the same two functions a person's click uses, over HTTP:
// production-write (work items) and calendar-upsert (the card). This function
// never updates calendar_posts or deliverables itself.
//
// Auth: the timer sends the Vault secret calendar_auto_posted_key in
// x-calendar-auto-posted-key; the database compares it
// (calendar_auto_posted_key_ok), so no copy of that key lives in a function secret.
//
// Actions: "ping" (ready check, writes nothing), "dry_run" (what a tick would do,
// counts and card ids only, writes nothing), "tick".
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (platform-provided)
//   ROLE_KEY_ADMIN                 the admin role key production-write already checks
//   CALENDAR_AUTO_POSTED_ACTOR     the exact roster name of one ACTIVE admin. The
//                                  gateway only accepts a roster member, so the
//                                  Production history names this person.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { ACTOR_LABEL, CARD_FIELDS, DEFAULT_LIMIT, requestIdFor, runTick, SOURCE } from "./logic.mjs";

type Json = Record<string, unknown>;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function clean(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function deps(db: SupabaseClient, url: string, anonKey: string, adminKey: string, actor: string) {
  const fnHeaders = (extra: Record<string, string>) => ({
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "x-syncview-source": SOURCE,
    ...extra,
  });
  return {
    now: () => new Date(),
    sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
    due: async (limit: number) => {
      const { data, error } = await db.rpc("calendar_auto_posted_due", { p_limit: limit });
      if (error) throw new Error("due_read_failed");
      return (data || []) as Json[];
    },
    readCard: async (client: string, id: string) => {
      const { data, error } = await db.from("calendar_posts").select(CARD_FIELDS.join(","))
        .eq("client", client).eq("id", id).limit(2);
      if (error || !Array.isArray(data) || data.length !== 1) return null;
      return data[0] as unknown as Json;
    },
    // production-write, exactly the body the Calendar sends for a status pick
    // (_writeUiGatewayPost), plus the compare-and-set the gateway honours.
    pushWorkItem: async (push: Json, ctx: Json) => {
      try {
        const response = await fetch(`${url}/functions/v1/production-write`, {
          method: "POST",
          headers: fnHeaders({ "x-syncview-key": adminKey, "x-syncview-actor": actor }),
          body: JSON.stringify({
            operation: "status",
            surface: "calendar",
            entity: "deliverable",
            id: push.deliverable_id,
            status: "posted",
            // Deterministic per card, part and work-item version: a retry of the
            // same move is an exact replay, never a second change.
            request_id: requestIdFor(ctx.id, push.component, push.expected_updated_at),
            source_edited_at: new Date().toISOString(),
            expected_status: push.expected_status,
            expected_updated_at: push.expected_updated_at,
          }),
          signal: AbortSignal.timeout(30000),
        });
        const body = await response.json().catch(() => ({})) as Json;
        if (!response.ok || body.ok !== true) {
          return { ok: false, error: clean(body.error || body.code) || `http_${response.status}` };
        }
        return { ok: true };
      } catch (_e) {
        return { ok: false, error: "gateway_unreachable" };
      }
    },
    // calendar-upsert, the body shape the Calendar sends (client + post), with
    // the card's fresh change time as comments_base_at: its conflict guard then
    // refuses if anyone saved the card after that read.
    saveCard: async (client: string, id: string, patch: Json, baseAt: string) => {
      try {
        const response = await fetch(`${url}/functions/v1/calendar-upsert`, {
          method: "POST",
          headers: fnHeaders({ "x-syncview-actor": ACTOR_LABEL, "x-syncview-role": "system" }),
          body: JSON.stringify({ client, post: { id, ...patch }, comments_base_at: baseAt }),
          signal: AbortSignal.timeout(30000),
        });
        const body = await response.json().catch(() => ({})) as Json;
        if (body.conflict === true) return { ok: false, conflict: true };
        if (!response.ok || body.ok !== true) return { ok: false, error: `http_${response.status}` };
        return { ok: true };
      } catch (_e) {
        return { ok: false, error: "calendar_unreachable" };
      }
    },
    // Only rows calendar-upsert writes count here ("ui" or this run's source);
    // the bridge's own rows ("native-bridge") are not evidence either way.
    sourceOf: async (client: string, id: string, sinceIso: string) => {
      const { data, error } = await db.from("calendar_post_events").select("source")
        .eq("client", client).eq("post_id", id).eq("action", "status_change")
        .in("source", [SOURCE, "ui"]).gte("ts", sinceIso).limit(20);
      if (error || !Array.isArray(data) || !data.length) return "none";
      return data.some(r => clean((r as Json).source) === SOURCE) ? SOURCE : "other";
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const given = clean(req.headers.get("x-calendar-auto-posted-key"));
  if (given.length < 32) return json({ ok: false, error: "unauthorized" }, 401);
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const anonKey = clean(Deno.env.get("SUPABASE_ANON_KEY"));
  if (!url || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: keyOk, error: keyError } = await db.rpc("calendar_auto_posted_key_ok", { p_key: given });
  if (keyError || keyOk !== true) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Json;
  const action = clean(body.action);
  const adminKey = clean(Deno.env.get("ROLE_KEY_ADMIN"));
  const actor = clean(Deno.env.get("CALENDAR_AUTO_POSTED_ACTOR"));
  const missing = [!anonKey && "SUPABASE_ANON_KEY", !adminKey && "ROLE_KEY_ADMIN", !actor && "CALENDAR_AUTO_POSTED_ACTOR"].filter(Boolean);

  if (action === "ping") {
    return json({ ok: true, pong: "calendar-auto-posted", ready: missing.length === 0, missing });
  }
  if (action !== "tick" && action !== "dry_run") return json({ ok: false, error: "unknown action" }, 400);
  if (action === "tick" && missing.length) return json({ ok: false, error: "not_configured", missing }, 500);

  const result = await runTick(deps(db, url, anonKey, adminKey, actor), {
    dryRun: action === "dry_run",
    limit: Number(body.limit) || DEFAULT_LIMIT,
  });
  console.log(JSON.stringify({ fn: "calendar-auto-posted", action, ...result }));
  return json(result, result.ok ? 200 : 502);
});
