// The filming pipeline's own calls over a pass (item 1, PR 2): the per-client
// file store, the batch counter, feedback notes and the brain snapshot. Plain
// JavaScript with no Deno parts, so a unit test can run every rule offline;
// index.ts passes in the database, GitHub and Storage calls as deps.
//
//   files.get      { name? }                         one file, or all of the pass's client's files
//   files.save     { name, expected_version, body }  through fp_file_save; a stale version is refused
//   batch.take     {}                                fp_take_batch for the pass's client
//   notes.add      { title, body, source, follows? } a note in fp_feedback_notes
//   brain.snapshot { have_commit? }                  the Synchro Brain at main, as a signed zip link,
//                                                    inputs/ cut to inputs/drive/ (see dropFromSnapshot)
//
// Who may save what. Any pass saves the files in OPEN_FILES (and
// filming_plans/*.md). The files in ADMIN_FILES need a pass made on a personal
// connector link whose member is on the publish list (fp_publishers) AND in
// the fp_settings key "file_admins" (a JSON list of member names, read on
// every call; no name is written in code).
//
// Every answer is { status, body } with body plain JSON: ok true, or ok false
// with a plain-English error. A stale save is not an error: it answers
// ok true, saved false and the current version, so the pipeline can re-read.

export const STORE_ACTIONS = new Set(["files.get", "files.save", "batch.take", "notes.add", "brain.snapshot"]);

export const OPEN_FILES = new Set(["ideas.json", "references.json", "own_performance.json"]);
export const ADMIN_FILES = new Set(["config.json", "plan_voice.json", "brief.md", "backlog.json", "plan_doc.json", "style_card.json"]);
// filming_plans/<name>.md, one level deep, no "..".
export const PLAN_FILE_RE = /^filming_plans\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.md$/;
export const BODY_MAX = 2_000_000;
export const ADMINS_KEY = "file_admins";

export const NOTE_SOURCES = ["chat", "sheet"];
export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 20_000;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMMIT_RE = /^[0-9a-f]{40}$/;
export const SNAPSHOT_BUCKET = "brain-snapshots";
export const SNAPSHOT_LINK_SECONDS = 600;
// The cached object's name carries the rule it was built under, so a zip built
// under another rule (the earlier no-money-1 build) is never handed out.
export const SNAPSHOT_FORMAT = "inputs-drive-plus-summaries-1";
export const snapshotName = (commit) => `${commit}.${SNAPSHOT_FORMAT}.zip`;
// What the snapshot holds (owner's decisions, 2026-10-17): the whole brain,
// money.md and history.md included (the pipeline's money guard reads each
// client's figures from money.md to keep them out of every Sheet and Doc; only
// the people on the filming plan list get a pass), but under any folder named
// inputs/ (at any depth) only inputs/drive/ is kept, plus the pipeline's four
// named per-client summaries (SNAPSHOT_KEEP below): the raw transcripts and chat
// text stay out, but the summaries the pipeline names in each client's config
// (competitor research, own top videos, finished videos, captions) are not raw
// text, and a batch that lacks them runs without its reference lane.
export const SNAPSHOT_KEEP = [
  ["research", "competitor-research"],
  ["research", "own-top-videos"],
  ["video", "finished-videos"],
  ["published", "instagram-captions"],
];
export function dropFromSnapshot(name) {
  const parts = String(name).split("/");
  const at = parts.findIndex((p) => p.toLowerCase() === "inputs");
  if (at < 0) return false;
  const next = parts[at + 1];
  if (next === undefined || next === "") return false;
  if (next.toLowerCase() === "drive") return false;
  const file = (parts[at + 2] ?? "").toLowerCase();
  const direct = parts.length === at + 3;
  if (direct && file.endsWith(".md") && SNAPSHOT_KEEP.some(([dir, frag]) => next.toLowerCase() === dir && file.includes(frag))) return false;
  return true;
}

const str = (v) => (typeof v === "string" ? v.trim() : "");
const answer = (body, status = 200) => ({ status, body });
const no = (error, status = 403) => answer({ ok: false, error }, status);

// "open", "admin" or null (not a pipeline file).
export function fileKind(name) {
  const n = str(name);
  if (n.includes("..")) return null;
  if (OPEN_FILES.has(n) || PLAN_FILE_RE.test(n)) return "open";
  if (ADMIN_FILES.has(n)) return "admin";
  return null;
}

// The file_admins setting as a list of names: a JSON list, or { members: [...] }.
// Anything else is an empty list (nobody), never an error that lets someone in.
export function parseAdmins(value) {
  let v = value;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch (_e) { return []; }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) v = v.members;
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
}

// May this pass save this file? pass: { member, via }.
export function maySave(name, pass, { isPublisher, admins }) {
  const kind = fileKind(name);
  if (!kind) {
    return { ok: false, status: 400, error: `"${String(name).slice(0, 120)}" is not a pipeline file. Files: ${[...OPEN_FILES, ...ADMIN_FILES].join(", ")} and filming_plans/<name>.md.` };
  }
  if (kind === "open") return { ok: true, kind };
  const member = str(pass && pass.member);
  const allowed = pass && pass.via === "personal" && isPublisher === true && parseAdmins(admins).includes(member);
  if (allowed) return { ok: true, kind };
  return {
    ok: false,
    status: 403,
    error: `Refused: only the account owner saves ${name} (it needs a pass from a personal connector link on the publish list and in the file_admins setting). Ask them to make this change.`,
  };
}

