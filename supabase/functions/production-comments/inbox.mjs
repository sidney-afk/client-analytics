// Messages inbox (Notes Step 2, docs/plans/2026-10-13-notes-messages.md).
//
// Pure helpers for production-comments' staff-only `inbox`, `inbox_mark`
// actions. This is the ONE place the inbox reads notes from: the card's
// *_tweaks lists plus the canonical production_comments rows Step 1 already
// writes. When team-only notes move out of the card (privacy rule 12), only
// collectMessages() changes its source.
//
// Who sees what (owner, 2026-10-13):
//   - admin not on the SMM roster (Kasper): every client
//   - anyone on the roster, admins included: their own clients, plus the
//     smm_also_sees grants (the same rule as "My clients", 098-smm-clients)
//   - editors and designers: nothing (they are not part of Messages)
//   - a post that is posted or archived leaves the inbox (it stays on the card)
//
// Which messages each view shows (owner, 2026-10-14), decided here, never in
// the browser:
//   - SMM view (anyone on the roster, admins included): team-only notes, and
//     client notes that are plain comments. A client change request (the
//     "Request changes" button, saved with is_tweak true) is hidden, with its
//     replies.
//   - reviewer view (an admin not on the roster): team-only notes written by
//     an SMM, the reviewer's own notes, and every team-only staff reply
//     (editors included) in a thread the reviewer started or replied to.
//     Never a client message.
// A conversation left with no visible message is dropped, and hidden
// messages never count as unread.

export const COMPONENTS = ["video", "graphic", "caption", "title"];
export const UNREAD_WINDOW_DAYS = 14; // with no read mark, older messages count as read
const TITLES = /^(?:dr|doctor|mr|mrs|ms|miss|prof|professor)\.?\s+/;

export function clean(value) {
  return String(value == null ? "" : value).trim();
}

// Same key as svClientKey (src/index/098-smm-clients.js.part).
export function clientKey(name) {
  let t = clean(name).toLowerCase();
  try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (_e) { /* ascii fallback */ }
  t = t.replace(TITLES, "").replace(/&/g, " and ");
  return t.replace(/[^a-z0-9]+/g, "");
}

// Same match as svRosterEntryFor: email, then full name, then a unique first name.
export function rosterEntryFor(managers, member) {
  const norm = (v) => clean(v).toLowerCase().replace(/\s+/g, " ");
  const list = (Array.isArray(managers) ? managers : []).filter((m) => m && m.active !== false && clean(m.name));
  const email = norm(member && member.email);
  const name = norm(member && member.name);
  const first = name.split(" ")[0];
  const byFirst = first ? list.filter((m) => norm(m.name).split(" ")[0] === first) : [];
  return (email && list.find((m) => norm(m.email) === email))
    || (name && list.find((m) => norm(m.name) === name))
    || (byFirst.length === 1 ? byFirst[0] : null);
}

// Which client slugs a staff member's inbox covers. Returns "all", or a Set.
export function inboxScope(member, managers, alsoSees, clients) {
  const role = clean(member && member.role).toLowerCase();
  if (role !== "admin" && role !== "smm") return new Set();
  const entry = rosterEntryFor(managers, member);
  if (role === "admin" && !entry) return "all";
  const owned = new Set((entry && Array.isArray(entry.source_clients) ? entry.source_clients : []).map(clientKey));
  const bySlug = new Map((Array.isArray(managers) ? managers : []).filter((m) => m && m.active !== false).map((m) => [clean(m.slug), m]));
  for (const g of Array.isArray(alsoSees) ? alsoSees : []) {
    if (!g || clean(g.viewer_member_id) !== clean(member && member.id)) continue;
    if (g.client_name) owned.add(clientKey(g.client_name));
    const m = g.manager_slug ? bySlug.get(clean(g.manager_slug)) : null;
    if (m && Array.isArray(m.source_clients)) for (const c of m.source_clients) owned.add(clientKey(c));
  }
  owned.delete("");
  const out = new Set();
  for (const c of Array.isArray(clients) ? clients : []) {
    if (!c || c.active === false) continue;
    if (owned.has(clientKey(c.display_name)) || owned.has(clientKey(c.slug))) out.add(clean(c.slug));
  }
  return out;
}

