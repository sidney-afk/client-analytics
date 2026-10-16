// The Synchro video studio's client profile (studio_profile,
// studio_profile_save): clients/<folder>/video-profile.json in the Synchro
// Brain. Read here; a save is filed through recordChange exactly like
// brainChange in clientinfo.ts, and the brain's own workflow writes the file
// (POLICY/syncview-changes.md, "Video profile updates"). Never touches the
// Look facts or the brief. The pure parts are in profile.mjs.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { parseBrainFacts, parseBrief } from "../brain/parse.mjs";
import { recordChange } from "../brain/change.mjs";
import { brainFolder, findClient, gh } from "./clientinfo.ts";
import { PROFILE_FILE, PROFILE_MAX_CHARS, draftReply, mergeProfile, profileChangeText, profileFactId, profileJson, profileProblems, profileReply, stampProfile } from "./profile.mjs";

async function readProfile(folder: string): Promise<{ text?: string; missing?: boolean; error?: string }> {
  const ref = encodeURIComponent(Deno.env.get("BRAIN_BRANCH") || "main");
  const r = await gh(`contents/clients/${folder}/${PROFILE_FILE}?ref=${ref}`, true);
  if (r.status === 404) return { missing: true };
  if (!r.ok) return { error: String(r.status) };
  return { text: await r.text() };
}

export async function studioProfile(db: SupabaseClient, client: string): Promise<string> {
  if (!Deno.env.get("BRAIN_GITHUB_TOKEN")) return "The Synchro Brain is not connected on the server (BRAIN_GITHUB_TOKEN missing).";
  const found = await findClient(db, client);
  if (!found.plan) return `Which client? ${found.choices?.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const p = found.plan;
  const where = await brainFolder(p.client_slug, p.client_name);
  if (where.error) return where.error;
  if (!where.folder) return `${p.client_name} has no folder in the Synchro Brain yet.`;
  const prof = await readProfile(where.folder);
  if (prof.error) return `Could not read ${p.client_name}'s video profile (${prof.error}). Try again in a minute.`;
  if (prof.text !== undefined) return profileReply(p.client_name, prof.text);
  // No profile yet: the brief's Look section and the exact spec lines, read only.
  const ref = encodeURIComponent(Deno.env.get("BRAIN_BRANCH") || "main");
  const read = async (file: string) => {
    const r = await gh(`contents/clients/${where.folder}/${file}.md?ref=${ref}`, true);
    if (r.status === 404) return "";
    if (!r.ok) throw new Error(String(r.status));
    return await r.text();
  };
  let brief: string, editing: string;
  try {
    [brief, editing] = await Promise.all([read("brief"), read("editing")]);
  } catch (e) {
    return `Could not read the Synchro Brain (${(e as Error).message}). Try again in a minute.`;
  }
  const look = parseBrief(brief).filter((s: { heading: string }) => /^look$/i.test(s.heading))
    .flatMap((s: { bullets: Array<{ text: string }> }) => s.bullets.map((b) => b.text));
  const specs = parseBrainFacts(editing, "editing")
    .filter((f: { status: string; spec: string }) => f.status === "written" && f.spec)
    .map((f: { heading: string; spec: string }) => ({ heading: f.heading, spec: f.spec }));
  return draftReply(p.client_name, look, specs);
}

export async function studioProfileSave(db: SupabaseClient, client: string, profile: unknown, replace: boolean, member: string): Promise<string> {
  if (!Deno.env.get("BRAIN_GITHUB_TOKEN")) return "The Synchro Brain is not connected on the server (BRAIN_GITHUB_TOKEN missing).";
  const problems = profileProblems(profile);
  if (problems.length) return `Fix these before saving:\n${problems.map((x) => `- ${x}`).join("\n")}`;
  const found = await findClient(db, client);
  if (!found.plan) return `Which client? ${found.choices?.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const p = found.plan;
  const where = await brainFolder(p.client_slug, p.client_name);
  if (where.error) return where.error;
  // A profile file needs a real folder; an unmatched change would be refused by the brain.
  if (!where.folder) return `Could not save: ${p.client_name} has no folder in the Synchro Brain yet. Ask the account owner to set the client up first.`;
  let current: unknown = {};
  if (!replace) {
    const prof = await readProfile(where.folder);
    if (prof.error) return `Could not read ${p.client_name}'s current video profile (${prof.error}), so nothing was saved. Try again in a minute.`;
    if (prof.text !== undefined) {
      try { current = JSON.parse(prof.text); } catch (_e) { return `Could not save: ${p.client_name}'s current video profile is not valid JSON. Save the whole profile again with replace set to true.`; }
    }
  }
  const stamped = stampProfile(mergeProfile(current, profile), member, new Date().toISOString());
  const json = profileJson(stamped);
  if (json.length > PROFILE_MAX_CHARS) return `Could not save: the profile is ${json.length} characters, more than ${PROFILE_MAX_CHARS}. Shorten the notes.`;
  const result = await recordChange({
    slug: p.client_slug,
    text: profileChangeText(where.folder, stamped),
    factId: profileFactId(where.folder),
    heading: "Video profile",
    from: `${member} via Claude connector`,
    role: "Claude connector",
    folders: where.folders,
    gh: (path: string, init: RequestInit) => gh(path, false, init),
    branch: Deno.env.get("BRAIN_BRANCH") || "main",
  });
  if (!result.ok) return result.error === "text_too_long" ? "Could not save: the profile is too long; shorten the notes." : "Could not save: the profile was empty.";
  return `Sent. ${p.client_name}'s video profile will be filed in the Synchro Brain within a few minutes (studio_profile shows the old one until then). This is what was sent:\n\n${json}`;
}
