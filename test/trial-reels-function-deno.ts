// The real trial-reels Edge Function (supabase/functions/trial-reels/index.ts), run under Deno against an in-memory
// stand-in for the database's REST API. Fully offline: fictional client, cards and links, fake role keys.
//   deno run --allow-env --allow-net=127.0.0.1 --allow-read --node-modules-dir=auto test/trial-reels-function-deno.ts
// It walks a card through the whole flow and checks the refusals that keep the card's one link and status safe.

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  syncview_runtime_flags: [{ key: "trial_reels_pages", value: { clients: ["fixtureclient"] } }],
  calendar_posts: [
    { id: "p1", client: "fixtureclient", video_status: "Client Approval", asset_url: "https://f.io/fixture-a", video_deliverable_id: "11111111-1111-4111-8111-111111111111" },
    { id: "p2", client: "fixtureclient", video_status: "In Progress", asset_url: "", video_deliverable_id: null },
    { id: "p9", client: "otherclient", video_status: "In Progress", asset_url: "", video_deliverable_id: null },
  ],
  deliverables: [{ id: "11111111-1111-4111-8111-111111111111", file_url: "https://f.io/fixture-a" }],
  studio_trial_versions: ["A", "B", "C", "D", "E"].map((l, i) => ({
    id: "v" + l, client: "fixtureclient", batch: "Fixture batch", video: "7", letter: l, hook: "Fictional hook " + l, status: "waiting",
    post_id: "p1", frame_url: l === "E" ? null : "https://f.io/fixture-" + l.toLowerCase(), revision: 0,
    smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, change_by: null, change_note: null, change_at: null,
    posted_at: null, trial_ends_at: null, updated_at: "2026-10-27T09:00:0" + i + ".000Z",
  })),
  trial_reel_cards: [],
  calendar_post_events: [],
  client_access: [{ slug: "fixtureclient", review_token: "fixture-review-token" }],
  clients: [{ slug: "fixtureclient", active: true }],
};

// ILIKE as Postgres reads it: `%` (PostgREST also takes `*`) is any run, `_` is any one character, `\` escapes.
function ilike(val: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%" || c === "*") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$", "is").test(val);
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const val = String(row[k] ?? "");
    if (v.startsWith("eq.") && val !== v.slice(3)) return false;
    if (v.startsWith("ilike.") && !ilike(val, v.slice(6))) return false;
  }
  return true;
}

const moved = { id: "" };
const realServe = Deno.serve.bind(Deno);
const db = realServe({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
  const u = new URL(req.url);
  const t = u.pathname.replace(/^\/rest\/v1\//, "");
  const rows = tables[t];
  if (!rows) return new Response(JSON.stringify({ message: "no table " + t }), { status: 404 });
  const single = (req.headers.get("accept") || "").includes("vnd.pgrst.object");
  const out = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (req.method === "GET") {
    const hit = rows.filter((r) => matches(r, u.searchParams));
    return single ? (hit.length ? out(hit[0]) : out({ message: "none" }, 406)) : out(hit);
  }
  if (req.method === "POST") {
    const body = await req.json();
    for (const r of Array.isArray(body) ? body : [body]) rows.push({ ...r });
    return out(Array.isArray(body) ? body : [body], 201);
  }
  if (req.method === "PATCH") {
    const body = await req.json();
    // A row the studio touches between our read and our write (set by a check below).
    const id = (u.searchParams.get("id") || "").replace(/^eq\./, "");
    if (moved.id && id === moved.id) { const row = rows.find((r) => r.id === id); if (row) row.updated_at = "2026-10-27T23:59:59.000Z"; moved.id = ""; }
    const hit = rows.filter((r) => matches(r, u.searchParams));
    for (const r of hit) Object.assign(r, body);
    return out(hit);
  }
  return out({ message: "method" }, 405);
});

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:" + db.addr.port);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
Deno.env.set("ROLE_KEY_SMM", "fixture-smm-key");
Deno.env.set("ROLE_KEY_ADMIN", "fixture-admin-key");
Deno.env.set("ROLE_KEY_CREATIVE", "fixture-creative-key");

type Handler = (req: Request) => Promise<Response>;
const registered: { h: Handler | null } = { h: null };
(Deno as unknown as { serve: unknown }).serve = (h: Handler) => { registered.h = h; return { finished: Promise.resolve() }; };
await import("../supabase/functions/trial-reels/index.ts");
(Deno as unknown as { serve: unknown }).serve = realServe;
if (!registered.h) throw new Error("trial-reels did not register a handler");
const handler: Handler = registered.h;

let passed = 0;
const failures: string[] = [];
function ok(c: unknown, m: string) { if (!c) { failures.push(m); console.error("FAIL  " + m); } else { passed++; console.log("  ok  " + m); } }
async function call(body: Row, who: "smm" | "admin" | "creative" | "client-token" | "client-none" = "smm") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (who === "smm") headers["x-syncview-key"] = "fixture-smm-key";
  if (who === "admin") headers["x-syncview-key"] = "fixture-admin-key";
  if (who === "creative") headers["x-syncview-key"] = "fixture-creative-key";
  if (who === "client-token") headers["x-syncview-client-token"] = "fixture-review-token";
  const res = await handler(new Request("http://fn/trial-reels", { method: "POST", headers, body: JSON.stringify({ client: "fixtureclient", post_id: "p1", ...body }) }));
  return { status: res.status, body: await res.json() as Row };
}
const v = (l: string) => tables.studio_trial_versions.find((r) => r.letter === l)!;

