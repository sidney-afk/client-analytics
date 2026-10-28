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
export const ACTIONS = ["list", "read", "switch_set", "version_link_set", "version_drop", "version_restore", "version_new_cut", "version_add", "answer", "trial_start", "winner_set", "winner_undo"];
// What a client review link may do. Everything else needs a staff key.
export const CLIENT_ACTIONS = ["list", "read", "answer"];

export const clean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);

/*
 * What each staff key may do. Admin and SMM keys: everything. A creative key (an editor): only paste a version's link,
 * since whoever uploads a version to Frame.io pastes its link (Q9). The automation key: read only.
 */
export function staffAllows(role, action) {
  if (action === "list" || action === "read") return true;
  const r = clean(role, 20).toLowerCase();
  if (r === "admin" || r === "smm") return true;
  // An editor pastes a version's link and says its new cut is ready; everything else is the SMM's or an admin's.
  return r === "creative" && (action === "version_link_set" || action === "version_new_cut" || action === "version_add");
}

/** An ILIKE pattern that matches exactly this text, case aside: `_` and `%` are wildcards in ILIKE, and slugs carry `_`. */
export const likeExact = (text) => String(text).replace(/[\\%_]/g, "\\$&");

/*
 * The card's video sub-issue id as studio_trial_versions.deliverable_id takes it: that column is a uuid, while the
 * card names its sub-issue "del_<uuid>" (found live, 2026-10-27: version_add answered write_failed on every card with
 * a sub-issue). The uuid part, as the studio's log stores it, or null when there is none.
 */
export function deliverableUuid(id) {
  const s = clean(id, 80).replace(/^del_/i, "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s.toLowerCase() : null;
}

/** The page switch: {"clients": [...]} or {"all": true}. Anything else, missing or unreadable, is off. */
export function flagAllows(value, slug) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !slug) return false;
  if (value.all === true) return true;
  const list = Array.isArray(value.clients) ? value.clients : [];
  return list.some((c) => clean(c, 80).toLowerCase() === slug.toLowerCase());
}

/*
 * Where a version's link may point: the providers today's Production attach takes for a Deliverable file (Frame.io,
 * Google Drive, Dropbox; production-write/policy.mjs assetUrlType), so a version that wins can always become the
 * card's one link. A Google Doc is a brief, not a video, and stays out, as it does there.
 */
export const LINK_HOSTS = ["frame.io", "app.frame.io", "next.frame.io", "f.io", "drive.google.com", "dropbox.com", "www.dropbox.com"];
// Where the sharing check may follow a redirect: the providers above and their own file hosts (as production-write's probe).
const PROBE_REDIRECT_HOSTS = ["drive.usercontent.google.com", "dl.dropboxusercontent.com", "storage.googleapis.com"];
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/\.$/, ""); } catch (_e) { return ""; } };

