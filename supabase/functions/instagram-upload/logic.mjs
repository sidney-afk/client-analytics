// Pure logic for the instagram-upload Edge Function: what is allowed, what is sent to Post For Me, and how
// Post For Me's answers become queue statuses. No network, no Deno APIs, so it is tested under Node
// (test/instagram-upload-source.js). The TikTok upload does the same steps inside n8n; this is the Instagram
// twin, kept in a Supabase function on purpose (owner, 2026-09-30).

export const ACCOUNT_ID_RE = /^spc_[A-Za-z0-9]{6,80}$/;
export const MEDIA_URL_RE = /^https:\/\/data\.postforme\.dev\//;
export const PLACEMENTS = Object.freeze(['reels', 'timeline']);
export const MAX_CAPTION_CHARS = 2200;
export const STATUSES = Object.freeze(['uploading', 'scheduled', 'processing', 'posted', 'failed', 'cancelled']);
export const TERMINAL = Object.freeze(['posted', 'failed', 'cancelled']);

const clean = (v) => String(v == null ? '' : v).trim();

// "Fixture Client", "fixtureclient" and "FIXTURE-CLIENT" are the same client.
export function clientKey(name) {
  return clean(name).toLowerCase().replace(/[^a-z0-9&]/g, '');
}

// The safety switch, fail closed: nobody can post until the owner lists clients in the server's
// INSTAGRAM_UPLOAD_ALLOWED_CLIENTS setting ("*" means every client). Nothing is listed in the repository.
export function clientAllowed(client, allowedRaw) {
  const list = clean(allowedRaw);
  if (!list) return false;
  if (list === '*') return true;
  const key = clientKey(client);
  if (!key) return false;
  return list.split(',').map(clientKey).filter(Boolean).includes(key);
}

// The Instagram account this client is supposed to post to, from the synced copy of Clients Info
// (an unknown sheet column is kept in `extra`, under its sheet header).
export const ACCOUNT_COLUMN = 'postforme_instagram_account_id';
export function expectedAccountId(profile) {
  const extra = profile && typeof profile.extra === 'object' && profile.extra ? profile.extra : {};
  return clean(extra[ACCOUNT_COLUMN]);
}

// Which unfinished rows are worth asking Post For Me about, most overdue first: anything in flight, and a
// scheduled post only once its time has come. Rows never asked about go first, then the longest unasked,
// so a pile of future posts can never starve an old one.
export function refreshCandidates(rows, nowMs, limit) {
  const due = (r) => r.status !== 'scheduled' || !r.scheduled_for || Date.parse(r.scheduled_for) <= nowMs;
  const asked = (r) => (r.last_checked_at ? Date.parse(r.last_checked_at) || 0 : 0);
  return (rows || []).filter((r) => needsRefresh(r) && due(r)).sort((a, b) => asked(a) - asked(b)).slice(0, limit);
}

// An Instagram account id never doubles as a TikTok one: Post For Me tells us which network an account is on.
export function platformMismatch(account) {
  const platform = clean(account && account.platform).toLowerCase();
  if (!platform) return 'Post For Me did not say which network that account is on.';
  if (platform !== 'instagram') return 'That Post For Me account is on ' + platform + ', not Instagram.';
  return '';
}

