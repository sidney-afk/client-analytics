// Client context for the team's chat app: the client list, a client's
// filming plan (the Google Doc SyncView links in filming_plans, read as text
// the same way production-write does), and the client's written voice and
// title guidance from the Synchro Brain (same repository and token the
// brain Edge Function uses). The one write is brainChange, which files a
// change exactly like SyncView's "Send a change" button (shared code in
// ../brain/change.mjs); it never edits a fact file.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { findClientFolder, parseAudience, parseBrainFacts } from "../brain/parse.mjs";
import { recordChange } from "../brain/change.mjs";
import { brainView } from "./brainview.mjs";

type Plan = { client_slug: string; client_name: string; doc_id: string; plan_months: string };

const PLAN_MAX_CHARS = 40_000;
const BRIEF_MAX_CHARS = 20_000;
// For titles only: voice.md whole, plus editing.md facts about thumbnail or
// on-screen wording. Visual specs (fonts, colours, layout) are deliberately
// left out: the designer's latest Canva thumbnail is the source for those.
const TITLE_FACTS = /thumbnail|on-screen|title|hook/i;

function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function plans(db: SupabaseClient): Promise<Plan[]> {
  const { data, error } = await db.from("filming_plans").select("client_slug,client_name,doc_id,plan_months").order("client_name");
  if (error) throw new Error("Could not read the client list.");
  return (data || []) as Plan[];
}

