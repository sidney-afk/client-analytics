// frameio-view logic: from a card's Frame.io link to a playable video address and the file's comments.
// Kept free of Deno so test/frameio-view-source.js runs it under Node with Frame.io faked.
//
// Read-only against Frame.io's V4 API. The access token comes from the frameio-token key keeper and never
// leaves this file: it is not returned, not logged, not put in an error. Nothing is stored anywhere.

export const API = 'https://api.frame.io/v4';
export const BUDGET_MS = 40000; // one open must finish inside this, whatever Frame.io does
const CALL_MS = 12000;
const COMMENT_PAGE = 100;
const MAX_COMMENT_PAGES = 3;
const LIST_PAGE = 50;
const MAX_LIST_PAGES = 20; // a share or folder listing is followed through links.next up to this many pages
const MAX_SEARCH_CALLS = 40; // the most Frame.io calls one search for a named file may spend; past it, the link is refused
export const MAX_LIST_VIDEOS = 50; // part "list" answers with at most this many videos, newest first, and says when it cut
export const MAX_REPLY_LOOKUPS = 30; // V4 leaves the author off a reply, so each name is one extra call
const TOKEN_MARGIN_MS = 120000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const clean = (v) => String(v == null ? '' : v).trim();
const isUuid = (v) => new RegExp('^' + UUID + '$', 'i').test(clean(v));

// A failure the page can show: a short code, a plain sentence, and the HTTP status to answer with.
export class ViewError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}
const MESSAGES = {
  unsupported_link: ['This link is not a Frame.io share or file link, so it cannot be played here.', 422],
  link_not_found: ['Frame.io does not know this link. It may have been deleted or switched off.', 404],
  share_off: ['This Frame.io share link is switched off.', 404],
  share_expired: ['This Frame.io share link has expired.', 404],
  empty_share: ['This Frame.io share has no video in it.', 404],
  folder_link: ["This is a Frame.io folder link, so it does not say which video. Paste the video's own link.", 422],
  file_not_in_share: ["This link's video is not in the Frame.io share any more. Paste the video's own link.", 404],
  not_video: ['This Frame.io file is not a video, so it cannot be played here.', 415],
  still_processing: ['Frame.io is still processing this video. Try again in a minute.', 409],
  no_playable_address: ['Frame.io did not give a playable address for this video.', 502],
  frameio_login_needed: ['The Frame.io connection needs to be signed in again.', 503],
  frameio_busy: ['Frame.io is busy right now. Try again in a minute.', 429],
  frameio_unavailable: ['Frame.io did not answer. Try again in a minute.', 502],
  timeout: ['Frame.io took too long to answer. Try again in a minute.', 504],
};
export function fail(code) { const m = MESSAGES[code] || MESSAGES.frameio_unavailable; return new ViewError(code, m[0], m[1]); }

// ---------------------------------------------------------------- the link

// The first Frame.io link in a card's link field (a field can hold several, separated by spaces or lines).
// Only three shapes are understood; anything else is refused before a single request is made.
export function parseFrameLink(raw) {
  const text = clean(raw);
  const found = [];
  const re = /https?:\/\/[^\s<>"']+/gi;
  let m;
  while ((m = re.exec(text))) found.push(m[0].replace(/[),.;]+$/, ''));
  for (const s of found) {
    let u;
    try { u = new URL(s); } catch { continue; }
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    if (host === 'f.io' && parts.length === 1 && /^[A-Za-z0-9_-]{3,40}$/.test(parts[0])) {
      return { kind: 'short', code: parts[0] };
    }
    if (host === 'next.frame.io') {
      if (parts[0] === 'share' && isUuid(parts[1])) {
        return { kind: 'share', shareId: parts[1].toLowerCase(), assetId: parts[2] === 'view' && isUuid(parts[3]) ? parts[3].toLowerCase() : '' };
      }
      if (parts[0] === 'project' && isUuid(parts[1]) && parts[2] === 'view' && isUuid(parts[3])) {
        const ver = clean(u.searchParams.get('version'));
        return { kind: 'view', projectId: parts[1].toLowerCase(), fileId: parts[3].toLowerCase(), versionId: isUuid(ver) ? ver.toLowerCase() : '' };
      }
    }
  }
  return null;
}

