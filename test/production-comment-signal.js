'use strict';
/*
 * Contract suite for migrations/2026-10-06-production-comment-signal.sql
 * (finding 2 of docs/ops/2026-10-06-realtime-test-findings.md: a Production
 * comment never reached another open screen live).
 *
 * THE FAILURES THIS EXISTS TO CATCH.
 *   - The stamp moving deliverables.updated_at. That column is the CAS clock
 *     of every SyncLinear write; a comment that moved it would hand every other
 *     open tab a write_conflict on its next status change.
 *   - The stamp writing a deliverable_events 'update' row (the ledger guard),
 *     i.e. a fake activity entry and provider outbox work per comment, or
 *     leaving app.event_written switched on for the rest of the transaction,
 *     which would silently suppress the ledger for a later real write.
 *   - A stamp failure breaking the comment save.
 *   - A revoke that forgets a role (CLAUDE.md: name all four).
 *
 * Two halves:
 *   1. Always runs, offline: structural facts about the SQL.
 *   2. Runs when a disposable PostgreSQL 16 is available (required with
 *      COMMENT_SIGNAL_REQUIRE_POSTGRES=1): applies the repository's own touch
 *      and ledger-guard triggers to a throwaway database, applies the
 *      migration twice, replays the cases above, then applies the rollback.
 *      Invented ids only; never contacts a hosted backend.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(ROOT, 'migrations', '2026-10-06-production-comment-signal.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(ROOT, 'migrations', '2026-10-06-production-comment-signal.ROLLBACK.sql'), 'utf8');
const b1 = fs.readFileSync(path.join(ROOT, 'migrations', '2026-07-06-b1-linear-data-model.sql'), 'utf8');
const rename = fs.readFileSync(path.join(ROOT, 'migrations', '2026-09-23-rename-propagation.sql'), 'utf8');

let passed = 0;
let failed = 0;
const ok = (name, value) => {
  if (value) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};

console.log('production comment signal: structure');
ok('marked NOT APPLIED (source-only until Lighthouse applies it)', /NOT APPLIED/.test(sql.slice(0, 400)));
ok('a separate column, never updated_at, carries the signal',
  /add column if not exists comments_changed_at timestamptz/.test(sql)
  && !/set\s+updated_at\s*=/.test(sql));
ok('the hold-clock trigger sorts after every other BEFORE trigger on deliverables (zzzz_ > zzz_ > track_b_)',
  /create trigger zzzz_comment_signal_hold_clock\s+before update on public\.deliverables/.test(sql)
  && ['track_b_deliverable_touch_timestamps_before', 'zzz_native_label_state_seed', 'zzz_production_native_identifier_mint']
    .every(name => name < 'zzzz_comment_signal_hold_clock'));
ok('the clock is held only when the stamp is the ONLY change',
  /\(to_jsonb\(new\) - 'comments_changed_at' - 'updated_at'\)\s+is not distinct from \(to_jsonb\(old\) - 'comments_changed_at' - 'updated_at'\)/.test(sql));
ok('the stamp suppresses the ledger guard for its own statement and restores the previous value',
  /v_prev := current_setting\('app\.event_written', true\);\s+[\s\S]{0,120}set_config\('app\.event_written', '1', true\);\s+update public\.deliverables[\s\S]{0,120}set_config\('app\.event_written', coalesce\(v_prev, ''\), true\);/.test(sql));
ok('a stamp failure is a warning inside its own block, never a failed comment save',
  /exception when others then\s+raise warning 'production_comment_signal_failed/.test(sql));
ok('bulk imports (backfill / mirror) never stamp', /in \('backfill', 'mirror'\) then return null/.test(sql));
const sqlCode = sql.replace(/--[^\n]*/g, '');
const revokes = sqlCode.match(/revoke all[^;]*;/g) || [];
ok('every revoke names all four roles (' + revokes.length + ' revokes)',
  revokes.length === 3 && revokes.every(r => /from public, anon, authenticated, service_role;$/.test(r.replace(/\s+/g, ' '))));
ok('the browser roles may read only the timestamp column',
  /grant select \(comments_changed_at\) on table public\.deliverables to anon, authenticated;/.test(sql)
  && !/grant [^;]*production_comments/.test(sql) && !/grant execute/.test(sql));
ok('production_comments itself stays closed (no grant, no policy, no publication change)',
  !/on (table )?public\.production_comments to/.test(sql) && !/create policy/.test(sql) && !/alter publication/.test(sql));
ok('rollback drops both triggers, both functions and the column',
  ['zzz_production_comment_signal', 'zzzz_comment_signal_hold_clock', 'production_comment_signal_stamp()',
    'production_comment_signal_hold_clock()', 'drop column if exists comments_changed_at'].every(t => rollback.includes(t)));

