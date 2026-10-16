// calendar-card-write: the pure part (no Deno, no network), so Node can test it.
//
// Ported line for line from the LIVE calendar-upsert (v90, read 2026-10-16), which
// is the writer this function replaces (docs/ops/CALENDAR_UPSERT_RETIREMENT_PLAN.md).
// Every guard keeps its exact shape: phantom row, comment three-way merge, link
// clobber and __CLEAR_LINK__, duplicate link, both urgent marker guards, the
// stale-save conflict, and the event ledger with the live role overrides. Do not
// "improve" a guard here without changing it in calendar-upsert's live copy too:
// while both writers run, the same card must get the same answer from either.

export const ALLOWED = [
  "order_index", "scheduled_date", "name", "asset_url", "thumbnail_url",
  "caption", "caption_alt", "caption_alt_platform", "post_url", "cta", "tweaks", "status", "linear_issue_id", "video_deliverable_id",
  "kasper_approved_at", "posted_at", "platform", "platforms", "color",
  "video_status", "graphic_status", "caption_status",
  "graphic_linear_issue_id", "graphic_deliverable_id",
  "video_tweaks", "graphic_tweaks", "caption_tweaks",
  "client_video_approved_at", "client_graphic_approved_at", "client_caption_approved_at",
  "title_status", "title_tweaks", "client_title_approved_at",
  "kasper_seen", "kasper_approved_after_tweaks",
  "thumb_rev",
  "kasper_finished_at", "kasper_closed_at", "kasper_finish_log",
  "video_urgent_pinged_at", "video_urgent_status_at", "video_urgent_issue", "video_urgent_editor",
  "kasper_urgent_pinged_at", "kasper_urgent_status_at", "kasper_urgent_comp", "kasper_urgent_by",
];

export const CONTENT_FIELDS = [
  "caption", "caption_alt", "name", "asset_url", "thumbnail_url", "linear_issue_id", "scheduled_date",
  "cta", "color", "platforms", "graphic_linear_issue_id",
];

export const SCALAR_FIELDS = [
  "scheduled_date", "name", "caption", "caption_alt", "caption_alt_platform", "asset_url", "thumbnail_url",
  "post_url", "cta", "status", "video_status", "graphic_status", "caption_status", "linear_issue_id",
  "video_deliverable_id", "graphic_linear_issue_id", "graphic_deliverable_id",
  "platform", "platforms", "color", "kasper_approved_at", "posted_at",
  "video_urgent_pinged_at", "video_urgent_status_at", "video_urgent_issue", "video_urgent_editor",
  "kasper_urgent_pinged_at", "kasper_urgent_status_at", "kasper_urgent_comp", "kasper_urgent_by",
];

export const READ_FAILURE_MESSAGE = "Not saved — the calendar store was briefly unavailable. Your text is kept; please try again in a moment.";
export const CLEAR = "__CLEAR_LINK__";
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_COLUMNS = ["graphic_linear_issue_id", "linear_issue_id", "video_deliverable_id", "graphic_deliverable_id"];
const NULLABLE_LINK_COLUMNS = new Set(["video_deliverable_id", "graphic_deliverable_id"]);
const URGENT_MARKER_FIELDS = ["video_urgent_pinged_at", "video_urgent_status_at", "video_urgent_issue", "video_urgent_editor"];
const KASPER_URGENT_MARKER_FIELDS = ["kasper_urgent_pinged_at", "kasper_urgent_status_at", "kasper_urgent_comp", "kasper_urgent_by"];
const KASPER_URGENT_COMPONENTS = ["video", "graphic", "caption", "title"];

/* The roster switch, read by the function itself (a page that routes wrongly is
   still refused). Same two shapes as the other rosters:
     { "clients": ["<slug>", ...] }  on for exactly those clients
     { "all": true }                 on for everyone
   Anything else (no row, a malformed value, an unlisted client) is OFF. */
export const FLAG_KEY = "calendar_card_write_clients";

