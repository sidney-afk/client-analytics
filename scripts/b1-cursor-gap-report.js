'use strict';

/*
 * How much did the B1 cursor bug actually drop?
 *
 * The bug (F131, fixed in scripts/b1-linear-backfill.js): three row kinds
 * share the `linear_incremental_refresh` action, and the cursor took the
 * newest of all three. A run that FAILED still stamped `finished_at`, so the
 * next run started from it and the failed run's window was never read again.
 *
 * "Was anything else skipped?" cannot be answered from GitHub run
 * conclusions, because a failure that happened before the summary was written
 * moved no cursor and dropped nothing. Only the summary ledger knows. This
 * script reads it and reconstructs both cursor rules:
 *
 *   OLD: any summary's finished_at advances the cursor
 *   NEW: only a summary with ok:true and a finished_at advances it
 *
 * A skipped window is a span the OLD rule stepped over and no later
 * SUCCESSFUL run's window ever covered again.
 *
 * Then it asks Linear the only question that settles whether the data still
 * needs re-reading: which issues' CURRENT `updatedAt` still falls inside a
 * skipped window? Linear keeps only the latest `updatedAt`, so an issue whose
 * newest change sits in a skipped window has not been touched since — its
 * change was dropped and nothing has re-read it. An issue that changed again
 * afterwards was picked up by a later window and needs nothing.
 *
 * Read-only. Writes nothing, to either system.
 *
 * PUBLIC SAFETY: emits timestamps, counts, team keys and Linear identifiers.
 * No titles, no client slugs, no assignee names.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const LINEAR_KEY = String(process.env.LINEAR_API_KEY || '');

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(process.argv[i]);
  if (match) args.set(match[1], match[2] === undefined ? '1' : match[2]);
}

const SINCE = String(args.get('since') || '2026-07-28T00:00:00Z');
// Must match b1-linear-backfill's --overlap-minutes default, or the
// reconstruction is not the cursor the job actually used.
const OVERLAP_MINUTES = Number(args.get('overlap-minutes') || 5);
// Fields whose divergence is real drift. `linear_raw` is deliberately absent:
// it is the whole raw payload and differs on essentially every re-read, so
// counting it would reproduce the `inbound_diff_count` mistake of calling a
// churn counter a health signal.
const MEANINGFUL_FIELDS = Object.freeze(['status', 'title', 'due_date', 'priority', 'assignee_linear_id', 'archived']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function iso(value) {
  const ms = Date.parse(clean(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function supabase(path) {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const response = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Supabase read HTTP ${response.status}`);
  return response.json();
}

async function linear(query, variables = {}) {
  if (!LINEAR_KEY) throw new Error('LINEAR_API_KEY is required');
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: LINEAR_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.errors) throw new Error(`Linear read failed: HTTP ${response.status}`);
  return body.data;
}

/** Terminal run summaries only — per-row write events carry no started_at. */
function summaries(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => {
      const payload = row && typeof row.payload === 'object' ? row.payload : {};
      return {
        id: row.id,
        ok: payload.ok === true,
        started_at: iso(payload.started_at),
        finished_at: iso(payload.finished_at),
        changed_since: iso(payload.changed_since),
      };
    })
    .filter(row => row.started_at && row.finished_at)
    .sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at));
}

/**
 * Reconstruct what the OLD rule covered and what it stepped over.
 *
 * Each run READ the span [changed_since, finished_at]. A successful run's span
 * is covered; a failed run's is not, because it did not finish writing it. A
 * gap is therefore a stretch of time inside some failed run's span that no
 * successful run's span — before or after — ever includes.
 */
function skippedWindows(rows) {
  const covered = rows.filter(row => row.ok && row.changed_since)
    .map(row => [Date.parse(row.changed_since), Date.parse(row.finished_at)])
    .sort((a, b) => a[0] - b[0]);

  // Merge the covered spans so an overlapping successful run closes the gap.
  const merged = [];
  for (const span of covered) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }

  const gaps = [];
  for (const row of rows.filter(entry => !entry.ok && entry.changed_since)) {
    let cursor = Date.parse(row.changed_since);
    const end = Date.parse(row.finished_at);
    for (const [from, to] of merged) {
      if (to <= cursor) continue;
      if (from >= end) break;
      if (from > cursor) gaps.push([cursor, Math.min(from, end)]);
      cursor = Math.max(cursor, to);
      if (cursor >= end) break;
    }
    if (cursor < end) gaps.push([cursor, end]);
  }

  // Merge the gaps too, so consecutive failures report as one window.
  gaps.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const gap of gaps) {
    const last = out[out.length - 1];
    if (last && gap[0] <= last[1]) last[1] = Math.max(last[1], gap[1]);
    else out.push([...gap]);
  }
  return out.map(([from, to]) => ({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    minutes: Math.round((to - from) / 60000),
  }));
}

