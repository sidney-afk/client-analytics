// Client context for the team's chat app: the client list, a client's
// filming plan (the Google Doc SyncView links in filming_plans, read as text
// the same way production-write does), and the client's written voice and
// thumbnail style from the Synchro Brain (same repository and token the
// brain Edge Function uses). Read-only; nothing here writes anywhere.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { findClientFolder, parseBrainFacts } from "../brain/parse.mjs";

type Plan = { client_slug: string; client_name: string; doc_id: string; plan_months: string };

const PLAN_MAX_CHARS = 40_000;
const BRIEF_MAX_CHARS = 20_000;
// Facts from editing.md that matter for thumbnails; voice.md is used whole.
const THUMBNAIL_FACTS = /thumbnail|font|colou?r|on-screen|text|graphic|brand|reference/i;

function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function plans(db: SupabaseClient): Promise<Plan[]> {
  const { data, error } = await db.from("filming_plans").select("client_slug,client_name,doc_id,plan_months").order("client_name");
  if (error) throw new Error("Could not read the client list.");
  return (data || []) as Plan[];
}

// Match a typed client name loosely: exact slug/name first, then "contains".
async function findClient(db: SupabaseClient, query: string): Promise<{ plan?: Plan; choices?: string[] }> {
  const q = norm(query);
  if (!q) return { choices: [] };
  const all = await plans(db);
  const exact = all.find((p) => norm(p.client_slug) === q || norm(p.client_name) === q);
  if (exact) return { plan: exact };
  const hits = all.filter((p) => norm(p.client_name).includes(q) || norm(p.client_slug).includes(q) || q.includes(norm(p.client_slug)));
  if (hits.length === 1) return { plan: hits[0] };
  return { choices: (hits.length ? hits : all).map((p) => p.client_name) };
}

export async function listClients(db: SupabaseClient): Promise<string> {
  const all = await plans(db);
  return all.length ? "Clients:\n" + all.map((p) => `- ${p.client_name}${p.doc_id ? "" : " (no filming plan linked)"}`).join("\n") : "No clients found.";
}

export async function filmingPlan(db: SupabaseClient, client: string, month: string): Promise<string> {
  const found = await findClient(db, client);
  if (!found.plan) return `Which client? ${found.choices?.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const p = found.plan;
  if (!p.doc_id) return `${p.client_name} has no filming plan linked in SyncView.`;
  const res = await fetch(`https://docs.google.com/document/d/${encodeURIComponent(p.doc_id)}/export?format=txt`);
  if (!res.ok) return `Could not open ${p.client_name}'s filming plan (${res.status}). It may not be shared by link.`;
  let text = (await res.text()).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  let note = "";
  const m = String(month || "").trim();
  if (m) {
    const at = text.toLowerCase().indexOf(m.toLowerCase());
    if (at >= 0) text = text.slice(at);
    else note = `(No section mentioning "${m}" was found, so this is the whole plan.)\n`;
  }
  const cut = text.length > PLAN_MAX_CHARS;
  return `${p.client_name} filming plan${m ? `, from "${m}"` : ""}${p.plan_months ? ` (months listed in SyncView: ${p.plan_months})` : ""}:\n${note}\n${text.slice(0, PLAN_MAX_CHARS)}${cut ? "\n\n[cut here; ask for a specific month to see later parts]" : ""}`;
}

function gh(path: string, raw = false): Promise<Response> {
  const repo = Deno.env.get("BRAIN_REPO") || "sidney-afk/synchro-brain";
  return fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: {
      Authorization: `Bearer ${Deno.env.get("BRAIN_GITHUB_TOKEN") || ""}`,
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "syncview-higgsfield-mcp",
    },
  });
}

export async function clientStyle(db: SupabaseClient, client: string): Promise<string> {
  if (!Deno.env.get("BRAIN_GITHUB_TOKEN")) return "The Synchro Brain is not connected on the server (BRAIN_GITHUB_TOKEN missing).";
  const found = await findClient(db, client);
  if (!found.plan) return `Which client? ${found.choices?.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const ref = encodeURIComponent(Deno.env.get("BRAIN_BRANCH") || "main");
  const list = await gh(`contents/clients?ref=${ref}`);
  if (!list.ok) return `Could not read the Synchro Brain (${list.status}).`;
  const folders = ((await list.json()) as Array<{ name: string; type: string }>).filter((i) => i.type === "dir").map((i) => i.name);
  const folder = findClientFolder(folders, found.plan.client_slug) || findClientFolder(folders, found.plan.client_name);
  if (!folder) return `${found.plan.client_name} has no folder in the Synchro Brain yet.`;
  const read = async (file: string) => {
    const r = await gh(`contents/clients/${folder}/${file}.md?ref=${ref}`, true);
    return r.ok ? await r.text() : "";
  };
  const [voice, editing] = await Promise.all([read("voice"), read("editing")]);
  const facts = [
    ...parseBrainFacts(voice, "voice"),
    ...parseBrainFacts(editing, "editing").filter((f: { heading: string }) => THUMBNAIL_FACTS.test(f.heading)),
  ].filter((f: { status: string; body: string }) => f.status === "written" && f.body);
  if (!facts.length) return `${found.plan.client_name}: the Synchro Brain has no written voice or thumbnail facts yet. Ask the designer for the style, or match the client's latest Canva thumbnail.`;
  const text = facts.map((f: { file: string; heading: string; spec: string; body: string }) =>
    `## ${f.heading} (${f.file})${f.spec ? `\nspec: ${f.spec}` : ""}\n${f.body}`).join("\n\n");
  return `${found.plan.client_name}, from the Synchro Brain (written facts only):\n\n${text.slice(0, BRIEF_MAX_CHARS)}`;
}
