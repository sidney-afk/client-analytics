// Files one "Send a change" submission in the Synchro Brain, shared by the
// brain Edge Function (SyncView's button) and the higgsfield-mcp connector
// (brain_change), so both write the same file in the same format under
// inputs/syncview-changes/ and the same brain-side workflow processes it.
// Plain JavaScript with the GitHub call passed in, so a unit test can run it
// with fetch faked.

import { findClientFolder } from "./parse.mjs";

export const MAX_CHANGE_CHARS = 8000;

export function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function oneLine(v, max = 200) {
  return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

// gh(path, init) calls the GitHub contents API for the brain repository.
// Returns { ok: true, received, path } or { ok: false, error } for bad input;
// throws brain_write_<status> when GitHub refuses the write.
export async function recordChange({ slug, text: rawText, factId: rawFactId, heading: rawHeading, from, role, folders, gh, branch }) {
  const text = String(rawText == null ? "" : rawText).replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, error: "text_required" };
  if (text.length > MAX_CHANGE_CHARS) return { ok: false, error: "text_too_long" };
  const folder = findClientFolder(folders, slug);
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const id = crypto.randomUUID().slice(0, 8);
  const target = folder || `unmatched-${slug}`;
  const path = `inputs/syncview-changes/${stamp.slice(0, 10)}-${target}-${id}.md`;
  const factId = oneLine(rawFactId, 160);
  const heading = oneLine(rawHeading, 160);
  const sender = oneLine(from, 80);
  const md = [
    `# SyncView change for ${target}`,
    "",
    `- received: ${now.toISOString()}`,
    `- client slug: ${slug}`,
    `- brain folder: ${folder || "none found, a person must place this"}`,
    `- fact id: ${factId || "none (new fact or general note)"}`,
    `- fact heading: ${heading || "none"}`,
    `- sent by (as typed): ${sender || "not given"}`,
    `- SyncView role: ${role}`,
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
      branch: branch || "main",
    }),
  });
  if (!r.ok) throw new Error(`brain_write_${r.status}`);
  return { ok: true, received: now.toISOString(), path };
}
