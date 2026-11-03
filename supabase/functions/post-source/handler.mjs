// post-source: a card's (or a trial version's) video copied from Frame.io into Post for Me storage, server to server,
// so a phone never downloads or uploads the file (plan row F4, OPEN_REPAIRS 649). Every outside thing is passed in,
// so the whole handler runs under Node against fakes (test/post-source-logic.js); index.ts only wires the real ones.
//
// deps:
//   allowedClients        the INSTAGRAM_UPLOAD_ALLOWED_CLIENTS setting ("*" = every client, empty = nobody)
//   readCard(client, id)  -> { id, client, asset_url, thumbnail_url } | null   the card, matched on client AND id
//   readVersions(client, postId) -> [{ id, letter, frame_url, thumbnail_url, created_at }]   the card's stored version rows (B..G; A
//                            is the card itself). A letter can have more than one row; the one used is the one
//                            trial-reels shows (oneRowPerLetter: earliest, then smallest id), never whichever came back.
//   lookupVideo(link)     -> { name, file_id, duration_seconds, renditions:{ original?, high_quality?, efficient? } }
//                            frameio-view's strict lookup; throws { code, status, message } to refuse
//   fileFacts(video)      -> { media_type, codec, width, height, metadata_fields } | null   what Frame says about the upload
//                            itself; metadata_fields is the list of Frame's field names (never values), for the live check
//   mint()                -> { ok, upload_url, media_url }          one Post for Me storage address
//   fetchFn, now
//
// Nothing is written to any table. A Frame address is never returned, stored or logged: it is fetched right before
// the copy and used once.
import { clientAllowed } from '../instagram-upload/logic.mjs';
import { oneRowPerLetter } from '../trial-reels/logic.mjs';

const clean = (v) => String(v == null ? '' : v).trim();
const reply = (status, body) => ({ status, body });
const refuse = (status, error, message) => reply(status, { ok: false, error, message });

const MB = 1024 * 1024;
// Each side's file limit. TikTok's is 287 MB (the page's TIKTOK_MAX_BYTES); Instagram takes the same cap until a real
// post measures otherwise (P1), so one copy serves either side.
export const MAX_BYTES = Object.freeze({ tiktok: 287 * MB, instagram: 287 * MB });
const LETTER_RE = /^[A-Ga-g]$/;
// The cover's own limits on Instagram: a JPEG or PNG of at most 8 MB (the page's IG_COVER_MAX_BYTES).
export const THUMB_MAX_BYTES = 8 * MB;
const THUMB_TYPES = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png' };
const THUMB_TIMEOUT_MS = 15000;
const DOWNLOAD_INSTEAD = 'Download it from Frame and drop the file on the Post tab instead.';

// D2 (Sidney, 2 Nov): full HD is the highest-quality H.264 file Frame has. The Original when Frame says it is an
// H.264 MP4; otherwise the largest H.264 proxy (high_quality, Frame's full-size copy, before efficient, its ~360p
// one). Facts Frame did not give never pick the Original. Returns the names to try, in order: a refused Original
// (403) falls to the next.
export function pickPostRendition(renditions, facts) {
  const r = renditions || {};
  const f = facts || {};
  const mp4 = /^video\/mp4$/i.test(clean(f.media_type));
  const h264 = /^(h\.?264|avc1?|mpeg-?4 avc)\b/i.test(clean(f.codec));
  const order = [];
  if (r.original && mp4 && h264) order.push('original');
  if (r.high_quality) order.push('high_quality');
  if (r.efficient) order.push('efficient');
  return order;
}

