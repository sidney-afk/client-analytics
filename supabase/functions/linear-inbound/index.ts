// Supabase Edge Function: linear-inbound
//
// Track B B3 dark inbound engine. Linear webhooks are not pointed here yet, and
// the live `linear_inbound_enabled` flag defaults false. With the flag false this
// function verifies the delivery, acknowledges it, logs only, and performs no
// data writes.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clearArchiveMarkers } from "./restore-markers.mjs";

type JsonMap = Record<string, unknown>;
type ExistingRow = Record<string, unknown>;

const FLAG_KEY = "linear_inbound_enabled";
const REPLAY_WINDOW_MS = 60_000;
const SIGNATURE_HEADER = "linear-signature";
const SIGNING_SECRET_ENV = "LINEAR_INBOUND_SIGNING_SECRET";
const STATE_UUID_MAP_ENV = "LINEAR_STATE_UUID_MAP";
const LEGACY_COMMENT_ACTORS_ENV = "LINEAR_LEGACY_COMMENT_ACTORS";
const ALERT_WEBHOOK_ENV = "SLACK_ALERT_WEBHOOK";
const ALERT_THROTTLE_MS = 60 * 60 * 1000;
const SYNCVIEW_COMMENT_PREFIX = /^\*\*.+ \(via SyncView\):\*\*/;
const CLAMPED_SAMPLE_STATES = new Set(["scheduled", "posted"]);
const STATUS_SLUGS = new Set([
  "triage", "backlog", "todo", "in_progress", "smm_approval", "kasper_approval",
  "client_approval", "tweak", "approved", "scheduled", "posted", "canceled", "duplicate",
]);
const lastAlertAt = new Map<string, number>();

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clean(v: unknown): string {
  return String(v == null ? "" : v).trim();
}

function lower(v: unknown): string {
  return clean(v).toLowerCase();
}

function has(o: JsonMap | ExistingRow | null | undefined, k: string): boolean {
  return !!o && Object.prototype.hasOwnProperty.call(o, k);
}

function normText(v: unknown): string {
  return lower(v).replace(/\s+/g, " ");
}

function parseJson(value: unknown): JsonMap {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as JsonMap;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonMap : {};
  } catch (_e) {
    return {};
  }
}

function parseArray(value: unknown): JsonMap[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(x => x && typeof x === "object") as JsonMap[];
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter(x => x && typeof x === "object") as JsonMap[] : [];
  } catch (_e) {
    return [];
  }
}

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, textEncoder().encode(body)));
}

function normalizeSignature(sig: string): string {
  const first = clean(sig).split(",")[0] || "";
  return first.replace(/^sha256=/i, "").trim().toLowerCase();
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = textEncoder().encode(a);
  const right = textEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function signingSecrets(): string[] {
  return clean(Deno.env.get(SIGNING_SECRET_ENV)).split(",").map(clean).filter(Boolean);
}

async function verifySignature(headers: Headers, rawBody: string): Promise<boolean> {
  const secrets = signingSecrets();
  const provided = normalizeSignature(headers.get(SIGNATURE_HEADER) || headers.get("Linear-Signature") || "");
  if (!secrets.length || !provided) return false;
  let matched = false;
  for (const secret of secrets) {
    const expected = await hmacSha256Hex(secret, rawBody);
    matched = timingSafeEqual(expected, provided) || matched;
  }
  return matched;
}

function webhookTimestampMs(payload: JsonMap): number {
  const raw = clean(payload.webhookTimestamp || payload.webhook_timestamp || payload.createdAt || "");
  if (!raw) return NaN;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n > 10_000_000_000 ? n : n * 1000;
  return Date.parse(raw);
}

function isFreshDelivery(payload: JsonMap, nowMs = Date.now()): boolean {
  const ts = webhookTimestampMs(payload);
  return Number.isFinite(ts) && Math.abs(nowMs - ts) <= REPLAY_WINDOW_MS;
}

async function readRuntimeFlag(supabase: SupabaseClient, key: string): Promise<JsonMap> {
  const { data, error } = await supabase.from("syncview_runtime_flags")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) return {};
  return parseJson(data && (data as JsonMap).value);
}

async function inboundEnabled(supabase: SupabaseClient): Promise<boolean> {
  const flag = await readRuntimeFlag(supabase, FLAG_KEY);
  return flag.enabled === true;
}

