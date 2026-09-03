'use strict';
/*
 * ONE DELETED LINEAR ISSUE MUST NOT TAKE DOWN THE RECONCILER.
 *
 * Run:  node test/reconcile-tolerates-deleted-issue.js   (exit 0 = all good)
 *
 * INCIDENT, 2026-09-02/03. `Linear ⇄ deliverables reconcile v2` failed on 16
 * consecutive runs across ~11 hours, every one with
 *
 *   Linear GraphQL failed: HTTP 200 [{"message":"Entity not found: Issue", ...}]
 *
 * The reconciler is the thing that measures outbound divergence, so for those
 * eleven hours divergence on BOTH teams was not merely undetected — the counter
 * that would have reported it stopped being written at all. The run before the
 * first failure passed on the SAME commit, so this was data, not a regression:
 * a deliverables row held a `linear_issue_uuid` for an issue somebody had
 * deleted in Linear.
 *
 * MECHANISM. A batched by-id read asks for 35 issues at once. Linear answers
 * HTTP 200 with `data` fully populated for the 34 that exist and an `errors`
 * entry for the one that does not. `linear()` treated any non-empty `errors` as
 * fatal — even though `loadLinearIssuesById` was already written to skip a null
 * alias. The tolerance the loader needed was one layer below it.
 *
 * The relaxation is deliberately narrow, and these assertions exist to keep it
 * narrow: a lane that silently accepted partial answers to MUTATIONS would
 * report success over work it never did.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'linear-deliverables-reconcile.js'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}
function grabFunc(name) {
  let at = SRC.indexOf('async function ' + name + '(');
  if (at < 0) at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return SRC.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

/* The real `linear()` and the real predicate, over a stubbed fetch that answers
   exactly as Linear did during the incident. */
function callLinear(response, opts) {
  const ctx = vm.createContext({ console });
  vm.runInContext(`
    const LINEAR_API_KEY = 'test-key';
    function fail(m) { throw new Error(m); }
    async function sleep() {}
    const RESPONSE = ${JSON.stringify(response)};
    let calls = 0;
    async function fetch() {
      calls++;
      return { ok: RESPONSE.ok, status: RESPONSE.status, async json() { return RESPONSE.body; } };
    }
    function callCount() { return calls; }
  `, ctx);
  vm.runInContext(grabFunc('isEntityNotFoundError'), ctx);
  vm.runInContext(grabFunc('linear'), ctx);
  return vm.runInContext(`linear('query {}', ${JSON.stringify(opts || null)})`, ctx);
}

const NOT_FOUND = {
  ok: true, status: 200,
  body: {
    data: { i0: { id: 'kept' }, i1: null },
    errors: [{ message: 'Entity not found: Issue', path: ['i1'] }],
  },
};

