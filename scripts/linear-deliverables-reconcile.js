'use strict';
/*
 * Track B reconciler v2: Linear ⇄ deliverables full-scope diff engine.
 *
 * Default mode is DRY-RUN. It reads Linear + dormant B1 Supabase tables, writes a
 * single summary event row, and never heals unless APPLY=true / --apply is set.
 *
 *   node scripts/linear-deliverables-reconcile.js
 *   APPLY=true CAP=15 node scripts/linear-deliverables-reconcile.js
 *   node scripts/linear-deliverables-reconcile.js --fixtures test/fixtures/linear-deliverables-reconcile.json
 */
const fs = require('fs');
const path = require('path');
const {
  clean,
  parseJson,
  classifyDeliverable,
  classifyOutboundDeliverable,
  classifyOutboundBatch,
  linkageGaps,
  summarize,
  summarizeWebhooks,
  deliverableArchivedOrDeleted,
} = require('./linear-deliverables-reconcile-lib');
const {
  planLinkageBackfill,
  summarizePlan: summarizeLinkageBackfillPlan,
} = require('./b3-linkage-backfill');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));

const APPLY = process.argv.includes('--apply') || /^(1|true|yes)$/i.test(process.env.APPLY || '');
const SAFETY_CAP = Number(process.env.CAP || args.get('cap') || 15);
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const LINEAR_API_KEY = String(process.env.LINEAR_API_KEY || process.env.LINEAR_API_TOKEN || process.env.LINEAR_KEY || process.env.LINEAR_TOKEN || '');
const STATE_UUID_MAP = parseJson(process.env.LINEAR_STATE_UUID_MAP || '{}');
const FIXTURES = args.get('fixtures') || '';
const TEAM_FILTER = clean(args.get('team')).toLowerCase();
const IDENTIFIER_FILTER = clean(args.get('identifier')).toUpperCase();
const CLIENT_FILTER = clean(args.get('client')).toLowerCase();
const TEST_AUTHORITY_CLIENT = clean(args.get('test-authority-client') || process.env.B4_TEST_AUTHORITY_CLIENT).toLowerCase();
const PAGE_DELAY_MS = Math.max(0, Number(args.get('page-delay-ms') || process.env.PAGE_DELAY_MS || 120));
const DETAILS_JSON = args.get('details-json') || '';

