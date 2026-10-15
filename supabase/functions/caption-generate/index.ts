// Supabase Edge Function: caption-generate
//
// The "Generate caption" button's AI job, moved off the n8n workflow "SyncView Calendar — Generate Caption"
// (docs/plans/2026-09-28-n8n-exit.md). Same steps: Frame.io file (direct lookup, Apify only as fallback) ->
// Replicate Whisper -> Claude -> calendar-upsert, with progress and cancel in caption_jobs exactly as n8n writes
// them, so the Calendar page's poller, cancel button and refresh survival work unchanged. New here:
//   - the client's caption prompt is read from caption_prompts by this function (the page's copy is the fallback);
//   - the client's Brain voice (voice.md, its "Caption style" section when written) and one fixed set of writing
//     rules (writing-rules.mjs) go to the model with every caption;
//   - the team's choices before Generate (call to action, platform, a note) and "Redo with a note". The answer is the
//     caption and nothing else: no title ideas, no separate hashtags (hashtags only when the client's prompt asks);
//   - a transcript a person pastes in: the only source when the card has no Frame.io link, an extra otherwise.
//
//   POST { client, postId, assetUrl?, transcript?, captionPrompt?, jobId, cta?, platform?, note?, redo? }
//     cta       one keyword from the client's list (caption_cta_options); empty = the model chooses
//     platform  instagram (default) | tiktok | youtube
//     note      a short note from the team, sent to the model apart from the transcript
//     redo      { caption }: re-run from the current caption plus the note.
//               A redo needs no video, never saves to the card (the page applies it if the box is unchanged) and
//               ends with the new caption on its row.
//     -> { ok: true, accepted: true, jobId }   the work continues in the background; the page polls caption-jobs
//     -> { ok: false, error }                  refused before anything ran (nothing written)
//
//   GET  ?action=cta_get&client=<slug>              -> { ok, client, options }   the client's call-to-action keywords
//   POST { action: "cta_save", client, options }   -> { ok, client, options }   saves them (the caption prompt editor)
//     The list lives in caption_cta_options, closed to every browser role: only this function reads and writes it.
//
// The page only calls this when the runtime switch caption_generate_ef_clients lists the client (default: n8n).
//
// Auth: a staff role key (X-Syncview-Key), the same as caption-jobs. Client review links are refused. The caller's
// staff headers are forwarded to calendar-upsert for the save, the way the page itself saves a card.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, the staff role key secrets, ANTHROPIC_API_KEY, and for a
// card with a video REPLICATE_API_TOKEN. Optional: APIFY_TOKEN (the fallback when the direct Frame.io lookup
// fails), BRAIN_GITHUB_TOKEN / BRAIN_REPO / BRAIN_BRANCH (the voice; without them captions are written without it),
// CAPTION_MODEL (default claude-sonnet-4-6, the model n8n uses).
//
// Just before the save the card's caption is read again: one typed and saved while the job ran is kept, and the
// job ends in error with no caption on its row (so the page saves nothing either).
//
// Never logs a transcript, a caption or a file name: only step names and status codes.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { authorizeStaffKey, staffAuthFailureStatus } from "../_shared/staff-role-auth.ts";
import { normalizeBrowserWriteClient } from "../_shared/browser-write-auth.ts";
import { buildPatch, selectJobs } from "../caption-jobs/jobs.mjs";
import { findClientFolder, parseBrainFacts } from "../brain/parse.mjs";
import {
  acceptReply, assetKey, buildMessages, duplicateRun, failureUpdate, findTells, FRAME_QUERY, MAX_TOKENS, MODEL,
  normalizeCtaOptions, parseRequest, pickFrameMedia, rawTextFromResponse, revisionRequest, shareIds, TRANSCRIPT_KEEP_MAX,
  transcriptFromPrediction, voiceGuide, WHISPER_INPUT, WHISPER_VERSION,
} from "./logic.mjs";
import { WRITING_RULES } from "./writing-rules.mjs";
import { apifyActorInput, mediaUrlFromApify } from "./apify.mjs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};
// Supabase stops a background task at 400 s (paid plan). Every step checks this budget so a run ends with an
// honest error on its row instead of being cut off mid-step and left "running".
const BUDGET_MS = 370 * 1000;
const POLL_MS = 3000;
const NOT_READABLE = "Could not read the video from the Frame.io page — check the link opens a playable video and is not expired or private.";
const SAVE_FAILED = "The caption was generated but could not be saved to the sheet — it is kept on the card, save it manually or retry";
// The two ends where the generated caption is NOT saved and NOT handed back on the row (a page with an empty box
// saves a caption it finds on an error row, which would put it over the caption the card already has).
const KEPT_THEIRS = "A caption was written on this card while this one was being generated, so that one was kept.";
const CARD_UNREADABLE = "The caption was generated but the card could not be checked before saving, so nothing was saved. Try again.";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const clean = (v: unknown): string => String(v == null ? "" : v).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const env = (k: string) => Deno.env.get(k) || "";