export function rosterAllows(value, client) {
  const slug = clean(client).toLowerCase();
  if (!slug || !value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.all === true) return true;
  if (!Array.isArray(value.clients)) return false;
  return value.clients.some((m) => typeof m === "string" && clean(m).toLowerCase() === slug);
}

export function clean(v) {
  return String(v == null ? "" : v).trim();
}

function sv(o, k) {
  return String(o && o[k] == null ? "" : o ? o[k] : "");
}

export function has(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/* The ledger source, exactly as the live writer records it: only the three
   known automation sources pass through, everything else is "ui". Readers of
   calendar_post_events (calendar-auto-posted among them) count on that. */
export function ledgerSource(raw) {
  const source = clean(raw || "ui").toLowerCase();
  return source === "linear" || source === "reconcile" || source === "auto-posted" ? source : "ui";
}

export function mintThumbRev(existing, updatedAt) {
  const before = clean(existing);
  const parsed = Date.parse(updatedAt);
  const epochMs = Number.isFinite(parsed) ? parsed : Date.now();
  let token = epochMs.toString(36);
  if (token === before) token = (epochMs + 1).toString(36);
  return token;
}

export function stripPrivate(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.charAt(0) === "_") continue;
    if (NULLABLE_LINK_COLUMNS.has(k) && clean(v) === "") out[k] = null;
    else out[k] = String(v == null ? "" : v);
  }
  return out;
}

function normalizeNullableLinks(row) {
  for (const col of NULLABLE_LINK_COLUMNS) {
    if (has(row, col) && clean(row[col]) === "") row[col] = null;
  }
}

export function responsePayload(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (NULLABLE_LINK_COLUMNS.has(k) && v == null) continue;
    out[k] = v;
  }
  return out;
}

/* `normalizeClient` is passed in so the handler uses the shared write-auth
   normaliser and Node tests can pass a plain one. */
export function buildIncoming(body, now, normalizeClient) {
  const client = normalizeClient(body.client);
  if (!client) throw new Error("client required");
  const post = body.post && typeof body.post === "object" ? body.post : {};
  let id = clean(post.id);
  if (!id) id = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  const row = { id, updated_at: now };
  for (const k of ALLOWED) {
    if (has(post, k)) row[k] = String(post[k] == null ? "" : post[k]);
  }
  row._client = client;
  row._baseAt = String(body.comments_base_at || "");
  return { client, row };
}

function parseComments(s) {
  try {
    const a = JSON.parse(s == null ? "[]" : (String(s) || "[]"));
    return Array.isArray(a) ? a.filter((c) => c && typeof c === "object" && c.id) : [];
  } catch (_e) {
    return [];
  }
}

function stamp(c) {
  return String(c.updated_at || c.created_at || "");
}

export function mergeCell(existingStr, incomingStr, baseAt, nowMs) {
  const ex = parseComments(existingStr);
  const inc = parseComments(incomingStr);
  const incIds = new Set(inc.map((c) => String(c.id)));
  const exById = new Map(ex.map((c) => [String(c.id), c]));
  const out = [];
  for (const c of inc) {
    const e = exById.get(String(c.id));
    out.push(e && stamp(e) > stamp(c) ? e : c);
  }
  for (const e of ex) {
    if (incIds.has(String(e.id))) continue;
    if (e.deleted) { out.push(e); continue; }
    const es = stamp(e);
    if (!baseAt) { out.push(e); continue; }
    if (es && es > baseAt) out.push(e);
  }
  const cutoff = nowMs - RETAIN_MS;
  const kept = out.filter((c) => {
    if (!c.deleted) return true;
    const t = Date.parse(String(c.updated_at || c.created_at || ""));
    return !(isFinite(t) && t < cutoff);
  });
  return kept.length ? JSON.stringify(kept) : "";
}