// A .json file must hold valid JSON, so a bad save cannot break a pass's file
// list (config.json) or the pipeline's next read.
export function checkBody(name, body) {
  if (typeof body !== "string") return "body must be the file's text (a string). For a .json file, send the JSON as text.";
  if (body.length > BODY_MAX) return `body is too long (${body.length} characters; the most is ${BODY_MAX}).`;
  if (str(name).endsWith(".json")) {
    try { JSON.parse(body); } catch (_e) { return `${name} must hold valid JSON; this body does not parse.`; }
  }
  return "";
}

export function checkVersion(v) {
  return Number.isInteger(v) && v >= 0 && v <= 2_147_483_647;
}

// A note from the pipeline (sheet) or a chat. Answers { ok, row } or { ok: false, error }.
export function noteRow({ title, body, source, follows }, { member, client }) {
  const t = str(title), b = str(body), s = str(source).toLowerCase(), f = str(follows);
  if (!t) return { ok: false, error: "Give the note a title." };
  if (t.length > NOTE_TITLE_MAX) return { ok: false, error: `The title is too long (the most is ${NOTE_TITLE_MAX} characters).` };
  if (!b) return { ok: false, error: "Give the note a body." };
  if (b.length > NOTE_BODY_MAX) return { ok: false, error: `The body is too long (the most is ${NOTE_BODY_MAX} characters); split it into two notes.` };
  if (!NOTE_SOURCES.includes(s)) return { ok: false, error: 'source must be "chat" or "sheet".' };
  if (f && !UUID_RE.test(f)) return { ok: false, error: "follows must be the id of an earlier note." };
  const m = str(member);
  if (!m) return { ok: false, error: "No member name to file the note under." };
  return { ok: true, row: { client_slug: client || null, title: t, body: b, source: s, follows: f ? f.toLowerCase() : null, member: m.slice(0, 80) } };
}

