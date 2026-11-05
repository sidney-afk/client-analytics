// voice_cleanup with engine "elevenlabs": ElevenLabs Voice Isolator, through the team's server-side key
// (nobody keeps a key on their own computer). Same flow as the Auphonic engine: the first call shows a
// price card and changes nothing; go: true reserves the price against the monthly cap and starts the
// job; check_job / wait_for_job (voiceCheck in voice.mjs hands rows with params.engine elevenlabs to isolateCheck here)
// hand back a private link. Unlike Auphonic the call is one request that returns the audio, so it runs
// in the background of the starting call and the row says in_progress until it is stored.
//
// Facts from ElevenLabs' docs (read 2026-11-05): POST https://api.elevenlabs.io/v1/audio-isolation,
// multipart field "audio"; $0.12 per minute of audio on the API price page; up to 500 MB and 1 hour.
// The docs do NOT say what format comes back, so the result is stored under the type the answer names
// (usually MP3) and the card says so. The first live call must confirm it (HIGGSFIELD_CONNECTOR_LESSONS rule 1).
import { elevenKey } from "./transcribe.mjs";
import { readWavHead, MAX_VOICE_SECONDS, LINK_SECONDS, VOICE_MODEL, money } from "./voice.mjs";

export const ISOLATE_URL = "https://api.elevenlabs.io/v1/audio-isolation";
export const DEFAULT_USD_PER_MIN = 0.12;
// The whole file is held in memory to be sent, so the limit is lower than Auphonic's.
export const MAX_ISOLATE_BYTES = 100 * 1024 * 1024;
export const STALE_RUNNING_MS = 15 * 60 * 1000;
export const NO_KEY_TEXT = "The voice isolator is not switched on yet: the account owner needs to add the ElevenLabs key.";

export function usdPerMinute(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return DEFAULT_USD_PER_MIN;
  if (!/^\d+(\.\d+)?$/.test(s) || !(Number(s) > 0)) return null;
  return Number(s);
}
// Billed by the audio's length, a started minute counts (rounded up to the cent, never low).
export function isolatePrice(seconds, rate) {
  return Math.ceil(Math.ceil((Number(seconds) || 0) / 60) * rate * 100 - 1e-9) / 100;
}
export function extFor(type) {
  const t = String(type || "").toLowerCase();
  if (/wav|wave/.test(t)) return "wav";
  if (/mpeg|mp3/.test(t)) return "mp3";
  if (/ogg|opus/.test(t)) return "ogg";
  if (/flac/.test(t)) return "flac";
  if (/mp4|m4a|aac/.test(t)) return "m4a";
  return "mp3";
}
export function isolateCard(file, usd, rate) {
  return [
    "Plan: voice clean-up (ElevenLabs Voice Isolator)",
    `- File: ${(file.seconds / 60).toFixed(1)} minutes, ${file.sampleRate} Hz, ${file.channels === 1 ? "mono" : file.channels + " channels"} WAV`,
    "- Removes everything except the voice (noise, music, room sound), stronger than Auphonic's gentle setting",
    "- Output: the cleaned voice as an audio file (usually MP3; ElevenLabs decides the format)",
    `- Price: about ${money(usd)} (${money(rate)} a minute, a started minute counts)`,
  ].join("\n");
}
const BAD_CAP = "The monthly budget setting (HF_MONTHLY_CAP_USD) is not a valid dollar amount, so nothing new can be made. Ask the account owner.";
const nowIso = (d) => (d.now ? d.now() : new Date()).toISOString();

