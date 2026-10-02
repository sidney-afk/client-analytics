// analytics-market-research-collect: the Market Research brief job (n8n "MARKET RESEARCH", branch
// generate-market-brief) run by our own Edge Function (docs/plans/2026-10-01-n8n-off-analytics.md, section 7).
//
// SHADOW ONLY, built the same way as analytics-metrics-collect and analytics-top-videos-collect. It does
// the same work as n8n (Apify keyword searches on Instagram and TikTok, ranking, Whisper transcripts of the
// most viewed videos, one Claude call that writes the brief) but writes only to
// analytics_market_research_shadow. It never touches analytics_market_research_briefs (what the pages
// read) and never touches a Sheet. n8n keeps running untouched; the two are compared with
// analytics_market_research_shadow_compare().
//
// Unlike the daily jobs this one is not on a daily timer: a brief is built when someone asks for one (n8n:
// a call to its webhook; here: a row inserted into analytics_market_research_collect_queue, see
// scripts/analytics-market-research-request.js). pg_cron calls "tick" every minute but only while a request is
// open. Each tick claims the one request nobody holds and advances it until a time budget is spent, saving
// what it learned in the queue row: a scraper that is still running keeps its Apify run id, the transcripts
// are kept per video, and the Claude call goes through the Message Batches API so that a brief that takes
// minutes to write does not have to fit in one request. The brief is committed in ONE transaction.
//
// Auth: header X-Analytics-Collect-Key against the secret ANALYTICS_COLLECT_KEY (the same key the other two
// jobs use; at least 32 characters), checked before anything else. Not browser callable. Secrets it reads:
// APIFY_TOKEN (same as the other two jobs), OPENAI_KEY (the existing OpenAI key; used for Whisper) and
// ANTHROPIC_API_KEY (new: the key n8n holds as a credential). Switch: syncview_runtime_flags row
// analytics_market_research_collect, {"mode": "off" | "shadow", "clients": [slug...] (REQUIRED: only these
// clients may be built), "model": "claude-opus-4-6", "max_new_per_day": 3}. Default off.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import {
  assembleReels,
  buildClaudeInput,
  buildPrompt,
  checkFileSize,
  claudeRequest,
  dedupeFilter,
  extractHook,
  MAX_VIDEO_BYTES,
  MODEL_DEFAULT,
  needsTranscript,
  normalizeInstagram,
  normalizeTikTok,
  mergeScrapes,
  parseBrief,
  sortAndFilter,
} from "../_shared/analytics-market-research-collect.mjs";

type JsonMap = Record<string, unknown>;
const APIFY = "https://api.apify.com/v2";
const ANTHROPIC = "https://api.anthropic.com/v1";
const TICK_BUDGET_MS = Number(Deno.env.get("ANALYTICS_COLLECT_TICK_BUDGET_MS")) || 100_000; // the override exists for the offline test
const MAX_ATTEMPTS = 240; // one claim per minute: four hours for a whole brief
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
const TRANSCRIBE_PARALLEL = 3; // videos are up to 25 MB each; the function has little memory
const TRANSCRIBE_MARGIN_MS = Math.min(45_000, Math.floor(TICK_BUDGET_MS * 0.45)); // a video can take up to ~40 s (download 30 s, then Whisper)
const BATCH_ID = "brief"; // custom_id of the one request in a Claude batch

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
const clean = (v: unknown) => String(v == null ? "" : v).trim();

function requireKey(req: Request): boolean {
  const secret = Deno.env.get("ANALYTICS_COLLECT_KEY") || "";
  const given = clean(req.headers.get("x-analytics-collect-key"));
  return secret.length >= 32 && !!given && timingSafeEqual(given, secret);
}

async function flagValue(db: SupabaseClient, key: string): Promise<JsonMap> {
  const { data, error } = await db.from("syncview_runtime_flags").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data && typeof data.value === "object" && data.value ? data.value as JsonMap : {};
}

// ---- Apify, resumable: start a run, wait in slices, read its dataset ----
// failed = the call itself failed (n8n takes the node's error output and goes on to the next keyword).
type Scrape = { done?: boolean; failed?: boolean; run_id?: string; dataset?: string; status?: string; items?: JsonMap[]; last_error?: string };

