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
const {
  authorityForTeam,
  validateAuthority,
} = require('./prod-authority-guard');
const {
  ATTRIBUTION_SCHEMA,
  buildProjectIndex,
  parseJson: parseAttributionJson,
  persistedExplicitClassifications,
  resolveAttributionGraph,
  sha256,
  stableJson: stableAttributionJson,
  withAttribution,
} = require('./f200-attribution');
const {
  PLAN_SCHEMA: F200_REPAIR_PLAN_SCHEMA,
  DEFAULT_EXPECTED_COUNT: F200_EXPECTED_COUNT,
} = require('./f200-attribution-plan');

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
const F200_REPAIR_PLAN_FILE = args.get('f200-repair-plan') || '';

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
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: LINEAR_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const json = await resp.json().catch(() => null);
    if (resp.ok && json && !json.errors) return json.data;
    if (attempt < 3 && (resp.status === 429 || resp.status >= 500)) {
      await sleep(500 * (2 ** (attempt - 1)));
      continue;
    }
    throw new Error(`Linear GraphQL failed: HTTP ${resp.status} ${JSON.stringify(json && json.errors || json).slice(0, 500)}`);
  }
  throw new Error('Linear GraphQL retry loop exhausted');
}

function isRetryableSupabaseRead(status) {
  return Number(status) === 429 || Number(status) >= 500;
}

