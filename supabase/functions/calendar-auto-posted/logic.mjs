// calendar-auto-posted: the decision and the run, with no network and no
// database of its own, so test/calendar-auto-posted.js can drive it under Node.
//
// THE RULE (owner, 2026-10-10, OPEN_REPAIRS 394). A Calendar post whose overall
// status is exactly "Scheduled" turns "Posted" by itself once its scheduled day
// has ended in US Eastern time. Nothing else is ever touched: any other status,
// a card whose parts disagree with its overall, a card or work item a person
// changed in the last hour, a work item whose status does not match its card.
//
// THE PATH. The same two server calls a person's click makes when they pick
// Posted in the Calendar:
//   1. For the video and thumbnail parts that have a Production work item, the
//      gateway (`production-write`, operation "status", surface "calendar"),
//      with a compare-and-set on the work item's status and change time. The
//      database's status bridge then moves the card's part and its overall in
//      the same step and writes its own history row, exactly as for a click.
//   2. For everything else on the card (the caption always, a part with no
//      work item), the Calendar save (`calendar-upsert`), with the card's
//      fresh change time as the conflict base, so a person's edit in between
//      wins and this run leaves the card alone.
// Nothing here writes a status into a table directly.
//
// The calendar history rows this run causes carry source "auto-posted". The
// Production side's own history keeps the gateway's usual source and names the
// configured roster member, because the gateway accepts only a roster member.

export const SOURCE = "auto-posted";
export const ACTOR_LABEL = "SyncView auto-post";
export const EASTERN = "America/New_York";
export const QUIET_MS = 60 * 60 * 1000;
export const DEFAULT_LIMIT = 20;
export const TIME_BUDGET_MS = 100 * 1000;

// The overall status, exactly as the page computes it (`_calNormStatus` and
// `computeOverallStatus` in src/index/120-calendar-flags-write-repair.js.part).
// The test executes the page's own functions against these two.
const CAL_STATUSES = ["N/A", "In Progress", "For SMM Approval", "Kasper Approval", "Client Approval", "Tweaks Needed", "Approved", "Scheduled", "Posted"];
const CAL_PRIORITY = { "Tweaks Needed": 0, "In Progress": 1, "For SMM Approval": 2, "Kasper Approval": 3, "Client Approval": 4, "Approved": 5, "Scheduled": 6, "Posted": 7 };
const RANKED = new Set(Object.keys(CAL_PRIORITY));
export const COMPONENTS = ["video", "graphic", "caption"];

export function normStatus(s) {
  const v = String(s || "").trim();
  if (!v || /^draft$/i.test(v)) return "In Progress";
  if (/^(for )?kasper approval$/i.test(v)) return "Kasper Approval";
  if (/^smm approval$/i.test(v)) return "For SMM Approval";
  const m = CAL_STATUSES.find(x => x.toLowerCase() === v.toLowerCase());
  return m || v;
}

export function overallStatus(p) {
  if (!p) return "In Progress";
  const subs = COMPONENTS.map(c => normStatus(p[c + "_status"] || "In Progress"));
  if (subs.every(s => !RANKED.has(s))) return subs[0] || "In Progress";
  return subs.reduce((acc, s) => (RANKED.has(s) && RANKED.has(acc) && CAL_PRIORITY[s] < CAL_PRIORITY[acc]) ? s : acc, "Posted");
}

function clean(v) {
  return v == null ? "" : String(v).trim();
}

// The calendar date (YYYY-MM-DD) it is right now in US Eastern time.
export function easternToday(now) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: EASTERN, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const get = (t) => (parts.find(x => x.type === t) || {}).value || "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

// The scheduled day has ENDED in Eastern time: today (Eastern) is a later date.
export function dayHasEnded(scheduledDate, now) {
  const d = clean(scheduledDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d < easternToday(now);
}

// Unparseable means "cannot prove it is quiet", so it is not quiet.
export function quietSince(stamp, now) {
  const ms = Date.parse(clean(stamp));
  if (!Number.isFinite(ms)) return false;
  return now.getTime() - ms >= QUIET_MS;
}

// The gateway accepts request ids of letters, digits and : _ - only
// (production-write policy validRequestId); a timestamp carries . and +.
export function requestIdFor(postId, component, itemUpdatedAt) {
  const raw = SOURCE + ":" + clean(postId) + ":" + clean(component) + ":" + clean(itemUpdatedAt);
  return raw.replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 200);
}

