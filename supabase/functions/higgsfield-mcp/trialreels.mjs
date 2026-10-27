// studio_action "trial_reels": one finished video becomes a family of versions
// (A as made, plus 2 to 6 with a different text hook), all posted as Instagram
// trial reels; the best one after 24 hours is posted for followers.
// Spec: synchro-pipelines editor-ai/docs/TRIAL_REELS_PLAN.md. The studio's
// tools/trial_reels.py draws and renders; this action gives the steps and keeps
// the log (one row per version in studio_trial_versions). It never posts.
// Plain JavaScript with no Deno parts; index.ts passes the database as deps:
//   deps.insert(rows), deps.list({client, batch, video}), deps.get(id), deps.find({client, batch, video, letter}),
//   deps.update(id, patch), deps.author
// insert drops post_id and deliverable_id itself when those columns are not there yet (SyncView adds them).

export const STATUSES = ["waiting", "approved", "change asked", "dropped", "on trial", "winner", "lost", "no clear winner"];
const NUMBERS = ["views", "watch_time_s", "shares", "saves", "follows"];
const LETTER_RE = /^[A-G]$/;
// Test client only until Sidney says otherwise (2026-10-26).
export const TEST_CLIENT_RE = /^sidney[\s_-]*laruel$/i;
const TEST_ONLY = "Refused: trial reels run only on the test client until Sidney says otherwise.";
// Once a version is on a SyncView card (post_id), approving, change requests and dropping belong to SyncView.
const CARD_OWNED = ["approved", "change asked", "dropped", "waiting", "no clear winner"];

export const GUIDE = `Trial reels, step by step (studio_action "trial_reels"). Test client only until Sidney says otherwise.
1. Read the client: client_brain, studio_profile (hook_style, music) and the base rules.
2. Get the video BEFORE its hook is added (review_notes download) and transcribe it with studio_transcribe. A finished video that already has a hook: pass --cover x,y,w,h to render so the new hook replaces it.
3. Proven hooks: Sandcastles (top_hooks, search_my_videos on the client's niche) and the client's own best reels (client_brain "Proven hooks"). Not Virlo.
4. Write 6 hooks (B to G), each from a different family of the hook playbook. Save them as hooks.json and run: python <studio>/tools/trial_reels.py checks hooks.json. Answer checks 1-7 in the file; 8-10 are measured. Only hooks that pass go on.
5. SAMPLES FIRST: no hook look saved? trial_reels.py looks, show it, save the pick with studio_profile_save (hook_style). Then trial_reels.py sheet, show the sheet and WAIT for the person's picks.
6. Picks get "pick": true and one other change each ("music": a Music Bank file, with --voice the voice-only mix, or "first_frame": seconds). trial_reels.py render (the hook stays the whole video), then pre_send_check.py check with --base (a version's own *_base.mp4 when listed) and verify on every file.
7. Log: trial_reels.py rows, add post_id and deliverable_id from review_notes when the video has a card, then studio_action "trial_reels" {"step": "log", "rows": [...]}. A new cut of a version after a change was asked: the same row with "replace": true. Each rejected hook's reason becomes a rule: the client's (brain_change) or everyone's (feedback_note "FEEDBACK base rule").
8. Whoever uploads to Frame.io pastes the links on the SyncView card; approvals and change requests happen on the card. The studio never writes links or approvals.
After posting, the SMM sets each version to "on trial", and after 24 hours picks the winner: "winner" for one, "lost" for the rest. No numbers are needed.`;

const text = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const int = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : NaN);

export function cleanRow(r, author) {
  const batch = text(r.batch, 81);
  if (!batch || batch.length > 80) return { error: "each row needs batch (the batch name or date, as review_notes shows it), since video numbers repeat across batches" };
  const client = text(r.client, 81), video = text(r.video, 41), letter = text(r.letter, 2).toUpperCase();
  if (!client || client.length > 80) return { error: "each row needs client (up to 80 characters)" };
  if (!video || video.length > 40) return { error: "each row needs video (its number)" };
  if (!LETTER_RE.test(letter)) return { error: `letter "${letter}" must be A to G` };
  const hook = r.hook == null ? null : text(r.hook, 301);
  if (letter !== "A" && !hook) return { error: `version ${letter} needs its hook` };
  if (hook && hook.length > 300) return { error: `version ${letter}: hook is over 300 characters` };
  const status = text(r.status || "waiting", 20);
  if (!STATUSES.includes(status)) return { error: `status "${status}" is not one of: ${STATUSES.join(", ")}` };
  if (!TEST_CLIENT_RE.test(client)) return { error: TEST_ONLY.replace("Refused: ", "") };
  const ids = {};
  if (r.post_id != null && text(r.post_id, 121)) ids.post_id = text(r.post_id, 120);
  if (r.deliverable_id != null) {
    const d = text(r.deliverable_id, 60);
    if (!/^[0-9a-f-]{36}$/i.test(d)) return { error: `version ${letter}: deliverable_id is not an id` };
    ids.deliverable_id = d;
  }
  return { replace: r.replace === true, row: { ...ids, client, batch, video, letter, hook, hook_type: text(r.hook_type, 80) || null, other_change: text(r.other_change, 200) || null, status, member: author } };
}

