// Pure policy for the Workload Linear metadata/deadline gateway. Keep parsing
// and response-shaping deterministic so hermetic Node tests can exercise the
// contract without an Edge runtime, Supabase, or Linear credentials.

export const MAX_METADATA_ISSUES = 100;
export const LINEAR_ALIAS_BATCH_SIZE = 20;

const SAFE_ISSUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const FALLBACK_LABEL_COLOR = "#94A3B8";

const WORKLOAD_LABEL_WEIGHTS = Object.freeze({
  "2× Workload": 2,
  "3× Workload": 3,
});

export function clean(value) {
  return String(value == null ? "" : value).trim();
}

export function workloadTeamBucket(teamKey, teamName) {
  const key = clean(teamKey).toUpperCase();
  const name = clean(teamName).toLowerCase();
  const keyBucket = key === "VID" ? "video" : key === "GRA" ? "graphics" : "";
  const nameBucket = name === "video" ? "video" : name === "graphics" ? "graphics" : "";
  if (keyBucket && nameBucket && keyBucket !== nameBucket) return "";
  return keyBucket || nameBucket;
}

export function linearIssueTeamDecision(value, expectedIssueId, mirroredTeam) {
  const issueId = clean(expectedIssueId);
  const expectedTeam = clean(mirroredTeam).toLowerCase();
  if (!isPlainObject(value)
      || value.id !== issueId
      || !isPlainObject(value.team)
      || !["video", "graphics"].includes(expectedTeam)) {
    return {
      ok: false,
      status: 503,
      error: "linear_team_unavailable",
      team: "",
    };
  }

  const currentTeam = workloadTeamBucket(value.team.key, value.team.name);
  if (currentTeam !== "video" && currentTeam !== "graphics") {
    return {
      ok: false,
      status: 409,
      error: "issue_team_unavailable",
      team: "",
    };
  }
  if (currentTeam !== expectedTeam) {
    return {
      ok: false,
      status: 409,
      error: "issue_team_changed",
      team: currentTeam,
    };
  }
  return { ok: true, status: 200, error: "", team: currentTeam };
}

export function productionAuthorityValue(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (_error) {
      return null;
    }
  }
  if (!isPlainObject(parsed)) return null;
  const video = clean(parsed.video).toLowerCase();
  const graphics = clean(parsed.graphics).toLowerCase();
  if (!["linear", "syncview"].includes(video)
      || !["linear", "syncview"].includes(graphics)) return null;
  return { video, graphics };
}

export function linearAuthorityDecision(value, team) {
  const authority = productionAuthorityValue(value);
  const bucket = clean(team).toLowerCase();
  if (!authority || !["video", "graphics"].includes(bucket)) {
    return { ok: false, status: 503, error: "authority_unavailable" };
  }
  if (authority[bucket] !== "linear") {
    return { ok: false, status: 409, error: "team_is_syncview_authoritative" };
  }
  return { ok: true, status: 200, error: "" };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function owns(value, key) {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

export function graphqlResponseHasErrors(value) {
  if (!isPlainObject(value)) return true;
  if (!owns(value, "errors")) return false;
  return !Array.isArray(value.errors) || value.errors.length > 0;
}

export function normalizeMetadataIssueIds(value) {
  if (!Array.isArray(value) || value.length < 1) {
    return { ok: false, error: "invalid_issue_ids", issueIds: [] };
  }
  if (value.length > MAX_METADATA_ISSUES) {
    return { ok: false, error: "too_many_issue_ids", issueIds: [] };
  }

  const issueIds = value.map(clean);
  if (issueIds.some((issueId) => !SAFE_ISSUE_ID.test(issueId))) {
    return { ok: false, error: "invalid_issue_id", issueIds: [] };
  }
  if (new Set(issueIds).size !== issueIds.length) {
    return { ok: false, error: "duplicate_issue_id", issueIds: [] };
  }
  return { ok: true, error: "", issueIds };
}

export function validIsoDateOrNull(value) {
  if (value === null) return true;
  const date = clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const parsed = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ));
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3]);
}

export function validRfc3339Timestamp(value) {
  if (typeof value !== "string" || value !== clean(value)) return false;
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return false;
  const date = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!date) return false;
  const parts = date.slice(1, 7).map(Number);
  const calendar = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return calendar.getUTCFullYear() === parts[0]
    && calendar.getUTCMonth() === parts[1] - 1
    && calendar.getUTCDate() === parts[2]
    && parts[3] <= 23 && parts[4] <= 59 && parts[5] <= 59
    && Number.isFinite(Date.parse(value));
}

export function sanitizeLabelColor(value) {
  const color = clean(value);
  return SAFE_HEX_COLOR.test(color) ? color.toUpperCase() : FALLBACK_LABEL_COLOR;
}

