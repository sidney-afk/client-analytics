'use strict';
/*
 * production_component_fill: the write behind "add the missing component",
 * which is the only way a half-complete card can be completed at all.
 *
 * Measured live 2026-08-31 across non-archived cards: 459 carry both
 * components, 67 only a video, 60 only a graphic, 102 neither. The 127 in the
 * middle are the population this exists for.
 *
 * TWO HALVES, AND THIS FILE IS THE SECOND ONE.
 *
 *  1. The SOURCE guards below hold everywhere, with no database. They pin the
 *     properties that make this function safe to expose from a calendar card
 *     rather than a fact about one call.
 *  2. The REHEARSAL executes the real RPC against a disposable PostgreSQL 16 --
 *     every happy path and every refusal, each with its own error code. It is
 *     the same code path as `npm run test:component-fill-rehearsal`, imported
 *     rather than copied. It SKIPS where the server binaries are absent,
 *     because that is an environment fact and not a defect; CI's unit lane
 *     pins postgres:16, so the executed half runs there.
 *
 * Both halves matter. A source test cannot tell you that PL/pgSQL guard
 * ordering does what the comments claim -- the first draft of the rehearsal
 * reported four false passes for exactly that reason, every one of them
 * short-circuiting on the occupancy check before reaching the guard it named.
 * And the rehearsal cannot run on a laptop without PostgreSQL. Neither alone
 * is the test.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(
  path.join(ROOT, 'migrations', '2026-08-31-production-component-fill.sql'), 'utf8');

/* The structural guards below read CODE, not prose. This migration's header
   quotes the very things it exists to avoid -- `ordinal = base + group_index`,
   `'Video ' || ordinal` -- and its rollback note spells out a `drop function`,
   so scanning the raw file reported two failures for text that is an
   explanation of the bug rather than the bug. Comments are stripped first;
   the assertions that are ABOUT the documentation use SQL. */
const CODE = SQL
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(line => line.replace(/--.*$/, '')).join('\n');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- 1. It is additive. The append path is not touched. ----------------- */
/* A fill that "fixed" intake numbering would be a change to the write path
   every post in the estate goes through, for the sake of 127 cards. */

ok(!/create or replace function public\.production_intake_append/.test(CODE),
  'does not redefine production_intake_append — a repair must not rewrite intake');
ok(!/\balter table\b|\bdrop (table|column|function|index|policy)\b|\bcreate table\b/i.test(CODE),
  'touches no table, column, index or policy');

/* ---- 2. It INHERITS. It does not allocate. ------------------------------ */
/* This is the whole reason it is a separate function. planAppendIntakeItems and
   the append RPC both compute `ordinal = base + group_index` and refuse a title
   that is not 'Video ' || ordinal; only 65 of the 126 live siblings are titled
   that way, and 21 of those carry a null sort_key. */

ok(/component_fill_sort_mismatch/.test(CODE),
  'refuses a row whose sort_key is not the sibling\'s, rather than allocating one');
ok(/is distinct from v_sibling\.sort_key/.test(CODE),
  'and compares against the sibling as NUMERIC, so a null inherits as a null');
ok(!/_intake_ordinal/.test(CODE),
  'carries no ordinal concept at all — nothing here can renumber a batch');
ok(!/'(?:Sample )?(?:Video|Thumbnail) ' \s*\|\|/.test(CODE),
  'and composes no title from a number; the title arrives from the sibling');

/* ---- 3. THE OWNER'S TWO RULES, 2026-08-31 ------------------------------- */
/* "any creation of sub issues should be done from the content calendar" and
   "I don't want people to add a sub-issue that wouldn't appear on the
   calendar." Both are structural here, not conventions. */

ok(/component_fill_card_mismatch/.test(CODE),
  'the card the caller names must be the card the sibling actually carries — a fill cannot invent an attachment');
ok(!/insert into public\.calendar_posts/i.test(CODE),
  'and it never creates a CARD, so a component made here is always attached to one that already existed');

/* THE CARD IS READ AND LOCKED, which is what makes the line above true rather
   than merely intended. Raised by Codex on PR 1195: everything else here
   validates the SIBLING, and `deliverables.card_id` is plain text with no
   foreign key, so before this the function would happily attach a live
   deliverable to a card that had been archived since the tab loaded -- or to
   one that never existed. Archiving a post PARKS its sub-issues (owner ruling
   2026-08-17), and the park covers only what it captured before the archive
   write, so a fill landing after it mints work nothing will ever park. */