if (TEST_AUTHORITY_CLIENT) {
  if (TEST_AUTHORITY_CLIENT !== 'sidneylaruel'
      || process.env.B4_CONFIRM_TEST_MUTATIONS !== '1'
      || APPLY) {
    fail('TEST authority override requires sidneylaruel, B4_CONFIRM_TEST_MUTATIONS=1, and dry-run mode');
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function linear(query) {
  if (!LINEAR_API_KEY) fail('LINEAR_API_KEY is required unless --fixtures is supplied');
  const resp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: LINEAR_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.errors) {
    throw new Error(`Linear GraphQL failed: HTTP ${resp.status} ${JSON.stringify(json && json.errors || json).slice(0, 500)}`);
  }
  return json.data;
}

async function supabaseRows(table, select, params = '') {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required unless --fixtures is supplied');
  const rows = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${limit}&offset=${offset}${params ? `&${params}` : ''}`;
    const resp = await fetch(url, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Supabase ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
    const batch = await resp.json();
    rows.push(...batch);
    if (!Array.isArray(batch) || batch.length < limit) break;
    offset += limit;
  }
  return rows;
}

async function supabaseInsert(table, rows) {
  if (!rows.length) return [];
  const resp = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) throw new Error(`Supabase insert ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  return resp.json();
}

async function supabaseRpc(name, body) {
  const resp = await fetch(`${SUPA_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Supabase rpc ${name} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  return resp.json();
}

function safeGraphqlString(v) {
  const s = clean(v);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error(`Unsafe Linear id: ${s.slice(0, 20)}`);
  return JSON.stringify(s);
}

function issueFields() {
  return `id identifier title description url priority dueDate archivedAt canceledAt completedAt updatedAt
    state { id name type }
    team { id key name }
    assignee { id name email }
    parent { id identifier title }
    comments(first: 50) { nodes { id body createdAt user { id name email } } pageInfo { hasNextPage } }`;
}

async function loadLinearIssuesById(ids) {
  const out = new Map();
  const unique = [...new Set(ids.map(clean).filter(Boolean))];
  const chunkSize = 35;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const aliases = chunk.map((id, idx) => `i${idx}: issue(id: ${safeGraphqlString(id)}) { ${issueFields()} }`).join('\n');
    const data = await linear(`query ReconcileDeliverableIssues { ${aliases} }`);
    chunk.forEach((id, idx) => {
      const issue = data[`i${idx}`] || null;
      if (issue) out.set(id, issue);
    });
    if (PAGE_DELAY_MS) await sleep(PAGE_DELAY_MS);
  }
  return out;
}

async function loadLinearWebhooks() {
  const data = await linear(`query ReconcileWebhookProbe {
    webhooks(first: 100) {
      nodes {
        id
        label
        enabled
        resourceTypes
        team { key name }
      }
    }
  }`);
  return data.webhooks && Array.isArray(data.webhooks.nodes) ? data.webhooks.nodes : [];
}

function groupEvents(events) {
  const by = new Map();
  for (const ev of events || []) {
    const id = clean(ev.deliverable_id);
    if (!id) continue;
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(ev);
  }
  return by;
}

function authorityFor(team, prodAuthority, clientSlug = '') {
  if (TEST_AUTHORITY_CLIENT && clean(clientSlug).toLowerCase() === TEST_AUTHORITY_CLIENT) return 'syncview';
  const raw = prodAuthority && typeof prodAuthority === 'object' ? prodAuthority : {};
  const key = clean(team).toLowerCase() === 'graphics' || clean(team).toLowerCase() === 'graphic'
    ? 'graphics'
    : 'video';
  const value = clean(raw[key] || 'linear').toLowerCase();
  return value === 'supabase' || value === 'syncview' ? 'syncview' : 'linear';
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

function batchParentEntries(batch) {
  const normalizeTeam = value => {
    const key = clean(value).toLowerCase();
    if (key === 'gra' || key === 'graphic') return 'graphics';
    if (key === 'vid') return 'video';
    return key;
  };
  const raw = batch && batch.linear_parent_ids;
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object'
      ? Object.entries(parsed).map(([team, value]) => value && typeof value === 'object'
        ? Object.assign({ team }, value)
        : { team, id: value })
      : []);
  const normalized = rows.map(value => {
    if (typeof value === 'string') return { id: clean(value), team: '' };
    return value && typeof value === 'object'
      ? { id: clean(value.id || value.uuid || value.linear_issue_uuid), team: normalizeTeam(value.team) }
      : { id: '', team: '' };
  }).filter(row => row.id);
  return normalized;
}

function batchParentId(batch, team) {
  const wanted = clean(team).toLowerCase() === 'gra' || clean(team).toLowerCase() === 'graphic' ? 'graphics'
    : (clean(team).toLowerCase() === 'vid' ? 'video' : clean(team).toLowerCase());
  const normalized = batchParentEntries(batch);
  const exact = normalized.find(row => row.team === wanted);
  return clean((exact || normalized[0] || {}).id);
}

function writtenComments(outboxRows) {
  const byDeliverable = new Map();
  for (const row of outboxRows || []) {
    if (row.status !== 'written' || row.operation !== 'comment') continue;
    const result = parseJson(row.linear_result);
    const payload = parseJson(row.payload);
    const id = clean(result.comment_id);
    const deliverableId = clean(row.deliverable_id || row.entity_id);
    if (!id || !deliverableId) continue;
    if (!byDeliverable.has(deliverableId)) byDeliverable.set(deliverableId, []);
    byDeliverable.get(deliverableId).push({
      comment_id: id,
      outbox_id: Number(row.id || 0),
      body: clean(payload.body),
      source_edited_at: clean(row.source_edited_at),
    });
  }
  return byDeliverable;
}

async function loadRuntimeFlag(key) {
  const rows = await supabaseRows('syncview_runtime_flags', 'key,value', `&key=eq.${encodeURIComponent(key)}&limit=1`);
  return rows[0] ? parseJson(rows[0].value) : {};
}

async function loadLiveData() {
  const [
    deliverables,
    members,
    events,
    calendarPosts,
    sampleReviews,
    linearArchive,
    batches,
    outboxRows,
    prodAuthority,
  ] = await Promise.all([
    supabaseRows('deliverables', 'id,identifier,batch_id,client_slug,team,kind,title,status,status_at,assignee_id,due_date,priority,origin,card_id,updated_at,linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw', 'order=team.asc,identifier.asc'),
    supabaseRows('team_members', 'id,name,email,linear_user_id,team,active'),
    supabaseRows('deliverable_events', 'deliverable_id,action,source,payload', '&source=in.(ui,mirror,outbound)&order=ts.desc'),
    supabaseRows('calendar_posts', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('sample_reviews', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('linear_archive', 'linear_uuid,identifier,state'),
    supabaseRows('batches', 'id,client_slug,team,name,description,status,comments,created_by,created_at,updated_at,linear_parent_ids'),
    supabaseRows('mirror_outbox', 'id,deliverable_id,batch_id,entity_id,operation,status,payload,source_edited_at,linear_result'),
    loadRuntimeFlag('prod_authority'),
  ]);
  const active = deliverables
    .filter(d => !deliverableArchivedOrDeleted(d))
    .filter(d => !TEAM_FILTER || clean(d.team).toLowerCase() === TEAM_FILTER)
    .filter(d => !CLIENT_FILTER || clean(d.client_slug).toLowerCase() === CLIENT_FILTER)
    .filter(d => !IDENTIFIER_FILTER || clean(d.identifier || d.linear_identifier).toUpperCase() === IDENTIFIER_FILTER);
  const activeBatches = batches
    .filter(b => !['archived', 'canceled'].includes(clean(b.status).toLowerCase()))
    .filter(b => !TEAM_FILTER || clean(b.team).toLowerCase() === TEAM_FILTER)
    .filter(b => !CLIENT_FILTER || clean(b.client_slug).toLowerCase() === CLIENT_FILTER)
    .filter(b => !IDENTIFIER_FILTER);
  const issueIds = active.map(d => d.linear_issue_uuid).filter(Boolean)
    .concat(activeBatches.flatMap(b => batchParentEntries(b).map(parent => parent.id)).filter(Boolean));
  const [linearIssues, webhooks] = await Promise.all([
    loadLinearIssuesById(issueIds),
    loadLinearWebhooks(),
  ]);
  return { deliverables: active, allDeliverables: deliverables, members, events, calendarPosts, sampleReviews, linearArchive, batches: activeBatches, allBatches: batches, outboxRows, prodAuthority, linearIssues, webhooks };
}

function loadFixtureData(file) {
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  return {
    deliverables: data.deliverables || [],
    members: data.members || [],
    events: data.events || [],
    calendarPosts: data.calendarPosts || [],
    sampleReviews: data.sampleReviews || [],
    linearArchive: data.linearArchive || [],
    batches: data.batches || [],
    allBatches: data.batches || [],
    outboxRows: data.outboxRows || [],
    prodAuthority: data.prodAuthority || { video: 'linear', graphics: 'linear' },
    linearIssues: new Map((data.linearIssues || []).map(i => [clean(i.id), i])),
    webhooks: data.webhooks || [],
  };
}

function buildPlan(data) {
  const memberById = new Map((data.members || []).map(m => [clean(m.id), m]).filter(([k]) => k));
  const memberByLinearId = new Map((data.members || []).map(m => [clean(m.linear_user_id), m]).filter(([k]) => k));
  const eventsByDeliverable = groupEvents(data.events || []);
  const batchById = new Map((data.allBatches || data.batches || []).map(row => [clean(row.id), row]).filter(([id]) => id));
  const commentsByEntity = writtenComments(data.outboxRows || []);
  const liveBatchIds = new Set((data.deliverables || []).map(row => clean(row.batch_id)).filter(Boolean));
  const results = [];
  for (const deliverable of data.deliverables || []) {
    const issue = data.linearIssues.get(clean(deliverable.linear_issue_uuid)) || null;
    const authority = authorityFor(clean(deliverable.team), data.prodAuthority, deliverable.client_slug);
    const shared = {
      deliverable,
      linearIssue: issue,
      events: eventsByDeliverable.get(clean(deliverable.id)) || [],
      memberById,
      memberByLinearId,
      stateUuidMap: STATE_UUID_MAP,
      authority,
    };
    results.push(authority === 'syncview'
      ? classifyOutboundDeliverable(Object.assign({}, shared, {
        expectedParentId: batchParentId(batchById.get(clean(deliverable.batch_id)), deliverable.team),
        outboxComments: commentsByEntity.get(clean(deliverable.id)) || [],
      }))
      : classifyDeliverable(shared));
  }
  for (const batch of data.batches || []) {
    if (!liveBatchIds.has(clean(batch.id))) continue;
    let parents = batchParentEntries(batch);
    if (!parents.length) {
      if (/backfill/i.test(clean(batch.created_by))) continue;
      parents = [{ id: '', team: clean(batch.team) }];
    }
    for (const parent of parents) {
      const authority = authorityFor(parent.team || clean(batch.team), data.prodAuthority, batch.client_slug);
      if (authority !== 'syncview') continue;
      const issue = data.linearIssues.get(parent.id) || null;
      results.push(classifyOutboundBatch({
        batch,
        team: parent.team || clean(batch.team),
        linearIssue: issue,
        outboxComments: commentsByEntity.get(clean(batch.id)) || [],
      }));
    }
  }
  const linkageRows = linkageGaps({ calendarPosts: data.calendarPosts, sampleReviews: data.sampleReviews });
  const summary = summarize(results, linkageRows);
  summary.linkage_residue = summarizeLinkageBackfillPlan(planLinkageBackfill({
    deliverables: data.allDeliverables || data.deliverables || [],
    calendarPosts: data.calendarPosts || [],
    sampleReviews: data.sampleReviews || [],
    linearArchive: data.linearArchive || [],
  }));
  summary.linkage_actionable = Number(summary.linkage_residue.planned_writes || 0);
  summary.webhooks = summarizeWebhooks(data.webhooks || []);
  return { results, linkageRows, summary };
}

function summaryMarkdown(plan, startedAt, finishedAt) {
  const s = plan.summary;
  const lr = s.linkage_residue || {};
  const lines = [
    '### Linear ⇄ deliverables reconcile v2',
    '',
    `Started: ${startedAt}`,
    `Finished: ${finishedAt}`,
    `Mode: ${APPLY ? 'apply' : 'dry-run'}`,
    `Scope: ${IDENTIFIER_FILTER || CLIENT_FILTER || TEAM_FILTER || 'all live entities'}`,
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Deliverables checked | ${s.deliverables_checked} |`,
    `| Batches checked | ${s.batches_checked || 0} |`,
    `| Real diffs | ${s.diff_count} |`,
    `| Linear -> SyncView diffs | ${s.inbound_diff_count || 0} |`,
    `| SyncView -> Linear diffs | ${s.outbound_diff_count || 0} |`,
    `| Rows with diffs | ${s.diff_rows} |`,
    `| Tolerated divergences | ${s.tolerated_count} |`,
    `| Unknown-assignee repair rows | ${s.repair_list_size} |`,
    `| Card linkage gaps | ${s.linkage_count} |`,
    `| Card linkage actionable | ${s.linkage_actionable || 0} |`,
    `| Card linkage resolvable writes | ${lr.planned_writes || 0} |`,
    `| Card linkage explained residue | ${lr.skipped || 0} |`,
    `| Linear webhooks checked | ${s.webhooks ? s.webhooks.checked : 0} |`,
    `| Linear webhooks disabled | ${s.webhooks ? s.webhooks.disabled : 0} |`,
    `| Linear webhooks missing Comment resource | ${s.webhooks ? s.webhooks.missing_comment_resource : 0} |`,
    '',
    '| Team | Deliverables | Batches | Inbound diffs | Outbound diffs | Tolerated | Repairs | Detect-only rows |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [team, t] of Object.entries(s.by_team || {})) {
    lines.push(`| ${team} | ${t.deliverables} | ${t.batches || 0} | ${t.inbound_diff_count || 0} | ${t.outbound_diff_count || 0} | ${t.tolerated_count} | ${t.repair_list_size} | ${t.detect_only_rows} |`);
  }
  return lines.join('\n');
}

async function writeSummaryEvent(plan, startedAt, finishedAt) {
  if (FIXTURES) return [];
  return supabaseInsert('deliverable_events', [{
    client_slug: '_system',
    action: 'linear_deliverables_reconcile_v2',
    source: 'reconcile',
    actor: 'codex-b3-reconciler-v2',
    payload: {
      ok: true,
      dry_run: !APPLY,
      apply: APPLY,
      cap: SAFETY_CAP,
      identifier_filter: IDENTIFIER_FILTER || null,
      client_filter: CLIENT_FILTER || null,
      test_authority_client: TEST_AUTHORITY_CLIENT || null,
      started_at: startedAt,
      finished_at: finishedAt,
      summary: plan.summary,
      linkage_sample: plan.linkageRows.slice(0, 20),
      tolerated_sample: plan.results.flatMap(r => r.tolerated.map(t => ({ id: r.id, team: r.team, ...t }))).slice(0, 20),
      repair_sample: plan.results.flatMap(r => r.repairs.map(p => ({ id: r.id, team: r.team, ...p }))).slice(0, 20),
    },
  }]);
}

async function applyHealing(plan) {
  const inboundRows = plan.results.filter(r => r.diffs.length && r.authority === 'linear');
  const outboundIntents = plan.results
    .filter(r => r.diffs.length && r.authority === 'syncview')
    .flatMap(row => (row.outbound_intents || []).map(intent => ({ row, intent })));
  if (!APPLY) return { attempted: 0, outbound_enqueued: 0, skipped: inboundRows.length + outboundIntents.length };
  if (inboundRows.length + outboundIntents.length > SAFETY_CAP) {
    throw new Error('Refusing to apply ' + (inboundRows.length + outboundIntents.length)
      + ' correction(s); cap is ' + SAFETY_CAP);
  }
  let attempted = 0;
  let outboundEnqueued = 0;
  for (const r of inboundRows) {
    const patchKeys = Object.keys(r.patch || {}).filter(k => r.patch[k] !== undefined);
    if (!patchKeys.length) continue;
    await supabaseRpc('deliverable_write', {
      p_row: Object.assign({}, r.row || {}, { id: r.id }, r.patch),
      p_event: {
        source: 'reconcile',
        action: 'linear_deliverables_reconcile_heal',
        actor: 'codex-b3-reconciler-v2',
        payload: {
          diff_fields: r.diffs.map(d => d.field),
          dry_run: false,
        },
      },
    });
    attempted++;
  }
  for (const item of outboundIntents) {
    const r = item.row;
    const intent = item.intent;
    if (Number(intent.requeue_outbox_id || 0) > 0) {
      const requeued = await supabaseRpc('mirror_outbox_requeue', {
        p_id: Number(intent.requeue_outbox_id),
      });
      if (requeued !== true) throw new Error('Outbound comment intent could not be requeued');
      outboundEnqueued++;
      continue;
    }
    const dedupKey = [
      'reconcile',
      clean(r.id),
      clean(intent.operation),
      clean(intent.payload && intent.payload.linear_issue_id),
      clean(intent.source_edited_at),
    ].join(':');
    await supabaseRpc('mirror_outbox_enqueue', {
      p_entity: r.entity === 'batch' ? 'batch' : 'deliverable',
      p_entity_id: clean(r.id),
      p_operation: clean(intent.operation),
      p_payload: intent.payload || {},
      p_dedup_key: dedupKey,
      p_source_edited_at: intent.source_edited_at,
      p_client_slug: clean(r.row && r.row.client_slug),
      p_team: clean(r.team),
      p_actor: 'SyncView reconciler',
      p_role: 'system',
      p_deliverable_id: r.entity === 'batch' ? null : clean(r.id),
      p_batch_id: r.entity === 'batch' ? clean(r.id) : (clean(r.row && r.row.batch_id) || null),
      p_comment_id: null,
      p_depends_on_id: null,
      p_test_only: false,
    });
    outboundEnqueued++;
  }
  return { attempted, outbound_enqueued: outboundEnqueued, skipped: 0 };
}

function writeDetails(file, plan, healing) {
  if (!file) return;
  const details = {
    summary: plan.summary,
    healing,
    diffs: plan.results
      .filter(r => r.diffs.length)
      .map(r => ({
        id: r.id,
        entity: r.entity || 'deliverable',
        team: r.team,
        identifier: r.identifier,
        authority: r.authority,
        direction: r.direction,
        diffs: r.diffs,
        patch: r.patch,
        outbound_intents: r.outbound_intents,
      })),
    repairs: plan.results
      .filter(r => r.repairs.length)
      .map(r => ({
        id: r.id,
        team: r.team,
        identifier: r.identifier,
        repairs: r.repairs,
      })),
    linkageRows: plan.linkageRows,
  };
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(path.resolve(file), JSON.stringify(details, null, 2));
}

async function main() {
  const startedAt = nowIso();
  const data = FIXTURES ? loadFixtureData(FIXTURES) : await loadLiveData();
  const plan = buildPlan(data);
  const healing = await applyHealing(plan);
  const finishedAt = nowIso();
  const events = await writeSummaryEvent(plan, startedAt, finishedAt);
  writeDetails(DETAILS_JSON, plan, healing);
  const md = summaryMarkdown(plan, startedAt, finishedAt);
  console.log(md);
  console.log(JSON.stringify({ summary_event_id: events && events[0] && events[0].id || null, summary: plan.summary, healing }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err && err.stack || err && err.message || String(err));
    process.exit(1);
  });
}

module.exports = { batchParentEntries, batchParentId, buildPlan, loadLiveData, summaryMarkdown };
