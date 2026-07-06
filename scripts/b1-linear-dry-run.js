'use strict';

/*
 * Track B B1 dry-run evidence generator.
 *
 * Read-only:
 *   LINEAR_API_KEY=... node scripts/b1-linear-dry-run.js --out docs/audits/2026-07-06-b1-dry-run.md
 *
 * Optional cache inputs, useful while iterating without re-pulling Linear:
 *   node scripts/b1-linear-dry-run.js --issues-json private/issues.json --projects-json private/projects.json
 *
 * This script never writes Linear or Supabase. It prints no secret values.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LINEAR_API_KEY = String(process.env.LINEAR_API_KEY
  || process.env.LINEAR_API_TOKEN
  || process.env.LINEAR_KEY
  || process.env.LINEAR_TOKEN
  || '').trim();
const SUPA_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SHEET_ID = '10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8';
const TRACK_TEAMS = new Set(['VID', 'GRA']);

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a, process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1');
}

function fail(message) {
  console.error('B1 dry-run failed:', message);
  process.exit(1);
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function wlNormalizeClient(s) {
  let t = clean(s).toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  t = t.replace(/^dr\.?\s+/, '');
  t = t.replace(/\s+(?:and|&)\s+/g, '&');
  return t.replace(/[^a-z0-9&]+/g, '');
}

function normalizeText(s) {
  return clean(s).toLowerCase().replace(/\s+/g, ' ');
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell);
  if (row.some(v => clean(v))) rows.push(row);
  return rows;
}

function csvObjects(text) {
  const rows = parseCsv(text);
  const headers = (rows.shift() || []).map(h => clean(h));
  return rows.map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = clean(r[i]); });
    return o;
  });
}

async function fetchSheet(sheet) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}&_t=${Date.now()}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`sheet ${sheet} HTTP ${resp.status}`);
  return csvObjects(await resp.text());
}

function seedClientsFromIndex() {
  const cached = args.get('--seed-clients-json');
  if (cached) return readJsonFile(cached);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const WL_CLIENT_NAMES = \[([\s\S]*?)\];/);
  if (!m) return [];
  return Array.from(m[1].matchAll(/'([^']+)'/g)).map(x => x[1]).filter(Boolean);
}

async function supabaseRows(table, select) {
  if (!SUPA_KEY) return [];
  const rows = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select || '*')}&limit=${limit}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Supabase ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const batch = await resp.json();
    rows.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return rows;
}

async function linear(query, variables) {
  if (!LINEAR_API_KEY) fail('LINEAR_API_KEY or a supported Linear token env var is required unless --issues-json and --projects-json are provided');
  const resp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: LINEAR_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.errors) {
    throw new Error(`Linear GraphQL failed: HTTP ${resp.status} ${JSON.stringify(json && json.errors || json).slice(0, 400)}`);
  }
  return json.data;
}

async function pageAll(rootField, query, nodePath) {
  const nodes = [];
  let after = null;
  const pageDelayMs = Math.max(0, Number(args.get('--page-delay-ms') || 260));
  for (;;) {
    const data = await linear(query, { after });
    const conn = nodePath(data);
    nodes.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
    if (pageDelayMs) await sleep(pageDelayMs);
  }
  return nodes;
}

async function loadIssues() {
  const cached = args.get('--issues-json');
  if (cached) return readJsonFile(cached);
  const query = `
    query B1Issues($after: String) {
      issues(first: 100, after: $after, includeArchived: true) {
        nodes {
          id identifier title description url priority createdAt updatedAt completedAt archivedAt canceledAt
          team { id key name }
          state { id name type }
          project { id name state targetDate archivedAt }
          assignee { id name email }
          parent {
            id identifier title description url
            team { id key name }
            project { id name state targetDate archivedAt }
          }
          children(first: 50) {
            nodes { id identifier team { key name } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  return pageAll('issues', query, data => data.issues);
}

async function loadProjects() {
  const cached = args.get('--projects-json');
  if (cached) return readJsonFile(cached);
  const query = `
    query B1Projects($after: String) {
      projects(first: 100, after: $after, includeArchived: true) {
        nodes {
          id name state createdAt updatedAt completedAt archivedAt targetDate
          lead { id name email }
          teams { nodes { id key name } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  return pageAll('projects', query, data => data.projects);
}

function isOpenIssue(issue) {
  const type = issue.state && issue.state.type;
  return !issue.archivedAt && !issue.completedAt && !issue.canceledAt && type !== 'completed' && type !== 'canceled';
}

function teamKey(issue) {
  return issue && issue.team && issue.team.key || 'NO_TEAM';
}

function isTrackIssue(issue) {
  return TRACK_TEAMS.has(teamKey(issue));
}

function issueClosedAt(issue) {
  return issue.completedAt || issue.canceledAt || issue.archivedAt || '';
}

function parseIdentifierFromUrlOrText(v) {
  const m = clean(v).match(/\b(?:VID|GRA|CON|STR)-\d+\b/i);
  return m ? m[0].toUpperCase() : '';
}

async function liveCardIdentifiers() {
  const cached = args.get('--linked-identifiers-json');
  if (cached) return new Set(readJsonFile(cached).map(v => clean(v).toUpperCase()).filter(Boolean));
  if (args.has('--skip-supabase')) return new Set();
  if (!SUPA_KEY) return new Set();
  const ids = new Set();
  const tables = [
    ['calendar_posts', 'status,linear_issue_id,graphic_linear_issue_id'],
    ['sample_reviews', 'status,linear_issue_id,graphic_linear_issue_id'],
  ];
  for (const [table, select] of tables) {
    const rows = await supabaseRows(table, select);
    for (const row of rows) {
      if (clean(row.status).toLowerCase() === 'archived') continue;
      for (const key of ['linear_issue_id', 'graphic_linear_issue_id']) {
        const ident = parseIdentifierFromUrlOrText(row[key]);
        if (ident) ids.add(ident);
      }
    }
  }
  return ids;
}

function cutoffDate(months, asOf) {
  const d = new Date(asOf);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

function splitByCutoff(issues, linkedIdentifiers, months, asOf) {
  const cutoff = cutoffDate(months, asOf);
  const operational = [];
  const archive = [];
  const openWithinCutoff = [];
  const openOlder = [];
  const recentCompleted = [];
  for (const issue of issues) {
    const created = issue.createdAt ? new Date(issue.createdAt) : null;
    const completed = issueClosedAt(issue) ? new Date(issueClosedAt(issue)) : null;
    const linked = linkedIdentifiers.has(clean(issue.identifier).toUpperCase());
    const open = isOpenIssue(issue);
    const createdWithin = !!(created && created >= cutoff);
    const op = open && (createdWithin || linked);
    if (op) operational.push(issue);
    else archive.push(issue);
    if (open && createdWithin) openWithinCutoff.push(issue);
    if (open && !createdWithin) openOlder.push(issue);
    if (completed && completed >= cutoff) recentCompleted.push(issue);
  }
  return {
    months,
    cutoff: cutoff.toISOString(),
    operational: operational.length,
    archive: archive.length,
    open_createdAt_cutoff: operational.filter(isOpenIssue).length,
    open_createdAt_within_cutoff: openWithinCutoff.length,
    open_createdAt_older_than_cutoff: openOlder.length,
    linked_live_card_included: operational.filter(i => linkedIdentifiers.has(clean(i.identifier).toUpperCase())).length,
    completedAt_within_cutoff: recentCompleted.length,
  };
}

function parentKey(issue) {
  const title = normalizeText(issue.title);
  const desc = normalizeText(issue.description);
  const project = wlNormalizeClient(issue.project && issue.project.name || issue.parent && issue.parent.project && issue.parent.project.name || '');
  return `${project}|${title}|${desc}`;
}

function batchShapes(issues) {
  const open = issues.filter(isOpenIssue).filter(i => ['VID', 'GRA'].includes(i.team && i.team.key));
  const parents = open.filter(i => !i.parent);
  const byKey = new Map();
  for (const p of parents) {
    const k = parentKey(p);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  let mirroredPairs = 0;
  let vidOnly = 0;
  let graOnly = 0;
  let mixedChildren = 0;
  let crossTeamChildren = 0;
  for (const group of byKey.values()) {
    const teams = new Set(group.map(i => i.team && i.team.key).filter(Boolean));
    if (teams.has('VID') && teams.has('GRA') && group.length >= 2) mirroredPairs++;
    else if (teams.has('VID')) vidOnly++;
    else if (teams.has('GRA')) graOnly++;
  }
  for (const p of parents) {
    const parentTeam = p.team && p.team.key;
    const childTeams = new Set(((p.children && p.children.nodes) || []).map(c => c.team && c.team.key).filter(Boolean));
    if (childTeams.size > 1) mixedChildren++;
    if (Array.from(childTeams).some(t => t !== parentTeam)) crossTeamChildren++;
  }
  return {
    mirrored_pair_groups: mirroredPairs,
    vid_only_parent_groups: vidOnly,
    gra_only_parent_groups: graOnly,
    mixed_children_parents: mixedChildren,
    cross_team_children_parents: crossTeamChildren,
    open_parent_issues: parents.length,
  };
}

function teamOpenCounts(issues) {
  const counts = {};
  for (const issue of issues.filter(isOpenIssue)) {
    const key = teamKey(issue);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function workloadIssueTeamSplit() {
  const cached = args.get('--workload-issues-json');
  const rows = cached ? readJsonFile(cached) : null;
  if (rows) return workloadIssueTeamSplitFromRows(rows);
  if (args.has('--skip-supabase')) return { available: false, all: {}, active: {} };
  if (!SUPA_KEY) return { available: false, all: {}, active: {} };
  return workloadIssueTeamSplitFromRows(await supabaseRows('workload_issues', 'team_key,active'));
}

function workloadIssueTeamSplitFromRows(rows) {
  const all = {};
  const active = {};
  for (const row of rows) {
    const key = clean(row.team_key) || 'NO_TEAM';
    all[key] = (all[key] || 0) + 1;
    if (row.active) active[key] = (active[key] || 0) + 1;
  }
  return { available: true, all, active };
}

function sourceAdd(map, slug, displayName, source, extra = {}) {
  if (!slug) return;
  if (!map.has(slug)) {
    map.set(slug, { slug, display_name: displayName || slug, sources: new Set(), names: new Set(), linear_project_ids: [], notes: [] });
  }
  const row = map.get(slug);
  row.sources.add(source);
  if (displayName) row.names.add(displayName);
  if (extra.projectId && !row.linear_project_ids.includes(extra.projectId)) row.linear_project_ids.push(extra.projectId);
  if (extra.note) row.notes.push(extra.note);
}

async function clientReconciliation(projects) {
  const [clientsInfo, smms] = await Promise.all([
    args.get('--clients-info-json') ? readJsonFile(args.get('--clients-info-json')) : fetchSheet('Clients Info'),
    args.get('--smms-json') ? readJsonFile(args.get('--smms-json')) : fetchSheet('Social Media Managers').catch(() => []),
  ]);
  const map = new Map();
  for (const name of seedClientsFromIndex()) sourceAdd(map, wlNormalizeClient(name), name, 'seed');
  for (const row of clientsInfo) {
    const name = clean(row.client_name);
    sourceAdd(map, wlNormalizeClient(name), name, 'clients_info', {
      note: row.slack_channel_id ? 'has_slack_channel' : 'missing_slack_channel',
    });
  }
  for (const row of smms) {
    const candidates = ['client_name', 'client', 'Client', 'Client Name'];
    const name = candidates.map(k => row[k]).find(Boolean);
    sourceAdd(map, wlNormalizeClient(name), clean(name), 'smm_sheet');
  }
  for (const project of projects) {
    const slug = wlNormalizeClient(project.name);
    const state = clean(project.state || '');
    sourceAdd(map, slug, project.name, 'linear_project', {
      projectId: project.id,
      note: state ? `linear_state:${state}` : '',
    });
  }
  sourceAdd(map, 'unattributed', 'Unattributed', 'b1_required_internal', { note: 'repair_queue_for_no_project_issues' });

  const rows = Array.from(map.values()).map(row => ({
    slug: row.slug,
    display_name: Array.from(row.names)[0] || row.display_name,
    names: Array.from(row.names).sort(),
    sources: Array.from(row.sources).sort(),
    linear_project_ids: row.linear_project_ids,
    notes: Array.from(new Set(row.notes.filter(Boolean))).sort(),
  })).sort((a, b) => a.slug.localeCompare(b.slug));

  const sourceKey = row => row.sources.join('+');
  const summary = rows.reduce((acc, row) => {
    const key = sourceKey(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const activeFalseCandidates = rows.filter(row => {
    const sources = new Set(row.sources);
    if (row.slug === 'unattributed') return false;
    if (sources.has('seed') && !sources.has('clients_info') && !sources.has('linear_project')) return true;
    if (sources.has('linear_project') && !sources.has('clients_info') && !sources.has('seed') && !sources.has('smm_sheet')) return true;
    return false;
  });
  const bySlug = new Map(rows.map(r => [r.slug, r]));
  const explicitReviewSlugs = String(process.env.B1_OWNER_REVIEW_SLUGS || '')
    .split(',')
    .map(s => wlNormalizeClient(s))
    .filter(Boolean);
  const ownerReview = explicitReviewSlugs.length
    ? explicitReviewSlugs.map(slug => bySlug.get(slug)).filter(Boolean)
    : activeFalseCandidates;

  return { total: rows.length, summary, rows, ownerReview, activeFalseCandidates };
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(v => clean(v).replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');
}

function renderReport(result) {
  const lines = [];
  lines.push('# B1 Linear Dry-Run Gate Evidence');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Cutoff as-of: ${result.asOf}`);
  lines.push('');
  lines.push('## Open Issue Reconciliation');
  lines.push('');
  lines.push(mdTable(
    ['Metric', 'Count'],
    [
      ['Open Track total (VID+GRA)', result.open.trackTotal],
      ['All open total (all Linear teams)', result.open.allTotal],
      ['Open VID', result.open.byTeam.VID || 0],
      ['Open GRA', result.open.byTeam.GRA || 0],
      ['Open CON', result.open.byTeam.CON || 0],
      ['Open STR', result.open.byTeam.STR || 0],
      ['Open Track no-project', result.open.trackNoProject],
      ['Audit baseline match', result.open.auditMatch ? 'yes' : 'NO - investigate before gate'],
    ],
  ));
  lines.push('');
  lines.push('## Cutoff Splits');
  lines.push('');
  lines.push(mdTable(
    ['Cutoff', 'Operational open', 'Archive/excluded', 'Open createdAt within cutoff', 'Open older', 'Live-card linked included', 'Closed within cutoff'],
    result.cutoffs.map(c => [`${c.months} mo`, c.operational, c.archive, c.open_createdAt_within_cutoff, c.open_createdAt_older_than_cutoff, c.linked_live_card_included, c.completedAt_within_cutoff]),
  ));
  lines.push('');
  lines.push('## D-11 CON/STR Scope Check');
  lines.push('');
  if (result.workloadIssues.available) {
    lines.push(mdTable(
      ['Team', 'workload_issues all rows', 'workload_issues active rows', 'Linear open rows'],
      ['VID', 'GRA', 'CON', 'STR', 'NO_TEAM'].map(team => [
        team,
        result.workloadIssues.all[team] || 0,
        result.workloadIssues.active[team] || 0,
        result.open.byTeam[team] || 0,
      ]),
    ));
  } else {
    lines.push('Supabase service-role key not available; skipped workload_issues split.');
  }
  lines.push('');
  lines.push('## Batch Shapes');
  lines.push('');
  lines.push(mdTable(
    ['Shape', 'Count'],
    Object.entries(result.batchShapes).map(([k, v]) => [k, v]),
  ));
  lines.push('');
  lines.push('## Client Reconciliation');
  lines.push('');
  lines.push(`Merged client rows: ${result.clients.total}`);
  lines.push('');
  lines.push('### Source Summary');
  lines.push('');
  lines.push(mdTable(['Sources', 'Count'], Object.entries(result.clients.summary).map(([k, v]) => [k, v])));
  lines.push('');
  lines.push('### D-16 Owner Review List');
  lines.push('');
  lines.push(mdTable(
    ['Slug', 'Display', 'Sources', 'Names/Notes'],
    result.clients.ownerReview.map(r => [r.slug, r.display_name, r.sources.join(', '), [...r.names, ...r.notes].join('; ')]),
  ));
  lines.push('');
  lines.push('### Active=false Candidates');
  lines.push('');
  lines.push(mdTable(
    ['Slug', 'Display', 'Sources', 'Notes'],
    result.clients.activeFalseCandidates.map(r => [r.slug, r.display_name, r.sources.join(', '), r.notes.join('; ')]),
  ));
  lines.push('');
  lines.push('## Confirmations for Gate');
  lines.push('');
  lines.push('- D-3 priority: mirror-only. `deliverables.priority` is stored for Linear parity/history and not exposed as a new UI control in B1.');
  lines.push('- D-7 identifier design: `deliverables.identifier` uses the Linear identifier during backfill; native IDs are minted later per spec, while `linear_issue_uuid` remains the durable join key.');
  lines.push('- Card linkage: card-to-deliverable resolution uses `deliverables.client_slug + origin + card_id + kind`; the card tables also have `video_deliverable_id` and `graphic_deliverable_id` slots.');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const asOf = args.get('--as-of') || new Date().toISOString();
  const [issues, projects, linkedIdentifiers] = await Promise.all([
    loadIssues(),
    loadProjects(),
    liveCardIdentifiers(),
  ]);
  const workloadIssues = await workloadIssueTeamSplit();
  const trackIssues = issues.filter(isTrackIssue);
  const open = issues.filter(isOpenIssue);
  const trackOpen = trackIssues.filter(isOpenIssue);
  const byTeam = teamOpenCounts(issues);
  const result = {
    asOf,
    issue_count_total: issues.length,
    project_count_total: projects.length,
    open: {
      allTotal: open.length,
      trackTotal: trackOpen.length,
      byTeam,
      trackNoProject: trackOpen.filter(i => !i.project).length,
      auditMatch: trackOpen.length === 1869 && (byTeam.GRA || 0) === 470 && (byTeam.VID || 0) === 1399,
    },
    cutoffs: [3, 6, 12].map(m => splitByCutoff(trackIssues, linkedIdentifiers, m, asOf)),
    workloadIssues,
    batchShapes: batchShapes(trackIssues),
    clients: await clientReconciliation(projects),
  };

  const jsonPath = args.get('--json-out');
  if (jsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  }

  const report = renderReport(result);
  const out = args.get('--out');
  if (out) {
    const full = path.resolve(out);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, report);
  }
  console.log(report);
}

main().catch(err => fail(err && err.stack ? err.stack : String(err)));
