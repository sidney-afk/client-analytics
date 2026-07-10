// Supabase Edge Function: sample-review-upsert
//
// A2 port of the live n8n sample-review-upsert workflow. It preserves the
// patch-vs-whole-row contract, read-failure guard, phantom-row guard,
// comments_base_at scalar conflict guard, link clear/carry-forward guards,
// sample_review_merge_comments RPC, and best-effort sample_review_events ledger.
//
// Required env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { captureGraphicTweakBaseline, scanGraphicTweakResolution } from "../_shared/thumbnail-revisions.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};

const ALLOWED = [
  "order_index", "name", "asset_url", "thumbnail_url", "status", "creative_direction", "hide_creative_direction",
  "linear_issue_id", "video_deliverable_id", "graphic_linear_issue_id", "graphic_deliverable_id",
  "video_status", "graphic_status", "video_tweaks", "graphic_tweaks",
  "client_video_approved_at", "client_graphic_approved_at", "kasper_approved_at", "kasper_approved_by", "kasper_seen",
  "kasper_approved_after_tweaks", "kasper_finished_at", "kasper_closed_at", "thumb_rev", "created_at",
  "video_urgent_pinged_at", "video_urgent_status_at", "video_urgent_issue", "video_urgent_editor",
] as const;

const CONTENT_FIELDS = ["name", "asset_url", "thumbnail_url", "creative_direction", "video_tweaks", "graphic_tweaks"];
const SCALAR_FIELDS = [
  "name", "asset_url", "thumbnail_url", "status", "video_status", "graphic_status", "creative_direction",
  "linear_issue_id", "video_deliverable_id", "graphic_linear_issue_id", "graphic_deliverable_id", "kasper_approved_at",
  "video_urgent_pinged_at", "video_urgent_status_at", "video_urgent_issue", "video_urgent_editor",
];
const MIRROR_COLS = [
  "id", "order_index", "name", "asset_url", "thumbnail_url", "status", "creative_direction", "hide_creative_direction",
  "linear_issue_id", "video_deliverable_id", "graphic_linear_issue_id", "graphic_deliverable_id",
  "video_status", "graphic_status", "video_tweaks", "graphic_tweaks",
  "client_video_approved_at", "client_graphic_approved_at", "kasper_approved_at", "kasper_approved_by", "kasper_seen",
  "kasper_approved_after_tweaks", "kasper_finished_at", "kasper_closed_at", "thumb_rev",
  "video_urgent_pinged_at", "video_urgent_status_at", "video_urgent_issue", "video_urgent_editor",
  "created_at", "updated_at",
];

const READ_FAILURE_MESSAGE = "Not saved \u2014 the sample store was briefly unavailable. Your text is kept; please try again in a moment.";
const CLEAR = "__CLEAR_LINK__";
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_COLUMNS = ["graphic_linear_issue_id", "linear_issue_id", "video_deliverable_id", "graphic_deliverable_id"] as const;
const DUPLICATE_LINK_COLUMNS = ["linear_issue_id", "graphic_linear_issue_id"] as const;
const NULLABLE_LINK_COLUMNS = new Set<string>(["video_deliverable_id", "graphic_deliverable_id"]);
const URGENT_MARKER_FIELDS = ["video_urgent_pinged_at", "video_urgent_status_at", "video_urgent_issue", "video_urgent_editor"] as const;

