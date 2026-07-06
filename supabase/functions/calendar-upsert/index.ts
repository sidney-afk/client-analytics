// Supabase Edge Function: calendar-upsert
//
// A1 port of the live n8n `calendar-upsert-post` workflow. This function keeps
// the n8n guard gauntlet intact, writes calendar_posts with the service role,
// calls the existing calendar_merge_comments RPC for atomic comment cells, and
// adds a best-effort calendar_post_events ledger.
//
// Deploy:
//   supabase functions deploy calendar-upsert --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
//
// Required env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syncview-actor, x-syncview-role, x-syncview-source, x-syncview-client-token",
  "Cache-Control": "no-store",
};

const ALLOWED = [
  "order_index", "scheduled_date", "name", "asset_url", "thumbnail_url",
  "caption", "caption_alt", "caption_alt_platform", "post_url", "cta", "tweaks", "status", "linear_issue_id", "video_deliverable_id",
  "kasper_approved_at", "posted_at", "platform", "platforms", "color",
  "video_status", "graphic_status", "caption_status",
  "graphic_linear_issue_id", "graphic_deliverable_id",
  "video_tweaks", "graphic_tweaks", "caption_tweaks",
  "client_video_approved_at", "client_graphic_approved_at", "client_caption_approved_at",
  "title_status", "title_tweaks", "client_title_approved_at",
  "kasper_seen", "kasper_approved_after_tweaks",
  "thumb_rev",
  "kasper_finished_at", "kasper_closed_at", "kasper_finish_log",
] as const;

const CONTENT_FIELDS = [
  "caption", "caption_alt", "name", "asset_url", "thumbnail_url", "linear_issue_id", "scheduled_date",
  "cta", "color", "platforms", "graphic_linear_issue_id",
];

const SCALAR_FIELDS = [
  "scheduled_date", "name", "caption", "caption_alt", "caption_alt_platform", "asset_url", "thumbnail_url",
  "post_url", "cta", "status", "video_status", "graphic_status", "caption_status", "linear_issue_id",
  "video_deliverable_id", "graphic_linear_issue_id", "graphic_deliverable_id",
  "platform", "platforms", "color", "kasper_approved_at", "posted_at",
];

const READ_FAILURE_MESSAGE = "Not saved \u2014 the calendar store was briefly unavailable. Your text is kept; please try again in a moment.";
const CLEAR = "__CLEAR_LINK__";
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

type JsonMap = Record<string, unknown>;
type Row = Record<string, string>;
type ExistingRow = Record<string, unknown>;
type Actor = { actor: string | null; role: string | null; source: string };
type EventDraft = {
  client: string;
  post_id: string;
  ts: string;
  actor: string | null;
  role: string | null;
  action: string;
  component?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  source: string;
  payload?: unknown;
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

function actorFrom(req: Request, body: JsonMap): Actor {
  const bodyActor = body.actor && typeof body.actor === "object" ? body.actor as JsonMap : {};
  const bodyActorName = typeof body.actor === "string" ? body.actor : "";
  const actor = clean(req.headers.get("x-syncview-actor") || bodyActor.name || body.actor_name || bodyActorName) || null;
  const role = clean(req.headers.get("x-syncview-role") || bodyActor.role || body.actor_role) || null;
  const rawSource = clean(req.headers.get("x-syncview-source") || body.source || "ui").toLowerCase();
  const source = rawSource === "linear" || rawSource === "reconcile" ? rawSource : "ui";
  return { actor, role, source };
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

function stripPrivate(row: JsonMap): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.charAt(0) === "_") continue;
    out[k] = String(v == null ? "" : v);
  }
  return out;
}