type Job = {
  db: SupabaseClient;
  jobId: string;
  client: string;
  postId: string;
  assetUrl: string;
  transcript: string;
  captionPrompt: string;
  mode: "video" | "transcript" | "redo";
  cta: string;
  platform: string;
  note: string;
  redo: { caption: string } | null;
  forward: Record<string, string>;
  startedAt: number;
  caption: string;
};

const active = new Map<string, Job>();

async function patchJob(job: Job, fields: Record<string, unknown>) {
  const built = buildPatch({ jobId: job.jobId, ...fields }, new Date().toISOString());
  if (!built.ok) return;
  const patch = (built.patch || {}) as Record<string, unknown>;
  const { error } = await job.db.from("caption_jobs").upsert(patch, { onConflict: "job_id" });
  if (error) console.warn("[caption-generate] job row write failed", error.code || "");
}

function checkBudget(job: Job) {
  if (Date.now() - job.startedAt > BUDGET_MS) throw new Error("Timed out — the caption run took too long. Try again.");
}

async function checkCancel(job: Job) {
  const { data, error } = await job.db.from("caption_jobs").select("cancel_requested").eq("job_id", job.jobId).maybeSingle();
  // Same rule as n8n: a failed read never aborts, only an explicit cancel does.
  if (!error && data && data.cancel_requested === true) throw new Error("CANCELLED");
}

async function fetchT(url: string, init: RequestInit, ms: number): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

// n8n "Resolve Frame.io Direct": f.io short link -> 302 to next.frame.io/share/<id>[/view/<id>] -> one call to
// Frame.io's share-viewer GraphQL (the share id is the credential). Any failure returns "" and Apify is tried.
async function resolveFrameDirect(assetUrl: string): Promise<string> {
  try {
    let ids = shareIds(assetUrl);
    if (!ids) {
      const r = await fetchT(assetUrl, { method: "GET", redirect: "manual" }, 15000);
      ids = shareIds(r.headers.get("location") || "");
      await r.body?.cancel();
    }
    if (!ids) return "";
    const res = await fetchT("https://api.frame.io/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "apollographql-client-name": "syncview", "x-frameio-share-authentication": btoa(ids.shareId) },
      body: JSON.stringify({ query: FRAME_QUERY, variables: { s: ids.shareId } }),
    }, 20000);
    if (!res.ok) return "";
    return pickFrameMedia(await res.json(), ids.viewId);
  } catch (_e) {
    return "";
  }
}

