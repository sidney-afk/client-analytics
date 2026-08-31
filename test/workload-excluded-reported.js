'use strict';
/*
 * An empty Workload board is read as "no work". It was sometimes a lie.
 *
 * Found by the unknowable-assertion sweep, 2026-08-31, in two separate
 * candidates that turned out to share one shape and one repair.
 *
 * wlApplyData buckets every active sub-issue in a single pass, and two of its
 * branches removed a row from EVERY panel and said nothing:
 *
 *   1. no assignee AND no work day or deadline. The "Needs assignment" strip is
 *      keyed on having somewhere to put the row, so a dateless unassigned row
 *      falls past it and past every later bucket.
 *   2. an assignee who is not on the roster of THAT ROW'S team. The comment
 *      called these "sub-issues stuck on former editors", which is one case it
 *      catches and not what the predicate asks — a current designer assigned to
 *      a video-team row was dropped identically.
 *
 * Measured live 2026-08-30, replaying the bucketing over workload_issues: of
 * 210 active sub-issues on the seed roster, 167 visible and 42 discarded — 20%
 * — with two clients losing every row they had, so filtering to one of them
 * produced a completely blank board with no message at all.
 *
 * THE REPAIR IS TO REPORT, NOT TO RE-BUCKET, and that distinction is the point
 * of this file. Both verifiers reached it independently. Routing these rows
 * into the "Needs assignment" strip turns a five-chip line into forty-seven,
 * built with applyEditorFilter=false so not one of them carries a "Set work
 * day" button — forty-two rows surfaced with no action on any. Routing them
 * into the tweak bucket is worse: every downstream consumer keys on assigneeId,
 * so unassigned rows collapse into a phantom editor and distort the capacity
 * model the auto-placement pass runs on. And widening the team predicate opens
 * a second capacity lane for a person who already has one on their own team,
 * double-counting them in the matrix.
 *
 * So nothing moves. The rows are counted, and the board says what it is not
 * showing.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

// --- the sentence, executed ------------------------------------------------
const ctx = {};
vm.createContext(ctx);
vm.runInContext(grabFunc('wlExcludedSummaryText') + '\nthis.summary = wlExcludedSummaryText;', ctx);
const summary = ctx.summary;

const rows = n => Array.from({ length: n }, (_, i) => ({ id: 'row-' + i }));

ok(summary({ noAssigneeNoDate: [], offTeamAssignee: [] }, 12) === '',
  'nothing excluded says NOTHING -- a banner that appears with nothing to report is its own lie');
ok(summary(null, 12) === '' && summary(undefined, 0) === '',
  'and an absent record is silence too, not a crash or a zero-count sentence');

{
  const text = summary({ noAssigneeNoDate: rows(3), offTeamAssignee: rows(2) }, 167);
  ok(/5 sub-issues are not shown here/.test(text),
    'with work still visible it reports the count as an omission from a working board');
  ok(/no assignee and no work day or deadline/.test(text)
    && /not on that issue team/.test(text),
    'and names BOTH reasons, because they need different repairs -- one is a plan, one is a mis-filed row');
}

{
  /* The case that made two clients disappear. The board is not incomplete
     here, it is empty, and an empty board answers a question nobody asked:
     "does this client have work?" */
  const text = summary({ noAssigneeNoDate: rows(4), offTeamAssignee: [] }, 0);
  ok(/Nothing is shown here, but this is not an empty board/.test(text),
    'with NOTHING visible it contradicts the reading an empty board invites, first');
  ok(/4 sub-issues are excluded/.test(text),
    '...and then says how many');
}

{
  const one = summary({ noAssigneeNoDate: rows(1), offTeamAssignee: [] }, 5);
  ok(/1 sub-issue is not shown/.test(one) && /1 has no assignee/.test(one),
    'one row reads as one row, in both clauses');
  const oneOff = summary({ noAssigneeNoDate: [], offTeamAssignee: rows(1) }, 5);
  ok(/1 is assigned to someone/.test(oneOff),
    'and the team clause agrees with itself in the singular too');
}

// --- the bucketing records them, and moves nothing -------------------------
const apply = grabFunc('wlApplyData');
ok(/const excluded = \{ noAssigneeNoDate: \[\], offTeamAssignee: \[\] \};/.test(apply),
  'the bucketing pass records what it removes');
ok(/else excluded\.noAssigneeNoDate\.push\(s\);/.test(apply),
  'a dateless unassigned row is recorded rather than dropped past every bucket');
ok(/excluded\.offTeamAssignee\.push\(s\);/.test(apply),
  'and so is a row whose assignee is not on that issue team');
ok(/wlState\.excluded\s*=\s*excluded;/.test(apply),
  'and the record reaches the state the renderer reads');

/* THE LOAD-BEARING NEGATIVE. If a later change re-buckets these rows to make
   the banner go away, the capacity model moves and the matrix double-counts.
   The counts must stay counts. */
ok(!/excluded\.noAssigneeNoDate[\s\S]{0,200}unassigned\.push/.test(apply)
  && !/excluded\.offTeamAssignee[\s\S]{0,200}(tweaksNeeded|planned|overdue|undated)\.push/.test(apply),
  'NOTHING excluded is also pushed into a visible bucket -- reporting is the repair, re-bucketing is the trap');

// --- the comment says what the predicate actually tests ---------------------
/* Targeted at the CLAIM, not at a phrase. The retired sentence is quoted in
   the new comment precisely so a later reader can see what was corrected and
   why, so a bare substring check would fail on its own documentation. What
   must be gone is the assertion that the drop is silent and harmless. */
ok(!/silently dropped/.test(apply),
  'the comment no longer says these rows are silently dropped, which is the part that stopped being true');
ok(/is one case it catches and not/.test(apply),
  'and it corrects the old reading rather than deleting it, so the next reader knows the predicate is about TEAM');
ok(/THIS ROW'S TEAM/.test(apply),
  'it says what is really being tested');
ok(/capacity\s+is keyed on the row team/.test(apply),
  'and names why widening the predicate is not the repair, which is the mistake the next person would make');

// --- the banner speaks last -------------------------------------------------
const status = grabFunc('renderWorkloadPlanStatus');
ok(status.indexOf('backgroundError') < status.indexOf('wlExcludedSummaryText'),
  'a real refresh failure outranks a completeness note');
ok(/status === 'ready'\s*\n?\s*\? wlExcludedSummaryText/.test(status),
  'and the note is only offered once the plan itself is ready, never over a loading or stale board');

console.log(failures === 0
  ? '\nWorkload excluded-rows reporting checks passed'
  : '\n' + failures + ' workload exclusion check(s) failed');
process.exit(failures === 0 ? 0 : 1);
