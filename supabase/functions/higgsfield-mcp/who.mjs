// Who made a thing, and what the connector calls itself. Plain JavaScript with
// no Deno parts, so a unit test can run it (index.ts imports it).
//
// The shared team link is the one hf_team_members row whose name is "Team".
// It is recognised by that name, never by its key. On it, brain_change and
// create take an optional "who" (a first name) so the log says
// "<who> (team)". Personal links ignore "who" and keep their own name.

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
  'This is the shared team link, so ask the person for their first name once in this conversation (say it is only so the log shows who made what), remember it, and pass it as "who" on every brain_change, create and run_recipe call.';
