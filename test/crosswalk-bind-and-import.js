#!/usr/bin/env node
'use strict';
/*
 * production_comment_card_bind_and_import — the combined operation OPEN_REPAIRS
 * 147 §4 says the crosswalk repair cannot be finished without.
 *
 * Two halves, and neither alone is the test:
 *  1. SOURCE guards, so the properties are asserted as facts about the
 *     migration rather than one lucky call.
 *  2. The REHEARSAL executes the real function against a disposable
 *     PostgreSQL 16 -- happy path, idempotency, and every reachable refusal by
 *     its own error code. It SKIPS where the server binaries are absent, which
 *     is an environment fact and not a defect; CI's unit lane pins postgres:16.
 *
 * A source test cannot prove PL/pgSQL guard ORDER does what the comments claim.
 * The component-fill rehearsal's header records four false passes from exactly
 * that -- refusals short-circuiting on an earlier check than the one they
 * named -- so each refusal below is set up so only its own guard can fire.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { stripBlockComments } = require('./helpers/strip-comments');

const ROOT = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'migrations', '2026-09-05-crosswalk-bind-and-import.sql'), 'utf8');
/* Guards read CODE: the header explains at length what the function refuses,
   and asserting against prose would pass on the explanation. */
const CODE = stripBlockComments(SQL.replace(/^--.*$/gm, ' '), ' ');

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}

/* ---- 1. it binds only what the card already asserts --------------------- */

ok(/from public\.calendar_posts c\s+where c\.client = v_client_slug and c\.id = v_card_id/.test(CODE),
  'the card is looked up on the COMPOSITE key (client, id) — the bare id is reused across clients by design, so an id-only lookup would find the wrong card');
ok(/v_card_slot is distinct from v_deliverable_id/.test(CODE)
  && /crosswalk_bind_card_does_not_reference_deliverable/.test(CODE),
  'and it refuses unless the card ALREADY points at this deliverable, so a binding can never be invented');

/* ---- 2. the three refusals that exist because live data has them ------- */

ok(/crosswalk_bind_client_mismatch/.test(CODE),
  'a deliverable is never moved between clients — one live card points at another client\'s live deliverable, and binding it would rewrite the wrong row');
ok(/crosswalk_bind_already_bound_elsewhere/.test(CODE),
  'an existing binding is never re-pointed; filling a blank is a repair, moving one is a decision');
ok(/crosswalk_bind_slot_occupied/.test(CODE),
  'a contested card slot is reported rather than surfacing as a unique-violation that names neither card nor occupant');
ok(/d2\.id is distinct from v_card_other_slot/.test(CODE)
  && /lower\(btrim\(coalesce\(d2\.team, ''\)\)\) = v_expected_team\s+or lower\(btrim\(coalesce\(d2\.kind, ''\)\)\) = v_kind_after/.test(CODE),
  'and the occupancy probe keys on the SLOT FAMILY -- the slot\'s team or the kind the row will carry after the bind -- and never counts the row the card\'s OTHER slot points at (9 live graphic slots hold Video-team rows)');

/* ---- 2b. the card pointer is not authority on its own ------------------- */

/* Codex, #1273: with only the checks above, a card whose deliverable pointer is
   STALE but happens to name an unbound row of the same client would have that
   unrelated row rewritten and the card's conversation copied onto it. The two
   checks below are the ones scripts/f42-linkage-defect-repair.js already
   applies for the planner, and they are the only ones here that do not descend
   from the card pointer -- which is the entire point of them. */
/* Owner ruling 2026-09-05 (OPEN_REPAIRS 156): kind is a regex over the issue
   title and its parent's title, not a fact about the artifact. It refused 40 of
   107 live slots in which both sides named the SAME Linear issue. Identity is
   the proof; the label follows the card. */
ok(!/crosswalk_bind_kind_does_not_match_slot/.test(CODE) && !/v_expected_kind/.test(CODE),
  'kind never refuses — the former kind_does_not_match_slot guard is gone, and identity below is the one proof of "the same work item"');
