// The seeded default thumbnail title prompt for one client: the n8n
// instruction plus the client's written title style from the Synchro Brain
// (read the same way the Higgsfield connector's client_style reads it).
// Refreshes only default_prompt; a prompt staff saved is never touched.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { titleStyleFacts } from "../higgsfield-mcp/clientinfo.ts";
import { defaultPromptFor, STYLE_EXCLUDE } from "./logic.mjs";

export async function seedDefault(db: SupabaseClient, slug: string, name = ""): Promise<{ default_prompt: string; source: string }> {
  let style = { text: "", reason: "brain_error" };
  try { style = await titleStyleFacts(slug, name, STYLE_EXCLUDE); } catch (_e) { /* generic default below */ }
  const defaultPrompt = defaultPromptFor(style.text);
  const source = style.text ? "brain" : `generic:${style.reason || "none"}`;
  const now = new Date().toISOString();
  const { data: existing } = await db.from("thumbnail_title_prompts").select("client_slug").eq("client_slug", slug).maybeSingle();
  const { error } = existing
    ? await db.from("thumbnail_title_prompts")
      .update({ default_prompt: defaultPrompt, default_source: source, default_refreshed_at: now })
      .eq("client_slug", slug)
    : await db.from("thumbnail_title_prompts").insert({
      client_slug: slug, prompt: "", default_prompt: defaultPrompt, default_source: source,
      default_refreshed_at: now, updated_at: now, updated_by: "thumbnail-titles-seed",
    });
  if (error) throw new Error("seed_write_failed");
  return { default_prompt: defaultPrompt, source };
}
