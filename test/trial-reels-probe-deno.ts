// TRIAL REELS: WHAT THE PROBE FOUND OPEN IN THE FUNCTION ITSELF (session Probe, 2026-10-27). The real trial-reels Edge
// Function (supabase/functions/trial-reels/index.ts), run under Deno against an in-memory stand-in for the database's
// REST API, as test/trial-reels-function-deno.ts does. Fully offline: fictional client, card and links, fake role keys.
//   deno run --allow-env --allow-net=127.0.0.1 --allow-read --node-modules-dir=auto test/trial-reels-probe-deno.ts
// Each check states what the plan asks; a failing check is a finding sent to session Trials (bugs 5 and 7 in
// docs/features/trial-reels/OVERNIGHT_PROBE_2026-10-27.md).

type Row = Record<string, unknown>;
const LINK = (l: string) => "https://f.io/fixture-probe-" + l.toLowerCase();
const tables: Record<string, Row[]> = {
  syncview_runtime_flags: [{ key: "trial_reels_pages", value: { clients: ["fixtureclient"] } }],
  calendar_posts: [{ id: "p1", client: "fixtureclient", video_status: "Approved", asset_url: LINK("C"), video_deliverable_id: null }],
  deliverables: [],
  studio_trial_versions: ["A", "B", "C", "D", "E"].map((l, i) => ({
    id: "v" + l, client: "fixtureclient", batch: "Fixture batch", video: "7", letter: l, hook: "Fictional hook " + l, status: "on trial",
    post_id: "p1", frame_url: LINK(l), revision: 0, smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, change_by: null, change_note: null,
    change_at: null, posted_at: "2026-10-26T09:00:00.000Z", trial_ends_at: "2026-10-27T09:00:00.000Z", updated_at: "2026-10-27T09:00:0" + i + ".000Z",
  })),
  trial_reel_cards: [{ client: "fixtureclient", post_id: "p1", enabled: true, winner_letter: null }],
  calendar_post_events: [],
  client_access: [],
  clients: [{ slug: "fixtureclient", active: true }],
};
function matches(row: Row, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const val = String(row[k] ?? "");
    if (v.startsWith("eq.") && val !== v.slice(3)) return false;
    if (v.startsWith("ilike.") && val.toLowerCase() !== v.slice(6).replace(/\\(.)/g, "$1").toLowerCase()) return false;
  }
  return true;
}
// The studio's log touches a row while the function is writing: run once, before the first version update.
let beforeFirstPatch: (() => void) | null = null;
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
    if (t === "studio_trial_versions" && beforeFirstPatch) { const f = beforeFirstPatch; beforeFirstPatch = null; f(); }
    const body = await req.json();
    const hit = rows.filter((r) => matches(r, u.searchParams));
    for (const r of hit) Object.assign(r, body);
    return out(hit);
  }
  return out({ message: "method" }, 405);
});
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:" + db.addr.port);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
Deno.env.set("ROLE_KEY_SMM", "fixture-smm-key");

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
async function raw(body: string) {
  const q = console.log; console.log = () => {};
  try {
    const res = await handler(new Request("http://fn/trial-reels", { method: "POST", headers: { "content-type": "application/json", "x-syncview-key": "fixture-smm-key" }, body }));
    return { status: res.status, body: await res.json().catch(() => ({})) as Row };
  } catch (e) {
    return { status: 0, body: { threw: String((e as Error).message || e) } as Row };
  } finally { console.log = q; }
}
const v = (l: string) => tables.studio_trial_versions.find((r) => r.letter === l)!;
const statuses = () => tables.studio_trial_versions.map((r) => r.letter + ":" + r.status).join(" ");

// Bug 5: the studio's log touches Video E while the winner is being written. The answer is a conflict; what must
// hold is that the card's versions are never left half-decided, and every row that did change has its ledger row.
beforeFirstPatch = () => { v("E").updated_at = "2026-10-27T09:30:00.000Z"; v("E").views = 10; };
const before = statuses();
const pick = await raw(JSON.stringify({ action: "winner_set", client: "fixtureclient", post_id: "p1", letter: "C" }));
const changed = tables.studio_trial_versions.filter((r) => r.status !== "on trial").map((r) => r.letter);
const sw = tables.trial_reel_cards[0];
ok(pick.status === 409, "bug 5: the winner pick meets the studio's write and answers conflict (" + pick.status + " " + pick.body.error + ")");
ok(statuses() === before || (v("C").status === "winner" && sw.winner_letter === "C" && tables.studio_trial_versions.every((r) => r.letter === "C" || r.status === "lost")),
  "bug 5: the versions are never left half-decided (" + statuses() + ", winner_letter " + sw.winner_letter + ")");
ok(changed.every((l) => tables.calendar_post_events.some((e) => (e.payload as Row | null)?.letter === l)),
  "bug 5: every version that changed has its ledger row (changed " + (changed.join(",") || "none") + ", ledger rows " + tables.calendar_post_events.length + ")");

// Bug 7: a body that is JSON but not an object is a plain 400, inside the handler's own answer and log.
for (const body of ["null", "5", "[]", '"read"']) {
  const r = await raw(body);
  ok(r.status === 400, "bug 7: a body of " + body + " answers 400 (" + (r.status || "threw: " + r.body.threw) + ")");
}

await db.shutdown();
console.log(`trial-reels-probe-deno: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ""));
if (failures.length) Deno.exit(1);
