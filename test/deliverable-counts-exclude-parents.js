'use strict';
/*
 * A BATCH PARENT IS NOT WORK — AND EVERY PLACE THAT COUNTS MUST KNOW IT.
 *
 * The B1 import writes a deliverable row for the parent issue itself and files
 * it inside the batch, so nothing about a parent row's SHAPE says "not work".
 * 75 of 535 open rows are that today (docs/ops/OPEN_REPAIRS.md item 50), and
 * every consumer that counts deliverables has had to learn it independently.
 * Three learned it the hard way, one at a time:
 *
 *   1. the browser Create Post editor pool — a parent row inflated its
 *      assignee's load, skewing the freest-editor suggestion;
 *   2. the gateway `autoAssigneeForIntake` — the same skew, server side, which
 *      had to be fixed symmetrically or the two would disagree;
 *   3. `_calFetchNativeBatchPostCounts` — found 2026-08-27 by this file's own
 *      sweep. It decides which batches rank LAST as empty, and the ranking
 *      exists because an empty twin was being offered above the sibling
 *      holding the work. Measured live the same day: 317 of 402 active
 *      batches counted their own parent, and 60 showed as populated while
 *      holding ZERO real posts — the exact rows the ranking was built to sink
 *      never sank.
 *
 * Three instances of one defect is a class, not a coincidence. The fix each
 * time is local and easy; the failure is that a new consumer has no way to
 * KNOW. So this suite does two things: it executes the third fix, and it holds
 * a REGISTRY of every site that reads more than one deliverable row. A new
 * aggregation site fails this file until somebody writes down which side of
 * the line it is on — which is the only mechanism here that prevents a fourth.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const gateway = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- 1. the third fix, EXECUTED -------------------------------------------
const from = html.indexOf('function _calNativeParentUuids(');
const to = html.indexOf('/* Which view is currently open for a given surface.');
ok(from > -1 && to > from, 'the count helpers are findable (harness is not vacuous)');

/* The real function, with only its network read stubbed — the rows it would
   have fetched are handed in instead, shaped exactly as the live view returns
   them. */
const makeCounter = rows => new Function('_prodRestRows',
  html.slice(from, to) + '\nreturn { _calFetchNativeBatchPostCounts, _calNativeParentUuids };')(
  async () => rows);

/* The measured shape: one batch whose only deliverable row IS its own parent,
   and one holding a real paired post plus its parent. */
const batches = [
  { id: 'b-empty', linear_parent_ids: { video: { uuid: 'p-empty' }, graphics: { uuid: 'p-empty' } } },
  { id: 'b-real', linear_parent_ids: { video: { uuid: 'p-real' }, graphics: { uuid: 'p-real' } } },
];
const rows = [
  { batch_id: 'b-empty', card_id: '', id: 'd1', linear_issue_uuid: 'p-empty' },
  { batch_id: 'b-real', card_id: '', id: 'd2', linear_issue_uuid: 'p-real' },
  { batch_id: 'b-real', card_id: 'card-9', id: 'd3', linear_issue_uuid: 'vid-1' },
  { batch_id: 'b-real', card_id: 'card-9', id: 'd4', linear_issue_uuid: 'gra-1' },
];

