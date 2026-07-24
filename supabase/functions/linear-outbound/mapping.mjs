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
  "labels",
  "description",
  "attachment",
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
const MAX_DESCRIPTION_LENGTH = 100_000;
const MAX_ATTACHMENT_URL_LENGTH = 2_048;
const ATTACHMENT_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "frame.io",
  "app.frame.io",
  "f.io",
  "dropbox.com",
  "www.dropbox.com",
]);

function clean(value) {
  return String(value == null ? "" : value).trim();
}

// Keep the linear-outbound deployment closure self-contained. This is the same
// exact-string bound used by production-write, including PostgreSQL's NUL
// exclusion, without importing another Edge Function's private module.
function canonicalDescription(value) {
  return typeof value === "string"
      && value.length <= MAX_DESCRIPTION_LENGTH
      && !value.includes("\0")
    ? value
    : null;
}

function lower(value) {
  return clean(value).toLowerCase();
}

export function canonicalAttachmentUrl(value) {
  const raw = clean(value);
  if (!raw || raw.length > MAX_ATTACHMENT_URL_LENGTH || raw.includes("\0")) return "";
  try {
    const url = new URL(raw);
    const host = lower(url.hostname).replace(/\.$/, "");
    if (url.protocol !== "https:"
        || url.username
        || url.password
        || !ATTACHMENT_HOSTS.has(host)
        || !clean(url.pathname)
        || url.pathname === "/") return "";
    const allowedKeys = host === "drive.google.com" || host === "docs.google.com"
      ? new Set(["resourcekey"])
      : host === "dropbox.com" || host === "www.dropbox.com"
        ? new Set(["rlkey"])
        : new Set();
    if ([...url.searchParams.keys()].some(key => !allowedKeys.has(lower(key)))) return "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return clean(a) === clean(b);
}

function canonicalIds(value) {
  const rows = Array.isArray(value) ? value : [];
  return [...new Set(rows.map(clean).filter(Boolean))].sort();
}

function issueLabelIds(issue) {
  const row = issue && typeof issue === "object" ? issue : {};
  if (Array.isArray(row.labelIds)) return canonicalIds(row.labelIds);
  const connection = row.labels && typeof row.labels === "object" ? row.labels : {};
  const nodes = Array.isArray(connection) ? connection : Array.isArray(connection.nodes) ? connection.nodes : [];
  return canonicalIds(nodes.map(label => label && label.id));
}

export function exactCreateIssueLabelIds(row, value) {
  const payload = parseObject(row && row.payload);
  if (!Object.prototype.hasOwnProperty.call(payload, "label_ids")) return value;
  const expectedIds = canonicalIds(payload.label_ids);
  if (JSON.stringify(issueLabelIds(value)) !== JSON.stringify(expectedIds)) {
    throw new Error("outbound create labels mismatch");
  }
  return { ...parseObject(value), labelIds: expectedIds };
}

export function completeCreateIssueLabels(row, entity, value) {
  const payload = parseObject(row && row.payload);
  if (!Object.prototype.hasOwnProperty.call(payload, "label_ids")) return value;
  const expectedIds = canonicalIds(payload.label_ids);
  const issue = exactCreateIssueLabelIds(row, value);
  const resultConnection = parseObject(issue.labels);
  const resultNodes = Array.isArray(resultConnection.nodes) ? resultConnection.nodes : [];
  const resultNodeIds = canonicalIds(resultNodes.map(label => parseObject(label).id));
  if (parseObject(resultConnection.pageInfo).hasNextPage === false
      && resultNodes.length === expectedIds.length
      && JSON.stringify(resultNodeIds) === JSON.stringify(expectedIds)) {
    return { ...issue, labelIds: expectedIds };
  }

  // Linear's create response caps the labels connection at 100 while labelIds
  // remains complete. Preserve the gateway-validated native selection instead
  // of downgrading the mirror to a partial or mismatched relation snapshot.
  const nativeIssue = parseObject(parseObject(entity && entity.linear_raw).issue);
  const nativeConnection = parseObject(nativeIssue.labels);
  const nativeNodes = Array.isArray(nativeConnection.nodes) ? nativeConnection.nodes : [];
  const nativeIds = canonicalIds(nativeNodes.map(label => parseObject(label).id));
  if (parseObject(nativeConnection.pageInfo).hasNextPage !== false
      || nativeNodes.length !== expectedIds.length
      || JSON.stringify(nativeIds) !== JSON.stringify(expectedIds)) {
    throw new Error("outbound create labels incomplete");
  }
  return {
    ...issue,
    labelIds: expectedIds,
    labels: nativeConnection,
  };
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

export function terminalCreateDependencyConflict(value) {
  const row = parseObject(value);
  const conflict = parseObject(parseObject(row.linear_result).conflict);
  return lower(row.operation) === "create"
    && lower(row.status) === "skipped"
    && lower(conflict.decision) === "idempotency_conflict";
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

function artifactRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

function artifactRevisionSubtitle(value) {
  const revision = artifactRevision(value);
  return revision ? `SyncView canonical revision ${revision}` : "";
}

function issueHasArtifactRevision(issue, payload) {
  const revision = artifactRevision(payload && payload.artifact_revision);
  const url = canonicalAttachmentUrl(payload && payload.url);
  if (!revision || !url) return false;
  const attachments = issue && issue.attachments && typeof issue.attachments === "object"
    ? issue.attachments
    : {};
  const nodes = Array.isArray(attachments)
    ? attachments
    : Array.isArray(attachments.nodes)
      ? attachments.nodes
      : [];
  const subtitle = artifactRevisionSubtitle(revision);
  return nodes.some(value => {
    const attachment = value && typeof value === "object" ? value : {};
    return canonicalAttachmentUrl(attachment.url) === url
      && clean(attachment.subtitle) === subtitle;
  });
}

export function actualValueForOperation(operation, issue, payload = {}) {
  const op = lower(operation);
  const row = issue && typeof issue === "object" ? issue : {};
  if (op === "status") {
    const stateId = clean(row.state && row.state.id);
    return Object.prototype.hasOwnProperty.call(payload, "due_date")
      ? JSON.stringify([stateId, clean(row.dueDate) || null])
      : stateId;
  }
  if (op === "due") return clean(row.dueDate) || null;
  if (op === "assignee") return clean(row.assignee && row.assignee.id) || null;
  if (op === "title") return clean(row.title);
  if (op === "description") {
    return row.description == null
      ? ""
      : typeof row.description === "string"
        ? row.description
        : null;
  }
  if (op === "priority") return row.priority == null ? 0 : Number(row.priority);
  if (op === "parent") return clean(row.parent && row.parent.id) || null;
  if (op === "labels") return JSON.stringify(issueLabelIds(row));
  if (op === "archive" || op === "restore") return !!row.archivedAt;
  if (op === "comment") {
    const comments = row.comments && Array.isArray(row.comments.nodes) ? row.comments.nodes : [];
    const dedup = clean(payload.dedup_key);
    return comments.some(comment => markerFromBody(comment && comment.body) === dedup);
  }
  if (op === "attachment") return issueHasArtifactRevision(row, payload);
  return null;
}

export function intendedValueForOperation(operation, payload = {}, context = {}) {
  const op = lower(operation);
  if (op === "status") {
    const stateId = clean(payload.state_id || context.state_id);
    return Object.prototype.hasOwnProperty.call(payload, "due_date")
      ? JSON.stringify([stateId, clean(payload.due_date) || null])
      : stateId;
  }
  if (op === "due") return clean(payload.due_date) || null;
  if (op === "assignee") return clean(payload.linear_user_id || context.linear_user_id) || null;
  if (op === "title") return clean(payload.title);
  if (op === "description") {
    return typeof payload.description === "string" ? payload.description : null;
  }
  if (op === "priority") return payload.priority == null || payload.priority === "" ? 0 : Number(payload.priority);
  if (op === "parent") return clean(payload.parent_linear_issue_id || context.parent_linear_issue_id) || null;
  if (op === "labels") return JSON.stringify(canonicalIds(payload.label_ids));
  if (op === "archive") return true;
  if (op === "restore") return false;
  if (op === "comment") return true;
  if (op === "attachment") return true;
  return null;
}

function createIntentMismatches(issue, payload, context) {
  const mismatches = [];
  const actualTeamId = clean(issue && issue.team && issue.team.id);
  const actualProjectId = clean(issue && issue.project && issue.project.id);
  const expectedTeamId = clean(payload.team_id || context.team_id);
  const expectedProjectId = clean(payload.project_id || context.project_id);
  if (!expectedTeamId || actualTeamId !== expectedTeamId) mismatches.push("team");
  if (!expectedProjectId || actualProjectId !== expectedProjectId) mismatches.push("project");
  if (clean(issue && issue.title) !== clean(payload.title)) mismatches.push("title");

  if (Object.prototype.hasOwnProperty.call(payload, "description")) {
    const expectedDescription = canonicalDescription(payload.description);
    const actualDescription = issue && issue.description == null
      ? ""
      : typeof issue.description === "string"
        ? issue.description
        : null;
    if (expectedDescription == null || actualDescription !== expectedDescription) {
      mismatches.push("description");
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "status")
      || Object.prototype.hasOwnProperty.call(payload, "state_id")) {
    if (!clean(context.state_id)
        || clean(issue && issue.state && issue.state.id) !== clean(context.state_id)) {
      mismatches.push("status");
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "due_date")) {
    if ((clean(issue && issue.dueDate) || null) !== (clean(payload.due_date) || null)) {
      mismatches.push("due_date");
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "assignee_id")
      || Object.prototype.hasOwnProperty.call(payload, "linear_user_id")) {
    if ((clean(issue && issue.assignee && issue.assignee.id) || null)
        !== (clean(payload.linear_user_id || context.linear_user_id) || null)) {
      mismatches.push("assignee");
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "priority")) {
    const expectedPriority = payload.priority == null || payload.priority === ""
      ? 0
      : Number(payload.priority);
    const actualPriority = issue && issue.priority == null ? 0 : Number(issue.priority);
    if (!Number.isFinite(expectedPriority) || actualPriority !== expectedPriority) {
      mismatches.push("priority");
    }
  }
  const actualParentId = clean(issue && issue.parent && issue.parent.id) || null;
  const expectedParentId = clean(
    payload.parent_linear_issue_id || context.parent_linear_issue_id,
  ) || null;
  if (actualParentId !== expectedParentId) mismatches.push("parent");
  if (Object.prototype.hasOwnProperty.call(payload, "label_ids")) {
    if (JSON.stringify(issueLabelIds(issue)) !== JSON.stringify(canonicalIds(payload.label_ids))) {
      mismatches.push("labels");
    }
  }
  return mismatches;
}

export function decideConflict(row, issue, context = {}) {
  const operation = lower(row && row.operation);
  const historical = historicalWriteDisposition(row, context.entity);
  if (historical) return historical;
  if (operation === "create") {
    if (!issue) return { decision: "apply" };
    const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
    const mismatched_fields = createIntentMismatches(issue, payload, context);
    return mismatched_fields.length
      ? {
        decision: "idempotency_conflict",
        reason: "linear_create_intent_mismatch",
        mismatched_fields,
      }
      : { decision: "already_exists", reason: "linear_issue_already_exists_exact" };
  }
  if (!issue) return { decision: "failed", reason: "linear_issue_missing" };

  const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
  if (operation === "attachment") {
    const intendedUrl = canonicalAttachmentUrl(payload.url);
    const intendedRevision = artifactRevision(payload.artifact_revision);
    const native = context && context.entity && typeof context.entity === "object"
      ? context.entity
      : {};
    const currentUrl = canonicalAttachmentUrl(native.file_url);
    const currentRevision = artifactRevision(native.artifact_revision);
    if (!intendedUrl || !intendedRevision) {
      return { decision: "failed", reason: "invalid_attachment_intent" };
    }
    // The database advances the native revision and inserts this outbox row in
    // one transaction. Revision, not URL, is therefore the ordering authority:
    // replacing a file behind the same stable share URL still has a distinct
    // intent, while an older A -> B -> A row can never revive revision A.
    if (currentRevision && currentRevision > intendedRevision) {
      return {
        decision: "stale",
        reason: "native_attachment_revision_superseded",
        actual: currentRevision,
        intended: intendedRevision,
        source_edited_at: clean(row && row.source_edited_at) || null,
        native_updated_at: clean(native.updated_at) || null,
      };
    }
    if (currentRevision !== intendedRevision || currentUrl !== intendedUrl) {
      return {
        decision: "failed",
        reason: "native_attachment_revision_mismatch",
        actual: { revision: currentRevision, url: currentUrl || null },
        intended: { revision: intendedRevision, url: intendedUrl },
      };
    }
  }
  const actual = actualValueForOperation(operation, issue, { ...payload, dedup_key: row.dedup_key });
  const intended = intendedValueForOperation(operation, payload, context);
  const alreadyApplied = operation === "description"
    ? actual === intended
    : sameValue(actual, intended);
  if (alreadyApplied) return { decision: "already_applied", actual, intended };

  // Comments and external attachments are additive. Attachment exact-retry
  // idempotency uses the server-owned revision marker; Linear's issue+URL
  // attachment upsert then lets a newer same-URL revision reach the issue.
  if (operation === "comment" || operation === "attachment") {
    return { decision: "apply", actual, intended };
  }

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
  "labelIds",
  "labels(first: 100, includeArchived: true) { nodes { id name color description } pageInfo { hasNextPage } }",
  "attachments(first: 100) { nodes { id url title subtitle } pageInfo { hasNextPage } }",
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
    const description = Object.prototype.hasOwnProperty.call(payload, "description")
      ? canonicalDescription(payload.description)
      : undefined;
    if (description === null) throw new Error("valid description required");
    const input = {
      id: clean(context.create_id),
      teamId: clean(payload.team_id || context.team_id),
      projectId: clean(payload.project_id || context.project_id),
      title: clean(payload.title),
    };
    const optional = {
      description: description === "" ? undefined : description,
      stateId: clean(payload.state_id || context.state_id) || undefined,
      assigneeId: clean(payload.linear_user_id || context.linear_user_id) || undefined,
      dueDate: clean(payload.due_date) || undefined,
      priority: payload.priority == null || payload.priority === "" ? undefined : Number(payload.priority),
      parentId: clean(payload.parent_linear_issue_id || context.parent_linear_issue_id) || undefined,
      labelIds: Object.prototype.hasOwnProperty.call(payload, "label_ids")
        ? canonicalIds(payload.label_ids)
        : undefined,
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
  if (operation === "attachment") {
    const url = canonicalAttachmentUrl(payload.url);
    const revision = artifactRevision(payload.artifact_revision);
    if (!url || !revision) throw new Error("valid attachment intent required");
    const metadata = payload.metadata && typeof payload.metadata === "object"
      && !Array.isArray(payload.metadata)
      ? Object.fromEntries(Object.entries(payload.metadata)
        .filter(([key, value]) =>
          !!clean(key)
          && key.length <= 100
          && (typeof value === "string"
            || typeof value === "number"
            || typeof value === "boolean")
        ))
      : undefined;
    const input = {
      issueId,
      url,
      title: clean(payload.title) || "SyncView canonical Graphics deliverable",
      subtitle: artifactRevisionSubtitle(revision),
      metadata: {
        ...(metadata && Object.keys(metadata).length ? metadata : {}),
        syncviewArtifactRevision: revision,
      },
    };
    return {
      kind: "attachmentCreate",
      query: "mutation SyncViewMirrorAttachment($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success attachment { id url title subtitle } } }",
      variables: { input },
    };
  }
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
    // Keep the full status intent in both the mutation and its persisted
    // linear_result.expected receipt. Even when Linear already has this state,
    // a due bump must not become a due-only acknowledgement: inbound echo
    // matching needs state + due to distinguish a later external state edit.
    input.stateId = value;
    if (Object.prototype.hasOwnProperty.call(payload, "due_date")) {
      input.dueDate = clean(payload.due_date) || null;
    }
  } else if (operation === "due") {
    input.dueDate = clean(payload.due_date) || null;
  } else if (operation === "assignee") {
    input.assigneeId = clean(payload.linear_user_id || context.linear_user_id) || null;
  } else if (operation === "title") {
    input.title = clean(payload.title);
  } else if (operation === "description") {
    const description = canonicalDescription(payload.description);
    if (description == null) throw new Error("valid description required");
    input.description = description || null;
  } else if (operation === "priority") {
    input.priority = payload.priority == null || payload.priority === "" ? 0 : Number(payload.priority);
  } else if (operation === "parent") {
    input.parentId = clean(payload.parent_linear_issue_id || context.parent_linear_issue_id) || null;
  } else if (operation === "labels") {
    if (!Array.isArray(payload.label_ids)) throw new Error("label ids required");
    input.labelIds = canonicalIds(payload.label_ids);
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
  if (kind === "attachmentCreate") return result.attachment || null;
  return { success: true };
}