async function prodAuthority(supabase: SupabaseClient): Promise<JsonMap> {
  return await readRuntimeFlag(supabase, "prod_authority");
}

function envJson(name: string): JsonMap {
  return parseJson(Deno.env.get(name) || "{}");
}

function stateUuidMap(): Record<string, string> {
  const out: Record<string, string> = {};
  const configured = envJson(STATE_UUID_MAP_ENV);
  for (const [k, v] of Object.entries(configured)) {
    const key = lower(k);
    const slug = lower(v);
    if (key && STATUS_SLUGS.has(slug)) out[key] = slug;
  }
  return out;
}

function statusFromName(name: unknown): string {
  const n = normText(name);
  if (!n) return "";
  if (n.includes("triage")) return "triage";
  if (n.includes("backlog")) return "backlog";
  if (n === "todo" || n.includes("to do")) return "todo";
  if (n.includes("progress")) return "in_progress";
  if (n.includes("smm")) return "smm_approval";
  if (n.includes("kasper")) return "kasper_approval";
  if (n.includes("tweak")) return "tweak";
  if (n.includes("client")) return "client_approval";
  if (n.includes("approved")) return "approved";
  if (n.includes("scheduled")) return "scheduled";
  if (n.includes("posted")) return "posted";
  if (n.includes("cancel")) return "canceled";
  if (n.includes("duplicate")) return "duplicate";
  return "";
}

function mapLinearState(state: JsonMap): { slug: string; unmapped_state?: JsonMap; mapped_by?: string } {
  const id = lower(state.id);
  const map = stateUuidMap();
  if (id && map[id]) return { slug: map[id], mapped_by: "uuid" };
  for (const [prefix, slug] of Object.entries(map)) {
    if (id && id.startsWith(prefix)) return { slug, mapped_by: "uuid_prefix" };
  }
  const byName = statusFromName(state.name);
  if (byName) return { slug: byName, mapped_by: "name" };
  return {
    slug: "",
    unmapped_state: { id: clean(state.id), name: clean(state.name), type: clean(state.type) },
  };
}

function alertPayload(type: string, issue: JsonMap, details: JsonMap = {}): JsonMap {
  const identifier = linearIdentifier(issue) || linearIssueUuid(issue) || "unknown";
  const team = teamFromIssue(issue) || "unknown";
  return {
    text: `[SyncView] linear-inbound ${type}: issue=${identifier} team=${team}`,
    syncview_alert: true,
    source: "linear-inbound",
    type,
    issue_identifier: identifier,
    team,
    details,
  };
}

async function postAnomalyAlert(type: string, issue: JsonMap, details: JsonMap = {}, nowMs = Date.now()): Promise<boolean> {
  const hook = clean(Deno.env.get(ALERT_WEBHOOK_ENV));
  if (!hook) return false;
  const last = lastAlertAt.get(type) || 0;
  if (nowMs - last < ALERT_THROTTLE_MS) return false;
  lastAlertAt.set(type, nowMs);
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alertPayload(type, issue, details)),
    });
    return true;
  } catch (_e) {
    return false;
  }
}

function issueFromPayload(payload: JsonMap): JsonMap {
  const data = payload.data && typeof payload.data === "object" ? payload.data as JsonMap : {};
  const issue = data.issue && typeof data.issue === "object" ? data.issue as JsonMap : data;
  return issue;
}

function commentFromPayload(payload: JsonMap): JsonMap {
  const data = payload.data && typeof payload.data === "object" ? payload.data as JsonMap : {};
  const comment = data.comment && typeof data.comment === "object" ? data.comment as JsonMap : data;
  return comment;
}

function payloadResource(payload: JsonMap): string {
  return lower(payload.type || payload.webhookType || payload.resource || payload.entity || payload.model || "");
}

function payloadAction(payload: JsonMap): string {
  return lower(payload.action || payload.type || "");
}

function teamFromIssue(issue: JsonMap): string {
  const team = issue.team && typeof issue.team === "object" ? issue.team as JsonMap : {};
  const key = lower(team.key || team.name || issue.teamKey || issue.teamName);
  if (key === "gra" || key.includes("graphic")) return "graphics";
  if (key === "vid" || key.includes("video")) return "video";
  return "";
}

function linearIssueUrl(issue: JsonMap): string {
  return clean(issue.url || issue.issueUrl || issue.link);
}

