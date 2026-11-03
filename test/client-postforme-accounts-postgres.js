'use strict';
/*
 * client-postforme-accounts-postgres.js -- migrations/2026-11-02-client-postforme-accounts.sql
 * (and its ROLLBACK) on a disposable PostgreSQL, on top of the migrations it builds on
 * (F3 of docs/plans/2026-11-trial-and-posting/combined.md, OPEN_REPAIRS 666).
 *
 * Synthetic names and ids only (the repository is public). Proves:
 *  - before it is applied: the YouTube and LinkedIn ids and made-for-kids are refused
 *    (field_not_editable), nothing is written, and the read-back answers false;
 *  - after: each saves in extra (never a column) with one history row; a blank removes it;
 *    made-for-kids is stored as true, and off removes the key (off when absent); only
 *    true/false/blank fit; a spc_ id only for the two accounts;
 *  - one Post for Me account per client on EVERY slot (TikTok column, Instagram, Facebook,
 *    YouTube, LinkedIn): a second client with the same id is refused (23505, the index named
 *    client_profiles_<field>_uniq) and nothing changes; an archived client's id counts too;
 *    padding with spaces does not get round it; the same id in two different slots is fine;
 *  - the Sheet copy is still queued; the version check holds; only service_role may run it;
 *  - it applies twice; the ROLLBACK restores the 2026-10-31 function body exactly and drops the
 *    five indexes, and its own read-back answers true.
 *
 * Locally, point PG* at a throwaway server and set
 * CLIENT_POSTFORME_ACCOUNTS_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY. It creates and drops its own database.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.CLIENT_POSTFORME_ACCOUNTS_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  console.log('SKIP client-postforme-accounts-postgres: needs a disposable PostgreSQL (CLIENT_POSTFORME_ACCOUNTS_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY)');
  process.exit(0);
}
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DB = 'client_postforme_accounts_' + process.pid;
const FILE = 'migrations/2026-11-02-client-postforme-accounts.sql';
const ROLLBACK = 'migrations/2026-11-02-client-postforme-accounts.ROLLBACK.sql';
const FN = 'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)';
const YT = 'postforme_youtube_account_id';
const LI = 'postforme_linkedin_account_id';
const KIDS = 'youtube_made_for_kids';
const SLOTS = ['postforme_account_id', 'postforme_instagram_account_id', 'postforme_facebook_account_id', YT, LI];

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
const row = slug => JSON.parse(q(`select to_jsonb(p)::text from public.client_profiles p where slug = ${lit(slug)}`));
const slotValue = (r, slot) => (slot === 'postforme_account_id' ? r[slot] : (r.extra || {})[slot]);
const probeOf = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from))).split('\n').slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const fnDef = () => q(`select pg_get_functiondef('${FN}'::regprocedure)`);
const uniqIndexes = () => q(`select count(*) from pg_indexes where schemaname = 'public' and tablename = 'client_profiles' and indexname like 'client\\_profiles\\_postforme\\_%\\_uniq'`);

const MIGRATION = read(FILE);
const probe = probeOf(MIGRATION, '-- HOW TO TELL IT IS APPLIED', "-- The function's grants");
const precheck = probeOf(MIGRATION, '-- PRECHECK', '-- WHY THE FUNCTIONS COPE');
const RB = read(ROLLBACK);
const rbProbe = probeOf(RB, '-- HOW TO TELL IT IS ROLLED BACK', '-- ====');

let failed = false;
try {
  assert(/^-- ef-auto-deploy: functions-cope-without-this$/m.test(MIGRATION.split('\n').slice(0, 40).join('\n')), 'the cope marker is in the first 40 lines');
  assert(/from public, anon, authenticated, service_role;/.test(MIGRATION), 'the revoke names all four roles');
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
    insert into public.clients (slug, display_name) values ('fixtureone', 'Fixture One'), ('fixturetwo', 'Fixture Two'), ('fixtureold', 'Fixture Old');
    insert into public.syncview_runtime_flags (key, value) values ('client_profiles_authority', '{"source":"syncview"}')
      on conflict (key) do update set value = excluded.value;`);
  psql(DB, read('migrations/2026-10-02-roster-native.sql'));
  psql(DB, read('migrations/2026-10-23-client-slack-mention.sql'));
  psql(DB, read('migrations/2026-10-31-client-facebook-page.sql'));
  const body1031 = fnDef();
  psql(DB, `insert into public.client_profiles (slug, display_name, email, postforme_account_id, extra, source, updated_at, archived_at) values
    ('fixtureone', 'Fixture One', 'one@example.test', 'spc_FixtureTikTok01', '{"postforme_instagram_account_id":"spc_FixtureInstagram01"}', 'syncview', now() - interval '1 hour', null),
    ('fixturetwo', 'Fixture Two', 'two@example.test', null, '{}', 'syncview', now() - interval '1 hour', null),
    ('fixtureold', 'Fixture Old', 'old@example.test', 'spc_FixtureTikTokOld1', '{"postforme_youtube_account_id":"spc_FixtureYouTubeOld1"}', 'syncview', now() - interval '1 hour', now() - interval '1 day');`);

  // Before.
  assert.equal(psql(DB, probe).out, 'f', 'before: the read-back answers false');
  for (const [k, v] of [[YT, 'spc_FixtureYouTube01'], [LI, 'spc_FixtureLinkedIn01'], [KIDS, 'true']]) {
    refused(edit('fixtureone', { [k]: v }), 'client_profile_edit_field_not_editable');
  }
  assert.deepEqual(Object.keys(row('fixtureone').extra), ['postforme_instagram_account_id'], 'nothing written before the migration');
  console.log('  before: the read-back says not applied; YouTube, LinkedIn and made-for-kids are refused (nothing written)');

  assert.equal(psql(DB, precheck).out, '', 'the header precheck finds no duplicate');
  psql(DB, MIGRATION);
  psql(DB, MIGRATION);
  console.log('  the precheck finds no duplicate; the migration applies twice without error');
  assert.equal(psql(DB, probe).out, 't', 'after: the read-back answers true');
  assert.equal(uniqIndexes(), '5', 'five unique indexes');

  // The two new accounts.
  const outbox0 = Number(q('select count(*) from public.roster_sheet_outbox'));
  let r = parse(edit('fixtureone', { [YT]: 'spc_FixtureYouTube01', [LI]: 'spc_FixtureLinkedIn01' }));
  assert.equal(r.changed, 2);
  assert.equal(r.row.extra[YT], 'spc_FixtureYouTube01');
  assert.equal(r.row.extra[LI], 'spc_FixtureLinkedIn01');
  assert.equal(r.row.extra.postforme_instagram_account_id, 'spc_FixtureInstagram01', 'the other extra keys are kept');
  assert.equal(q(`select count(*) from information_schema.columns where table_name = 'client_profiles' and column_name in ('${YT}', '${LI}', '${KIDS}')`), '0', 'no new column');
  assert.equal(q(`select string_agg(field || '=' || coalesce(old_value,'NULL') || '>' || new_value, ',' order by field) from public.client_profile_edits where slug='fixtureone' and field like 'extra.%'`),
    `extra.${LI}=NULL>spc_FixtureLinkedIn01,extra.${YT}=NULL>spc_FixtureYouTube01`, 'one history row each');
  assert.equal(Number(q('select count(*) from public.roster_sheet_outbox')), outbox0 + 1, 'the save still queues one Sheet copy');
  for (const bad of ['UCfixtureChannel01', 'spc_short', 'https://youtube.com/@x']) {
    refused(edit('fixtureone', { [YT]: bad }), 'client_profile_edit_bad_value');
    refused(edit('fixtureone', { [LI]: bad }), 'client_profile_edit_bad_value');
  }
  r = parse(edit('fixtureone', { [LI]: '' }));
  assert.equal(r.changed, 1);
  assert.equal(r.row.extra[LI], undefined, 'a blank removes the LinkedIn id');
  console.log('  YouTube and LinkedIn: saved in extra, one history row each, Sheet copy queued, spc_ only, blank removes');

  // Made for kids: off when absent.
  assert.equal(row('fixturetwo').extra[KIDS], undefined, 'no client is made for kids until set');
  r = parse(edit('fixturetwo', { [KIDS]: 'true' }));
  assert.equal(r.changed, 1);
  assert.equal(r.row.extra[KIDS], true, 'stored as a JSON true');
  assert.equal(q(`select jsonb_typeof(extra -> '${KIDS}') from public.client_profiles where slug = 'fixturetwo'`), 'boolean');
  assert.equal(parse(edit('fixturetwo', { [KIDS]: 'TRUE' })).changed, 0, 'on again changes nothing');
  assert.equal(parse(edit('fixturetwo', { [KIDS]: true })).changed, 0, 'a JSON true reads the same');
  for (const bad of ['yes', '1', 'on']) refused(edit('fixturetwo', { [KIDS]: bad }), 'client_profile_edit_bad_value');
  r = parse(edit('fixturetwo', { [KIDS]: 'false' }));
  assert.equal(r.changed, 1);
  assert.equal(r.row.extra[KIDS], undefined, 'off removes the key');
  assert.equal(parse(edit('fixturetwo', { [KIDS]: '' })).changed, 0, 'off again is a no-op');
  assert.equal(q(`select string_agg(coalesce(old_value,'NULL') || '>' || coalesce(new_value,'NULL'), ',' order by id) from public.client_profile_edits where slug='fixturetwo' and field='extra.${KIDS}'`),
    'NULL>true,true>NULL', 'a history row for on and for off');
  console.log('  made-for-kids: off when absent, on stores true, off removes it, history rows, only true/false/blank');

  // One account per client, every slot.
  const t0 = row('fixturetwo').updated_at;
  const taken = { postforme_account_id: 'spc_FixtureTikTok01', postforme_instagram_account_id: 'spc_FixtureInstagram01',
    postforme_facebook_account_id: 'spc_FixtureFacebook01', [YT]: 'spc_FixtureYouTube01', [LI]: 'spc_FixtureLinkedIn02' };
  parse(edit('fixtureone', { postforme_facebook_account_id: taken.postforme_facebook_account_id, [LI]: taken[LI] }));
  for (const slot of SLOTS) {
    const res = edit('fixturetwo', { [slot]: taken[slot] });
    refused(res, `client_profiles_${slot}_uniq`);
    assert(/duplicate key value violates unique constraint/.test(res.err), slot + ': refused by the unique index');
    // Padded with spaces: still the same account (the index is on the trimmed value).
    refused(edit('fixturetwo', { [slot]: '  ' + taken[slot] + ' ' }), `client_profiles_${slot}_uniq`);
    assert.equal(slotValue(row('fixturetwo'), slot) || null, null, slot + ': nothing written');
  }
  // A raw write cannot get round it with spaces either.
  const raw = psql(DB, `update public.client_profiles set extra = extra || '{"${YT}": " spc_FixtureYouTube01 "}' where slug = 'fixturetwo';`, true);
  refused(raw, `client_profiles_${YT}_uniq`);
  assert.equal(row('fixturetwo').updated_at, t0, 'the refused saves changed nothing on the second client');
  console.log('  every slot (TikTok column, Instagram, Facebook, YouTube, LinkedIn): a second client with the same id is refused, even padded');

  refused(edit('fixturetwo', { postforme_account_id: 'spc_FixtureTikTokOld1' }), 'client_profiles_postforme_account_id_uniq');
  refused(edit('fixturetwo', { [YT]: 'spc_FixtureYouTubeOld1' }), `client_profiles_${YT}_uniq`);
  console.log("  an archived client's accounts count too");

  r = parse(edit('fixturetwo', { [YT]: 'spc_FixtureShared0001', [LI]: 'spc_FixtureShared0001' }));
  assert.equal(r.changed, 2, 'the same id in two different slots is not refused here (Post for Me says which network)');
  assert.equal(parse(edit('fixtureone', { [YT]: '' })).changed, 1);
  r = parse(edit('fixturetwo', { [YT]: 'spc_FixtureYouTube01' }));
  assert.equal(r.row.extra[YT], 'spc_FixtureYouTube01', 'an id freed by one client can go to another');
  console.log('  different slots may hold the same id; a freed id can move to another client');

  refused(edit('fixtureone', { [YT]: 'spc_FixtureYouTube09' }, '2000-01-01T00:00:00Z'), 'client_profile_version_conflict');
  refused(edit('fixtureone', { roam_channel_id: 'x' }), 'client_profile_edit_field_not_editable');
  assert.equal(parse(edit('fixtureone', { email: 'one2@example.test' })).row.email, 'one2@example.test', 'a column still saves');
  console.log('  the version check holds; an unlisted field is still refused; columns save as before');

  for (const role of ['anon', 'authenticated']) {
    assert.equal(q(`select has_function_privilege('${role}', '${FN}', 'EXECUTE')`), 'f', role + ' cannot run the save');
  }
  assert.equal(q(`select has_function_privilege('service_role', '${FN}', 'EXECUTE')`), 't');
  assert.equal(q(`select count(*) from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'client_profile_admin_edit' and grantee = 'PUBLIC'`), '0', 'PUBLIC holds no EXECUTE');
  console.log('  four roles measured: only service_role may run the save');

  // Rollback.
  assert.equal(psql(DB, rbProbe).out, 'f', 'before the rollback its read-back answers false');
  psql(DB, RB);
  psql(DB, RB);
  assert.equal(fnDef(), body1031, 'the rollback restores the 2026-10-31 function body exactly');
  assert.equal(uniqIndexes(), '0', 'the rollback drops the five indexes');
  assert.equal(psql(DB, rbProbe).out, 't', 'the rollback read-back answers true');
  refused(edit('fixtureone', { [KIDS]: 'true' }), 'client_profile_edit_field_not_editable');
  assert.equal(row('fixturetwo').extra[YT], 'spc_FixtureYouTube01', 'saved values stay in extra');
  console.log('  rollback: applies twice, restores the 2026-10-31 body exactly, drops the indexes, keeps saved values');
  console.log('client-postforme-accounts-postgres checks passed');
} catch (e) {
  failed = true;
  console.error('FAIL ' + (e && e.stack || e));
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
if (failed) process.exit(1);
