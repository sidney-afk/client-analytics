// Collect one complete Linear issue-label relation. Selection pagination is
// independent from catalog pagination: no caller receives a partial merge.

const SAFE_LINEAR_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(object(value), key);
}

export class SelectedLabelPageError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = "SelectedLabelPageError";
    this.kind = kind;
  }
}

function fail(kind, reason) {
  throw new SelectedLabelPageError(kind, reason);
}

function selectedLabel(value, issueTeamId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid", "malformed_label_node");
  }
  const node = object(value);
  if (!has(node, "team")
      || !has(node, "archivedAt")
      || typeof node.isGroup !== "boolean") {
    fail("invalid", "malformed_label_node");
  }
  const id = clean(node.id);
  const name = clean(node.name);
  const color = clean(node.color);
  if (!SAFE_LINEAR_ID.test(id) || !name || !/^#[0-9a-f]{6}$/i.test(color)) {
    fail("invalid", "malformed_label_node");
  }
  const labelTeamId = clean(object(node.team).id);
  if (node.isGroup === true || (labelTeamId && labelTeamId !== issueTeamId)) {
    fail("invalid", "inapplicable_selected_label");
  }
  return {
    id,
    name,
    color,
    description: clean(node.description) || null,
  };
}

export async function collectCompleteSelectedLabels(options) {
  const issueId = clean(options && options.issueId);
  const expectedTeamId = clean(options && options.expectedTeamId);
  const maxPages = Number(options && options.maxPages);
  const fetchPage = options && options.fetchPage;
  if (!issueId
      || !expectedTeamId
      || !Number.isInteger(maxPages)
      || maxPages < 1
      || typeof fetchPage !== "function") {
    fail("invalid", "invalid_pagination_options");
  }

  let after = null;
  const cursors = new Set();
  const byId = new Map();

  for (let page = 0; page < maxPages; page++) {
    const data = object(await fetchPage(after));
    const issue = object(data.issue);
    if (clean(issue.id) !== issueId || clean(object(issue.team).id) !== expectedTeamId) {
      fail("identity", "issue_identity_changed");
    }
    const connection = object(issue.labels);
    if (!Array.isArray(connection.nodes)) {
      fail("invalid", "malformed_label_connection");
    }
    for (const raw of connection.nodes) {
      const label = selectedLabel(raw, expectedTeamId);
      if (byId.has(label.id)) fail("invalid", "duplicate_label_id");
      byId.set(label.id, label);
    }

    const pageInfo = object(connection.pageInfo);
    if (pageInfo.hasNextPage === false) {
      const labels = [...byId.values()]
        .sort((a, b) => clean(a.id).localeCompare(clean(b.id)));
      return {
        teamId: expectedTeamId,
        labels,
        ids: labels.map(label => label.id),
      };
    }
    if (pageInfo.hasNextPage !== true) {
      fail("incomplete", "ambiguous_page_state");
    }
    const cursor = clean(pageInfo.endCursor);
    if (!cursor || cursors.has(cursor) || page === maxPages - 1) {
      fail("incomplete", "invalid_or_exhausted_cursor");
    }
    cursors.add(cursor);
    after = cursor;
  }

  fail("incomplete", "page_limit_exhausted");
}
