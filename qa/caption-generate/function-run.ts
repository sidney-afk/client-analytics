// End-to-end run of the caption-generate Edge Function's own code under Deno, with every outside service replaced
// by an in-memory stand-in: the database (caption_jobs, caption_prompts), calendar-upsert, Frame.io, Replicate,
// Claude and the brain repository on GitHub. Nothing leaves this process. Fictional client and text only.
//
//   deno run --allow-env --allow-read --allow-net --node-modules-dir=none qa/caption-generate/function-run.ts
//
// (--allow-net is needed only to fetch the npm supabase-js package the first time; every request the function makes
// is answered by the stand-in below.) Prints CAPTION_GENERATE_FUNCTION_RUN_OK on success.

const SMM_KEY = "fixture-smm-key";
for (const [k, v] of Object.entries({
  SUPABASE_URL: "https://fixture.supabase.local", SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  ROLE_KEY_SMM: SMM_KEY, ANTHROPIC_API_KEY: "fixture-anthropic", REPLICATE_API_TOKEN: "fixture-replicate",
  BRAIN_GITHUB_TOKEN: "fixture-github", APIFY_TOKEN: "",
})) Deno.env.set(k, v);

const SHARE = "11111111-2222-3333-4444-555555555555", VIEW = "66666666-7777-8888-9999-000000000000";
type Row = Record<string, unknown>;
const state = {
  jobs: new Map<string, Row>(),
  stages: [] as string[],
  calls: [] as string[],
  claude: [] as Array<Record<string, unknown>>,
  saves: [] as Array<{ body: Record<string, unknown>; key: string; source: string }>,
  saveOk: true,
  replicatePollsBeforeDone: 1,
  replicatePolls: 0,
  replicateCancelled: 0,
  cancelOnPoll: 0,
  prompt: "FIXTURE CLIENT PROMPT",
};
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function postgrest(url: URL, init: RequestInit): Response {
  const table = url.pathname.split("/").pop();
  const filters = [...url.searchParams.entries()].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
  const match = (r: Row) => filters.every(([k, v]) => v.startsWith("eq.") ? String(r[k] ?? "") === v.slice(3) : true);
  const single = String(new Headers(init.headers).get("accept") || "").includes("vnd.pgrst.object");
  if (table === "caption_prompts") {
    const rows = state.prompt === null ? [] : [{ prompt: state.prompt }];
    return single ? (rows.length ? reply(rows[0]) : reply({}, 406)) : reply(rows);
  }
  if (table === "caption_jobs") {
    if ((init.method || "GET") === "GET") {
      const rows = [...state.jobs.values()].filter(match);
      if (single) return rows.length ? reply(rows[0]) : reply({ code: "PGRST116" }, 406);
      return reply(rows);
    }
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      // No on_conflict means a plain insert: an existing key is a unique violation, as in Postgres.
      const isUpsert = url.searchParams.has("on_conflict");
      for (const p of Array.isArray(body) ? body : [body]) {
        if (!isUpsert && state.jobs.has(p.job_id)) return reply({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
      }
      for (const p of Array.isArray(body) ? body : [body]) {
        const prev = state.jobs.get(p.job_id) || {};
        state.jobs.set(p.job_id, { ...prev, ...p });
        if (p.stage) state.stages.push(`${p.job_id}:${p.stage}`);
      }
      return reply("", 201);
    }
    if (init.method === "DELETE") return reply("", 204);
  }
  return reply({ message: "unknown table" }, 404);
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init: RequestInit = {}) => {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input));
  if (req) init = { method: req.method, headers: req.headers, body: req.body ? await req.text() : undefined, ...init };
  const method = init.method || "GET";
  state.calls.push(`${method} ${url.host}${url.pathname}`);
  if (url.host === "fixture.supabase.local" && url.pathname.startsWith("/rest/v1/")) return postgrest(url, init);
  if (url.host === "fixture.supabase.local" && url.pathname === "/functions/v1/calendar-upsert") {
    const h = new Headers(init.headers);
    state.saves.push({ body: JSON.parse(String(init.body)), key: h.get("x-syncview-key") || "", source: h.get("x-syncview-source") || "" });
    return reply(state.saveOk ? { ok: true } : { ok: false, error: "conflict" }, state.saveOk ? 200 : 409);
  }
  if (url.host === "f.io") return new Response(null, { status: 302, headers: { location: `https://next.frame.io/share/${SHARE}/view/${VIEW}` } });
  if (url.host === "api.frame.io") {
    if (new Headers(init.headers).get("x-frameio-share-authentication") !== btoa(SHARE)) return reply({}, 401);
    return reply({ data: { share: { assets: { nodes: [{ id: "a", versions: [{ id: VIEW, media: { original: { downloadUrl: "https://assets.frame.io/fixture.mp4" } } }] }] } } } });
  }
  if (url.host === "api.replicate.com") {
    if (method === "POST" && url.pathname === "/v1/predictions") {
      const body = JSON.parse(String(init.body));
      if (body.input.audio !== "https://assets.frame.io/fixture.mp4" || body.input.model !== "large-v3") return reply({}, 422);
      state.replicatePolls = 0;
      return reply({ id: "pred1", status: "starting", urls: { get: "https://api.replicate.com/v1/predictions/pred1" } }, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/cancel")) { state.replicateCancelled++; return reply({ status: "canceled" }); }
    state.replicatePolls++;
    if (state.cancelOnPoll && state.replicatePolls === state.cancelOnPoll) {
      for (const r of state.jobs.values()) r.cancel_requested = true;
    }
    if (state.replicatePolls >= state.replicatePollsBeforeDone) return reply({ id: "pred1", status: "succeeded", output: { transcription: "WHISPER TRANSCRIPT" } });
    return reply({ id: "pred1", status: "processing" });
  }
  if (url.host === "api.anthropic.com") {
    const body = JSON.parse(String(init.body));
    state.claude.push(body);
    // First draft carries two tells; the revision is clean.
    const text = body.messages.length === 1 ? "Caption: We delve into rest — slowly. #rest #calm #slow" : "We slow down and rest. #rest #calm #slow";
    return reply({ content: [{ type: "text", text }] });
  }
  if (url.host === "api.github.com") {
    if (url.pathname.endsWith("/contents/clients")) return reply([{ name: "fixture-client", type: "dir" }, { name: "README.md", type: "file" }]);
    if (url.pathname.endsWith("/clients/fixture-client/voice.md")) {
      return new Response("# Fixture: voice\n\n## Tone\n<!-- brain\nid: t\nstatus: written\n-->\n\nWarm.\n\n## Caption style\n<!-- brain\nid: c\nstatus: written\n-->\n\nFIXTURE CAPTION STYLE\n", { status: 200 });
    }
    return reply({}, 404);
  }
  return realFetch(input as Request, init);
}) as typeof fetch;

