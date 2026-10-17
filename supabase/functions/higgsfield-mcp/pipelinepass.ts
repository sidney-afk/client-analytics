// The connector's "pipeline_pass" tool: a 6-hour pass that lets the filming
// pipeline on a teammate's own computer reach one client's Google files
// through pipeline-google, with no shared password on that computer.
//
// The rules (who gets which target) and the token format are in
// ../pipeline-google/pass.mjs, shared with the function that checks the pass.
// Only the token's SHA-256 is stored (fp_passes); the token is in the reply
// once and nowhere else (the activity log records the tool, client and
// summary, never the reply).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { findClient } from "./clientinfo.ts";
import { storeSlug } from "../pipeline-google/store.mjs";
import { newPassToken, passDecision, passHash, passReply, passTarget } from "../pipeline-google/pass.mjs";

export async function pipelinePass(
  db: SupabaseClient,
  opts: { member: string; author: string; teamLink: boolean; client: string; target: unknown },
): Promise<string> {
  const target = passTarget(opts.target);
  if (!target) return passDecision({ teamLink: opts.teamLink, target: opts.target, isPublisher: false }).text ?? "";
  const found = await findClient(db, opts.client);
  if (!found.plan) return `Which client? ${found.choices?.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const p = found.plan;

  // Only a personal link can be on the publish list; the shared team link's
  // first name is self-declared, so its member name is never looked up.
  let isPublisher = false;
  if (target === "client" && !opts.teamLink) {
    const { data, error } = await db.from("fp_publishers").select("member").eq("member", opts.member).maybeSingle();
    if (error) return "Could not check the publish list. Try again in a minute.";
    isPublisher = !!data;
  }
  const decision = passDecision({ teamLink: opts.teamLink, target, isPublisher });
  if (!decision.ok) return decision.text ?? "Refused.";

  const token = newPassToken();
  const { data: row, error } = await db.from("fp_passes")
    .insert({ token_hash: await passHash(token), member: opts.author, via: decision.via, client_slug: storeSlug(p.client_slug), target })
    .select("expires_at")
    .single();
  if (error || !row) return "Could not make a pass (the pass tables may not be set up yet). Ask the account owner.";
  return passReply({ clientName: p.client_name, target, token, expiresAt: String(row.expires_at) });
}
