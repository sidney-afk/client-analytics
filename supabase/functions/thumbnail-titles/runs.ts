// The Production thumbnail title buttons, server side (session Titlecard, 2026-10-23, OPEN_REPAIRS 476).
//
// Browser actions (staff key; admins and SMMs only, owner decision 2):
//   run       {client, run_key, items:[deliverable ids], scope:"post"|"item"}  start a run, or follow the
//             one already going for this post (one active run per run_key; a second press or person joins it)
//   status    {client, run_key} or {client, run_id}                           the run and its rows
//   decide    {client, run_id, deliverable_id, choice}                        keep | replace | above | use_new | undo
//   retry     {client, run_id, deliverable_id}                                that one row again, same run
//   pick_tab  {client, run_id, tab_id}                                        "Which tab?" / "Use another tab"
//   cancel    {client, run_id}
// The run itself works in the background (EdgeRuntime.waitUntil), so closing the tab does not stop it; a run
// whose worker dies is picked up again by the per-minute timer (lease expiry, at most three tries).
//
// Nothing is written into a description except through thumbnail_title_manual_apply, which writes only when
// the description is still exactly what the run saw. Logs carry counts and codes only.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { tabMonth } from "../higgsfield-mcp/clientinfo.ts";
import {
  effectivePrompt,
  grounded,
  normalizedText,
  numberFromCardName,
  numberFromItemTitle,
  postNameFor,
  titleShapeOk,
} from "./logic.mjs";
import {
  MAX_RUN_ITEMS,
  RUN_KEY_RE,
  costCents,
  decideWrite,
  docIdFromUrl,
  pickBatchTab,
  skipMessage,
  tabChoices,
  tabFits,
  tabLabel,
  textFor,
  titleLineFor,
} from "./manual.mjs";
import { readPlanTabs } from "./plan.ts";
import { seedDefault } from "./seed.ts";

type Json = Record<string, unknown>;
type Usage = { input: number; output: number };
export type Asker = (prompt: string, posts: Array<{ key: string; videoNumber: number | null; postName: string }>, planText: string)
  => Promise<{ titles: Map<string, string> | null; error: string; usage: Usage }>;

export const MANUAL_ACTIONS = new Set(["run", "status", "decide", "retry", "pick_tab", "cancel"]);
const LEASE_MS = 3 * 60 * 1000;
const CHUNK = 30;
const RETRY_DELAYS_MS = [2000, 6000];
const ACTIVE = ["queued", "running", "ask"];

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}
const nowIso = () => new Date().toISOString();
// A run that is queued but whose worker never started is picked up by the timer after a minute.
const startLease = () => new Date(Date.now() + 60_000).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A table the migration adds is missing: the buttons say "not ready" instead of failing loudly.
function missingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202" || /does not exist|schema cache/i.test(error.message || ""));
}

export class RunError extends Error {
  status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}

// ---------------------------------------------------------------------------
// Reading a run for the page.
// ---------------------------------------------------------------------------
export async function runPayload(db: SupabaseClient, run: Json | null): Promise<Json> {
  if (!run) return { ok: true, run: null, items: [] };
  const { data: items, error } = await db.from("thumbnail_title_run_items")
    .select("deliverable_id,position,state,outcome,message,video_number,title,proposed_text,previous_brief,written_text,updated_at")
    .eq("run_id", clean(run.id)).order("position");
  if (error) throw new RunError(500, "items_read");
  const counts: Record<string, number> = {};
  for (const it of (items || []) as Json[]) counts[clean(it.state)] = (counts[clean(it.state)] || 0) + 1;
  return {
    ok: true,
    run: {
      id: run.id, run_key: run.run_key, scope: run.scope, state: run.state, stage: run.stage,
      requested_by: run.requested_by, tab_id: run.tab_id, tab_name: run.tab_name, tab_choices: run.tab_choices || [],
      error: run.error, created_at: run.created_at, finished_at: run.finished_at,
      input_tokens: run.input_tokens, output_tokens: run.output_tokens,
      cost_cents: costCents(clean(run.model), Number(run.input_tokens || 0), Number(run.output_tokens || 0)),
      counts,
    },
    items: ((items || []) as Json[]).map((it) => ({
      deliverable_id: it.deliverable_id, state: it.state, outcome: it.outcome, message: it.message,
      video_number: it.video_number, title: it.title,
      before: it.previous_brief, after: it.proposed_text || it.written_text,
    })),
  };
}