// Where the card's thumbnail can be fetched from, or '' (P1a, OPEN_REPAIRS 650). The address is the card's own
// thumbnail_url, read on the server. A Drive file goes to Google's image host, as the Calendar shows it
// (_calDeriveThumb); otherwise only a direct https link to a .jpg, .jpeg or .png. Never http, a bare IP or localhost,
// and never a redirect (it could lead anywhere).
export function thumbSource(raw) {
  const u = clean(raw);
  if (!u) return '';
  const drive = u.match(/googleusercontent\.com\/d\/([A-Za-z0-9_-]+)/i) || (/(?:drive|docs)\.google\.com/i.test(u) && (u.match(/\/file\/d\/([A-Za-z0-9_-]+)/i) || u.match(/[?&]id=([A-Za-z0-9_-]+)/i)));
  if (drive) return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(drive[1]) + '=w1080';
  let url;
  try { url = new URL(u); } catch { return ''; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return '';
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return '';
  if (!/\.(jpe?g|png)$/i.test(url.pathname)) return '';
  return url.href;
}

// A response body read piece by piece and stopped as soon as it passes `cap`, so a server that states no size (or a
// wrong one) can never make this function hold more than the cap (supervisor and Codex P2 on #2554). Answers the
// bytes, or TOO_BIG.
const TOO_BIG = Symbol('too_big');
async function readCapped(body, cap) {
  if (!body || typeof body.getReader !== 'function') return null;
  const reader = body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { try { await reader.cancel(); } catch { /* already closed */ } return TOO_BIG; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

// The thumbnail into its own Post for Me address. Never fails the post: it answers { url, note }, url null with the
// reason in note.
async function copyThumb(deps, raw) {
  const none = (note) => ({ url: null, note });
  const from = thumbSource(raw);
  if (!clean(raw)) return none('This card has no thumbnail.');
  if (!from) return none('The card\'s thumbnail is not an image SyncView can copy. Pick a cover by hand.');
  const resp = await deps.fetchFn(from, { method: 'GET', headers: { Accept: 'image/jpeg,image/png' }, redirect: 'error', signal: AbortSignal.timeout(THUMB_TIMEOUT_MS) }).catch(() => null);
  if (!resp || !resp.ok) return none('The card\'s thumbnail could not be read. Pick a cover by hand.');
  const type = THUMB_TYPES[clean(resp.headers && resp.headers.get && resp.headers.get('content-type')).split(';')[0].toLowerCase()];
  const said = Number(resp.headers && resp.headers.get && resp.headers.get('content-length')) || 0;
  const stop = () => { try { resp.body && resp.body.cancel && resp.body.cancel(); } catch { /* already closed */ } };
  if (!type) { stop(); return none('The card\'s thumbnail is not a JPEG or PNG, which Instagram needs for a cover. Pick a cover by hand.'); }
  if (said > THUMB_MAX_BYTES) { stop(); return none('The card\'s thumbnail is over 8 MB. Pick a smaller cover by hand.'); }
  const bytes = await readCapped(resp.body, THUMB_MAX_BYTES).catch(() => null);
  if (bytes === TOO_BIG) return none('The card\'s thumbnail is over 8 MB. Pick a smaller cover by hand.');
  if (!bytes || !bytes.byteLength) return none('The card\'s thumbnail could not be read. Pick a cover by hand.');
  const target = await deps.mint().catch(() => null);
  if (!target || !target.ok || !clean(target.upload_url) || !clean(target.media_url)) return none('Post for Me did not give an address for the thumbnail. Pick a cover by hand.');
  const put = await deps.fetchFn(target.upload_url, { method: 'PUT', headers: { 'Content-Type': type, 'Content-Length': String(bytes.byteLength) }, body: bytes }).catch(() => null);
  if (!put || !put.ok) return none('The thumbnail copy did not finish. Pick a cover by hand.');
  return { url: clean(target.media_url), note: '' };
}

export async function handlePostSource({ body, deps }) {
  const started = deps.now();
  const input = body && typeof body === 'object' ? body : {};
  const client = clean(input.client);
  const postId = clean(input.post_id);
  const letter = clean(input.letter).toUpperCase();
  const side = clean(input.side) === 'tiktok' ? 'tiktok' : 'instagram';
  if (!client || !postId || (letter && !LETTER_RE.test(letter))) {
    return refuse(400, 'bad_request', 'Send the client, the card and, for a trial version, its letter.');
  }
  if (!clientAllowed(client, deps.allowedClients)) {
    return refuse(403, 'client_not_allowed', 'Posting from a card is not switched on for this client yet.');
  }

  // The link is read here, from the card or the version, never taken from the request.
  // A letter names a version row, A included: once the SMM has put another version on the card, the card's link is
  // that version's, so A must be read from its own row (plan row P4). A card with no row for A is a card that never had
  // versions: A is the card, as before. A version's thumbnail is its own, else the card's (V3's rule, trial-reels
  // effectiveFields); the version on the card is posted without a letter, as the card.
  let link = '';
  let thumbRaw = '';
  const version = letter ? oneRowPerLetter(await deps.readVersions(client, postId)).find((v) => clean(v.letter).toUpperCase() === letter) : null;
  const isCard = !version && (!letter || letter === 'A');
  if (!version && !isCard) return refuse(404, 'version_not_found', 'Version ' + letter + ' was not found on this card.');
  const card = await deps.readCard(client, postId);
  if (!card || clean(card.client) !== client) return refuse(404, 'card_not_found', 'That card was not found for this client.');
  if (isCard) {
    link = clean(card.asset_url);
    thumbRaw = clean(card.thumbnail_url);
  } else {
    link = clean(version.frame_url);
    thumbRaw = clean(version.thumbnail_url) || clean(card.thumbnail_url);
  }
  if (!link) return refuse(409, 'no_link', 'This ' + (isCard ? 'card' : 'version') + ' has no Frame link yet.');

  let video;
  try {
    video = await deps.lookupVideo(link);
  } catch (e) {
    if (e && e.code && e.status) return refuse(e.status, e.code, e.message);
    return refuse(502, 'frameio_unavailable', 'Frame.io did not answer. Try again in a minute.');
  }
  const facts = await deps.fileFacts(video).catch(() => null);
  const order = pickPostRendition(video.renditions, facts);
  if (!order.length) return refuse(409, 'no_h264_copy', 'Frame has no copy of this video that every network takes yet. Wait for Frame to finish processing, or ' + DOWNLOAD_INSTEAD.charAt(0).toLowerCase() + DOWNLOAD_INSTEAD.slice(1));

  // Fetch the chosen file; a refused Original (no download right) falls to the largest proxy.
  let source = null, rendition = '', fellBack = false;
  for (const name of order) {
    const resp = await deps.fetchFn(video.renditions[name], { method: 'GET' }).catch(() => null);
    if (resp && resp.ok) { source = resp; rendition = name; break; }
    if (resp && resp.body && typeof resp.body.cancel === 'function') { try { resp.body.cancel(); } catch { /* already closed */ } }
    if (name === 'original' && resp && resp.status === 403) { fellBack = true; continue; }
    return refuse(502, 'frameio_unavailable', 'Frame.io did not hand over the file. Try again in a minute, or ' + DOWNLOAD_INSTEAD.charAt(0).toLowerCase() + DOWNLOAD_INSTEAD.slice(1));
  }
  if (!source) return refuse(502, 'frameio_unavailable', 'Frame.io did not hand over the file. ' + DOWNLOAD_INSTEAD);

  const bytes = Number(source.headers && source.headers.get && source.headers.get('content-length')) || 0;
  const cap = MAX_BYTES[side];
  const stop = () => { try { source.body && source.body.cancel && source.body.cancel(); } catch { /* already closed */ } };
  if (!bytes) { stop(); return refuse(502, 'copy_failed', 'Frame.io did not say how big the file is, so it cannot be copied. ' + DOWNLOAD_INSTEAD); }
  if (bytes > cap) {
    stop();
    return refuse(413, 'too_large', 'This video is ' + Math.round(bytes / MB) + ' MB; ' + (side === 'tiktok' ? 'TikTok' : 'the post') + ' takes at most ' + Math.round(cap / MB) + ' MB.');
  }

  const target = await deps.mint().catch(() => null);
  if (!target || !target.ok || !clean(target.upload_url) || !clean(target.media_url)) {
    stop();
    return refuse(502, 'copy_failed', 'Post for Me did not give an upload address. ' + DOWNLOAD_INSTEAD);
  }
  const put = await deps.fetchFn(target.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes) },
    body: source.body,
    duplex: 'half',
  }).catch(() => null);
  if (!put || !put.ok) return refuse(502, 'copy_failed', 'The copy to Post for Me did not finish. ' + DOWNLOAD_INSTEAD);

  // The thumbnail goes too, after the video: the card's, or the version's own (else the card's).
  const thumb = await copyThumb(deps, thumbRaw).catch(() => ({ url: null, note: 'The thumbnail copy did not finish. Pick a cover by hand.' }));
  const f = facts || {};
  return reply(200, {
    ok: true,
    media_url: clean(target.media_url),
    file_name: clean(video.name),
    rendition,
    fell_back_from_original: fellBack,
    bytes,
    width: Number(f.width) || null,
    height: Number(f.height) || null,
    duration_seconds: Number(video.duration_seconds) || null,
    thumb_url: thumb.url,
    thumb_note: thumb.note,
    metadata_fields: Array.isArray(f.metadata_fields) ? f.metadata_fields.map(clean).filter(Boolean).slice(0, 60) : [],
    took_ms: deps.now() - started,
  });
}
