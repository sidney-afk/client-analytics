'use strict';
/*
 * WHETHER A BATCH CAN TAKE A POST IS A QUESTION ABOUT ITS PARENTS.
 *
 * It was being answered by `batches.team`, in three places at once — the
 * picker, the gateway and the append RPC. That column cannot answer it. The B1
 * import derives it as "the one team all my CHILDREN share, or null when they
 * span both" (scripts/b1-linear-backfill.js:760), while the parent map keys
 * come from each child's PARENT's team; the import states at :848-865 that the
 * two "legitimately disagree — a graphics child can hang off a video batch
 * card".
 *
 * The cost, measured 2026-08-26: 143 of 397 active batches carried a stamp, and
 * every one of them was refused a Video + Thumbnail post however complete its
 * parent map was. Two SMMs reported it the same day as batches "not appearing
 * in the list". The by-hand repair — clear the column — is undone by the next
 * import, which recomputes it from those same children, so the workaround
 * expires on a 30-minute clock.
 *
 * The rule is now the one thing the picker can establish from the row itself,
 * and the same one `parentIdsForTeam` enforces in the gateway: every team the
 * post needs has a parent recorded.
 *
 * IT DELIBERATELY DOES NOT SECOND-GUESS THE OWNER TEAM. The first version of
 * this rule did, and it was wrong (caught in review 2026-08-27):
 * `synthesizeParentMap` can mirror one team's parent into the other's slot with
 * `owner_team` recorded, and `validateLinearBatchParent` then compares that
 * issue's PROJECT against the REQUESTING team's project. For the 28 clients
 * whose Video and Graphics map to the same Linear project — every client in the
 * two reports, verified live — those are the same project, so the gateway
 * ACCEPTS the append. Rejecting cross-owned primaries hid batches the server
 * would have taken, which is the symptom this change exists to end.
 *
 * The picker cannot see project mappings on this path, so it cannot tell a
 * shared-project client from one of the 3 split ones. The honest default is to
 * offer and let the server decide: a split client with a mirrored parent gets
 * `batch_parent_mapping_missing`, which the dialog renders as a specific
 * sentence. A visible refusal beats an invisible absence.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const gateway = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const v7 = fs.readFileSync(
  path.join(ROOT, 'migrations', '2026-08-26-production-intake-append-v7.sql'), 'utf8');
const v6 = fs.readFileSync(
  path.join(ROOT, 'migrations', '2026-08-19-production-intake-append-v6.sql'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- the picker rule, EXECUTED --------------------------------------------
const from = html.indexOf('function _calNativeBatchParentTeams(');
const to = html.indexOf('function _calNativeBatchHasLinearParents(');
ok(from > -1 && to > from, 'the picker rule is findable (harness is not vacuous)');
const compatible = new Function('CAL_NATIVE_MODE_TEAMS',
  html.slice(from, to) + '\nreturn _calNativeBatchCompatible;')(
  { video: ['video'], thumbnail: ['graphics'], both: ['video', 'graphics'] });

/* The two reported rows, and every one of the ten like them: a video parent
   owned by video, and a graphics key pointing at that same issue with the
   owner recorded — the shape ONE PARENT PER CARD produces. */
const shared = { linear_parent_ids: { video: { uuid: 'vid-1' }, graphics: { uuid: 'vid-1', owner_team: 'video' } } };
const withStamp = Object.assign({ team: 'video' }, shared);
const noStamp = Object.assign({ team: null }, shared);
const wrongStamp = Object.assign({ team: 'graphics' }, shared);

ok(compatible(withStamp, 'both') === true,
  'a batch that has only held video work can take a Video + Thumbnail post — the reported case');
ok(compatible(withStamp, 'video') === true, 'and still takes a video-only post, as it always did');

/* THE POINT: the answer must not move when the column moves. Same parents,
   three different stamps, one answer. */
ok(compatible(noStamp, 'both') === compatible(withStamp, 'both')
  && compatible(wrongStamp, 'both') === compatible(withStamp, 'both'),
  'the stamp is irrelevant — clearing it, setting it, or setting it wrong gives the same answer');
/* Comments stripped first: this rule carries a long note explaining WHY it
   ignores the stamp and the owner team, and a naive search would find those
   words in the explanation and call it a use. */
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ruleSrc = stripComments(html.slice(html.indexOf('function _calNativeBatchCompatible('), to));
ok(/needed\.every/.test(ruleSrc), 'the stripped rule still contains its real logic (harness is not vacuous)');
ok(!/\bbatch\.team\b/.test(ruleSrc),
  'because the rule does not read the column at all');