type JsonMap = Record<string, unknown>;
type Row = Record<string, string | null>;
type ExistingRow = Record<string, unknown>;
type EventDraft = {
  client: string;
  sample_id: string;
  ts: string;
  actor: string | null;
  role: string | null;
  action: string;
  component?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  source: string;
  payload?: unknown;
  created_at: string;
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function sv(o: JsonMap | ExistingRow | null | undefined, k: string): string {
  return String(o && o[k] == null ? "" : o ? o[k] : "");
}

function has(o: JsonMap | ExistingRow, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function isoNow(): string {
  return new Date().toISOString();
}

function waitUntil(p: Promise<unknown>): void {
  const edge = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  try {
    if (edge && typeof edge.waitUntil === "function") edge.waitUntil(p.catch(() => null));
    else p.catch(() => null);
  } catch (_e) {
    p.catch(() => null);
  }
}

function buildIncoming(body: JsonMap, now: string): { client: string; row: JsonMap } {
  const client = clean(body.client);
  if (!client) throw new Error("client required");
  const sample = body.sample && typeof body.sample === "object" ? body.sample as JsonMap : {};
  let id = clean(sample.id);
  if (!id) id = "sr_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);

  const row: JsonMap = { id, updated_at: now };
  for (const k of ALLOWED) {
    if (has(sample, k)) row[k] = String(sample[k] == null ? "" : sample[k]);
  }
  row._client = client;
  row._baseAt = String(body.comments_base_at || "");
  return { client, row };
}

function stripPrivate(row: JsonMap): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.charAt(0) === "_") continue;
    if (NULLABLE_LINK_COLUMNS.has(k) && clean(v) === "") out[k] = null;
    else out[k] = String(v == null ? "" : v);
  }
  return out;
}

function normalizeNullableLinks(row: JsonMap): void {
  for (const col of NULLABLE_LINK_COLUMNS) {
    if (has(row, col) && clean(row[col]) === "") row[col] = null;
  }
}

function responsePayload(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (NULLABLE_LINK_COLUMNS.has(k) && v == null) continue;
    out[k] = v;
  }
  return out;
}

function parseComments(s: unknown): JsonMap[] {
  try {
    const a = JSON.parse(s == null ? "[]" : (String(s) || "[]"));
    return Array.isArray(a) ? a.filter(c => c && typeof c === "object" && (c as JsonMap).id) as JsonMap[] : [];
  } catch (_e) {
    return [];
  }
}

function stamp(c: JsonMap): string {
  return String(c.updated_at || c.created_at || "");
}

function mergeCell(existingStr: unknown, incomingStr: unknown, baseAt: string, nowMs: number): string {
  const ex = parseComments(existingStr);
  const inc = parseComments(incomingStr);
  const incIds = new Set(inc.map(c => String(c.id)));
  const exById = new Map(ex.map(c => [String(c.id), c]));
  const out: JsonMap[] = [];

  for (const c of inc) {
    const e = exById.get(String(c.id));
    out.push(e && stamp(e) > stamp(c) ? e : c);
  }
  for (const e of ex) {
    if (incIds.has(String(e.id))) continue;
    if (e.deleted) { out.push(e); continue; }
    const es = stamp(e);
    if (!baseAt) { out.push(e); continue; }
    if (es && es > baseAt) out.push(e);
  }

  const cutoff = nowMs - RETAIN_MS;
  const kept = out.filter(c => {
    if (!c.deleted) return true;
    const t = Date.parse(String(c.updated_at || c.created_at || ""));
    return !(isFinite(t) && t < cutoff);
  });
  return kept.length ? JSON.stringify(kept) : "";
}

function applyUrgentMarkerGuards(row: JsonMap, incoming: JsonMap, existing: ExistingRow): void {
  const touched = URGENT_MARKER_FIELDS.some(k => has(incoming, k));
  if (!touched) return;

  for (const field of URGENT_MARKER_FIELDS) {
    if (has(incoming, field) && clean(incoming[field]) === "" && clean(existing[field]) !== "") {
      row[field] = String(existing[field] == null ? "" : existing[field]);
    }
  }

  if (!has(incoming, "video_urgent_pinged_at") || clean(incoming.video_urgent_pinged_at) === "") return;

  const status = clean(has(row, "video_status") ? row.video_status : existing.video_status);
  if (status !== "Tweaks Needed") {
    for (const field of URGENT_MARKER_FIELDS) {
      row[field] = String(existing[field] == null ? "" : existing[field]);
    }
    return;
  }

  const statusAt = clean(existing.video_status_at) || clean(row.video_status_at) || clean(incoming.video_urgent_status_at);
  if (statusAt) {
    row.video_urgent_status_at = statusAt;
    row.video_status_at = statusAt;
  }
  if (!clean(row.video_urgent_issue)) {
    row.video_urgent_issue = clean(row.linear_issue_id) || clean(existing.linear_issue_id);
  }
}

