// The real pto Edge Function (supabase/functions/pto/index.ts), run under Deno
// against an in-memory stand-in for the database's REST API, for the admin
// "Log time off" actions `log` and `log_quote` (OPEN_REPAIRS 627).
// Fully offline: invented members, fake role keys, no live backend.
//   deno run --allow-env --allow-net=127.0.0.1 --allow-read --node-modules-dir=auto test/pto-admin-log-deno.ts
//
// The stand-in plays the three database functions the way the migrations
// define them (pto_create_request_v1, pto_decision_snapshot_v1,
// pto_finalize_decision_v1): row locks become plain checks, every write to a
// member's requests advances their state_version (the trigger), and the
// source check can be switched back to its pre-2026-11-01 shape.
import { countPtoDays, ptoPolicyToday } from "../supabase/functions/pto/policy.js";

type Row = Record<string, unknown>;
const ADMIN = { id: "00000000-0000-4000-8000-0000000000a1", name: "Fixture Admin", role: "admin", team: null, active: true };
const MEMBER = { id: "00000000-0000-4000-8000-0000000000b2", name: "Fixture Editor", role: "editor", team: "video", active: true };
const OTHER = { id: "00000000-0000-4000-8000-0000000000c3", name: "Fixture Designer", role: "designer", team: "graphics", active: true };
const OFF = { id: "00000000-0000-4000-8000-0000000000d4", name: "Fixture Switched Off", role: "editor", team: "video", active: true };

const tables: Record<string, Row[]> = {
  syncview_runtime_flags: [{ key: "pto_v1", value: { mode: "on" } }],
  team_members: [ADMIN, MEMBER, OTHER, OFF].map((m) => ({ ...m })),
  pto_members: [ADMIN, MEMBER, OTHER, OFF].map((m) => ({
    member_id: m.id, pto_start_date: "2024-01-02", pto_enabled: m.id !== OFF.id, state_version: 0, updated_at: "2026-01-01T00:00:00Z",
  })),
  pto_requests: [],
  pto_adjustments: [],
};
const sim = { oldSourceCheck: false, finalizeAnswer: "" };
let seq = 0;
const newId = () => "00000000-0000-4000-8000-" + String(++seq).padStart(12, "0");
const bump = (memberId: unknown) => {
  const m = tables.pto_members.find((r) => r.member_id === memberId);
  if (m) m.state_version = Number(m.state_version) + 1;
};

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "columns"].includes(k)) continue;
    const val = String(row[k] ?? "");
    if (v.startsWith("eq.") && val !== v.slice(3)) return false;
    if (v.startsWith("gt.") && !(val > v.slice(3))) return false;
  }
  return true;
}

