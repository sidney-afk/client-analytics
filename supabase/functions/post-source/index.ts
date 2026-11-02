// Supabase Edge Function: post-source
//
// A card's (or a trial version's) video copied from Frame.io into Post for Me storage, server to server, so a phone
// never downloads or uploads the file (plan row F4, OPEN_REPAIRS 649). Nothing calls it yet: the Post tab's
// "From a card" picker does in plan row P1.
//
//   POST { client, post_id, letter?, side? }   header X-Syncview-Key: a staff role key (admin, smm or creative)
//     letter: "B".."G" for a trial version; empty or "A" is the card itself. side: "instagram" (default) or "tiktok".
//     -> 200 { ok:true, media_url, file_name, rendition:"original"|"high_quality"|"efficient", fell_back_from_original,
//              bytes, width, height, duration_seconds, took_ms }
//     -> { ok:false, error, message }  bad_request 400, client_not_allowed 403, card_not_found 404,
//        version_not_found 404, no_link 409, no_h264_copy 409, too_large 413, copy_failed 502, frameio_unavailable 502,
//        and frameio-view's own refusals (folder_link 422, file_not_in_share 404, still_processing 409, ...)
//
// The Frame link is read here from calendar_posts.asset_url (the card, matched on client and id) or
// studio_trial_versions.frame_url (a version; trial-reels' own row per letter), never taken from the request. Frame is read through frameio-view's own
// lookup, strict: a folder link is refused, never "the first video". Which file goes is D2: the Original when Frame
// says it is an H.264 MP4, else the full-size H.264 proxy, else the small one (handler.mjs, pickPostRendition). The
// file is streamed straight from Frame into one Post for Me upload address; it is never buffered or stored here.
//
// Writes no table. A signed Frame address is fetched right before the copy, used once, and never returned, stored or
// logged. Logs only step names and codes.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (reads only), POST_FOR_ME_API_KEY, the staff role key secrets,
// FRAMEIO_BROKER_KEY and FRAMEIO_CLIENT_ID (as frameio-view), INSTAGRAM_UPLOAD_ALLOWED_CLIENTS (as instagram-upload;
// "*" = every client, empty = nobody). No new secret.

import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import { lookup, tokenSource } from "../frameio-view/logic.mjs";
import { likeExact } from "../trial-reels/logic.mjs";
import { handlePostSource } from "./handler.mjs";

const PFM = "https://api.postforme.dev/v1";
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source",
  "Cache-Control": "no-store",
};
const clean = (v: unknown): string => String(v == null ? "" : v).trim();
const env = (k: string): string => clean(Deno.env.get(k));
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

let tokens: ReturnType<typeof tokenSource> | null = null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const auth = authorizeStaffKey(clean(req.headers.get("x-syncview-key")), ["admin", "smm", "creative"]);
  if (!auth.ok) return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));

  const supabaseUrl = env("SUPABASE_URL").replace(/\/+$/, "");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const pfmKey = env("POST_FOR_ME_API_KEY");
  const brokerKey = env("FRAMEIO_BROKER_KEY");
  const clientId = env("FRAMEIO_CLIENT_ID");
  if (!supabaseUrl || !serviceKey || !pfmKey || brokerKey.length < 32 || !clientId) {
    return json({ ok: false, error: "not_configured", message: "Copying from Frame is not set up on the server." }, 500);
  }
  if (!tokens) tokens = tokenSource({ fetchFn: fetch, brokerUrl: supabaseUrl + "/functions/v1/frameio-token", brokerKey });

  const rest = async (path: string) => {
    const r = await fetch(supabaseUrl + "/rest/v1/" + path, { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" } });
    if (!r.ok) throw new Error("read_failed");
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };
  const restAll = async (path: string) => {
    const r = await fetch(supabaseUrl + "/rest/v1/" + path, { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" } });
    if (!r.ok) throw new Error("read_failed");
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  };
  const eq = (v: string) => "eq." + encodeURIComponent(v);
  const body = await req.json().catch(() => ({}));

  try {
    const out = await handlePostSource({
      body,
      deps: {
        allowedClients: env("INSTAGRAM_UPLOAD_ALLOWED_CLIENTS"),
        readCard: (client: string, id: string) => rest("calendar_posts?select=id,client,asset_url&client=" + eq(client) + "&id=" + eq(id) + "&limit=1"),
        // Every row of the card, matched as trial-reels matches them (client case-insensitively, exactly); the handler
        // keeps the one trial-reels shows for each letter.
        readVersions: (client: string, postId: string) =>
          restAll("studio_trial_versions?select=id,letter,frame_url,created_at&post_id=" + eq(postId) + "&client=ilike." + encodeURIComponent(likeExact(client))),
        lookupVideo: async (link: string) =>
          (await lookup(link, { fetchFn: fetch, getToken: () => tokens!.get(), dropToken: () => tokens!.drop(), clientId, now: Date.now }, { part: "video", strict: true })).video,
        fileFacts: async (video: { media_type?: string; codec?: string; width?: number; height?: number }) =>
          ({ media_type: video.media_type, codec: video.codec, width: video.width, height: video.height }),
        mint: async () => {
          const r = await fetch(PFM + "/media/create-upload-url", {
            method: "POST", headers: { Authorization: "Bearer " + pfmKey, "Content-Type": "application/json", Accept: "application/json" },
            signal: AbortSignal.timeout(25000),
          });
          const d = await r.json().catch(() => ({}));
          return { ok: r.ok, upload_url: clean(d.upload_url), media_url: clean(d.media_url) };
        },
        fetchFn: fetch,
        now: Date.now,
      },
    });
    if (!out.body.ok) console.warn("post-source refused", out.body.error);
    else console.log("post-source copied", out.body.rendition, out.body.bytes, out.body.took_ms);
    return json(out.body, out.status);
  } catch (e) {
    console.error("post-source failed", e instanceof Error ? e.name : "error");
    return json({ ok: false, error: "copy_failed", message: "The copy did not finish. Download it from Frame and drop the file on the Post tab instead." }, 502);
  }
});
