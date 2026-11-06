// studio_action "make_music": ElevenLabs Music (Eleven Music), through the team's server-side key
// (nobody keeps a key on their own computer). Music Bank stays the default; this runs only when the
// person says yes. First call shows a card and changes nothing; go: true reserves and starts.
//
// HARD LIMITS (Sidney 2026-11-06: nobody may burn a batch of credits at once; no per-person or per-track
// count limits, editors make many tracks):
//   - one track is 3 seconds to 5 minutes (ElevenLabs allows up to 10 minutes);
//   - music started per UTC day (ELEVENLABS_MUSIC_DAY_USD) and per month (ELEVENLABS_MUSIC_MONTH_USD) is capped in
//     reserved dollars, counted and reserved in one serialized database step
//     (migration 20261106180000_hf_music_reserve.sql) so concurrent requests cannot both pass;
//   - the price reserved is a ceiling, set high on purpose, against the team's monthly cap too;
//   - a double click never starts two tracks (idempotency key).
// Every limit has a built-in default and can only be tightened or loosened by the account owner in the
// Supabase secrets, never by the person asking.
//
// Facts from ElevenLabs' docs (read 2026-11-06): POST https://api.elevenlabs.io/v1/music, JSON body
// { prompt, music_length_ms (3000 to 600000), model_id, force_instrumental }, header xi-api-key (same
// key as transcription), the answer is the audio file (MP3 by default). The docs state no price and do
// not say how long a call takes, so the price below is a deliberately high ceiling and the first live
// call must confirm the format and the credits used (HIGGSFIELD_CONNECTOR_LESSONS rule 1).
import { elevenKey } from "./transcribe.mjs";
import { LINK_SECONDS, money } from "./voice.mjs";
import { extFor, typeFor } from "./isolate.mjs";

export const MUSIC_URL = "https://api.elevenlabs.io/v1/music";
export const MUSIC_MODEL = "elevenlabs/music";
export const MUSIC_MODEL_ID = "music_v2_5";
export const MIN_SECONDS = 3;
export const MAX_SECONDS = 300;
export const DEFAULT_SECONDS = 30;
// A ceiling, not a measurement: ElevenLabs publishes no price. Reserved per started minute.
export const DEFAULT_USD_PER_MIN = 1;
export const DEFAULT_DAY_USD = 30;
export const DEFAULT_MONTH_USD = 150;
export const MAX_PROMPT_CHARS = 1500;
export const STALE_RUNNING_MS = 10 * 60 * 1000;
export const NO_KEY_TEXT = "Music is not switched on yet: the account owner needs to add the ElevenLabs key.";

// A setting must be a plain positive number; anything else is "invalid" (null), never a silent default.
function num(raw, dflt, whole) {
  const s = String(raw ?? "").trim();
  if (!s) return dflt;
  if (!(whole ? /^\d+$/ : /^\d+(\.\d+)?$/).test(s) || !(Number(s) > 0)) return null;
  return Number(s);
}
export function limits(env) {
  const l = {
    rate: num(env("ELEVENLABS_MUSIC_USD_PER_MIN"), DEFAULT_USD_PER_MIN, false),
    day: num(env("ELEVENLABS_MUSIC_DAY_USD"), DEFAULT_DAY_USD, false),
    month: num(env("ELEVENLABS_MUSIC_MONTH_USD"), DEFAULT_MONTH_USD, false),
  };
  return Object.values(l).some((v) => v === null) ? null : l;
}
export function musicPrice(seconds, rate) {
  return Math.ceil(Math.ceil(seconds / 60) * rate * 100 - 1e-9) / 100;
}
function seconds(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_SECONDS;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}
export function musicCard(prompt, secs, instrumental, usd, l) {
  return [
    "Plan: make a music track (ElevenLabs Music)",
    `- Idea: ${prompt.length > 200 ? prompt.slice(0, 200) + "..." : prompt}`,
    `- Length: ${secs} seconds (3 seconds to 5 minutes allowed)`,
    `- ${instrumental ? "Instrumental, no singing" : "May include vocals"}`,
    "- Output: an MP3 you can download",
    `- Price: up to ${money(usd)} (a safe ceiling; ElevenLabs does not publish a price)`,
    `- Guard: music for the whole team is capped at ${money(l.day)} a day and ${money(l.month)} a month, so nothing can use up a batch of credits`,
  ].join("\n");
}
const nowIso = (d) => (d.now ? d.now() : new Date()).toISOString();

