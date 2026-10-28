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
    // studio_trial_versions.deliverable_id is a uuid column: Postgres refuses anything else (22P02), as live does.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (t === "studio_trial_versions" && (Array.isArray(body) ? body : [body]).some((r: Row) => r.deliverable_id != null && !uuid.test(String(r.deliverable_id)))) {
      return out({ code: "22P02", message: "invalid input syntax for type uuid" }, 400);
    }
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
ok(dropMain.status === 409 && dropMain.body.error === "attach_first" && v("A").status !== "dropped", "the version on the card is dropped only after today's attach moved the card to the next live version");
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

// Production's rows: each version link's sharing state (staff only), from the providers' own answers. No real network:
// every address that is not the stand-in database is answered here.
const realFetch = globalThis.fetch;
const probed: string[] = [];
globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "127.0.0.1") return realFetch(input, init);
  probed.push(url.toString());
  const html = (body: string, status = 200) => Promise.resolve(new Response(body, { status, headers: { "content-type": "text/html" } }));
  if (url.pathname === "/fixture-a") return html("<html>Frame.io review</html>");
  if (url.pathname === "/fixture-probe-denied") return html("", 403);
  if (url.pathname === "/fixture-probe-private") return Promise.resolve(new Response(null, { status: 302, headers: { location: "https://accounts.frame.io/login" } }));
  return Promise.reject(new Error("unexpected address in the test: " + url));
}) as typeof fetch;
tables.studio_trial_versions.push(
  { ...v("A"), id: "p2b", letter: "B", client: "fixtureclient", post_id: "p2", frame_url: "https://f.io/fixture-probe-denied" },
  { ...v("A"), id: "p2c", letter: "C", client: "fixtureclient", post_id: "p2", frame_url: "https://f.io/fixture-probe-private" },
  { ...v("A"), id: "p2d", letter: "D", client: "fixtureclient", post_id: "p2", frame_url: "https://example.com/fixture" },
  { ...v("A"), id: "p2e", letter: "E", client: "fixtureclient", post_id: "p2", frame_url: null },
);
tables.studio_trial_versions.find((r) => r.id === "mine")!.frame_url = "https://f.io/fixture-a";
const probe = await step({ action: "read", post_id: "p2", probe: true });
const ls = (probe.body.link_states || {}) as Record<string, Row>;
ok(ls.A?.state === "available" && ls.A?.http_status === 200 && ls.B?.state === "permission_denied" && ls.E?.state === "missing",
  "each version's link answers Production's own words: available, permission denied, missing");
ok(ls.C?.state === "unavailable" && !("http_status" in ls.C) && ls.D?.state === "invalid" && !probed.some((u) => /accounts\.frame\.io|example\.com/.test(u)),
  "a private Frame.io project's sign-in redirect is never followed (no status, so the page says Not checked), and a link off the providers is never opened");
const before = probed.length;
await step({ action: "read", post_id: "p2", probe: true });
ok(probed.length === before, "a page reopened at once does not ask the providers again");
const noProbe = await step({ action: "read", post_id: "p2" });
const clientProbe = await step({ action: "read", post_id: "p2", probe: true }, "client-none");
ok(!("link_states" in noProbe.body) && !("link_states" in clientProbe.body) && !("video_deliverable_id" in clientProbe.body), "only a staff read that asks gets the states; a client link never does");
globalThis.fetch = realFetch;

// A new Deliverable file saved through Production's own row is copied to the version on the card by the next staff read.
const winnerRow = () => tables.studio_trial_versions.find((r) => r.post_id === "p1" && r.letter === "C")!;
tables.deliverables[0].file_url = "https://f.io/fixture-c3";
const healRead = await step({ action: "read" });
ok(healRead.body.video_deliverable_id === "11111111-1111-4111-8111-111111111111" && winnerRow().frame_url === "https://f.io/fixture-c3"
  && tables.calendar_post_events.some((e) => e.action === "trial_version_link_set" && (e.payload as Row)?.letter === "C"),
  "Production's new file lands on the winner's own link, with a ledger row, and the read names the card's video sub-issue");
