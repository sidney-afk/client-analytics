'use strict';

/*
 * Native intake project-mapping readiness inventory.
 *
 * This program is intentionally read-only. It reads active client rows and
 * Linear projects, separates persisted gateway-ready mappings from migration
 * candidates, and emits public-safe evidence. It never PATCHes Supabase or sends a
 * Linear mutation. A private, human-reviewable patch plan can be written only
 * outside this repository.
 *
 * Live dry-run:
 *   SUPABASE_SERVICE_ROLE_KEY=... LINEAR_READ_API_KEY=... \
 *     node scripts/production-write-project-mapping.js --public-json artifacts/project-mapping.json
 *
 * Optional stable pseudonyms in the public report:
 *   PROJECT_MAPPING_HASH_KEY=private-stable-key ...
 *
 * Optional private review plan (still no writes):
 *   ... --private-plan C:/private/syncview/project-mapping-plan.json
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SUPABASE_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const DEFAULT_TEAMS = Object.freeze(['video', 'graphics']);
const TEAM_ALIASES = Object.freeze({
  video: 'video', vid: 'video',
  graphics: 'graphics', graphic: 'graphics', gra: 'graphics', thumbnail: 'graphics',
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeName(value) {
  let text = clean(value).toLowerCase();
  try { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  return text.replace(/[^a-z0-9@.]+/g, '');
}

function normalizeTeam(value) {
  return TEAM_ALIASES[clean(value).toLowerCase()] || '';
}

function unique(values) {
  return Array.from(new Set((values || []).map(clean).filter(Boolean)));
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith('--')) throw new Error(`unexpected argument: ${value}`);
    const next = argv[i + 1];
    args.set(value, next && !next.startsWith('--') ? argv[++i] : '1');
  }
  if (args.has('--apply') || args.has('--write')) {
    throw new Error('write modes are not supported; this tool is dry-run only');
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function configuredProjectIds(value) {
  if (typeof value === 'string') {
    const text = clean(value);
    if (!text) return [];
    try { return configuredProjectIds(JSON.parse(text)); } catch (_) {
      // A single opaque Linear id is the normal legacy string shape. Commas
      // are accepted only for old offline fixtures.
      return unique(text.split(','));
    }
  }
  const found = new Set();
  function addLegacyEntry(current) {
    if (typeof current === 'string') {
      if (clean(current)) found.add(clean(current));
      return;
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return;
    for (const key of ['id', 'project_id', 'linear_project_id']) {
      const id = clean(current[key]);
      if (id) found.add(id);
    }
  }
  // Historical rows are either one opaque id, a top-level array of ids, or
  // array/object entries carrying a recognized id field. Do not recurse into
  // arbitrary metadata: project-looking note values are not mapping evidence.
  if (Array.isArray(value)) value.forEach(addLegacyEntry);
  else addLegacyEntry(value);
  return Array.from(found).sort();
}

function idFrom(value) {
  if (typeof value === 'string') return clean(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return clean(value.id || value.project_id || value.linear_project_id);
}

function recognizedIdsFrom(value) {
  if (typeof value === 'string') return clean(value) ? [clean(value)] : [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return unique(['id', 'project_id', 'linear_project_id']
    .map(key => clean(value[key]))
    .filter(Boolean));
}

// Tagged mappings are the only gateway-ready form. Untagged values and exact
// names are reported only as owner migration candidates.
function projectIdsForTeam(value, wantedTeam) {
  const wanted = normalizeTeam(wantedTeam);
  const found = new Set();
  const root = value && typeof value === 'object' ? value : null;
  if (!root) return [];
  function addExplicit(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const team = normalizeTeam(entry.team || entry.team_key || entry.key || entry.kind);
    if (team === wanted) recognizedIdsFrom(entry).forEach(id => found.add(id));
  }
  if (Array.isArray(root)) root.forEach(addExplicit);
  else {
    for (const [key, entry] of Object.entries(root)) {
      if (normalizeTeam(key) !== wanted) continue;
      recognizedIdsFrom(entry).forEach(id => found.add(id));
    }
    addExplicit(root);
    if (Array.isArray(root.projects)) root.projects.forEach(addExplicit);
  }
  return Array.from(found).sort();
}

function projectTeams(project) {
  const raw = project && project.teams;
  const rows = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.nodes) ? raw.nodes : [];
  return unique(rows.map(row => normalizeTeam(row && typeof row === 'object' ? row.key : row)));
}

function compactProject(project) {
  return {
    id: clean(project && project.id),
    name: clean(project && project.name),
    name_key: normalizeName(project && project.name),
    teams: projectTeams(project),
  };
}

function clientInScope(client, kinds) {
  const active = client && (client.active === true || clean(client.active).toLowerCase() === 'true');
  return active && kinds.has(clean(client.kind || 'client').toLowerCase());
}

function resolveTeam(client, team, projects, projectById) {
  const targetTeam = normalizeTeam(team);
  const taggedIds = projectIdsForTeam(client.linear_project_ids, targetTeam);
  if (taggedIds.length > 1) {
    return {
      team: targetTeam,
      status: 'ambiguous',
      reason: 'multiple_tagged_team_projects',
      candidate_count: taggedIds.length,
      project_ids: taggedIds,
    };
  }
  if (taggedIds.length === 1) {
    const tagged = projectById.get(taggedIds[0]);
    if (tagged && tagged.teams.includes(targetTeam)) {
      return { team: targetTeam, status: 'configured', candidate_count: 1, project_id: tagged.id, tagged: true };
    }
    return {
      team: targetTeam,
      status: 'missing',
      reason: 'tagged_project_does_not_resolve_for_team',
      candidate_count: 0,
      project_ids: taggedIds,
    };
  }
  const configuredIds = configuredProjectIds(client.linear_project_ids);
  const configured = configuredIds
    .map(id => projectById.get(id))
    .filter(project => project && project.teams.includes(targetTeam));

  if (configuredIds.length) {
    if (configured.length === 1) {
      return {
        team: targetTeam,
        status: 'configured',
        candidate_count: 1,
        project_id: configured[0].id,
        tagged: false,
      };
    }
    return {
      team: targetTeam,
      status: configured.length > 1 ? 'ambiguous' : 'missing',
      reason: configured.length > 1 ? 'multiple_configured_team_projects' : 'configured_ids_do_not_resolve_for_team',
      candidate_count: configured.length,
      project_ids: configured.map(project => project.id),
    };
  }

  const clientName = normalizeName(client.display_name);
  const exact = projects.filter(project => project.name_key === clientName && project.teams.includes(targetTeam));
  if (exact.length === 1) {
    return { team: targetTeam, status: 'exact_match', candidate_count: 1, project_id: exact[0].id };
  }
  return {
    team: targetTeam,
    status: exact.length > 1 ? 'ambiguous' : 'missing',
    reason: exact.length > 1 ? 'multiple_exact_name_team_projects' : 'no_exact_name_team_project',
    candidate_count: exact.length,
    project_ids: exact.map(project => project.id),
  };
}

function hmacRef(kind, value, key) {
  const secret = clean(key);
  if (!secret) return '';
  const digest = crypto.createHmac('sha256', secret)
    .update(`syncview-project-mapping-v1:${kind}:${clean(value)}`)
    .digest('hex')
    .slice(0, 20);
  return `${kind}_${digest}`;
}

function buildInventory(clientsInput, projectsInput, options = {}) {
  const teams = unique(options.teams || DEFAULT_TEAMS).map(normalizeTeam).filter(Boolean);
  const kinds = new Set((options.kinds || ['client']).map(value => clean(value).toLowerCase()).filter(Boolean));
  const projects = (projectsInput || []).map(compactProject).filter(project => project.id && project.name);
  const projectById = new Map(projects.map(project => [project.id, project]));
  const clients = (clientsInput || []).filter(client => clientInScope(client, kinds));
  const rows = clients.map(client => ({
    slug: clean(client.slug),
    display_name: clean(client.display_name),
    kind: clean(client.kind || 'client').toLowerCase(),
    current_linear_project_ids: client.linear_project_ids == null ? null : client.linear_project_ids,
    current_project_ids_flat: configuredProjectIds(client.linear_project_ids),
    teams: teams.map(team => resolveTeam(client, team, projects, projectById)),
  }));
  return { teams, kinds: Array.from(kinds).sort(), projects, rows };
}

function statusCounts(rows, teams) {
  const byTeam = {};
  for (const team of teams) {
    const counts = { tagged_ready: 0, untagged_candidate: 0, exact_candidate: 0, ambiguous: 0, missing: 0 };
    for (const row of rows) {
      const result = row.teams.find(item => item.team === team);
      if (!result) continue;
      if (result.status === 'configured' && result.tagged === true) counts.tagged_ready++;
      else if (result.status === 'configured') counts.untagged_candidate++;
      else if (result.status === 'exact_match') counts.exact_candidate++;
      else if (Object.prototype.hasOwnProperty.call(counts, result.status)) counts[result.status]++;
    }
    byTeam[team] = counts;
  }
  return byTeam;
}

function publicReport(inventory, options = {}) {
  const hashKey = clean(options.hashKey);
  const rows = [];
  if (hashKey) {
    for (const client of inventory.rows) {
      for (const result of client.teams) {
        rows.push({
          client_ref: hmacRef('client', client.slug, hashKey),
          team: result.team,
          status: result.status,
          production_ready: result.status === 'configured' && result.tagged === true,
          reason: result.reason || null,
          candidate_count: result.candidate_count,
        });
      }
    }
  }
  const counts = statusCounts(inventory.rows, inventory.teams);
  const totalPairs = inventory.rows.length * inventory.teams.length;
  const taggedReady = Object.values(counts).reduce((sum, team) => sum + team.tagged_ready, 0);
  const candidates = Object.values(counts).reduce((sum, team) => sum + team.untagged_candidate + team.exact_candidate, 0);
  const unresolved = Object.values(counts).reduce((sum, team) => sum + team.ambiguous + team.missing, 0);
  return {
    schema: 'syncview_project_mapping_readiness_v1',
    generated_at: options.generatedAt || new Date().toISOString(),
    mode: 'read_only_dry_run',
    scope: { active_client_count: inventory.rows.length, teams: inventory.teams, kinds: inventory.kinds },
    by_team: counts,
    total_team_mappings: totalPairs,
    production_ready_team_mappings: taggedReady,
    candidate_team_mappings: candidates,
    unresolved_discovery_team_mappings: unresolved,
    not_production_ready_team_mappings: totalPairs - taggedReady,
    production_ready: totalPairs > 0 && taggedReady === totalPairs,
    stable_pseudonyms_included: Boolean(hashKey),
    rows,
    safety: {
      linear_mutations: 0,
      supabase_mutations: 0,
      contains_client_names: false,
      contains_linear_ids: false,
    },
  };
}

function privatePlan(inventory, options = {}) {
  const clients = inventory.rows.map(client => {
    const resolved = client.teams.every(result => result.status === 'configured' || result.status === 'exact_match');
    const proposedMapping = resolved
      ? Object.fromEntries(client.teams.map(result => [result.team, result.project_id]))
      : {};
    const unchanged = resolved && client.teams.every(result => result.status === 'configured' && result.tagged === true);
    return {
      slug: client.slug,
      display_name: client.display_name,
      current_linear_project_ids: client.current_linear_project_ids,
      team_resolution: client.teams,
      review_state: resolved ? (unchanged ? 'already_configured' : 'safe_exact_plan') : 'manual_review_required',
      planned_patch: resolved && !unchanged
        ? { filter: { slug: client.slug }, values: { linear_project_ids: proposedMapping } }
        : null,
    };
  });
  return {
    schema: 'syncview_project_mapping_private_plan_v1',
    generated_at: options.generatedAt || new Date().toISOString(),
    mode: 'plan_only_no_apply',
    warning: 'Private: contains client names and Linear project IDs. Review manually; this tool cannot apply it.',
    clients,
  };
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function writePrivatePlan(file, plan) {
  const output = path.resolve(file);
  if (isInside(ROOT, output)) {
    throw new Error('refusing to write a private plan inside the repository');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return output;
}

async function supabaseClients(env) {
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  const base = clean(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required (read-only GET)');
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({
      select: 'slug,display_name,kind,active,linear_project_ids',
      active: 'eq.true',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${base}/rest/v1/clients?${query}`, {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Supabase clients read failed: HTTP ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function linearProjects(env) {
  const key = clean(env.LINEAR_READ_API_KEY || env.LINEAR_MIRROR_API_KEY || env.LINEAR_API_KEY);
  if (!key) throw new Error('LINEAR_READ_API_KEY is required (GraphQL query only)');
  const rows = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const query = `query ProjectMappingReadiness($after: String) {
      projects(first: 100, after: $after, includeArchived: false) {
        nodes { id name teams { nodes { id key } } }
        pageInfo { hasNextPage endCursor }
      }
    }`;
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: key, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { after } }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || Array.isArray(result.errors)) {
      throw new Error(`Linear projects read failed: HTTP ${response.status}`);
    }
    const connection = result.data && result.data.projects;
    if (!connection || !Array.isArray(connection.nodes)) throw new Error('Linear projects read returned an invalid shape');
    rows.push(...connection.nodes);
    if (!connection.pageInfo || connection.pageInfo.hasNextPage !== true) return rows;
    after = clean(connection.pageInfo.endCursor) || null;
    if (!after) throw new Error('Linear pagination cursor missing');
  }
  throw new Error('Linear pagination exceeded the 20-page safety limit');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const clients = args.get('--clients-json') ? readJson(args.get('--clients-json')) : await supabaseClients(env);
  const projects = args.get('--projects-json') ? readJson(args.get('--projects-json')) : await linearProjects(env);
  const teams = clean(args.get('--teams') || '').split(',').map(normalizeTeam).filter(Boolean);
  const kinds = clean(args.get('--kinds') || 'client').split(',').map(value => clean(value).toLowerCase()).filter(Boolean);
  const generatedAt = new Date().toISOString();
  const inventory = buildInventory(clients, projects, { teams: teams.length ? teams : DEFAULT_TEAMS, kinds });
  const report = publicReport(inventory, { generatedAt, hashKey: env.PROJECT_MAPPING_HASH_KEY });

  if (args.get('--public-json')) {
    const output = path.resolve(args.get('--public-json'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  if (args.get('--private-plan')) {
    writePrivatePlan(args.get('--private-plan'), privatePlan(inventory, { generatedAt }));
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}

module.exports = {
  buildInventory,
  configuredProjectIds,
  hmacRef,
  normalizeName,
  parseArgs,
  privatePlan,
  projectIdsForTeam,
  publicReport,
  resolveTeam,
  writePrivatePlan,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  });
}