// f.io/<code> is a redirect to next.frame.io/share/<id>. Only the redirect is read; its target must be a share.
async function followShortLink(ctx, code) {
  let resp;
  try {
    resp = await ctx.fetchFn('https://f.io/' + encodeURIComponent(code), { redirect: 'manual', signal: ctx.signal(CALL_MS) });
  } catch { throw fail(ctx.timedOut() ? 'timeout' : 'frameio_unavailable'); }
  const loc = clean(resp.headers && resp.headers.get && resp.headers.get('location'));
  if (resp.status < 300 || resp.status > 399 || !loc) throw fail('link_not_found');
  const next = parseFrameLink(loc);
  if (!next || next.kind === 'short') throw fail('link_not_found');
  return next;
}

// ---------------------------------------------------------------- Frame.io calls

// One GET against V4. A 401 drops the cached token and tries once more; nothing else is retried.
async function api(ctx, path, { optional = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await ctx.token();
    let resp;
    try {
      resp = await ctx.fetchFn(API + path, {
        headers: { Authorization: 'Bearer ' + token, 'x-api-key': ctx.clientId, Accept: 'application/json' },
        signal: ctx.signal(CALL_MS),
      });
    } catch { throw fail(ctx.timedOut() ? 'timeout' : 'frameio_unavailable'); }
    ctx.calls++;
    if (resp.status === 401 && attempt === 0) { ctx.dropToken(); continue; }
    if (resp.status === 401) throw fail('frameio_login_needed');
    if (resp.status === 429) throw fail('frameio_busy');
    if (resp.status === 404 || resp.status === 403) return { missing: true };
    if (resp.status >= 500) throw fail('frameio_unavailable');
    if (resp.status === 400 || resp.status === 422) return { missing: true, rejected: true };
    if (!resp.ok) throw fail('frameio_unavailable');
    try { return await resp.json(); } catch { if (optional) return { missing: true }; throw fail('frameio_unavailable'); }
  }
  throw fail('frameio_unavailable');
}

async function accountIds(ctx) {
  const got = await api(ctx, '/accounts');
  const ids = ((got && got.data) || []).map((a) => clean(a && a.id)).filter(isUuid);
  if (!ids.length) throw fail('link_not_found');
  return ids;
}

// ---------------------------------------------------------------- finding the file

const isVideo = (f) => /^video\//i.test(clean(f && f.media_type));

async function fileFromStack(ctx, acct, stackId) {
  const kids = await api(ctx, '/accounts/' + acct + '/version_stacks/' + stackId + '/children');
  const list = ((kids && kids.data) || []).filter((f) => f && f.type === 'file');
  list.sort((a, b) => clean(b.created_at).localeCompare(clean(a.created_at)));
  return list[0] || null;
}

// A share's asset is the file itself, a version stack (use its newest version), or a folder (use its first video).
async function fileFromAsset(ctx, acct, asset) {
  if (!asset) return null;
  if (asset.type === 'version_stack') return asset.head_version || (await fileFromStack(ctx, acct, asset.id));
  if (asset.type === 'file') return asset;
  if (asset.type === 'folder') {
    const kids = await api(ctx, '/accounts/' + acct + '/folders/' + asset.id + '/children?page_size=50');
    for (const k of ((kids && kids.data) || [])) {
      const f = k && k.type === 'version_stack' ? (k.head_version || null) : (k && k.type === 'file' ? k : null);
      if (f && isVideo(f)) return f;
    }
  }
  return null;
}

// The items of a Frame.io list, following links.next, stopping at the first page that holds an item `found` accepts
// (so a named file on page 1 never waits on, or fails because of, a later page). Each page spends one call from
// `budget`; when the budget or the page cap runs out the list is cut short (and `budget.cut` says so), which can
// only make a named file be refused, never swapped.
async function listAll(ctx, path, budget, found) {
  const out = [];
  for (let page = 0; path; page++) {
    if (page >= MAX_LIST_PAGES || budget.left <= 0) { budget.cut = true; break; }
    budget.left--;
    const got = await api(ctx, path);
    if (got.missing) break;
    for (const x of (got.data || [])) if (x) out.push(x);
    if (out.some(found)) break;
    const next = clean(got.links && got.links.next).replace(/^https:\/\/api\.frame\.io\/v4/i, '');
    path = next.startsWith('/accounts/') ? next : '';
  }
  return out;
}

