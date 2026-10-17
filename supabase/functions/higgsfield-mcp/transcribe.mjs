// studio_transcribe: a take transcribed by ElevenLabs Speech-to-Text through
// the team connector, so no editor keeps an ElevenLabs key on their computer.
//
// Plain JavaScript with no Deno parts: every decision (the request, the price,
// the WAV length, the cache key, ElevenLabs' answers, the job's states) lives
// here and runs in the unit lane (test/higgsfield-studio-transcribe.js).
// index.ts registers the tool and hands in what it needs (database and
// storage through transcribe.ts, fetch, the public-address check, the budget
// line); nothing here reads Deno.env.
//
// The request is the studio's own (synchro-pipelines editor-ai/scripts/
// pipeline.py transcribe()): POST /v1/speech-to-text, model_id scribe_v2,
// diarize=true, timestamps_granularity=word. The one difference: the studio
// uploads the WAV, the server passes its link as source_url and ElevenLabs
// downloads it itself (checked 2026-10-17 against
// https://elevenlabs.io/docs/api-reference/speech-to-text/convert: source_url
// takes any https audio link, under 2 GB; cloud_storage_url is deprecated in
// its favour). So the file never passes through the connector.
//
// The flow matches voice_cleanup: the first call shows a price card and
// changes nothing; only a second call with go: true reserves the price
// against the monthly cap and starts the job. ElevenLabs answers in one long
// request, so the job runs in the background; check_job and wait_for_job read
// its row and hand back a signed link (1 hour) to ElevenLabs' JSON, stored
// unchanged in the private Storage bucket "transcripts".

import { money, parseWavHeader, totalBytesOf } from "./voice.mjs";

export const STT_MODEL = "elevenlabs/scribe_v2";
export const STT_BUCKET = "transcripts";
export const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
export const SECRET_NAMES = ["ELEVENLABS_KEY", "ELEVENLABS_API_KEY"];

export const NO_KEY_TEXT = "Transcription is not switched on yet: the account owner needs to add the ElevenLabs key.";

// Up to 30 minutes (a few seconds over is let through). The server waits for
// ElevenLabs' answer in one request, and a background job has a few minutes.
export const MAX_STT_SECONDS = 30 * 60 + 5;
// ElevenLabs' own limit for a linked file is under 2 GB.
export const MAX_STT_BYTES = 2 * 1000 * 1000 * 1000;
// Dollars per hour of audio. ElevenLabs' API price for Scribe v2 is $0.22 an
// hour (https://elevenlabs.io/pricing/api, checked 2026-10-17), but a
// subscription account pays in credits instead: 330 credits a minute, and the
// dearest extra credits found are $0.30 per 1,000 (Creator), which is $5.94
// an hour. The default is that, rounded up, so the estimate never comes in
// low; ELEVENLABS_USD_PER_HOUR overrides it for the plan the key belongs to.
export const DEFAULT_USD_PER_HOUR = 6;
export const LINK_SECONDS = 3600;
// The longest the background request is given; past it the job is unknown.
export const REQUEST_TIMEOUT_MS = 380 * 1000;
// A job that has said "in_progress" this long never got its answer stored.
export const STALE_RUNNING_MS = 15 * 60 * 1000;
// The length guard: ElevenLabs' reported length may pass the priced length by
// this much (rounding, a header a little off); more means the linked file is
// not the one that was priced.
export const LENGTH_SLACK_SECONDS = 5;
export const LENGTH_SLACK_SHARE = 0.02;
// The transcript is JSON text; a 30 minute take is a few MB.
export const MAX_RESULT_BYTES = 50 * 1024 * 1024;
// The cache key reads this much from each end of the file.
export const FINGERPRINT_BYTES = 256 * 1024;
const FINGERPRINT_TAG = "stt-fp-1";

// The fields of the multipart form, exactly the studio's, with the link in
// place of the uploaded file.
export function sttForm(link) {
  return [
    ["model_id", "scribe_v2"],
    ["diarize", "true"],
    ["timestamps_granularity", "word"],
    ["source_url", link],
  ];
}

// Which secret holds the key: ELEVENLABS_KEY first, then ELEVENLABS_API_KEY.
export function elevenKey(env) {
  for (const name of SECRET_NAMES) {
    const v = String(env(name) || "").trim();
    if (v) return v;
  }
  return "";
}

