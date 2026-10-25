// What client_brain sends, as pure text building (no network), shared with the
// unit test and the size measurement. By default: the whole brain (brief and
// every written fact in full) when it fits the budget; only when it does not,
// the brief plus each fact's first paragraph, then the named list of facts that
// still did not fit. With a topic: the facts it names, in full. Whatever does
// not fit is named, never silently cut.
//
// The facts come only from the fixed file list in clientinfo.ts (focus,
// brief, identity, voice, editing, relationship, audience). focus.md (what the
// content is focused on right now) is part of the head: always sent whole,
// before the brief, never left out. history.md holds old
// notes and is never read or served here. dreams.md (what the brain dreamt:
// our read of the client, not facts) is sent whole after the brief, under its
// "Dreamt by the brain" heading, and on the topic "dreams".

import { parseBrief } from "../brain/parse.mjs";

export const BRAIN_MAX_CHARS = 60_000;
// A first paragraph longer than this is shortened too (rare; keeps one huge
// opening paragraph from crowding out the rest).
export const FIRST_PARAGRAPH_MAX = 1_500;
export const BRAIN_FILE_NAMES = ["focus", "brief", "identity", "voice", "editing", "relationship", "audience"];

const ASK = "call client_brain again with topic set to its fact id (or a heading word such as \"Caption style\", or a file name such as editing)";

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// The first paragraph: the body up to its first blank line, capped.
export function firstParagraph(body) {
  const text = String(body || "").trim();
  const paras = text.split(/\n[ \t]*\n/);
  // A paragraph ending in ":" introduces what follows, so the next one comes along.
  let n = 1;
  while (n < paras.length && /:\**\s*$/.test(paras[n - 1])) n++;
  const first = paras.slice(0, n).join("\n\n").trim();
  const cut = first.length > FIRST_PARAGRAPH_MAX ? first.slice(0, FIRST_PARAGRAPH_MAX).replace(/\s+\S*$/, "") + " …" : first;
  return { text: cut, more: n < paras.length || cut !== first };
}

export function briefSections(brief) {
  return parseBrief(brief).map((s) => ({ heading: s.heading, text: `## ${s.heading}\n${s.bullets.map((b) => `- ${b.text}`).join("\n")}` }));
}

function label(f, more) {
  return `### ${f.heading} (${f.file}; fact id: ${f.id || "none"}${more ? "; more" : ""})`;
}

function fullFact(f) {
  return `${label(f, false)}\n${f.body}${f.sure ? `\nHow sure we are: ${f.sure}` : ""}`;
}

function shortFact(f) {
  const p = firstParagraph(f.body);
  return `${label(f, p.more)}\n${p.text}${f.sure ? `\nHow sure we are: ${f.sure}` : ""}`;
}

// "editing.md: id, id; audience.md: id" for the facts that did not fit.
function leftOutLine(facts) {
  const byFile = new Map();
  for (const f of facts) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f.id || `"${f.heading}" (no id)`);
  }
  return [...byFile].map(([file, ids]) => `${file}.md (${ids.length}): ${ids.join(", ")}`).join("\n");
}

// Add blocks in order while they fit; name every one that does not.
function fit(head, blocks, facts) {
  let out = head;
  const left = [];
  for (let i = 0; i < blocks.length; i++) {
    if (left.length) { left.push(facts[i]); continue; }
    const rest = facts.slice(i + 1);
    const room = BRAIN_MAX_CHARS - (rest.length ? footer(rest).length : 0);
    if (out.length + 2 + blocks[i].length <= room) out += (out ? "\n\n" : "") + blocks[i];
    else left.push(facts[i]);
  }
  return left.length ? out + footer(left) : out;
}

// The list of left-out facts is itself bounded: past this size it names only
// the files and how many facts each lost, so the reply stays within budget.
const FOOTER_MAX = 12_000;

function footer(left) {
  const head = `\n\n# Left out for length\n\nThese facts did not fit in this answer and were not sent. To read one, ${ASK}:\n`;
  const ids = leftOutLine(left);
  if (head.length + ids.length <= FOOTER_MAX) return head + ids;
  const counts = new Map();
  for (const f of left) counts.set(f.file, (counts.get(f.file) || 0) + 1);
  return head + [...counts].map(([file, n]) => `${file}.md: ${n} facts (too many to list; ask with the file name, or a heading word)`).join("\n");
}

