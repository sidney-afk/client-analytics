// studio_action "trial_reels": one finished video becomes a family of versions
// (A as made, plus 2 to 6 with a different text hook), all posted as Instagram
// trial reels; the best one after 24 hours is posted for followers.
// Spec: synchro-pipelines editor-ai/docs/TRIAL_REELS_PLAN.md. The studio's
// tools/trial_reels.py draws and renders; this action gives the steps and keeps
// the log (one row per version in studio_trial_versions). It never posts.
// Plain JavaScript with no Deno parts; index.ts passes the database as deps:
//   deps.insert(rows), deps.list({client, video}), deps.update(id, patch), deps.author

export const STATUSES = ["waiting", "approved", "change asked", "dropped", "on trial", "winner", "lost", "no clear winner"];
const NUMBERS = ["views", "watch_time_s", "shares", "saves", "follows"];
const LETTER_RE = /^[A-G]$/;

export const GUIDE = `Trial reels, step by step (studio_action "trial_reels"). Test client only until Sidney says otherwise.
1. Read the client: client_brain, studio_profile (hook_style, music) and the base rules.
2. Get the finished video (review_notes download) and transcribe it with studio_transcribe.
3. Proven hooks: Sandcastles (top_hooks, search_my_videos on the client's niche) and the client's own best reels (client_brain "Proven hooks"). Not Virlo.
4. Write 6 hooks (B to G), each from a different family of the hook playbook, to work with the video's first spoken line. Save them as hooks.json and run: python <studio>/tools/trial_reels.py checks hooks.json. Answer checks 1-7 in the file; 8-10 are measured. Only hooks that pass go on.
5. SAMPLES FIRST: no hook look saved? trial_reels.py looks, show it, save the pick with studio_profile_save (hook_style). Then trial_reels.py sheet, show the sheet and WAIT for the person's picks.
6. Picks get "pick": true and one other change each ("music": a Music Bank file, with --voice the voice-only mix, or "first_frame": seconds). trial_reels.py render, then pre_send_check.py verify on every file.
7. Log: trial_reels.py rows, then studio_action "trial_reels" {"step": "log", "rows": [...]}. Each rejected hook's reason becomes a rule: the client's (brain_change) or everyone's (feedback_note "FEEDBACK base rule").
8. Frame.io links and the SyncView card versions: not wired yet; share the files as separate links and say so.
After posting, the SMM sets each version with {"step": "update", "id": ..., "status": "on trial"}, and after 24 hours the numbers (views, watch_time_s, shares, saves, follows) and "winner" or "lost".`;

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
  return { row: { client, batch, video, letter, hook, hook_type: text(r.hook_type, 80) || null, other_change: text(r.other_change, 200) || null, status, member: author } };
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
      clean.push(c.row);
    }
    const seen = new Set(clean.map((r) => r.client.toLowerCase() + "|" + r.batch + "|" + r.video + "|" + r.letter));
    if (seen.size !== clean.length) return "Refused, nothing logged: the same letter twice for one video.";
    const res = await deps.insert(clean);
    if (res && res.missing) return "The trial reels log is not switched on yet (its table is waiting to be applied). Nothing logged; keep the rows file and log it later.";
    if (res && res.duplicate) return "Refused, nothing logged: a version with that client, batch, video and letter is already logged. Use step update with its id.";
    return `Logged ${clean.length} version${clean.length === 1 ? "" : "s"} for ${clean[0].client} ${clean[0].batch} video ${clean[0].video}: ${clean.map((r) => r.letter).join(", ")}.`;
  }
  if (step === "list") {
    const client = text(args.client, 81);
    if (!client) return "Give client.";
    const res = await deps.list({ client, batch: args.batch == null ? null : text(args.batch, 81), video: args.video == null ? null : text(args.video, 41) });
    if (res && res.missing) return "The trial reels log is not switched on yet.";
    return res.length ? res.map(show).join("\n") : `No trial versions logged for ${client}${args.video ? " video " + args.video : ""}.`;
  }
  if (step === "update") {
    const id = text(args.id, 60);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return "Give id: the version's id from step list.";
    const patch = {};
    if (args.status != null) {
      const s = text(args.status, 20);
      if (!STATUSES.includes(s)) return `status must be one of: ${STATUSES.join(", ")}.`;
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
