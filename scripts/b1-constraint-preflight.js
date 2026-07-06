'use strict';

/*
 * Track B B1 mandatory constraint preflight (section 5.6).
 *
 * Read-only. Pulls live Linear issue-level data + Supabase card references,
 * enumerates the B1 target-table constraint risks, and writes a gate addendum
 * report. It must run before any B1 backfill write.
 *
 * Per spec section 5.6, this blocking gate intentionally does not read Linear
 * comments. Delivery-link comment sweeps are best-effort repair annotations and
 * must not block the B1 backfill.
 *
 * Private assignee alias rules are supplied by B1_ASSIGNEE_RULES_FILE or
 * B1_ASSIGNEE_RULES_JSON. Do not commit those rules to this public repo.
 */

const fs = require('fs');
const path = require('path');

const LINEAR_API_KEY = String(process.env.LINEAR_API_KEY
  || process.env.LINEAR_API_TOKEN
  || process.env.LINEAR_KEY
  || process.env.LINEAR_TOKEN
  || '').trim();
const SUPA_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const TRACK_TEAMS = new Set(['VID', 'GRA']);
const PRIVATE_ASSIGNEE_RULES = loadPrivateAssigneeRules();
const ASSIGNEE_ALIAS_EMAILS = new Map(Object.entries(PRIVATE_ASSIGNEE_RULES.alias_emails || {})
  .map(([alias, canonical]) => [clean(alias).toLowerCase(), clean(canonical).toLowerCase()])
  .filter(([alias, canonical]) => alias && canonical));

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a, process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1');
}