function applyGuards(incoming: JsonMap, existing: ExistingRow, twins: ExistingRow[], readFailed: boolean, nowMs: number): JsonMap {
  if (readFailed) {
    return { _conflict: true, ok: false, id: incoming.id, error: READ_FAILURE_MESSAGE };
  }

  const existsAlready = !!(existing && existing.id);
  const hasContent = CONTENT_FIELDS.some(k => clean(incoming[k]) !== "");
  if (!existsAlready && !hasContent) {
    throw new Error("phantom-row guard: refusing to create sample_reviews row id " + clean(incoming.id) +
      " because the row does not exist and the payload contains no substantive content fields. This is the misrouted-skeleton pattern.");
  }

  const row: JsonMap = { ...incoming };
  const baseAt = clean(incoming._baseAt);
  for (const col of ["video_tweaks", "graphic_tweaks"]) {
    if (has(incoming, col)) row[col] = mergeCell(existing[col], incoming[col], baseAt, nowMs);
  }

  const cleared: Record<string, boolean> = {};
  for (const linkCol of LINK_COLUMNS) {
    if (has(incoming, linkCol) && clean(incoming[linkCol]) === CLEAR) {
      row[linkCol] = "";
      cleared[linkCol] = true;
    }
  }

  for (const linkCol of LINK_COLUMNS) {
    if (cleared[linkCol]) continue;
    if (has(incoming, linkCol) && clean(incoming[linkCol]) === "" && clean(existing[linkCol]) !== "") {
      row[linkCol] = String(existing[linkCol] == null ? "" : existing[linkCol]);
    }
  }

  for (const linkCol of DUPLICATE_LINK_COLUMNS) {
    if (cleared[linkCol]) continue;
    const incomingLink = has(incoming, linkCol) ? clean(incoming[linkCol]) : "";
    if (!incomingLink) continue;

    // duplicate-link guard: each live Samples component can own a Linear issue link only once.
    const twin = twins.find(t => t && t.id && clean(t.id) !== clean(incoming.id) &&
      clean(t.status).toLowerCase() !== "archived" && clean(t[linkCol]) === incomingLink);
    if (twin) {
      if (!existsAlready) {
        row[linkCol] = "";
      } else if (clean(existing[linkCol]) !== incomingLink) {
        row[linkCol] = String(existing[linkCol] == null ? "" : existing[linkCol]);
      }
    }
  }

  applyUrgentMarkerGuards(row, incoming, existing);

  if (existsAlready && baseAt) {
    const storedAt = clean(existing.updated_at);
    if (storedAt && storedAt > baseAt) {
      const changed = SCALAR_FIELDS.filter(k => has(incoming, k) && clean(row[k]) !== clean(existing[k]));
      if (changed.length) {
        return {
          _conflict: true,
          ok: false,
          conflict: true,
          id: incoming.id,
          error: "Not saved: someone else updated this sample (" + changed.join(", ") +
            ") after your screen last loaded it. Refresh to see their version, then re-apply your change.",
        };
      }
    }
  }

  row._conflict = false;
  normalizeNullableLinks(row);
  return row;
}

async function readExisting(supabase: SupabaseClient, client: string, id: string): Promise<{ row: ExistingRow; failed: boolean }> {
  const { data, error } = await supabase.from("sample_reviews")
    .select("*")
    .eq("client", client)
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: {}, failed: true };
  return { row: (data || {}) as ExistingRow, failed: false };
}

async function readLinkTwins(supabase: SupabaseClient, client: string, incoming: JsonMap): Promise<ExistingRow[]> {
  const rows = new Map<string, ExistingRow>();
  for (const linkCol of DUPLICATE_LINK_COLUMNS) {
    const link = has(incoming, linkCol) ? clean(incoming[linkCol]) : "";
    if (!link) continue;

    const { data, error } = await supabase.from("sample_reviews")
      .select("*")
      .eq("client", client)
      .eq(linkCol, link);
    if (error || !Array.isArray(data)) continue;

    for (const row of data as ExistingRow[]) {
      if (clean(row.status).toLowerCase() === "archived") continue;
      rows.set(clean(row.id) || `${linkCol}:${rows.size}`, row);
    }
  }
  return [...rows.values()];
}