// n8n "Run Apify Scraper" + "Extract Video URL", bounded to the time left.
async function resolveFrameApify(job: Job): Promise<string> {
  const token = env("APIFY_TOKEN");
  const left = Math.floor((BUDGET_MS - (Date.now() - job.startedAt)) / 1000) - 150;   // keep time for Whisper and Claude
  if (!token || left < 40) return "";
  const secs = Math.min(240, left);
  try {
    const r = await fetchT(`https://api.apify.com/v2/acts/apify~web-scraper/run-sync-get-dataset-items?timeout=${secs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(apifyActorInput(job.assetUrl)),
    }, (secs + 20) * 1000);
    if (!r.ok) return "";
    return mediaUrlFromApify(await r.json());
  } catch (_e) {
    return "";
  }
}

// n8n "Submit Replicate Whisper" + "Wait for Replicate Callback" + "Extract Transcript". n8n waits for Replicate's
// webhook; a function polls instead. A cancel pressed during transcription stops the prediction too.
async function transcribe(job: Job, mediaUrl: string): Promise<string> {
  const token = env("REPLICATE_API_TOKEN");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const r = await fetchT("https://api.replicate.com/v1/predictions", {
    method: "POST", headers,
    body: JSON.stringify({ version: WHISPER_VERSION, input: { audio: mediaUrl, ...WHISPER_INPUT } }),
  }, 60000);
  if (!r.ok) throw new Error(`Transcription could not start (Replicate ${r.status})`);
  let pred = await r.json();
  const getUrl = (pred && pred.urls && pred.urls.get) || `https://api.replicate.com/v1/predictions/${pred.id}`;
  let polls = 0;
  while (pred && !["succeeded", "failed", "canceled"].includes(pred.status)) {
    await sleep(POLL_MS);
    polls += 1;
    try {
      if (polls % 4 === 0) await checkCancel(job);
      checkBudget(job);
    } catch (e) {
      await fetchT(`https://api.replicate.com/v1/predictions/${pred.id}/cancel`, { method: "POST", headers }, 10000).then(
        (x) => x.body?.cancel(), () => {});
      throw e;
    }
    const g = await fetchT(getUrl, { headers }, 20000).catch(() => null);
    if (g && g.ok) pred = await g.json();
    else await g?.body?.cancel();
  }
  return transcriptFromPrediction(pred);
}

async function readCaptionPrompt(job: Job): Promise<string> {
  const { data, error } = await job.db.from("caption_prompts").select("prompt").eq("client_slug", job.client).maybeSingle();
  if (error) {
    console.warn("[caption-generate] caption_prompts read failed; using the page's copy", error.code || "");
    return job.captionPrompt;
  }
  return data ? String(data.prompt || "") : "";
}

// The brain function's approach (supabase/functions/brain): the private brain repository through the GitHub API,
// the client's folder matched by slug, voice.md parsed into sections.
let folderCache: { at: number; names: string[] } | null = null;
async function readVoice(job: Job): Promise<{ source: string; text: string }> {
  const token = env("BRAIN_GITHUB_TOKEN");
  if (!token) return { source: "none", text: "" };
  const repo = env("BRAIN_REPO") || "sidney-afk/synchro-brain";
  const ref = encodeURIComponent(env("BRAIN_BRANCH") || "main");
  const gh = (path: string, accept: string) => fetchT(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "syncview-caption-generate" },
  }, 15000);
  try {
    if (!folderCache || Date.now() - folderCache.at > 3 * 60 * 1000) {
      const r = await gh(`contents/clients?ref=${ref}`, "application/vnd.github+json");
      if (!r.ok) { await r.body?.cancel(); return { source: "none", text: "" }; }
      const items = await r.json() as Array<{ name: string; type: string }>;
      folderCache = { at: Date.now(), names: items.filter((i) => i.type === "dir").map((i) => i.name) };
    }
    const folder = findClientFolder(folderCache.names, job.client);
    if (!folder) return { source: "none", text: "" };
    const r = await gh(`contents/clients/${folder}/voice.md?ref=${ref}`, "application/vnd.github.raw+json");
    if (!r.ok) { await r.body?.cancel(); return { source: "none", text: "" }; }
    return voiceGuide(parseBrainFacts(await r.text(), "voice"));
  } catch (_e) {
    console.warn("[caption-generate] brain voice read failed; writing without it");
    return { source: "none", text: "" };
  }
}

// The client's own call-to-action keywords (caption_cta_options), staff-edited with the caption prompt. A client with
// no row, or a failed read, simply has none: the note box still works.
async function readCtaOptions(job: Job): Promise<string[]> {
  const { data, error } = await job.db.from("caption_cta_options").select("options").eq("client_slug", job.client).maybeSingle();
  if (error) {
    console.warn("[caption-generate] cta options read failed; writing without a list", error.code || "");
    return [];
  }
  return normalizeCtaOptions(data ? (data as { options?: unknown }).options : []);
}

async function claude(system: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const r = await fetchT("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env("CAPTION_MODEL") || MODEL, max_tokens: MAX_TOKENS, system, messages }),
  }, 120000);
  if (!r.ok) { await r.body?.cancel(); throw new Error(`The caption writer did not answer (${r.status}). Try again.`); }
  return rawTextFromResponse(await r.json());
}

