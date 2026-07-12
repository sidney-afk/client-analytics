export const OUTBOUND_OPERATIONS = Object.freeze([
  "create",
  "status",
  "comment",
  "due",
  "assignee",
  "title",
  "priority",
  "parent",
  "archive",
  "restore",
]);

const STATUS_NAMES = Object.freeze({
  triage: "Triage",
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  smm_approval: "For SMM approval",
  kasper_approval: "For Kasper approval",
  client_approval: "For Client approval",
  tweak: "Tweak Needed",
  approved: "Approved",
  scheduled: "Scheduled",
  posted: "Posted",
  canceled: "Canceled",
  duplicate: "Duplicate",
});

export const D27_LIVE_ERA_START = "2026-07-12T04:48:56.000Z";
const D27_BACKFILL_CREATORS = new Set(["linear-backfill", "history-backfill-2026-07-10"]);

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return clean(a) === clean(b);
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_e) {
    return {};
  }
}

function dateMs(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function isHistoricalEntity(entity) {
  const row = entity && typeof entity === "object" ? entity : {};
  const raw = parseObject(row.linear_raw);
  const issue = raw.issue && typeof raw.issue === "object" ? raw.issue : {};
  const createdAt = dateMs(row.created_at || issue.createdAt);
  const liveEraStart = dateMs(D27_LIVE_ERA_START);
  if (createdAt == null || liveEraStart == null || createdAt >= liveEraStart) return false;

  const backfillProvenance = D27_BACKFILL_CREATORS.has(lower(row.created_by))
    || lower(row.origin) === "backfill";
  const completedAt = dateMs(issue.completedAt);
  const completedBeforeLiveEra = completedAt != null && completedAt < liveEraStart;
  return backfillProvenance || completedBeforeLiveEra;
}

export function historicalWriteDisposition(row, entity) {
  const operation = lower(row && row.operation);
  if (!["parent", "restore"].includes(operation) || !isHistoricalEntity(entity)) return null;
  return {
    decision: "tolerated_historical",
    operation,
    classification_reason: "d27_historical_structure_frozen",
    live_era_start: D27_LIVE_ERA_START,
  };
}

export function statusNameForSlug(slug) {
  return STATUS_NAMES[lower(slug)] || "";
}

export function statusSlugFromName(name) {
  const needle = lower(name).replace(/\s+/g, " ");
  for (const [slug, label] of Object.entries(STATUS_NAMES)) {
    if (lower(label) === needle) return slug;
  }
  if (needle.includes("smm")) return "smm_approval";
  if (needle.includes("kasper")) return "kasper_approval";
  if (needle.includes("client")) return "client_approval";
  if (needle.includes("tweak")) return "tweak";
  if (needle.includes("progress")) return "in_progress";
  if (needle.includes("cancel")) return "canceled";
  return "";
}

export function stateIdForSlug(states, slug) {
  const wanted = lower(slug);
  const rows = Array.isArray(states) ? states : [];
  const exact = rows.find(state => statusSlugFromName(state && state.name) === wanted);
  return clean(exact && exact.id);
}

export function mirrorMarker(dedupKey) {
  return "<!-- syncview-mirror:" + clean(dedupKey) + " -->";
}

export function outboundCommentBody(actor, body, dedupKey) {
  const name = clean(actor) || "SyncView";
  return "**" + name + " (via SyncView):**\n\n"
    + String(body == null ? "" : body)
    + "\n\n" + mirrorMarker(dedupKey);
}

export function markerFromBody(body) {
  const match = String(body == null ? "" : body).match(/<!--\s*syncview-mirror:([^>]+?)\s*-->/i);
  return match ? clean(match[1]) : "";
}

function parentTeamKey(value) {
  const key = lower(value);
  if (key === "gra" || key === "graphic" || key === "graphics") return "graphics";
  return "video";
}

export function mergeBatchParentIds(raw, team, issue = {}) {
  let parsed = raw;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch (_e) { parsed = {}; }
  }
  const parents = {};
  if (Array.isArray(parsed)) {
    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const key = parentTeamKey(value.team || value.team_key || value.key);
      parents[key] = {
        uuid: clean(value.uuid || value.id || value.linear_issue_id),
        identifier: clean(value.identifier),
        url: clean(value.url),
      };
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      parents[parentTeamKey(key)] = { ...value };
    }
  }

  const key = parentTeamKey(team);
  parents[key] = {
    ...(parents[key] || {}),
    uuid: clean(issue.id || issue.uuid),
    identifier: clean(issue.identifier),
    url: clean(issue.url),
  };
  return parents;
}

