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
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { clean, parseJson, deliverableArchivedOrDeleted } = require('./linear-deliverables-reconcile-lib');
const { authorityForTeam, loadAuthority } = require('./prod-authority-guard');

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
const PROMOTE_ARCHIVE = process.argv.includes('--promote-archive') || /^(1|true|yes)$/i.test(process.env.PROMOTE_ARCHIVE || '');
const EXPECTED_PROMOTIONS = Number(args.get('expected-promotions') || process.env.EXPECTED_PROMOTIONS || 0);

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
  return !['archived', 'canceled', 'cancelled', 'duplicate'].includes(lower(row && row.status));
}

function sha(input, len = 24) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, len);
}

function normalizeText(value) {
  return lower(value).replace(/\s+/g, ' ');
}

function statusSlug(value) {
  const n = normalizeText(value && value.name || value);
  if (!n) return 'in_progress';
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
  return 'in_progress';
}

function archiveIssue(row) {
  const raw = parseJson(row && row.raw);
  return raw && raw.issue && typeof raw.issue === 'object' ? raw.issue : (raw && typeof raw === 'object' ? raw : {});
}

function normalizedTeam(value) {
  const n = lower(value && value.key || value);
  if (n === 'vid' || n === 'video') return 'video';
  if (n === 'gra' || n === 'graphic' || n === 'graphics') return 'graphics';
  return '';
}

function archiveClosedForPromotion(row, issue) {
  const state = lower(issue && issue.state && (issue.state.type || issue.state.name) || row && row.state);
  return Boolean(issue && (issue.archivedAt || issue.canceledAt))
    || state.includes('cancel')
    || state === 'archived';
}