/** A version link: an https address on one of the providers above, with no credential in it. */
export function cleanLink(raw) {
  const s = clean(raw, 2049);
  if (!s) return { link: "" };
  if (s.length > 2048) return { error: "link_too_long" };
  if (!/^https:\/\/[^\s<>"']+$/i.test(s)) return { error: "link_not_https" };
  let u;
  try { u = new URL(s); } catch (_e) { return { error: "link_not_https" }; }
  if (u.username || u.password || !LINK_HOSTS.includes(hostOf(s)) || u.pathname === "/") return { error: "link_host_unsupported" };
  return { link: s };
}

/** May the sharing check open this address (the first request, or a redirect it was sent)? */
export function probeHostAllowed(url) {
  if (!/^https:\/\//i.test(String(url || ""))) return false;
  const h = hostOf(url);
  return LINK_HOSTS.includes(h) || PROBE_REDIRECT_HOSTS.includes(h) || h.endsWith(".googleusercontent.com");
}

/** The address the check opens: a Drive file's download URL and a Dropbox share's raw URL, as production-write's assetProbeUrl. */
export function probeUrl(raw) {
  const url = new URL(raw);
  const host = hostOf(raw);
  if (host === "drive.google.com") {
    const id = (url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/i) || [])[1] || url.searchParams.get("id");
    if (id) {
      const p = new URL("https://drive.google.com/uc");
      p.searchParams.set("export", "download");
      p.searchParams.set("id", id);
      const key = url.searchParams.get("resourcekey");
      if (key) p.searchParams.set("resourcekey", key);
      return p.toString();
    }
  }
  if (host === "dropbox.com" || host === "www.dropbox.com") {
    url.searchParams.delete("dl");
    url.searchParams.set("raw", "1");
  }
  return url.toString();
}

/*
 * The sharing check's verdict, the same rule as production-write's providerEvidenceState (a copy: that probe lives
 * inside a Section 4 function and cannot move to _shared without changing it). A live provider page is enough
 * (owner ruling 2026-08-16: Frame.io never serves the video's bytes at a share link), unless it is a sign-in or
 * request-access wall. The words are Production's own: available, permission_denied, expired, unavailable.
 */
export function probeVerdict({ status, contentType, disposition, sample }) {
  if (status === 401 || status === 403) return "permission_denied";
  if (status === 404 || status === 410) return "expired";
  if (!(status >= 200 && status < 300)) return "unavailable";
  const type = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (String(disposition || "").toLowerCase().includes("attachment") || /^(?:image|video|audio)\//.test(type)
      || /^application\/(?:pdf|octet-stream|zip|vnd[.])/.test(type)) return "available";
  if (type !== "text/html" && type !== "application/xhtml+xml") return "unavailable";
  const body = String(sample || "").toLowerCase();
  if (!body) return "unavailable";
  if (/accounts[.]google[.]com|servicelogin|request access|access denied|permission denied|not authorized|(?:sign|log)[ -]?in|type\s*=\s*["']password["']/i.test(body)) {
    return "permission_denied";
  }
  return "available";
}

export const live = (v) => v.status !== STATUS.dropped;
/*
 * The client's "Not this one" (owner, 2026-10-28): client_pass_at on the version, its status left as it was. A passed
 * version is not waiting for anyone: the client stage, the card's Approved and the trial count without it, and the team
 * drops it (only the team drops, Q2, so the card's link never moves for the client). Cleared by a new cut, a new link,
 * Bring back, or the client's own approve. A row with no pass never names the column, so every other write works
 * before the migration that adds it is applied.
 */
export const passed = (v) => !!v.client_pass_at;
const counted = (v) => live(v) && !passed(v);
const clearPass = (v) => (passed(v) ? { client_pass_at: null } : {});

/*
 * One row per letter. Two writers add rows: the AI editor's studio log, keyed by its batch and video number, and
 * SyncView's version_add, keyed by the card's id and "card". Both key rows by (client, batch, video, letter), so a
 * card switched on before the studio logged it can end up with two "Video A" rows (Codex on PR 2373). Every read
 * keeps the earliest written for each letter (then the smaller id), so each letter names one version; the other row
 * is never read or written here.
 */
export function oneRowPerLetter(rows) {
  const keep = new Map();
  for (const r of rows || []) {
    const was = keep.get(r.letter);
    const key = (x) => String(x.created_at || "9999") + "|" + String(x.id || "");
    if (!was || key(r) < key(was)) keep.set(r.letter, r);
  }
  return [...keep.values()];
}

/*
 * A version added from SyncView (2026-10-27, found live): until now a card listed only the rows the AI editor's studio
 * log writes, so a card it had not logged showed no versions and nowhere to paste a link. The next free letter, A to
 * G, with its link. The first live version is the one on the card, so its link must already be the card's (the page
 * saves the card's link first, as it does for Video A). Never once the trial has started.
 */
export function addVersion(versions, rawLink, mainLink) {
  if (versions.some((v) => [STATUS.trial, STATUS.winner, STATUS.lost].includes(v.status))) return { error: "version_on_trial" };
  const used = new Set(versions.map((v) => v.letter));
  const letter = LETTERS.find((l) => !used.has(l));
  if (!letter) return { error: "no_letter_left" };
  const c = cleanLink(rawLink);
  if (c.error) return { error: c.error };
  if (!c.link) return { error: "version_has_no_link" };
  if (versions.some((x) => clean(x.frame_url, 2048) === c.link)) return { error: "link_used_by_another_version" };
  if (!versions.some(live) && c.link !== clean(mainLink, 2048)) return { error: "attach_first" };
  return { letter, link: c.link };
}

/*
 * The winner is SyncView's alone (owner, 2026-10-27): trial_reel_cards.winner_letter is the only source of truth, and
 * a "winner" or "lost" the studio (the AI editor) writes on a version's row means nothing. Every read and rule sees
 * the versions through this. With a winner letter, that version is the winner and every other one on trial or
 * decided is lost; with none, nothing is decided, so a stored "winner" or "lost" reads as on trial (where SyncView's
 * own Undo puts them).
 */
export function settleWinner(versions, winnerLetter) {
  const w = clean(winnerLetter, 1).toUpperCase();
  const pick = LETTERS.includes(w) ? w : "";
  return versions.map((v) => {
    const decided = v.status === STATUS.winner || v.status === STATUS.lost;
    if (pick && v.letter === pick) return v.status === STATUS.winner ? v : { ...v, status: STATUS.winner };
    if (pick && (decided || v.status === STATUS.trial)) return v.status === STATUS.lost ? v : { ...v, status: STATUS.lost };
    if (!pick && decided) return { ...v, status: STATUS.trial };
    return v;
  });
}
const okField = (stage) => stage + "_ok_at";

/*
 * The version that is the card's one link: the winner once picked; else the live version whose link the card carries;
 * else the first live one (Video A while it is not dropped). The team may drop the version on the card (default (c),
 * 2026-10-27, awaiting the owner): today's attach first puts the next live version's link on the card, so "on the
 * card" moves to it, and only then is the old one dropped.
 */
export function mainLetter(versions, mainLink) {
  const w = versions.find((v) => v.status === STATUS.winner);
  if (w) return w.letter;
  const rest = [...versions].sort((a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter)).filter(live);
  const link = clean(mainLink, 2048);
  const carried = link && rest.find((v) => clean(v.frame_url, 2048) === link);
  return carried ? carried.letter : rest.length ? rest[0].letter : "A";
}

/** Has every version that is not dropped got this stage's OK? (At least one version must remain.) */
export function stageDone(versions, stage) {
  const rest = versions.filter(counted);
  if (!rest.length) return false;
  if (stage === "client") return rest.every((v) => v.status === STATUS.approved || v.status === STATUS.trial || v.status === STATUS.winner || v.status === STATUS.lost);
  return rest.every((v) => !!v[okField(stage)]);
}

/** The card is Approved once no version is waiting or has a change asked, and at least one is approved (owner, Q4). */
export function cardApprovable(versions) {
  const rest = versions.filter(counted);
  return rest.length > 0 && rest.every((v) => v.status === STATUS.approved);
}

/** One reviewer's answer on one version, or on every version still open ("approve_all"). Returns the patches by id. */
/*
 * The stage order, held by the server and not only by the card's status: Kasper answers a version only after the SMM,
 * and the client only after the SMM (the SMM may send a version straight to the client, as "Approve to client" does
 * today, so the client's turn does not wait on Kasper).
 */
export function stageReady(v, stage, sentWhole) {
  return stage === "smm" ? true : !!v.smm_ok_at || !!sentWhole;
}

/*
 * The team sent the card on today's way (today's Approve before the review page asked per version, or the status menu)
 * while the SMM had looked at no version: every version then counts as through the SMM for the stage the card was sent
 * to, or the client link would show them all "with the team" and nothing could move (Sidney, 2026-10-27). Once the SMM
 * has looked at one version, one it has not seen stays with the team (Probe rule-miss 13).
 */
const SENT_TO = Object.freeze({
  kasper: ["Kasper Approval"],
  client: ["Client Approval", "Approved", "Scheduled", "Posted"],
});
export function sentOnWhole(versions, stage, cardStatus) {
  return (SENT_TO[stage] || []).includes(clean(cardStatus, 40)) && !versions.some((v) => live(v) && v.smm_ok_at);
}

export function answerPatches(versions, { stage, kind, letter, note, cardStatus }, now) {
  if (!STAGES.includes(stage)) return { error: "stage_invalid" };
  const whole = sentOnWhole(versions, stage, cardStatus);
  if (!["approve", "change", "approve_all", "pass"].includes(kind)) return { error: "kind_invalid" };
  if (kind === "pass" && stage !== "client") return { error: "pass_client_only" };
  // Open for this reviewer: live, not decided, not waiting on a new cut, with a link to watch, its turn, not yet answered.
  const open = (v) => live(v) && v.status !== STATUS.change && v.status !== STATUS.trial && v.status !== STATUS.winner && v.status !== STATUS.lost
    && !!clean(v.frame_url, 2048) && stageReady(v, stage, whole)
    && (stage === "client" ? v.status === STATUS.waiting && !passed(v) : !v[okField(stage)]);
  let targets;
  if (kind === "approve_all") targets = versions.filter(open);
  else {
    const v = versions.find((x) => x.letter === letter);
    if (!v) return { error: "version_not_found" };
    if (!live(v)) return { error: "version_dropped" };
    if ([STATUS.trial, STATUS.winner, STATUS.lost].includes(v.status)) return { error: "version_on_trial" };
    if (kind === "pass") {
      if (v.status !== STATUS.waiting) return { error: v.status === STATUS.change ? "change_open" : "version_answered" };
      if (passed(v)) return { error: "version_passed" };
      if (!clean(v.frame_url, 2048)) return { error: "version_has_no_link" };
      if (!stageReady(v, stage, whole)) return { error: "stage_order" };
      if (!versions.some((x) => x.letter !== v.letter && counted(x))) return { error: "last_live_version" };
    }
    if (kind === "approve") {
      // A change asked waits for its new cut (Q3); nothing to watch, nothing to approve; and each stage in its turn.
      if (v.status === STATUS.change) return { error: "change_open" };
      if (!clean(v.frame_url, 2048)) return { error: "version_has_no_link" };
      if (!stageReady(v, stage, whole)) return { error: "stage_order" };
    }
    targets = [v];
  }
  if (!targets.length) return { patches: [] };
  const patches = targets.map((v) => {
    if (kind === "change") {
      const text = clean(note, 4000);
      return { id: v.id, letter: v.letter, from: v.status, patch: { status: STATUS.change, change_by: stage, change_note: text || null, change_at: now } };
    }
    if (kind === "pass") return { id: v.id, letter: v.letter, from: v.status, patch: { client_pass_at: now } };
    const patch = { [okField(stage)]: now };
    if (stage === "client") Object.assign(patch, { status: STATUS.approved }, clearPass(v));
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
  if (letter === mainLetter(versions, mainLink) && c.link !== clean(mainLink, 2048)) return { error: "attach_first" };
  if (c.link === clean(v.frame_url, 2048)) return { patch: null, letter };
  if ([STATUS.trial, STATUS.winner, STATUS.lost].includes(v.status)) return { error: "version_on_trial" };
  // One link, one version: the same link on two versions would be the same video reviewed twice.
  if (c.link && versions.some((x) => x.letter !== letter && clean(x.frame_url, 2048) === c.link)) return { error: "link_used_by_another_version" };
  const patch = linkChange(v, c.link);
  return { patch, letter, restarted: patch.status === STATUS.waiting };
}

/*
 * A new cut starts the version again (plan section 2: revision goes up, the three OKs and the status go back to
 * waiting): a new link on a version with a change asked (Q3), and a link that REPLACES another on a version already
 * answered by anyone, so no approval ever covers a video its reviewer did not see. A first paste (no link before)
 * keeps what the version had. A decided version (on trial, winner, lost) never restarts.
 */
function linkChange(v, link) {
  const patch = { frame_url: link || null };
  const had = clean(v.frame_url, 2048);
  const replaced = !!had && !!link && had !== link;
  // A client's pass is an answer too (a card sent straight to the client may be passed with no OK on it).
  const answered = v.status === STATUS.approved || !!(v.smm_ok_at || v.kasper_ok_at || v.client_ok_at || v.client_pass_at);
  if (link && (v.status === STATUS.change || (replaced && answered && [STATUS.waiting, STATUS.approved].includes(v.status)))) {
    Object.assign(patch, {
      revision: (Number(v.revision) || 0) + 1, status: STATUS.waiting,
      smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, change_by: null, change_note: null, change_at: null,
    }, clearPass(v));
  }
  return patch;
}

/*
 * The copy of the card's one link, caught up. Production's own Deliverable file row (today's attach) is how the
 * version on the card gets a new link from Production, and nothing tells this log; so a staff read copies file_url
 * into that version's frame_url, with the same restart as a link pasted here (Q3).
 * Not while the page is moving the card's link between versions: when the card's link is ANOTHER version's link (a
 * winner pick, or its Undo, between today's attach and winner_set / winner_undo), nothing is copied.
 */
export function healMainPatch(versions, mainLink) {
  const link = clean(mainLink, 2048);
  const letter = mainLetter(versions, mainLink);
  const v = versions.find((x) => x.letter === letter);
  if (!link || !v || clean(v.frame_url, 2048) === link) return null;
  if (versions.some((x) => x.letter !== letter && clean(x.frame_url, 2048) === link)) return null;
  return { id: v.id, letter, from: v.status, patch: linkChange(v, link) };
}

/*
 * "New cut ready" (default (b), 2026-10-27, awaiting the owner): the editor's new cut of a version asked to change sits
 * at the same link (Frame.io keeps one link across uploads), so pasting can't restart it. This action does what a new
 * link does: revision up, every OK and the change cleared, status waiting, so the SMM and Kasper review it again
 * before the client (Q3). Only on a version with a change asked.
 */
export function newCutPatch(versions, letter) {
  const v = versions.find((x) => x.letter === letter);
  if (!v) return { error: "version_not_found" };
  if (v.status !== STATUS.change) return { error: "version_not_change_asked" };
  if (!clean(v.frame_url, 2048)) return { error: "version_has_no_link" };
  return { patch: { revision: (Number(v.revision) || 0) + 1, status: STATUS.waiting, smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, change_by: null, change_note: null, change_at: null, ...clearPass(v) } };
}

/** Only the team drops a version (owner, Q2), and never one that is out on trial or decided. */
export function dropPatch(versions, letter, restore, mainLink) {
  const v = versions.find((x) => x.letter === letter);
  if (!v) return { error: "version_not_found" };
  if ([STATUS.trial, STATUS.winner, STATUS.lost].includes(v.status)) return { error: "version_on_trial" };
  // Brought back: reviewed again from the start, so no earlier OK stands for it.
  if (restore) {
    return v.status === STATUS.dropped
      ? { patch: { status: STATUS.waiting, smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, change_by: null, change_note: null, change_at: null, ...clearPass(v) } }
      : { patch: null };
  }
  if (!restore && v.status !== STATUS.dropped && !versions.some((x) => x.letter !== letter && live(x))) return { error: "last_live_version" };
  // The version on the card: today's attach first puts the next live version's link on the card (409, attach_first).
  if (letter === mainLetter(versions, mainLink)) return { error: "attach_first" };
  return v.status === STATUS.dropped ? { patch: null } : { patch: { status: STATUS.dropped } };
}

/** The SMM posted the approved versions as trial reels by hand: each goes on trial with its 24 h timer. */
export function trialPatches(versions, nowMs) {
  const ready = versions.filter((v) => v.status === STATUS.approved);
  if (!ready.length) return { error: "nothing_approved" };
  // Every live version approved first: the trial never starts with some still waiting or asked to change.
  if (!cardApprovable(versions)) return { error: "not_all_approved" };
  const at = new Date(nowMs).toISOString();
  const ends = new Date(nowMs + TRIAL_MS).toISOString();
  return { patches: ready.map((v) => ({ id: v.id, letter: v.letter, from: v.status, patch: { status: STATUS.trial, posted_at: at, trial_ends_at: ends } })) };
}

/*
 * Posted starts the trial (owner, 2026-10-28): once the card's video is Posted, every approved live version goes on
 * trial, its 24 h counted from the card's Posted time (video_status_at; now when that is unknown). A version not
 * approved (waiting, change asked, dropped by the client) stays off it and the team drops it; with none approved there
 * is no trial. Once started it stays, even if the card leaves Posted before a winner (nothing is lost). Nothing to do
 * answers no patches.
 */
export function autoTrialPatches(versions, { cardStatus, postedAt, nowMs }) {
  if (clean(cardStatus, 40) !== "Posted") return { patches: [] };
  if (versions.some((v) => [STATUS.trial, STATUS.winner, STATUS.lost].includes(v.status))) return { patches: [] };
  const ready = versions.filter((v) => v.status === STATUS.approved && !passed(v));
  if (!ready.length) return { patches: [] };
  const t = Date.parse(clean(postedAt, 40));
  const startMs = Number.isFinite(t) ? t : nowMs;
  const at = new Date(startMs).toISOString(), ends = new Date(startMs + TRIAL_MS).toISOString();
  return { patches: ready.map((v) => ({ id: v.id, letter: v.letter, from: v.status, patch: { status: STATUS.trial, posted_at: at, trial_ends_at: ends } })) };
}

/**
 * The SMM picks the winner (staff only). The card's one link must already be the winner's (the page saves it through
 * today's Production attach first), so the card, Production and this log agree.
 */
export function winnerPatches(versions, letter, mainLink, opts) {
  const o = opts || {};
  const w = versions.find((x) => x.letter === letter);
  if (!w) return { error: "version_not_found" };
  if (w.status !== STATUS.trial) return { error: "version_not_on_trial" };
  // The card is Posted for the whole trial (it starts there), so the pick is made on a Posted card (owner, 2026-10-28).
  // The 24 h first (the page shows the trophy only then; the server holds the same line).
  const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now();
  if (versions.some((v) => v.status === STATUS.trial && v.trial_ends_at && Date.parse(v.trial_ends_at) > nowMs)) return { error: "trial_not_over" };
  if (!w.frame_url) return { error: "version_has_no_link" };
  if (clean(mainLink, 2048) !== clean(w.frame_url, 2048)) return { error: "attach_first" };
  return {
    patches: versions.filter((v) => v.status === STATUS.trial).map((v) => ({
      id: v.id, letter: v.letter, from: v.status, patch: { status: v.letter === letter ? STATUS.winner : STATUS.lost },
    })),
  };
}

/**
 * Undo of the winner pick (the page's Undo toast, as Kasper's approve has): every decided version goes back on trial.
 * The card's one link must already be back on Video A's (the page puts it back through today's Production attach
 * first), so the card and this log agree at every step.
 */
export function undoWinnerPatches(versions, mainLink, opts) {
  if (!versions.some((v) => v.status === STATUS.winner)) return { error: "no_winner" };
  // Back on trial, the card carries the first live version again (Video A unless it was dropped).
  const a = [...versions].sort((x, y) => LETTERS.indexOf(x.letter) - LETTERS.indexOf(y.letter)).find(live);
  if (!a || clean(mainLink, 2048) !== clean(a.frame_url, 2048)) return { error: "attach_first" };
  return {
    patches: versions.filter((v) => v.status === STATUS.winner || v.status === STATUS.lost).map((v) => ({
      id: v.id, letter: v.letter, from: v.status, patch: { status: STATUS.trial },
    })),
  };
}

/** What a reader gets back. A client link sees no hook family, no notes from the team, and once a winner is picked only the winner (owner, Q8). */
export function readShape(versions, { client, mainLink, cardStatus }) {
  const sorted = [...versions].sort((a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter));
  const main = mainLetter(sorted, mainLink);
  const winner = sorted.find((v) => v.status === STATUS.winner);
  // A client read answers for the client's turn; a staff read for Kasper's (the SMM's is never held back).
  const whole = sentOnWhole(sorted, client ? "client" : "kasper", cardStatus);
  const rows = (client ? (winner ? [winner] : sorted.filter((v) => live(v) && v.status !== STATUS.lost)) : sorted).map((v) => {
    const isMain = v.letter === main;
    const base = {
      id: v.id, letter: v.letter, status: v.status, revision: Number(v.revision) || 0, updated_at: v.updated_at || null,
      // For the version on the card, the link shown is the card's own link (file_url, or the card's link with no task).
      frame_url: isMain && clean(mainLink, 2048) ? clean(mainLink, 2048) : (v.frame_url || null),
      on_card: isMain,
      client_ok_at: v.client_ok_at || null,
      // The client's own "Not this one" (shown to the team as "Client passed").
      client_pass_at: v.client_pass_at || null,
      // The SMM has looked at it, so Kasper and the client may answer it (stage order). A yes or no only: a client
      // read carries no team timestamps (Probe rule-miss 13).
      ready: !!v.smm_ok_at || whole,
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
    // The main version's own link as stored (its row above shows the card's link): what a page puts the card back to
    // when a winner it tried is refused (two staff picking at once, Probe bug 9).
    out.main_url = (mainRow && clean(mainRow.frame_url, 2048)) || null;
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
