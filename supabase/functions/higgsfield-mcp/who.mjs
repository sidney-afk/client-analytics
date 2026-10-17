// Who made a thing, and what the connector calls itself. Plain JavaScript with
// no Deno parts, so a unit test can run it (index.ts imports it).
//
// The shared team link is the one hf_team_members row whose name is "Team".
// It is recognised by that name, never by its key. On it, every tool takes an
// optional "who" (a first name) so jobs and brain saves say "<who> (team)" and
// the activity log names the person. Personal links ignore "who" and keep
// their own name.

export const TEAM_NAME = "Team";

// What Claude shows for this connector, and its icon (the real favicon of the
// agency's public site). Claude would otherwise show the host's icon.
export const SERVER_NAME = "synchro";
export const SERVER_ICON = { src: "https://synchrosocial.com/images/logo.png", mimeType: "image/png", sizes: ["500x500"] };
export const SERVER_INFO = { name: SERVER_NAME, version: "2.0.0", icons: [SERVER_ICON] };

export function isTeamLink(member) {
  return member === TEAM_NAME;
}

// A first name only: letters, spaces, hyphen, apostrophe, dot; at most 40
// characters. Anything else is dropped so a log line cannot be forged.
export function cleanWho(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/[^\p{L}\p{M} .'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
}

// The name to record for this call. Only the team link uses "who".
export function authorFor(member, who) {
  if (!isTeamLink(member)) return member;
  const name = cleanWho(who);
  return name ? `${name} (team)` : member;
}

export const TEAM_START_NOTE =
  'This is the shared team link, so at the start of this conversation ask the person for their first name once (say it is only so the activity log shows who did what), remember it, and pass it as "who" on every tool call, together with "summary".';

// ---- Activity log (hf_activity) ------------------------------------------
// One row per tools/call, success or failure. Written fire and forget: a log
// that cannot be written never slows or fails the tool.

export const SUMMARY_MAX = 200;

// What every link is told: pass "summary" on every call. Personal links too.
export const SUMMARY_NOTE =
  'On every tool call, also pass "summary": one line, in the person\'s own words, saying what they asked for (at most 200 characters).';

// Plain one-line text: control characters and line breaks become spaces,
// runs of spaces collapse, and the result is capped.
export function cleanLine(raw, max) {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

// Claude's one-line summary of what the person asked, at most 200 characters.
export function cleanSummary(raw) {
  return cleanLine(raw, SUMMARY_MAX);
}

// The row for one tool call. "who" is kept only on the team link; personal
// links already carry the person's name in member_name.
export function activityRow({ member, tool, args, ok, error }) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  return {
    member_name: cleanLine(String(member ?? ""), 80),
    who: isTeamLink(member) ? (cleanWho(a.who) || null) : null,
    tool: cleanLine(String(tool ?? ""), 60),
    client: cleanLine(a.client, 120) || null,
    summary: cleanSummary(a.summary) || null,
    ok: ok === true,
    error: ok === true ? null : (cleanLine(String(error ?? ""), 300) || "error"),
  };
}

// Whether a tool call that returned normally actually did what was asked.
// Handlers report refusals and failures as text instead of throwing (budget
// refusals, unknown models, bad links, failed jobs), so "did not throw" is not
// success. A reply whose first line opens with one of the connector's own
// refusal phrasings is a failure; for the job and batch tools every line is
// read, so one failed job in a batch marks the call as failed.
export const FAILURE_OPENINGS = [
  "Could not", "Refused", "Unknown ", "Fix these", "That link", "That file",
  "That job_id", "The link must", "The upload failed", "The monthly budget setting",
  "Voice clean-up is not switched on", "The file Auphonic received", "Auphonic is stopping",
  "Higgsfield could not", "Higgsfield blocked", "It failed", "The image was made",
  "This job was canceled", "A worked-out price", "Give ", "Unsupported",
  "No models in", "This recipe runs on", "At most ", "Which client?",
  "The Synchro Brain is not connected", "Skipped:", "Stopped:", "Something went wrong",
  "No guide called", "The filming plan is only",
];
const LINE_TOOLS = new Set(["check_job", "check_video", "check_jobs", "wait_for_job", "run_recipe"]);

export function outcomeOf(tool, text) {
  const body = typeof text === "string" ? text : "";
  const lines = LINE_TOOLS.has(tool) ? body.split("\n") : [body.split("\n")[0]];
  for (const raw of lines) {
    const line = raw.replace(/^\s*\d+\.\s*(\[[^\]]*\]\s*)?/, "").trim();
    if (FAILURE_OPENINGS.some((o) => line.startsWith(o))) return { ok: false, error: line };
  }
  return { ok: true };
}

// Write one row. Whatever the write does (throws, rejects, returns an error),
// this resolves quietly: the log must never break the tool.
export async function logActivity(write, row) {
  try {
    await write(row);
  } catch (_e) {
    // swallowed on purpose
  }
}
