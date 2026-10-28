// Supabase Edge Function: pipeline-social
//
// The filming plan pipeline's door to ScrapeCreators (Sidney, 2026-10-23): idea
// research on TikTok, YouTube Shorts and Reddit, and the words of a video. The
// pipeline reaches it the same way it reaches Google through pipeline-google:
// with a filming pipeline pass (the connector's pipeline_pass tool), so no key
// sits on anyone's computer. The ScrapeCreators key is the Supabase secret
// SCRAPECREATORS_API_KEY and never leaves this function.
//
//   POST { action, ... }   header x-pipeline-pass: <a filming pipeline pass>
//
//   tiktok.search    (slimmed to words, link, date, counts incl. views, poster) { query, sort_by?, date_posted?, region?, cursor? }
//   tiktok.profile  { handle, cache_max_age? }                       followers, likes, video count
//   tiktok.videos   { handle, sort_by? (latest|popular), region?, max_cursor? }   an account's recent videos (slimmed like search)
//   youtube.search   { query, type? (shorts|videos), uploadDate?, sortBy?, region?, continuationToken? }
//   youtube.channel { handle | channelId, cache_max_age? }           subscribers, video count
//   youtube.channel_videos { handle | channelId, type? (shorts|videos), sort?, continuationToken? }
//   youtube.video   { url, cache_max_age? }                          one video or Short, with its channel
//   reddit.search    { query, filter?, sort?, timeframe?, after? }
//   reddit.subreddit { subreddit, sort?, timeframe?, cache_max_age?, after? }
//   transcript       { url, language? }       a TikTok, Instagram or YouTube link
//   credits          {}                       the ScrapeCreators credit balance
//   watch            { url, max_seconds? }    Gemini watches one TikTok, Instagram or YouTube video and answers its words,
//                                            what is on screen, the hook, how it is built, ad or repost (Sidney, 2026-10-28).
//                                            The Gemini key is the Supabase secret GEMINI_API_KEY. Answers cost_usd from
//                                            Gemini's own token count; the caller keeps the per-batch money cap.
//
// What each action may send is fixed in rules.mjs (no free choice of endpoint,
// host or paid option). Every pass call first re-checks the member is still on
// the filming plan list (the same gate as pipeline-google). Each call is logged
// in hf_activity as tool "scrapecreators.<action>" with who ran it, and calls
// count against a monthly cap (fp_settings key scrapecreators_monthly_calls,
// default 2000; credits does not count). A call is written down before it is
// made, so parallel calls cannot overshoot the cap. Refusals are plain English, ok:false.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { PASS_HEADER, isPassToken, passHash } from "../pipeline-google/pass.mjs";
import { pipelineGate } from "../pipeline-google/users.mjs";
import { BASE, CAP_KEY, WATCH_MAX_BYTES, WATCH_MODEL, buildRequest, capFrom, geminiBody, logLine, mediaFrom, monthStart, slimResult, watchCost } from "./rules.mjs";

const clean = (v: unknown) => String(v == null ? "" : v).trim();
const json = (obj: unknown, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });
const refused = (error: string, status = 403) => json({ ok: false, error }, status);