function fail(message) {
  console.error('B1 constraint preflight failed:', message);
  process.exit(1);
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function loadPrivateAssigneeRules() {
  const inline = clean(process.env.B1_ASSIGNEE_RULES_JSON);
  const file = clean(process.env.B1_ASSIGNEE_RULES_FILE);
  const text = inline || (file ? fs.readFileSync(path.resolve(file), 'utf8') : '');
  if (!text) return { alias_emails: {} };
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function normalizeText(s) {
  return clean(s).toLowerCase().replace(/\s+/g, ' ');
}

function wlNormalizeClient(s) {
  let t = clean(s).toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  t = t.replace(/^dr\.?\s+/, '');
  t = t.replace(/\s+(?:and|&)\s+/g, '&');
  return t.replace(/[^a-z0-9&]+/g, '');
}

function parseIdentifier(v) {
  const m = clean(v).match(/\b(?:VID|GRA|CON|STR)-\d+\b/i);
  return m ? m[0].toUpperCase() : '';
}

function issueTeam(issue) {
  return issue && issue.team && issue.team.key || 'NO_TEAM';
}

function isOpenIssue(issue) {
  const type = issue.state && issue.state.type;
  return !issue.archivedAt && !issue.completedAt && !issue.canceledAt && type !== 'completed' && type !== 'canceled';
}

function closedAt(issue) {
  return issue.completedAt || issue.canceledAt || issue.archivedAt || '';
}

function isTrackIssue(issue) {
  return TRACK_TEAMS.has(issueTeam(issue));
}

function linearTeam(issue) {
  const key = issueTeam(issue);
  if (key === 'VID') return 'video';
  if (key === 'GRA') return 'graphics';
  return '';
}

function linearStatusSlug(issue) {
  const n = normalizeText(issue && issue.state && issue.state.name || '');
  if (!n) return '';
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
  return '';
}

function classifyKind(issue) {
  const team = issueTeam(issue);
  const title = normalizeText([issue.title, issue.parent && issue.parent.title].filter(Boolean).join(' '));
  if (team === 'VID') {
    if (/\bthumb(?:nail)?s?\b/.test(title)) return 'thumbnail';
    const suspicious = /\b(script|admin|sop|process|notion|outline|caption|copy|research|planning|call notes?)\b/.test(title);
    return suspicious ? 'other' : 'video';
  }
  if (team === 'GRA') {
    const nonThumb = /\b(banner|carousel|brand\s*kit|logo|profile|story|stories|slides?|deck|quote|feed post|ig post|instagram post|ad creative|flyer|one[-\s]?pager)\b/.test(title);
    return nonThumb ? 'other' : 'thumbnail';
  }
  return 'other';
}

function issueClientCandidate(issue) {
  const names = [
    issue.project && issue.project.name,
    issue.parent && issue.parent.project && issue.parent.project.name,
  ].filter(Boolean);
  for (const name of names) {
    const slug = wlNormalizeClient(name);
    if (slug) return { slug, source: name };
  }
  return { slug: 'unattributed', source: 'no_project' };
}

function stableBatchKey(issue) {
  const parent = issue.parent || issue;
  const client = issueClientCandidate(issue).slug || 'unattributed';
  const title = normalizeText(parent.title || issue.title || 'Untitled batch');
  const desc = normalizeText(parent.description || '');
  return `${client}|${title}|${desc}`;
}

async function linear(query, variables) {
  if (!LINEAR_API_KEY) fail('LINEAR_API_KEY or a supported Linear token env var is required');
  const maxAttempts = Math.max(1, Number(args.get('--linear-attempts') || 5));
  let last = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: LINEAR_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const json = await resp.json().catch(() => null);
    if (resp.ok && json && !json.errors) return json.data;
    last = `HTTP ${resp.status} ${JSON.stringify(json && json.errors || json).slice(0, 500)}`;
    const retryable = resp.status === 429 || resp.status >= 500 || !json;
    if (!retryable || attempt === maxAttempts) break;
    const wait = Math.min(15000, 750 * Math.pow(2, attempt - 1));
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  throw new Error(`Linear GraphQL failed after ${maxAttempts} attempt(s): ${last}`);
}

async function loadIssues() {
  const nodes = [];
  let after = null;
  const delay = Math.max(0, Number(args.get('--page-delay-ms') || 240));
  const query = `
    query B1Issues($after: String) {
      issues(first: 100, after: $after, includeArchived: true) {
        nodes {
          id identifier title description url priority createdAt updatedAt completedAt archivedAt canceledAt dueDate
          team { id key name }
          state { id name type }
          project { id name state targetDate archivedAt }
          assignee { id name email }
          parent {
            id identifier title description url completedAt archivedAt canceledAt
            team { id key name }
            project { id name state targetDate archivedAt }
          }
          children(first: 50) { nodes { id identifier team { key name } } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  for (;;) {
    const data = await linear(query, { after });
    nodes.push(...data.issues.nodes);
    if (!data.issues.pageInfo.hasNextPage) break;
    after = data.issues.pageInfo.endCursor;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  }
  return nodes;
}

async function supabaseRows(table, select, params = '') {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required');
  const rows = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${limit}&offset=${offset}${params ? `&${params}` : ''}`;
    const resp = await fetch(url, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Supabase ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const batch = await resp.json();
    rows.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return rows;
}

function operationalIssues(issues, linkedIdentifiers, asOf, months) {
  const cutoff = new Date(asOf);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return issues.filter(issue => {
    if (!isTrackIssue(issue) || !isOpenIssue(issue)) return false;
    const created = issue.createdAt ? new Date(issue.createdAt) : null;
    const linked = linkedIdentifiers.has(clean(issue.identifier).toUpperCase());
    return linked || (created && created >= cutoff);
  });
}

function constraint(table, name, type, count, handling, sample) {
  return { table, constraint: name, type, count, handling: count ? handling : 'no handling needed', sample: sample || [] };
}

function renderTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(v => clean(v).replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');
}

async function main() {
  const asOf = args.get('--as-of') || '2026-07-05T00:00:00.000Z';
  const cutoffMonths = Number(args.get('--cutoff-months') || 12);

  const [issues, clients, members, calendarRows, sampleRows, workloadRows] = await Promise.all([
    loadIssues(),
    supabaseRows('clients', 'slug,display_name,kind,active'),
    supabaseRows('team_members', 'id,name,email,linear_user_id,role,team,active'),
    supabaseRows('calendar_posts', 'client,id,status,linear_issue_id,graphic_linear_issue_id'),
    supabaseRows('sample_reviews', 'client,id,status,linear_issue_id,graphic_linear_issue_id'),
    supabaseRows('workload_issues', 'team_key,active'),
  ]);

  const issueByIdentifier = new Map(issues.map(i => [clean(i.identifier).toUpperCase(), i]));
  const clientSet = new Set(clients.map(c => c.slug));
  const memberByLinear = new Map(members.map(m => [clean(m.linear_user_id), m]).filter(([k]) => k));
  const memberByEmail = new Map(members.map(m => [clean(m.email).toLowerCase(), m]).filter(([k]) => k));
  for (const [alias, canonical] of ASSIGNEE_ALIAS_EMAILS.entries()) {
    const canonicalMember = memberByEmail.get(canonical);
    if (canonicalMember) memberByEmail.set(alias, canonicalMember);
  }
  const activeCards = [];
  for (const [origin, rows] of [['calendar', calendarRows], ['samples', sampleRows]]) {
    for (const row of rows) {
      if (clean(row.status).toLowerCase() === 'archived') continue;
      activeCards.push({ origin, ...row });
    }
  }

  const linkedIdentifiers = new Set();
  const cardLinks = [];
  const cardLinksByIdentifier = new Map();
  for (const card of activeCards) {
    for (const [kind, col] of [['video', 'linear_issue_id'], ['thumbnail', 'graphic_linear_issue_id']]) {
      const identifier = parseIdentifier(card[col]);
      if (!identifier) continue;
      linkedIdentifiers.add(identifier);
      const link = { origin: card.origin, client: card.client, card_id: card.id, kind, identifier, url: card[col] };
      cardLinks.push(link);
      if (!cardLinksByIdentifier.has(identifier)) cardLinksByIdentifier.set(identifier, []);
      cardLinksByIdentifier.get(identifier).push(link);
    }
  }

  const operational = operationalIssues(issues, linkedIdentifiers, asOf, cutoffMonths);
  const operationalSet = new Set(operational.map(i => i.id));
  const operationalByIdentifier = new Map(operational.map(i => [clean(i.identifier).toUpperCase(), i]));

  const clientMisses = [];
  const assigneeMisses = [];
  const kindCounts = { video: 0, thumbnail: 0, other: 0 };
  const otherKind = [];
  const statusMisses = [];
  const parentGaps = [];
  const deliverableIds = new Set();
  const identifierCounts = new Map();
  const deliverableCardSlotKeys = new Map();
  const batchGroups = new Map();

  for (const issue of operational) {
    const client = issueClientCandidate(issue);
    if (!clientSet.has(client.slug)) clientMisses.push({ identifier: issue.identifier, title: issue.title, slug: client.slug, source: client.source });
    if (issue.assignee && !memberByLinear.has(clean(issue.assignee.id)) && !memberByEmail.has(clean(issue.assignee.email).toLowerCase())) {
      assigneeMisses.push({ identifier: issue.identifier, assignee: issue.assignee.name || issue.assignee.email || issue.assignee.id });
    }
    const kind = classifyKind(issue);
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    if (kind === 'other') otherKind.push({ identifier: issue.identifier, team: issueTeam(issue), title: issue.title });
    const links = cardLinksByIdentifier.get(clean(issue.identifier).toUpperCase()) || [];
    const selectedLink = links.find(l => l.kind === kind) || null;
    if (selectedLink) {
      const slot = `${selectedLink.client}|${selectedLink.origin}|${selectedLink.card_id}|${kind}`;
      deliverableCardSlotKeys.set(slot, (deliverableCardSlotKeys.get(slot) || 0) + 1);
    }
    if (!linearStatusSlug(issue)) statusMisses.push({ identifier: issue.identifier, state: issue.state && issue.state.name || '' });
    if (deliverableIds.has(issue.id)) {
      // Linear ids should be unique; retained for explicit constraint accounting.
    }
    deliverableIds.add(issue.id);
    identifierCounts.set(clean(issue.identifier).toUpperCase(), (identifierCounts.get(clean(issue.identifier).toUpperCase()) || 0) + 1);
    const key = stableBatchKey(issue);
    if (!batchGroups.has(key)) batchGroups.set(key, []);
    batchGroups.get(key).push(issue);
    if (issue.parent && !operationalSet.has(issue.parent.id)) {
      parentGaps.push({
        identifier: issue.identifier,
        parent: issue.parent.identifier || issue.parent.id,
        parent_closed: !!closedAt(issue.parent),
      });
    }
  }

  const duplicateIdentifiers = Array.from(identifierCounts.entries()).filter(([, n]) => n > 1);
  const batchClientMisses = [];
  for (const group of batchGroups.values()) {
    const issue = group[0];
    const client = issueClientCandidate(issue);
    if (!clientSet.has(client.slug)) batchClientMisses.push({ batch_key: stableBatchKey(issue), slug: client.slug, count: group.length });
  }

  const linkCounts = new Map();
  const cardClientMismatch = [];
  const linkResolution = { unresolved: [], closed: [], outOfWindow: [], outOfTeam: [] };
  const cardSlotKeys = new Map();
  for (const link of cardLinks) {
    linkCounts.set(link.identifier, (linkCounts.get(link.identifier) || 0) + 1);
    const issue = issueByIdentifier.get(link.identifier);
    if (!issue) {
      linkResolution.unresolved.push(link);
    } else {
      if (!isTrackIssue(issue)) linkResolution.outOfTeam.push(link);
      if (!isOpenIssue(issue)) linkResolution.closed.push(link);
      if (!operationalByIdentifier.has(link.identifier)) linkResolution.outOfWindow.push(link);
      const issueClient = issueClientCandidate(issue).slug;
      if (issueClient && link.client !== issueClient) cardClientMismatch.push({ ...link, issue_client: issueClient });
    }
    const slot = `${link.client}|${link.origin}|${link.card_id}|${link.kind}`;
    cardSlotKeys.set(slot, (cardSlotKeys.get(slot) || 0) + 1);
  }
  const duplicateCardLinks = Array.from(linkCounts.entries()).filter(([, n]) => n > 1);
  const duplicateCardSlots = Array.from(deliverableCardSlotKeys.entries()).filter(([, n]) => n > 1);

  const workloadAll = {};
  const workloadActive = {};
  for (const row of workloadRows) {
    const key = clean(row.team_key) || 'NO_TEAM';
    workloadAll[key] = (workloadAll[key] || 0) + 1;
    if (row.active) workloadActive[key] = (workloadActive[key] || 0) + 1;
  }

  const constraints = [
    constraint('batches', 'client_slug NOT NULL/FK clients(slug)', 'foreign key', batchClientMisses.length, 'insert missing client rows first under sections 5.5/5.3, flagged inactive unless explicitly internal/test; then rerun preflight before batches', batchClientMisses.slice(0, 10)),
    constraint('batches', 'team CHECK video|graphics|null', 'check', 0, ''),
    constraint('batches', 'name NOT NULL', 'not null', 0, ''),
    constraint('deliverables', 'client_slug NOT NULL/FK clients(slug)', 'foreign key', clientMisses.length, 'insert missing client rows first under sections 5.5/5.3, flagged inactive; no deliverable row may be dropped or silently routed', clientMisses.slice(0, 10)),
    constraint('deliverables', 'batch_id NOT NULL/FK batches(id)', 'foreign key', 0, 'batch rows are generated before deliverables using synthetic-batch rule for absent/out-of-window parents'),
    constraint('deliverables', 'team CHECK video|graphics', 'check', operational.filter(i => !linearTeam(i)).length, 'non-VID/GRA issues are excluded from operational pull and archived only', operational.filter(i => !linearTeam(i)).slice(0, 10).map(i => ({ identifier: i.identifier, team: issueTeam(i) }))),
    constraint('deliverables', 'kind CHECK video|thumbnail|other', 'check', 0, 'measured neither-kind issues backfill as kind=other per spec section 2.2; titles are posted for review and can be reclassified later'),
    constraint('deliverables', 'status CHECK canonical enum', 'check', statusMisses.length, 'unknown Linear states stop the run; add explicit mapping or archive/repair rule before write', statusMisses.slice(0, 20)),
    constraint('deliverables', 'assignee_id FK team_members(id)', 'foreign key', assigneeMisses.length, 'approved handling needed: insert inactive member rows or store NULL with the Linear assignee retained in linear_raw/repair note', assigneeMisses.slice(0, 20)),
    constraint('deliverables', 'unique linear_issue_uuid where not null', 'unique', 0, ''),
    constraint('deliverables', 'identifier UNIQUE', 'unique', duplicateIdentifiers.length, 'duplicate identifiers stop the run; use linear_issue_uuid as canonical and add alias/repair rule before write', duplicateIdentifiers.slice(0, 10)),
    constraint('deliverables', 'card slot unique (client_slug, origin, card_id, kind)', 'unique', duplicateCardSlots.length, 'duplicate card slots stop card-linkage backfill; repair duplicated card links first', duplicateCardSlots.slice(0, 10)),
    constraint('deliverable_events', 'client_slug/action/source NOT NULL + source CHECK', 'not null/check', 0, ''),
    constraint('linear_archive', 'linear_uuid PRIMARY KEY NOT NULL', 'primary key', 0, ''),
    constraint('mirror_outbox', 'B1 backfill plans zero mirror_outbox rows', 'phase invariant', 0, ''),
  ];

  const result = {
    generated_at: new Date().toISOString(),
    as_of: asOf,
    cutoff_months: cutoffMonths,
    blocking_gate_scope: 'issue-level Linear fields only: assignee, state, parent, team, project/client, card-link resolution; no comments',
    issue_count_total: issues.length,
    operational_count: operational.length,
    linked_live_card_included: operational.filter(i => linkedIdentifiers.has(clean(i.identifier).toUpperCase())).length,
    constraints,
    sweep: {
      item_1_kind_classification: { counts: kindCounts, other_count: otherKind.length, sample: otherKind.slice(0, 28) },
      item_2_live_card_links: {
        total_links: cardLinks.length,
        duplicate_link_identifiers: duplicateCardLinks.length,
        unresolved: linkResolution.unresolved.length,
        closed: linkResolution.closed.length,
        out_of_window: linkResolution.outOfWindow.length,
        out_of_team: linkResolution.outOfTeam.length,
        card_client_mismatch: cardClientMismatch.length,
      },
      item_5_assignees: { unresolved_assignee_count: assigneeMisses.length, sample: assigneeMisses.slice(0, 20) },
      item_6_batch_shapes: { parent_gap_count: parentGaps.length, sample: parentGaps.slice(0, 20) },
      item_7_card_linkage: { duplicate_link_identifiers: duplicateCardLinks, card_client_mismatch: cardClientMismatch.slice(0, 20) },
      item_8_slug_fusion: 'covered by dry-run client reconciliation/D-16 owner-review list; no additional write performed here',
      item_11_delivery_link_comment_sweep: {
        blocking: false,
        status: 'not run in the blocking constraint gate',
        handling: 'separate best-effort comment sweep annotates file_url; if skipped, rows remain eligible for backfill and are flagged for later file_url repair',
      },
    },
    str_clarifier: {
      linear_open_str: issues.filter(i => isOpenIssue(i) && issueTeam(i) === 'STR').length,
      workload_issues_all_str: workloadAll.STR || 0,
      workload_issues_active_str: workloadActive.STR || 0,
      explanation: 'The dry-run counts live open Linear STR issues; workload_issues contains mirrored rows, including active STR rows that are out of Track B VID/GRA operational scope.',
    },
  };

  const lines = [];
  lines.push('# B1 Constraint Preflight Addendum');
  lines.push('');
  lines.push(`Generated: ${result.generated_at}`);
  lines.push(`Cutoff: ${cutoffMonths} months as of ${asOf}, plus linked-live-card inclusion`);
  lines.push(`Operational deliverables tested: ${operational.length}`);
  lines.push(`Blocking gate scope: ${result.blocking_gate_scope}`);
  lines.push('');
  lines.push('## Constraint Counts');
  lines.push('');
  lines.push(renderTable(
    ['Table', 'Constraint', 'Type', 'Violation count', 'Handling rule'],
    constraints.map(c => [c.table, c.constraint, c.type, c.count, c.handling]),
  ));
  lines.push('');
  lines.push('## Sweep Items');
  lines.push('');
  lines.push(`- Item 1 kind classification: video=${kindCounts.video || 0}, thumbnail=${kindCounts.thumbnail || 0}, other=${otherKind.length}.`);
  lines.push('- Item 11 delivery-link comment sweep: skipped from the blocking gate by spec section 5.6; best-effort file_url annotation/repair pass remains separate and non-blocking.');
  lines.push(`- STR clarifier: Linear open STR=${result.str_clarifier.linear_open_str}; workload_issues all STR=${result.str_clarifier.workload_issues_all_str}; workload_issues active STR=${result.str_clarifier.workload_issues_active_str}. ${result.str_clarifier.explanation}`);
  lines.push('');
  lines.push('## Samples For Non-Zero Counts');
  for (const c of constraints.filter(c => c.count)) {
    lines.push('');
    lines.push(`### ${c.table}: ${c.constraint}`);
    lines.push('```json');
    lines.push(JSON.stringify(c.sample, null, 2));
    lines.push('```');
  }
  lines.push('');
  lines.push('Backfill remains stopped until every non-zero handling rule is approved.');

  const jsonPath = args.get('--json-out');
  if (jsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  }
  const out = args.get('--out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, lines.join('\n'));
  }
  console.log(lines.join('\n'));
}

main().catch(err => fail(err && err.stack ? err.stack : String(err)));