/* ---- the PostgreSQL proof ------------------------------------------------- */
const PG_BIN = '/usr/lib/postgresql/16/bin';
const haveServer = fs.existsSync(path.join(PG_BIN, 'postgres')) && fs.existsSync(path.join(PG_BIN, 'initdb'));
const required = process.env.COMMENT_SIGNAL_REQUIRE_POSTGRES === '1';
if (!haveServer) {
  if (required) { failed += 1; console.log('  FAIL PostgreSQL 16 required but not installed'); }
  else console.log('SKIP production comment signal PostgreSQL proof: PostgreSQL 16 not installed');
} else {
  console.log('production comment signal: PostgreSQL');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const base = fs.mkdtempSync(path.join(asRoot ? '/var/tmp' : os.tmpdir(), 'comment-signal-'));
  fs.chmodSync(base, 0o755);
  const port = String(55000 + Math.floor(Math.random() * 4000));
  const as = (cmd, args, opts) => asRoot
    ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], Object.assign({ encoding: 'utf8' }, opts))
    : spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
  if (asRoot) spawnSync('chown', ['postgres', base]);
  const data = path.join(base, 'data');
  let started = false;
  let lastStderr = '';
  const psql = (db, input) => {
    const r = spawnSync(path.join(PG_BIN, 'psql'), ['-h', base, '-p', port, '-U', 'postgres', '-d', db,
      '-v', 'ON_ERROR_STOP=1', '-q', '-At'], { input, encoding: 'utf8' });
    lastStderr = r.stderr || '';
    if (r.status !== 0) throw new Error('psql failed: ' + (r.stderr || '').trim());
    return r.stdout.trim();
  };
  const one = (q) => psql('t', q);
  const between = (src, from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    assert.ok(a >= 0 && b > a, 'fixture source moved: ' + from);
    return src.slice(a, b + to.length);
  };
  try {
    const init = as(path.join(PG_BIN, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust']);
    assert.equal(init.status, 0, 'initdb failed: ' + init.stderr);
    const start = as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${base} -c listen_addresses=''`,
      '-l', path.join(base, 'log'), '-w', 'start']);
    assert.equal(start.status, 0, 'pg_ctl start failed: ' + start.stderr);
    started = true;
    psql('postgres', 'create database t');
    // Minimal stand-ins for the live tables; the triggers that matter are the
    // repository's own: the CAS touch (with its 2026-09-23 propagation branch)
    // and the ledger guard.
    one(`
      do $$ begin create role anon; create role authenticated; create role service_role bypassrls;
      exception when duplicate_object then null; end $$;
      create table public.deliverables(id text primary key, batch_id text, client_slug text, status text,
        title text, status_at timestamptz, updated_at timestamptz not null default now());
      create table public.deliverable_events(id bigserial primary key, deliverable_id text, batch_id text,
        client_slug text, actor text, role text, action text, from_status text, to_status text, source text,
        payload jsonb, event_key text);
      create table public.production_comments(id text primary key, deliverable_id text references public.deliverables(id),
        batch_id text, source text not null default 'ui', body text not null default '',
        updated_at timestamptz not null default now());
      revoke all on table public.deliverables from public, anon, authenticated;
      grant select (id, status, title, updated_at) on table public.deliverables to anon, authenticated;
      grant all on all tables in schema public to service_role;
      grant all on all sequences in schema public to service_role;`);
    one(between(rename, 'create or replace function public.track_b_deliverable_touch_timestamps()', '$function$;'));
    one(`create trigger track_b_deliverable_touch_timestamps_before before insert or update on public.deliverables
      for each row execute function public.track_b_deliverable_touch_timestamps();`);
    one(between(b1, 'create or replace function public.track_b_deliverable_ledger_guard()', '$fn$;'));
    one(`create trigger track_b_deliverable_ledger_guard_after after insert or update on public.deliverables
      for each row execute function public.track_b_deliverable_ledger_guard();`);
    one(`insert into deliverables(id, client_slug, status, title) values ('dv1','test-client','in_progress','One'),
      ('dv2','test-client','in_progress','Two');`);

    one(sql);
    ok('migration applies', true);
    one(sql);
    ok('migration applies twice (idempotent)', true);

    const svc = (q) => one('set role service_role;\n' + q);
    const stamp = (id) => svc(`select coalesce(comments_changed_at::text,'') from deliverables where id='${id}';`);
    const clock = (id) => svc(`select updated_at::text from deliverables where id='${id}';`);
    const events = () => Number(svc(`select count(*) from deliverable_events;`));

    const clockBefore = clock('dv1');
    const eventsBefore = events();
    svc(`select pg_sleep(0.02); insert into production_comments(id, deliverable_id, body) values ('c1','dv1','hello');`);
    ok('a comment stamps its work item', stamp('dv1') !== '');
    ok('...and leaves updated_at (the CAS clock) exactly where it was', clock('dv1') === clockBefore);
    ok('...and writes no deliverable_events row (no fake activity, no outbox work)', events() === eventsBefore);
    ok('...and touches no other work item', stamp('dv2') === '');

    const first = stamp('dv1');
    svc(`select pg_sleep(0.02); update production_comments set body='edited' where id='c1';`);
    ok('an edit stamps again (a later time)', stamp('dv1') > first && clock('dv1') === clockBefore);

    // The ledger guard is switched off for the stamp only, then restored, so a
    // real write later in the same transaction is still recorded.
    const before2 = events();
    svc(`begin;
      select set_config('app.event_written', '', true);
      insert into production_comments(id, deliverable_id, body) values ('c2','dv2','x');
      update deliverables set status = 'for_review' where id = 'dv2';
      commit;`);
    ok('app.event_written is restored after the stamp: a real write in the same transaction still writes its event',
      events() === before2 + 1
      && svc(`select action from deliverable_events order by id desc limit 1;`) === 'status_change');
    const before3 = events();
    svc(`begin;
      select set_config('app.event_written', '1', true);
      insert into production_comments(id, deliverable_id, body) values ('c3','dv2','y');
      update deliverables set title = 'Two b' where id = 'dv2';
      commit;`);
    ok('...and a caller that had already set it keeps it set', events() === before3);

    // A real change moves the clock as always, even alongside a stamp.
    const c2 = clock('dv2');
    svc(`select pg_sleep(0.02); update deliverables set status='approved', comments_changed_at = now() where id='dv2';`);
    ok('a real change still moves updated_at, even when the stamp rides along', clock('dv2') > c2);

    // Bulk imports never stamp.
    const s2 = stamp('dv2');
    svc(`insert into production_comments(id, deliverable_id, body, source) values ('c4','dv2','imported','backfill'),
      ('c5','dv2','mirrored','mirror');`);
    ok('backfill and mirror imports do not stamp', stamp('dv2') === s2);
    // Batch-level and unmapped comments have nothing to stamp.
    svc(`insert into production_comments(id, batch_id, body) values ('c6','b1','batch note');`);
    ok('a batch-level comment is a no-op, not an error', true);

    // A failing stamp never fails the comment.
    one(`create function public.fail_stamp() returns trigger language plpgsql as $f$ begin
        if new.comments_changed_at is distinct from old.comments_changed_at then raise exception 'boom'; end if;
        return new; end $f$;
      create trigger aaa_fail before update on public.deliverables for each row execute function public.fail_stamp();`);
    const s1 = stamp('dv1');
    svc(`insert into production_comments(id, deliverable_id, body) values ('c7','dv1','still saved');`);
    const warned = lastStderr;
    ok('when the stamp fails the comment is still saved',
      svc(`select count(*) from production_comments where id='c7';`) === '1' && stamp('dv1') === s1);
    ok('...with a warning, not an error', /production_comment_signal_failed/.test(warned));
    one(`drop trigger aaa_fail on public.deliverables; drop function public.fail_stamp();`);

    // Roles, measured rather than assumed.
    const fnPriv = one(`select string_agg(r || ':' || has_function_privilege(r, f, 'EXECUTE')::text, ',' order by r, f)
      from unnest(array['anon','authenticated','service_role']) r,
           unnest(array['public.production_comment_signal_stamp()','public.production_comment_signal_hold_clock()']) f;`);
    ok('no role can call either function directly (' + fnPriv + ')', !/true/.test(fnPriv));
    const pubPriv = one(`select count(*) from information_schema.routine_privileges
      where routine_name in ('production_comment_signal_stamp','production_comment_signal_hold_clock') and grantee = 'PUBLIC';`);
    ok('PUBLIC holds no EXECUTE either', pubPriv === '0');
    ok('anon and authenticated can read the stamp column',
      one(`select has_column_privilege('anon','public.deliverables','comments_changed_at','SELECT')
        and has_column_privilege('authenticated','public.deliverables','comments_changed_at','SELECT');`) === 't');
    ok('...but cannot write it',
      one(`select has_column_privilege('anon','public.deliverables','comments_changed_at','UPDATE')
        or has_column_privilege('authenticated','public.deliverables','comments_changed_at','UPDATE');`) === 'f');
    ok('production_comments stays closed to the browser roles',
      one(`select has_table_privilege('anon','public.production_comments','SELECT')
        or has_table_privilege('authenticated','public.production_comments','SELECT');`) === 'f');

    one(rollback);
    ok('rollback applies and removes the column',
      one(`select count(*) from information_schema.columns where table_name='deliverables' and column_name='comments_changed_at';`) === '0');
    svc(`insert into production_comments(id, deliverable_id, body) values ('c8','dv1','after rollback');`);
    ok('comments still save after the rollback', svc(`select count(*) from production_comments where id='c8';`) === '1');
  } catch (e) {
    failed += 1;
    console.log('  FAIL PostgreSQL proof: ' + (e && e.message || e));
  } finally {
    if (started) as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
    fs.rmSync(base, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