// The per-hour price setting: unset uses the default; anything that is not a
// plain positive dollar amount is null, and nothing new is priced or started.
export function usdPerHour(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return DEFAULT_USD_PER_HOUR;
  if (!/^\d+(\.\d+)?$/.test(s) || !(Number(s) > 0)) return null;
  return Number(s);
}

// ElevenLabs bills by the audio's length; at least one cent is reserved.
export function priceFor(seconds, rate) {
  const s = Math.max(0, Number(seconds) || 0);
  return Math.max(0.01, Math.ceil((s / 3600) * rate * 100 - 1e-9) / 100);
}

export function tooLong(reportedSeconds, pricedSeconds) {
  const r = Number(reportedSeconds);
  const p = Number(pricedSeconds);
  if (!(r > 0) || !(p > 0)) return false;
  return r > p + Math.max(LENGTH_SLACK_SECONDS, p * LENGTH_SLACK_SHARE);
}

// The cache key, without downloading the file: SHA-256 over the file's total
// size and its first and last 256 KB (two range requests; the first is the
// one that already reads the WAV header). Two different takes share the same
// size and the same opening and closing quarter megabyte of audio only by
// copying. A file whose size is unknown (no range support) gets no key and is
// never cached.
export async function fingerprint(head, tail, totalBytes, digest) {
  if (!(Number(totalBytes) > 0) || !head || !tail) return null;
  const tag = new TextEncoder().encode(`${FINGERPRINT_TAG}\n${Number(totalBytes)}\n`);
  const all = new Uint8Array(tag.length + head.length + tail.length);
  all.set(tag, 0);
  all.set(head, tag.length);
  all.set(tail, tag.length + head.length);
  const hash = new Uint8Array(await digest(all));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Plain English for an ElevenLabs answer that was not a success.
export function elevenErrorText(status, body) {
  if (status === 401 || status === 403) return "ElevenLabs did not accept the key; the account owner needs to check the ElevenLabs key";
  const b = body && typeof body === "object" ? body : {};
  const det = b.detail;
  const raw = typeof det === "string" ? det
    : det && typeof det === "object" && !Array.isArray(det) ? String(det.message || det.status || JSON.stringify(det))
    : Array.isArray(det) ? det.map((x) => (x && x.msg) || JSON.stringify(x)).join("; ")
    : String(b.message || b.raw || "");
  const msg = raw.replace(/\s+/g, " ").trim();
  if (/quota|credit|insufficient|payment|limit_reached|exceeds your/i.test(msg) || status === 402) return "the ElevenLabs account has run out of credits; the account owner needs to top it up";
  if (status === 429) return "ElevenLabs is busy (too many requests); try again in a few minutes";
  if (/download|fetch|source_url|cloud_storage|url|not accessible|could not (open|access|get)/i.test(msg)) return "ElevenLabs could not download the recording. Use the link from get_upload_link or import_file";
  if (/format|decode|codec|corrupt|invalid audio|unsupported|too short/i.test(msg)) return "ElevenLabs could not read the file as audio. Send a WAV recording";
  return `ElevenLabs answered ${status}` + (msg ? ": " + msg.slice(0, 200) : "");
}

function describeFile(f) {
  const mins = (f.seconds / 60).toFixed(1);
  const ch = f.channels === 1 ? "mono" : f.channels === 2 ? "stereo" : `${f.channels} channels`;
  return `${mins} minutes, ${f.sampleRate} Hz, ${ch}, ${f.bits}-bit WAV`;
}

export function priceCard(file, usd, rate) {
  return [
    "Plan: transcribe a take (ElevenLabs Speech-to-Text, Scribe v2)",
    `- File: ${describeFile(file)}`,
    "- Same settings as the studio: speakers marked, a start and end time for every word",
    "- Result: ElevenLabs' transcript file (JSON) exactly as it comes back, ready for the studio's take selection",
    `- Price: about ${money(usd)} (ElevenLabs bills by the audio's length, ${money(rate)} an hour)`,
    "- Transcribing the same file again later is free (the transcript is kept)",
  ].join("\n");
}

export const STT_TOOL = {
  name: "studio_transcribe",
  description: "Transcribe a take for the video studio with ElevenLabs Speech-to-Text (Scribe v2, speakers marked, a start and end time for every word), the same request the studio makes, through the team account so nobody needs their own ElevenLabs key. Takes a WAV of up to 30 minutes. First call it WITHOUT go: it shows the price card, which you show the person exactly as returned, ending with \"Say go, or tell me what to change.\" Only after they say go, call it again with the same file and go: true. That returns a job_id: call wait_for_job with it until it is done; the result is a private download link to ElevenLabs' transcript JSON, unchanged, that works for 1 hour (check_job with the same job_id gives a fresh one). A file transcribed before comes back at once, free, with its job_id.",
  inputSchema: {
    type: "object",
    required: ["file"],
    additionalProperties: false,
    properties: {
      file: { type: "string", description: "Link to the WAV itself: the public_url from get_upload_link (content_type audio/wav) for a file on the computer, the link import_file returned, or a Drive or Dropbox link shared as anyone with the link." },
      go: { type: "boolean", description: "true only after the person said go to this file's price card." },
    },
  },
};

// Follows redirects by hand so every hop passes the public-address check,
// then reads up to max bytes. range is the Range header value.
async function rangedRead(link, range, max, d) {
  let url;
  try { url = new URL(link); } catch { return "The link must start with https://"; }
  for (let hop = 0; hop < 6; hop++) {
    if (!(await d.publicHost(url))) return "That link points somewhere that is not a public https address.";
    let res;
    try {
      res = await d.fetch(url.toString(), { redirect: "manual", headers: { Range: range } });
    } catch {
      return "Could not open that link.";
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel?.();
      url = new URL(res.headers.get("location"), url);
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel?.();
      return `Could not download that link (${res.status}). Make sure it is shared as "anyone with the link".`;
    }
    const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const total = totalBytesOf(res.status, res.headers);
    const bytes = await readUpTo(res.body, max);
    return { status: res.status, type, total, bytes };
  }
  return "That link redirects too many times.";
}

// Reads the WAV header and the cache key. Returns the facts, or a sentence
// for the person.
async function readSource(link, d) {
  const head = await rangedRead(link, `bytes=0-${FINGERPRINT_BYTES - 1}`, FINGERPRINT_BYTES, d);
  if (typeof head === "string") return head;
  if (head.type === "text/html") return "That link opened a web page, not the file. Check the sharing setting, or upload the WAV with get_upload_link.";
  if (head.total !== null && head.total > MAX_STT_BYTES) return "That file is over 2 GB, too big to transcribe.";
  const wav = parseWavHeader(head.bytes, head.total);
  if (wav.error === "not-wav") return "That file is not a WAV recording. Transcription takes WAV files only.";
  if (wav.error) return "Could not read the recording's length from the file. Upload it with get_upload_link (audio/wav) and try again.";
  let key = null;
  // Only a server that honoured the range gives a trustworthy size and tail.
  if (head.status === 206 && head.total) {
    const tail = head.total <= FINGERPRINT_BYTES
      ? { status: 206, bytes: head.bytes, total: head.total }
      : await rangedRead(link, `bytes=-${FINGERPRINT_BYTES}`, FINGERPRINT_BYTES, d);
    if (typeof tail !== "string" && tail.status === 206 && tail.total === head.total) {
      key = await fingerprint(head.bytes, tail.bytes, head.total, d.digest);
    }
  }
  return { ...wav, totalBytes: head.total, key };
}

async function readUpTo(body, max) {
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(total, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.length, out.length - at));
    out.set(part, at);
    at += part.length;
    if (at >= out.length) break;
  }
  return out;
}

