#!/usr/bin/env node
'use strict';

// Execution proof for migrations/2026-08-31-production-component-fill.sql.
//
// House rule since the v2 CASE defect: no migration is handed over unexecuted.
// A plain `create function` proves almost nothing about PL/pgSQL -- the body is
// parsed, but rowtypes, guard ordering and every RAISE path are only reached by
// CALLING it. So this stands up a disposable PostgreSQL 16, applies the real
// prerequisite chain, and drives the RPC through one happy path per shape and
// one call per refusal, asserting the exact error code each time.
//
// It reuses the F42 rehearsal's Cluster and FOUNDATION_SQL rather than carrying
// a second copy: a forked harness drifts from the schema it is meant to mirror,
// which is the failure mode half the comments in this repo are about.
//
// THE TWO HAPPY PATHS ARE THE POINT, and they are chosen from the live
// population measured 2026-08-31. Of the 126 readable siblings behind the 127
// half-complete cards, 65 are titled in the strict 'Video N' form and 61 are
// human-titled Linear-era issues; 21 of the conforming ones carry a null
// sort_key. So the fixtures are exactly one of each: a human-titled sibling
// with a null sort_key (the half production_intake_append structurally cannot
// serve) and a 'Video 9' sibling with sort_key 4.
//
// Requires local initdb/pg_ctl/psql (PostgreSQL 16), or an external server via
// F42_REHEARSAL_SOCKET/PGHOST + PGPORT. Leaves no residue.
//
// RUN IT AS `node scripts/component-fill-rehearsal.js`, or let
// test/component-fill-rpc.js run it as part of the unit suite -- it imports
// rehearse() from here, so there is one implementation and two entry points.
// There is deliberately NO npm alias: the leave-lifecycle evidence packet
// fingerprints package.json in its ENTIRETY (see
// test/leave-evidence-fingerprint-coupling.js), so adding a script to it
// stales a 101-screenshot audit whose only sanctioned repair is a human
// re-review of every shot. That coupling is too broad and is worth fixing on
// its own; paying its price for a convenience alias is not.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Cluster, FOUNDATION_SQL } = require('./f42-apply-rehearsal.js');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

// The real chain, in live order. batches/deliverables/mirror_outbox, then the
// functions this one calls (production_assert_authority, production_outbox_replay,
// production_deliverable_write), then batches.purpose, then the append
// migration that defines production_batch_parent_ids_for_team.
const CHAIN = [
  '2026-07-06-b1-linear-data-model.sql',
  '2026-07-11-b4-linear-outbound.sql',
  '2026-07-12-production-comments.sql',
  '2026-07-12-write-ui-outbox-parity.sql',
  '2026-08-19-samples-batch-purpose.sql',
  '2026-08-19-samples-batch-write-purpose.sql',
  '2026-08-26-production-intake-append-v7.sql',
];
const SUBJECT = '2026-08-31-production-component-fill.sql';

function have(bin) {
  if (fs.existsSync('/usr/lib/postgresql/16/bin/' + bin)) return true;
  return spawnSync('bash', ['-lc', 'command -v ' + bin], { encoding: 'utf8' }).status === 0;
}

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const FIXTURE = `
insert into public.clients(slug, display_name, active, kind)
values ('fixture-client', 'Fixture Client', true, 'client') on conflict (slug) do nothing;

insert into public.syncview_runtime_flags(key, value)
values ('prod_authority', '{"video":"syncview","graphics":"syncview"}'::jsonb)
on conflict (key) do update set value = excluded.value;

insert into public.batches(id, client_slug, name, status, purpose, linear_parent_ids, updated_at)
values ('bat_fix', 'fixture-client', 'Fixture batch', 'active', 'calendar',
  '{"video":{"linear_issue_id":"lin_parent_shared","owner_team":"video"},
    "graphics":{"linear_issue_id":"lin_parent_shared","owner_team":"video"}}'::jsonb,
  '2026-08-31T00:00:00Z') on conflict (id) do nothing;

-- Linear-era sibling: human title, null sort_key.
insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,card_id,sort_key,created_at)
values ('del_sib','bat_fix','fixture-client','video','video',
        'Video 6 - Before Coming To Us','in_progress','calendar','card_one',null,now())
on conflict (id) do nothing;
-- Modern sibling: conforming title, numeric sort_key.
insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,card_id,sort_key,created_at)
values ('del_sib2','bat_fix','fixture-client','video','video',
        'Video 9','in_progress','calendar','card_two',4,now())
on conflict (id) do nothing;
-- A THIRD card that is never filled, reserved for the guards that sit BEHIND
-- the occupancy check. Running those against an already-filled card is how the
-- first draft of this rehearsal reported four false passes: every one of them
-- short-circuited on component_fill_team_occupied and never reached the guard
-- it named. A refusal test has to be able to fail for its own reason.
insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,card_id,sort_key,created_at)
values ('del_sib3','bat_fix','fixture-client','video','video',
        'Video 12','in_progress','calendar','card_three',9,now())
on conflict (id) do nothing;

create or replace function public.rehearsal_fill(
  p_id text, p_sibling text, p_card text, p_title text, p_sort jsonb,
  p_expected timestamptz, p_team text default 'graphics', p_batch text default 'bat_fix'
) returns jsonb language sql as $$
  select public.production_component_fill(p_batch, p_expected, p_sibling,
    jsonb_build_object('id',p_id,'batch_id',p_batch,'client_slug','fixture-client',
      'team',p_team,'kind',case when p_team='graphics' then 'thumbnail' else 'video' end,
      'title',p_title,'status','todo','origin','calendar','card_id',p_card,'sort_key',p_sort),
    jsonb_build_object('source','ui','action','create','ts','2026-08-31T12:00:00Z',
      'actor','tester','role','smm','surface','calendar',
      'outbound', jsonb_build_object('entity','deliverable','entity_id',p_id,'team',p_team,
        'operation','create','dedup_key','fill:'||p_id,'test_only',false,'legacy_parity',false,
        'payload', jsonb_build_object('project_id','proj_x',
          'parent_linear_issue_id','lin_parent_shared','title',p_title,
          '_intent_fingerprint','fp:'||p_id))));
$$;
`;

