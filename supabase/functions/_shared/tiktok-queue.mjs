// Pure logic for the TikTok upload queue (table public.tiktok_uploads), shared by the tiktok-upload and
// tiktok-upload-cancel Edge Functions: what is sent to Post For Me, how its answers become queue statuses,
// what the page sees, and how a TikTokUpload Sheet row is copied in. No network and no Deno APIs, so
// test/tiktok-upload-source.js runs it under Node.
//
// Ported from the n8n workflows it replaces (read 2026-10-07, not edited): "SyncView TikTok Upload, Submit
// (Direct)" Build Upload Row / Build Post Body / Merge Upload Response, "Status" Build Response and "Result"
// Parse Result. The Post For Me request is the same one n8n sends.

export const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
export const ACCOUNT_ID_RE = /^spc_[A-Za-z0-9]{6,80}$/;
export const MEDIA_URL_RE = /^https:\/\/data\.postforme\.dev\//;
export const MAX_CAPTION_CHARS = 4000;
export const MAX_PHOTOS = 35;
export const STATUSES = Object.freeze(['queued', 'uploading', 'processing', 'scheduled', 'posted', 'failed', 'cancelled']);
export const OPEN = Object.freeze(['queued', 'uploading', 'processing', 'scheduled']);
export const TERMINAL = Object.freeze(['posted', 'failed', 'cancelled']);
// The column on the synced Clients Info copy (client_profiles) that holds a client's TikTok connection.
export const ACCOUNT_COLUMN = 'postforme_account_id';
export const SHEET_TAB = 'TikTokUpload';
export const SHEET_COLUMNS = Object.freeze(['id', 'client', 'profile', 'title', 'post_comment', 'options_json', 'scheduled_for',
  'timezone', 'status', 'upload_post_id', 'tiktok_url', 'error', 'posted_at', 'created_at', 'updated_at']);

const clean = (v) => String(v == null ? '' : v).trim();

// "Fixture Client", "fixtureclient" and "FIXTURE-CLIENT" are the same client (same rule as instagram-upload).
export function clientKey(name) {
  return clean(name).toLowerCase().replace(/[^a-z0-9&]/g, '');
}

export function expectedAccountId(profile) {
  return clean(profile && profile[ACCOUNT_COLUMN]);
}

// The page sends the client's display name. A few slugs are not the display name with spaces and punctuation
// taken out, so a client is found by either; a name that matches two clients finds none (fail closed).
export function findClientProfile(profiles, client) {
  const key = clientKey(client);
  if (!key) return null;
  const hits = (profiles || []).filter((p) => p && (clean(p.slug) === key || clientKey(p.display_name) === key));
  const bySlug = hits.filter((p) => clean(p.slug) === key);
  if (bySlug.length === 1) return bySlug[0];
  return hits.length === 1 ? hits[0] : null;
}

// A TikTok account id never doubles as an Instagram one: Post For Me says which network an account is on.
// TikTok accounts are 'tiktok' or 'tiktok_business'.
export function platformMismatch(account) {
  const platform = clean(account && account.platform).toLowerCase();
  if (!platform) return 'Post For Me did not say which network that account is on.';
  if (platform !== 'tiktok' && platform !== 'tiktok_business') return 'That Post For Me account is on ' + platform + ', not TikTok.';
  return '';
}

function toUtcIso(raw) {
  const s = clean(raw);
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// Wall-clock "YYYY-MM-DDTHH:MM" in a named time zone -> UTC ISO. The n8n fallback when no UTC time was sent.
export function wallClockToUtc(rawLocal, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(clean(rawLocal));
  if (!m || !clean(tz)) return '';
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: clean(tz), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(dtf.formatToParts(new Date(naive)).map((x) => [x.type, x.value]));
    const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return new Date(naive - (asTz - naive)).toISOString();
  } catch {
    return '';
  }
}