async function supabaseRows(table, select, params = '') {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required unless --fixtures is supplied');
  const rows = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${limit}&offset=${offset}${params ? `&${params}` : ''}`;
    let batch;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const resp = await fetch(url, {
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
      });
      if (resp.ok) {
        batch = await resp.json();
        break;
      }
      const errorText = (await resp.text()).slice(0, 500);
      if (attempt < 3 && isRetryableSupabaseRead(resp.status)) {
        await sleep(500 * (2 ** (attempt - 1)));
        continue;
      }
      throw new Error(`Supabase ${table} HTTP ${resp.status}: ${errorText}`);
    }
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

async function f27WriteAuthorizationGeneration(team) {
  const rawTeam = clean(team).toLowerCase();
  const normalizedTeam = rawTeam === 'graphics' || rawTeam === 'graphic' || rawTeam === 'gra'
    ? 'graphics'
    : rawTeam === 'video' || rawTeam === 'vid'
      ? 'video'
      : '';
  if (!normalizedTeam) throw new Error('F27 write authorization requires a real team');
  const authorization = parseJson(await supabaseRpc('track_b_f27_write_authorization', {
    p_team: normalizedTeam,
  }));
  const generation = authorization.generation;
  if (authorization.ok !== true
      || clean(authorization.type) !== 'f27_write_authorization'
      || clean(authorization.team) !== normalizedTeam
      || !['linear', 'syncview'].includes(clean(authorization.authority))
      || typeof generation !== 'number'
      || !Number.isSafeInteger(generation)
      || generation < 0) {
    throw new Error('F27 write authorization is invalid');
  }
  return generation;
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
    project { id }
    assignee { id name email }
    parent {
      id identifier title
      project { id }
      parent { id identifier title project { id } }
    }
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

function expectedParentIdForDeliverable(deliverable, batch) {
  const title = clean(deliverable && deliverable.title).toLowerCase();
  const batchName = clean(batch && batch.name).toLowerCase();
  // The B1 adapter contract represents a title-matched deliverable as the
  // batch-parent issue. It must never be reconciled as its own child.
  if (title && batchName && title === batchName) return '';
  return batchParentId(batch, deliverable && deliverable.team);
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
    clients,
    prodAuthority,
  ] = await Promise.all([
    supabaseRows('deliverables', 'id,identifier,batch_id,client_slug,team,kind,title,status,status_at,assignee_id,due_date,priority,origin,card_id,created_by,created_at,updated_at,linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw', 'order=team.asc,identifier.asc'),
    supabaseRows('team_members', 'id,name,email,linear_user_id,team,active'),
    supabaseRows('deliverable_events', 'deliverable_id,action,source,payload', '&source=in.(ui,mirror,outbound)&order=ts.desc'),
    supabaseRows('calendar_posts', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('sample_reviews', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('linear_archive', 'linear_uuid,identifier,state'),
    supabaseRows('batches', 'id,client_slug,team,name,description,status,comments,created_by,created_at,updated_at,linear_parent_ids'),
    supabaseRows('mirror_outbox', 'id,deliverable_id,batch_id,entity_id,operation,status,payload,source_edited_at,linear_result'),
    supabaseRows('clients', 'slug,kind,active,linear_project_ids'),
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
  const attributionIssueIds = [...new Set(active.map(row => clean(row.linear_issue_uuid)).filter(Boolean))];
  const attributionFamilyComplete = !TEAM_FILTER && !CLIENT_FILTER && !IDENTIFIER_FILTER
    && attributionIssueIds.every(id => linearIssues.has(id));
  return {
    deliverables: active,
    allDeliverables: deliverables,
    members,
    events,
    calendarPosts,
    sampleReviews,
    linearArchive,
    batches: activeBatches,
    allBatches: batches,
    outboxRows,
    clients,
    attributionFamilyComplete,
    attributionExpectedIssueCount: attributionIssueIds.length,
    attributionLoadedIssueCount: attributionIssueIds.filter(id => linearIssues.has(id)).length,
    prodAuthority,
    linearIssues,
    webhooks,
  };
}

/*
 * An F200 repair is an exact private cohort, not a normal whole-mirror
 * reconcile. Loading only that cohort avoids an unrelated large GraphQL read
 * becoming a prerequisite for its per-row authority/CAS revalidation.
 */
async function loadLiveF200RepairData(privatePlan) {
  const payloads = privatePlan && privatePlan.payloads;
  if (!Array.isArray(payloads) || !payloads.length) {
    throw new Error('F200 repair plan has no payload cohort');
  }
  const ids = payloads.map(payload => clean(payload && payload.target_id));
  if (ids.some(id => !/^[A-Za-z0-9_-]+$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('F200 repair plan has an unsafe or duplicate deliverable cohort');
  }
  const deliverables = [];
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    deliverables.push(...await supabaseRows(
      'deliverables',
      'id,identifier,batch_id,client_slug,team,kind,title,status,status_at,assignee_id,due_date,priority,origin,card_id,created_by,created_at,updated_at,linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw',
      `id=in.(${chunk.map(encodeURIComponent).join(',')})`,
    ));
  }
  if (deliverables.length !== ids.length) {
    throw new Error('F200 repair cohort no longer resolves to its exact deliverables');
  }
  const [clients, prodAuthority] = await Promise.all([
    supabaseRows('clients', 'slug,kind,active,linear_project_ids'),
    loadRuntimeFlag('prod_authority'),
  ]);
  const linearIssues = await loadLinearIssuesById(deliverables.map(row => clean(row.linear_issue_uuid)));
  if (linearIssues.size !== deliverables.length) {
    throw new Error('F200 repair cohort no longer resolves to its exact Linear issues');
  }
  return {
    deliverables,
    allDeliverables: deliverables,
    members: [],
    events: [],
    calendarPosts: [],
    sampleReviews: [],
    linearArchive: [],
    batches: [],
    allBatches: [],
    outboxRows: [],
    clients,
    attributionFamilyComplete: false,
    attributionExpectedIssueCount: deliverables.length,
    attributionLoadedIssueCount: linearIssues.size,
    prodAuthority,
    linearIssues,
    webhooks: [],
  };
}

function loadFixtureData(file) {
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  return {
    deliverables: data.deliverables || [],
    allDeliverables: data.deliverables || [],
    members: data.members || [],
    events: data.events || [],
    calendarPosts: data.calendarPosts || [],
    sampleReviews: data.sampleReviews || [],
    linearArchive: data.linearArchive || [],
    batches: data.batches || [],
    allBatches: data.batches || [],
    outboxRows: data.outboxRows || [],
    clients: data.clients || [],
    attributionFamilyComplete: data.attributionFamilyComplete === true,
    attributionExpectedIssueCount: Number(data.attributionExpectedIssueCount || (data.linearIssues || []).length),
    attributionLoadedIssueCount: Number(data.attributionLoadedIssueCount || (data.linearIssues || []).length),
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
  const attributionIssueIds = new Set([...data.linearIssues.keys()].map(clean).filter(Boolean));
  const explicitClassifications = persistedExplicitClassifications(
    (data.allDeliverables || data.deliverables || [])
      .filter(row => attributionIssueIds.has(clean(row.linear_issue_uuid))),
    data.clients || [],
  );
  const attributionGraph = (data.clients || []).length
    ? resolveAttributionGraph([...data.linearIssues.values()], data.clients, {
      explicitClassifications,
      familyComplete: data.attributionFamilyComplete === true,
    })
    : null;
  const unresolvedClientSlug = (data.clients || []).some(row => clean(row && row.slug) === 'unattributed')
    ? 'unattributed'
    : '';
  const results = [];
  for (const deliverable of data.deliverables || []) {
    const issue = data.linearIssues.get(clean(deliverable.linear_issue_uuid)) || null;
    const authority = authorityFor(clean(deliverable.team), data.prodAuthority, deliverable.client_slug);
    const batch = batchById.get(clean(deliverable.batch_id));
    const shared = {
      deliverable,
      linearIssue: issue,
      events: eventsByDeliverable.get(clean(deliverable.id)) || [],
      memberById,
      memberByLinearId,
      stateUuidMap: STATE_UUID_MAP,
      authority,
      attribution: attributionGraph && attributionGraph.byIssueId.get(clean(issue && issue.id)),
      unresolvedClientSlug,
    };
    results.push(authority === 'syncview'
      ? classifyOutboundDeliverable(Object.assign({}, shared, {
        expectedParentId: expectedParentIdForDeliverable(deliverable, batch),
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
  summary.attribution = attributionGraph ? attributionGraph.summary : null;
  if (summary.attribution) {
    summary.attribution.family_complete = data.attributionFamilyComplete === true;
    summary.attribution.expected_issue_count = Number(data.attributionExpectedIssueCount || 0);
    summary.attribution.loaded_issue_count = Number(data.attributionLoadedIssueCount || 0);
  }
  summary.attribution_storage_sentinel_present = !!unresolvedClientSlug;
  return { results, linkageRows, summary };
}

function exactObjectKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has unexpected keys`);
  }
}