async function writeCaption(job: Job, videoTranscript: string): Promise<string> {
  const [captionPrompt, voice, ctaOptions] = await Promise.all([readCaptionPrompt(job), readVoice(job), readCtaOptions(job)]);
  const m = buildMessages({
    captionPrompt, voice, videoTranscript, pastedTranscript: job.transcript, rules: WRITING_RULES,
    note: job.note, cta: job.cta, ctaOptions, platform: job.platform, redo: job.redo,
  });
  const first = await claude(m.system, [{ role: "user", content: m.user }]);
  // A reply that reads like talk to a person (a question, a note about a missing transcript, a preamble, a "---" line)
  // is never a caption. Nothing is saved; the job ends in an error the box shows and the caption stays as it was.
  const accepted = acceptReply(first, !!job.redo);
  if (!accepted.ok) throw new Error(accepted.error);
  let out: string = accepted.caption || "";
  const tells = findTells(out);
  if (tells.length) {
    // One revision for the mechanical tells; if it fails or comes back empty, the first draft stands.
    try {
      checkBudget(job);
      const revised = await claude(m.system, [
        { role: "user", content: m.user }, { role: "assistant", content: first }, { role: "user", content: revisionRequest(tells) },
      ]);
      const again = acceptReply(revised, !!job.redo);
      if (again.ok && again.caption) out = again.caption;
    } catch (_e) { /* the first draft stands */ }
  }
  return out;
}

// The card's caption as saved right now, read just before the save: someone may have typed and saved one while
// this job was queued or running, and calendar-upsert writes the caption without a base, so it would be replaced.
// null when the card cannot be read; the caller then saves nothing.
async function savedCaption(job: Job): Promise<string | null> {
  try {
    const { data, error } = await job.db.from("calendar_posts").select("caption")
      .eq("client", job.client).eq("id", job.postId).maybeSingle();
    if (error) { console.warn("[caption-generate] card read before save failed", error.code || ""); return null; }
    return clean(data && (data as { caption?: unknown }).caption);
  } catch (_e) {
    console.warn("[caption-generate] card read before save failed");
    return null;
  }
}

