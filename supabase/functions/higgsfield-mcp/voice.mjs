// voice_cleanup: a recorded voice cleaned up by Auphonic through the team
// connector, so nobody keeps an Auphonic key on their own computer.
//
// Plain JavaScript with no Deno parts: every decision (settings, price, the
// WAV length, Auphonic's answers, the job's states) lives here and runs in the
// unit lane (test/higgsfield-voice-cleanup.js). index.ts registers the tool
// and hands in what it needs (database and storage through voice.ts, fetch,
// the public-address check, the budget line); nothing here reads Deno.env.
//
// The flow matches images and videos: the first call shows a price card and
// changes nothing; only a second call with go: true reserves the price
// against the monthly cap and starts the Auphonic production. check_job and
// wait_for_job poll Auphonic, copy the finished WAV into the private Storage
// bucket "voice" and hand back a signed link. Auphonic's own download link is
// never shown: it only works with the account's key attached.

export const VOICE_MODEL = "auphonic/voice-cleanup";
export const VOICE_BUCKET = "voice";
export const AUPHONIC_API = "https://auphonic.com/api";
export const STRENGTHS = ["gentle", "strong", "studio"];

export const NO_KEY_TEXT = "Voice clean-up is not switched on yet: the account owner needs to add the Auphonic key.";

// Up to 5 minutes (a few seconds over is let through) and about 200 MB.
export const MAX_VOICE_SECONDS = 5 * 60 + 5;
export const MAX_VOICE_BYTES = 200 * 1024 * 1024;
// The result can be a little larger than the input (16-bit WAV of a 8-bit
// file is twice the size), so the copy allows more.
export const MAX_RESULT_BYTES = 400 * 1024 * 1024;
// Auphonic bills processing time by the audio's length, at least 3 minutes
// per production, and nothing for a production that fails.
export const MIN_BILLED_SECONDS = 180;
// Dollars per hour of audio. The default is the dearest current Auphonic
// price (the 5 hour one-time pack, $12, checked 2026-10-17), so the estimate
// never comes in low; AUPHONIC_USD_PER_HOUR overrides it for the plan bought.
export const DEFAULT_USD_PER_HOUR = 2.4;
export const LINK_SECONDS = 3600;
// A copy that has said "storing" this long without finishing is retried.
export const STALE_STORING_MS = 10 * 60 * 1000;
const HEAD_BYTES = 128 * 1024;

const STRENGTH_TEXT = {
  gentle: "background noise taken down by up to 12 dB",
  strong: "background noise removed fully (no limit)",
  studio: "background noise taken down by up to 12 dB, plus Auphonic's Studio Voice filter (beta) for a studio-mic sound",
};

// The Auphonic algorithm settings per strength, exactly as the brief set them
// and named as Auphonic's docs name them (checked 2026-10-17 against
// https://auphonic.com/api/info/algorithms.json and the API details page):
// - denoiseamount is in dB; 0 means "100 dB (full)", which is no limit.
// - deverbamount -1 is "Off": room echo is left as recorded. (Auphonic's
//   default, 0, would remove it fully whenever denoisemethod is dynamic.)
// - silence_cutter defaults to true inside the cutter group, so both are
//   switched off by name rather than left to the defaults.
export function auphonicAlgorithms(strength) {
  if (!STRENGTHS.includes(strength)) throw new Error("unknown strength");
  return {
    denoise: true,
    denoisemethod: "dynamic",
    denoiseamount: strength === "strong" ? 0 : 12,
    deverbamount: -1,
    leveler: false,
    normloudness: false,
    filtering: strength === "studio",
    ...(strength === "studio" ? { filtermethod: "studiovoice" } : {}),
    cutter: false,
    silence_cutter: false,
  };
}

// The whole request to POST /api/productions.json. Output is 16-bit PCM WAV
// ("wav"); Auphonic has no sample-rate setting, it keeps the input's rate.
export function productionBody(strength, inputUrl, jobId) {
  return {
    input_file: inputUrl,
    metadata: { title: `voice clean-up ${String(jobId).slice(0, 8)}` },
    output_basename: `voice-${String(jobId).slice(0, 8)}`,
    output_files: [{ format: "wav" }],
    algorithms: auphonicAlgorithms(strength),
    action: "start",
  };
}