function mergedCurrentLinearIssue(deliverable, linearIssue) {
  const raw = parseAttributionJson(deliverable && deliverable.linear_raw);
  const stored = raw.issue && typeof raw.issue === 'object' ? raw.issue : {};
  const live = linearIssue && typeof linearIssue === 'object' ? linearIssue : {};
  return Object.assign({}, stored, live, {
    id: clean(linearIssue && linearIssue.id || deliverable && deliverable.linear_issue_uuid),
  });
}

function f200RepairRowState(current, liveIssue, payload) {
  const targetPatch = payload && payload.patch || {};
  const precondition = payload && payload.precondition || {};
  const id = clean(payload && payload.target_id);
  const linearIssueId = clean(precondition.linear_issue_uuid);
  const targetSlug = clean(targetPatch.client_slug);
  const targetAttribution = parseAttributionJson(targetPatch.linear_raw).attribution;
  const currentRaw = parseAttributionJson(current && current.linear_raw);
  const currentAttribution = currentRaw.attribution;

  if (!current || !liveIssue || !id || clean(current.id) !== id
      || !linearIssueId || clean(current.linear_issue_uuid) !== linearIssueId
      || clean(liveIssue.id) !== linearIssueId || !targetSlug || !targetAttribution) {
    throw new Error(`F200 repair live row identity is invalid for ${id || 'unknown'}`);
  }
  if (sha256(mergedCurrentLinearIssue(current, liveIssue))
      !== clean(precondition.linear_issue_sha256)) {
    throw new Error(`F200 repair Linear issue drifted for deliverable ${id}`);
  }
  if (clean(current.client_slug) === targetSlug
      && stableAttributionJson(currentAttribution || {})
        === stableAttributionJson(targetAttribution)) {
    return {
      state: 'already_applied',
      id,
      linearIssueId,
      targetSlug,
      targetAttribution,
      patch: null,
    };
  }
  if (clean(precondition.client_slug) !== 'unattributed'
      || clean(current.client_slug) !== 'unattributed'
      || clean(current.updated_at) !== clean(precondition.updated_at)
      || sha256(currentRaw) !== clean(precondition.linear_raw_sha256)) {
    throw new Error(`F200 repair precondition drifted for deliverable ${id}`);
  }

  return {
    state: 'pending',
    id,
    linearIssueId,
    targetSlug,
    targetAttribution,
    patch: {
      client_slug: targetSlug,
      linear_raw: withAttribution(currentRaw, targetAttribution),
    },
  };
}