function buildIncoming(body: JsonMap, now: string): { client: string; row: JsonMap } {
  const client = clean(body.client);
  if (!client) throw new Error("client required");
  const post = body.post && typeof body.post === "object" ? body.post as JsonMap : {};
  let id = clean(post.id);
  if (!id) id = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  const row: JsonMap = { id, updated_at: now };
  for (const k of ALLOWED) {
    if (has(post, k)) row[k] = String(post[k] == null ? "" : post[k]);
  }
  row._client = client;
  row._baseAt = String(body.comments_base_at || "");
  return { client, row };
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

function applyGuards(incoming: JsonMap, existing: ExistingRow, twins: ExistingRow[], readFailed: boolean, nowMs: number): JsonMap {
  if (readFailed) {
    return { _conflict: true, ok: false, id: incoming.id, error: READ_FAILURE_MESSAGE };
  }

  const existsAlready = !!(existing && existing.id);
  const hasContent = CONTENT_FIELDS.some(k => clean(incoming[k]) !== "");
  if (!existsAlready && !hasContent) {
    throw new Error("phantom-row guard: refusing to create a row in Calendar_" + clean(incoming._client || "?") +
      " with id " + clean(incoming.id) + " because the row does not exist and the payload contains no substantive content fields. This is the misrouted-skeleton pattern.");
  }

  const row: JsonMap = { ...incoming };
  const baseAt = clean(incoming._baseAt);
  for (const col of ["video_tweaks", "graphic_tweaks", "caption_tweaks"]) {
    if (has(incoming, col)) row[col] = mergeCell(existing[col], incoming[col], baseAt, nowMs);
  }
  if (has(incoming, "video_tweaks")) row.tweaks = row.video_tweaks;

  const cleared: Record<string, boolean> = {};
  for (const linkCol of ["graphic_linear_issue_id", "linear_issue_id"]) {
    if (has(incoming, linkCol) && clean(incoming[linkCol]) === CLEAR) {
      row[linkCol] = "";
      cleared[linkCol] = true;
    }
  }

  for (const linkCol of ["graphic_linear_issue_id", "linear_issue_id"]) {
    if (cleared[linkCol]) continue;
    // link-clobber guard: a blank incoming link must not wipe a stored link.
    if (has(incoming, linkCol) && clean(incoming[linkCol]) === "" && clean(existing[linkCol]) !== "") {
      row[linkCol] = String(existing[linkCol] == null ? "" : existing[linkCol]);
    }
  }

  const incomingLink = (!cleared.linear_issue_id && has(incoming, "linear_issue_id")) ? clean(incoming.linear_issue_id) : "";
  if (incomingLink) {
    // duplicate-link guard: linear_issue_id must stay unique across live rows.
    const twin = twins.find(t => t && t.id && clean(t.id) !== clean(incoming.id) &&
      clean(t.status).toLowerCase() !== "archived" && clean(t.linear_issue_id) === incomingLink);
    if (twin) {
      if (!existsAlready) {
        row.linear_issue_id = "";
      } else if (clean(existing.linear_issue_id) !== incomingLink) {
        row.linear_issue_id = String(existing.linear_issue_id == null ? "" : existing.linear_issue_id);
      }
    }
  }

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
          error: "Not saved: someone else updated this card (" + changed.join(", ") +
            ") after your screen last loaded it. Refresh the calendar to see their version, then re-apply your change.",
        };
      }
    }
  }

  row._conflict = false;
  return row;
}

async function readExisting(supabase: SupabaseClient, client: string, id: string): Promise<{ row: ExistingRow; failed: boolean }> {
  const { data, error } = await supabase.from("calendar_posts")
    .select("*")
    .eq("client", client)
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: {}, failed: true };
  return { row: (data || {}) as ExistingRow, failed: false };
}

async function readLinkTwins(supabase: SupabaseClient, client: string, incomingLink: string): Promise<ExistingRow[]> {
  const link = incomingLink.trim() || "__no_link__";
  const { data, error } = await supabase.from("calendar_posts")
    .select("*")
    .eq("client", client)
    .eq("linear_issue_id", link);
  if (error || !Array.isArray(data)) return [];
  return data as ExistingRow[];
}

function updatePayload(client: string, row: Row): Row {
  const out: Row = { client };
  for (const [k, v] of Object.entries(row)) out[k] = v;
  return out;
}

function scalarPayloadForExisting(row: Row): Row {
  const out: Row = { ...row };
  for (const k of ["video_tweaks", "graphic_tweaks", "caption_tweaks", "title_tweaks", "tweaks"]) delete out[k];
  return out;
}

async function callCommentRpc(supabase: SupabaseClient, client: string, row: Row): Promise<void> {
  const args: JsonMap = { p_client: client, p_id: row.id, p_base: "" };
  for (const c of ["video", "graphic", "caption", "title"]) {
    const col = c + "_tweaks";
    if (has(row, col)) args["p_" + c] = row[col] == null ? "" : String(row[col]);
  }
  if (!has(args, "p_video") && !has(args, "p_graphic") && !has(args, "p_caption") && !has(args, "p_title")) return;
  const { error } = await supabase.rpc("calendar_merge_comments", args);
  if (error) throw new Error("comment merge failed");
}

async function writeCalendarRow(supabase: SupabaseClient, client: string, row: Row, existsAlready: boolean): Promise<void> {
  if (existsAlready) {
    await callCommentRpc(supabase, client, row);
    const patch = updatePayload(client, scalarPayloadForExisting(row));
    const { error } = await supabase.from("calendar_posts")
      .update(patch)
      .eq("client", client)
      .eq("id", row.id);
    if (error) throw new Error("calendar update failed");
  } else {
    const insert = updatePayload(client, row);
    const { error } = await supabase.from("calendar_posts").insert(insert);
    if (error) throw new Error("calendar create failed");
  }
}

