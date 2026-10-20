// The connector's video_cards tool: everything a studio session needs to do a
// client's tweaks, read straight from SyncView. Read only: nothing is written
// anywhere (the one activity row per call is written by index.ts, as for
// every tool).
//
//   video_cards(client, videos?, batch?, frameio?)
//
// For each video it answers the batch, the video number, the title, the brief
// (the editor brief from the work item, which usually holds the script or the
// footage notes), the status, every note and tweak (from the SyncView card,
// from SyncLinear and, when the card links a Frame.io video, from Frame.io with
// the time in the video), the latest edit link, the raw footage folder, and a
// way to download the files.
//
// Plain JavaScript with no Deno parts, so a unit test can run it; index.ts
// passes in the database reads (and the Frame.io lookup) as deps:
//   findClient(query)       -> { plan?: { client_slug, client_name }, choices?: string[] }
//   batches(slug)           -> [{ id, name, status, purpose, created_at, footage_folder_url, filming_doc_url, delivery_folder_url }]
//   deliverables(slug)      -> [{ id, batch_id, kind, title, brief, status, status_at, file_url, card_id, updated_at }]
//   cards(slug)             -> [{ id, name, status, video_status, asset_url, video_tweaks, tweaks, video_deliverable_id, scheduled_date, updated_at }]
//   comments(ids)           -> production_comments rows for those work item ids
//   frameio(link) (optional)-> the frameio-view lookup body ({ video, comments, comments_error, open_url }) or throws

export const MAX_VIDEOS = 30;
export const MAX_FRAMEIO = 8;
export const MAX_CHARS = 60_000;
export const SYNCVIEW = "https://syncview.synchrosocial.com";

const clean = (v) => String(v == null ? "" : v).trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const time = (t) => {
  const d = new Date(clean(t));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "";
};
// 75.4 -> "1:15"
export function clock(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return "";
  const s = Math.floor(n);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

// "Video 7 — Hook test" -> 7. Also "Video #7", "video7". Null when there is no number.
export function videoNumber(...names) {
  for (const n of names) {
    const m = clean(n).match(/\bvideo\s*#?\s*(\d{1,3})\b/i);
    if (m) return Number(m[1]);
  }
  return null;
}

// "Video 7 — Hook test" -> "Hook test"; "Video 6 — Video 6 - Short 3" -> "Short 3"; "Video 7" -> "".
const LEAD = /^\s*video\s*#?\s*\d{1,3}\b\s*(?:[—–:|-]\s*)*/i;
export function titleOf(...names) {
  for (const n of names) {
    let t = clean(n);
    while (LEAD.test(t)) t = t.replace(LEAD, "").trim();
    if (t) return t;
  }
  return "";
}

// The video numbers asked for: [7, 8, 12], "7, 8 and 12", "7-9". Answers [] for none, null when unreadable.
export function parseVideos(raw) {
  if (raw == null || raw === "") return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  const out = new Set();
  for (const p of parts) {
    if (typeof p === "number") {
      if (!Number.isInteger(p) || p < 1 || p > 999) return null;
      out.add(p);
      continue;
    }
    const text = clean(p);
    if (!text) continue;
    if (!/^[\d\s,;&+\-–to and]*$/i.test(text.replace(/video/gi, ""))) return null;
    const t = text.replace(/video/gi, "");
    for (const m of t.matchAll(/(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})|(\d{1,3})/gi)) {
      if (m[3]) { out.add(Number(m[3])); continue; }
      const a = Number(m[1]), b = Number(m[2]);
      if (b < a || b - a > MAX_VIDEOS) return null;
      for (let i = a; i <= b; i++) out.add(i);
    }
  }
  return [...out].filter((n) => n >= 1).sort((a, b) => a - b);
}

// Legacy note rules, the same ones the comment feedback reader uses
// (../production-comments/feedback.mjs, sourceComment): a note is deleted when
// deleted, is_deleted (true, 1, "true", "1", "yes") or deleted_at says so; done
// when done, resolved or resolved_at says so; a note stored in a *_tweaks
// column counts as a change request even when is_tweak is missing or false.
const truthy = (v) => v === true || v === 1 || ["true", "1", "yes"].includes(clean(v).toLowerCase());
export const noteDeleted = (n) => truthy(n.deleted) || truthy(n.is_deleted) || !!clean(n.deleted_at);
export const noteDone = (n) => truthy(n.done) || truthy(n.resolved) || !!clean(n.resolved_at);
export const LEGACY_AUTHOR = "Older note kept from before notes were per person";

// The card's notes: a JSON list in video_tweaks (older cards: tweaks). Plain
// text there is an older single note; it comes back as one change request,
// the way the Calendar shows it.
export function cardNotes(card) {
  const fromVideo = clean(card && card.video_tweaks);
  const field = fromVideo ? "video_tweaks" : "tweaks";
  const raw = fromVideo || clean(card && card.tweaks);
  if (!raw) return [];
  let list = null;
  if (raw.startsWith("[")) {
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) list = parsed; } catch { /* plain text below */ }
  }
  if (!list) {
    return [{ id: "", from: "SyncView card", who: LEGACY_AUTHOR, role: "", when: "", at: "", text: raw, tweak: true, round: null, done: false, reply_to: null, for_client: false, legacy_text: true }];
  }
  return list.filter((n) => n && typeof n === "object" && !noteDeleted(n) && !truthy(n.hidden)
    && (!clean(n.component) || clean(n.component) === "video") && clean(n.body)).map((n) => ({
    id: clean(n.id),
    from: "SyncView card",
    who: clean(n.author) || "someone",
    role: clean(n.role),
    when: time(n.created_at),
    at: clean(n.created_at),
    text: clean(n.body),
    // Stored in a *_tweaks column: a change request (same rule as the feedback reader).
    tweak: n.is_tweak === true || /_tweaks$/.test(field),
    round: Number.isInteger(n.round) ? n.round : null,
    done: noteDone(n),
    reply_to: clean(n.parent_id) || null,
    for_client: clean(n.audience) === "client",
  }));
}

