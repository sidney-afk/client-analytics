'use strict';
/*
 * `buildIncrementalPlan` must actually RUN. Nothing checked that until now.
 *
 * WHAT THIS FIXES (2026-08-10). A rename introduced a temporal-dead-zone
 * ReferenceError — a `for (const b of batches)` reading a `const batches`
 * declared 38 lines further down the same block. `buildIncrementalPlan` could
 * not execute at all: every scheduled run of
 * .github/workflows/b1-linear-incremental-refresh.yml (every 30 minutes, with
 * --apply) would have died, permanently halting Linear -> Supabase ingestion
 * for every client, with the cursor unable to advance.
 *
 * The full 214-suite run was GREEN with the function in that state, because
 * `grep -rl buildIncrementalPlan test/ qa/` returned nothing — no test had
 * ever invoked it. Its companion suite regex-greps the source and evals one
 * helper in isolation, so it happily asserted "the incremental path merges
 * BEFORE building write candidates" against code that could not run.
 *
 * The lesson this file encodes: a static assertion about source text cannot
 * prove a code path executes. This suite stubs the network and calls the real
 * function, so any error that is fatal on the first statement — TDZ, a typo, a
 * bad destructure, a missing import — fails here instead of in production.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// Hermetic: no network, no real credentials, no repo writes.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-plan-'));
process.env.LINEAR_API_KEY = 'test-only-not-a-credential';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-credential';
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.PROD_AUTHORITY_CACHE_PATH = path.join(tmp, 'authority.json');
fs.writeFileSync(process.env.PROD_AUTHORITY_CACHE_PATH, JSON.stringify({
  authority: { video: 'linear', graphics: 'linear' },
  write_safe: true,
  captured_at: '2026-08-10T00:00:00.000Z',
}));

/* Every outbound call in this function is fetch: loadIssues hits the Linear
 * GraphQL endpoint, supabaseRows hits PostgREST. Empty-but-well-formed
 * responses exercise the whole body without any row-shape assumptions. */
const calls = [];
global.fetch = async (url, options) => {
  const href = String(url);
  calls.push(href);
  let body = [];
  if (href.includes('linear.app')) {
    body = { data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } };
  } else if (href.includes('syncview_runtime_flags')) {
    // The authority guard fails closed without exactly one row, so the run
    // must be given a live-shaped Linear/Linear reading to proceed at all.
    body = [{ key: 'prod_authority', value: { video: 'linear', graphics: 'linear' } }];
  }
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
};

const { buildIncrementalPlan } = require(path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js'));
ok(typeof buildIncrementalPlan === 'function',
  'buildIncrementalPlan is exported, so a test can invoke it rather than grep for it');

(async () => {
  let plan = null;
  let threw = null;
  try {
    plan = await buildIncrementalPlan();
  } catch (error) {
    threw = error;
  }

  ok(!threw, threw
    ? `buildIncrementalPlan threw before producing a plan: ${threw && threw.message}`
    : 'buildIncrementalPlan executes end to end without throwing');
  ok(plan && plan.mode === 'incremental',
    'it returns an incremental plan — the shape the workflow and the cursor depend on');
  ok(plan && Array.isArray(plan.card_slot_conflicts) && typeof plan.changed_issue_count === 'number',
    'the plan carries the fields the run summary and the withhold path read');
  ok(calls.some(href => href.includes('linear.app')),
    'the stub was actually exercised — the run really did traverse the load path');

  /* Deliberately NO source-text TDZ check here. I wrote one, and it reported
   * `deliverables` and `batches` as violations because a bare word-boundary
   * scan matches inside string literals — supabaseRows('deliverables', …) and
   * comment prose. A lint that cries wolf on correct code is worse than none,
   * and it would be re-teaching the same lesson this file exists for: the
   * execution above is the guard, because only running it proves it runs. */

  fs.rmSync(tmp, { recursive: true, force: true });
  if (failures) {
    console.error(`\n${failures} b1 incremental-plan execution check(s) failed`);
    process.exit(1);
  }
  console.log('\nB1 incremental plan execution checks passed');
})();