function db() {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

type Db = NonNullable<ReturnType<typeof db>>;

// What buildRequest (rules.mjs) answers: a refusal, or the request to make.
type Plan = { ok: boolean; error?: string; path: string; query: Record<string, string>; counts: boolean; site?: string; watch?: boolean; maxSeconds?: number };

function readSetting(sb: Db) {
  return async (key: string) => {
    const { data, error } = await sb.from("fp_settings").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`the settings: ${error.message || "no answer"}`);
    return data ? data.value : null;
  };
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return refused("Send a POST with an action.", 405);
  const raw = clean(req.headers.get(PASS_HEADER));
  if (!isPassToken(raw)) return refused("Send a filming pipeline pass in the x-pipeline-pass header. Ask the connector for one (pipeline_pass).", 401);
  const sb = db();
  if (!sb) return refused("not set up: the database connection is missing", 503);

  const { data: rows, error: useError } = await sb.rpc("fp_pass_use", { p_token_hash: await passHash(raw) });
  if (useError) return refused("Could not check the pipeline pass.", 503);
  const pass = Array.isArray(rows) ? rows[0] : null;
  if (!pass) return refused("That pipeline pass is not known. Ask the connector for a new one (pipeline_pass).", 401);
  if (pass.expired) return refused(`That pipeline pass ran out at ${String(pass.expires_at)}. Ask the connector for a new one (pipeline_pass).`, 401);
  const gate = await pipelineGate(readSetting(sb), { member: String(pass.member ?? ""), teamLink: pass.via !== "personal" });
  if (gate) return refused(gate.text, gate.status);

  // deno-lint-ignore no-explicit-any
  const b = await req.json().catch(() => ({})) as Record<string, any>;
  const action = clean(b.action);
  const plan = buildRequest(action, b) as Plan;
  if (!plan.ok) return refused(String(plan.error), 400);

  if (plan.watch && !clean(Deno.env.get("GEMINI_API_KEY"))) return refused("Watching is not set up yet (the Gemini key is missing in Supabase). Tell the Connector supervisor.", 503);
  const key = clean(Deno.env.get("SCRAPECREATORS_API_KEY"));
  if (!key) return refused("ScrapeCreators is not set up yet (the key is missing in Supabase). Tell the Connector supervisor.", 503);

  const member = String(pass.member ?? "");
  const line = logLine(action, plan, b);
  const row = { member_name: member, tool: line.tool, client: String(pass.client_slug ?? ""), summary: line.summary };

  // The call is written down BEFORE it is made, as a used call, and only then
  // counted: parallel requests cannot all pass a count taken before any of them
  // is written, and a call cannot be made without its row. A call that does not
  // go through is marked failed afterwards (if that update is lost the call
  // stays counted, which is the safe side).
  const entry = await sb.from("hf_activity").insert({ ...row, ok: true, error: null }).select("id").single();
  if (entry.error || !entry.data) return refused("Could not write the call down, so it was not made.", 503);
  const entryId = entry.data.id;
  const fail = async (error: string) => { await sb.from("hf_activity").update({ ok: false, error }).eq("id", entryId); };

  if (plan.counts) {
    let cap: number;
    try { cap = capFrom(await readSetting(sb)(CAP_KEY)); } catch (_e) { await fail("could not read the monthly limit"); return refused("Could not read the monthly limit, so the call was not made.", 503); }
    const used = await sb.from("hf_activity").select("id", { count: "exact", head: true })
      .like("tool", "scrapecreators.%").neq("tool", "scrapecreators.credits").eq("ok", true).gte("created_at", monthStart());
    if (used.error) { await fail("could not count this month's calls"); return refused("Could not count this month's calls, so the call was not made.", 503); }
    if ((used.count ?? 0) > cap) {
      await fail("monthly limit reached");
      return refused(`The monthly ScrapeCreators limit (${cap} calls) is used up. Ask the account owner to raise it.`, 429);
    }
  }

  if (plan.watch) return await watch(plan, String(b.url), key, fail, async (summary: string) => { await sb.from("hf_activity").update({ summary }).eq("id", entryId); });

  const url = new URL(BASE + plan.path);
  for (const [k, v] of Object.entries(plan.query)) url.searchParams.set(k, v);
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { "x-api-key": key, Accept: "application/json" } });
  } catch (_e) {
    await fail("no answer from ScrapeCreators");
    return refused("ScrapeCreators did not answer. Try again in a minute.", 502);
  }
  const text = await resp.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch (_e) { /* not JSON */ }
  if (!resp.ok) {
    const why = resp.status === 401 || resp.status === 402 ? "ScrapeCreators refused the key or is out of credits. Tell the Connector supervisor."
      : resp.status === 429 ? "ScrapeCreators says too many calls at once. Wait a moment and try again."
      : resp.status === 404 ? "ScrapeCreators found nothing for that."
      : `ScrapeCreators could not do that (status ${resp.status}).`;
    await fail(`status ${resp.status}`);
    return json({ ok: false, error: why, status: resp.status }, resp.status === 404 ? 404 : 502);
  }
  return json({ ok: true, action, result: slimResult(action, data ?? text) });
}

