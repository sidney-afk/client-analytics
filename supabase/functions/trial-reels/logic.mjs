// trial-reels: the rules, as plain JavaScript with no Deno parts, so test/trial-reels-logic.js runs them in Node.
// index.ts reads and writes the database and calls these to decide what changes.
// Plan: docs/features/TRIAL_REELS_PLAN.md (approved as #2352). One row per version lives in studio_trial_versions;
// the card's switch in trial_reel_cards. The card's own status is never written here: the page calls today's saves.

export const FLAG_KEY = "trial_reels_pages";
export const LETTERS = ["A", "B", "C", "D", "E", "F", "G"];
// The status words are #2349's. SyncView writes these seven and never "no clear winner".
export const STATUS = Object.freeze({
  waiting: "waiting",
  approved: "approved",
  change: "change asked",
  dropped: "dropped",
  trial: "on trial",
  winner: "winner",
  lost: "lost",
});
export const STAGES = ["smm", "kasper", "client"];
export const TRIAL_MS = 24 * 60 * 60 * 1000;
export const ACTIONS = ["read", "switch_set", "version_link_set", "version_drop", "version_restore", "answer", "trial_start", "winner_set"];
// What a client review link may do. Everything else needs a staff key.
export const CLIENT_ACTIONS = ["read", "answer"];

export const clean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);

/** The page switch: {"clients": [...]} or {"all": true}. Anything else, missing or unreadable, is off. */
export function flagAllows(value, slug) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !slug) return false;
  if (value.all === true) return true;
  const list = Array.isArray(value.clients) ? value.clients : [];
  return list.some((c) => clean(c, 80).toLowerCase() === slug.toLowerCase());
}

