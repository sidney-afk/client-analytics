'use strict';

/*
 * TEST-only B3 inbound mirror scenario harness.
 *
 * Required for a live run:
 *   B3_CONFIRM_TEST_MUTATIONS=1
 *   B3_TEST_PROJECT_ID, B3_TEST_CLIENT_SLUG
 *   B3_TEST_PRIMARY_ISSUE, B3_TEST_PARENT_ISSUE
 *   B3_TEST_CROSS_VIDEO_ISSUE, B3_TEST_CROSS_GRAPHIC_ISSUE
 *   LINEAR_API_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Supabase observations always use the public anon key. The service key is
 * restricted to batch_write/deliverable_write snapshot cleanup after a
 * scenario verdict. Linear mutations are restricted to VID-/GRA- issues in
 * the configured TEST project. The script never reads or writes mirror_outbox
 * and never reads or changes runtime flags.
 */

const fs = require('fs');
const path = require('path');
const {
  clean,
  parseJson,
  mapLinearState,
  classifyDeliverable,
} = require('./linear-deliverables-reconcile-lib');

const SUPABASE_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const TEST_PROJECT_NAME = String(process.env.B3_TEST_PROJECT_NAME || 'Sidney Laruel').trim();
const CONFIRMED = process.env.B3_CONFIRM_TEST_MUTATIONS === '1';
const LINEAR_KEY = String(process.env.LINEAR_API_KEY || '').trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const RUN_MARKER = `b3-mirror-${Date.now().toString(36)}`;

const ISSUE_FIELDS = `
  id identifier title description url priority dueDate archivedAt canceledAt completedAt updatedAt
  state { id name type }
  team { id key name }
  project { id name }
  assignee { id name email }
  parent { id identifier title project { id name } team { id key } }
  comments(first: 100) { nodes { id body url createdAt user { id name email } } }
`;

const STATUS_LADDER = [
  { label: 'Todo', slug: 'todo' },
  { label: 'In Progress', slug: 'in_progress' },
  { label: 'For SMM approval', slug: 'smm_approval' },
  { label: 'Tweak Needed', slug: 'tweak' },
  // Active VID/GRA teams call the old "Tweak Applied" gate "For Kasper approval".
  { label: 'Tweak Applied', slug: 'kasper_approval', activeAlias: 'For Kasper approval' },
  { label: 'Approved', slug: 'approved' },
  { label: 'Tweak Needed (backward regression)', slug: 'tweak', backward: true },
  { label: 'Approved (resume ladder)', slug: 'approved' },
  { label: 'Posted', slug: 'posted' },
];

function parseArgs(argv = process.argv.slice(2)) {
  const out = new Map();
  for (const arg of argv) {
    const match = String(arg).match(/^--([^=]+)(?:=(.*))?$/);
    if (match) out.set(match[1], match[2] == null ? '1' : match[2]);
  }
  return out;
}

function publicAnonKey() {
  const explicit = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (explicit) return explicit;
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const match = source.match(/const CAL_SUPABASE_ANON_KEY = '([^']+)'/);
  return match ? match[1] : '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableLinearRead(query, status) {
  return /^\s*query\b/.test(String(query || '')) && (Number(status) === 429 || Number(status) >= 500);
}

function parseThread(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_error) {
    return [];
  }
}

function normalizePriority(value) {
  return value == null || value === '' ? null : Number(value);
}

function normalizeDate(value) {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function rawHasAny(raw, keys) {
  const stack = raw && typeof raw === 'object' ? [raw] : [];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(current, key) && current[key]) return true;
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return false;
}

function rawContains(raw, candidates) {
  const wanted = new Set((candidates || []).map(clean).filter(Boolean));
  const stack = raw && typeof raw === 'object' ? [raw] : [];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
      else if (wanted.has(clean(value))) return true;
    }
  }
  return false;
}

function isMirrorVisible(row) {
  if (!row) return false;
  const raw = parseJson(row.linear_raw);
  if (clean(row.status).toLowerCase() === 'archived') return false;
  if (rawHasAny(raw, ['webhook_delete', 'deleted', 'delete', 'removed', 'archived'])) return false;
  if (raw.issue && (raw.issue.archivedAt || raw.issue.canceledAt)) return false;
  for (const key of ['raw_issue_archived_at', 'raw_issue_canceled_at', 'raw_webhook_delete', 'raw_deleted', 'raw_delete', 'raw_removed', 'raw_archived']) {
    const value = clean(row[key]).toLowerCase();
    if (value && !['false', '0', 'null'].includes(value)) return false;
  }
  return true;
}

function parentIdFromRow(row) {
  const raw = parseJson(row && row.linear_raw);
  return clean(raw.issue && raw.issue.parent && raw.issue.parent.id);
}

function issueSnapshot(issue) {
  return {
    id: clean(issue.id),
    identifier: clean(issue.identifier),
    title: clean(issue.title),
    stateId: clean(issue.state && issue.state.id),
    dueDate: normalizeDate(issue.dueDate) || null,
    priority: normalizePriority(issue.priority) == null ? 0 : normalizePriority(issue.priority),
    assigneeId: clean(issue.assignee && issue.assignee.id) || null,
    parentId: clean(issue.parent && issue.parent.id) || null,
    archived: !!issue.archivedAt,
  };
}

function assertTestIssue(issue, config, expectedTeam) {
  if (!issue || !issue.id) throw new Error('Refusing mutation: Linear issue was not returned');
  const identifier = clean(issue.identifier).toUpperCase();
  const team = clean(issue.team && issue.team.key).toUpperCase();
  const projectId = clean(issue.project && issue.project.id);
  const projectName = clean(issue.project && issue.project.name);
  if (!/^(VID|GRA)-\d+$/.test(identifier)) throw new Error(`Refusing mutation: unsafe identifier ${identifier || 'missing'}`);
  if (!['VID', 'GRA'].includes(team) || !identifier.startsWith(`${team}-`)) {
    throw new Error(`Refusing mutation: identifier/team mismatch ${identifier}/${team}`);
  }
  if (expectedTeam && team !== String(expectedTeam).toUpperCase()) {
    throw new Error(`Refusing mutation: expected ${expectedTeam}, got ${team}`);
  }
  if (projectId !== config.projectId || projectName !== config.projectName) {
    throw new Error(`Refusing mutation: ${identifier} is outside the configured TEST project`);
  }
  return issue;
}

function stateMapFromTeams(teams) {
  const map = {};
  for (const team of teams || []) {
    const nodes = team && team.states && Array.isArray(team.states.nodes) ? team.states.nodes : [];
    for (const state of nodes) {
      const mapped = mapLinearState(state, {});
      if (mapped.slug) map[clean(state.id).toLowerCase()] = mapped.slug;
    }
  }
  return map;
}