function mirrorPayload(client: string, row: Row, existsAlready: boolean): Row {
  const out: Row = { client };
  for (const k of MIRROR_COLS) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  if (!existsAlready && clean(out.created_at) === "") {
    out.created_at = out.updated_at || isoNow();
  }
  return out;
}

function scalarPayloadForExisting(row: Row): Row {
  const out: Row = { ...row };
  delete out.video_tweaks;
  delete out.graphic_tweaks;
  return out;
}

async function callCommentRpc(supabase: SupabaseClient, client: string, row: Row): Promise<void> {
  const args: JsonMap = { p_client: client, p_id: row.id, p_base: "" };
  for (const c of ["video", "graphic"]) {
    const col = c + "_tweaks";
    if (has(row, col)) args["p_" + c] = row[col] == null ? "" : String(row[col]);
  }
  if (!has(args, "p_video") && !has(args, "p_graphic")) return;
  const { error } = await supabase.rpc("sample_review_merge_comments", args);
  if (error) throw new Error("comment merge failed");
}

async function writeSampleRow(supabase: SupabaseClient, client: string, row: Row, existsAlready: boolean): Promise<void> {
  const mirror = mirrorPayload(client, row, existsAlready);
  if (existsAlready) {
    await callCommentRpc(supabase, client, mirror);
    const patch = scalarPayloadForExisting(mirror);
    const { error } = await supabase.from("sample_reviews")
      .update(patch)
      .eq("client", client)
      .eq("id", row.id);
    if (error) throw new Error("sample update failed");
  } else {
    const { error } = await supabase.from("sample_reviews").insert(mirror);
    if (error) throw new Error("sample create failed");
  }
}

function commentIds(s: unknown): string[] {
  return parseComments(s)
    .filter(c => !c.deleted)
    .map(c => String(c.id));
}

function buildEvents(client: string, inc: Row, patch: JsonMap, existing: ExistingRow, now: string): EventDraft[] {
  const existsAlready = !!(existing && existing.id);
  const sampleId = clean(inc.id || patch.id);
  const actor = clean(patch.kasper_approved_by) || null;
  const events: EventDraft[] = [];
  const ev = (action: string, extra: Partial<EventDraft> = {}) => {
    events.push({
      client,
      sample_id: sampleId,
      ts: now,
      actor,
      role: null,
      action,
      source: "ui",
      created_at: now,
      ...extra,
    });
  };

  if (!existsAlready) {
    ev("create", { component: null, from_status: sv(existing, "status"), to_status: sv(inc, "status") || null });
  } else if (has(patch, "status") && sv(inc, "status") !== sv(existing, "status")) {
    if (sv(inc, "status").toLowerCase() === "archived") ev("archive", { component: null, from_status: sv(existing, "status"), to_status: sv(inc, "status") });
    else ev("status_change", { component: null, from_status: sv(existing, "status"), to_status: sv(inc, "status") });
  }

  for (const comp of ["video", "graphic"]) {
    const col = comp + "_status";
    if (has(patch, col) && sv(inc, col) !== sv(existing, col)) {
      ev("status_change", { component: comp, from_status: sv(existing, col), to_status: sv(inc, col) });
    }
  }

  if (has(patch, "client_video_approved_at") && sv(inc, "client_video_approved_at") && sv(inc, "client_video_approved_at") !== sv(existing, "client_video_approved_at")) {
    ev("approve_video", { component: "video", role: "client" });
  }
  if (has(patch, "client_graphic_approved_at") && sv(inc, "client_graphic_approved_at") && sv(inc, "client_graphic_approved_at") !== sv(existing, "client_graphic_approved_at")) {
    ev("approve_graphic", { component: "graphic", role: "client" });
  }
  if (has(patch, "kasper_approved_at") && sv(inc, "kasper_approved_at") && sv(inc, "kasper_approved_at") !== sv(existing, "kasper_approved_at")) {
    ev("kasper_approve", { component: null, role: "kasper" });
  }
  if (has(patch, "kasper_finished_at") && sv(inc, "kasper_finished_at") && sv(inc, "kasper_finished_at") !== sv(existing, "kasper_finished_at")) {
    ev("kasper_finish", { component: null, role: "kasper" });
  }
  if (has(patch, "kasper_closed_at") && sv(inc, "kasper_closed_at") && sv(inc, "kasper_closed_at") !== sv(existing, "kasper_closed_at")) {
    ev("kasper_close", { component: null, role: "kasper" });
  }
  if (has(patch, "video_urgent_pinged_at") && sv(inc, "video_urgent_pinged_at") && sv(inc, "video_urgent_pinged_at") !== sv(existing, "video_urgent_pinged_at")) {
    ev("urgent_ping", {
      component: "video",
      payload: {
        issue: sv(inc, "video_urgent_issue") || sv(inc, "linear_issue_id"),
        editor: sv(inc, "video_urgent_editor") || null,
        status_at: sv(inc, "video_urgent_status_at") || null,
      },
    });
  }

  for (const [comp, col] of [["video", "linear_issue_id"], ["graphic", "graphic_linear_issue_id"]]) {
    if (!has(patch, col)) continue;
    const before = sv(existing, col);
    const after = sv(inc, col);
    if (after === before) continue;
    if (after && !before) ev("link_set", { component: comp, payload: { to: after } });
    else if (!after && before) ev("link_clear", { component: comp, payload: { from: before } });
    else ev("link_set", { component: comp, payload: { from: before, to: after } });
  }

  for (const [comp, col] of [["video", "video_tweaks"], ["graphic", "graphic_tweaks"]]) {
    if (!has(patch, col)) continue;
    const before = new Set(commentIds(existing[col]));
    const after = commentIds(inc[col]);
    const added = after.filter(x => !before.has(x));
    if (added.length) ev("comment_add", { component: comp, payload: { added } });
  }

  return events;
}

