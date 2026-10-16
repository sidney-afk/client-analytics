// A client's video look as one JSON (the "video profile"), served by the
// connector's studio_profile and studio_profile_save tools for the Synchro
// video studio. Plain JavaScript with no Deno parts, so a unit test can run it.
//
// Where it lives: the private synchro-brain repository, one file per client,
// clients/<folder>/video-profile.json. The connector never writes that file
// itself. A save is filed exactly like brain_change (../brain/change.mjs): a
// new input under inputs/syncview-changes/ naming who sent it, which the
// brain's own workflow processes and logs (POLICY/syncview-changes.md, section
// "Video profile updates"). So a profile has the same history, review and
// "who changed it" as every other brain change, and nothing touches the
// client's Look facts or brief.
//
// The schema is permissive: the known fields below are type-checked, every
// other field is kept as it is.

export const PROFILE_FILE = "video-profile.json";
export const PROFILE_MARKER = "VIDEO PROFILE";
export const SCHEMA_VERSION = 1;
// The whole input file must stay under the brain's 8000 character limit
// (MAX_CHANGE_CHARS), with room for the lines around the JSON.
export const PROFILE_MAX_CHARS = 7000;
const TEXT_MAX = 600;
const LIST_MAX = 30;
const DEPTH_MAX = 4;

// The proposed fields. Documented for Claude in the tool description and in
// the PR; anything else a teammate adds is kept.
export const PROFILE_FIELDS = {
  colours: "object: accent, bg, paper, grey (hex like #1a1a1a, or words)",
  fonts: "object: main, accent, subtitles (font names)",
  subtitles: "object: style, size, position, case, highlight, box, shadow, words_per_line (any of these, text)",
  hook_style: "text: how the first seconds and written hooks look",
  music: "text: the music rule",
  avoid: "list of text: things never to do",
  preferred_style: "text: the overall editing style",
  handle: "text: the on-screen handle, e.g. @name",
  platform: "text or list: where the videos go",
  cta_style: "text: how calls to action look and sound",
  camera: "text: the usual camera setup and framing",
  notes: "text: anything else",
};
const OBJECT_FIELDS = new Set(["colours", "fonts", "subtitles"]);
const TEXT_FIELDS = new Set(["hook_style", "music", "preferred_style", "handle", "cta_style", "camera", "notes"]);
const LIST_FIELDS = new Set(["avoid"]);
const TEXT_OR_LIST_FIELDS = new Set(["platform"]);
// Set by the connector on save, never by the caller.
const STAMP_FIELDS = new Set(["schema", "updated_by", "updated_at"]);