function rpc(name: string, a: Row): { status: number; body: unknown } {
  const ptoMember = (id: unknown) => tables.pto_members.find((r) => r.member_id === id);
  if (name === "pto_create_request_v1") {
    const tm = tables.team_members.find((r) => r.id === a.p_member_id && r.active === true);
    const pm = ptoMember(a.p_member_id);
    if (!tm || !pm) return { status: 200, body: { status: "member_not_found" } };
    if (!pm.pto_enabled) return { status: 200, body: { status: "not_enabled" } };
    if (Number(pm.state_version) !== Number(a.p_expected_state_version)) return { status: 200, body: { status: "stale" } };
    const allowed = sim.oldSourceCheck ? ["syncview", "hrvey_migration"] : ["syncview", "hrvey_migration", "admin_log"];
    if (!allowed.includes(String(a.p_source))) {
      return { status: 400, body: { code: "23514", message: 'new row for relation "pto_requests" violates check constraint "pto_requests_source_check"' } };
    }
    const row: Row = {
      id: newId(), member_id: a.p_member_id, type: a.p_type, start_date: a.p_start_date, end_date: a.p_end_date,
      days: a.p_days, note: a.p_note || "", status: "pending", decided_by: null, decision_note: "", source: a.p_source,
      requested_at: new Date(Date.now() + seq).toISOString(), decided_at: null, cancelled_by: null, cancelled_at: null,
    };
    tables.pto_requests.push(row);
    bump(a.p_member_id);
    return { status: 200, body: { status: "ok", request: { ...row } } };
  }
  if (name === "pto_decision_snapshot_v1") {
    const req = tables.pto_requests.find((r) => r.id === a.p_request_id);
    if (!req) return { status: 200, body: { status: "not_found" } };
    const pm = ptoMember(req.member_id);
    if (!pm) return { status: 200, body: { status: "member_not_found" } };
    return {
      status: 200,
      body: {
        status: "ok", request: { ...req }, member: { ...pm }, state_version: pm.state_version,
        requests: tables.pto_requests.filter((r) => r.member_id === req.member_id).map((r) => ({ ...r })),
        adjustments: tables.pto_adjustments.filter((r) => r.member_id === req.member_id).map((r) => ({ ...r })),
      },
    };
  }
  if (name === "pto_finalize_decision_v1") {
    if (sim.finalizeAnswer) return { status: 200, body: { status: sim.finalizeAnswer } };
    const req = tables.pto_requests.find((r) => r.id === a.p_request_id);
    if (!req) return { status: 200, body: { status: "not_found" } };
    const pm = ptoMember(req.member_id);
    if (!pm) return { status: 200, body: { status: "member_not_found" } };
    if (req.status !== "pending") return { status: 200, body: { status: "request_not_pending" } };
    if (Number(pm.state_version) !== Number(a.p_expected_state_version)) return { status: 200, body: { status: "stale" } };
    Object.assign(req, { status: a.p_decision, decided_by: a.p_actor, decision_note: a.p_decision_note || "", decided_at: new Date().toISOString() });
    bump(req.member_id);
    return { status: 200, body: { status: "ok", request: { ...req } } };
  }
  return { status: 404, body: { code: "PGRST202", message: "no function " + name } };
}

const realServe = Deno.serve.bind(Deno);
const db = realServe({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
  const u = new URL(req.url);
  const t = u.pathname.replace(/^\/rest\/v1\//, "");
  const out = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (t.startsWith("rpc/") && req.method === "POST") {
    const r = rpc(t.slice(4), await req.json());
    return out(r.body, r.status);
  }
  const rows = tables[t];
  if (!rows) return out({ message: "no table " + t }, 404);
  const wantsObject = (req.headers.get("accept") || "").includes("vnd.pgrst.object");
  const answer = (hit: Row[]) => {
    if (!wantsObject) return out(hit);
    return hit.length === 1 ? out(hit[0]) : out({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: "The result contains " + hit.length + " rows" }, 406);
  };
  if (req.method === "GET") {
    let hit = rows.filter((r) => matches(r, u.searchParams)).map((r) => ({ ...r }));
    const order = u.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      hit.sort((x, y) => String(x[col]).localeCompare(String(y[col])) * (dir === "desc" ? -1 : 1));
    }
    const limit = Number(u.searchParams.get("limit") || 0);
    if (limit) hit = hit.slice(0, limit);
    return answer(hit);
  }
  if (req.method === "PATCH") {
    const body = await req.json() as Row;
    const hit = rows.filter((r) => matches(r, u.searchParams));
    for (const r of hit) { Object.assign(r, body); if (t === "pto_requests") bump(r.member_id); }
    return answer(hit.map((r) => ({ ...r })));
  }
  if (req.method === "POST") {
    const body = await req.json();
    const list = (Array.isArray(body) ? body : [body]).map((r: Row) => ({ id: newId(), created_at: new Date().toISOString(), ...r }));
    rows.push(...list);
    return answer(list);
  }
  return out({ message: "method" }, 405);
});

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:" + db.addr.port);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
Deno.env.set("ROLE_KEY_ADMIN", "fixture-admin-key");
Deno.env.set("ROLE_KEY_SMM", "fixture-smm-key");
Deno.env.set("ROLE_KEY_CREATIVE", "fixture-creative-key");

type Handler = (req: Request) => Promise<Response>;
const registered: { h: Handler | null } = { h: null };
(Deno as unknown as { serve: unknown }).serve = (h: Handler) => { registered.h = h; return { finished: Promise.resolve() }; };
await import("../supabase/functions/pto/index.ts");
(Deno as unknown as { serve: unknown }).serve = realServe;
if (!registered.h) throw new Error("pto did not register a handler");
const handler: Handler = registered.h;

