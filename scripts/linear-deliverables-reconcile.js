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
const PAGE_DELAY_MS = Math.max(0, Number(args.get('page-delay-ms') || process.env.PAGE_DELAY_MS || 120));
const DETAILS_JSON = args.get('details-json') || '';

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

function authorityFor(team, prodAuthority) {
  const raw = prodAuthority && typeof prodAuthority === 'object' ? prodAuthority : {};
  return clean(raw[team] || 'linear').toLowerCase() === 'supabase' ? 'supabase' : 'linear';
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
    prodAuthority,
  ] = await Promise.all([
    supabaseRows('deliverables', 'id,identifier,batch_id,client_slug,team,kind,title,status,assignee_id,due_date,priority,origin,card_id,linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw', 'order=team.asc,identifier.asc'),
    supabaseRows('team_members', 'id,name,email,linear_user_id,team,active'),
    supabaseRows('deliverable_events', 'deliverable_id,action,source,payload', '&source=eq.mirror&order=ts.desc'),
    supabaseRows('calendar_posts', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('sample_reviews', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('linear_archive', 'linear_uuid,identifier,state'),
    loadRuntimeFlag('prod_authority'),
  ]);
  const active = deliverables
    .filter(d => clean(d.linear_issue_uuid))
    .filter(d => !deliverableArchivedOrDeleted(d))
    .filter(d => !TEAM_FILTER || clean(d.team).toLowerCase() === TEAM_FILTER);
  const [linearIssues, webhooks] = await Promise.all([
    loadLinearIssuesById(active.map(d => d.linear_issue_uuid)),
    loadLinearWebhooks(),
  ]);
  return { deliverables: active, allDeliverables: deliverables, members, events, calendarPosts, sampleReviews, linearArchive, prodAuthority, linearIssues, webhooks };
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
    prodAuthority: data.prodAuthority || { video: 'linear', graphics: 'linear' },
    linearIssues: new Map((data.linearIssues || []).map(i => [clean(i.id), i])),
    webhooks: data.webhooks || [],
  };
}

function buildPlan(data) {
  const memberById = new Map((data.members || []).map(m => [clean(m.id), m]).filter(([k]) => k));
  const memberByLinearId = new Map((data.members || []).map(m => [clean(m.linear_user_id), m]).filter(([k]) => k));
  const eventsByDeliverable = groupEvents(data.events || []);
  const results = [];
  for (const deliverable of data.deliverables || []) {
    const issue = data.linearIssues.get(clean(deliverable.linear_issue_uuid)) || null;
    const authority = authorityFor(clean(deliverable.team), data.prodAuthority);
    results.push(classifyDeliverable({
      deliverable,
      linearIssue: issue,
      events: eventsByDeliverable.get(clean(deliverable.id)) || [],
      memberById,
      memberByLinearId,
      stateUuidMap: STATE_UUID_MAP,
      authority,
    }));
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
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Deliverables checked | ${s.deliverables_checked} |`,
    `| Real diffs | ${s.diff_count} |`,
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
    '| Team | Deliverables | Diffs | Tolerated | Repairs | Detect-only rows |',
    '|---|---:|---:|---:|---:|---:|',
  ];
  for (const [team, t] of Object.entries(s.by_team || {})) {
    lines.push(`| ${team} | ${t.deliverables} | ${t.diff_count} | ${t.tolerated_count} | ${t.repair_list_size} | ${t.detect_only_rows} |`);
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
  const rows = plan.results.filter(r => r.diffs.length && r.authority !== 'supabase');
  if (!APPLY) return { attempted: 0, skipped: rows.length };
  if (rows.length > SAFETY_CAP) {
    throw new Error(`Refusing to apply ${rows.length} row correction(s); cap is ${SAFETY_CAP}`);
  }
  let attempted = 0;
  for (const r of rows) {
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
  return { attempted, skipped: 0 };
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
        team: r.team,
        identifier: r.identifier,
        authority: r.authority,
        diffs: r.diffs,
        patch: r.patch,
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

module.exports = { buildPlan, loadLiveData, summaryMarkdown };