// Each step is checked right after it runs (the rows are shared and later steps change them).
async function step(body: Row, who: "smm" | "admin" | "creative" | "client-token" | "client-none" = "smm") {
  const q = console.log; console.log = () => {};
  try { return await call(body, who); } finally { console.log = q; }
}
const off = await step({ action: "read" });
ok(off.status === 409 && off.body.error === "trial_reels_off", "a card whose switch is off answers trial_reels_off");
const on = await step({ action: "switch_set", enabled: true });
ok(on.body.ok === true && tables.trial_reel_cards.length === 1, "switch_set turns the card's switch on");
const listed = await step({ action: "list", post_id: "" });
ok(listed.body.ok === true && Object.keys(listed.body.cards as Row).join() === "p1" && ((listed.body.cards as Row).p1 as Row).main_letter === "A", "list: every card of the client whose switch is on, in one answer");
const readStaff = await step({ action: "read" });
ok(readStaff.body.ok === true && (readStaff.body.versions as Row[]).length === 5 && readStaff.body.main_letter === "A", "staff read: five versions, Video A on the card");
{
  const q = console.log; console.log = () => {};
  const r = await handler(new Request("http://fn", { method: "POST", headers: { "content-type": "application/json", "x-syncview-key": "fixture-smm-key" }, body: JSON.stringify({ action: "read", client: "otherclient", post_id: "p9" }) }));
  console.log = q;
  const b = await r.json() as Row;
  ok(r.status === 403 && b.error === "not_enabled", "a client the switch does not list is refused");
}
const clientWrite = await step({ action: "version_drop", letter: "D" }, "client-none");
ok(clientWrite.status === 401 || (clientWrite.status === 403 && clientWrite.body.error === "staff_only"), "a client link with no token cannot drop a version (" + clientWrite.status + " " + clientWrite.body.error + ")");
const clientTokenWrite = await step({ action: "version_drop", letter: "D" }, "client-token");
ok(clientTokenWrite.status === 403 && clientTokenWrite.body.error === "staff_only", "a client link with its token cannot drop a version either");
const clientRead = await step({ action: "read" }, "client-none");
ok(clientRead.body.ok === true && !(clientRead.body.versions as Row[]).some((x) => "hook" in x), "a client link with no token can read (owner, Q5), without hooks");
const drop = await step({ action: "version_drop", letter: "D" });
ok(drop.body.ok === true && v("D").status === "dropped", "the team drops Video D");
const dropMain = await step({ action: "version_drop", letter: "A" });
ok(dropMain.status === 400 && dropMain.body.error === "main_version", "the version on the card cannot be dropped");
const eLink = await step({ action: "version_link_set", letter: "E", link: "https://f.io/fixture-e" });
ok(eLink.body.ok === true && v("E").frame_url === "https://f.io/fixture-e", "Video E's link is pasted");
const kasperEarly = await step({ action: "answer", stage: "kasper", kind: "approve", letter: "B" }, "admin");
ok(kasperEarly.status === 400 && kasperEarly.body.error === "stage_order", "Kasper cannot answer a version before the SMM has (the server holds the order)");
const smmAll = await step({ action: "answer", stage: "smm", kind: "approve_all" });
ok(smmAll.body.ok === true && ["A", "B", "C", "E"].every((l) => v(l).smm_ok_at) && !v("D").smm_ok_at, "SMM Approve all stamps every live version");
ok((smmAll.body.stages_done as Row).smm === true, "the SMM's stage reports done, so the page can call today's Approve to Kasper");
const kasperAll = await step({ action: "answer", stage: "kasper", kind: "approve_all" }, "admin");
ok((kasperAll.body.stages_done as Row).kasper === true, "Kasper's stage reports done");
const clientB = await step({ action: "answer", kind: "approve", letter: "B" }, "client-token");
ok(clientB.body.ok === true && v("B").status === "approved", "the client (with its token) approves Video B");
const clientC = await step({ action: "answer", kind: "change", letter: "C", note: "Bigger opening text" }, "client-none");
ok(clientC.body.ok === true && v("C").status === "change asked" && v("C").change_by === "client", "the client (no token) asks a change on Video C (" + clientC.status + " " + clientC.body.error + ")");
const aNoAttach = await step({ action: "version_link_set", letter: "A", link: "https://f.io/fixture-a2" });
ok(aNoAttach.status === 409 && aNoAttach.body.error === "attach_first" && v("A").frame_url === "https://f.io/fixture-a", "Video A's link is refused until today's attach has put it on the card (one link, never two)");
const cNew = await step({ action: "version_link_set", letter: "C", link: "https://f.io/fixture-c2" });
ok(cNew.body.restarted === true && v("C").status === "waiting" && v("C").revision === 1 && !v("C").kasper_ok_at, "a new cut of Video C starts it again through the SMM and Kasper (owner, Q3)");
const events = tables.calendar_post_events.map((e) => String(e.action));
ok(events.includes("trial_on") && events.includes("trial_change") && !events.some((a) => a.startsWith("approve_")), "the card's history gets trial_ rows, never approve_ rows");
ok(tables.calendar_posts[0].video_status === "Client Approval" && tables.deliverables[0].file_url === "https://f.io/fixture-a", "the card's status and its one link were never written");

