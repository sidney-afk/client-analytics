'use strict';
/*
 * THE NATIVE WORKLOAD SOURCE MUST SPEAK THE SAME VOCABULARY AS THE ONE IT
 * REPLACES, AND MUST NOT QUIETLY CHANGE THE BOARD ON THE WAY.
 *
 * Step 1 of docs/ops/WORKLOAD_NATIVE_SOURCE.md, which exists because the
 * Workload board is the only major surface still reading a Linear-derived
 * table -- so Linear is a mandatory relay rather than a legacy mirror, and
 * OPEN_REPAIRS item 95 measures what that already costs: 40 live deliverables
 * across 10 active clients that the board cannot see because something
 * archived their issues in Linear.
 *
 * `migrations/2026-09-02-workload-native-view.sql` builds the replacement
 * source and changes no browser code. This suite is what makes that migration
 * worth reviewing rather than trusting: it pins the four things that would let
 * a correct-looking view be wrong.
 *
 * VERIFIED ON A REAL DATABASE, not only by pattern. The migration was applied
 * to a disposable PostgreSQL 16 cluster against the schema from
 * `2026-07-06-b1-linear-data-model.sql` and `2026-07-05-b0-linear-auth-scaffold.sql`
 * and read back with fixtures covering a null-team batch, a both-teams batch,
 * an archived batch holding live work, and a batch with no deliverables. That
 * run is what caught `min(team)` silently meaning "graphics" for every mixed
 * batch. Executing it here would require a live server in every unit run, so
 * the shape it proved is pinned below as source contracts.
 *
 * PROVENANCE OF THE STATUS TYPES. Measured 2026-09-02 over the live
 * `workload_issues` (3,437 rows, every distinct (status, status_type) pair
 * read with the browser publishable key). `Approved`, `Scheduled` and `Posted`
 * are all type `completed` -- which the parked-NAME list would not lead you to
 * assume, and assuming wrong would hide or show real work.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SQL = read('migrations/2026-09-02-workload-native-view.sql');
const MAPPING = read('supabase/functions/linear-outbound/mapping.mjs');
const MODEL = read('migrations/2026-07-06-b1-linear-data-model.sql');
const INDEX = read('index.html');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- 1. The status DISPLAY NAMES are the ones SyncView already writes ---- */

/* Two maps that must agree, so read both and compare rather than eyeballing.
   `STATUS_NAMES` in mapping.mjs is what linear-outbound sends INTO Linear; the
   view is what the board reads back OUT. If they drift, a status written by
   SyncView and a status read by Workload stop being the same word. */
const outbound = new Map();
{
  const block = /const STATUS_NAMES = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(MAPPING);
  ok(!!block, 'mapping.mjs still declares STATUS_NAMES as one frozen object, so there is a single place to read it from');
  const body = block ? block[1] : '';
  const pair = /([a-z_]+):\s*"([^"]+)"/g;
  let m;
  while ((m = pair.exec(body)) !== null) outbound.set(m[1], m[2]);
}

const viewNames = new Map();
{
  const block = /case d\.status([\s\S]*?)end\s+as status\b/.exec(SQL);
  ok(!!block, 'the view maps native status to a display name with one CASE expression');
  const body = block ? block[1] : '';
  const pair = /when\s+'([a-z_]+)'\s+then\s+'([^']+)'/g;
  let m;
  while ((m = pair.exec(body)) !== null) viewNames.set(m[1], m[2]);
}

const missing = [...outbound.keys()].filter(k => !viewNames.has(k));
const extra = [...viewNames.keys()].filter(k => !outbound.has(k));
const disagree = [...outbound].filter(([k, v]) => viewNames.has(k) && viewNames.get(k) !== v)
  .map(([k, v]) => `${k}: outbound "${v}" vs view "${viewNames.get(k)}"`);

ok(outbound.size >= 13, `read ${outbound.size} status names from mapping.mjs to compare against`);
ok(missing.length === 0, missing.length === 0
  ? 'the view names every status linear-outbound can write'
  : 'the view is missing: ' + missing.join(', '));
ok(extra.length === 0, extra.length === 0
  ? 'and names no status linear-outbound does not know, so there is no third vocabulary'
  : 'the view invents: ' + extra.join(', '));
ok(disagree.length === 0, disagree.length === 0
  ? 'and every display string is byte-identical between the two — a status SyncView writes is the status Workload reads'
  : disagree.join('; '));

/* ---- 2. The map is TOTAL against the column's own CHECK constraint ------- */

/* A native status with no mapping answers NULL, and a NULL status_type passes
   `wlIsActiveStatus` -- so an unmapped value does not disappear, it renders as
   live work with no status at all. That is why the migration refuses to commit
   on one, and why the constraint is read here rather than transcribed. */
