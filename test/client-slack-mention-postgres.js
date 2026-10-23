'use strict';
/*
 * client-slack-mention-postgres.js -- migrations/2026-10-23-client-slack-mention.sql
 * on a disposable PostgreSQL, on top of the migrations it builds on.
 *
 * Synthetic names and ids only (the repository is public). Proves:
 *  - the column is added, only Slack member ids (U... / W...) or null fit;
 *  - the Clients tab's save (client_profile_admin_edit) can set and clear it,
 *    writes one history row, and still queues one Sheet copy;
 *  - every other field saves exactly as before, and an unknown field is still refused;
 *  - only service_role may run the function (all four roles measured);
 *  - the "how to tell it is applied" read in the file answers false, false
 *    before and true, true after;
 *  - the migration applies twice without error.
 *
 * Locally, point PG* at a throwaway server and set
 * CLIENT_SLACK_MENTION_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY. It creates and drops
 * its own database.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.CLIENT_SLACK_MENTION_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  console.log('SKIP client-slack-mention-postgres: needs a disposable PostgreSQL (CLIENT_SLACK_MENTION_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY)');
  process.exit(0);
}
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DB = 'client_slack_mention_' + process.pid;
const FILE = 'migrations/2026-10-23-client-slack-mention.sql';
const FN = 'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)';

function psql(database, text, allowFail = false) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input: text, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = text => psql(DB, text).out;
const lit = v => (v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");
const edit = (slug, changes) => psql(DB, `set role service_role; select public.client_profile_admin_edit(${lit(slug)}, ${lit(JSON.stringify(changes))}::jsonb,
  (select updated_at from public.client_profiles where slug = ${lit(slug)}), 'Admin QA', 'admin', 'm1', null, 'req-1');`, true);
const parse = r => { assert(r.ok, 'call failed: ' + r.err); return JSON.parse(r.out.split('\n').pop()); };
const refused = (r, code) => { assert(!r.ok, 'expected a refusal, got: ' + r.out); assert(r.err.includes(code), `expected ${code}, got: ${r.err}`); };

// The read-back query the migration's header gives, run as written.
const header = read(FILE);
const probe = header.slice(header.indexOf('-- HOW TO TELL IT IS APPLIED'), header.indexOf('-- No grant changes')).split('\n').slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

let failed = false;
try {
  assert(/^-- ef-auto-deploy: functions-cope-without-this$/m.test(header.split('\n').slice(0, 40).join('\n')), 'the cope marker is in the first 40 lines');
  psql('postgres', `drop database if exists ${DB}; create database ${DB};`);
  psql(DB, `
    do $r$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $r$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.syncview_runtime_flags (key text primary key, value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(), updated_by text);
  `);
  psql(DB, read('migrations/2026-09-25-sheets-mirror-phase1.sql'));
  psql(DB, read('migrations/2026-09-25-client-profile-edits.sql'));
  psql(DB, `create table public.social_media_managers (
      slug text primary key, name text not null, email text not null default '', active boolean not null default true,
      source text not null default 'google_sheet', source_row_count integer not null default 0,
      source_clients jsonb not null default '[]'::jsonb, synced_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.clients (slug text primary key, display_name text, active boolean not null default true,
      kind text not null default 'client', updated_at timestamptz not null default now());
    insert into public.clients (slug, display_name) values ('fixtureone', 'Fixture One');
    insert into public.syncview_runtime_flags (key, value) values ('client_profiles_authority', '{"source":"syncview"}')
      on conflict (key) do update set value = excluded.value;`);
  psql(DB, read('migrations/2026-10-02-roster-native.sql'));
  psql(DB, `insert into public.client_profiles (slug, display_name, email, slack_channel_id, source, updated_at)
    values ('fixtureone', 'Fixture One', 'one@example.test', 'C0FIXTURE01', 'syncview', now() - interval '1 hour');`);

  assert.equal(psql(DB, probe).out, 'f|f', 'before: the read-back answers false, false');
  refused(edit('fixtureone', { slack_mention_user_id: 'U0FIXTURE01' }), 'client_profile_edit_field_not_editable');
  console.log('  before the migration: the read-back says not applied, and the field is refused (nothing written)');

  const MIGRATION = read(FILE);
  psql(DB, MIGRATION);
  psql(DB, MIGRATION);
  console.log('  migration applies twice without error');
  assert.equal(psql(DB, probe).out, 't|t', 'after: the read-back answers true, true');
  console.log('  the read-back in the file answers true, true');

  const outbox0 = Number(q('select count(*) from public.roster_sheet_outbox'));
  let r = parse(edit('fixtureone', { slack_mention_user_id: 'U0FIXTURE01' }));
  assert.equal(r.changed, 1);
  assert.equal(r.row.slack_mention_user_id, 'U0FIXTURE01');
  assert.equal(r.row.row_hash, undefined, 'row_hash is never returned');
  assert.equal(q(`select coalesce(old_value,'NULL') || '>' || new_value || '/' || edited_by from public.client_profile_edits where slug='fixtureone' and field='slack_mention_user_id'`), 'NULL>U0FIXTURE01/Admin QA');
  assert.equal(Number(q('select count(*) from public.roster_sheet_outbox')), outbox0 + 1, 'the save still queues one Sheet copy');
  console.log('  set: saved, one history row, one Sheet copy queued');

  r = parse(edit('fixtureone', { slack_mention_user_id: 'W0GRIDUSER1', email: 'two@example.test' }));
  assert.equal(r.changed, 2);
  assert.equal(r.row.email, 'two@example.test', 'other fields still save');
  r = parse(edit('fixtureone', { slack_mention_user_id: null }));
  assert.equal(r.row.slack_mention_user_id, null, 'null clears it (not linked)');
  assert.equal(parse(edit('fixtureone', { slack_mention_user_id: null })).changed, 0, 'a no-op changes nothing');
  console.log('  W ids accepted, clearing works, other fields unaffected, no-op is a no-op');

  for (const bad of ['C0CHANNEL01', 'u0lowercase1', '<@U0FIXTURE01>', '<!channel>', 'U123', ' U0FIXTURE01']) {
    refused(edit('fixtureone', { slack_mention_user_id: bad }), 'client_profiles_slack_mention_user_id_shape');
  }
  refused(psql(DB, `update public.client_profiles set slack_mention_user_id = '@here' where slug = 'fixtureone'`, true), 'client_profiles_slack_mention_user_id_shape');
  assert.equal(q(`select coalesce(slack_mention_user_id, 'NULL') from public.client_profiles where slug = 'fixtureone'`), 'NULL');
  console.log('  only a Slack member id fits: channels, markup, @here and short or padded values are refused by the table');

  refused(edit('fixtureone', { roam_channel_id: 'x' }), 'client_profile_edit_field_not_editable');
  console.log('  an unlisted field is still refused');

  for (const role of ['anon', 'authenticated']) {
    assert.equal(q(`select has_function_privilege('${role}', '${FN}', 'EXECUTE')`), 'f', role + ' cannot run the save');
  }
  assert.equal(q(`select has_function_privilege('service_role', '${FN}', 'EXECUTE')`), 't');
  assert.equal(q(`select count(*) from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'client_profile_admin_edit' and grantee = 'PUBLIC'`), '0', 'PUBLIC holds no EXECUTE');
  console.log('  four roles measured: only service_role may run the save');
  console.log('client-slack-mention-postgres checks passed');
} catch (e) {
  failed = true;
  console.error('FAIL ' + (e && e.stack || e));
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
if (failed) process.exit(1);
