// The connector's shared tools, as studio_action actions: tool_save, tool_list,
// tool_get. A client kit or a tool a session made is saved once and every
// teammate's Claude gets the latest. Plain JavaScript with no Deno parts, so a
// unit test can run it; index.ts passes in the database as deps:
//   deps.get(name) -> row | null
//   deps.insert(row), deps.update(name, patch)
//   deps.list(client|null) -> rows without the bundle, newest first
//   deps.author -> who is calling (a member name, or "First (team)")

export const BUNDLE_MAX = 20_000;
export const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,59}$/;
const LIST_LIMIT = 60;

// A bundle that looks like it holds a key is refused before anything is written.
const SECRET_PATTERNS = [
  /(?:password|passwd|api[_-]?key|secret|token|[_-]key)\w*["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i,
  // Unquoted .env and shell style values: API_KEY=abcdefghijklmnop1234
  /(?:password|passwd|api[_-]?key|secret|token|[_-]key)\w*\s*[:=]\s*[^\s"'`(){}\[\],;]{12,}/i,
  /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{16,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/,
];
export const looksLikeKey = (text) => SECRET_PATTERNS.some((re) => re.test(String(text)));

const when = (t) => {
  const d = new Date(String(t));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown time";
};
const text = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

export async function toolSave(deps, args) {
  const name = text(args.name, 80).toLowerCase().replace(/\s+/g, "-");
  if (!NAME_RE.test(name)) return "Give a name for the tool: lowercase letters, numbers, dots, dashes or underscores, up to 60 characters (for example \"kit-example-client\").";
  const what = text(args.what, 301);
  const use = text(args.use, 601);
  if (!what) return "Give what: one line saying what the tool is.";
  if (what.length > 300) return "Refused: what is too long, keep it to 300 characters.";
  if (!use) return "Give use: when and how someone should use the tool.";
  if (use.length > 600) return "Refused: use is too long, keep it to 600 characters.";
  const client = text(args.client, 81);
  if (client.length > 80) return "Refused: client is too long, keep it to 80 characters.";
  const bundle = typeof args.bundle === "string" ? args.bundle : "";
  if (!bundle.trim()) return "Give bundle: the tool's text (from the kit bundler).";
  if (bundle.length > BUNDLE_MAX) return `Refused: the bundle is ${bundle.length} characters; the limit is ${BUNDLE_MAX}. Trim it and save again.`;
  if (looksLikeKey(bundle) || looksLikeKey(what) || looksLikeKey(use)) {
    return "Refused: the text looks like it holds a key, token or password. Take it out (keys never go in a shared tool) and save again.";
  }
  const row = { name, what, use, client: client || null, bundle, member: deps.author };
  const have = await deps.get(name);
  if (have) {
    if (have.member !== deps.author) return `Refused: the name "${name}" is already used by ${have.member}. Pick another name, or ask ${have.member} to update theirs.`;
    await deps.update(name, { what, use, client: row.client, bundle, updated_at: new Date().toISOString() });
    return `Updated the shared tool "${name}" (${bundle.length} characters). Everyone's Claude gets this version with tool_get.`;
  }
  await deps.insert(row);
  return `Saved the shared tool "${name}" (${bundle.length} characters). Everyone's Claude can now list it with tool_list and get it with tool_get.`;
}

export async function toolList(deps, args) {
  const client = text(args.client, 80);
  const rows = await deps.list(client || null);
  if (!rows.length) return client ? `No shared tools for "${client}" yet.` : "No shared tools saved yet.";
  const shown = rows.slice(0, LIST_LIMIT);
  const lines = shown.map((r) =>
    `- ${r.name}: ${r.what} | use: ${r.use} | client: ${r.client || "any"} | made by ${r.member} | ${r.status} | ${when(r.updated_at || r.created_at)}`);
  const more = rows.length > shown.length ? `\n(${rows.length - shown.length} more; ask for one client to narrow it.)` : "";
  return `Shared tools (${rows.length}), newest first:\n${lines.join("\n")}${more}\nGet one with tool_get {name}.`;
}

export async function toolGet(deps, args) {
  const name = text(args.name, 80).toLowerCase().replace(/\s+/g, "-");
  if (!name) return "Give name: the tool to get (see tool_list).";
  const row = await deps.get(name);
  if (!row) return `Could not find a shared tool called "${name}". Use tool_list to see the names.`;
  return `Shared tool "${row.name}" (${row.status}), made by ${row.member}, saved ${when(row.updated_at || row.created_at)}.\nWhat: ${row.what}\nUse: ${row.use}\nClient: ${row.client || "any"}\n--- bundle ---\n${row.bundle}`;
}
