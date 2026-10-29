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
import { PROFILE_FILE, PROFILE_MAX_CHARS, draftReply, mergeProfile, pickPendingProfile, profileChangeText, profileChecklist, profileFactId, profileJson, profileProblems, profileReply, stampProfile } from "./profile.mjs";

async function readProfile(folder: string): Promise<{ text?: string; missing?: boolean; error?: string }> {
  const ref = encodeURIComponent(Deno.env.get("BRAIN_BRANCH") || "main");
  const r = await gh(`contents/clients/${folder}/${PROFILE_FILE}?ref=${ref}`, true);
  if (r.status === 404) return { missing: true };
  if (!r.ok) return { error: String(r.status) };
  return { text: await r.text() };
}

// Saves filed after the profile file was last written, which the brain has not
// processed yet. Best effort: any failure here returns null and the save starts
// from the file, as before.
async function readPendingProfile(folder: string): Promise<unknown | null> {
  try {
    const ref = encodeURIComponent(Deno.env.get("BRAIN_BRANCH") || "main");
    const c = await gh(`commits?path=${encodeURIComponent(`clients/${folder}/${PROFILE_FILE}`)}&sha=${ref}&per_page=1`, false);
    // Without the file's write date every old input would look pending, so any
    // doubt here means "start from the file".
    if (!c.ok) return null;
    const list = await c.json();
    let since = "";
    if (Array.isArray(list) && list.length) {
      since = list[0]?.commit?.committer?.date || "";
      if (!(Date.parse(since) > 0)) return null;
    }
    const day = (since || "1970-01-01").slice(0, 10);
    const d = await gh(`contents/inputs/syncview-changes?ref=${ref}`, false);
    if (!d.ok) return null;
    // <date>-<folder>-<8 hex>.md: the folder part must be exactly this client's.
    const names: string[] = (await d.json()).map((x: { name: string }) => x.name)
      .filter((n: string) => n.slice(0, 10) >= day && /^\d{4}-\d{2}-\d{2}-(.+)-[0-9a-f]{8}\.md$/.exec(n)?.[1] === folder);
    const files = await Promise.all(names.slice(-10).map(async (n) => {
      const r = await gh(`contents/inputs/syncview-changes/${n}?ref=${ref}`, true);
      return { text: r.ok ? await r.text() : "" };
    }));
    return pickPendingProfile(files, since, folder);
  } catch (_e) {
    return null;
  }
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
    // A save filed moments ago is not in the file yet: start from it.
    const pending = await readPendingProfile(where.folder);
    if (pending) current = pending;
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
  const todo = profileChecklist(stamped);
  const check = todo.length ? `\n\nSaved, but not ready to use as a complete profile. Check these:\n${todo.map((x) => `- ${x}`).join("\n")}` : "\n\nChecklist: every basic piece is set.";
  return `Sent. ${p.client_name}'s video profile will be filed in the Synchro Brain within a few minutes (studio_profile shows the old one until then).${check}\n\nThis is what was sent:\n\n${json}`;
}