// The share's item that a /share/<id>/view/<file> link names: on any page of the share, inside a shared folder (at
// any depth), or as an older version inside a version stack. { pick, file? } or null when it is not there.
async function findInShare(ctx, acct, shareId, id) {
  const budget = { left: MAX_SEARCH_CALLS };
  const names = (a) => !!a && (a.id === id || (!!a.head_version && a.head_version.id === id));
  let level = await listAll(ctx, '/accounts/' + acct + '/shares/' + shareId + '/assets?page_size=' + LIST_PAGE, budget, names);
  const stacks = [];
  const seen = new Set();
  while (level.length) {
    const hit = level.find(names);
    if (hit) return { pick: hit };
    const below = [];
    for (const a of level) {
      if (a.type === 'version_stack') stacks.push(a);
      if (a.type === 'folder' && !seen.has(a.id)) {
        seen.add(a.id);
        const kids = await listAll(ctx, '/accounts/' + acct + '/folders/' + a.id + '/children?page_size=' + LIST_PAGE, budget, names);
        const inside = kids.find(names);
        if (inside) return { pick: inside };
        below.push(...kids);
      }
    }
    level = below;
  }
  const isFile = (k) => k.type === 'file' && k.id === id;
  for (const s of stacks) {
    const file = (await listAll(ctx, '/accounts/' + acct + '/version_stacks/' + s.id + '/children', budget, isFile)).find(isFile);
    if (file) return { pick: s, file };
  }
  return null;
}

async function resolveShare(ctx, accounts, link) {
  for (const acct of accounts) {
    const share = await api(ctx, '/accounts/' + acct + '/shares/' + link.shareId);
    if (share.missing || !share.data) continue;
    const s = share.data;
    if (s.enabled === false) throw fail('share_off');
    if (s.expiration && Date.parse(s.expiration) < ctx.now()) throw fail('share_expired');
    let pick = null;
    let file = null;
    let fromFolder = false;
    if (link.assetId) {
      // A link that names a file plays that file or is refused: it never falls back to another video.
      const found = await findInShare(ctx, acct, link.shareId, link.assetId);
      if (!found) throw fail('file_not_in_share');
      pick = found.file || found.pick;
      file = found.file || (await fileFromAsset(ctx, acct, found.pick));
      fromFolder = pick.type === 'folder';
    } else {
      // A bare share (a folder sent as a whole) plays its first video, as before. It counts as one file only when
      // the share holds exactly one item and that item is not a folder.
      const assets = await api(ctx, '/accounts/' + acct + '/shares/' + link.shareId + '/assets');
      const list = (assets && assets.data) || [];
      pick = list[0] || null;
      fromFolder = list.length !== 1 || !!(assets.links && assets.links.next) || (pick && pick.type === 'folder');
      file = await fileFromAsset(ctx, acct, pick);
    }
    if (!file) throw fail('empty_share');
    return { acct, file, fromFolder, openUrl: 'https://next.frame.io/share/' + link.shareId + (pick && pick.id ? '/view/' + pick.id : '') };
  }
  throw fail('link_not_found');
}

async function resolveView(ctx, accounts, link) {
  for (const acct of accounts) {
    const id = link.versionId || link.fileId;
    const got = await api(ctx, '/accounts/' + acct + '/files/' + id);
    if (got.missing || !got.data) continue;
    let file = got.data;
    if (file.type === 'version_stack') file = await fileFromStack(ctx, acct, file.id);
    if (!file) throw fail('empty_share');
    return { acct, file, openUrl: 'https://next.frame.io/project/' + link.projectId + '/view/' + link.fileId + (link.versionId ? '?version=' + link.versionId : '') };
  }
  throw fail('link_not_found');
}

// ---------------------------------------------------------------- part "list": the videos a link points at

// Measured live on 2026-11-03 (two live-check runs): `include=media_links.thumbnail` gives
// `media_links.thumbnail.download_url`, but a listed file carries no `duration`. A length found on the listing is
// still used; a row without one gets it from the file's metadata after the cut (fillDurations).
const durationOf = (f) => (Number(f && f.duration) > 0 ? Number(f.duration) : null);
const thumbOf = (f) => {
  const u = clean(f && f.media_links && f.media_links.thumbnail && f.media_links.thumbnail.download_url);
  return FRAME_HOST.test(u) ? u : '';
};
const THUMB = 'include=media_links.thumbnail';

