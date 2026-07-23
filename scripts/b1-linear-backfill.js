'use strict';

/*
 * Track B B1 Linear backfill.
 *
 * Default mode is read-only plan/verify. Use --apply only after the B1 handling
 * rules are approved. Writes are limited to Track B tables plus approved
 * team_members reconciliation rows. The active SyncView roster is the sole
 * client catalog; this job never creates a client from Linear data.
 *
 * Private assignee reconciliation rules are supplied by B1_ASSIGNEE_RULES_FILE
 * or B1_ASSIGNEE_RULES_JSON. Do not commit those rules to this public repo.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authorityForTeam, loadAuthority } = require('./prod-authority-guard');
const { publicB1Artifact } = require('./public-b1-artifact');
const {
  attributionForIssue,
  persistedExplicitClassifications,
  resolveAttributionGraph,
  storageClientSlug,
  withAttribution,
} = require('./f200-attribution');

const ROOT = path.join(__dirname, '..');
const LINEAR_API_KEY = String(process.env.LINEAR_API_KEY
  || process.env.LINEAR_API_TOKEN
  || process.env.LINEAR_KEY
  || process.env.LINEAR_TOKEN
  || '').trim();
const SUPA_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const AUTHORITY_CACHE_PATH = process.env.PROD_AUTHORITY_CACHE_PATH
  || path.join(ROOT, '.sync-ledger', 'b1-linear-incremental-authority.json');
const TRACK_TEAMS = new Set(['VID', 'GRA']);
const PRIVATE_ASSIGNEE_RULES = loadPrivateAssigneeRules();
const ASSIGNEE_EXISTING_MEMBER_RULES = (PRIVATE_ASSIGNEE_RULES.existing_member_rules || []).map(rule => ({
  assigneeNames: Array.isArray(rule.assigneeNames) ? rule.assigneeNames : [],
  assigneeEmails: Array.isArray(rule.assigneeEmails) ? rule.assigneeEmails : [],
  memberNames: Array.isArray(rule.memberNames) ? rule.memberNames : [],
}));
const ASSIGNEE_ALIAS_EMAILS = new Map(Object.entries(PRIVATE_ASSIGNEE_RULES.alias_emails || {})
  .map(([alias, canonical]) => [clean(alias).toLowerCase(), clean(canonical).toLowerCase()])
  .filter(([alias, canonical]) => alias && canonical));
const RECONCILIATION_INSERT_EMAILS = new Set((PRIVATE_ASSIGNEE_RULES.reconciliation_insert_emails || [])
  .map(v => clean(v).toLowerCase())
  .filter(Boolean));
const RECONCILIATION_INSERT_NAMES = new Set((PRIVATE_ASSIGNEE_RULES.reconciliation_insert_names || [])
  .map(personKey)
  .filter(Boolean));
const RECONCILIATION_NO_EMAIL_NAMES = new Set((PRIVATE_ASSIGNEE_RULES.reconciliation_no_email_names || [])
  .map(personKey)
  .filter(Boolean));

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a, process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1');
}

const APPLY = args.has('--apply');
const APPLY_RECONCILIATION_ONLY = args.has('--apply-reconciliation-only');
const INCREMENTAL = args.has('--incremental');
const PROJECT_FILTER = clean(args.get('--project-id'));

function fail(message) {
  console.error('B1 Linear backfill failed:', message);
  process.exit(1);
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function normalizeText(s) {
  return clean(s).toLowerCase().replace(/\s+/g, ' ');
}

function issueProjectId(issue) {
  return clean(issue && issue.project && issue.project.id
    || issue && issue.parent && issue.parent.project && issue.parent.project.id);
}

function personKey(s) {
  let t = clean(s).toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  return t.replace(/[^a-z0-9@.]+/g, '');
}

function loadPrivateAssigneeRules() {
  const inline = clean(process.env.B1_ASSIGNEE_RULES_JSON);
  const file = clean(process.env.B1_ASSIGNEE_RULES_FILE);
  const text = inline || (file ? fs.readFileSync(path.resolve(file), 'utf8') : '');
  if (!text) {
    return {
      existing_member_rules: [],
      alias_emails: {},
      reconciliation_insert_emails: [],
      reconciliation_insert_names: [],
      reconciliation_no_email_names: [],
    };
  }
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function sha(input, len = 24) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, len);
}

function parseIdentifier(v) {
  const m = clean(v).match(/\b(?:VID|GRA|CON|STR)-\d+\b/i);
  return m ? m[0].toUpperCase() : '';
}

function issueTeam(issue) {
  return issue && issue.team && issue.team.key || 'NO_TEAM';
}

function linearTeam(issue) {
  const key = issueTeam(issue);
  if (key === 'VID') return 'video';
  if (key === 'GRA') return 'graphics';
  return '';
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

function batchGroupKey(issue, attributionGraph, unresolvedClientSlug) {
  const parent = issue.parent || issue;
  const attribution = attributionForIssue(attributionGraph, issue);
  const client = storageClientSlug(attribution, unresolvedClientSlug) || 'needs_attribution';
  const title = normalizeText(parent.title || issue.title || 'Untitled batch');
  const desc = normalizeText(parent.description || '');
  return `${client}|${title}|${desc}`;
}

function batchIdForKey(key) {
  return `b1_b_${sha(key, 28)}`;
}

function deliverableId(issue) {
  return `b1_d_${clean(issue.id).replace(/[^a-zA-Z0-9]/g, '')}`;
}

function teamMemberPlan(assignee, teams) {
  const only = Array.from(teams).sort();
  let role = 'editor';
  let team = null;
  if (only.length === 1 && only[0] === 'GRA') {
    role = 'designer';
    team = 'graphics';
  } else if (only.length === 1 && only[0] === 'VID') {
    role = 'editor';
    team = 'video';
  }
  const name = clean(assignee.name || assignee.email || assignee.id);
  const email = clean(assignee.email).toLowerCase() || null;
  const omitEmail = RECONCILIATION_NO_EMAIL_NAMES.has(personKey(name));
  return {
    name,
    email: omitEmail ? null : email,
    role,
    team,
    slack_user_id: null,
    linear_user_id: clean(assignee.id),
    default_for_team: false,
    active: false,
  };
}

function assigneeEmail(assignee) {
  return clean(assignee && assignee.email).toLowerCase();
}

function assigneeNameKey(assignee) {
  return personKey(assignee && assignee.name);
}

function memberMatchesAlias(member, alias) {
  const target = personKey(alias);
  if (!target) return false;
  return [member.name, member.email].some(v => personKey(v).includes(target));
}

function approvedRuleForAssignee(assignee) {
  const email = assigneeEmail(assignee);
  const name = assigneeNameKey(assignee);
  return ASSIGNEE_EXISTING_MEMBER_RULES.find(rule => {
    const emailHit = rule.assigneeEmails.map(e => e.toLowerCase()).includes(email);
    const nameHit = rule.assigneeNames.map(personKey).includes(name);
    return emailHit || nameHit;
  }) || null;
}

function findExistingMemberForAssignee(assignee, members) {
  const rule = approvedRuleForAssignee(assignee);
  if (!rule) return null;
  const matches = members.filter(member => rule.memberNames.some(alias => memberMatchesAlias(member, alias)));
  return matches.length === 1 ? matches[0] : null;
}

function canonicalAssigneeEmail(assignee) {
  const email = assigneeEmail(assignee);
  return ASSIGNEE_ALIAS_EMAILS.get(email) || email;
}

function needsReconciliationInsert(assignee) {
  const name = assigneeNameKey(assignee);
  const email = canonicalAssigneeEmail(assignee);
  return RECONCILIATION_INSERT_NAMES.has(name) || RECONCILIATION_INSERT_EMAILS.has(email);
}

function canonicalizeAssigneeForInsert(assignee) {
  const canonicalEmail = canonicalAssigneeEmail(assignee);
  if (canonicalEmail && canonicalEmail !== assigneeEmail(assignee)) {
    const canonicalNames = PRIVATE_ASSIGNEE_RULES.canonical_names_by_email || {};
    return {
      ...assignee,
      email: canonicalEmail,
      name: clean(canonicalNames[canonicalEmail] || assignee.name || canonicalEmail),
    };
  }
  return assignee;
}

function buildAssigneeResolution(operational, existingMembers) {
  const byLinear = new Map(existingMembers.map(m => [clean(m.linear_user_id), m]).filter(([k]) => k));
  const byEmail = new Map(existingMembers.map(m => [clean(m.email).toLowerCase(), m]).filter(([k]) => k));
  const stats = new Map();
  const currentLinkUpdates = new Map();
  const insertPlansByKey = new Map();
  const unresolved = new Map();

  for (const issue of operational) {
    const assignee = issue.assignee;
    if (!assignee) continue;
    const linearId = clean(assignee.id);
    const email = assigneeEmail(assignee);
    const canonicalEmail = canonicalAssigneeEmail(assignee);
    const statKey = linearId || canonicalEmail || assigneeNameKey(assignee);
    if (!stats.has(statKey)) {
      stats.set(statKey, { assignee, count: 0, teams: new Set(), identifiers: [] });
    }
    const stat = stats.get(statKey);
    stat.count++;
    stat.teams.add(issueTeam(issue));
    stat.identifiers.push(issue.identifier);

    const existingByLinear = byLinear.get(linearId);
    if (existingByLinear) {
      if (!clean(existingByLinear.email) && email) {
        currentLinkUpdates.set(existingByLinear.id, {
          id: existingByLinear.id,
          name: existingByLinear.name,
          existing: existingByLinear,
          linear_user_id: linearId,
          email,
          source_assignee_name: clean(assignee.name || assignee.email),
          source_assignee_email: email || null,
        });
      }
      continue;
    }

    const existingByEmail = email ? byEmail.get(email) : null;
    if (existingByEmail) {
      if (!clean(existingByEmail.linear_user_id) && linearId) {
        currentLinkUpdates.set(existingByEmail.id, {
          id: existingByEmail.id,
          name: existingByEmail.name,
          existing: existingByEmail,
          linear_user_id: linearId,
          email,
          source_assignee_name: clean(assignee.name || assignee.email),
          source_assignee_email: email || null,
        });
      }
      byLinear.set(linearId, existingByEmail);
      continue;
    }

    const existing = findExistingMemberForAssignee(assignee, existingMembers);
    if (existing) {
      const needsPatch = (!clean(existing.linear_user_id) && linearId) || (!clean(existing.email) && email);
      if (needsPatch && !currentLinkUpdates.has(existing.id)) {
        currentLinkUpdates.set(existing.id, {
          id: existing.id,
          name: existing.name,
          existing,
          linear_user_id: linearId,
          email: email || null,
          source_assignee_name: clean(assignee.name || assignee.email),
          source_assignee_email: email || null,
        });
      }
      byLinear.set(linearId, existing);
      if (email) byEmail.set(email, existing);
      continue;
    }

    if (needsReconciliationInsert(assignee)) {
      const canonicalAssignee = canonicalizeAssigneeForInsert(assignee);
      const insertKey = canonicalAssigneeEmail(canonicalAssignee) || assigneeNameKey(canonicalAssignee);
      if (!insertPlansByKey.has(insertKey)) {
        insertPlansByKey.set(insertKey, { assignee: canonicalAssignee, teams: new Set(), count: 0, identifiers: [] });
      }
      const plan = insertPlansByKey.get(insertKey);
      plan.count++;
      plan.teams.add(issueTeam(issue));
      plan.identifiers.push(issue.identifier);
      continue;
    }

    if (!unresolved.has(statKey)) unresolved.set(statKey, stat);
  }

  const linkUpdates = Array.from(currentLinkUpdates.values()).sort((a, b) => a.name.localeCompare(b.name));
  const inserts = Array.from(insertPlansByKey.values()).map(row => ({
    ...teamMemberPlan(row.assignee, row.teams),
    count: row.count,
    teams: Array.from(row.teams).sort(),
    sample_identifiers: row.identifiers.slice(0, 10),
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const unresolvedPlans = Array.from(unresolved.values()).map(row => ({
    ...teamMemberPlan(row.assignee, row.teams),
    count: row.count,
    teams: Array.from(row.teams).sort(),
    sample_identifiers: row.identifiers.slice(0, 10),
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const distinct = Array.from(stats.values()).map(row => ({
    ...teamMemberPlan(row.assignee, row.teams),
    count: row.count,
    teams: Array.from(row.teams).sort(),
    sample_identifiers: row.identifiers.slice(0, 10),
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { distinct, linkUpdates, inserts, unresolved: unresolvedPlans };
}

function stableJson(value) {
  return JSON.stringify(value == null ? null : value);
}

function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (typeof a === 'object' || typeof b === 'object') return stableJson(a) === stableJson(b);
  return clean(a) === clean(b);
}

async function linear(query, variables) {
  if (!LINEAR_API_KEY) fail('LINEAR_API_KEY or a supported Linear token env var is required');
  const resp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: LINEAR_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.errors) {
    throw new Error(`Linear GraphQL failed: HTTP ${resp.status} ${JSON.stringify(json && json.errors || json).slice(0, 500)}`);
  }
  return json.data;
}

async function loadIssues(options = {}) {
  const nodes = [];
  let after = null;
  const delay = Math.max(0, Number(args.get('--page-delay-ms') || 280));
  const filter = options.updatedSince ? { updatedAt: { gte: options.updatedSince } } : null;
  const query = `
    query B1BackfillIssues($after: String, $filter: IssueFilter) {
      issues(first: 100, after: $after, includeArchived: true, filter: $filter) {
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
    const data = await linear(query, { after, filter });
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

async function supabaseInsert(table, rows) {
  if (!rows.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const resp = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(batch),
    });
    if (!resp.ok) throw new Error(`Supabase insert ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
    out.push(...await resp.json());
  }
  return out;
}

async function supabaseUpsert(table, rows, onConflict) {
  if (!rows.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const url = `${SUPA_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(batch),
    });
    if (!resp.ok) throw new Error(`Supabase upsert ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
    out.push(...await resp.json());
  }
  return out;
}

async function supabasePatch(table, idColumn, id, patch) {
  const keys = Object.keys(patch).filter(k => patch[k] !== undefined);
  if (!keys.length) return [];
  const url = `${SUPA_URL}/rest/v1/${table}?${encodeURIComponent(idColumn)}=eq.${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(`Supabase patch ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
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

async function writeSystemEvent(action, payload) {
  await supabaseInsert('deliverable_events', [{
    client_slug: '_system',
    action,
    source: 'system',
    payload,
  }]);
}

async function latestIncrementalEvent() {
  const rows = await supabaseRows(
    'deliverable_events',
    'id,ts,payload',
    '&source=eq.system&action=eq.linear_incremental_refresh&order=ts.desc&limit=1',
  );
  return rows[0] || null;
}

function minutesAgoIso(minutes) {
  return new Date(Date.now() - Math.max(0, Number(minutes || 0)) * 60000).toISOString();
}

async function incrementalChangedSince() {
  const explicit = clean(args.get('--changed-since'));
  if (explicit) return new Date(explicit).toISOString();
  const last = await latestIncrementalEvent();
  const overlap = Math.max(0, Number(args.get('--overlap-minutes') || 5));
  const lastFinished = last && last.payload && clean(last.payload.finished_at || last.payload.started_at || last.ts);
  if (lastFinished) return new Date(new Date(lastFinished).getTime() - overlap * 60000).toISOString();
  return minutesAgoIso(Number(args.get('--since-minutes') || 30));
}

function activeCardRows(calendarRows, sampleRows) {
  const cards = [];
  for (const [origin, rows] of [['calendar', calendarRows], ['samples', sampleRows]]) {
    for (const row of rows) {
      if (clean(row.status).toLowerCase() === 'archived') continue;
      cards.push({ origin, ...row });
    }
  }
  return cards;
}

function cardLinkMap(cards) {
  const map = new Map();
  for (const card of cards) {
    for (const [kind, col] of [['video', 'linear_issue_id'], ['thumbnail', 'graphic_linear_issue_id']]) {
      const identifier = parseIdentifier(card[col]);
      if (!identifier) continue;
      if (!map.has(identifier)) map.set(identifier, []);
      map.get(identifier).push({
        identifier,
        origin: card.origin,
        client_slug: card.client,
        card_id: card.id,
        kind,
        url: card[col],
      });
    }
  }
  for (const links of map.values()) {
    links.sort((a, b) => `${a.origin}|${a.client_slug}|${a.card_id}|${a.kind}`.localeCompare(`${b.origin}|${b.client_slug}|${b.card_id}|${b.kind}`));
  }
  return map;
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

function batchRowsFor(operational, attributionGraph, unresolvedClientSlug) {
  const groups = new Map();
  for (const issue of operational) {
    const key = batchGroupKey(issue, attributionGraph, unresolvedClientSlug);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  return Array.from(groups.entries()).map(([key, group]) => {
    const first = group[0];
    const parent = first.parent || first;
    const attribution = attributionForIssue(attributionGraph, first);
    const clientSlug = storageClientSlug(attribution, unresolvedClientSlug);
    const teams = new Set(group.map(linearTeam).filter(Boolean));
    const parentIds = {};
    for (const issue of group) {
      const p = issue.parent || issue;
      const team = linearTeam(p);
      if (!team || parentIds[team]) continue;
      parentIds[team] = {
        uuid: p.id,
        identifier: p.identifier,
        url: p.url,
      };
    }
    return {
      id: batchIdForKey(key),
      client_slug: clientSlug,
      team: teams.size === 1 ? Array.from(teams)[0] : null,
      name: clean(parent.title || first.title || 'Untitled batch'),
      description: clean(parent.description || '') || null,
      status: 'active',
      created_by: 'linear-backfill',
      created_at: parent.createdAt || first.createdAt || new Date().toISOString(),
      linear_parent_ids: parentIds,
      _issues: group,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function deliverableRow(
  issue,
  batchByKey,
  memberByLinear,
  memberByEmail,
  linksByIdentifier,
  attributionGraph,
  unresolvedClientSlug,
) {
  const attribution = attributionForIssue(attributionGraph, issue);
  const clientSlug = storageClientSlug(attribution, unresolvedClientSlug);
  const kind = classifyKind(issue);
  const links = linksByIdentifier.get(clean(issue.identifier).toUpperCase()) || [];
  const preferred = links.find(l => l.kind === kind) || null;
  const assigneeId = issue.assignee
    ? (memberByLinear.get(clean(issue.assignee.id)) || memberByEmail.get(clean(issue.assignee.email).toLowerCase()) || {}).id
    : null;
  return {
    id: deliverableId(issue),
    identifier: clean(issue.identifier),
    batch_id: batchByKey.get(batchGroupKey(issue, attributionGraph, unresolvedClientSlug)).id,
    client_slug: clientSlug,
    team: linearTeam(issue),
    kind,
    title: clean(issue.title || issue.identifier || 'Untitled deliverable'),
    brief: clean(issue.description || ''),
    status: linearStatusSlug(issue) || 'in_progress',
    status_at: issue.updatedAt || issue.createdAt || null,
    assignee_id: assigneeId || null,
    due_date: clean(issue.dueDate) || null,
    priority: issue.priority == null ? null : Number(issue.priority),
    file_url: null,
    comments: null,
    origin: preferred ? preferred.origin : 'manual',
    card_id: preferred ? preferred.card_id : null,
    sync_state: 'clean',
    created_by: 'linear-backfill',
    created_at: issue.createdAt || new Date().toISOString(),
    linear_issue_uuid: clean(issue.id),
    linear_identifier: clean(issue.identifier),
    linear_issue_url: clean(issue.url),
    linear_aliases: { identifier: issue.identifier, url: issue.url },
    linear_raw: withAttribution({
      issue,
      backfill: {
        card_links: links,
        selected_card_link: preferred,
        duplicate_card_link_count: links.length,
        delivery_link_sweep: 'not_run_non_blocking',
      },
    }, attribution),
  };
}

function archiveRow(issue, operationalSet, attributionGraph, unresolvedClientSlug) {
  const attribution = attributionForIssue(attributionGraph, issue);
  const clientSlug = storageClientSlug(attribution, unresolvedClientSlug);
  const parent = issue.parent || {};
  return {
    linear_uuid: clean(issue.id),
    identifier: clean(issue.identifier),
    aliases: { identifier: issue.identifier, url: issue.url },
    team: issueTeam(issue),
    client_slug: clientSlug,
    parent_uuid: clean(parent.id),
    parent_identifier: clean(parent.identifier),
    title: clean(issue.title),
    state: clean(issue.state && issue.state.name),
    assignee_name: clean(issue.assignee && issue.assignee.name),
    assignee_email: clean(issue.assignee && issue.assignee.email).toLowerCase() || null,
    due_date: clean(issue.dueDate) || null,
    priority: issue.priority == null ? null : Number(issue.priority),
    created_at: issue.createdAt || null,
    completed_at: issue.completedAt || issue.canceledAt || null,
    archived_at: issue.archivedAt || null,
    comments: null,
    raw: withAttribution({
      issue,
      archive_reason: operationalSet.has(issue.id) ? 'operational' : 'non_operational_issue_level_backfill',
    }, attribution),
  };
}

function attributionRepairRows(issues, attributionGraph) {
  return (issues || []).map(issue => {
    const attribution = attributionForIssue(attributionGraph, issue);
    return {
      linear_issue_uuid: clean(issue.id),
      identifier: clean(issue.identifier),
      state: clean(attribution && attribution.state) || 'needs_attribution',
      source: clean(attribution && attribution.source) || 'none',
      repair_required: !attribution || attribution.repair_required === true,
      mapping_revision: clean(attribution && attribution.mapping_revision),
    };
  }).filter(row => row.state !== 'resolved' || row.repair_required);
}

function unresolvedAttributionSentinel(clients) {
  // Legacy schema requires a client_slug FK. This value is storage-only:
  // linear_raw.attribution remains needs/provisional/conflict and the UI must
  // never present the sentinel as a normal roster client.
  return (clients || []).some(row => clean(row && row.slug) === 'unattributed')
    ? 'unattributed'
    : '';
}

function unresolvedAssigneePlans(operational, existingMembers) {
  const byLinear = new Map(existingMembers.map(m => [clean(m.linear_user_id), m]).filter(([k]) => k));
  const byEmail = new Map(existingMembers.map(m => [clean(m.email).toLowerCase(), m]).filter(([k]) => k));
  const missing = new Map();
  for (const issue of operational) {
    const a = issue.assignee;
    if (!a) continue;
    const id = clean(a.id);
    const email = clean(a.email).toLowerCase();
    if (byLinear.has(id) || (email && byEmail.has(email))) continue;
    if (!missing.has(id)) missing.set(id, { assignee: a, count: 0, teams: new Set(), identifiers: [] });
    const row = missing.get(id);
    row.count++;
    row.teams.add(issueTeam(issue));
    row.identifiers.push(issue.identifier);
  }
  return Array.from(missing.values())
    .map(row => ({ ...teamMemberPlan(row.assignee, row.teams), count: row.count, teams: Array.from(row.teams).sort(), sample_identifiers: row.identifiers.slice(0, 10) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function memberLookups(members) {
  const byLinear = new Map(members.map(m => [clean(m.linear_user_id), m]).filter(([k]) => k));
  const byEmail = new Map(members.map(m => [clean(m.email).toLowerCase(), m]).filter(([k]) => k));
  for (const [alias, canonical] of ASSIGNEE_ALIAS_EMAILS.entries()) {
    const member = byEmail.get(canonical);
    if (member) byEmail.set(alias, member);
  }
  return { byLinear, byEmail };
}

function addPlannedAssigneeInsertToLookups(memberByLinear, memberByEmail, plan) {
  const fakeMember = { id: null, ...plan };
  if (plan.linear_user_id) memberByLinear.set(plan.linear_user_id, fakeMember);
  if (plan.email) memberByEmail.set(plan.email, fakeMember);
  for (const [alias, canonical] of ASSIGNEE_ALIAS_EMAILS.entries()) {
    if (plan.email === canonical) memberByEmail.set(alias, fakeMember);
  }
}

function addPendingLinkUpdateToLookups(memberByLinear, memberByEmail, update) {
  const pendingMember = { ...update.existing, id: update.id };
  if (update.linear_user_id) memberByLinear.set(update.linear_user_id, pendingMember);
  if (update.email) memberByEmail.set(update.email, pendingMember);
}

function oddAssignee(plan) {
  const s = `${plan.name} ${plan.email || ''}`.toLowerCase();
  return /\b(bot|automation|n8n|zapier|api|linear)\b/.test(s);
}

function compareRow(existing, row, fields) {
  if (!existing) return false;
  return fields.every(f => sameValue(existing[f], row[f]));
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(v => clean(v).replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');
}

async function buildPlan() {
  const asOf = args.get('--as-of') || '2026-07-05T00:00:00.000Z';
  const cutoffMonths = Number(args.get('--cutoff-months') || 12);
  const [
    issues,
    clients,
    members,
    calendarRows,
    sampleRows,
    existingBatches,
    existingDeliverables,
    existingArchive,
    existingEvents,
  ] = await Promise.all([
    loadIssues(),
    supabaseRows('clients', 'slug,display_name,kind,active,source,linear_project_ids'),
    supabaseRows('team_members', 'id,name,email,role,team,linear_user_id,active'),
    supabaseRows('calendar_posts', 'client,id,status,linear_issue_id,graphic_linear_issue_id'),
    supabaseRows('sample_reviews', 'client,id,status,linear_issue_id,graphic_linear_issue_id'),
    supabaseRows('batches', 'id,client_slug,team,name,description,status,created_by,linear_parent_ids'),
    supabaseRows('deliverables', 'id,identifier,batch_id,client_slug,team,kind,title,status,assignee_id,due_date,priority,origin,card_id,linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw'),
    supabaseRows('linear_archive', 'linear_uuid,identifier,title,state,client_slug,team'),
    supabaseRows('deliverable_events', 'id,deliverable_id,batch_id,client_slug,action,source,payload'),
  ]);

  const cards = activeCardRows(calendarRows, sampleRows);
  const linksByIdentifier = cardLinkMap(cards);
  const linkedIdentifiers = new Set(Array.from(linksByIdentifier.keys()));
  const operational = operationalIssues(issues, linkedIdentifiers, asOf, cutoffMonths);
  const operationalSet = new Set(operational.map(i => i.id));
  const issueScope = new Set(issues.map(issue => clean(issue.id)).filter(Boolean));
  const explicitClassifications = persistedExplicitClassifications(
    existingDeliverables.filter(row => issueScope.has(clean(row.linear_issue_uuid))),
    clients,
  );
  const attributionGraph = resolveAttributionGraph(issues, clients, {
    explicitClassifications,
    familyComplete: true,
  });
  const unresolvedClientSlug = unresolvedAttributionSentinel(clients);
  const batches = batchRowsFor(operational, attributionGraph, unresolvedClientSlug);
  const batchByKey = new Map();
  for (const b of batches) {
    for (const issue of b._issues) {
      batchByKey.set(batchGroupKey(issue, attributionGraph, unresolvedClientSlug), b);
    }
  }
  const assigneeResolution = buildAssigneeResolution(operational, members);

  const { byLinear: memberByLinear, byEmail: memberByEmail } = memberLookups(members);
  for (const update of assigneeResolution.linkUpdates) addPendingLinkUpdateToLookups(memberByLinear, memberByEmail, update);
  for (const m of assigneeResolution.inserts) addPlannedAssigneeInsertToLookups(memberByLinear, memberByEmail, m);

  const existingBatchById = new Map(existingBatches.map(r => [r.id, r]));
  const existingDeliverableById = new Map(existingDeliverables.map(r => [r.id, r]));
  const existingArchiveById = new Map(existingArchive.map(r => [r.linear_uuid, r]));
  const deliverables = operational.map(issue => deliverableRow(
    issue,
    batchByKey,
    memberByLinear,
    memberByEmail,
    linksByIdentifier,
    attributionGraph,
    unresolvedClientSlug,
  ));
  const archive = issues.filter(issue => !operationalSet.has(issue.id))
    .map(issue => archiveRow(issue, operationalSet, attributionGraph, unresolvedClientSlug));

  const batchFields = ['client_slug', 'team', 'name', 'description', 'status', 'created_by'];
  const deliverableFields = ['identifier', 'batch_id', 'client_slug', 'team', 'kind', 'title', 'status', 'assignee_id', 'due_date', 'priority', 'origin', 'card_id', 'linear_issue_uuid', 'linear_identifier', 'linear_issue_url', 'linear_raw'];
  const archiveFields = ['identifier', 'title', 'state', 'client_slug', 'team'];
  const batchWrites = batches.filter(r => r.client_slug
    && !compareRow(existingBatchById.get(r.id), r, batchFields));
  const deliverableWrites = deliverables.filter(r => r.client_slug
    && !compareRow(existingDeliverableById.get(r.id), r, deliverableFields));
  const archiveWrites = archive.filter(r => r.client_slug
    && !compareRow(existingArchiveById.get(r.linear_uuid), r, archiveFields));
  const otherKind = deliverables.filter(d => d.kind === 'other').map(d => ({ identifier: d.identifier, title: d.title, team: d.team }));

  const eventSourceCounts = existingEvents.reduce((acc, e) => {
    acc[e.source] = (acc[e.source] || 0) + 1;
    return acc;
  }, {});

  return {
    generated_at: new Date().toISOString(),
    mode: APPLY ? 'apply' : APPLY_RECONCILIATION_ONLY ? 'apply-reconciliation-only' : 'plan',
    as_of: asOf,
    cutoff_months: cutoffMonths,
    issue_count_total: issues.length,
    operational_count: operational.length,
    archive_count: archive.length,
    linked_live_card_included: operational.filter(i => linkedIdentifiers.has(clean(i.identifier).toUpperCase())).length,
    missing_clients: [],
    attribution: attributionGraph.summary,
    attribution_repairs: attributionRepairRows(issues, attributionGraph),
    attribution_storage_sentinel_present: !!unresolvedClientSlug,
    missing_assignees: assigneeResolution.distinct,
    team_member_link_updates: assigneeResolution.linkUpdates,
    team_member_inserts: assigneeResolution.inserts,
    unhandled_assignees: assigneeResolution.unresolved,
    odd_assignees: assigneeResolution.unresolved.filter(oddAssignee),
    batches: batches.map(({ _issues, ...r }) => r),
    deliverables,
    archive,
    writes: {
      clients: [],
      team_members: assigneeResolution.inserts.map(({ count, teams, sample_identifiers, ...row }) => row),
      team_member_link_updates: assigneeResolution.linkUpdates.map(({ existing, name, ...row }) => row),
      batches: batchWrites.map(({ _issues, ...r }) => r),
      deliverables: deliverableWrites,
      linear_archive: archiveWrites,
    },
    other_kind_titles: otherKind,
    batch_shapes: batchShapeSummary(batches),
    existing_counts: {
      batches: existingBatches.length,
      deliverables: existingDeliverables.length,
      linear_archive: existingArchive.length,
      deliverable_events: existingEvents.length,
    },
    event_source_counts: eventSourceCounts,
    raw: { issues },
  };
}

function batchShapeSummary(batches) {
  let mirrored = 0;
  let videoOnly = 0;
  let graphicsOnly = 0;
  let mixed = 0;
  for (const batch of batches) {
    const parents = batch.linear_parent_ids || {};
    if (parents.video && parents.graphics) mirrored++;
    else if (batch.team === 'video') videoOnly++;
    else if (batch.team === 'graphics') graphicsOnly++;
    else mixed++;
  }
  return {
    total_batches: batches.length,
    mirrored_pair_batches: mirrored,
    video_only_batches: videoOnly,
    graphics_only_batches: graphicsOnly,
    mixed_or_null_team_batches: mixed,
  };
}

function softClosedDeliverableRow(issue, existing, attributionGraph, unresolvedClientSlug) {
  const attribution = attributionForIssue(attributionGraph, issue);
  const fallbackStatus = issue.state && issue.state.type === 'canceled'
    ? 'canceled'
    : issue.state && issue.state.type === 'completed'
      ? 'approved'
      : existing.status || 'approved';
  return {
    id: existing.id,
    identifier: existing.identifier || clean(issue.identifier),
    batch_id: existing.batch_id,
    client_slug: storageClientSlug(attribution, unresolvedClientSlug),
    team: existing.team || linearTeam(issue),
    kind: existing.kind || classifyKind(issue),
    title: clean(issue.title || existing.title || issue.identifier || 'Untitled deliverable'),
    brief: clean(issue.description || ''),
    status: linearStatusSlug(issue) || fallbackStatus,
    status_at: issue.updatedAt || new Date().toISOString(),
    assignee_id: existing.assignee_id || null,
    due_date: clean(issue.dueDate) || null,
    priority: issue.priority == null ? null : Number(issue.priority),
    origin: existing.origin || 'manual',
    card_id: existing.card_id || null,
    sync_state: 'clean',
    created_by: existing.created_by || 'linear-backfill',
    created_at: existing.created_at || issue.createdAt || new Date().toISOString(),
    linear_issue_uuid: clean(issue.id),
    linear_identifier: clean(issue.identifier),
    linear_issue_url: clean(issue.url),
    linear_aliases: { identifier: issue.identifier, url: issue.url },
    linear_raw: withAttribution({
      issue,
      incremental_refresh: {
        soft_handled: true,
        reason: closedAt(issue) ? 'closed_or_archived' : 'outside_operational_window',
      },
    }, attribution),
  };
}

async function buildIncrementalPlan() {
  const startedAt = new Date().toISOString();
  const asOf = args.get('--as-of') || startedAt;
  const cutoffMonths = Number(args.get('--cutoff-months') || 12);
  const authorityState = await loadAuthority({
    cachePath: AUTHORITY_CACHE_PATH,
    key: SUPA_KEY || undefined,
    supabaseUrl: SUPA_URL,
  });
  const prodAuthority = authorityState.authority;
  const changedSince = await incrementalChangedSince();
  const [
    loadedIssues,
    clients,
    members,
    calendarRows,
    sampleRows,
    existingBatches,
    existingDeliverables,
    existingArchive,
  ] = await Promise.all([
    loadIssues({ updatedSince: changedSince }),
    supabaseRows('clients', 'slug,display_name,kind,active,source,linear_project_ids'),
    supabaseRows('team_members', 'id,name,email,role,team,linear_user_id,active'),
    supabaseRows('calendar_posts', 'client,id,status,linear_issue_id,graphic_linear_issue_id'),
    supabaseRows('sample_reviews', 'client,id,status,linear_issue_id,graphic_linear_issue_id'),
    supabaseRows('batches', 'id,client_slug,team,name,description,status,created_by,linear_parent_ids'),
    supabaseRows('deliverables', 'id,identifier,batch_id,client_slug,team,kind,title,status,assignee_id,due_date,priority,origin,card_id,created_by,created_at,linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw'),
    supabaseRows('linear_archive', 'linear_uuid,identifier,title,state,client_slug,team'),
  ]);
  const issues = PROJECT_FILTER
    ? loadedIssues.filter(issue => issueProjectId(issue) === PROJECT_FILTER)
    : loadedIssues;

  const cards = activeCardRows(calendarRows, sampleRows);
  const linksByIdentifier = cardLinkMap(cards);
  const linkedIdentifiers = new Set(Array.from(linksByIdentifier.keys()));
  const existingDeliverableByUuid = new Map(existingDeliverables.map(r => [clean(r.linear_issue_uuid), r]).filter(([k]) => k));
  const operational = issues.filter(issue => {
    if (!isTrackIssue(issue) || !isOpenIssue(issue)) return false;
    const created = issue.createdAt ? new Date(issue.createdAt) : null;
    const linked = linkedIdentifiers.has(clean(issue.identifier).toUpperCase());
    const alreadyTracked = existingDeliverableByUuid.has(clean(issue.id));
    const cutoff = new Date(asOf);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - cutoffMonths);
    return linked || alreadyTracked || (created && created >= cutoff);
  });
  const operationalSet = new Set(operational.map(i => i.id));
  const operationalById = new Map(operational.map(i => [clean(i.id), i]));
  const nonOperational = issues.filter(issue => !operationalById.has(clean(issue.id)));
  // Incremental Linear input is not a complete family snapshot. Direct and
  // embedded-ancestor mappings are safe; child-family inference stays off.
  const issueScope = new Set(issues.map(issue => clean(issue.id)).filter(Boolean));
  const explicitClassifications = persistedExplicitClassifications(
    existingDeliverables.filter(row => issueScope.has(clean(row.linear_issue_uuid))),
    clients,
  );
  const attributionGraph = resolveAttributionGraph(issues, clients, {
    explicitClassifications,
    familyComplete: false,
  });
  const unresolvedClientSlug = unresolvedAttributionSentinel(clients);
  const batches = batchRowsFor(operational, attributionGraph, unresolvedClientSlug);
  const batchByKey = new Map();
  for (const b of batches) {
    for (const issue of b._issues) {
      batchByKey.set(batchGroupKey(issue, attributionGraph, unresolvedClientSlug), b);
    }
  }

  const { byLinear: memberByLinear, byEmail: memberByEmail } = memberLookups(members);
  const deliverables = operational.map(issue => deliverableRow(
    issue,
    batchByKey,
    memberByLinear,
    memberByEmail,
    linksByIdentifier,
    attributionGraph,
    unresolvedClientSlug,
  ));
  const softHandledDeliverables = nonOperational
    .map(issue => ({ issue, existing: existingDeliverableByUuid.get(clean(issue.id)) }))
    .filter(row => row.existing)
    .map(row => softClosedDeliverableRow(
      row.issue,
      row.existing,
      attributionGraph,
      unresolvedClientSlug,
    ));
  const archive = nonOperational
    .map(issue => archiveRow(issue, operationalSet, attributionGraph, unresolvedClientSlug));

  const existingBatchById = new Map(existingBatches.map(r => [r.id, r]));
  const existingDeliverableById = new Map(existingDeliverables.map(r => [r.id, r]));
  const existingArchiveById = new Map(existingArchive.map(r => [r.linear_uuid, r]));
  const batchFields = ['client_slug', 'team', 'name', 'description', 'status', 'created_by'];
  const deliverableFields = ['identifier', 'batch_id', 'client_slug', 'team', 'kind', 'title', 'status', 'assignee_id', 'due_date', 'priority', 'origin', 'card_id', 'linear_issue_uuid', 'linear_identifier', 'linear_issue_url', 'linear_raw'];
  const archiveFields = ['identifier', 'title', 'state', 'client_slug', 'team'];
  const deliverableCandidates = [...deliverables, ...softHandledDeliverables];
  const batchCandidates = batches.filter(r => r.client_slug
    && !compareRow(existingBatchById.get(r.id), r, batchFields));
  const deliverableWriteCandidates = deliverableCandidates.filter(r => r.client_slug
    && !compareRow(existingDeliverableById.get(r.id), r, deliverableFields));
  const batchAllowed = row => authorityState.write_safe === true
    && (row._issues || []).every(issue => authorityForTeam(prodAuthority, linearTeam(issue)) === 'linear');
  const deliverableAllowed = row => authorityState.write_safe === true
    && authorityForTeam(prodAuthority, row.team) === 'linear';
  const allowedBatches = batchCandidates.filter(batchAllowed);
  const gatedBatches = batchCandidates.filter(row => !batchAllowed(row));
  const allowedDeliverables = deliverableWriteCandidates.filter(deliverableAllowed);
  const gatedDeliverables = deliverableWriteCandidates.filter(row => !deliverableAllowed(row));
  return {
    generated_at: startedAt,
    mode: 'incremental',
    as_of: asOf,
    cutoff_months: cutoffMonths,
    project_filter: PROJECT_FILTER || null,
    changed_since: changedSince,
    changed_issue_count: issues.length,
    operational_count: operational.length,
    soft_handled_count: softHandledDeliverables.length,
    archive_count: archive.length,
    attribution: attributionGraph.summary,
    attribution_repairs: attributionRepairRows(issues, attributionGraph),
    attribution_storage_sentinel_present: !!unresolvedClientSlug,
    authority: {
      value: prodAuthority,
      source: authorityState.source,
      write_safe: authorityState.write_safe === true,
      warning: authorityState.warning || null,
    },
    gated: {
      batch_write_candidates: gatedBatches.length,
      deliverable_write_candidates: gatedDeliverables.length,
      by_team: {
        video: gatedDeliverables.filter(row => row.team === 'video').length,
        graphics: gatedDeliverables.filter(row => row.team === 'graphics').length,
      },
    },
    writes: {
      clients: [],
      batches: allowedBatches.map(({ _issues, ...r }) => r),
      deliverables: allowedDeliverables,
      linear_archive: archive.filter(r => r.client_slug
        && !compareRow(existingArchiveById.get(r.linear_uuid), r, archiveFields)),
    },
    raw: { issues },
  };
}

async function applyIncrementalPlan(plan) {
  const startedAt = new Date().toISOString();
  let result = {
    inserted_clients: 0,
    batch_rpc_writes: 0,
    deliverable_rpc_writes: 0,
    archive_upserts: 0,
    summary_event_written: 0,
  };
  try {
    for (const batch of plan.writes.batches) {
      await assertFreshLinearAuthority(batch.team || ['video', 'graphics']);
      await supabaseRpc('batch_write', {
        p_row: batch,
        p_event: {
          source: 'system',
          action: 'linear_incremental_batch_refresh',
          actor: 'codex-b1-incremental',
          payload: { incremental: true, idempotent_id: batch.id, changed_since: plan.changed_since },
        },
      });
      result.batch_rpc_writes++;
    }

    for (const deliverable of plan.writes.deliverables) {
      await assertFreshLinearAuthority(deliverable.team);
      await supabaseRpc('deliverable_write', {
        p_row: deliverable,
        p_event: {
          source: 'system',
          action: 'linear_incremental_refresh',
          actor: 'codex-b1-incremental',
          payload: {
            incremental: true,
            linear_issue_uuid: deliverable.linear_issue_uuid,
            changed_since: plan.changed_since,
          },
        },
      });
      result.deliverable_rpc_writes++;
    }

    const archiveRows = plan.writes.linear_archive.map(row => {
      const { linear_raw, ...out } = row;
      return out;
    });
    result.archive_upserts = (await supabaseUpsert('linear_archive', archiveRows, 'linear_uuid')).length;
    const finishedAt = new Date().toISOString();
    await writeSystemEvent('linear_incremental_refresh', {
      ok: true,
      started_at: startedAt,
      finished_at: finishedAt,
      changed_since: plan.changed_since,
      project_filter: plan.project_filter,
      changed_issue_count: plan.changed_issue_count,
      operational_count: plan.operational_count,
      soft_handled_count: plan.soft_handled_count,
      archive_count: plan.archive_count,
      authority: plan.authority,
      gated: plan.gated,
      writes: result,
    });
    result.summary_event_written = 1;
    return result;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    await writeSystemEvent('linear_incremental_refresh', {
      ok: false,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      changed_since: plan.changed_since,
      project_filter: plan.project_filter,
      changed_issue_count: plan.changed_issue_count,
      authority: plan.authority,
      gated: plan.gated,
      error: message.slice(0, 500),
      writes: result,
    }).catch(() => {});
    throw err;
  }
}

async function applyReconciliation(plan) {
  if (plan.unhandled_assignees.length) {
    fail(`unhandled assignees detected; refusing to apply: ${plan.unhandled_assignees.map(a => a.name).join(', ')}`);
  }
  await supabaseInsert('team_members', plan.writes.team_members);

  let patchedMembers = 0;
  for (const update of plan.team_member_link_updates) {
    const patch = {};
    const existing = update.existing || {};
    if (!clean(existing.linear_user_id) && update.linear_user_id) patch.linear_user_id = update.linear_user_id;
    if (!clean(existing.email) && update.email) patch.email = update.email;
    if (!Object.keys(patch).length) continue;
    await supabasePatch('team_members', 'id', update.id, patch);
    patchedMembers++;
  }

  return {
    inserted_clients: 0,
    inserted_team_members: plan.writes.team_members.length,
    patched_team_members: patchedMembers,
  };
}

async function applyPlan(plan) {
  const reconciliation = await applyReconciliation(plan);

  const members = await supabaseRows('team_members', 'id,name,email,role,team,linear_user_id,active');
  const { byLinear: memberByLinear, byEmail: memberByEmail } = memberLookups(members);
  for (const deliverable of plan.writes.deliverables) {
    const issue = deliverable.linear_raw && deliverable.linear_raw.issue || {};
    if (issue.assignee && !deliverable.assignee_id) {
      const byId = memberByLinear.get(clean(issue.assignee.id));
      const byEmail = memberByEmail.get(clean(issue.assignee.email).toLowerCase());
      deliverable.assignee_id = (byId || byEmail || {}).id || null;
    }
  }

  let batchWritten = 0;
  for (const batch of plan.writes.batches) {
    await assertFreshLinearAuthority(batch.team || ['video', 'graphics']);
    await supabaseRpc('batch_write', {
      p_row: batch,
      p_event: {
        source: 'backfill',
        action: 'batch_create',
        actor: 'codex-b1-backfill',
        payload: { backfill: 'b1', idempotent_id: batch.id },
      },
    });
    batchWritten++;
  }

  let deliverableWritten = 0;
  for (const deliverable of plan.writes.deliverables) {
    await assertFreshLinearAuthority(deliverable.team);
    await supabaseRpc('deliverable_write', {
      p_row: deliverable,
      p_event: {
        source: 'backfill',
        action: 'create',
        actor: 'codex-b1-backfill',
        payload: { backfill: 'b1', linear_issue_uuid: deliverable.linear_issue_uuid },
      },
    });
    deliverableWritten++;
  }

  const archiveRows = plan.writes.linear_archive.map(row => {
    const { linear_raw, ...out } = row;
    return out;
  });
  const archived = await supabaseUpsert('linear_archive', archiveRows, 'linear_uuid');
  return {
    ...reconciliation,
    batch_rpc_writes: batchWritten,
    deliverable_rpc_writes: deliverableWritten,
    archive_upserts: archived.length,
  };
}

async function verify(plan) {
  const [batches, deliverables, archive, events] = await Promise.all([
    supabaseRows('batches', 'id,client_slug,team,status,linear_parent_ids'),
    supabaseRows('deliverables', 'id,identifier,batch_id,client_slug,team,kind,title,status,assignee_id,due_date,priority,origin,card_id,linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw'),
    supabaseRows('linear_archive', 'linear_uuid,identifier,title,state,client_slug,team'),
    supabaseRows('deliverable_events', 'id,deliverable_id,batch_id,client_slug,action,source,payload'),
  ]);
  const deliverableByUuid = new Map(deliverables.map(d => [d.linear_issue_uuid, d]));
  const issueByUuid = new Map(plan.raw.issues.map(i => [i.id, i]));
  const spots = plan.deliverables.slice()
    .sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }))
    .filter((_, i) => i % Math.max(1, Math.floor(plan.deliverables.length / 20)) === 0)
    .slice(0, 20)
    .map(expected => {
      const issue = issueByUuid.get(expected.linear_issue_uuid);
      const got = deliverableByUuid.get(expected.linear_issue_uuid);
      const assigneeRaw = issue && issue.assignee ? clean(issue.assignee.name || issue.assignee.email) : '';
      return {
        identifier: expected.identifier,
        ok: !!got
          && got.title === expected.title
          && got.status === expected.status
          && clean(got.due_date) === clean(expected.due_date)
          && Number(got.priority || 0) === Number(expected.priority || 0),
        title: got && got.title,
        status: got && got.status,
        due_date: got && got.due_date,
        priority: got && got.priority,
        linear_assignee: assigneeRaw,
      };
    });
  const eventSourceCounts = events.reduce((acc, e) => {
    acc[e.source] = (acc[e.source] || 0) + 1;
    return acc;
  }, {});
  const migrationEvent = e => (e.source === 'backfill' || e.source === 'system');
  const deliverableEventIds = new Set(events.filter(e => migrationEvent(e) && e.deliverable_id).map(e => e.deliverable_id));
  const batchEventIds = new Set(events.filter(e => migrationEvent(e) && e.batch_id && !e.deliverable_id).map(e => e.batch_id));
  return {
    counts: {
      batches: batches.length,
      deliverables: deliverables.length,
      linear_archive: archive.length,
      deliverable_events: events.length,
    },
    expected: {
      batches: plan.batches.length,
      deliverables: plan.deliverables.length,
      linear_archive: plan.archive.length,
    },
    event_source_counts: eventSourceCounts,
    all_events_backfill: Object.keys(eventSourceCounts).every(k => k === 'backfill' || k === 'system'),
    deliverables_with_backfill_event: deliverables.filter(d => deliverableEventIds.has(d.id)).length,
    batches_with_backfill_event: batches.filter(b => batchEventIds.has(b.id)).length,
    spot_parity: spots,
    spot_parity_passed: spots.filter(s => s.ok).length,
    replay_verify: {
      deliverable_count_matches: deliverables.length === plan.deliverables.length,
      batch_count_matches: batches.length === plan.batches.length,
      archive_count_matches: archive.length === plan.archive.length,
      event_coverage_matches: deliverables.every(d => deliverableEventIds.has(d.id)) && batches.every(b => batchEventIds.has(b.id)),
    },
  };
}

function render(plan, applyResult, verification) {
  const lines = [];
  lines.push('# B1 Linear Backfill Plan');
  lines.push('');
  lines.push(`Generated: ${plan.generated_at}`);
  lines.push(`Mode: ${plan.mode}`);
  lines.push(`Cutoff: ${plan.cutoff_months} months as of ${plan.as_of}`);
  lines.push(`Operational deliverables: ${plan.operational_count}`);
  lines.push(`Archive rows: ${plan.archive_count}`);
  lines.push(`Linked live-card included: ${plan.linked_live_card_included}`);
  lines.push('');
  lines.push('## Planned Writes');
  lines.push('');
  lines.push(mdTable(['Target', 'Count'], Object.entries(plan.writes).map(([k, v]) => [k, v.length])));
  lines.push('');
  lines.push('## Distinct Unresolved Assignees');
  lines.push('');
  lines.push(mdTable(
    ['Name', 'Email', 'Count', 'Teams', 'Planned role', 'Planned team'],
    plan.missing_assignees.map(a => [a.name, a.email || '', a.count, a.teams.join(', '), a.role, a.team || '']),
  ));
  lines.push('');
  lines.push('## Attribution Repair Rows');
  lines.push('');
  lines.push(mdTable(
    ['Linear issue', 'Identifier', 'State', 'Source', 'Repair required'],
    plan.attribution_repairs.map(row => [
      row.linear_issue_uuid,
      row.identifier,
      row.state,
      row.source,
      row.repair_required ? 'yes' : 'no',
    ]),
  ));
  lines.push('');
  lines.push('## Other Kind Titles');
  lines.push('');
  lines.push(mdTable(
    ['Identifier', 'Team', 'Title'],
    plan.other_kind_titles.map(r => [r.identifier, r.team, r.title]),
  ));
  lines.push('');
  lines.push('## Batch Shapes');
  lines.push('');
  lines.push(mdTable(['Shape', 'Count'], Object.entries(plan.batch_shapes).map(([k, v]) => [k, v])));
  if (applyResult) {
    lines.push('');
    lines.push('## Apply Result');
    lines.push('');
    lines.push(mdTable(['Write', 'Count'], Object.entries(applyResult).map(([k, v]) => [k, v])));
  }
  if (verification) {
    lines.push('');
    lines.push('## Verification');
    lines.push('');
    lines.push(mdTable(['Table', 'Expected', 'Actual'], [
      ['batches', verification.expected.batches, verification.counts.batches],
      ['deliverables', verification.expected.deliverables, verification.counts.deliverables],
      ['linear_archive', verification.expected.linear_archive, verification.counts.linear_archive],
      ['deliverable_events', '>= batches + deliverables', verification.counts.deliverable_events],
    ]));
    lines.push('');
    lines.push(`Events all migration-safe sources (backfill/system): ${verification.all_events_backfill ? 'yes' : 'NO'} (${JSON.stringify(verification.event_source_counts)})`);
    lines.push(`Backfill event coverage: deliverables ${verification.deliverables_with_backfill_event}/${verification.counts.deliverables}; batches ${verification.batches_with_backfill_event}/${verification.counts.batches}`);
    lines.push(`20-issue spot parity: ${verification.spot_parity_passed}/${verification.spot_parity.length}`);
    lines.push(`Replay verify: ${JSON.stringify(verification.replay_verify)}`);
    lines.push('');
    lines.push('### Spot Parity');
    lines.push('');
    lines.push(mdTable(
      ['Identifier', 'OK', 'Status', 'Due', 'Priority', 'Linear assignee'],
      verification.spot_parity.map(s => [s.identifier, s.ok ? 'yes' : 'NO', s.status || '', s.due_date || '', s.priority || '', s.linear_assignee || '']),
    ));
  }
  lines.push('');
  lines.push('Delivery-link comment sweep is separate best-effort work; file_url remains null unless annotated later.');
  return lines.join('\n');
}

function renderIncremental(plan, applyResult) {
  const lines = [];
  lines.push('# B1 Linear Incremental Refresh');
  lines.push('');
  lines.push(`Generated: ${plan.generated_at}`);
  lines.push(`Changed since: ${plan.changed_since}`);
  lines.push(`Changed issues pulled: ${plan.changed_issue_count}`);
  lines.push(`Operational changed issues: ${plan.operational_count}`);
  lines.push(`Soft-handled existing deliverables: ${plan.soft_handled_count}`);
  lines.push(`Archive candidates: ${plan.archive_count}`);
  lines.push(`Authority: video=${plan.authority.value.video}, graphics=${plan.authority.value.graphics} (${plan.authority.source})`);
  lines.push(`Authority-gated live writes: batches=${plan.gated.batch_write_candidates}, deliverables=${plan.gated.deliverable_write_candidates}`);
  lines.push('');
  lines.push('## Planned Writes');
  lines.push('');
  lines.push(mdTable(['Target', 'Count'], Object.entries(plan.writes).map(([k, v]) => [k, v.length])));
  if (applyResult) {
    lines.push('');
    lines.push('## Apply Result');
    lines.push('');
    lines.push(mdTable(['Write', 'Count'], Object.entries(applyResult).map(([k, v]) => [k, v])));
  }
  lines.push('');
  lines.push('Incremental mode only writes dormant B1 tables and system-source ledger events. It does not change runtime flags, n8n workflows, auth, or Linear.');
  return lines.join('\n');
}

async function assertFullApplyAuthority() {
  if (!APPLY && !APPLY_RECONCILIATION_ONLY) return;
  const state = await loadAuthority({
    cachePath: AUTHORITY_CACHE_PATH,
    key: SUPA_KEY || undefined,
    supabaseUrl: SUPA_URL,
  });
  if (state.write_safe !== true || state.authority.video !== 'linear' || state.authority.graphics !== 'linear') {
    throw new Error('full B1 apply is frozen unless a live flag read confirms both production teams are Linear-authoritative; use the authority-aware incremental lane or v2 reconciler');
  }
}

async function assertFreshLinearAuthority(teams) {
  const required = (Array.isArray(teams) ? teams : [teams]).map(teamKeyForAuthority);
  if (!required.length || required.some(team => !team)) {
    throw new Error('B1 authoritative write has an unknown production team');
  }
  const state = await loadAuthority({
    cachePath: AUTHORITY_CACHE_PATH,
    key: SUPA_KEY || undefined,
    supabaseUrl: SUPA_URL,
  });
  if (state.write_safe !== true) {
    throw new Error('B1 authoritative write frozen because prod_authority was not read live');
  }
  const blocked = [...new Set(required)].filter(team => authorityForTeam(state.authority, team) !== 'linear');
  if (blocked.length) {
    throw new Error(`B1 authoritative write frozen for SyncView-authoritative team(s): ${blocked.join(',')}`);
  }
  return state;
}

function teamKeyForAuthority(team) {
  const key = clean(team).toLowerCase();
  if (key === 'vid' || key === 'video') return 'video';
  if (key === 'gra' || key === 'graphic' || key === 'graphics' || key === 'thumbnail') return 'graphics';
  return '';
}

async function main() {
  if (INCREMENTAL) {
    const plan = await buildIncrementalPlan();
    const applyResult = APPLY ? await applyIncrementalPlan(plan) : null;
    const jsonPath = args.get('--json-out');
    if (jsonPath) {
      const full = path.resolve(jsonPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(publicB1Artifact(plan, applyResult, null), null, 2));
    }
    const report = renderIncremental(plan, applyResult);
    const out = args.get('--out');
    if (out) {
      const full = path.resolve(out);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, report);
    }
    console.log(report);
    return;
  }
  await assertFullApplyAuthority();
  const plan = await buildPlan();
  let applyResult = null;
  if (APPLY_RECONCILIATION_ONLY) applyResult = await applyReconciliation(plan);
  if (APPLY) applyResult = await applyPlan(plan);
  const verification = APPLY || args.has('--verify') ? await verify(plan) : null;

  const jsonPath = args.get('--json-out');
  if (jsonPath) {
    const full = path.resolve(jsonPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(publicB1Artifact(plan, applyResult, verification), null, 2));
  }
  const report = render(plan, applyResult, verification);
  const out = args.get('--out');
  if (out) {
    const full = path.resolve(out);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, report);
  }
  console.log(report);
}

if (require.main === module) {
  main().catch(err => fail(err && err.stack ? err.stack : String(err)));
}

module.exports = {
  batchGroupKey,
  batchRowsFor,
  deliverableRow,
  archiveRow,
  softClosedDeliverableRow,
  attributionRepairRows,
  unresolvedAttributionSentinel,
};