function show(r) {
  const nums = NUMBERS.filter((k) => r[k] != null).map((k) => `${k.replace("_s", "")} ${r[k]}`).join(", ");
  return `${r.batch ? r.batch + " " : ""}${r.video}${r.letter} [${r.status}] ${r.hook ? `"${r.hook}"` : "(as made)"}${r.other_change ? ` + ${r.other_change}` : ""}${nums ? ` | ${nums}` : ""} (id ${r.id})`;
}

export async function trialReels(deps, args) {
  const step = text(args.step || "guide", 20).toLowerCase();
  if (step === "guide") return GUIDE;
  if (step === "log") {
    const rows = Array.isArray(args.rows) ? args.rows : [];
    if (!rows.length || rows.length > 7) return "Give rows: 1 to 7 versions (the output of trial_reels.py rows).";
    const clean = [];
    for (const r of rows) {
      const c = cleanRow(r || {}, deps.author);
      if (c.error) return "Refused, nothing logged: " + c.error + ".";
      clean.push(c.replace ? { ...c.row, __replace: true } : c.row);
    }
    const seen = new Set(clean.map((r) => r.client.toLowerCase() + "|" + r.batch + "|" + r.video + "|" + r.letter));
    if (seen.size !== clean.length) return "Refused, nothing logged: the same letter twice for one video.";
    const swaps = [];
    for (const r of clean.filter((x) => x.__replace)) {
      const have = await deps.find({ client: r.client, batch: r.batch, video: r.video, letter: r.letter });
      if (have && have.missing) return "The trial reels log is not switched on yet (its table is waiting to be applied). Nothing logged.";
      if (!have) return `Refused, nothing logged: version ${r.letter} to replace is not logged yet; log it without replace.`;
      if (have.status !== "change asked") return `Refused, nothing logged: version ${r.letter} is "${have.status}"; a new cut replaces a version only after a change was asked.`;
      swaps.push({ id: have.id, patch: { hook: r.hook, hook_type: r.hook_type, other_change: r.other_change, updated_at: new Date().toISOString() } });
    }
    for (const sw of swaps) await deps.update(sw.id, sw.patch);
    const fresh = clean.filter((x) => !x.__replace).map(({ __replace, ...r }) => r);
    if (!fresh.length) return `Replaced ${swaps.length} version${swaps.length === 1 ? "" : "s"} after a change was asked: ${clean.map((r) => r.letter).join(", ")}.`;
    const res = await deps.insert(fresh);
    if (res && res.missing) return "The trial reels log is not switched on yet (its table is waiting to be applied). Nothing logged; keep the rows file and log it later.";
    if (res && res.duplicate) return "Refused, nothing logged: a version with that client, batch, video and letter is already logged. Use step update with its id.";
    return `Logged ${fresh.length} version${fresh.length === 1 ? "" : "s"} for ${fresh[0].client} ${fresh[0].batch} video ${fresh[0].video}: ${fresh.map((r) => r.letter).join(", ")}${swaps.length ? `; replaced ${swaps.length}` : ""}.`;
  }
  if (step === "list") {
    const client = text(args.client, 81);
    if (!client) return "Give client.";
    if (!TEST_CLIENT_RE.test(client)) return TEST_ONLY;
    const res = await deps.list({ client, batch: args.batch == null ? null : text(args.batch, 81), video: args.video == null ? null : text(args.video, 41) });
    if (res && res.missing) return "The trial reels log is not switched on yet.";
    return res.length ? res.map(show).join("\n") : `No trial versions logged for ${client}${args.video ? " video " + args.video : ""}.`;
  }
  if (step === "update") {
    const id = text(args.id, 60);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return "Give id: the version's id from step list.";
    const row = await deps.get(id);
    if (row && row.missing) return "The trial reels log is not switched on yet.";
    if (!row) return "No trial version with that id.";
    if (!TEST_CLIENT_RE.test(String(row.client))) return TEST_ONLY;
    const patch = {};
    if (args.status != null) {
      const s = text(args.status, 20);
      if (!STATUSES.includes(s)) return `status must be one of: ${STATUSES.join(", ")}.`;
      if (row.post_id && CARD_OWNED.includes(s)) return `Refused: version ${row.letter} is on a SyncView card, so "${s}" is set on the card, not here. The studio sets only on trial, winner and lost.`;
      patch.status = s;
      if (s === "on trial") patch.posted_at = new Date().toISOString();
    }
    for (const k of NUMBERS) if (args[k] != null) {
      const n = int(args[k]);
      if (Number.isNaN(n)) return `${k} must be a whole number of 0 or more.`;
      patch[k] = n;
    }
    if (!Object.keys(patch).length) return "Give what changed: status, or the 24 hour numbers (" + NUMBERS.join(", ") + ").";
    patch.updated_at = new Date().toISOString();
    const r = await deps.update(id, patch);
    if (r && r.missing) return "The trial reels log is not switched on yet.";
    return r ? "Updated: " + show(r) : "No trial version with that id.";
  }
  return `Unknown step "${step}". Steps: guide, log, list, update.`;
}