// One row: the file's facts and the link that plays exactly it (F0 resolves a share link by the asset id it names).
function row(f, link) {
  return {
    file_id: clean(f.id), name: clean(f.name), duration_seconds: durationOf(f), thumbnail_url: thumbOf(f) || null,
    created_at: clean(f.created_at), processing: f.status === 'created' || f.status === 'uploaded', link,
  };
}

// Every video under a share or folder listing, through folders and version stacks (newest version), paged.
// Returns the rows found and whether the walk was cut (pages or folders were left unread).
async function collectVideos(ctx, acct, firstPath, shareId) {
  const budget = { left: MAX_SEARCH_CALLS };
  const rows = new Map();
  const queue = [firstPath];
  const seen = new Set();
  let cut = false;
  while (queue.length) {
    if (budget.left <= 0) { cut = true; break; }
    const items = await listAll(ctx, queue.shift(), budget, () => false);
    for (const a of items) {
      if (a.type === 'folder') {
        if (!seen.has(a.id)) { seen.add(a.id); queue.push('/accounts/' + acct + '/folders/' + a.id + '/children?page_size=' + LIST_PAGE + '&' + THUMB); }
        continue;
      }
      const f = a.type === 'version_stack' ? a.head_version : (a.type === 'file' ? a : null);
      if (!f || !isVideo(f) || rows.has(f.id)) continue;
      rows.set(f.id, row(f, 'https://next.frame.io/share/' + shareId + '/view/' + a.id));
    }
  }
  return { rows: [...rows.values()], cut: cut || !!budget.cut };
}

async function openShare(ctx, accounts, shareId) {
  for (const acct of accounts) {
    const share = await api(ctx, '/accounts/' + acct + '/shares/' + shareId);
    if (share.missing || !share.data) continue;
    const s = share.data;
    if (s.enabled === false) throw fail('share_off');
    if (s.expiration && Date.parse(s.expiration) < ctx.now()) throw fail('share_expired');
    return { acct, s };
  }
  throw fail('link_not_found');
}