function findState(teams, teamKey, slug) {
  const team = (teams || []).find(row => clean(row.key).toUpperCase() === clean(teamKey).toUpperCase());
  const states = team && team.states && Array.isArray(team.states.nodes) ? team.states.nodes : [];
  return states.find(state => mapLinearState(state, {}).slug === slug) || null;
}

function eventInnerPayload(event) {
  const outer = parseJson(event && event.payload);
  return parseJson(outer.payload || outer);
}

function eventCommentId(event) {
  const payload = eventInnerPayload(event);
  return clean(payload.linear_comment_id || payload.comment_id);
}

function commentObservation(threadValue, genuineMarker, echoMarker) {
  const thread = parseThread(threadValue);
  const genuine = thread.filter(item => clean(item && item.body).includes(genuineMarker));
  const echoes = thread.filter(item => clean(item && item.body).includes(echoMarker));
  const pinned = genuine.length === 1 && genuine[0]
    && genuine[0].is_tweak === false
    && genuine[0].done === false
    && genuine[0].round === null
    && genuine[0].parent_id === null
    && clean(genuine[0].author);
  return { genuine_count: genuine.length, echo_count: echoes.length, pinned: !!pinned };
}

function compactReconcile(result) {
  return {
    diff_count: result.diffs.length,
    tolerated_count: result.tolerated.length,
    repair_list_size: result.repairs.length,
    diff_fields: result.diffs.map(item => item.field),
    tolerated_reasons: result.tolerated.map(item => item.reason),
    repair_reasons: result.repairs.map(item => item.reason),
  };
}

function compactPollObservation(value) {
  if (Array.isArray(value)) return { count: value.length };
  if (!value || typeof value !== 'object') return value;
  if (!Object.prototype.hasOwnProperty.call(value, 'linear_raw') && !value.linear_issue_uuid) return value;
  return {
    id: clean(value.id),
    identifier: clean(value.identifier || value.linear_identifier),
    status: clean(value.status),
    due_date: normalizeDate(value.due_date) || null,
    assignee_id: clean(value.assignee_id) || null,
    parent_id: parentIdFromRow(value) || null,
    visible: isMirrorVisible(value),
    updated_at: clean(value.updated_at) || null,
  };
}

function markdownReport(report) {
  const esc = value => String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const lines = [
    '# B3 inbound mirror scenario harness',
    '',
    `Run: ${report.run_marker}`,
    `Started: ${report.started_at}`,
    `Finished: ${report.finished_at || ''}`,
    `TEST project: ${report.test_project_name}`,
    '',
    '| Scenario | Result | Latency | Fired | Expected | Observed |',
    '|---|---|---:|---|---|---|',
  ];
  for (const item of report.scenarios || []) {
    lines.push(`| ${esc(item.name)} | ${esc(item.status)} | ${item.latency_ms == null ? '' : `${item.latency_ms} ms`} | ${esc(JSON.stringify(item.fired))} | ${esc(JSON.stringify(item.expected))} | ${esc(JSON.stringify(item.observed))} |`);
  }
  lines.push('', `Totals: ${report.passed || 0} PASS / ${report.failed || 0} FAIL / ${report.total || 0} scenarios.`);
  if (report.final_reconciler) {
    lines.push(`Final reconciler: diff=${report.final_reconciler.diff_count}, repair=${report.final_reconciler.repair_list_size}, linkage=${report.final_reconciler.linkage_actionable}.`);
  }
  lines.push(`Cleanup: ${report.cleanup_complete ? 'complete' : 'INCOMPLETE'}.`);
  return lines.join('\n') + '\n';
}

class Harness {
  constructor(config) {
    this.config = config;
    this.context = null;
    this.results = [];
    this.createdIssues = [];
    this.runStartedAt = new Date().toISOString();
  }

