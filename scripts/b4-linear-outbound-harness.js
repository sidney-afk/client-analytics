'use strict';

/*
 * B4 outbound mirror proof. This script is intentionally fail-closed to the
 * active sidneylaruel TEST client and the two named TEST projects. It creates
 * disposable rows/issues, exercises shadow/live/pause/off behavior, archives
 * every disposable issue, and never changes runtime flags.
 *
 * Required:
 *   B4_CONFIRM_TEST_MUTATIONS=1
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   LINEAR_API_KEY=...            (TEST-only direct-edit portion)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_REF = 'uzltbbrjidmjwwfakwve';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const LINEAR_URL = 'https://api.linear.app/graphql';
const TEST_CLIENT = 'sidneylaruel';
const TEST_PROJECT_NAMES = Object.freeze({
  video: 'Sidney Laruel',
  graphics: 'Test Project',
});
const CREATE_UUID_NAMESPACE = '8ec6f2de-20f4-4dc3-8f21-8b3298e780db';
const STATUS_LABELS = Object.freeze({
  todo: 'Todo',
  in_progress: 'In Progress',
  smm_approval: 'For SMM approval',
  tweak: 'Tweak Needed',
  kasper_approval: 'For Kasper approval',
  client_approval: 'For Client approval',
  approved: 'Approved',
  posted: 'Posted',
});

const clean = value => String(value == null ? '' : value).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}
const stableJson = value => JSON.stringify(stableValue(value));

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function deterministicCreateId(dedupKey) {
  const namespace = Buffer.from(CREATE_UUID_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(namespace).update(String(dedupKey)).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function statusSlug(name) {
  const value = clean(name).toLowerCase();
  for (const [slug, label] of Object.entries(STATUS_LABELS)) {
    if (value === label.toLowerCase()) return slug;
  }
  if (value.includes('client')) return 'client_approval';
  if (value.includes('kasper')) return 'kasper_approval';
  if (value.includes('smm')) return 'smm_approval';
  if (value.includes('tweak')) return 'tweak';
  return '';
}

function stateForSlug(team, slug) {
  const states = parseArray(team && team.states && team.states.nodes);
  return states.find(state => statusSlug(state && state.name) === slug) || null;
}

function assertTestIssue(issue, projects) {
  assert(issue && /^(VID|GRA)-\d+$/i.test(clean(issue.identifier)), 'issue identifier is not VID/GRA');
  const projectId = clean(issue.project && issue.project.id);
  assert(projects.has(projectId), 'issue is outside the TEST project allowlist');
  const expectedName = projects.get(projectId);
  assert(clean(issue.project && issue.project.name) === expectedName, 'TEST project name changed');
  return true;
}

function scenarioPlan() {
  return [
    'create_shadow', 'create_live', 'status_ladder', 'comment', 'due_set_clear',
    'assignee_set_clear', 'title', 'priority', 'archive_restore',
    'pause_linear_newer_wins', 'kill_switch_off', 'idempotent_redrain',
    'echo_drop', 'two_way_reconcile', 'final_reconcile', 'cleanup_archive',
  ];
}

function compactOutbox(row) {
  return {
    id: Number(row.id || 0),
    entity: clean(row.entity),
    operation: clean(row.operation),
    status: clean(row.status),
    attempts: Number(row.attempts || 0),
    dedup_key: clean(row.dedup_key),
    linear_result: parseJson(row.linear_result),
  };
}

class Harness {
  constructor() {
    this.serviceKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    this.linearKey = clean(process.env.LINEAR_API_KEY || process.env.LINEAR_API_TOKEN);
    this.runId = `b4-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    this.projects = new Map();
    this.projectByTeam = {};
    this.teamByKey = {};
    this.assets = [];
    this.scenarios = [];
    this.expectedDirectMirrorEventIds = new Set();
    this.startEventId = 0;
    this.flagsBefore = {};
    this.reportPath = path.resolve(process.env.B4_REPORT_PATH || path.join(process.cwd(), '..', `${this.runId}.private.json`));
  }

  record(name, expected, observed, latencyMs, status = 'PASS') {
    this.scenarios.push({ name, expected, observed, status, latency_ms: latencyMs });
    console.log(`${status} ${name} (${latencyMs} ms)`);
  }

  async rest(resource, options = {}) {
    const headers = {
      apikey: this.serviceKey,
      authorization: `Bearer ${this.serviceKey}`,
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {}),
    };
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) fail(`Supabase ${resource.split('?')[0]} HTTP ${response.status}: ${text.slice(0, 300)}`);
    return body;
  }

  async rpc(name, body) {
    return this.rest(`rpc/${name}`, { method: 'POST', body });
  }

  async linear(query, variables = {}) {
    const response = await fetch(LINEAR_URL, {
      method: 'POST',
      headers: { authorization: this.linearKey, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.errors) {
      const error = new Error(`Linear HTTP ${response.status}: ${JSON.stringify(body && body.errors || body).slice(0, 400)}`);
      error.linearErrors = body && body.errors;
      throw error;
    }
    return body.data;
  }

  async issue(id, allowMissing = false) {
    try {
      const data = await this.linear(`query B4HarnessIssue($id: String!) {
        issue(id: $id) {
          id identifier title description dueDate priority archivedAt updatedAt
          state { id name type }
          team { id key name }
          project { id name }
          assignee { id name email }
          parent { id identifier title }
          comments(first: 100) { nodes { id body createdAt user { id name email } } }
        }
      }`, { id });
      return data.issue || null;
    } catch (error) {
      if (allowMissing) return null;
      throw error;
    }
  }

  async directTestUpdate(issueId, input) {
    const allowed = new Set(['title', 'dueDate', 'assigneeId', 'stateId', 'priority', 'parentId']);
    assert(Object.keys(input).every(key => allowed.has(key)), 'direct TEST update contains a forbidden field');
    const before = await this.issue(issueId);
    assertTestIssue(before, this.projects);
    const data = await this.linear(`mutation B4HarnessDirectEdit($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { id identifier title updatedAt project { id name } } }
    }`, { id: issueId, input });
    assert(data.issueUpdate && data.issueUpdate.success, 'direct TEST update was not acknowledged');
    return data.issueUpdate.issue;
  }

  async edge(name, body) {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: this.serviceKey,
        authorization: `Bearer ${this.serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      fail(`${name} HTTP ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
    }
    return data;
  }

  async write(kind, request) {
    const endpoint = kind === 'batch' ? 'batch-write' : 'deliverable-write';
    const data = await this.edge(endpoint, {
      id: request.id || undefined,
      patch: request.patch || {},
      operation: request.operation,
      dedup_key: request.dedup,
      source_edited_at: request.sourceEditedAt || nowIso(),
      linear_payload: request.linearPayload || {},
      depends_on_id: request.dependsOn || null,
      comment_id: request.commentId || null,
      comments_base: request.commentsBase == null ? undefined : request.commentsBase,
      actor: 'B4 TEST harness',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    });
    const rows = await this.rest(`mirror_outbox?select=*&dedup_key=eq.${encodeURIComponent(request.dedup)}&limit=1`);
    assert(rows.length === 1, `outbox row missing for ${request.dedup}`);
    return { row: data.row, outbox: rows[0] };
  }

  async drain(mode, authority = 'syncview', limit = 50) {
    return this.edge('linear-outbound', {
      limit,
      test_override: { client_slug: TEST_CLIENT, mode, authority },
      confirm: 'B4_TEST_ONLY',
    });
  }

  async outbox(dedup) {
    const rows = await this.rest(`mirror_outbox?select=*&dedup_key=eq.${encodeURIComponent(dedup)}&limit=1`);
    return rows[0] || null;
  }

  async entity(table, id) {
    const rows = await this.rest(`${table}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] || null;
  }

  async poll(label, fn, timeoutMs = 45000, intervalMs = 750) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await fn();
      if (last) return last;
      await sleep(intervalMs);
    }
    fail(`${label} timed out; last=${JSON.stringify(last).slice(0, 300)}`);
  }

  async preflight() {
    assert(process.env.B4_CONFIRM_TEST_MUTATIONS === '1', 'B4_CONFIRM_TEST_MUTATIONS=1 is required');
    assert(this.serviceKey && this.linearKey, 'Supabase service role and Linear TEST key are required');

    const [client] = await this.rest(`clients?select=slug,kind,active&slug=eq.${TEST_CLIENT}&limit=1`);
    assert(client && client.kind === 'test' && client.active === true, 'sidneylaruel is not an active TEST client');

    const flags = await this.rest('syncview_runtime_flags?select=key,value&key=in.(linear_outbound_enabled,prod_authority,auth_enforcement,linear_inbound_enabled)');
    this.flagsBefore = Object.fromEntries(flags.map(row => [row.key, row.value]));
    assert(parseJson(this.flagsBefore.linear_outbound_enabled).mode === 'off', 'global outbound mode is not off');
    const authority = parseJson(this.flagsBefore.prod_authority);
    assert(authority.video === 'linear' && authority.graphics === 'linear', 'production authority changed before TEST proof');

    const allProjects = await this.linear('query B4HarnessProjects { projects(first: 100, includeArchived: false) { nodes { id name teams { nodes { id key name } } } } }');
    for (const [team, name] of Object.entries(TEST_PROJECT_NAMES)) {
      const matches = allProjects.projects.nodes.filter(project => clean(project.name) === name);
      assert(matches.length === 1, `expected exactly one ${team} TEST project`);
      const project = matches[0];
      const key = team === 'graphics' ? 'GRA' : 'VID';
      assert(project.teams.nodes.some(row => row.key === key), `${name} is not attached to ${key}`);
      this.projects.set(project.id, name);
      this.projectByTeam[team] = project;
    }

    const teams = await this.linear('query B4HarnessTeams { teams(first: 50) { nodes { id key name states { nodes { id name type } } } } }');
    for (const team of teams.teams.nodes.filter(row => ['VID', 'GRA'].includes(row.key))) {
      this.teamByKey[team.key] = team;
    }
    assert(this.teamByKey.VID && this.teamByKey.GRA, 'VID/GRA teams are unavailable');
    for (const slug of Object.keys(STATUS_LABELS)) {
      assert(stateForSlug(this.teamByKey.VID, slug), `VID state missing for ${slug}`);
      assert(stateForSlug(this.teamByKey.GRA, slug), `GRA state missing for ${slug}`);
    }

    const members = await this.rest('team_members?select=id,name,team,linear_user_id,active&active=eq.true&linear_user_id=not.is.null');
    this.videoMembers = members.filter(member => clean(member.team).toLowerCase() === 'video' && clean(member.linear_user_id));
    assert(this.videoMembers.length >= 1, 'no mapped active video member is available for TEST assignment');

    const events = await this.rest('deliverable_events?select=id&order=id.desc&limit=1');
    this.startEventId = events[0] ? Number(events[0].id) : 0;
  }

  async createFixtures() {
    const started = Date.now();
    for (const team of ['video', 'graphics']) {
      const linearTeam = this.teamByKey[team === 'graphics' ? 'GRA' : 'VID'];
      const project = this.projectByTeam[team];
      const suffix = `${this.runId}-${team}`;
      const batchDedup = `${this.runId}:${team}:batch:create`;
      const batch = await this.write('batch', {
        operation: 'create',
        dedup: batchDedup,
        patch: {
          client_slug: TEST_CLIENT,
          team,
          name: `B4 TEST batch ${suffix}`,
          description: 'Disposable B4 outbound TEST fixture',
          status: 'active',
          created_by: 'b4-outbound-harness',
        },
        linearPayload: {
          team_id: linearTeam.id,
          project_id: project.id,
          title: `B4 TEST batch ${suffix}`,
          description: 'Disposable B4 outbound TEST fixture',
          status: 'todo',
          priority: 0,
        },
      });
      const deliverableDedup = `${this.runId}:${team}:deliverable:create`;
      const deliverable = await this.write('deliverable', {
        operation: 'create',
        dedup: deliverableDedup,
        dependsOn: Number(batch.outbox.id),
        patch: {
          batch_id: batch.row.id,
          client_slug: TEST_CLIENT,
          team,
          kind: team === 'graphics' ? 'thumbnail' : 'video',
          title: `B4 TEST deliverable ${suffix}`,
          brief: 'Disposable B4 outbound TEST fixture',
          status: 'todo',
          priority: 0,
          origin: 'manual',
          created_by: 'b4-outbound-harness',
        },
        linearPayload: {
          team_id: linearTeam.id,
          project_id: project.id,
          title: `B4 TEST deliverable ${suffix}`,
          description: 'Disposable B4 outbound TEST fixture',
          status: 'todo',
          priority: 0,
        },
      });
      this.assets.push({
        team,
        project,
        linearTeam,
        batch: { id: batch.row.id, dedup: batchDedup, expectedIssueId: deterministicCreateId(batchDedup) },
        deliverable: { id: deliverable.row.id, dedup: deliverableDedup, expectedIssueId: deterministicCreateId(deliverableDedup) },
      });
    }
    this.record('enqueue_test_fixtures', 'two TEST parent/child pairs', { pairs: this.assets.length }, Date.now() - started);
  }

  async proveShadow() {
    const started = Date.now();
    for (const asset of this.assets) {
      assert(await this.issue(asset.batch.expectedIssueId, true) === null, 'batch existed before shadow');
      assert(await this.issue(asset.deliverable.expectedIssueId, true) === null, 'deliverable existed before shadow');
    }
    const summary = await this.drain('shadow');
    assert(summary.counts.shadow_ok === 4 && summary.counts.written === 0, 'shadow did not classify all four creates without writes');
    for (const asset of this.assets) {
      for (const item of [asset.batch, asset.deliverable]) {
        const row = await this.outbox(item.dedup);
        const result = parseJson(row.linear_result);
        const wouldSend = parseJson(result.would_send);
        const variables = parseJson(wouldSend.variables);
        const input = parseJson(variables.input);
        assert(row.status === 'shadow_ok', 'shadow row not marked shadow_ok');
        assert(input.id === item.expectedIssueId, 'shadow create id is not deterministic');
        assert(input.projectId === asset.project.id && input.teamId === asset.linearTeam.id, 'shadow create scope mismatch');
        assert(await this.issue(item.expectedIssueId, true) === null, 'shadow created a Linear issue');
      }
      const child = await this.outbox(asset.deliverable.dedup);
      const childInput = parseJson(parseJson(parseJson(child.linear_result).would_send).variables).input;
      assert(childInput.parentId === asset.batch.expectedIssueId, 'shadow child does not target the deterministic parent id');
    }
    this.record('create_shadow', '4 exact mutations, 0 Linear writes', {
      event_id: summary.event_id,
      shadow_ok: summary.counts.shadow_ok,
      written: summary.counts.written,
    }, Date.now() - started);
  }

  async proveLiveCreates() {
    const started = Date.now();
    const summary = await this.drain('live');
    assert(summary.counts.written === 4 && summary.counts.failed === 0, 'live create drain did not write all four rows');
    for (const asset of this.assets) {
      const parent = await this.poll('parent create', () => this.issue(asset.batch.expectedIssueId, true));
      const child = await this.poll('child create', () => this.issue(asset.deliverable.expectedIssueId, true));
      assertTestIssue(parent, this.projects);
      assertTestIssue(child, this.projects);
      assert(clean(child.parent && child.parent.id) === parent.id, 'created child is not under its TEST parent');
      asset.batch.issueId = parent.id;
      asset.batch.identifier = parent.identifier;
      asset.deliverable.issueId = child.id;
      asset.deliverable.identifier = child.identifier;
    }
    this.record('create_live', '4 TEST issues written by mirror identity', {
      event_id: summary.event_id,
      written: summary.counts.written,
      identifiers: this.assets.flatMap(asset => [asset.batch.identifier, asset.deliverable.identifier]),
    }, Date.now() - started);
  }

  async writeAndDrain(asset, operation, patch, linearPayload, suffix, commentsBase = null) {
    const dedup = `${this.runId}:video:${suffix}`;
    const queued = await this.write('deliverable', {
      id: asset.deliverable.id,
      operation,
      dedup,
      patch,
      linearPayload,
      commentId: operation === 'comment' ? `${this.runId}:${suffix}` : null,
      commentsBase,
    });
    const summary = await this.drain('live');
    assert(summary.counts.failed === 0, `${operation} drain failed`);
    const outbox = await this.poll(`${operation} outbox`, async () => {
      const row = await this.outbox(dedup);
      return row && ['written', 'skipped', 'stale'].includes(row.status) ? row : null;
    });
    return { queued, summary, outbox };
  }

  async proveOperations() {
    const asset = this.assets.find(row => row.team === 'video');
    const issueId = asset.deliverable.issueId;

    const ladderStarted = Date.now();
    const ladder = ['todo', 'in_progress', 'smm_approval', 'tweak', 'kasper_approval', 'client_approval', 'approved', 'posted'];
    for (const slug of ladder) {
      await this.writeAndDrain(asset, 'status', { status: slug }, { status: slug }, `status:${slug}`);
      const issue = await this.poll(`status ${slug}`, async () => {
        const current = await this.issue(issueId);
        return statusSlug(current.state && current.state.name) === slug ? current : null;
      });
      assertTestIssue(issue, this.projects);
    }
    this.record('status_ladder', ladder, { final: 'posted' }, Date.now() - ladderStarted);

    const titleStarted = Date.now();
    const title = `B4 TEST title ${this.runId}`;
    await this.writeAndDrain(asset, 'title', { title }, { title }, 'title');
    await this.poll('title reflection', async () => (await this.issue(issueId)).title === title);
    this.record('title', title, title, Date.now() - titleStarted);

    const priorityStarted = Date.now();
    await this.writeAndDrain(asset, 'priority', { priority: 2 }, { priority: 2 }, 'priority');
    await this.poll('priority reflection', async () => (await this.issue(issueId)).priority === 2);
    this.record('priority', 2, 2, Date.now() - priorityStarted);

    const dueStarted = Date.now();
    const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await this.writeAndDrain(asset, 'due', { due_date: dueDate }, { due_date: dueDate }, 'due:set');
    await this.poll('due set', async () => (await this.issue(issueId)).dueDate === dueDate);
    await this.writeAndDrain(asset, 'due', { due_date: null }, { due_date: null }, 'due:clear');
    await this.poll('due clear', async () => !(await this.issue(issueId)).dueDate);
    this.record('due_set_clear', `${dueDate} -> null`, null, Date.now() - dueStarted);

    const assigneeStarted = Date.now();
    const member = this.videoMembers[0];
    await this.writeAndDrain(asset, 'assignee', { assignee_id: member.id }, { assignee_id: member.id }, 'assignee:set');
    await this.poll('assignee set', async () => clean((await this.issue(issueId)).assignee && (await this.issue(issueId)).assignee.id) === clean(member.linear_user_id));
    await this.writeAndDrain(asset, 'assignee', { assignee_id: null }, { assignee_id: null, linear_user_id: null }, 'assignee:clear');
    await this.poll('assignee clear', async () => !(await this.issue(issueId)).assignee);
    this.record('assignee_set_clear', 'mapped member -> null', 'mapped member -> null', Date.now() - assigneeStarted);

    const commentStarted = Date.now();
    const commentBody = `B4 TEST comment ${this.runId}`;
    const beforeComment = await this.entity('deliverables', asset.deliverable.id);
    const localComments = parseArray(beforeComment.comments);
    localComments.push({
      id: `${this.runId}:comment`,
      role: 'editor',
      audience: 'internal',
      author: 'B4 TEST harness',
      body: commentBody,
      is_tweak: false,
      ts: nowIso(),
    });
    const commentRun = await this.writeAndDrain(
      asset,
      'comment',
      { comments: JSON.stringify(localComments) },
      { body: commentBody },
      'comment',
      beforeComment.comments || '',
    );
    const localAfterComment = parseArray((await this.entity('deliverables', asset.deliverable.id)).comments);
    assert(localAfterComment.some(comment => clean(comment.body) === commentBody),
      'comment was not committed to the SyncView thread before mirroring');
    const commentId = clean(parseJson(commentRun.outbox.linear_result).comment_id);
    assert(commentId, 'comment result id missing');
    await this.poll('comment reflection', async () => {
      const issue = await this.issue(issueId);
      return issue.comments.nodes.some(comment => comment.id === commentId && comment.body.includes(commentBody));
    });
    this.record('comment', 'one marked mirror comment', { comment_id: commentId }, Date.now() - commentStarted);

    const archiveStarted = Date.now();
    await this.writeAndDrain(asset, 'archive', {}, {}, 'archive');
    let row = await this.entity('deliverables', asset.deliverable.id);
    assert(!!parseJson(row.linear_raw).archived, 'archive did not set the local visibility marker');
    await this.poll('archive reflection', async () => !!(await this.issue(issueId)).archivedAt);
    await this.writeAndDrain(asset, 'restore', {}, {}, 'restore');
    row = await this.entity('deliverables', asset.deliverable.id);
    assert(!parseJson(row.linear_raw).archived, 'restore did not clear the local visibility marker');
    await this.poll('restore reflection', async () => !(await this.issue(issueId)).archivedAt);
    this.record('archive_restore', 'hidden -> visible', 'hidden -> visible', Date.now() - archiveStarted);
  }

  async provePauseResume() {
    const asset = this.assets.find(row => row.team === 'video');
    const issueId = asset.deliverable.issueId;
    const started = Date.now();
    const queuedTitle = `B4 queued before pause ${this.runId}`;
    const directTitle = `B4 direct Linear during pause ${this.runId}`;
    const dedup = `${this.runId}:video:pause:title`;
    await this.write('deliverable', {
      id: asset.deliverable.id,
      operation: 'title',
      dedup,
      patch: { title: queuedTitle },
      linearPayload: { title: queuedTitle },
    });

    const paused = await this.drain('live', 'linear');
    assert(paused.counts.paused === 1 && paused.counts.written === 0, 'pause did not stop the queued write');
    assert((await this.outbox(dedup)).status === 'pending', 'paused row did not remain queued');
    assert((await this.issue(issueId)).title !== queuedTitle, 'paused write reached Linear');

    await sleep(1500);
    await this.directTestUpdate(issueId, { title: directTitle });
    await this.poll('paused inbound title', async () => (await this.entity('deliverables', asset.deliverable.id)).title === directTitle, 60000);
    const directEvents = await this.rest(`deliverable_events?select=id,deliverable_id,action,source&deliverable_id=eq.${encodeURIComponent(asset.deliverable.id)}&source=eq.mirror&id=gt.${this.startEventId}&order=id.desc&limit=1`);
    if (directEvents[0]) this.expectedDirectMirrorEventIds.add(Number(directEvents[0].id));

    const resumed = await this.drain('live', 'syncview');
    const finalOutbox = await this.outbox(dedup);
    assert(finalOutbox.status === 'stale' && resumed.counts.stale_dropped === 1, 'newer Linear edit was not dropped as stale');
    assert((await this.issue(issueId)).title === directTitle, 'resume overwrote the newer direct Linear title');
    assert((await this.entity('deliverables', asset.deliverable.id)).title === directTitle, 'SyncView did not retain the paused Linear title');
    this.record('pause_linear_newer_wins', 'pending preserved; newer Linear title wins', {
      paused_event_id: paused.event_id,
      resumed_event_id: resumed.event_id,
      outbox_status: finalOutbox.status,
    }, Date.now() - started);
  }

  async proveKillSwitch() {
    const asset = this.assets.find(row => row.team === 'video');
    const issueId = asset.deliverable.issueId;
    const started = Date.now();
    const before = await this.issue(issueId);
    const dueDate = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    const dedup = `${this.runId}:video:kill:due`;
    await this.write('deliverable', {
      id: asset.deliverable.id,
      operation: 'due',
      dedup,
      patch: { due_date: dueDate },
      linearPayload: { due_date: dueDate },
    });
    const stopped = await this.drain('off');
    assert(stopped.mode === 'off' && stopped.counts.written === 0, 'TEST kill switch did not stop the drain');
    assert((await this.outbox(dedup)).status === 'pending', 'kill switch did not preserve the pending row');
    assert(clean((await this.issue(issueId)).dueDate) === clean(before.dueDate), 'kill switch allowed a Linear write');
    const resumed = await this.drain('live');
    assert(resumed.counts.written === 1, 'post-kill resume did not drain the preserved row');
    await this.poll('kill resume due', async () => (await this.issue(issueId)).dueDate === dueDate);
    const noOp = await this.drain('live');
    assert(noOp.counts.written === 0 && noOp.counts.enqueued === 0, 'redrain was not idempotent');
    this.record('kill_switch_off', '0 writes + pending preserved', {
      stopped_event_id: stopped.event_id,
      resumed_event_id: resumed.event_id,
      redrain_event_id: noOp.event_id,
    }, Date.now() - started);
    this.record('idempotent_redrain', '0 duplicate writes', { written: noOp.counts.written }, 0);
  }

  async proveEchoDrops() {
    const started = Date.now();
    const written = (await this.rest(`mirror_outbox?select=id,status&client_slug=eq.${TEST_CLIENT}&test_only=eq.true&dedup_key=like.${encodeURIComponent(this.runId + '*')}`))
      .filter(row => row.status === 'written')
      .map(row => Number(row.id));
    const events = await this.poll('outbound echo drops', async () => {
      const rows = await this.rest(`deliverable_events?select=id,action,payload,source&source=eq.outbound&action=eq.mirror_out_echo_dropped&id=gt.${this.startEventId}&order=id.asc&limit=500`);
      const ids = new Set(rows.map(row => Number(parseJson(row.payload).outbox_id)).filter(Boolean));
      return ids.size >= Math.min(written.length, 4) ? rows : null;
    }, 60000);
    const mirrorEvents = await this.rest(`deliverable_events?select=id,deliverable_id,action,payload,source&source=eq.mirror&id=gt.${this.startEventId}&order=id.asc&limit=500`);
    const fixtureIds = new Set(this.assets.map(asset => asset.deliverable.id));
    const unexpected = mirrorEvents.filter(event => fixtureIds.has(clean(event.deliverable_id))
      && !this.expectedDirectMirrorEventIds.has(Number(event.id)));
    this.record('echo_drop', 'own writes recognized without a write loop', {
      echo_drop_events: events.length,
      unexpected_fixture_mirror_events: unexpected.length,
    }, Date.now() - started, unexpected.length ? 'FAIL' : 'PASS');
    assert(unexpected.length === 0, 'mirror write produced an inbound write event instead of an echo drop');
  }

  async cleanup() {
    const started = Date.now();
    let outboundArchives = 0;
    for (const asset of this.assets) {
      const discoveredParent = await this.issue(asset.batch.expectedIssueId, true);
      const discoveredChild = await this.issue(asset.deliverable.expectedIssueId, true);
      if (discoveredParent) {
        assertTestIssue(discoveredParent, this.projects);
        asset.batch.issueId = discoveredParent.id;
        asset.batch.identifier = discoveredParent.identifier;
      }
      if (discoveredChild) {
        assertTestIssue(discoveredChild, this.projects);
        asset.deliverable.issueId = discoveredChild.id;
        asset.deliverable.identifier = discoveredChild.identifier;
      }

      let row = await this.entity('deliverables', asset.deliverable.id);
      if (row) {
        if (asset.deliverable.issueId) {
          await this.write('deliverable', {
            id: asset.deliverable.id,
            operation: 'archive',
            dedup: `${this.runId}:${asset.team}:cleanup:deliverable:archive`,
            patch: {},
          });
          outboundArchives++;
        } else {
          const raw = parseJson(row.linear_raw);
          await this.rpc('deliverable_write', {
            p_row: { ...row, linear_raw: { ...raw, archived: nowIso() } },
            p_event: { source: 'system', action: 'b4_test_fixture_quarantine', actor: 'B4 TEST harness', role: 'system' },
          });
        }
      }

      row = await this.entity('batches', asset.batch.id);
      if (row) {
        if (asset.batch.issueId) {
          await this.write('batch', {
            id: asset.batch.id,
            operation: 'archive',
            dedup: `${this.runId}:${asset.team}:cleanup:batch:archive`,
            patch: { status: 'archived' },
          });
          outboundArchives++;
        } else {
          await this.rpc('batch_write', {
            p_row: { ...row, status: 'archived' },
            p_event: { source: 'system', action: 'b4_test_fixture_quarantine', actor: 'B4 TEST harness', role: 'system' },
          });
        }
      }
    }
    const drained = outboundArchives ? await this.drain('live') : null;
    if (drained) assert(drained.counts.failed === 0, 'cleanup archive drain failed');
    const quarantined = await this.rpc('mirror_outbox_quarantine_test_run', { p_dedup_prefix: this.runId });
    for (const asset of this.assets) {
      if (asset.batch.issueId) await this.poll('cleanup parent archive', async () => !!(await this.issue(asset.batch.issueId)).archivedAt);
      if (asset.deliverable.issueId) await this.poll('cleanup child archive', async () => !!(await this.issue(asset.deliverable.issueId)).archivedAt);
    }
    this.record('cleanup_archive', 'every created TEST issue archived; local-only rows quarantined', {
      outbound_archives: outboundArchives,
      written: drained ? drained.counts.written : 0,
      quarantined_intents: Number(quarantined || 0),
    }, Date.now() - started);
  }

  async reconcile() {
    const started = Date.now();
    const result = spawnSync(process.execPath, ['scripts/linear-deliverables-reconcile.js'], {
      cwd: process.cwd(),
      env: { ...process.env, APPLY: 'false', CAP: '15' },
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
    });
    if (result.status !== 0) fail(`reconciler failed: ${(result.stderr || result.stdout).slice(-1000)}`);
    const rows = await this.rest('deliverable_events?select=id,payload,ts&action=eq.linear_deliverables_reconcile_v2&order=id.desc&limit=1');
    assert(rows.length === 1, 'reconciler summary event missing');
    const summary = parseJson(parseJson(rows[0].payload).summary);
    assert(Number(summary.diff_count || 0) === 0, 'reconciler ended with nonzero diff_count');
    assert(Number(summary.repair_list_size || 0) === 0, 'reconciler ended with nonzero repair_list_size');
    assert(Number(summary.linkage_actionable || 0) === 0, 'reconciler ended with nonzero linkage_actionable');
    this.record('final_reconcile', '0/0/0', {
      event_id: rows[0].id,
      diff_count: summary.diff_count,
      repair_list_size: summary.repair_list_size,
      linkage_actionable: summary.linkage_actionable,
    }, Date.now() - started);
  }

  async reconcileTwoWay() {
    const started = Date.now();
    const result = spawnSync(process.execPath, [
      'scripts/linear-deliverables-reconcile.js',
      `--client=${TEST_CLIENT}`,
      `--test-authority-client=${TEST_CLIENT}`,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, APPLY: 'false', CAP: '15', B4_CONFIRM_TEST_MUTATIONS: '1' },
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
    });
    if (result.status !== 0) fail(`two-way reconciler failed: ${(result.stderr || result.stdout).slice(-1000)}`);
    const rows = await this.rest('deliverable_events?select=id,payload,ts&action=eq.linear_deliverables_reconcile_v2&order=id.desc&limit=1');
    assert(rows.length === 1, 'two-way reconciler summary event missing');
    const event = parseJson(rows[0].payload);
    const summary = parseJson(event.summary);
    assert(event.test_authority_client === TEST_CLIENT, 'two-way summary did not use the TEST authority override');
    assert(Number(summary.diff_count || 0) === 0 && Number(summary.outbound_diff_count || 0) === 0,
      'two-way reconciler ended with outbound drift');
    assert(Number(summary.repair_list_size || 0) === 0 && Number(summary.linkage_actionable || 0) === 0,
      'two-way reconciler ended with repair/linkage work');
    this.record('two_way_reconcile', 'outbound 0/0/0', {
      event_id: rows[0].id,
      entities_checked: summary.entities_checked,
      outbound_diff_count: summary.outbound_diff_count,
      repair_list_size: summary.repair_list_size,
      linkage_actionable: summary.linkage_actionable,
    }, Date.now() - started);
  }

  async assertFlagsUnchanged() {
    const rows = await this.rest('syncview_runtime_flags?select=key,value&key=in.(linear_outbound_enabled,prod_authority,auth_enforcement,linear_inbound_enabled)');
    const after = Object.fromEntries(rows.map(row => [row.key, row.value]));
    assert(stableJson(after) === stableJson(this.flagsBefore), 'runtime flags changed during B4 TEST proof');
    return after;
  }

  async run() {
    await this.preflight();
    let failure = null;
    try {
      await this.createFixtures();
      await this.proveShadow();
      await this.proveLiveCreates();
      await this.proveOperations();
      await this.provePauseResume();
      await this.proveKillSwitch();
      await this.proveEchoDrops();
      await this.reconcileTwoWay();
    } catch (error) {
      failure = error;
    }

    try {
      if (this.assets.length) await this.cleanup();
      await this.reconcile();
    } catch (cleanupError) {
      failure = failure || cleanupError;
    }

    const flagsAfter = await this.assertFlagsUnchanged();
    const outbox = await this.rest(`mirror_outbox?select=*&client_slug=eq.${TEST_CLIENT}&test_only=eq.true&dedup_key=like.${encodeURIComponent(this.runId + '*')}&order=id.asc`);
    const report = {
      run_id: this.runId,
      finished_at: nowIso(),
      ok: !failure && this.scenarios.every(row => row.status === 'PASS'),
      scenarios: this.scenarios,
      assets: this.assets.map(asset => ({
        team: asset.team,
        project: asset.project.name,
        batch_identifier: asset.batch.identifier || null,
        deliverable_identifier: asset.deliverable.identifier || null,
      })),
      outbox: outbox.map(compactOutbox),
      flags_unchanged: flagsAfter,
      error: failure ? clean(failure.message) : null,
    };
    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2));
    console.log(`Private report: ${this.reportPath}`);
    if (failure) throw failure;
    assert(report.ok, 'one or more B4 scenarios failed');
    return report;
  }
}

module.exports = {
  TEST_CLIENT,
  TEST_PROJECT_NAMES,
  deterministicCreateId,
  statusSlug,
  stateForSlug,
  assertTestIssue,
  scenarioPlan,
};

if (require.main === module) {
  new Harness().run().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