function applyUrgentMarkerGuards(row, incoming, existing) {
  const touched = URGENT_MARKER_FIELDS.some((k) => has(incoming, k));
  if (!touched) return;

  for (const field of URGENT_MARKER_FIELDS) {
    if (has(incoming, field) && clean(incoming[field]) === "" && clean(existing[field]) !== "") {
      row[field] = String(existing[field] == null ? "" : existing[field]);
    }
  }

  if (!has(incoming, "video_urgent_pinged_at") || clean(incoming.video_urgent_pinged_at) === "") return;

  const status = clean(has(row, "video_status") ? row.video_status : existing.video_status);
  if (status !== "Tweaks Needed") {
    for (const field of URGENT_MARKER_FIELDS) {
      row[field] = String(existing[field] == null ? "" : existing[field]);
    }
    return;
  }

  const statusAt = clean(existing.video_status_at) || clean(row.video_status_at) || clean(incoming.video_urgent_status_at);
  if (statusAt) {
    row.video_urgent_status_at = statusAt;
    row.video_status_at = statusAt;
  }
  if (!clean(row.video_urgent_issue)) {
    row.video_urgent_issue = clean(row.linear_issue_id) || clean(existing.linear_issue_id);
  }
}

function kasperUrgentComp(incoming, existing) {
  const raw = clean(has(incoming, "kasper_urgent_comp") ? incoming.kasper_urgent_comp : existing.kasper_urgent_comp);
  return KASPER_URGENT_COMPONENTS.includes(raw) ? raw : "video";
}

function applyKasperUrgentMarkerGuards(row, incoming, existing) {
  const touched = KASPER_URGENT_MARKER_FIELDS.some((k) => has(incoming, k));
  if (!touched) return;

  for (const field of KASPER_URGENT_MARKER_FIELDS) {
    if (has(incoming, field) && clean(incoming[field]) === "" && clean(existing[field]) !== "") {
      row[field] = String(existing[field] == null ? "" : existing[field]);
    }
  }

  if (!has(incoming, "kasper_urgent_pinged_at") || clean(incoming.kasper_urgent_pinged_at) === "") return;

  const comp = kasperUrgentComp(incoming, existing);
  const statusCol = comp + "_status";
  const status = clean(has(row, statusCol) ? row[statusCol] : existing[statusCol]);
  if (status !== "Kasper Approval") {
    for (const field of KASPER_URGENT_MARKER_FIELDS) {
      row[field] = String(existing[field] == null ? "" : existing[field]);
    }
    return;
  }

  row.kasper_urgent_comp = comp;
  const statusAtCol = comp + "_status_at";
  const statusAt = clean(existing[statusAtCol]) || clean(row[statusAtCol]) || clean(incoming.kasper_urgent_status_at);
  if (statusAt) {
    row.kasper_urgent_status_at = statusAt;
    row[statusAtCol] = statusAt;
  }
}