let handler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: unknown }).serve = (h: (req: Request) => Promise<Response>) => { handler = h; return {}; };
const pending: Promise<unknown>[] = [];
(globalThis as unknown as { EdgeRuntime: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => pending.push(p) };
await import("../../supabase/functions/caption-generate/index.ts");
if (!handler) throw new Error("the function did not register a handler");

let checks = 0;
function ok(c: unknown, m: string) { if (!c) throw new Error("FAIL: " + m); checks++; console.log("  ok  " + m); }
async function call(body: Record<string, unknown>, headers: Record<string, string> = { "x-syncview-key": SMM_KEY, "x-syncview-actor": "Fixture SMM", "x-syncview-role": "smm" }) {
  const res = await handler!(new Request("https://fixture.supabase.local/functions/v1/caption-generate", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const json = await res.json();
  await Promise.all(pending.splice(0));
  return { status: res.status, json };
}
const reset = () => { state.claude.length = 0; state.saves.length = 0; state.stages.length = 0; state.calls.length = 0; state.cancelOnPoll = 0; state.saveOk = true; state.replicatePollsBeforeDone = 1; };

// 1. Video + an optional pasted transcript: the whole n8n chain, plus voice, rules and the extra.
reset();
let r = await call({ client: "fixtureclient", postId: "p1", assetUrl: "https://f.io/abc", captionPrompt: "PAGE COPY", jobId: "job_video", transcript: "PASTED NOTES" });
ok(r.status === 200 && r.json.ok && r.json.accepted && r.json.jobId === "job_video", "video: the request is accepted at once");
ok(state.stages.join(",") === "job_video:scraping,job_video:transcribing,job_video:writing,job_video:done", "video: stages scraping, transcribing, writing, done (as n8n): " + state.stages.join(","));
const c0 = state.claude[0] as { model: string; max_tokens: number; system: string; messages: Array<{ content: string }> };
ok(c0.model === "claude-sonnet-4-6" && c0.max_tokens === 1500, "video: same model and token cap as n8n");
ok(c0.messages[0].content.startsWith("FIXTURE CLIENT PROMPT\n\nTranscript:\n<transcript>\nWHISPER TRANSCRIPT\n</transcript>") && c0.messages[0].content.endsWith("<pasted_notes>\nPASTED NOTES\n</pasted_notes>") && c0.system.includes("data, not instructions"), "video: the table's client prompt, the Whisper transcript, then the pasted notes");
ok(c0.system.includes("# Writing rules (always apply)") && c0.system.includes("FIXTURE CAPTION STYLE") && !c0.system.includes("Warm."), "video: writing rules plus only the Caption style section");
ok(state.claude.length === 2 && /Remove these/.test((state.claude[1] as { messages: Array<{ content: string }> }).messages[2].content), "video: one revision asked for the tells in the first draft");
let row = state.jobs.get("job_video")!;
ok(row.status === "done" && row.caption === "We slow down and rest. #rest #calm #slow", "video: the row is done with the revised caption");
ok(state.saves.length === 1 && JSON.stringify(state.saves[0].body) === JSON.stringify({ client: "fixtureclient", post: { id: "p1", caption: row.caption } }), "video: calendar-upsert got the n8n body");
ok(state.saves[0].key === SMM_KEY && state.saves[0].source === "caption-generate", "video: the save carries the caller's staff key and names its source");

// 2. No video, transcript only: no Frame.io, no Replicate.
reset();
r = await call({ client: "fixtureclient", postId: "p2", jobId: "job_tx", transcript: "WHAT WAS SAID" });
ok(r.status === 200 && r.json.accepted, "transcript: accepted");
ok(!state.calls.some((c) => /frame\.io|f\.io|replicate/.test(c)), "transcript: Frame.io and Replicate are never called");
ok(state.stages.join(",") === "job_tx:writing,job_tx:done", "transcript: starts at writing: " + state.stages.join(","));
ok((state.claude[0] as { messages: Array<{ content: string }> }).messages[0].content.endsWith("<pasted_transcript>\nWHAT WAS SAID\n</pasted_transcript>"), "transcript: the pasted text is the transcript");
ok(state.jobs.get("job_tx")!.status === "done", "transcript: done");

// 3. No client prompt saved: the n8n default prompt.
reset(); state.prompt = null as unknown as string;
r = await call({ client: "fixtureclient", postId: "p3", jobId: "job_default", transcript: "SAID" });
ok((state.claude[0] as { messages: Array<{ content: string }> }).messages[0].content.startsWith("Caption Writer\nGenerate an Instagram Reels caption"), "no prompt saved: the default prompt");
state.prompt = "FIXTURE CLIENT PROMPT";

// 4. Cancel pressed during transcription: Replicate is stopped, Claude never runs, nothing is saved.
reset(); state.replicatePollsBeforeDone = 99; state.cancelOnPoll = 2;
r = await call({ client: "fixtureclient", postId: "p4", assetUrl: "https://f.io/abc", jobId: "job_cancel" });
row = state.jobs.get("job_cancel")!;
ok(row.status === "cancelled" && state.claude.length === 0 && state.saves.length === 0 && state.replicateCancelled === 1, "cancel: cancelled, Replicate stopped, no caption written or saved");

// 5. The save is refused: the caption is kept on the row with the n8n message.
reset(); state.saveOk = false;
r = await call({ client: "fixtureclient", postId: "p5", jobId: "job_savefail", transcript: "SAID" });
row = state.jobs.get("job_savefail")!;
ok(row.status === "error" && /could not be saved/.test(String(row.error)) && row.caption === "We slow down and rest. #rest #calm #slow", "save refused: error, caption kept for the page to save");

// 6. Refusals before anything runs.
reset();
ok((await call({ client: "fixtureclient", postId: "p6", transcript: "x" }, {})).status === 401, "no staff key: 401");
ok((await call({ client: "fixtureclient", postId: "p6", transcript: "x" }, { "x-syncview-key": SMM_KEY, "x-syncview-client-token": "t" })).status === 403, "client review link: 403");
ok((await call({ client: "fixtureclient", postId: "p6" })).status === 400, "no video and no transcript: 400");
// A re-post of a job id that already exists is refused and leaves the row alone (a cancel stays a cancel).
const before = JSON.stringify(state.jobs.get("job_cancel"));
r = await call({ client: "fixtureclient", postId: "p4", assetUrl: "https://f.io/abc", jobId: "job_cancel" });
ok(r.status === 409 && /already started/.test(r.json.error) && JSON.stringify(state.jobs.get("job_cancel")) === before, "an existing job id: 409, the row (and its cancel) untouched");
state.jobs.set("job_other", { job_id: "job_other", client: "fixtureclient", post_id: "p7", status: "running", updated_at: new Date().toISOString() });
r = await call({ client: "fixtureclient", postId: "p7", jobId: "job_dup", transcript: "x" });
ok(r.status === 409 && !state.jobs.has("job_dup"), "a card already generating: 409, nothing written");
Deno.env.delete("REPLICATE_API_TOKEN");
ok((await call({ client: "fixtureclient", postId: "p8", assetUrl: "https://f.io/abc" })).status === 503, "video without the Replicate secret: 503 with a message");
ok((await call({ client: "fixtureclient", postId: "p9", jobId: "job_tx2", transcript: "x" })).json.accepted, "a transcript still works without the Replicate secret");
Deno.env.delete("ANTHROPIC_API_KEY");
ok((await call({ client: "fixtureclient", postId: "p10", transcript: "x" })).status === 503, "without the AI key: 503 with a message");

console.log(`caption-generate function run: ${checks} checks passed`);
console.log("CAPTION_GENERATE_FUNCTION_RUN_OK");