ok(/from public\.calendar_posts c[\s\S]{0,200}for update/.test(CODE)
  && /from public\.sample_reviews s[\s\S]{0,200}for update/.test(CODE),
  'the card row itself is read and locked — on BOTH card tables, so the samples surface is covered too');
ok(/component_fill_card_missing/.test(CODE),
  'a card that is not there is refused, rather than gaining an orphan component');
ok(/component_fill_card_archived/.test(CODE),
  'and an archived card is refused, because archiving parks sub-issues and a later fill would never be parked');
ok(/coalesce\(v_batch\.purpose, 'calendar'\) = 'samples'/.test(CODE),
  'and which table it reads follows the BATCH purpose, the same value that already decides the row origin');
ok(/component_fill_team_occupied/.test(CODE),
  'a card that already has that team is refused — no card can grow a second video or a second thumbnail');
ok(/from public\.deliverables d\s*\n\s*where d\.client_slug = v_batch\.client_slug/.test(CODE),
  'and the duplicate check reads COMMITTED ROWS, so two tabs racing the button serialize on the batch lock');

/* ---- 3b. The parent route is inherited, like everything else ----------- */
/* Raised by Codex on PR 1195 and measured: of the 47 distinct batches behind
   the 127 half-complete cards, 25 record a parent for the team being FILLED and
   22 do not. A single-team batch records a parent only for the team it was
   created with, so asking the map for the missing team's parent answers
   nothing -- and the write was refused on nearly half the population this
   function exists for. */

ok(/v_sibling_parent_ids := public\.production_batch_parent_ids_for_team\(\s*\n?\s*v_batch\.linear_parent_ids, v_sibling\.team\)/.test(CODE),
  'the sibling\'s parent route is resolved, not only the target team\'s');
ok(/when cardinality\(v_own_parent_ids\) = 1 then v_own_parent_ids\s*\n\s*else v_sibling_parent_ids/.test(CODE),
  'the target team\'s own entry wins when it has one, and the sibling\'s is used when it does not');
ok(/cardinality\(v_own_parent_ids\) = 0[\s\S]{0,200}v_sibling\.team/.test(CODE),
  'and the dependency waiver is extended only for a target team with NO parent of its own — not as a blanket');
ok(/v_own_parent_ids\) = 1 and v_own_parent_ids = v_dep_parent_ids/.test(CODE),
  'while the original identical-parent waiver is kept intact beside it');

/* ---- 4. Every guard the append path applies, still applied -------------- */

for (const [needle, why] of [
  ['production_assert_authority', 'refuses a team that is Linear-authoritative'],
  ['production_outbox_replay', 'an exact retry replays instead of writing twice'],
  ['write_conflict', 'CAS on batches.updated_at'],
  ['batch_not_active', 'refuses an archived batch'],
  ['for update', 'takes the batch and sibling locks'],
  ['production_batch_parent_ids_for_team', 'validates the Linear parent route'],
  ["origin' is distinct from coalesce(v_batch.purpose", 'a calendar row cannot land in a samples batch'],
]) {
  ok(CODE.includes(needle), why + ' (' + needle + ')');
}

ok(/revoke all on function public\.production_component_fill[\s\S]{0,200}grant execute[\s\S]{0,120}to service_role/.test(CODE),
  'service_role only — never anon or authenticated');

/* ---- 5. Executed, where a PostgreSQL 16 exists -------------------------- */

function have(bin) {
  if (fs.existsSync('/usr/lib/postgresql/16/bin/' + bin)) return true;
  return spawnSync('bash', ['-lc', 'command -v ' + bin], { encoding: 'utf8' }).status === 0;
}

if (!have('initdb') || !have('psql')) {
  console.log('  --  rehearsal SKIPPED: no PostgreSQL 16 server binaries here (source guards above still ran)');
} else {
  console.log('  --  running the executed rehearsal against a disposable PostgreSQL 16');
  const { rehearse } = require('../scripts/component-fill-rehearsal.js');
  let passed = false;
  try { passed = rehearse(); }
  catch (error) { console.error('      ' + ((error && error.message) || String(error))); }
  ok(passed, 'the RPC rehearsal passed: both happy paths, and every refusal returned its own code');
}

console.log(failures === 0
  ? '\nproduction_component_fill checks passed'
  : '\n' + failures + ' production_component_fill check(s) failed');
process.exit(failures === 0 ? 0 : 1);