// n8n "Save caption (calendar-upsert)" + "Save Caption to Sheet": the same body, and only ok:true counts as saved.
async function saveCaption(job: Job): Promise<boolean> {
  try {
    const r = await fetchT(`${env("SUPABASE_URL")}/functions/v1/calendar-upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...job.forward, "X-Syncview-Source": "caption-generate" },
      body: JSON.stringify({ client: job.client, post: { id: job.postId, caption: job.caption } }),
    }, 30000);
    const j = await r.json().catch(() => null);
    if (!j || j.ok !== true) console.warn("[caption-generate] calendar-upsert refused", r.status, clean(j && j.error).slice(0, 60));
    return !!j && j.ok === true;
  } catch (_e) {
    return false;
  }
}

// The words of the post's video, kept on the job row so a later redo can use them. A failed write (the column is not
// there yet) only means a later redo transcribes again; it never fails the caption.
async function keepTranscript(job: Job, text: string) {
  const kept = clean(text).slice(0, TRANSCRIPT_KEEP_MAX);
  if (!kept) return;
  const { error } = await job.db.from("caption_jobs").update({ transcript: kept, transcript_asset: assetKey(job.assetUrl) }).eq("job_id", job.jobId);
  if (error) console.warn("[caption-generate] transcript not kept", error.code || "");
}

// The newest transcript an earlier run kept for this post AND this video ("" when there is none, it belongs to a
// different video link (the card's video was replaced), or it cannot be read).
async function latestTranscript(job: Job): Promise<string> {
  const { data, error } = await job.db.from("caption_jobs").select("transcript")
    .eq("client", job.client).eq("post_id", job.postId).eq("transcript_asset", assetKey(job.assetUrl)).neq("job_id", job.jobId)
    .not("transcript", "is", null).neq("transcript", "").order("updated_at", { ascending: false }).limit(1);
  if (error) {
    console.warn("[caption-generate] kept transcript read failed", error.code || "");
    return "";
  }
  const row = Array.isArray(data) ? data[0] : null;
  return clean(row && (row as { transcript?: unknown }).transcript);
}

async function transcribeVideo(job: Job): Promise<string> {
  const media = (await resolveFrameDirect(job.assetUrl)) || (await resolveFrameApify(job));
  if (!media) throw new Error(NOT_READABLE);
  checkBudget(job);
  await patchJob(job, { stage: "transcribing" });
  const text = await transcribe(job, media);
  await checkCancel(job);                         // n8n "Cancel check 1": before the caption writer is ever called
  return text;
}

async function run(job: Job) {
  active.set(job.jobId, job);
  try {
    let videoTranscript = "";
    if (job.mode === "video") {
      videoTranscript = await transcribeVideo(job);
      await keepTranscript(job, [videoTranscript, job.transcript].filter(Boolean).join("\n\n"));
    } else if (job.mode === "transcript") {
      await keepTranscript(job, job.transcript);
    } else if (job.mode === "redo") {
      // A redo works from the video's words: the ones the last Generate kept, else the card's video is transcribed now.
      // Only a post with no video and no kept transcript goes without (the model is told so).
      videoTranscript = await latestTranscript(job);
      if (!videoTranscript && job.assetUrl) {
        videoTranscript = await transcribeVideo(job);
        await keepTranscript(job, videoTranscript);
      }
    }
    checkBudget(job);
    await checkCancel(job);                       // n8n "Cancel check 1": before the caption writer is ever called
    if (job.mode !== "transcript") await patchJob(job, { stage: "writing" });   // a transcript-only row starts at writing
    job.caption = await writeCaption(job, videoTranscript);
    await checkCancel(job);                       // n8n "Cancel check 2": a cancelled caption is never saved
    if (job.redo) {
      // A redo never touches the card. The page applies the new caption only if the box still holds the caption the
      // redo started from, so a caption typed or edited meanwhile is never overwritten.
      await patchJob(job, { status: "done", stage: "done", caption: job.caption });
      return;
    }
    // A caption already on the card wins (typed while this job waited or ran). Neither end hands the generated
    // caption back on the row, so no page saves it over theirs either.
    const onCard = await savedCaption(job);
    if (onCard === null) { job.caption = ""; throw new Error(CARD_UNREADABLE); }
    if (onCard && onCard !== clean(job.caption)) { job.caption = ""; throw new Error(KEPT_THEIRS); }
    if (!onCard && !(await saveCaption(job))) throw new Error(SAVE_FAILED);
    await patchJob(job, { status: "done", stage: "done", caption: job.caption });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A redo's failure never hands a caption back: the page would take an error row with a caption as a caption to save.
    const { cancelled, update } = failureUpdate(job.jobId, msg, job.redo ? "" : job.caption);
    console.warn("[caption-generate] job ended", cancelled ? "cancelled" : "error");
    await patchJob(job, update);
  } finally {
    active.delete(job.jobId);
  }
}

// If the platform stops this worker anyway, leave no row saying "running".
addEventListener("beforeunload", () => {
  for (const job of active.values()) {
    patchJob(job, { status: "error", stage: "error", error: "The caption run was stopped by the server. Try again.", ...(job.caption ? { caption: job.caption } : {}) });
  }
});

// The client's call-to-action keywords for the caption prompt editor and the Generate caption box.
async function ctaAction(supabaseUrl: string, serviceKey: string, req: Request, body: Record<string, unknown>, action: string): Promise<Response> {
  const client = normalizeBrowserWriteClient(body.client);
  if (!client) return json({ ok: false, error: "client required" }, 400);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  try {
    if (action === "cta_get") {
      const { data, error } = await db.from("caption_cta_options").select("options").eq("client_slug", client).maybeSingle();
      if (error) throw error;
      return json({ ok: true, client, options: normalizeCtaOptions(data ? (data as { options?: unknown }).options : []) });
    }
    const options = normalizeCtaOptions(body.options);
    const actor = clean(req.headers.get("x-syncview-actor")).slice(0, 120) || "syncview";
    const { error } = await db.from("caption_cta_options").upsert(
      { client_slug: client, options, updated_at: new Date().toISOString(), updated_by: actor }, { onConflict: "client_slug" });
    if (error) throw error;
    // The same trail the caption prompt save leaves; a failure here never undoes the save.
    const { error: eventError } = await db.from("settings_events").insert({
      surface: "caption_prompts", client_slug: client, actor, role: clean(req.headers.get("x-syncview-role")).slice(0, 40) || null,
      action: "cta_save", source: "caption-generate", payload: { cta_count: options.length },
    });
    if (eventError) console.warn("[caption-generate] settings event write failed", eventError.code || "");
    return json({ ok: true, client, options });
  } catch (e) {
    console.warn("[caption-generate] cta list failed", (e as { code?: string } | null)?.code || "");
    return json({ ok: false, error: "Could not read or save the call to action choices. Try again." }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST" && req.method !== "GET") return json({ ok: false, error: "method not allowed" }, 405);
  if (req.headers.get("x-syncview-client-token")) return json({ ok: false, error: "staff_only" }, 403);
  const supabaseUrl = env("SUPABASE_URL"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);

  const key = clean(req.headers.get("x-syncview-key"));
  const auth = authorizeStaffKey(key, ["admin", "smm", "creative"]);
  if (!auth.ok) return json({ ok: false, error: "unauthorized" }, staffAuthFailureStatus(auth));

  if (req.method === "GET") {
    // The only read: the client's call to action choices (?action=cta_get&client=...), sent as a GET so that opening the box writes nothing.
    const q = new URL(req.url).searchParams;
    if (q.get("action") !== "cta_get") return json({ ok: false, error: "method not allowed" }, 405);
    return await ctaAction(supabaseUrl, serviceKey, req, { client: q.get("client") }, "cta_get");
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = clean(body && body.action);
  if (action === "cta_get" || action === "cta_save") return await ctaAction(supabaseUrl, serviceKey, req, body, action);

  const parsed = parseRequest(body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const client = normalizeBrowserWriteClient(parsed.client);
  if (!client) return json({ ok: false, error: "client required" }, 400);
  if (!env("ANTHROPIC_API_KEY")) return json({ ok: false, error: "The caption writer is not set up yet (missing AI key)." }, 503);
  if (parsed.mode === "video" && !env("REPLICATE_API_TOKEN")) {
    return json({ ok: false, error: "Video transcription is not set up yet. Paste the transcript instead." }, 503);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  // n8n "Guard read jobs" + "Check duplicate run": a second run for a card with a fresh running job is refused.
  // A failed read never blocks.
  const { data: rows } = await db.from("caption_jobs")
    .select("job_id,client,post_id,status,stage,caption,error,cancel_requested,started_at,updated_at")
    .eq("client", client).eq("post_id", String(parsed.postId)).order("updated_at", { ascending: false }).limit(50);
  if (duplicateRun(selectJobs(rows || [], { postId: String(parsed.postId) }, Date.now()), String(parsed.jobId), Date.now())) {
    return json({ ok: false, error: "A caption is already generating for this card" }, 409);
  }

  const forward: Record<string, string> = { "X-Syncview-Key": key };
  for (const h of ["x-syncview-actor", "x-syncview-role"]) {
    const v = clean(req.headers.get(h));
    if (v) forward[h === "x-syncview-actor" ? "X-Syncview-Actor" : "X-Syncview-Role"] = v.slice(0, 120);
  }
  const job: Job = {
    db, jobId: String(parsed.jobId), client, postId: String(parsed.postId), assetUrl: String(parsed.assetUrl || ""),
    transcript: String(parsed.transcript || ""), captionPrompt: String(parsed.captionPrompt || ""),
    mode: parsed.mode === "video" ? "video" : parsed.mode === "redo" ? "redo" : "transcript", forward, startedAt: Date.now(), caption: "",
    cta: String(parsed.cta || ""), platform: String(parsed.platform || "instagram"), note: String(parsed.note || ""),
    redo: parsed.redo || null,
  };
  // n8n "Progress scraping": the row the page's poller confirms the job by. A card with no video starts at writing.
  // An INSERT, not an upsert: a job id that already exists is refused, so a re-post can never clear a cancel or
  // start a second run of the same job (the primary key makes two racing posts end with one refused too).
  const first = buildPatch({
    jobId: job.jobId, client, postId: job.postId, status: "running", stage: job.mode === "video" ? "scraping" : "writing",
    caption: "", error: "", cancel_requested: false, started_at: new Date().toISOString(),
  }, new Date().toISOString());
  if (!first.ok) return json({ ok: false, error: first.error }, 400);
  const { error: insertError } = await db.from("caption_jobs").insert(first.patch);
  if (insertError) {
    if (insertError.code === "23505") return json({ ok: false, error: "This caption job was already started" }, 409);
    console.warn("[caption-generate] job row insert failed", insertError.code || "");
    return json({ ok: false, error: "Could not start the caption job. Try again." }, 500);
  }
  const work = run(job);
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(work);
  return json({ ok: true, accepted: true, jobId: job.jobId });
});
