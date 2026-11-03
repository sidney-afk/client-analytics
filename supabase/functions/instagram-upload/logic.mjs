// Pure logic for the instagram-upload Edge Function: what is allowed, what is sent to Post For Me, and how
// Post For Me's answers become queue statuses. No network, no Deno APIs, so it is tested under Node
// (test/instagram-upload-source.js). The TikTok upload does the same steps inside n8n; this is the Instagram
// twin, kept in a Supabase function on purpose (owner, 2026-09-30).

export const ACCOUNT_ID_RE = /^spc_[A-Za-z0-9]{6,80}$/;
export const MEDIA_URL_RE = /^https:\/\/data\.postforme\.dev\//;
// Instagram treats a video post as a Reel, so a Reel is the only placement offered (Post For Me is told it
// explicitly rather than left to pick a default).
export const PLACEMENT = 'reels';
// A carousel is one feed post of several items (images and videos may mix). Post For Me takes it as several
// media on one post with placement "timeline"; Instagram allows 2 to 10 items in one carousel.
export const CAROUSEL_PLACEMENT = 'timeline';
export const CAROUSEL_MIN_ITEMS = 2;
export const CAROUSEL_MAX_ITEMS = 10;
export const KINDS = Object.freeze(['reel', 'carousel']);
export const MAX_CAPTION_CHARS = 2200;
// With Instagram unticked, the longest caption any other network here takes (YouTube's description, 5,000 bytes).
export const OTHER_CAPTION_MAX_CHARS = 5000;
// A trial reel is shown to non-followers first. Only Post For Me's "manual" kind is offered: the reel stays
// a trial until someone shares it to followers in the Instagram app. "performance" (Instagram shares it by
// itself if it does well) is refused, so a trial can never reach followers without a person deciding.
export const TRIAL_REEL_TYPES = Object.freeze(['manual']);
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

// The Instagram account this client is supposed to post to, from the client's profile (client_profiles.extra; set through roster-write)
// (an unknown sheet column is kept in `extra`, under its sheet header).
// The page sends the client's display name. A few slugs are not the display
// name with spaces and punctuation taken out ("Dr." is dropped, " and " becomes
// "&", accents go), so a client is found by its slug or its display name, and a
// name that matches two clients finds none (fail closed). Same rule as the
// TikTok side (_shared/tiktok-queue.mjs). Before 2026-10-10 Instagram looked up
// only `slug = clientKey(name)`, so two active clients would have been refused
// with "no Instagram account" once they had one (OPEN_REPAIRS 398).
export function findClientProfile(profiles, client) {
  const key = clientKey(client);
  if (!key) return null;
  const hits = (profiles || []).filter((p) => p && (clean(p.slug) === key || clientKey(p.display_name) === key));
  const bySlug = hits.filter((p) => clean(p.slug) === key);
  if (bySlug.length === 1) return bySlug[0];
  return hits.length === 1 ? hits[0] : null;
}

// Cancel, Post For Me first (same rule as tiktok-upload-cancel, OPEN_REPAIRS 361): the row may say
// Cancelled only when Post For Me no longer holds a post that can publish. Before 2026-10-10 Instagram
// trusted its own "scheduled" row, sent the DELETE and marked the row cancelled on a 2xx or a 404, so a
// Reel that had already gone out (or was going out) showed as Cancelled (OPEN_REPAIRS 398).
//   pfm(method, path) -> { ok, status, data }, never throws.
//   -> 'cancelled' | 'already_posted' | 'cancel_failed'
export const PFM_GONE_OUT = Object.freeze(['processing', 'processed']);
export const PFM_CANCELLABLE = Object.freeze(['draft', 'scheduled']);
function resultsSayPosted(resp, postId) {
  const list = Array.isArray(resp) ? resp : Array.isArray(resp && resp.data) ? resp.data : [];
  return list.some((x) => x && typeof x === 'object' && x.success === true && (!x.post_id || String(x.post_id) === postId));
}
export async function cancelInPostForMe(pfm, postId) {
  const id = clean(postId);
  if (!id) return 'cancel_failed';
  const path = '/social-posts/' + encodeURIComponent(id);
  const status = (r) => clean(r && r.data && r.data.status).toLowerCase();
  const goneOrPosted = async () => {
    const res = await pfm('GET', '/social-post-results?post_id=' + encodeURIComponent(id));
    if (!res.ok) return 'cancel_failed';
    return resultsSayPosted(res.data, id) ? 'already_posted' : 'cancelled';
  };
  const before = await pfm('GET', path);
  if (before.status === 404) return goneOrPosted();
  if (!before.ok) return 'cancel_failed';
  if (PFM_GONE_OUT.includes(status(before))) return 'already_posted';
  if (!PFM_CANCELLABLE.includes(status(before))) return 'cancel_failed';
  const del = await pfm('DELETE', path);
  if (!del.ok && del.status !== 404) {
    const again = await pfm('GET', path);
    return again.ok && PFM_GONE_OUT.includes(status(again)) ? 'already_posted' : 'cancel_failed';
  }
  const after = await pfm('GET', path);
  if (after.status !== 404) return after.ok && PFM_GONE_OUT.includes(status(after)) ? 'already_posted' : 'cancel_failed';
  return goneOrPosted();
}

