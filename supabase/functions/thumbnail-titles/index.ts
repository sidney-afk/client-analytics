// Supabase Edge Function: thumbnail-titles
//
// The background step that writes a thumbnail work item's title into its
// description, replacing the retired n8n step "Generate Titles" (spec and
// history in ./logic.mjs). Called only by the pg_cron timer
// thumbnail-titles-tick (migrations/2026-10-09-thumbnail-titles.sql), never by
// a browser, so creating a post never waits for it.
//
// One tick: queue new empty thumbnails from the Submit tab and Calendar posts
// (never Samples), claim a batch, and for each client read its thumbnail title
// prompt and its filming plan (the Higgsfield connector's planTabs reader),
// ask Claude once per client and month, and write each line through
// thumbnail_title_apply, which writes ONLY into a description that is still
// empty. Where no title can be honestly written the line says "Needs info: ..."
// instead of leaving the description blank.
//
// Off unless the runtime flag thumbnail_titles lists the client ("*" = all).
//
// Auth: the timer sends the Vault secret thumbnail_titles_key in x-thumbnail-titles-key; the
// database compares it (thumbnail_titles_key_ok), so no second copy of that key lives anywhere.
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   THUMBNAIL_TITLES_API_KEY  Anthropic API key. Without it only the "Needs info" lines that need no
//                             AI are written; the rest wait in the queue (counted as waiting_for_api_key).
// Optional env:
//   THUMBNAIL_TITLES_MODEL    default claude-sonnet-5-5

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { tabMonth } from "../higgsfield-mcp/clientinfo.ts";
import { readPlanTabs } from "./plan.ts";
import {
  clientOn,
  effectivePrompt,
  borrowedMonthLabel,
  borrowedPlanName,
  borrowedVerdict,
  CHECK_SYSTEM_PROMPT,
  checkForCutoff,
  checkMessage,
  cutoffDay,
  parseCheck,
  selectEarlierCaptioned,
  monthLabel,
  needsInfoLine,
  normalizedText,
  numberFromCardName,
  numberFromItemTitle,
  parseTitles,
  JSON_ONLY_FOLLOWUP,
  pickTab,
  planHasVideos,
  postNameFor,
  resolveLine,
  shortError,
  SYSTEM_PROMPT,
  userMessage,
} from "./logic.mjs";
import { seedDefault } from "./seed.ts";
import { actorName, addUsage } from "./manual.mjs";
import { type Asker, MANUAL_ACTIONS, RunError, handleManual, processRun, resumeStaleRuns } from "./runs.ts";
import {
  authorizeBrowserWrite,
  browserWriteAuthResponse,
  normalizeBrowserWriteClient,
} from "../_shared/browser-write-auth.ts";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const CLAIM_LIMIT = 40;
const MAX_ATTEMPTS = 3;
const PROVIDER_TIMEOUT_MS = 60_000;

type Json = Record<string, unknown>;
type Job = { deliverable_id: string; client_slug: string; attempts: number };
type Post = { key: string; job: Job; videoNumber: number | null; postName: string; createdAt: string; via: string };

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

async function apply(db: SupabaseClient, id: string, text: string, state: string, outcome: string, lastError = ""): Promise<string> {
  // No more "Needs info" lines in descriptions (owner decision 5, 2026-10-23): the description stays
  // empty and only the queue records why, so a person can press "Write title" once the plan is ready.
  if (state === "needs_info") {
    const { error } = await db.from("thumbnail_title_queue")
      .update({ state: "needs_info", outcome, lease_until: null, last_error: lastError || null, updated_at: new Date().toISOString() })
      .eq("deliverable_id", id).in("state", ["pending", "running"]);
    if (error) throw new Error("apply_failed");
    return "needs_info";
  }
  const args = { p_deliverable_id: id, p_text: text, p_state: state, p_outcome: outcome };
  let { data, error } = await db.rpc("thumbnail_title_apply", { ...args, p_error: lastError || null });
  // Deployed before migrations/2026-10-10-thumbnail-titles-error-record.sql was applied: the database
  // only has the four-argument version (PostgREST answers PGRST202). Write the line anyway.
  if (error && error.code === "PGRST202") ({ data, error } = await db.rpc("thumbnail_title_apply", args));
  if (error) throw new Error("apply_failed");
  return clean(data);
}

