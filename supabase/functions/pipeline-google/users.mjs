// Who may use the filming plan pipeline at all (owner's decision, 2026-10-17).
// Plain JavaScript with no Deno parts, so a unit test can run it; both
// higgsfield-mcp (pipeline_pass, toolkit_latest "filming-plan") and
// pipeline-google (every pass action) use it.
//
// The list is the fp_settings key "pipeline_users": a JSON list of personal
// connector link member names (or { members: [...] }), read on every call, so
// removing a name takes effect at once, even on a pass already handed out. No
// name is written in code. The shared team link is always refused: its names
// are typed by whoever uses it. The refusal text is the fp_settings key
// "pipeline_users_refusal" when set, else REFUSAL_FALLBACK.

export const USERS_KEY = "pipeline_users";
export const REFUSAL_KEY = "pipeline_users_refusal";
export const REFUSAL_FALLBACK = "The filming plan is only for a few people. Ask the account owner.";
export const REFUSAL_MAX = 500;

// The list as names: a JSON list, or { members: [...] }. Anything else is an
// empty list (nobody), never an error that lets someone in.
export function parseUsers(value) {
  let v = value;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch (_e) { return []; }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) v = v.members;
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
}

// The refusal text from the setting (a plain string, a JSON string, or
// { text }), else the fallback.
export function refusalText(value) {
  let v = value;
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith('"') || s.startsWith("{")) {
      try { v = JSON.parse(s); } catch (_e) { v = s; }
    } else {
      v = s;
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) v = v.text;
  const text = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, REFUSAL_MAX) : "";
  return text || REFUSAL_FALLBACK;
}

// May this person use the pipeline? teamLink: the call (or the pass) came from
// the shared team link. users: the raw setting value.
export function mayUsePipeline({ member, teamLink, users }) {
  if (teamLink) return false;
  const m = typeof member === "string" ? member.trim() : "";
  return !!m && parseUsers(users).includes(m);
}

// The check both functions run. setting(key) -> value or null (may throw).
// Answers null when allowed, else { text, status }. A setting that cannot be
// read refuses (status 503): it never lets someone in.
export async function pipelineGate(setting, { member, teamLink }) {
  let users, refusal = null;
  try {
    users = await setting(USERS_KEY);
  } catch (_e) {
    return { text: "Could not check who may use the filming plan. Try again in a minute.", status: 503 };
  }
  if (mayUsePipeline({ member, teamLink, users })) return null;
  try { refusal = await setting(REFUSAL_KEY); } catch (_e) { refusal = null; }
  return { text: refusalText(refusal), status: 403 };
}