function linearIdentifier(issue: JsonMap): string {
  return clean(issue.identifier);
}

function linearIssueUuid(issue: JsonMap): string {
  return clean(issue.id || issue.uuid);
}

function baseDeliverableRow(existing: ExistingRow): JsonMap {
  return {
    id: clean(existing.id),
    batch_id: clean(existing.batch_id),
    client_slug: clean(existing.client_slug),
    team: clean(existing.team),
    kind: clean(existing.kind || "video"),
    title: clean(existing.title || "Untitled deliverable"),
  };
}

function mergeLinearRaw(existing: ExistingRow, issue: JsonMap, payload: JsonMap): JsonMap {
  const raw = parseJson(existing.linear_raw);
  const previousIssue = raw.issue && typeof raw.issue === "object" ? raw.issue as JsonMap : {};
  raw.issue = { ...issue };
  if (!has(issue, "parent") && previousIssue.parent !== undefined) {
    (raw.issue as JsonMap).parent = previousIssue.parent;
  }
  raw.inbound = {
    webhook_action: payloadAction(payload),
    webhook_timestamp: clean(payload.webhookTimestamp || payload.webhook_timestamp),
    delivery_id: clean(payload.id || payload.webhookId || payload.deliveryId),
  };
  return raw;
}

function appendAlias(existing: ExistingRow, issue: JsonMap): JsonMap {
  const aliases = parseJson(existing.linear_aliases);
  const list = Array.isArray(aliases.history) ? aliases.history as JsonMap[] : [];
  const next = {
    identifier: linearIdentifier(issue),
    url: linearIssueUrl(issue),
    team: teamFromIssue(issue),
    ts: new Date().toISOString(),
  };
  aliases.identifier = next.identifier;
  aliases.url = next.url;
  aliases.team = next.team;
  aliases.history = [...list, next].slice(-20);
  return aliases;
}

async function readDeliverableForIssue(supabase: SupabaseClient, issue: JsonMap): Promise<ExistingRow | null> {
  const uuid = linearIssueUuid(issue);
  if (uuid) {
    const { data } = await supabase.from("deliverables").select("*").eq("linear_issue_uuid", uuid).maybeSingle();
    if (data) return data as ExistingRow;
  }

  const identifier = linearIdentifier(issue);
  if (identifier) {
    const { data } = await supabase.from("deliverables").select("*").eq("linear_identifier", identifier).maybeSingle();
    if (data) return data as ExistingRow;
  }

  const url = linearIssueUrl(issue);
  if (url) {
    const { data } = await supabase.from("deliverables").select("*").eq("linear_issue_url", url).maybeSingle();
    if (data) return data as ExistingRow;
  }
  return null;
}

async function resolveAssignee(supabase: SupabaseClient, assignee: JsonMap | null | undefined): Promise<{ id: string | null; unknown?: JsonMap }> {
  if (!assignee) return { id: null };
  const linearUserId = clean(assignee.id);
  if (linearUserId) {
    const { data } = await supabase.from("team_members").select("id").eq("linear_user_id", linearUserId).maybeSingle();
    if (data && (data as JsonMap).id) return { id: clean((data as JsonMap).id) };
  }
  const email = lower(assignee.email);
  if (email) {
    const { data } = await supabase.from("team_members").select("id").eq("email", email).maybeSingle();
    if (data && (data as JsonMap).id) return { id: clean((data as JsonMap).id) };
  }
  return {
    id: null,
    unknown: { linear_user_id: linearUserId, email, name: clean(assignee.name || assignee.displayName) },
  };
}

function eventFor(existing: ExistingRow, action: string, payload: JsonMap, fromStatus?: string, toStatus?: string): JsonMap {
  return {
    deliverable_id: clean(existing.id),
    batch_id: clean(existing.batch_id),
    client_slug: clean(existing.client_slug),
    actor: "Linear webhook",
    role: "system",
    action: `mirror_in_${action}`,
    source: "mirror",
    from_status: fromStatus || "",
    to_status: toStatus || "",
    payload,
  };
}

async function writeDeliverableMirror(supabase: SupabaseClient, row: JsonMap, event: JsonMap): Promise<ExistingRow> {
  const { data, error } = await supabase.rpc("deliverable_write", { p_row: row, p_event: event });
  if (error) throw new Error("deliverable_write failed");
  return (data || {}) as ExistingRow;
}