// A passing failure goes back in the queue; the third one becomes a Needs info line.
// Either way the short reason stays in last_error, so a failure is never silent.
async function fail(db: SupabaseClient, job: Job, code: string, counts: Json): Promise<void> {
  if (job.attempts >= MAX_ATTEMPTS) {
    const state = await apply(db, job.deliverable_id, needsInfoLine("generation_failed"), "needs_info", "generation_failed", code);
    counts[state] = Number(counts[state] || 0) + 1;
    return;
  }
  await db.rpc("thumbnail_titles_release", { p_deliverable_id: job.deliverable_id, p_error: code });
  counts.retry_later = Number(counts.retry_later || 0) + 1;
}

type Answer = { ok: boolean; content: unknown; error: string; usage?: unknown };

async function callClaude(apiKey: string, model: string, messages: Json[], system = SYSTEM_PROMPT): Promise<Answer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4096, system, messages }),
    });
    const body = await response.json().catch(() => null) as Json | null;
    if (!response.ok) {
      const type = body && typeof body.error === "object" && body.error ? clean((body.error as Json).type) : "";
      return { ok: false, content: null, error: shortError(`http_${response.status}`, type) };
    }
    if (!body || !Array.isArray(body.content)) return { ok: false, content: null, error: "answer_unreadable" };
    const stop = clean(body.stop_reason);
    return { ok: true, content: body.content, error: stop && stop !== "end_turn" ? `stop_${stop}` : "", usage: body.usage };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, content: null, error: aborted ? "timeout" : shortError("network", e instanceof Error ? e.name : "") };
  } finally {
    clearTimeout(timer);
  }
}

// One request for a month's posts. An answer with no readable list gets one
// follow-up in the same thread asking for the JSON only; if that still has no
// list, the reason comes back so the caller can store it.
// Token counts for the whole call (both requests when a follow-up was needed), recorded per run and
// counted in the tick's response (owner decision 7, 2026-10-23).
type Usage = { input: number; output: number };
async function askClaude(apiKey: string, model: string, prompt: string, posts: Post[], planText: string): Promise<{ titles: Map<string, string> | null; error: string; usage: Usage }> {
  const keys = posts.map((p) => p.key);
  let usage: Usage = { input: 0, output: 0 };
  const messages: Json[] = [{ role: "user", content: userMessage(prompt, posts, planText) }];
  const first = await callClaude(apiKey, model, messages);
  usage = addUsage(usage, first.usage);
  if (!first.ok) return { titles: null, error: first.error, usage };
  const parsed = parseTitles(first.content, keys);
  if (parsed.ok) return { titles: parsed.titles, error: "", usage };
  messages.push({ role: "assistant", content: first.content as Json[] }, { role: "user", content: JSON_ONLY_FOLLOWUP });
  const second = await callClaude(apiKey, model, messages);
  usage = addUsage(usage, second.usage);
  if (!second.ok) return { titles: null, error: shortError(parsed.error, second.error), usage };
  const again = parseTitles(second.content, keys);
  if (again.ok) return { titles: again.titles, error: "", usage };
  return { titles: null, error: shortError(again.error, [first.error, second.error].filter(Boolean).join(" ")), usage };
}

// The used-video check for posts that borrowed a neighbouring month's tab: one extra request per borrowed
// tab. Returns the check, or the short reason it could not be read.
async function askCheck(apiKey: string, model: string, earlier: Array<{ caption: string }>, posts: Post[], planText: string): Promise<{ check: ReturnType<typeof parseCheck> | null; error: string }> {
  const answer = await callClaude(apiKey, model, [{ role: "user", content: checkMessage(earlier, posts, planText) }], CHECK_SYSTEM_PROMPT);
  if (!answer.ok) return { check: null, error: answer.error };
  const check = parseCheck(answer.content, earlier.length, posts.map((p) => p.key));
  return check.ok ? { check, error: "" } : { check: null, error: check.error };
}

