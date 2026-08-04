'use strict';

/*
 * Locks the B1 refresh bookmark (F131).
 *
 * On 2026-07-28 a refresh failed, stamped `finished_at` on its FAILURE summary
 * anyway, and the next run started from that timestamp — so ~40 minutes of
 * Linear changes were skipped and never re-read, silently. Three row kinds
 * share the `linear_incremental_refresh` action:
 *
 *   success summary  ok:true   finished_at present   <- the only valid cursor
 *   failure summary  ok:false  finished_at present
 *   per-row event    no `ok`   no finished_at
 *
 * The rule this suite enforces: a run that did not complete may not move the
 * cursor, so the next run re-reads the window the failed one dropped.
 */

const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(condition, message) {
  if (!condition) {
    console.error('FAIL b1-refresh-cursor-safety:', message);
    failures++;
  }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js'), 'utf8');
const selector = /async function latestIncrementalEvent\(\)[\s\S]*?\n}/.exec(source);
const resolver = /async function incrementalChangedSince\(\)[\s\S]*?\n}/.exec(source);

ok(selector, 'latestIncrementalEvent must exist');
ok(resolver, 'incrementalChangedSince must exist');

const selectorBody = selector ? selector[0] : '';
const resolverBody = resolver ? resolver[0] : '';

// --- the query may only ever select a COMPLETED run -----------------------
ok(/payload->>ok=eq\.true/.test(selectorBody),
  'the cursor query must select only successful summaries, so a failure summary can never become the bookmark');
ok(/action=eq\.linear_incremental_refresh/.test(selectorBody),
  'the cursor query must still be scoped to the refresh action');
ok(/finished_at/.test(selectorBody) && /return null/.test(selectorBody),
  'a success row without finished_at cannot describe how far the run got and must be rejected as a checkpoint');

// --- the resolver may only ever read finished_at --------------------------
ok(!/payload\.started_at/.test(resolverBody),
  'started_at must not advance the cursor — a run that started is not a run that finished');
ok(!/\|\|\s*last\.ts/.test(resolverBody),
  'the row write timestamp must not advance the cursor — that is how per-row events moved it mid-run');
ok(/clean\(last\.payload\.finished_at\)/.test(resolverBody),
  'only a completed run\'s finished_at may advance the cursor');

// --- a failure must widen the next window, never narrow it ----------------
{
  // Model the resolver's arithmetic against the three row kinds.
  const overlapMs = 5 * 60000;
  const cursorFrom = row => {
    // Mirrors latestIncrementalEvent's filter: ok:true AND finished_at present.
    if (!row || row.ok !== true || !row.finished_at) return null;
    return new Date(Date.parse(row.finished_at) - overlapMs).toISOString();
  };

  const lastSuccess = { ok: true, finished_at: '2026-07-28T12:00:00.000Z' };
  const failedRun = { ok: false, finished_at: '2026-07-28T12:40:00.000Z' };
  const perRowEvent = { finished_at: undefined };

  ok(cursorFrom(failedRun) === null,
    'a failed run must not produce a cursor — this is the 2026-07-28 defect');
  ok(cursorFrom(perRowEvent) === null,
    'a per-row event must not produce a cursor');
  ok(cursorFrom(lastSuccess) === '2026-07-28T11:55:00.000Z',
    'the cursor comes from the last SUCCESS, minus the overlap');

  // With the fix, the window after a failure still covers the failed span.
  const next = cursorFrom(lastSuccess);
  ok(Date.parse(next) < Date.parse(failedRun.finished_at),
    'the window after a failure must still include everything the failed run was supposed to read');
}

// --- the operator escape hatch must exist ---------------------------------
{
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'b1-linear-incremental-refresh.yml'), 'utf8');
  ok(/changed_since:/.test(workflow),
    'the workflow must accept a changed_since override so a skipped window can be re-read deliberately');
  ok(/inputs\.apply/.test(workflow),
    'the workflow must be able to measure a window read-only before anyone decides to re-read it');
  ok(/B1_APPLY.*!=.*false|if \[ "\$B1_APPLY" != "false" \]/.test(workflow),
    'scheduled runs must keep applying by default');
}

console.log(failures ? `b1-refresh-cursor-safety: ${failures} check(s) failed` : 'b1-refresh-cursor-safety checks passed');
process.exit(failures ? 1 : 0);