export function applyGuards(incoming, existing, twins, readFailed, nowMs) {
  if (readFailed) {
    return { _conflict: true, ok: false, id: incoming.id, error: READ_FAILURE_MESSAGE };
  }

  const existsAlready = !!(existing && existing.id);
  const hasContent = CONTENT_FIELDS.some((k) => clean(incoming[k]) !== "");
  if (!existsAlready && !hasContent) {
    throw new Error("phantom-row guard: refusing to create a row in Calendar_" + clean(incoming._client || "?") +
      " with id " + clean(incoming.id) + " because the row does not exist and the payload contains no substantive content fields. This is the misrouted-skeleton pattern.");
  }

  const row = { ...incoming };
  const baseAt = clean(incoming._baseAt);
  for (const col of ["video_tweaks", "graphic_tweaks", "caption_tweaks"]) {
    if (has(incoming, col)) row[col] = mergeCell(existing[col], incoming[col], baseAt, nowMs);
  }
  if (has(incoming, "video_tweaks")) row.tweaks = row.video_tweaks;

  const cleared = {};
  for (const linkCol of LINK_COLUMNS) {
    if (has(incoming, linkCol) && clean(incoming[linkCol]) === CLEAR) {
      row[linkCol] = "";
      cleared[linkCol] = true;
    }
  }

  for (const linkCol of LINK_COLUMNS) {
    if (cleared[linkCol]) continue;
    // link-clobber guard: a blank incoming link must not wipe a stored link.
    if (has(incoming, linkCol) && clean(incoming[linkCol]) === "" && clean(existing[linkCol]) !== "") {
      row[linkCol] = String(existing[linkCol] == null ? "" : existing[linkCol]);
    }
  }

  const incomingLink = (!cleared.linear_issue_id && has(incoming, "linear_issue_id")) ? clean(incoming.linear_issue_id) : "";
  if (incomingLink) {
    // duplicate-link guard: linear_issue_id must stay unique across live rows.
    const twin = twins.find((t) => t && t.id && clean(t.id) !== clean(incoming.id) &&
      clean(t.status).toLowerCase() !== "archived" && clean(t.linear_issue_id) === incomingLink);
    if (twin) {
      if (!existsAlready) {
        row.linear_issue_id = "";
      } else if (clean(existing.linear_issue_id) !== incomingLink) {
        row.linear_issue_id = String(existing.linear_issue_id == null ? "" : existing.linear_issue_id);
      }
    }
  }

  applyUrgentMarkerGuards(row, incoming, existing);
  applyKasperUrgentMarkerGuards(row, incoming, existing);

  if (existsAlready && baseAt) {
    const storedAt = clean(existing.updated_at);
    if (storedAt && storedAt > baseAt) {
      const changed = SCALAR_FIELDS.filter((k) => has(incoming, k) && clean(row[k]) !== clean(existing[k]));
      if (changed.length) {
        return {
          _conflict: true,
          ok: false,
          conflict: true,
          id: incoming.id,
          error: "Not saved: someone else updated this card (" + changed.join(", ") +
            ") after your screen last loaded it. Refresh the calendar to see their version, then re-apply your change.",
        };
      }
    }
  }

  row._conflict = false;
  normalizeNullableLinks(row);
  return row;
}

export function updatePayload(client, row) {
  const out = { client };
  for (const [k, v] of Object.entries(row)) out[k] = v;
  return out;
}

export function scalarPayloadForExisting(row) {
  const out = { ...row };
  for (const k of ["video_tweaks", "graphic_tweaks", "caption_tweaks", "title_tweaks", "tweaks"]) delete out[k];
  // All four status stamps: the Kasper marker guard writes row[comp + "_status_at"],
  // and a stale stamp written back here would never be repaired by the trigger.
  delete out.video_status_at;
  delete out.graphic_status_at;
  delete out.caption_status_at;
  delete out.title_status_at;
  return out;
}

/* Arguments for the calendar_merge_comments RPC, or null when the save carries
   no comment cell. */
export function commentRpcArgs(client, row) {
  const args = { p_client: client, p_id: row.id, p_base: "" };
  for (const c of ["video", "graphic", "caption", "title"]) {
    const col = c + "_tweaks";
    if (has(row, col)) args["p_" + c] = row[col] == null ? "" : String(row[col]);
  }
  if (!has(args, "p_video") && !has(args, "p_graphic") && !has(args, "p_caption") && !has(args, "p_title")) return null;
  return args;
}

function commentIds(s, includeDeleted = false) {
  return parseComments(s)
    .filter((c) => includeDeleted || !c.deleted)
    .map((c) => String(c.id));
}

/* The ledger rows, with the live writer's role overrides: an approval is the
   client's and a Kasper approve, finish or close is Kasper's, whoever's key
   carried the save. */