/** A version link: an https address, as the card's Video link takes today (permissive: the server checks the shape only). */
export function cleanLink(raw) {
  const s = clean(raw, 2049);
  if (!s) return { link: "" };
  if (s.length > 2048) return { error: "link_too_long" };
  if (!/^https:\/\/[^\s<>"']+$/i.test(s)) return { error: "link_not_https" };
  return { link: s };
}

export const live = (v) => v.status !== STATUS.dropped;
const okField = (stage) => stage + "_ok_at";

/** The version that is the card's one link: the winner once picked, otherwise A. */
export function mainLetter(versions) {
  const w = versions.find((v) => v.status === STATUS.winner);
  return w ? w.letter : "A";
}

/** Has every version that is not dropped got this stage's OK? (At least one version must remain.) */
export function stageDone(versions, stage) {
  const rest = versions.filter(live);
  if (!rest.length) return false;
  if (stage === "client") return rest.every((v) => v.status === STATUS.approved || v.status === STATUS.trial || v.status === STATUS.winner || v.status === STATUS.lost);
  return rest.every((v) => !!v[okField(stage)]);
}

/** The card is Approved once no version is waiting or has a change asked, and at least one is approved (owner, Q4). */
export function cardApprovable(versions) {
  const rest = versions.filter(live);
  return rest.length > 0 && rest.every((v) => v.status === STATUS.approved);
}

/** One reviewer's answer on one version, or on every version still open ("approve_all"). Returns the patches by id. */
export function answerPatches(versions, { stage, kind, letter, note }, now) {
  if (!STAGES.includes(stage)) return { error: "stage_invalid" };
  if (!["approve", "change", "approve_all"].includes(kind)) return { error: "kind_invalid" };
  const open = (v) => live(v) && v.status !== STATUS.change && v.status !== STATUS.trial && v.status !== STATUS.winner && v.status !== STATUS.lost
    && (stage === "client" ? v.status === STATUS.waiting : !v[okField(stage)]);
  let targets;
  if (kind === "approve_all") targets = versions.filter(open);
  else {
    const v = versions.find((x) => x.letter === letter);
    if (!v) return { error: "version_not_found" };
    if (!live(v)) return { error: "version_dropped" };
    if ([STATUS.trial, STATUS.winner, STATUS.lost].includes(v.status)) return { error: "version_on_trial" };
    targets = [v];
  }
  if (!targets.length) return { patches: [] };
  const patches = targets.map((v) => {
    if (kind === "change") {
      const text = clean(note, 4000);
      return { id: v.id, letter: v.letter, from: v.status, patch: { status: STATUS.change, change_by: stage, change_note: text || null, change_at: now } };
    }
    const patch = { [okField(stage)]: now };
    if (stage === "client") patch.status = STATUS.approved;
    return { id: v.id, letter: v.letter, from: v.status, patch };
  });
  if (kind === "change" && !clean(note, 4000)) return { error: "note_required" };
  return { patches };
}

/**
 * A version's Frame.io link (from the card's version row or Production's "Deliverable file · Video X" row).
 * The version that is the card's one link (main) is saved through today's Production attach FIRST; here it is only
 * copied, and only when the card already carries the same link, so the two can never disagree on screen.
 * A new link on a version with a change asked starts it again: revision + 1, the three OKs and the change cleared,
 * back to waiting, so it takes the normal route (SMM, Kasper, then the client; owner, Q3).
 */
export function linkPatch(versions, letter, rawLink, mainLink) {
  const v = versions.find((x) => x.letter === letter);
  if (!v) return { error: "version_not_found" };
  const c = cleanLink(rawLink);
  if (c.error) return { error: c.error };
  if (letter === mainLetter(versions) && c.link !== clean(mainLink, 2048)) return { error: "attach_first" };
  if (c.link === clean(v.frame_url, 2048)) return { patch: null, letter };
  const patch = { frame_url: c.link || null };
  if (v.status === STATUS.change && c.link) {
    Object.assign(patch, {
      revision: (Number(v.revision) || 0) + 1, status: STATUS.waiting,
      smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, change_by: null, change_note: null, change_at: null,
    });
  }
  return { patch, letter, restarted: patch.status === STATUS.waiting };
}

/** Only the team drops a version (owner, Q2), and never one that is out on trial or decided. */
export function dropPatch(versions, letter, restore) {
  const v = versions.find((x) => x.letter === letter);
  if (!v) return { error: "version_not_found" };
  if ([STATUS.trial, STATUS.winner, STATUS.lost].includes(v.status)) return { error: "version_on_trial" };
  if (restore) return v.status === STATUS.dropped ? { patch: { status: STATUS.waiting } } : { patch: null };
  if (letter === mainLetter(versions)) return { error: "main_version" };
  return v.status === STATUS.dropped ? { patch: null } : { patch: { status: STATUS.dropped } };
}

/** The SMM posted the approved versions as trial reels by hand: each goes on trial with its 24 h timer. */
export function trialPatches(versions, nowMs) {
  const ready = versions.filter((v) => v.status === STATUS.approved);
  if (!ready.length) return { error: "nothing_approved" };
  const at = new Date(nowMs).toISOString();
  const ends = new Date(nowMs + TRIAL_MS).toISOString();
  return { patches: ready.map((v) => ({ id: v.id, letter: v.letter, from: v.status, patch: { status: STATUS.trial, posted_at: at, trial_ends_at: ends } })) };
}

/**
 * The SMM picks the winner (staff only). The card's one link must already be the winner's (the page saves it through
 * today's Production attach first), so the card, Production and this log agree.
 */
export function winnerPatches(versions, letter, mainLink) {
  const w = versions.find((x) => x.letter === letter);
  if (!w) return { error: "version_not_found" };
  if (w.status !== STATUS.trial) return { error: "version_not_on_trial" };
  if (!w.frame_url) return { error: "version_has_no_link" };
  if (clean(mainLink, 2048) !== clean(w.frame_url, 2048)) return { error: "attach_first" };
  return {
    patches: versions.filter((v) => v.status === STATUS.trial).map((v) => ({
      id: v.id, letter: v.letter, from: v.status, patch: { status: v.letter === letter ? STATUS.winner : STATUS.lost },
    })),
  };
}

/** What a reader gets back. A client link sees no hook family, no notes from the team, and once a winner is picked only the winner (owner, Q8). */
export function readShape(versions, { client, mainLink, cardStatus }) {
  const sorted = [...versions].sort((a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter));
  const main = mainLetter(sorted);
  const winner = sorted.find((v) => v.status === STATUS.winner);
  const rows = (client ? (winner ? [winner] : sorted.filter((v) => live(v) && v.status !== STATUS.lost)) : sorted).map((v) => {
    const isMain = v.letter === main;
    const base = {
      id: v.id, letter: v.letter, status: v.status, revision: Number(v.revision) || 0, updated_at: v.updated_at || null,
      // For the version on the card, the link shown is the card's own link (file_url, or the card's link with no task).
      frame_url: isMain && clean(mainLink, 2048) ? clean(mainLink, 2048) : (v.frame_url || null),
      on_card: isMain,
      client_ok_at: v.client_ok_at || null,
    };
    if (client) return base;
    return Object.assign(base, {
      hook: v.hook || null, smm_ok_at: v.smm_ok_at || null, kasper_ok_at: v.kasper_ok_at || null,
      change_by: v.change_by || null, change_note: v.change_note || null, change_at: v.change_at || null,
      posted_at: v.posted_at || null, trial_ends_at: v.trial_ends_at || null,
    });
  });
  const mainRow = sorted.find((v) => v.letter === main);
  // Every reader learns when the card can move to Approved, so the page (the client's too) sends today's approve then.
  const out = { versions: rows, main_letter: main, card_approvable: cardApprovable(sorted) };
  if (!client) {
    out.stages_done = { smm: stageDone(sorted, "smm"), kasper: stageDone(sorted, "kasper"), client: stageDone(sorted, "client") };
    // The client stage is done but the card has not moved: the page offers today's approve save again.
    out.card_behind = out.card_approvable && !["Approved", "Scheduled", "Posted"].includes(clean(cardStatus, 40));
    out.main_copy_behind = !!(mainRow && clean(mainLink, 2048) && clean(mainRow.frame_url, 2048) !== clean(mainLink, 2048));
    const ends = sorted.map((v) => v.trial_ends_at).filter(Boolean).sort().pop() || null;
    out.trial_ends_at = ends;
  }
  return out;
}

/** One ledger row per changed version, in calendar_post_events, so the card's history shows "Video C: change asked". */
export function ledgerRows(client, postId, changes, actor, now, action) {
  return changes.map((c) => ({
    client, post_id: postId, ts: now, actor: actor.actor || null, role: actor.role || null,
    action: "trial_" + action, component: "video", from_status: c.from || null, to_status: c.patch && c.patch.status ? c.patch.status : null,
    source: "trial-reels", payload: { letter: c.letter, label: "Video " + c.letter },
  }));
}