let passed = 0;
const failures: string[] = [];
function ok(c: unknown, m: string) { if (!c) { failures.push(m); console.error("FAIL  " + m); } else { passed++; console.log("  ok  " + m); } }

type Who = { key: string; actor: string; id: string };
const asAdmin: Who = { key: "fixture-admin-key", actor: ADMIN.name, id: ADMIN.id };
const asMember: Who = { key: "fixture-creative-key", actor: MEMBER.name, id: MEMBER.id };
const asSmm: Who = { key: "fixture-smm-key", actor: "Nobody", id: "" };
async function call(action: string, body: Row, who: Who) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-syncview-key": who.key, "x-syncview-actor": who.actor };
  const quiet = console.error; console.error = () => {};
  try {
    const res = await handler(new Request("http://fn/pto?action=" + action, { method: "POST", headers, body: JSON.stringify({ action, actor_member_id: who.id || undefined, ...body }) }));
    return { status: res.status, body: await res.json() as Row };
  } finally { console.error = quiet; }
}
async function overviewFor(who: Who) {
  const res = await handler(new Request("http://fn/pto?action=overview&member_id=" + who.id, { method: "GET", headers: { "x-syncview-key": who.key, "x-syncview-actor": who.actor } }));
  return await res.json() as Row;
}
const rowsOf = (memberId: string) => tables.pto_requests.filter((r) => r.member_id === memberId);
const sickLeft = async (who: Who) => Number(((await overviewFor(who)).balance as Row).sick_available);

// Business days of the current leave year (Jan 1 - Dec 31, the policy's), so
// the test needs no frozen clock: an admin may log past days. They start in
// March, after the policy's 2026-02-06 baseline (before it nobody has a balance).
const today = ptoPolicyToday();
const year = today.slice(0, 4);
const days: string[] = [];
for (let d = new Date(year + "-03-02T00:00:00Z"); days.length < 12; d.setUTCDate(d.getUTCDate() + 1)) {
  const iso = d.toISOString().slice(0, 10);
  if (countPtoDays(iso, iso) === 1) days.push(iso);
}
// Three business days in a row (Mon-Wed of a full week), for the range checks.
let run = -1;
for (let i = 0; i + 2 < days.length; i++) {
  if (countPtoDays(days[i], days[i + 2]) === 3 && new Date(days[i] + "T00:00:00Z").getUTCDay() === 1) { run = i; break; }
}
if (run < 0) throw new Error("fixture: no Monday-Wednesday run in the first business days");
const [d1, d2, d3] = [days[run], days[run + 1], days[run + 2]];
const lone = days[(run + 5) % days.length];

// ── Refused before anything is read ──
for (const action of ["log", "log_quote"]) {
  const r = await call(action, { member_id: MEMBER.id, type: "sick", start_date: d1, end_date: d1, days: 1 }, asMember);
  ok(r.status === 403 && r.body.error === "forbidden", `a non-admin (creative key) is refused ${action} with 403`);
  const s = await call(action, { member_id: MEMBER.id, type: "sick", start_date: d1, end_date: d1, days: 1 }, asSmm);
  ok(s.status === 403 && s.body.error === "forbidden", `an SMM key is refused ${action} too`);
}
const forged = await call("log", { member_id: MEMBER.id, type: "sick", start_date: d1, end_date: d1, days: 1 }, { key: "fixture-creative-key", actor: ADMIN.name, id: ADMIN.id });
ok(forged.status === 403, "naming the admin in the headers does not lift a creative key");
ok(tables.pto_requests.length === 0, "nothing was written by any refused call");

// ── Quote ──
const sickBefore = await sickLeft(asMember);
const q = await call("log_quote", { member_id: MEMBER.id, type: "sick", start_date: d1, end_date: d1 }, asAdmin);
ok(q.status === 200 && q.body.full_days === 1 && q.body.partial_day_count === 0.5 && q.body.available_before === sickBefore
  && q.body.available_after === sickBefore - 1 && q.body.balance_kind === "sick", "log_quote answers the day count and what it leaves (" + JSON.stringify(q.body) + ")");
