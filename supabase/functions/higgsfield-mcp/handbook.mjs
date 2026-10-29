// The team handbook in the Synchro Brain: flat pages company/handbook-<name>.md,
// with handbook-start.md as the index. Read through client_brain's handbook
// option and changed through brain_change's handbook_page option; this file
// holds the pure parts (names, text, the reply wording) so a test can run them
// with no network.

export const HANDBOOK_START = "start";
export const HANDBOOK_MAX_CHARS = 60000;
// Pages anyone may change by chat. Every other page takes a suggestion that
// waits for Sidney.
export const OPEN_HANDBOOK_PAGES = ["videographers"];

// "team", "Handbook Team", "handbook-team.md" and "company/handbook-team.md"
// all name the page "team". Empty or "list" is the index. "" when the words
// cannot name a page (so nothing odd ever reaches a file path).
export function handbookPageName(input) {
  let s = String(input == null ? "" : input).trim().toLowerCase().replace(/^company\//, "").replace(/\.md$/, "");
  s = s.replace(/[\s_]+/g, "-").replace(/^handbook-?/, "");
  if (s === "" || s === "list" || s === "index" || s === "all" || s === "true") return HANDBOOK_START;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 60 ? s : "";
}

export const handbookPath = (page) => `company/handbook-${page}.md`;

// The page names found in a directory listing of company/.
export function handbookPagesIn(names) {
  return (names || []).map((n) => /^handbook-([a-z0-9-]+)\.md$/.exec(String(n))).filter(Boolean).map((m) => m[1]).sort();
}

// The page as people read it: the <!-- brain ... --> fact blocks are
// bookkeeping, not text.
export function cleanPage(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->\n?/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function handbookReply(page, text, pages) {
  const body = cleanPage(text);
  const others = pages.filter((p) => p !== page);
  const head = `Team handbook, page "${page}"${page === HANDBOOK_START ? " (the index: read the page that fits the question, by calling client_brain again with handbook set to its name)" : ""}.`;
  const tail = others.length ? `\n\nOther pages (ask for one with handbook set to its name): ${others.join(", ")}.` : "";
  if (body.length <= HANDBOOK_MAX_CHARS) return `${head}\n\n${body}${tail}`;
  return `${head}\n\n${body.slice(0, HANDBOOK_MAX_CHARS)}\n\n[This page is ${body.length} characters; the first ${HANDBOOK_MAX_CHARS} are shown and the rest was left out. Say so, and answer only from what is shown.]${tail}`;
}

export const handbookOpen = (page) => OPEN_HANDBOOK_PAGES.includes(page);

// The text filed for a handbook change. The line before the person's words is
// what the brain's change run reads to know which page and whether it may go
// straight in.
export function handbookChangeText(page, whatChanged) {
  const line = handbookOpen(page)
    ? `HANDBOOK PAGE ${handbookPath(page)}. Anyone may change this page by chat (Sidney's decision, 2026-10-28), so apply it.`
    : `HANDBOOK PAGE ${handbookPath(page)}. A suggestion only: this page changes with Sidney's OK, so do not apply it until he says yes.`;
  return `${line}\n\n${String(whatChanged || "").trim()}`;
}

export function handbookChangeReply(page, filed) {
  if (!filed) return "";
  return handbookOpen(page)
    ? `Sent. It will be filed in the handbook page "${page}" within a few minutes.`
    : `Sent as a suggestion for the handbook page "${page}". Sidney has to say yes before it goes in; say that instead of "Saved".`;
}
