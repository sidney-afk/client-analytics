// Supabase Edge Function: brain
//
// Reads one client's editor brief and facts from the private Synchro Brain repository for the
// SyncView Templates page, and records a "Send a change" submission there.
//
// The public site never sees the brain token. Reads return only the four
// client files (identity, voice, editing, relationship) of the one client
// asked for, parsed into facts; nothing under inputs/, company/ or POLICY/ is
// ever read back. A change is written verbatim as a new file under
// inputs/syncview-changes/ (brain rule 5); a brain-side workflow processes it
// into facts. This function never edits a fact file.
//
// A third action, "folders", lists the client's recent Frame folder and Raw
// footage links from production batches (the page cannot read `batches`
// directly). It reads only those columns, newest first.
//
// All actions require a SyncView staff key (client review tokens are refused:
// the brain is staff-only).
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (staff-key auth helper)
//   BRAIN_GITHUB_TOKEN                        (fine-grained, synchro-brain only)
// Optional env:
//   BRAIN_REPO   default "sidney-afk/synchro-brain"
//   BRAIN_BRANCH default "main"

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authorizeBrowserWrite,
  browserWriteAuthResponse,
  normalizeBrowserWriteClient,
} from "../_shared/browser-write-auth.ts";
import { findClientFolder, parseBrainFacts, parseBrief } from "./parse.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};
const FILES = ["identity", "voice", "editing", "relationship"];
const CACHE_MS = 3 * 60 * 1000;
const MAX_CHANGE_CHARS = 8000;
const cache = new Map<string, { at: number; body: unknown }>();
let folderCache: { at: number; names: string[] } | null = null;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const token = Deno.env.get("BRAIN_GITHUB_TOKEN") || "";
  const repo = Deno.env.get("BRAIN_REPO") || "sidney-afk/synchro-brain";
  return fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "syncview-brain",
      ...(init.headers || {}),
    },
  });
}

async function clientFolders(): Promise<string[]> {
  if (folderCache && Date.now() - folderCache.at < CACHE_MS) return folderCache.names;
  const ref = Deno.env.get("BRAIN_BRANCH") || "main";
  const r = await gh(`contents/clients?ref=${encodeURIComponent(ref)}`);
  if (!r.ok) throw new Error(`brain_list_${r.status}`);
  const items = await r.json() as Array<{ name: string; type: string }>;
  const names = items.filter((i) => i.type === "dir").map((i) => i.name);
  folderCache = { at: Date.now(), names };
  return names;
}

async function readFile(folder: string, file: string): Promise<string | null> {
  const ref = Deno.env.get("BRAIN_BRANCH") || "main";
  const r = await gh(`contents/clients/${folder}/${file}.md?ref=${encodeURIComponent(ref)}`, {
    headers: { Accept: "application/vnd.github.raw+json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`brain_read_${r.status}`);
  return await r.text();
}

async function readClient(slug: string) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  const folder = findClientFolder(await clientFolders(), slug);
  if (!folder) {
    const body = { ok: true, found: false, facts: [] };
    cache.set(slug, { at: Date.now(), body });
    return body;
  }
  const [texts, briefText] = await Promise.all([
    Promise.all(FILES.map((f) => readFile(folder, f))),
    readFile(folder, "brief"),
  ]);
  const facts = FILES.flatMap((f, i) => texts[i] == null ? [] : parseBrainFacts(texts[i] as string, f));
  const brief = briefText == null ? [] : parseBrief(briefText);
  const body = { ok: true, found: true, folder, facts, brief, read_at: new Date().toISOString() };
  cache.set(slug, { at: Date.now(), body });
  return body;
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function oneLine(v: unknown, max = 200): string {
  return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

async function recordChange(slug: string, body: Record<string, unknown>, principal: { actor: string; role: string }) {
  const text = String(body.text == null ? "" : body.text).replace(/\r\n/g, "\n").trim();
  if (!text) return json({ ok: false, error: "text_required" }, 400);
  if (text.length > MAX_CHANGE_CHARS) return json({ ok: false, error: "text_too_long" }, 400);
  const folder = findClientFolder(await clientFolders(), slug);
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const id = crypto.randomUUID().slice(0, 8);
  const target = folder || `unmatched-${slug}`;
  const path = `inputs/syncview-changes/${stamp.slice(0, 10)}-${target}-${id}.md`;
  const factId = oneLine(body.factId, 160);
  const heading = oneLine(body.heading, 160);
  const sender = oneLine(body.from, 80);
  const md = [
    `# SyncView change for ${target}`,
    "",
    `- received: ${now.toISOString()}`,
    `- client slug: ${slug}`,
    `- brain folder: ${folder || "none found, a person must place this"}`,
    `- fact id: ${factId || "none (new fact or general note)"}`,
    `- fact heading: ${heading || "none"}`,
    `- sent by (as typed): ${sender || "not given"}`,
    `- SyncView role: ${principal.role}`,
    "",
    "## What they sent, word for word",
    "",
    text,
    "",
  ].join("\n");
  const r = await gh(`contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `SyncView change for ${target}${factId ? ` (${factId})` : ""}`,
      content: b64(md),
      branch: Deno.env.get("BRAIN_BRANCH") || "main",
    }),
  });
  if (!r.ok) throw new Error(`brain_write_${r.status}`);
  return json({ ok: true, received: now.toISOString(), path });
}

async function recentFolders(db: SupabaseClient, slug: string) {
  // Walk the client's batches newest first, a page at a time, until both
  // lists hold 8 unique links or history runs out. Each list de-duplicates
  // on its own, so one folder used for both kinds shows in both.
  const frame: Array<{ url: string; name: string; at: string }> = [];
  const raw: Array<{ url: string; name: string; at: string }> = [];
  const seen = { frame: new Set<string>(), raw: new Set<string>() };
  const PAGE = 100;
  for (let from = 0; from < 2000 && (frame.length < 8 || raw.length < 8); from += PAGE) {
    const { data, error } = await db
      .from("batches")
      .select("name,created_at,footage_folder_url,delivery_folder_url")
      .eq("client_slug", slug)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as Array<Record<string, string | null>>;
    for (const b of rows) {
      for (const [kind, list, url] of [["frame", frame, b.delivery_folder_url], ["raw", raw, b.footage_folder_url]] as const) {
        const u = String(url || "").trim();
        if (!/^https?:\/\//i.test(u) || seen[kind].has(u) || list.length >= 8) continue;
        seen[kind].add(u);
        list.push({ url: u, name: String(b.name || ""), at: String(b.created_at || "") });
      }
    }
    if (rows.length < PAGE) break;
  }
  return { ok: true, frame, raw };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const slug = normalizeBrowserWriteClient(body.clientName);
    if (!slug) return json({ ok: false, error: "clientName required" }, 400);
    if (req.headers.get("x-syncview-client-token")) return json({ ok: false, error: "staff_only" }, 403);

    const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
      auth: { persistSession: false },
    });
    const principal = await authorizeBrowserWrite(db, req, slug, "brain");

    if (body.action === "folders") return json(await recentFolders(db, slug));
    if (!Deno.env.get("BRAIN_GITHUB_TOKEN")) return json({ ok: false, error: "brain_not_configured" }, 503);
    if (body.action === "read") return json(await readClient(slug));
    if (body.action === "change") return await recordChange(slug, body, principal);
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    const auth = browserWriteAuthResponse(error);
    if (auth) return json({ ok: false, error: auth.code }, auth.status);
    console.error("[brain]", error);
    return json({ ok: false, error: "brain_unavailable" }, 502);
  }
});