tables.deliverables[0].file_url = "https://f.io/fixture-c4";
await step({ action: "read" }, "client-none");
ok(winnerRow().frame_url === "https://f.io/fixture-c3", "a client read never writes");
tables.deliverables[0].file_url = "https://f.io/fixture-a";
await step({ action: "read" });
ok(winnerRow().frame_url === "https://f.io/fixture-c3", "nothing is copied while the card's link is another version's (mid winner pick or Undo)");
// Probe, batch 1: the rules the server holds by itself.
{
  const q = console.log; console.log = () => {};
  const r = await handler(new Request("http://fn", { method: "POST", headers: { "content-type": "application/json" }, body: "null" }));
  console.log = q;
  ok(r.status === 400 && ((await r.json()) as Row).error === "invalid body", "a body of null is refused cleanly, not a crash");
}
// Default (b): an editor says the new cut of a version asked to change is ready (same Frame.io link).
const eRev = Number(v("E").revision) || 0;
Object.assign(v("E"), { status: "change asked", smm_ok_at: "2026-10-27T08:00:00.000Z", kasper_ok_at: "2026-10-27T08:00:00.000Z", change_note: "Fixture note", change_by: "kasper" });
const newCut = await step({ action: "version_new_cut", letter: "E" }, "creative");
ok(newCut.body.ok === true && v("E").status === "waiting" && v("E").revision === eRev + 1 && !v("E").smm_ok_at && !v("E").kasper_ok_at && !v("E").change_note,
  "an editor's New cut ready puts Video E back to waiting, every OK cleared, for the SMM and Kasper again (" + newCut.status + " " + newCut.body.error + ")");
const newCutAgain = await step({ action: "version_new_cut", letter: "E" }, "creative");
ok(newCutAgain.status === 400 && newCutAgain.body.error === "version_not_change_asked", "New cut ready only on a version with a change asked");
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

// The winner is SyncView's alone (owner, 2026-10-27): a "winner" the studio writes on a row is never read.
Object.assign(p3("B"), { status: "winner" }); Object.assign(p3("C"), { status: "lost" });
const studioOnly = await step({ action: "read", post_id: "p3" }, "client-none");
const soRows = (studioOnly.body.versions || []) as Row[];
ok(studioOnly.body.ok === true && soRows.length === 3 && !soRows.some((r) => r.status === "winner"), "a studio-written winner with no winner letter on the card: the client still sees every version, none a winner");
const soUndo = await step({ action: "winner_undo", post_id: "p3" });
ok(soUndo.status === 400 && soUndo.body.error === "no_winner", "and there is no winner to undo");
Object.assign(v("A"), { status: "winner" });
const cardWins = await step({ action: "read" }, "client-none");
const cwRows = (cardWins.body.versions || []) as Row[];
ok(cwRows.length === 1 && cwRows[0].letter === "C" && cardWins.body.main_letter === "C", "the studio writing winner on Video A changes nothing: the card's letter (C) is the winner");
const staffWins = await step({ action: "read" });
ok(((staffWins.body.versions || []) as Row[]).find((r) => r.letter === "A")?.status === "lost", "staff see Video A as lost, as the card says");

// A card the AI editor has not logged (found live, 2026-10-27): SyncView adds its versions itself.
tables.calendar_posts.push({ id: "p4", client: "fixtureclient", video_status: "For SMM Approval", asset_url: "https://f.io/p4-main", video_deliverable_id: null });
tables.calendar_posts.push({ id: "p5", client: "fixtureclient", video_status: "For SMM Approval", asset_url: "", video_deliverable_id: null });
const p4 = () => tables.studio_trial_versions.filter((r) => r.post_id === "p4");
await step({ action: "switch_set", enabled: true, post_id: "p4" });
ok(p4().length === 1 && p4()[0].letter === "A" && p4()[0].frame_url === "https://f.io/p4-main" && p4()[0].batch === "p4" && p4()[0].video === "card",
  "a card switched on with no version starts with Video A, the link it already carries");
const addB = await step({ action: "version_add", post_id: "p4", link: "https://f.io/p4-b" }, "creative");
ok(addB.body.ok === true && p4().some((r) => r.letter === "B" && r.frame_url === "https://f.io/p4-b" && r.status === "waiting")
  && ((addB.body.versions || []) as Row[]).length === 2, "version_add adds Video B with its link (an editor's key may), and answers the two versions");
const addDup = await step({ action: "version_add", post_id: "p4", link: "https://f.io/p4-b" });
ok(addDup.status === 400 && addDup.body.error === "link_used_by_another_version", "a link another version already has is refused");
const addClient = await step({ action: "version_add", post_id: "p4", link: "https://f.io/p4-c" }, "client-token");
ok(addClient.status === 403 && p4().length === 2, "a client link cannot add a version");
await step({ action: "switch_set", enabled: true, post_id: "p5" });
const addFirst = await step({ action: "version_add", post_id: "p5", link: "https://f.io/p5-a" });
ok(addFirst.status === 409 && addFirst.body.error === "attach_first" && !tables.studio_trial_versions.some((r) => r.post_id === "p5"),
  "with no link on the card, the first version waits until the card carries its link (the page saves it first)");