export function buildEvents(client, inc, patch, existing, actor, now) {
  const existsAlready = !!(existing && existing.id);
  const postId = clean(inc.id || patch.id);
  const events = [];
  const ev = (action, extra = {}) => {
    events.push({
      client,
      post_id: postId,
      ts: now,
      actor: actor.actor,
      role: extra.role === undefined ? actor.role : extra.role || null,
      action,
      source: actor.source,
      ...extra,
    });
  };

  if (!existsAlready) {
    ev("create", { component: null, from_status: sv(existing, "status"), to_status: sv(inc, "status") || null });
  } else if (has(patch, "status") && sv(inc, "status") !== sv(existing, "status")) {
    if (sv(inc, "status").toLowerCase() === "archived") ev("archive", { component: null, from_status: sv(existing, "status"), to_status: sv(inc, "status") });
    else ev("status_change", { component: null, from_status: sv(existing, "status"), to_status: sv(inc, "status") });
  }

  for (const comp of ["video", "graphic", "caption", "title"]) {
    const col = comp + "_status";
    if (has(patch, col) && sv(inc, col) !== sv(existing, col)) {
      ev("status_change", { component: comp, from_status: sv(existing, col), to_status: sv(inc, col) });
    }
  }

  for (const comp of ["video", "graphic", "caption", "title"]) {
    const col = "client_" + comp + "_approved_at";
    if (has(patch, col) && sv(inc, col) && sv(inc, col) !== sv(existing, col)) {
      ev("approve_" + comp, { component: comp, role: "client" });
    }
  }
  if (has(patch, "kasper_approved_at") && sv(inc, "kasper_approved_at") && sv(inc, "kasper_approved_at") !== sv(existing, "kasper_approved_at")) {
    ev("kasper_approve", { component: null, role: "kasper" });
  }
  if (has(patch, "kasper_finished_at") && sv(inc, "kasper_finished_at") && sv(inc, "kasper_finished_at") !== sv(existing, "kasper_finished_at")) {
    ev("kasper_finish", { component: null, role: "kasper" });
  }
  if (has(patch, "kasper_closed_at") && sv(inc, "kasper_closed_at") && sv(inc, "kasper_closed_at") !== sv(existing, "kasper_closed_at")) {
    ev("kasper_close", { component: null, role: "kasper" });
  }
  if (has(patch, "video_urgent_pinged_at") && sv(inc, "video_urgent_pinged_at") && sv(inc, "video_urgent_pinged_at") !== sv(existing, "video_urgent_pinged_at")) {
    ev("urgent_ping", {
      component: "video",
      payload: {
        issue: sv(inc, "video_urgent_issue") || sv(inc, "linear_issue_id"),
        editor: sv(inc, "video_urgent_editor") || null,
        status_at: sv(inc, "video_urgent_status_at") || sv(inc, "video_status_at") || null,
      },
    });
  }
  // The Kasper ping's ledger row is written by a database trigger
  // (migrations/2026-09-10-kasper-urgent-ping-ledger.sql), not here.

  for (const [comp, col] of [["video", "linear_issue_id"], ["graphic", "graphic_linear_issue_id"]]) {
    if (!has(patch, col)) continue;
    const before = sv(existing, col);
    const after = sv(inc, col);
    if (after === before) continue;
    if (after && !before) ev("link_set", { component: comp, payload: { to: after } });
    else if (!after && before) ev("link_clear", { component: comp, payload: { from: before } });
    else ev("link_set", { component: comp, payload: { from: before, to: after } });
  }

  for (const [comp, col] of [["video", "video_tweaks"], ["graphic", "graphic_tweaks"], ["caption", "caption_tweaks"], ["title", "title_tweaks"]]) {
    if (!has(patch, col)) continue;
    const beforeActive = new Set(commentIds(existing[col]));
    const afterActive = commentIds(inc[col]);
    const added = afterActive.filter((x) => !beforeActive.has(x));
    if (added.length) ev("comment_add", { component: comp, payload: { added } });
    const beforeAll = new Set(commentIds(existing[col], true));
    const afterDeleted = parseComments(inc[col]).filter((c) => c.deleted && beforeAll.has(String(c.id))).map((c) => String(c.id));
    if (afterDeleted.length) ev("comment_delete", { component: comp, payload: { deleted: afterDeleted } });
  }

  return events;
}