function buildF200RepairExecutionPlan(data, privatePlan, options = {}) {
  const expectedCount = Number(options.expectedCount == null ? F200_EXPECTED_COUNT : options.expectedCount);
  let exactAuthority;
  try {
    exactAuthority = validateAuthority(data && data.prodAuthority);
  } catch (error) {
    throw new Error(`F200 repair requires validated live prod_authority: ${error.message}`);
  }
  if (clean(privatePlan && privatePlan.schema) !== F200_REPAIR_PLAN_SCHEMA
      || clean(privatePlan && privatePlan.finding) !== 'F200') {
    throw new Error('F200 repair plan schema/finding is invalid');
  }
  if (privatePlan.source_only !== true || Number(privatePlan.writes_executed) !== 0) {
    throw new Error('F200 repair plan must be an unused source-only artifact');
  }
  if (Number(privatePlan.expected_count) !== expectedCount
      || !privatePlan.proof
      || privatePlan.proof.complete !== true
      || Number(privatePlan.proof.resolved_count) !== expectedCount
      || Number(privatePlan.proof.distinct_deliverable_ids) !== expectedCount
      || Number(privatePlan.proof.distinct_linear_issue_ids) !== expectedCount
      || privatePlan.proof.exact_payload_count !== true
      || privatePlan.proof.all_payloads_are_cas_patch !== true
      || privatePlan.proof.source_cohort_is_unattributed_repair !== true
      || privatePlan.proof.no_client_inserts !== true
      || privatePlan.proof.no_name_or_title_inference !== true) {
    throw new Error(`F200 repair proof must bind exactly ${expectedCount} fully resolved rows`);
  }
  if (!privatePlan.before
      || Number(privatePlan.before.total) !== expectedCount
      || stableAttributionJson(privatePlan.before.by_client_slug || {})
        !== stableAttributionJson({ unattributed: expectedCount })) {
    throw new Error(`F200 repair source must be exactly ${expectedCount} unattributed rows`);
  }
  if (!privatePlan.owner_manifest || privatePlan.owner_manifest.owner_approved !== true
      || Number(privatePlan.owner_manifest.expected_count) !== expectedCount
      || clean(privatePlan.owner_manifest.snapshot_sha256) !== clean(privatePlan.snapshot_sha256)) {
    throw new Error('F200 repair plan lacks its exact owner-approved manifest proof');
  }
  const hashInput = Object.assign({}, privatePlan);
  delete hashInput.plan_sha256;
  if (clean(privatePlan.plan_sha256) !== sha256(hashInput)) {
    throw new Error('F200 repair plan hash does not match its payloads');
  }

  const payloads = privatePlan.payloads;
  if (!Array.isArray(payloads) || payloads.length !== expectedCount) {
    throw new Error(`F200 repair plan must contain exactly ${expectedCount} payloads`);
  }
  const currentById = new Map((data.allDeliverables || data.deliverables || [])
    .map(row => [clean(row.id), row]).filter(([id]) => id));
  const projectIndex = buildProjectIndex(data.clients || []);
  if (clean(privatePlan.mapping_revision) !== projectIndex.mapping_revision) {
    throw new Error('F200 repair mapping revision is stale');
  }
  const mappedGraph = resolveAttributionGraph([...data.linearIssues.values()], data.clients || [], {
    projectIndex,
    familyComplete: false,
  });
  const seenDeliverables = new Set();
  const seenIssues = new Set();
  const results = [];

  for (const payload of payloads) {
    if (clean(payload && payload.mutation) !== 'deliverables_cas_patch'
        || clean(payload && payload.table) !== 'deliverables') {
      throw new Error('F200 repair payload must use the deliverables CAS patch');
    }
    exactObjectKeys(payload, [
      'descriptor_sha256',
      'mutation',
      'patch',
      'precondition',
      'repair_evidence',
      'table',
      'target_id',
    ], 'F200 repair descriptor');
    exactObjectKeys(payload.patch, ['client_slug', 'linear_raw'], 'F200 repair patch');
    const id = clean(payload.target_id);
    const precondition = payload.precondition || {};
    const linearIssueId = clean(precondition.linear_issue_uuid);
    if (!id || id !== clean(precondition.deliverable_id)
        || seenDeliverables.has(id) || !linearIssueId || seenIssues.has(linearIssueId)) {
      throw new Error('F200 repair payload scope is duplicate or inconsistent');
    }
    seenDeliverables.add(id);
    seenIssues.add(linearIssueId);

    const current = currentById.get(id);
    if (!current) throw new Error(`F200 repair precondition row is missing: ${id}`);
    const liveIssue = data.linearIssues.get(linearIssueId);
    if (!liveIssue) throw new Error(`F200 repair Linear issue is missing: ${linearIssueId}`);
    if (clean(precondition.client_slug) !== 'unattributed') {
      throw new Error(`F200 repair source client must be unattributed for ${id}`);
    }
    const repairState = f200RepairRowState(current, liveIssue, payload);
    const descriptorInput = Object.assign({}, payload);
    delete descriptorInput.descriptor_sha256;
    if (clean(payload.descriptor_sha256) !== sha256(descriptorInput)) {
      throw new Error(`F200 repair payload hash drifted for deliverable ${id}`);
    }

    const targetSlug = clean(payload.patch.client_slug);
    const targetOwner = projectIndex.clientBySlug.get(targetSlug);
    const targetRaw = parseAttributionJson(payload.patch.linear_raw);
    const attribution = targetRaw.attribution;
    if (!targetOwner || !attribution || attribution.schema !== ATTRIBUTION_SCHEMA
        || attribution.state !== 'resolved'
        || clean(attribution.client_slug) !== targetSlug
        || clean(attribution.mapping_revision) !== projectIndex.mapping_revision) {
      throw new Error(`F200 repair target is not a resolved active-roster owner for ${id}`);
    }
    if (repairState.state === 'pending'
        && stableAttributionJson(targetRaw)
          !== stableAttributionJson(withAttribution(current.linear_raw, attribution))) {
      throw new Error(`F200 repair payload changes fields outside attribution for ${id}`);
    }
    if (attribution.source === 'explicit_internal_test_classification') {
      if (!['internal', 'test'].includes(targetOwner.kind)) {
        throw new Error(`F200 explicit internal/test target kind is invalid for ${id}`);
      }
    } else if (attribution.source === 'explicit_roster_classification') {
      if (targetOwner.kind !== 'client') {
        throw new Error(`F200 explicit roster target kind is invalid for ${id}`);
      }
    } else {
      const mapped = mappedGraph.byIssueId.get(linearIssueId);
      if (!mapped || mapped.state !== 'resolved' || clean(mapped.client_slug) !== targetSlug) {
        throw new Error(`F200 mapped repair target no longer resolves for ${id}`);
      }
    }
    if (['explicit_internal_test_classification', 'explicit_roster_classification']
      .includes(attribution.source)
      && (attribution.explicit_owner_approved !== true
        || !clean(attribution.explicit_decision_ref)
        || clean(attribution.explicit_manifest_sha256)
          !== clean(privatePlan.owner_manifest.manifest_sha256))) {
      throw new Error(`F200 explicit repair target lacks durable owner proof for ${id}`);
    }
    if (authorityForTeam(exactAuthority, clean(current.team)) !== 'linear') {
      throw new Error(`F200 repair requires current Linear authority for ${id}`);
    }
    const evidence = payload.repair_evidence || {};
    if (clean(evidence.source) !== 'reconcile'
        || clean(evidence.action) !== 'f200_attribution_repair'
        || clean(evidence.payload && evidence.payload.finding) !== 'F200'
        || clean(evidence.payload && evidence.payload.snapshot_sha256) !== clean(privatePlan.snapshot_sha256)) {
      throw new Error(`F200 repair evidence is invalid for ${id}`);
    }

    results.push({
      id,
      entity: 'deliverable',
      team: clean(current.team),
      identifier: clean(current.identifier || current.linear_identifier),
      authority: 'linear',
      direction: 'inbound',
      row: current,
      diffs: [{
        field: 'client_attribution',
        expected: attribution,
        actual: parseAttributionJson(current.linear_raw).attribution || null,
        reason: 'owner_approved_f200_repair',
      }],
      tolerated: [],
      repairs: [],
      patch: {
        client_slug: targetSlug,
        linear_raw: targetRaw,
      },
      outbound_intents: [],
      repair_payload: payload,
      repair_state: repairState.state,
    });
  }

  if (seenDeliverables.size !== expectedCount || seenIssues.size !== expectedCount) {
    throw new Error(`F200 repair execution scope must remain exactly ${expectedCount}`);
  }
  results.sort((a, b) => a.id.localeCompare(b.id));
  const summary = summarize(results, []);
  summary.f200_attribution_repair = {
    expected_count: expectedCount,
    validated_count: results.length,
    snapshot_sha256: clean(privatePlan.snapshot_sha256),
    mapping_revision: projectIndex.mapping_revision,
    plan_sha256: clean(privatePlan.plan_sha256),
    preconditions_passed: true,
  };
  summary.linkage_residue = summarizeLinkageBackfillPlan({ planned: [], skipped: [] });
  summary.linkage_actionable = 0;
  summary.webhooks = summarizeWebhooks(data.webhooks || []);
  return { results, linkageRows: [], summary, f200Repair: true };
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
    `| Historical structure tolerances | ${s.tolerated_historical || 0} |`,
    `| Unknown-assignee repair rows | ${s.repair_list_size} |`,
    `| Needs-attribution rows | ${s.attribution && s.attribution.by_state.needs_attribution || 0} |`,
    `| Provisional child-family rows | ${s.attribution && s.attribution.by_state.provisional_child_family || 0} |`,
    `| Attribution conflicts | ${s.attribution && s.attribution.by_state.conflict || 0} |`,
    `| Attribution family snapshot complete | ${s.attribution && s.attribution.family_complete ? 'yes' : 'no'} |`,
    `| Card linkage gaps | ${s.linkage_count} |`,
    `| Card linkage actionable | ${s.linkage_actionable || 0} |`,
    `| Card linkage resolvable writes | ${lr.planned_writes || 0} |`,
    `| Card linkage explained residue | ${lr.skipped || 0} |`,
    `| Linear webhooks checked | ${s.webhooks ? s.webhooks.checked : 0} |`,
    `| Linear webhooks disabled | ${s.webhooks ? s.webhooks.disabled : 0} |`,
    `| Linear webhooks missing Comment resource | ${s.webhooks ? s.webhooks.missing_comment_resource : 0} |`,
    '',
    '| Team | Deliverables | Batches | Inbound diffs | Outbound diffs | Tolerated | Historical | Repairs | Detect-only rows |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [team, t] of Object.entries(s.by_team || {})) {
    lines.push(`| ${team} | ${t.deliverables} | ${t.batches || 0} | ${t.inbound_diff_count || 0} | ${t.outbound_diff_count || 0} | ${t.tolerated_count} | ${t.tolerated_historical || 0} | ${t.repair_list_size} | ${t.detect_only_rows} |`);
  }
  return lines.join('\n');
}