(async () => {
  /* ---- the incident, and the tolerance that ends it ---------------------- */
  {
    let threw = false;
    try { await callLinear(NOT_FOUND); } catch (e) { threw = true; }
    ok(threw, 'without the opt-in, a deleted issue still fails the call — the default is unchanged');
  }
  {
    const data = await callLinear(NOT_FOUND, { tolerateNotFound: true });
    ok(data && data.i0 && data.i0.id === 'kept',
      'WITH the opt-in, the 34 issues that DO exist are returned instead of the run dying');
  }

  /* ---- and it stays narrow ------------------------------------------------ */
  const OTHER_ERROR = {
    ok: true, status: 200,
    body: { data: { i0: { id: 'kept' } }, errors: [{ message: 'Rate limited', path: ['i0'] }] },
  };
  {
    let threw = false;
    try { await callLinear(OTHER_ERROR, { tolerateNotFound: true }); } catch (e) { threw = true; }
    ok(threw, 'a NON-not-found error still throws even with the opt-in — a rate limit is not a deletion');
  }
  const MIXED = {
    ok: true, status: 200,
    body: {
      data: { i0: { id: 'kept' } },
      errors: [{ message: 'Entity not found: Issue', path: ['i1'] }, { message: 'Something else', path: ['i2'] }],
    },
  };
  {
    let threw = false;
    try { await callLinear(MIXED, { tolerateNotFound: true }); } catch (e) { threw = true; }
    ok(threw, 'a MIXED error set throws — tolerance requires EVERY error to be a not-found');
  }
  {
    const noData = { ok: true, status: 200, body: { errors: [{ message: 'Entity not found: Issue', path: ['i0'] }] } };
    let threw = false;
    try { await callLinear(noData, { tolerateNotFound: true }); } catch (e) { threw = true; }
    ok(threw, 'a response with no data at all throws — there is nothing partial to salvage');
  }

  /* ---- the predicate itself ----------------------------------------------- */
  const ctx = vm.createContext({ console });
  vm.runInContext(grabFunc('isEntityNotFoundError'), ctx);
  const isNF = e => vm.runInContext(`isEntityNotFoundError(${JSON.stringify(e)})`, ctx);
  ok(isNF({ message: 'Entity not found: Issue', path: ['i0'] }), 'matches the message Linear actually sent');
  ok(isNF({ type: 'EntityNotFound', message: 'Entity not found: Issue', path: ['i7'] }),
    'accepts the machine field alongside the message');
  ok(!isNF({ type: 'AuthenticationError', message: 'Entity not found: Issue', path: ['i0'] }),
    'a machine type that is NOT not-found wins over a matching message');
  ok(!isNF({ message: 'Could not find referenced Issue', path: ['i0'] }) && !isNF(null) && !isNF({}),
    'an unfamiliar shape is not tolerated — unrecognised keeps failing the run');

  /* THE PATH IS PART OF THE PREDICATE — review finding on PR #1241.
     GraphQL nulls the whole alias when a non-nullable CHILD errors, so a nested
     miss would have made the loader record a LIVE issue as deleted and
     reconcile the row against an incomplete object. */
  ok(!isNF({ message: 'Entity not found: Project', path: ['i1', 'project'] }),
    'a NESTED entity miss is NOT tolerated — it would mark a live issue deleted');
  ok(!isNF({ message: 'Entity not found: Issue', path: ['i1', 'parent'] }),
    'not even a nested ISSUE miss — only a top-level alias may be tolerated');
  ok(!isNF({ message: 'Entity not found: Issue' }),
    'and an error with no path at all is not tolerated');
  ok(!isNF({ message: 'Entity not found: Project', path: ['i1'] }),
    'a top-level miss of some OTHER entity is not tolerated either');
  ok(!isNF({ message: 'Entity not found: Issue', path: ['webhooks'] }),
    'and a path that is not one of this loader’s aliases is refused');

  /* ---- the deletion is REPORTED, not silently skipped --------------------- */
  const loader = grabFunc('loadLinearIssuesById');
  ok(/tolerateNotFound: true/.test(loader) && /collectNotFound/.test(loader),
    'the by-id issue loader is the caller that opts in');
  ok(/LINEAR_ISSUES_NOT_FOUND\.add/.test(loader),
    'and records WHICH ids were missing, rather than quietly dropping them');
  ok(/\^i\(\\d\+\)\$/.test(loader) || /\^i\(\\\\d\+\)\$/.test(loader) || /err && err\.path/.test(loader),
    'resolving the id from the error path, not from a diff of the returned map');
  ok(/linear_issue_not_found_count: LINEAR_ISSUES_NOT_FOUND\.size/.test(SRC),
    'the summary event carries the count, so a silent blind spot becomes a visible number');
  ok(/linear_issue_not_found_sample: privateRepair \? \[\]/.test(SRC),
    'and its id sample obeys the same private-run rule as every other sample');

  /* ---- the APPLY lane still refuses an incomplete cohort ------------------
   *
   * The tolerance is in the READ. It must not become tolerance in the WRITE:
   * the F200 repair preflight reads a precondition cohort and refuses to
   * proceed unless every issue in it resolved. A deleted issue there means the
   * precondition cannot be checked, which is a stop, not a skip. */
  const preflight = grabFunc('loadF200RepairLiveStates');
  ok(/linearIssues\.size !== new Set\(issueIds\)\.size/.test(preflight)
    && /F200 repair preflight did not read the exact Linear issue cohort/.test(preflight),
    'the F200 apply preflight still throws on an incomplete Linear cohort');
  ok(/attributionIssueIds\.every\(id => linearIssues\.has\(id\)\)/.test(SRC),
    'and attribution completeness is still computed from whether every id resolved');

  /* ---- LOAD-TO-PLAN: a deleted issue must not inflate the divergence counter
   *
   * The second review finding on PR #1241, and the serious one. Letting an
   * orphaned row through made `attributionFamilyComplete` false, which disables
   * unanimous child-family inference GLOBALLY — so valid `provisional_child_family`
   * rows were recomputed as `needs_attribution` and `compareAttribution` injected
   * unrelated entries into `outbound_diff_count`, the counter the health check
   * gates and pages on. The first fix traded a LOUD outage for a silently
   * inflated divergence number, which is the worse of the two.
   *
   * Asserted on the real source rather than the shape of a stub, because the
   * property is about which rows reach the plan at all. */
  const loadBodies = ['loadLiveData'].map(n => { try { return grabFunc(n); } catch (_) { return ''; } });
  const completenessSites = (SRC.match(/attributionIssueIds\.every\(id => linearIssues\.has\(id\)\)/g) || []).length;
  const dropSites = (SRC.match(/active = active\.filter\(row => !LINEAR_ISSUES_NOT_FOUND\.has\(clean\(row\.linear_issue_uuid\)\)\)/g) || []).length;
  ok(dropSites === completenessSites && dropSites >= 1,
    'every completeness computation is preceded by dropping the orphaned rows (' + dropSites + ' of ' + completenessSites + ')');
  ok(/const orphanedByDeletedIssue = active\.filter\(row => LINEAR_ISSUES_NOT_FOUND\.has/.test(SRC),
    'and the dropped rows are captured rather than discarded');
  ok(/orphaned_by_deleted_issue_count: Number\(plan\.orphanedByDeletedIssueCount/.test(SRC),
    'the summary reports how many rows the deletions removed from the comparison');
  ok(loadBodies.some(b => b && b.includes('LINEAR_ISSUES_NOT_FOUND')),
    'the drop happens inside the live load, before any plan is built');

  /* ---- no other caller was loosened --------------------------------------- */
  const optIn = (SRC.match(/tolerateNotFound: true/g) || []).length;
  ok(optIn === 1, 'exactly ONE call site opts in (found ' + optIn + ') — mutations and the webhook probe still fail loudly');

  if (failures) {
    console.error('\nReconciler deleted-issue tolerance checks FAILED');
    process.exit(1);
  }
  console.log('\nReconciler deleted-issue tolerance checks passed');
})();