const nowIso = (d) => (d.now ? d.now() : new Date()).toISOString();
const BAD_CAP = "The monthly budget setting (HF_MONTHLY_CAP_USD) is not a valid dollar amount, so nothing new can be made. Ask the account owner.";
const BAD_RATE = "Could not price it: the ElevenLabs price setting (ELEVENLABS_USD_PER_HOUR) is not a valid dollar amount. Ask the account owner.";

const cachedText = (jobId) =>
  `This take was transcribed before, so it is free this time (nothing is charged).\njob_id: ${jobId}\nNow call wait_for_job with this job_id for the download link.`;

// d: { env(name), fetch, publicHost(URL), directLink(link), background(p),
//      uuid(), author, cap (number or null), budget(): Promise<string>,
//      digest(bytes): Promise<ArrayBuffer>, idemKey(member, model, input),
//      reserve(p), update(id, fields, only), byRequest(jobId),
//      cached(key): Promise<{request_id, video_url} | null>,
//      upload(path, text), exists(path): Promise<boolean>, sign(path, seconds) }
export async function studioTranscribe(args, d) {
  const key = elevenKey(d.env);
  if (!key) return NO_KEY_TEXT;
  const file = String(args.file || "").trim();
  if (!/^https:\/\//i.test(file)) return "The link must start with https://";
  const rate = usdPerHour(d.env("ELEVENLABS_USD_PER_HOUR"));
  if (rate === null) return BAD_RATE;
  const link = d.directLink(file);
  const src = await readSource(link, d);
  if (typeof src === "string") return src;
  if (src.seconds > MAX_STT_SECONDS) return `That file is ${(src.seconds / 60).toFixed(1)} minutes long; transcription takes up to 30 minutes. Trim it or split it into parts.`;
  if (!(src.seconds > 0)) return "That file has no audio in it.";

  // Already transcribed: free, before and after go.
  if (src.key) {
    const hit = await d.cached(src.key).catch(() => null);
    if (hit && hit.request_id && hit.video_url && await d.exists(String(hit.video_url)).catch(() => false)) {
      return cachedText(String(hit.request_id));
    }
  }

  const usd = priceFor(src.seconds, rate);
  if (args.go !== true) {
    return priceCard(src, usd, rate) + "\n" + await d.budget()
      + "\n\nSay go, or tell me what to change. (After go, call studio_transcribe again with the same file and go: true.)";
  }
  if (d.cap === null || d.cap === undefined) return BAD_CAP;

  const params = {
    file: link,
    seconds: Math.round(src.seconds * 10) / 10,
    sample_rate: src.sampleRate,
    total_bytes: src.totalBytes,
    source_hash: src.key,
    cache_ok: false,
  };
  const rsv = await d.reserve({
    member: d.author,
    model: STT_MODEL,
    prompt: "Transcribe a take (ElevenLabs Scribe v2)",
    params,
    cost: usd,
    cap: d.cap,
    idemKey: await d.idemKey(d.author, STT_MODEL, { file: link, key: src.key }),
  });
  if (!rsv) return "Could not start: the log is unavailable, so nothing was spent.";
  if (rsv.outcome === "over_cap") return `Refused: this (${money(usd)}) would pass the team's monthly budget of ${money(d.cap)} (${money(Number(rsv.spent))} already used). Ask the account owner.`;
  if (rsv.outcome === "duplicate") {
    return rsv.request_id
      ? `This exact transcription was already started a moment ago, so it was not charged twice.\njob_id: ${rsv.request_id}\nUse wait_for_job with that job_id.`
      : "This exact transcription is being started right now. Wait a minute, then ask for team_usage to find its job.";
  }
  const rowId = Number(rsv.id);
  const jobId = d.uuid();
  try {
    const n = await d.update(rowId, { request_id: jobId, status: "in_progress", updated_at: nowIso(d) });
    if (!n) throw new Error("no row");
  } catch {
    await d.update(rowId, { status: "submit_failed", error: "could not record the job id", updated_at: nowIso(d) }).catch(() => {});
    return "Could not start: the log is unavailable, so nothing was spent.";
  }
  d.background(runTranscription(d, key, rowId, jobId, link, params, rate));
  return `Started: transcription of a ${(src.seconds / 60).toFixed(1)} minute take, about ${money(usd)}.\njob_id: ${jobId}\nNow call wait_for_job with this job_id. It usually takes under a minute.`;
}

// The background job: one request to ElevenLabs, the length guard, the
// transcript stored unchanged, the real cost written back.
export async function runTranscription(d, key, rowId, jobId, link, params, rate) {
  const done = (fields) => d.update(rowId, { ...fields, updated_at: nowIso(d) }).catch(() => 0);
  const form = new FormData();
  for (const [k, v] of sttForm(link)) form.append(k, v);
  let res;
  try {
    res = await d.fetch(ELEVENLABS_STT_URL, {
      method: "POST",
      headers: { "xi-api-key": key, Accept: "application/json" },
      body: form,
      signal: d.timeout ? d.timeout(REQUEST_TIMEOUT_MS) : undefined,
    });
  } catch (e) {
    await done({ status: "submit_unknown", error: "no answer from ElevenLabs: " + String(e?.message || e).slice(0, 200) });
    return;
  }
  let text = "";
  try { text = await res.text(); } catch (e) {
    await done({ status: "submit_unknown", error: "ElevenLabs' answer was cut off: " + String(e?.message || e).slice(0, 200) });
    return;
  }
  if (!res.ok) {
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 300) }; }
    const why = elevenErrorText(res.status, body);
    // A 4xx is a refusal (not billed); anything else may have been.
    const refused = res.status >= 400 && res.status < 500;
    await done({ status: refused ? "failed" : "submit_unknown", error: why });
    return;
  }
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!data || typeof data !== "object" || !Array.isArray(data.words)) {
    await done({ status: "delivery_failed", error: "ElevenLabs answered without word timings" });
    return;
  }
  const reported = Number(data.audio_duration_secs);
  const actual = reported > 0 ? priceFor(reported, rate) : priceFor(params.seconds, rate);
  if (tooLong(reported, params.seconds)) {
    // Charged by ElevenLabs, so it stays in the budget (not "failed"); the
    // transcript is not handed out or kept, since it is not of the file priced.
    await done({
      status: "refused_length",
      est_cost_usd: actual,
      params: { ...params, audio_seconds: reported },
      error: `ElevenLabs read ${(reported / 60).toFixed(1)} minutes of audio, more than the ${(params.seconds / 60).toFixed(1)} minutes priced, so the file behind the link changed after pricing`,
    });
    return;
  }
  if (text.length > MAX_RESULT_BYTES) {
    await done({ status: "delivery_failed", est_cost_usd: actual, error: "the transcript is over 50 MB" });
    return;
  }
  const path = `${jobId}.json`;
  try {
    await d.upload(path, text);
  } catch (e) {
    await done({ status: "delivery_failed", est_cost_usd: actual, params: { ...params, audio_seconds: reported }, error: "could not store the transcript: " + String(e?.message || e).slice(0, 200) });
    return;
  }
  await done({
    status: "completed",
    video_url: path,
    est_cost_usd: actual,
    params: { ...params, audio_seconds: reported, cache_ok: Boolean(params.source_hash) },
    error: null,
  });
}