function parseMaybeJson(v, fallback) {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string' && v.trim()) { try { return JSON.parse(v); } catch { return fallback; } }
  return fallback;
}

// Validates the page's create request and builds both the queue row and the Post For Me body.
// Returns { ok:false, error } or { ok:true, row, postBody }.
export function buildCreate(input, nowMs, actor) {
  const body = input && typeof input === 'object' ? input : {};
  const client = clean(body.clientName || body.client);
  const accountId = clean(body.socialAccountId || body.profile);
  const title = clean(body.title);
  const mediaUrl = clean(body.mediaUrl);
  let mediaUrls = parseMaybeJson(body.mediaUrls, null);
  if (mediaUrls != null && !Array.isArray(mediaUrls)) return { ok: false, error: 'mediaUrls must be a list' };
  if (mediaUrls) mediaUrls = mediaUrls.map(clean).filter(Boolean);
  if (!client) return { ok: false, error: 'clientName required' };
  if (!ACCOUNT_ID_RE.test(accountId)) return { ok: false, error: 'socialAccountId must be a Post For Me connection id (spc_...)' };
  if (!title) return { ok: false, error: 'title required' };
  if (title.length > MAX_CAPTION_CHARS) return { ok: false, error: 'caption is over ' + MAX_CAPTION_CHARS + ' characters' };
  const urls = mediaUrls && mediaUrls.length ? mediaUrls : (mediaUrl ? [mediaUrl] : []);
  if (!urls.length) return { ok: false, error: 'mediaUrl or mediaUrls required' };
  if (urls.length > MAX_PHOTOS) return { ok: false, error: 'at most ' + MAX_PHOTOS + ' photos' };
  if (urls.some((u) => !MEDIA_URL_RE.test(u))) return { ok: false, error: 'mediaUrl(s) must be Post For Me media urls' };
  const carousel = !!(mediaUrls && mediaUrls.length);

  let options = parseMaybeJson(body.options, {});
  if (!options || typeof options !== 'object' || Array.isArray(options)) options = {};

  const tz = clean(body.timezone).slice(0, 80);
  let scheduledUtc = toUtcIso(body.scheduledAtUTC);
  if (clean(body.scheduledAtUTC) && !scheduledUtc) return { ok: false, error: 'scheduledAtUTC is not a valid time' };
  if (!scheduledUtc && clean(body.scheduledAt)) scheduledUtc = wallClockToUtc(body.scheduledAt, tz);
  if (scheduledUtc && Date.parse(scheduledUtc) < nowMs - 60 * 1000) return { ok: false, error: 'scheduled time is in the past' };

  const id = clean(body.idempotencyKey) || ('tk_' + nowMs.toString(36) + '_' + Math.random().toString(36).slice(2, 8));
  if (!ID_RE.test(id)) return { ok: false, error: 'idempotencyKey has unsupported characters' };

  // Same TikTok settings n8n builds: Post For Me takes public or private only.
  const priv = clean(options.privacy_level || 'PUBLIC_TO_EVERYONE').toUpperCase();
  const configuration = {
    privacy_status: priv === 'PUBLIC_TO_EVERYONE' ? 'public' : 'private',
    allow_comment: !options.disable_comment,
    allow_duet: !options.disable_duet,
    allow_stitch: !options.disable_stitch,
    disclose_your_brand: !!options.brand_organic_toggle,
    disclose_branded_content: !!options.brand_content_toggle,
    is_ai_generated: !!options.is_aigc,
    is_draft: clean(options.post_mode || 'DIRECT_POST').toUpperCase() === 'MEDIA_UPLOAD',
  };
  if (carousel) configuration.auto_add_music = options.auto_add_music !== false;
  configuration.localizations = null;

  const media = urls.map((url) => ({ url }));
  const coverMs = Number(options.cover_timestamp_ms);
  if (!carousel && Number.isFinite(coverMs) && coverMs > 0) media[0].thumbnail_timestamp_ms = Math.round(coverMs);

  const postBody = {
    caption: title,
    social_accounts: [accountId],
    media,
    account_configurations: [{ social_account_id: accountId, configuration }],
    external_id: id,
  };
  if (scheduledUtc) postBody.scheduled_at = scheduledUtc;

  const nowIso = new Date(nowMs).toISOString();
  const row = {
    id, client, profile: accountId, title, post_comment: '',
    options_json: options,
    scheduled_for: scheduledUtc || null,
    timezone: tz,
    status: scheduledUtc ? 'scheduled' : 'uploading',
    upload_post_id: '', tiktok_url: '', error: '', posted_at: null,
    created_at: nowIso, updated_at: nowIso,
    post_body: postBody, created_by: clean(actor).slice(0, 120), source: 'syncview',
  };
  return { ok: true, row, postBody };
}

