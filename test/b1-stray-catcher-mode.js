'use strict';
/*
 * The stray-catcher is B1's post-video-flip job description (owner rulings
 * 2026-08-24, FLIP_BUG_LEDGER §0-5; design docs/ops/B1_STRAY_CATCHER_DESIGN.md):
 * catch work someone created in Linear anyway, import it, and that is all.
 *
 * Everything here EXECUTES the real buildIncrementalPlan against stubbed
 * network responses — the b1-incremental-plan-executes lesson — with a fresh
 * require per scenario because the flag is read at module load. The three
 * properties under test are the three ways this change could hurt someone:
 *
 *  1. SCOPE: an open issue that is unlinked, untracked and older than the
 *     cutoff — the exact profile of the 655 standing Linear-born video issues
 *     — is IN scope with the flag on and OUT of scope with it off.
 *  2. INSERT-ONLY: an issue that already has a row (native `del_…` id
 *     included, via the same uuid map the id-reuse path uses) produces NO
 *     write in stray mode, and is counted in skipped_existing. The classic
 *     lane still updates it — that contrast is asserted, not assumed.
 *  3. ONE WORLD PER MODE: stray writes demand SyncView authority exactly as
 *     classic writes demand Linear. Stray mode under a Linear-authoritative
 *     team gates everything.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-stray-'));
process.env.LINEAR_API_KEY = 'test-only-not-a-credential';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-credential';
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.PROD_AUTHORITY_CACHE_PATH = path.join(tmp, 'authority.json');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js');

// The flag is a module-load const, so each scenario re-requires from scratch.
function freshModule(strayFlag) {
  for (const key of Object.keys(require.cache)) {
    if (/b1-linear-backfill|prod-authority-guard|public-b1-artifact/.test(key)) delete require.cache[key];
  }
  if (strayFlag) process.env.B1_STRAY_CATCHER = '1';
  else delete process.env.B1_STRAY_CATCHER;
  return require(SCRIPT);
}

function setAuthority(video, graphics) {
  fs.writeFileSync(process.env.PROD_AUTHORITY_CACHE_PATH, JSON.stringify({
    authority: { video, graphics },
    write_safe: true,
    captured_at: '2026-08-24T00:00:00.000Z',
  }));
  stub.authority = { video, graphics };
}

/*
 * Fixtures. Two open VID issues in one Linear project mapped to one active
 * fixture client:
 *  - STRAY (uuid-stray): created 2023, unlinked, no existing row — the 655
 *    profile. Classic scope must exclude it; stray scope must import it.
 *  - TRACKED (uuid-tracked): has a NATIVE row (del_… id) whose status differs
 *    from Linear's — classic mode's update candidate, stray mode's skip.
 */
function issueFixture(id, identifier, title, createdAt) {
  return {
    id, identifier, title,
    url: 'https://linear.app/fixture/issue/' + identifier + '/x',
    description: '', createdAt, updatedAt: '2026-08-24T00:00:00.000Z',
    dueDate: null, priority: 0,
    state: { name: 'Todo', type: 'unstarted' },
    team: { key: 'VID', name: 'Video' },
    parent: null, project: { id: 'proj-fixture-1' },
    assignee: null,
    labels: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  };
}
const strayIssue = issueFixture('uuid-stray', 'VID-9001', 'Fixture stray video', '2023-01-05T00:00:00.000Z');
const trackedIssue = issueFixture('uuid-tracked', 'VID-9002', 'Fixture tracked video', '2026-08-01T00:00:00.000Z');

// The TRACKED row's native batch. Not optional scenery: deliverables.batch_id
// carries a foreign key, so a native `del_…` row cannot exist without its
// batch row. A stub without it fabricates an impossible state — the tracked
// row then trips the orphan-batch withhold (`batchResolvable`) and vanishes
// from classic writes for a reason that cannot occur in production.
const nativeBatch = {
  id: 'batch_fixture_native', client_slug: 'fixture-brand', team: 'video',
  name: 'Fixture native batch', description: '', status: 'active',
  created_by: 'member:fixture', linear_parent_ids: {},
};

const stub = {
  authority: { video: 'syncview', graphics: 'syncview' },
  batches: [nativeBatch],
};
global.fetch = async (url) => {
  const href = String(url);
  let body = [];
  if (href.includes('linear.app')) {
    body = { data: { issues: { nodes: [strayIssue, trackedIssue], pageInfo: { hasNextPage: false, endCursor: null } } } };
  } else if (href.includes('syncview_runtime_flags')) {
    body = [{ key: 'prod_authority', value: stub.authority }];
  } else if (href.includes('/rest/v1/clients')) {
    body = [{ slug: 'fixture-brand', display_name: 'Fixture Brand', kind: 'client', active: true, source: 'test', linear_project_ids: ['proj-fixture-1'] }];
  } else if (href.includes('/rest/v1/deliverables')) {
    body = [{
      id: 'del_fixture_native', identifier: null, batch_id: 'batch_fixture_native',
      client_slug: 'fixture-brand', team: 'video', kind: 'video',
      title: 'Fixture tracked video', status: 'smm_approval', assignee_id: null,
      due_date: null, priority: 0, origin: 'calendar', card_id: 'card-1',
      created_by: 'member:fixture', created_at: '2026-08-01T00:00:00.000Z',
      linear_issue_uuid: 'uuid-tracked', linear_identifier: 'VID-9002',
      linear_issue_url: trackedIssue.url, linear_raw: {},
    }];
  } else if (href.includes('/rest/v1/batches')) {
    body = stub.batches;
  }
  return {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => body, text: async () => JSON.stringify(body),
  };
};