async function writeBatchMirror(supabase: SupabaseClient, row: JsonMap, event: JsonMap): Promise<ExistingRow> {
  const { data, error } = await supabase.rpc("batch_write", { p_row: row, p_event: event });
  if (error) throw new Error("batch_write failed");
  return (data || {}) as ExistingRow;
}

async function recordDetectOnly(supabase: SupabaseClient, existing: ExistingRow, payload: JsonMap): Promise<void> {
  await supabase.from("deliverable_events").insert({
    deliverable_id: clean(existing.id),
    batch_id: clean(existing.batch_id),
    client_slug: clean(existing.client_slug),
    actor: "Linear webhook",
    role: "system",
    action: "foreign_write_detected",
    source: "mirror",
    payload,
  });
}

async function isDetectOnlyTeam(supabase: SupabaseClient, team: string): Promise<boolean> {
  const authority = await prodAuthority(supabase);
  return clean(authority[team]) === "supabase";
}

function isClampedState(existing: ExistingRow, slug: string): boolean {
  return clean(existing.origin) === "samples" && CLAMPED_SAMPLE_STATES.has(slug);
}

function linearRawWithFlag(existing: ExistingRow, issue: JsonMap, payload: JsonMap, flag: string, value: unknown): JsonMap {
  const raw = mergeLinearRaw(existing, issue, payload);
  raw[flag] = value;
  return raw;
}

async function maintainCardLinkage(supabase: SupabaseClient, deliverable: ExistingRow, issue: JsonMap): Promise<void> {
  const links = [linearIssueUrl(issue), linearIssueUuid(issue)].map(clean).filter(Boolean);
  if (!links.length) return;

  const directOrigin = clean(deliverable.origin);
  const directCardId = clean(deliverable.card_id);
  const directClient = clean(deliverable.client_slug);
  const directSlot = clean(deliverable.kind) === "thumbnail" ? "graphic_deliverable_id" : "video_deliverable_id";
  if ((directOrigin === "calendar" || directOrigin === "samples") && directCardId && directClient) {
    const table = directOrigin === "samples" ? "sample_reviews" : "calendar_posts";
    await supabase.from(table).update({ [directSlot]: clean(deliverable.id) }).eq("client", directClient).eq("id", directCardId);
  }

  for (const table of ["calendar_posts", "sample_reviews"]) {
    for (const link of links) {
      const { data } = await supabase.from(table)
        .select("client,id,linear_issue_id,graphic_linear_issue_id")
        .or(`linear_issue_id.eq.${link},graphic_linear_issue_id.eq.${link}`)
        .limit(10);
      for (const row of (Array.isArray(data) ? data as JsonMap[] : [])) {
        const slot = clean(row.graphic_linear_issue_id) === link ? "graphic_deliverable_id" : "video_deliverable_id";
        await supabase.from(table).update({ [slot]: clean(deliverable.id) })
          .eq("client", clean(row.client)).eq("id", clean(row.id));
      }
    }
  }
}