function toUtcIso(raw) {
  const s = clean(raw);
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// Validates the browser's create request and builds both the queue row and the Post For Me body.
// Returns { ok:false, error } or { ok:true, row, postBody }.
export function buildCreate(input, nowMs, actor) {
  const body = input && typeof input === 'object' ? input : {};
  const client = clean(body.clientName || body.client);
  const accountId = clean(body.socialAccountId);
  const title = clean(body.title);
  const mediaUrl = clean(body.mediaUrl);
  if (!client) return { ok: false, error: 'clientName required' };
  if (!ACCOUNT_ID_RE.test(accountId)) return { ok: false, error: 'socialAccountId must be a Post For Me connection id (spc_...)' };
  if (!title) return { ok: false, error: 'caption required' };
  if (title.length > MAX_CAPTION_CHARS) return { ok: false, error: 'caption is over ' + MAX_CAPTION_CHARS + ' characters' };
  if (!MEDIA_URL_RE.test(mediaUrl)) return { ok: false, error: 'mediaUrl must be a Post For Me media url' };

  let options = body.options;
  if (typeof options === 'string') { try { options = JSON.parse(options); } catch { options = {}; } }
  if (!options || typeof options !== 'object') options = {};
  const placement = PLACEMENTS.includes(clean(options.placement)) ? clean(options.placement) : 'reels';
  const coverMs = Number(options.cover_timestamp_ms);

  const scheduledUtc = toUtcIso(body.scheduledAtUTC);
  if (clean(body.scheduledAtUTC) && !scheduledUtc) return { ok: false, error: 'scheduledAtUTC is not a valid time' };
  if (scheduledUtc && Date.parse(scheduledUtc) < nowMs - 60 * 1000) return { ok: false, error: 'scheduled time is in the past' };

  const id = clean(body.idempotencyKey) || ('ig_' + nowMs.toString(36) + '_' + Math.random().toString(36).slice(2, 8));
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return { ok: false, error: 'idempotencyKey has unsupported characters' };

  const media = { url: mediaUrl };
  if (Number.isFinite(coverMs) && coverMs > 0) media.thumbnail_timestamp_ms = Math.round(coverMs);
  const postBody = {
    caption: title,
    social_accounts: [accountId],
    media: [media],
    account_configurations: [{ social_account_id: accountId, configuration: { placement } }],
    external_id: id,
  };
  if (scheduledUtc) postBody.scheduled_at = scheduledUtc;

  const nowIso = new Date(nowMs).toISOString();
  const row = {
    id, client, account_id: accountId, title,
    options: { placement, cover_timestamp_ms: media.thumbnail_timestamp_ms || null },
    scheduled_for: scheduledUtc || null,
    timezone: clean(body.timezone).slice(0, 60),
    status: scheduledUtc ? 'scheduled' : 'uploading',
    post_id: '', instagram_url: '', error: '', posted_at: null,
    created_by: clean(actor).slice(0, 80), created_at: nowIso, updated_at: nowIso,
  };
  return { ok: true, row, postBody };
}

// Post For Me's answer to "create post" becomes the row's next state.
export function applyCreateResponse(row, resp, nowIso) {
  const r = resp && typeof resp === 'object' ? resp : {};
  const postId = r.id ? String(r.id) : '';
  if (!postId) {
    let raw = r.message || r.error || (r.errors && JSON.stringify(r.errors));
    if (raw && typeof raw === 'object') raw = JSON.stringify(raw);
    return { ...row, status: 'failed', error: String(raw || 'Post For Me did not return a post id').slice(0, 280), updated_at: nowIso };
  }
  const pf = clean(r.status);
  let status = 'processing';
  if (row.status === 'scheduled' || pf === 'scheduled') status = 'scheduled';
  else if (pf === 'processed') status = 'posted';
  return { ...row, status, post_id: postId, error: '', posted_at: status === 'posted' ? nowIso : row.posted_at, updated_at: nowIso };
}

// Reads Post For Me's per-network results for one post (GET /v1/social-post-results?post_id=...).
// No result yet means "still going": the row keeps its status.
export function applyResults(row, resultsResp, nowIso) {
  const list = Array.isArray(resultsResp) ? resultsResp
    : Array.isArray(resultsResp && resultsResp.data) ? resultsResp.data : [];
  const mine = list.filter((x) => x && typeof x === 'object' && (!x.post_id || String(x.post_id) === row.post_id));
  if (!mine.length) return row;
  const hit = mine.find((x) => x.success === true);
  if (hit) {
    const pd = hit.platform_data && typeof hit.platform_data === 'object' ? hit.platform_data : {};
    return { ...row, status: 'posted', instagram_url: clean(pd.url), error: '', posted_at: row.posted_at || nowIso, updated_at: nowIso };
  }
  const bad = mine.find((x) => x.success === false);
  if (!bad) return row;
  let base = bad.error;
  if (base && typeof base === 'object') base = base.message || JSON.stringify(base);
  base = clean(base || (bad.details ? JSON.stringify(bad.details) : 'Instagram rejected the post'));
  let detail = '';
  if (bad.details && typeof bad.details === 'object' && bad.details.error) {
    detail = typeof bad.details.error === 'object' ? (bad.details.error.message || JSON.stringify(bad.details.error)) : clean(bad.details.error);
  }
  const msg = (detail && !base.includes(detail) ? base + ': ' + detail : base).slice(0, 280);
  return { ...row, status: 'failed', error: msg, updated_at: nowIso };
}

// Only rows that can still change are worth asking Post For Me about.
export function needsRefresh(row) {
  return !!row && !!row.post_id && !TERMINAL.includes(row.status);
}

// What the browser sees. Account ids stay on the server side of the queue.
export function publicRow(row) {
  const r = row || {};
  return {
    id: r.id, client: r.client, title: r.title, status: r.status,
    scheduled_for: r.scheduled_for || '', timezone: r.timezone || '',
    instagram_url: r.instagram_url || '', error: r.error || '', posted_at: r.posted_at || '',
    created_at: r.created_at || '', updated_at: r.updated_at || '',
    placement: (r.options && r.options.placement) || 'reels',
  };
}
