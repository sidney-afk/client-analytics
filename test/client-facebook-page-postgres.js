'use strict';
/*
 * client-facebook-page-postgres.js -- migrations/2026-10-31-client-facebook-page.sql
 * on a disposable PostgreSQL, on top of the migrations it builds on (OPEN_REPAIRS 620).
 *
 * Synthetic names and ids only (the repository is public). Proves:
 *  - before it is applied, the Facebook Page is refused (field_not_editable) and nothing is written;
 *  - after: the Clients tab's save (client_profile_admin_edit) sets the Page in extra (never a column),
 *    keeps the other extra keys (the Instagram account), writes one history row named
 *    "extra.postforme_facebook_account_id", queues one Sheet copy, and a blank removes it;
 *  - only a Post For Me connection id (spc_...) fits; anything else is refused and nothing changes;
 *  - columns and the Facebook Page save together in one call; the version check still holds;
 *  - every other field saves as before, and an unlisted field is still refused;
 *  - only service_role may run the function (all four roles measured);
 *  - the "how to tell it is applied" read answers false before and true after; it applies twice.
 *
 * Locally, point PG* at a throwaway server and set
 * CLIENT_FACEBOOK_PAGE_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY. It creates and drops its own database.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.CLIENT_FACEBOOK_PAGE_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  console.log('SKIP client-facebook-page-postgres: needs a disposable PostgreSQL (CLIENT_FACEBOOK_PAGE_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY)');
  process.exit(0);
}
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DB = 'client_facebook_page_' + process.pid;
const FILE = 'migrations/2026-10-31-client-facebook-page.sql';
const FN = 'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)';
const KEY = 'postforme_facebook_account_id';
const FB = 'spc_FixtureFacebook01';
const IG = 'spc_FixtureInstagram01';

function psql(database, text, allowFail = false) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input: text, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = text => psql(DB, text).out;
const lit = v => (v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");
const edit = (slug, changes, at) => psql(DB, `set role service_role; select public.client_profile_admin_edit(${lit(slug)}, ${lit(JSON.stringify(changes))}::jsonb,
  ${at ? lit(at) + '::timestamptz' : `(select updated_at from public.client_profiles where slug = ${lit(slug)})`}, 'Admin QA', 'admin', 'm1', null, 'req-1');`, true);
const parse = r => { assert(r.ok, 'call failed: ' + r.err); return JSON.parse(r.out.split('\n').pop()); };
const refused = (r, code) => { assert(!r.ok, 'expected a refusal, got: ' + r.out); assert(r.err.includes(code), `expected ${code}, got: ${r.err}`); };
const extraOf = slug => JSON.parse(q(`select extra::text from public.client_profiles where slug = ${lit(slug)}`));

const header = read(FILE);
const probe = header.slice(header.indexOf('-- HOW TO TELL IT IS APPLIED'), header.indexOf("-- The function's grants")).split('\n').slice(1)
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
  psql(DB, read('migrations/2026-10-23-client-slack-mention.sql'));
  psql(DB, `insert into public.client_profiles (slug, display_name, email, slack_channel_id, extra, source, updated_at)
    values ('fixtureone', 'Fixture One', 'one@example.test', 'C0FIXTURE01', '{"postforme_instagram_account_id":"${IG}"}', 'syncview', now() - interval '1 hour');`);

  assert.equal(psql(DB, probe).out, 'f', 'before: the read-back answers false');
  refused(edit('fixtureone', { [KEY]: FB }), 'client_profile_edit_field_not_editable');
  assert.equal(extraOf('fixtureone')[KEY], undefined, 'nothing written before the migration');
  console.log('  before the migration: the read-back says not applied, and the Page is refused (nothing written)');

  const MIGRATION = read(FILE);
  psql(DB, MIGRATION);
  psql(DB, MIGRATION);
  console.log('  migration applies twice without error');
  assert.equal(psql(DB, probe).out, 't', 'after: the read-back answers true');

  const outbox0 = Number(q('select count(*) from public.roster_sheet_outbox'));
  let r = parse(edit('fixtureone', { [KEY]: FB }));
  assert.equal(r.changed, 1);
  assert.equal(r.row.extra[KEY], FB);
  assert.equal(r.row.extra.postforme_instagram_account_id, IG, 'the Instagram account in extra is kept');
  assert.equal(r.row.source, 'syncview');
  assert.equal(r.row.row_hash, undefined, 'row_hash is never returned');
  assert.equal(q(`select count(*) from information_schema.columns where table_name = 'client_profiles' and column_name = ${lit(KEY)}`), '0', 'no new column');
  assert.equal(q(`select coalesce(old_value,'NULL') || '>' || new_value || '/' || edited_by || '/' || edited_role from public.client_profile_edits where slug='fixtureone' and field='extra.${KEY}'`), `NULL>${FB}/Admin QA/admin`);
  assert.equal(Number(q('select count(*) from public.roster_sheet_outbox')), outbox0 + 1, 'the save still queues one Sheet copy');
  console.log('  set: saved in extra, Instagram account kept, one history row, one Sheet copy queued');

  assert.equal(parse(edit('fixtureone', { [KEY]: FB })).changed, 0, 'the same value again changes nothing');
  r = parse(edit('fixtureone', { [KEY]: 'spc_FixtureFacebook02', email: 'two@example.test' }));
  assert.equal(r.changed, 2);
  assert.equal(r.row.email, 'two@example.test');
  assert.equal(r.row.extra[KEY], 'spc_FixtureFacebook02');
  console.log('  a column and the Page save together in one call');

  for (const bad of ['spc_short', 'abc_FixtureFacebook01', 'spc_Fixture Facebook', 'https://facebook.com/page', 'spc_' + 'x'.repeat(90)]) {
    refused(edit('fixtureone', { [KEY]: bad, email: 'three@example.test' }), 'client_profile_edit_bad_value');
  }
  assert.equal(q(`select email from public.client_profiles where slug = 'fixtureone'`), 'two@example.test', 'a refused value leaves the columns alone too');
  console.log('  only a Post For Me id (spc_...) fits; a refused value writes nothing at all');

  refused(edit('fixtureone', { [KEY]: FB }, '2000-01-01T00:00:00Z'), 'client_profile_version_conflict');
  console.log('  the version check still holds');

  r = parse(edit('fixtureone', { [KEY]: '' }));
  assert.equal(r.changed, 1);
  assert.equal(r.row.extra[KEY], undefined, 'a blank removes the key');
  assert.equal(r.row.extra.postforme_instagram_account_id, IG);
  assert.equal(q(`select coalesce(new_value,'NULL') from public.client_profile_edits where slug='fixtureone' and field='extra.${KEY}' order by id desc limit 1`), 'NULL');
  assert.equal(parse(edit('fixtureone', { [KEY]: null })).changed, 0, 'clearing twice is a no-op');
  console.log('  a blank removes it (with a history row); clearing again is a no-op');

  r = parse(edit('fixtureone', { slack_mention_user_id: 'U0FIXTURE01' }));
  assert.equal(r.row.slack_mention_user_id, 'U0FIXTURE01', 'the Slack person still saves');
  refused(edit('fixtureone', { roam_channel_id: 'x' }), 'client_profile_edit_field_not_editable');
  console.log('  other fields unchanged; an unlisted field is still refused');

  // The Instagram account beside it: the same rules, and the Sheet copy is queued (it is a Clients Info column).
  const outbox1 = Number(q('select count(*) from public.roster_sheet_outbox'));
  r = parse(edit('fixtureone', { postforme_instagram_account_id: 'spc_FixtureInstagram02', [KEY]: FB }));
  assert.equal(r.changed, 2);
  assert.deepEqual([r.row.extra.postforme_instagram_account_id, r.row.extra[KEY]], ['spc_FixtureInstagram02', FB], 'both accounts saved in one call');
  assert.equal(q(`select old_value || '>' || new_value from public.client_profile_edits where slug='fixtureone' and field='extra.postforme_instagram_account_id'`), `${IG}>spc_FixtureInstagram02`);
  assert.equal(Number(q('select count(*) from public.roster_sheet_outbox')), outbox1 + 1, 'one Sheet copy queued');
  refused(edit('fixtureone', { postforme_instagram_account_id: 'not-an-id' }), 'client_profile_edit_bad_value');
  console.log('  the Instagram account: set beside the Page, history row, Sheet copy queued, spc_ only');

  for (const role of ['anon', 'authenticated']) {
    assert.equal(q(`select has_function_privilege('${role}', '${FN}', 'EXECUTE')`), 'f', role + ' cannot run the save');
  }
  assert.equal(q(`select has_function_privilege('service_role', '${FN}', 'EXECUTE')`), 't');
  assert.equal(q(`select count(*) from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'client_profile_admin_edit' and grantee = 'PUBLIC'`), '0', 'PUBLIC holds no EXECUTE');
  console.log('  four roles measured: only service_role may run the save');
  console.log('client-facebook-page-postgres checks passed');
} catch (e) {
  failed = true;
  console.error('FAIL ' + (e && e.stack || e));
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
if (failed) process.exit(1);