tables.calendar_posts.find((r) => r.id === "p5")!.asset_url = "https://f.io/p5-a";
const addFirst2 = await step({ action: "version_add", post_id: "p5", link: "https://f.io/p5-a" });
ok(addFirst2.body.ok === true && (addFirst2.body.changed as string[])[0] === "A", "then Video A is added");

// The studio logs this card after SyncView seeded its Video A: still one Video A (Codex on PR 2373).
tables.studio_trial_versions.push({ ...p4()[0], id: "studio-p4-a", batch: "Fixture batch", video: "9", frame_url: "https://f.io/p4-studio-a", created_at: "2099-01-01T00:00:00.000Z" });
const afterStudio = await step({ action: "read", post_id: "p4" });
const asRows = (afterStudio.body.versions || []) as Row[];
ok(asRows.filter((r) => r.letter === "A").length === 1 && asRows.find((r) => r.letter === "A")!.id !== "studio-p4-a", "a later studio row for the same letter is not a second Video A");

// A card whose video sub-issue is named as live names it, "del_<uuid>" (found live, 2026-10-27: every add answered
// write_failed, because studio_trial_versions.deliverable_id is a uuid column).
tables.calendar_posts.push({ id: "p6", client: "fixtureclient", video_status: "For SMM Approval", asset_url: "https://f.io/p6-main", video_deliverable_id: "del_66666666-6666-4666-8666-666666666666" });
tables.deliverables.push({ id: "del_66666666-6666-4666-8666-666666666666", file_url: "https://f.io/p6-main" });
const p6 = () => tables.studio_trial_versions.filter((r) => r.post_id === "p6");
await step({ action: "switch_set", enabled: true, post_id: "p6" });
ok(p6().length === 1 && p6()[0].letter === "A" && p6()[0].deliverable_id === "66666666-6666-4666-8666-666666666666", "a card with a del_ sub-issue starts with Video A, its sub-issue stored as the uuid");
const addP6 = await step({ action: "version_add", post_id: "p6", link: "https://f.io/p6-b" });
ok(addP6.body.ok === true && p6().length === 2, "and version_add adds Video B there (" + addP6.status + " " + addP6.body.error + ")");

// Sent for approval today's way, before any version went through the SMM (Sidney, 2026-10-27): the card is at Client
// Approval, so the client link answers each version, and a staff read says each one is ready for the client.
tables.calendar_posts.push({ id: "p7", client: "fixtureclient", video_status: "Kasper Approval", asset_url: "https://f.io/p7-main", video_deliverable_id: null });
const p7 = () => tables.studio_trial_versions.filter((r) => r.post_id === "p7");
await step({ action: "switch_set", enabled: true, post_id: "p7" });
await step({ action: "version_add", post_id: "p7", link: "https://f.io/p7-b" });
const p7Early = await step({ action: "answer", post_id: "p7", kind: "approve", letter: "B" }, "client-none");
ok(p7Early.status === 400 && p7Early.body.error === "stage_order", "a card still at Kasper Approval: the client waits for its turn");
const p7Kasper = await step({ action: "answer", post_id: "p7", stage: "kasper", kind: "approve", letter: "B" }, "admin");
ok(p7Kasper.body.ok === true && !!p7().find((r) => r.letter === "B")!.kasper_ok_at, "sent to Kasper with no version through the SMM: Kasper answers Video B");
tables.calendar_posts.find((r) => r.id === "p7")!.video_status = "Client Approval";
const p7Read = await step({ action: "read", post_id: "p7" }, "client-none");
ok(((p7Read.body.versions || []) as Row[]).length === 2 && ((p7Read.body.versions || []) as Row[]).every((r) => r.ready === true), "sent on to the client: a client read says both versions are ready");
const p7Client = await step({ action: "answer", post_id: "p7", kind: "approve_all" }, "client-none");
ok(p7Client.body.ok === true && p7().every((r) => r.status === "approved"), "and the client's Approve all approves them (" + p7Client.status + " " + p7Client.body.error + ")");

console.log(`trial-reels-function-deno: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ""));
await db.shutdown();
if (failures.length) Deno.exit(1);