export function maxWorkloadLabel(value) {
  if (!Array.isArray(value)) return null;
  let selected = null;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    // Linear label names are a closed contract here: no aliases, case folding,
    // whitespace folding, or ASCII-x lookalikes may alter planning weight.
    const label = String(candidate.name == null ? "" : candidate.name);
    const weight = WORKLOAD_LABEL_WEIGHTS[label] || 0;
    if (!weight || (selected && selected.weight >= weight)) continue;
    selected = {
      label,
      weight,
      color: sanitizeLabelColor(candidate.color),
    };
  }
  return selected;
}

export function linearMetadataRow(value, expectedIssueId) {
  const issueId = clean(expectedIssueId);
  if (!isPlainObject(value)
      || !owns(value, "id")
      || value.id !== issueId
      || !owns(value, "dueDate")
      || !owns(value, "updatedAt")) {
    return { row: null, incomplete: true };
  }

  const dueDate = value.dueDate;
  if ((dueDate !== null && typeof dueDate !== "string")
      || (typeof dueDate === "string" && dueDate !== clean(dueDate))
      || !validIsoDateOrNull(dueDate)
      || !validRfc3339Timestamp(value.updatedAt)) {
    return { row: null, incomplete: true };
  }

  const labels = owns(value, "labels") && isPlainObject(value.labels)
    ? value.labels
    : null;
  const nodes = labels && owns(labels, "nodes") && Array.isArray(labels.nodes)
    ? labels.nodes
    : null;
  const pageInfo = labels && owns(labels, "pageInfo") && isPlainObject(labels.pageInfo)
    ? labels.pageInfo
    : null;
  const nodesComplete = !!nodes && nodes.every((node) => (
    isPlainObject(node)
    && owns(node, "name")
    && typeof node.name === "string"
    && owns(node, "color")
    && typeof node.color === "string"
  ));
  const pageComplete = !!pageInfo
    && owns(pageInfo, "hasNextPage")
    && typeof pageInfo.hasNextPage === "boolean";
  const connectionComplete = nodesComplete && pageComplete;

  return {
    row: {
      issue_id: issueId,
      due_date: dueDate,
      updated_at: clean(value.updatedAt),
      workload: maxWorkloadLabel(nodesComplete ? nodes : []),
    },
    incomplete: !connectionComplete || pageInfo.hasNextPage !== false,
  };
}

export function exactDueDateAcknowledgement(value, expectedIssueId, expectedDueDate) {
  const issueId = clean(expectedIssueId);
  if (!isPlainObject(value) || value.success !== true || !owns(value, "issue")) return null;
  const issue = value.issue;
  if (!isPlainObject(issue)
      || !owns(issue, "id")
      || issue.id !== issueId
      || !owns(issue, "dueDate")
      || !owns(issue, "updatedAt")
      || !validRfc3339Timestamp(issue.updatedAt)) {
    return null;
  }
  if (expectedDueDate === null) {
    if (issue.dueDate !== null) return null;
  } else if (typeof issue.dueDate !== "string" || issue.dueDate !== expectedDueDate) {
    return null;
  }
  return {
    issueId,
    dueDate: expectedDueDate,
    updatedAt: clean(issue.updatedAt),
  };
}

export function splitAliasBatches(issueIds) {
  const batches = [];
  for (let index = 0; index < issueIds.length; index += LINEAR_ALIAS_BATCH_SIZE) {
    batches.push(issueIds.slice(index, index + LINEAR_ALIAS_BATCH_SIZE));
  }
  return batches;
}

export function dueDateSuccessReceipt(issueId, dueDate, updatedAt, mirrorCount) {
  const mirrorUpdated = mirrorCount === 1 ? 1 : 0;
  return {
    ok: true,
    linear_committed: true,
    issue_id: clean(issueId),
    due_date: dueDate === null ? null : clean(dueDate),
    updated_at: clean(updatedAt),
    mirror_updated: mirrorUpdated,
    mirror_pending: mirrorUpdated !== 1,
  };
}

export function metadataSuccessReceipt(
  issueIds,
  rows,
  missingIssueIds,
  incompleteIssueIds,
) {
  const requested = Array.isArray(issueIds) ? issueIds.length : 0;
  const safeRows = Array.isArray(rows) ? rows : [];
  const missing = Array.isArray(missingIssueIds) ? missingIssueIds : [];
  const incomplete = Array.isArray(incompleteIssueIds) ? incompleteIssueIds : [];
  const returned = safeRows.length;
  return {
    ok: true,
    rows: safeRows,
    requested,
    returned,
    complete: returned === requested && missing.length === 0 && incomplete.length === 0,
    missing_issue_ids: missing,
    incomplete_issue_ids: incomplete,
  };
}