function errorText(resp) {
  let raw = resp && (resp.message || resp.error || (resp.errors && JSON.stringify(resp.errors)));
  if (raw && typeof raw === 'object') raw = JSON.stringify(raw);
  if (!raw) raw = typeof resp === 'string' ? resp : JSON.stringify(resp || {});
  return String(raw || 'Post For Me did not return a post id').slice(0, 280);
}

// Post For Me's answer to "create post" becomes the row's next state (n8n Merge Upload Response).
export function applyCreateResponse(row, resp, nowIso) {
  const r = resp && typeof resp === 'object' ? resp : {};
  const postId = r.id ? String(r.id) : '';
  if (!postId) return { ...row, status: 'failed', error: errorText(r), updated_at: nowIso };
  const pf = clean(r.status);
  let status = 'processing';
  if (row.scheduled_for || pf === 'scheduled') status = 'scheduled';
  else if (pf === 'processed') status = 'posted';
  return { ...row, status, upload_post_id: postId, tiktok_url: '', error: '', posted_at: status === 'posted' ? nowIso : row.posted_at, updated_at: nowIso };
}

// What Post For Me's results say about one post (GET /v1/social-post-results?post_id=...), the same answer
// the n8n Status workflow gave: { state: 'posted', url } | { state: 'failed', error } | { state: 'none' }.
// A bad answer is { state: 'unknown' }.
export function resultState(resp, postId) {
  const list = Array.isArray(resp) ? resp : Array.isArray(resp && resp.data) ? resp.data : null;
  if (!list) return { state: 'unknown' };
  const mine = list.filter((x) => x && typeof x === 'object' && (!x.post_id || String(x.post_id) === postId));
  const ok = mine.find((x) => x.success === true);
  if (ok) return { state: 'posted', url: clean((ok.platform_data && ok.platform_data.url) || '') };
  const bad = mine.find((x) => x.success === false);
  if (!bad) return { state: 'none' };
  // The top-level error is generic ("Failed to post to TikTok"); TikTok's own reason sits in details.error.
  let base = bad.error;
  if (base && typeof base === 'object') base = base.message || JSON.stringify(base);
  base = clean(base || (bad.details ? JSON.stringify(bad.details) : 'TikTok rejected the post'));
  let detail = '';
  if (bad.details && typeof bad.details === 'object' && bad.details.error) {
    detail = typeof bad.details.error === 'object' ? (bad.details.error.message || JSON.stringify(bad.details.error)) : clean(bad.details.error);
  }
  return { state: 'failed', error: (detail && !base.includes(detail) ? base + ': ' + detail : base).slice(0, 280) };
}

// A result becomes the row's next state; no result yet keeps the row as it is.
export function applyResults(row, resultsResp, nowIso) {
  const st = resultState(resultsResp, row.upload_post_id);
  if (st.state === 'posted') return { ...row, status: 'posted', tiktok_url: st.url, error: '', posted_at: row.posted_at || nowIso, updated_at: nowIso };
  if (st.state === 'failed') return { ...row, status: 'failed', error: st.error, updated_at: nowIso };
  return row;
}

