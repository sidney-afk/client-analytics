// Pure logic for the Production thumbnail title buttons (session Titlecard, 2026-10-23, OPEN_REPAIRS 476).
// No Deno or network APIs here, so test/thumbnail-title-buttons-source.js runs it under Node.
//
// A press of "Thumbnail titles" (a whole post) or "Write title" (one thumbnail) starts a RUN on the server.
// The run reads the client's filming plan, picks the plan tab this batch was filmed from (pickBatchTab),
// asks the model once for every thumbnail (the same prompt and checks as the background writer in
// logic.mjs), and decides per thumbnail what may be written without asking (decideWrite). Owner decisions
// are in docs/syncview-design/mockups/thumbnail-titles/PLAN.md section 10.

import { NEEDS_INFO_TEXT, NEEDS_INFO, MONTHS, planHasVideos, weekStart } from "./logic.mjs";

const clean = (v) => String(v == null ? "" : v).trim();

// ---------------------------------------------------------------------------
// Dating a plan tab. A tab's date comes from its NAME ("October 2026", "Oct", "Week of Sept 28"), else
// from the month its text mentions most (tabMonthOf, the connector's tabMonth), else it has none. A name
// with no year takes the year that puts it nearest the anchor (within six months either side), so a
// "November" tab seen in October is next month's plan, not last year's.
// ---------------------------------------------------------------------------
const MONTH_WORD = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?(?:\s*,?\s*(20\d\d))?/i;
const ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function nearestYear(monthIndex, anchor) {
  const y = anchor.getUTCFullYear();
  const options = [y - 1, y, y + 1].map((yy) => new Date(Date.UTC(yy, monthIndex, 1)));
  const ref = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1);
  options.sort((a, b) => Math.abs(a.getTime() - ref) - Math.abs(b.getTime() - ref));
  return options[0];
}

function monthFrom(label, anchor) {
  const m = MONTH_WORD.exec(String(label || ""));
  if (!m) return null;
  const idx = ABBR[m[1].toLowerCase().slice(0, 3)];
  if (idx == null) return null;
  return m[2] ? new Date(Date.UTC(Number(m[2]), idx, 1)) : nearestYear(idx, anchor);
}

// { date: Date | null, kind: "week" | "month" | "text" | "none" }
export function tabDate(tab, anchorIso, tabMonthOf) {
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) return { date: null, kind: "none" };
  const name = clean(tab && tab.name);
  // weekStart puts a year-less week on or before the date it is given; giving it a date half a year
  // ahead makes it pick the nearest year instead, so next week's tab reads as next week.
  const ahead = new Date(anchor.getTime() + 182 * 24 * 3600 * 1000).toISOString();
  const week = weekStart(name, ahead);
  if (week) return { date: week, kind: "week" };
  const byName = monthFrom(name, anchor);
  if (byName) return { date: byName, kind: "month" };
  const label = tabMonthOf ? clean(tabMonthOf(String((tab && tab.text) || ""))) : "";
  const byText = label && label !== "no month found" ? monthFrom(label, anchor) : null;
  if (byText) return { date: byText, kind: "text" };
  return { date: null, kind: "none" };
}

// A tab dated after the anchor is the plan being written for the next shoot ("the one still being
// worked on right now"). A month tab counts as on or before the anchor when it is the anchor's month or
// earlier; a week tab when it starts on or before the anchor day.
function onOrBefore(dated, anchor) {
  if (!dated.date) return true;
  if (dated.kind === "week") return dated.date.getTime() <= anchor.getTime();
  return dated.date.getTime() <= Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1);
}