async function insertEvents(supabase: SupabaseClient, events: EventDraft[]): Promise<void> {
  if (!events.length) return;
  const { error } = await supabase.from("sample_review_events").insert(events);
  if (error) throw error;
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let body: JsonMap;
  try { body = JSON.parse(await req.text()) as JsonMap; }
  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }

  const now = isoNow();
  let client = "";
  let id = "";
  let outcome = "error";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    const built = buildIncoming(body, now);
    client = built.client;
    id = clean(built.row.id);
    const existingRead = await readExisting(supabase, client, id);
    const twins = await readLinkTwins(supabase, client, built.row);
    const guarded = applyGuards(built.row, existingRead.row, twins, existingRead.failed, Date.now());
    if (guarded._conflict === true) {
      outcome = guarded.conflict ? "conflict" : "read_failure";
      return json(guarded);
    }

    const sample = stripPrivate(guarded);
    const existsAlready = !!(existingRead.row && existingRead.row.id);
    await writeSampleRow(supabase, client, sample, existsAlready);

    waitUntil(captureGraphicTweakBaseline({
      supabase,
      surface: "samples",
      client,
      sourceId: id,
      incoming: sample,
      patch: built.row,
      existing: existingRead.row,
      actor: { actor: clean(built.row.kasper_approved_by) || null, role: null, source: "ui" },
      now: isoNow(),
    }));
    waitUntil(scanGraphicTweakResolution({
      supabase,
      surface: "samples",
      client,
      sourceId: id,
      incoming: sample,
      patch: built.row,
      existing: existingRead.row,
      actor: { actor: clean(built.row.kasper_approved_by) || null, role: null, source: "ui" },
      now: isoNow(),
    }));

    const events = buildEvents(client, sample, built.row, existingRead.row, isoNow());
    waitUntil(insertEvents(supabase, events));

    outcome = "ok";
    return json({ ok: true, sample: responsePayload(sample) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "request failed";
    const status = msg.indexOf("phantom-row guard") === 0 ? 400 : 500;
    return json({ ok: false, error: msg }, status);
  } finally {
    console.log(JSON.stringify({
      fn: "sample-review-upsert",
      client,
      id,
      outcome,
      ms: Date.now() - started,
    }));
  }
});