function buildSummaryEventPayload(plan, startedAt, finishedAt) {
  const privateRepair = plan.f200Repair === true;
  const results = plan.results || [];
  return {
    ok: true,
    dry_run: !APPLY,
    apply: APPLY,
    cap: SAFETY_CAP,
    identifier_filter: privateRepair ? null : IDENTIFIER_FILTER || null,
    client_filter: privateRepair ? null : CLIENT_FILTER || null,
    test_authority_client: privateRepair ? null : TEST_AUTHORITY_CLIENT || null,
    run_class: clean(process.env.RECONCILE_RUN_CLASS || 'manual'),
    github_event_name: clean(process.env.GITHUB_EVENT_NAME) || null,
    github_run_id: clean(process.env.GITHUB_RUN_ID) || null,
    github_run_attempt: clean(process.env.GITHUB_RUN_ATTEMPT) || null,
    started_at: startedAt,
    finished_at: finishedAt,
    summary: plan.summary,
    // The F200 repair plan is a private artifact. Its generic system event is
    // aggregate-only and never persists identifiers or row-level samples.
    inbound_identifier_sample: privateRepair
      ? []
      : results
        .filter(row => row.authority === 'linear' && row.diffs.length)
        .map(row => ({ identifier: clean(row.identifier), team: clean(row.team) }))
        .filter(row => row.identifier)
        .slice(0, 20),
    linkage_sample: privateRepair ? [] : (plan.linkageRows || []).slice(0, 20),
    tolerated_sample: privateRepair
      ? []
      : results.flatMap(r => r.tolerated.map(t => ({ id: r.id, team: r.team, ...t }))).slice(0, 20),
    repair_sample: privateRepair
      ? []
      : results.flatMap(r => r.repairs.map(p => ({ id: r.id, team: r.team, ...p }))).slice(0, 20),
  };
}