async function issuesUpdatedIn(window) {
  const nodes = [];
  let after = null;
  const query = `
    query B1GapIssues($after: String, $filter: IssueFilter) {
      issues(first: 100, after: $after, includeArchived: true, filter: $filter) {
        nodes {
          id identifier updatedAt archivedAt dueDate priority title
          team { key }
          state { name }
          assignee { id }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  const filter = { updatedAt: { gte: window.from, lt: window.to } };
  for (;;) {
    const data = await linear(query, { after, filter });
    nodes.push(...data.issues.nodes);
    if (!data.issues.pageInfo.hasNextPage) break;
    after = data.issues.pageInfo.endCursor;
  }
  return nodes;
}

/**
 * Does the stored row still disagree with Linear on something that matters?
 * A dropped change is only outstanding damage if the divergence survives.
 */
function meaningfulDivergence(issue, stored) {
  if (!stored) return 'row_missing';
  const differences = [];
  if (clean(stored.linear_identifier).toUpperCase() !== clean(issue.identifier).toUpperCase()) {
    differences.push('identifier');
  }
  if (clean(stored.title) && clean(stored.title) !== clean(issue.title)) differences.push('title');
  if (clean(stored.due_date).slice(0, 10) !== clean(issue.dueDate).slice(0, 10)) differences.push('due_date');
  if (Number(stored.priority || 0) !== Number(issue.priority || 0)) differences.push('priority');
  if (Boolean(issue.archivedAt) !== (clean(stored.status).toLowerCase() === 'archived')) {
    differences.push('archived');
  }
  return differences.length ? differences.join('+') : '';
}

async function main() {
  const rows = await supabase(
    `deliverable_events?select=id,ts,payload&source=eq.system&action=eq.linear_incremental_refresh`
    + `&ts=gte.${encodeURIComponent(SINCE)}&order=ts.asc&limit=5000`,
  );
  const runs = summaries(rows);
  const failed = runs.filter(row => !row.ok);
  const windows = skippedWindows(runs);

  const report = {
    since: SINCE,
    overlap_minutes: OVERLAP_MINUTES,
    ledger_rows_read: Array.isArray(rows) ? rows.length : 0,
    terminal_summaries: runs.length,
    successful_summaries: runs.length - failed.length,
    failed_summaries: failed.length,
    // A failed run that never wrote a summary moved no cursor and dropped
    // nothing; only these are capable of having skipped a window.
    skipped_windows: windows,
    skipped_minutes_total: windows.reduce((sum, window) => sum + window.minutes, 0),
    dropped_changes: 0,
    still_outstanding: 0,
    outstanding_sample: [],
    by_team: { video: 0, graphics: 0, other: 0 },
  };

  if (!windows.length) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  const identifiers = [];
  for (const window of windows) {
    const issues = await issuesUpdatedIn(window);
    // Linear stores only the newest updatedAt, so an issue still sitting in a
    // skipped window has not been touched since — nothing re-read its change.
    report.dropped_changes += issues.length;
    for (const issue of issues) {
      const team = clean(issue.team && issue.team.key).toUpperCase();
      const bucket = team === 'VID' ? 'video' : team === 'GRA' ? 'graphics' : 'other';
      report.by_team[bucket]++;
      identifiers.push(issue);
    }
  }

  // Compare each dropped change against what SyncView currently stores.
  for (const issue of identifiers) {
    const stored = (await supabase(
      `deliverables?select=linear_identifier,title,status,due_date,priority,assignee_id`
      + `&linear_issue_uuid=eq.${encodeURIComponent(issue.id)}&limit=1`,
    ))[0] || null;
    const divergence = meaningfulDivergence(issue, stored);
    if (!divergence) continue;
    report.still_outstanding++;
    if (report.outstanding_sample.length < 25) {
      report.outstanding_sample.push({
        identifier: clean(issue.identifier).toUpperCase(),
        team: clean(issue.team && issue.team.key).toUpperCase(),
        diverges_on: divergence,
      });
    }
  }
  report.compared_fields = MEANINGFUL_FIELDS;

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  main().catch(error => {
    console.error(clean(error && error.message).slice(0, 300));
    process.exit(1);
  });
}

module.exports = { meaningfulDivergence, skippedWindows, summaries };
