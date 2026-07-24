// Supabase Edge Function: linear-outbound
//
// Service-only B4 outbox drainer. Normal calls obey both
// linear_outbound_enabled (off/shadow/live) and prod_authority per team.
// A service-role-authenticated TEST override is accepted only for rows already
// marked test_only and belonging to clients.kind='test'.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  buildMutation,
  completeCreateIssueLabels,
  decideConflict,
  exactCreateIssueLabelIds,
  extractMutationResult,
  issueFields,
  markerFromBody,
  mergeBatchParentIds,
  stateIdForSlug,
  terminalCreateDependencyConflict,
} from "./mapping.mjs";
import {
  pendingAgeAlertTeams,
  pendingAgeThresholdMinutes,
} from "./monitoring.mjs";
import {
  bindF27LinearResult,
  bindF27ReplayScope,
  f27ReplayRequest,
  hasExactF27DrillStops,
  isExactF27DrillAuthority,
  isExactF27DrillReceipt,
} from "./f27-replay.mjs";
import {
  deterministicLinearCreateId,
} from "../_shared/linear-create-id.mjs";

type JsonMap = Record<string, unknown>;
type OutboxRow = JsonMap & {
  id: number;
  entity: string;
  entity_id: string;
  operation: string;
  client_slug: string;
  team: string;
  dedup_key: string;
  source_edited_at: string;
  status: string;
  attempts: number;
  payload: JsonMap;
  test_only: boolean;
  legacy_parity: boolean;
  deliverable_id?: string | null;
  batch_id?: string | null;
  depends_on_id?: number | null;
  linear_result?: JsonMap | null;
  lock_token?: string | null;
  f27_drill_rollback_id?: string | null;
};

const LINEAR_URL = "https://api.linear.app/graphql";
const OUTBOUND_FLAG = "linear_outbound_enabled";
const AUTHORITY_FLAG = "prod_authority";
const LEGACY_PARITY_FLAG = "linear_legacy_parity_enabled";
const PENDING_AGE_ALERT_FLAG = "linear_outbound_pending_age_alert";
const LEGACY_PARITY_OPERATIONS = new Set(["create", "status", "comment"]);
const MAX_LIMIT = 50;
const MAX_ATTEMPTS = 8;
const RATE_DELAY_MS = 1_000;
const LOCK_TIMEOUT_MS = 10 * 60 * 1_000;
const BACKLOG_ALERT_THRESHOLD = 100;
const VOLUME_ALERT_THRESHOLD = 50;
const DEFAULT_PENDING_AGE_ALERT_MINUTES = 30;

function clean(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function lower(value: unknown): string {
  return clean(value).toLowerCase();
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

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value == null ? "[]" : value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function json(body: JsonMap, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeError(error: unknown): string {
  return clean(error instanceof Error ? error.message : error).slice(0, 500) || "outbound failure";
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bearer(req: Request): string {
  return clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
}

async function serviceRoleRequest(req: Request): Promise<boolean> {
  const expected = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const supplied = bearer(req);
  if (!supplied) return false;
  if (expected && timingSafeEqual(expected, supplied)) return true;

  // Supabase can rotate the public service-role key before the Edge runtime's
  // built-in value refreshes. Validate the presented key against a table whose
  // grants/RLS admit service_role only; this remains cryptographic and fail-closed.
  const url = clean(Deno.env.get("SUPABASE_URL"));
  if (!url) return false;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/b4_service_role_probe`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${supplied}`,
        apikey: supplied,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) return false;
    return await response.json() === true;
  } catch (_e) {
    return false;
  }
}

function modeFrom(value: unknown): string {
  const mode = lower(parseJson(value).mode);
  return ["off", "shadow", "live"].includes(mode) ? mode : "off";
}

function authorityFor(team: unknown, value: unknown): string {
  const flags = parseJson(value);
  const normalizedTeam = lower(team);
  const key = ["graphics", "graphic", "gra", "thumbnail"].includes(normalizedTeam)
    ? "graphics"
    : ["video", "vid"].includes(normalizedTeam)
      ? "video"
      : "";
  if (!key) return "";
  const raw = lower(flags[key]);
  if (raw === "syncview" || raw === "supabase") return "syncview";
  return raw === "linear" ? "linear" : "";
}

async function readFlag(supabase: SupabaseClient, key: string): Promise<JsonMap> {
  const { data, error } = await supabase.from("syncview_runtime_flags")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) throw new Error(`runtime flag unavailable: ${key}`);
  const value = (data as JsonMap).value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`runtime flag malformed: ${key}`);
  }
  return value as JsonMap;
}

async function linearGraphql(query: string, variables: JsonMap): Promise<JsonMap> {
  const key = clean(Deno.env.get("LINEAR_MIRROR_API_KEY"));
  if (!key) throw new Error("LINEAR_MIRROR_API_KEY unavailable");
  const response = await fetch(LINEAR_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: key,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => null) as JsonMap | null;
  if (!response.ok || !body || Array.isArray(body.errors)) {
    const retryAfter = response.headers.get("retry-after");
    const suffix = retryAfter ? " retry-after=" + retryAfter : "";
    const first = body && Array.isArray(body.errors) ? parseJson(body.errors[0]) : {};
    const extensions = parseJson(first.extensions);
    const detail = [clean(extensions.type || extensions.code), clean(first.message)]
      .filter(Boolean)
      .join(": ")
      .replace(/[^a-zA-Z0-9 _.:/-]/g, "")
      .slice(0, 240);
    throw new Error("Linear GraphQL HTTP " + response.status + suffix + (detail ? " " + detail : ""));
  }
  return parseJson(body.data);
}

async function readViewer(): Promise<JsonMap> {
  const data = await linearGraphql(
    "query SyncViewMirrorViewer { viewer { id name email } }",
    {},
  );
  return parseJson(data.viewer);
}

async function readIssue(id: string, allowMissing = false): Promise<JsonMap | null> {
  if (!id) return null;
  try {
    const data = await linearGraphql(
      "query SyncViewMirrorIssue($id: String!) { issue(id: $id) { " + issueFields() + " } }",
      { id },
    );
    const issue = data.issue;
    return issue && typeof issue === "object" && !Array.isArray(issue) ? issue as JsonMap : null;
  } catch (error) {
    if (allowMissing && /\b(entity|issue|resource) not found\b/i.test(safeError(error))) return null;
    throw error;
  }
}

async function readLinearComment(id: string, allowMissing = false): Promise<JsonMap | null> {
  if (!id) return null;
  try {
    const data = await linearGraphql(
      "query SyncViewMirrorComment($id: String!) { comment(id: $id) { id body createdAt updatedAt issue { id identifier updatedAt } } }",
      { id },
    );
    const comment = data.comment;
    return comment && typeof comment === "object" && !Array.isArray(comment)
      ? comment as JsonMap
      : null;
  } catch (error) {
    if (allowMissing && /\b(entity|comment|resource) not found\b/i.test(safeError(error))) return null;
    throw error;
  }
}

async function readCommentByMarker(issueId: string, dedupKey: string): Promise<JsonMap | null> {
  if (!issueId || !dedupKey) return null;
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const data = await linearGraphql(
      "query SyncViewMirrorIssueComments($id: String!, $after: String) { issue(id: $id) { comments(first: 100, after: $after) { nodes { id body createdAt updatedAt issue { id identifier updatedAt } } pageInfo { hasNextPage endCursor } } } }",
      { id: issueId, after },
    );
    const connection = parseJson(parseJson(data.issue).comments);
    const nodes = Array.isArray(connection.nodes) ? connection.nodes : [];
    const match = nodes.find(item =>
      markerFromBody(parseJson(item).body) === clean(dedupKey)
    );
    if (match && typeof match === "object" && !Array.isArray(match)) return match as JsonMap;
    const pageInfo = parseJson(connection.pageInfo);
    if (pageInfo.hasNextPage !== true) return null;
    const next = clean(pageInfo.endCursor);
    if (!next || next === after) throw new Error("comment marker pagination stalled");
    after = next;
  }
  throw new Error("comment marker pagination exceeded");
}

