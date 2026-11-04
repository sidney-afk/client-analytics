// Drives the continuous thumbnail revision scan (supabase/functions/_shared/thumbnail-revisions.ts,
// scanPendingThumbnailRevisions) against an in-memory stand-in for the database and a stubbed Drive.
// Session Thumbscan, 2026-11-03, OPEN_REPAIRS 695.
//
// Run: deno run --allow-env --allow-read --node-modules-dir=auto test/thumbnail-revision-scan-deno.ts
//
// What it proves, in the terms the scheduled caller (scripts/thumbnail-revision-scan.js) acts on:
//   - a card whose thumbnail link is a Drive file that is NOT an image is reported inside `failed`
//     AND inside the known-unusable subset (`missing_source`), NEW the first time and KNOWN after,
//     so the lane goes red once and then stops going red on every lap for the same file;
//   - re-linking the card to a DIFFERENT non-image file is NEW again (the mark is bound to the file);
//   - a Drive 404 keeps its existing behaviour (new once, then known);
//   - any other failure (a Drive 500 here) is never in the subset, so it stays red every time;
//   - a 404 mark never makes a non-image failure on the same file read as known, and vice versa;
//   - the row stays `pending` (the backfill would re-create a terminal row on the next run).

Deno.env.set("GOOGLE_DRIVE_API_KEY", "test-key");
Deno.env.delete("GOOGLE_SERVICE_ACCOUNT_JSON");
Deno.env.delete("GOOGLE_CLIENT_EMAIL");
Deno.env.delete("GOOGLE_PRIVATE_KEY");

const { scanPendingThumbnailRevisions } = await import("../supabase/functions/_shared/thumbnail-revisions.ts");

