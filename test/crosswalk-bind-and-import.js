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
ok(/d2\.kind is not distinct from v_kind/.test(CODE),
  'and the occupancy probe keys on KIND, matching deliverables_card_slot_unique(client_slug, origin, card_id, kind)');

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
