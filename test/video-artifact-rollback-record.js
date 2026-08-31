'use strict';
/*
 * A rollback note that names the wrong sequence is worse than no note.
 *
 * Found in review of PR #1182 (Codex, P2). The video-artifact migration shipped
 * with this rollback instruction: re-apply the August 6 definition, and nothing
 * else needs undoing. That is true only while the migration is the ONLY layer
 * shipped. Once the gateway and the browser carry the widening too, reverting
 * the database alone leaves the gateway accepting a video attach and calling a
 * graphics-only function whose raise reaches rpc() as a 500
 * native_write_failed -- while the panel goes on offering the control.
 *
 * So the note pointed an operator, mid-incident, at the one sequence that
 * causes an incident. Deploy runs bottom-up; rollback runs top-down and stops
 * before the database, because the migration is additive and unreachable once
 * the gateway is restored.
 *
 * ROLLBACK.md is law in this repository (AGENTS.md requires it to move with the
 * change it describes). This suite holds both records to the corrected order,
 * because the failure mode is not a missing file -- it is a present file that
 * confidently says the wrong thing, which no existence check can catch.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'migrations', '2026-08-30-artifact-video-projection.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'ROLLBACK.md'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// The migration's own note is what an operator reads first: they are already
// in the file, because it is the thing they came to undo.
const note = MIGRATION.slice(MIGRATION.indexOf('-- ROLLBACK.'), MIGRATION.indexOf('begin;'));
ok(note.length > 200, 'the migration carries a rollback note');
ok(/TOP-DOWN/.test(note),
  'and it says the direction, which is the whole point: deploy is bottom-up, rollback is not');
ok(/native_write_failed/.test(note),
  'it names the concrete failure a database-only revert produces, not just "do not do it"');
ok(/[Ll]eave THIS migration installed/.test(note),
  'it says plainly that the database layer stays');
ok(!/nothing else needs undoing/.test(note),
  'the original claim -- that reverting the database alone restores the prior refusal -- is gone');

const entry = (ROLLBACK.match(/- \*\*Video deliverables may carry a canonical artifact[\s\S]*?(?=\n- \*\*|$)/) || [''])[0];
ok(entry.length > 400, 'ROLLBACK.md carries the entry AGENTS.md requires for this change');
ok(/deploy-f27-section4-closures\.yml/.test(entry),
  'it names the lane that performs the source-exact gateway restore, not a vague "redeploy"');
ok(/browser/.test(entry) && entry.indexOf('browser') < entry.indexOf('deploy-f27-section4-closures'),
  'and it orders the browser revert BEFORE the gateway redeploy, which is what bounds the stale-tab window');
ok(/leave the migration installed/i.test(entry),
  'the entry agrees with the migration: the database layer is not rolled back');

/* The one-step switch is a standing rule in ROLLBACK.md, and a rollback record
   that names one without naming its blast radius invites an operator to reach
   for it on a narrow defect and take the whole tab down. */
ok(/prod_authority/.test(entry) && /linear/.test(entry),
  'the entry names the one-step containment');
ok(/production_assert_authority/.test(entry),
  'and says WHERE it takes effect, so the claim is checkable rather than asserted');
ok(/every native video write|status, due date, assignee, comments/.test(entry),
  'and states its cost: it is not scoped to attach');

/* The containment claim has to be true of the shipped function, not just
   plausible. If the authority assertion ever leaves production_artifact_write,
   this record becomes a promise the database does not keep. */
const fn = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.production_artifact_write'));
const authorityAt = fn.indexOf('production_assert_authority(');
const projectionAt = fn.indexOf('update public.calendar_posts');
ok(authorityAt > 0 && projectionAt > 0 && authorityAt < projectionAt,
  'production_artifact_write really does assert authority before it projects anything');

console.log(failures === 0
  ? '\nVideo-artifact rollback record checks passed'
  : '\n' + failures + ' rollback record check(s) failed');
process.exit(failures === 0 ? 0 : 1);
