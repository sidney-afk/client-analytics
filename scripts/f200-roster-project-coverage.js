#!/usr/bin/env node
'use strict';

/*
 * Read-only audit: which active clients have work in a team whose Linear
 * project is not registered against them?
 *
 * The TEST client's missing Graphics project id was found because the nightly
 * drill reported `direct_project_unmapped` on every Graphics fixture. That
 * mechanism is not test-specific. `clients.linear_project_ids` is the ONLY
 * project-to-client authority (`scripts/f200-attribution.js`), so a real client
 * whose second team was added after onboarding has its work land unattributed —
 * silently, because nothing pages on an attribution state.
 *
 * PUBLIC-REPO SAFETY. This script prints COUNTS AND TEAM KEYS ONLY. No client
 * slug, name, id, or Linear project id ever reaches stdout, the step summary,
 * or an artifact. `assertAggregateOnly` re-checks the rendered report against
 * the identifiers actually read before anything is printed, so a future edit
 * that starts naming a client fails the run instead of leaking.
 *
 * WRITES NOTHING. There is no --apply. Fixing a gap is a deliberate edit to the
 * `clients` row, made by an owner who can see which client it is.
 */

const { configuredProjectIds, clean } = require('./f200-attribution');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

// The team keys the reader recognises, grouped by the team they mean. Matches
// TEAM_KEYS in f200-attribution.js; kept as groups here because "does this
// client have a graphics project" is the question, not "which alias was used".
const TEAM_ALIASES = Object.freeze({
  video: ['video', 'vid'],
  graphics: ['graphics', 'graphic', 'gra', 'thumbnail'],
});

function lower(value) {
  return clean(value).toLowerCase();
}

function isActive(value) {
  if (value === false) return false;
  if (value === true || value == null) return true;
  return !['false', '0', 'no', 'inactive', 'archived'].includes(lower(value));
}

async function supabaseRows(table, select, params = '') {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const rows = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`
      + `&limit=${limit}&offset=${offset}${params ? `&${params}` : ''}`;
    const response = await fetch(url, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Supabase read ${table} HTTP ${response.status}`);
    }
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < limit) return rows;
  }
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_error) { return null; }
}

// A client's registered project ids, split by which team key they sit under.
// An id under no recognised team key still counts as registered (the reader
// accepts bare shapes), so it is tracked separately rather than ignored.
function projectIdsByTeam(rawValue) {
  const all = new Set(configuredProjectIds(rawValue));
  const byTeam = { video: new Set(), graphics: new Set() };
  const parsed = parseJson(rawValue);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, entry] of Object.entries(parsed)) {
      for (const [team, aliases] of Object.entries(TEAM_ALIASES)) {
        if (!aliases.includes(lower(key))) continue;
        for (const id of configuredProjectIds({ [lower(key)]: entry })) byTeam[team].add(id);
      }
    }
  }
  const teamed = new Set([...byTeam.video, ...byTeam.graphics]);
  return { all, byTeam, unteamed: new Set([...all].filter(id => !teamed.has(id))) };
}

function issueProjectId(linearRaw) {
  const raw = parseJson(linearRaw);
  const issue = raw && typeof raw === 'object' && raw.issue && typeof raw.issue === 'object'
    ? raw.issue
    : raw;
  const project = issue && typeof issue === 'object' ? issue.project : null;
  return clean(project && typeof project === 'object' ? project.id : project);
}

function normalizeTeam(value) {
  const team = lower(value);
  for (const [name, aliases] of Object.entries(TEAM_ALIASES)) {
    if (name === team || aliases.includes(team)) return name;
  }
  if (team === 'vid') return 'video';
  if (team === 'gra') return 'graphics';
  return team || 'unknown';
}