async function readTeam(id: string): Promise<JsonMap | null> {
  if (!id) return null;
  const data = await linearGraphql(
    "query SyncViewMirrorTeam($id: String!) { team(id: $id) { id key name states { nodes { id name type position } } } }",
    { id },
  );
  const team = data.team;
  return team && typeof team === "object" && !Array.isArray(team) ? team as JsonMap : null;
}

const teamByKeyCache = new Map<string, JsonMap>();
async function readTeamByRowTeam(value: unknown): Promise<JsonMap | null> {
  const rowTeam = lower(value);
  const key = ["graphics", "graphic", "gra"].includes(rowTeam)
    ? "GRA"
    : ["video", "vid"].includes(rowTeam)
      ? "VID"
      : "";
  if (!key) return null;
  const cached = teamByKeyCache.get(key);
  if (cached) return cached;
  const data = await linearGraphql(
    "query SyncViewMirrorTeams { teams(first: 50) { nodes { id key name states { nodes { id name type position } } } } }",
    {},
  );
  const teams = parseJson(data.teams);
  const nodes = Array.isArray(teams.nodes) ? teams.nodes : [];
  const found = nodes.find((item) => clean(parseJson(item).key).toUpperCase() === key);
  if (!found || typeof found !== "object" || Array.isArray(found)) return null;
  const team = found as JsonMap;
  teamByKeyCache.set(key, team);
  return team;
}

function projectIds(value: unknown): Set<string> {
  const out = new Set<string>();
  const stack = parseArray(value);
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === "string" && clean(current)) out.add(clean(current));
    else if (current && typeof current === "object") {
      const row = current as JsonMap;
      for (const key of ["id", "project_id", "linear_project_id"]) {
        if (clean(row[key])) out.add(clean(row[key]));
      }
      for (const child of Object.values(row)) if (Array.isArray(child)) stack.push(...child);
    }
  }
  return out;
}

function configuredTestProjectIds(): Set<string> {
  return new Set(clean(Deno.env.get("B4_TEST_PROJECT_IDS"))
    .split(",")
    .map(clean)
    .filter(Boolean));
}

async function testScope(
  supabase: SupabaseClient,
  row: OutboxRow,
  issue: JsonMap | null,
): Promise<JsonMap> {
  if (!row.test_only) throw new Error("TEST override requires test_only outbox rows");
  const { data, error } = await supabase.from("clients")
    .select("slug,kind,active,linear_project_ids")
    .eq("slug", row.client_slug)
    .maybeSingle();
  if (error || !data || data.kind !== "test" || data.active !== true) {
    throw new Error("TEST override client is not an active test client");
  }
  const allowed = projectIds(data.linear_project_ids);
  for (const id of configuredTestProjectIds()) allowed.add(id);
  const payload = parseJson(row.payload);
  const issueProject = clean(issue && issue.project && (issue.project as JsonMap).id);
  const createProject = clean(payload.project_id);
  const project = issueProject || createProject;
  if (!project || !allowed.has(project)) throw new Error("TEST override project mismatch");
  return { client_slug: data.slug, project_ids: [...allowed] };
}

async function entityRow(supabase: SupabaseClient, row: OutboxRow): Promise<JsonMap> {
  const table = row.entity === "batch" || (row.entity === "comment" && row.batch_id && !row.deliverable_id)
    ? "batches"
    : "deliverables";
  const { data, error } = await supabase.from(table)
    .select("*")
    .eq("id", row.entity_id)
    .maybeSingle();
  if (error || !data) throw new Error("outbox entity row missing");
  return data as JsonMap;
}

function batchParentId(row: OutboxRow, entity: JsonMap): string {
  const wanted = lower(row.team) === "graphics" || lower(row.team) === "graphic" ? "graphics" : "video";
  const raw = entity.linear_parent_ids;
  const parsed = typeof raw === "string" ? parseJson(raw) : raw;
  const parents = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object"
      ? Object.entries(parsed as JsonMap).map(([team, value]) => value && typeof value === "object"
        ? { team, ...(value as JsonMap) }
        : { team, id: value })
      : []);
  const matching = parents.find(value => {
    if (!value || typeof value !== "object") return false;
    const item = value as JsonMap;
    const team = lower(item.team || item.team_key || item.key);
    return team === wanted || (wanted === "graphics" && (team === "gra" || team === "graphic")) || (wanted === "video" && team === "vid");
  });
  const selected = matching || parents[0];
  return clean(selected && typeof selected === "object"
    ? ((selected as JsonMap).id || (selected as JsonMap).uuid || (selected as JsonMap).linear_issue_id)
    : selected);
}

function linearIssueId(row: OutboxRow, entity: JsonMap, _dependency: JsonMap): string {
  const payload = parseJson(row.payload);
  const priorResult = parseJson(row.linear_result);
  return clean(
    payload.linear_issue_id
      || entity.linear_issue_uuid
      || batchParentId(row, entity)
      || priorResult.issue_id,
  );
}

async function dependencyResult(supabase: SupabaseClient, row: OutboxRow): Promise<JsonMap> {
  const id = Number(row.depends_on_id || 0);
  if (!id) return {};
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,status,operation,entity,entity_id,linear_result")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error("outbox dependency missing");
  const result = parseJson(data.linear_result);
  if (terminalCreateDependencyConflict(data)) {
    return {
      terminal_create_conflict: true,
      status: data.status,
      dependency_outbox_id: Number(data.id),
      dependency_entity_id: clean(data.entity_id),
      conflict: parseJson(result.conflict),
    };
  }
  if (data.status === "written"
      || (data.status === "skipped"
        && clean(data.operation) === "comment"
        && !!clean(result.comment_id))) {
    return result;
  }
  if (data.status === "shadow_ok") {
    const wouldSend = parseJson(result.would_send);
    const variables = parseJson(wouldSend.variables);
    const input = parseJson(variables.input);
    if (clean(data.operation) === "comment") {
      const shadowCommentId = clean(variables.id || input.id)
        || `shadow-comment-dependency:${Number(data.id)}`;
      return {
        ...result,
        comment_id: shadowCommentId,
        linear_comment_id: shadowCommentId,
        shadow_dependency: true,
        synthetic_comment_dependency: true,
      };
    }
    const issueId = clean(input.id);
    if (issueId) return { ...result, linear_issue_id: issueId, shadow_dependency: true };
  }
  return { waiting: true, status: data.status };
}