// The card fields a person could change that this run relies on: its version,
// its overall and parts, its day and what it is linked to.
const BINDING = ["scheduled_date", "video_deliverable_id", "graphic_deliverable_id", "linear_issue_id", "graphic_linear_issue_id"];
export const CARD_FIELDS = ["client", "id", "status", "updated_at", "video_status", "graphic_status", "caption_status", ...BINDING];

function sameBinding(a, b) {
  return BINDING.every(k => clean(a[k]) === clean(b[k]));
}

// Before any work item moves: the card must still be exactly what the due list saw.
export function unchangedSinceDue(row, fresh) {
  if (!fresh) return false;
  if (!sameBinding(row, fresh)) return false;
  return ["status", "updated_at", "video_status", "graphic_status", "caption_status"].every(k => clean(row[k]) === clean(fresh[k]));
}

const WORK_ITEM = { video: { id: "video_deliverable_id", link: "linear_issue_id", status: "video_deliverable_status", at: "video_deliverable_updated_at" },
  graphic: { id: "graphic_deliverable_id", link: "graphic_linear_issue_id", status: "graphic_deliverable_status", at: "graphic_deliverable_updated_at" } };

// What one card needs. `row` is one row of calendar_auto_posted_due(): the card
// plus, for video and thumbnail, its work item's id, status and change time.
//   { skip: reason }                     leave the card alone
//   { pushes: [...], lanes: [...] }      pushes go through the gateway; lanes are
//                                        the card parts that end at Posted
export function planCard(row, now) {
  if (!row || !clean(row.id) || !clean(row.client)) return { skip: "bad_row" };
  if (clean(row.status) !== "Scheduled") return { skip: "not_scheduled" };
  if (!dayHasEnded(row.scheduled_date, now)) return { skip: "not_due" };
  if (!quietSince(row.updated_at, now)) return { skip: "changed_recently" };
  if (overallStatus(row) !== "Scheduled") return { skip: "parts_disagree" };
  const pushes = [];
  const lanes = [];
  for (const comp of COMPONENTS) {
    const lane = normStatus(row[comp + "_status"]);
    if (lane !== "Scheduled") continue;   // Posted and N/A stay as they are
    lanes.push(comp);
    const w = WORK_ITEM[comp];
    if (!w) continue;                     // the caption has no work item
    const deliverableId = clean(row[w.id]);
    if (!deliverableId) {
      // A part linked only the old way, with no work item to move, is left for a person.
      if (clean(row[w.link])) return { skip: "linked_without_work_item" };
      continue;
    }
    const itemStatus = clean(row[w.status]).toLowerCase();
    if (!itemStatus) return { skip: "work_item_missing" };
    if (itemStatus !== "scheduled") return { skip: "work_item_disagrees" };
    if (!quietSince(row[w.at], now)) return { skip: "changed_recently" };
    pushes.push({ component: comp, deliverable_id: deliverableId, expected_status: "scheduled", expected_updated_at: clean(row[w.at]) });
  }
  if (!lanes.length) return { skip: "parts_disagree" };
  const binding = {};
  for (const k of BINDING) binding[k] = clean(row[k]);
  return { pushes, lanes, binding };
}

// The Calendar save for a card re-read AFTER the gateway pushes. Returns null
// when the card moved in a way this run did not cause (a person, most likely);
// {} when the bridge already finished everything.
export function calendarPatch(plan, fresh) {
  if (!fresh || clean(fresh.status) === "" || clean(fresh.status).toLowerCase() === "archived") return null;
  if (plan.binding && !sameBinding(plan.binding, fresh)) return null;
  const pushed = new Set(plan.pushes.map(p => p.component));
  const patch = {};
  const after = { ...fresh };
  for (const comp of COMPONENTS) {
    const lane = normStatus(fresh[comp + "_status"]);
    if (!plan.lanes.includes(comp)) continue;
    // A pushed part may already read Posted (the bridge moved it); any other
    // value on a planned part means somebody changed the card meanwhile.
    if (lane === "Posted" && pushed.has(comp)) continue;
    if (lane !== "Scheduled") return null;
    patch[comp + "_status"] = "Posted";
    after[comp + "_status"] = "Posted";
  }
  const status = overallStatus(after);
  if (status !== "Posted") return null;
  if (clean(fresh.status) !== status) patch.status = status;
  return patch;
}