// The video numbers a tab lists: "1.", "Video 3:", "#4 -", "Reel 2)" at the start of a line. Only the
// first, main list counts, as the model is told: numbering that restarts at 1 ends it.
const NUMBER_LINE = /^\s*(?:(?:video|vid|reel|script|short|ad|hook)\s*)?#?(\d{1,3})\s*[.):\-—–]/gim;
export function planVideoNumbers(text) {
  const out = [];
  for (const m of String(text || "").matchAll(NUMBER_LINE)) {
    const n = Number(m[1]);
    if (!(n >= 1 && n <= 200)) continue;
    if (out.length && n === 1 && out.includes(1)) break;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// Does this tab hold every video number the batch needs? A tab whose list cannot be read as numbers is
// not refused here (permissive rule, AGENTS.md): the model still leaves out what it cannot match.
export function tabFits(tab, wanted) {
  const want = (wanted || []).filter((n) => Number.isInteger(n) && n > 0);
  if (!want.length) return true;
  const have = planVideoNumbers(tab && tab.text);
  if (!have.length) return true;
  const max = Math.max(...have);
  return want.every((n) => n <= max);
}

export function tabLabel(tab, anchorIso, tabMonthOf) {
  const name = clean(tab && tab.name).replace(/\s+/g, " ").slice(0, 40);
  if (name) return name;
  const dated = tabDate(tab, anchorIso, tabMonthOf);
  if (dated.date && dated.kind !== "week") {
    const m = MONTHS[dated.date.getUTCMonth()];
    return m[0].toUpperCase() + m.slice(1);
  }
  return "plan";
}

// Every tab that lists videos, for "Use another tab". Newest first when dated, Doc order otherwise.
export function tabChoices(tabs, anchorIso, tabMonthOf) {
  const list = (tabs || []).filter((t) => planHasVideos(t.text));
  return list.map((t, i) => {
    const dated = tabDate(t, anchorIso, tabMonthOf);
    return { id: clean(t.id) || `#${i}`, name: tabLabel(t, anchorIso, tabMonthOf), videos: planVideoNumbers(t.text).length, order: i, time: dated.date ? dated.date.getTime() : null };
  }).sort((a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity) || b.order - a.order)
    .map(({ id, name, videos }) => ({ id, name, videos }));
}

// THE BATCH RULE (owner decision 4). anchorIso = the day the post's batch was made in SyncView.
// Returns { tab, via, reason, ask }:
//   tab     the chosen tab, or null
//   via     "latest" | "previous" | "only" | "picked"
//   reason  "" | "plan_empty" | "no_fit" | "two_fit"
//   ask     tabs to offer the person when the rule cannot decide (two fit equally, or nothing fits)
export function pickBatchTab(tabs, anchorIso, wanted, tabMonthOf, pickedId) {
  const list = (tabs || []).filter((t) => planHasVideos(t.text));
  if (!list.length) return { tab: null, via: "", reason: "plan_empty", ask: [] };
  if (pickedId) {
    const byId = list.find((t, i) => (clean(t.id) || `#${i}`) === pickedId);
    if (byId) return { tab: byId, via: "picked", reason: "", ask: [] };
  }
  const choices = () => tabChoices(tabs, anchorIso, tabMonthOf);
  if (list.length === 1) return tabFits(list[0], wanted)
    ? { tab: list[0], via: "only", reason: "", ask: [] }
    : { tab: null, via: "", reason: "no_fit", ask: choices() };

  const anchor = new Date(anchorIso);
  const dated = list.map((t, order) => ({ t, order, ...tabDate(t, anchorIso, tabMonthOf) }));
  const anyDated = dated.some((d) => d.date);
  let candidates;
  if (anyDated && !Number.isNaN(anchor.getTime())) {
    candidates = dated.filter((d) => d.date && onOrBefore(d, anchor))
      .sort((a, b) => b.date.getTime() - a.date.getTime() || b.order - a.order);
    if (candidates.length > 1 && candidates[0].date.getTime() === candidates[1].date.getTime()) {
      return { tab: null, via: "", reason: "two_fit", ask: [candidates[0], candidates[1]].map((c) => ({ id: clean(c.t.id) || `#${c.order}`, name: tabLabel(c.t, anchorIso, tabMonthOf), videos: planVideoNumbers(c.t.text).length })) };
    }
  } else {
    // No tab carries a date: the Doc's own order, last tab first.
    candidates = dated.slice().reverse();
  }
  for (const [i, c] of candidates.slice(0, 2).entries()) {
    if (tabFits(c.t, wanted)) return { tab: c.t, via: i === 0 ? "latest" : "previous", reason: "", ask: [] };
  }
  return { tab: null, via: "", reason: "no_fit", ask: choices() };
}

// ---------------------------------------------------------------------------
// What is in a description now, and what a run may do with it (owner decision 3).
// ---------------------------------------------------------------------------
function needsInfoPatterns() {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Object.values(NEEDS_INFO_TEXT).map((t) => {
    const parts = t.split(/\{(?:month|plan|video|post)\}/g).map(esc);
    return new RegExp("^" + esc(NEEDS_INFO) + parts.join("[^\\n]{0,120}") + "$");
  });
}
const NEEDS_INFO_RES = needsInfoPatterns();
const AI_LINE = /^Thumbnail title \(generated by AI(?:, from the [^\n)]{1,60} plan)?\): [^\n]{1,200}$/;

// "empty" | "needs_info" (the robot's own exact line) | "ai" (an AI title line, untouched) | "human"
export function briefKind(brief) {
  const b = clean(brief);
  if (!b) return "empty";
  if (NEEDS_INFO_RES.some((re) => re.test(b))) return "needs_info";
  if (AI_LINE.test(b)) return "ai";
  return "human";
}

// Written at once: an empty description or the robot's own "Needs info" line. Anything else waits for a
// person: an earlier AI title (Use new), or text a person wrote (Keep mine is the default).
export function decideWrite(brief) {
  const kind = briefKind(brief);
  return { kind, auto: kind === "empty" || kind === "needs_info" };
}

export const PREVIOUS_HEADING = "Previous description:";

// The text a person's choice writes. "replace" keeps their text under the title, never deletes it.
export function textFor(choice, titleLine, before) {
  const old = String(before || "").trim();
  if (choice === "use_new" || choice === "write" || !old) return titleLine;
  if (choice === "above") return `${titleLine}\n\n${old}`;
  if (choice === "replace") return `${titleLine}\n\n${PREVIOUS_HEADING}\n${old}`;
  throw new Error("unknown_choice");
}

export function titleLineFor(title, tabName) {
  const plan = clean(tabName).replace(/[\r\n()]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return (plan ? `Thumbnail title (generated by AI, from the ${plan} plan): ` : "Thumbnail title (generated by AI): ") + clean(title);
}

// The words a row shows when no title is written. Short, plain, and never a plan line.
export function skipMessage(outcome, vars = {}) {
  const tab = clean(vars.tab) || "chosen";
  const n = Number(vars.video) || 0;
  switch (outcome) {
    // "No video N" only when the tab's own list stops before N; otherwise the model could not match it.
    case "no_match": return !n ? `Not matched to a video in the ${tab} plan` : vars.absent ? `No video ${n} in the ${tab} plan` : `Video ${n} not matched in the ${tab} plan`;
    case "not_grounded": return "No title could be grounded in the plan";
    case "gone": return "This sub-issue was removed or cancelled";
    case "changed": return "Changed while writing, kept yours";
    case "not_thumbnail": return "Not a thumbnail";
    default: return "Skipped";
  }
}

// ---------------------------------------------------------------------------
// The filming plan Doc: its id from a batch link, and its tabs' text from the Google Docs API (the
// service-account reader, for plans that are not shared by link).
// ---------------------------------------------------------------------------
export function docIdFromUrl(url) {
  const m = /\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,100})/.exec(String(url || ""));
  return m ? m[1] : "";
}