export function actualValueForOperation(operation, issue, payload = {}) {
  const op = lower(operation);
  const row = issue && typeof issue === "object" ? issue : {};
  if (op === "status") return clean(row.state && row.state.id);
  if (op === "due") return clean(row.dueDate) || null;
  if (op === "assignee") return clean(row.assignee && row.assignee.id) || null;
  if (op === "title") return clean(row.title);
  if (op === "priority") return row.priority == null ? 0 : Number(row.priority);
  if (op === "parent") return clean(row.parent && row.parent.id) || null;
  if (op === "archive" || op === "restore") return !!row.archivedAt;
  if (op === "comment") {
    const comments = row.comments && Array.isArray(row.comments.nodes) ? row.comments.nodes : [];
    const dedup = clean(payload.dedup_key);
    return comments.some(comment => markerFromBody(comment && comment.body) === dedup);
  }
  return null;
}

export function intendedValueForOperation(operation, payload = {}, context = {}) {
  const op = lower(operation);
  if (op === "status") return clean(payload.state_id || context.state_id);
  if (op === "due") return clean(payload.due_date) || null;
  if (op === "assignee") return clean(payload.linear_user_id || context.linear_user_id) || null;
  if (op === "title") return clean(payload.title);
  if (op === "priority") return payload.priority == null || payload.priority === "" ? 0 : Number(payload.priority);
  if (op === "parent") return clean(payload.parent_linear_issue_id || context.parent_linear_issue_id) || null;
  if (op === "archive") return true;
  if (op === "restore") return false;
  if (op === "comment") return true;
  return null;
}

export function decideConflict(row, issue, context = {}) {
  const operation = lower(row && row.operation);
  const historical = historicalWriteDisposition(row, context.entity);
  if (historical) return historical;
  if (operation === "create") {
    return issue
      ? { decision: "already_exists", reason: "linear_issue_already_exists" }
      : { decision: "apply" };
  }
  if (!issue) return { decision: "failed", reason: "linear_issue_missing" };

  const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
  const actual = actualValueForOperation(operation, issue, { ...payload, dedup_key: row.dedup_key });
  const intended = intendedValueForOperation(operation, payload, context);
  if (sameValue(actual, intended)) return { decision: "already_applied", actual, intended };

  // Comments are additive. A later, unrelated Linear edit must not discard a
  // queued comment; the hidden marker above provides field-level idempotency.
  if (operation === "comment") return { decision: "apply", actual, intended };

  const sourceMs = Date.parse(clean(row && row.source_edited_at));
  const fieldMs = Date.parse(clean(context.field_updated_at));
  const issueMs = Date.parse(clean(issue.updatedAt));
  // The webhook supplies exact per-field clocks when the field is present, but
  // Linear can omit clears. The live issue clock is therefore a conservative
  // upper bound: an ambiguous queued edit is dropped rather than overwriting a
  // direct Linear edit made while the team was paused.
  const linearMs = Math.max(
    Number.isFinite(fieldMs) ? fieldMs : -Infinity,
    Number.isFinite(issueMs) ? issueMs : -Infinity,
  );
  if (Number.isFinite(sourceMs) && Number.isFinite(linearMs) && linearMs > sourceMs) {
    return {
      decision: "stale",
      reason: "linear_newer_than_syncview_intent",
      actual,
      intended,
      source_edited_at: new Date(sourceMs).toISOString(),
      linear_field_updated_at: Number.isFinite(fieldMs) ? new Date(fieldMs).toISOString() : null,
      linear_issue_updated_at: Number.isFinite(issueMs) ? new Date(issueMs).toISOString() : null,
    };
  }
  return { decision: "apply", actual, intended };
}

