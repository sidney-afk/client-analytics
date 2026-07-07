'use strict';
/*
 * Track B B3 Stage 3: one-time card linkage backfill.
 *
 * Default mode is DRY-RUN. It fills only the additive B1 linkage slots on
 * calendar_posts/sample_reviews when an existing Linear link resolves to an
 * existing deliverable. It never changes Linear links, deliverables, flags,
 * webhooks, or n8n.
 *
 *   node scripts/b3-linkage-backfill.js
 *   APPLY=true CAP=600 node scripts/b3-linkage-backfill.js
 *   node scripts/b3-linkage-backfill.js --fixtures test/fixtures/b3-linkage-backfill.json
 */
const fs = require('fs');
const path = require('path');
const { clean, parseJson, deliverableArchivedOrDeleted } = require('./linear-deliverables-reconcile-lib');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));

const APPLY = process.argv.includes('--apply') || /^(1|true|yes)$/i.test(process.env.APPLY || '');
const SAFETY_CAP = Number(process.env.CAP || args.get('cap') || 600);
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const FIXTURES = args.get('fixtures') || '';
const DETAILS_JSON = args.get('details-json') || '';

const TABLES = {
  calendar: {
    table: 'calendar_posts',
    slots: [
      { component: 'video', kind: 'video', linkColumn: 'linear_issue_id', deliverableColumn: 'video_deliverable_id' },
      { component: 'graphic', kind: 'thumbnail', linkColumn: 'graphic_linear_issue_id', deliverableColumn: 'graphic_deliverable_id' },
    ],
  },
  samples: {
    table: 'sample_reviews',
    slots: [
      { component: 'video', kind: 'video', linkColumn: 'linear_issue_id', deliverableColumn: 'video_deliverable_id' },
      { component: 'graphic', kind: 'thumbnail', linkColumn: 'graphic_linear_issue_id', deliverableColumn: 'graphic_deliverable_id' },
    ],
  },
};

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function lower(v) {
  return clean(v).toLowerCase();
}

function activeCard(row) {
  return lower(row && row.status) !== 'archived';
}