async function runClient(db: SupabaseClient, slug: string, jobs: Job[], apiKey: string, model: string, counts: Json): Promise<void> {
  const ids = jobs.map((j) => j.deliverable_id);
  const { data: rows, error } = await db.from("deliverables")
    .select("id,title,batch_id,card_id,created_at,brief,status,kind").in("id", ids);
  if (error) { for (const j of jobs) await fail(db, j, shortError("deliverables_read", error.code), counts); return; }
  const byId = new Map(((rows || []) as Json[]).map((r) => [clean(r.id), r]));

  // Live rows only; a description someone has filled in meanwhile is left alone by apply().
  const live: Array<{ job: Job; row: Json }> = [];
  for (const job of jobs) {
    const row = byId.get(job.deliverable_id);
    if (!row || clean(row.brief)) {
      const state = row ? "skipped_human" : "skipped_gone";
      await db.from("thumbnail_title_queue")
        .update({ state, outcome: state, lease_until: null, updated_at: new Date().toISOString() })
        .eq("deliverable_id", job.deliverable_id);
      counts[state] = Number(counts[state] || 0) + 1;
      continue;
    }
    live.push({ job, row });
  }
  if (!live.length) return;

  const writeAll = async (items: Array<{ job: Job }>, text: string, outcome: string) => {
    for (const { job } of items) {
      const state = await apply(db, job.deliverable_id, text, "needs_info", outcome);
      counts[state] = Number(counts[state] || 0) + 1;
    }
  };

  const { data: plan } = await db.from("filming_plans").select("doc_id").eq("client_slug", slug).maybeSingle();
  const docId = clean(plan && (plan as Json).doc_id);
  if (!docId) return await writeAll(live, needsInfoLine("no_plan"), "no_plan");

  // The link reader first, then the service account (private plans, owner decision 6).
  const tabs = (await readPlanTabs(docId)).tabs;
  if (!tabs.length) return await writeAll(live, needsInfoLine("plan_unreadable"), "plan_unreadable");

  const { data: promptRow } = await db.from("thumbnail_title_prompts").select("prompt,default_prompt").eq("client_slug", slug).maybeSingle();
  // A client added after the seeding run gets its default now, the first time it is needed.
  const prompt = promptRow ? effectivePrompt(promptRow) : (await seedDefault(db, slug)).default_prompt;

  // Card names and how many thumbnails share each batch, for the video number.
  const cardIds = [...new Set(live.map((l) => clean(l.row.card_id)).filter(Boolean))];
  const batchIds = [...new Set(live.map((l) => clean(l.row.batch_id)).filter(Boolean))];
  const [{ data: cards }, { data: siblings }] = await Promise.all([
    db.from("calendar_posts").select("id,name").eq("client", slug).in("id", cardIds.length ? cardIds : ["-"]),
    db.from("deliverables").select("batch_id").eq("kind", "thumbnail").in("batch_id", batchIds.length ? batchIds : ["-"]),
  ]);
  const cardName = new Map(((cards || []) as Json[]).map((c) => [clean(c.id), clean(c.name)]));
  const perBatch = new Map<string, number>();
  for (const s of (siblings || []) as Json[]) perBatch.set(clean(s.batch_id), (perBatch.get(clean(s.batch_id)) || 0) + 1);

  // One request per filming-plan tab (one per month).
  const groups = new Map<string, { tab: { id: string; name: string; text: string }; posts: Post[] }>();
  for (const [i, { job, row }] of live.entries()) {
    const picked = pickTab(tabs, clean(row.created_at), tabMonth);
    if (!picked.tab) {
      const outcome = picked.reason || "no_month_tab";
      const state = await apply(db, job.deliverable_id, needsInfoLine(outcome, { month: monthLabel(clean(row.created_at)) }), "needs_info", outcome);
      counts[state] = Number(counts[state] || 0) + 1;
      continue;
    }
    if (!planHasVideos(picked.tab.text)) {
      const state = await apply(db, job.deliverable_id, needsInfoLine("plan_empty"), "needs_info", "plan_empty");
      counts[state] = Number(counts[state] || 0) + 1;
      continue;
    }
    const name = cardName.get(clean(row.card_id)) || "";
    const videoNumber = numberFromCardName(name) ?? numberFromItemTitle(clean(row.title), perBatch.get(clean(row.batch_id)) || 0);
    const post: Post = { key: `p${i + 1}`, job, videoNumber, postName: postNameFor(name, clean(row.title)), createdAt: clean(row.created_at), via: picked.via || "" };
    const key = picked.tab.id || picked.tab.name || "only";
    if (!groups.has(key)) groups.set(key, { tab: picked.tab, posts: [] });
    groups.get(key)!.posts.push(post);
  }

  for (const { tab, posts } of groups.values()) {
    if (!apiKey) {
      for (const p of posts) await db.rpc("thumbnail_titles_release", { p_deliverable_id: p.job.deliverable_id, p_error: "no_api_key", p_count: false });
      counts.waiting_for_api_key = Number(counts.waiting_for_api_key || 0) + posts.length;
      continue;
    }
    // Posts on a borrowed tab: numbering restarts every month, so first check that the video the card
    // points to was not already used by an earlier post. Posts on their own month's tab skip this.
    let toTitle = posts;
    const borrowed = posts.filter((p) => p.via);
    if (borrowed.length) {
      const first = borrowed[0];
      const cardIds = borrowed.map((p) => clean(byId.get(p.job.deliverable_id)?.card_id)).filter(Boolean);
      const [{ data: cardRows, error: cardError }, { data: history, error: historyError }] = await Promise.all([
        db.from("calendar_posts").select("id,scheduled_date").eq("client", slug).in("id", cardIds.length ? cardIds : ["-"]),
        db.from("calendar_posts").select("id,name,caption,scheduled_date").eq("client", slug).neq("caption", "").not("caption", "is", null).order("scheduled_date", { ascending: false }).limit(400),
      ]);
      // A failed read is a failed check, never an empty one: the posts go back in the queue.
      const readFailed = !!(cardError || historyError);
      if (readFailed) {
        const code = shortError("calendar_read", (cardError || historyError)?.code);
        console.warn(`thumbnail-titles: calendar read failed for ${borrowed.length} borrowed post(s) (${code})`);
        for (const p of borrowed) await fail(db, p.job, code, counts);
        toTitle = posts.filter((p) => !p.via);
      }
      // Each borrowed post has its own cutoff day; the captions are read up to the latest of them.
      const dateOf = new Map(((cardRows || []) as Json[]).map((r) => [clean(r.id), clean(r.scheduled_date)]));
      const cutoffs = new Map(borrowed.map((p) => [p.key, cutoffDay(dateOf.get(clean(byId.get(p.job.deliverable_id)?.card_id)), p.createdAt)]));
      const cardDate = [...cutoffs.values()].filter(Boolean).sort().pop() || "";
      const earlier = readFailed ? [] : selectEarlierCaptioned(history || [], { cardDate, createdAt: first.createdAt, excludeIds: cardIds });
      const { check, error } = readFailed ? { check: null, error: "" } : await askCheck(apiKey, model, earlier, borrowed, tab.text);
      if (readFailed) {
        // The borrowed posts were already put back in the queue above.
      } else if (!check) {
        console.warn(`thumbnail-titles: used-video check failed for ${borrowed.length} post(s) (${error})`);
        for (const p of borrowed) await fail(db, p.job, error || "check_failed", counts);
        toTitle = posts.filter((p) => !p.via);
      } else {
        const stop = new Set<string>();
        for (const p of borrowed) {
          const own = checkForCutoff(check, earlier, cutoffs.get(p.key) || "");
          const verdict = borrowedVerdict(p, own.check, own.count);
          if (verdict.accept) continue;
          stop.add(p.key);
          const vars = { month: monthLabel(p.createdAt), plan: borrowedPlanName(p.createdAt, p.via), video: verdict.video };
          const note = `tab_${p.via}: ${borrowedMonthLabel(p.createdAt, p.via)}`;
          const state = await apply(db, p.job.deliverable_id, needsInfoLine(verdict.outcome, vars), "needs_info", verdict.outcome, note);
          counts[state] = Number(counts[state] || 0) + 1;
          counts[verdict.outcome] = Number(counts[verdict.outcome] || 0) + 1;
        }
        toTitle = posts.filter((p) => !stop.has(p.key));
      }
      if (!toTitle.length) continue;
    }
    const answer = await askClaude(apiKey, model, prompt, toTitle, tab.text);
    counts.input_tokens = Number(counts.input_tokens || 0) + answer.usage.input;
    counts.output_tokens = Number(counts.output_tokens || 0) + answer.usage.output;
    if (!answer.titles) {
      // Counts and a code only: never a title, a plan line or a client name in the logs.
      console.warn(`thumbnail-titles: no titles for a group of ${toTitle.length} (${answer.error})`);
      for (const p of toTitle) await fail(db, p.job, answer.error || "provider", counts);
      continue;
    }
    const planNormalized = normalizedText(tab.text);
    for (const post of toTitle) {
      const line = resolveLine(post, answer.titles.get(post.key) || "", planNormalized, post.via ? borrowedPlanName(post.createdAt, post.via) : "");
      // A tab borrowed from the next or previous month is noted in last_error (a code and a month, never plan text).
      const note = post.via ? `tab_${post.via}: ${borrowedMonthLabel(post.createdAt, post.via)}` : "";
      const state = await apply(db, post.job.deliverable_id, line.text, line.state, line.outcome, note);
      counts[state] = Number(counts[state] || 0) + 1;
      if (post.via) counts[`tab_${post.via}`] = Number(counts[`tab_${post.via}`] || 0) + 1;
    }
  }
}