(async () => {
  // ---------- Scenario A: stray mode in the post-flip world ----------------
  setAuthority('syncview', 'syncview');
  const stray = freshModule(true);
  const planA = await stray.buildIncrementalPlan();

  ok(planA.stray_catcher === true, 'the plan says which mode built it');
  const wroteStray = planA.writes.deliverables.some(r => r.linear_issue_uuid === 'uuid-stray');
  ok(wroteStray,
    'SCOPE+GATE: the 655-profile issue (old, unlinked, untracked) becomes a write under SyncView authority');
  const wroteTracked = planA.writes.deliverables.some(r => r.linear_issue_uuid === 'uuid-tracked');
  ok(!wroteTracked,
    'INSERT-ONLY: the issue with a NATIVE row produces no write, drifted fields and all');
  ok(planA.skipped_existing.deliverables === 1 && planA.skipped_existing.by_team.video === 1,
    'and the skip is counted, per team — the guard leaves public evidence');
  const newBatch = planA.writes.batches.find(b => b.client_slug === 'fixture-brand');
  ok(!!newBatch, 'the stray issue brings its batch with it');
  ok(!!(newBatch && newBatch.linear_parent_ids && newBatch.linear_parent_ids.video && newBatch.linear_parent_ids.graphics),
    'and the batch arrives with BOTH parent slots — the synthesis piece composes with this one');

  // ---------- Scenario B: stray mode in the WRONG world --------------------
  setAuthority('linear', 'syncview');
  const planB = await stray.buildIncrementalPlan();
  ok(!planB.writes.deliverables.some(r => r.team === 'video'),
    'ONE WORLD: stray mode under a Linear-authoritative video team writes nothing for video');
  ok(planB.gated.deliverable_write_candidates > 0,
    'and reports the held-back rows as gated rather than dropping them silently');

  // ---------- Scenario C: the classic lane is byte-for-byte itself ---------
  setAuthority('linear', 'linear');
  const classic = freshModule(false);
  const planC = await classic.buildIncrementalPlan();
  ok(planC.stray_catcher === false, 'flag off: the plan says so');
  ok(planC.skipped_existing.deliverables === 0 && planC.skipped_existing.batches === 0,
    'flag off: the insert-only mechanism never fires');
  ok(!planC.writes.deliverables.some(r => r.linear_issue_uuid === 'uuid-stray'),
    'flag off: the 655-profile issue stays OUT of scope — the classic filter is untouched');
  ok(planC.writes.deliverables.some(r => r.linear_issue_uuid === 'uuid-tracked'),
    'flag off: the drifted tracked row IS an update candidate — classic refresh behaviour survives');

  // ---------- Scenario D: batch insert-only, proven with the real minted id -
  setAuthority('syncview', 'syncview');
  const strayAgain = freshModule(true);
  // Two feedback passes because the two properties fail in opposite fixtures.
  // BYTE-EQUAL feedback never becomes a compare candidate, so it can only
  // prove the skip COUNT (a count based on candidates would report 0 on
  // exactly the pass where the guard held the most back). DRIFTED feedback
  // (an operator renamed the stored copy) IS a candidate classic mode would
  // write, so it is the only fixture that proves insert-only — byte-equal
  // feedback would let the equality filter do all the work.
  const feedBack = name => [nativeBatch, ...planA.writes.batches
    .map(b => ({ id: b.id, client_slug: b.client_slug, team: b.team, name: name || b.name, description: b.description, status: 'active', created_by: b.created_by, linear_parent_ids: b.linear_parent_ids }))];
  stub.batches = feedBack(null);
  const planD1 = await strayAgain.buildIncrementalPlan();
  ok(planD1.writes.batches.length === 0,
    'a batch that exists (fed back its own minted id) is not written again');
  ok(planD1.skipped_existing.batches >= 1,
    'and the batch skip is counted even with nothing drifted — the count means "encountered", not "update withheld"');
  stub.batches = feedBack('Renamed by an operator');
  const planD2 = await strayAgain.buildIncrementalPlan();
  ok(planD2.writes.batches.length === 0,
    'a DRIFTED existing batch is not written either — insert-only, not field equality, holds it back');
  stub.batches = [nativeBatch];

  // ---------- The per-write assert follows the mode ------------------------
  // applyIncrementalPlan needs live RPC stubs to execute; the mode line inside
  // assertFreshLinearAuthority is pinned instead, beside the executed plan
  // gates above that prove the same policy at plan time.
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const assertBody = source.slice(source.indexOf('async function assertFreshLinearAuthority'),
    source.indexOf('\n}', source.indexOf('async function assertFreshLinearAuthority')));
  ok(/const requiredAuthority = STRAY_CATCHER \? 'syncview' : 'linear';/.test(assertBody),
    'the per-write authority re-read derives its requirement from the SAME flag');
  ok(/stray-catcher write frozen for Linear-authoritative/.test(assertBody),
    'and a stray write into the wrong world names itself in the error');

  fs.rmSync(tmp, { recursive: true, force: true });
  if (failures) {
    console.error(`\n${failures} b1 stray-catcher check(s) failed`);
    process.exit(1);
  }
  console.log('\nB1 stray-catcher mode checks passed');
})().catch(err => { console.error(err); process.exit(1); });