async function resolveContext(
  supabase: SupabaseClient,
  row: OutboxRow,
  entity: JsonMap,
  issue: JsonMap | null,
  dependency: JsonMap,
): Promise<JsonMap> {
  const payload = parseJson(row.payload);
  const context: JsonMap = {
    entity,
    linear_issue_id: linearIssueId(row, entity, dependency),
    parent_linear_issue_id: clean(
      payload.parent_linear_issue_id
        || dependency.linear_issue_id
        || dependency.issue_id,
    ),
    linear_comment_id: clean(
      payload.linear_comment_id
        || dependency.comment_id
        || dependency.linear_comment_id,
    ),
  };

  if (row.operation === "create") {
    context.create_id = await deterministicLinearCreateId(row.dedup_key);
  }

  const raw = parseJson(entity.linear_raw);
  const fieldUpdatedAt = parseJson(raw.field_updated_at);
  context.field_updated_at = clean(fieldUpdatedAt[row.operation]);

  let team = issue && issue.team && typeof issue.team === "object" ? issue.team as JsonMap : null;
  const requestedTeamId = clean(payload.team_id || (team && team.id));
  if (!team && requestedTeamId) team = await readTeam(requestedTeamId);
  if (!team && row.operation === "create") team = await readTeamByRowTeam(row.team);
  context.team_id = clean(requestedTeamId || (team && team.id));

  const stateSlug = clean(payload.status);
  if (stateSlug) {
    const states = team && team.states && typeof team.states === "object"
      ? ((team.states as JsonMap).nodes as unknown[])
      : [];
    context.state_id = clean(payload.state_id) || stateIdForSlug(states, stateSlug);
    if (!context.state_id) throw new Error("outbound state mapping missing");
  }

  const memberId = clean(payload.assignee_id);
  if (memberId && !clean(payload.linear_user_id)) {
    const { data, error } = await supabase.from("team_members")
      .select("linear_user_id")
      .eq("id", memberId)
      .maybeSingle();
    if (error || !data || !clean(data.linear_user_id)) throw new Error("outbound assignee mapping missing");
    context.linear_user_id = clean(data.linear_user_id);
  } else {
    context.linear_user_id = clean(payload.linear_user_id);
  }
  context.project_id = clean(payload.project_id);
  return context;
}