  async linear(query, variables = {}) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { Authorization: this.config.linearKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      const json = await response.json().catch(() => null);
      if (response.ok && json && !json.errors) return json.data;
      if (attempt < 3 && isRetryableLinearRead(query, response.status)) {
        await sleep(500 * (2 ** (attempt - 1)));
        continue;
      }
      throw new Error(`Linear request failed: HTTP ${response.status} ${JSON.stringify(json && json.errors || json).slice(0, 500)}`);
    }
    throw new Error('Linear read retry loop exhausted');
  }

  async supabaseRead(restPath) {
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/${restPath}`, {
      method: 'GET',
      headers: {
        apikey: this.config.anonKey,
        Authorization: `Bearer ${this.config.anonKey}`,
        Accept: 'application/json',
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase anon read failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  async cleanupRpc(name, body) {
    if (!['deliverable_write', 'batch_write'].includes(name)) throw new Error(`Cleanup RPC ${name} is not allowed`);
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: this.config.serviceKey,
        Authorization: `Bearer ${this.config.serviceKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Cleanup RPC ${name} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  async readIssue(id) {
    const data = await this.linear(`query B3HarnessIssue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id });
    return data.issue || null;
  }

  async readDeliverable(issue) {
    if (!issue) return null;
    const uuid = clean(issue.id);
    const identifier = clean(issue.identifier);
    let rows = uuid
      ? await this.supabaseRead(`deliverables?select=*&linear_issue_uuid=eq.${encodeURIComponent(uuid)}&limit=2`)
      : [];
    if ((!Array.isArray(rows) || !rows.length) && identifier) {
      rows = await this.supabaseRead(`deliverables?select=*&linear_identifier=eq.${encodeURIComponent(identifier)}&limit=2`);
    }
    if (!Array.isArray(rows) || !rows.length) return null;
    if (rows.length !== 1) throw new Error(`Expected one deliverable for ${identifier}; found ${rows.length}`);
    return rows[0];
  }

  async readEvents(deliverableId, afterId = 0) {
    return await this.supabaseRead(
      `deliverable_events?select=id,ts,action,source,payload&deliverable_id=eq.${encodeURIComponent(deliverableId)}`
      + `&source=eq.mirror&id=gt.${Number(afterId || 0)}&order=id.asc&limit=500`,
    );
  }

  async eventCursor(deliverableId) {
    const rows = await this.supabaseRead(
      `deliverable_events?select=id&deliverable_id=eq.${encodeURIComponent(deliverableId)}&order=id.desc&limit=1`,
    );
    return Array.isArray(rows) && rows[0] ? Number(rows[0].id || 0) : 0;
  }

  async readLatestReconciler() {
    const rows = await this.supabaseRead(
      'deliverable_events?select=id,ts,payload&action=eq.linear_deliverables_reconcile_v2&order=id.desc&limit=1',
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const payload = parseJson(row && row.payload);
    return row ? { id: row.id, ts: row.ts, summary: parseJson(payload.summary) } : null;
  }

  async poll(fn, accept, label, timeoutMs = this.config.timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let latest;
    while (Date.now() < deadline) {
      latest = await fn();
      if (await accept(latest)) return latest;
      await sleep(this.config.pollMs);
    }
    const error = new Error(`${label} timed out after ${timeoutMs} ms`);
    error.latest = latest;
    throw error;
  }

  async updateIssue(issue, input) {
    assertTestIssue(issue, this.config);
    const allowed = new Set(['title', 'stateId', 'dueDate', 'priority', 'assigneeId', 'parentId']);
    for (const key of Object.keys(input || {})) {
      if (!allowed.has(key)) throw new Error(`Refusing unsafe issueUpdate field: ${key}`);
    }
    const data = await this.linear(`
      mutation B3HarnessUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } }
      }
    `, { id: issue.id, input });
    if (!data.issueUpdate || data.issueUpdate.success !== true || !data.issueUpdate.issue) {
      throw new Error(`Linear issueUpdate was not acknowledged for ${issue.identifier}`);
    }
    return assertTestIssue(data.issueUpdate.issue, this.config);
  }

  async archiveIssue(issue) {
    assertTestIssue(issue, this.config);
    const data = await this.linear(`mutation B3HarnessArchive($id: String!) { issueArchive(id: $id) { success } }`, { id: issue.id });
    if (!data.issueArchive || data.issueArchive.success !== true) throw new Error(`Linear archive was not acknowledged for ${issue.identifier}`);
    return assertTestIssue(await this.readIssue(issue.id), this.config);
  }

  async unarchiveIssue(issue) {
    assertTestIssue(issue, this.config);
    const data = await this.linear(`mutation B3HarnessUnarchive($id: String!) { issueUnarchive(id: $id) { success } }`, { id: issue.id });
    if (!data.issueUnarchive || data.issueUnarchive.success !== true) throw new Error(`Linear unarchive was not acknowledged for ${issue.identifier}`);
    return assertTestIssue(await this.readIssue(issue.id), this.config);
  }

  async createIssue(team, input) {
    const key = clean(team && team.key).toUpperCase();
    if (!['VID', 'GRA'].includes(key)) throw new Error(`Refusing create for non-TEST team ${key || 'missing'}`);
    if (clean(input.projectId) !== this.config.projectId || clean(input.teamId) !== clean(team.id)) {
      throw new Error('Refusing issueCreate outside the configured TEST project/team');
    }
    const data = await this.linear(`
      mutation B3HarnessCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
      }
    `, { input });
    if (!data.issueCreate || data.issueCreate.success !== true || !data.issueCreate.issue) throw new Error('Linear issueCreate was not acknowledged');
    const issue = assertTestIssue(data.issueCreate.issue, this.config, key);
    this.createdIssues.push(issue.id);
    return issue;
  }

  async createComment(issue, body) {
    assertTestIssue(issue, this.config);
    if (!clean(body).includes(RUN_MARKER)) throw new Error('Refusing to create an unmarked harness comment');
    const data = await this.linear(`
      mutation B3HarnessComment($input: CommentCreateInput!) {
        commentCreate(input: $input) { success comment { id body url createdAt user { id name email } } }
      }
    `, { input: { issueId: issue.id, body } });
    if (!data.commentCreate || data.commentCreate.success !== true || !data.commentCreate.comment) throw new Error('Linear commentCreate was not acknowledged');
    return data.commentCreate.comment;
  }

  async deleteComment(issue, commentId) {
    assertTestIssue(issue, this.config);
    if (!commentId) return;
    const data = await this.linear(`mutation B3HarnessCommentCleanup($id: String!) { commentDelete(id: $id) { success } }`, { id: commentId });
    if (!data.commentDelete || data.commentDelete.success !== true) throw new Error('Linear comment cleanup was not acknowledged');
  }

  async preflight() {
    const [clients, projectData, usersData, members] = await Promise.all([
      this.supabaseRead(`clients?select=slug,display_name,kind,active&slug=eq.${encodeURIComponent(this.config.clientSlug)}&limit=2`),
      this.linear(`query B3HarnessProject($id: String!) {
        project(id: $id) { id name archivedAt teams { nodes { id key name states { nodes { id name type position } } } } }
      }`, { id: this.config.projectId }),
      this.linear('query B3HarnessUsers { users(first: 100) { nodes { id active } } }'),
      this.supabaseRead('team_members?select=id,name,email,linear_user_id,team,active&order=id.asc'),
    ]);
    if (!Array.isArray(clients) || clients.length !== 1) throw new Error('Configured TEST client must resolve exactly once');
    const client = clients[0];
    if (client.kind !== 'test' || client.active !== true || client.display_name !== this.config.projectName) {
      throw new Error('Configured client is not the active TEST client');
    }
    const project = projectData.project;
    if (!project || project.id !== this.config.projectId || project.name !== this.config.projectName || project.archivedAt) {
      throw new Error('Configured Linear TEST project is unavailable');
    }
    const teams = project.teams && Array.isArray(project.teams.nodes) ? project.teams.nodes : [];
    if (!['VID', 'GRA'].every(key => teams.some(team => clean(team.key).toUpperCase() === key))) {
      throw new Error('TEST project must include both VID and GRA teams');
    }

    const issueIds = [
      this.config.primaryIssue,
      this.config.parentIssue,
      this.config.crossVideoIssue,
      this.config.crossGraphicIssue,
    ];
    const issues = await Promise.all(issueIds.map(id => this.readIssue(id)));
    issues.forEach(issue => assertTestIssue(issue, this.config));
    assertTestIssue(issues[0], this.config, 'VID');
    assertTestIssue(issues[1], this.config, 'VID');
    assertTestIssue(issues[2], this.config, 'VID');
    assertTestIssue(issues[3], this.config, 'GRA');

    const rows = await Promise.all(issues.map(issue => this.readDeliverable(issue)));
    rows.forEach((row, index) => {
      if (!row || row.client_slug !== this.config.clientSlug) throw new Error(`TEST issue ${issues[index].identifier} is not mirrored to the TEST client`);
    });
    if (isMirrorVisible(rows[0])) throw new Error('Primary harness issue must start hidden/canceled so it can be restored safely');
    if (rows[2].batch_id !== rows[3].batch_id) throw new Error('Cross-team fixtures must share one mirrored batch');

    const memberById = new Map(members.map(member => [clean(member.id), member]).filter(([id]) => id));
    const memberByLinearId = new Map(members.map(member => [clean(member.linear_user_id), member]).filter(([id]) => id));
    const users = usersData.users && Array.isArray(usersData.users.nodes) ? usersData.users.nodes : [];
    const knownUsers = users.filter(user => user.active && memberByLinearId.has(clean(user.id)));
    if (knownUsers.length < 2) throw new Error('Two mapped Linear users are required for the assignee scenario');
    const unknownUser = users.find(user => user.active && !memberByLinearId.has(clean(user.id))) || null;
    if (!unknownUser) throw new Error('An unmapped Linear user is required for the repair-list scenario');

    const stateUuidMap = stateMapFromTeams(teams);
    const unmappedState = teams.flatMap(team => team.states && team.states.nodes || [])
      .find(state => !mapLinearState(state, stateUuidMap).slug) || null;

    this.context = {
      client,
      project,
      teams,
      users,
      members,
      memberById,
      memberByLinearId,
      knownUsers: knownUsers.slice(0, 2),
      unknownUser,
      unmappedState,
      stateUuidMap,
      issues: {
        primary: issues[0],
        parent: issues[1],
        crossVideo: issues[2],
        crossGraphic: issues[3],
      },
      rows: {
        primary: rows[0],
        crossVideo: rows[2],
        crossGraphic: rows[3],
      },
    };
    return this.context;
  }

  async targetedReconcile(issue, row) {
    const events = await this.readEvents(row.id, 0);
    return classifyDeliverable({
      deliverable: row,
      linearIssue: issue,
      events,
      memberById: this.context.memberById,
      memberByLinearId: this.context.memberByLinearId,
      stateUuidMap: this.context.stateUuidMap,
      authority: 'linear',
    });
  }

  async waitForReflection(issueId, rowPredicate, expectedAction, cursor, label) {
    const started = Date.now();
    const row = await this.poll(
      async () => this.readDeliverable(await this.readIssue(issueId)),
      current => !!current && rowPredicate(current),
      `${label} row reflection`,
    );
    let events = [];
    if (expectedAction) {
      events = await this.poll(
        () => this.readEvents(row.id, cursor),
        current => Array.isArray(current) && current.some(event => expectedAction instanceof RegExp
          ? expectedAction.test(clean(event.action))
          : clean(event.action) === expectedAction),
        `${label} mirror event`,
      );
    }
    const issue = assertTestIssue(await this.readIssue(issueId), this.config);
    const reconcile = compactReconcile(await this.targetedReconcile(issue, row));
    return { row, issue, events, reconcile, latency_ms: Date.now() - started };
  }

  assertReconcile(reconcile, options = {}) {
    const expectedRepairs = Number(options.repairs || 0);
    if (reconcile.diff_count !== 0) throw new Error(`Targeted reconciler found ${reconcile.diff_count} real diff(s): ${reconcile.diff_fields.join(',')}`);
    if (reconcile.repair_list_size !== expectedRepairs) {
      throw new Error(`Targeted reconciler repair count ${reconcile.repair_list_size}; expected ${expectedRepairs}`);
    }
    if (options.toleratedReason && !reconcile.tolerated_reasons.includes(options.toleratedReason)) {
      throw new Error(`Expected tolerated reason ${options.toleratedReason}`);
    }
  }

  async restoreLinearSnapshot(snapshot) {
    let current = assertTestIssue(await this.readIssue(snapshot.id), this.config);
    if (current.archivedAt) current = await this.unarchiveIssue(current);
    current = await this.updateIssue(current, {
      title: snapshot.title,
      stateId: snapshot.stateId,
      dueDate: snapshot.dueDate,
      priority: snapshot.priority,
      assigneeId: snapshot.assigneeId,
      parentId: snapshot.parentId,
    });
    if (snapshot.archived) current = await this.archiveIssue(current);
    await this.poll(
      () => this.readIssue(snapshot.id),
      issue => {
        if (!issue) return false;
        const actual = issueSnapshot(issue);
        return actual.title === snapshot.title
          && actual.stateId === snapshot.stateId
          && actual.dueDate === snapshot.dueDate
          && actual.priority === snapshot.priority
          && actual.assigneeId === snapshot.assigneeId
          && actual.parentId === snapshot.parentId
          && actual.archived === snapshot.archived;
      },
      `Linear cleanup ${snapshot.identifier}`,
    );
  }

  async restoreDeliverableSnapshot(row) {
    await this.cleanupRpc('deliverable_write', {
      p_row: row,
      p_event: {
        actor: 'B3 TEST harness',
        role: 'system',
        action: 'b3_mirror_harness_cleanup',
        source: 'system',
        probe: 'b3_mirror_scenario_harness',
        marker: RUN_MARKER,
      },
    });
  }

  async withRestoration(issueIds, work, extraCleanup) {
    const issues = await Promise.all(issueIds.map(id => this.readIssue(id)));
    issues.forEach(issue => assertTestIssue(issue, this.config));
    const issueSnapshots = issues.map(issueSnapshot);
    const rowSnapshots = await Promise.all(issues.map(issue => this.readDeliverable(issue)));
    let value;
    let workError = null;
    try {
      value = await work({ issues, rows: rowSnapshots });
    } catch (error) {
      workError = error;
    }

    let cleanupError = null;
    try {
      if (extraCleanup) await extraCleanup({ issues, rows: rowSnapshots });
      for (const snapshot of issueSnapshots) await this.restoreLinearSnapshot(snapshot);
      // Exact TEST-row snapshot restore is deliberately after the assertion.
      for (const row of rowSnapshots) if (row) await this.restoreDeliverableSnapshot(row);
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError) {
      cleanupError.cleanupFatal = true;
      throw cleanupError;
    }
    if (workError) throw workError;
    return value;
  }

  async runScenario(name, expected, fn) {
    const trace = { fired: [], expected, observed: null };
    const started = Date.now();
    let status = 'PASS';
    let errorText = '';
    try {
      const observed = await fn(trace);
      trace.observed = observed == null ? trace.observed : observed;
    } catch (error) {
      status = 'FAIL';
      errorText = error && error.message ? error.message : String(error);
      if (error && error.latest !== undefined && trace.observed == null) trace.observed = compactPollObservation(error.latest);
      if (error && error.cleanupFatal) {
        const result = { name, status, fired: trace.fired, expected, observed: trace.observed, error: errorText, latency_ms: Date.now() - started };
        this.results.push(result);
        console.log(JSON.stringify(result));
        throw error;
      }
    }
    const result = {
      name,
      status,
      fired: trace.fired,
      expected,
      observed: trace.observed,
      error: errorText || undefined,
      latency_ms: Date.now() - started,
    };
    this.results.push(result);
    console.log(JSON.stringify(result));
    return result;
  }

  async activatePrimary() {
    const todo = findState(this.context.teams, 'VID', 'todo');
    if (!todo) throw new Error('VID Todo state is required');
    let issue = assertTestIssue(await this.readIssue(this.config.primaryIssue), this.config, 'VID');
    if (issue.archivedAt) issue = await this.unarchiveIssue(issue);
    const cursor = await this.eventCursor(this.context.rows.primary.id);
    issue = await this.updateIssue(issue, { stateId: todo.id });
    await this.waitForReflection(issue.id, row => row.status === 'todo' && isMirrorVisible(row), 'mirror_in_status_change', cursor, 'primary activation');
  }

  async scenarioCreate(trace) {
    const video = this.context.teams.find(team => clean(team.key).toUpperCase() === 'VID');
    const todo = findState(this.context.teams, 'VID', 'todo');
    let parent = null;
    let child = null;
    try {
      parent = await this.createIssue(video, {
        teamId: video.id,
        projectId: this.config.projectId,
        stateId: todo.id,
        title: `B3 HARNESS PARENT ${RUN_MARKER}`,
      });
      trace.fired.push(`${parent.identifier}:create_parent`);
      child = await this.createIssue(video, {
        teamId: video.id,
        projectId: this.config.projectId,
        stateId: todo.id,
        parentId: parent.id,
        title: `B3 HARNESS CHILD ${RUN_MARKER}`,
      });
      trace.fired.push(`${child.identifier}:create_sub_issue`);

      const observed = await this.poll(async () => {
        const [parentRow, childRow, batches] = await Promise.all([
          this.readDeliverable(parent),
          this.readDeliverable(child),
          this.supabaseRead(`batches?select=*&client_slug=eq.${encodeURIComponent(this.config.clientSlug)}&limit=500`),
        ]);
        const batch = (batches || []).find(row => rawContains(parseJson(row.linear_parent_ids), [parent.id, parent.identifier]));
        return { parent_row: !!parentRow, child_row: !!childRow, batch_row: !!batch };
      }, current => current.parent_row && current.child_row && current.batch_row, 'create parent/sub inbound reflection', this.config.createTimeoutMs);
      trace.observed = observed;
      return observed;
    } finally {
      for (const issue of [child, parent].filter(Boolean)) {
        const current = await this.readIssue(issue.id);
        if (current && !current.archivedAt) await this.archiveIssue(current);
      }
      for (const issue of [child, parent].filter(Boolean)) {
        const row = await this.readDeliverable(issue);
        if (row) {
          await this.poll(() => this.readDeliverable(issue), current => !!current && !isMirrorVisible(current), `created issue cleanup ${issue.identifier}`);
        }
      }
      if (parent) {
        const batches = await this.supabaseRead(`batches?select=*&client_slug=eq.${encodeURIComponent(this.config.clientSlug)}&limit=500`);
        const batch = (batches || []).find(row => rawContains(parseJson(row.linear_parent_ids), [parent.id, parent.identifier]));
        if (batch && batch.status !== 'archived') {
          await this.cleanupRpc('batch_write', {
            p_row: { ...batch, status: 'archived' },
            p_event: {
              actor: 'B3 TEST harness',
              role: 'system',
              action: 'b3_mirror_harness_cleanup',
              source: 'system',
              probe: 'b3_mirror_scenario_harness',
              marker: RUN_MARKER,
            },
          });
        }
      }
    }
  }

  async scenarioStatusLadder(trace) {
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      let issue = issues[0];
      const row = rows[0];
      const steps = [];
      for (const step of STATUS_LADDER) {
        const state = findState(this.context.teams, 'VID', step.slug);
        if (!state) throw new Error(`Missing VID state for ${step.label}`);
        const cursor = await this.eventCursor(row.id);
        const firedAt = Date.now();
        trace.fired.push(`${issue.identifier}:state=${state.name}`);
        issue = await this.updateIssue(issue, { stateId: state.id });
        const reflected = await this.waitForReflection(issue.id, current => current.status === step.slug, 'mirror_in_status_change', cursor, step.label);
        this.assertReconcile(reflected.reconcile);
        steps.push({ requested: step.label, linear_state: state.name, observed: reflected.row.status, event_actions: [...new Set(reflected.events.map(event => event.action))], latency_ms: Date.now() - firedAt, backward: !!step.backward });
      }
      trace.observed = { steps, active_tweak_applied_alias: steps.find(step => step.requested === 'Tweak Applied').linear_state };
      return trace.observed;
    });
  }

  async scenarioSimpleField(trace, field, values, expectedAction, rowValue) {
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      let issue = issues[0];
      const row = rows[0];
      const steps = [];
      for (const value of values) {
        const cursor = await this.eventCursor(row.id);
        const input = { [field]: value };
        trace.fired.push(`${issue.identifier}:${field}=${value == null ? 'null' : value}`);
        const firedAt = Date.now();
        issue = await this.updateIssue(issue, input);
        const reflected = await this.waitForReflection(issue.id, current => rowValue(current) === value, expectedAction, cursor, `${field}=${value}`);
        this.assertReconcile(reflected.reconcile);
        steps.push({ value, observed: rowValue(reflected.row), event_actions: [...new Set(reflected.events.map(event => event.action))], latency_ms: Date.now() - firedAt });
      }
      trace.observed = { steps };
      return trace.observed;
    });
  }

  async scenarioKnownAssignees(trace) {
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      let issue = issues[0];
      const row = rows[0];
      const steps = [];
      for (const user of [...this.context.knownUsers, null]) {
        const linearId = user ? clean(user.id) : null;
        const expectedMember = user ? this.context.memberByLinearId.get(linearId) : null;
        const expectedId = expectedMember ? clean(expectedMember.id) : null;
        const cursor = await this.eventCursor(row.id);
        trace.fired.push(`${issue.identifier}:assignee=${linearId || 'null'}`);
        const firedAt = Date.now();
        issue = await this.updateIssue(issue, { assigneeId: linearId });
        const reflected = await this.waitForReflection(
          issue.id,
          current => (clean(current.assignee_id) || null) === expectedId,
          /^mirror_in_/,
          cursor,
          `assignee=${linearId || 'null'}`,
        );
        this.assertReconcile(reflected.reconcile);
        steps.push({ linear_user_id: linearId, team_member_id: expectedId, event_actions: [...new Set(reflected.events.map(event => event.action))], latency_ms: Date.now() - firedAt });
      }
      trace.observed = { steps };
      return trace.observed;
    });
  }

  async scenarioUnknownAssignee(trace) {
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      const issue = issues[0];
      const row = rows[0];
      const unknownId = clean(this.context.unknownUser.id);
      const cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:assignee=unmapped:${unknownId}`);
      await this.updateIssue(issue, { assigneeId: unknownId });
      const reflected = await this.waitForReflection(
        issue.id,
        current => !clean(current.assignee_id) && rawHasAny(parseJson(current.linear_raw), ['unknown_assignee']),
        /^mirror_in_/,
        cursor,
        'unknown assignee',
      );
      this.assertReconcile(reflected.reconcile, { repairs: 1 });
      trace.observed = { assignee_id: reflected.row.assignee_id || null, reconcile: reflected.reconcile };
      return trace.observed;
    });
  }

  async scenarioUnmappedState(trace) {
    const state = this.context.unmappedState;
    if (!state) {
      trace.observed = { blocked: 'No active VID/GRA workflow state is unmapped; creating a workspace state is outside harness rails.' };
      throw new Error(trace.observed.blocked);
    }
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      const issue = issues[0];
      const row = rows[0];
      const cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:state=unmapped:${state.id}`);
      await this.updateIssue(issue, { stateId: state.id });
      const reflected = await this.waitForReflection(
        issue.id,
        current => rawHasAny(parseJson(current.linear_raw), ['unmapped_state']),
        /mirror_in_/,
        cursor,
        'unmapped state',
      );
      this.assertReconcile(reflected.reconcile, { toleratedReason: 'unmapped_state_refused' });
      trace.observed = { status: reflected.row.status, reconcile: reflected.reconcile };
      return trace.observed;
    });
  }

  async scenarioReparent(trace) {
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      let issue = issues[0];
      const row = rows[0];
      const parent = assertTestIssue(await this.readIssue(this.config.parentIssue), this.config, 'VID');
      let cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:parent=${parent.identifier}`);
      issue = await this.updateIssue(issue, { parentId: parent.id });
      let reflected = await this.waitForReflection(issue.id, current => parentIdFromRow(current) === parent.id, /^mirror_in_/, cursor, 're-parent');
      this.assertReconcile(reflected.reconcile);

      const title = `B3 parent-preserve ${RUN_MARKER}`;
      cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:title_after_parent`);
      issue = await this.updateIssue(issue, { title });
      reflected = await this.waitForReflection(
        issue.id,
        current => current.title === title && parentIdFromRow(current) === parent.id,
        /^mirror_in_/,
        cursor,
        'parent preservation after partial webhook',
      );
      this.assertReconcile(reflected.reconcile);
      trace.observed = { parent_id: parentIdFromRow(reflected.row), title: reflected.row.title, reconcile: reflected.reconcile };
      return trace.observed;
    });
  }

  async scenarioArchive(trace) {
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      const issue = issues[0];
      const row = rows[0];
      const cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:archive`);
      await this.archiveIssue(issue);
      const reflected = await this.waitForReflection(issue.id, current => !isMirrorVisible(current), /^mirror_in_(archive|delete)$/, cursor, 'archive');
      this.assertReconcile(reflected.reconcile);
      trace.observed = { visible: isMirrorVisible(reflected.row), reconcile: reflected.reconcile };
      return trace.observed;
    });
  }

  async scenarioCancel(trace) {
    const canceled = findState(this.context.teams, 'VID', 'canceled');
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      const issue = issues[0];
      const row = rows[0];
      const cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:state=${canceled.name}`);
      await this.updateIssue(issue, { stateId: canceled.id });
      const reflected = await this.waitForReflection(issue.id, current => current.status === 'canceled' && !isMirrorVisible(current), 'mirror_in_status_change', cursor, 'cancel');
      this.assertReconcile(reflected.reconcile);
      trace.observed = { status: reflected.row.status, visible: isMirrorVisible(reflected.row), reconcile: reflected.reconcile };
      return trace.observed;
    });
  }

  async scenarioReopen(trace) {
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      let issue = issues[0];
      const row = rows[0];
      let cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:archive_for_reopen`);
      issue = await this.archiveIssue(issue);
      await this.waitForReflection(issue.id, current => !isMirrorVisible(current), /^mirror_in_(archive|delete)$/, cursor, 'reopen setup archive');
      cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:unarchive`);
      await this.unarchiveIssue(issue);
      const reflected = await this.waitForReflection(issue.id, current => isMirrorVisible(current), /^mirror_in_/, cursor, 'reopen');
      this.assertReconcile(reflected.reconcile);
      trace.observed = { visible: isMirrorVisible(reflected.row), reconcile: reflected.reconcile };
      return trace.observed;
    });
  }

  async scenarioRapidEdits(trace) {
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      let issue = issues[0];
      const row = rows[0];
      const titles = ['A', 'B', 'C'].map(suffix => `B3 rapid ${RUN_MARKER} ${suffix}`);
      const cursor = await this.eventCursor(row.id);
      const firedAt = Date.now();
      for (const title of titles) {
        trace.fired.push(`${issue.identifier}:title=${title}`);
        issue = await this.updateIssue(issue, { title });
      }
      const reflected = await this.waitForReflection(issue.id, current => current.title === titles[2], /^mirror_in_/, cursor, 'rapid final state');
      this.assertReconcile(reflected.reconcile);
      trace.observed = { final_title: reflected.row.title, expected_final: titles[2], latency_ms: Date.now() - firedAt, reconcile: reflected.reconcile };
      return trace.observed;
    });
  }

  async scenarioDuplicateDelivery(trace) {
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      let issue = issues[0];
      const row = rows[0];
      const title = `B3 duplicate ${RUN_MARKER}`;
      const cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:same_title_update_1`);
      issue = await this.updateIssue(issue, { title });
      trace.fired.push(`${issue.identifier}:same_title_update_2`);
      issue = await this.updateIssue(issue, { title });
      const reflected = await this.waitForReflection(issue.id, current => current.title === title, /^mirror_in_/, cursor, 'duplicate delivery');
      await sleep(5000);
      const events = await this.readEvents(row.id, cursor);
      const matching = events.filter(event => /^mirror_in_/.test(clean(event.action)));
      this.assertReconcile(reflected.reconcile);
      trace.observed = { mirror_event_count: matching.length, final_title: reflected.row.title, reconcile: reflected.reconcile };
      if (matching.length !== 1) throw new Error(`Expected one deduped mirror event; observed ${matching.length}`);
      return trace.observed;
    });
  }

  async scenarioCrossTeam(trace) {
    return this.withRestoration([this.config.crossVideoIssue, this.config.crossGraphicIssue], async ({ issues, rows }) => {
      if (rows[0].batch_id !== rows[1].batch_id) throw new Error('Cross-team rows no longer share one batch');
      const titles = [`B3 cross VID ${RUN_MARKER}`, `B3 cross GRA ${RUN_MARKER}`];
      const cursors = await Promise.all(rows.map(row => this.eventCursor(row.id)));
      trace.fired.push(`${issues[0].identifier}:title`, `${issues[1].identifier}:title`);
      await Promise.all([
        this.updateIssue(issues[0], { title: titles[0] }),
        this.updateIssue(issues[1], { title: titles[1] }),
      ]);
      const reflected = await Promise.all([
        this.waitForReflection(issues[0].id, row => row.title === titles[0] && row.batch_id === rows[0].batch_id, /^mirror_in_/, cursors[0], 'cross-team VID'),
        this.waitForReflection(issues[1].id, row => row.title === titles[1] && row.batch_id === rows[1].batch_id, /^mirror_in_/, cursors[1], 'cross-team GRA'),
      ]);
      reflected.forEach(item => this.assertReconcile(item.reconcile));
      trace.observed = {
        batch_id_same: reflected[0].row.batch_id === reflected[1].row.batch_id,
        video: { identifier: reflected[0].issue.identifier, title: reflected[0].row.title, reconcile: reflected[0].reconcile },
        graphics: { identifier: reflected[1].issue.identifier, title: reflected[1].row.title, reconcile: reflected[1].reconcile },
      };
      return trace.observed;
    });
  }

  async scenarioComment(trace) {
    const createdCommentIds = [];
    return this.withRestoration([this.config.primaryIssue], async ({ issues, rows }) => {
      const issue = issues[0];
      const row = rows[0];
      const genuineMarker = `${RUN_MARKER}-genuine`;
      const echoMarker = `${RUN_MARKER}-echo`;
      const cursor = await this.eventCursor(row.id);
      trace.fired.push(`${issue.identifier}:comment_add_genuine`);
      const genuine = await this.createComment(issue, genuineMarker);
      createdCommentIds.push(genuine.id);
      const genuineReflected = await this.waitForReflection(
        issue.id,
        current => commentObservation(current.comments, genuineMarker, echoMarker).genuine_count === 1,
        'mirror_in_comment_add',
        cursor,
        'genuine comment',
      );
      const genuineEvents = genuineReflected.events.filter(event => eventCommentId(event) === genuine.id);
      const firstObservation = commentObservation(genuineReflected.row.comments, genuineMarker, echoMarker);
      if (genuineEvents.length !== 1 || !firstObservation.pinned) {
        throw new Error(`Genuine comment expected one pinned mirror entry; events=${genuineEvents.length}, pinned=${firstObservation.pinned}`);
      }
      this.assertReconcile(genuineReflected.reconcile);

      trace.fired.push(`${issue.identifier}:comment_add_legacy_echo`);
      const echoBody = `**B3 harness (via SyncView):** ${echoMarker}`;
      const echo = await this.createComment(issue, echoBody);
      createdCommentIds.push(echo.id);
      await sleep(8000);
      const afterEcho = await this.readDeliverable(await this.readIssue(issue.id));
      const afterEvents = await this.readEvents(row.id, cursor);
      const observation = commentObservation(afterEcho.comments, genuineMarker, echoMarker);
      const echoEvents = afterEvents.filter(event => eventCommentId(event) === echo.id);
      trace.observed = {
        genuine: { copies: observation.genuine_count, mirror_events: genuineEvents.length, pinned: observation.pinned },
        echo: { copies: observation.echo_count, mirror_events: echoEvents.length },
        reconcile: genuineReflected.reconcile,
      };
      if (observation.genuine_count !== 1 || observation.echo_count !== 0 || echoEvents.length !== 0) {
        throw new Error(`Comment mirror/echo mismatch: ${JSON.stringify(trace.observed)}`);
      }
      return trace.observed;
    }, async ({ issues }) => {
      for (const id of createdCommentIds.reverse()) await this.deleteComment(issues[0], id);
      await sleep(2000);
    });
  }

  async waitForFinalReconciler(afterIso) {
    const row = await this.poll(
      () => this.readLatestReconciler(),
      current => {
        if (!current || Date.parse(current.ts) < Date.parse(afterIso)) return false;
        const summary = current.summary || {};
        return Number(summary.diff_count || 0) === 0
          && Number(summary.repair_list_size || 0) === 0
          && Number(summary.linkage_actionable || 0) === 0;
      },
      'final reconciler 0/0/0',
      this.config.finalTimeoutMs,
    );
    return {
      event_id: row.id,
      ts: row.ts,
      diff_count: Number(row.summary.diff_count || 0),
      repair_list_size: Number(row.summary.repair_list_size || 0),
      linkage_actionable: Number(row.summary.linkage_actionable || 0),
    };
  }

  async run() {
    await this.preflight();
    const originalPrimaryIssue = issueSnapshot(this.context.issues.primary);
    const originalPrimaryRow = this.context.rows.primary;
    const originalCrossRows = [this.context.rows.crossVideo, this.context.rows.crossGraphic];
    let cleanupComplete = false;
    let fatalError = null;
    let finalReconciler = null;

    try {
      await this.runScenario('Create parent + sub-issue', { batch: true, parent_deliverable: true, child_deliverable: true }, trace => this.scenarioCreate(trace));
      await this.activatePrimary();
      await this.runScenario('Full status ladder + backward regression', { final_status: 'posted', every_step_reflected: true, diff_count: 0 }, trace => this.scenarioStatusLadder(trace));
      await this.runScenario('Title change', { title_reflected: true, diff_count: 0 }, trace => this.scenarioSimpleField(trace, 'title', [`B3 title ${RUN_MARKER}`], /^mirror_in_/, row => row.title));
      const dateA = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
      const dateB = new Date(Date.now() + 17 * 86400000).toISOString().slice(0, 10);
      await this.runScenario('Due date set -> change -> clear', { values: [dateA, dateB, null], diff_count: 0 }, trace => this.scenarioSimpleField(trace, 'dueDate', [dateA, dateB, null], /^mirror_in_/, row => normalizeDate(row.due_date) || null));
      await this.runScenario('Priority change', { values: [1, 4, 0], diff_count: 0 }, trace => this.scenarioSimpleField(trace, 'priority', [1, 4, 0], /^mirror_in_/, row => normalizePriority(row.priority) == null ? 0 : normalizePriority(row.priority)));
      await this.runScenario('Assignee set -> change -> clear', { mapped_members: 2, clear: true, diff_count: 0 }, trace => this.scenarioKnownAssignees(trace));
      await this.runScenario('Unknown assignee repair lane', { diff_count: 0, repair_list_size: 1 }, trace => this.scenarioUnknownAssignee(trace));
      await this.runScenario('Unmapped state tolerated lane', { diff_count: 0, tolerated: 'unmapped_state_refused' }, trace => this.scenarioUnmappedState(trace));
      await this.runScenario('Re-parent and preserve parent', { parent_reflected: true, parent_survives_partial_update: true, diff_count: 0 }, trace => this.scenarioReparent(trace));
      await this.runScenario('Archive hides mirror row', { visible: false, diff_count: 0 }, trace => this.scenarioArchive(trace));
      await this.runScenario('Cancel hides mirror row', { status: 'canceled', visible: false, diff_count: 0 }, trace => this.scenarioCancel(trace));
      await this.runScenario('Reopen reappears', { visible: true, diff_count: 0 }, trace => this.scenarioReopen(trace));
      await this.runScenario('Rapid successive edits', { final_state_wins: true, diff_count: 0 }, trace => this.scenarioRapidEdits(trace));
      await this.runScenario('Duplicate webhook within 60 seconds', { mirror_event_count: 1, material_state_once: true }, trace => this.scenarioDuplicateDelivery(trace));
      await this.runScenario('Cross-team batch VID + GRA', { both_reflected: true, same_batch: true, diff_count: 0 }, trace => this.scenarioCrossTeam(trace));
      // Comment runs last while the disposable issue is active. Its mirror event
      // is excluded from v2 after the issue returns to its original canceled state.
      await this.runScenario('Comment add + echo filter + tweak pinning', { genuine_copies: 1, echo_copies: 0, is_tweak: false, diff_count: 0 }, trace => this.scenarioComment(trace));
    } catch (error) {
      fatalError = error;
    } finally {
      try {
        await this.restoreLinearSnapshot(originalPrimaryIssue);
        await this.restoreDeliverableSnapshot(originalPrimaryRow);
        for (const row of originalCrossRows) await this.restoreDeliverableSnapshot(row);
        cleanupComplete = true;
      } catch (error) {
        fatalError = fatalError || error;
        cleanupComplete = false;
      }
    }

    const cleanupFinishedAt = new Date().toISOString();
    if (cleanupComplete && !fatalError) {
      try {
        finalReconciler = await this.waitForFinalReconciler(cleanupFinishedAt);
      } catch (error) {
        await this.runScenario('Final reconciler 0/0/0', { diff_count: 0, repair_list_size: 0, linkage_actionable: 0 }, trace => {
          trace.observed = error.latest || null;
          throw error;
        });
      }
    }

    const report = {
      run_marker: RUN_MARKER,
      started_at: this.runStartedAt,
      finished_at: new Date().toISOString(),
      test_project_name: this.config.projectName,
      test_client_slug: this.config.clientSlug,
      scenarios: this.results,
      total: this.results.length,
      passed: this.results.filter(item => item.status === 'PASS').length,
      failed: this.results.filter(item => item.status === 'FAIL').length,
      cleanup_complete: cleanupComplete,
      created_issue_ids: this.createdIssues,
      final_reconciler: finalReconciler,
    };
    if (this.config.reportJson) {
      fs.mkdirSync(path.dirname(path.resolve(this.config.reportJson)), { recursive: true });
      fs.writeFileSync(path.resolve(this.config.reportJson), JSON.stringify(report, null, 2) + '\n');
    }
    if (this.config.reportMd) {
      fs.mkdirSync(path.dirname(path.resolve(this.config.reportMd)), { recursive: true });
      fs.writeFileSync(path.resolve(this.config.reportMd), markdownReport(report));
    }
    console.log(JSON.stringify(report, null, 2));
    if (fatalError) throw fatalError;
    if (!cleanupComplete || !finalReconciler || report.failed) process.exitCode = 1;
    return report;
  }
}

