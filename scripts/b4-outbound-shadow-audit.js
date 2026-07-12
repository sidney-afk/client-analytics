'use strict';

/*
 * Read-only full-roster B4 outbound audit. It reuses reconciler v2's live
 * loaders and outbound classifiers, but overrides authority only in memory.
 * It never calls a mutation, RPC, Edge Function, or runtime-flag write.
 * Detailed rows go to a required private path outside the repository.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  loadLiveData,
  buildPlan,
} = require('./linear-deliverables-reconcile');
const { clean, parseJson } = require('./linear-deliverables-reconcile-lib');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const LINEAR_KEY = String(process.env.LINEAR_API_KEY || process.env.LINEAR_API_TOKEN || '');
const PRIVATE_JSON = String(process.env.B4_SHADOW_PRIVATE_JSON || '');
const CONFIRMED = process.env.B4_CONFIRM_READ_ONLY_SHADOW === '1';

const OP_FIELD = Object.freeze({
  status: 'status',
  title: 'title',
  due: 'due_date',
  assignee: 'assignee_id',
  priority: 'priority',
  parent: 'parent',
  archive: 'archived_deleted',
  restore: 'archived_deleted',
  comment: 'comments',
  create: 'linear_issue',
});

function fail(message) {
  throw new Error(message);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function bump(map, key, amount = 1) {
  const name = clean(key) || 'unknown';
  map.set(name, Number(map.get(name) || 0) + amount);
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableJson(value))).digest('hex');
}

function classifyDiff(result, diff, sampleLinkedIds) {
  const reason = clean(diff && diff.reason) || 'unknown';
  const sampleClamped = reason === 'outbound_state_mismatch'
    && sampleLinkedIds.has(clean(result && result.id))
    && ['scheduled', 'posted'].includes(clean(diff && diff.actual).toLowerCase());
  return sampleClamped
    ? { disposition: 'expected_explainable', category: 'sample_clamped_state' }
    : { disposition: 'unexpected', category: reason };
}

function classifyRepair(repair) {
  const reason = clean(repair && repair.reason) || 'unknown';
  return reason === 'outbound_assignee_mapping_missing'
    ? { disposition: 'expected_explainable', category: 'unknown_assignee_repair' }
    : { disposition: 'unexpected', category: reason };
}

function sampleLinkedDeliverableIds(sampleReviews) {
  const ids = new Set();
  for (const row of sampleReviews || []) {
    for (const key of ['video_deliverable_id', 'graphic_deliverable_id']) {
      if (clean(row && row[key])) ids.add(clean(row[key]));
    }
  }
  return ids;
}

function teamBucket(byTeam, team) {
  const key = ['video', 'graphics'].includes(clean(team).toLowerCase())
    ? clean(team).toLowerCase()
    : 'unknown';
  if (!byTeam[key]) {
    byTeam[key] = {
      entities_checked: 0,
      deliverables_checked: 0,
      batches_checked: 0,
      divergence_count: 0,
      expected_explainable_divergences: 0,
      unexpected_divergences: 0,
      intended_write_count: 0,
      expected_explainable_intents: 0,
      unexpected_intents: 0,
      repair_count: 0,
      expected_explainable_repairs: 0,
      unexpected_repairs: 0,
      tolerated_historical: 0,
    };
  }
  return byTeam[key];
}

function summarizeShadow(plan, data, rosterSlugs, testClientsExcluded = 0) {
  const sampleIds = sampleLinkedDeliverableIds(data.sampleReviews);
  const byTeam = {};
  const reasons = new Map();
  const expectedReasons = new Map();
  const operations = new Map();
  const expectedOperations = new Map();
  const clientsWithDiffs = new Set();
  const clientsWithHistorical = new Set();
  const privateRows = [];

  let divergenceCount = 0;
  let expectedDivergences = 0;
  let unexpectedDivergences = 0;
  let intendedWriteCount = 0;
  let expectedIntents = 0;
  let unexpectedIntents = 0;
  let repairCount = 0;
  let expectedRepairs = 0;
  let unexpectedRepairs = 0;
  let toleratedHistorical = 0;
  const historicalOperations = new Map();

  for (const result of plan.results || []) {
    const bucket = teamBucket(byTeam, result.team);
    bucket.entities_checked++;
    if (result.entity === 'batch') bucket.batches_checked++;
    else bucket.deliverables_checked++;

    const diffClasses = (result.diffs || []).map(diff => ({
      diff,
      ...classifyDiff(result, diff, sampleIds),
    }));
    for (const item of diffClasses) {
      divergenceCount++;
      bucket.divergence_count++;
      if (item.disposition === 'expected_explainable') {
        expectedDivergences++;
        bucket.expected_explainable_divergences++;
        bump(expectedReasons, item.category);
      } else {
        unexpectedDivergences++;
        bucket.unexpected_divergences++;
        bump(reasons, item.category);
      }
    }

    const intentClasses = (result.outbound_intents || []).map(intent => {
      const field = OP_FIELD[clean(intent && intent.operation).toLowerCase()] || 'unknown';
      const matching = diffClasses.find(item => item.diff && item.diff.field === field);
      return {
        intent,
        disposition: matching ? matching.disposition : 'unexpected',
        category: matching ? matching.category : `intent_without_matching_diff:${field}`,
      };
    });
    for (const item of intentClasses) {
      const operation = clean(item.intent && item.intent.operation) || 'unknown';
      intendedWriteCount++;
      bucket.intended_write_count++;
      if (item.disposition === 'expected_explainable') {
        expectedIntents++;
        bucket.expected_explainable_intents++;
        bump(expectedOperations, operation);
      } else {
        unexpectedIntents++;
        bucket.unexpected_intents++;
        bump(operations, operation);
      }
    }

    const repairClasses = (result.repairs || []).map(repair => ({
      repair,
      ...classifyRepair(repair),
    }));
    for (const item of repairClasses) {
      repairCount++;
      bucket.repair_count++;
      if (item.disposition === 'expected_explainable') {
        expectedRepairs++;
        bucket.expected_explainable_repairs++;
      } else {
        unexpectedRepairs++;
        bucket.unexpected_repairs++;
      }
    }

    const historical = (result.tolerated || []).filter(item => clean(item && item.reason) === 'tolerated_historical');
    for (const item of historical) {
      toleratedHistorical++;
      bucket.tolerated_historical++;
      bump(historicalOperations, item.operation || item.field);
    }

    if (diffClasses.length || repairClasses.length) {
      clientsWithDiffs.add(clean(result.row && result.row.client_slug));
    }
    if (historical.length) {
      clientsWithHistorical.add(clean(result.row && result.row.client_slug));
    }
    if (diffClasses.length || repairClasses.length || historical.length) {
      privateRows.push({
        entity: result.entity,
        entity_id: result.id,
        identifier: result.identifier,
        client_slug: clean(result.row && result.row.client_slug),
        team: result.team,
        diffs: diffClasses,
        intents: intentClasses,
        repairs: repairClasses,
        tolerated_historical: historical,
      });
    }
  }

  return {
    public: {
      roster: {
        active_real_clients: rosterSlugs.size,
        test_clients_excluded: Number(testClientsExcluded || 0),
      },
      coverage: {
        entities_checked: Number(plan.summary && plan.summary.entities_checked || 0),
        deliverables_checked: Number(plan.summary && plan.summary.deliverables_checked || 0),
        batches_checked: Number(plan.summary && plan.summary.batches_checked || 0),
        clients_with_any_divergence: [...clientsWithDiffs].filter(Boolean).length,
        clients_with_tolerated_historical: [...clientsWithHistorical].filter(Boolean).length,
      },
      divergences: {
        total: divergenceCount,
        expected_explainable: expectedDivergences,
        unexpected: unexpectedDivergences,
        unexpected_by_reason: sortedObject(reasons),
        expected_explainable_by_reason: sortedObject(expectedReasons),
      },
      intended_writes: {
        total: intendedWriteCount,
        expected_explainable: expectedIntents,
        unexpected: unexpectedIntents,
        unexpected_by_operation: sortedObject(operations),
        expected_explainable_by_operation: sortedObject(expectedOperations),
      },
      repairs: {
        total: repairCount,
        expected_explainable: expectedRepairs,
        unexpected: unexpectedRepairs,
      },
      tolerated_historical: {
        total: toleratedHistorical,
        by_operation: sortedObject(historicalOperations),
      },
      by_team: byTeam,
    },
    private_rows: privateRows,
  };
}

async function restRows(table, select, params = '') {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1000&offset=${offset}${params ? `&${params}` : ''}`;
    const response = await fetch(url, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
    });
    if (!response.ok) fail(`Supabase ${table} read failed: HTTP ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (!Array.isArray(page) || page.length < 1000) break;
  }
  return rows;
}

function flagsMap(rows) {
  return Object.fromEntries((rows || []).map(row => [clean(row.key), parseJson(row.value)]));
}

async function safetySnapshot() {
  const [flags, clients, outbox, latestSummary] = await Promise.all([
    restRows('syncview_runtime_flags', 'key,value', 'key=in.(linear_outbound_enabled,prod_authority,linear_inbound_enabled,auth_enforcement,settings_ef_clients)'),
    restRows('clients', 'slug,kind,active', 'active=eq.true&order=slug.asc'),
    restRows('mirror_outbox', 'id,status,test_only'),
    restRows('deliverable_events', 'id,ts', 'action=eq.linear_outbound_summary&order=id.desc&limit=1'),
  ]);
  const mapped = flagsMap(flags);
  const activeSlugs = new Set(clients.map(row => clean(row.slug)).filter(Boolean));
  const flaggedSlugs = new Set((mapped.settings_ef_clients && mapped.settings_ef_clients.clients || []).map(clean).filter(Boolean));
  const realSlugs = new Set(clients
    .filter(row => row.active === true && clean(row.kind).toLowerCase() !== 'test')
    .map(row => clean(row.slug)).filter(Boolean));
  const pendingStatuses = new Set(['pending', 'failed', 'shadow_ok']);
  return {
    flags: mapped,
    flag_digest: digest({
      linear_outbound_enabled: mapped.linear_outbound_enabled,
      prod_authority: mapped.prod_authority,
      linear_inbound_enabled: mapped.linear_inbound_enabled,
      auth_enforcement: mapped.auth_enforcement,
    }),
    active_slugs: activeSlugs,
    flagged_slugs: flaggedSlugs,
    real_slugs: realSlugs,
    outbox: {
      total: outbox.length,
      high_water_id: Math.max(0, ...outbox.map(row => Number(row.id || 0))),
      pending: outbox.filter(row => pendingStatuses.has(clean(row.status))).length,
      written_real: outbox.filter(row => clean(row.status) === 'written' && row.test_only !== true).length,
    },
    latest_outbound_summary_id: Number(latestSummary[0] && latestSummary[0].id || 0),
  };
}

function assertSafe(snapshot) {
  const flags = snapshot.flags || {};
  if (clean(flags.linear_outbound_enabled && flags.linear_outbound_enabled.mode).toLowerCase() !== 'off') {
    fail('linear_outbound_enabled must be off');
  }
  if (clean(flags.prod_authority && flags.prod_authority.video).toLowerCase() !== 'linear'
      || clean(flags.prod_authority && flags.prod_authority.graphics).toLowerCase() !== 'linear') {
    fail('prod_authority must remain linear/linear');
  }
  if (!flags.linear_inbound_enabled || flags.linear_inbound_enabled.enabled !== true) {
    fail('linear_inbound_enabled must remain true');
  }
  if (clean(flags.auth_enforcement && flags.auth_enforcement.mode).toLowerCase() !== 'permissive') {
    fail('auth_enforcement must remain permissive');
  }
  if (snapshot.outbox.pending !== 0 || snapshot.outbox.written_real !== 0) {
    fail('outbox must begin with zero pending and zero real written rows');
  }
  if (snapshot.active_slugs.size !== snapshot.flagged_slugs.size
      || [...snapshot.active_slugs].some(slug => !snapshot.flagged_slugs.has(slug))) {
    fail('settings roster does not match active clients');
  }
}

function privatePath() {
  if (!PRIVATE_JSON) fail('B4_SHADOW_PRIVATE_JSON is required');
  const resolved = path.resolve(PRIVATE_JSON);
  const relative = path.relative(process.cwd(), resolved);
  if (!relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('private evidence path must be outside the repository');
  }
  return resolved;
}

async function main() {
  if (!CONFIRMED) fail('B4_CONFIRM_READ_ONLY_SHADOW=1 is required');
  if (!SUPA_KEY || !LINEAR_KEY) fail('Supabase service role and Linear read key are required');
  if (/^(1|true|yes)$/i.test(process.env.APPLY || '')) fail('APPLY must remain false');

  const before = await safetySnapshot();
  assertSafe(before);

  const data = await loadLiveData();
  const keep = before.real_slugs;
  data.deliverables = (data.deliverables || []).filter(row => keep.has(clean(row.client_slug)));
  data.allDeliverables = (data.allDeliverables || []).filter(row => keep.has(clean(row.client_slug)));
  data.batches = (data.batches || []).filter(row => keep.has(clean(row.client_slug)));
  data.allBatches = (data.allBatches || []).filter(row => keep.has(clean(row.client_slug)));
  data.calendarPosts = (data.calendarPosts || []).filter(row => keep.has(clean(row.client)));
  data.sampleReviews = (data.sampleReviews || []).filter(row => keep.has(clean(row.client)));

  // The only authority override is this process-local object consumed by the
  // pure classifier. No runtime flag is patched or written.
  data.prodAuthority = { video: 'syncview', graphics: 'syncview' };
  const plan = buildPlan(data);
  const summarized = summarizeShadow(
    plan,
    data,
    keep,
    before.active_slugs.size - before.real_slugs.size,
  );

  const after = await safetySnapshot();
  assertSafe(after);
  const unchanged = before.flag_digest === after.flag_digest
    && before.outbox.total === after.outbox.total
    && before.outbox.high_water_id === after.outbox.high_water_id
    && before.outbox.pending === after.outbox.pending
    && before.outbox.written_real === after.outbox.written_real;
  if (!unchanged) fail('read-only proof failed: flags or outbox changed during audit');

  const report = {
    run_id: `b4-shadow-${Date.now()}`,
    generated_at: new Date().toISOString(),
    method: 'in-memory authority override over reconciler v2 classifiers; Linear/Supabase reads only',
    ...summarized.public,
    zero_write_proof: {
      runtime_flag_digest_unchanged: before.flag_digest === after.flag_digest,
      outbox_total_before: before.outbox.total,
      outbox_total_after: after.outbox.total,
      outbox_high_water_before: before.outbox.high_water_id,
      outbox_high_water_after: after.outbox.high_water_id,
      pending_before: before.outbox.pending,
      pending_after: after.outbox.pending,
      real_written_before: before.outbox.written_real,
      real_written_after: after.outbox.written_real,
      latest_outbound_summary_before: before.latest_outbound_summary_id,
      latest_outbound_summary_after: after.latest_outbound_summary_id,
      linear_mutation_calls: 0,
    },
  };
  const detail = {
    ...report,
    active_real_client_slugs: [...keep].sort(),
    rows: summarized.private_rows,
  };
  const output = privatePath();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(detail, null, 2));
  report.private_artifact_sha256 = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  classifyDiff,
  classifyRepair,
  sampleLinkedDeliverableIds,
  summarizeShadow,
};