export const DOCS_TEXT_FIELDS = "tabs(tabProperties(tabId,title),documentTab(body(content(paragraph(elements(textRun(content))),table(tableRows(tableCells(content(paragraph(elements(textRun(content)))))))))),childTabs(tabProperties(tabId,title),documentTab(body(content(paragraph(elements(textRun(content))),table(tableRows(tableCells(content(paragraph(elements(textRun(content))))))))))))";

function contentText(content) {
  let out = "";
  for (const el of Array.isArray(content) ? content : []) {
    if (el && el.paragraph) {
      for (const pe of el.paragraph.elements || []) out += (pe && pe.textRun && pe.textRun.content) || "";
    } else if (el && el.table) {
      for (const row of el.table.tableRows || []) {
        const cells = (row.tableCells || []).map((c) => contentText(c.content).replace(/\n+/g, " ").trim());
        out += cells.join(" | ") + "\n";
      }
    }
  }
  return out;
}

// documents.get with includeTabsContent=true -> [{ id, name, text }], the same shape planTabs returns.
export function docTabsText(googleDoc) {
  const out = [];
  const walk = (tabs) => {
    for (const t of Array.isArray(tabs) ? tabs : []) {
      const p = (t && t.tabProperties) || {};
      const body = t && t.documentTab && t.documentTab.body;
      const text = contentText(body && body.content).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
      if (text.trim()) out.push({ id: clean(p.tabId), name: clean(p.title), text });
      if (t && Array.isArray(t.childTabs)) walk(t.childTabs);
    }
  };
  walk(googleDoc && googleDoc.tabs);
  return out;
}

// ---------------------------------------------------------------------------
// Token counts (owner decision 7): the provider's usage block, summed across the calls of one run.
// ---------------------------------------------------------------------------
export function addUsage(total, usage) {
  const u = usage && typeof usage === "object" ? usage : {};
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    input: total.input + n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens),
    output: total.output + n(u.output_tokens),
  };
}

// Sonnet 5.5 list price, dollars per million tokens. For the run summary only; the stored numbers are
// the token counts themselves.
export const PRICE_PER_MTOK = { "claude-sonnet-5-5": { input: 2, output: 10 } };
export function costCents(model, input, output) {
  const p = PRICE_PER_MTOK[model] || PRICE_PER_MTOK["claude-sonnet-5-5"];
  return Math.round(((input * p.input + output * p.output) / 1e6) * 1000) / 10;
}

// A display name from the X-Syncview-Actor header. It labels the run ("Being written by Sam") and the
// history row; it is never used to decide anything (the staff key decides).
export function actorName(header, role) {
  const v = clean(header).replace(/[^\p{L}\p{N} .'-]/gu, "").slice(0, 60).trim();
  return v || (role ? `staff:${role}` : "staff");
}

export const MAX_RUN_ITEMS = 40;
export const RUN_KEY_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