async function handleIssueEvent(supabase: SupabaseClient, payload: JsonMap): Promise<JsonMap> {
  const issue = issueFromPayload(payload);
  const existing = await readDeliverableForIssue(supabase, issue);
  if (!existing) {
    console.warn(JSON.stringify({ fn: "linear-inbound", repair: "missing_deliverable", issue: linearIdentifier(issue) || linearIssueUuid(issue) }));
    return { ok: true, ignored: "missing_deliverable" };
  }

  const row: JsonMap = baseDeliverableRow(existing);
  const eventPayload: JsonMap = { linear_issue_uuid: linearIssueUuid(issue), linear_identifier: linearIdentifier(issue) };
  const action = payloadAction(payload);
  let eventAction = "fields";

  if (await isDetectOnlyTeam(supabase, clean(existing.team))) {
    await recordDetectOnly(supabase, existing, { ...eventPayload, detect_only: true, issue });
    return { ok: true, detect_only: true };
  }

  if (action === "remove" || action === "delete") {
    row.linear_raw = linearRawWithFlag(existing, issue, payload, "webhook_delete", true);
    eventAction = "delete";
  } else {
    row.linear_issue_uuid = linearIssueUuid(issue) || clean(existing.linear_issue_uuid);
    row.linear_identifier = linearIdentifier(issue) || clean(existing.linear_identifier);
    row.linear_issue_url = linearIssueUrl(issue) || clean(existing.linear_issue_url);
    row.linear_aliases = appendAlias(existing, issue);
    row.linear_raw = mergeLinearRaw(existing, issue, payload);

    if (has(issue, "title")) row.title = clean(issue.title);
    if (has(issue, "description")) row.brief = clean(issue.description);
    if (has(issue, "dueDate")) row.due_date = clean(issue.dueDate);
    if (has(issue, "priority")) row.priority = issue.priority == null ? "" : String(issue.priority);

    const team = teamFromIssue(issue);
    if (team && team !== clean(existing.team)) {
      row.team = team;
      eventPayload.team_move = { from: clean(existing.team), to: team };
    }

    const state = issue.state && typeof issue.state === "object" ? issue.state as JsonMap : {};
    if (Object.keys(state).length) {
      const mapped = mapLinearState(state);
      if (mapped.slug) {
        if (isClampedState(existing, mapped.slug)) {
          row.linear_raw = linearRawWithFlag(existing, issue, payload, "clamped_state", mapped.slug);
          eventPayload.clamped = { status: mapped.slug, origin: clean(existing.origin) };
        } else {
          row.status = mapped.slug;
          eventAction = "status_change";
        }
      } else {
        row.linear_raw = linearRawWithFlag(existing, issue, payload, "unmapped_state", mapped.unmapped_state || state);
        eventPayload.unmapped_state = mapped.unmapped_state || state;
        console.warn(JSON.stringify({ fn: "linear-inbound", alert: "unmapped_state", state: eventPayload.unmapped_state }));
        await postAnomalyAlert("unmapped_state", issue, {
          state_id: clean(state.id),
          state_type: clean(state.type),
        });
      }
    }

    if (has(issue, "assignee")) {
      const assignee = issue.assignee && typeof issue.assignee === "object" ? issue.assignee as JsonMap : null;
      const resolved = await resolveAssignee(supabase, assignee);
      row.assignee_id = resolved.id || "";
      if (resolved.unknown) {
        row.linear_raw = linearRawWithFlag(existing, issue, payload, "unknown_assignee", resolved.unknown);
        eventPayload.unknown_assignee = resolved.unknown;
        await postAnomalyAlert("unknown_assignee", issue);
      }
      eventAction = eventAction === "status_change" ? eventAction : "assign";
    }

    if (has(issue, "parent")) {
      const parent = issue.parent && typeof issue.parent === "object" ? issue.parent as JsonMap : null;
      eventPayload.parent_change = parent ? { id: clean(parent.id), identifier: clean(parent.identifier), title: clean(parent.title) } : null;
    }

    if (issue.archivedAt || action === "archive") {
      row.linear_raw = linearRawWithFlag(existing, issue, payload, "archived", clean(issue.archivedAt || new Date().toISOString()));
      eventAction = "archive";
    } else if (action === "restore") {
      row.linear_raw = clearArchiveMarkers(linearRawWithFlag(existing, issue, payload, "restored", true));
      eventAction = "restore";
    }
  }

  const fromStatus = clean(existing.status);
  const toStatus = clean(row.status || existing.status);
  const written = await writeDeliverableMirror(supabase, row, eventFor(existing, eventAction, eventPayload, fromStatus, toStatus));
  await maintainCardLinkage(supabase, written, issue);
  return { ok: true, deliverable_id: clean(written.id), action: eventAction };
}

function legacyCommentActors(): string[] {
  const configured = clean(Deno.env.get(LEGACY_COMMENT_ACTORS_ENV));
  const raw = configured || "syncview";
  return raw.split(",").map(s => normText(s)).filter(Boolean);
}

function commentAuthor(comment: JsonMap): string {
  const user = comment.user && typeof comment.user === "object" ? comment.user as JsonMap : {};
  return clean(user.displayName || user.name || comment.author || comment.userName);
}

function commentAuthorKey(comment: JsonMap): string {
  const user = comment.user && typeof comment.user === "object" ? comment.user as JsonMap : {};
  return normText([user.email, user.displayName, user.name, comment.author, comment.userName].map(clean).filter(Boolean).join(" "));
}