function normalizeUrl(v) {
  const s = clean(v);
  if (!s) return '';
  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    u.pathname = u.pathname.replace(/\/+$/, '');
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}`;
  } catch (_e) {
    return s.replace(/\/+$/, '').toLowerCase();
  }
}

function extractIdentifier(v) {
  const m = clean(v).match(/\b([A-Z]{2,5}-\d+)\b/i);
  return m ? m[1].toUpperCase() : '';
}

function extractUuid(v) {
  const m = clean(v).match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  return m ? m[0].toLowerCase() : '';
}

function flattenStrings(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string' || typeof value === 'number') {
    const s = clean(value);
    if (s) out.push(s);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) flattenStrings(item, out);
  }
  return out;
}

function deliverableKeyStrings(d) {
  const raw = parseJson(d.linear_raw);
  return [
    d.id,
    d.linear_issue_uuid,
    d.linear_identifier,
    d.linear_issue_url,
    ...flattenStrings(d.linear_aliases),
    ...flattenStrings(raw && raw.issue ? {
      id: raw.issue.id,
      identifier: raw.issue.identifier,
      url: raw.issue.url,
    } : null),
  ].map(clean).filter(Boolean);
}

function addMap(map, key, row) {
  const k = clean(key);
  if (!k) return;
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(row);
}

function buildDeliverableLookup(deliverables) {
  const lookup = {
    byCardSlot: new Map(),
    byUrl: new Map(),
    byIdentifier: new Map(),
    byUuid: new Map(),
    byAny: new Map(),
  };
  for (const d of deliverables || []) {
    if (!d || deliverableArchivedOrDeleted(d)) continue;
    const cardKey = [
      lower(d.client_slug),
      lower(d.origin),
      clean(d.card_id),
      lower(d.kind),
    ].join('|');
    if (clean(d.card_id)) addMap(lookup.byCardSlot, cardKey, d);
    for (const key of deliverableKeyStrings(d)) {
      addMap(lookup.byAny, lower(key), d);
      const ident = extractIdentifier(key);
      if (ident) addMap(lookup.byIdentifier, ident, d);
      const uuid = extractUuid(key);
      if (uuid) addMap(lookup.byUuid, uuid, d);
      const url = normalizeUrl(key);
      if (url && /^https?:\/\//i.test(url)) addMap(lookup.byUrl, url, d);
    }
  }
  return lookup;
}

function buildArchiveLookup(linearArchive) {
  const lookup = {
    byIdentifier: new Map(),
    byUuid: new Map(),
  };
  for (const row of linearArchive || []) {
    addMap(lookup.byIdentifier, extractIdentifier(row.identifier), row);
    addMap(lookup.byUuid, lower(row.linear_uuid), row);
  }
  return lookup;
}

function uniqueRows(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const id = clean(row && (row.id || row.linear_uuid || row.identifier));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function linkMatchesDeliverable(row, link) {
  const n = normalizeUrl(link);
  const ident = extractIdentifier(link);
  const uuid = extractUuid(link);
  return deliverableKeyStrings(row).some(key => {
    return lower(key) === lower(link)
      || (n && normalizeUrl(key) === n)
      || (ident && extractIdentifier(key) === ident)
      || (uuid && extractUuid(key) === uuid);
  });
}

function twinKey(source, client, link) {
  return [source, lower(client), normalizeUrl(link) || lower(link)].join('|');
}

function buildTwinCounts(calendarPosts, sampleReviews) {
  const counts = new Map();
  const addRows = (source, rows) => {
    for (const row of rows || []) {
      if (!activeCard(row)) continue;
      for (const slot of TABLES[source].slots) {
        const link = clean(row[slot.linkColumn]);
        if (!link) continue;
        const key = twinKey(source, row.client || row.client_slug, link);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  };
  addRows('calendar', calendarPosts);
  addRows('samples', sampleReviews);
  return counts;
}

function candidateRows(lookup, source, slot, row, link) {
  const client = lower(row.client || row.client_slug);
  const directKey = [client, source, clean(row.id || row.sample_id), lower(slot.kind)].join('|');
  const direct = (lookup.byCardSlot.get(directKey) || []).filter(d => linkMatchesDeliverable(d, link));
  const linkCandidates = [
    ...(lookup.byUrl.get(normalizeUrl(link)) || []),
    ...(lookup.byIdentifier.get(extractIdentifier(link)) || []),
    ...(lookup.byUuid.get(extractUuid(link)) || []),
    ...(lookup.byAny.get(lower(link)) || []),
  ];
  const candidates = uniqueRows([...direct, ...linkCandidates])
    .filter(d => lower(d.client_slug) === client)
    .filter(d => lower(d.kind) === lower(slot.kind));
  const sameOrigin = candidates.filter(d => lower(d.origin) === source);
  if (sameOrigin.length) return sameOrigin;
  const originless = candidates.filter(d => lower(d.origin) === 'manual' || !lower(d.origin));
  if (originless.length) return originless;
  return candidates;
}

function archiveMatches(lookup, link) {
  return uniqueRows([
    ...(lookup.byIdentifier.get(extractIdentifier(link)) || []),
    ...(lookup.byUuid.get(extractUuid(link)) || []),
  ]);
}

function planLinkageBackfill(input) {
  const calendarPosts = input.calendarPosts || [];
  const sampleReviews = input.sampleReviews || [];
  const deliverables = input.deliverables || [];
  const lookup = buildDeliverableLookup(deliverables);
  const archiveLookup = buildArchiveLookup(input.linearArchive || []);
  const twins = buildTwinCounts(calendarPosts, sampleReviews);
  const planned = [];
  const skipped = [];

  const visit = (source, rows) => {
    for (const row of rows || []) {
      if (!activeCard(row)) continue;
      for (const slot of TABLES[source].slots) {
        const link = clean(row[slot.linkColumn]);
        const existing = clean(row[slot.deliverableColumn]);
        if (!link || existing) continue;
        const dupCount = twins.get(twinKey(source, row.client || row.client_slug, link)) || 0;
        if (dupCount > 1) {
          skipped.push({
            reason: 'duplicate_live_link',
            source,
            component: slot.component,
            client_slug: clean(row.client || row.client_slug),
            card_id: clean(row.id || row.sample_id),
            link_identifier: extractIdentifier(link),
          });
          continue;
        }
        const candidates = candidateRows(lookup, source, slot, row, link);
        if (candidates.length !== 1) {
          const archived = archiveMatches(archiveLookup, link);
          skipped.push({
            reason: candidates.length ? 'ambiguous_deliverable' : (archived.length ? 'archive_only' : 'unresolved_deliverable'),
            source,
            component: slot.component,
            client_slug: clean(row.client || row.client_slug),
            card_id: clean(row.id || row.sample_id),
            link_identifier: extractIdentifier(link),
            candidate_count: candidates.length,
          });
          continue;
        }
        planned.push({
          source,
          table: TABLES[source].table,
          component: slot.component,
          client_slug: clean(row.client || row.client_slug),
          card_id: clean(row.id || row.sample_id),
          link_column: slot.linkColumn,
          deliverable_column: slot.deliverableColumn,
          deliverable_id: clean(candidates[0].id),
          deliverable_origin: clean(candidates[0].origin),
        });
      }
    }
  };
  visit('calendar', calendarPosts);
  visit('samples', sampleReviews);
  return { planned, skipped };
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = keyFn(row) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function summarizePlan(plan) {
  return {
    planned_writes: plan.planned.length,
    skipped: plan.skipped.length,
    by_source_component: countBy(plan.planned, r => `${r.source}:${r.component}`),
    skipped_by_reason: countBy(plan.skipped, r => r.reason),
    skipped_by_source_component: countBy(plan.skipped, r => `${r.source}:${r.component}`),
  };
}

async function supabaseRows(table, select, params = '') {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required unless --fixtures is supplied');
  const rows = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${limit}&offset=${offset}${params ? `&${params}` : ''}`;
    const resp = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`Supabase ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
    const batch = await resp.json();
    rows.push(...batch);
    if (!Array.isArray(batch) || batch.length < limit) break;
    offset += limit;
  }
  return rows;
}

async function supabasePatch(table, client, id, body) {
  const url = `${SUPA_URL}/rest/v1/${table}?client=eq.${encodeURIComponent(client)}&id=eq.${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Supabase patch ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
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

async function loadLiveData() {
  const [deliverables, calendarPosts, sampleReviews, linearArchive] = await Promise.all([
    supabaseRows('deliverables', 'id,client_slug,origin,card_id,kind,status,linear_issue_uuid,linear_identifier,linear_issue_url,linear_aliases,linear_raw'),
    supabaseRows('calendar_posts', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('sample_reviews', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('linear_archive', 'linear_uuid,identifier,state'),
  ]);
  return { deliverables, calendarPosts, sampleReviews, linearArchive };
}

function loadFixtureData(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

async function applyPlan(plan) {
  if (!APPLY) return { attempted: 0, skipped: plan.planned.length };
  if (plan.planned.length > SAFETY_CAP) {
    throw new Error(`Refusing to apply ${plan.planned.length} linkage write(s); cap is ${SAFETY_CAP}`);
  }
  let attempted = 0;
  for (const item of plan.planned) {
    await supabasePatch(item.table, item.client_slug, item.card_id, { [item.deliverable_column]: item.deliverable_id });
    attempted++;
  }
  await supabaseInsert('deliverable_events', [{
    client_slug: '_system',
    action: 'b3_card_linkage_backfill',
    source: 'reconcile',
    actor: 'codex-b3-stage3',
    payload: {
      dry_run: false,
      applied: attempted,
      summary: summarizePlan(plan),
    },
  }]);
  return { attempted, skipped: 0 };
}

function writeDetails(file, plan, summary, applyResult) {
  if (!file) return;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(path.resolve(file), JSON.stringify({ summary, apply: applyResult, plan }, null, 2));
}

async function main() {
  const data = FIXTURES ? loadFixtureData(FIXTURES) : await loadLiveData();
  const plan = planLinkageBackfill(data);
  const summary = summarizePlan(plan);
  const apply = await applyPlan(plan);
  writeDetails(DETAILS_JSON, plan, summary, apply);
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', summary, apply }, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error(err && err.stack || err && err.message || String(err));
    process.exit(1);
  });
}

module.exports = {
  TABLES,
  normalizeUrl,
  extractIdentifier,
  planLinkageBackfill,
  summarizePlan,
};
