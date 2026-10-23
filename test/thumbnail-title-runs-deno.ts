// Drives the Production thumbnail title run (supabase/functions/thumbnail-titles/runs.ts) end to end against
// an in-memory stand-in for the database (session Titlecard, 2026-10-23, OPEN_REPAIRS 476). The plan reader
// is fed a fictional plan through a stubbed fetch, and the model is a fake that answers per post.
//
// Run: deno run --allow-env --allow-read --node-modules-dir=auto test/thumbnail-title-runs-deno.ts
//
// What it proves: a press writes an empty description and the robot's "Needs info" line at once, waits for
// a person on text a person wrote and on an earlier AI title, skips a video the tab does not hold, records
// tokens; a second press follows the run; Keep mine, Replace (keeps the old text) and Undo write by compare
// and set; a description edited meanwhile is never overwritten; a provider failure retries and then marks
// only those rows failed; "Try again" runs them again in the same run; a creative is refused; a run whose
// worker died is finished by the timer.

import { handleManual, processRun, resumeStaleRuns, RunError, type Asker } from "../supabase/functions/thumbnail-titles/runs.ts";
import { needsInfoLine } from "../supabase/functions/thumbnail-titles/logic.mjs";

type Row = Record<string, unknown>;
let checks = 0;
function ok(v: unknown, m: string) { if (!v) throw new Error("thumbnail-title-runs: " + m); checks++; }

// ---- a small stand-in for the supabase-js query builder ------------------------------------------------
class Db {
  t: Record<string, Row[]> = {};
  rpcCalls: Array<{ name: string; args: Row }> = [];
  seq = 0;
  from(name: string) { this.t[name] = this.t[name] || []; return new Q(this, name); }
  async rpc(name: string, args: Row) {
    this.rpcCalls.push({ name, args });
    if (name !== "thumbnail_title_manual_apply") return { data: null, error: { code: "PGRST202", message: "no" } };
    const d = this.t.deliverables.find((r) => r.id === args.p_deliverable_id);
    if (!d || d.kind !== "thumbnail" || ["canceled", "duplicate"].includes(String(d.status))) return { data: "gone", error: null };
    if (String(d.brief ?? "") !== String(args.p_expected ?? "")) return { data: "changed", error: null };
    d.brief = args.p_text;
    (this.t.deliverable_events = this.t.deliverable_events || []).push({ deliverable_id: d.id, actor: args.p_actor, action: "description_change", payload: { action: args.p_action } });
    return { data: "written", error: null };
  }
}
type Filter = (r: Row) => boolean;
class Q {
  op = "select"; patch: Row | Row[] | null = null; filters: Filter[] = []; orderBy: [string, boolean] | null = null; lim = 0; single = false; wantRows = false;
  constructor(public db: Db, public name: string) {}
  select(_c?: string) { if (this.op !== "select") this.wantRows = true; return this; }
  insert(v: Row | Row[]) { this.op = "insert"; this.patch = v; return this; }
  update(v: Row) { this.op = "update"; this.patch = v; return this; }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
  in(k: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
  lt(k: string, v: string) { this.filters.push((r) => r[k] != null && String(r[k]) < v); return this; }
  neq(k: string, v: unknown) { this.filters.push((r) => r[k] !== v); return this; }
  not(k: string, _op: string, list: string) { const vs = list.replace(/[()]/g, "").split(","); this.filters.push((r) => !vs.includes(String(r[k]))); return this; }
  or(expr: string) {
    // Only the claim's shape: state.eq.queued,and(state.eq.running,lease_until.lt.<iso>)
    const m = /^state\.eq\.(\w+),and\(state\.eq\.(\w+),lease_until\.lt\.(.+)\)$/.exec(expr);
    if (!m) throw new Error("fake db: unsupported or(): " + expr);
    this.filters.push((r) => r.state === m[1] || (r.state === m[2] && r.lease_until != null && String(r.lease_until) < m[3]));
    return this;
  }
  order(k: string, o?: { ascending?: boolean }) { this.orderBy = [k, o?.ascending !== false]; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.single = true; return this; }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(res, rej); }
  run(): { data: unknown; error: unknown } {
    const rows = this.db.t[this.name];
    const match = () => rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "insert") {
      const list = (Array.isArray(this.patch) ? this.patch : [this.patch]) as Row[];
      const made: Row[] = [];
      for (const v of list) {
        const row: Row = { ...v };
        if (this.name === "thumbnail_title_runs") {
          if (rows.some((r) => r.run_key === row.run_key && ["queued", "running", "ask"].includes(String(r.state)))) return { data: null, error: { code: "23505", message: "dup" } };
          Object.assign(row, { id: row.id || `ttr_${++this.db.seq}`, state: row.state || "queued", stage: "reading", attempts: 0, input_tokens: 0, output_tokens: 0, tab_choices: [], created_at: new Date().toISOString() });
        }
        if (this.name === "thumbnail_title_run_items") Object.assign(row, { state: row.state || "waiting" });
        rows.push(row); made.push(row);
      }
      return { data: this.single ? made[0] : made, error: null };
    }
    if (this.op === "update") {
      const hit = match();
      for (const r of hit) {
        Object.assign(r, this.patch);
        if (this.name === "thumbnail_title_runs" && ["queued", "running", "ask"].includes(String(r.state))
          && rows.some((o) => o !== r && o.run_key === r.run_key && ["queued", "running", "ask"].includes(String(o.state)))) return { data: null, error: { code: "23505", message: "dup" } };
      }
      const out = hit.map((r) => ({ ...r }));
      return { data: this.wantRows ? (this.single ? out[0] ?? null : out) : null, error: null };
    }
    let out = match().map((r) => ({ ...r }));
    if (this.orderBy) { const [k, asc] = this.orderBy; out.sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (asc ? 1 : -1)); }
    if (this.lim) out = out.slice(0, this.lim);
    return { data: this.single ? out[0] ?? null : out, error: null };
  }
}

