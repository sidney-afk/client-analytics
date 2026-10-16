// The "Synchro video studio" download, served by the connector's
// "studio_latest" tool. Plain JavaScript with no Deno parts, so a unit test can
// run it (index.ts imports it and passes in the storage reads and the log).
//
// The zips live in the PRIVATE Supabase Storage bucket "studio": one
// synchro-video-studio-<version>.zip per version, plus a small latest.json
// ({"version": "...", "file": "...", "notes": "..."}) naming the current one.
// Sidney uploads both in the dashboard; the connector only reads. Every call is
// logged in hf_studio_downloads (who, when, which version was given out), so
// the team can see who is on which version.

export const STUDIO_BUCKET = "studio";
export const LATEST_FILE = "latest.json";
// A signed link is valid about 10 minutes.
export const LINK_SECONDS = 600;

export const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;
export const NOTES_MAX = 2000;

export const NO_VERSION =
  "No studio version uploaded yet. Ask the account owner to upload the studio zip and latest.json to the studio bucket.";

// The file must be the zip for that exact version, at the top of the bucket.
export function studioFileFor(version) {
  return `synchro-video-studio-${version}.zip`;
}

// latest.json as text in, either { version, file, notes } or { error }.
export function parseLatest(text) {
  let j;
  try {
    j = JSON.parse(String(text ?? ""));
  } catch (_e) {
    return { error: "latest.json is not valid JSON" };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { error: "latest.json is not an object" };
  const version = typeof j.version === "string" ? j.version.trim() : "";
  if (!VERSION_RE.test(version)) return { error: "latest.json has no valid version" };
  const file = typeof j.file === "string" && j.file.trim() ? j.file.trim() : studioFileFor(version);
  if (file !== studioFileFor(version)) return { error: `latest.json names "${file.slice(0, 80)}", expected ${studioFileFor(version)}` };
  const notes = typeof j.notes === "string" ? j.notes.trim().slice(0, NOTES_MAX) : "";
  return { version, file, notes };
}

// The log row for one call. version and file are null when nothing was given out.
export function downloadRow({ member, who, version, file }) {
  return {
    member_name: String(member ?? "").slice(0, 80),
    who: who ? String(who).slice(0, 40) : null,
    version: version || null,
    file: file || null,
  };
}

// The whole tool. deps:
//   exists(name)            -> Promise<boolean>   (is that object in the bucket?)
//   readText(name)          -> Promise<string>
//   sign(name, seconds)     -> Promise<string>    (a signed download link)
//   log(row)                -> void               (fire and forget; never awaited for the answer)
// Any dep may throw; the reply then starts with "Could not", which the
// activity log reads as a failure.
export async function studioLatest(deps, { member, who }) {
  const say = (text, version, file) => {
    try {
      deps.log(downloadRow({ member, who, version, file }));
    } catch (_e) {
      // the log must never break the tool
    }
    return text;
  };
  let present;
  try {
    present = await deps.exists(LATEST_FILE);
  } catch (e) {
    return say(`Could not read the studio bucket (${errText(e)}). Try again in a minute; if it keeps failing, tell the account owner.`);
  }
  if (!present) return say(NO_VERSION);
  let latest;
  try {
    latest = parseLatest(await deps.readText(LATEST_FILE));
  } catch (e) {
    return say(`Could not read latest.json (${errText(e)}). Tell the account owner.`);
  }
  if (latest.error) return say(`Could not use latest.json: ${latest.error}. Tell the account owner.`);
  let url;
  try {
    url = await deps.sign(latest.file, LINK_SECONDS);
  } catch (e) {
    return say(`Could not make a download link for ${latest.file} (${errText(e)}). Tell the account owner the file may be missing from the studio bucket.`);
  }
  if (typeof url !== "string" || !/^https:\/\//.test(url)) {
    return say(`Could not make a download link for ${latest.file}. Tell the account owner.`);
  }
  const body = { version: latest.version, download_url: url, notes: latest.notes, expires: "in about 10 minutes" };
  return say(JSON.stringify(body), latest.version, latest.file);
}

function errText(e) {
  return String((e && e.message) || e || "unknown error").replace(/\s+/g, " ").slice(0, 200);
}