// Gemini watches one video. The file is found through ScrapeCreators (Instagram, TikTok) or opened by Gemini from the
// link (YouTube). A video longer than max_seconds is refused before anything is sent to Gemini.
async function watch(plan: Plan, link: string, scKey: string, fail: (e: string) => Promise<void>, note: (s: string) => Promise<void>): Promise<Response> {
  const gKey = clean(Deno.env.get("GEMINI_API_KEY"));
  const max = plan.maxSeconds ?? 180;
  let video: { fileUri?: string; base64?: string; mime?: string };
  let seconds: number | null = null;
  if (plan.site === "youtube") {
    video = { fileUri: link };
  } else {
    const u = new URL(BASE + plan.path);
    for (const [k, v] of Object.entries(plan.query)) u.searchParams.set(k, v);
    let data: unknown = null;
    try {
      const r = await fetch(u, { headers: { "x-api-key": scKey, Accept: "application/json" } });
      if (!r.ok) { await fail(`status ${r.status}`); return refused(`ScrapeCreators could not find that video (status ${r.status}).`, 502); }
      data = await r.json();
    } catch (_e) { await fail("no answer from ScrapeCreators"); return refused("ScrapeCreators did not answer. Try again in a minute.", 502); }
    const m = mediaFrom(plan.site, data);
    seconds = m.seconds;
    if (seconds !== null && seconds > max) { await fail(`too long: ${Math.round(seconds)} s`); return json({ ok: false, error: `The video is ${Math.round(seconds)} seconds, over the ${max} second limit, so it was not watched.`, too_long: true, seconds }, 422); }
    if (!m.url) { await fail("no video file in the answer"); return refused("ScrapeCreators gave no video file for that link.", 404); }
    let bytes: Uint8Array;
    try {
      const f = await fetch(m.url);
      if (!f.ok) { await fail(`file status ${f.status}`); return refused(`The video file could not be fetched (status ${f.status}).`, 502); }
      const len = Number(f.headers.get("content-length") || 0);
      if (len > WATCH_MAX_BYTES) { await fail("file too big"); return refused("The video file is too big to watch.", 422); }
      bytes = new Uint8Array(await f.arrayBuffer());
    } catch (_e) { await fail("file not fetched"); return refused("The video file could not be fetched.", 502); }
    if (bytes.length > WATCH_MAX_BYTES) { await fail("file too big"); return refused("The video file is too big to watch.", 422); }
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    video = { base64: btoa(bin), mime: "video/mp4" };
  }
  let g: Response;
  try {
    g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${WATCH_MODEL}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": gKey }, body: JSON.stringify(geminiBody(video)) });
  } catch (_e) { await fail("no answer from Gemini"); return refused("Gemini did not answer. Try again in a minute.", 502); }
  // deno-lint-ignore no-explicit-any
  const out = await g.json().catch(() => ({})) as Record<string, any>;
  if (!g.ok) { await fail(`gemini status ${g.status}`); return json({ ok: false, error: `Gemini could not watch it (status ${g.status}).`, status: g.status }, 502); }
  const cost = watchCost(out.usageMetadata);
  const text = String(out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "");
  let read: unknown = null;
  try { read = JSON.parse(text); } catch (_e) { read = { transcript: text }; }
  if (seconds !== null && read && typeof read === "object" && (read as Record<string, unknown>).seconds == null) (read as Record<string, unknown>).seconds = seconds;
  await note(`watch: ${plan.site} - $${cost.toFixed(4)}`);
  return json({ ok: true, action: "watch", result: { read, model: WATCH_MODEL, usage: out.usageMetadata ?? null, cost_usd: cost, seconds } });
}

Deno.serve(async (req) => {
  try { return await handle(req); } catch (_e) { return refused("Something went wrong in pipeline-social.", 500); }
});
