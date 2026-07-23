// Pure normalization for the native issue-label relation. Linear webhook
// payloads may supply labelIds, label nodes, or both; native consumers may
// claim completeness only when one exact ID/metadata set can be proven.

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(object(value), key);
}

function rawNodes(value) {
  if (Array.isArray(value)) return value;
  const connection = object(value);
  return Array.isArray(connection.nodes) ? connection.nodes : null;
}

function inspectNodes(value, present) {
  const rows = rawNodes(value);
  const byId = new Map();
  const rawIds = new Set();
  const blockedIds = new Set();
  let sound = !present || rows !== null;

  for (const raw of rows || []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      sound = false;
      continue;
    }
    const node = object(raw);
    const id = clean(node.id);
    const name = clean(node.name);
    if (id) rawIds.add(id);
    if (!id || !name) {
      sound = false;
      if (id) blockedIds.add(id);
      continue;
    }
    if (byId.has(id)) {
      sound = false;
      blockedIds.add(id);
      byId.delete(id);
      continue;
    }
    if (!blockedIds.has(id)) byId.set(id, node);
  }
  for (const id of blockedIds) byId.delete(id);

  const connection = object(value);
  const relationComplete = Array.isArray(value)
    || object(connection.pageInfo).hasNextPage === false;
  return { byId, rawIds, blockedIds, sound, relationComplete, present };
}

function inspectIds(issue) {
  if (!has(issue, "labelIds")) return { present: false, ids: [], sound: true };
  if (!Array.isArray(issue.labelIds)) return { present: true, ids: [], sound: false };
  const ids = [];
  const seen = new Set();
  let sound = true;
  for (const raw of issue.labelIds) {
    if (typeof raw !== "string" || !clean(raw)) {
      sound = false;
      continue;
    }
    const id = clean(raw);
    if (seen.has(id)) {
      sound = false;
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return { present: true, ids: ids.sort(), sound };
}

function mergedNode(id, current, previous) {
  const live = object(current);
  const prior = object(previous);
  const description = has(live, "description")
    ? clean(live.description) || null
    : clean(prior.description) || null;
  return {
    ...prior,
    ...live,
    id,
    name: clean(live.name || prior.name),
    color: clean(live.color || prior.color || "#5e6ad2"),
    description,
  };
}

export function canonicalIssueLabelIds(issue) {
  const row = object(issue);
  const ids = Array.isArray(row.labelIds)
    ? row.labelIds
    : (rawNodes(row.labels) || []).map(label => object(label).id);
  return [...new Set(ids.filter(value => typeof value === "string").map(clean).filter(Boolean))].sort();
}

export function normalizeIssueLabelRelation(issueValue, previousIssueValue = {}) {
  const issue = object(issueValue);
  const previousIssue = object(previousIssueValue);
  const labelsPresent = has(issue, "labels");
  const current = inspectNodes(issue.labels, labelsPresent);
  const previous = inspectNodes(previousIssue.labels, has(previousIssue, "labels"));
  const requested = inspectIds(issue);

  if (!requested.present) {
    const nodes = [...current.byId.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, node]) => mergedNode(id, node, null));
    return {
      ids: nodes.map(node => node.id),
      nodes,
      complete: labelsPresent && current.sound && current.relationComplete,
    };
  }

  const wanted = new Set(requested.ids);
  const extraCurrent = [...current.rawIds].some(id => !wanted.has(id));
  const nodes = [];
  let metadataComplete = true;
  for (const id of requested.ids) {
    if (current.blockedIds.has(id)) {
      metadataComplete = false;
      continue;
    }
    const live = current.byId.get(id);
    const prior = previous.byId.get(id);
    // Previous metadata may fill a known ID only when this webhook omitted the
    // label connection. If Linear supplied labels, that current node set must
    // itself account for every requested ID.
    const chosen = live || (!labelsPresent ? prior : null);
    if (!chosen) {
      metadataComplete = false;
      continue;
    }
    const normalized = mergedNode(id, live, prior);
    if (!clean(normalized.id) || !clean(normalized.name)) {
      metadataComplete = false;
      continue;
    }
    nodes.push(normalized);
  }

  const nodeIds = nodes.map(node => clean(node.id)).sort();
  const exactSet = JSON.stringify(nodeIds) === JSON.stringify(requested.ids);
  return {
    ids: requested.ids,
    nodes,
    complete: requested.sound
      && current.sound
      && !extraCurrent
      && metadataComplete
      && exactSet,
  };
}
