// Supabase Edge Function: thumbnail-title-prompts
//
// Reads and saves one client's thumbnail title prompt for the Calendar's
// "Thumbnail title prompt" editor, the twin of caption-prompts-save. Staff
// only: a client review token is refused, and the table is closed to the
// browser because the default carries private Synchro Brain text.
//
//   POST {action:"get",  client}          -> { ok, client, prompt, default_prompt, is_custom }
//   POST {action:"save", client, prompt}  -> { ok, client, prompt }   ('' = use the default)
//
// A client with no row yet is seeded on first read (see ../thumbnail-titles/seed.ts).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, a staff role key secret,
// BRAIN_GITHUB_TOKEN (for the default; without it the default is the plain n8n instruction).

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeBrowserWrite,
  browserWriteAuthResponse,
  normalizeBrowserWriteClient,
} from "../_shared/browser-write-auth.ts";
import { seedDefault } from "../thumbnail-titles/seed.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};
const MAX_PROMPT_CHARS = 20000;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "");
    if (action !== "get" && action !== "save") return json({ ok: false, error: "unknown action" }, 400);
    const clientSlug = normalizeBrowserWriteClient(body.client);
    if (!clientSlug) return json({ ok: false, error: "client required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const actor = await authorizeBrowserWrite(db, req, clientSlug, "thumbnail-title-prompts");
    if (actor.kind !== "staff") return json({ ok: false, error: "staff_only" }, 403);

    let { data: row, error } = await db.from("thumbnail_title_prompts")
      .select("client_slug,prompt,default_prompt").eq("client_slug", clientSlug).maybeSingle();
    if (error) throw error;
    if (!row) {
      const seeded = await seedDefault(db, clientSlug);
      row = { client_slug: clientSlug, prompt: "", default_prompt: seeded.default_prompt };
    }

    if (action === "get") {
      const prompt = String(row.prompt || "");
      return json({ ok: true, client: clientSlug, prompt, default_prompt: String(row.default_prompt || ""), is_custom: !!prompt.trim() });
    }

    const prompt = String(body.prompt == null ? "" : body.prompt);
    if (prompt.length > MAX_PROMPT_CHARS || prompt.includes("\0")) return json({ ok: false, error: "prompt too long" }, 400);
    // Saving the default verbatim is saving nothing, so a refreshed default reaches this client.
    const stored = prompt.trim() === String(row.default_prompt || "").trim() ? "" : prompt;
    const { error: saveError } = await db.from("thumbnail_title_prompts")
      .update({ prompt: stored, updated_at: new Date().toISOString(), updated_by: actor.actor || "syncview" })
      .eq("client_slug", clientSlug);
    if (saveError) throw saveError;

    const { error: eventError } = await db.from("settings_events").insert({
      surface: "thumbnail_title_prompts",
      client_slug: clientSlug,
      actor: actor.actor,
      role: actor.role,
      action: "save",
      source: actor.source,
      payload: { prompt_length: stored.length, uses_default: !stored },
    });
    if (eventError) throw eventError;

    return json({ ok: true, client: clientSlug, prompt: stored });
  } catch (e) {
    const auth = browserWriteAuthResponse(e);
    if (auth) return json({ ok: false, error: auth.code }, auth.status);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