export const ACCOUNT_COLUMN = 'postforme_instagram_account_id';
export function expectedAccountId(profile) {
  const extra = profile && typeof profile.extra === 'object' && profile.extra ? profile.extra : {};
  return clean(extra[ACCOUNT_COLUMN]);
}

// The client's Facebook Page, as Post For Me knows it (added 2026-10-31, OPEN_REPAIRS 620). Set on the
// client's profile from the Kasper Clients tab (client-profile-write); kept in client_profiles.extra.
// Instagram's own "also share to Facebook" does not apply to a post published through the API, so a
// cross-post is one Post For Me post sent to both accounts.
export const FACEBOOK_ACCOUNT_COLUMN = 'postforme_facebook_account_id';
export function expectedFacebookAccountId(profile) {
  const extra = profile && typeof profile.extra === 'object' && profile.extra ? profile.extra : {};
  return clean(extra[FACEBOOK_ACCOUNT_COLUMN]);
}
// From Post For Me's API reference (FacebookConfigurationDto, read 2026-10-31): placement is one of
// reels / stories / timeline; a Reel goes to Facebook as a Facebook Reel ("reels"); several images on
// "timeline" are a Facebook carousel, and set_caption_for_each_image:false keeps the caption on the post
// only, not repeated under every photo. Facebook takes a carousel of images only here: a carousel with a
// video goes to Instagram only (the page says so and the server refuses it).
export const FACEBOOK_REEL_PLACEMENT = 'reels';
export const FACEBOOK_CAROUSEL_PLACEMENT = 'timeline';
export const NETWORK_TERMINAL = TERMINAL;

// Which unfinished rows are worth asking Post For Me about, most overdue first: anything in flight, and a
// scheduled post only once its time has come. Rows never asked about go first, then the longest unasked,
// so a pile of future posts can never starve an old one.
export function refreshCandidates(rows, nowMs, limit) {
  const due = (r) => r.status !== 'scheduled' || !r.scheduled_for || Date.parse(r.scheduled_for) <= nowMs;
  const asked = (r) => (r.last_checked_at ? Date.parse(r.last_checked_at) || 0 : 0);
  return (rows || []).filter((r) => needsRefresh(r) && due(r)).sort((a, b) => asked(a) - asked(b)).slice(0, limit);
}

