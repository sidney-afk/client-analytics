// studio_action "watch_video": Google's Gemini Flash-Lite watches AND hears a
// video and answers a question about it (feedback on an edit, what is said and
// shown, timings). Plain JavaScript with every outside part passed in, so a
// unit test runs it (test/higgsfield-watch-video.js).
//
// Money: every call is a row in hf_generations (reserved through
// hf_reserve_generation, so it also counts against the team's main cap), then
// settled to the exact price from Google's token counts. Gemini also has its
// own monthly cap, GEMINI_MONTHLY_CAP_USD (default 50), checked first.
// The key is the function secret GEMINI_API_KEY (GOOGLE_AI_KEY also works).

import { openLink } from "./transcribe.mjs";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_ROW_MODEL = "google/" + GEMINI_MODEL;
export const API = "https://generativelanguage.googleapis.com";
// Paid tier, per million tokens (checked on Google's pricing page 2026-11-03):
// input $0.30 for text, image, video and audio alike; output (thinking included) $2.50.
export const USD_PER_M_IN = 0.30;
export const USD_PER_M_OUT = 2.50;
// Held from the budget while a video is watched, then replaced by the exact price.
// About two hours of video at high detail would still fit under it.
export const HOLD_USD = 0.75;
export const DEFAULT_CAP_USD = 50;
export const MAX_BYTES = 1024 * 1024 * 1024;
export const SECRET_NAMES = ["GEMINI_API_KEY", "GOOGLE_AI_KEY"];
export const NO_KEY_TEXT = "Watching videos is not switched on yet: the account owner needs to add the Gemini key.";
const READY_WAIT_MS = 150 * 1000;
const DEFAULT_ASK = "Watch and listen to this whole video. Give clear, specific feedback an editor can act on: the hook in the first seconds, pacing and dead moments, cuts, captions and on-screen text (spelling, timing, readability), audio (levels, music against voice, clarity), and anything that looks or sounds wrong. Give times as m:ss.";

export function geminiKey(env) {
  for (const n of SECRET_NAMES) { const v = (env(n) || "").trim(); if (v) return v; }
  return "";
}

export function geminiCap(env) {
  const raw = (env("GEMINI_MONTHLY_CAP_USD") || String(DEFAULT_CAP_USD)).trim();
  return /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
}

export function priceOf(usage) {
  const u = usage || {};
  const inTok = Number(u.promptTokenCount || 0);
  const outTok = Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0);
  const usd = (inTok * USD_PER_M_IN + outTok * USD_PER_M_OUT) / 1e6;
  return { inTok, outTok, usd: Math.round(usd * 1e6) / 1e6 };
}

export function isYouTube(link) {
  return /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/)|youtu\.be\/)/i.test(link);
}

const money = (n) => "$" + (n < 1 ? n.toFixed(3) : n.toFixed(2));