function buildReport(clients, deliverables) {
  const active = clients.filter(row => isActive(row.active) && clean(row.slug));
  const bySlug = new Map();
  for (const row of active) {
    bySlug.set(clean(row.slug), {
      kind: lower(row.kind || 'client'),
      projects: projectIdsByTeam(row.linear_project_ids),
      workByTeam: { video: 0, graphics: 0 },
      unmappedProjectIdsByTeam: { video: new Set(), graphics: new Set() },
    });
  }

  let deliverablesWithoutKnownClient = 0;
  for (const row of deliverables) {
    const slug = clean(row.client_slug);
    const entry = bySlug.get(slug);
    if (!entry) { deliverablesWithoutKnownClient++; continue; }
    const team = normalizeTeam(row.team);
    if (!Object.prototype.hasOwnProperty.call(entry.workByTeam, team)) continue;
    entry.workByTeam[team]++;
    const projectId = issueProjectId(row.linear_raw);
    if (projectId && !entry.projects.all.has(projectId)) {
      entry.unmappedProjectIdsByTeam[team].add(projectId);
    }
  }

  const kinds = {};
  const teamRows = {};
  for (const team of Object.keys(TEAM_ALIASES)) {
    teamRows[team] = {
      clients_with_work: 0,
      clients_with_work_and_no_registered_project: 0,
      clients_with_work_whose_issues_name_an_unregistered_project: 0,
      unregistered_project_ids_seen: 0,
      deliverables_on_unregistered_projects: 0,
    };
  }

  const gapSlugs = new Set();
  for (const [slug, entry] of bySlug) {
    kinds[entry.kind] = (kinds[entry.kind] || 0) + 1;
    for (const team of Object.keys(TEAM_ALIASES)) {
      const work = entry.workByTeam[team];
      if (!work) continue;
      teamRows[team].clients_with_work++;
      if (entry.projects.byTeam[team].size === 0) {
        teamRows[team].clients_with_work_and_no_registered_project++;
        gapSlugs.add(slug);
      }
      const unmapped = entry.unmappedProjectIdsByTeam[team];
      if (unmapped.size) {
        teamRows[team].clients_with_work_whose_issues_name_an_unregistered_project++;
        teamRows[team].unregistered_project_ids_seen += unmapped.size;
        gapSlugs.add(slug);
      }
    }
  }

  for (const row of deliverables) {
    const entry = bySlug.get(clean(row.client_slug));
    if (!entry) continue;
    const team = normalizeTeam(row.team);
    if (!teamRows[team]) continue;
    const projectId = issueProjectId(row.linear_raw);
    if (projectId && !entry.projects.all.has(projectId)) {
      teamRows[team].deliverables_on_unregistered_projects++;
    }
  }

  return {
    schema: 'syncview_f200_roster_project_coverage_v1',
    read_only: true,
    active_clients: bySlug.size,
    active_clients_by_kind: kinds,
    active_clients_with_no_registered_projects: [...bySlug.values()]
      .filter(entry => entry.projects.all.size === 0).length,
    active_clients_with_ids_under_no_team_key: [...bySlug.values()]
      .filter(entry => entry.projects.unteamed.size > 0).length,
    deliverables_checked: deliverables.length,
    deliverables_whose_client_is_not_on_the_active_roster: deliverablesWithoutKnownClient,
    by_team: teamRows,
    clients_with_at_least_one_gap: gapSlugs.size,
    // Deliberately absent: every slug, name, id, and Linear project id.
  };
}

/*
 * The last line of defence. Everything read is checked against the rendered
 * report; if any identifier appears verbatim, nothing is printed.
 */
function assertAggregateOnly(rendered, clients, deliverables) {
  const secrets = new Set();
  for (const row of clients || []) {
    for (const key of ['slug', 'name', 'id', 'client_slug']) {
      const value = clean(row && row[key]);
      if (value.length >= 3) secrets.add(value);
    }
    for (const id of configuredProjectIds(row && row.linear_project_ids)) secrets.add(id);
  }
  for (const row of deliverables || []) {
    const value = clean(row && row.client_slug);
    if (value.length >= 3) secrets.add(value);
    const projectId = issueProjectId(row && row.linear_raw);
    if (projectId) secrets.add(projectId);
  }
  const haystack = rendered.toLowerCase();
  for (const secret of secrets) {
    if (haystack.includes(secret.toLowerCase())) {
      throw new Error('roster coverage report would have printed an identifier; refusing to emit');
    }
  }
}

async function main() {
  const clients = await supabaseRows('clients', 'slug,kind,active,linear_project_ids');
  const deliverables = await supabaseRows('deliverables', 'client_slug,team,linear_raw');
  const report = buildReport(clients, deliverables);
  const rendered = JSON.stringify(report, null, 2);
  assertAggregateOnly(rendered, clients, deliverables);
  console.log(rendered);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.message || String(error));
    process.exit(1);
  });
}

module.exports = { buildReport, projectIdsByTeam, normalizeTeam, assertAggregateOnly };