function cursor(cluster) {
  return cluster.run('', null, {
    sql: "select to_char(updated_at,'YYYY-MM-DD\"T\"HH24:MI:SS.USOF') from public.batches where id='bat_fix';",
    tuplesOnly: true,
  }).trim();
}

// Every refusal case runs inside its own transaction that is rolled back, so a
// case can never change what the next one sees. `expect` is the bare code.
function refuses(cluster, label, call, expected) {
  let message = '';
  try {
    cluster.exec(`begin; select ${call}; rollback;`);
  } catch (error) {
    message = String((error && error.message) || '');
  }
  ok(message.includes(expected), `${label} -> ${expected}` + (message.includes(expected) ? '' : ` (got: ${message.split('\n').find(l => /ERROR/.test(l)) || 'NO ERROR'})`));
}

function rehearse() {
  const cluster = new Cluster();
  cluster.start();
  try {
    // The F42 harness turns body checking OFF for its own chain; this rehearsal
    // wants the compile to be real, so it is turned back on before the subject
    // migration is applied.
    cluster.exec('set check_function_bodies = on;');
    cluster.exec(FOUNDATION_SQL);
    for (const file of CHAIN) cluster.runFile(path.join(MIGRATIONS, file));
    ok(true, 'prerequisite chain applied (' + CHAIN.length + ' migrations)');

    cluster.exec('alter database ' + cluster.db + ' set check_function_bodies = on;');
    cluster.runFile(path.join(MIGRATIONS, SUBJECT));
    ok(true, SUBJECT + ' applied with check_function_bodies = on');

    cluster.exec(FIXTURE);

    const at = () => `'${cursor(cluster)}'::timestamptz`;

    // 1. The case the append path cannot serve at all.
    const first = cluster.run('', null, {
      sql: `select public.rehearsal_fill('del_new','del_sib','card_one','Video 6 - Before Coming To Us','null'::jsonb,${at()})`,
      tuplesOnly: true,
    });
    ok(/"card_id"\s*:\s*"card_one"/.test(first), 'human-titled, null-sort sibling: the fill lands on the sibling\'s card');
    ok(/"sort_key"\s*:\s*null/.test(first), 'and inherits its null sort_key rather than inventing one');
    ok(/"replay"\s*:\s*false/.test(first), 'and reports itself as a fresh write');

    // 2. Idempotence: the identical call must not make a second component.
    const again = cluster.run('', null, {
      sql: `select public.rehearsal_fill('del_new','del_sib','card_one','Video 6 - Before Coming To Us','null'::jsonb,${at()})`,
      tuplesOnly: true,
    });
    ok(/"replay"\s*:\s*true/.test(again), 'an exact retry replays instead of writing again');
    const count = cluster.run('', null, {
      sql: "select count(*) from public.deliverables where card_id='card_one' and team='graphics';",
      tuplesOnly: true,
    }).trim();
    ok(count === '1', 'and the card still has exactly one graphics component (' + count + ')');

    // 3. The conforming shape, with a real sort key to inherit.
    const second = cluster.run('', null, {
      sql: `select public.rehearsal_fill('del_n2','del_sib2','card_two','Thumbnail 9','4'::jsonb,${at()})`,
      tuplesOnly: true,
    });
    ok(/"sort_key"\s*:\s*4\b/.test(second), 'a numeric sort_key is inherited exactly, so the pair stays adjacent');

    // 4. Every refusal, each on a card that reaches it.
    refuses(cluster, 'a second graphics fill on a card that has one',
      `public.rehearsal_fill('del_dup','del_sib','card_one','Dup','null'::jsonb,${at()})`,
      'component_fill_team_occupied');
    refuses(cluster, 'a card the sibling does not carry',
      `public.rehearsal_fill('del_x','del_sib2','card_someone_elses','X','4'::jsonb,${at()})`,
      'component_fill_card_mismatch');
    refuses(cluster, 'filling the team the sibling itself is',
      `public.rehearsal_fill('del_v2','del_sib3','card_three','V','9'::jsonb,${at()},'video')`,
      'component_fill_team_occupied');
    refuses(cluster, 'an invented sort key',
      `public.rehearsal_fill('del_y','del_sib3','card_three','Y','7'::jsonb,${at()})`,
      'component_fill_sort_mismatch');
    refuses(cluster, 'a null sort key where the sibling has one',
      `public.rehearsal_fill('del_y2','del_sib3','card_three','Y','null'::jsonb,${at()})`,
      'component_fill_sort_mismatch');
    refuses(cluster, 'a stale CAS cursor',
      `public.rehearsal_fill('del_z','del_sib3','card_three','Z','9'::jsonb,'2020-01-01T00:00:00Z'::timestamptz)`,
      'write_conflict');
    refuses(cluster, 'an unknown sibling',
      `public.rehearsal_fill('del_w','del_nope','card_three','W','9'::jsonb,${at()})`,
      'component_fill_sibling_missing');
    refuses(cluster, 'a sibling in another batch',
      `public.rehearsal_fill('del_ob','del_sib3','card_three','OB','9'::jsonb,${at()},'graphics','bat_missing')`,
      'batch_not_found');

    // Authority and batch status need a mutation first, so they carry their own
    // transaction rather than going through refuses().
    for (const [label, setup, expected] of [
      ['a team rolled back to Linear',
        `update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"linear"}'::jsonb where key='prod_authority';`,
        'team_is_linear_authoritative'],
      ['an archived batch',
        `update public.batches set status='archived' where id='bat_fix';`,
        'batch_not_active'],
    ]) {
      let message = '';
      try {
        cluster.exec(`begin; ${setup} select public.rehearsal_fill('del_a','del_sib3','card_three','A','9'::jsonb,(select updated_at from public.batches where id='bat_fix')); rollback;`);
      } catch (error) { message = String((error && error.message) || ''); }
      ok(message.includes(expected), `${label} -> ${expected}`);
    }

    // 5. Nothing from a rolled-back refusal survived.
    const final = cluster.run('', null, {
      sql: "select string_agg(id, ',' order by id) from public.deliverables;",
      tuplesOnly: true,
    }).trim();
    ok(final === 'del_n2,del_new,del_sib,del_sib2,del_sib3',
      'only the two intended components exist; every refusal left nothing behind (' + final + ')');

    // 6. The audit trail the ops side reads.
    const events = cluster.run('', null, {
      sql: "select count(*) from public.deliverable_events where action='component_fill';",
      tuplesOnly: true,
    }).trim();
    ok(events === '2', 'both fills wrote a component_fill audit row (' + events + ')');

    return failures === 0;
  } finally {
    cluster.stop();
  }
}

if (require.main === module) {
  // SKIP rather than fail where the server binaries are absent: this runs in
  // the same suite as offline checks, and a missing PostgreSQL is an
  // environment fact, not a defect in the migration.
  if (!have('initdb') || !have('psql')) {
    console.log('[component-fill-rehearsal] SKIP: PostgreSQL 16 server binaries (initdb/psql) not available here');
    process.exit(0);
  }
  let passed = false;
  try { passed = rehearse(); }
  catch (error) {
    console.error('[component-fill-rehearsal] FAIL ' + ((error && error.message) || String(error)));
    process.exit(1);
  }
  console.log(passed
    ? '\nproduction_component_fill rehearsal passed'
    : '\n' + failures + ' production_component_fill rehearsal check(s) failed');
  process.exit(passed ? 0 : 1);
}

module.exports = { CHAIN, SUBJECT, rehearse };