// The per-hour price setting: unset uses the default; anything that is not a
// plain positive dollar amount is null, and nothing new is priced or started.
export function usdPerHour(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return DEFAULT_USD_PER_HOUR;
  if (!/^\d+(\.\d+)?$/.test(s) || !(Number(s) > 0)) return null;
  return Number(s);
}

export function priceFor(seconds, rate) {
  const billed = Math.max(MIN_BILLED_SECONDS, Number(seconds) || 0);
  return Math.ceil((billed / 3600) * rate * 100 - 1e-9) / 100;
}

export function money(n) {
  return "$" + Number(n).toFixed(2);
}

const ascii = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

const PCM_BITS = new Set([8, 16, 24, 32, 64]);

// Plain PCM (1) or float (3), directly or inside WAVE_FORMAT_EXTENSIBLE (0xFFFE),
// with a byte rate and block size that match the sample rate, channels and bits.
export function pcmFormat(fmt) {
  if (!fmt) return false;
  const code = fmt.format === 0xFFFE ? fmt.subFormat : fmt.format;
  if (code !== 1 && code !== 3) return false;
  if (!(fmt.channels > 0) || !(fmt.sampleRate > 0) || !PCM_BITS.has(fmt.bits)) return false;
  const frame = (fmt.channels * fmt.bits) / 8;
  return fmt.blockAlign === frame && fmt.byteRate === fmt.sampleRate * frame;
}

// The length of a WAV from its first bytes: the "fmt " chunk gives the bytes
// per second, the "data" chunk its size. RF64 (WAV over 4 GB, also written by
// some recorders for any length) keeps the real size in "ds64". A size of 0
// or one running past the file (a recorder that never filled it in) falls
// back to the file's total size, when known.
export function parseWavHeader(bytes, totalBytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 12) return { error: "not-wav" };
  const riff = ascii(b, 0);
  if ((riff !== "RIFF" && riff !== "RF64") || ascii(b, 8) !== "WAVE") return { error: "not-wav" };
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fmt = null;
  let ds64Data = null;
  let at = 12;
  while (at + 8 <= b.length) {
    const id = ascii(b, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "ds64" && body + 24 <= b.length) {
      ds64Data = Number(view.getBigUint64(body + 8, true));
    } else if (id === "fmt " && body + 16 <= b.length) {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        byteRate: view.getUint32(body + 8, true),
        blockAlign: view.getUint16(body + 12, true),
        bits: view.getUint16(body + 14, true),
        // WAVE_FORMAT_EXTENSIBLE keeps the real format in the first two bytes of its sub-format.
        subFormat: size >= 40 && body + 26 <= b.length ? view.getUint16(body + 24, true) : null,
      };
    } else if (id === "data") {
      if (!fmt) return { error: "no-length" };
      // Only plain PCM or float audio has a length that follows from its size. A compressed
      // stream (MP3 and others) can sit in a RIFF/WAVE file with any byte rate written in the
      // header, so its length would be priced from a number the file chooses (2026-10-17).
      if (!pcmFormat(fmt)) return { error: "not-pcm" };
      let dataBytes = size;
      if (riff === "RF64" && size === 0xFFFFFFFF && ds64Data) dataBytes = ds64Data;
      const total = Number(totalBytes) > 0 ? Number(totalBytes) : null;
      if (dataBytes === 0 || dataBytes === 0xFFFFFFFF || (total !== null && body + dataBytes > total)) {
        if (total === null) return { error: "no-length" };
        dataBytes = total - body;
      }
      const rate = fmt.byteRate;
      if (!(rate > 0) || !(fmt.sampleRate > 0)) return { error: "no-length" };
      return { seconds: dataBytes / rate, sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits };
    }
    at = body + size + (size % 2);
  }
  return { error: "no-length" };
}

// The file's total size from a ranged answer ("bytes 0-131071/52428844") or,
// for a server that ignored the range, from its content-length.
export function totalBytesOf(status, headers) {
  const get = (k) => (typeof headers?.get === "function" ? headers.get(k) : headers?.[k]) || "";
  if (status === 206) {
    const m = String(get("content-range")).match(/\/(\d+)\s*$/);
    return m ? Number(m[1]) : null;
  }
  const n = Number(get("content-length"));
  return n > 0 ? n : null;
}