export async function isolateCleanup(args, d) {
  const key = elevenKey(d.env);
  if (!key) return NO_KEY_TEXT;
  const file = String(args.file || "").trim();
  if (!/^https:\/\//i.test(file)) return "The link must start with https://";
  const rate = usdPerMinute(d.env("ELEVENLABS_ISOLATOR_USD_PER_MIN"));
  if (rate === null) return "Could not price it: the setting ELEVENLABS_ISOLATOR_USD_PER_MIN is not a valid dollar amount. Ask the account owner.";
  const link = d.directLink(file);
  const wav = await readWavHead(link, d);
  if (typeof wav === "string") return wav;
  if (wav.seconds > MAX_VOICE_SECONDS) return `That file is ${(wav.seconds / 60).toFixed(1)} minutes long; voice clean-up takes up to 5 minutes. Trim it or split it into parts.`;
  if (!(wav.seconds > 0)) return "That file has no audio in it.";
  const usd = isolatePrice(wav.seconds, rate);
  if (args.go !== true) {
    return isolateCard(wav, usd, rate) + "\n" + await d.budget()
      + "\n\nSay go, or tell me what to change. (After go, call voice_cleanup again with the same file, engine elevenlabs and go: true.)";
  }
  if (d.cap === null || d.cap === undefined) return BAD_CAP;
  const params = { file: link, engine: "elevenlabs", seconds: Math.round(wav.seconds * 10) / 10 };
  const rsv = await d.reserve({ member: d.author, model: VOICE_MODEL, prompt: "Voice isolator", params, cost: usd, cap: d.cap, idemKey: await d.idemKey(d.author, VOICE_MODEL, { file: link, engine: "elevenlabs" }) });
  if (!rsv) return "Could not start: the log is unavailable, so nothing was spent.";
  if (rsv.outcome === "over_cap") return `Refused: this (${money(usd)}) would pass the team's monthly budget of ${money(d.cap)} (${money(Number(rsv.spent))} already used). Ask the account owner.`;
  if (rsv.outcome === "duplicate") {
    return rsv.request_id ? `This exact clean-up was already started a moment ago, so it was not charged twice.\njob_id: ${rsv.request_id}\nUse wait_for_job with that job_id.` : "This exact clean-up is being started right now. Wait a minute, then ask for team_usage to find its job.";
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
  d.background(runIsolate(d, key, rowId, jobId, link));
  return `Started: voice isolator, about ${money(usd)}.\njob_id: ${jobId}\nNow call wait_for_job with this job_id. It usually takes about a minute.`;
}

async function runIsolate(d, key, rowId, jobId, link) {
  const fail = (status, error) => d.update(rowId, { status, error, updated_at: nowIso(d) }).catch(() => {});
  try {
    const src = await d.fetch(link, { redirect: "follow" });
    if (!src.ok) return await fail("failed", `could not download the recording (${src.status})`);
    const bytes = new Uint8Array(await src.arrayBuffer());
    if (bytes.length > MAX_ISOLATE_BYTES) return await fail("failed", "the recording is over 100 MB");
    const form = new FormData();
    form.append("audio", new Blob([bytes], { type: "audio/wav" }), "voice.wav");
    let res;
    try {
      res = await d.fetch(ISOLATE_URL, { method: "POST", headers: { "xi-api-key": key }, body: form, signal: d.timeout ? d.timeout(240000) : undefined });
    } catch (e) {
      // The request may have been accepted and billed: counted until someone looks.
      return await fail("failed_charged", "no answer from ElevenLabs: " + String(e?.message || e).slice(0, 150));
    }
    if (!res.ok || !res.body) {
      const msg = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      const why = res.status === 401 ? "ElevenLabs did not accept the key; the account owner needs to check it"
        : res.status === 402 || res.status === 429 ? "the ElevenLabs account is out of credits or too busy; the account owner needs to check it" : `ElevenLabs answered ${res.status}: ${msg}`;
      return await fail("failed", why);
    }
    const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type.includes("json") || type === "text/html") return await fail("failed_charged", "ElevenLabs answered with text instead of audio");
    const path = `${jobId}.${extFor(type)}`;
    await d.upload(path, res.body, type.startsWith("audio/") ? type : "audio/mpeg");
    await d.update(rowId, { status: "completed", video_url: path, error: null, updated_at: nowIso(d) });
  } catch (e) {
    await fail("failed_charged", "could not finish: " + String(e?.message || e).replace(/https?:\/\/\S+/g, "(link)").slice(0, 200));
  }
}

export async function isolateCheck(row, d) {
  const cost = money(Number(row.est_cost_usd || 0));
  if (row.status === "completed" && row.video_url) {
    try {
      const url = await d.sign(String(row.video_url), LINK_SECONDS);
      return `Done. It cost ${cost}. Download the cleaned voice (${String(row.video_url).split(".").pop()} file; the link works for 1 hour, check_job with this job_id gives a fresh one):\n${url}`;
    } catch (e) {
      return "Could not make the download link: " + String(e?.message || e).slice(0, 200) + ". Try check_job again in a minute.";
    }
  }
  if (row.status === "failed") return "It failed: " + String(row.error || "no reason given").replace(/\.$/, "") + ". Nothing was spent.";
  if (row.status === "failed_charged") return "It failed: " + String(row.error || "no reason given") + `. ElevenLabs may have charged for it (${cost}, counted in the team budget).`;
  const age = (d.now ? d.now() : new Date()).getTime() - Date.parse(String(row.updated_at || ""));
  if (age > STALE_RUNNING_MS) {
    await d.update(row.id, { status: "failed_charged", error: "the clean-up never finished", updated_at: nowIso(d) });
    return `It never finished. ElevenLabs may have charged for it (${cost}, counted in the team budget). Start it again if you need it.`;
  }
  return "Still working. Check again in about 20 to 30 seconds.";
}
