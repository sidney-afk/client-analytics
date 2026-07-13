// Supabase Edge Function: linear-inbound
//
// Track B inbound engine. The live `linear_inbound_enabled` flag remains the
// kill switch; disabled deliveries are verified and acknowledged without mirror
// writes. Comment capture is normalized before any echo/loop suppression.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clearArchiveMarkers } from "./restore-markers.mjs";
import { normalizeLinearComment, parseSyncViewBridgeBody } from "./comment-normalize.mjs";

type JsonMap = Record<string, unknown>;
type ExistingRow = Record<string, unknown>;

const FLAG_KEY = "linear_inbound_enabled";
const REPLAY_WINDOW_MS = 60_000;
const SIGNATURE_HEADER = "linear-signature";
const SIGNING_SECRET_ENV = "LINEAR_INBOUND_SIGNING_SECRET";
const STATE_UUID_MAP_ENV = "LINEAR_STATE_UUID_MAP";
const ALERT_WEBHOOK_ENV = "SLACK_ALERT_WEBHOOK";
const ALERT_THROTTLE_MS = 60 * 60 * 1000;
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

function issueFromCommentPayload(payload: JsonMap, comment: JsonMap): JsonMap {
  if (comment.issue && typeof comment.issue === "object") return comment.issue as JsonMap;
  const data = objectAt(payload.data);
  if (data.issue && typeof data.issue === "object") return data.issue as JsonMap;
  return {
    id: clean(comment.issueId || data.issueId),
    identifier: clean(comment.issueIdentifier || data.issueIdentifier),
    team: comment.team || data.team || null,
  };
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
  const identifier = lower(issue.identifier);
  if (identifier.startsWith("gra-")) return "graphics";
  if (identifier.startsWith("vid-")) return "video";
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

function updateLinearFieldClocks(raw: JsonMap, payload: JsonMap, issue: JsonMap): void {
  const data = objectAt(payload.data);
  const updatedFrom = objectAt(payload.updatedFrom || data.updatedFrom);
  const changed = new Set(Object.keys(updatedFrom));
  const action = payloadAction(payload);
  const timestampMs = webhookTimestampMs(payload);
  const timestamp = Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : clean(issue.updatedAt);
  if (!timestamp) return;

  const clocks = parseJson(raw.field_updated_at);
  const mark = (field: string, keys: string[]): void => {
    if (keys.some(key => changed.has(key))) clocks[field] = timestamp;
  };
  mark("status", ["state", "stateId"]);
  mark("due", ["dueDate"]);
  mark("assignee", ["assignee", "assigneeId"]);
  mark("title", ["title"]);
  mark("priority", ["priority"]);
  mark("parent", ["parent", "parentId"]);
  if (["archive", "restore", "remove", "delete"].includes(action) || changed.has("archivedAt")) {
    clocks[action === "restore" ? "restore" : "archive"] = timestamp;
  }
  if (action === "create") {
    for (const [field, key] of [["status", "state"], ["due", "dueDate"], ["assignee", "assignee"], ["title", "title"], ["priority", "priority"], ["parent", "parent"]]) {
      if (has(issue, key)) clocks[field] = timestamp;
    }
  }
  raw.field_updated_at = clocks;
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
  updateLinearFieldClocks(raw, payload, issue);
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

async function readStoredComment(
  supabase: SupabaseClient,
  linearCommentId: string,
  nativeCommentId = "",
): Promise<ExistingRow | null> {
  const select = "id,native_comment_id,deliverable_id,batch_id,client_slug,team,origin,source,linear_comment_id,author_key,author_member_id,author_name,role,audience,body,body_format,attachments,parent_id,thread_root_id,component,is_tweak,round,source_created_at";
  if (linearCommentId) {
    const { data, error } = await supabase.from("production_comments")
      .select(select)
      .eq("linear_comment_id", linearCommentId)
      .maybeSingle();
    if (error) throw new Error("production comment lookup failed");
    if (data) return data as ExistingRow;
  }
  if (!nativeCommentId) return null;
  const { data, error } = await supabase.from("production_comments")
    .select(select)
    .or(`id.eq.${nativeCommentId},native_comment_id.eq.${nativeCommentId}`)
    .limit(2);
  if (error) throw new Error("production native comment lookup failed");
  if (!Array.isArray(data) || data.length !== 1) return null;
  return data[0] as ExistingRow;
}

async function readBatchForIssue(supabase: SupabaseClient, issue: JsonMap): Promise<ExistingRow | null> {
  const uuid = linearIssueUuid(issue);
  const identifier = linearIdentifier(issue);
  if (!uuid && !identifier) return null;

  const issueTeam = teamFromIssue(issue);
  const teamKeys = issueTeam ? [issueTeam] : ["video", "graphics"];
  const probes: JsonMap[] = [];
  for (const team of teamKeys) {
    if (uuid) {
      probes.push({ [team]: { uuid } }, { [team]: { id: uuid } }, { [team]: uuid });
    }
    if (identifier) probes.push({ [team]: { identifier } });
  }

  const matches = new Map<string, ExistingRow>();
  for (const probe of probes) {
    const { data, error } = await supabase.from("batches")
      .select("id,client_slug,team,linear_parent_ids")
      .contains("linear_parent_ids", probe)
      .limit(2);
    if (error) throw new Error("production comment batch lookup failed");
    for (const row of Array.isArray(data) ? data : []) {
      const item = row as ExistingRow;
      const id = clean(item.id);
      if (id) matches.set(id, item);
    }
  }
  if (matches.size > 1) throw new Error("production comment batch target is ambiguous");
  return matches.values().next().value || null;
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
  const key = lower(team) === "graphics" || lower(team) === "graphic" ? "graphics" : "video";
  const value = lower(authority[key]);
  return value === "syncview" || value === "supabase";
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

function commentAuthor(comment: JsonMap): string {
  const user = comment.user && typeof comment.user === "object" ? comment.user as JsonMap : {};
  return clean(user.displayName || user.name || comment.author || comment.userName);
}

function outboundMarker(body: unknown): string {
  const match = String(body == null ? "" : body).match(/<!--\s*syncview-mirror:([^>]+?)\s*-->/i);
  return match ? clean(match[1]) : "";
}

function objectAt(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function webhookActorId(payload: JsonMap, issue: JsonMap, comment: JsonMap): string {
  const candidates = [
    objectAt(payload.actor).id,
    objectAt(payload.user).id,
    objectAt(payload.webhookActor).id,
    objectAt(issue.updatedBy).id,
    objectAt(comment.user).id,
  ];
  return candidates.map(clean).find(Boolean) || "";
}

function outboundExpected(row: JsonMap): JsonMap {
  const result = parseJson(row.linear_result);
  const variables = parseJson(result.expected);
  return parseJson(variables.input);
}

function outboundValueMatches(row: JsonMap, payload: JsonMap, issue: JsonMap, comment: JsonMap): boolean {
  const operation = lower(row.operation);
  const expected = outboundExpected(row);
  const action = payloadAction(payload);
  if (operation === "comment") {
    const result = parseJson(row.linear_result);
    const commentId = clean(comment.id);
    return (clean(result.comment_id) && clean(result.comment_id) === commentId)
      || (!!outboundMarker(comment.body) && outboundMarker(comment.body) === clean(row.dedup_key));
  }
  if (operation === "create") return action === "create";
  if (operation === "status") return clean(objectAt(issue.state).id) === clean(expected.stateId);
  if (operation === "due") return clean(issue.dueDate) === clean(expected.dueDate);
  if (operation === "assignee") return clean(objectAt(issue.assignee).id) === clean(expected.assigneeId);
  if (operation === "title") return clean(issue.title) === clean(expected.title);
  if (operation === "priority") return Number(issue.priority || 0) === Number(expected.priority || 0);
  if (operation === "parent") return clean(objectAt(issue.parent).id) === clean(expected.parentId);
  if (operation === "archive") return action === "archive" || !!issue.archivedAt;
  if (operation === "restore") return action === "restore" && !issue.archivedAt;
  return false;
}

async function recentOutboundEcho(
  supabase: SupabaseClient,
  payload: JsonMap,
): Promise<JsonMap | null> {
  const comment = commentFromPayload(payload);
  const resource = payloadResource(payload);
  const action = payloadAction(payload);
  const isCommentEvent = resource.includes("comment")
    || (comment.body !== undefined && action !== "remove");
  // Issue webhooks carry the issue directly in data. Treating that data as a
  // comment loses data.id and makes every scalar echo impossible to match.
  const issue = isCommentEvent
    ? issueFromCommentPayload(payload, comment)
    : issueFromPayload(payload);
  const issueId = linearIssueUuid(issue);
  const actorId = webhookActorId(payload, issue, comment);
  if (!issueId) return null;

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,entity_id,client_slug,operation,comment_id,dedup_key,payload,linear_result,status,processed_at,updated_at")
    .in("status", ["pending", "shadow_ok", "written", "failed"])
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) return null;

  for (const candidate of Array.isArray(data) ? data : []) {
    const row = candidate as JsonMap;
    const result = parseJson(row.linear_result);
    if (clean(result.issue_id) !== issueId) continue;
    if (!outboundValueMatches(row, payload, issue, comment)) continue;
    const actorMatches = !!actorId
      && !!clean(result.mirror_actor_id)
      && clean(result.mirror_actor_id) === actorId;
    // Linear issue webhooks do not consistently expose the API-key viewer as
    // their actor. A terminal outbox row plus the exact issue and exact value
    // is still a durable echo proof: the native ledger already owns the human
    // actor, and applying that transport echo would only advance the CAS clock.
    // Pending rows still require an actor match so a coincident external write
    // cannot be suppressed before our mutation has been acknowledged.
    const terminalValueProof = lower(row.status) === "written" && !!clean(row.processed_at);
    if (!actorMatches && !terminalValueProof) continue;
    return row;
  }
  return null;
}

async function recordOutboundEchoDrop(
  supabase: SupabaseClient,
  row: JsonMap,
  payload: JsonMap,
): Promise<void> {
  const issue = issueFromPayload(payload);
  const existing = await readDeliverableForIssue(supabase, issue);
  await supabase.from("deliverable_events").insert({
    deliverable_id: clean(existing && existing.id) || clean(row.entity_id) || null,
    batch_id: clean(existing && existing.batch_id) || null,
    client_slug: clean(existing && existing.client_slug) || clean(row.client_slug) || "_system",
    actor: "SyncView Mirror",
    role: "system",
    action: "mirror_out_echo_dropped",
    source: "outbound",
    payload: {
      outbox_id: Number(row.id || 0),
      operation: clean(row.operation),
      delivery_id: clean(payload.webhookId || payload.deliveryId || payload.id),
    },
  });
}

async function resolveCommentMember(supabase: SupabaseClient, comment: JsonMap): Promise<JsonMap | null> {
  const user = objectAt(comment.user);
  const linearUserId = clean(user.id);
  const bridge = parseSyncViewBridgeBody(comment.body || comment.description || "");
  if (!bridge.bridge_authored && linearUserId) {
    const { data } = await supabase.from("team_members")
      .select("id,name,role")
      .eq("linear_user_id", linearUserId)
      .eq("active", true)
      .maybeSingle();
    if (data) return data as JsonMap;
  }
  if (!bridge.bridge_author_name) return null;
  const { data } = await supabase.from("team_members").select("id,name,role").eq("active", true);
  const target = normText(bridge.bridge_author_name);
  return ((Array.isArray(data) ? data : []) as JsonMap[]).find(row => normText(row.name) === target) || null;
}

async function persistProductionComment(
  supabase: SupabaseClient,
  payload: JsonMap,
  comment: JsonMap,
  issue: JsonMap,
  existing: ExistingRow | null,
  echo: JsonMap | null,
): Promise<JsonMap> {
  const action = payloadAction(payload);
  const member = await resolveCommentMember(supabase, comment);
  const normalized = normalizeLinearComment({ comment, issue, payload, action, member, echo });
  const existingComment = await readStoredComment(
    supabase,
    clean(normalized.linear_comment_id),
    echo ? clean(normalized.native_comment_id) : "",
  );
  if (!existingComment && !clean(normalized.author_key)) {
    // A first-seen tombstone can legitimately contain only IDs. Retain it with
    // an explicit unknown snapshot; never apply this fallback over a stored
    // human identity.
    normalized.author_key = `linear-name:unknown-author`;
    normalized.author_name = "Unknown author";
    normalized.role = "linear";
    normalized.transport_actor = "Linear";
    normalized.transport_role = "linear_webhook";
  }
  const lifecycleOnly = ["remove", "delete", "archive"].includes(action);
  if (echo && existingComment) {
    // A fast outbound echo links the Linear transport identity to the native
    // comment. It must never reclassify a client-visible native thread as an
    // internal bridge comment or replace its stable human author/body.
    for (const field of [
      "native_comment_id", "body", "body_format", "attachments",
      "author_key", "author_member_id", "author_name", "role", "audience",
      "origin", "source", "parent_id", "thread_root_id", "component",
      "is_tweak", "round", "source_created_at", "edited_at",
    ]) delete normalized[field];
  }
  if (existingComment && lifecycleOnly) {
    // Linear removal payloads are allowed to omit body and human identity. A
    // tombstone changes lifecycle state only; it must not erase the durable
    // author/body snapshot captured by create, edit, or historical backfill.
    for (const field of [
      "body", "body_format", "author_key", "author_member_id", "author_name", "role",
      "linear_author_id", "transport_linear_user_id", "transport_actor", "transport_role",
      "audience", "origin", "source_created_at",
    ]) delete normalized[field];
  }
  const linearParentId = clean(normalized.linear_parent_comment_id);
  if (linearParentId) {
    const { data: parent } = await supabase.from("production_comments")
      .select("id,thread_root_id,linear_comment_id,linear_thread_root_id")
      .eq("linear_comment_id", linearParentId)
      .maybeSingle();
    if (parent) {
      const parentRow = parent as JsonMap;
      normalized.parent_id = clean(parentRow.id) || null;
      normalized.thread_root_id = clean(parentRow.thread_root_id || parentRow.id) || null;
      normalized.linear_thread_root_id = clean(
        parentRow.linear_thread_root_id || parentRow.linear_comment_id,
      ) || linearParentId;
    }
  }
  const storedDeliverableId = clean(existingComment && existingComment.deliverable_id);
  const storedBatchId = clean(existingComment && existingComment.batch_id);
  const batch = !storedDeliverableId && !storedBatchId && !existing
    ? await readBatchForIssue(supabase, issue) : null;
  const targetDeliverableId = storedDeliverableId || (existing ? clean(existing.id) : "");
  const targetBatchId = storedBatchId || (!targetDeliverableId && batch ? clean(batch.id) : "");
  const targetClientSlug = clean(
    existingComment && existingComment.client_slug
      || existing && existing.client_slug
      || batch && batch.client_slug,
  );
  const targetTeam = clean(
    existingComment && existingComment.team
      || existing && existing.team
      || batch && batch.team
      || teamFromIssue(issue),
  );
  const pComment = {
    ...normalized,
    ...(targetDeliverableId ? { deliverable_id: targetDeliverableId } : {}),
    ...(targetBatchId ? { batch_id: targetBatchId } : {}),
    ...(targetClientSlug ? { client_slug: targetClientSlug } : {}),
    ...(targetTeam ? { team: targetTeam } : {}),
  };
  const pEvent = {
    action: action === "remove" || action === "delete" ? "mirror_in_comment_delete"
      : action === "update" ? "mirror_in_comment_edit" : "mirror_in_comment_add",
    source: "mirror",
    payload: {
      delivery_id: clean(payload.webhookId || payload.deliveryId || payload.id) || null,
      echo_suppressed: !!echo,
    },
  };
  const { data, error } = await supabase.rpc("production_comment_upsert", {
    p_comment: pComment,
    p_event: pEvent,
  });
  if (error) throw new Error("production_comment_upsert failed");
  return (data || pComment) as JsonMap;
}

async function handleCommentEvent(supabase: SupabaseClient, payload: JsonMap, echo: JsonMap | null = null): Promise<JsonMap> {
  const comment = commentFromPayload(payload);
  const issue = issueFromCommentPayload(payload, comment);
  const existing = await readDeliverableForIssue(supabase, issue);
  const commentId = clean(comment.id);
  const stored = await persistProductionComment(supabase, payload, comment, issue, existing, echo);

  if (existing && await isDetectOnlyTeam(supabase, clean(existing.team))) {
    await recordDetectOnly(supabase, existing, { linear_comment_id: commentId, detect_only: true });
    return { ok: true, stored: true, comment_id: clean(stored.id), detect_only: true };
  }
  if (echo) {
    await recordOutboundEchoDrop(supabase, echo, payload);
  }
  return {
    ok: true,
    stored: true,
    comment_id: clean(stored.id),
    deliverable_id: existing ? clean(existing.id) : null,
    action: payloadAction(payload) || "create",
    echo_suppressed: !!echo,
  };
}

async function handleLinearWebhook(supabase: SupabaseClient, payload: JsonMap): Promise<JsonMap> {
  const resource = payloadResource(payload);
  const action = payloadAction(payload);
  if (resource.includes("comment") || (commentFromPayload(payload).body !== undefined && action !== "remove")) {
    // Echo detection is now linkage/loop metadata only. Every Linear comment,
    // including house-authored `(via SyncView)` bridges, is persisted first.
    return await handleCommentEvent(supabase, payload, await recentOutboundEcho(supabase, payload));
  }
  const echo = await recentOutboundEcho(supabase, payload);
  if (echo) {
    await recordOutboundEchoDrop(supabase, echo, payload);
    return { ok: true, dropped: "syncview_mirror_echo", outbox_id: Number(echo.id || 0) };
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
