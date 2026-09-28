// Client context for the team's chat app: the client list, a client's
// filming plan (the Google Doc SyncView links in filming_plans, read as text
// the same way production-write does), and the client's written voice and
// title guidance from the Synchro Brain (same repository and token the
// brain Edge Function uses). Read-only; nothing here writes anywhere.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { findClientFolder, parseBrainFacts } from "../brain/parse.mjs";

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

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MAX_TABS = 16;

// The house format keeps a header on the master Doc's first page and each
// month's plan in its own Docs tab (NEW_CLIENT_ONBOARDING §6a). A plain export
// returns only the first tab, so read the tab ids from the Doc page (the Doc
// is shared by link) and export each tab as text.
async function planTabs(docId: string): Promise<Array<{ id: string; text: string }>> {
  const base = `https://docs.google.com/document/d/${encodeURIComponent(docId)}`;
  const page = await fetch(`${base}/edit`);
  const html = page.ok ? await page.text() : "";
  const ids = [...new Set([...html.matchAll(/"(t\.[a-z0-9]{6,20})"/g)].map((m) => m[1]))].slice(0, MAX_TABS);
  const targets = ids.length ? ids : [""];
  const tabs = await Promise.all(targets.map(async (id) => {
    const res = await fetch(`${base}/export?format=txt${id ? `&tab=${encodeURIComponent(id)}` : ""}`);
    return { id, text: res.ok ? (await res.text()).replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n") : "" };
  }));
  return tabs.filter((t) => t.text.trim());
}

// A tab's label: the month (and year) it mentions most, ignoring the shared header.
function tabMonth(text: string): string {
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
  const labelled = tabs.map((t, i) => ({ ...t, n: i + 1, month: tabMonth(t.text) }));
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
    pick = byNumber || scored[0]?.t;
    if (!pick) return `${p.client_name}'s filming plan has no tab for "${month}". Tabs found:\n${list}\nAsk for one by month or number.`;
  }
  if (!pick) return `${p.client_name}'s filming plan has ${labelled.length} tabs:\n${list}\nAsk for one by month or number.`;
  const cut = pick.text.length > PLAN_MAX_CHARS;
  return `${p.client_name} filming plan, tab ${pick.n} (${pick.month})${labelled.length > 1 ? `. Other tabs:\n${list}\n` : ""}\n\n${pick.text.slice(0, PLAN_MAX_CHARS)}${cut ? "\n\n[cut here]" : ""}`;
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
    ...parseBrainFacts(editing, "editing").filter((f: { heading: string }) => TITLE_FACTS.test(f.heading) && !/font|colou?r|spec/i.test(f.heading)),
  ].filter((f: { status: string; body: string }) => f.status === "written" && f.body);
  if (!facts.length) return `${found.plan.client_name}: the Synchro Brain has no written voice or title facts yet. Match the wording style of the client's recent Canva thumbnail titles.`;
  const text = facts.map((f: { file: string; heading: string; spec: string; body: string }) =>
    `## ${f.heading} (${f.file})\n${f.body}`).join("\n\n");
  return `${found.plan.client_name}, voice and title guidance from the Synchro Brain (written facts only; fonts and colours come from the latest Canva thumbnail, not from here):\n\n${text.slice(0, BRIEF_MAX_CHARS)}`;
}