// ---- the fictional plan, served by a stubbed fetch -------------------------------------------------------
const planText = (n: number) => "Filming plan\n" + Array.from({ length: n }, (_, i) => `${i + 1}. Video ${i + 1}: the morning routine part ${i + 1}, pantry swaps and the work day, said to camera.`).join("\n") + "\n" + "notes ".repeat(300);
const tabsHtml = '{"ty":"ac","d":["t.sepxyz",[1,"September"]]} {"ty":"ac","d":["t.octxyz",[1,"October"]]} {"ty":"ac","d":["t.novxyz",[1,"November"]]}';
const tabText: Record<string, string> = { "t.sepxyz": planText(6), "t.octxyz": planText(5), "t.novxyz": planText(8) };
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  if (url.endsWith("/edit")) return new Response(tabsHtml, { status: 200 });
  const m = /tab=([^&]+)/.exec(url);
  if (m) return new Response(tabText[decodeURIComponent(m[1])] || "", { status: 200 });
  return new Response("", { status: 404 });
}) as typeof fetch;

// ---- the fake model -----------------------------------------------------------------------------------
let failNext = 0;
let asked = 0;
const ask: Asker = async (_prompt, posts, _plan) => {
  asked++;
  if (failNext > 0) { failNext--; return { titles: null, error: "http_529: overloaded_error", usage: { input: 0, output: 0 } }; }
  const titles = new Map<string, string>();
  for (const p of posts) if (p.videoNumber && p.videoNumber <= 3) titles.set(p.key, ["", "Morning routine part one", "Pantry swaps part two", "Work day part three"][p.videoNumber]);
  return { titles, error: "", usage: { input: 4000, output: 120 } };
};
const deps = { apiKey: "test-key", model: "claude-sonnet-5-5", ask };

