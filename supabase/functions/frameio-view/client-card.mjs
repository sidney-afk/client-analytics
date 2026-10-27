// frameio-view, client side: may THIS client's review link play THIS card's video?
// Kept free of Deno so test/frameio-view-source.js runs it under Node with the database faked.
//
// The page sends only a card id. Everything else is decided here, on the server:
//   1. the review token must be a stored client review token (exactly one client owns it);
//   2. the card must exist and belong to that same client (a card of another client answers exactly like a
//      card that does not exist, so nothing is learned about other clients' cards);
//   3. the Frame.io link comes from the card itself, never from the request;
//   4. the client must be switched on in the frame_viewer_clients flag (a missing row, a bad shape or a failed
//      read all mean no).
// Only reads, and only through the `rest` function the handler passes in.

const clean = (v) => String(v == null ? '' : v).trim();
const SAFE_CARD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const FLAG_KEY = 'frame_viewer_clients';

export class ClientRefusal extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
const refuse = (code, status) => new ClientRefusal(code, status);

// The same slug rule the other client-scoped functions use.
export function normalizeClient(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch { /* ASCII slugs still work */ }
  text = text.replace(/^dr\.?\s+/, '');
  text = text.replace(/\s+(?:and|&)\s+/g, '&');
  return text.replace(/[^a-z0-9&]+/g, '');
}

function sameSecret(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// The flag row's value to "is this client on". Only exact shapes open anything.
export function flagAllows(value, slug) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.all === true) return true;
  const list = Array.isArray(value.clients) ? value.clients : [];
  return list.some((m) => typeof m === 'string' && normalizeClient(m) === slug);
}

// rest(path) -> parsed JSON rows from the database (GET only), or throws.
export async function authorizeClientCard({ token, cardId, link }, rest) {
  const t = clean(token), id = clean(cardId);
  if (!t) throw refuse('credentials_required', 401);
  if (t.length > 200 || !id || !SAFE_CARD_ID.test(id)) throw refuse('invalid_scope', 400);

  let accessRows;
  try { accessRows = await rest('client_access?select=slug,review_token'); } catch { throw refuse('authorization_unavailable', 503); }
  const owners = (Array.isArray(accessRows) ? accessRows : []).filter((r) => clean(r && r.review_token) && sameSecret(t, clean(r.review_token)));
  if (owners.length === 0) throw refuse('invalid_client_token', 401);
  if (owners.length !== 1) throw refuse('ambiguous_client_token', 403);
  const slug = normalizeClient(owners[0].slug);
  if (!slug) throw refuse('invalid_client_token', 401);

  let flagRows;
  try { flagRows = await rest('syncview_runtime_flags?select=value&key=eq.' + FLAG_KEY + '&limit=1'); } catch { throw refuse('not_enabled', 403); }
  if (!flagAllows(Array.isArray(flagRows) && flagRows[0] ? flagRows[0].value : null, slug)) throw refuse('not_enabled', 403);

  let active;
  try { active = await rest('clients?select=slug&active=is.true&slug=eq.' + encodeURIComponent(slug) + '&limit=1'); } catch { throw refuse('authorization_unavailable', 503); }
  if (!Array.isArray(active) || active.length === 0) throw refuse('inactive_client', 403);

  let cards;
  try {
    cards = await rest('calendar_posts?select=id,client,asset_url&client=eq.' + encodeURIComponent(slug) + '&id=eq.' + encodeURIComponent(id) + '&limit=1');
  } catch { throw refuse('authorization_unavailable', 503); }
  const card = Array.isArray(cards) ? cards[0] : null;
  if (!card || normalizeClient(card.client) !== slug) throw refuse('not_found', 404);
  const cardLink = clean(card.asset_url);
  if (!cardLink) throw refuse('not_found', 404);
  // A link in the request is never used, but if one is sent it has to be this card's own, or (trial reels) one of
  // this card's own versions that the client may see.
  if (clean(link) && !cardLink.includes(clean(link))) {
    const version = await trialVersionLink({ slug, cardId: id, link: clean(link) }, rest);
    if (!version) throw refuse('not_found', 404);
    return { slug, link: version };
  }
  return { slug, link: cardLink };
}

/*
 * TRIAL REELS (docs/features/TRIAL_REELS_PLAN.md, section 10 item 1): the client's review page plays the version on
 * screen. A requested link plays only when every one of these holds, all read here:
 *   - the trial_reels_pages switch lists this client (a missing row, a bad shape or a failed read all mean no);
 *   - this card's Trial reels switch is on (trial_reel_cards);
 *   - the link is the frame_url of one of THIS card's versions that is not dropped and not lost, and once a winner
 *     is picked only the winner's (the client sees only the winner, Q8).
 * Anything else answers exactly like a link that is not this card's.
 */
const TRIAL_FLAG_KEY = 'trial_reels_pages';
const likeExact = (text) => String(text).replace(/[\\%_]/g, '\\$&');
export async function trialVersionLink({ slug, cardId, link }, rest) {
  try {
    const flags = await rest('syncview_runtime_flags?select=value&key=eq.' + TRIAL_FLAG_KEY + '&limit=1');
    if (!flagAllows(Array.isArray(flags) && flags[0] ? flags[0].value : null, slug)) return '';
    const sw = await rest('trial_reel_cards?select=enabled&client=eq.' + encodeURIComponent(slug) + '&post_id=eq.' + encodeURIComponent(cardId) + '&limit=1');
    if (!Array.isArray(sw) || !sw[0] || sw[0].enabled !== true) return '';
    const rows = await rest('studio_trial_versions?select=letter,status,frame_url&post_id=eq.' + encodeURIComponent(cardId) + '&client=ilike.' + encodeURIComponent(likeExact(slug)));
    const versions = Array.isArray(rows) ? rows : [];
    const winner = versions.find((v) => v && v.status === 'winner');
    const seen = winner ? [winner] : versions.filter((v) => v && v.status !== 'dropped' && v.status !== 'lost');
    const hit = seen.find((v) => clean(v.frame_url) && clean(v.frame_url) === link);
    return hit ? clean(hit.frame_url) : '';
  } catch {
    return '';
  }
}