// Auphonic's production status codes, as listed at
// https://auphonic.com/api/info/production_status.json (checked 2026-10-17):
// 0 File Upload, 1 Waiting, 2 Error, 3 Done, 4 Audio Processing, 5 Audio
// Encoding, 6 Outgoing File Transfer, 7 Audio Mono Mixdown, 8 Split Audio On
// Chapter Marks, 9 Incomplete, 10 Production Not Started Yet, 11 Production
// Outdated, 12 Incoming File Transfer, 13 Stopping the Production, 14 Speech
// Recognition, 15 Production Changed, 98 Empty Production.
const FAILED_STATES = {
  2: null, // Error: Auphonic's own message is used
  9: "Auphonic could not finish it (the production is incomplete)",
  11: "Auphonic marked the production as outdated",
  98: "Auphonic received an empty production (no audio)",
};
// 13, "Stopping the Production": the production is being stopped (from
// Auphonic's site or through its stop call), so it will never finish.
export const STOPPING_TEXT = "Auphonic is stopping this clean-up (it was stopped at Auphonic), so it will not finish. Auphonic charges only for a clean-up that finishes, so nothing was spent.";
// 10, "Production Not Started Yet": the production exists but is not running.
// voice_cleanup always asks Auphonic to start it, so this is normal only for
// a moment; after NOT_STARTED_GIVE_UP_MS the production is deleted at
// Auphonic (so it can never start and charge later) and only then is the job
// called failed.
export const NOT_STARTED_GIVE_UP_MS = 10 * 60 * 1000;
export const NOT_STARTED_TEXT = "Auphonic never started the clean-up (it may have been stopped at Auphonic)";

// ageMs is how long ago the job was started (for status 10). Anything the
// code does not know stays "still working" with Auphonic's own status text.
export function statusOf(details, ageMs) {
  const d = details && typeof details === "object" ? details : {};
  const code = Number(d.status);
  if (code === 3) return { state: "done" };
  if (code === 13) return { state: "canceled" };
  if (code === 10) {
    if (Number(ageMs) > NOT_STARTED_GIVE_UP_MS) return { state: "failed", error: NOT_STARTED_TEXT, remove: true };
    return { state: "working", label: "waiting for Auphonic to start it" };
  }
  if (Object.prototype.hasOwnProperty.call(FAILED_STATES, code)) return { state: "failed", error: FAILED_STATES[code] ?? productionErrorText(d.error_message) };
  const label = String(d.status_string || "in progress").replace(/\s+/g, " ").trim().slice(0, 80).toLowerCase() || "in progress";
  return { state: "working", label };
}

// The length Auphonic reports for the production (seconds), or null while it
// has not said yet. The price was set from the WAV header read before go, but
// Auphonic downloads the link itself afterwards, so the file it got can be a
// different, longer one: this is the length that counts.
export function auphonicSeconds(details) {
  const n = Number(details?.length);
  return Number.isFinite(n) && n > 0 ? n : null;
}
export const TOO_LONG_TEXT = "The file Auphonic received is longer than 5 minutes, so the clean-up was stopped.";

// Plain English for a production that Auphonic stopped with an error.
export function productionErrorText(raw) {
  const msg = String(raw || "").replace(/\s+/g, " ").trim();
  if (/credit/i.test(msg)) return "the Auphonic account has run out of processing hours; the account owner needs to top it up";
  if (/download|fetch|http|url|input file|not found|could not (open|access|get)/i.test(msg)) return "Auphonic could not download the recording. Use the link from get_upload_link or import_file";
  if (/format|decode|codec|corrupt|invalid audio|unsupported/i.test(msg)) return "Auphonic could not read the file as audio. Send a WAV recording";
  return msg ? "Auphonic could not process it: " + msg.slice(0, 200) : "Auphonic stopped with an error and gave no reason";
}