// Match a typed client name loosely: exact slug/name first, then "contains".
export async function findClient(db: SupabaseClient, query: string): Promise<{ plan?: Plan; choices?: string[] }> {
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

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MAX_TABS = 16;

// The house format keeps a header on the master Doc's first page and each
// month's plan in its own Docs tab (NEW_CLIENT_ONBOARDING §6a). A plain export
// returns only the first tab, so read the tab ids from the Doc page (the Doc
// is shared by link) and export each tab as text.
export async function planTabs(docId: string): Promise<Array<{ id: string; name: string; text: string }>> {
  const base = `https://docs.google.com/document/d/${encodeURIComponent(docId)}`;
  const page = await fetch(`${base}/edit`);
  const html = page.ok ? await page.text() : "";
  // Tab names sit in the page model as {"ty":"ac","d":["t.<id>",[1,"<name>"],[<order>]]}.
  const names = new Map<string, string>();
  for (const m of html.matchAll(/\{"ty":"ac","d":\["(t\.[a-z0-9]{6,20})",\[1,"([^"]{1,80})"\]/g)) names.set(m[1], m[2]);
  // Export every tab id found; names only label the ones whose name parsed.
  const ids = [...new Set([...names.keys(), ...[...html.matchAll(/"(t\.[a-z0-9]{6,20})"/g)].map((m) => m[1])])].slice(0, MAX_TABS);
  const targets = ids.length ? ids : [""];
  const tabs = await Promise.all(targets.map(async (id) => {
    const res = await fetch(`${base}/export?format=txt${id ? `&tab=${encodeURIComponent(id)}` : ""}`);
    return { id, name: names.get(id) || "", text: res.ok ? (await res.text()).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n") : "" };
  }));
  return tabs.filter((t) => t.text.trim());
}

// Fallback label when the Doc page gives no tab name: the month (and year)
// the tab mentions most.
export function tabMonth(text: string): string {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b(?:\s+(\d{4}))?/gi)) {
    const key = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + (m[2] ? " " + m[2] : "");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = "", n = 0;
  for (const [k, v] of counts) if (v > n || (v === n && k.length > best.length)) { best = k; n = v; }
  return best || "no month found";
}

export async function filmingPlan(db: SupabaseClient, client: string, month: string): Promise<string> {
  const found = await findClient(db, client);
  if (!found.plan) return `Which client? ${found.choices?.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const p = found.plan;
  if (!p.doc_id) return `${p.client_name} has no filming plan linked in SyncView.`;
  const tabs = await planTabs(p.doc_id);
  if (!tabs.length) return `Could not open ${p.client_name}'s filming plan. It may not be shared by link.`;
  const labelled = tabs.map((t, i) => ({ ...t, n: i + 1, month: t.name || tabMonth(t.text) }));
  const want = String(month || "").trim().toLowerCase();
  const list = labelled.map((t) => `${t.n}. ${t.month}`).join("\n");
  let pick = labelled.length === 1 ? labelled[0] : undefined;
  if (want) {
    const byNumber = /^\d+$/.test(want) ? labelled.find((t) => String(t.n) === want) : undefined;
    const monthWord = MONTHS.find((m) => want.includes(m));
    const scored = labelled
      .map((t) => ({ t, hits: (t.text.toLowerCase().match(new RegExp(monthWord || want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => (b.t.month.toLowerCase().startsWith(monthWord || want) ? 1 : 0) - (a.t.month.toLowerCase().startsWith(monthWord || want) ? 1 : 0) || b.hits - a.hits);
    // A tab whose name matches wins; body text is the fallback.
    const byName = labelled.find((t) => t.name && t.name.toLowerCase().includes(monthWord || want));
    pick = byNumber || byName || scored[0]?.t;
    if (!pick) return `${p.client_name}'s filming plan has no tab for "${month}". Tabs found:\n${list}\nAsk for one by month or number.`;
  }
  if (!pick) return `${p.client_name}'s filming plan has ${labelled.length} tabs:\n${list}\nAsk for one by month or number.`;
  const cut = pick.text.length > PLAN_MAX_CHARS;
  return `${p.client_name} filming plan, tab ${pick.n} (${pick.month})${labelled.length > 1 ? `. Other tabs:\n${list}\n` : ""}\n\n${pick.text.slice(0, PLAN_MAX_CHARS)}${cut ? "\n\n[cut here]" : ""}`;
}

export function gh(path: string, raw = false, init: RequestInit = {}): Promise<Response> {
  const repo = Deno.env.get("BRAIN_REPO") || "sidney-afk/synchro-brain";
  return fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> || {}),
      Authorization: `Bearer ${Deno.env.get("BRAIN_GITHUB_TOKEN") || ""}`,
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "syncview-higgsfield-mcp",
    },
  });
}

// The written voice and title facts for one client slug, or the reason there
// are none. Shared with the thumbnail-titles functions, which seed each
// client's thumbnail title prompt from the same facts this connector shows.
export async function titleStyleFacts(clientSlug: string, clientName = "", exclude: RegExp | null = null): Promise<{ text: string; reason: string; facts: Array<{ file: string; heading: string; body: string }> }> {
  if (!Deno.env.get("BRAIN_GITHUB_TOKEN")) return { text: "", reason: "brain_not_connected", facts: [] };
  const ref = encodeURIComponent(Deno.env.get("BRAIN_BRANCH") || "main");
  const list = await gh(`contents/clients?ref=${ref}`);
  if (!list.ok) return { text: "", reason: `brain_unreadable_${list.status}`, facts: [] };
  const folders = ((await list.json()) as Array<{ name: string; type: string }>).filter((i) => i.type === "dir").map((i) => i.name);
  const folder = findClientFolder(folders, clientSlug) || (clientName ? findClientFolder(folders, clientName) : null);
  if (!folder) return { text: "", reason: "no_brain_folder", facts: [] };
  const read = async (file: string) => {
    const r = await gh(`contents/clients/${folder}/${file}.md?ref=${ref}`, true);
    return r.ok ? await r.text() : "";
  };
  const [voice, editing] = await Promise.all([read("voice"), read("editing")]);
  const facts = [
    ...parseBrainFacts(voice, "voice"),
    ...parseBrainFacts(editing, "editing").filter((f: { heading: string }) => TITLE_FACTS.test(f.heading) && !/font|colou?r|spec/i.test(f.heading)),
  ].filter((f: { status: string; body: string; heading: string }) => f.status === "written" && f.body && !(exclude && exclude.test(f.heading)));
  if (!facts.length) return { text: "", reason: "no_written_facts", facts: [] };
  const text = facts.map((f: { file: string; heading: string; spec: string; body: string }) =>
    `## ${f.heading} (${f.file})\n${f.body}`).join("\n\n");
  return { text: text.slice(0, BRIEF_MAX_CHARS), reason: "", facts: facts.map((f: { file: string; heading: string; body: string }) => ({ file: f.file, heading: f.heading, body: f.body })) };
}

export async function clientStyle(db: SupabaseClient, client: string): Promise<string> {
  if (!Deno.env.get("BRAIN_GITHUB_TOKEN")) return "The Synchro Brain is not connected on the server (BRAIN_GITHUB_TOKEN missing).";
  const found = await findClient(db, client);
  if (!found.plan) return `Which client? ${found.choices?.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const style = await titleStyleFacts(found.plan.client_slug, found.plan.client_name);
  if (style.reason.startsWith("brain_unreadable_")) return `Could not read the Synchro Brain (${style.reason.slice(17)}).`;
  if (style.reason === "no_brain_folder") return `${found.plan.client_name} has no folder in the Synchro Brain yet.`;
  if (!style.text) return `${found.plan.client_name}: the Synchro Brain has no written voice or title facts yet. Match the wording style of the client's recent Canva thumbnail titles.`;
  return `${found.plan.client_name}, voice and title guidance from the Synchro Brain (written facts only; fonts and colours come from the latest Canva thumbnail, not from here):\n\n${style.text}`;
}

// The client files client_brain reads, in this order after brief.md. money.md,
// history.md (old notes moved out of the live facts) and everything under
// inputs/ are never read here: this fixed list is the only way in.
const BRAIN_FILES = ["identity", "voice", "editing", "relationship"];

export async function brainFolder(slug: string, name: string): Promise<{ folder?: string; folders: string[]; error?: string }> {
  const ref = encodeURIComponent(Deno.env.get("BRAIN_BRANCH") || "main");
  const list = await gh(`contents/clients?ref=${ref}`);
  if (!list.ok) return { folders: [], error: `Could not read the Synchro Brain (${list.status}).` };
  const folders = ((await list.json()) as Array<{ name: string; type: string }>).filter((i) => i.type === "dir").map((i) => i.name);
  return { folders, folder: findClientFolder(folders, slug) || findClientFolder(folders, name) || undefined };
}

// One client's brain: brief.md in full, then the current answer (first
// paragraph) of each written fact of identity, voice, editing, relationship
// and audience, each with its fact id. With a topic (a fact id, heading words
// or a file name) the matching facts come in full. Nothing is cut silently:
// what does not fit is named (brainview.mjs).
export async function clientBrain(db: SupabaseClient, client: string, topic = ""): Promise<string> {
  if (!Deno.env.get("BRAIN_GITHUB_TOKEN")) return "The Synchro Brain is not connected on the server (BRAIN_GITHUB_TOKEN missing).";
  const found = await findClient(db, client);
  if (!found.plan) return `Which client? ${found.choices?.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const p = found.plan;
  const where = await brainFolder(p.client_slug, p.client_name);
  if (where.error) return where.error;
  if (!where.folder) return `${p.client_name} has no folder in the Synchro Brain yet.`;
  const ref = encodeURIComponent(Deno.env.get("BRAIN_BRANCH") || "main");
  // Only a missing file (404) reads as empty; any other failure is reported, never a silent gap.
  const read = async (file: string) => {
    const r = await gh(`contents/clients/${where.folder}/${file}.md?ref=${ref}`, true);
    if (r.status === 404) return "";
    if (!r.ok) throw new Error(String(r.status));
    return await r.text();
  };
  let brief: string, audience: string, texts: string[];
  try {
    [brief, audience, ...texts] = await Promise.all([read("brief"), read("audience"), ...BRAIN_FILES.map(read)]);
  } catch (e) {
    return `Could not read the Synchro Brain (${(e as Error).message}). Try again in a minute; do not answer as if ${p.client_name} had no brain facts.`;
  }
  const facts = [
    ...BRAIN_FILES.flatMap((f, i) => parseBrainFacts(texts[i], f)),
    ...parseAudience(audience),
  ].filter((f: { status: string; body: string }) => f.status === "written" && f.body);
  return brainView({ name: p.client_name, brief, facts, topic });
}

// Files a change exactly like SyncView's "Send a change" button. The
// brain-side workflow and POLICY/syncview-changes.md decide where it goes.
export async function brainChange(db: SupabaseClient, client: string, whatChanged: string, factId: string, member: string): Promise<string> {
  if (!Deno.env.get("BRAIN_GITHUB_TOKEN")) return "The Synchro Brain is not connected on the server (BRAIN_GITHUB_TOKEN missing).";
  const found = await findClient(db, client);
  if (!found.plan) return `Which client? ${found.choices?.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const p = found.plan;
  const where = await brainFolder(p.client_slug, p.client_name);
  if (where.error) return where.error;
  // Same slug and folder match as SyncView's button, so the file is identical.
  const result = await recordChange({
    slug: p.client_slug,
    text: whatChanged,
    factId,
    heading: "",
    from: `${member} via Claude connector`,
    role: "Claude connector",
    folders: where.folders,
    gh: (path: string, init: RequestInit) => gh(path, false, init),
    branch: Deno.env.get("BRAIN_BRANCH") || "main",
  });
  if (!result.ok) return result.error === "text_too_long" ? "That is too long to send in one change; split it up." : "Say what changed first.";
  if (!findClientFolder(where.folders, p.client_slug)) return `Sent, but ${p.client_name} has no Synchro Brain folder yet, so a person has to place it by hand. It will not show in client_brain until then; say that instead of "Saved".`;
  return `Sent. It will be filed in ${p.client_name}'s brain within a few minutes.`;
}