ok(/v_kind_after := case when v_component = 'graphic' then 'thumbnail' else 'video' end;/.test(CODE)
  && /kind = v_kind_after/.test(CODE),
  "the label follows the card and becomes the SLOT KEY: video slot -> kind='video', graphic slot -> kind='thumbnail' — the two values deliverables_card_slot_unique and linear-inbound's maintainCardLinkage read, so a bound row can neither collide with its card's other slot nor be routed into the wrong one by a later inbound write");
/* Codex P1 on #1291: maintainCardLinkage (linear-inbound) reads any kind but
   'thumbnail' as the video slot. If the RPC ever leaves a graphic-slot row at
   'other', a team returned to Linear authority would write that row into
   video_deliverable_id on its next webhook. */
const INBOUND = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'linear-inbound', 'index.ts'), 'utf8');
ok(/clean\(deliverable\.kind\) === "thumbnail" \? "graphic_deliverable_id" : "video_deliverable_id"/.test(INBOUND)
  && !/in \('thumbnail', 'other'\) then lower\(btrim\(v_kind\)\)/.test(CODE),
  "and that is checked against the consumer, not assumed: linear-inbound still reads kind as a two-valued slot key, and the RPC no longer preserves 'other' on a graphic-slot row");
ok(/crosswalk_bind_linear_identity_unproven/.test(CODE)
  && /crosswalk_bind_linear_identity_disagrees/.test(CODE),
  'and both sides must name the SAME Linear issue, with either side missing treated as UNPROVEN rather than as permission');
ok(CODE.indexOf('crosswalk_bind_linear_identity_unproven') < CODE.indexOf('update public.deliverables'),
  'both are checked BEFORE the update — a guard that runs after the row is rewritten reports the refusal accurately and leaves the damage');

/* ---- 2b'. the slot: who loses it, and only on request ------------------- */

ok(/v_evict not in \('off', 'card_wins'\)/.test(CODE) && /crosswalk_bind_invalid_evict_mode/.test(CODE)
  && /if v_evict <> 'card_wins' then\s+raise exception 'crosswalk_bind_slot_occupied'/.test(CODE),
  "eviction is opt-in by NAME (evict_occupant='card_wins'); without it a contested slot is still the slot_occupied refusal, and any other value is refused rather than read as consent");
ok(/crosswalk_bind_occupant_same_issue/.test(CODE)
  && CODE.indexOf('crosswalk_bind_occupant_same_issue') < CODE.indexOf('update public.deliverables'),
  'an occupant naming the SAME issue as the card is a second projection of one issue, refused before anything is written — evicting it would cancel the issue the card keeps');
ok(/in \('approved', 'posted', 'canceled', 'duplicate'\) then 'detached'\s+else 'canceled'/.test(CODE),
  'a terminal occupant is only detached; a live one is canceled natively so it leaves every queue');