async function loadRun(db: SupabaseClient, runId: string, client: string): Promise<Json> {
  const { data, error } = await db.from("thumbnail_title_runs").select("*").eq("id", runId).maybeSingle();
  if (missingTable(error)) throw new RunError(503, "not_ready");
  if (error) throw new RunError(500, "run_read");
  if (!data || clean((data as Json).client_slug) !== client) throw new RunError(404, "run_not_found");
  return data as Json;
}

// ---------------------------------------------------------------------------
// Browser actions.
// ---------------------------------------------------------------------------
export async function handleManual(
  db: SupabaseClient, action: string, body: Json, client: string,
  who: { name: string; role: string }, start: (runId: string) => void,
): Promise<Json> {
  if (action === "status") {
    if (clean(body.run_id)) return await runPayload(db, await loadRun(db, clean(body.run_id), client));
    const key = clean(body.run_key);
    if (!RUN_KEY_RE.test(key)) throw new RunError(400, "run_key_required");
    const { data, error } = await db.from("thumbnail_title_runs").select("*")
      .eq("run_key", key).eq("client_slug", client).order("created_at", { ascending: false }).limit(1);
    if (missingTable(error)) throw new RunError(503, "not_ready");
    if (error) throw new RunError(500, "run_read");
    return await runPayload(db, ((data || []) as Json[])[0] || null);
  }

  if (action === "run") {
    const key = clean(body.run_key);
    if (!RUN_KEY_RE.test(key)) throw new RunError(400, "run_key_required");
    const ids = [...new Set((Array.isArray(body.items) ? body.items : []).map(clean).filter(Boolean))].slice(0, MAX_RUN_ITEMS);
    if (!ids.length) throw new RunError(400, "no_thumbnails");
    const { data: rows, error } = await db.from("deliverables").select("id,client_slug,kind,status,title").in("id", ids);
    if (error) throw new RunError(500, "deliverables_read");
    const live = new Set(((rows || []) as Json[])
      .filter((r) => clean(r.client_slug) === client && clean(r.kind) === "thumbnail" && !["canceled", "duplicate"].includes(clean(r.status)))
      .map((r) => clean(r.id)));
    const keep = ids.filter((id) => live.has(id));
    if (!keep.length) throw new RunError(400, "no_thumbnails");
    const scope = clean(body.scope) === "item" ? "item" : "post";
    const { data: created, error: insertError } = await db.from("thumbnail_title_runs")
      .insert({ run_key: key, client_slug: client, scope, requested_by: who.name, requested_role: who.role, lease_until: startLease() })
      .select("*").maybeSingle();
    if (missingTable(insertError)) throw new RunError(503, "not_ready");
    if (insertError && insertError.code === "23505") {
      // One run per post at a time: a second press, from anyone, follows the run already going.
      const { data: active } = await db.from("thumbnail_title_runs").select("*")
        .eq("run_key", key).in("state", ACTIVE).order("created_at", { ascending: false }).limit(1);
      const run = ((active || []) as Json[])[0] || null;
      return { ...(await runPayload(db, run)), following: true };
    }
    if (insertError || !created) throw new RunError(500, "run_create");
    const run = created as Json;
    const { error: itemsError } = await db.from("thumbnail_title_run_items")
      .insert(keep.map((id, position) => ({ run_id: run.id, deliverable_id: id, position })));
    if (itemsError) {
      await db.from("thumbnail_title_runs").update({ state: "error", error: "items_create", finished_at: nowIso() }).eq("id", run.id);
      throw new RunError(500, "items_create");
    }
    start(clean(run.id));
    return { ...(await runPayload(db, run)), following: false };
  }

  const run = await loadRun(db, clean(body.run_id), client);
  const runId = clean(run.id);
  const state = clean(run.state);

  if (action === "cancel") {
    if (ACTIVE.includes(state)) {
      await db.from("thumbnail_title_runs").update({ state: "cancelled", stage: "finished", lease_until: null, finished_at: nowIso(), updated_at: nowIso() }).eq("id", runId).in("state", ACTIVE);
      await db.from("thumbnail_title_run_items").update({ state: "skipped", outcome: "cancelled", message: "Cancelled", updated_at: nowIso() })
        .eq("run_id", runId).in("state", ["waiting", "building"]);
    }
    return await runPayload(db, await loadRun(db, runId, client));
  }

  if (action === "pick_tab") {
    const tabId = clean(body.tab_id).slice(0, 80);
    if (!tabId) throw new RunError(400, "tab_required");
    // "Use another tab": every row that is not settled by a person goes again on that tab. A title the
    // first tab already wrote now reads as an AI title, so it comes back as a before/after, never silently.
    await db.from("thumbnail_title_run_items").update({ state: "waiting", outcome: null, message: null, last_error: null, updated_at: nowIso() })
      .eq("run_id", runId).in("state", ["waiting", "building", "done", "review", "skipped", "failed"]);
    const { error } = await db.from("thumbnail_title_runs")
      .update({ state: "queued", stage: "reading", tab_id: tabId, error: null, attempts: 0, lease_until: startLease(), finished_at: null, updated_at: nowIso() })
      .eq("id", runId);
    if (error) throw new RunError(500, "run_update");
    start(runId);
    return await runPayload(db, await loadRun(db, runId, client));
  }

  if (action === "retry" && body.all === true) {
    // "Try again" in the toast: every failed row of this run, same run, same tab.
    if (ACTIVE.includes(state)) throw new RunError(409, "run_active");
    const { data: reset } = await db.from("thumbnail_title_run_items").update({ state: "waiting", outcome: null, message: null, last_error: null, updated_at: nowIso() })
      .eq("run_id", runId).eq("state", "failed").select("deliverable_id");
    if (!(reset || []).length) throw new RunError(409, "not_retryable");
    const { error } = await db.from("thumbnail_title_runs")
      .update({ state: "queued", stage: "reading", error: null, attempts: 0, lease_until: startLease(), finished_at: null, updated_at: nowIso() })
      .eq("id", runId);
    if (error && error.code === "23505") throw new RunError(409, "run_active");
    if (error) throw new RunError(500, "run_update");
    start(runId);
    return await runPayload(db, await loadRun(db, runId, client));
  }

  const deliverableId = clean(body.deliverable_id);
  const { data: itemRow } = await db.from("thumbnail_title_run_items").select("*").eq("run_id", runId).eq("deliverable_id", deliverableId).maybeSingle();
  const item = itemRow as Json | null;
  if (!item) throw new RunError(404, "item_not_found");

  if (action === "retry") {
    if (ACTIVE.includes(state)) throw new RunError(409, "run_active");
    if (clean(item.state) !== "failed" && clean(item.state) !== "skipped") throw new RunError(409, "not_retryable");
    await db.from("thumbnail_title_run_items").update({ state: "waiting", outcome: null, message: null, last_error: null, updated_at: nowIso() })
      .eq("run_id", runId).eq("deliverable_id", deliverableId);
    const { error } = await db.from("thumbnail_title_runs")
      .update({ state: "queued", stage: "reading", error: null, attempts: 0, lease_until: startLease(), finished_at: null, updated_at: nowIso() })
      .eq("id", runId).not("state", "in", `(${ACTIVE.join(",")})`);
    if (error && error.code === "23505") throw new RunError(409, "run_active");
    if (error) throw new RunError(500, "run_update");
    start(runId);
    return await runPayload(db, await loadRun(db, runId, client));
  }

  if (action === "decide") {
    const choice = clean(body.choice);
    if (!["keep", "replace", "above", "use_new", "undo"].includes(choice)) throw new RunError(400, "unknown_choice");
    const itemState = clean(item.state);
    const patch: Json = { updated_at: nowIso(), decided_by: who.name };
    let result = "";
    if (choice === "keep") {
      if (itemState !== "review") throw new RunError(409, "not_waiting");
      Object.assign(patch, { state: "kept", outcome: "kept", message: "Kept yours" });
    } else if (choice === "undo") {
      if (itemState !== "done" || !clean(item.written_text)) throw new RunError(409, "nothing_to_undo");
      result = await manualApply(db, deliverableId, clean(item.written_text) ? String(item.written_text) : "", String(item.previous_brief || ""), who, runId, "undo");
      if (result === "written") Object.assign(patch, { state: "kept", outcome: "undone", message: "Undone", written_text: null });
    } else {
      if (itemState !== "review" || !clean(item.proposed_text)) throw new RunError(409, "not_waiting");
      const text = textFor(choice, String(item.proposed_text), String(item.previous_brief || ""));
      result = await manualApply(db, deliverableId, String(item.previous_brief || ""), text, who, runId, choice);
      if (result === "written") Object.assign(patch, { state: "done", outcome: choice, message: clean(item.title), written_text: text, proposed_text: null });
    }
    if (result === "changed") {
      // Someone edited the description since the run read it: show the new "now" and ask again.
      const { data: fresh } = await db.from("deliverables").select("brief").eq("id", deliverableId).maybeSingle();
      Object.assign(patch, { previous_brief: clean(fresh && (fresh as Json).brief) ? String((fresh as Json).brief) : "" });
      if (choice === "undo") Object.assign(patch, { message: "Changed since it was written, so Undo was not applied" });
    } else if (result === "gone") {
      Object.assign(patch, { state: "skipped", outcome: "gone", message: skipMessage("gone") });
    }
    await db.from("thumbnail_title_run_items").update(patch).eq("run_id", runId).eq("deliverable_id", deliverableId);
    return { ...(await runPayload(db, await loadRun(db, runId, client))), result: result || "ok" };
  }

  throw new RunError(400, "unknown action");
}