// Only rows that can still change, with a post id, are worth asking Post For Me about.
export function needsRefresh(row) {
  return !!row && !!row.upload_post_id && OPEN.includes(row.status);
}

// Which open rows to ask about on a list, most overdue first: anything in flight, and a scheduled post only
// once its time has come. Never-asked rows first, then the longest unasked, so none starves.
export function refreshCandidates(rows, nowMs, limit) {
  const due = (r) => r.status !== 'scheduled' || !r.scheduled_for || Date.parse(r.scheduled_for) <= nowMs;
  const asked = (r) => (r.last_checked_at ? Date.parse(r.last_checked_at) || 0 : 0);
  return (rows || []).filter((r) => needsRefresh(r) && due(r)).sort((a, b) => asked(a) - asked(b)).slice(0, limit);
}

// The safety net (OPEN_REPAIRS 369): every open row whose time has come, not only the newest page the queue
// shows. A row without a post id is included too, so its post can be found by external_id. Never-asked rows
// first, then the longest unasked, so a row Post For Me never answers for cannot starve the others.
export function sweepCandidates(rows, nowMs, limit) {
  const due = (r) => !r.scheduled_for || Date.parse(r.scheduled_for) <= nowMs;
  const asked = (r) => (r.last_checked_at ? Date.parse(r.last_checked_at) || 0 : 0);
  const seen = new Set();
  return (rows || []).filter((r) => r && OPEN.includes(r.status) && due(r) && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => asked(a) - asked(b)).slice(0, limit);
}

// ---- Post For Me's result webhook --------------------------------------------------------------------
// Post For Me sends { event_type, data } with the webhook's secret in the header "Post-For-Me-Webhook-Secret"
// (its docs, "Security"; there is no HMAC). Only social.post.result.created changes a row.
export const WEBHOOK_EVENT = 'social.post.result.created';
export const WEBHOOK_HEADER = 'post-for-me-webhook-secret';

// Constant-time compare, so the secret cannot be guessed one character at a time from response timing.
export function sameSecret(given, expected) {
  const a = String(given == null ? '' : given), b = String(expected == null ? '' : expected);
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
  return diff === 0;
}

// The webhook Post For Me holds for this URL (GET /v1/webhooks answer), or null.
export function webhookFor(listResp, url) {
  const list = Array.isArray(listResp) ? listResp : Array.isArray(listResp && listResp.data) ? listResp.data : [];
  return list.find((w) => w && clean(w.url) === url) || null;
}

const iso = (v) => (v ? new Date(v).toISOString() : '');