export function isClosedPost(post) {
  const s = clean(post && post.status).toLowerCase();
  return s === "posted" || s === "archived" || !!clean(post && post.posted_at);
}

function parseList(raw) {
  const text = clean(raw);
  if (!text || !/^\[/.test(text)) return [];
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch (_e) { return []; }
}

const sameName = (a, b) => clean(a).toLowerCase().replace(/\s+/g, " ") === clean(b).toLowerCase().replace(/\s+/g, " ");

// Every live message on one post, oldest first: card notes plus canonical rows.
export function collectMessages(post, canonicalRows) {
  const seen = new Set();
  const out = [];
  const push = (m) => {
    const key = clean(m.id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  // Canonical rows are listed under native_comment_id, but their parent and
  // thread root are database row ids: translate those to the listed ids.
  const rows = (Array.isArray(canonicalRows) ? canonicalRows : []).filter((row) => row && !row.deleted_at);
  const listedId = new Map(rows.map((row) => [clean(row.id), clean(row.native_comment_id) || clean(row.id)]));
  const toListed = (v) => (clean(v) ? listedId.get(clean(v)) || clean(v) : "");
  for (const row of rows) {
    const id = clean(row.native_comment_id) || clean(row.id);
    const root = toListed(row.thread_root_id);
    push({
      id,
      parent_id: root && root !== id ? root : (toListed(row.parent_id) || null),
      author: clean(row.author_name),
      author_member_id: clean(row.author_member_id),
      role: clean(row.role),
      body: clean(row.body),
      audience: clean(row.audience),
      is_tweak: row.is_tweak === true,
      component: clean(row.component) || (clean(row.team) === "graphics" ? "graphic" : "video"),
      created_at: clean(row.source_created_at) || clean(row.created_at),
    });
  }
  for (const comp of COMPONENTS) {
    const list = parseList(post && post[comp + "_tweaks"]);
    for (const m of list) {
      if (!m || m.deleted || m.hidden || !clean(m.id)) continue;
      push({
        id: clean(m.id),
        parent_id: clean(m.parent_id) || null,
        author: clean(m.author),
        author_member_id: clean(m.author_member_id),
        role: clean(m.role),
        body: clean(m.body),
        audience: clean(m.audience),
        is_tweak: m.is_tweak === true,
        component: comp,
        created_at: clean(m.created_at),
      });
    }
  }
  // A reply carries its first message's part and audience.
  const byId = new Map(out.map((m) => [m.id, m]));
  for (const m of out) {
    const root = m.parent_id && byId.has(m.parent_id) ? byId.get(m.parent_id) : m;
    m.root_id = root.id;
    m.component = root.component;
    m.audience = root.audience === "client" ? "client" : "internal";
  }
  out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return out;
}

export function inboxView(scope) {
  return scope === "all" ? "reviewer" : "smm";
}

// Written by an SMM: the writer's member id is in smmIds. A staff note saved
// before the id was stored falls back to the role the note carries.
export function isSmmAuthor(message, smmIds) {
  const id = clean(message && message.author_member_id);
  if (id) return !!(smmIds && smmIds.has(id));
  return clean(message && message.role).toLowerCase() === "smm";
}

const isClientChangeRequest = (m) => clean(m && m.role).toLowerCase() === "client" && m.is_tweak === true;

// The messages one view may see, from collectMessages() output.
// Notes written on the Kasper dashboard are stored as role "kasper" with no
// member id; in the reviewer view they are the reviewer's own.
const isReviewerNote = (m) => clean(m && m.role).toLowerCase() === "kasper" && !clean(m && m.author_member_id);

// The client message a staff reply answers: the client message it replies to
// directly, else the latest client message before it in the same thread.
function answeredClientMessage(reply, list) {
  const parent = list.find((m) => m.id === reply.parent_id);
  if (parent && isClientMessage(parent)) return parent;
  let hit = null;
  for (const m of list) {
    if (m.root_id === reply.root_id && isClientMessage(m) && m.created_at <= reply.created_at) hit = m;
  }
  return hit;
}
const isClientMessage = (m) => clean(m && m.role).toLowerCase() === "client";

// Hidden client messages come back when a staff reply answers them, so the
// thread reads properly (owner, 2026-10-15). In the SMM view any staff reply
// counts; in the reviewer view only the reviewer's own reply does, and that
// reply is shown with it. Unanswered ones stay hidden.
export function visibleMessages(messages, view, smmIds, member) {
  const list = Array.isArray(messages) ? messages : [];
  if (view === "reviewer") {
    const mine = (m) => !!member && !isClientMessage(m) && isMine(m, member);
    const staffInternal = list.filter((m) => m.audience === "internal" && !isClientMessage(m))
      .map((m) => (isReviewerNote(m) && member && clean(member.id) ? { ...m, author_member_id: clean(member.id) } : m));
    const own = (m) => !!member && isMine(m, member);
    const joined = new Set(staffInternal.filter(own).map((m) => m.root_id));
    const keep = new Set(staffInternal.filter((m) => own(m) || joined.has(m.root_id) || isSmmAuthor(m, smmIds)).map((m) => m.id));
    for (const r of list) {
      if (!mine(r)) continue;
      const answered = answeredClientMessage(r, list);
      if (answered) { keep.add(answered.id); keep.add(r.id); }
    }
    const byId = new Map(staffInternal.map((m) => [m.id, m]));
    return list.filter((m) => keep.has(m.id)).map((m) => byId.get(m.id) || m);
  }
  const answered = new Set();
  for (const r of list) {
    if (isClientMessage(r)) continue;
    const a = answeredClientMessage(r, list);
    if (a) answered.add(a.id);
  }
  const hidden = (m) => isClientChangeRequest(m) && !answered.has(m.id);
  const hiddenRoots = new Set(list.filter(hidden).map((m) => m.id));
  return list.filter((m) => !hidden(m) && !hiddenRoots.has(m.root_id));
}

// Yours when it carries your member id. Staff notes written before the id
// was stored fall back to the name match; a client-written note is never
// yours, even when the client's name equals yours.
export function isMine(message, member) {
  const id = clean(message && message.author_member_id);
  if (id) return id === clean(member && member.id);
  if (clean(message && message.role).toLowerCase() === "client") return false;
  return sameName(message && message.author, member && member.name);
}

export function unreadCount(messages, member, lastReadAt, nowMs) {
  const floor = clean(lastReadAt)
    || new Date((nowMs || Date.now()) - UNREAD_WINDOW_DAYS * 86400000).toISOString();
  return messages.filter((m) => m.created_at > floor && !isMine(m, member)).length;
}

// The read mark that makes a conversation unread again: just before the
// newest message someone else wrote. Null when there is nothing to mark.
export function unreadMark(messages, member) {
  const others = messages.filter((m) => !isMine(m, member));
  if (!others.length) return null;
  const newest = Date.parse(others[others.length - 1].created_at);
  return Number.isFinite(newest) ? new Date(newest - 1).toISOString() : null;
}

export function buildConversation(post, messages, member, lastReadAt, nowMs) {
  const last = messages[messages.length - 1];
  return {
    post_id: clean(post.id),
    client_slug: clean(post.client),
    title: clean(post.name),
    thumbnail_url: clean(post.thumbnail_url),
    asset_url: clean(post.asset_url),
    status: clean(post.status),
    last_at: last ? last.created_at : "",
    last_author: last ? last.author : "",
    last_author_member_id: last ? last.author_member_id : "",
    last_role: last ? last.role : "",
    last_body: last ? last.body.slice(0, 160) : "",
    unread: unreadCount(messages, member, lastReadAt, nowMs),
    messages,
  };
}