async function writeSummaryEvent(plan, startedAt, finishedAt) {
  if (FIXTURES) return [];
  return supabaseInsert('deliverable_events', [{
    client_slug: '_system',
    action: 'linear_deliverables_reconcile_v2',
    source: 'reconcile',
    actor: 'codex-b3-reconciler-v2',
    payload: buildSummaryEventPayload(plan, startedAt, finishedAt),
  }]);
}

async function loadF200RepairLiveStates(results) {
  const ids = results.map(row => clean(row.id));
  if (ids.some(id => !/^[A-Za-z0-9_-]+$/.test(id))) {
    throw new Error('F200 repair contains an unsafe deliverable id');
  }
  const rows = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    rows.push(...await supabaseRows(
      'deliverables',
      'id,client_slug,team,updated_at,linear_issue_uuid,linear_raw',
      `id=in.(${chunk.map(encodeURIComponent).join(',')})`,
    ));
  }
  const currentById = new Map(rows.map(row => [clean(row.id), row]).filter(([id]) => id));
  if (currentById.size !== ids.length) {
    throw new Error('F200 repair preflight did not read the exact deliverable cohort');
  }
  const issueIds = results.map(row => clean(
    row.repair_payload && row.repair_payload.precondition
      && row.repair_payload.precondition.linear_issue_uuid,
  ));
  const linearIssues = await loadLinearIssuesById(issueIds);
  if (linearIssues.size !== new Set(issueIds).size) {
    throw new Error('F200 repair preflight did not read the exact Linear issue cohort');
  }

  return new Map(results.map(row => {
    const payload = row.repair_payload;
    const current = currentById.get(clean(row.id));
    const issueIdValue = clean(payload.precondition.linear_issue_uuid);
    const liveIssue = linearIssues.get(issueIdValue);
    return [clean(row.id), {
      current,
      liveIssue,
      repairState: f200RepairRowState(current, liveIssue, payload),
    }];
  }));
}