export async function makeMusic(d, args) {
  const key = elevenKey(d.env);
  if (!key) return NO_KEY_TEXT;
  const l = limits(d.env);
  if (!l) return "Could not price it: one of the music settings is not a valid number. Ask the account owner.";
  const prompt = String(args.prompt || "").replace(/\s+/g, " ").trim();
  if (!prompt) return "Give a prompt: what the music should feel like (style, mood, instruments).";
  if (prompt.length > MAX_PROMPT_CHARS) return `That description is ${prompt.length} characters; keep it under ${MAX_PROMPT_CHARS}.`;
  const secs = seconds(args.seconds);
  if (!(secs >= MIN_SECONDS && secs <= MAX_SECONDS)) return `Music tracks here run from ${MIN_SECONDS} seconds to 5 minutes (${MAX_SECONDS} seconds). Pick a length in that range.`;
  const instrumental = args.instrumental !== false;
  const usd = musicPrice(secs, l.rate);
  if (args.go !== true) {
    return musicCard(prompt, secs, instrumental, usd, l) + "\n\nSay go, or tell me what to change. (After go, call studio_action make_music again with the same args and go: true.)";
  }
  if (d.cap === null || d.cap === undefined) return "The monthly budget setting (HF_MONTHLY_CAP_USD) is not a valid dollar amount, so nothing new can be made. Ask the account owner.";
  // The hard limits are counted and the row is reserved in ONE serialized database step (hf_music_reserve),
  // so two requests at the same moment cannot both pass a limit. If that step is missing or fails, nothing starts.
  const params = { prompt, seconds: secs, instrumental, engine: "elevenlabs-music" };
  const rsv = await d.reserveMusic({ member: d.author, prompt: "Music: " + prompt.slice(0, 200), params, cost: usd, cap: d.cap, idemKey: await d.idemKey(d.author, MUSIC_MODEL, { prompt, secs, instrumental }), day: l.day, month: l.month });
  if (!rsv) return "Could not check the music limits, so nothing was started or spent. Try again in a minute.";
  if (rsv.outcome === "day_budget") return `Refused: this would pass the team's music limit for today of ${money(l.day)} (${money(Number(rsv.used))} already started today). Try again tomorrow, use Music Bank, or ask the account owner.`;
  if (rsv.outcome === "month_budget") return `Refused: this would pass the monthly music budget of ${money(l.month)} (${money(Number(rsv.used))} used). Use Music Bank, or ask the account owner.`;
  if (rsv.outcome !== "reserved" && rsv.outcome !== "over_cap" && rsv.outcome !== "duplicate") return "Could not check the music limits, so nothing was started or spent. Try again in a minute.";
  if (rsv.outcome === "over_cap") return `Refused: this (${money(usd)}) would pass the team's monthly budget of ${money(d.cap)} (${money(Number(rsv.spent))} already used). Ask the account owner.`;
  if (rsv.outcome === "duplicate") {
    return rsv.request_id ? `This exact track was already started a moment ago, so it was not charged twice.\njob_id: ${rsv.request_id}\nUse wait_for_job with that job_id.` : "This exact track is being started right now. Wait a minute, then ask for team_usage to find its job.";
  }
  const rowId = Number(rsv.id);
  const jobId = d.uuid();
  try {
    const n = await d.update(rowId, { request_id: jobId, status: "in_progress", params, updated_at: nowIso(d) });
    if (!n) throw new Error("no row");
  } catch {
    await d.update(rowId, { status: "failed", est_cost_usd: 0, error: "could not record the job", updated_at: nowIso(d) }).catch(() => {});
    return "Could not record the job, so nothing was started or spent. Try again.";
  }
  d.background(runMusic(d, key, rowId, jobId, prompt, secs, instrumental));
  return `Started: music track, ${secs} seconds, up to ${money(usd)}.\njob_id: ${jobId}\nNow call wait_for_job with this job_id. It usually takes under a minute.`;
}

async function runMusic(d, key, rowId, jobId, prompt, secs, instrumental) {
  const fail = (status, error) => d.update(rowId, { status, error, updated_at: nowIso(d) }).catch(() => {});
  try {
    let res;
    try {
      res = await d.fetch(MUSIC_URL + "?output_format=mp3_44100_128", {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ prompt, music_length_ms: secs * 1000, model_id: MUSIC_MODEL_ID, force_instrumental: instrumental }),
        signal: d.timeout ? d.timeout(280000) : undefined,
      });
    } catch (e) {
      // The request may have been accepted and billed: counted until someone looks.
      return await fail("failed_charged", "no answer from ElevenLabs: " + String(e?.message || e).slice(0, 150));
    }
    if (!res.ok || !res.body) {
      const text = (await res.text().catch(() => "")).replace(/\s+/g, " ");
      const why = d.errorText ? d.errorText(res.status, text) : `ElevenLabs answered ${res.status}: ${text.slice(0, 200)}`;
      return await fail("failed", why);
    }
    const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type.includes("json") || type === "text/html") return await fail("failed_charged", "ElevenLabs answered with text instead of audio");
    const ext = extFor(type);
    const path = `${jobId}.${ext}`;
    await d.upload(path, res.body, typeFor(ext));
    await d.update(rowId, { status: "completed", video_url: path, error: null, updated_at: nowIso(d) });
  } catch (e) {
    await fail("failed_charged", "could not finish: " + String(e?.message || e).replace(/https?:\/\/\S+/g, "(link)").slice(0, 200));
  }
}

export async function musicCheck(row, d) {
  const cost = money(Number(row.est_cost_usd || 0));
  if (row.status === "completed" && row.video_url) {
    try {
      const url = await d.sign(String(row.video_url), LINK_SECONDS);
      return `Done. Reserved ${cost}. Download the track (${String(row.video_url).split(".").pop()} file; the link works for 1 hour, check_job with this job_id gives a fresh one). The old track, if any, is untouched:\n${url}`;
    } catch (e) {
      return "Could not make the download link: " + String(e?.message || e).slice(0, 200) + ". Try check_job again in a minute.";
    }
  }
  if (row.status === "failed") return "It failed: " + String(row.error || "no reason given").replace(/\.$/, "") + ". Nothing was spent.";
  if (row.status === "failed_charged") return "It failed: " + String(row.error || "no reason given") + `. ElevenLabs may have charged for it (${cost}, counted in the budget).`;
  const age = (d.now ? d.now() : new Date()).getTime() - Date.parse(String(row.updated_at || ""));
  if (age > STALE_RUNNING_MS) {
    await d.update(row.id, { status: "failed_charged", error: "the track never finished", updated_at: nowIso(d) });
    return `It never finished. ElevenLabs may have charged for it (${cost}, counted in the budget). Start it again if you need it.`;
  }
  return "Still working. Check again in about 20 to 30 seconds.";
}