function loadConfig(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const config = {
    confirmed: CONFIRMED,
    linearKey: LINEAR_KEY,
    anonKey: publicAnonKey(),
    serviceKey: SERVICE_KEY,
    supabaseUrl: SUPABASE_URL,
    projectId: clean(process.env.B3_TEST_PROJECT_ID),
    projectName: TEST_PROJECT_NAME,
    clientSlug: clean(process.env.B3_TEST_CLIENT_SLUG),
    primaryIssue: clean(process.env.B3_TEST_PRIMARY_ISSUE).toUpperCase(),
    parentIssue: clean(process.env.B3_TEST_PARENT_ISSUE).toUpperCase(),
    crossVideoIssue: clean(process.env.B3_TEST_CROSS_VIDEO_ISSUE).toUpperCase(),
    crossGraphicIssue: clean(process.env.B3_TEST_CROSS_GRAPHIC_ISSUE).toUpperCase(),
    timeoutMs: Math.max(5000, Number(args.get('timeout-ms') || process.env.B3_HARNESS_TIMEOUT_MS || 60000)),
    createTimeoutMs: Math.max(5000, Number(args.get('create-timeout-ms') || process.env.B3_CREATE_TIMEOUT_MS || 30000)),
    finalTimeoutMs: Math.max(10000, Number(args.get('final-timeout-ms') || process.env.B3_FINAL_TIMEOUT_MS || 20 * 60 * 1000)),
    pollMs: Math.max(250, Number(args.get('poll-ms') || process.env.B3_HARNESS_POLL_MS || 1000)),
    reportJson: args.get('report-json') || process.env.B3_HARNESS_REPORT_JSON || '',
    reportMd: args.get('report-md') || process.env.B3_HARNESS_REPORT_MD || '',
  };
  if (!config.confirmed) throw new Error('Set B3_CONFIRM_TEST_MUTATIONS=1 to run the TEST-only mirror harness');
  if (!config.linearKey) throw new Error('LINEAR_API_KEY is required');
  if (!config.anonKey) throw new Error('SUPABASE_ANON_KEY is required (the public browser key may be read from index.html)');
  if (!config.serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for fail-safe TEST snapshot cleanup');
  if (!config.projectId || !config.clientSlug) throw new Error('B3_TEST_PROJECT_ID and B3_TEST_CLIENT_SLUG are required');
  for (const [key, value] of Object.entries({
    B3_TEST_PRIMARY_ISSUE: config.primaryIssue,
    B3_TEST_PARENT_ISSUE: config.parentIssue,
    B3_TEST_CROSS_VIDEO_ISSUE: config.crossVideoIssue,
    B3_TEST_CROSS_GRAPHIC_ISSUE: config.crossGraphicIssue,
  })) {
    if (!/^(VID|GRA)-\d+$/.test(value)) throw new Error(`${key} must be a VID-/GRA- TEST identifier`);
  }
  return config;
}

async function main() {
  const harness = new Harness(loadConfig());
  await harness.run();
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  STATUS_LADDER,
  parseArgs,
  isRetryableLinearRead,
  parseThread,
  rawHasAny,
  rawContains,
  isMirrorVisible,
  parentIdFromRow,
  issueSnapshot,
  assertTestIssue,
  stateMapFromTeams,
  findState,
  eventInnerPayload,
  eventCommentId,
  commentObservation,
  compactReconcile,
  compactPollObservation,
  markdownReport,
  loadConfig,
  Harness,
};