(async () => {
  const scope = makeCounter(rows);
  const counts = await scope._calFetchNativeBatchPostCounts(batches);

  ok(counts.get('b-empty') === 0,
    'a batch holding only its own parent row counts ZERO posts — 60 live batches were counting 1');
  ok(counts.get('b-real') === 1,
    'and a real paired post still counts once, both halves sharing one card');

  /* Inversion: without the exclusion the empty batch reads as populated, which
     is precisely how it escaped the empty-ranking for months. */
  const naive = makeCounter(rows);
  const parentless = batches.map(b => ({ id: b.id }));
  const naiveCounts = await naive._calFetchNativeBatchPostCounts(parentless);
  ok(naiveCounts.get('b-empty') === 1,
    'strip the parent map and the same batch reads as populated again — the assertion above is doing work');

  ok(scope._calNativeParentUuids(batches).size === 2,
    'the parent set is derived from the batch rows already in hand — no second network read to be correct');
  ok(scope._calNativeParentUuids([{ id: 'x' }, null, { id: 'y', linear_parent_ids: 'not an object' }]).size === 0,
    'and a batch with no parent map, or a malformed one, contributes nothing rather than throwing');

  // ---- 2. the registry: no new consumer counts parents by accident --------
  /* Enclosing-function names for every site that reads MORE THAN ONE
     deliverable row. Single-row lookups by id are deliberately out of scope: a
     parent row fetched by its own id is a legitimate target, not a miscount. */
  const enclosing = (source, index) => {
    const head = source.slice(0, index);
    const marks = [...head.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)];
    return marks.length ? marks[marks.length - 1][1] : '(top level)';
  };
  /* Counted PER OCCURRENCE, not collapsed to a set of names.
   *
   * The first version of this sweep stored bare function names, which Codex
   * caught on review: a SECOND query added inside an already-registered
   * function would have been silently accepted, so the guard did not actually
   * guard the thing it advertised. Every site now carries how many qualifying
   * queries its function is known to hold, and a mismatch fails — adding a
   * query anywhere forces a line here, which is the whole mechanism. */
  const sitesIn = (source, pattern, qualifies) => {
    const found = new Map();
    for (const match of source.matchAll(pattern)) {
      if (qualifies && !qualifies(source, match.index)) continue;
      const name = enclosing(source, match.index);
      found.set(name, (found.get(name) || 0) + 1);
    }
    return found;
  };

  /* Browser: every mention of the deliverables view. Deliberately broad — a
     miss here is a fourth instance, a false positive is one registry line. */
  const browserSites = sitesIn(html, /production_deliverables_browser_v1/g);
  /* Gateway: MULTI-ROW selects only, over the table OR the browser view — the
     view gained a gateway reader on 2026-08-27 (autoAssigneeForIntake's parent
     read, which must use the view because raw_issue_parent_id exists nowhere
     else), and a sweep that only watched from("deliverables") would have let
     every future view read through unregistered. A read pinned to one id
     cannot miscount, because a parent row fetched by its own id is a
     legitimate target rather than noise in a total — so those are out of
     scope by construction, not by anybody's judgement. */
  const gatewaySites = sitesIn(gateway, /from\("(?:deliverables|production_deliverables_browser_v1)"\)\s*\n?\s*\.select\(/g, (source, index) => {
    const tail = source.slice(index, index + 420);
    const singleById = (tail.includes('maybeSingle()') || (tail.includes('.eq("id"') && !tail.includes('count:')))
      && !tail.includes('.in("id"');
    return !singleById;
  });

  /* THE REGISTRY. Every entry is a decision somebody made on the record: how
     many qualifying queries that function holds, and which side of the line
     they are on. PARENT_AWARE excludes batch-parent rows; EXEMPT does not,
     with the reason it does not need to. */
  const PARENT_AWARE = {
    _calNativeVideoEditorPool: [2, 'freest-editor suggestion — the count read plus the parent-uuid read it excludes with'],
    _calFetchNativeBatchPostCounts: [1, 'empty-batch ranking — excludes parents via the batch parent map'],
    autoAssigneeForIntake: [2, 'gateway auto-assign — the load read plus its parent-uuid read, symmetric with the browser'],
  };
  const EXEMPT = {
    _prodLoadDeliverableProjection: [1, 'loads the Production TREE, where parent rows ARE the parent nodes — removing them orphans every imported child. Their overdue treatment is withheld by the display gate (_prodRowOverdue) instead'],
    _prodDeltaRefresh: [1, 'the incremental half of that same tree projection'],
    _prodBrowserProjectionMissing: [1, 'an error classifier — matches the view name inside a failure detail, reads nothing'],
    wlFetchNativeMetadata: [1, 'Workload metadata keyed by issue id; the board filters is_sub_issue upstream, so a batch parent never reaches this call'],
    reclaimMirrorBatches: [1, 'counts a displaced batch to decide whether it is EMPTY enough to archive — there the parent row is precisely what must be counted'],
    handleEntityOperation: [1, 'resolves ONE entity by its link column with limit 2, purely to detect ambiguity; it is not a total of anybody work'],
    handleIntakeCreate: [4, 'append planning. The ordinal is derived from titles matching the Video N / Thumbnail N pattern, which a batch parent title never matches, so parents cannot shift the numbering; the other reads are keyed by explicit id lists'],
    _prodAssetDefaultEvidence: [1, 'names the browser view in a COMMENT explaining why no asset column is readable from it, and reads nothing at all. Same false positive as _prodBrowserProjectionMissing, and the same answer: the sweep is deliberately broad, so a false positive costs one registry line'],
    handleBatchDescriptionWrite: [1, 'the SAME TEAM FALLBACK as handleBatchAssetWrite, for the same reason and by deliberate copy: a post description is read by every sibling on every team, `batches.team` is null on 303 of 1,644 batches, and authorizing on that column alone is what made the folder slots unwritable by anyone. Selects only `team`, counts nothing, sums nothing, and is never written back -- a batch parent among those rows contributes the team its siblings already do, so it cannot skew a value that is not a total (added 2026-09-01 with production_batch_description_write)'],
    handleBatchAssetWrite: [1, 'the TEAM FALLBACK, added 2026-08-31 after the round-3 tester found Raw footage and Frame folder unsaveable by anyone on any post: `batches.team` is null on 303 of 1,644 batches, and both the gateway permission check and production_assert_authority refused on it. It selects only `team`, takes the first row that carries one, counts nothing and sums nothing -- a batch parent among those rows would contribute the same team its siblings do, so it cannot skew a value that is not a total. It is deliberately NOT written back: repairing the column belongs to intake, and guessing one in on a read path is how a wrong value becomes permanent'],
    handleBatchFilesRead: [1, 'the file links behind the sub-issue pills, read per batch. It is a LIST, not a total: nothing is counted, summed or ranked, and each row is emitted only if it has a file, so a batch parent among the rows would at worst contribute one more pill to a list that is already about individual issues. A synthetic parent has no deliverable row at all, and a real hierarchy parent that carries a file is a row whose file a reader would legitimately want to open'],
  };

  const registered = Object.assign({}, PARENT_AWARE, EXEMPT);
  const drift = [];
  for (const [name, count] of [...browserSites, ...gatewaySites]) {
    const entry = registered[name];
    if (!entry) { drift.push(`${name}: UNREGISTERED (${count} quer${count === 1 ? 'y' : 'ies'})`); continue; }
    if (entry[0] !== count) drift.push(`${name}: registered ${entry[0]}, found ${count}`);
  }
  for (const name of Object.keys(registered)) {
    if (!browserSites.has(name) && !gatewaySites.has(name)) drift.push(`${name}: registered but no longer present`);
  }
  ok(drift.length === 0,
    'every deliverable-aggregation query is registered, and no function has gained or lost one'
    + (drift.length ? ' — DRIFT: ' + drift.join('; ') : ''));
  ok(browserSites.size > 0 && gatewaySites.size > 0,
    'the sweep actually found sites in both files (harness is not vacuous)');
  /* The property Codex named, proven rather than asserted: plant a SECOND
     query inside a function that is ALREADY registered, and the sweep must
     report drift for it. The first version of this file keyed on names alone
     and would have absorbed it silently. */
  const anchor = 'const parentUuids = _calNativeParentUuids(rowsIn);';
  ok(html.includes(anchor), 'the seed anchor exists (harness is not vacuous)');
  const seededHtml = html.replace(anchor,
    anchor + '\n        const smuggled = await _prodRestRows("production_deliverables_browser_v1", "id", "", 1000, 1);');
  const seededSites = sitesIn(seededHtml, /production_deliverables_browser_v1/g);
  ok(seededSites.get('_calFetchNativeBatchPostCounts') === 2
    && browserSites.get('_calFetchNativeBatchPostCounts') === 1,
    'a second query smuggled into an already-registered function is COUNTED, so the registry catches it');

  /* And the three that must exclude really do, checked in their own source
     rather than taken on the registry's word. */
  const poolSrc = html.slice(html.indexOf('function _calNativeVideoEditorPool('), html.indexOf('function _calNativeEditorDisclaimer('));
  ok(/raw_issue_parent_id/.test(poolSrc) && /parentUuids\.has/.test(poolSrc),
    'the editor pool still excludes parent rows');
  const countSrc = html.slice(from, to);
  ok(/parentUuids\.has\(String\(row && row\.linear_issue_uuid/.test(countSrc),
    'the batch post count excludes parent rows');
  const assignSrc = gateway.slice(gateway.indexOf('async function autoAssigneeForIntake('), gateway.indexOf('async function autoAssigneeForIntake(') + 4000);
  ok(/parentUuids\.has\(clean\(row\.linear_issue_uuid\)\)/.test(assignSrc),
    'the gateway auto-assign excludes parent rows, symmetrically');

  if (failures) {
    console.error(`\n${failures} deliverable-count check(s) failed`);
    process.exit(1);
  }
  console.log('\ndeliverable counts exclude batch parents — all sites registered');
})();