function shouldDropEchoComment(comment: JsonMap): boolean {
  const body = clean(comment.body || comment.description || "");
  if (!SYNCVIEW_COMMENT_PREFIX.test(body)) return false;
  const authorKey = commentAuthorKey(comment);
  return legacyCommentActors().some(actor => actor && authorKey.includes(actor));
}

function pinnedCommentObject(comment: JsonMap): JsonMap {
  return {
    role: "editor",
    audience: "internal",
    is_tweak: false,
    done: false,
    round: null,
    parent_id: null,
    author: commentAuthor(comment) || "Linear",
    body: String(comment.body || comment.description || ""),
  };
}

async function hasRecentCommentEvent(supabase: SupabaseClient, deliverableId: string, commentId: string): Promise<boolean> {
  if (!commentId) return false;
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await supabase.from("deliverable_events")
    .select("payload")
    .eq("deliverable_id", deliverableId)
    .eq("source", "mirror")
    .eq("action", "mirror_in_comment_add")
    .gte("ts", since)
    .limit(50);
  return (Array.isArray(data) ? data : []).some(row => clean((row as JsonMap).payload && ((row as JsonMap).payload as JsonMap).linear_comment_id) === commentId);
}

async function handleCommentEvent(supabase: SupabaseClient, payload: JsonMap): Promise<JsonMap> {
  const comment = commentFromPayload(payload);
  if (shouldDropEchoComment(comment)) return { ok: true, dropped: "syncview_echo" };

  const issue = comment.issue && typeof comment.issue === "object" ? comment.issue as JsonMap : issueFromPayload(payload);
  const existing = await readDeliverableForIssue(supabase, issue);
  if (!existing) return { ok: true, ignored: "missing_deliverable" };

  const commentId = clean(comment.id);
  if (await hasRecentCommentEvent(supabase, clean(existing.id), commentId)) {
    return { ok: true, dropped: "duplicate_comment_event" };
  }

  if (await isDetectOnlyTeam(supabase, clean(existing.team))) {
    await recordDetectOnly(supabase, existing, { linear_comment_id: commentId, detect_only: true });
    return { ok: true, detect_only: true };
  }

  const thread = parseArray(existing.comments);
  const nextThread = [...thread, pinnedCommentObject(comment)];
  const row = {
    ...baseDeliverableRow(existing),
    comments: JSON.stringify(nextThread),
    linear_raw: linearRawWithFlag(existing, issue, payload, "last_linear_comment", { id: commentId, url: clean(comment.url) }),
  };
  const event = eventFor(existing, "comment_add", { linear_comment_id: commentId, image_urls: comment.imageUrls || comment.attachments || [] });
  const written = await writeDeliverableMirror(supabase, row, event);
  return { ok: true, deliverable_id: clean(written.id), action: "comment_add" };
}

async function handleLinearWebhook(supabase: SupabaseClient, payload: JsonMap): Promise<JsonMap> {
  const resource = payloadResource(payload);
  const action = payloadAction(payload);
  if (resource.includes("comment") || (commentFromPayload(payload).body !== undefined && action !== "remove")) {
    return await handleCommentEvent(supabase, payload);
  }
  if (resource.includes("issue") || issueFromPayload(payload).identifier !== undefined || action === "remove") {
    return await handleIssueEvent(supabase, payload);
  }
  return { ok: true, ignored: "unsupported_resource" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const raw = await req.text();
  if (!(await verifySignature(req.headers, raw))) {
    return json({ ok: false, error: "invalid signature" }, 401);
  }

  let payload: JsonMap;
  try {
    payload = JSON.parse(raw) as JsonMap;
  } catch (_e) {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  if (!isFreshDelivery(payload)) {
    return json({ ok: false, error: "stale delivery" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const enabled = await inboundEnabled(supabase);
  if (!enabled) {
    console.log(JSON.stringify({
      fn: "linear-inbound",
      outcome: "disabled",
      delivery_id: clean(payload.id || payload.webhookId || payload.deliveryId),
      resource: payloadResource(payload),
      action: payloadAction(payload),
    }));
    return json({ ok: true, disabled: true });
  }

  try {
    return json(await handleLinearWebhook(supabase, payload));
  } catch (e) {
    const message = e instanceof Error ? e.message : "linear inbound failed";
    console.error(JSON.stringify({ fn: "linear-inbound", outcome: "error", message }));
    return json({ ok: false, error: message }, 500);
  }
});
