'use strict';
// migrations/2026-10-07-tiktok-uploads.sql against a real, throwaway Postgres (OPEN_REPAIRS 362): applies twice,
// the switch starts on n8n and never overwrites a live value, browser roles can do nothing, service_role can
// read, insert and update but not delete, and the table holds what the functions write, the Sheet copy
// included. Needs a disposable server: set SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY (or
// F63_REQUIRE_POSTGRES=1 in CI) with PG* pointing at it.
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-10-07-tiktok-uploads.sql'), 'utf8');
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.SHEETS_MIRROR_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  throw Error('DISPOSABLE_REQUIRED: set SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY with PG* pointing at a throwaway server');
}
const DB = 'tiktok_uploads_' + process.pid;

function psql(database, text, allowFail = false, role = null) {
  const input = (role ? `set role ${role};\n` : '') + text;
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database], { input, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = (sql, role) => psql(DB, sql, false, role).out;

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

let failed = false;
try {
  psql('postgres', `drop database if exists ${DB}; create database ${DB};`);
  psql(DB, `
    do $r$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'public_probe') then create role public_probe nologin; end if;
    end $r$;
    grant usage on schema public to anon, authenticated, service_role, public_probe;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table public.syncview_runtime_flags (key text primary key, value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(), updated_by text);
  `);
  psql(DB, MIGRATION);
  eq(q(`select value::text from public.syncview_runtime_flags where key = 'tiktok_upload_source'`), '{"source": "n8n"}', 'the switch starts on n8n');
  q(`update public.syncview_runtime_flags set value = '{"source":"supabase"}' where key = 'tiktok_upload_source'`);
  psql(DB, MIGRATION);
  eq(q(`select value::text from public.syncview_runtime_flags where key = 'tiktok_upload_source'`), '{"source": "supabase"}', 'applying again never flips a live switch back');

  for (const role of ['public_probe', 'anon', 'authenticated']) {
    for (const stmt of ['select 1 from public.tiktok_uploads limit 1', "insert into public.tiktok_uploads (id, client, status) values ('x', 'c', 'queued')", "update public.tiktok_uploads set status = 'posted'", 'delete from public.tiktok_uploads']) {
      ok(!psql(DB, stmt, true, role).ok, `${role} cannot run: ${stmt.split(' ').slice(0, 2).join(' ')}`);
    }
  }
  eq(q(`select relrowsecurity from pg_class where oid = 'public.tiktok_uploads'::regclass`), 't', 'row level security is on');
  eq(q(`select count(*) from pg_policy where polrelid = 'public.tiktok_uploads'::regclass`), '0', 'and no policy opens it');

  // What the functions write, as service_role.
  q(`insert into public.tiktok_uploads (id, client, profile, title, options_json, scheduled_for, timezone, status, post_body, created_by)
     values ('a1', 'Fixture Client', 'spc_fixture01', 'caption', '{"privacy_level":"SELF_ONLY"}', '2026-10-09T10:00:00Z', 'UTC', 'scheduled', '{"caption":"caption"}', 'QA')`, 'service_role');
  q(`insert into public.tiktok_uploads (id, client, status, created_at, source) values ('b2', 'Fixture Client', 'posted', '2026-10-01T00:00:00Z', 'sheet')`, 'service_role');
  q(`update public.tiktok_uploads set upload_post_id = 'sp_1', last_checked_at = now() where id = 'a1'`, 'service_role');
  eq(q(`select string_agg(id, ',' order by sort_at desc) from public.tiktok_uploads`, 'service_role'), 'a1,b2', 'sort_at is the scheduled time, else when it was sent');
  eq(q(`select source || ':' || created_by from public.tiktok_uploads where id = 'a1'`, 'service_role'), 'syncview:QA', 'defaults');
  ok(!psql(DB, 'delete from public.tiktok_uploads', true, 'service_role').ok, 'service_role cannot delete');
  ok(!psql(DB, `insert into public.tiktok_uploads (id, client, status) values ('c3', 'Fixture Client', 'weird')`, true, 'service_role').ok, 'an unknown status is refused');
  ok(!psql(DB, `insert into public.tiktok_uploads (id, client, status) values ('bad id', 'Fixture Client', 'queued')`, true, 'service_role').ok, 'a bad id is refused');
  ok(!psql(DB, `update public.tiktok_uploads set sort_at = now() where id = 'a1'`, true, 'service_role').ok, 'sort_at is computed, never written');
  // The Sheet copy: a row already there is kept.
  q(`insert into public.tiktok_uploads (id, client, status, title) values ('a1', 'Fixture Client', 'queued', 'from the Sheet') on conflict (id) do nothing`, 'service_role');
  eq(q(`select title from public.tiktok_uploads where id = 'a1'`, 'service_role'), 'caption', 'a copy never overwrites a table row');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
if (failed) process.exit(1);
console.log(`tiktok-uploads-postgres: ${checks} checks passed`);