// The rest of the route: approvals, the trial, the winner.
await step({ action: "answer", stage: "smm", kind: "approve", letter: "C" });
await step({ action: "answer", stage: "kasper", kind: "approve", letter: "C" }, "admin");
const all = await step({ action: "answer", kind: "approve_all" }, "client-none");
ok(all.body.card_approvable === true && !("card_behind" in all.body), "the client's last answer tells its page the card can move to Approved (today's approve save)");
const staffAfter = await step({ action: "read" });
ok(staffAfter.body.card_behind === true, "until that save lands, staff see card_behind and the page offers it again");
const trial = await step({ action: "trial_start" });
ok(trial.body.ok === true && ["A", "B", "C", "E"].every((l) => v(l).status === "on trial" && v(l).trial_ends_at), "on trial with the 24 h timer");
const tooSoon = await step({ action: "winner_set", letter: "C" });
ok(tooSoon.status === 400 && tooSoon.body.error === "trial_not_over", "no winner before the 24 h are up");
for (const r of tables.studio_trial_versions) if (r.status === "on trial") r.trial_ends_at = new Date(Date.now() - 60000).toISOString();   // the 24 h pass
const winEarly = await step({ action: "winner_set", letter: "C" });
ok(winEarly.status === 409 && winEarly.body.error === "attach_first", "the winner is refused until the card's link is the winner's");
tables.deliverables[0].file_url = "https://f.io/fixture-c2";   // what today's attach does for the winner
const win = await step({ action: "winner_set", letter: "C" });
ok(win.body.ok === true && v("C").status === "winner" && ["A", "B", "E"].every((l) => v(l).status === "lost") && tables.trial_reel_cards[0].winner_letter === "C", "Video C wins, the others are lost");
const undoEarly = await step({ action: "winner_undo" });
ok(undoEarly.status === 409 && undoEarly.body.error === "attach_first" && v("C").status === "winner", "Undo is refused until the card's link is back on Video A's");
tables.deliverables[0].file_url = "https://f.io/fixture-a";   // what today's attach does when the page puts A back
const undo = await step({ action: "winner_undo" });
ok(undo.body.ok === true && ["A", "B", "C", "E"].every((l) => v(l).status === "on trial") && tables.trial_reel_cards[0].winner_letter === null, "Undo: every version back on trial, no winner");
tables.deliverables[0].file_url = "https://f.io/fixture-c2";
await step({ action: "winner_set", letter: "C" });
const clientAfter = await step({ action: "read" }, "client-none");
ok((clientAfter.body.versions as Row[]).length === 1 && (clientAfter.body.versions as Row[])[0].letter === "C", "the client link now sees only the winner (owner, Q8)");