// Plain English for an Auphonic API answer that was not a success.
export function auphonicErrorText(status, body) {
  if (status === 401 || status === 403) return "Auphonic did not accept the key; the account owner needs to check the Auphonic key";
  const b = body && typeof body === "object" ? body : {};
  const forms = b.form_errors && typeof b.form_errors === "object" ? Object.entries(b.form_errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("; ") : "";
  const msg = String(b.error_message || forms || b.raw || "").replace(/\s+/g, " ").trim();
  if (/credit/i.test(msg)) return "the Auphonic account has run out of processing hours; the account owner needs to top it up";
  return `Auphonic answered ${status}` + (msg ? ": " + msg.slice(0, 200) : "");
}

function describeFile(f) {
  const mins = (f.seconds / 60).toFixed(1);
  const ch = f.channels === 1 ? "mono" : f.channels === 2 ? "stereo" : `${f.channels} channels`;
  return `${mins} minutes, ${f.sampleRate} Hz, ${ch}, ${f.bits}-bit WAV`;
}

export function priceCard(strength, file, usd, rate) {
  return [
    "Plan: voice clean-up (Auphonic)",
    `- Strength: ${strength} (${STRENGTH_TEXT[strength]})`,
    `- File: ${describeFile(file)}`,
    "- Kept as recorded: levels, loudness, room sound and every pause (nothing is cut)",
    "- Output: WAV at the same sample rate",
    `- Other strengths: ${STRENGTHS.filter((s) => s !== strength).map((s) => `${s} (${STRENGTH_TEXT[s]})`).join("; ")}`,
    `- Price: about ${money(usd)} (Auphonic bills processing time, ${money(rate)} an hour, at least 3 minutes per file)`,
  ].join("\n");
}

export const VOICE_TOOL = {
  name: "voice_cleanup",
  description: "Clean up a recorded voice with Auphonic: background noise removed and nothing else changed (no levelling, no loudness change, room sound kept, nothing cut, same sample rate). Takes a WAV of up to 5 minutes and about 200 MB. strength: gentle (noise down by up to 12 dB), strong (noise removed fully), studio (gentle plus Auphonic's Studio Voice filter). First call it WITHOUT go: it only shows the price card, which you show the person exactly as returned, ending with \"Say go, or tell me what to change.\" Only after they say go, call it again with the same file and strength and go: true. That returns a job_id: call wait_for_job with it until it is done; the result is a private WAV download link that works for 1 hour (check_job with the same job_id gives a fresh one).",
  inputSchema: {
    type: "object",
    required: ["file", "strength"],
    additionalProperties: false,
    properties: {
      file: { type: "string", description: "Link to the WAV itself: the public_url from get_upload_link (content_type audio/wav) for a file on the computer, the link import_file returned, or a Drive or Dropbox link shared as anyone with the link." },
      strength: { type: "string", enum: STRENGTHS, description: "gentle, strong or studio." },
      go: { type: "boolean", description: "true only after the person said go to this file's price card." },
    },
  },
};

// Reads the first bytes of the file (a range request), following redirects
// by hand so every hop passes the public-address check. Returns the WAV
// facts, or a sentence for the person.
async function readWavHead(link, d) {
  let url;
  try { url = new URL(link); } catch { return "The link must start with https://"; }
  for (let hop = 0; hop < 6; hop++) {
    if (!(await d.publicHost(url))) return "That link points somewhere that is not a public https address.";
    let res;
    try {
      res = await d.fetch(url.toString(), { redirect: "manual", headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
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
    const head = await readUpTo(res.body, HEAD_BYTES);
    if (type === "text/html") return "That link opened a web page, not the file. Check the sharing setting, or upload the WAV with get_upload_link.";
    if (total !== null && total > MAX_VOICE_BYTES) return "That file is over 200 MB, too big for voice clean-up.";
    const wav = parseWavHeader(head, total);
    if (wav.error === "not-wav") return "That file is not a WAV recording. Voice clean-up takes WAV files only.";
    if (wav.error === "not-pcm") return "That WAV is compressed, not a plain recording. Export it again as an uncompressed WAV (PCM) and try again.";
    if (wav.error) return "Could not read the recording's length from the file. Upload it with get_upload_link (audio/wav) and try again.";
    return wav;
  }
  return "That link redirects too many times.";
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

async function auphonic(d, key, method, path, body) {
  const res = await d.fetch(`${AUPHONIC_API}/${path}`, {
    method,
    headers: { Authorization: "bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, data };
}

const nowIso = (d) => (d.now ? d.now() : new Date()).toISOString();
const BAD_CAP = "The monthly budget setting (HF_MONTHLY_CAP_USD) is not a valid dollar amount, so nothing new can be made. Ask the account owner.";
const BAD_RATE = "Could not price it: the Auphonic price setting (AUPHONIC_USD_PER_HOUR) is not a valid dollar amount. Ask the account owner.";

// d: { env(name), fetch, publicHost(URL), directLink(link), background(p),
//      uuid(), author, cap (number or null), budget(): Promise<string>,
//      idemKey(member, model, input), reserve(p), update(id, fields, only),
//      byRequest(jobId), upload(path, body, type), sign(path, seconds) }
export async function voiceCleanup(args, d) {
  const key = String(d.env("AUPHONIC_KEY") || "").trim();
  if (!key) return NO_KEY_TEXT;
  const strength = String(args.strength || "").trim().toLowerCase();
  if (!STRENGTHS.includes(strength)) return "Give the strength: gentle, strong or studio.";
  const file = String(args.file || "").trim();
  if (!/^https:\/\//i.test(file)) return "The link must start with https://";
  const rate = usdPerHour(d.env("AUPHONIC_USD_PER_HOUR"));
  if (rate === null) return BAD_RATE;
  const link = d.directLink(file);
  const wav = await readWavHead(link, d);
  if (typeof wav === "string") return wav;
  if (wav.seconds > MAX_VOICE_SECONDS) return `That file is ${(wav.seconds / 60).toFixed(1)} minutes long; voice clean-up takes up to 5 minutes. Trim it or split it into parts.`;
  if (!(wav.seconds > 0)) return "That file has no audio in it.";
  const usd = priceFor(wav.seconds, rate);

  if (args.go !== true) {
    return priceCard(strength, wav, usd, rate) + "\n" + await d.budget()
      + "\n\nSay go, or tell me what to change. (After go, call voice_cleanup again with the same file and strength and go: true.)";
  }
  if (d.cap === null || d.cap === undefined) return BAD_CAP;

  const params = { file: link, strength, seconds: Math.round(wav.seconds * 10) / 10, sample_rate: wav.sampleRate };
  const rsv = await d.reserve({
    member: d.author,
    model: VOICE_MODEL,
    prompt: `Voice clean-up (${strength})`,
    params,
    cost: usd,
    cap: d.cap,
    idemKey: await d.idemKey(d.author, VOICE_MODEL, { file: link, strength }),
  });
  if (!rsv) return "Could not start: the log is unavailable, so nothing was spent.";
  if (rsv.outcome === "over_cap") return `Refused: this (${money(usd)}) would pass the team's monthly budget of ${money(d.cap)} (${money(Number(rsv.spent))} already used). Ask the account owner.`;
  if (rsv.outcome === "duplicate") {
    return rsv.request_id
      ? `This exact clean-up was already started a moment ago, so it was not charged twice.\njob_id: ${rsv.request_id}\nUse wait_for_job with that job_id.`
      : "This exact clean-up is being started right now. Wait a minute, then ask for team_usage to find its job.";
  }
  const rowId = Number(rsv.id);
  const jobId = d.uuid();
  let res;
  try {
    res = await auphonic(d, key, "POST", "productions.json", productionBody(strength, link, jobId));
  } catch (e) {
    await d.update(rowId, { status: "submit_unknown", error: "no answer from Auphonic: " + String(e?.message || e).slice(0, 200), updated_at: nowIso(d) });
    return "Could not confirm the start with Auphonic (no answer). It may have started and may be charged, so do not send it again: ask for team_usage in a few minutes.";
  }
  const uuid = res.ok ? String(res.data?.data?.uuid || "") : "";
  if (!uuid) {
    const why = auphonicErrorText(res.status, res.data);
    // Only a 4xx is a refusal; anything else may have started a production.
    const refused = res.status >= 400 && res.status < 500;
    await d.update(rowId, { status: refused ? "submit_failed" : "submit_unknown", error: why, updated_at: nowIso(d) });
    return refused
      ? "Refused by Auphonic: " + why + ". Nothing was spent."
      : "Could not confirm the start with Auphonic (" + why + "). It may have started and may be charged, so do not send it again: ask for team_usage in a few minutes.";
  }
  try {
    const n = await d.update(rowId, { request_id: jobId, status: "in_progress", params: { ...params, auphonic_uuid: uuid }, updated_at: nowIso(d) });
    if (!n) throw new Error("no row");
  } catch {
    return "Could not record the job: it started at Auphonic and may be charged, but its job_id was not saved. Tell the account owner before trying again.";
  }
  return `Started: voice clean-up (${strength}), about ${money(usd)}.\njob_id: ${jobId}\nNow call wait_for_job with this job_id. It usually takes 1 to 3 minutes.`;
}

const STILL_SAVING = "Still working (saving the cleaned file). Check again in about 20 to 30 seconds.";

// check_job and wait_for_job for a voice job (row.model is VOICE_MODEL).
export async function voiceCheck(jobId, d) {
  const row = await d.byRequest(jobId);
  if (!row) return "That job_id does not look right.";
  const cost = money(Number(row.est_cost_usd || 0));
  const path = `${jobId}.wav`;
  if (row.status === "completed" && row.video_url) {
    try {
      const url = await d.sign(String(row.video_url), LINK_SECONDS);
      return `Done. It cost ${cost}. Download the cleaned voice (WAV; the link works for 1 hour, check_job with this job_id gives a fresh one):\n${url}`;
    } catch (e) {
      return "Could not make the download link: " + String(e?.message || e).slice(0, 200) + ". Try check_job again in a minute.";
    }
  }
  if (row.status === "failed") return "It failed: " + String(row.error || "no reason given").replace(/\.$/, "") + ". Auphonic does not charge for a clean-up that fails, so nothing was spent.";
  if (row.status === "failed_charged") return "It failed: " + (row.error || "no reason given") + `. Auphonic charged for it (${cost}, counted in the team budget).`;
  if (row.status === "canceled") return "This job was canceled.";
  const age = (d.now ? d.now() : new Date()).getTime() - Date.parse(String(row.updated_at || ""));
  if (row.status === "storing" && !(age > STALE_STORING_MS)) return STILL_SAVING;
  const uuid = String(row.params?.auphonic_uuid || "");
  if (!uuid) return "Could not check: this job has no Auphonic production recorded. Tell the account owner.";
  const key = String(d.env("AUPHONIC_KEY") || "").trim();
  if (!key) return "Could not check: " + NO_KEY_TEXT;

  let res;
  try { res = await auphonic(d, key, "GET", `production/${encodeURIComponent(uuid)}.json`); } catch { return "Could not check: Auphonic did not answer. Try again in a minute."; }
  if (!res.ok) return "Could not check: " + auphonicErrorText(res.status, res.data) + ".";
  const details = res.data?.data || {};
  const st = statusOf(details, age);
  if (st.remove) {
    // DELETE /api/production/{uuid}.json (https://auphonic.com/help/api/update.html).
    // Not confirmed: keep polling, never a failed row Auphonic could still charge.
    let del = null;
    try { del = await auphonic(d, key, "DELETE", `production/${encodeURIComponent(uuid)}.json`); } catch { del = null; }
    if (!del || !(del.ok || del.status === 404)) return "Still working (waiting for Auphonic to start it). Check again in about 20 to 30 seconds.";
  }
  if (st.state === "failed") {
    await d.update(row.id, { status: "failed", error: st.error, updated_at: nowIso(d) });
    return "It failed: " + st.error + ". Auphonic does not charge for a clean-up that fails, so nothing was spent.";
  }
  if (st.state === "canceled") {
    await d.update(row.id, { status: "canceled", error: "stopped at Auphonic", updated_at: nowIso(d) });
    return STOPPING_TEXT;
  }
  const rate = usdPerHour(d.env("AUPHONIC_USD_PER_HOUR"));
  const seconds = auphonicSeconds(details);
  const priced = (s) => (rate !== null ? priceFor(s, rate) : Number(row.est_cost_usd || 0));
  if (seconds !== null && seconds > MAX_VOICE_SECONDS) return await stopTooLong(d, key, row, uuid, st.state, priced(seconds));
  if (st.state === "working") return `Still working (${st.label}). Check again in about 20 to 30 seconds.`;

  // Done at Auphonic, so it is charged: the real price (from the length
  // Auphonic processed) replaces the estimate before the copy starts.
  const actual = seconds !== null ? priced(seconds) : Number(row.est_cost_usd || 0);
  const out = (Array.isArray(details.output_files) ? details.output_files : []).find((f) => f && /^wav/.test(String(f.format)) && f.download_url);
  if (!out || !/^https:\/\/auphonic\.com\//.test(String(out.download_url))) {
    await d.update(row.id, { status: "delivery_failed", est_cost_usd: actual, error: "Auphonic finished but listed no WAV to download", updated_at: nowIso(d) });
    return `Could not save the cleaned voice: Auphonic finished (and charged, ${money(actual)}) but listed no WAV to download. Tell the account owner.`;
  }
  // One copy at a time: only the check that moves the row on starts it.
  const was = String(row.status);
  const lastError = row.error;
  const only = { status: was, updated_at: row.updated_at };
  const claimed = await d.update(row.id, { status: "storing", est_cost_usd: actual, updated_at: nowIso(d) }, only);
  if (!claimed) return STILL_SAVING;
  d.background(copyResult(d, key, row.id, String(out.download_url), path));
  if (was === "delivery_failed") {
    return `Could not save the cleaned voice yet: ${lastError || "storage error"}. It was made and charged (${money(actual)}); saving it again now, so call check_job with this job_id in a minute.`;
  }
  return STILL_SAVING;
}

// The file Auphonic downloaded is over the 5 minute limit (the price was set
// from a shorter file). A running production is stopped with Auphonic's stop
// call (POST /api/production/{uuid}/stop.json, from
// https://auphonic.com/help/api/update.html). Auphonic charges "only if your
// production was successful" (its pricing FAQ, checked 2026-10-17), so a
// stopped one costs 0 and the row is "failed", which the budget does not
// count. If the stop is not confirmed, the price from Auphonic's length is
// written and the row stays running (so it still counts), and the next check
// tries again. If Auphonic had already finished, it was charged: the row is
// "failed_charged" at that price, which the budget does count, and the
// result is not handed out.
async function stopTooLong(d, key, row, uuid, state, usd) {
  if (state === "done") {
    const why = "the file Auphonic received is longer than 5 minutes; Auphonic finished it before it could be stopped, so the result is not handed out";
    await d.update(row.id, { status: "failed_charged", est_cost_usd: usd, error: why, updated_at: nowIso(d) });
    return `The file Auphonic received is longer than 5 minutes, so the result is not handed out. Auphonic had already finished it, so it was charged (${money(usd)}, counted in the team budget).`;
  }
  let res = null;
  try { res = await auphonic(d, key, "POST", `production/${encodeURIComponent(uuid)}/stop.json`); } catch { res = null; }
  if (!res || !res.ok) {
    // Updating est_cost_usd only: the row keeps its state and its start time.
    await d.update(row.id, { est_cost_usd: usd });
    const why = res ? auphonicErrorText(res.status, res.data) : "Auphonic did not answer";
    return `The file Auphonic received is longer than 5 minutes, but stopping it did not go through (${why}). It may be charged (${money(usd)}, counted in the team budget until it is stopped). Check again in about 20 to 30 seconds to try the stop again.`;
  }
  await d.update(row.id, { status: "failed", est_cost_usd: 0, error: TOO_LONG_TEXT, updated_at: nowIso(d) });
  return TOO_LONG_TEXT + " Auphonic charges only for a clean-up that finishes, so nothing was spent.";
}

// Streams Auphonic's WAV into the private bucket (never held in memory whole).
async function copyResult(d, key, rowId, downloadUrl, path) {
  try {
    let res = await d.fetch(downloadUrl, { headers: { Authorization: "bearer " + key }, redirect: "follow" });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel?.();
      const u = new URL(downloadUrl);
      u.searchParams.set("bearer_token", key);
      res = await d.fetch(u.toString(), { redirect: "follow" });
    }
    if (!res.ok || !res.body) throw new Error(`Auphonic's download answered ${res.status}`);
    if (Number(res.headers.get("content-length") || 0) > MAX_RESULT_BYTES) {
      await res.body.cancel?.();
      throw new Error("the cleaned file is over 400 MB");
    }
    await d.upload(path, res.body, "audio/wav");
    await d.update(rowId, { status: "completed", video_url: path, error: null, updated_at: nowIso(d) });
  } catch (e) {
    // The message never carries the download link (it can hold the key).
    const why = String(e?.message || e).replace(/https?:\/\/\S+/g, "(link)").slice(0, 300);
    await d.update(rowId, { status: "delivery_failed", error: "could not store the result: " + why, updated_at: nowIso(d) }).catch(() => {});
  }
}