async function preflightF200Repair(plan) {
  const authority = validateAuthority(await loadRuntimeFlag('prod_authority'));
  const clients = await supabaseRows('clients', 'slug,kind,active,linear_project_ids');
  const projectIndex = buildProjectIndex(clients);
  if (projectIndex.mapping_revision !== clean(
    plan.summary && plan.summary.f200_attribution_repair
      && plan.summary.f200_attribution_repair.mapping_revision,
  )) {
    throw new Error('F200 repair mapping revision changed after plan validation');
  }
  const liveStates = await loadF200RepairLiveStates(plan.results);
  for (const { current } of liveStates.values()) {
    if (authorityForTeam(authority, current.team) !== 'linear') {
      throw new Error(`F200 repair authority changed for deliverable ${clean(current.id)}`);
    }
  }
  return liveStates;
}

function buildF200CasPatchRequest(current, repairState, options = {}) {
  if (!current || !repairState || repairState.state !== 'pending'
      || clean(current.id) !== clean(repairState.id)
      || clean(current.client_slug) !== 'unattributed'
      || !clean(current.updated_at)) {
    throw new Error('F200 CAS patch requires an exact pending unattributed row');
  }
  exactObjectKeys(repairState.patch, ['client_slug', 'linear_raw'], 'F200 CAS patch body');
  const baseUrl = String(options.baseUrl || SUPA_URL).replace(/\/$/, '');
  const key = String(options.key == null ? SUPA_KEY : options.key);
  const filters = [
    `id=eq.${encodeURIComponent(clean(current.id))}`,
    `updated_at=eq.${encodeURIComponent(clean(current.updated_at))}`,
    'client_slug=eq.unattributed',
    'select=id,client_slug,updated_at,linear_issue_uuid,linear_raw',
  ].join('&');
  return {
    url: `${baseUrl}/rest/v1/deliverables?${filters}`,
    init: {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(repairState.patch),
    },
  };
}

function requireSingleF200CasPatchRow(rows, expectedId) {
  if (!Array.isArray(rows) || rows.length !== 1
      || clean(rows[0] && rows[0].id) !== clean(expectedId)) {
    throw new Error(`F200 CAS patch matched ${Array.isArray(rows) ? rows.length : 0} rows; expected exactly 1`);
  }
  return rows[0];
}

