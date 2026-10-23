// Caption history (session Versions, 2026-10-23): how the Calendar's history pop-up reads public.caption_versions.
// Pure functions, so they are unit tested (test/caption-history-logic.js); caption-generate's two GET actions call them.
//
// The table keeps every save. A person typing a caption saves every few seconds (60% of caption changes are under
// 10 seconds apart), so the pop-up shows one version per burst: saves by the same person, made the same way, less
// than five minutes apart, show as one version holding the last text of the burst. A generate, a redo, a restore
// and a client edit always start a version of their own. A burst that ends where the previous version ended is no
// change, and is left out.

export const BURST_MS = 5 * 60 * 1000;
// A write that came through the API without saying how ("saved") is a client edit when the client wrote about
// the caption (their caption-change note) this close to it.
export const CLIENT_NOTE_WINDOW_MS = 3 * 60 * 1000;
export const MAX_ROWS = 2000;
export const MAX_INDEX_IDS = 200;

const MERGEABLE = new Set(["typed", "saved", "outside", "backfill"]);

function ms(at) {
  const t = Date.parse(String(at || ""));
  return Number.isFinite(t) ? t : 0;
}

// rows: caption_versions rows of ONE card and ONE field, any order. clientNoteTimes: ISO times of the client's own
// caption notes on that card (calendar_post_events, component caption, role client).
export function labelRows(rows, clientNoteTimes) {
  const notes = (clientNoteTimes || []).map(ms).filter(Boolean);
  return (rows || []).slice().sort((a, b) => Number(a.id) - Number(b.id)).map((r) => {
    let kind = String(r.kind || "saved");
    let actor = r.actor || null;
    if (kind === "saved") {
      const t = ms(r.created_at);
      if (notes.some((n) => Math.abs(n - t) <= CLIENT_NOTE_WINDOW_MS)) { kind = "client"; actor = actor || "Client"; }
    }
    return {
      id: Number(r.id),
      kind,
      text: String(r.text == null ? "" : r.text),
      note: kind === "redo" && r.note ? String(r.note) : null,
      from: kind === "restored" && r.restored_from != null ? Number(r.restored_from) : null,
      actor,
      role: r.actor_role || null,
      at: String(r.created_at || ""),
    };
  });
}

// Labelled rows (oldest first) to the versions the pop-up shows (oldest first).
export function groupVersions(labelled, opts) {
  const withText = !opts || opts.withText !== false;
  const out = [];
  for (const r of labelled || []) {
    const last = out[out.length - 1];
    const sameBurst = last && MERGEABLE.has(r.kind) && last.kind === r.kind && (last.actor || "") === (r.actor || "") &&
      ms(r.at) - ms(last.at) < BURST_MS;
    if (sameBurst) {
      last.id = r.id;
      last.text = r.text;
      last.at = r.at;
      continue;
    }
    out.push(Object.assign({}, r));
  }
  // A version whose text is the same as the one before it changed nothing (typed and typed back): leave it out.
  const kept = [];
  for (const v of out) {
    const prev = kept[kept.length - 1];
    if (withText && prev && prev.text === v.text && v.kind !== "restored") continue;
    kept.push(v);
  }
  return kept;
}

// The answer of ?action=caption_history: the versions of one card's caption, oldest first.
export function historyAnswer(rows, clientNoteTimes) {
  const versions = groupVersions(labelRows(rows, clientNoteTimes));
  return { ok: true, available: true, versions, truncated: (rows || []).length >= MAX_ROWS };
}

// The answer of ?action=caption_history_index: which of the cards asked about have a caption that has changed
// (two versions or more once bursts are grouped). Rows carry post_id, kind, actor, created_at (no text).
export function historyIndex(rows) {
  const byPost = new Map();
  for (const r of rows || []) {
    const k = String(r.post_id || "");
    if (!k) continue;
    if (!byPost.has(k)) byPost.set(k, []);
    byPost.get(k).push(r);
  }
  const changed = [];
  for (const [post, list] of byPost) {
    const n = groupVersions(labelRows(list, []), { withText: false }).length;
    if (n >= 2) changed.push(post);
  }
  return { ok: true, available: true, changed: changed.sort() };
}

// The card ids the page asks about: plain ids only, at most MAX_INDEX_IDS.
export function parseIds(raw) {
  return Array.from(new Set(String(raw || "").split(",").map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_.:-]{1,200}$/.test(s)))).slice(0, MAX_INDEX_IDS);
}

// A read of a table that is not there yet (the migration not applied): PostgREST answers 42P01 or PGRST205.
export function tableMissing(error) {
  if (!error) return false;
  const code = String(error.code || "");
  return code === "42P01" || code === "PGRST205" || /caption_versions/.test(String(error.message || "")) && /does not exist|could not find/i.test(String(error.message || ""));
}
