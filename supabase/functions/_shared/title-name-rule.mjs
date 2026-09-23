/*
 * THE NAME RULE: one source for splitting and renaming sub-issue titles.
 *
 * A sub-issue title is `[Sample ]Video|Thumbnail N[ — name]`. The number is
 * data (the next ordinal in a batch is read back out of the titles, see
 * production-write/policy.mjs `intakeTitleParts`), so a rename only ever
 * replaces the part after the separator. Titles that are not in that shape
 * (Linear-era human titles, `Video 03`, `Video 3 - x`) carry no number, so a
 * rename replaces them whole -- and must never produce something that LOOKS
 * numbered, because that would invent an ordinal (owner ruling 2026-09-23).
 *
 * THREE COPIES, ONE RULE. This module is the source. The browser carries a
 * copy in src/index/125-title-name-rule.js.part and SQL carries one in
 * migrations/2026-09-23-rename-propagation.sql (`syncview_title_*`).
 * test/title-name-rule-drift.js runs the same fixture table through all three
 * and through policy.mjs's parser, and fails on any difference.
 *
 * To make the SQL copy exact, whitespace and "any character" are spelled out
 * instead of using `\s` and `.`, whose meaning differs between JavaScript and
 * Postgres. WS is exactly JavaScript's `\s` set; LINE_BREAKS are the four
 * characters JavaScript's `.` refuses. Lengths are counted in code points
 * (Postgres `char_length`), not UTF-16 units.
 */
export const TITLE_SEPARATOR = " \u2014 ";
export const NAME_MAX = 160;

const WS = "\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
const LINE_BREAKS = "\\n\\r\\u2028\\u2029";
export const RULE_SOURCE = Object.freeze({
  whitespace: WS,
  lineBreaks: LINE_BREAKS,
  title: "^(Sample )?(Video|Thumbnail) ([1-9][0-9]*)(?:" + TITLE_SEPARATOR + "([^" + LINE_BREAKS + "]+))?$",
});

const WS_RUN = new RegExp("[" + WS + "]+", "g");
const WS_EDGE = new RegExp("^[" + WS + "]+|[" + WS + "]+$", "g");
const TITLE_RE = new RegExp(RULE_SOURCE.title);

export function trimText(value) {
  return String(value == null ? "" : value).replace(WS_EDGE, "");
}

// What a person typed, as it will be stored: every whitespace run (newlines,
// NBSP, tabs) becomes one space, and the ends are trimmed.
export function cleanName(value) {
  return trimText(String(value == null ? "" : value).replace(WS_RUN, " "));
}

export function nameLength(value) {
  return [...String(value == null ? "" : value)].length;
}

// { sample, kind, ordinal, digits, name } for a title in our shape, else null.
// `digits` is the number exactly as written; compose from it, never from
// `ordinal`, which loses precision past 2^53.
export function titleParts(title) {
  const match = TITLE_RE.exec(trimText(title));
  if (!match) return null;
  return {
    sample: !!match[1],
    kind: match[2],
    ordinal: Number(match[3]),
    digits: match[3],
    name: trimText(match[4] || ""),
  };
}

// The name a title carries: the part after the separator for our shape
// (empty for a bare `Video 4`), or the whole trimmed title otherwise.
export function nameOfTitle(title) {
  const parts = titleParts(title);
  return parts ? parts.name : trimText(title);
}

/*
 * The title `oldTitle` becomes when its name is set to `newName`.
 * Returns { ok: true, title, changed } or { ok: false, reason }.
 *
 *   name_too_long              > NAME_MAX code points after cleaning
 *   empty_name_not_propagated  old title has no number and the name is empty
 *                              (a title cannot be empty; inventing one is worse)
 *   name_would_look_numbered   old title has no number and the new name is
 *                              itself `Video 7 ...`: taking it as written would
 *                              invent ordinal 7 in that batch
 */
export function renameTitle(oldTitle, newName) {
  const name = cleanName(newName);
  if (nameLength(name) > NAME_MAX) return { ok: false, reason: "name_too_long" };
  const before = trimText(oldTitle);
  const parts = titleParts(before);
  let title;
  if (parts) {
    title = (parts.sample ? "Sample " : "") + parts.kind + " " + parts.digits
      + (name ? TITLE_SEPARATOR + name : "");
  } else {
    if (!name) return { ok: false, reason: "empty_name_not_propagated" };
    if (titleParts(name)) return { ok: false, reason: "name_would_look_numbered" };
    title = name;
  }
  return { ok: true, title, changed: title !== before };
}