async function apifyJson(path: string, init: RequestInit = {}): Promise<{ status: number; body: JsonMap }> {
  const token = Deno.env.get("APIFY_TOKEN") || "";
  const res = await fetch(`${APIFY}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  let body: unknown = {};
  try { body = await res.json(); } catch (_e) { /* non-JSON answer */ }
  return { status: res.status, body: (body && typeof body === "object" ? body : { data: body }) as JsonMap };
}

const SCRAPE_FAILED: Scrape = { done: true, failed: true, items: [] };

async function scrapeStage(actor: string, input: JsonMap, st: Scrape, deadline: number, normalize: (items: JsonMap[]) => JsonMap[]): Promise<Scrape> {
  if (st.done) return st;
  try {
    let status = clean(st.status);
    if (!st.run_id) {
      const r = await apifyJson(`/acts/${actor}/runs?waitForFinish=40`, { method: "POST", body: JSON.stringify(input) });
      if (r.status >= 400) return SCRAPE_FAILED;
      const d = (r.body.data || {}) as JsonMap;
      st = { ...st, run_id: clean(d.id), dataset: clean(d.defaultDatasetId) };
      status = clean(d.status);
    }
    while (!TERMINAL.has(status) && Date.now() < deadline - 8_000) {
      const wait = Math.max(1, Math.min(40, Math.floor((deadline - Date.now()) / 1000) - 6));
      const r = await apifyJson(`/actor-runs/${st.run_id}?waitForFinish=${wait}`);
      if (r.status >= 400) return { ...st, last_error: `run_status_${r.status}` };
      status = clean(((r.body.data || {}) as JsonMap).status);
    }
    st.status = status;
    if (!TERMINAL.has(status)) return st; // still running: the next tick continues
    if (status !== "SUCCEEDED") return SCRAPE_FAILED;
    const res = await fetch(`${APIFY}/datasets/${st.dataset}/items?format=json`, { headers: { Authorization: `Bearer ${Deno.env.get("APIFY_TOKEN") || ""}` } });
    if (!res.ok) return SCRAPE_FAILED;
    const arr = await res.json();
    return { ...st, done: true, items: normalize(Array.isArray(arr) ? arr.map((x: JsonMap) => x || {}) : []) };
  } catch (e) {
    return { ...st, last_error: e instanceof Error ? e.message.slice(0, 120) : "fetch_failed" };
  }
}

// ---- one video: download (30 s, one retry), size check, Whisper, hook rules ----
type Outcome = { transcript: string; hook: string | null; hookSkipped: boolean; skipReason?: string };

// Reads at most MAX_VIDEO_BYTES bytes; anything bigger is reported as too large without keeping it.
async function download(url: string): Promise<{ bytes: Uint8Array | null; size: number | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok || !res.body) continue;
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared >= MAX_VIDEO_BYTES) { await res.body.cancel(); return { bytes: null, size: declared }; }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size >= MAX_VIDEO_BYTES) { await reader.cancel(); return { bytes: null, size }; }
        chunks.push(value);
      }
      const all = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) { all.set(c, at); at += c.length; }
      return { bytes: all, size };
    } catch (_e) { /* try once more */ }
  }
  return { bytes: null, size: null };
}

async function transcribeOne(url: string): Promise<Outcome> {
  const d = await download(url);
  const skip = checkFileSize(d.size);
  if (skip) return { transcript: "", hook: null, hookSkipped: true, skipReason: skip };
  let whisper: JsonMap = { error: "whisper_failed" };
  try {
    const form = new FormData();
    form.append("file", new Blob([(d.bytes as Uint8Array).buffer as ArrayBuffer], { type: "video/mp4" }), "video.mp4");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_KEY") || ""}` }, body: form });
    whisper = await res.json().catch(() => ({ error: "whisper_bad_json" })) as JsonMap;
    if (!res.ok && !whisper.error) whisper = { error: `whisper_${res.status}` };
  } catch (_e) { /* stays an error: transcribe_failed */ }
  return extractHook(whisper) as Outcome;
}

// ---- Claude through the Message Batches API ----
type ClaudeStage = { batch_id?: string; submissions?: number; done?: boolean; failed?: boolean; text?: string; stop_reason?: string; usage?: JsonMap; prompt_sha256?: string; prompt_chars?: number };