// The brain keeps money out of every file the team reads (POLICY, "Money").
// Same patterns as synchro-brain scripts/check_brain.py.
const MONEY = new RegExp(
  "[$€£]\\s?\\d" +
  "|\\b\\d[\\d,.]*\\s?(?:USD|EUR|GBP|dollars?|euros?)\\b" +
  "|\\b(?:stripe|invoic\\w*|billing|billed|retainer|pricing|costs?|commissions?)\\b" +
  "|\\b(?:revenue|product|profit|sales)[- ]share\\b|\\ba share of\\b" +
  "|\\bpayment[- ]plans?\\b|\\bmonth[- ]to[- ]month\\b",
  "i",
);
// A password, token or key never goes into the brain (rule 1).
const SECRET = /\b(?:password|passwd|api[_ -]?key|secret|token)\b\s*[:=]|\b(?:sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9]{12,}/i;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// Check a profile (or a partial one) the caller sent. Returns a list of plain
// problems; empty means fine.
export function profileProblems(p) {
  const out = [];
  if (!isObj(p)) return ["The profile must be a JSON object."];
  const walk = (v, path, depth) => {
    if (depth > DEPTH_MAX) { out.push(`${path} is nested too deep.`); return; }
    if (typeof v === "string") {
      if (v.length > TEXT_MAX) out.push(`${path} is longer than ${TEXT_MAX} characters.`);
      if (MONEY.test(v)) out.push(`${path} mentions money; money never goes in a video profile.`);
      if (SECRET.test(v)) out.push(`${path} looks like a password or key; leave it out.`);
    } else if (Array.isArray(v)) {
      if (v.length > LIST_MAX) out.push(`${path} has more than ${LIST_MAX} items.`);
      v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (!/^[A-Za-z][A-Za-z0-9_ -]{0,39}$/.test(k)) out.push(`${path}: "${k.slice(0, 40)}" is not a usable field name.`);
        else walk(x, `${path}.${k}`, depth + 1);
      }
    } else if (!(v === null || typeof v === "number" || typeof v === "boolean")) {
      out.push(`${path} has a value that is not text, a number, true/false, a list or an object.`);
    }
  };
  for (const [k, v] of Object.entries(p)) {
    if (STAMP_FIELDS.has(k)) continue;
    if (v === null) continue; // null removes the field on save
    if (OBJECT_FIELDS.has(k) && !isObj(v)) out.push(`${k} must be an object (${PROFILE_FIELDS[k]}).`);
    if (TEXT_FIELDS.has(k) && typeof v !== "string") out.push(`${k} must be text.`);
    if (LIST_FIELDS.has(k) && !(typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string")))) out.push(`${k} must be a list of text.`);
    if (TEXT_OR_LIST_FIELDS.has(k) && !(typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string")))) out.push(`${k} must be text or a list of text.`);
    if (OBJECT_FIELDS.has(k) && isObj(v)) {
      for (const [ik, iv] of Object.entries(v)) {
        if (iv !== null && typeof iv !== "string" && typeof iv !== "number" && typeof iv !== "boolean") out.push(`${k}.${ik} must be text.`);
      }
    }
  }
  walk(p, "profile", 0);
  return [...new Set(out)];
}

// Merge a change into the current profile. Objects merge key by key (so a
// change to one colour keeps the others), lists and text replace, null
// removes. Unknown fields on either side are kept. A one-item "avoid" given as
// text becomes a list.
export function mergeProfile(current, change) {
  const base = isObj(current) ? current : {};
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (v === null) delete out[k];
      else if (isObj(v) && isObj(out[k])) out[k] = merge(out[k], v);
      else out[k] = v;
    }
    return out;
  };
  const clean = {};
  for (const [k, v] of Object.entries(isObj(change) ? change : {})) if (!STAMP_FIELDS.has(k)) clean[k] = v;
  const merged = merge(base, clean);
  if (typeof merged.avoid === "string") merged.avoid = [merged.avoid];
  return merged;
}

// The JSON as it is filed: schema first, then the known fields in order, then
// the rest, then who and when. Two-space indent, trailing newline.
export function stampProfile(profile, author, nowIso) {
  const out = { schema: SCHEMA_VERSION };
  for (const k of Object.keys(PROFILE_FIELDS)) if (k in profile) out[k] = profile[k];
  for (const [k, v] of Object.entries(profile)) if (!(k in out) && !STAMP_FIELDS.has(k)) out[k] = v;
  out.updated_by = String(author || "").slice(0, 80);
  out.updated_at = nowIso;
  return out;
}

export function profileJson(profile) {
  return JSON.stringify(profile, null, 2) + "\n";
}

// The text filed through recordChange. It starts with the marker the brain's
// policy recognises, names the target file, and carries the whole profile, so
// the brain writes it exactly as given and never has to merge.
export function profileChangeText(folder, profile) {
  return [
    PROFILE_MARKER,
    `Write this JSON, exactly as given, to clients/${folder}/${PROFILE_FILE} (replacing the file if it exists).`,
    "It is the complete profile; do not merge it, and do not change any .md file, the brief or the Look facts for it.",
    "",
    "```json",
    profileJson(profile).trimEnd(),
    "```",
  ].join("\n");
}

// The fact id the change is filed under, so the brain's log names it.
export function profileFactId(folder) {
  return `client.${folder}.video-profile`;
}

// What studio_profile answers when the file exists.
export function profileReply(clientName, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    return `Could not read ${clientName}'s video profile: the file is not valid JSON. Here is what it says, so it can be fixed with studio_profile_save:\n\n${String(text).slice(0, PROFILE_MAX_CHARS)}`;
  }
  return `${clientName}, video profile from the Synchro Brain (clients/…/${PROFILE_FILE}):\n\n${profileJson(parsed)}`;
}

// What studio_profile answers when there is no file yet: what the brain already
// knows about the client's look, so Claude can draft a first profile.
export function draftReply(clientName, lookBullets, specs) {
  const look = (lookBullets || []).map((b) => `- ${b}`).join("\n");
  const spec = (specs || []).map((s) => `- ${s.heading}: ${s.spec}`).join("\n");
  const known = [look && `From the brief's Look section:\n${look}`, spec && `Exact values in the editing facts:\n${spec}`].filter(Boolean).join("\n\n");
  const fields = Object.entries(PROFILE_FIELDS).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  return `${clientName} has no video profile yet.${known ? ` Here is what the Synchro Brain already knows about the look, to draft a first one from:\n\n${known}` : " The Synchro Brain has no Look notes for this client yet either."}\n\nA profile is one JSON object. Proposed fields (any other field is kept too):\n${fields}\n\nDraft it with the person, show it, and save it with studio_profile_save only after they agree.`;
}
