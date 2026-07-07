'use strict';

const STATUS_SLUGS = new Set([
  'triage', 'backlog', 'todo', 'in_progress', 'smm_approval', 'kasper_approval',
  'client_approval', 'tweak', 'approved', 'scheduled', 'posted', 'canceled', 'duplicate',
]);
const SAMPLE_CLAMPED_STATES = new Set(['scheduled', 'posted']);

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function lower(v) {
  return clean(v).toLowerCase();
}

function parseJson(v) {
  if (!v) return {};
  if (typeof v === 'object' && !Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(String(v));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_e) {
    return {};
  }
}

function parseArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(x => x && typeof x === 'object');
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed.filter(x => x && typeof x === 'object') : [];
  } catch (_e) {
    return [];
  }
}

function normText(v) {
  return lower(v).replace(/\s+/g, ' ');
}

function statusFromName(name) {
  const n = normText(name);
  if (!n) return '';
  if (n.includes('triage')) return 'triage';
  if (n.includes('backlog')) return 'backlog';
  if (n === 'todo' || n.includes('to do')) return 'todo';
  if (n.includes('progress')) return 'in_progress';
  if (n.includes('smm')) return 'smm_approval';
  if (n.includes('kasper')) return 'kasper_approval';
  if (n.includes('tweak')) return 'tweak';
  if (n.includes('client')) return 'client_approval';
  if (n.includes('approved')) return 'approved';
  if (n.includes('scheduled')) return 'scheduled';
  if (n.includes('posted')) return 'posted';
  if (n.includes('cancel')) return 'canceled';
  if (n.includes('duplicate')) return 'duplicate';
  return '';
}

function normalizedStateMap(stateUuidMap) {
  const out = {};
  for (const [k, v] of Object.entries(stateUuidMap || {})) {
    const key = lower(k);
    const slug = lower(v);
    if (key && STATUS_SLUGS.has(slug)) out[key] = slug;
  }
  return out;
}

function mapLinearState(state, stateUuidMap = {}) {
  const s = state && typeof state === 'object' ? state : {};
  const map = normalizedStateMap(stateUuidMap);
  const id = lower(s.id);
  if (id && map[id]) return { slug: map[id], mapped_by: 'uuid' };
  for (const [prefix, slug] of Object.entries(map)) {
    if (id && id.startsWith(prefix)) return { slug, mapped_by: 'uuid_prefix' };
  }
  const byName = statusFromName(s.name);
  if (byName) return { slug: byName, mapped_by: 'name' };
  return {
    slug: '',
    unmapped_state: { id: clean(s.id), name: clean(s.name), type: clean(s.type) },
  };
}

function isoDate(v) {
  const s = clean(v);
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function daysBetween(a, b) {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Infinity;
  return Math.abs(Math.round((da - db) / 86400000));
}

function rawHasAny(raw, keys) {
  const stack = [raw].filter(Boolean);
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(cur, key) && cur[key]) return true;
    }
    for (const value of Object.values(cur)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return false;
}

function deliverableArchivedOrDeleted(row) {
  const raw = parseJson(row && row.linear_raw);
  return lower(row && row.status) === 'archived'
    || rawHasAny(raw, ['webhook_delete', 'deleted', 'delete', 'removed', 'archived'])
    || !!(raw.issue && (raw.issue.archivedAt || raw.issue.canceledAt));
}

function engineCommentIds(events) {
  const ids = new Set();
  for (const ev of events || []) {
    const action = lower(ev && ev.action);
    if (!action.includes('comment')) continue;
    const payload = parseJson(ev && ev.payload);
    const id = clean(payload.linear_comment_id
      || payload.comment_id
      || (payload.comment && payload.comment.id)
      || (payload.linear_comment && payload.linear_comment.id));
    if (id) ids.add(id);
  }
  return ids;
}

function linearCommentIds(issue) {
  const conn = issue && issue.comments && typeof issue.comments === 'object' ? issue.comments : {};
  const nodes = Array.isArray(conn.nodes) ? conn.nodes : [];
  return new Set(nodes.map(c => clean(c && c.id)).filter(Boolean));
}

function parentIdFromRaw(raw) {
  return clean((raw.issue && raw.issue.parent && raw.issue.parent.id)
    || (raw.parent && raw.parent.id)
    || (raw.parent_change && raw.parent_change.id)
    || raw.parent_id);
}