async function anthropic(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${ANTHROPIC}${path}`, { ...init, headers: { ...(init.headers || {}), "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" } });
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function claudeStage(st: ClaudeStage, request: JsonMap, prompt: string): Promise<ClaudeStage> {
  if (st.done) return st;
  try {
    if (!st.batch_id) {
      if ((st.submissions || 0) >= 2) return { ...st, done: true, failed: true }; // n8n retries the call; two tries here
      const res = await anthropic("/messages/batches", { method: "POST", body: JSON.stringify({ requests: [{ custom_id: BATCH_ID, params: request }] }) });
      const body = await res.json().catch(() => ({})) as JsonMap;
      if (!res.ok || !body.id) return { ...st, submissions: (st.submissions || 0) + 1, done: (st.submissions || 0) + 1 >= 2, failed: (st.submissions || 0) + 1 >= 2 };
      return { ...st, batch_id: clean(body.id), submissions: (st.submissions || 0) + 1, prompt_sha256: await sha256(prompt), prompt_chars: prompt.length };
    }
    const res = await anthropic(`/messages/batches/${st.batch_id}`);
    const body = await res.json().catch(() => ({})) as JsonMap;
    if (!res.ok) return st; // try again next tick
    if (body.processing_status !== "ended") return st;
    const out = await anthropic(`/messages/batches/${st.batch_id}/results`);
    if (!out.ok) return st;
    const lines = (await out.text()).split("\n").filter(l => l.trim());
    for (const line of lines) {
      const row = JSON.parse(line) as JsonMap;
      if (row.custom_id !== BATCH_ID) continue;
      const result = (row.result || {}) as JsonMap;
      if (result.type === "succeeded") {
        const message = (result.message || {}) as JsonMap;
        const content = (message.content as JsonMap[]) || [];
        return { ...st, done: true, text: String((content[0] || {}).text ?? ""), stop_reason: clean(message.stop_reason), usage: (message.usage || {}) as JsonMap };
      }
    }
    // errored, expired or canceled: submit again once
    return { ...st, batch_id: undefined };
  } catch (_e) {
    return st;
  }
}

// ---- one request ----
type Profile = { slug: string; display_name: string; keywords: string | null; content_description: string | null };
type QueueRow = { id: string; client_slug: string; keywords: string[]; attempts: number; stages: JsonMap | null };

async function fail(db: SupabaseClient, id: string, reason: string, outcome: JsonMap = {}): Promise<string> {
  const { error } = await db.from("analytics_market_research_collect_queue").update({ state: "failed", last_error: reason, lease_until: null, outcome, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  return "failed";
}

async function processRequest(db: SupabaseClient, q: QueueRow, flags: JsonMap, deadline: number, runId: string): Promise<string> {
  const allowed = ((flags.clients as string[]) || []).map(clean).filter(Boolean);
  if (!allowed.includes(q.client_slug)) return await fail(db, q.id, "client_not_allowed");
  const { data: p, error: pe } = await db.from("client_profiles").select("slug,display_name,keywords,content_description").eq("slug", q.client_slug).is("archived_at", null).maybeSingle();
  if (pe) throw pe;
  if (!p) return await fail(db, q.id, "client_profile_missing");
  const prof = p as Profile;
  const keywords = (q.keywords || []).map(clean).filter(Boolean);
  const model = clean(flags.model) || MODEL_DEFAULT;
  const stages: JsonMap = { ...(q.stages || {}) };
  const save = async (): Promise<void> => {
    const { error } = await db.from("analytics_market_research_collect_queue").update({ stages, state: "running", lease_until: null, updated_at: new Date().toISOString() }).eq("id", q.id);
    if (error) throw error;
  };
  const now = new Date();
  const newer = new Date(now.getTime() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  // 1. the keyword searches, all started at once, each kept until it answers
  if (!stages.ranked) {
    const scr = (stages.scrape || {}) as Record<string, Scrape>;
    const jobs: Array<Promise<void>> = [];
    keywords.forEach((kw, i) => {
      jobs.push(scrapeStage("patient_discovery~instagram-search-reels", { query: kw, maxPages: 8, onlyPostsNewerThan: newer }, scr[`ig${i}`] || {}, deadline, items => normalizeInstagram(items, kw))
        .then(s => { scr[`ig${i}`] = s; }));
      jobs.push(scrapeStage("clockworks~free-tiktok-scraper", { searchQueries: [kw], searchSection: "/video", maxRequestRetries: 5, maxCrawls: 75, resultsPerPage: 75 }, scr[`tt${i}`] || {}, deadline, items => normalizeTikTok(items, kw))
        .then(s => { scr[`tt${i}`] = s; }));
    });
    await Promise.all(jobs);
    stages.scrape = scr;
    const all = Object.values(scr);
    if (all.length < keywords.length * 2 || all.some(s => !s.done)) { await save(); return "waiting"; }
    const ig = keywords.flatMap((_, i) => (scr[`ig${i}`].items || []) as JsonMap[]);
    const tt = keywords.flatMap((_, i) => (scr[`tt${i}`].items || []) as JsonMap[]);
    let merged: JsonMap[];
    try { merged = mergeScrapes(ig, tt) as JsonMap[]; } catch (_e) { return await fail(db, q.id, "no_reels", { scrape_failed: all.filter(s => s.failed).length, scrape_runs: all.length }); }
    stages.ranked = sortAndFilter(merged, now);
    stages.scrape_failed = all.filter(s => s.failed).length;
    stages.scrape_runs = all.length;
    delete stages.scrape; // the raw answers are big and no longer needed
    await save();
  }

  // 2. transcripts of the reels that can reach the brief, a few at a time
  const ranked = stages.ranked as Array<JsonMap & { rank: number; videoUrl: string; views: number }>;
  const tx = (stages.tx || {}) as Record<string, Outcome>;
  stages.tx = tx;
  const todo = ranked.filter(r => needsTranscript(r) && !tx[String(r.rank)]);
  let at = 0;
  const worker = async (): Promise<void> => {
    while (Date.now() < deadline - TRANSCRIBE_MARGIN_MS) {
      const r = todo[at++];
      if (!r) return;
      tx[String(r.rank)] = await transcribeOne(r.videoUrl);
    }
  };
  await Promise.all(Array.from({ length: TRANSCRIBE_PARALLEL }, worker));
  if (ranked.some(r => needsTranscript(r) && !tx[String(r.rank)])) { await save(); return "waiting"; }

  // 3. the brief
  const outcomes: Record<number, Outcome> = {};
  for (const [k, v] of Object.entries(tx)) outcomes[Number(k)] = v;
  const reels = dedupeFilter(assembleReels(ranked, outcomes));
  const input = buildClaudeInput(reels, { clientName: prof.display_name, clientNiche: prof.keywords || "", contentDescription: prof.content_description || "", keywords });
  const prompt = buildPrompt(input, now.getTime());
  const request = claudeRequest(prompt, model) as JsonMap;
  const cl = await claudeStage((stages.claude || {}) as ClaudeStage, request, prompt);
  stages.claude = cl;
  if (cl.done && cl.failed) return await fail(db, q.id, "claude_failed", { model, reels: input.totalReels });
  if (!cl.done) { await save(); return "waiting"; }

  const row = parseBrief(cl.text || "", keywords, now.getTime());
  const { error: ce } = await db.rpc("analytics_market_research_collect_commit_shadow", {
    p_id: q.id,
    p_row: { id: now.toISOString(), client_name: row.clientName, date: row.date, raw_json: row.rawJson, raw_json_2: row.rawJson2, raw_json_3: row.rawJson3 },
    p_outcome: {
      model, stop_reason: cl.stop_reason || null, prompt_sha256: cl.prompt_sha256 || null, prompt_chars: cl.prompt_chars || null,
      reels_ranked: ranked.length, reels_in_brief: input.totalReels, transcribed: input.transcribedCount, instagram: input.instagramInTop100, tiktok: input.tiktokInTop100,
      scrape_runs: stages.scrape_runs ?? null, scrape_failed: stages.scrape_failed ?? null, usage: cl.usage || null,
    },
    p_run_id: runId,
  });
  if (ce) throw ce;
  return "done";
}

async function tick(db: SupabaseClient, flags: JsonMap): Promise<JsonMap> {
  const deadline = Date.now() + TICK_BUDGET_MS;
  const runId = `market-research-collect-${new Date().toISOString().slice(0, 10)}`;
  const cap = Math.max(1, Math.min(10, Number(flags.max_new_per_day) || 3));
  const { data: claimed, error: ke } = await db.rpc("analytics_market_research_collect_claim", { p_lease_seconds: 170, p_max_attempts: MAX_ATTEMPTS, p_max_new_per_day: cap });
  if (ke) throw ke;
  const results: Record<string, string> = {};
  await Promise.all(((claimed || []) as QueueRow[]).map(async (q) => {
    try {
      results[q.id] = await processRequest(db, q, flags, deadline, runId);
    } catch (e) {
      results[q.id] = "error";
      // Never log handles, keywords or payloads: the error text only.
      console.error("market research collect failed", e instanceof Error ? e.message : String(e));
      // An internal error (database, profile, commit) is not the providers' fault: give the attempt back.
      await db.from("analytics_market_research_collect_queue").update({ attempts: Math.max(0, q.attempts - 1), last_error: (e instanceof Error ? e.message : String(e)).slice(0, 200), lease_until: null, updated_at: new Date().toISOString() })
        .eq("id", q.id);
    }
  }));
  const counts = Object.values(results).reduce((m: Record<string, number>, s) => { m[s] = (m[s] || 0) + 1; return m; }, {});
  return { ok: true, claimed: (claimed || []).length, results: counts };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!requireKey(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);
  try {
    const raw = await req.text();
    if (raw.length > 100_000) return json({ ok: false, error: "body_too_large" }, 413);
    let body: JsonMap = {};
    try { body = raw ? JSON.parse(raw) as JsonMap : {}; } catch (_e) { return json({ ok: false, error: "bad_json" }, 400); }
    const action = clean(body.action) || "tick";
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const flags = await flagValue(db, "analytics_market_research_collect");
    if (flags.mode !== "shadow") return json({ ok: true, skipped: "off" });
    if (action === "tick") return json(await tick(db, flags));
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("analytics-market-research-collect failed", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "collect_failed" }, 500);
  }
});
