'use strict';

/*
 * Private F200 live snapshot operator.
 *
 * This is deliberately read-only. It collects the current unattributed
 * deliverable cohort, the active-roster mapping input, enough Linear issue
 * context for a bounded owner decision, and aggregate Kasper impact evidence.
 * It must write only to the supplied private file; nothing is printed except
 * aggregate counts suitable for an Actions log.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const LINEAR_KEY = String(process.env.LINEAR_API_KEY || process.env.LINEAR_API_TOKEN || '');

function clean(value) { return String(value == null ? '' : value).trim(); }

function comparisonPath(value) {
  const normalized = path.normalize(path.resolve(value));
  const root = path.parse(normalized).root;
  const trimmed = normalized.length > root.length ? normalized.replace(/[\\/]+$/, '') : normalized;
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function registeredGitWorktrees() {
  const result = spawnSync('git', ['-C', path.resolve(__dirname, '..'), 'worktree', 'list', '--porcelain', '-z'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('could not verify Git worktree registry');
  const worktrees = [...new Set(String(result.stdout || '').split('\0')
    .filter(field => field.startsWith('worktree '))
    .map(field => comparisonPath(field.slice('worktree '.length)))
    .filter(Boolean))];
  if (!worktrees.length) throw new Error('could not verify Git worktree registry');
  return worktrees;
}

function assertPrivateOutputPath(value) {
  if (!clean(value) || !path.isAbsolute(value)) {
    throw new Error('--out must be an absolute private path outside every Git worktree');
  }
  const output = path.resolve(value);
  if (registeredGitWorktrees().some(worktree => pathInside(comparisonPath(output), worktree))) {
    throw new Error('--out must be outside every Git worktree');
  }
  return output;
}

function arg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => String(value).startsWith(prefix));
  if (inline) return String(inline).slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? clean(process.argv[index + 1]) : '';
}

async function supabaseRows(table, select, filters = '') {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1000&offset=${offset}${filters ? `&${filters}` : ''}`;
    const response = await fetch(url, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Supabase ${table} read failed: HTTP ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (!Array.isArray(page) || page.length < 1000) return rows;
  }
}

function graphqlText(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('unsafe Linear issue id');
  return JSON.stringify(value);
}

function fields() {
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

async function linearIssues(ids) {
  if (!LINEAR_KEY) throw new Error('LINEAR_API_KEY is required');
  const out = [];
  const unique = [...new Set(ids.map(clean).filter(Boolean))];
  for (let start = 0; start < unique.length; start += 30) {
    const chunk = unique.slice(start, start + 30);
    const aliases = chunk.map((id, index) => `i${index}: issue(id: ${graphqlText(id)}) { ${fields()} }`).join('\n');
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: LINEAR_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ query: `query F200Snapshot { ${aliases} }` }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.errors) throw new Error(`Linear issue read failed: HTTP ${response.status}`);
    for (let index = 0; index < chunk.length; index++) {
      const issue = body.data && body.data[`i${index}`];
      if (!issue || clean(issue.id) !== chunk[index]) throw new Error('Linear snapshot was incomplete');
      out.push(issue);
    }
  }
  return out;
}

function by(values, key) {
  return Object.fromEntries([...values.reduce((out, value) => {
    const name = clean(value && value[key]) || 'missing';
    out.set(name, (out.get(name) || 0) + 1);
    return out;
  }, new Map())].sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  const output = assertPrivateOutputPath(arg('out'));
  const [deliverables, clients, allBatches, kasperDeliverables, kasperBatches, kasperCalendar, kasperSamples] = await Promise.all([
    supabaseRows('deliverables', 'id,identifier,batch_id,client_slug,team,kind,title,status,updated_at,linear_issue_uuid,linear_raw', 'client_slug=eq.unattributed'),
    supabaseRows('clients', 'slug,display_name,kind,active,linear_project_ids'),
    supabaseRows('batches', 'id,client_slug,team,name,description,status,linear_parent_ids'),
    supabaseRows('deliverables', 'id,team,kind,status,origin', 'client_slug=eq.kasperhytonen'),
    supabaseRows('batches', 'id,team,status', 'client_slug=eq.kasperhytonen'),
    supabaseRows('calendar_posts', 'id,status', 'client=eq.kasperhytonen'),
    supabaseRows('sample_reviews', 'id,status', 'client=eq.kasperhytonen'),
  ]);
  const issues = await linearIssues(deliverables.map(row => clean(row.linear_issue_uuid)));
  const cohortBatchIds = new Set(deliverables.map(row => clean(row.batch_id)).filter(Boolean));
  const snapshot = {
    schema: 'syncview_f200_live_snapshot_v1',
    generated_at: new Date().toISOString(),
    // The snapshot contains only the current sentinel cohort. It omits normal
    // siblings, so family inference must fail closed rather than treating the
    // observed set as a complete projectless family.
    family_complete: false,
    deliverables,
    batches: allBatches.filter(row => cohortBatchIds.has(clean(row.id))),
    clients,
    linear_issues: issues,
    downstream: {
      kasper: {
        deliverables: kasperDeliverables.length,
        deliverables_by_team: by(kasperDeliverables, 'team'),
        deliverables_by_status: by(kasperDeliverables, 'status'),
        batches: kasperBatches.length,
        batches_by_status: by(kasperBatches, 'status'),
        calendar_posts: kasperCalendar.length,
        sample_reviews: kasperSamples.length,
      },
    },
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({
    schema: snapshot.schema,
    unattributed_deliverables: deliverables.length,
    by_team: by(deliverables, 'team'),
    kasper_downstream: snapshot.downstream.kasper,
    writes_executed: 0,
  }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { assertPrivateOutputPath, registeredGitWorktrees };