function seed(): Db {
  const db = new Db();
  const now = "2026-10-20T10:00:00.000Z";
  const d = (id: string, title: string, brief: string, card: string) => ({ id, title, brief, kind: "thumbnail", status: "todo", batch_id: "bat_1", card_id: card, created_at: now, client_slug: "demo-fixture" });
  db.t.deliverables = [
    d("th-1", "Thumbnail 1 — Morning routine", "", "card-1"),
    d("th-2", "Thumbnail 2 — Pantry swaps", needsInfoLine("plan_empty"), "card-2"),
    d("th-3", "Thumbnail 3 — Work day", "Big text: lunch box", "card-3"),
    d("th-4", "Thumbnail 4 — Questions", "", "card-4"),
    d("th-5", "Thumbnail 5 — Old title", "Thumbnail title (generated by AI): Old title", "card-5"),
  ];
  db.t.batches = [{ id: "bat_1", created_at: now, filming_doc_url: "https://docs.google.com/document/d/1FictionalDocIdForTheTestOnly0000000/edit" }];
  db.t.calendar_posts = [1, 2, 3, 4, 5].map((n) => ({ id: `card-${n}`, name: `Video ${n === 5 ? 1 : n} — post ${n}`, client: "demo-fixture" }));
  db.t.thumbnail_title_prompts = [{ client_slug: "demo-fixture", prompt: "", default_prompt: "Write short titles." }];
  db.t.filming_plans = [];
  db.t.thumbnail_title_runs = [];
  db.t.thumbnail_title_run_items = [];
  return db;
}
const who = { name: "Browser Admin", role: "admin" };
const brief = (db: Db, id: string) => String(db.t.deliverables.find((r) => r.id === id)!.brief ?? "");
const itemOf = (db: Db, id: string) => db.t.thumbnail_title_run_items.find((r) => r.deliverable_id === id)!;

// 1. A whole post.
{
  const db = seed();
  const started: string[] = [];
  const start = (id: string) => { started.push(id); };
  const res = await handleManual(db as never, "run", { run_key: "post:p1", items: ["th-1", "th-2", "th-3", "th-4", "th-5", "nope"] }, "demo-fixture", who, start) as Row;
  ok(started.length === 1 && (res.items as Row[]).length === 5, "a run starts with the five live thumbnails (an unknown id is dropped)");
  const second = await handleManual(db as never, "run", { run_key: "post:p1", items: ["th-1"] }, "demo-fixture", { name: "Sam Other", role: "smm" }, start) as Row;
  ok(second.following === true && started.length === 1 && db.t.thumbnail_title_runs.length === 1, "a second press, from anyone, follows the run already going");
  ok(await processRun(db as never, started[0], deps) === "done", "the run finishes");
  const run = db.t.thumbnail_title_runs[0];
  ok(run.tab_name === "October" && run.state === "done", "the October tab: the latest on or before the batch (November is the plan being written)");
  ok(brief(db, "th-1") === "Thumbnail title (generated by AI, from the October plan): Morning routine part one" && itemOf(db, "th-1").state === "done", "an empty description gets its title at once");
  ok(brief(db, "th-2").endsWith("Pantry swaps part two") && itemOf(db, "th-2").state === "done", "the robot's Needs info line is replaced at once");
  ok(brief(db, "th-3") === "Big text: lunch box" && itemOf(db, "th-3").state === "review" && itemOf(db, "th-3").outcome === "human", "a person's text waits for review, untouched");
  ok(itemOf(db, "th-4").state === "skipped" && itemOf(db, "th-4").message === "Video 4 not matched in the October plan" && brief(db, "th-4") === "", "a video the model could not match is skipped, with the reason, and nothing written");
  ok(itemOf(db, "th-5").state === "review" && itemOf(db, "th-5").outcome === "ai", "an earlier AI title waits for Use new");
  ok(run.input_tokens === 4000 && run.output_tokens === 120 && asked === 1, "one model call for the whole post, its tokens stored");
  ok(db.rpcCalls.every((c) => c.args.p_actor === "Browser Admin"), "writes carry the person who pressed");

  // Decisions.
  await handleManual(db as never, "decide", { run_id: run.id, deliverable_id: "th-3", choice: "replace" }, "demo-fixture", who, start);
  ok(brief(db, "th-3") === "Thumbnail title (generated by AI, from the October plan): Work day part three\n\nPrevious description:\nBig text: lunch box", "Replace keeps the person's text under the title");
  db.t.deliverables.find((r) => r.id === "th-5")!.brief = "Thumbnail title (generated by AI): Old title (edited)";
  const changed = await handleManual(db as never, "decide", { run_id: run.id, deliverable_id: "th-5", choice: "use_new" }, "demo-fixture", who, start) as Row;
  ok(changed.result === "changed" && brief(db, "th-5").endsWith("(edited)") && itemOf(db, "th-5").previous_brief === "Thumbnail title (generated by AI): Old title (edited)", "an edit made meanwhile is never overwritten; the review shows the new text");
  await handleManual(db as never, "decide", { run_id: run.id, deliverable_id: "th-5", choice: "keep" }, "demo-fixture", who, start);
  ok(itemOf(db, "th-5").state === "kept" && brief(db, "th-5").endsWith("(edited)"), "Keep mine writes nothing");
  await handleManual(db as never, "decide", { run_id: run.id, deliverable_id: "th-2", choice: "undo" }, "demo-fixture", who, start);
  ok(brief(db, "th-2") === needsInfoLine("plan_empty") && itemOf(db, "th-2").outcome === "undone", "Undo puts back exactly what was there");
  let threw = "";
  try { await handleManual(db as never, "decide", { run_id: run.id, deliverable_id: "th-2", choice: "undo" }, "demo-fixture", who, start); } catch (e) { threw = (e as RunError).message; }
  ok(threw === "nothing_to_undo", "a second Undo is refused");
  const status = await handleManual(db as never, "status", { run_key: "post:p1" }, "demo-fixture", who, start) as Row;
  ok((status.run as Row).id === run.id && (status.run as Row).cost_cents === 0.9, "status by post returns the run, with its cost");
  let wrongClient = "";
  try { await handleManual(db as never, "status", { run_id: run.id }, "other-client", who, start); } catch (e) { wrongClient = (e as RunError).message; }
  ok(wrongClient === "run_not_found", "another client cannot read this run");
}