function workItemNotes(rows) {
  return (rows || []).filter((c) => !c.deleted_at && clean(c.body) && (!c.component || c.component === "video")).map((c) => ({
    id: clean(c.id),
    native: clean(c.native_comment_id),
    from: "SyncLinear",
    who: clean(c.author_name) || "someone",
    role: clean(c.role),
    when: time(c.source_created_at || c.created_at),
    at: clean(c.source_created_at || c.created_at),
    text: clean(c.body),
    tweak: c.is_tweak === true,
    round: Number.isInteger(c.round) ? c.round : null,
    done: !!c.resolved_at,
    reply_to: clean(c.parent_id) || null,
    for_client: clean(c.audience) === "client",
  }));
}

function frameNotes(found) {
  const out = [];
  for (const c of (found && found.comments) || []) {
    const at = c.time_seconds == null ? "" : clock(c.time_seconds);
    out.push({
      from: "Frame.io",
      who: clean(c.author) || "a guest",
      when: time(c.created_at),
      at: clean(c.created_at),
      time_in_video: at || null,
      seconds: c.time_seconds == null ? null : c.time_seconds,
      text: clean(c.text),
      done: c.done === true,
      replies: (c.replies || []).filter((r) => clean(r.text)).map((r) => ({ who: clean(r.author) || "a guest", when: time(r.created_at), text: clean(r.text) })),
    });
  }
  return out;
}

// SyncLinear keeps a copy of most card notes; show each note once.
function merge(card, linear) {
  const seen = new Set(card.map((n) => n.id).filter(Boolean));
  const extra = linear.filter((n) => !seen.has(n.id) && !(n.native && seen.has(n.native)));
  return [...card, ...extra].sort((a, b) => a.at.localeCompare(b.at)).map(({ native: _n, at: _a, ...n }) => n);
}