// The versions read is exact, case aside: the studio may store the slug in any case, and a longer slug that starts
// with this one is another client. (ILIKE with the slug's `_` and `%` escaped; the slug normalizer drops both today.)
tables.studio_trial_versions.push(
  { ...v("A"), id: "stray", client: "fixtureclientx", post_id: "p2" },
  { ...v("A"), id: "mine", client: "FIXTURECLIENT", post_id: "p2" },
);
await step({ action: "switch_set", enabled: true, post_id: "p2" });
const exact = await step({ action: "read", post_id: "p2" });
const exactIds = ((exact.body.versions || []) as Row[]).map((r) => r.id);
ok(exact.body.ok === true && exactIds.length === 1 && exactIds[0] === "mine", "the versions read matches this client exactly (case aside), never a longer slug");

// Probe, batch 1: the rules the server holds by itself.
{
  const q = console.log; console.log = () => {};
  const r = await handler(new Request("http://fn", { method: "POST", headers: { "content-type": "application/json" }, body: "null" }));
  console.log = q;
  ok(r.status === 400 && ((await r.json()) as Row).error === "invalid body", "a body of null is refused cleanly, not a crash");
}
const creativeDrop = await step({ action: "version_drop", letter: "B" }, "creative");
ok(creativeDrop.status === 403 && creativeDrop.body.error === "role_not_allowed", "an editor's key cannot drop a version, pick or start the trial");
// All or nothing: a row the studio touched mid-write puts back the rows already written.
tables.calendar_posts.push({ id: "p3", client: "fixtureclient", video_status: "For SMM Approval", asset_url: "https://f.io/p3-a", video_deliverable_id: null });
for (const l of ["A", "B", "C"]) tables.studio_trial_versions.push({ ...v("A"), id: "p3" + l, letter: l, post_id: "p3", status: "waiting", frame_url: "https://f.io/p3-" + l.toLowerCase(), smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, change_by: null, change_note: null, change_at: null, trial_ends_at: null, updated_at: "2026-10-27T09:00:00.000Z" });
await step({ action: "switch_set", enabled: true, post_id: "p3" });
moved.id = "p3C";
const half = await step({ action: "answer", stage: "smm", kind: "approve_all", post_id: "p3" });
const p3 = (l: string) => tables.studio_trial_versions.find((r) => r.id === "p3" + l)!;
ok(half.status === 409 && half.body.error === "conflict" && !p3("A").smm_ok_at && !p3("B").smm_ok_at && p3("A").updated_at === "2026-10-27T09:00:00.000Z",
  "a row moved mid-write: the rows already written are put back, and the request answers conflict");

console.log(`trial-reels-function-deno: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ""));
await db.shutdown();
if (failures.length) Deno.exit(1);