// check_job and wait_for_job for a transcription job (row.model is STT_MODEL).
export async function transcribeCheck(jobId, d) {
  const row = await d.byRequest(jobId);
  if (!row) return "That job_id does not look right.";
  const cost = money(Number(row.est_cost_usd || 0));
  if (row.status === "completed" && row.video_url) {
    try {
      const url = await d.sign(String(row.video_url), LINK_SECONDS);
      return `Done. It cost ${cost}. Download the transcript (ElevenLabs JSON, unchanged; the link works for 1 hour, check_job with this job_id gives a fresh one):\n${url}`;
    } catch (e) {
      return "Could not make the download link: " + String(e?.message || e).slice(0, 200) + ". Try check_job again in a minute.";
    }
  }
  if (row.status === "failed") return "It failed: " + (row.error || "no reason given") + ". ElevenLabs does not charge for a request it refuses, so nothing was spent.";
  if (row.status === "refused_length") return `Refused: ${row.error || "the file was longer than priced"}. ElevenLabs charged for it (${cost}), but the transcript was not kept. Price the file again with studio_transcribe and say go to the new card.`;
  if (row.status === "delivery_failed") return `Could not save the transcript: ${row.error || "storage error"}. It was made and charged (${cost}). Tell the account owner before trying again.`;
  if (row.status === "submit_unknown") return `Could not confirm the transcription with ElevenLabs (${row.error || "no answer"}). It may have been charged (${cost}), so do not send it again straight away: tell the account owner.`;
  if (row.status === "canceled") return "This job was canceled.";
  const age = (d.now ? d.now() : new Date()).getTime() - Date.parse(String(row.updated_at || ""));
  if (age > STALE_RUNNING_MS) {
    const why = "no answer from ElevenLabs was stored (the server stopped waiting)";
    await d.update(row.id, { status: "submit_unknown", error: why, updated_at: nowIso(d) }, { status: String(row.status) }).catch(() => 0);
    return `Could not confirm the transcription with ElevenLabs (${why}). It may have been charged (${cost}), so do not send it again straight away: tell the account owner.`;
  }
  return "Still working (ElevenLabs is transcribing). Check again in about 20 to 30 seconds.";
}
