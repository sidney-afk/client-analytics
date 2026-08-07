'use strict';
/*
 * A batch parent must declare its own state, and the drill must check where
 * the create actually landed.
 *
 * TWO COMPLAINTS, ONE SHAPE (2026-08-07).
 *
 * 1. NESTING. From the 2026-08-02 deploy until 2026-08-07, every item created
 *    through Calendar "Create Post" came out UNPARENTED — at the top level of
 *    the project instead of nested under its batch. Root cause and fix are in
 *    test/linear-autolink-parent-linkage.js.
 *
 * 2. TRIAGE. Opening one of those issues showed it sitting in "Triage", a
 *    queue the studio has never used. `resolveContext` only resolves
 *    `context.state_id` when the payload carries `status`, and the batch-parent
 *    payload carried team_id, project_id, title and description — no status.
 *    So `issueCreate` was sent with no `stateId` and Linear applied the TEAM
 *    DEFAULT. Video has triage enabled; Graphics does not. Same code, two
 *    different-looking results, which is why it read as a Video-only oddity.
 *    The child items were never affected — they have always carried `status`.
 *
 * Both were invisible for the same reason: the daily drill asserted that the
 * issues EXISTED and never where they LANDED. That is the recurring defect in
 * this project — a check that confirms something happened without confirming it
 * was right, the same shape as a monitor that reads a heartbeat's age and never
 * the ok flag the heartbeat stores.
 *
 * So this suite guards the fix AND the check. Shipping the payload change
 * without the drill assertion would leave the next regression just as silent.
 */
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const gateway = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const outbound = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'linear-outbound', 'index.ts'), 'utf8');
const mapping = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'linear-outbound', 'mapping.mjs'), 'utf8');
const drill = fs.readFileSync(path.join(ROOT, 'scripts', 'production-write-drill.js'), 'utf8');

// --- 1. The parent payload declares a state --------------------------------
const parentPayload = gateway.slice(
  gateway.indexOf('const parentOutbound: JsonMap = {'),
  gateway.indexOf('const parentEvent = eventFor('));
ok(parentPayload.length > 0, 'the batch-parent outbound payload is still built in one place');
ok(/\bstatus: "todo",/.test(parentPayload),
  'the batch parent declares status "todo" instead of inheriting the team default (this is the Triage fix)');
ok(/title: clean\(batchInput\.name\)/.test(parentPayload) && /project_id: projectByTeam\[team\]/.test(parentPayload),
  'the rest of the parent payload is unchanged');

// --- 2. That status is what makes a stateId reach Linear -------------------
// The chain is load-bearing and spans two files. If any link drifts, the
// payload above becomes decoration.
ok(/const stateSlug = clean\(payload\.status\);/.test(outbound)
  && /context\.state_id = clean\(payload\.state_id\) \|\| stateIdForSlug\(states, stateSlug\);/.test(outbound),
'resolveContext turns payload.status into context.state_id');
ok(/if \(!context\.state_id\) throw new Error\("outbound state mapping missing"\);/.test(outbound),
  'a team with no matching state fails the create CLOSED rather than landing somewhere unwatched');
ok(/stateId: clean\(payload\.state_id \|\| context\.state_id\) \|\| undefined,/.test(mapping),
  'the create mutation sends stateId from that context');

// "todo" must be a slug the mapper can actually resolve. Both Linear teams
// expose a state named exactly "Todo"; STATUS_NAMES is what connects the two.
ok(/\btodo: "Todo",/.test(mapping),
  'the "todo" slug maps to the state name "Todo", which both teams define');

// --- 3. Declaring status also ARMS the post-create verification ------------
// createIntentMismatches only compares state when the payload asked for one, so
// before this change nothing checked where the parent went — not even in
// principle.
const mismatches = mapping.slice(mapping.indexOf('function createIntentMismatches(issue, payload, context)'));
ok(/Object\.prototype\.hasOwnProperty\.call\(payload, "status"\)/.test(mismatches)
  && /clean\(issue && issue\.state && issue\.state\.id\) !== clean\(context\.state_id\)/.test(mismatches),
'the create verification compares the resulting state whenever the payload declared one');

// --- 4. The drill must assert NESTING, not existence ----------------------
ok(/parent \{ id identifier state \{ name type \} \}/.test(drill),
  'the drill asks Linear for the issue s parent (it never used to)');
const nesting = drill.slice(drill.indexOf('async function verifyNesting'),
  drill.indexOf('async function verifyFixture'));