async function claimRow(supabase: SupabaseClient, row: OutboxRow): Promise<OutboxRow | null> {
  const token = crypto.randomUUID();
  const cutoff = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();
  const { data, error } = await supabase.from("mirror_outbox")
    .update({ lock_token: token, locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", row.status)
    .or("lock_token.is.null,locked_at.lt." + cutoff)
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return data as OutboxRow;
}

async function checkpointLinearResult(
  supabase: SupabaseClient,
  row: OutboxRow,
  linearResult: JsonMap,
): Promise<void> {
  const { data, error } = await supabase.from("mirror_outbox")
    .update({ linear_result: linearResult, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("lock_token", row.lock_token)
    .select("id")
    .maybeSingle();
  if (error || !data || Number(data.id) !== Number(row.id)) {
    throw new Error("outbox create checkpoint CAS failed");
  }
  row.linear_result = linearResult;
}

async function bindLinearCommentId(
  supabase: SupabaseClient,
  row: OutboxRow,
  linearCommentId: string,
): Promise<void> {
  const commentId = clean(parseJson(row.payload).comment_id || row.comment_id);
  const providerId = clean(linearCommentId);
  if (!commentId || !providerId) throw new Error("comment Linear binding identity missing");
  const { data, error } = await supabase.rpc("production_comment_bind_linear_id", {
    p_comment_id: commentId,
    p_linear_comment_id: providerId,
    p_outbox_id: Number(row.id),
  });
  const bound = parseJson(data);
  if (error || clean(bound.id) !== commentId
      || clean(bound.linear_comment_id) !== providerId) {
    throw new Error("comment Linear binding failed");
  }
}

async function releaseRow(
  supabase: SupabaseClient,
  row: OutboxRow,
  patch: JsonMap,
): Promise<void> {
  const attempts = Number(row.attempts || 0) + 1;
  const { error } = await supabase.from("mirror_outbox")
    .update({
      ...patch,
      attempts,
      lock_token: null,
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("lock_token", row.lock_token);
  if (error) throw new Error("outbox release failed");
}

async function unlockPending(supabase: SupabaseClient, row: OutboxRow, delaySeconds = 30): Promise<void> {
  const { error } = await supabase.from("mirror_outbox")
    .update({
      lock_token: null,
      locked_at: null,
      next_retry_at: new Date(Date.now() + delaySeconds * 1_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("lock_token", row.lock_token);
  if (error) throw new Error("outbox unlock failed");
}

function compactIssue(issue: JsonMap | null): JsonMap {
  if (!issue) return {};
  const labels = issue.labels && typeof issue.labels === "object" ? issue.labels as JsonMap : {};
  const labelNodes = Array.isArray(labels) ? labels : Array.isArray(labels.nodes) ? labels.nodes : [];
  const labelIds = Array.isArray(issue.labelIds)
    ? issue.labelIds
    : labelNodes.map(label => label && typeof label === "object" ? (label as JsonMap).id : "");
  return {
    id: clean(issue.id),
    identifier: clean(issue.identifier),
    description: typeof issue.description === "string" ? issue.description : null,
    updated_at: clean(issue.updatedAt),
    state_id: clean(issue.state && (issue.state as JsonMap).id),
    due_date: clean(issue.dueDate) || null,
    assignee_id: clean(issue.assignee && (issue.assignee as JsonMap).id) || null,
    parent_id: clean(issue.parent && (issue.parent as JsonMap).id) || null,
    label_ids: [...new Set(labelIds.map(clean).filter(Boolean))].sort(),
    archived: !!issue.archivedAt,
  };
}

function sameCreateIdentity(
  row: OutboxRow,
  initial: JsonMap,
  current: JsonMap,
  plannedLinearIssueId: string,
): boolean {
  const sameInstant = (left: unknown, right: unknown): boolean => {
    const leftMs = Date.parse(clean(left));
    const rightMs = Date.parse(clean(right));
    return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
  };
  return clean(current.id) === clean(row.entity_id)
    && clean(initial.id) === clean(current.id)
    && clean(current.batch_id) === clean(initial.batch_id)
    && clean(current.client_slug) === clean(row.client_slug)
    && clean(current.client_slug) === clean(initial.client_slug)
    && lower(current.team) === lower(row.team)
    && lower(current.team) === lower(initial.team)
    && clean(current.kind) === clean(initial.kind)
    && clean(current.origin) === clean(initial.origin)
    && (clean(current.card_id) || "") === (clean(initial.card_id) || "")
    && clean(current.created_by) === clean(initial.created_by)
    && sameInstant(current.created_at, initial.created_at)
    && clean(initial.linear_issue_uuid) === plannedLinearIssueId
    && clean(current.linear_issue_uuid) === plannedLinearIssueId;
}

async function applyCreateLinkage(
  supabase: SupabaseClient,
  row: OutboxRow,
  entity: JsonMap,
  issue: JsonMap,
): Promise<void> {
  if (row.entity === "batch") {
    const ids = mergeBatchParentIds(entity.linear_parent_ids, row.team, issue);
    const { error } = await supabase.rpc("batch_write", {
      p_row: { ...entity, linear_parent_ids: ids },
      p_event: {
        source: "outbound",
        action: "mirror_out_create_link",
        actor: "SyncView Mirror",
        role: "system",
        payload: { outbox_id: row.id },
      },
    });
    if (error) throw new Error("batch create linkage failed");
    return;
  }

  const payload = parseJson(row.payload);
  const plannedLinearIssueId = clean(payload.planned_linear_issue_id);
  // F203 linkage patches identity only. Exact Linear `labelIds` already proves
  // the create intent even when Linear's labels connection is capped at 100;
  // a later native labels edit must not wedge that identity acknowledgement.
  const completeIssue = plannedLinearIssueId
    ? exactCreateIssueLabelIds(row, issue)
    : completeCreateIssueLabels(row, entity, issue);
  if (plannedLinearIssueId) {
    const linearIssueId = clean(completeIssue.id);
    const outboxId = Number(row.id);
    if (linearIssueId !== plannedLinearIssueId
        || !Number.isSafeInteger(outboxId)
        || outboxId < 1) {
      throw new Error("deliverable create linkage identity mismatch");
    }
    const { data: currentData, error: currentError } = await supabase.from("deliverables")
      .select("*")
      .eq("id", clean(row.entity_id))
      .maybeSingle();
    if (currentError || !currentData) throw new Error("deliverable create linkage refresh failed");
    const current = currentData as JsonMap;
    if (!sameCreateIdentity(row, entity, current, plannedLinearIssueId)) {
      throw new Error("deliverable create linkage identity mismatch");
    }
    const { data, error } = await supabase.rpc("production_issue_create_linkage", {
      p_deliverable_id: clean(row.entity_id),
      p_outbox_id: outboxId,
      p_expected: {
        id: clean(current.id),
        batch_id: clean(current.batch_id),
        client_slug: clean(current.client_slug),
        team: lower(current.team),
        kind: clean(current.kind),
        origin: clean(current.origin),
        card_id: clean(current.card_id) || null,
        created_by: clean(current.created_by),
        created_at: clean(current.created_at),
        planned_linear_issue_id: plannedLinearIssueId,
        intent_fingerprint: clean(payload._intent_fingerprint),
      },
      p_issue: {
        id: linearIssueId,
        identifier: clean(completeIssue.identifier) || null,
        url: clean(completeIssue.url) || null,
      },
    });
    const linked = parseJson(data);
    if (error || clean(linked.id) !== clean(row.entity_id)) {
      throw new Error("deliverable create linkage failed");
    }
    return;
  }

  const raw = parseJson(entity.linear_raw);
  const { error } = await supabase.rpc("deliverable_write", {
    p_row: {
      ...entity,
      linear_issue_uuid: clean(completeIssue.id),
      linear_identifier: clean(completeIssue.identifier),
      linear_issue_url: clean(completeIssue.url),
      linear_raw: { ...raw, issue: completeIssue },
      sync_state: "clean",
    },
    p_event: {
      source: "outbound",
      action: "mirror_out_create_link",
      actor: "SyncView Mirror",
      role: "system",
      payload: { outbox_id: row.id },
    },
  });
  if (error) throw new Error("deliverable create linkage failed");
}

type CreateIdentityState = "not_f203" | "pending" | "ready" | "conflict";

function createIdentityRepair(value: JsonMap): JsonMap {
  return parseJson(parseJson(value.linear_raw).identity_repair);
}

async function createIdentityState(
  supabase: SupabaseClient,
  row: OutboxRow,
  entity: JsonMap,
): Promise<CreateIdentityState> {
  if (row.entity !== "deliverable" && row.entity !== "comment") return "not_f203";
  const deliverableId = row.entity === "comment"
    ? clean(row.deliverable_id)
    : clean(row.entity_id);
  if (!deliverableId) return "not_f203";
  if (clean(entity.id) !== deliverableId) {
    throw new Error("create identity guard target mismatch");
  }
  const repair = createIdentityRepair(entity);
  const repairState = lower(repair.state);
  const currentLinearIssueId = clean(entity.linear_issue_uuid || parseJson(parseJson(entity.linear_raw).issue).id);
  if (repairState === "required") return "conflict";
  if (repairState === "resolved"
      && clean(repair.resolved_linear_issue_id)
      && clean(repair.resolved_linear_issue_id) === currentLinearIssueId) {
    return "ready";
  }
  if (repairState) return "conflict";

  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,status,entity,entity_id,operation,client_slug,team,payload,linear_result")
    .eq("entity", "deliverable")
    .eq("entity_id", deliverableId)
    .eq("operation", "create");
  if (error) throw new Error("create identity guard unavailable");
  const candidates = ((data || []) as JsonMap[]).filter(candidate => {
    const payload = parseJson(candidate.payload);
    return clean(candidate.client_slug) === clean(row.client_slug)
      && lower(candidate.team) === lower(row.team)
      && clean(payload.planned_linear_issue_id)
      && clean(payload.planned_linear_issue_id) === currentLinearIssueId;
  });
  if (!candidates.length) return "not_f203";
  if (candidates.length !== 1) return "conflict";
  const create = candidates[0];
  const conflict = parseJson(parseJson(create.linear_result).conflict);
  if (lower(conflict.decision) === "idempotency_conflict") return "conflict";
  if (lower(create.status) === "written") return "ready";
  if (["pending", "failed", "shadow_ok"].includes(lower(create.status))) return "pending";
  return "conflict";
}

async function quarantineCreateIdentity(
  supabase: SupabaseClient,
  row: OutboxRow,
): Promise<void> {
  const plannedLinearIssueId = clean(parseJson(row.payload).planned_linear_issue_id);
  const outboxId = Number(row.id);
  if (row.entity !== "deliverable" || !plannedLinearIssueId) return;
  if (!Number.isSafeInteger(outboxId) || outboxId < 1) {
    throw new Error("create identity quarantine receipt invalid");
  }
  const { data, error } = await supabase.rpc("production_issue_create_quarantine", {
    p_deliverable_id: clean(row.entity_id),
    p_outbox_id: outboxId,
  });
  if (error || clean(parseJson(data).id) !== clean(row.entity_id)) {
    throw new Error("create identity quarantine failed");
  }
}

async function latestOutboundSummaryTs(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from("deliverable_events")
    .select("ts")
    .eq("action", "linear_outbound_summary")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return clean(data && data.ts) || new Date(Date.now() - 60 * 60 * 1_000).toISOString();
}

async function echoDropCount(supabase: SupabaseClient, since: string): Promise<number> {
  const { count } = await supabase.from("deliverable_events")
    .select("id", { count: "exact", head: true })
    .eq("action", "mirror_out_echo_dropped")
    .gte("ts", since);
  return Number(count || 0);
}

async function backlogCount(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase.from("mirror_outbox")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "failed", "shadow_ok"]);
  return Number(count || 0);
}

async function oldestPendingMinutesByTeam(
  supabase: SupabaseClient,
  now = Date.now(),
): Promise<Record<string, number | null>> {
  const statuses = ["pending", "failed", "shadow_ok"];
  const entries = await Promise.all(["video", "graphics"].map(async team => {
    const { data, error } = await supabase.from("mirror_outbox")
      .select("created_at,source_edited_at,status,attempts")
      .eq("team", team)
      .eq("test_only", false)
      .eq("legacy_parity", false)
      .in("status", statuses)
      // Deliberately no attempts filter: retry-exhausted failed rows must age
      // into the pager instead of disappearing from monitoring.
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`oldest pending ${team} read failed`);
    if (!data) return [team, null] as const;
    const started = Date.parse(clean((data as JsonMap).created_at || (data as JsonMap).source_edited_at));
    const minutes = Number.isFinite(started)
      ? Math.max(0, Math.floor((now - started) / 60_000))
      : null;
    return [team, minutes] as const;
  }));
  return Object.fromEntries(entries);
}

async function pendingAgeThreshold(supabase: SupabaseClient): Promise<number> {
  try {
    return pendingAgeThresholdMinutes(
      await readFlag(supabase, PENDING_AGE_ALERT_FLAG),
      DEFAULT_PENDING_AGE_ALERT_MINUTES,
    );
  } catch (_error) {
    // The migration seeds the flag, but an older deployment still gets the
    // documented conservative default instead of losing age monitoring.
    return DEFAULT_PENDING_AGE_ALERT_MINUTES;
  }
}

async function writeSummary(supabase: SupabaseClient, summary: JsonMap): Promise<number | null> {
  const { data, error } = await supabase.from("deliverable_events")
    .insert({
      deliverable_id: null,
      batch_id: null,
      client_slug: "_system",
      actor: "SyncView Mirror",
      role: "system",
      action: "linear_outbound_summary",
      source: "outbound",
      payload: summary,
    })
    .select("id")
    .single();
  if (error) throw new Error("outbound summary event failed");
  return data && data.id ? Number(data.id) : null;
}

async function readRows(
  supabase: SupabaseClient,
  mode: string,
  limit: number,
  testClient: string,
  parityEnabled: boolean,
  targetDedupKey: string,
  targetedSyncviewLive: boolean,
  f27Replay: boolean,
): Promise<OutboxRow[]> {
  const normalStatuses = mode === "live" ? ["pending", "failed", "shadow_ok"] : ["pending", "failed"];
  const parityStatuses = ["pending", "failed", "shadow_ok"];
  const fetchLane = async (
    legacyParity: boolean | null,
    statuses: string[],
    laneLimit: number,
    scope: "test" | "real" | "any",
  ): Promise<OutboxRow[]> => {
    let query = supabase.from("mirror_outbox")
      .select("*")
      .in("status", statuses)
      .order("created_at", { ascending: true })
      .limit(laneLimit);
    if (legacyParity !== null) query = query.eq("legacy_parity", legacyParity);
    if (scope === "test") query = query.eq("client_slug", testClient).eq("test_only", true);
    else if (scope === "real") query = query.eq("test_only", false);
    if (targetDedupKey) query = query.eq("dedup_key", targetDedupKey);
    const { data, error } = await query;
    if (error) throw new Error("outbox read failed");
    return (Array.isArray(data) ? data : []) as OutboxRow[];
  };

  let data: OutboxRow[] = [];
  if (targetDedupKey && f27Replay) {
    data = await fetchLane(null, ["pending", "skipped"], 1, "any");
  } else if (targetDedupKey) {
    if (testClient && mode !== "off") data = await fetchLane(false, normalStatuses, 1, "test");
    else if (targetedSyncviewLive && mode === "live") data = await fetchLane(false, normalStatuses, 1, "real");
    else if (!targetedSyncviewLive && parityEnabled) data = await fetchLane(true, parityStatuses, 1, "any");
  } else if (testClient) {
    if (mode !== "off") data = await fetchLane(false, normalStatuses, limit * 3, "test");
  } else {
    const [normalRows, parityRows] = await Promise.all([
      mode === "off" ? Promise.resolve([]) : fetchLane(false, normalStatuses, limit * 3, "real"),
      parityEnabled ? fetchLane(true, parityStatuses, limit * 3, "real") : Promise.resolve([]),
    ]);
    const byId = new Map<number, OutboxRow>();
    for (const row of [...normalRows, ...parityRows]) byId.set(Number(row.id), row);
    data = [...byId.values()].sort((a, b) => {
      const created = Date.parse(clean(a.created_at)) - Date.parse(clean(b.created_at));
      return Number.isFinite(created) && created !== 0 ? created : Number(a.id) - Number(b.id);
    });
  }

  const now = Date.now();
  return data
    // F27 is an owner-scoped emergency recovery lane. Its exact classified
    // intent must remain selectable until it receives a correlated terminal
    // result; the normal backlog attempt ceiling must not strand a rollback.
    .filter(row => f27Replay || Number(row.attempts || 0) < MAX_ATTEMPTS)
    .filter(row => !row.next_retry_at || Date.parse(row.next_retry_at) <= now)
    .slice(0, limit) as OutboxRow[];
}

async function targetResult(supabase: SupabaseClient, dedupKey: string): Promise<JsonMap | null> {
  if (!dedupKey) return null;
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,status,operation,team,dedup_key,legacy_parity,test_only,attempts,next_retry_at,last_error,linear_result")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  if (error) throw new Error("target outbox read failed");
  return data && typeof data === "object" ? data as JsonMap : null;
}

async function f27TargetResult(supabase: SupabaseClient, dedupKey: string): Promise<JsonMap | null> {
  if (!dedupKey) return null;
  const { data, error } = await supabase.from("mirror_outbox")
    .select("id,status,operation,team,client_slug,dedup_key,legacy_parity,test_only,f27_drill_rollback_id,attempts,next_retry_at,last_error,linear_result")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  if (error) throw new Error("F27 target outbox read failed");
  return data && typeof data === "object" ? data as JsonMap : null;
}

async function f27ReplayAuthorization(
  supabase: SupabaseClient,
  request: JsonMap,
  row: OutboxRow | null = null,
): Promise<JsonMap> {
  const rollbackId = clean(request.rollbackId);
  const dedupKey = clean(request.dedupKey);
  const { data: rollback, error: rollbackError } = await supabase
    .from("track_b_team_rollbacks")
    .select("id,correlation_id,team,state,is_drill")
    .eq("id", rollbackId)
    .eq("state", "open")
    .maybeSingle();
  if (rollbackError || !rollback) throw new Error("F27 open rollback required");

  let outbox = row as JsonMap | null;
  if (!outbox) outbox = await f27TargetResult(supabase, dedupKey);
  if (!outbox) throw new Error("F27 replay target mismatch");
  const replay = bindF27ReplayScope(request, rollback, outbox) as JsonMap;
  const { data: intent, error: intentError } = await supabase
    .from("track_b_team_rollback_intents")
    .select("classification,terminal_receipt,row_sha256")
    .eq("rollback_id", rollbackId)
    .eq("outbox_id", Number(outbox.id))
    .eq("classification", "replay")
    .is("terminal_receipt", null)
    .maybeSingle();
  if (intentError || !intent) throw new Error("F27 approved replay required");

  const [outbound, parity, authority] = await Promise.all([
    readFlag(supabase, OUTBOUND_FLAG),
    readFlag(supabase, LEGACY_PARITY_FLAG),
    readFlag(supabase, AUTHORITY_FLAG),
  ]);
  if (modeFrom(outbound) !== "off" || parity.enabled !== false) {
    throw new Error("F27 emergency stops required");
  }
  if (replay.isDrill === true) {
    if (!hasExactF27DrillStops(outbound, parity)) {
      throw new Error("F27 emergency stops required");
    }
    if (!isExactF27DrillAuthority(authority)) {
      throw new Error("F27 drill Linear authority required");
    }
  } else if (authorityFor(clean(outbox.team), authority) !== "syncview") {
    throw new Error("F27 SyncView authority required");
  }
  return { ...replay, intentSnapshotSha256: clean(intent.row_sha256) };
}

async function executeF27DrillReplay(
  supabase: SupabaseClient,
  replay: JsonMap,
  row: OutboxRow,
): Promise<JsonMap> {
  const rollbackId = clean(replay.rollbackId);
  const lockToken = clean(row.lock_token);
  if (!rollbackId || !lockToken) throw new Error("F27 drill lock required");
  const { data, error } = await supabase.rpc("track_b_f27_execute_drill_replay", {
    p_rollback_id: rollbackId,
    p_outbox_id: Number(row.id),
    p_lock_token: lockToken,
  });
  const receipt = data && typeof data === "object" && !Array.isArray(data)
    ? data as JsonMap
    : {};
  if (error || !isExactF27DrillReceipt(receipt, replay, row)) {
    throw new Error("F27 drill replay refused");
  }
  return receipt;
}

async function currentControl(
  supabase: SupabaseClient,
  row: OutboxRow,
  testOverride: JsonMap,
  f27Replay: JsonMap | null = null,
): Promise<{ mode: string; authority: string; legacyParity: boolean }> {
  if (clean(testOverride.client_slug)) {
    return {
      mode: modeFrom({ mode: testOverride.mode }),
      authority: lower(testOverride.authority) === "linear" ? "linear" : "syncview",
      legacyParity: false,
    };
  }
  if (f27Replay) {
    const authorityFlag = await readFlag(supabase, AUTHORITY_FLAG);
    return {
      mode: "live",
      authority: authorityFor(row.team, authorityFlag),
      legacyParity: false,
    };
  }
  if (row.legacy_parity === true) {
    const [parityFlag, authorityFlag] = await Promise.all([
      readFlag(supabase, LEGACY_PARITY_FLAG),
      readFlag(supabase, AUTHORITY_FLAG),
    ]);
    const enabled = parityFlag.enabled === true
      && LEGACY_PARITY_OPERATIONS.has(lower(row.operation));
    return {
      mode: enabled ? "live" : "off",
      authority: authorityFor(row.team, authorityFlag),
      legacyParity: true,
    };
  }
  const [modeFlag, authorityFlag] = await Promise.all([
    readFlag(supabase, OUTBOUND_FLAG),
    readFlag(supabase, AUTHORITY_FLAG),
  ]);
  return {
    mode: modeFrom(modeFlag),
    authority: authorityFor(row.team, authorityFlag),
    legacyParity: false,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (!(await serviceRoleRequest(req))) return json({ ok: false, error: "forbidden" }, 403);

  let body: JsonMap;
  try {
    body = parseJson(await req.json());
  } catch (_e) {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const testOverride = parseJson(body.test_override);
  const testClient = clean(testOverride.client_slug);
  const testMode = lower(testOverride.mode);
  const targetDedupKey = clean(body.target_dedup_key);
  let f27ReplayRequestValue: JsonMap | null = null;
  try {
    f27ReplayRequestValue = f27ReplayRequest(body) as JsonMap | null;
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 400);
  }
  const targetedParity = body.legacy_parity === true;
  const targetedSyncviewLive = body.syncview_live === true;
  if (testClient && clean(body.confirm) !== "B4_TEST_ONLY") {
    return json({ ok: false, error: "TEST override confirmation missing" }, 400);
  }
  if (testClient && !["shadow", "live", "off"].includes(testMode)) {
    return json({ ok: false, error: "invalid TEST override mode" }, 400);
  }
  if (f27ReplayRequestValue && testClient) {
    return json({ ok: false, error: "F27 replay cannot use TEST override" }, 400);
  } else if (targetDedupKey && testClient) {
    if ((body.legacy_parity !== undefined && body.legacy_parity !== false)
        || body.syncview_live !== undefined) {
      return json({ ok: false, error: "invalid TEST target" }, 400);
    }
  } else if (targetDedupKey && targetedSyncviewLive) {
    if (body.legacy_parity !== undefined
        || clean(body.confirm) !== "WRITE_UI_SYNCVIEW_LIVE") {
      return json({ ok: false, error: "invalid SyncView live target" }, 400);
    }
  } else if (!f27ReplayRequestValue
      && (targetDedupKey || body.legacy_parity !== undefined || body.syncview_live !== undefined)) {
    if (!targetDedupKey || !targetedParity
        || targetedSyncviewLive
        || clean(body.confirm) !== "WRITE_UI_LEGACY_PARITY") {
      return json({ ok: false, error: "invalid legacy parity target" }, 400);
    }
  }

  const requestedLimit = Number(body.limit || 15);
  const limit = targetDedupKey
    ? 1
    : Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? requestedLimit : 15));
  const runStarted = new Date().toISOString();
  const since = await latestOutboundSummaryTs(supabase);
  const initialMode = testClient
    ? modeFrom({ mode: testOverride.mode })
    : modeFrom(await readFlag(supabase, OUTBOUND_FLAG));
  const parityEnabled = !testClient
    && (await readFlag(supabase, LEGACY_PARITY_FLAG)).enabled === true;
  const counts: Record<string, number> = {
    enqueued: 0,
    shadow_ok: 0,
    written: 0,
    failed: 0,
    retried: 0,
    echo_dropped: 0,
    stale_dropped: 0,
    tolerated_historical: 0,
    skipped: 0,
    paused: 0,
    legacy_parity_written: 0,
    legacy_parity_paused: 0,
    shadow_vs_actual_divergence: 0,
  };

  let rows: OutboxRow[] = [];
  let mirrorActor: JsonMap = {};
  let f27DrillReceipt: JsonMap | null = null;
  if (f27ReplayRequestValue) {
    f27ReplayRequestValue = await f27ReplayAuthorization(supabase, f27ReplayRequestValue);
  }
  if (initialMode !== "off" || parityEnabled || f27ReplayRequestValue) {
    rows = await readRows(
      supabase,
      initialMode,
      limit,
      testClient,
      parityEnabled,
      targetDedupKey,
      targetedSyncviewLive,
      Boolean(f27ReplayRequestValue),
    );
    counts.enqueued = rows.length;
    if (f27ReplayRequestValue?.isDrill !== true
        && (initialMode === "live"
          || f27ReplayRequestValue
          || rows.some(row => row.legacy_parity === true))) {
      mirrorActor = await readViewer();
    }
  }

  for (const candidate of rows) {
    const row = await claimRow(supabase, candidate);
    if (!row) continue;
    // Preserve lane identity for catch even if post-claim authorization or a
    // flag read fails before it can return the fully bound replay context.
    let f27Replay: JsonMap | null = f27ReplayRequestValue;
    try {
      f27Replay = f27ReplayRequestValue
        ? await f27ReplayAuthorization(supabase, f27ReplayRequestValue, row)
        : null;
      if (f27Replay && f27Replay.isDrill === true) {
        // The service RPC terminalizes only the bound reserved fixture. Branch
        // here so a drill can never resolve an entity or call Linear.
        f27DrillReceipt = await executeF27DrillReplay(supabase, f27Replay, row);
        counts.written++;
        continue;
      }
      const control = await currentControl(supabase, row, testOverride, f27Replay);
      if (control.mode === "off") {
        counts.paused++;
        if (control.legacyParity) counts.legacy_parity_paused++;
        await unlockPending(supabase, row, 0);
        if (!control.legacyParity) break;
        continue;
      }
      const authorityAllowed = control.legacyParity
        ? control.authority === "linear"
        : control.authority === "syncview";
      if (!authorityAllowed) {
        counts.paused++;
        if (control.legacyParity) counts.legacy_parity_paused++;
        await unlockPending(supabase, row, testClient ? 0 : 30);
        continue;
      }

      const entity = await entityRow(supabase, row);
      if (row.operation !== "create") {
        const identityState = await createIdentityState(supabase, row, entity);
        if (identityState === "pending") {
          // A later native edit may commit while its deterministic create is
          // still catching up, but it cannot address that planned UUID until
          // the create receipt has linked it successfully.
          await unlockPending(supabase, row, 15);
          continue;
        }
        if (identityState === "conflict") {
          counts.failed++;
          counts.skipped++;
          await releaseRow(supabase, row, {
            status: "skipped",
            processed_at: f27Replay ? null : new Date().toISOString(),
            linear_result: bindF27LinearResult({
              conflict: {
                decision: "identity_repair_required",
                reason: "linear_create_idempotency_conflict",
              },
            }, f27Replay, row),
            last_error: f27Replay
              ? "F27 replay declined: identity_repair_required"
              : "identity_repair_required",
            next_retry_at: f27Replay ? new Date(Date.now() + 30_000).toISOString() : null,
          });
          continue;
        }
      }
      let dependency = await dependencyResult(supabase, row);
      const plannedLinearIssueId = clean(parseJson(row.payload).planned_linear_issue_id);
      if (dependency.terminal_create_conflict === true
          && row.operation === "create"
          && row.entity === "deliverable"
          && plannedLinearIssueId) {
        // A child cannot ever resolve a parent whose deterministic create ID
        // belongs to another Linear issue. Give the child its own structured
        // terminal receipt and native read-only marker before releasing it, so
        // neither this create nor later edits can target the foreign identity.
        const linearResult = bindF27LinearResult({
          conflict: {
            decision: "idempotency_conflict",
            reason: "parent_linear_create_idempotency_conflict",
            dependency_outbox_id: Number(dependency.dependency_outbox_id),
            dependency_entity_id: clean(dependency.dependency_entity_id),
          },
        }, f27Replay, row);
        await checkpointLinearResult(supabase, row, linearResult);
        await quarantineCreateIdentity(supabase, row);
        counts.failed++;
        counts.skipped++;
        await releaseRow(supabase, row, {
          status: "skipped",
          processed_at: f27Replay ? null : new Date().toISOString(),
          linear_result: linearResult,
          last_error: f27Replay
            ? "F27 replay declined: parent_create_idempotency_conflict"
            : "parent_create_idempotency_conflict",
          next_retry_at: f27Replay ? new Date(Date.now() + 30_000).toISOString() : null,
        });
        continue;
      }
      if (dependency.waiting === true) {
        await unlockPending(supabase, row, 15);
        continue;
      }
      const commentPayload = row.operation === "comment" ? parseJson(row.payload) : {};
      const commentAction = lower(commentPayload.action || "add");
      const cardImportWithoutForeign = row.operation === "comment"
        && commentPayload.card_import_without_foreign === true
        && !clean(commentPayload.linear_comment_id)
        && !Number(row.depends_on_id || 0);
      const shadowWithoutForeign = dependency.synthetic_comment_dependency === true
        && control.mode === "live";
      if ((shadowWithoutForeign || cardImportWithoutForeign)
          && row.operation === "comment"
          && commentAction === "delete") {
        // No foreign comment exists for an F42 import or for shadow-only
        // history. Canonical deletion is already converged, so terminalize
        // without inventing a provider id or issuing a Linear request.
        counts.written++;
        await releaseRow(supabase, row, {
          status: "written",
          processed_at: new Date().toISOString(),
          linear_result: bindF27LinearResult({
            mutation: "commentDelete",
            comment_id: null,
            delete_attempted: false,
            delete_applied: true,
            recovered_idempotently: true,
            shadow_transition_noop: shadowWithoutForeign,
            card_import_transition_noop: cardImportWithoutForeign,
            recovery_reason: "no_foreign_comment_materialized",
          }, f27Replay, row),
          last_error: null,
          next_retry_at: null,
        });
        continue;
      }
      const issueId = linearIssueId(row, entity, dependency)
        || (row.operation === "create" ? await deterministicLinearCreateId(row.dedup_key) : "");
      const issue = issueId ? await readIssue(issueId, row.operation === "create") : null;
      if (testClient || row.test_only === true) {
        await testScope(supabase, row, issue);
      }
      const context = await resolveContext(supabase, row, entity, issue, dependency);
      if (dependency.synthetic_comment_dependency === true
          && control.mode === "live"
          && row.operation === "comment"
          && commentAction === "edit") {
        // Materialize only the current canonical edit at the shadow-to-live
        // boundary. Historical shadow rows stay terminal; this intent creates
        // the provider comment and binds its real id for all later lifecycle.
        context.comment_shadow_materialize = true;
        context.linear_comment_id = "";
      }
      if (cardImportWithoutForeign
          && row.operation === "comment"
          && commentAction === "edit") {
        // F42 import preserves the native history but creates no Linear
        // object. The first applicable edit therefore materializes the current
        // canonical body once and binds that provider id for later lifecycle.
        context.comment_import_materialize = true;
        context.linear_comment_id = "";
      }
      if (row.operation === "comment" && (commentAction === "add" || commentAction === "edit")) {
        context.comment_marker_match = await readCommentByMarker(issueId, row.dedup_key);
      }
      if (row.operation === "comment"
          && commentAction === "delete"
          && parseJson(row.linear_result).delete_attempted === true) {
        context.comment_delete_checked = true;
        context.linear_comment = await readLinearComment(
          clean(context.linear_comment_id),
          true,
        );
      }
      const conflict = decideConflict(row, issue, context);

      if (conflict.decision === "tolerated_historical") {
        counts.tolerated_historical++;
        counts.skipped++;
        await releaseRow(supabase, row, {
          status: "skipped",
          processed_at: f27Replay ? null : new Date().toISOString(),
          linear_result: { conflict, issue: compactIssue(issue) },
          last_error: f27Replay ? "F27 replay declined: tolerated_historical" : null,
          next_retry_at: f27Replay ? new Date(Date.now() + 30_000).toISOString() : null,
        });
        continue;
      }

      if (conflict.decision === "stale") {
        counts.stale_dropped++;
        await releaseRow(supabase, row, {
          status: f27Replay ? "skipped" : "stale",
          processed_at: f27Replay ? null : new Date().toISOString(),
          linear_result: { conflict },
          last_error: f27Replay ? "F27 replay declined: stale" : null,
          next_retry_at: f27Replay ? new Date(Date.now() + 30_000).toISOString() : null,
        });
        continue;
      }
      if (conflict.decision === "already_exists" && row.operation === "create" && control.mode === "live" && issue) {
        await applyCreateLinkage(supabase, row, entity, issue);
        counts.written++;
        if (control.legacyParity) counts.legacy_parity_written++;
        await releaseRow(supabase, row, {
          status: "written",
          processed_at: new Date().toISOString(),
          linear_result: bindF27LinearResult({
            ...parseJson(row.linear_result),
            mutation: "issueCreate",
            issue_id: clean(issue.id),
            identifier: clean(issue.identifier),
            updated_at: clean(issue.updatedAt || issue.createdAt),
            mirror_actor_id: clean(mirrorActor.id),
            mirror_actor_name: clean(mirrorActor.name),
            recovered_idempotently: true,
            conflict,
          }, f27Replay, row),
          last_error: null,
          next_retry_at: null,
        });
        continue;
      }
      if (conflict.decision === "already_applied" || conflict.decision === "already_exists") {
        const recoveredCommentId = row.operation === "comment"
          && (commentAction === "add" || commentAction === "edit")
          && context.comment_marker_match
          ? clean(parseJson(context.comment_marker_match).id)
          : commentAction === "delete"
            ? clean(context.linear_comment_id)
            : "";
        if (row.operation === "comment"
            && (commentAction === "add" || commentAction === "edit")
            && context.comment_marker_match) {
          await bindLinearCommentId(
            supabase,
            row,
            clean(parseJson(context.comment_marker_match).id),
          );
        }
        counts.skipped++;
        await releaseRow(supabase, row, {
          status: f27Replay ? "written" : "skipped",
          processed_at: new Date().toISOString(),
          linear_result: bindF27LinearResult({
            ...parseJson(row.linear_result),
            conflict,
            issue: compactIssue(issue),
            ...(recoveredCommentId ? { comment_id: recoveredCommentId } : {}),
            ...(commentAction === "delete" ? { delete_applied: true } : {}),
            recovered_idempotently: row.operation === "comment",
          }, f27Replay, row),
          last_error: null,
          next_retry_at: null,
        });
        continue;
      }
      if (conflict.decision === "idempotency_conflict" && row.operation === "create") {
        // A deterministic create UUID that belongs to a different intent can
        // never succeed by retrying. Quarantine it in the existing terminal
        // status and retain the structured receipt so production-write can
        // expose a conflict instead of reporting indefinite mirror lag.
        const linearResult = bindF27LinearResult({
          conflict,
          issue: compactIssue(issue),
        }, f27Replay, row);
        // The checkpoint makes the conflict discoverable by concurrent
        // mutable-row guards before the native quarantine is persisted.
        await checkpointLinearResult(supabase, row, linearResult);
        await quarantineCreateIdentity(supabase, row);
        counts.failed++;
        counts.skipped++;
        await releaseRow(supabase, row, {
          status: "skipped",
          processed_at: f27Replay ? null : new Date().toISOString(),
          linear_result: linearResult,
          last_error: f27Replay ? "F27 replay declined: idempotency_conflict" : "idempotency_conflict",
          next_retry_at: f27Replay ? new Date(Date.now() + 30_000).toISOString() : null,
        });
        continue;
      }
      if (conflict.decision === "failed") throw new Error(clean(conflict.reason));

      const mutation = buildMutation(row, context);
      if (f27Replay) {
        // The ledger quarantine uses the existing `skipped` status. Persist
        // the exact intended value and F27 identity before Linear can emit its
        // webhook so inbound can recognize this one authorized skipped row as
        // an in-flight mirror echo.
        await checkpointLinearResult(supabase, row, bindF27LinearResult({
          mutation: mutation.kind,
          issue_id: issueId,
          mirror_actor_id: clean(mirrorActor.id),
          mirror_actor_name: clean(mirrorActor.name),
          expected: mutation.variables,
          f27_preflight: true,
        }, f27Replay, row));
      }
      if (control.mode === "shadow") {
        counts.shadow_ok++;
        counts.shadow_vs_actual_divergence++;
        await releaseRow(supabase, row, {
          status: "shadow_ok",
          processed_at: new Date().toISOString(),
          shadow_actual: compactIssue(issue),
          linear_result: {
            would_send: { kind: mutation.kind, variables: mutation.variables },
            conflict,
          },
          last_error: null,
          next_retry_at: null,
        });
        continue;
      }

      if (mutation.kind === "commentDelete") {
        // This durable pre-attempt receipt closes the external delete crash
        // window. If Linear deletes the marker and the worker dies before its
        // terminal checkpoint, retry verifies the exact provider comment is
        // absent and terminalizes without issuing a second delete mutation.
        await checkpointLinearResult(supabase, row, bindF27LinearResult({
          ...parseJson(row.linear_result),
          mutation: mutation.kind,
          issue_id: issueId,
          comment_id: clean(context.linear_comment_id),
          delete_attempted: true,
          delete_applied: false,
          expected: mutation.variables,
        }, f27Replay, row));
      }
      if (Number(row.attempts || 0) > 0) counts.retried++;
      const data = await linearGraphql(mutation.query, mutation.variables as JsonMap);
      let result = extractMutationResult(mutation.kind, data);
      if (mutation.kind === "issueArchive" || mutation.kind === "issueUnarchive") {
        result = await readIssue(issueId);
      }
      const resultMap = result && typeof result === "object" ? result as JsonMap : {};
      const resultIssue = mutation.kind === "commentCreate" || mutation.kind === "commentUpdate"
        ? parseJson(resultMap.issue)
        : resultMap;
      const createVerification = row.operation === "create"
        ? decideConflict(row, resultIssue, context)
        : null;
      const linearResult: JsonMap = bindF27LinearResult({
        mutation: mutation.kind,
        issue_id: clean(resultIssue.id) || issueId,
        identifier: clean(resultIssue.identifier),
        updated_at: clean(resultIssue.updatedAt || resultMap.createdAt),
        comment_id: mutation.kind === "commentCreate" || mutation.kind === "commentUpdate"
          ? clean(resultMap.id)
          : mutation.kind === "commentDelete"
            ? clean(context.linear_comment_id)
            : null,
        mirror_actor_id: clean(mirrorActor.id),
        mirror_actor_name: clean(mirrorActor.name),
        expected: mutation.variables,
        ...(mutation.kind === "commentDelete"
          ? { delete_attempted: true, delete_applied: true }
          : {}),
        ...(createVerification ? { create_verification: createVerification } : {}),
        ...(createVerification?.decision === "idempotency_conflict"
          ? { conflict: createVerification }
          : {}),
      }, f27Replay, row);
      // Persist the acknowledged mutation before any follow-up work. Linear can
      // deliver its webhook immediately, and inbound must see the exact intent
      // even while this row is still locked/finalizing.
      await checkpointLinearResult(supabase, row, linearResult);
      if (mutation.kind === "commentCreate" || mutation.kind === "commentUpdate") {
        // The provider id is part of canonical lifecycle state, not merely an
        // outbox receipt. Bind it before releasing the outbox row as terminal.
        await bindLinearCommentId(supabase, row, clean(resultMap.id));
      }
      if (createVerification?.decision === "idempotency_conflict") {
        await quarantineCreateIdentity(supabase, row);
        counts.failed++;
        counts.skipped++;
        await releaseRow(supabase, row, {
          status: "skipped",
          processed_at: f27Replay ? null : new Date().toISOString(),
          linear_result: linearResult,
          last_error: f27Replay ? "F27 replay declined: idempotency_conflict" : "idempotency_conflict",
          next_retry_at: f27Replay ? new Date(Date.now() + 30_000).toISOString() : null,
        });
        continue;
      }
      if (createVerification && createVerification.decision !== "already_exists") {
        throw new Error(clean(createVerification.reason) || "linear_create_intent_mismatch");
      }
      if (row.operation === "create" && result && typeof result === "object") {
        await applyCreateLinkage(supabase, row, entity, resultIssue);
      }
      counts.written++;
      if (control.legacyParity) counts.legacy_parity_written++;
      await releaseRow(supabase, row, {
        status: "written",
        processed_at: new Date().toISOString(),
        linear_result: linearResult,
        last_error: null,
        next_retry_at: null,
      });
      await sleep(RATE_DELAY_MS);
    } catch (error) {
      counts.failed++;
      const attempts = Number(row.attempts || 0) + 1;
      const delay = Math.min(60 * 60, Math.pow(2, Math.min(attempts, 8)) * 15);
      await releaseRow(supabase, row, {
        status: f27Replay ? "skipped" : "failed",
        last_error: safeError(error),
        next_retry_at: !f27Replay && attempts >= MAX_ATTEMPTS
          ? null
          : new Date(Date.now() + delay * 1_000).toISOString(),
      }).catch(() => null);
    }
  }

  counts.echo_dropped = await echoDropCount(supabase, since);
  const [backlog, target, oldestPendingMinutes, authorityFlag, pendingAgeAlertMinutes] = await Promise.all([
    backlogCount(supabase),
    targetResult(supabase, targetDedupKey),
    oldestPendingMinutesByTeam(supabase),
    readFlag(supabase, AUTHORITY_FLAG),
    pendingAgeThreshold(supabase),
  ]);
  const authority = {
    video: authorityFor("video", authorityFlag),
    graphics: authorityFor("graphics", authorityFlag),
  };
  const oldestPendingAlertTeams = pendingAgeAlertTeams(
    oldestPendingMinutes,
    authority,
    pendingAgeAlertMinutes,
  );
  const summary: JsonMap = {
    ok: counts.failed === 0,
    mode: initialMode,
    test_override: !!testClient,
    legacy_parity_enabled: parityEnabled,
    targeted: !!targetDedupKey,
    started_at: runStarted,
    finished_at: new Date().toISOString(),
    counts,
    backlog,
    authority,
    oldest_pending_minutes: oldestPendingMinutes,
    oldest_pending_alert_threshold_minutes: pendingAgeAlertMinutes,
    oldest_pending_alert_teams: oldestPendingAlertTeams,
    alerts: {
      failed_write: counts.failed > 0,
      backlog_growth: backlog > BACKLOG_ALERT_THRESHOLD,
      write_volume_spike: counts.written > VOLUME_ALERT_THRESHOLD,
      shadow_mismatch: counts.shadow_vs_actual_divergence > 0,
      oldest_pending_age: oldestPendingAlertTeams.length > 0,
    },
  };
  const eventId = await writeSummary(supabase, summary);
  return json({
    ok: counts.failed === 0,
    event_id: eventId,
    ...summary,
    target,
    ...(f27DrillReceipt ? { f27_drill_receipt: f27DrillReceipt } : {}),
  });
});