const qUnpaid = await call("log_quote", { member_id: MEMBER.id, type: "unpaid", start_date: d1, end_date: d2 }, asAdmin);
ok(qUnpaid.body.ok === true && qUnpaid.body.full_days === 2 && qUnpaid.body.available_before === null, "unpaid quotes a day count and no balance");
ok(tables.pto_requests.length === 0, "a quote writes nothing");

// ── Admin logs a sick day for the member ──
const versionBefore = Number(tables.pto_members.find((r) => r.member_id === MEMBER.id)!.state_version);
const logged = await call("log", { member_id: MEMBER.id, type: "sick", start_date: d1, end_date: d1, days: 1, note: "Fixture note" }, asAdmin);
const row = rowsOf(MEMBER.id)[0] || {};
ok(logged.status === 201 && logged.body.ok === true && logged.body.logged === true, "an admin logs one sick day (201)");
ok(row.status === "approved" && row.source === "admin_log" && row.decided_by === ADMIN.name && !!row.decided_at && row.note === "Fixture note",
  "the row is approved, marked admin_log, decided by the admin, with the note (" + JSON.stringify(row) + ")");
ok(rowsOf(MEMBER.id).length === 1 && rowsOf(ADMIN.id).length === 0, "exactly one row, on the member, none on the admin");
ok(Number(tables.pto_members.find((r) => r.member_id === MEMBER.id)!.state_version) === versionBefore + 2,
  "it went through create then approve (two state-version steps), not a direct write");
ok(await sickLeft(asMember) === sickBefore - 1, "it uses the member's sick balance like an approved request");
const memberView = await overviewFor(asMember);
const mine = (memberView.my_requests as Row[]).find((r) => r.id === row.id) || {};
ok(mine.status === "approved" && mine.source === "admin_log" && mine.decided_by === ADMIN.name, "the member sees it in their own requests, approved, logged by the admin");
// The calendar projection covers about three months either side of today, so
// prove it with an entry logged near today (d1 may be months back).
let near = "";
for (let d = new Date(today + "T00:00:00Z"); !near; d.setUTCDate(d.getUTCDate() - 1)) {
  const iso = d.toISOString().slice(0, 10);
  if (countPtoDays(iso, iso) === 1 && ![d1, d2, d3, lone].includes(iso)) near = iso;
}
const nearLog = await call("log", { member_id: OTHER.id, type: "unpaid", start_date: near, end_date: near, days: 1 }, asAdmin);
const calendar = (await overviewFor(asMember)).absences as Row[];
ok(nearLog.status === 201 && calendar.some((a) => a.member_name === OTHER.name && a.start_date === near),
  "it is on the team calendar (absences) like any approved request");
const memberCancel = await call("cancel", { request_id: row.id, member_id: MEMBER.id }, asMember);
ok(memberCancel.status === 403 && memberCancel.body.error === "cancel_not_allowed" && row.status === "approved",
  "the member cannot cancel an entry an admin logged (existing rule: members cancel only pending)");