async function manualApply(db: SupabaseClient, id: string, expected: string, text: string, who: { name: string; role: string }, runId: string, action: string): Promise<string> {
  const { data, error } = await db.rpc("thumbnail_title_manual_apply", {
    p_deliverable_id: id, p_expected: expected, p_text: text, p_actor: who.name, p_role: who.role, p_run_id: runId, p_action: action,
  });
  if (missingTable(error)) throw new RunError(503, "not_ready");
  if (error) throw new RunError(500, "apply_failed");
  return clean(data);
}

// ---------------------------------------------------------------------------
// The run itself.
// ---------------------------------------------------------------------------
async function setItems(db: SupabaseClient, runId: string, ids: string[], patch: Json): Promise<void> {
  if (!ids.length) return;
  await db.from("thumbnail_title_run_items").update({ ...patch, updated_at: nowIso() }).eq("run_id", runId).in("deliverable_id", ids);
}

async function finish(db: SupabaseClient, runId: string, patch: Json): Promise<void> {
  await db.from("thumbnail_title_runs").update({ stage: "finished", lease_until: null, finished_at: nowIso(), updated_at: nowIso(), ...patch })
    .eq("id", runId).in("state", ["running"]);
}

// Is this worker still the one the run belongs to? A cancel, or "Use another tab" while it works, changes
// the run's state or tab; this worker then stops before writing anything more.
async function stillMine(db: SupabaseClient, runId: string, tabId: string | null): Promise<boolean> {
  const { data } = await db.from("thumbnail_title_runs").select("state,tab_id").eq("id", runId).maybeSingle();
  const r = data as Json | null;
  return !!r && clean(r.state) === "running" && clean(r.tab_id) === clean(tabId);
}

