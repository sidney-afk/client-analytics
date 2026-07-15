// Supabase Edge Function: sample-review-reorder
//
// A2 port of the live sample-review-reorder workflow. This preserves the n8n
// contract: validate {client, items}, update order_index for matching
// sample_reviews rows, and respond {ok:true, updated: items.length}.
//
// Required env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeBrowserWrite,
  browserWriteAuthResponse,
  normalizeBrowserWriteClient,
} from "../_shared/browser-write-auth.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};

type JsonMap = Record<string, unknown>;
type ReorderItem = { id: string; order_index: string };

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function parsePayload(body: JsonMap): { client: string; items: ReorderItem[] } {
  const client = normalizeBrowserWriteClient(body.client);
  if (!client) throw new Error("client required");
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) throw new Error("items[] required");
  const items = raw.map((it) => {
    const item = it && typeof it === "object" ? it as JsonMap : {};
    const id = clean(item.id);
    if (!id) throw new Error("every item needs an id");
    const n = Number(item.order_index);
    if (!Number.isFinite(n)) throw new Error("every item needs a numeric order_index");
    return { id, order_index: String(n) };
  });
  return { client, items };
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let client = "";
  let itemCount = 0;
  let outcome = "error";

  try {
    const body = JSON.parse(await req.text()) as JsonMap;
    const parsed = parsePayload(body);
    client = parsed.client;
    itemCount = parsed.items.length;
    const now = new Date().toISOString();
    const events: JsonMap[] = [];

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const actor = await authorizeBrowserWrite(supabase, req, client, "sample-review-reorder");

    for (const item of parsed.items) {
      const { data, error } = await supabase.from("sample_reviews")
        .update({ order_index: item.order_index })
        .eq("client", client)
        .eq("id", item.id)
        .select("id");
      if (error) throw new Error("sample reorder failed");
      if (Array.isArray(data) && data.length) {
        events.push({
          client,
          sample_id: item.id,
          ts: now,
          actor: actor.actor,
          role: actor.role,
          action: "reorder",
          source: actor.source,
          payload: { order_index: item.order_index },
          created_at: now,
        });
      }
    }

    if (events.length) {
      const { error } = await supabase.from("sample_review_events").insert(events);
      if (error) throw new Error("sample reorder event failed");
    }

    outcome = "ok";
    return json({ ok: true, updated: parsed.items.length });
  } catch (e) {
    const auth = browserWriteAuthResponse(e);
    if (auth) {
      outcome = "denied";
      return json({ ok: false, error: auth.code }, auth.status);
    }
    const msg = e instanceof Error ? e.message : "request failed";
    return json({ ok: false, error: msg }, 500);
  } finally {
    console.log(JSON.stringify({
      fn: "sample-review-reorder",
      client,
      items: itemCount,
      outcome,
      ms: Date.now() - started,
    }));
  }
});