function linearParentId(issue) {
  return clean(issue && issue.parent && issue.parent.id);
}

function linearArchivedOrDeleted(issue) {
  if (!issue) return true;
  return !!(issue.archivedAt || issue.canceledAt || issue.deletedAt || issue.removedAt);
}

function addReal(out, field, expected, actual, reason) {
  out.diffs.push({ field, expected, actual, reason: reason || 'mismatch' });
}

function addTolerated(out, field, expected, actual, reason) {
  out.tolerated.push({ field, expected, actual, reason });
}

function classifyDeliverable(input) {
  const deliverable = input.deliverable || {};
  const issue = input.linearIssue || null;
  const events = input.events || [];
  const memberById = input.memberById || new Map();
  const memberByLinearId = input.memberByLinearId || new Map();
  const stateUuidMap = input.stateUuidMap || {};
  const authority = input.authority || 'linear';
  const raw = parseJson(deliverable.linear_raw);
  const out = {
    id: clean(deliverable.id),
    team: clean(deliverable.team),
    identifier: clean(deliverable.identifier || deliverable.linear_identifier),
    authority,
    row: deliverable,
    diffs: [],
    tolerated: [],
    repairs: [],
    patch: {},
  };

  if (!issue) {
    addReal(out, 'linear_issue', 'present', 'missing', 'linked Linear issue not returned');
    return out;
  }

  const state = mapLinearState(issue.state, stateUuidMap);
  if (!state.slug) {
    if (rawHasAny(raw, ['unmapped_state'])) {
      addTolerated(out, 'status', 'mapped state', state.unmapped_state, 'unmapped_state_refused');
    } else {
      addReal(out, 'status', 'mapped state', state.unmapped_state, 'unmapped_state');
    }
  } else if (state.slug !== clean(deliverable.status)) {
    if (deliverable.origin === 'samples' && SAMPLE_CLAMPED_STATES.has(state.slug)) {
      addTolerated(out, 'status', state.slug, clean(deliverable.status), 'clamped_sample_state');
    } else if (rawHasAny(raw, ['stale_linear_regress', 'refused_stale_regress'])) {
      addTolerated(out, 'status', state.slug, clean(deliverable.status), 'refused_stale_regress');
    } else {
      addReal(out, 'status', state.slug, clean(deliverable.status), 'state_mismatch');
      out.patch.status = state.slug;
    }
  }

  const linearTitle = clean(issue.title);
  if (linearTitle && linearTitle !== clean(deliverable.title)) {
    addReal(out, 'title', linearTitle, clean(deliverable.title), 'title_mismatch');
    out.patch.title = linearTitle;
  }

  const linearDue = isoDate(issue.dueDate);
  const deliverableDue = isoDate(deliverable.due_date);
  if (linearDue !== deliverableDue) {
    if (linearDue && deliverableDue && daysBetween(linearDue, deliverableDue) <= 2) {
      addTolerated(out, 'due_date', linearDue, deliverableDue, 'due_date_roller_or_plus_2d_churn');
    } else {
      addReal(out, 'due_date', linearDue || null, deliverableDue || null, 'due_date_mismatch');
      out.patch.due_date = linearDue || null;
    }
  }

  const linearPriority = issue.priority == null ? null : Number(issue.priority);
  const deliverablePriority = deliverable.priority == null || deliverable.priority === '' ? null : Number(deliverable.priority);
  if (linearPriority !== deliverablePriority) {
    addReal(out, 'priority', linearPriority, deliverablePriority, 'priority_mismatch');
    out.patch.priority = linearPriority;
  }

  const linearAssigneeId = clean(issue.assignee && issue.assignee.id);
  const deliverableMember = clean(deliverable.assignee_id) ? memberById.get(clean(deliverable.assignee_id)) : null;
  const deliverableLinearUserId = clean(deliverableMember && deliverableMember.linear_user_id);
  if (linearAssigneeId) {
    const expectedMember = memberByLinearId.get(linearAssigneeId);
    if (!expectedMember) {
      out.repairs.push({
        field: 'assignee_id',
        linear_user_id: linearAssigneeId,
        reason: 'unknown_assignee',
      });
    } else if (clean(expectedMember.id) !== clean(deliverable.assignee_id)) {
      addReal(out, 'assignee_id', clean(expectedMember.id), clean(deliverable.assignee_id) || null, 'assignee_mismatch');
      out.patch.assignee_id = clean(expectedMember.id);
    }
  } else if (deliverableLinearUserId) {
    addReal(out, 'assignee_id', null, clean(deliverable.assignee_id), 'assignee_should_be_null');
    out.patch.assignee_id = null;
  }

  const expectedParent = linearParentId(issue);
  const storedParent = parentIdFromRaw(raw);
  if (expectedParent !== storedParent) {
    addReal(out, 'parent', expectedParent || null, storedParent || null, 'parent_mismatch');
  }

  const linearGone = linearArchivedOrDeleted(issue);
  const storedGone = deliverableArchivedOrDeleted(deliverable);
  if (linearGone !== storedGone) {
    addReal(out, 'archived_deleted', linearGone, storedGone, 'archive_delete_mismatch');
  }

  const expectedComments = engineCommentIds(events);
  const actualComments = linearCommentIds(issue);
  for (const id of expectedComments) {
    if (!actualComments.has(id)) {
      addReal(out, 'comments', id, null, 'engine_comment_missing_in_linear');
    }
  }

  out.patch.linear_raw = Object.assign({}, raw, { issue });
  return out;
}