export async function processRun(db: SupabaseClient, runId: string, deps: { apiKey: string; model: string; ask: Asker }): Promise<string> {
  const leaseIso = () => new Date(Date.now() + LEASE_MS).toISOString();
  const { data: claimed, error: claimError } = await db.from("thumbnail_title_runs")
    .update({ state: "running", lease_until: leaseIso(), updated_at: nowIso() })
    .eq("id", runId)
    .or(`state.eq.queued,and(state.eq.running,lease_until.lt.${nowIso()})`)
    .select("*").maybeSingle();
  if (claimError || !claimed) return "not_claimed";
  const run = claimed as Json;
  const attempts = Number(run.attempts || 0) + 1;
  await db.from("thumbnail_title_runs").update({ attempts, model: deps.model }).eq("id", runId);
  const client = clean(run.client_slug);
  const pickedTab = clean(run.tab_id) || null;
  let usage: Usage = { input: Number(run.input_tokens || 0), output: Number(run.output_tokens || 0) };
  const saveUsage = () => db.from("thumbnail_title_runs").update({ input_tokens: usage.input, output_tokens: usage.output, lease_until: leaseIso(), updated_at: nowIso() }).eq("id", runId);

  try {
    const { data: itemRows } = await db.from("thumbnail_title_run_items").select("deliverable_id,state,position").eq("run_id", runId).order("position");
    const pending = ((itemRows || []) as Json[]).filter((r) => ["waiting", "building"].includes(clean(r.state))).map((r) => clean(r.deliverable_id));
    if (!pending.length) { await finish(db, runId, { state: "done" }); return "done"; }

    const { data: delivRows, error: delivError } = await db.from("deliverables")
      .select("id,title,batch_id,card_id,created_at,brief,status,kind").in("id", pending);
    if (delivError) throw new Error("deliverables_read");
    const byId = new Map(((delivRows || []) as Json[]).map((r) => [clean(r.id), r]));
    const gone = pending.filter((id) => !byId.has(id) || ["canceled", "duplicate"].includes(clean(byId.get(id)!.status)) || clean(byId.get(id)!.kind) !== "thumbnail");
    await setItems(db, runId, gone, { state: "skipped", outcome: "gone", message: skipMessage("gone") });
    const ids = pending.filter((id) => !gone.includes(id));
    if (!ids.length) { await finish(db, runId, { state: "done" }); return "done"; }

    // 1. Reading the filming plan: the batch's own link first (the Assets grid's Filming plan row), then the client's.
    await db.from("thumbnail_title_runs").update({ stage: "reading", updated_at: nowIso() }).eq("id", runId);
    const batchIds = [...new Set(ids.map((id) => clean(byId.get(id)!.batch_id)).filter(Boolean))];
    const { data: batchRows } = await db.from("batches").select("id,created_at,filming_doc_url").in("id", batchIds.length ? batchIds : ["-"]);
    let docId = "";
    for (const b of (batchRows || []) as Json[]) docId = docId || docIdFromUrl(b.filming_doc_url);
    if (!docId) {
      const { data: plan } = await db.from("filming_plans").select("doc_id").eq("client_slug", client).maybeSingle();
      docId = clean(plan && (plan as Json).doc_id);
    }
    if (!docId) { await finish(db, runId, { state: "error", error: "no_plan" }); await setItems(db, runId, ids, { state: "skipped", outcome: "no_plan", message: "No filming plan linked" }); return "no_plan"; }
    const read = await readPlanTabs(docId);
    if (!read.tabs.length) {
      await finish(db, runId, { state: "error", error: read.shareWith ? `plan_unreadable:${read.shareWith}` : "plan_unreadable" });
      await setItems(db, runId, ids, { state: "skipped", outcome: "plan_unreadable", message: "The filming plan could not be opened" });
      return "plan_unreadable";
    }

    // 2. Finding the batch: the plan tab (owner decision 4).
    await db.from("thumbnail_title_runs").update({ stage: "finding", updated_at: nowIso() }).eq("id", runId);
    const anchor = ((batchRows || []) as Json[]).map((b) => clean(b.created_at)).filter(Boolean).sort()[0]
      || ids.map((id) => clean(byId.get(id)!.created_at)).filter(Boolean).sort()[0] || nowIso();
    const cardIds = [...new Set(ids.map((id) => clean(byId.get(id)!.card_id)).filter(Boolean))];
    const [{ data: cards }, { data: siblings }] = await Promise.all([
      db.from("calendar_posts").select("id,name").eq("client", client).in("id", cardIds.length ? cardIds : ["-"]),
      db.from("deliverables").select("batch_id").eq("kind", "thumbnail").in("batch_id", batchIds.length ? batchIds : ["-"]),
    ]);
    const cardName = new Map(((cards || []) as Json[]).map((c) => [clean(c.id), clean(c.name)]));
    const perBatch = new Map<string, number>();
    for (const s of (siblings || []) as Json[]) perBatch.set(clean(s.batch_id), (perBatch.get(clean(s.batch_id)) || 0) + 1);
    const posts = ids.map((id, i) => {
      const row = byId.get(id)!;
      const name = cardName.get(clean(row.card_id)) || "";
      return { key: `p${i + 1}`, id, videoNumber: numberFromCardName(name) ?? numberFromItemTitle(clean(row.title), perBatch.get(clean(row.batch_id)) || 0), postName: postNameFor(name, clean(row.title)) };
    });
    for (const p of posts) if (p.videoNumber) await setItems(db, runId, [p.id], { video_number: p.videoNumber });
    const picked = pickBatchTab(read.tabs, anchor, posts.map((p) => p.videoNumber).filter(Boolean), tabMonth, pickedTab);
    const choices = tabChoices(read.tabs, anchor, tabMonth);
    if (!picked.tab) {
      if (picked.reason === "plan_empty") {
        await finish(db, runId, { state: "error", error: "plan_empty" });
        await setItems(db, runId, ids, { state: "skipped", outcome: "plan_empty", message: "The filming plan has no videos yet" });
        return "plan_empty";
      }
      // The rule cannot decide (two tabs fit equally, or none holds these videos): ask the person.
      await db.from("thumbnail_title_runs").update({ state: "ask", stage: "finding", error: picked.reason, tab_choices: picked.ask.length ? picked.ask : choices, lease_until: null, updated_at: nowIso() }).eq("id", runId).eq("state", "running");
      return "ask";
    }
    const tabName = tabLabel(picked.tab, anchor, tabMonth);
    const tabKey = clean(picked.tab.id) || pickedTab;
    await db.from("thumbnail_title_runs").update({ stage: "writing", tab_name: tabName, tab_id: tabKey, tab_choices: choices, updated_at: nowIso() }).eq("id", runId);
    if (!(await stillMine(db, runId, tabKey))) return "superseded";
    await setItems(db, runId, ids, { state: "building" });

    // 3. Writing titles: one request per 30 thumbnails (a whole post is normally one).
    if (!deps.apiKey) {
      await setItems(db, runId, ids, { state: "failed", outcome: "no_api_key", message: "Titles are not set up yet (no AI key)", last_error: "no_api_key" });
      await finish(db, runId, { state: "done", error: "no_api_key" });
      return "no_api_key";
    }
    const { data: promptRow } = await db.from("thumbnail_title_prompts").select("prompt,default_prompt").eq("client_slug", client).maybeSingle();
    const prompt = promptRow ? effectivePrompt(promptRow) : (await seedDefault(db, client)).default_prompt;
    const planNormalized = normalizedText(picked.tab.text);
    for (let at = 0; at < posts.length; at += CHUNK) {
      const chunk = posts.slice(at, at + CHUNK);
      let answer = await deps.ask(prompt, chunk, picked.tab.text);
      usage = { input: usage.input + answer.usage.input, output: usage.output + answer.usage.output };
      for (const delay of RETRY_DELAYS_MS) {
        if (answer.titles) break;
        await saveUsage();
        await sleep(delay);
        answer = await deps.ask(prompt, chunk, picked.tab.text);
        usage = { input: usage.input + answer.usage.input, output: usage.output + answer.usage.output };
      }
      await saveUsage();
      if (!answer.titles) {
        console.warn(`thumbnail-titles: a manual run had no answer for ${chunk.length} item(s) (${answer.error})`);
        await setItems(db, runId, chunk.map((p) => p.id), { state: "failed", outcome: "generation_failed", message: "The AI did not answer", last_error: answer.error.slice(0, 200) });
        continue;
      }
      if (!(await stillMine(db, runId, tabKey))) return "superseded";
      for (const p of chunk) {
        const title = clean(answer.titles.get(p.key));
        if (!title) { await setItems(db, runId, [p.id], { state: "skipped", outcome: "no_match", message: skipMessage("no_match", { tab: tabName, video: p.videoNumber, absent: !!p.videoNumber && !tabFits(picked.tab, [p.videoNumber]) }) }); continue; }
        if (!titleShapeOk(title) || !grounded(title, planNormalized)) { await setItems(db, runId, [p.id], { state: "skipped", outcome: "not_grounded", message: skipMessage("not_grounded") }); continue; }
        const line = titleLineFor(title, tabName);
        // Read the description now, at the moment of writing, not when the run started.
        const { data: fresh } = await db.from("deliverables").select("brief,status,kind").eq("id", p.id).maybeSingle();
        const before = fresh ? String((fresh as Json).brief || "") : "";
        const decision = decideWrite(before);
        if (!decision.auto) {
          await setItems(db, runId, [p.id], { state: "review", outcome: decision.kind, title, message: title, proposed_text: line, previous_brief: before });
          continue;
        }
        const { data: applied, error: applyError } = await db.rpc("thumbnail_title_manual_apply", {
          p_deliverable_id: p.id, p_expected: before, p_text: line, p_actor: clean(run.requested_by), p_role: clean(run.requested_role), p_run_id: runId, p_action: "write",
        });
        const result = applyError ? "error" : clean(applied);
        if (result === "written") await setItems(db, runId, [p.id], { state: "done", outcome: "written", title, message: title, written_text: line, previous_brief: before, proposed_text: null });
        else if (result === "changed") await setItems(db, runId, [p.id], { state: "skipped", outcome: "changed", message: skipMessage("changed") });
        else if (result === "gone") await setItems(db, runId, [p.id], { state: "skipped", outcome: "gone", message: skipMessage("gone") });
        else await setItems(db, runId, [p.id], { state: "failed", outcome: "apply_failed", message: "Could not save", last_error: "apply_failed" });
      }
    }
    await finish(db, runId, { state: "done", input_tokens: usage.input, output_tokens: usage.output });
    return "done";
  } catch (e) {
    const code = e instanceof Error ? e.message.slice(0, 80) : "run_failed";
    console.warn(`thumbnail-titles: a manual run stopped (${code})`);
    // Give the lease back early when tries remain, so the timer resumes it; otherwise end it with the reason.
    if (attempts < 3) {
      await db.from("thumbnail_title_runs").update({ lease_until: new Date(Date.now() - 1000).toISOString(), error: code, input_tokens: usage.input, output_tokens: usage.output }).eq("id", runId);
    } else {
      await setItems(db, runId, (await pendingIds(db, runId)), { state: "failed", outcome: "run_failed", message: "Something went wrong", last_error: code });
      await finish(db, runId, { state: "error", error: code, input_tokens: usage.input, output_tokens: usage.output });
    }
    return "failed";
  }
}

async function pendingIds(db: SupabaseClient, runId: string): Promise<string[]> {
  const { data } = await db.from("thumbnail_title_run_items").select("deliverable_id").eq("run_id", runId).in("state", ["waiting", "building"]);
  return ((data || []) as Json[]).map((r) => clean(r.deliverable_id));
}

// The timer finishes runs whose worker died (lease ran out), at most three tries each.
export async function resumeStaleRuns(db: SupabaseClient, deps: { apiKey: string; model: string; ask: Asker }): Promise<number> {
  const { data, error } = await db.from("thumbnail_title_runs").select("id,attempts")
    .in("state", ["queued", "running"]).lt("lease_until", nowIso()).lt("attempts", 3).limit(3);
  if (error) return 0;
  let n = 0;
  for (const r of (data || []) as Json[]) {
    // A queued run whose start was lost has no lease; it is picked up the same way once it is a minute old.
    if ((await processRun(db, clean(r.id), deps)) !== "not_claimed") n++;
  }
  return n;
}