type Row = Record<string, unknown>;
let checks = 0;
function ok(v: unknown, m: string) { if (!v) throw new Error("thumbnail-revision-scan: " + m); checks++; }
function eq(a: unknown, b: unknown, m: string) { ok(a === b, m + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

// ---- a small stand-in for the supabase-js query builder ------------------------------------------------
class Db {
  t: Record<string, Row[]> = {};
  from(name: string) { this.t[name] = this.t[name] || []; return new Q(this, name); }
  async rpc(name: string, _args: Row) {
    if (name === "syncview_thumbnail_revision_backfill") return { data: 0, error: null };
    return { data: null, error: { message: "unexpected rpc " + name } };
  }
  storage = { from: (_b: string) => ({ upload: async () => ({ error: null }) }) };
}

class Q {
  filters: Array<(r: Row) => boolean> = [];
  patch: Row | null = null;
  max = Infinity;
  single = false;
  constructor(public db: Db, public name: string) {}
  select(_cols?: string) { return this; }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
  is(k: string, v: unknown) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
  not(k: string, op: string, v: unknown) { if (op === "is") this.filters.push((r) => (r[k] ?? null) !== v); return this; }
  lte(_k: string, _v: unknown) { return this; }
  or(_expr: string) { return this; }
  order(_k: string, _o?: unknown) { return this; }
  limit(n: number) { this.max = n; return this; }
  update(p: Row) { this.patch = p; return this; }
  insert(r: Row) { this.db.t[this.name].push({ ...r }); return Promise.resolve({ data: null, error: null }); }
  maybeSingle() { this.single = true; return this; }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    try {
      const rows = this.db.t[this.name].filter((r) => this.filters.every((f) => f(r))).slice(0, this.max);
      if (this.patch) for (const r of rows) Object.assign(r, this.patch);
      const data = this.single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
      return Promise.resolve({ data, error: null }).then(res, rej);
    } catch (e) { return Promise.reject(e).then(res, rej); }
  }
}

// ---- a stubbed Drive: file id -> how the metadata read answers ------------------------------------------
type DriveAnswer = { status: number; mimeType?: string };
const drive: Record<string, DriveAnswer> = {};
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const m = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
  if (!m) throw new Error("unexpected fetch " + url.pathname);
  const fileId = decodeURIComponent(m[1]);
  const a = drive[fileId];
  if (!a) throw new Error("unstubbed Drive file");
  if (url.searchParams.get("alt") === "media") {
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": a.mimeType || "" } });
  }
  if (a.status !== 200) {
    return new Response(JSON.stringify({ error: { message: "Drive says " + a.status } }), { status: a.status });
  }
  return new Response(JSON.stringify({
    id: fileId, name: "f", mimeType: a.mimeType, modifiedTime: "2026-11-03T00:00:00Z",
    md5Checksum: "md5-" + fileId, headRevisionId: "rev-" + fileId,
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

// ---- fixtures: fictional ids only ---------------------------------------------------------------------
const CLIENT = "fixtureclient";
const FILE_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const FILE_B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const FILE_C = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const link = (id: string) => "https://drive.google.com/file/d/" + id + "/view";

function freshDb(fileId: string): Db {
  const db = new Db();
  db.t.clients = [{ slug: CLIENT, active: true }];
  db.t.calendar_posts = [{ id: "card-1", client: CLIENT, status: "In Progress", thumbnail_url: link(fileId) }];
  db.t.thumbnail_media_revisions = [{
    id: "watch-1", surface: "calendar", client: CLIENT, source_id: "card-1",
    reason: "continuous_watch", status: "pending", error: null,
    thumbnail_url: link(fileId), drive_file_id: fileId, baseline_storage_path: null,
  }];
  return db;
}

async function scan(db: Db) {
  const out = await scanPendingThumbnailRevisions({ supabase: db as never, limit: 25 }) as Row;
  return out;
}

/** The exit rule of scripts/thumbnail-revision-scan.js, applied to one response. */
function laneRed(o: Row): boolean {
  const failed = Number(o.failed), missing = Number(o.missing_source), fresh = Number(o.missing_source_new);
  return failed - missing > 0 || fresh > 0;
}

// 1. A thumbnail link to a Drive file that is not an image: new once, known after.
{
  drive[FILE_A] = { status: 200, mimeType: "video/mp4" };
  const db = freshDb(FILE_A);
  const first = await scan(db);
  eq(first.failed, 1, "a non-image source stays inside failed");
  eq(first.missing_source, 1, "a non-image source is in the known-unusable subset");
  eq(first.missing_source_new, 1, "the first sighting of a non-image source is NEW");
  ok(laneRed(first), "the first sighting turns the lane red");
  const row = db.t.thumbnail_media_revisions[0];
  eq(row.status, "pending", "the row stays pending (the backfill would re-create a terminal row)");
  ok(String(row.error).includes(FILE_A), "the stored error is bound to the file it describes");

  const second = await scan(db);
  eq(second.failed, 1, "the second lap still counts it as failed");
  eq(second.missing_source, 1, "the second lap still reports it in the subset");
  eq(second.missing_source_new, 0, "the same non-image file coming round again is KNOWN");
  ok(!laneRed(second), "the same non-image file must not turn the lane red on every lap");

  // 2. Re-linked to a different non-image file: new again.
  drive[FILE_B] = { status: 200, mimeType: "application/pdf" };
  db.t.calendar_posts[0].thumbnail_url = link(FILE_B);
  const relinked = await scan(db);
  eq(relinked.missing_source_new, 1, "a different non-image file is NEW even though the row carries A's mark");
  ok(laneRed(relinked), "a newly linked non-image file turns the lane red");

  // A 404 on the same file the row was marked not-an-image for is a different kind of trouble: new.
  drive[FILE_B] = { status: 404 };
  const nowGone = await scan(db);
  eq(nowGone.missing_source_new, 1, "a 404 on a file marked not-an-image is NEW, not known");
  const goneAgain = await scan(db);
  eq(goneAgain.missing_source_new, 0, "the same 404 coming round again is known");

  // Replaced by an image at the same link: the row initializes and the mark is cleared.
  drive[FILE_B] = { status: 200, mimeType: "image/png" };
  const fixed = await scan(db);
  eq(fixed.failed, 0, "an image source scans clean");
  eq(fixed.unchanged, 1, "an image source initializes its baseline");
  eq(db.t.thumbnail_media_revisions[0].error ?? null, null, "a clean scan clears the stored mark");
}

// 3. A Drive 404 keeps its existing behaviour, and a not-image mark never makes it known.
{
  drive[FILE_C] = { status: 200, mimeType: "video/quicktime" };
  const db = freshDb(FILE_C);
  await scan(db);
  drive[FILE_C] = { status: 404 };
  const first = await scan(db);
  eq(first.missing_source, 1, "a 404 is in the subset");
  eq(first.missing_source_new, 1, "a 404 after a not-image mark on the same file is NEW");
  const second = await scan(db);
  eq(second.missing_source_new, 0, "the same 404 coming round again is known");
  ok(!laneRed(second), "a known 404 keeps the lane green, as before");
}

// 4. Any other failure kind is never in the subset: red on every lap.
{
  drive[FILE_A] = { status: 500 };
  const db = freshDb(FILE_A);
  for (let lap = 0; lap < 2; lap++) {
    const o = await scan(db);
    eq(o.failed, 1, "a Drive outage counts as failed (lap " + lap + ")");
    eq(o.missing_source, 0, "a Drive outage is never in the known-unusable subset (lap " + lap + ")");
    ok(laneRed(o), "a Drive outage keeps the lane red on every lap (lap " + lap + ")");
  }
}

console.log("thumbnail-revision-scan: " + checks + " checks passed");
