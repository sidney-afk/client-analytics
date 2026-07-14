// Supabase Edge Function: caption-prompts-save
//
// A4 port of only the caption prompt settings writer. Caption generation stays
// on n8n and is intentionally not touched by this function.
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

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const clientSlug = normalizeBrowserWriteClient(body.client);
    if (!clientSlug) return json({ ok: false, error: "client required" }, 400);
    const prompt = String(body.prompt == null ? "" : body.prompt);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);

    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const actor = await authorizeBrowserWrite(db, req, clientSlug, "caption-prompts-save");
    const now = new Date().toISOString();
    const { data, error } = await db
      .from("caption_prompts")
      .upsert({
        client_slug: clientSlug,
        prompt,
        updated_at: now,
        updated_by: actor.actor || "syncview",
      }, { onConflict: "client_slug" })
      .select("client_slug,prompt,updated_at")
      .single();
    if (error) throw error;

    const { error: eventError } = await db.from("settings_events").insert({
      surface: "caption_prompts",
      client_slug: clientSlug,
      actor: actor.actor,
      role: actor.role,
      action: "save",
      source: actor.source,
      payload: { prompt_length: prompt.length },
    });
    if (eventError) throw eventError;

    return json({ ok: true, client: data?.client_slug || clientSlug, prompt: data?.prompt ?? prompt });
  } catch (e) {
    const auth = browserWriteAuthResponse(e);
    if (auth) return json({ ok: false, error: auth.code }, auth.status);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