ok(!/owner_team/.test(ruleSrc),
  'and does not guess at owner teams either — that question needs the project mappings only the server has');

// ---- what must STILL be refused -------------------------------------------
const oneParent = { team: 'video', linear_parent_ids: { video: { uuid: 'vid-1' } } };
ok(compatible(oneParent, 'both') === false,
  'a batch with only one team\'s parent is still hidden — 127 live rows, and the gateway would refuse them');
ok(compatible(oneParent, 'thumbnail') === false, 'and cannot take a thumbnail-only post either');
ok(compatible(oneParent, 'video') === true, 'while the team it CAN file is still offered');

/* The mirrored shape is OFFERED. Whether it files depends on the client's
   project mappings, which the gateway can read and the picker cannot: for the
   28 shared-project clients the append succeeds, for the 3 split ones the
   gateway refuses with a sentence the dialog already renders. */
const mirrored = { team: 'video', linear_parent_ids: { video: { uuid: 'gra-9', owner_team: 'graphics' }, graphics: { uuid: 'gra-9' } } };
ok(compatible(mirrored, 'both') === true,
  'a cross-owned primary parent is offered rather than hidden on a guess about projects');
ok(compatible(mirrored, 'video') === true, 'in every mode where it is the primary');

/* And the case that made the first version's cost concrete: a thumbnail-only
   post on the shared-parent shape. Its graphics parent is a video issue, and
   for a shared-project client the gateway takes it — so hiding it removed a
   working option from the very batches this change was fixing. */
ok(compatible(withStamp, 'thumbnail') === true,
  'a thumbnail-only post is offered on the shared-parent shape, which the server accepts for shared-project clients');

ok(compatible(null, 'both') === false && compatible({}, 'both') === false,
  'a missing batch or an empty one is refused rather than throwing');

// ---- the same rule, in the two server layers ------------------------------
ok(!/throw new GatewayError\(409, "batch_team_mismatch"\)/.test(gateway),
  'the gateway no longer vetoes an append on the team column');
ok(/ownsDistinctParent/.test(gateway) && /validateLinearBatchParent/.test(gateway),
  'and still decides by resolving and validating a parent, which is what refuses the rest');

const clause = 'or (v_batch.team is not null and v_team is distinct from v_batch.team)';
/* Compared over the EXECUTABLE half only: v7's header quotes the clause it
   removes, which is exactly what a reader needs and would make a whole-file
   search say the opposite of the truth. */
/* From the first definition to the final `commit;`. The trailing OWNER-ONLY
   ROLLBACK block is commented-out prose, and v7 rewrites it on purpose: a
   supersede is rolled back by re-running v6, not by dropping a function a
   deployed gateway still calls. Comparing that prose as if it were code would
   fail this on a correction that makes the file safer. */
const executable = text => {
  const from = text.indexOf('create or replace function');
  const to = text.lastIndexOf('\ncommit;');
  return text.slice(from, to > from ? to + '\ncommit;'.length : undefined);
};
ok(executable(v6).includes(clause), 'the applied migration carries the clause (harness is not vacuous)');
ok(!executable(v7).includes(clause), 'and v7 removes it from the function it installs');
ok(v7.includes(clause), 'while still quoting it in the header, so the change is legible without a diff');
ok(/SUPERSEDES migrations\/2026-08-19-production-intake-append-v6\.sql/.test(v7),
  'v7 names what it supersedes, as every migration here does');
/* Derived mechanically: the executable half must differ from v6 by exactly the
   removed line, so nothing else can ride along in a migration nobody re-reads. */
const body = text => executable(text).split('\n');
const v6Body = body(v6);
const v7Body = body(v7);
const removed = v6Body.filter(line => !v7Body.includes(line));
const added = v7Body.filter(line => !v6Body.includes(line));
ok(removed.length === 1 && removed[0].includes(clause) && added.length === 0,
  'and the executable body differs from v6 by exactly that one line, nothing else');

if (failures) {
  console.error(`\n${failures} batch-append parent-map check(s) failed`);
  process.exit(1);
}
console.log('\nbatch append parent-map rule checks passed');