// What the page sees: the Sheet row's fields, as strings, like the n8n list returned. The account id and the
// stored Post For Me request stay on the server.
export function publicRow(row) {
  const r = row || {};
  return {
    id: r.id, client: r.client, title: r.title || '', status: r.status,
    scheduled_for: iso(r.scheduled_for), timezone: r.timezone || '',
    upload_post_id: r.upload_post_id || '', tiktok_url: r.tiktok_url || '', error: r.error || '',
    posted_at: iso(r.posted_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  };
}

// A failed post can be sent again only when its exact request was kept (rows sent through the Edge Function).
export function retryPlan(row, nowMs) {
  if (!row) return { ok: false, code: 'not_found', error: 'That upload is not in the queue.' };
  if (row.status !== 'failed') return { ok: false, code: 'not_failed', error: 'Only a failed upload can be retried.' };
  if (!row.post_body || typeof row.post_body !== 'object') {
    return { ok: false, code: 'no_request', error: 'This upload was sent before the move off n8n, so it cannot be retried here. Upload it again.' };
  }
  const postBody = { ...row.post_body };
  if (postBody.scheduled_at && Date.parse(postBody.scheduled_at) < nowMs + 60 * 1000) delete postBody.scheduled_at;
  const nowIso = new Date(nowMs).toISOString();
  const next = {
    ...row, post_body: postBody, scheduled_for: postBody.scheduled_at || null,
    status: postBody.scheduled_at ? 'scheduled' : 'uploading', upload_post_id: '', tiktok_url: '', error: '', posted_at: null,
    last_checked_at: null, updated_at: nowIso,
  };
  return { ok: true, row: next, postBody };
}

// ---- The one-time copy of the TikTokUpload Sheet tab -------------------------------------------------

// Sheet cells are written RAW as ISO text by n8n; a cell Google turned into a date serial is converted too.
export function sheetTime(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400000);
    return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
  }
  const s = clean(v);
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? s + ':00Z' : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// One Sheet row (header -> cell) -> { ok:true, row, note? } or { ok:false, reason }.
export function sheetRowToRow(cells, nowIso) {
  const g = (k) => (cells && cells[k] != null ? String(cells[k]) : '');
  const id = clean(g('id'));
  if (!ID_RE.test(id)) return { ok: false, reason: 'bad_id' };
  const client = clean(g('client')).slice(0, 200);
  if (!client) return { ok: false, reason: 'no_client' };
  let status = clean(g('status')).toLowerCase();
  if (status === 'canceled') status = 'cancelled';
  let error = clean(g('error')).slice(0, 600);
  let note = '';
  if (!status) status = 'queued';
  if (!STATUSES.includes(status)) {
    note = 'unknown_status';
    error = ('Status in the Sheet was "' + status.slice(0, 40) + '". ' + error).slice(0, 600);
    status = 'failed';
  }
  let options = parseMaybeJson(g('options_json'), {});
  if (!options || typeof options !== 'object' || Array.isArray(options)) options = {};
  const createdAt = sheetTime(cells && cells.created_at) || sheetTime(cells && cells.updated_at) || nowIso;
  const row = {
    id, client,
    profile: clean(g('profile')).slice(0, 200),
    title: g('title').slice(0, 4000),
    post_comment: g('post_comment').slice(0, 4000),
    options_json: options,
    scheduled_for: sheetTime(cells && cells.scheduled_for),
    timezone: clean(g('timezone')).slice(0, 80),
    status,
    upload_post_id: clean(g('upload_post_id')).slice(0, 200),
    tiktok_url: clean(g('tiktok_url')).slice(0, 1000),
    error,
    posted_at: sheetTime(cells && cells.posted_at),
    created_at: createdAt,
    updated_at: sheetTime(cells && cells.updated_at) || createdAt,
    created_by: 'sheet-copy',
    source: 'sheet',
  };
  return note ? { ok: true, row, note } : { ok: true, row };
}

// The whole tab (first row = headers) -> the rows to copy, last one wins on a repeated id, plus counts.
export function planSheetCopy(values, nowIso) {
  const header = (values && values[0] ? values[0] : []).map((h) => clean(h));
  const missing = ['id', 'client', 'status'].filter((c) => !header.includes(c));
  if (missing.length) return { ok: false, error: 'TikTokUpload tab is missing columns: ' + missing.join(', ') };
  const byId = new Map();
  const counts = { sheet_rows: 0, valid: 0, skipped_bad_id: 0, skipped_no_client: 0, unknown_status: 0, repeated_id: 0 };
  for (let i = 1; i < values.length; i++) {
    const raw = values[i] || [];
    if (!raw.some((c) => clean(c))) continue;
    counts.sheet_rows++;
    const cells = {};
    header.forEach((h, j) => { if (h) cells[h] = raw[j]; });
    const out = sheetRowToRow(cells, nowIso);
    if (!out.ok) { counts[out.reason === 'bad_id' ? 'skipped_bad_id' : 'skipped_no_client']++; continue; }
    if (out.note === 'unknown_status') counts.unknown_status++;
    if (byId.has(out.row.id)) counts.repeated_id++;
    byId.set(out.row.id, out.row);
  }
  counts.valid = byId.size;
  return { ok: true, rows: [...byId.values()], counts };
}