// dreams.md, capped, always under one heading that says these are not facts.
export const DREAMS_MAX_CHARS = 6_000;
export function dreamsBlock(dreams) {
  const body = String(dreams || "").replace(/^# .*\n+/, "").trim();
  if (!body) return "";
  const cut = body.length > DREAMS_MAX_CHARS ? body.slice(0, DREAMS_MAX_CHARS).replace(/\s+\S*$/, "") + " …" : body;
  return `# Dreamt by the brain (our read of this client, not facts; each line names the facts it came from)\n\n${cut.replace(/^## /gm, "### ")}`;
}

// The one place the reply text is built. focus and facts: written facts
// only, each { file, heading, id, body, sure? }, in reading order.
/**
 * @param {{ name: string, brief: string, focus?: any[], facts: any[], topic?: string, dreams?: string }} args
 * @returns {string}
 */
export function brainView({ name, brief, focus = [], facts, topic = "", dreams = "" }) {
  const sections = briefSections(brief);
  const briefText = sections.map((s) => s.text).join("\n\n");
  const t = String(topic || "").trim();
  const dreamText = dreamsBlock(dreams);
  if (!briefText && !facts.length && !focus.length) return `${name}: the Synchro Brain has no written brief or facts yet.`;

  if (!t) {
    const focusBlock = focus.length ? `# Current focus\n\n${focus.map(fullFact).join("\n\n")}\n\n` : "";
    const briefBlock = `${focusBlock}# Brief\n\n${briefText || "(no brief written yet)"}${dreamText ? "\n\n" + dreamText : ""}\n\n# Facts`;
    // The whole brain first; sent as is when it fits.
    const whole = `${name}, from the Synchro Brain: the brief and every written fact, in full.\n\n${briefBlock}\n\n${facts.length ? facts.map(fullFact).join("\n\n") : "(no written facts yet)"}`;
    if (whole.length <= BRAIN_MAX_CHARS) return whole;
    const head = `${name}, from the Synchro Brain. The whole brain is too long for one answer, so the current focus and the brief are in full and each fact shows its first paragraph; a fact marked "more" has more detail. When you need more on a topic, ${ASK}.\n\n${briefBlock}`;
    return fit(head, facts.map(shortFact), facts);
  }

  const want = norm(t.replace(/\.md$/i, ""));
  if (want === "dreams" || want === "dreamt" || want === "dreamt by the brain") {
    return dreamText ? `${name}, from the Synchro Brain:\n\n${dreamText}` : `${name}: the brain has dreamt nothing about this client yet.`;
  }
  // With a topic, focus facts are searched like any other.
  facts = [...focus, ...facts];

  // A file name: that whole file, in full.
  const file = BRAIN_FILE_NAMES.find((f) => f === want);
  if (file === "brief") return `${name}, brief from the Synchro Brain, in full.\n\n${briefText || "(no brief written yet)"}`;
  let hits = file ? facts.filter((f) => f.file === file) : [];
  let how = file ? `every written fact in ${file}.md` : "";
  // A fact id, whole or by a dotted ending ("editing.subtitle-spec").
  if (!file) {
    const id = t.toLowerCase();
    hits = facts.filter((f) => f.id && (f.id.toLowerCase() === id || (id.includes(".") && f.id.toLowerCase().endsWith("." + id))));
    how = "the fact with that id";
  }
  // Heading words: every fact whose heading (or own name) holds them, exact
  // headings first. Only the file and the fact's own name in the id count:
  // "client.<folder>." is in every id, so matching it would hit every fact.
  if (!hits.length && !file && want) {
    const own = (f) => norm(String(f.id || "").split(".").slice(2).join(" "));
    const exact = facts.filter((f) => norm(f.heading) === want);
    hits = [...exact, ...facts.filter((f) => !exact.includes(f) && (norm(f.heading).includes(want) || own(f).includes(want)))];
    how = `the facts whose heading matches "${t}"`;
  }
  const briefHits = file ? [] : sections.filter((s) => norm(s.heading) === want || norm(s.heading).includes(want));
  if (!hits.length && !briefHits.length) {
    const list = facts.map((f) => `- ${f.heading} (${f.file}; fact id: ${f.id || "none"})`);
    let out = `${name}: no fact matches "${t}" in the Synchro Brain. These are the written facts; ask again with one of their ids or headings:`;
    for (const line of list) {
      if (out.length + line.length + 40 > BRAIN_MAX_CHARS) { out += "\n(and more)"; break; }
      out += "\n" + line;
    }
    return out;
  }
  if (!hits.length) return `${name}, brief from the Synchro Brain, sections matching "${t}":\n\n${briefHits.map((s) => s.text).join("\n\n")}`;

  const briefPart = briefHits.length ? `\n\n# Brief sections matching "${t}"\n\n${briefHits.map((s) => s.text).join("\n\n")}` : "";
  const head = `${name}, from the Synchro Brain: ${how}, in full.${briefPart}\n\n# Facts`;
  // One fact longer than the whole budget is cut, and says so with its id.
  const blocks = hits.map((f) => {
    const b = fullFact(f);
    const room = BRAIN_MAX_CHARS - head.length - 400;
    return b.length > room ? b.slice(0, room) + `\n\n[This fact is longer than this answer can hold; the rest of ${f.id || f.heading} was not sent.]` : b;
  });
  return fit(head, blocks, hits);
}
