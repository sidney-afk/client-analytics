// post-source: a card's (or a trial version's) video copied from Frame.io into Post for Me storage, server to server,
// so a phone never downloads or uploads the file (plan row F4, OPEN_REPAIRS 649). Every outside thing is passed in,
// so the whole handler runs under Node against fakes (test/post-source-logic.js); index.ts only wires the real ones.
//
// deps:
//   allowedClients        the INSTAGRAM_UPLOAD_ALLOWED_CLIENTS setting ("*" = every client, empty = nobody)
//   readCard(client, id)  -> { id, client, asset_url } | null      the card, matched on client AND id
//   readVersion(client, postId, letter) -> { frame_url } | null    a trial version (B..G; A is the card itself)
//   lookupVideo(link)     -> { name, file_id, duration_seconds, renditions:{ original?, high_quality?, efficient? } }
//                            frameio-view's strict lookup; throws { code, status, message } to refuse
//   fileFacts(video)      -> { media_type, codec, width, height } | null   what Frame says about the upload itself
//   mint()                -> { ok, upload_url, media_url }          one Post for Me storage address
//   fetchFn, now
//
// Nothing is written to any table. A Frame address is never returned, stored or logged: it is fetched right before
// the copy and used once.
import { clientAllowed } from '../instagram-upload/logic.mjs';

const clean = (v) => String(v == null ? '' : v).trim();
const reply = (status, body) => ({ status, body });
const refuse = (status, error, message) => reply(status, { ok: false, error, message });

const MB = 1024 * 1024;
// Each side's file limit. TikTok's is 287 MB (the page's TIKTOK_MAX_BYTES); Instagram takes the same cap until a real
// post measures otherwise (P1), so one copy serves either side.
export const MAX_BYTES = Object.freeze({ tiktok: 287 * MB, instagram: 287 * MB });
const LETTER_RE = /^[A-Ga-g]$/;
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
  let link = '';
  if (!letter || letter === 'A') {
    const card = await deps.readCard(client, postId);
    if (!card || clean(card.client) !== client) return refuse(404, 'card_not_found', 'That card was not found for this client.');
    link = clean(card.asset_url);
  } else {
    const version = await deps.readVersion(client, postId, letter);
    if (!version) return refuse(404, 'version_not_found', 'Version ' + letter + ' was not found on this card.');
    link = clean(version.frame_url);
  }
  if (!link) return refuse(409, 'no_link', 'This ' + (letter && letter !== 'A' ? 'version' : 'card') + ' has no Frame link yet.');

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
    took_ms: deps.now() - started,
  });
}