function exactLinearUrl(left, right) {
  return Boolean(clean(left) && clean(right) && clean(left) === clean(right));
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

function exactUrlCandidateRows(deliverables, slot, row, link) {
  const client = lower(row && (row.client || row.client_slug));
  const url = normalizeUrl(link);
  if (!client || !url || !/^https?:\/\//i.test(url)) return [];
  return (deliverables || []).filter(deliverable => {
    return deliverable
      && !deliverableArchivedOrDeleted(deliverable)
      && lower(deliverable.client_slug) === client
      && lower(deliverable.kind) === lower(slot.kind)
      && normalizeUrl(deliverable.linear_issue_url) === url;
  });
}

function strictActiveCalendarSweep(input) {
  const deliverables = input && input.deliverables || [];
  const failures = [];
  let checked = 0;
  let resolvedById = 0;
  let resolvedByUrl = 0;

  for (const card of input && input.calendarPosts || []) {
    if (!activeCard(card)) continue;
    for (const slot of TABLES.calendar.slots) {
      const link = clean(card[slot.linkColumn]);
      const deliverableId = clean(card[slot.deliverableColumn]);
      if (!link && !deliverableId) continue;
      checked++;
      const context = {
        source: 'calendar',
        component: slot.component,
        client_slug: clean(card.client || card.client_slug),
        card_id: clean(card.id),
        link_identifier: extractIdentifier(link),
      };

      if (deliverableId) {
        const idRows = deliverables.filter(row => clean(row && row.id) === deliverableId);
        if (!idRows.length) {
          failures.push({ ...context, reason: 'dangling_deliverable_id', candidate_count: 0 });
          continue;
        }
        const scoped = idRows.filter(row => {
          if (deliverableArchivedOrDeleted(row)) return false;
          if (lower(row.client_slug) !== lower(context.client_slug) || lower(row.kind) !== lower(slot.kind)) return false;
          return !link || normalizeUrl(row.linear_issue_url) === normalizeUrl(link);
        });
        if (!scoped.length) {
          failures.push({ ...context, reason: 'wrong_deliverable_id', candidate_count: idRows.length });
          continue;
        }
        if (scoped.length !== 1) {
          failures.push({ ...context, reason: 'ambiguous_deliverable_id', candidate_count: scoped.length });
          continue;
        }
        resolvedById++;
        continue;
      }

      const exact = exactUrlCandidateRows(deliverables, slot, card, link);
      if (!exact.length) {
        failures.push({ ...context, reason: 'unresolved_exact_url', candidate_count: 0 });
        continue;
      }
      if (exact.length !== 1) {
        failures.push({ ...context, reason: 'ambiguous_exact_url', candidate_count: exact.length });
        continue;
      }
      resolvedByUrl++;
    }
  }

  return {
    checked,
    resolved: resolvedById + resolvedByUrl,
    resolved_by_id: resolvedById,
    resolved_by_exact_url: resolvedByUrl,
    failures,
  };
}

function summarizeStrictSweep(sweep) {
  return {
    checked_slots: Number(sweep && sweep.checked || 0),
    resolved_slots: Number(sweep && sweep.resolved || 0),
    resolved_by_id: Number(sweep && sweep.resolved_by_id || 0),
    resolved_by_exact_url: Number(sweep && sweep.resolved_by_exact_url || 0),
    failures: (sweep && sweep.failures || []).length,
    failures_by_reason: countBy(sweep && sweep.failures || [], row => row.reason),
  };
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
        // Calendar's ratified resolver is strict: populated linkage ID wins;
        // otherwise only the canonical deliverable URL may resolve the slot.
        // Samples retain their existing broader transition-era resolver.
        const candidates = source === 'calendar'
          ? exactUrlCandidateRows(deliverables, slot, row, link)
          : candidateRows(lookup, source, slot, row, link);
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
          team: lower(candidates[0].team) || (slot.kind === 'thumbnail' ? 'graphics' : 'video'),
          client_slug: clean(row.client || row.client_slug),
          card_id: clean(row.id || row.sample_id),
          link_column: slot.linkColumn,
          link_url: link,
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

function memberLookups(members) {
  const byLinear = new Map();
  const byEmail = new Map();
  for (const member of members || []) {
    const linear = clean(member && member.linear_user_id);
    const email = lower(member && member.email);
    if (linear && !byLinear.has(linear)) byLinear.set(linear, member);
    if (email && !byEmail.has(email)) byEmail.set(email, member);
  }
  return { byLinear, byEmail };
}

function promotionBatch(issue, archive, clientSlug, team) {
  const parent = issue && issue.parent && typeof issue.parent === 'object' ? issue.parent : issue;
  const title = clean(parent && parent.title || issue && issue.title || archive && archive.parent_identifier || 'Recovered Linear batch');
  const description = clean(parent && parent.description || '');
  const groupKey = [lower(clientSlug), normalizeText(title), normalizeText(description)].join('|');
  const parentTeam = normalizedTeam(parent && parent.team) || team;
  const parentIds = {};
  parentIds[parentTeam] = {
    uuid: clean(parent && parent.id || archive && archive.parent_uuid),
    identifier: clean(parent && parent.identifier || archive && archive.parent_identifier),
    url: clean(parent && parent.url),
  };
  return {
    id: `b1_b_${sha(groupKey, 28)}`,
    client_slug: clientSlug,
    team,
    name: title,
    description: description || null,
    status: 'active',
    created_by: 'b3-linkage-backfill',
    created_at: clean(parent && parent.createdAt || issue && issue.createdAt || archive && archive.created_at) || new Date(0).toISOString(),
    linear_parent_ids: parentIds,
  };
}

function promotionDeliverable(issue, archive, card, slot, batch, memberMaps) {
  const assignee = issue && issue.assignee || {};
  const member = memberMaps.byLinear.get(clean(assignee.id)) || memberMaps.byEmail.get(lower(assignee.email)) || null;
  const linearUuid = clean(issue && issue.id || archive && archive.linear_uuid);
  const identifier = clean(issue && issue.identifier || archive && archive.identifier);
  const url = clean(issue && issue.url);
  return {
    id: `b1_d_${linearUuid.replace(/[^a-zA-Z0-9]/g, '')}`,
    identifier,
    batch_id: batch.id,
    client_slug: clean(card.client || card.client_slug),
    team: slot.kind === 'thumbnail' ? 'graphics' : 'video',
    kind: slot.kind,
    title: clean(issue && issue.title || archive && archive.title || identifier || 'Recovered Linear deliverable'),
    brief: clean(issue && issue.description || '') || null,
    status: statusSlug(issue && issue.state || archive && archive.state),
    status_at: clean(issue && issue.updatedAt || issue && issue.createdAt || archive && archive.created_at) || null,
    assignee_id: member && member.id || null,
    due_date: clean(issue && issue.dueDate || archive && archive.due_date) || null,
    priority: issue && issue.priority != null ? Number(issue.priority) : (archive && archive.priority != null ? Number(archive.priority) : null),
    file_url: null,
    comments: null,
    origin: 'calendar',
    card_id: clean(card.id),
    sync_state: 'clean',
    created_by: 'b3-linkage-backfill',
    created_at: clean(issue && issue.createdAt || archive && archive.created_at) || new Date(0).toISOString(),
    linear_issue_uuid: linearUuid,
    linear_identifier: identifier,
    linear_issue_url: url,
    linear_aliases: { identifier, url },
    linear_raw: {
      issue,
      archive_promotion: {
        source: 'linear_archive',
        archive_linear_uuid: clean(archive && archive.linear_uuid),
        selected_card_link: clean(card[slot.linkColumn]),
      },
    },
  };
}

function sameBatchIdentity(existing, planned) {
  return existing
    && clean(existing.id) === clean(planned.id)
    && lower(existing.client_slug) === lower(planned.client_slug)
    && normalizeText(existing.name) === normalizeText(planned.name);
}

function mergeParentReference(existing, incoming) {
  const left = parseJson(existing);
  const right = parseJson(incoming);
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const before = clean(merged[key]);
    const after = clean(value);
    if (before && after && before !== after) return null;
    if (!before && after) merged[key] = value;
  }
  return merged;
}

function mergePromotionBatch(existing, incoming) {
  if (!sameBatchIdentity(existing, incoming)) return null;
  const leftParents = parseJson(existing.linear_parent_ids);
  const rightParents = parseJson(incoming.linear_parent_ids);
  const parents = { ...leftParents };
  for (const [teamKey, reference] of Object.entries(rightParents)) {
    if (!(teamKey in parents)) {
      parents[teamKey] = reference;
      continue;
    }
    const mergedReference = mergeParentReference(parents[teamKey], reference);
    if (!mergedReference) return null;
    parents[teamKey] = mergedReference;
  }

  // B1 groups by client + parent title + parent description, not team. One
  // derived batch can therefore own a VID parent and a GRA parent. Its scalar
  // team must be null in that mixed case; team-specific routing comes from the
  // retained linear_parent_ids entries.
  const teams = new Set([
    normalizedTeam(existing.team),
    normalizedTeam(incoming.team),
    ...Object.keys(parents).map(normalizedTeam),
  ].filter(Boolean));
  return {
    ...existing,
    team: teams.size === 1 ? Array.from(teams)[0] : null,
    linear_parent_ids: parents,
  };
}

function canonicalParentIds(value) {
  const parents = parseJson(value);
  const canonical = {};
  for (const team of Object.keys(parents).sort()) {
    const reference = parseJson(parents[team]);
    canonical[team] = {};
    for (const key of Object.keys(reference).sort()) canonical[team][key] = reference[key];
  }
  return JSON.stringify(canonical);
}

function sameBatchRouting(existing, planned) {
  return normalizedTeam(existing && existing.team) === normalizedTeam(planned && planned.team)
    && canonicalParentIds(existing && existing.linear_parent_ids) === canonicalParentIds(planned && planned.linear_parent_ids);
}

function planArchivePromotions(input) {
  const deliverables = input.deliverables || [];
  const lookup = buildDeliverableLookup(deliverables);
  const archiveLookup = buildArchiveLookup(input.linearArchive || []);
  const twins = buildTwinCounts(input.calendarPosts || [], []);
  const existingBatchById = new Map((input.batches || []).map(row => [clean(row.id), row]));
  const existingDeliverableById = new Map(deliverables.map(row => [clean(row.id), row]));
  const memberMaps = memberLookups(input.members || []);
  const batchWrites = new Map();
  const deliverableWrites = [];
  const linkageWrites = [];
  const skipped = [];

  for (const card of input.calendarPosts || []) {
    if (!activeCard(card)) continue;
    for (const slot of TABLES.calendar.slots) {
      const link = clean(card[slot.linkColumn]);
      if (!link || clean(card[slot.deliverableColumn])) continue;
      const cardId = clean(card.id);
      const clientSlug = clean(card.client || card.client_slug);
      const context = { source: 'calendar', component: slot.component, client_slug: clientSlug, card_id: cardId, link_identifier: extractIdentifier(link) };
      const duplicateCount = twins.get(twinKey('calendar', clientSlug, link)) || 0;
      if (duplicateCount > 1) {
        skipped.push({ ...context, reason: 'duplicate_live_link' });
        continue;
      }
      if (exactUrlCandidateRows(deliverables, slot, card, link).length) {
        skipped.push({ ...context, reason: 'deliverable_already_resolvable' });
        continue;
      }
      const archives = archiveMatches(archiveLookup, link);
      if (archives.length !== 1) {
        skipped.push({ ...context, reason: archives.length ? 'ambiguous_archive' : 'no_archive_match' });
        continue;
      }
      const archive = archives[0];
      const issue = archiveIssue(archive);
      const issueUrl = clean(issue.url);
      if (!exactLinearUrl(link, issueUrl)) {
        skipped.push({ ...context, reason: 'archive_url_not_exact' });
        continue;
      }
      if (!clean(issue.id) || !clean(issue.identifier) || !issueUrl) {
        skipped.push({ ...context, reason: 'archive_raw_incomplete' });
        continue;
      }
      if (archiveClosedForPromotion(archive, issue)) {
        skipped.push({ ...context, reason: 'archive_canceled_or_archived' });
        continue;
      }
      const team = normalizedTeam(issue.team) || normalizedTeam(archive.team);
      const expectedTeam = slot.kind === 'thumbnail' ? 'graphics' : 'video';
      if (team !== expectedTeam) {
        skipped.push({ ...context, reason: 'team_mismatch', archive_team: team || 'unknown' });
        continue;
      }
      if (archive.client_slug && lower(archive.client_slug) !== lower(clientSlug)) {
        skipped.push({ ...context, reason: 'client_mismatch' });
        continue;
      }
      const batch = promotionBatch(issue, archive, clientSlug, team);
      const deliverable = promotionDeliverable(issue, archive, card, slot, batch, memberMaps);
      const existingBatch = existingBatchById.get(batch.id);
      if (existingBatch && !sameBatchIdentity(existingBatch, batch)) {
        skipped.push({ ...context, reason: 'batch_identity_conflict', batch_id: batch.id });
        continue;
      }
      const existingDeliverable = existingDeliverableById.get(deliverable.id);
      if (existingDeliverable) {
        skipped.push({ ...context, reason: 'deliverable_identity_conflict', deliverable_id: deliverable.id });
        continue;
      }
      const baseBatch = batchWrites.get(batch.id) || existingBatch;
      if (baseBatch) {
        const mergedBatch = mergePromotionBatch(baseBatch, batch);
        if (!mergedBatch) {
          skipped.push({ ...context, reason: 'batch_identity_conflict', batch_id: batch.id });
          continue;
        }
        // Existing deterministic B1 batches are safe to upsert only when this
        // promotion adds a parent route or neutralizes a stale single-team
        // lock. A fully merged batch produces no redundant batch_write event.
        if (!sameBatchRouting(baseBatch, mergedBatch)) batchWrites.set(batch.id, mergedBatch);
      } else batchWrites.set(batch.id, batch);
      deliverableWrites.push(deliverable);
      linkageWrites.push({
        source: 'calendar',
        table: TABLES.calendar.table,
        component: slot.component,
        team,
        client_slug: clientSlug,
        card_id: cardId,
        link_column: slot.linkColumn,
        link_url: link,
        deliverable_column: slot.deliverableColumn,
        deliverable_id: deliverable.id,
        deliverable_origin: 'calendar',
        promoted_from_archive: clean(archive.linear_uuid),
      });
    }
  }
  return { batches: Array.from(batchWrites.values()), deliverables: deliverableWrites, linkages: linkageWrites, skipped };
}

function projectedStrictInput(input, plan, promotions) {
  const calendarPosts = (input && input.calendarPosts || []).map(row => ({ ...row }));
  const byCard = new Map(calendarPosts.map(row => [
    `${lower(row.client || row.client_slug)}|${clean(row.id)}`,
    row,
  ]));
  const linkages = [
    ...(plan && plan.planned || []),
    ...(promotions && promotions.linkages || []),
  ];
  for (const linkage of linkages) {
    if (linkage.table !== TABLES.calendar.table) continue;
    const row = byCard.get(`${lower(linkage.client_slug)}|${clean(linkage.card_id)}`);
    if (row) row[linkage.deliverable_column] = linkage.deliverable_id;
  }
  return {
    calendarPosts,
    deliverables: [
      ...(input && input.deliverables || []),
      ...(promotions && promotions.deliverables || []),
    ],
  };
}

function strictSweepsForPlan(input, plan, promotions) {
  return {
    current: strictActiveCalendarSweep(input),
    projected: strictActiveCalendarSweep(projectedStrictInput(input, plan, promotions)),
  };
}

function archivePromotionBlockers(promotions) {
  const intentional = new Set([
    'duplicate_live_link',
    'deliverable_already_resolvable',
    'archive_canceled_or_archived',
  ]);
  return (promotions && promotions.skipped || []).filter(row => !intentional.has(row.reason));
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = keyFn(row) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function summarizePlan(plan, promotions = null) {
  const summary = {
    planned_writes: plan.planned.length,
    skipped: plan.skipped.length,
    by_source_component: countBy(plan.planned, r => `${r.source}:${r.component}`),
    skipped_by_reason: countBy(plan.skipped, r => r.reason),
    skipped_by_source_component: countBy(plan.skipped, r => `${r.source}:${r.component}`),
  };
  if (promotions) {
    summary.archive_promotion = {
      batch_writes: promotions.batches.length,
      deliverable_writes: promotions.deliverables.length,
      linkage_writes: promotions.linkages.length,
      skipped: promotions.skipped.length,
      skipped_by_reason: countBy(promotions.skipped, row => row.reason),
    };
  }
  return summary;
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

async function loadLiveData() {
  const [deliverables, calendarPosts, sampleReviews, linearArchive, batches, members] = await Promise.all([
    supabaseRows('deliverables', 'id,client_slug,team,origin,card_id,kind,status,linear_issue_uuid,linear_identifier,linear_issue_url,linear_aliases,linear_raw'),
    supabaseRows('calendar_posts', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('sample_reviews', 'id,client,status,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'),
    supabaseRows('linear_archive', 'linear_uuid,identifier,aliases,team,client_slug,parent_uuid,parent_identifier,title,state,assignee_name,assignee_email,due_date,priority,created_at,completed_at,archived_at,raw'),
    supabaseRows('batches', 'id,client_slug,team,name,description,status,created_by,created_at,linear_parent_ids'),
    supabaseRows('team_members', 'id,email,linear_user_id'),
  ]);
  return { deliverables, calendarPosts, sampleReviews, linearArchive, batches, members };
}

function loadFixtureData(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

async function assertLinearAuthority(writes) {
  const teams = Array.from(new Set((writes || []).map(row => normalizedTeam(row.team)).filter(Boolean)));
  const state = await loadAuthority({
    key: SUPA_KEY,
    supabaseUrl: SUPA_URL,
    cachePath: path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'b3-linkage-authority.json'),
  });
  if (state.write_safe !== true || state.source !== 'live') {
    throw new Error('Refusing writes without a fresh live prod_authority read');
  }
  for (const team of teams) {
    if (authorityForTeam(state.authority, team) !== 'linear') {
      throw new Error(`Refusing ${team} archive/linkage writes while that team is not Linear-authoritative`);
    }
  }
  return { source: state.source, teams };
}

async function verifyAppliedWrites(writes) {
  const live = await loadLiveData();
  const deliverableById = new Map(live.deliverables.map(row => [clean(row.id), row]));
  const rowsByTable = {
    calendar_posts: new Map(live.calendarPosts.map(row => [`${lower(row.client)}|${clean(row.id)}`, row])),
    sample_reviews: new Map(live.sampleReviews.map(row => [`${lower(row.client)}|${clean(row.id || row.sample_id)}`, row])),
  };
  const failures = [];
  for (const write of writes) {
    const row = rowsByTable[write.table] && rowsByTable[write.table].get(`${lower(write.client_slug)}|${clean(write.card_id)}`);
    const deliverable = deliverableById.get(clean(write.deliverable_id));
    if (!row || clean(row[write.deliverable_column]) !== clean(write.deliverable_id)) {
      failures.push({ card_id: write.card_id, component: write.component, reason: 'linkage_not_committed' });
      continue;
    }
    const resolves = deliverable && (write.table === TABLES.calendar.table
      ? exactLinearUrl(normalizeUrl(write.link_url), normalizeUrl(deliverable.linear_issue_url))
      : linkMatchesDeliverable(deliverable, write.link_url));
    if (!resolves) {
      failures.push({ card_id: write.card_id, component: write.component, reason: 'deliverable_url_not_exact' });
    }
  }
  let archiveFailures = [];
  if (PROMOTE_ARCHIVE) {
    const residue = planArchivePromotions(live);
    archiveFailures = archivePromotionBlockers(residue);
  }
  const strictSweep = strictActiveCalendarSweep(live);
  if (failures.length || archiveFailures.length || strictSweep.failures.length) {
    throw new Error(`Post-sweep failed: ${failures.length} targeted mismatch(es), ${archiveFailures.length} archive blocker(s), ${strictSweep.failures.length} strict active-card failure(s)`);
  }
  return {
    checked: writes.length,
    failures,
    remaining_archive_failures: archiveFailures.length,
    strict_active_calendar: summarizeStrictSweep(strictSweep),
  };
}

async function applyPlan(plan, promotions, input, strictSweeps) {
  const promotionWrites = promotions ? promotions.linkages : [];
  const existingLinkWrites = plan.planned.filter(item => !promotionWrites.some(p => p.table === item.table && p.client_slug === item.client_slug && p.card_id === item.card_id && p.deliverable_column === item.deliverable_column));
  const allLinkWrites = [...existingLinkWrites, ...promotionWrites];
  const totalMutations = allLinkWrites.length
    + (promotions ? promotions.batches.length + promotions.deliverables.length : 0);
  const sweeps = strictSweeps || strictSweepsForPlan(input || {}, plan, promotions);
  if (!APPLY) {
    return {
      attempted: 0,
      skipped: totalMutations,
      verified: { checked: 0, failures: [], strict_projected_active_calendar: summarizeStrictSweep(sweeps.projected) },
    };
  }
  if (PROMOTE_ARCHIVE) {
    if (!Number.isInteger(EXPECTED_PROMOTIONS) || EXPECTED_PROMOTIONS <= 0) {
      throw new Error('Archive promotion APPLY requires --expected-promotions=N from a reviewed dry-run');
    }
    if (promotions.deliverables.length !== EXPECTED_PROMOTIONS) {
      throw new Error(`Archive promotion drift: expected ${EXPECTED_PROMOTIONS}, planned ${promotions.deliverables.length}`);
    }
    const blockers = archivePromotionBlockers(promotions);
    if (blockers.length) {
      throw new Error(`Archive promotion pre-sweep has ${blockers.length} unresolved active calendar slot(s); refusing partial apply`);
    }
  }
  if (totalMutations > SAFETY_CAP) {
    throw new Error(`Refusing to apply ${totalMutations} mutation(s); cap is ${SAFETY_CAP}`);
  }
  if (sweeps.projected.failures.length) {
    throw new Error(`Strict active-card precondition failed: ${sweeps.projected.failures.length} unresolved or ambiguous slot(s) remain after the projected plan`);
  }
  const authority = await assertLinearAuthority([
    ...allLinkWrites,
    ...(promotions ? promotions.deliverables : []),
  ]);
  let attempted = 0;
  if (promotions) {
    for (const batch of promotions.batches) {
      await supabaseRpc('batch_write', {
        p_row: batch,
        p_event: { source: 'backfill', action: 'b3_archive_promotion_batch', actor: 'codex-b3-stage3' },
      });
      attempted++;
    }
    for (const deliverable of promotions.deliverables) {
      await supabaseRpc('deliverable_write', {
        p_row: deliverable,
        p_event: { source: 'backfill', action: 'b3_archive_promotion_deliverable', actor: 'codex-b3-stage3' },
      });
      attempted++;
    }
  }
  for (const item of allLinkWrites) {
    await supabasePatch(item.table, item.client_slug, item.card_id, { [item.deliverable_column]: item.deliverable_id });
    attempted++;
  }
  const verified = await verifyAppliedWrites(allLinkWrites);
  await supabaseInsert('deliverable_events', [{
    client_slug: '_system',
    action: 'b3_card_linkage_backfill',
    source: 'reconcile',
    actor: 'codex-b3-stage3',
    payload: {
      dry_run: false,
      applied: attempted,
      authority,
      verified,
      summary: summarizePlan(plan, promotions),
    },
  }]);
  return { attempted, skipped: 0, authority, verified };
}

function writeDetails(file, plan, promotions, strictSweeps, summary, applyResult) {
  if (!file) return;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(path.resolve(file), JSON.stringify({ summary, apply: applyResult, strict_sweeps: strictSweeps, plan, promotions }, null, 2));
}

async function main() {
  const data = FIXTURES ? loadFixtureData(FIXTURES) : await loadLiveData();
  const plan = planLinkageBackfill(data);
  const promotions = PROMOTE_ARCHIVE ? planArchivePromotions(data) : null;
  const strictSweeps = strictSweepsForPlan(data, plan, promotions);
  const summary = summarizePlan(plan, promotions);
  summary.strict_active_calendar = summarizeStrictSweep(strictSweeps.current);
  summary.strict_projected_active_calendar = summarizeStrictSweep(strictSweeps.projected);
  const apply = await applyPlan(plan, promotions, data, strictSweeps);
  writeDetails(DETAILS_JSON, plan, promotions, strictSweeps, summary, apply);
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', archive_promotion: PROMOTE_ARCHIVE, summary, apply }, null, 2));
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
  planArchivePromotions,
  strictActiveCalendarSweep,
  strictSweepsForPlan,
  summarizeStrictSweep,
  archivePromotionBlockers,
  summarizePlan,
  statusSlug,
};