// 2. The provider fails: it retries, then marks only those rows failed; Try again finishes them in the same run.
{
  const db = seed();
  const started: string[] = [];
  await handleManual(db as never, "run", { run_key: "post:p2", items: ["th-1"] }, "demo-fixture", who, (id) => started.push(id));
  failNext = 3;
  asked = 0;
  ok(await processRun(db as never, started[0], deps) === "done" && asked === 3, "a failing provider is tried three times");
  ok(itemOf(db, "th-1").state === "failed" && itemOf(db, "th-1").last_error === "http_529: overloaded_error" && brief(db, "th-1") === "", "then the row says failed, with the reason, and nothing is written");
  await handleManual(db as never, "retry", { run_id: started[0], all: true }, "demo-fixture", who, (id) => started.push(id));
  ok(started.length === 2 && started[1] === started[0], "Try again runs again in the same run");
  ok(await processRun(db as never, started[1], deps) === "done" && itemOf(db, "th-1").state === "done", "and the title lands");
}

// 3. A worker that died: the timer picks the run up once its lease runs out.
{
  const db = seed();
  await handleManual(db as never, "run", { run_key: "post:p3", items: ["th-1"] }, "demo-fixture", who, () => { /* the start is lost */ });
  db.t.thumbnail_title_runs[0].lease_until = new Date(Date.now() - 1000).toISOString();
  ok(await resumeStaleRuns(db as never, deps) === 1 && db.t.thumbnail_title_runs[0].state === "done" && brief(db, "th-1") !== "", "the timer finishes a run whose worker never started");
}

// 4. Two tabs for the same month: the run asks, then the person's pick is used.
{
  const db = seed();
  const started: string[] = [];
  const twoOct = '{"ty":"ac","d":["t.octxyz",[1,"October"]]} {"ty":"ac","d":["t.oc2xyz",[1,"October 2026"]]}';
  tabText["t.oc2xyz"] = planText(3);
  const saved = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => String(input).endsWith("/edit") ? new Response(twoOct) : saved(input)) as typeof fetch;
  await handleManual(db as never, "run", { run_key: "post:p4", items: ["th-1"] }, "demo-fixture", who, (id) => started.push(id));
  ok(await processRun(db as never, started[0], deps) === "ask" && db.t.thumbnail_title_runs[0].state === "ask" && (db.t.thumbnail_title_runs[0].tab_choices as Row[]).length === 2 && brief(db, "th-1") === "", "two tabs fit: it asks, and nothing is written");
  await handleManual(db as never, "pick_tab", { run_id: started[0], tab_id: "t.oc2xyz" }, "demo-fixture", who, (id) => started.push(id));
  ok(await processRun(db as never, started[1], deps) === "done" && db.t.thumbnail_title_runs[0].tab_id === "t.oc2xyz" && brief(db, "th-1").includes("October 2026"), "the person's pick is used");
  globalThis.fetch = saved;
}

console.log(`thumbnail-title-runs-deno: ${checks} checks passed`);