// One action for a pass that is already let in. pass: { member, via, client_slug }.
// deps (each may throw; the answer then says what could not be done):
//   getFiles(client, name|null)        -> [{ name, version, body, updated_by, updated_at }]
//   saveFile(client, name, v, body, m) -> { saved, new_version, current_version }
//   isPublisher(member)                -> boolean
//   setting(key)                       -> value or null
//   takeBatch(client)                  -> integer
//   noteExists(id)                     -> boolean
//   addNote(row)                       -> { id, created_at }
//   brainHead()                        -> commit sha (40 hex)
//   snapshotSize(commit)               -> bytes, or null when not cached yet
//   snapshotFetch(commit)              -> Uint8Array (the GitHub zipball)
//   snapshotStore(commit, bytes)       -> void
//   snapshotSign(commit, seconds)      -> https link
export async function storeAction(action, b, pass, deps) {
  const body = b && typeof b === "object" && !Array.isArray(b) ? b : {};
  const client = String(pass.client_slug);
  try {
    switch (action) {
      case "files.get": {
        const name = str(body.name);
        if (name && !fileKind(name)) return no(`"${name.slice(0, 120)}" is not a pipeline file.`, 400);
        const rows = await deps.getFiles(client, name || null);
        const files = rows.map((r) => ({ name: r.name, version: r.version, body: r.body, updated_by: r.updated_by, updated_at: r.updated_at }));
        if (!name) return answer({ ok: true, files });
        if (!files.length) return answer({ ok: false, error: `${name} has not been saved for this client yet. Save it with expected_version 0.`, version: 0 }, 404);
        return answer({ ok: true, file: files[0] });
      }
      case "files.save": {
        const name = str(body.name);
        const v = body.expected_version;
        const rule = maySave(name, pass, {
          isPublisher: fileKind(name) === "admin" && pass.via === "personal" ? await deps.isPublisher(String(pass.member)) : false,
          admins: fileKind(name) === "admin" ? await deps.setting(ADMINS_KEY) : null,
        });
        if (!rule.ok) return no(rule.error, rule.status);
        if (!checkVersion(v)) return no("expected_version must be the version you read (a whole number; 0 for a new file).", 400);
        const bad = checkBody(name, body.body);
        if (bad) return no(bad, 400);
        const r = await deps.saveFile(client, name, v, body.body, String(pass.member));
        if (r && r.saved) return answer({ ok: true, saved: true, name, version: r.new_version });
        const current = r ? Number(r.current_version) || 0 : 0;
        return answer({
          ok: true,
          saved: false,
          name,
          version: current,
          message: `Not saved: ${name} is at version ${current}, not ${v}. Someone saved it since you read it; read it again (files.get) and redo the change.`,
        });
      }
      case "batch.take": {
        const n = await deps.takeBatch(client);
        if (!Number.isInteger(n) || n < 1) return no("Could not take a batch number.", 503);
        return answer({ ok: true, batch: n });
      }
      case "notes.add": {
        const made = noteRow(body, { member: pass.member, client });
        if (!made.ok) return no(made.error, 400);
        if (made.row.follows && !(await deps.noteExists(made.row.follows))) return no("follows names a note that does not exist.", 400);
        const saved = await deps.addNote(made.row);
        return answer({ ok: true, id: saved.id, created_at: saved.created_at });
      }
      case "brain.snapshot": {
        const have = str(body.have_commit).toLowerCase();
        const commit = str(await deps.brainHead()).toLowerCase();
        if (!COMMIT_RE.test(commit)) return no("Could not read the Synchro Brain's current commit.", 502);
        if (have && have === commit) return answer({ ok: true, unchanged: true, commit });
        let bytes = await deps.snapshotSize(commit);
        if (bytes === null || bytes === undefined) {
          const zip = repackZip(await deps.snapshotFetch(commit)).zip;
          await deps.snapshotStore(commit, zip);
          bytes = zip.byteLength;
        }
        const url = await deps.snapshotSign(commit, SNAPSHOT_LINK_SECONDS);
        if (typeof url !== "string" || !/^https:\/\//.test(url)) return no("Could not make a download link for the brain snapshot.", 502);
        return answer({ ok: true, unchanged: false, commit, download_url: url, bytes, expires: "in about 10 minutes" });
      }
      default:
        return no(`The action ${JSON.stringify(action)} is not a file store action.`, 400);
    }
  } catch (e) {
    const why = String((e && e.message) || e || "unknown error").replace(/\s+/g, " ").slice(0, 200);
    return no(`Could not do ${action} (${why}). Try again in a minute; if it keeps failing, tell the Connector supervisor.`, 503);
  }
}

// A copy of a zip without the entries drop(name) picks (dropFromSnapshot by default).
// Nothing is unpacked: each kept entry's bytes (local header, compressed data
// and any data descriptor) are copied as they are, and the central directory
// is rebuilt with the new offsets. Refuses Zip64 and anything it cannot read,
// so a zip it does not understand is never handed out half-filtered.
// Answers { zip: Uint8Array, kept, dropped } (counts of entries).
export function repackZip(input, drop = dropFromSnapshot) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const bad = (why) => new Error("the brain zip could not be read (" + why + ")");
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad("no end record");
  if (eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) throw bad("Zip64 is not supported");
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  const commentLen = dv.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLen > u8.length) throw bad("cut off");
  if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 8, true) !== count) throw bad("split archives are not supported");
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw bad("Zip64 is not supported");
  if (cdOff + cdSize > eocd) throw bad("central directory out of range");
  const names = new TextDecoder();
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== 0x02014b50) throw bad("central entry " + i);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), noteLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    if (dv.getUint32(p + 20, true) === 0xffffffff || localOff === 0xffffffff) throw bad("Zip64 is not supported");
    if (localOff + 30 > cdOff || dv.getUint32(localOff, true) !== 0x04034b50) throw bad("local entry " + i);
    const len = 46 + nameLen + extraLen + noteLen;
    entries.push({ at: p, len, localOff, name: names.decode(u8.subarray(p + 46, p + 46 + nameLen)) });
    p += len;
  }
  if (p !== cdOff + cdSize) throw bad("central directory size");
  const byOffset = [...entries].sort((a, b) => a.localOff - b.localOff);
  byOffset.forEach((e, i) => { e.end = i + 1 < byOffset.length ? byOffset[i + 1].localOff : cdOff; });
  const kept = entries.filter((e) => !drop(e.name));
  const keptByOffset = byOffset.filter((e) => kept.includes(e));
  const bodySize = keptByOffset.reduce((n, e) => n + (e.end - e.localOff), 0);
  const centralSize = kept.reduce((n, e) => n + e.len, 0);
  const out = new Uint8Array(bodySize + centralSize + 22 + commentLen);
  const ov = new DataView(out.buffer);
  let w = 0;
  for (const e of keptByOffset) {
    e.newOff = w;
    out.set(u8.subarray(e.localOff, e.end), w);
    w += e.end - e.localOff;
  }
  const newCd = w;
  for (const e of kept) {
    out.set(u8.subarray(e.at, e.at + e.len), w);
    ov.setUint32(w + 42, e.newOff, true);
    w += e.len;
  }
  out.set(u8.subarray(eocd, eocd + 22 + commentLen), w);
  ov.setUint16(w + 8, kept.length, true);
  ov.setUint16(w + 10, kept.length, true);
  ov.setUint32(w + 12, centralSize, true);
  ov.setUint32(w + 16, newCd, true);
  return { zip: out, kept: kept.length, dropped: entries.length - kept.length };
}

// A client's name in the file store and on a pass. SyncView's client_slug is
// used as it is when it is already letters, digits and hyphens (every client
// so far, so nothing moves); anything else is lowercased, "&" read as "and",
// and every other character dropped ("a&b" -> "aandb").
export function storeSlug(slug) {
  const s = String(slug ?? "");
  if (/^[a-z0-9][a-z0-9-]{0,79}$/.test(s)) return s;
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9-]/g, "").replace(/^-+/, "").slice(0, 80);
}