// ── Overlap, balance, half day, past dates ──
const overlap = await call("log", { member_id: MEMBER.id, type: "wellness", start_date: d1, end_date: d2, days: 2 }, asAdmin);
ok(overlap.status === 409 && overlap.body.error === "overlaps_existing" && (overlap.body.overlap as Row).start_date === d1, "leave overlapping a live entry is refused");
const overlapQuote = await call("log_quote", { member_id: MEMBER.id, type: "unpaid", start_date: d1, end_date: d1 }, asAdmin);
ok(overlapQuote.status === 409 && overlapQuote.body.error === "overlaps_existing", "the quote says so before Log is pressed");
const tooMuch = await call("log", { member_id: MEMBER.id, type: "sick", start_date: d2, end_date: d3, days: 2 }, asAdmin);
ok(tooMuch.status === 201, "two more sick days fit the remaining balance");
const over = await call("log", { member_id: MEMBER.id, type: "sick", start_date: lone, end_date: lone, days: 1 }, asAdmin);
ok(over.status === 409 && over.body.error === "insufficient_sick_balance" && rowsOf(MEMBER.id).length === 2, "a fourth sick day is refused for balance and writes nothing");
const half = await call("log", { member_id: OTHER.id, type: "sick", start_date: d1, end_date: d1, days: 0.5 }, asAdmin);
ok(half.status === 201 && Number((half.body.request as Row).days) === 0.5, "a half day logs 0.5");
const badHalf = await call("log", { member_id: OTHER.id, type: "wellness", start_date: d2, end_date: d3, days: 0.5 }, asAdmin);
ok(badHalf.status === 400 && badHalf.body.error === "days_mismatch", "half-day rule unchanged: over two days only 2 or 1.5 is accepted");
const pastWellness = await call("log", { member_id: OTHER.id, type: "wellness", start_date: d2, end_date: d2, days: 1 }, asAdmin);
ok(pastWellness.status === 201, "an admin may log wellness on a past date (the member could not request it)");
const memberPast = await call("request", { type: "wellness", start_date: today, end_date: today, days: 1 }, asMember);
ok(memberPast.status === 400 && memberPast.body.error === "past_date_not_allowed", "the member's own request still refuses a past wellness day");
const off = await call("log", { member_id: OFF.id, type: "unpaid", start_date: d1, end_date: d1, days: 1 }, asAdmin);
ok(off.status === 403 && off.body.error === "pto_not_enabled", "a member with Time Off switched off is refused");
const ghost = await call("log", { member_id: "00000000-0000-4000-8000-0000000000ff", type: "unpaid", start_date: d1, end_date: d1, days: 1 }, asAdmin);
ok(ghost.status === 404 && ghost.body.error === "member_not_found", "an unknown member is refused");
const floatA = await call("log", { member_id: OTHER.id, type: "floating_holiday", start_date: d3, end_date: d3, days: 1 }, asAdmin);
const floatB = await call("log", { member_id: OTHER.id, type: "floating_holiday", start_date: lone, end_date: lone, days: 1 }, asAdmin);
ok(floatA.status === 201 && floatB.status === 409 && floatB.body.error === "floating_holiday_used", "the floating holiday is still once a year");

// ── The approval refuses after the row exists: it is withdrawn, not left pending ──
const countBefore = tables.pto_requests.length;
sim.finalizeAnswer = "member_inactive";
const refused = await call("log", { member_id: ADMIN.id, type: "unpaid", start_date: d1, end_date: d1, days: 1 }, asAdmin);
sim.finalizeAnswer = "";
const stray = tables.pto_requests[tables.pto_requests.length - 1];
ok(refused.status === 409 && refused.body.error === "member_inactive" && refused.body.withdrawn === true, "an approval refusal is passed on");
ok(tables.pto_requests.length === countBefore + 1 && stray.status === "cancelled" && stray.cancelled_by === ADMIN.name,
  "and the half-made row is withdrawn (cancelled by the admin), never left in the pending queue");
ok(!tables.pto_requests.some((r) => r.status === "pending"), "no pending row anywhere");

// ── Before the migration: refused plainly, nothing written ──
sim.oldSourceCheck = true;
const early = await call("log", { member_id: ADMIN.id, type: "unpaid", start_date: d2, end_date: d2, days: 1 }, asAdmin);
sim.oldSourceCheck = false;
ok(early.status === 503 && early.body.error === "admin_log_not_ready" && tables.pto_requests.length === countBefore + 1,
  "before the source migration, log answers admin_log_not_ready and writes nothing");
const memberStill = days.find((d) => d > today);
if (memberStill) {
  const own = await call("request", { type: "unpaid", start_date: memberStill, end_date: memberStill, days: 1 }, asMember);
  ok(own.status === 201 && (own.body.request as Row).source === "syncview" && (own.body.request as Row).status === "pending",
    "a member's own request still goes in as pending, source syncview");
}
const adminView = await overviewFor(asAdmin);
ok((adminView.recent_requests as Row[]).some((r) => r.source === "admin_log" && r.decided_by === ADMIN.name), "Kasper's recent history carries source and who logged it");

console.log(`\n${passed} passed, ${failures.length} failed`);
await db.shutdown();
if (failures.length) Deno.exit(1);