const isFrame = (link) => /^https?:\/\/(f\.io|next\.frame\.io|app\.frame\.io|[a-z0-9-]+\.frame\.io)\//i.test(clean(link));
const firstLink = (raw) => (clean(raw).match(/https?:\/\/[^\s<>"']+/) || [""])[0].replace(/[),.;]+$/, "");

function batchLabel(b) {
  return b ? clean(b.name) || b.id : "no batch";
}

// The batch asked for: its id, words from its name or date ("19 Oct", "October 2026"), or "latest".
function pickBatches(all, asked) {
  const q = clean(asked);
  if (!q) return { list: all };
  if (/^(latest|newest|last|current)$/i.test(q)) return { list: all.slice(0, 1) };
  const exact = all.filter((b) => b.id === q || norm(b.name) === norm(q));
  if (exact.length) return { list: exact.slice(0, 1) };
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hits = all.filter((b) => {
    const name = clean(b.name).toLowerCase();
    return words.every((w) => name.includes(w) || (w.length >= 3 && name.split(/[^a-z0-9]+/).some((p) => p.startsWith(w) || w.startsWith(p) && p.length >= 3)));
  });
  if (hits.length === 1) return { list: hits };
  return { ask: hits.length ? hits : all };
}

export async function videoCards(deps, args) {
  const a = args && typeof args === "object" ? args : {};
  const found = await deps.findClient(clean(a.client));
  if (!found.plan) return `Which client? ${found.choices && found.choices.length ? "Options: " + found.choices.join(", ") : "No match."}`;
  const slug = found.plan.client_slug, name = found.plan.client_name;
  const wanted = parseVideos(a.videos);
  if (wanted === null) return 'Give videos as numbers, for example [7, 8, 12] or "7-9".';
  if (wanted.length > MAX_VIDEOS) return `At most ${MAX_VIDEOS} videos in one call. Ask for fewer, or for one batch at a time.`;

  const [batches, items, cards] = await Promise.all([deps.batches(slug), deps.deliverables(slug), deps.cards(slug)]);
  const byNew = (x, y) => clean(y.created_at).localeCompare(clean(x.created_at));
  const allBatches = [...batches].sort(byNew);
  const batchById = new Map(allBatches.map((b) => [b.id, b]));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  // Cards that point back at each work item (a card can carry a stale link).
  const backTo = new Map();
  for (const c of cards) {
    const id = clean(c.video_deliverable_id);
    if (!id) continue;
    if (!backTo.has(id)) backTo.set(id, []);
    backTo.get(id).push(c);
  }

  // One entry per video work item (canceled and duplicate ones left out), plus
  // older cards that have no work item, so nothing SyncView shows is missed.
  // A card is joined to a work item only when the two point at each other:
  // the work item's card_id names the card AND the card's video_deliverable_id
  // names the work item. With no card_id, only a single card pointing back counts.
  const videos = [];
  for (const d of items) {
    if (d.kind !== "video" || d.status === "canceled" || d.status === "duplicate") continue;
    const back = backTo.get(d.id) || [];
    let card = null, cardProblem = "";
    if (clean(d.card_id)) {
      const c = cardById.get(clean(d.card_id));
      if (c && clean(c.video_deliverable_id) === d.id) card = c;
      else cardProblem = "The work item and its Calendar card do not point at each other, so the card's status, notes and edit link are left out. Check the card in SyncLinear.";
    } else if (back.length === 1) {
      card = back[0];
    } else if (back.length > 1) {
      cardProblem = "More than one Calendar card points at this work item, so none is used. Check the card in SyncLinear.";
    }
    const num = videoNumber(d.title, card && card.name);
    videos.push({ item: d, card, cardProblem, batch: batchById.get(d.batch_id) || null, num });
  }
  for (const c of cards) {
    // Only cards with no work item at all; a card pointing at a work item is never shown on its own.
    if (clean(c.video_deliverable_id) || /archived/i.test(clean(c.status))) continue;
    const num = videoNumber(c.name);
    if (num === null) continue;
    videos.push({ item: null, card: c, cardProblem: "", batch: null, num });
  }

  // Which batch: the one asked for; otherwise, for each number, the newest
  // batch that has it (a card with no work item counts as the newest).
  const picked = pickBatches(allBatches.filter((b) => videos.some((v) => v.batch === b)), a.batch);
  if (picked.ask) {
    const list = picked.ask.slice(0, 15).map((b) => `- ${batchLabel(b)}`).join("\n");
    return `Which batch? ${clean(a.batch) ? `"${clean(a.batch)}" matches ${picked.ask.length === 0 ? "none" : "more than one"}. ` : ""}${name}'s batches, newest first:\n${list || "- none"}`;
  }
  const inBatch = clean(a.batch) ? videos.filter((v) => picked.list.includes(v.batch)) : videos;
  // Newest batch first; a card with no work item comes last.
  const rank = (v) => (v.batch ? allBatches.indexOf(v.batch) : allBatches.length);
  let chosen = [];
  const otherBatches = [];
  if (wanted.length) {
    // The newest batch that has any of the numbers; a number it lacks comes from the newest batch that has it.
    const main = [...inBatch].filter((v) => wanted.includes(v.num)).sort((x, y) => rank(x) - rank(y))[0];
    for (const n of wanted) {
      const hits = inBatch.filter((v) => v.num === n).sort((x, y) => rank(x) - rank(y));
      if (!hits.length) continue;
      const pick = hits.find((v) => v.batch === main.batch) || hits[0];
      chosen.push(pick);
      if (pick.batch !== main.batch) otherBatches.push(`Video ${n} is not in ${batchLabel(main.batch)}; shown from ${batchLabel(pick.batch)}.`);
      const rest = [...new Set(hits.filter((v) => v !== pick).map((v) => batchLabel(v.batch)))];
      if (rest.length) otherBatches.push(`Video ${n} is also in: ${rest.join("; ")} (pass batch to pick one).`);
    }
  } else {
    const batch = clean(a.batch) ? picked.list[0] : allBatches.find((b) => videos.some((v) => v.batch === b));
    chosen = inBatch.filter((v) => v.batch === batch).sort((x, y) => (x.num ?? 999) - (y.num ?? 999));
    if (chosen.length > MAX_VIDEOS) {
      otherBatches.push(`This batch has ${chosen.length} videos; the first ${MAX_VIDEOS} are shown. Ask for the rest by number.`);
      chosen = chosen.slice(0, MAX_VIDEOS);
    }
  }
  const missing = wanted.filter((n) => !chosen.some((v) => v.num === n));
  if (!chosen.length) {
    return `Could not find ${wanted.length ? `video${wanted.length > 1 ? "s" : ""} ${wanted.join(", ")}` : "any videos"} for ${name}${clean(a.batch) ? ` in ${batchLabel(picked.list[0])}` : ""}. Check the numbers, or leave videos out to see the newest batch.`;
  }

  const comments = await deps.comments(chosen.map((v) => v.item && v.item.id).filter(Boolean));
  const byItem = new Map();
  for (const c of comments) {
    if (!byItem.has(c.deliverable_id)) byItem.set(c.deliverable_id, []);
    byItem.get(c.deliverable_id).push(c);
  }

  // Frame.io: notes with the time in the video, and a download link. A few at a
  // time, and never more than MAX_FRAMEIO per call.
  const wantFrame = a.frameio !== false && typeof deps.frameio === "function";
  const frameFor = new Map();
  const frameSkipped = [];
  if (wantFrame) {
    const todo = chosen.filter((v) => v.card && isFrame(firstLink(v.card.asset_url)));
    const now = todo.slice(0, MAX_FRAMEIO);
    for (const v of todo.slice(MAX_FRAMEIO)) frameSkipped.push(v.num);
    let at = 0;
    const worker = async () => {
      while (at < now.length) {
        const v = now[at++];
        try { frameFor.set(v, await deps.frameio(firstLink(v.card.asset_url))); } catch (e) { frameFor.set(v, { error: clean(e && e.message) || "Frame.io did not answer." }); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  const out = chosen.map((v) => {
    const d = v.item, c = v.card, b = v.batch;
    const frame = frameFor.get(v);
    const edit = firstLink(c && c.asset_url) || firstLink(d && d.file_url);
    const notes = merge(cardNotes(c), workItemNotes(d ? byItem.get(d.id) : []));
    const fnotes = frame && !frame.error ? frameNotes(frame) : [];
    const card = {
      batch: batchLabel(b),
      video: v.num,
      title: titleOf(d && d.title, c && c.name) || clean((d && d.title) || (c && c.name)),
      status: clean(c && c.video_status) || clean(c && c.status) || clean(d && d.status).replace(/_/g, " "),
      work_item_status: d ? clean(d.status).replace(/_/g, " ") : null,
      brief: clean(d && d.brief) || null,
      // Tweaks still to do: change requests not marked done, and every Frame.io note not marked done.
      open_tweaks: notes.filter((n) => n.tweak && !n.done).length + fnotes.filter((n) => !n.done).length,
      notes,
      frameio_notes: fnotes,
      latest_edit: edit || null,
      raw_footage: firstLink(b && b.footage_folder_url) || null,
      filming_doc: firstLink(b && b.filming_doc_url) || null,
      syncview_card: c ? `${SYNCVIEW}/#calendar/${encodeURIComponent(slug)}/${encodeURIComponent(c.id)}` : null,
      synclinear: d ? `${SYNCVIEW}/?prod=1&d=${encodeURIComponent(d.id)}#production` : null,
      download: null,
    };
    if (v.cardProblem) card.card_problem = v.cardProblem;
    if (frame && frame.error) card.frameio_problem = frame.error;
    else if (frame && frame.comments_error) card.frameio_problem = "The Frame.io notes could not be read this time; the video link still works.";
    else if (frame && frame.comments_truncated) card.frameio_problem = `This video has more than ${fnotes.length} Frame.io notes; only the first ${fnotes.length} are listed. Open latest_edit in Frame.io to see the rest.`;
    if (frame && frame.video) {
      const r = frame.video.renditions || {};
      card.download = {
        edit_video: r.original || r.high_quality || frame.video.url || null,
        edit_video_small: r.efficient || null,
        file_name: clean(frame.video.name) || null,
        link_expires: clean(frame.video.expires_at) || null,
      };
    }
    return card;
  });

  const how = [
    "How to get the files: download.edit_video is a direct download of the latest edit from Frame.io (it expires; call video_cards again for a fresh one).",
    "raw_footage is a Google Drive (or Dropbox) folder: open it in the browser and download the clips, or use the Google Drive connector to list and download them.",
    "For one shared file (not a folder), import_file turns its Drive or Dropbox link into a direct link.",
    "The script is usually in the brief; if not, read it from the filming plan with client_filming_plan.",
  ].join(" ");
  const notes = [...otherBatches];
  if (missing.length) notes.push(`Not found: video${missing.length > 1 ? "s" : ""} ${missing.join(", ")}${clean(a.batch) ? ` in ${batchLabel(picked.list[0])}` : ""}.`);
  if (frameSkipped.length) notes.push(`Frame.io notes were read for the first ${MAX_FRAMEIO} videos only; ask again for video${frameSkipped.length > 1 ? "s" : ""} ${frameSkipped.join(", ")} to get theirs.`);
  if (a.frameio === false) notes.push("Frame.io was not asked (frameio false): no time-stamped notes and no download link.");

  const head = `${name}: ${out.length} video card${out.length > 1 ? "s" : ""} from SyncView (read only).`;
  const body = { client: name, videos: out, how_to_download: how, ...(notes.length ? { notes: notes } : {}) };
  let text = JSON.stringify(body, null, 1);
  if (head.length + text.length > MAX_CHARS) {
    // Too long: keep every card, drop the longest note texts first, and say so.
    const cut = [];
    for (const v of out) {
      for (const n of [...v.notes, ...v.frameio_notes]) if (n.text.length > 600) { n.text = n.text.slice(0, 600) + " [cut]"; if (!cut.includes(v.video)) cut.push(v.video); }
      if (v.brief && v.brief.length > 3000) { v.brief = v.brief.slice(0, 3000) + " [cut]"; if (!cut.includes(v.video)) cut.push(v.video); }
    }
    body.notes = [...(body.notes || []), `Some long notes or briefs were shortened (marked [cut]) for video${cut.length > 1 ? "s" : ""} ${cut.join(", ")}; ask for one video at a time to read them in full.`];
    text = JSON.stringify(body, null, 1);
    if (head.length + text.length > MAX_CHARS) {
      // Still too long: leave out the notes already marked done, and say so.
      for (const v of out) {
        v.notes = v.notes.filter((n) => !n.done);
        v.frameio_notes = v.frameio_notes.filter((n) => !n.done);
      }
      body.notes.push("Notes already marked done were left out for length; ask for one video at a time to see them.");
      text = JSON.stringify(body, null, 1);
      // Still too long: keep the newest notes of the longest list, and count what was left out.
      while (head.length + text.length > MAX_CHARS) {
        const v = [...out].sort((x, y) => (y.notes.length + y.frameio_notes.length) - (x.notes.length + x.frameio_notes.length))[0];
        const total = v.notes.length + v.frameio_notes.length;
        if (total === 0) break;
        const drop = Math.max(1, Math.ceil(total / 4));
        const fromNotes = Math.min(drop, v.notes.length);
        v.notes = v.notes.slice(fromNotes);
        v.frameio_notes = v.frameio_notes.slice(0, Math.max(0, v.frameio_notes.length - (drop - fromNotes)));
        v.older_notes_left_out = (v.older_notes_left_out || 0) + drop;
        if (!body.notes.some((n) => n.startsWith("Older notes were left out"))) body.notes.push("Older notes were left out for length (older_notes_left_out says how many); ask for one video at a time, or open the card in SyncView to read them.");
        text = JSON.stringify(body, null, 1);
      }
    }
  }
  return `${head}\n${text}`;
}
