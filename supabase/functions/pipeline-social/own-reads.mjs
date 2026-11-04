// pipeline-social: the three READ actions for the client video study (Sidney, 2026-11-02: study only videos we made,
// from Frame.io, not Instagram). Kept free of Deno so test/pipeline-social.js runs it under Node with fakes.
//
//   frame.cards { }      the pass client's production cards that have a Frame.io link
//   frame.video { card } a short-lived address of that card's small (efficient) rendition
//   own.views   { }      the client's own Instagram videos with caption, post link and views
//
// Always the client of the pass, never one named in the request. A request that names another client is refused.

import { parseFrameLink } from "../frameio-view/logic.mjs";

const clean = (v) => String(v == null ? "" : v).trim();
export const OWN_ACTIONS = ["frame.cards", "frame.video", "own.views"];
export const isOwnAction = (a) => OWN_ACTIONS.includes(a);
const SAFE_CARD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const MAX_CARDS = 300;
const MAX_VIEWS = 300;

// Which client the call is for: the pass's own. Returns { ok, slug } or { ok:false, error, status }.
export function ownScope(pass, body) {
  const slug = clean(pass && pass.client_slug);
  if (!slug) return { ok: false, status: 403, error: "This pass is not for one client, so it cannot read a client's cards. Ask the connector for a pass for the client (pipeline_pass)." };
  const asked = clean(body && (body.client || body.slug));
  if (asked && asked.toLowerCase() !== slug.toLowerCase()) return { ok: false, status: 403, error: "A pass reads only its own client." };
  return { ok: true, slug };
}

export function planOwn(action, body) {
  const b = body && typeof body === "object" ? body : {};
  if (action === "frame.video") {
    const id = clean(b.card || b.card_id || b.id);
    if (!SAFE_CARD_ID.test(id)) return { ok: false, error: "Give card: the card id from frame.cards." };
    return { ok: true, card: id };
  }
  return { ok: true };
}

// A card row, cut to what the study needs. The Frame.io link is only a flag here; frame.video looks it up itself.
export function slimCard(r) {
  return { id: r.id, name: r.name || "", caption: r.caption || "", post_url: r.post_url || "", scheduled_date: r.scheduled_date || "", posted_at: r.posted_at || "" };
}

export async function cardsFor(sb, slug) {
  const { data, error } = await sb.from("calendar_posts").select("id,name,caption,post_url,scheduled_date,posted_at,asset_url")
    .eq("client", slug).or("asset_url.ilike.%frame.io%,asset_url.ilike.%f.io%").order("scheduled_date", { ascending: false }).limit(MAX_CARDS);
  if (error) return { ok: false, status: 503, error: "Could not read the cards." };
  const rows = (data || []).filter((r) => parseFrameLink(clean(r.asset_url)));
  return { ok: true, result: { client: slug, cards: rows.map(slimCard), truncated: (data || []).length >= MAX_CARDS } };
}

export async function viewsFor(sb, slug) {
  const { data, error } = await sb.from("analytics_top_videos").select("scraped_date,platform,period,rank,caption,video_url,views,likes,comments,shares")
    .eq("client_slug", slug).order("scraped_date", { ascending: false }).limit(MAX_VIEWS * 4);
  if (error) return { ok: false, status: 503, error: "Could not read the client's own videos." };
  const seen = new Set(); const videos = [];
  for (const r of data || []) {
    if (!/instagram/i.test(clean(r.platform)) || !clean(r.video_url) || seen.has(r.video_url)) continue;
    seen.add(r.video_url);
    videos.push({ caption: r.caption || "", post_url: r.video_url, views: r.views, likes: r.likes, comments: r.comments, scraped_date: r.scraped_date });
    if (videos.length >= MAX_VIEWS) break;
  }
  return { ok: true, result: { client: slug, videos } };
}

// The card's Frame.io link comes from the card itself (never from the request). deps.lookup(link) answers frameio-view's body.
export async function videoFor(sb, slug, cardId, lookup) {
  const { data, error } = await sb.from("calendar_posts").select("id,asset_url").eq("client", slug).eq("id", cardId).limit(1);
  if (error) return { ok: false, status: 503, error: "Could not read the card." };
  const link = clean(data && data[0] && data[0].asset_url);
  if (!link) return { ok: false, status: 404, error: "That card has no Frame.io link for this client." };
  let out;
  try { out = await lookup(link); } catch (e) {
    const code = e && e.code ? String(e.code) : "frameio_unavailable";
    return { ok: false, status: e && e.status ? e.status : 502, error: `Frame.io could not give the video (${code}).` };
  }
  const v = out && out.video ? out.video : {};
  const url = clean((v.renditions && v.renditions.efficient) || v.url);
  if (!url) return { ok: false, status: 502, error: "Frame.io gave no video address." };
  return { ok: true, result: { card: cardId, url, expires_at: v.expires_at || null, duration_seconds: v.duration_seconds ?? null, name: v.name || "" } };
}