const ISSUE_FIELDS = [
  "id identifier title description url priority dueDate archivedAt updatedAt",
  "state { id name type }",
  "team { id key name states { nodes { id name type position } } }",
  "project { id name }",
  "assignee { id name email }",
  "parent { id identifier title }",
  "comments(first: 100) { nodes { id body createdAt user { id name email } } }",
].join("\n");

export function issueFields() {
  return ISSUE_FIELDS;
}

export function buildMutation(row, context = {}) {
  const operation = lower(row && row.operation);
  const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
  if (!OUTBOUND_OPERATIONS.includes(operation)) throw new Error("unsupported outbound operation");

  if (operation === "create") {
    const input = {
      id: clean(context.create_id),
      teamId: clean(payload.team_id || context.team_id),
      projectId: clean(payload.project_id || context.project_id),
      title: clean(payload.title),
    };
    const optional = {
      description: payload.description == null ? undefined : String(payload.description),
      stateId: clean(payload.state_id || context.state_id) || undefined,
      assigneeId: clean(payload.linear_user_id || context.linear_user_id) || undefined,
      dueDate: clean(payload.due_date) || undefined,
      priority: payload.priority == null || payload.priority === "" ? undefined : Number(payload.priority),
      parentId: clean(payload.parent_linear_issue_id || context.parent_linear_issue_id) || undefined,
    };
    for (const [key, value] of Object.entries(optional)) if (value !== undefined) input[key] = value;
    if (!input.id || !input.teamId || !input.projectId || !input.title) throw new Error("incomplete create mutation");
    return {
      kind: "issueCreate",
      query: "mutation SyncViewMirrorCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { "
        + ISSUE_FIELDS + " } } }",
      variables: { input },
    };
  }

  if (operation === "comment") {
    const issueId = clean(payload.linear_issue_id || context.linear_issue_id);
    const body = outboundCommentBody(row.actor, payload.body, row.dedup_key);
    if (!issueId || !clean(payload.body)) throw new Error("incomplete comment mutation");
    return {
      kind: "commentCreate",
      query: "mutation SyncViewMirrorComment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body url createdAt user { id name email } issue { id identifier updatedAt } } } }",
      variables: { input: { issueId, body } },
    };
  }

  const issueId = clean(payload.linear_issue_id || context.linear_issue_id);
  if (!issueId) throw new Error("linear issue id required");
  if (operation === "archive") {
    return {
      kind: "issueArchive",
      query: "mutation SyncViewMirrorArchive($id: String!) { issueArchive(id: $id) { success } }",
      variables: { id: issueId },
    };
  }
  if (operation === "restore") {
    return {
      kind: "issueUnarchive",
      query: "mutation SyncViewMirrorRestore($id: String!) { issueUnarchive(id: $id) { success } }",
      variables: { id: issueId },
    };
  }

  const input = {};
  if (operation === "status") {
    const value = clean(payload.state_id || context.state_id);
    if (!value) throw new Error("state id required");
    input.stateId = value;
  } else if (operation === "due") {
    input.dueDate = clean(payload.due_date) || null;
  } else if (operation === "assignee") {
    input.assigneeId = clean(payload.linear_user_id || context.linear_user_id) || null;
  } else if (operation === "title") {
    input.title = clean(payload.title);
  } else if (operation === "priority") {
    input.priority = payload.priority == null || payload.priority === "" ? 0 : Number(payload.priority);
  } else if (operation === "parent") {
    input.parentId = clean(payload.parent_linear_issue_id || context.parent_linear_issue_id) || null;
  }

  return {
    kind: "issueUpdate",
    query: "mutation SyncViewMirrorUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { "
      + ISSUE_FIELDS + " } } }",
    variables: { id: issueId, input },
  };
}

export function extractMutationResult(kind, data) {
  const result = data && data[kind];
  if (!result || result.success !== true) throw new Error(kind + " was not acknowledged");
  if (kind === "issueCreate" || kind === "issueUpdate") return result.issue || null;
  if (kind === "commentCreate") return result.comment || null;
  return { success: true };
}
