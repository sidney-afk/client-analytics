'use strict';
/*
 * A DELIVERABLE WITH A REAL, CORRECTLY BOUND CARD CAN RECEIVE AN ARTIFACT --
 * EVEN WHEN ITS `origin` COLUMN HAS DRIFTED.
 *
 * OWNER REPORT, 2026-09-05: attaching a deliverable file to one sub-issue of a
 * post was refused with "The deliverable was not changed because its linked
 * card could not be updated safely", while its 31 siblings accepted the same
 * kind of link.
 *
 * THE ROW carries `origin = 'manual'` and a real `p_` card id. That card is in
 * the same client and names THIS deliverable back, in the slot for THIS team --
 * the binding is intact in both directions. Every sibling carries
 * `origin = 'calendar'`. Only the filing column disagrees.
 *
 * WHY IT REFUSED EVERY ATTACH. production_artifact_write routed the card
 * projection on a literal `origin` chain: `= 'calendar'`, `= 'samples'`, else
 * (card_id not null) raise. With `origin = 'manual'` and a card id the first
 * two arms are false and the third is unconditionally true, so it raised
 * `artifact_card_projection_scope_invalid` -- not `..._failed`, which is gated
 * on a projection surface having been chosen and is unreachable for this shape.
 * Both map to one 409 and one sentence in the panel, which is why the owner's
 * message could not distinguish them. The raise aborts a transaction that has
 * already written file_url and bumped artifact_revision, so both roll back and
 * "the deliverable was not changed" is literal.
 *
 * MEASURED 2026-09-05 across all 6,330 browser-visible deliverables: 7 live
 * rows carry a real `p_` card id while `origin` is still 'manual'.
 *
 * TWO HALVES, and this suite holds both:
 *   - the READ side, migrations/2026-09-05-artifact-card-binding-first.sql:
 *     when `origin` names no surface but a card IS named, resolve the surface
 *     from the two-way binding instead;
 *   - the PRODUCER, scripts/b1-linear-backfill.js: it adopted
 *     `preferred.card_id` onto a native-batch row while `origin` fell back to
 *     the literal 'manual' and never consulted `preferred.origin` -- two halves
 *     of one fact resolved from two sources.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(
  path.join(ROOT, 'migrations/2026-09-05-artifact-card-binding-first.sql'), 'utf8');
const PRIOR = fs.readFileSync(
  path.join(ROOT, 'migrations/2026-08-30-artifact-video-projection.sql'), 'utf8');
const BACKFILL = fs.readFileSync(
  path.join(ROOT, 'scripts/b1-linear-backfill.js'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- 1. The read side: the surface comes from the binding --------------- */

ok(/v_card := nullif\(btrim\(coalesce\(v_result\.card_id, ''\)\), ''\);/.test(SQL),
  'the card id is resolved once into a local rather than re-derived in three branch conditions');
ok(/v_surface := case\s*\n\s*when v_result\.origin in \('calendar', 'samples'\) then v_result\.origin\s*\n\s*end;/.test(SQL),
  "and `origin` still decides the surface whenever it names one, so no row that attaches correctly today changes behaviour");
ok(/if v_surface is null and v_card is not null then/.test(SQL),
  'the binding is consulted ONLY when origin names no surface and a card IS named -- which is exactly the shape that raised on every attach before');

const branch = SQL.slice(SQL.indexOf('if v_surface is null and v_card is not null then'),
  SQL.indexOf("if v_surface = 'calendar'"));
ok(/from public\.calendar_posts p/.test(branch) && /from public\.sample_reviews p/.test(branch),
  'and both card surfaces are asked, not just the one the report happened to involve');
ok((branch.match(/p\.client = v_result\.client_slug/g) || []).length === 2,
  'each lookup is pinned to THIS row\'s client, so a card id colliding across clients can never be adopted');
ok((branch.match(/then p\.video_deliverable_id\s*\n\s*else p\.graphic_deliverable_id end\) = v_result\.id/g) || []).length === 2,
  'and each requires the card to name THIS deliverable back in the slot for THIS team -- the same direction and the same team pairing the projection arms use, so a surface resolved here is one whose update below matches exactly one row');
ok(branch.indexOf('calendar_posts') < branch.indexOf('sample_reviews'),
  'calendar is tried first and wins a tie, so the surface never depends on evaluation order');

ok(/elsif v_card is not null then[\s\S]{0,1200}raise exception 'artifact_card_projection_scope_invalid';/.test(SQL),
  'a card that NO surface binds back to is still refused -- the fix reads around a drifted filing column, it does not invent a card');
ok(/if v_projection_surface is not null\s*\n\s*and \(v_projection_updated > 1 or v_projection_matches <> 1\) then\s*\n\s*raise exception 'artifact_card_projection_failed';/.test(SQL),
  'and the projection readback is unchanged, so a projection that lands on zero or many rows still rolls the attach back');

/* The rest of the function is load-bearing and must not have moved. */
const bodyOf = src => src.slice(src.indexOf('\nbegin\n'), src.indexOf('\n$fn$;'));
const prior = bodyOf(PRIOR);
const next = bodyOf(SQL);
for (const [label, fragment] of [
  ['the advisory-lock ORDER against production_deliverable_write',
    "perform pg_advisory_xact_lock(hashtextextended('production-artifact:' || v_id, 0));"],
  ['the second advisory lock, in the same sequence',
    "perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));"],
  ['the artifact_revision increment',
    'v_next_revision := coalesce(v_current.artifact_revision, 0) + 1;'],
  ['the deliverable write it wraps',
    'v_result := public.production_deliverable_write(v_row, v_event);'],
]) {
  ok(prior.includes(fragment) && next.includes(fragment),
    label + ' is byte-identical to the 2026-08-30 definition');
}

ok(!/alter table|drop |create table|create index|create trigger|create policy/i.test(SQL),
  'the migration is additive: no table, column, index, trigger or policy is touched');
ok(/create or replace function public\.production_artifact_write/i.test(SQL),
  'and it is a CREATE OR REPLACE of the same function, so re-applying it is idempotent');
ok(!/update public\.deliverables[\s\S]{0,200}set[\s\S]{0,80}origin/i.test(SQL),
  'and it writes no row at install time -- the drifted filing column is read around, never repaired, because that would be a write on live client rows');

/* ---- 2. The producer: origin follows the card id ------------------------ */

const producer = BACKFILL.slice(BACKFILL.indexOf('ONE CARD, ONE SOURCE'),
  BACKFILL.indexOf('sync_state:', BACKFILL.indexOf('ONE CARD, ONE SOURCE')));
ok(producer.length > 0, 'the backfill records why the two halves must share a source');
ok(/preferred \? preferred\.origin :/.test(producer),
  "the origin now falls back to `preferred.origin` -- the same source the card id is adopted from -- instead of to the literal 'manual'");
ok(/clean\(alreadyStored\.card_id\)\s*\n?\s*\? \(clean\(alreadyStored\.origin\) \|\| 'manual'\)/.test(producer),
  'a row that KEEPS its own stored card id keeps its own stored origin beside it, rather than adopting a different card\'s');
ok(/card_id: nativeBatchId\s*\n\s*\? \(clean\(alreadyStored\.card_id\) \|\| \(preferred \? preferred\.card_id : null\)\)/.test(BACKFILL),
  'and the card id fallback itself is unchanged, so this moves only the half that was inconsistent with it');

console.log(failures === 0
  ? '\nartifact card binding-first checks passed'
  : '\n' + failures + ' artifact card binding-first check(s) failed');
process.exit(failures === 0 ? 0 : 1);