// An Instagram account id never doubles as a TikTok one: Post For Me tells us which network an account is on.
export const NETWORK_NAMES = Object.freeze({ instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn' });
export function platformMismatch(account, want = 'instagram') {
  const platform = clean(account && account.platform).toLowerCase();
  const name = NETWORK_NAMES[want] || 'Instagram';
  if (!platform) return 'Post For Me did not say which network that account is on.';
  if (platform !== want) return 'That Post For Me account is on ' + platform + ', not ' + name + '.';
  return '';
}

// Reads "also post to Facebook" from the browser's create request. Returns { error, facebook }: error is ''
// when it is fine, and facebook is null (Instagram only) or { account_id }. A trial reel is an Instagram feature,
// so it never goes to Facebook; a carousel goes only when every item is an image (itemTypes, one per item).
function facebookFromInput(body, { kind, trial, accountId, items }) {
  const want = body.alsoFacebook === true || clean(body.alsoFacebook).toLowerCase() === 'true';
  if (!want) return { error: '', facebook: null };
  const fbId = clean(body.facebookAccountId);
  if (!ACCOUNT_ID_RE.test(fbId)) return { error: 'facebookAccountId must be a Post For Me connection id (spc_...)', facebook: null };
  if (fbId === accountId) return { error: 'the Facebook account cannot be the Instagram account', facebook: null };
  if (trial) return { error: 'a trial reel is for Instagram only, not Facebook', facebook: null };
  if (kind === 'carousel') {
    const types = Array.isArray(body.itemTypes) ? body.itemTypes.map((t) => clean(t).toLowerCase()) : [];
    if (types.length !== items) return { error: 'a Facebook carousel needs itemTypes, one per item', facebook: null };
    if (!types.every((t) => t === 'image')) return { error: 'Facebook takes a carousel of images only; this one has a video', facebook: null };
  }
  return { error: '', facebook: { account_id: fbId } };
}

/* YouTube and LinkedIn (plan row P3, decision D5, OPEN_REPAIRS 652). One Post for Me post carries every ticked
   network, as Facebook does. The page sends each account id and YouTube's title and format; the server checks every
   id against the client's profile and Post for Me's own platform before anything is written (checkNetworkAccounts),
   and made for kids comes from the profile only (applyProfileSettings), never from the page. */
export const YOUTUBE_ACCOUNT_COLUMN = 'postforme_youtube_account_id';
export const LINKEDIN_ACCOUNT_COLUMN = 'postforme_linkedin_account_id';
export const MADE_FOR_KIDS_COLUMN = 'youtube_made_for_kids';
export const ACCOUNT_COLUMNS = Object.freeze({ instagram: ACCOUNT_COLUMN, facebook: FACEBOOK_ACCOUNT_COLUMN, youtube: YOUTUBE_ACCOUNT_COLUMN, linkedin: LINKEDIN_ACCOUNT_COLUMN });
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;
export const LINKEDIN_CAPTION_MAX = 3000;
export const YOUTUBE_FORMATS = Object.freeze(['short', 'regular']);
export const YOUTUBE_SHORT_MAX_SECONDS = 180;
export const YOUTUBE_PRIVACY = 'public';
const byteLength = (s) => new TextEncoder().encode(String(s)).length;
function networksFromInput(body, { trial, title, instagramOn, ids }) {
  const out = { error: '', youtube: null, linkedin: null };
  const seen = new Set(ids);
  const takeId = (raw, name) => {
    const id = clean(raw);
    if (!ACCOUNT_ID_RE.test(id)) return { error: name + ' accountId must be a Post For Me connection id (spc_...)' };
    if (seen.has(id)) return { error: 'the ' + name + ' account cannot be the same as another network\'s' };
    seen.add(id);
    return { id };
  };
  if (trial && (body.youtube || body.linkedin || !instagramOn)) return { ...out, error: 'a trial reel is for Instagram only' };
  if (body.youtube) {
    const y = typeof body.youtube === 'object' ? body.youtube : {};
    const got = takeId(y.accountId, 'YouTube');
    if (got.error) return { ...out, error: got.error };
    const ytTitle = clean(y.title).replace(/\s+/g, ' ');
    if (!ytTitle) return { ...out, error: 'a YouTube post needs a title' };
    if (ytTitle.length > YOUTUBE_TITLE_MAX) return { ...out, error: 'the YouTube title is over ' + YOUTUBE_TITLE_MAX + ' characters' };
    if (/[<>]/.test(ytTitle)) return { ...out, error: 'YouTube does not take < or > in a title' };
    if (byteLength(title) > YOUTUBE_DESCRIPTION_MAX_BYTES) return { ...out, error: 'the caption is too long for a YouTube description (5,000 bytes)' };
    const format = clean(y.format).toLowerCase() || 'short';
    if (!YOUTUBE_FORMATS.includes(format)) return { ...out, error: 'YouTube format must be short or regular' };
    if (format === 'short') {
      // YouTube itself makes a vertical video of 3 minutes or less a Short; Post for Me has no Shorts flag. What the
      // page knows of the file is checked here; an unknown length or shape is left to YouTube.
      const secs = Number(y.durationSeconds), w = Number(y.width), h = Number(y.height);
      if (secs > YOUTUBE_SHORT_MAX_SECONDS) {
        const m = Math.floor(secs / 60), sec = String(Math.round(secs % 60)).padStart(2, '0');
        return { ...out, error: 'A Short is at most 3 minutes; this video is ' + m + ':' + sec + '. Post it as a regular video.' };
      }
      if (w > 0 && h > 0 && w >= h) return { ...out, error: 'A Short is a vertical video; this one is ' + w + '×' + h + '. Post it as a regular video.' };
    }
    out.youtube = { account_id: got.id, title: ytTitle, format };
  }
  if (body.linkedin) {
    const l = typeof body.linkedin === 'object' ? body.linkedin : {};
    const got = takeId(l.accountId, 'LinkedIn');
    if (got.error) return { ...out, error: got.error };
    if (title.length > LINKEDIN_CAPTION_MAX) return { ...out, error: 'the caption is over LinkedIn\'s ' + LINKEDIN_CAPTION_MAX + ' characters' };
    out.linkedin = { account_id: got.id };
  }
  return out;
}
function youtubeConfiguration(y) {
  return { title: y.title, privacy_status: YOUTUBE_PRIVACY, made_for_kids: false };
}
function networkRowPart(accountId, status) {
  return { account_id: accountId, status, url: '', error: '', posted_at: null };
}

// Made for kids is a legal declaration: it comes from the client's profile (extra.youtube_made_for_kids === true;
// off when absent), never from the page. Applied to both the post body and the row once the profile is read.
export function applyProfileSettings(row, postBody, profile) {
  const yt = row && row.options && row.options.youtube;
  if (!yt) return { row, postBody };
  const extra = profile && typeof profile.extra === 'object' && profile.extra ? profile.extra : {};
  const kids = extra[MADE_FOR_KIDS_COLUMN] === true;
  const configs = (postBody.account_configurations || []).map((c) => (c && c.configuration && 'made_for_kids' in c.configuration)
    ? { ...c, configuration: { ...c.configuration, made_for_kids: kids } } : c);
  return { row: { ...row, options: { ...row.options, youtube: { ...yt, made_for_kids: kids } } }, postBody: { ...postBody, account_configurations: configs } };
}

// Every network of the post other than an Instagram primary (that one keeps its own long-standing check in
// index.ts), each as { name, account_id }.
export function checkedNetworks(row) {
  const o = (row && row.options) || {};
  const list = [];
  if (o.network) list.push({ name: o.network, account_id: row.account_id });
  for (const name of ['youtube', 'linkedin']) {
    const p = o.networks && o.networks[name];
    if (p && p.account_id) list.push({ name, account_id: p.account_id });
  }
  return list;
}
/* Each of those accounts must be the one on the client's profile, and Post for Me must say it is on that network.
   getAccount(id) -> { ok, status, data } (Post for Me's GET /social-accounts/:id). Answers { ok:true } or
   { ok:false, status, error }. Runs before anything is written. */
export async function checkNetworkAccounts(row, profile, getAccount) {
  const extra = profile && typeof profile.extra === 'object' && profile.extra ? profile.extra : {};
  for (const n of checkedNetworks(row)) {
    const label = NETWORK_NAMES[n.name] || n.name;
    const expected = clean(extra[ACCOUNT_COLUMNS[n.name]]);
    if (!expected) return { ok: false, status: 409, error: 'No ' + label + ' account on file for this client. Untick ' + label + ', or ask Sidney to connect it in Post for Me and add it to the client\'s profile.' };
    if (expected !== n.account_id) return { ok: false, status: 403, error: 'That ' + label + ' account is not the one on file for this client.' };
    const acct = await getAccount(n.account_id);
    if (!acct || !acct.ok) {
      return acct && acct.status === 404
        ? { ok: false, status: 400, error: 'Post For Me does not know that ' + label + ' account id.' }
        : { ok: false, status: 502, error: 'Could not check the ' + label + ' account with Post For Me. Try again.' };
    }
    const mismatch = platformMismatch(acct.data, n.name);
    if (mismatch) return { ok: false, status: 400, error: mismatch };
  }
  return { ok: true };
}

// The Facebook part of a queue row (options.facebook): its own status, link and error, apart from
// Instagram's, so one network's failure never hides the other's success.
function facebookRowPart(accountId, placement, status) {
  return { account_id: accountId, placement, status, url: '', error: '', posted_at: null };
}

function toUtcIso(raw) {
  const s = clean(raw);
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// Validates the browser's create request and builds both the queue row and the Post For Me body.
// `kind` is "reel" (the default: one video, placement reels) or "carousel" (see buildCarousel).
// Returns { ok:false, error } or { ok:true, row, postBody }.
export function buildCreate(input, nowMs, actor) {
  const body = input && typeof input === 'object' ? input : {};
  const client = clean(body.clientName || body.client);
  const accountId = clean(body.socialAccountId);
  const title = clean(body.title);
  const mediaUrl = clean(body.mediaUrl);
  const kind = clean(body.kind).toLowerCase() || 'reel';
  if (!KINDS.includes(kind)) return { ok: false, error: 'kind must be reel or carousel' };
  const instagramOn = !(body.instagram === false || clean(body.instagram).toLowerCase() === 'false');
  const wantsMore = !!(body.youtube || body.linkedin);
  if (kind === 'carousel') {
    if (wantsMore || !instagramOn) return { ok: false, error: 'a carousel goes to Instagram (and Facebook) only, not YouTube or LinkedIn' };
    return buildCarousel(body, nowMs, actor, { client, accountId, title });
  }
  if (!client) return { ok: false, error: 'clientName required' };
  if (instagramOn && !ACCOUNT_ID_RE.test(accountId)) return { ok: false, error: 'socialAccountId must be a Post For Me connection id (spc_...)' };
  if (!instagramOn && clean(accountId)) return { ok: false, error: 'socialAccountId is for Instagram, which is not ticked' };
  if (!title) return { ok: false, error: 'caption required' };
  // Instagram's 2,200 is the limit only when Instagram is ticked; YouTube and LinkedIn check their own below.
  if (title.length > (instagramOn ? MAX_CAPTION_CHARS : OTHER_CAPTION_MAX_CHARS)) return { ok: false, error: 'caption is over ' + (instagramOn ? MAX_CAPTION_CHARS : OTHER_CAPTION_MAX_CHARS) + ' characters' };
  if (!MEDIA_URL_RE.test(mediaUrl)) return { ok: false, error: 'mediaUrl must be a Post For Me media url' };
  if (body.mediaUrls != null) return { ok: false, error: 'mediaUrls is only for a carousel' };

  let options = body.options;
  if (typeof options === 'string') { try { options = JSON.parse(options); } catch { options = {}; } }
  if (!options || typeof options !== 'object') options = {};
  const placement = PLACEMENT;
  const coverMs = Number(options.cover_timestamp_ms);
  const trialRaw = clean(options.trial_reel_type).toLowerCase();
  if (trialRaw && !TRIAL_REEL_TYPES.includes(trialRaw)) return { ok: false, error: 'trial_reel_type must be manual' };
  const trial = trialRaw || null;
  // The cover: an uploaded image (already in Post For Me storage) or a frame of the video, never both.
  // Post For Me documents both fields on a media item and does not say which wins, so only one is ever sent.
  const coverUrl = clean(body.coverUrl);
  if (coverUrl && !MEDIA_URL_RE.test(coverUrl)) return { ok: false, error: 'coverUrl must be a Post For Me media url' };

  const scheduledUtc = toUtcIso(body.scheduledAtUTC);
  if (clean(body.scheduledAtUTC) && !scheduledUtc) return { ok: false, error: 'scheduledAtUTC is not a valid time' };
  if (scheduledUtc && Date.parse(scheduledUtc) < nowMs - 60 * 1000) return { ok: false, error: 'scheduled time is in the past' };

  const id = clean(body.idempotencyKey) || ('ig_' + nowMs.toString(36) + '_' + Math.random().toString(36).slice(2, 8));
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return { ok: false, error: 'idempotencyKey has unsupported characters' };

  const fb = facebookFromInput(body, { kind: 'reel', trial, accountId });
  if (fb.error) return { ok: false, error: fb.error };
  const more = networksFromInput(body, { trial, title, instagramOn, ids: [instagramOn ? accountId : '', fb.facebook ? fb.facebook.account_id : ''].filter(Boolean) });
  if (more.error) return { ok: false, error: more.error };
  if (!instagramOn && !fb.facebook && !more.youtube && !more.linkedin) return { ok: false, error: 'tick at least one network' };
  if (!instagramOn && (coverUrl || (Number.isFinite(coverMs) && coverMs > 0)) && !more.youtube) return { ok: false, error: 'a cover is for Instagram or YouTube' };

  const media = { url: mediaUrl };
  let cover = null;
  if (coverUrl) { media.thumbnail_url = coverUrl; cover = 'image'; }
  else if (Number.isFinite(coverMs) && coverMs > 0) { media.thumbnail_timestamp_ms = Math.round(coverMs); cover = 'frame'; }
  const configuration = { placement };
  if (trial) configuration.trial_reel_type = trial;
  const postBody = {
    caption: title,
    social_accounts: instagramOn ? [accountId] : [],
    media: [media],
    account_configurations: instagramOn ? [{ social_account_id: accountId, configuration }] : [],
    external_id: id,
  };
  if (fb.facebook) {
    postBody.social_accounts.push(fb.facebook.account_id);
    postBody.account_configurations.push({ social_account_id: fb.facebook.account_id, configuration: { placement: FACEBOOK_REEL_PLACEMENT } });
  }
  if (more.youtube) {
    postBody.social_accounts.push(more.youtube.account_id);
    postBody.account_configurations.push({ social_account_id: more.youtube.account_id, configuration: youtubeConfiguration(more.youtube) });
  }
  // LinkedIn takes nothing extra for a video: the caption and the media are the post's own.
  if (more.linkedin) postBody.social_accounts.push(more.linkedin.account_id);
  if (scheduledUtc) postBody.scheduled_at = scheduledUtc;

  const nowIso = new Date(nowMs).toISOString();
  const status0 = scheduledUtc ? 'scheduled' : 'uploading';
  const rowOptions = { placement, cover, cover_timestamp_ms: media.thumbnail_timestamp_ms || null, trial_reel_type: trial };
  // The row's own account_id / status / instagram_url describe the first ticked network (Instagram, else
  // Facebook, else YouTube, else LinkedIn); options.network names it when it is not Instagram, so every row
  // written before P3 reads as Instagram, unchanged.
  const primary = instagramOn ? { name: 'instagram', account_id: accountId }
    : fb.facebook ? { name: 'facebook', account_id: fb.facebook.account_id }
    : more.youtube ? { name: 'youtube', account_id: more.youtube.account_id }
    : { name: 'linkedin', account_id: more.linkedin.account_id };
  if (primary.name !== 'instagram') rowOptions.network = primary.name;
  if (fb.facebook && primary.name !== 'facebook') rowOptions.facebook = facebookRowPart(fb.facebook.account_id, FACEBOOK_REEL_PLACEMENT, status0);
  if (more.youtube) rowOptions.youtube = { title: more.youtube.title, format: more.youtube.format, privacy_status: YOUTUBE_PRIVACY, made_for_kids: false };
  const parts = {};
  if (more.youtube && primary.name !== 'youtube') parts.youtube = networkRowPart(more.youtube.account_id, status0);
  if (more.linkedin && primary.name !== 'linkedin') parts.linkedin = networkRowPart(more.linkedin.account_id, status0);
  if (Object.keys(parts).length) rowOptions.networks = parts;
  const row = {
    id, client, account_id: primary.account_id, title,
    options: rowOptions,
    scheduled_for: scheduledUtc || null,
    timezone: clean(body.timezone).slice(0, 60),
    status: scheduledUtc ? 'scheduled' : 'uploading',
    post_id: '', instagram_url: '', error: '', posted_at: null,
    created_by: clean(actor).slice(0, 80), created_at: nowIso, updated_at: nowIso,
  };
  return { ok: true, row, postBody };
}

function parseOptions(raw) {
  let options = raw;
  if (typeof options === 'string') { try { options = JSON.parse(options); } catch { options = {}; } }
  return options && typeof options === 'object' ? options : {};
}

// A carousel: 2 to 10 items, every one already in Post For Me storage, in the order they will show. The same
// client, account, caption, schedule and key checks as a Reel. Reel-only things (a trial, a cover image or
// frame) are refused rather than dropped, so nothing the SMM picked is silently ignored.
function buildCarousel(body, nowMs, actor, { client, accountId, title }) {
  if (!client) return { ok: false, error: 'clientName required' };
  if (!ACCOUNT_ID_RE.test(accountId)) return { ok: false, error: 'socialAccountId must be a Post For Me connection id (spc_...)' };
  if (!title) return { ok: false, error: 'caption required' };
  if (title.length > MAX_CAPTION_CHARS) return { ok: false, error: 'caption is over ' + MAX_CAPTION_CHARS + ' characters' };
  if (!Array.isArray(body.mediaUrls)) return { ok: false, error: 'a carousel needs mediaUrls' };
  const urls = body.mediaUrls.map(clean);
  if (urls.length < CAROUSEL_MIN_ITEMS || urls.length > CAROUSEL_MAX_ITEMS) {
    return { ok: false, error: 'a carousel has ' + CAROUSEL_MIN_ITEMS + ' to ' + CAROUSEL_MAX_ITEMS + ' items' };
  }
  if (!urls.every((u) => MEDIA_URL_RE.test(u))) return { ok: false, error: 'every carousel item must be a Post For Me media url' };
  if (new Set(urls).size !== urls.length) return { ok: false, error: 'a carousel item is listed twice' };
  if (clean(body.mediaUrl)) return { ok: false, error: 'a carousel sends mediaUrls, not mediaUrl' };
  if (clean(body.coverUrl)) return { ok: false, error: 'a carousel has no cover image' };
  const options = parseOptions(body.options);
  if (clean(options.trial_reel_type)) return { ok: false, error: 'a trial is for a Reel only, not a carousel' };
  if (Number(options.cover_timestamp_ms) > 0) return { ok: false, error: 'a carousel has no cover frame' };

  const scheduledUtc = toUtcIso(body.scheduledAtUTC);
  if (clean(body.scheduledAtUTC) && !scheduledUtc) return { ok: false, error: 'scheduledAtUTC is not a valid time' };
  if (scheduledUtc && Date.parse(scheduledUtc) < nowMs - 60 * 1000) return { ok: false, error: 'scheduled time is in the past' };

  const id = clean(body.idempotencyKey) || ('ig_' + nowMs.toString(36) + '_' + Math.random().toString(36).slice(2, 8));
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return { ok: false, error: 'idempotencyKey has unsupported characters' };

  const fb = facebookFromInput(body, { kind: 'carousel', trial: null, accountId, items: urls.length });
  if (fb.error) return { ok: false, error: fb.error };

  const placement = CAROUSEL_PLACEMENT;
  const postBody = {
    caption: title,
    social_accounts: [accountId],
    media: urls.map((url) => ({ url })),
    account_configurations: [{ social_account_id: accountId, configuration: { placement } }],
    external_id: id,
  };
  if (fb.facebook) {
    postBody.social_accounts.push(fb.facebook.account_id);
    postBody.account_configurations.push({
      social_account_id: fb.facebook.account_id,
      configuration: { placement: FACEBOOK_CAROUSEL_PLACEMENT, set_caption_for_each_image: false },
    });
  }
  if (scheduledUtc) postBody.scheduled_at = scheduledUtc;

  const nowIso = new Date(nowMs).toISOString();
  const status0 = scheduledUtc ? 'scheduled' : 'uploading';
  const rowOptions = { kind: 'carousel', placement, items: urls.length, cover: null, cover_timestamp_ms: null, trial_reel_type: null };
  if (fb.facebook) rowOptions.facebook = facebookRowPart(fb.facebook.account_id, FACEBOOK_CAROUSEL_PLACEMENT, status0);
  const row = {
    id, client, account_id: accountId, title,
    options: rowOptions,
    scheduled_for: scheduledUtc || null,
    timezone: clean(body.timezone).slice(0, 60),
    status: scheduledUtc ? 'scheduled' : 'uploading',
    post_id: '', instagram_url: '', error: '', posted_at: null,
    created_by: clean(actor).slice(0, 80), created_at: nowIso, updated_at: nowIso,
  };
  return { ok: true, row, postBody };
}

// The Facebook part of a row, or null when the post went to Instagram only.
export function facebookPart(row) {
  const fb = row && row.options && typeof row.options === 'object' ? row.options.facebook : null;
  return fb && typeof fb === 'object' && fb.account_id ? fb : null;
}
function withFacebook(row, patch) {
  const fb = facebookPart(row);
  if (!fb) return row;
  return { ...row, options: { ...row.options, facebook: { ...fb, ...patch } } };
}
// YouTube's and LinkedIn's parts of a row (options.networks), when they are not its first network.
export function networkParts(row) {
  const n = row && row.options && row.options.networks && typeof row.options.networks === 'object' ? row.options.networks : {};
  return Object.keys(n).filter((k) => n[k] && n[k].account_id).map((k) => ({ name: k, part: n[k] }));
}
function withNetwork(row, name, patch) {
  const n = (row.options && row.options.networks) || {};
  if (!n[name]) return row;
  return { ...row, options: { ...row.options, networks: { ...n, [name]: { ...n[name], ...patch } } } };
}
// The same patch on every part of the post: Facebook's and each other network's.
function withAllParts(row, patch) {
  let next = withFacebook(row, patch);
  for (const { name } of networkParts(next)) next = withNetwork(next, name, patch);
  return next;
}

// Post For Me's answer to "create post" becomes the row's next state. One post carries both networks, so
// a create that fails fails both, and an accepted one moves both to the same state.
export function applyCreateResponse(row, resp, nowIso) {
  const r = resp && typeof resp === 'object' ? resp : {};
  const postId = r.id ? String(r.id) : '';
  if (!postId) {
    let raw = r.message || r.error || (r.errors && JSON.stringify(r.errors));
    if (raw && typeof raw === 'object') raw = JSON.stringify(raw);
    const error = String(raw || 'Post For Me did not return a post id').slice(0, 280);
    return withAllParts({ ...row, status: 'failed', error, updated_at: nowIso }, { status: 'failed', error });
  }
  const pf = clean(r.status);
  let status = 'processing';
  if (row.status === 'scheduled' || pf === 'scheduled') status = 'scheduled';
  // "processed" means Post For Me handled the post, not that each network took it. On a cross-post both
  // networks wait for their own result (a failure on either must show); an Instagram-only row keeps its
  // old behaviour.
  else if (pf === 'processed' && !facebookPart(row) && !networkParts(row).length) status = 'posted';
  const next = { ...row, status, post_id: postId, error: '', posted_at: status === 'posted' ? nowIso : row.posted_at, updated_at: nowIso };
  return withAllParts(next, { status, error: '' });
}

function resultError(bad, fallback) {
  let base = bad.error;
  if (base && typeof base === 'object') base = base.message || JSON.stringify(base);
  base = clean(base || (bad.details ? JSON.stringify(bad.details) : fallback));
  let detail = '';
  if (bad.details && typeof bad.details === 'object' && bad.details.error) {
    detail = typeof bad.details.error === 'object' ? (bad.details.error.message || JSON.stringify(bad.details.error)) : clean(bad.details.error);
  }
  return (detail && !base.includes(detail) ? base + ': ' + detail : base).slice(0, 280);
}
// One network's results -> { status, url, error } or null when there is no answer for it yet.
function readNetwork(list, fallback) {
  if (!list.length) return null;
  const hit = list.find((x) => x.success === true);
  if (hit) {
    const pd = hit.platform_data && typeof hit.platform_data === 'object' ? hit.platform_data : {};
    return { status: 'posted', url: clean(pd.url), error: '' };
  }
  const bad = list.find((x) => x.success === false);
  if (!bad) return null;
  return { status: 'failed', url: '', error: resultError(bad, fallback) };
}

// Reads Post For Me's per-network results for one post (GET /v1/social-post-results?post_id=...). Each
// result names its social_account_id, so Instagram's and Facebook's are read apart: a Facebook failure
// never hides an Instagram success, or the other way round. No result yet means "still going": that
// network keeps its status. A result without an account id counts for Instagram only on a post that has
// no Facebook part (rows written before cross-posting).
export function applyResults(row, resultsResp, nowIso) {
  const list = Array.isArray(resultsResp) ? resultsResp
    : Array.isArray(resultsResp && resultsResp.data) ? resultsResp.data : [];
  const mine = list.filter((x) => x && typeof x === 'object' && (!x.post_id || String(x.post_id) === row.post_id));
  if (!mine.length) return row;
  const fb = facebookPart(row);
  const others = networkParts(row);
  const acct = (x) => clean(x.social_account_id);
  const igList = mine.filter((x) => acct(x) === row.account_id || (!acct(x) && !fb && !others.length));
  const fbList = fb ? mine.filter((x) => acct(x) === fb.account_id) : [];
  let next = row;
  if (!TERMINAL.includes(row.status)) {
    const ig = readNetwork(igList, (NETWORK_NAMES[row.options && row.options.network] || 'Instagram') + ' rejected the post');
    if (ig && ig.status === 'posted') next = { ...next, status: 'posted', instagram_url: ig.url, error: '', posted_at: row.posted_at || nowIso, updated_at: nowIso };
    else if (ig) next = { ...next, status: 'failed', error: ig.error, updated_at: nowIso };
  }
  if (fb && !TERMINAL.includes(fb.status)) {
    const f = readNetwork(fbList, 'Facebook rejected the post');
    if (f) {
      next = withFacebook(next, { status: f.status, url: f.url, error: f.error, posted_at: f.status === 'posted' ? (fb.posted_at || nowIso) : fb.posted_at || null });
      next = { ...next, updated_at: nowIso };
    }
  }
  for (const { name, part } of others) {
    if (TERMINAL.includes(part.status)) continue;
    const r = readNetwork(mine.filter((x) => acct(x) === part.account_id), (NETWORK_NAMES[name] || name) + ' rejected the post');
    if (!r) continue;
    next = withNetwork(next, name, { status: r.status, url: r.url, error: r.error, posted_at: r.status === 'posted' ? (part.posted_at || nowIso) : part.posted_at || null });
    next = { ...next, updated_at: nowIso };
  }
  return next;
}

// Only rows that can still change are worth asking Post For Me about: Instagram not finished, or the
// Facebook part not finished.
export function needsRefresh(row) {
  if (!row || !row.post_id) return false;
  if (!TERMINAL.includes(row.status)) return true;
  if (row.status === 'cancelled') return false;
  const fb = facebookPart(row);
  return (!!fb && !TERMINAL.includes(fb.status)) || networkParts(row).some(({ part }) => !TERMINAL.includes(part.status));
}

// A cancelled post is cancelled on both networks: it is one Post For Me post.
export function markCancelled(row, nowIso) {
  return withAllParts({ ...row, status: 'cancelled', updated_at: nowIso }, { status: 'cancelled' });
}

// The queue's overall group for a row: failed if any network failed, upcoming while any is still going,
// otherwise done. The page shows each network's own status inside the row.
export function overallStatus(row) {
  const fb = facebookPart(row);
  const all = [row.status].concat(fb ? [fb.status] : [], networkParts(row).map(({ part }) => part.status));
  if (all.includes('failed')) return 'failed';
  const going = all.find((s) => !TERMINAL.includes(s));
  if (going) return going;
  return row.status;
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
    cover: (r.options && r.options.cover) || '',
    trial: !!(r.options && r.options.trial_reel_type),
    // A row written before carousels existed has no kind: it is a Reel.
    kind: (r.options && r.options.kind === 'carousel') ? 'carousel' : 'reel',
    items: (r.options && Number(r.options.items)) || 1,
    // Instagram's own result is status / instagram_url / error above; Facebook's sits here, without its
    // account id. null = Instagram only.
    facebook: facebookPart(r) ? {
      status: facebookPart(r).status || '', url: facebookPart(r).url || '', error: facebookPart(r).error || '',
      posted_at: facebookPart(r).posted_at || '', placement: facebookPart(r).placement || '',
    } : null,
    // P3: which network the row's own status and link describe (Instagram unless it was not ticked), and YouTube's
    // and LinkedIn's results, each without its account id. null = none of them.
    network: (r.options && r.options.network) || 'instagram',
    networks: networkParts(r).length ? Object.fromEntries(networkParts(r).map(({ name, part }) => [name, {
      status: part.status || '', url: part.url || '', error: part.error || '', posted_at: part.posted_at || '',
    }])) : null,
    youtube: (r.options && r.options.youtube) ? { title: r.options.youtube.title || '', format: r.options.youtube.format || '', made_for_kids: !!r.options.youtube.made_for_kids } : null,
  };
}