function linkageGaps(input) {
  const rows = [];
  const add = (source, row, component, linkColumn, idColumn) => {
    const link = clean(row && row[linkColumn]);
    const deliverableId = clean(row && row[idColumn]);
    if (!link || deliverableId) return;
    if (lower(row.status) === 'archived') return;
    rows.push({
      source,
      component,
      client_slug: clean(row.client || row.client_slug),
      card_id: clean(row.id || row.sample_id),
      link_column: linkColumn,
      deliverable_column: idColumn,
    });
  };
  for (const row of input.calendarPosts || []) {
    add('calendar', row, 'video', 'linear_issue_id', 'video_deliverable_id');
    add('calendar', row, 'graphic', 'graphic_linear_issue_id', 'graphic_deliverable_id');
  }
  for (const row of input.sampleReviews || []) {
    add('samples', row, 'video', 'linear_issue_id', 'video_deliverable_id');
    add('samples', row, 'graphic', 'graphic_linear_issue_id', 'graphic_deliverable_id');
  }
  return rows;
}

function summarize(results, linkageRows) {
  const byTeam = {};
  for (const r of results) {
    const team = r.team || 'unknown';
    if (!byTeam[team]) byTeam[team] = { deliverables: 0, diff_count: 0, diff_rows: 0, tolerated_count: 0, repair_list_size: 0, detect_only_rows: 0 };
    byTeam[team].deliverables++;
    byTeam[team].diff_count += r.diffs.length;
    byTeam[team].tolerated_count += r.tolerated.length;
    byTeam[team].repair_list_size += r.repairs.length;
    if (r.diffs.length) byTeam[team].diff_rows++;
    if (r.authority === 'supabase' && r.diffs.length) byTeam[team].detect_only_rows++;
  }
  return {
    deliverables_checked: results.length,
    diff_count: results.reduce((n, r) => n + r.diffs.length, 0),
    diff_rows: results.filter(r => r.diffs.length).length,
    tolerated_count: results.reduce((n, r) => n + r.tolerated.length, 0),
    repair_list_size: results.reduce((n, r) => n + r.repairs.length, 0),
    linkage_count: (linkageRows || []).length,
    by_team: byTeam,
  };
}

function summarizeWebhooks(webhooks) {
  const tracked = (webhooks || []).filter(w => ['VID', 'GRA'].includes(clean(w && w.team && w.team.key).toUpperCase()));
  const types = (w) => Array.isArray(w && w.resourceTypes) ? w.resourceTypes.map(clean) : parseArray(w && w.resourceTypes).map(clean);
  return {
    checked: tracked.length,
    enabled: tracked.filter(w => w.enabled === true).length,
    disabled: tracked.filter(w => w.enabled !== true).length,
    missing_comment_resource: tracked.filter(w => !types(w).includes('Comment')).length,
    missing_issue_resource: tracked.filter(w => !types(w).includes('Issue')).length,
  };
}

module.exports = {
  STATUS_SLUGS,
  SAMPLE_CLAMPED_STATES,
  clean,
  parseJson,
  statusFromName,
  mapLinearState,
  deliverableArchivedOrDeleted,
  engineCommentIds,
  classifyDeliverable,
  linkageGaps,
  summarize,
  summarizeWebhooks,
};
