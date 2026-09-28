'use strict';
/*
 * clients-roster-sync-postgres.js — migrations/2026-09-28-clients-roster-sync.sql
 * on a disposable PostgreSQL, before anyone applies it live.
 *
 * Proves, on synthetic rows only: a dry run changes nothing; an applied run
 * switches off active clients missing from the tab and back on inactive ones
 * that reappear; a test-kind client is never touched; nothing is inserted or
 * deleted; a too-small tab or too many switch-offs is refused with no change;
 * and only service_role may run the function or read its log (measured for
 * all four roles, starting from Supabase's default grants).
 *
 * Needs PG* pointing at a throwaway server and
 * ROSTER_SYNC_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY (or F63_REQUIRE_POSTGRES=1 in
 * the isolated CI lane). It creates and drops its own database.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.ROSTER_SYNC_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  console.log('SKIP clients-roster-sync-postgres: needs a disposable PostgreSQL (ROSTER_SYNC_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY)');
  process.exit(0);
}
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'migrations/2026-09-28-clients-roster-sync.sql'), 'utf8');
const DB = 'roster_sync_' + process.pid;

function psql(database, text, allowFail = false) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input: text, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = text => psql(DB, text).out;
const state = () => q("select string_agg(slug || ':' || active, ',' order by slug) from public.clients");
const call = (slugs, apply) =>
  JSON.parse(q(`select public.clients_roster_sync_v1(array[${slugs.map(s => `'${s}'`).join(',')}]::text[], 'test', ${apply})`));

const current = Array.from({ length: 12 }, (_, i) => 'current' + String(i).padStart(2, '0'));

psql('postgres', `create database ${DB}`);
try {
  psql(DB, `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      if not exists (select 1 from pg_roles where rolname='public_probe') then create role public_probe nologin; end if;
    end $$;
    -- Supabase's defaults: every new object is granted to these three roles.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role, public_probe;
    create table public.clients (slug text primary key, display_name text, active boolean not null default true,
      kind text not null default 'client', updated_at timestamptz not null default now());
    insert into public.clients(slug, active, kind) values
      ${current.map(s => `('${s}', true, 'client')`).join(',')},
      ('formerone', true, 'client'), ('formertwo', true, 'client'),
      ('returning', false, 'client'),
      ('testfixture', true, 'test'), ('testoff', false, 'test');
  `);
  psql(DB, MIGRATION);

  const sheet = [...current, 'returning', 'newonsheet', 'testoff'];
  const before = state();

  // Dry run: reports, changes nothing, logs.
  let out = call(sheet, false);
  assert.equal(out.applied, false);
  assert.deepEqual(out.deactivated, ['formerone', 'formertwo']);
  assert.deepEqual(out.reactivated, ['returning']);
  assert.deepEqual(out.not_in_clients, ['newonsheet']);
  assert.equal(state(), before, 'dry run changed nothing');

  // Applied run.
  out = call(sheet, true);
  assert.equal(out.applied, true);
  assert.equal(out.refused, null);
  const after = Object.fromEntries(q("select slug || '=' || active from public.clients order by slug").split('\n').map(l => l.split('=')));
  assert.equal(after.formerone, 'false');
  assert.equal(after.formertwo, 'false');
  assert.equal(after.returning, 'true');
  assert.equal(after.testfixture, 'true', 'test client off the tab stays active');
  assert.equal(after.testoff, 'false', 'test client on the tab is not switched on');
  for (const s of current) assert.equal(after[s], 'true');
  assert.equal(q('select count(*) from public.clients'), String(current.length + 5), 'nothing inserted or deleted');
  assert.equal(q("select count(*) from public.clients where slug = 'newonsheet'"), '0', 'never adds a client');

  // Re-running is a no-op.
  out = call(sheet, true);
  assert.deepEqual(out.deactivated, []);
  assert.deepEqual(out.reactivated, []);

  // Guards: a tiny tab, or too many switch-offs, is refused and changes nothing.
  const mid = state();
  out = call(['current00'], true);
  assert.equal(out.refused, 'sheet_too_small');
  assert.equal(out.applied, false);
  assert.equal(state(), mid);
  out = call(current.slice(0, 10).concat(['returning']), true);
  assert.equal(out.refused, null, 'two switch-offs out of fifteen is allowed');
  // 15 active clients: switching off 5 (exactly a third) is allowed; with a
  // 16th, switching off 6 is more than a third and is refused.
  psql(DB, "update public.clients set active = true where kind = 'client'");
  out = call(current.slice(0, 10), false);
  assert.ok(out.deactivated.length === 5 && out.refused === null, 'exactly a third is allowed');
  psql(DB, "insert into public.clients(slug, active, kind) values ('extraone', true, 'client')");
  const wide = state();
  out = call(current.slice(0, 10), true);
  assert.ok(out.deactivated.length === 6 && out.refused === 'too_many_deactivations', 'more than a third is refused');
  assert.equal(state(), wide, 'a refused run changes nothing');

  assert.equal(q('select count(*) from public.clients_roster_sync_log'), '7', 'every call is logged');

  // Privileges, measured.
  const can = (role, sql) => psql(DB, `set role ${role}; ${sql}`, true).ok;
  for (const role of ['public_probe', 'anon', 'authenticated']) {
    assert.equal(can(role, "select public.clients_roster_sync_v1(array['x'], 'r', false)"), false, role + ' cannot execute');
    assert.equal(can(role, 'select * from public.clients_roster_sync_log'), false, role + ' cannot read the log');
    assert.equal(can(role, "insert into public.clients_roster_sync_log(run_id, applied, sheet_count) values ('x', false, 0)"), false, role + ' cannot write the log');
  }
  assert.equal(can('service_role', "select public.clients_roster_sync_v1(array['x'], 'r', false)"), true, 'service_role can execute');
  assert.equal(can('service_role', 'select * from public.clients_roster_sync_log'), true, 'service_role can read the log');
  assert.equal(can('service_role', "insert into public.clients_roster_sync_log(run_id, applied, sheet_count) values ('x', false, 0)"), false, 'service_role cannot write the log directly');
  assert.equal(can('service_role', 'delete from public.clients_roster_sync_log'), false, 'service_role cannot delete the log');

  console.log('clients-roster-sync-postgres: all checks passed');
} finally {
  psql('postgres', `drop database if exists ${DB}`, true);
}