function bump(map, key) {
  map[key] = Number(map[key] || 0) + 1;
}

// One timer tick. deps:
//   due(limit)                      rows of calendar_auto_posted_due
//   readCard(client, id)            the card row now (CARD_FIELDS), read before the
//                                   pushes and again after them
//   pushWorkItem(push, ctx)         gateway call; { ok, error }
//   saveCard(client, id, patch, baseAt)   calendar-upsert; { ok, conflict, error }
//   sourceOf(client, id, sinceIso)  "auto-posted" | "other" | "none": the source on the
//                                   card's calendar history rows written since sinceIso
//   now(), sleep(ms)
//   dryRun                          plan only, write nothing
export async function runTick(deps, opts = {}) {
  const started = deps.now();
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || DEFAULT_LIMIT));
  const out = { ok: true, dry_run: !!opts.dryRun, considered: 0, flipped: 0, would_flip: 0, skipped: {}, failed: {}, flipped_ids: [], would_flip_ids: [] };
  let rows;
  try {
    rows = await deps.due(limit);
  } catch (_e) {
    return { ok: false, error: "due_read_failed" };
  }
  let sourceChecked = false;
  for (const row of rows || []) {
    if (deps.now().getTime() - started.getTime() > TIME_BUDGET_MS) { out.stopped = "time_budget"; break; }
    out.considered++;
    const plan = planCard(row, deps.now());
    if (plan.skip) { bump(out.skipped, plan.skip); continue; }
    const client = clean(row.client);
    const id = clean(row.id);
    if (opts.dryRun) { out.would_flip++; out.would_flip_ids.push(id); continue; }

    // Re-read the card before anything irreversible: a person may have moved
    // its day, relinked it or changed a part since the due list was read.
    let before;
    try { before = await deps.readCard(client, id); } catch (_e) { before = null; }
    if (!before) { bump(out.failed, "card_read_failed"); continue; }
    if (!unchangedSinceDue(row, before)) { bump(out.skipped, "changed_while_running"); continue; }

    const sinceIso = new Date(deps.now().getTime() - 1000).toISOString();
    let pushFailed = "";
    for (const push of plan.pushes) {
      const r = await deps.pushWorkItem(push, { client, id });
      if (!r || r.ok !== true) { pushFailed = clean(r && r.error) || "push_failed"; break; }
    }
    if (pushFailed) { bump(out.failed, "work_item:" + pushFailed); continue; }

    let fresh;
    try { fresh = await deps.readCard(client, id); } catch (_e) { fresh = null; }
    if (!fresh) { bump(out.failed, "card_reread_failed"); continue; }
    const patch = calendarPatch(plan, fresh);
    if (patch === null) { bump(out.skipped, "changed_while_running"); continue; }
    if (Object.keys(patch).length) {
      const saved = await deps.saveCard(client, id, patch, clean(fresh.updated_at));
      if (!saved || saved.ok !== true) {
        bump(out.failed, saved && saved.conflict ? "card_conflict" : "card:" + (clean(saved && saved.error) || "save_failed"));
        continue;
      }
    }
    out.flipped++;
    out.flipped_ids.push(id);

    // Once per tick: prove the Calendar save recorded this run's source. If the
    // deployed calendar-upsert does not know "auto-posted" yet it records "ui",
    // which would make these flips look like a person's; stop instead.
    if (!sourceChecked && Object.keys(patch).length) {
      sourceChecked = true;
      let seen = "none";
      for (let i = 0; i < 6 && seen === "none"; i++) {
        await deps.sleep(1000);
        try { seen = await deps.sourceOf(client, id, sinceIso); } catch (_e) { seen = "none"; }
      }
      // No receipt is no evidence either: stop rather than carry on unrecorded.
      if (seen === "other") { out.ok = false; out.error = "calendar_upsert_source_not_deployed"; break; }
      if (seen === "none") { out.ok = false; out.error = "calendar_history_unconfirmed"; break; }
    }
  }
  return out;
}