const constrained = new Set();
{
  const block = /status text not null default 'in_progress' check \(status in([\s\S]*?)\),/.exec(MODEL);
  ok(!!block, 'the deliverables status CHECK constraint is readable from the data-model migration');
  const body = block ? block[1] : '';
  const lit = /'([a-z_]+)'/g;
  let m;
  while ((m = lit.exec(body)) !== null) constrained.add(m[1]);
}
const unmapped = [...constrained].filter(s => !viewNames.has(s));
ok(constrained.size >= 13 && unmapped.length === 0,
  unmapped.length === 0
    ? `all ${constrained.size} values the deliverables CHECK constraint allows are mapped`
    : 'these constrained statuses have no mapping and would render as live work with no status: ' + unmapped.join(', '));

ok(/raise exception[\s\S]{0,200}does not map/.test(SQL) && /status not in \(/.test(SQL),
  'AND THE MIGRATION REFUSES TO COMMIT if a status ever escapes the map — a guard in the file beats a guard in a test, because the file is what gets applied');
const guarded = new Set((/status not in \(([\s\S]*?)\)/.exec(SQL) || [, ''])[1].match(/'([a-z_]+)'/g) || []
  .map(s => s.replace(/'/g, '')));
{
  const listed = new Set(((/status not in \(([\s\S]*?)\);?/.exec(SQL) || [, ''])[1].match(/'[a-z_]+'/g) || [])
    .map(s => s.replace(/'/g, '')));
  const drift = [...viewNames.keys()].filter(k => !listed.has(k))
    .concat([...listed].filter(k => !viewNames.has(k)));
  ok(drift.length === 0, drift.length === 0
    ? 'and that guard lists exactly the statuses the CASE maps, so the two cannot drift apart inside one file'
    : 'the commit guard and the CASE disagree about: ' + drift.join(', '));
}
void guarded;

/* ---- 3. Types come from the measurement, and the terminal ones matter ---- */

const viewTypes = new Map();
{
  const block = /case d\.status([\s\S]*?)end\s+as status_type\b/.exec(SQL);
  ok(!!block, 'the view maps native status to a Linear workflow-state TYPE with its own CASE expression');
  const body = block ? block[1] : '';
  const pair = /when\s+'([a-z_]+)'\s+then\s+'([a-z_]+)'/g;
  let m;
  while ((m = pair.exec(body)) !== null) viewTypes.set(m[1], m[2]);
}

/* Measured live 2026-09-02, and each of these decides whether a row is work
   somebody is holding. They are asserted individually because a wrong one is
   invisible: the board simply shows a different set of rows. */
[
  ['todo', 'unstarted', 'Todo is live work — 595 rows, and typing it `backlog` would empty the board'],
  ['backlog', 'backlog', 'Backlog is parked by the 2026-08-23 owner ruling, and only the TYPE carries that'],
  ['triage', 'triage', 'Triage is parked'],
  ['in_progress', 'started', 'In Progress is live'],
  ['smm_approval', 'started', 'For SMM approval is type-live and parked by NAME instead — the two mechanisms are not interchangeable'],
  ['kasper_approval', 'started', 'For Kasper approval, likewise'],
  ['client_approval', 'started', 'For Client approval, likewise'],
  ['tweak', 'started', 'Tweak Needed is live work — it is work sent back, not work finished'],
  ['approved', 'completed', 'Approved is `completed` in the live data, NOT `started` as the parked-name list suggests'],
  ['scheduled', 'completed', 'Scheduled is `completed` too'],
  ['posted', 'completed', 'Posted is `completed`'],
  ['canceled', 'canceled', 'Canceled is terminal'],
  ['duplicate', 'duplicate', 'Duplicate is terminal — the F40 gate found a Duplicate row holding a designer\'s capacity'],
].forEach(([status, type, why]) => {
  ok(viewTypes.get(status) === type, `${status} → ${type}: ${why}`);
});

/* ---- 4. THE TRAP: it must not switch the board's ordering on ------------ */

/* `deliverables.sort_key` exists and `workload_issues` has no sort column at
   all, so this view CAN supply the manual ordering the board has been doing
   without. Naming that column `sort_order` would switch it on the moment the
   view is read, because `_wlV2MapRow` reads `r.sort_order` and
   `wlSortSubIssues` uses manual order as soon as EVERY row has a finite value.
   Scope doc §4 says do not reintroduce it without asking. So this is a
   load-bearing NEGATIVE: the column ships inert, under another name. */
ok(!/\bas sort_order\b/.test(SQL),
  'the view does NOT publish a `sort_order` column — supplying one would silently re-sort the whole board on first read');
ok(/\bas native_sort_key\b/.test(SQL),
  'it publishes `native_sort_key` instead, so the data is there for whoever decides they want it and inert until then');
ok(/_wlV2MapRow[\s\S]{0,900}sortOrder:\s*r\.sort_order/.test(INDEX),
  'and the reason still holds: _wlV2MapRow reads exactly `r.sort_order`, which this view leaves undefined');

/* ---- 5. Every field the board actually consumes is answered ------------- */

/* Read the mapper rather than the scope document's table: the mapper is what
   runs. Anything it reads and the view does not answer arrives `undefined`. */
const mapper = /function _wlV2MapRow\(r\) \{([\s\S]*?)\n    \}/.exec(INDEX);
ok(!!mapper, 'the row mapper is readable from index.html, so this list is derived rather than transcribed');
const consumed = [...new Set(((mapper ? mapper[1] : '').match(/r\.([a-z_]+)/g) || [])
  .map(s => s.slice(2)))];
const DELIBERATELY_ABSENT = new Set(['sort_order']);   // see section 4

/* PER ARM, NOT PER FILE. This is a UNION view, and searching the whole file
   for `as <column>` passes as soon as EITHER arm answers it -- which is how a
   first draft of this suite missed a renamed column in the sub-issue arm while
   the parent arm's `null::text as assignee_email` kept it quiet. */
const arms = SQL.slice(SQL.indexOf('create or replace view'), SQL.lastIndexOf(';\n\nalter view'))
  .split(/\nunion all\n/);
ok(arms.length === 2, 'the view is exactly two UNION ALL arms — sub-issues from deliverables, parents from batches');
const aliasesOf = arm => (arm.match(/\bas\s+([a-z_][a-z_0-9]*)\s*(?:,|\n\s{2}from)/g) || [])
  .map(s => s.replace(/^\s*as\s+/, '').replace(/\s*(?:,|\n\s{2}from)$/, '').trim());
const armAliases = arms.map(aliasesOf);

ok(armAliases[0].length >= 24 && armAliases[1].length === armAliases[0].length,
  `both arms publish the same number of columns (${armAliases[0].length})`);

/* AND IN THE SAME ORDER. A UNION pairs columns POSITIONALLY and takes its
   names from the first arm only, so an alias out of order in the second arm
   compiles cleanly and quietly puts one column's values under another's name.
   On this view most of the second arm is NULL, which is precisely where such a
   swap would hide. */
const orderDrift = armAliases[0]
  .map((name, i) => (armAliases[1][i] === name ? null : `position ${i + 1}: sub-issue arm says \`${name}\`, parent arm says \`${armAliases[1][i]}\``))
  .filter(Boolean);
ok(orderDrift.length === 0, orderDrift.length === 0
  ? 'and in the same order — a UNION pairs columns by position and names them from the first arm, so a reordered second arm would silently file one column under another\'s name'
  : orderDrift.join('; '));

const unanswered = [];
consumed.filter(col => !DELIBERATELY_ABSENT.has(col)).forEach(col => {
  armAliases.forEach((names, i) => {
    if (!names.includes(col)) unanswered.push(`${col} (${i === 0 ? 'sub-issue' : 'parent'} arm)`);
  });
});
ok(consumed.length >= 15 && unanswered.length === 0,
  unanswered.length === 0
    ? `all ${consumed.length - DELIBERATELY_ABSENT.size} fields the mapper reads are answered by BOTH arms (plus sort_order, withheld on purpose)`
    : 'the mapper reads these and an arm does not answer them: ' + unanswered.join(', '));

/* ---- 6. The identity decision is deferred, not taken -------------------- */

/* Scope doc §6.1 is an owner decision, and taking it here would have been
   silent data loss: `public.workload_plan` is keyed on the LINEAR uuid, so
   every manual plan day already saved joins on it. The view answers both. */
ok(/\bas id\b/.test(SQL) && /\bas linear_id\b/.test(SQL),
  'the view answers BOTH identities — native `id` and `linear_id` — so the owner decision in scope §6.1 is still open');
ok(/workload_plan/.test(SQL),
  'and it says why in the file: workload_plan is keyed on the Linear uuid today, so choosing native here would orphan every saved plan day');

/* ---- 7. Step 1 changes nothing anyone can see -------------------------- */

/* The invariant is not "index.html never names the view" -- step 2 names it, to
   read the two sources side by side and print the difference. The invariant is
   that THE BOARD'S OWN READ IS UNCHANGED: `_wlV2FetchIssues` still goes to
   `workload_issues`. A step that also switched the source could not be diffed
   against the old one, and it could not be done safely anyway while
   `workload_plan` is keyed on the Linear uuid. */
ok(/_wlV2FetchIssues\(\)[\s\S]{0,400}\/rest\/v1\/workload_issues\?select/.test(INDEX),
  'THE BOARD\'S OWN FETCH STILL READS workload_issues — building the view does not switch anything, and cannot until scope §6.1 is decided and workload_plan is re-keyed');
ok(/grant select on public\.workload_issues_native_v1 to anon;/.test(SQL)
  && /grant select on public\.workload_issues_native_v1 to authenticated;/.test(SQL),
  'it is granted to exactly the two browser roles workload_issues already serves');
ok(!/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\bdrop\s+/i.test(SQL),
  'and the migration writes nothing, drops nothing, and is re-runnable — the only statements are create-or-replace, grant, and a guard');
ok(/security_barrier = true/.test(SQL),
  'the view is a security barrier, matching every other browser-facing view in this estate');

/* ---- 8. The n8n boundary, stated in the file --------------------------- */

ok(/no workflow is touched|No workflow is touched/i.test(SQL),
  'the file states that no n8n workflow is touched — those are production sales automation and need the owner\'s explicit go-ahead');

console.log(failures === 0
  ? '\nworkload native view contract checks passed'
  : '\n' + failures + ' workload native view check(s) failed');
process.exit(failures === 0 ? 0 : 1);