// d: { env(name), fetch, publicHost(URL), directLink(link), timeout(ms), sleep(ms), author, uuid(),
//      geminiSpent(): Promise<number>, reserve({member,model,prompt,params,cost,idemKey}): Promise<{outcome,id,spent}|null>,
//      settle(id, fields): Promise<void> }
export async function watchVideo(d, args) {
  const link = String(args.video || args.url || args.link || "").trim();
  if (!link) return "Give video: a link to the video (the public_url from get_upload_link, a Drive or Dropbox link shared as anyone with the link, a Frame.io download link, or a YouTube link).";
  const key = geminiKey(d.env);
  if (!key) return NO_KEY_TEXT;
  const cap = geminiCap(d.env);
  if (cap === null) return "The Gemini budget setting (GEMINI_MONTHLY_CAP_USD) is not a valid dollar amount, so nothing can be watched. Ask the account owner.";
  const ask = String(args.question || args.ask || "").trim().slice(0, 4000) || DEFAULT_ASK;
  const high = /^high$/i.test(String(args.detail || ""));

  const spent = await d.geminiSpent();
  if (spent + HOLD_USD > cap) return `Refused: the team's Gemini budget this month is ${money(cap)} and ${money(spent)} is already used. Ask the account owner.`;
  const rsv = await d.reserve({
    member: d.author || "team", model: GEMINI_ROW_MODEL, prompt: ask.slice(0, 500),
    params: { video: link.slice(0, 500), detail: high ? "high" : "default", client: args.client ? String(args.client).slice(0, 80) : undefined },
    cost: HOLD_USD, idemKey: d.uuid(),
  });
  if (!rsv) return "Could not book the cost, so nothing was watched. Try again in a minute.";
  if (rsv.outcome === "over_cap") return `Refused: the team's monthly budget is used up (${money(Number(rsv.spent))}). Ask the account owner.`;
  const fail = async (text) => { await d.settle(rsv.id, { status: "failed", error: text.slice(0, 300), est_cost_usd: 0 }); return text; };

  let fileUri, mime, fileName = "";
  try {
    if (isYouTube(link)) {
      fileUri = link; mime = "video/mp4";
    } else {
      const res = await openLink(d.directLink(link), {}, d, false, 120 * 1000);
      if (typeof res === "string") return await fail(res);
      const size = Number(res.headers.get("content-length") || 0);
      mime = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!/^video\//.test(mime)) {
        const ext = (new URL(link).pathname.match(/\.(mp4|mov|webm|m4v|mkv)$/i) || [])[1];
        if (!ext) { await res.body?.cancel?.(); return await fail(`That link is not a video (it is ${mime || "an unknown type"}). Send a link to the video file itself.`); }
        mime = ext.toLowerCase() === "mov" ? "video/quicktime" : ext.toLowerCase() === "webm" ? "video/webm" : "video/mp4";
      }
      if (!size) { await res.body?.cancel?.(); return await fail("That link does not say how big the video is, so it cannot be passed on. Upload it with get_upload_link and send that link."); }
      if (size > MAX_BYTES) { await res.body?.cancel?.(); return await fail("That video is over 1 GB. Send a smaller export."); }
      const start = await d.fetch(`${API}/upload/v1beta/files`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(size), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" },
        body: JSON.stringify({ file: { display_name: "syncmate-watch" } }),
      });
      const upUrl = start.headers.get("x-goog-upload-url");
      if (!start.ok || !upUrl) { await res.body?.cancel?.(); return await fail(`Google refused the upload (${start.status}).`); }
      const put = await d.fetch(upUrl, {
        method: "POST", headers: { "Content-Length": String(size), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
        body: res.body, duplex: "half",
      });
      const up = await put.json().catch(() => ({}));
      if (!put.ok || !up.file?.uri) return await fail(`The upload to Google failed (${put.status}).`);
      fileUri = up.file.uri; fileName = up.file.name || "";
      let state = up.file.state;
      const until = Date.now() + READY_WAIT_MS;
      while (state === "PROCESSING" && Date.now() < until) {
        await d.sleep(3000);
        const g = await d.fetch(`${API}/v1beta/${fileName}`, { headers: { "x-goog-api-key": key } });
        state = (await g.json().catch(() => ({}))).state;
      }
      if (state !== "ACTIVE") return await fail(state === "PROCESSING" ? "Google is still preparing that video. Try again in a minute." : "Google could not read that video file.");
    }

    const body = {
      contents: [{ role: "user", parts: [{ file_data: { file_uri: fileUri, mime_type: mime } }, { text: ask }] }],
      generationConfig: { maxOutputTokens: 8192, ...(high ? { mediaResolution: "MEDIA_RESOLUTION_HIGH" } : {}) },
    };
    const r = await d.fetch(`${API}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: d.timeout ? d.timeout(240 * 1000) : undefined,
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return await fail(`Gemini said no (${r.status}): ${String(out.error?.message || "no reason given").slice(0, 200)}`);
    const text = (out.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
    const price = priceOf(out.usageMetadata);
    await d.settle(rsv.id, { status: "completed", est_cost_usd: price.usd, params: { video: link.slice(0, 500), detail: high ? "high" : "default", client: args.client ? String(args.client).slice(0, 80) : undefined, tokens_in: price.inTok, tokens_out: price.outTok } });
    if (!text) return `Gemini watched it but gave no answer (cost ${money(price.usd)}). Try asking again more simply.`;
    return `${text}\n\n(Watched by Gemini Flash-Lite. Cost ${money(price.usd)}. Gemini budget this month: ${money(spent + price.usd)} of ${money(cap)}.)`;
  } catch (e) {
    return await fail(`Watching failed: ${String(e?.message || e).slice(0, 200)}`);
  } finally {
    if (fileName) d.fetch(`${API}/v1beta/${fileName}`, { method: "DELETE", headers: { "x-goog-api-key": key } }).catch(() => {});
  }
}