async function executeF200CasPatch(current, repairState) {
  const request = buildF200CasPatchRequest(current, repairState);
  const response = await fetch(request.url, request.init);
  if (!response.ok) {
    throw new Error(`F200 CAS patch HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return requireSingleF200CasPatchRow(await response.json(), repairState.id);
}

async function applyHealing(plan) {
  const inboundRows = plan.results.filter(r => r.diffs.length && r.authority === 'linear');
  const outboundIntents = plan.results
    .filter(r => r.diffs.length && r.authority === 'syncview')
    .flatMap(row => (row.outbound_intents || []).map(intent => ({ row, intent })));
  if (!APPLY) return { attempted: 0, outbound_enqueued: 0, skipped: inboundRows.length + outboundIntents.length };
  const f200ExpectedCount = Number(plan.summary && plan.summary.f200_attribution_repair
    && plan.summary.f200_attribution_repair.expected_count);
  if (plan.f200Repair === true
      && (!Number.isSafeInteger(f200ExpectedCount) || f200ExpectedCount <= 0
        || inboundRows.length !== f200ExpectedCount || SAFETY_CAP !== f200ExpectedCount)) {
    throw new Error(`F200 repair apply requires exactly its manifest-bound validated row count and matching CAP (got rows=${inboundRows.length}, cap=${SAFETY_CAP}, expected=${f200ExpectedCount})`);
  }
  if (plan.f200Repair === true && outboundIntents.length) {
    throw new Error('F200 repair cannot contain outbound intents');
  }
  if (inboundRows.length + outboundIntents.length > SAFETY_CAP) {
    throw new Error('Refusing to apply ' + (inboundRows.length + outboundIntents.length)
      + ' correction(s); cap is ' + SAFETY_CAP);
  }
  let attempted = 0;
  let outboundEnqueued = 0;
  let alreadyApplied = 0;
  if (plan.f200Repair === true) {
    // Abort before the first mutation if any of the 72 rows, Linear issues,
    // roster mapping, or authority flag drifted after the private plan check.
    await preflightF200Repair(plan);
  }
  for (const r of inboundRows) {
    const patchKeys = Object.keys(r.patch || {}).filter(k => r.patch[k] !== undefined);
    if (!patchKeys.length) continue;
    if (plan.f200Repair === true) {
      const live = await loadF200RepairLiveStates([r]);
      const liveRow = live.get(clean(r.id));
      const repairState = liveRow.repairState;
      if (repairState.state === 'already_applied') {
        alreadyApplied++;
        continue;
      }
      const currentAuthority = validateAuthority(await loadRuntimeFlag('prod_authority'));
      if (authorityForTeam(currentAuthority, liveRow.current.team) !== 'linear') {
        throw new Error(`F200 repair authority changed for deliverable ${clean(r.id)}`);
      }
      // The id + updated_at + sentinel predicates are checked by PostgreSQL in
      // the same statement as the attribution-only mutation. A zero-row
      // representation is drift and aborts the run.
      await executeF200CasPatch(liveRow.current, repairState);
      const readback = await loadF200RepairLiveStates([r]);
      if (readback.get(clean(r.id)).repairState.state !== 'already_applied') {
        throw new Error(`F200 repair readback failed for deliverable ${clean(r.id)}`);
      }
    } else {
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
    }
    attempted++;
  }
  for (const item of outboundIntents) {
    const r = item.row;
    const intent = item.intent;
    const authorityGeneration = await f27WriteAuthorizationGeneration(r.team);
    if (Number(intent.requeue_outbox_id || 0) > 0) {
      const requeued = await supabaseRpc('track_b_f27_requeue', {
        p_id: Number(intent.requeue_outbox_id),
        p_authority_generation: authorityGeneration,
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
      p_payload: Object.assign({}, parseJson(intent.payload || {}), {
        _f27_authority_generation: authorityGeneration,
        _f27_legacy_parity: false,
      }),
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
  return {
    attempted,
    outbound_enqueued: outboundEnqueued,
    skipped: alreadyApplied,
  };
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
  const privateF200Plan = F200_REPAIR_PLAN_FILE
    ? JSON.parse(fs.readFileSync(path.resolve(F200_REPAIR_PLAN_FILE), 'utf8'))
    : null;
  const data = FIXTURES
    ? loadFixtureData(FIXTURES)
    : (privateF200Plan ? await loadLiveF200RepairData(privateF200Plan) : await loadLiveData());
  if (F200_REPAIR_PLAN_FILE && (TEAM_FILTER || IDENTIFIER_FILTER || CLIENT_FILTER || TEST_AUTHORITY_CLIENT)) {
    throw new Error('F200 repair plan owns an exact owner-approved scope and cannot be combined with other filters or overrides');
  }
  const privateExpectedCount = Number(privateF200Plan && privateF200Plan.expected_count);
  const plan = privateF200Plan
    ? buildF200RepairExecutionPlan(
      data,
      privateF200Plan,
      { expectedCount: privateExpectedCount },
    )
    : buildPlan(data);
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

module.exports = {
  isRetryableSupabaseRead,
  batchParentEntries,
  batchParentId,
  expectedParentIdForDeliverable,
  buildPlan,
  buildSummaryEventPayload,
  buildF200RepairExecutionPlan,
  buildF200CasPatchRequest,
  f200RepairRowState,
  mergedCurrentLinearIssue,
  requireSingleF200CasPatchRow,
  loadLiveData,
  summaryMarkdown,
};