// The Production buttons (runs.ts) are called from the browser with a staff key; everything else is the
// timer, with the Vault key, exactly as before.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};
function corsJson(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function runDeps() {
  const apiKey = clean(Deno.env.get("THUMBNAIL_TITLES_API_KEY"));
  const model = clean(Deno.env.get("THUMBNAIL_TITLES_MODEL")) || DEFAULT_MODEL;
  const ask: Asker = (prompt, posts, planText) => askClaude(apiKey, model, prompt, posts as Post[], planText);
  return { apiKey, model, ask };
}

async function handleBrowser(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({})) as Json;
    const action = clean(body.action);
    if (!MANUAL_ACTIONS.has(action)) return corsJson({ ok: false, error: "unknown action" }, 400);
    const client = normalizeBrowserWriteClient(body.client);
    if (!client) return corsJson({ ok: false, error: "client required" }, 400);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) return corsJson({ ok: false, error: "server not configured" }, 500);
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const principal = await authorizeBrowserWrite(db, req, client, "thumbnail-titles");
    // Admins and SMMs only: the people who may already edit a description (owner decision 2).
    if (principal.kind !== "staff" || !["admin", "smm"].includes(principal.role)) {
      return corsJson({ ok: false, error: "smm_or_admin_only" }, 403);
    }
    const who = { name: actorName(req.headers.get("x-syncview-actor"), principal.role), role: principal.role };
    const deps = runDeps();
    const start = (runId: string) => {
      const work = processRun(db, runId, deps).catch(() => "failed");
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime && typeof EdgeRuntime.waitUntil === "function") EdgeRuntime.waitUntil(work);
    };
    return corsJson(await handleManual(db, action, body, client, who, start));
  } catch (e) {
    const auth = browserWriteAuthResponse(e);
    if (auth) return corsJson({ ok: false, error: auth.code }, auth.status);
    if (e instanceof RunError) return corsJson({ ok: false, error: e.message }, e.status);
    console.warn(`thumbnail-titles: a button request failed (${e instanceof Error ? e.name : "error"})`);
    return corsJson({ ok: false, error: "server_error" }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (!req.headers.get("x-thumbnail-titles-key") && req.headers.get("x-syncview-key")) return await handleBrowser(req);
  const given = clean(req.headers.get("x-thumbnail-titles-key"));
  if (given.length < 32) return json({ ok: false, error: "unauthorized" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: keyOk, error: keyError } = await db.rpc("thumbnail_titles_key_ok", { p_key: given });
  if (keyError || keyOk !== true) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Json;
  const action = clean(body.action);
  if (action === "ping") return json({ ok: true, pong: "thumbnail-titles" });
  if (action !== "tick" && action !== "seed") return json({ ok: false, error: "unknown action" }, 400);

  // Seed (or refresh) the default prompt of every active client. Saved prompts are untouched.
  if (action === "seed") {
    const { data: clients, error } = await db.from("clients").select("slug,display_name").eq("active", true);
    if (error) return json({ ok: false, error: "clients_read" }, 500);
    const sources: Record<string, number> = {};
    let failed = 0;
    for (const c of (clients || []) as Json[]) {
      try {
        const seeded = await seedDefault(db, clean(c.slug), clean(c.display_name));
        const key = seeded.source.split(":")[0] === "brain" ? "from_brain" : seeded.source.replace("generic:", "generic_");
        sources[key] = (sources[key] || 0) + 1;
      } catch (_e) { failed++; }
    }
    return json({ ok: true, seeded: (clients || []).length - failed, failed, ...sources });
  }

  // Finish any button run whose worker stopped. Missing tables (migration not applied) are simply skipped.
  let resumed = 0;
  try { resumed = await resumeStaleRuns(db, runDeps()); } catch (_e) { resumed = 0; }

  const { data: flag } = await db.from("syncview_runtime_flags").select("value").eq("key", "thumbnail_titles").maybeSingle();
  const flagValue = (flag && (flag as Json).value) as Json | null;
  const anyOn = !!flagValue && Array.isArray(flagValue.clients) && flagValue.clients.length > 0;
  if (!anyOn) return json({ ok: true, skipped: "off", resumed_runs: resumed });
  // Without the AI key, lines that need no AI (no plan, empty plan, no tab for the month) are still
  // written; items that need a title go back in the queue without using up a try.
  const apiKey = clean(Deno.env.get("THUMBNAIL_TITLES_API_KEY"));
  const model = clean(Deno.env.get("THUMBNAIL_TITLES_MODEL")) || DEFAULT_MODEL;

  const { data: queued, error: enqueueError } = await db.rpc("thumbnail_titles_enqueue_new");
  if (enqueueError) return json({ ok: false, error: "enqueue_failed" }, 500);
  const { data: claimed, error: claimError } = await db.rpc("thumbnail_titles_claim", { p_limit: CLAIM_LIMIT });
  if (claimError) return json({ ok: false, error: "claim_failed" }, 500);

  const byClient = new Map<string, Job[]>();
  for (const job of (claimed || []) as Job[]) {
    if (!clientOn(flagValue, job.client_slug)) continue;
    if (!byClient.has(job.client_slug)) byClient.set(job.client_slug, []);
    byClient.get(job.client_slug)!.push(job);
  }
  const counts: Json = {};
  for (const [slug, jobs] of byClient) {
    try {
      await runClient(db, slug, jobs, apiKey, model, counts);
    } catch (e) {
      const reason = shortError("client_run", e instanceof Error ? e.message : "");
      console.warn(`thumbnail-titles: a client run stopped (${reason})`);
      for (const job of jobs) {
        try { await db.rpc("thumbnail_titles_release", { p_deliverable_id: job.deliverable_id, p_error: reason }); } catch (_e2) { /* lease expiry re-offers it */ }
      }
      counts.client_errors = Number(counts.client_errors || 0) + 1;
    }
  }
  // Counts only: never a title, a slug or an id in the response or the logs.
  return json({ ok: true, queued_new: Number(queued || 0), claimed: (claimed || []).length, clients: byClient.size, resumed_runs: resumed, ...counts });
});