ok(/'crosswalk_occupant_evicted'/.test(CODE) && /mirror_outbox_enqueue\(/.test(CODE) && /p_operation := 'status'/.test(CODE)
  && !/linear\.app|graphql|net\.http/i.test(CODE),
  'each eviction is written to deliverable_events and the cancel is handed to the OUTBOUND lane as a status intent — never a direct Linear call from SQL');
ok(/set_config\('app\.event_written', '1', true\)/.test(CODE) && /set_config\('app\.event_written', v_prev_flag, true\)/.test(CODE)
  && /'crosswalk_bound'/.test(CODE),
  'the ledger guard is bypassed only around writes that record a richer event of their own, and restored to what the caller had');
/* The identifier parse is transcribed from linearIdentifier() in the planner.
   If the two ever disagree about what "the same issue" means, the SQL repair
   and the JS planner are repairing different things. */
const PLANNER = fs.readFileSync(path.join(ROOT, 'scripts', 'f42-linkage-defect-repair.js'), 'utf8');
ok(PLANNER.includes('[A-Za-z][A-Za-z0-9]*-') && CODE.includes('[A-Za-z][A-Za-z0-9]*-'),
  'and the SQL reads an issue identifier in the same shape the planner does — letters, a dash, digits — so "the same issue" means the same thing in the repair and in the runner that plans it');
ok(CODE.includes("'/issue/([A-Za-z]") && CODE.includes("'^([A-Za-z]"),
  'accepting BOTH shapes live rows carry: a full issue URL and a bare identifier. Refusing the URL shape would look like a clean run over a third of the work rather than a refusal');

/* ---- 2c. the card row is locked before it is trusted -------------------- */

/* Without this, staff relinking the card between the read and the commit leaves
   the function binding into a deliverable the card no longer points at; the
   nested import validates only the deliverable side and cannot notice. */
const cardSelect = CODE.slice(CODE.indexOf('from public.calendar_posts c'));
ok(/^[\s\S]{0,200}?for update/.test(cardSelect),
  'the card is selected FOR UPDATE, so its slot cannot change under the bind');
ok(CODE.indexOf('from public.calendar_posts c') < CODE.indexOf('from public.deliverables d\n'),
  'and the card is locked before the deliverable, so the two locks are always taken in the same order');

/* ---- 2d. the receipt counts inserts, not attempts ----------------------- */

/* production_comment_card_import returns the existing row on an idempotent
   retry and is otherwise indistinguishable from an insert, so counting the loop
   would let a runner certify more copied comments than were created. */
ok(/'processed', v_processed/.test(CODE) && /'already_linked', v_already/.test(CODE)
  && /v_already := v_already \+ 1;/.test(CODE),
  'the receipt separates processed / imported / already_linked rather than reporting the loop count as "imported"');

/* ---- 3. bind BEFORE import, in one transaction -------------------------- */

ok(CODE.indexOf('update public.deliverables') < CODE.indexOf('production_comment_card_import'),
  'the bind happens BEFORE the import — the import validates the crosswalk first, so the reverse order refuses exactly when the copy is needed');
/* `begin` opens the PL/pgSQL block and is not transaction control; matching it
   was a false positive in the first draft of this check. The real hazard is a
   COMMIT or ROLLBACK inside the body, which would break the atomicity the whole
   design rests on. */
ok(!/\bcommit\s*;|\brollback\s*;/i.test(CODE),
  'and there is no COMMIT or ROLLBACK inside it, so the whole operation is one atomic statement — a refused import cannot leave a bound row behind');

/* ---- 4. it copies; it never destroys the legacy thread ------------------ */

ok(!/delete\s+from|update public\.calendar_posts|truncate/i.test(CODE),
  'nothing deletes or rewrites the legacy thread — calendar_posts is only READ, so the repair is reversible and clients keep the notes they can see today');

/* ---- 5. service-role only ---------------------------------------------- */

ok(/revoke all on function public\.production_comment_card_bind_and_import\(jsonb, jsonb, jsonb\)\s+from public, anon, authenticated;/.test(SQL),
  'the function is revoked from public, anon and authenticated');
ok(/grant execute on function public\.production_comment_card_bind_and_import\(jsonb, jsonb, jsonb\)\s+to service_role;/.test(SQL),
  'and granted only to service_role, like every other function in this family');
ok(/security definer/.test(CODE) && /set search_path = public/.test(CODE),
  'it is security definer with a pinned search_path');

/* ---- 6. the rehearsal, executed ---------------------------------------- */

function have(bin) {
  if (fs.existsSync('/usr/lib/postgresql/16/bin/' + bin)) return true;
  return spawnSync('bash', ['-lc', 'command -v ' + bin], { encoding: 'utf8' }).status === 0;
}
if (!have('initdb') || !have('psql')) {
  console.log('  --  rehearsal SKIPPED: PostgreSQL 16 server binaries are not available here');
} else {
  const { rehearse } = require('../scripts/crosswalk-bind-rehearsal.js');
  let passed = false;
  try { passed = rehearse(); }
  catch (e) { console.error('  rehearsal threw: ' + ((e && e.message) || e)); passed = false; }
  ok(passed, 'the rehearsal executed the real function against PostgreSQL 16 and every check passed');
}

if (failures) { console.log('\n' + failures + ' check(s) failed.'); process.exit(1); }
console.log('\ncrosswalk bind-and-import checks passed');