ok(nesting.length > 0, 'the nesting check exists as its own function');
ok(/linear_parent_ids/.test(nesting),
  'it asserts SyncView recorded a parent id for the batch');
ok(/assert\(parent && parent\.id,/.test(nesting),
  'it asserts Linear actually applied the parent — the exact fact five green runs never checked');
ok(/clean\(parent\.id\) === recordedParent/.test(nesting),
  'the two sides must agree, so a parent recorded but never sent is caught');
ok(/parentState !== 'triage'/.test(nesting),
  'it asserts the parent did not land in Triage');
ok(/await verifyNesting\(asset, issue\);/.test(drill),
  'verifyFixture calls it — an unreferenced check proves nothing');
ok(/nesting_by_team:/.test(drill),
  'the run report publishes what was proved, so a green run says which parent and which state');

// --- 5. The reader must match the column's ONLY writer ---------------------
/*
 * Drill run #31 failed here, and the fault was the check, not the product.
 *
 * `linear_parent_ids` is a team-keyed object of OBJECTS — mergeBatchParentIds
 * emits `{ uuid, identifier, url }`. The first version of verifyNesting read
 * `parentIds[team]` as a string, so `clean()` produced "[object Object]": the
 * "a parent was recorded" assertion passed on a truthy stringified object
 * without verifying anything, and the id comparison then failed. A check
 * written to catch "confirms something happened without confirming it was
 * right" had exactly that defect in its own first line.
 *
 * Meanwhile the run proved the product worked: VID-13267 came out with
 * parentId VID-13266, and VID-13266 landed in Todo rather than Triage.
 *
 * Every shape the writer can leave behind is exercised, plus the shape gate
 * that makes the original mistake unrepresentable.
 */
const { recordedParentUuid, parentTeamKey, FAILURE_CLASSES, classifyFailure } =
  require('../scripts/production-write-drill.js');
const UUID = '4264ca43-6e6f-4106-b005-4363bd034024';

const shapes = [
  ['the canonical object the writer emits', { video: { uuid: UUID, identifier: 'VID-1' } }, 'video', UUID],
  ['the column read back as a JSON string', JSON.stringify({ video: { uuid: UUID } }), 'video', UUID],
  ['a key the writer would normalize (GRA)', { GRA: { uuid: UUID } }, 'graphics', UUID],
  ['the legacy array form', [{ team: 'video', id: UUID }], 'video', UUID],
  ['a legacy entry carrying linear_issue_id', { video: { linear_issue_id: UUID } }, 'video', UUID],
  ['another team s parent is not borrowed', { graphics: { uuid: UUID } }, 'video', ''],
  ['no linkage at all', null, 'video', ''],
  ['an unparseable column', 'not json', 'video', ''],
];
for (const [label, raw, team, expected] of shapes) {
  ok(recordedParentUuid(raw, team) === expected, `reads ${label}`);
}
ok(parentTeamKey('GRA') === 'graphics' && parentTeamKey('graphic') === 'graphics'
  && parentTeamKey('VID') === 'video' && parentTeamKey('') === 'video',
'the team key is normalized exactly as the writer normalizes it');

const UUID_RE_IN_DRILL = /UUID_RE = \/\^\[0-9a-f\]\{8\}-/;
ok(UUID_RE_IN_DRILL.test(drill) && /assert\(UUID_RE\.test\(recordedParent\)/.test(drill),
  'the recorded parent must LOOK like a uuid, so "[object Object]" can never satisfy it again');

// --- 6. A failure must name the assertion, not just the stage --------------
// Run #31 reported error_code: video_verification, error_class: unclassified —
// the third time in one day a check published THAT it failed without WHAT.
const classified = [
  ['graphics batch recorded no Linear parent issue id (linear_parent_ids carries no usable uuid for the team)',
    'batch_parent_not_linked'],
  ['video item was created at the top level instead of nested under its batch parent', 'item_not_nested'],
  ['video item is nested under a different issue than the batch parent SyncView recorded',
    'item_nested_under_wrong_parent'],
  ['video batch parent landed in Triage instead of the state the create declared', 'batch_parent_in_triage'],
];
for (const [message, expected] of classified) {
  ok(classifyFailure(new Error(message)) === expected,
    `"${expected}" is reported by name rather than as unclassified`);
}
ok(new Set(FAILURE_CLASSES.map(entry => entry[1])).size === FAILURE_CLASSES.length,
  'every failure class is distinct, so two different diagnoses never share a code');

if (failures) {
  console.error(`\n${failures} batch-parent state/nesting check(s) failed`);
  process.exit(1);
}
console.log('\nBatch parent state + drill nesting checks passed');