function commentIds(s: unknown, includeDeleted = false): string[] {
  return parseComments(s)
    .filter(c => includeDeleted || !c.deleted)
    .map(c => String(c.id));
}

function buildEvents(client: string, inc: Row, patch: JsonMap, existing: ExistingRow, actor: Actor, now: string): EventDraft[] {
  const existsAlready = !!(existing && existing.id);
  const postId = clean(inc.id || patch.id);
  const events: EventDraft[] = [];
  const ev = (action: string, extra: Partial<EventDraft> = {}) => {
    events.push({
      client,
      post_id: postId,
      ts: now,
      actor: actor.actor,
      role: extra.role === undefined ? actor.role : extra.role || null,
      action,
      source: actor.source,
      ...extra,
    });
  };

  if (!existsAlready) {
    ev("create", { component: null, from_status: sv(existing, "status"), to_status: sv(inc, "status") || null });
  } else if (has(patch, "status") && sv(inc, "status") !== sv(existing, "status")) {
    if (sv(inc, "status").toLowerCase() === "archived") ev("archive", { component: null, from_status: sv(existing, "status"), to_status: sv(inc, "status") });
    else ev("status_change", { component: null, from_status: sv(existing, "status"), to_status: sv(inc, "status") });
  }

  for (const comp of ["video", "graphic", "caption", "title"]) {
    const col = comp + "_status";
    if (has(patch, col) && sv(inc, col) !== sv(existing, col)) {
      ev("status_change", { component: comp, from_status: sv(existing, col), to_status: sv(inc, col) });
    }
  }

  for (const comp of ["video", "graphic", "caption", "title"]) {
    const col = "client_" + comp + "_approved_at";
    if (has(patch, col) && sv(inc, col) && sv(inc, col) !== sv(existing, col)) {
      ev("approve_" + comp, { component: comp, role: "client" });
    }
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

  for (const [comp, col] of [["video", "linear_issue_id"], ["graphic", "graphic_linear_issue_id"]]) {
    if (!has(patch, col)) continue;
    const before = sv(existing, col);
    const after = sv(inc, col);
    if (after === before) continue;
    if (after && !before) ev("link_set", { component: comp, payload: { to: after } });
    else if (!after && before) ev("link_clear", { component: comp, payload: { from: before } });
    else ev("link_set", { component: comp, payload: { from: before, to: after } });
  }

  for (const [comp, col] of [["video", "video_tweaks"], ["graphic", "graphic_tweaks"], ["caption", "caption_tweaks"], ["title", "title_tweaks"]]) {
    if (!has(patch, col)) continue;
    const beforeActive = new Set(commentIds(existing[col]));
    const afterActive = commentIds(inc[col]);
    const added = afterActive.filter(x => !beforeActive.has(x));
    if (added.length) ev("comment_add", { component: comp, payload: { added } });
    const beforeAll = new Set(commentIds(existing[col], true));
    const afterDeleted = parseComments(inc[col]).filter(c => c.deleted && beforeAll.has(String(c.id))).map(c => String(c.id));
    if (afterDeleted.length) ev("comment_delete", { component: comp, payload: { deleted: afterDeleted } });
  }

  return events;
}

async function insertEvents(supabase: SupabaseClient, events: EventDraft[]): Promise<void> {
  if (!events.length) return;
  const { error } = await supabase.from("calendar_post_events").insert(events);
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
  const actor = actorFrom(req, body);
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
    const incomingLink = has(built.row, "linear_issue_id") ? clean(built.row.linear_issue_id) : "";
    const twins = await readLinkTwins(supabase, client, incomingLink);
    const guarded = applyGuards(built.row, existingRead.row, twins, existingRead.failed, Date.now());
    if (guarded._conflict === true) {
      outcome = guarded.conflict ? "conflict" : "read_failure";
      return json(guarded);
    }
    const post = stripPrivate(guarded);
    const existsAlready = !!(existingRead.row && existingRead.row.id);
    await writeCalendarRow(supabase, client, post, existsAlready);

    const events = buildEvents(client, post, built.row, existingRead.row, actor, isoNow());
    waitUntil(insertEvents(supabase, events));

    outcome = "ok";
    return json({ ok: true, post });
  } catch (e) {
    outcome = "error";
    const msg = e instanceof Error ? e.message : "request failed";
    const status = msg.indexOf("phantom-row guard") === 0 ? 400 : 500;
    return json({ ok: false, error: msg }, status);
  } finally {
    console.log(JSON.stringify({
      fn: "calendar-upsert",
      action: "upsert",
      client,
      id,
      actor: actor.actor,
      role: actor.role,
      outcome,
      ms: Date.now() - started,
    }));
  }
});