// A listed row with no length gets the file's metadata "Duration" (the same read the video part makes), a few rows at
// a time and only for the rows kept. A metadata call that fails, is refused or runs out of time leaves that row's
// length null; it never fails the list.
const DURATION_WORKERS = 5;
async function fillDurations(ctx, acct, rows) {
  const todo = rows.filter((r) => r.duration_seconds == null && r.file_id);
  let at = 0;
  const worker = async () => {
    while (at < todo.length) {
      const r = todo[at++];
      try { r.duration_seconds = (await videoFacts(ctx, acct, r.file_id)).duration; } catch { /* the length stays null */ }
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(DURATION_WORKERS, todo.length); i++) workers.push(worker());
  await Promise.all(workers);
}

// The videos a link points at: every video in a shared folder (up to MAX_LIST_VIDEOS, newest first), or the one video
// a file link names. Names, lengths, Frame's thumbnails and per-file links only: no playable address, no comments.
async function listLink(ctx, link) {
  const resolved = link.kind === 'short' ? await followShortLink(ctx, link.code) : link;
  const accounts = await accountIds(ctx);
  if (resolved.kind === 'view') {
    const found = await resolveView(ctx, accounts, resolved);
    const got = await api(ctx, '/accounts/' + found.acct + '/files/' + found.file.id + '?' + THUMB);
    const f = (got && got.data) || found.file;
    return { acct: found.acct, name: clean(f.name), rows: isVideo(f) ? [row(f, found.openUrl)] : [], cut: false, openUrl: found.openUrl };
  }
  const { acct, s } = await openShare(ctx, accounts, resolved.shareId);
  const shareUrl = 'https://next.frame.io/share/' + resolved.shareId;
  let name = clean(s.name);
  let walk;
  if (resolved.assetId) {
    const found = await findInShare(ctx, acct, resolved.shareId, resolved.assetId);
    if (!found) throw fail('file_not_in_share');
    if (found.pick.type === 'folder') {
      name = clean(found.pick.name) || name;
      walk = await collectVideos(ctx, acct, '/accounts/' + acct + '/folders/' + found.pick.id + '/children?page_size=' + LIST_PAGE + '&' + THUMB, resolved.shareId);
    } else {
      const file = found.file || (await fileFromAsset(ctx, acct, found.pick));
      const got = file ? await api(ctx, '/accounts/' + acct + '/files/' + file.id + '?' + THUMB) : null;
      const f = (got && got.data) || file;
      walk = { rows: f && isVideo(f) ? [row(f, shareUrl + '/view/' + (found.file ? found.file.id : found.pick.id))] : [], cut: false };
    }
  } else {
    walk = await collectVideos(ctx, acct, '/accounts/' + acct + '/shares/' + resolved.shareId + '/assets?page_size=' + LIST_PAGE + '&' + THUMB, resolved.shareId);
  }
  return { acct, name, rows: walk.rows, cut: walk.cut, openUrl: shareUrl + (resolved.assetId ? '/view/' + resolved.assetId : '') };
}

// ---------------------------------------------------------------- the video address

// When the address stops working: the earlier of the signed link's own Expires and the stream token's exp.
export function addressExpiry(url, nowMs) {
  const times = [];
  try {
    const q = new URL(url).searchParams;
    const e = Number(q.get('Expires'));
    if (e > 0) times.push(e * 1000);
    const t = clean(q.get('token')).split('.');
    if (t.length >= 2) {
      const pad = t[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(pad + '='.repeat((4 - (pad.length % 4)) % 4)));
      if (Number(payload.exp) > 0) times.push(Number(payload.exp) * 1000);
    }
  } catch { /* fall through to the default */ }
  const at = times.length ? Math.min(...times) : nowMs + 3600000;
  return new Date(at).toISOString();
}

const FRAME_HOST = /^https:\/\/[a-z0-9.-]+\.frame\.io\//i;

// Every playable address Frame.io gave for the file, by name. "efficient" is a small 360p proxy (about 1 Mbit/s),
// "high_quality" is the full-size H.264 (about 4 Mbit/s), "original" is the upload itself. Measured 2026-10-16
// on one vertical 1080x1920 test file: all three start playing (the index is at the front of each file).
export function pickRenditions(links) {
  const l = links || {};
  const out = {};
  const put = (name, u) => { const v = clean(u); if (FRAME_HOST.test(v)) out[name] = v; };
  put('efficient', l.efficient && l.efficient.download_url);
  put('high_quality', l.high_quality && l.high_quality.download_url);
  put('original', l.original && l.original.inline_url);
  return out;
}

// The one to start with: the full-size H.264 when there is one (the page falls back to the small one only on a slow
// connection), else the small proxy, else the original upload (last: it can be a format a browser cannot play).
export function pickAddress(links) {
  const r = pickRenditions(links);
  return r.high_quality || r.efficient || r.original || '';
}

async function playable(ctx, acct, fileId) {
  const got = await api(ctx, '/accounts/' + acct + '/files/' + fileId + '?include=media_links.efficient,media_links.high_quality,media_links.original');
  if (got.missing || !got.data) throw fail('link_not_found');
  const f = got.data;
  if (!isVideo(f)) throw fail('not_video');
  if (f.status === 'created') throw fail('still_processing');
  const renditions = pickRenditions(f.media_links);
  const url = renditions.high_quality || renditions.efficient || renditions.original || '';
  if (!url) throw fail(f.status === 'uploaded' ? 'still_processing' : 'no_playable_address');
  return { name: clean(f.name), url, renditions };
}

async function videoFacts(ctx, acct, fileId) {
  const got = await api(ctx, '/accounts/' + acct + '/files/' + fileId + '/metadata', { optional: true });
  const out = { fps: null, duration: null };
  for (const m of ((got && got.metadata) || (got && got.data && got.data.metadata) || [])) {
    const n = Number(m && m.value);
    if (m && m.field_definition_name === 'Frame Rate' && n > 0 && n < 240) out.fps = n;
    if (m && m.field_definition_name === 'Duration' && n > 0) out.duration = n;
  }
  return out;
}

// ---------------------------------------------------------------- comments

const person = (owner) => {
  const name = clean(owner && owner.name);
  return name ? { name, guest: false } : { name: '', guest: true };
};

async function commentsFor(ctx, acct, fileId, fps) {
  const out = []; let truncated = false;
  let path = '/accounts/' + acct + '/files/' + fileId + '/comments?include=owner,replies&page_size=' + COMMENT_PAGE;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const got = await api(ctx, path);
    if (got.missing) break;
    for (const c of (got.data || [])) out.push(c);
    const next = got.links && got.links.next;
    if (!next) { truncated = false; break; }
    truncated = true;
    path = String(next).replace(/^https:\/\/api\.frame\.io\/v4/i, '');
    if (!path.startsWith('/accounts/')) break;
  }
  // V4 leaves the author off every reply. Ask for each one by itself (capped), so a team member's name shows.
  const replies = [];
  for (const c of out) for (const r of (c.replies || [])) replies.push(r);
  const budget = replies.slice(0, MAX_REPLY_LOOKUPS);
  const names = new Map();
  let at = 0;
  const worker = async () => {
    while (at < budget.length) {
      const r = budget[at++];
      try {
        const got = await api(ctx, '/accounts/' + acct + '/comments/' + r.id + '?include=owner', { optional: true });
        names.set(r.id, person(got && got.data && got.data.owner));
      } catch (e) {
        if (e instanceof ViewError && (e.code === 'frameio_login_needed' || e.code === 'timeout')) throw e;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  const shape = (c, isReply) => {
    const who = isReply ? (names.get(c.id) || { name: '', guest: true }) : person(c.owner);
    const frame = Number(c.timestamp);
    const o = {
      id: clean(c.id), text: clean(c.text), author: who.name, guest: who.guest, created_at: clean(c.created_at),
    };
    if (!isReply) {
      o.frame = Number.isFinite(frame) && frame >= 0 ? frame : null;
      o.time_seconds = o.frame != null && fps ? Math.round((o.frame / fps) * 100) / 100 : null;
      o.done = !!c.completed_at;
      o.replies = (c.replies || []).map((r) => shape(r, true)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    return o;
  };
  const top = out.map((c) => shape(c, false));
  top.sort((a, b) => (a.time_seconds == null ? -1 : a.time_seconds) - (b.time_seconds == null ? -1 : b.time_seconds) || a.created_at.localeCompare(b.created_at));
  return { comments: top, truncated, replyNamesPartial: replies.length > budget.length };
}

// ---------------------------------------------------------------- the whole lookup

// A link's file is stable for a minute: remembering it saves the redirect, the account search, the share and the
// asset calls (five of the seven Frame.io calls of an open) for the hover-then-click and for repeat opens. Short on
// purpose: a new version uploaded to the stack shows within a minute. Opt in with deps.cache (a Map).
export const RESOLVE_TTL_MS = 60000;
const RESOLVE_CACHE_MAX = 200;
function cacheKey(link) {
  if (link.kind === 'short') return 's:' + link.code;
  if (link.kind === 'share') return 'sh:' + link.shareId + ':' + (link.assetId || '');
  return 'v:' + link.projectId + ':' + link.fileId + ':' + (link.versionId || '');
}
async function resolveLink(ctx, link, cache) {
  const key = cacheKey(link);
  const hit = cache && cache.get(key);
  if (hit && ctx.now() - hit.at < RESOLVE_TTL_MS) return hit.found;
  const run = async () => {
    const resolved = link.kind === 'short' ? await followShortLink(ctx, link.code) : link;
    const accounts = await accountIds(ctx);
    return resolved.kind === 'share' ? await resolveShare(ctx, accounts, resolved) : await resolveView(ctx, accounts, resolved);
  };
  if (!cache) return run();
  // The promise is what is remembered, so the video request and the comments request that arrive together share
  // one search; a failed search is forgotten at once.
  const found = run();
  if (cache.size >= RESOLVE_CACHE_MAX) cache.clear();
  cache.set(key, { at: ctx.now(), found });
  found.catch(() => { const cur = cache.get(key); if (cur && cur.found === found) cache.set(key, { at: 0, found }); });
  return found;
}

// deps: { fetchFn, getToken(), dropToken(), clientId, now(), cache? }. Returns the body to send, or throws a ViewError.
// opts.part: "all" (the default), "video" (the playable addresses only: fast, so the player can start) or "comments"
// (the comments only, asked for in parallel so they never hold the video back).
// opts.client === true is the client's lookup: comments are never asked for from Frame.io, so there is nothing to
// leak, and only the playable addresses and what is needed to play them come back.
export async function lookup(rawLink, deps, opts = {}) {
  const link = parseFrameLink(rawLink);
  if (!link) throw fail('unsupported_link');
  const started = deps.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BUDGET_MS);
  const ctx = {
    fetchFn: deps.fetchFn, clientId: deps.clientId, now: deps.now, calls: 0,
    token: deps.getToken, dropToken: deps.dropToken,
    timedOut: () => ctrl.signal.aborted,
    signal: (ms) => (typeof AbortSignal.any === 'function' ? AbortSignal.any([ctrl.signal, AbortSignal.timeout(ms)]) : ctrl.signal),
  };
  const client = opts.client === true || opts.comments === false;
  const part = client ? 'video' : (['video', 'comments', 'list'].includes(opts.part) ? opts.part : 'all');
  try {
    if (part === 'list') {
      const got = await listLink(ctx, link);
      got.rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      const videos = got.rows.slice(0, MAX_LIST_VIDEOS);
      await fillDurations(ctx, got.acct, videos);
      return {
        ok: true, name: got.name, videos, truncated: got.cut || got.rows.length > MAX_LIST_VIDEOS,
        open_url: got.openUrl, fetched_at: new Date(deps.now()).toISOString(), took_ms: deps.now() - started,
      };
    }
    const found = await resolveLink(ctx, link, deps.cache);
    // opts.strict: the exact file or a refusal. A folder link (bare, or naming a folder) does not say which video.
    if (opts.strict === true && found.fromFolder) throw fail('folder_link');
    const fetchedAt = new Date(deps.now()).toISOString();
    if (part === 'comments') {
      const facts = await videoFacts(ctx, found.acct, found.file.id);
      let com = { comments: [], truncated: false, replyNamesPartial: false }, commentsError = '';
      try { com = await commentsFor(ctx, found.acct, found.file.id, facts.fps); } catch (e) {
        commentsError = e instanceof ViewError ? e.code : 'frameio_unavailable';
      }
      return { ok: true, comments: com.comments, comments_error: commentsError, comments_truncated: com.truncated, reply_names_partial: com.replyNamesPartial, open_url: found.openUrl, fetched_at: fetchedAt, took_ms: deps.now() - started };
    }
    // The address and the file's facts do not depend on each other.
    const [video, facts] = await Promise.all([playable(ctx, found.acct, found.file.id), videoFacts(ctx, found.acct, found.file.id)]);
    const addr = { url: video.url, renditions: video.renditions, expires_at: addressExpiry(video.url, deps.now()), duration_seconds: facts.duration, fps: facts.fps };
    if (client) return { ok: true, video: addr, fetched_at: fetchedAt };
    const shaped = { ...addr, name: video.name, file_id: found.file.id };
    if (part === 'video') return { ok: true, video: shaped, open_url: found.openUrl, fetched_at: fetchedAt, took_ms: deps.now() - started };
    // Comments are a bonus: if only they fail, the video still plays.
    let com = { comments: [], truncated: false, replyNamesPartial: false }, commentsError = '';
    try { com = await commentsFor(ctx, found.acct, found.file.id, facts.fps); } catch (e) {
      commentsError = e instanceof ViewError ? e.code : 'frameio_unavailable';
    }
    return {
      ok: true,
      video: shaped,
      comments: com.comments,
      comments_error: commentsError,
      comments_truncated: com.truncated,
      reply_names_partial: com.replyNamesPartial,
      open_url: found.openUrl,
      fetched_at: fetchedAt,
      took_ms: deps.now() - started,
    };
  } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------- the access token

// The key keeper hands out an Adobe access token (about an hour). It is kept in memory for this instance only.
export function tokenSource({ fetchFn, brokerUrl, brokerKey, now = Date.now }) {
  let cached = null;
  return {
    async get() {
      if (cached && cached.until > now()) return cached.token;
      let resp;
      try {
        resp = await fetchFn(brokerUrl, { method: 'POST', headers: { 'x-broker-key': brokerKey }, signal: AbortSignal.timeout(30000) });
      } catch { throw fail('frameio_unavailable'); }
      if (resp.status === 401) throw fail('frameio_login_needed');
      if (!resp.ok) throw fail('frameio_unavailable');
      const body = await resp.json().catch(() => ({}));
      const token = clean(body.access_token);
      if (!token) throw fail('frameio_unavailable');
      const lifeMs = Math.max(0, Number(body.expires_in) || 0) * 1000;
      cached = { token, until: now() + lifeMs - TOKEN_MARGIN_MS };
      return token;
    },
    drop() { cached = null; },
  };
}
