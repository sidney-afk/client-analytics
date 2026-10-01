'use strict';
/*
 * roster-native-postgres.js -- migrations/2026-10-02-roster-native.sql on a
 * disposable PostgreSQL, before anyone applies it live.
 *
 * Synthetic names only (the repository is public). Proves:
 *  - every write function REFUSES unless client_profiles_authority reads
 *    "syncview" (flag "sheet", flag missing, flag malformed: all refused);
 *  - creating, changing, clearing and restoring a client, the extra field,
 *    the compare-and-set, and that a refused call leaves nothing behind;
 *  - assigning a client to a manager: one manager per client, moved cleanly,
 *    the Slack id kept when a blank one is sent, history written;
 *  - each write queues exactly one outbox row for the read-only Sheet copy,
 *    and a no-op queues none;
 *  - all of it works when run as service_role, and only service_role may run
 *    the functions or touch the new tables (measured for all four roles,
 *    starting from Supabase's default grants);
 *  - the migration applies twice without error.
 *
 * Runs in the isolated PG17 CI lane. Locally, point PG* at a throwaway server
 * and set ROSTER_NATIVE_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY. It creates and drops
 * its own database.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.ROSTER_NATIVE_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  console.log('SKIP roster-native-postgres: needs a disposable PostgreSQL (ROSTER_NATIVE_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY)');
  process.exit(0);
}
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DB = 'roster_native_' + process.pid;

function psql(database, text, allowFail = false) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input: text, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = text => psql(DB, text).out;
// One statement as service_role; returns { ok, out, err }.
const asService = text => psql(DB, `set role service_role; ${text}`, true);
const lit = v => (v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");
const js = o => lit(JSON.stringify(o)) + '::jsonb';

function write(slug, { name = null, cols = {}, extra = {}, expect = {}, actor = 'n8n-onboarding', role = 'n8n' } = {}) {
  return asService(`select public.client_profile_service_write(${lit(slug)}, ${lit(name)}, ${js(cols)}, ${js(extra)}, ${js(expect)}, ${lit(actor)}, ${lit(role)}, 'req-1');`);
}
function assign(slug, name, mslug, mname, slack = '', role = 'n8n') {
  return asService(`select public.smm_assign_client(${lit(slug)}, ${lit(name)}, ${lit(mslug)}, ${lit(mname)}, ${lit(slack)}, 'n8n-onboarding', ${lit(role)}, 'req-2');`);
}
const parse = r => { assert(r.ok, 'call failed: ' + r.err); return JSON.parse(r.out.split('\n').pop()); };
const LISTS = ['calendar_upsert_ef_clients', 'sample_review_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients'];
const inList = (key, slug) => q(`select (value->'clients') @> to_jsonb(${lit(slug)}::text) from public.syncview_runtime_flags where key = ${lit(key)}`) === 't';
const inAll = slug => LISTS.every(k => inList(k, slug));
const inNone = slug => LISTS.every(k => !inList(k, slug));
const listsText = () => q(`select string_agg(key || '=' || (value->'clients')::text, ';' order by key) from public.syncview_runtime_flags where key in (${LISTS.map(lit).join(',')})`);
const archive = (slug, role = 'n8n') => asService(`select public.client_profile_archive(${lit(slug)}, 'n8n-offboarding', ${lit(role)}, 'req-9');`);
const refused = (r, code) => { assert(!r.ok, 'expected a refusal, got: ' + r.out); assert(r.err.includes(code), `expected ${code}, got: ${r.err}`); };
const count = t => Number(q(`select count(*) from public.${t}`));

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
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.syncview_runtime_flags (key text primary key, value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(), updated_by text);
  `);
  psql(DB, read('migrations/2026-09-25-sheets-mirror-phase1.sql'));
  psql(DB, read('migrations/2026-09-25-client-profile-edits.sql'));
  // The Managers table exactly as its own migration defines it (only that table).
  psql(DB, `create table public.social_media_managers (
      slug text primary key, name text not null, email text not null default '', active boolean not null default true,
      source text not null default 'google_sheet', source_row_count integer not null default 0,
      source_clients jsonb not null default '[]'::jsonb, synced_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create unique index social_media_managers_name_unique on public.social_media_managers (lower(name));`);
  // The clients table (only the columns used here) and the four save-permission lists.
  psql(DB, `create table public.clients (slug text primary key, display_name text, active boolean not null default true,
      kind text not null default 'client', updated_at timestamptz not null default now());
    insert into public.clients (slug, display_name, active, kind) values
      ('existingone', 'Existing One', true, 'client'), ('alphaone', 'Alpha One', false, 'client'),
      ('alphatwo', 'Alpha Two', true, 'client'), ('testexample', 'Test Example', true, 'test'),
      ('sidneylaruel', 'Test', true, 'test');
    insert into public.syncview_runtime_flags (key, value) values
      ('calendar_upsert_ef_clients', '{"clients":["existingone","sidneylaruel"]}'),
      ('sample_review_ef_clients', '{"clients":["existingone","sidneylaruel"]}'),
      ('settings_ef_clients', '{"clients":["existingone","sidneylaruel"]}'),
      ('write_ui_reroute_clients', '{"clients":["existingone","sidneylaruel"]}');`);
  const MIGRATION = read('migrations/2026-10-02-roster-native.sql');
  psql(DB, MIGRATION);
  psql(DB, MIGRATION); // idempotent
  console.log('  migration applies twice without error');

  // ---- 1. refused unless the switch reads "syncview" ----
  psql(DB, `delete from public.syncview_runtime_flags where key = 'client_profiles_authority';`);
  refused(write('alphaone', { name: 'Alpha One' }), 'roster_authority_not_syncview');
  psql(DB, `insert into public.syncview_runtime_flags (key, value) values ('client_profiles_authority', '{"source":"sheet"}');`);
  refused(write('alphaone', { name: 'Alpha One' }), 'roster_authority_not_syncview');
  refused(assign('alphaone', 'Alpha One', 'mgrone', 'Mgr One'), 'roster_authority_not_syncview');
  psql(DB, `update public.syncview_runtime_flags set value = '"syncview"' where key = 'client_profiles_authority';`);
  refused(write('alphaone', { name: 'Alpha One' }), 'roster_authority_not_syncview');
  assert.equal(count('client_profiles'), 0);
  assert.equal(count('roster_sheet_outbox'), 0);
  console.log('  refused with the flag at "sheet", missing, or malformed; nothing written');

  psql(DB, `update public.syncview_runtime_flags set value = '{"source":"syncview"}' where key = 'client_profiles_authority';`);

  // ---- 2. create, change, clear ----
  let r = parse(write('alphaone', { name: ' Alpha One ', cols: { email: ' a@example.test ', instagram_handle: 'alpha' }, extra: { postforme_instagram_account_id: 'pf-1' } }));
  assert.equal(r.created, true);
  assert.equal(r.row.display_name, 'Alpha One');
  assert.equal(r.row.email, 'a@example.test');
  assert.equal(r.row.source, 'syncview');
  assert.equal(r.row.extra.postforme_instagram_account_id, 'pf-1');
  assert.equal(r.row.row_hash, undefined, 'row_hash is never returned');
  assert.equal(q(`select count(*) from public.client_profile_edits where slug='alphaone' and field='(created)'`), '1');
  assert.equal(q(`select count(*) from public.client_profile_edits where slug='alphaone' and field='extra.postforme_instagram_account_id'`), '1');
  assert.equal(count('roster_sheet_outbox'), 1);

  r = parse(write('alphaone', { cols: { creative_channel_id: 'C123', email: '' } }));
  assert.equal(r.created, false);
  assert.equal(r.changed, 2);
  assert.equal(r.row.email, null, 'a blank clears');
  assert.equal(r.row.creative_channel_id, 'C123');
  assert.equal(q(`select old_value || '>' || coalesce(new_value,'NULL') from public.client_profile_edits where slug='alphaone' and field='email' order by id desc limit 1`), 'a@example.test>NULL');
  assert.equal(q(`select edited_by || '/' || edited_role from public.client_profile_edits where slug='alphaone' and field='creative_channel_id'`), 'n8n-onboarding/n8n');
  assert.equal(count('roster_sheet_outbox'), 2);

  const before = [count('client_profile_edits'), count('roster_sheet_outbox')];
  r = parse(write('alphaone', { cols: { creative_channel_id: 'C123' } }));
  assert.equal(r.changed, 0);
  assert.deepEqual([count('client_profile_edits'), count('roster_sheet_outbox')], before, 'a no-op writes no history and queues no copy');

  parse(write('alphaone', { extra: { postforme_instagram_account_id: '' } }));
  assert.equal(q(`select extra ? 'postforme_instagram_account_id' from public.client_profiles where slug='alphaone'`), 'f');
  console.log('  create, change, clear, extra field, no-op: ok');

  // ---- 3. compare-and-set ----
  parse(write('alphatwo', { name: 'Alpha Two' }));
  parse(write('alphatwo', { cols: { creative_channel_id: 'C900' }, expect: { creative_channel_id: '' } }));
  const hist = count('client_profile_edits');
  const box = count('roster_sheet_outbox');
  refused(write('alphatwo', { cols: { creative_channel_id: 'C901', email: 'x@example.test' }, expect: { creative_channel_id: '' } }), 'client_profile_expectation_failed');
  assert.equal(q(`select creative_channel_id from public.client_profiles where slug='alphatwo'`), 'C900');
  assert.equal(q(`select coalesce(email,'none') from public.client_profiles where slug='alphatwo'`), 'none');
  assert.deepEqual([count('client_profile_edits'), count('roster_sheet_outbox')], [hist, box], 'a refused call leaves nothing behind');
  console.log('  compare-and-set refuses and rolls everything back');

  // ---- 4. missing, archived, bad input ----
  refused(write('nobodyhere', { cols: { email: 'z@example.test' } }), 'client_profile_missing');
  psql(DB, `update public.client_profiles set archived_at = now() where slug = 'alphatwo'`);
  refused(write('alphatwo', { cols: { email: 'z@example.test' } }), 'client_profile_archived');
  r = parse(write('alphatwo', { name: 'Alpha Two', cols: { email: 'z@example.test' } }));
  assert.equal(r.row.archived_at, null);
  assert.equal(q(`select count(*) from public.client_profile_edits where slug='alphatwo' and field='(restored)'`), '1');
  refused(write('alphatwo', { cols: { client_review_token: 'nope' } }), 'client_profile_field_not_writable');
  refused(write('alphatwo', { cols: { slug: 'x' } }), 'client_profile_field_not_writable');
  refused(write('alphatwo', { cols: { email: 'q' }, role: 'anon' }), 'client_profile_write_bad_role');
  refused(write('Bad Slug', { name: 'Bad' }), 'client_profile_bad_slug');
  refused(write('alphatwo', { cols: { email: 'q' }, actor: '  ' }), 'client_profile_write_actor_required');
  console.log('  missing, archived, restore, forbidden fields, bad role/slug/actor: ok');

  // ---- 4b. creating or restoring joins the four save-permission lists; archiving leaves them ----
  assert(inAll('alphaone') && inAll('alphatwo'), 'the clients created above joined all four lists');
  assert(inAll('existingone') && inAll('sidneylaruel'), 'existing entries are kept');
  assert.equal(q(`select active from public.clients where slug='alphaone'`), 't', 'creating makes an existing inactive client active');
  assert.equal(count('roster_sheet_outbox') > 0, true);
  // a plain field change never re-enrols
  psql(DB, `update public.syncview_runtime_flags set value = jsonb_set(value, '{clients}', '["existingone","sidneylaruel","alphatwo"]') where key = 'settings_ef_clients'`);
  parse(write('alphaone', { cols: { keywords: 'plain change' } }));
  assert(!inList('settings_ef_clients', 'alphaone'), 'a plain field change leaves the lists alone');
  // creating again (already exists, not archived) does not touch them either; restoring does add back
  parse(write('alphaone', { name: 'Alpha One', cols: { keywords: 'again' } }));
  assert(!inList('settings_ef_clients', 'alphaone'), 'an upsert of a live client is not an enrolment');
  // the test client: written normally, never enrolled
  const listsBefore = listsText();
  parse(write('sidneylaruel', { name: 'Test', cols: { keywords: 'qa' } }));
  parse(write('testexample', { name: 'Test Example', cols: { keywords: 'qa' } }));
  assert.equal(listsText(), listsBefore, 'creating or changing a test client never changes the lists');
  parse(write('freshtestonly', { name: 'Fresh Client', cols: { email: 'f@example.test' } }));
  assert(inAll('freshtestonly'), 'a brand-new client joins all four');
  assert.equal(q(`select count(*) from public.clients where slug='freshtestonly'`), '0', 'no clients row: the lists still get it, and no row is invented');
  const added = q(`select count(*) from public.client_profile_edits where slug='freshtestonly' and field='(created)'`);
  assert.equal(added, '1');
  // archive
  let a = parse(archive('alphaone'));
  assert.deepEqual([a.archived, a.already], [true, false]);
  assert(inNone('alphaone'), 'archiving takes the client out of all four lists');
  assert(inAll('existingone') && inAll('sidneylaruel') && inAll('alphatwo'), 'nobody else is touched');
  assert.equal(q(`select active from public.clients where slug='alphaone'`), 'f', 'and makes it inactive');
  assert.equal(q(`select count(*) from public.client_profile_edits where slug='alphaone' and field='(archived)'`), '1');
  assert.equal(q(`select (archived_at is not null)::text from public.client_profiles where slug='alphaone'`), 'true');
  const boxA = count('roster_sheet_outbox');
  a = parse(archive('alphaone'));
  assert.deepEqual([a.archived, a.already], [false, true], 'archiving twice changes nothing');
  assert.equal(count('roster_sheet_outbox'), boxA);
  // restore puts it back on all four and active
  parse(write('alphaone', { name: 'Alpha One' }));
  assert(inAll('alphaone'), 'restoring joins all four again');
  assert.equal(q(`select active from public.clients where slug='alphaone'`), 't');
  // the test client can never be archived or taken off
  for (const slug of ['sidneylaruel', 'testexample']) {
    const snap = listsText();
    refused(archive(slug), 'roster_test_client_untouchable');
    assert.equal(listsText(), snap, slug + ': lists untouched');
    assert.equal(q(`select (archived_at is null)::text from public.client_profiles where slug=${lit(slug)}`), 'true', slug + ': still not archived');
  }
  refused(archive('nobodyhere'), 'client_profile_missing');
  refused(archive('alphaone', 'anon'), 'client_profile_write_bad_role');
  // a malformed or missing list refuses the whole call and writes nothing
  for (const [label, bad] of [['not an array', `'{"clients":"x"}'`], ['duplicates', `'{"clients":["existingone","existingone"]}'`], ['not an object', `'[]'`]]) {
    const keep = q(`select value::text from public.syncview_runtime_flags where key='write_ui_reroute_clients'`);
    psql(DB, `update public.syncview_runtime_flags set value = ${bad}::jsonb where key='write_ui_reroute_clients'`);
    const profilesBefore = count('client_profiles');
    refused(write('badlistclient', { name: 'Bad List' }), 'roster_routing_flag_invalid');
    assert.equal(count('client_profiles'), profilesBefore, label + ': nothing created');
    refused(archive('alphatwo'), 'roster_routing_flag_invalid');
    assert.equal(q(`select (archived_at is null)::text from public.client_profiles where slug='alphatwo'`), 'true', label + ': nothing archived');
    psql(DB, `update public.syncview_runtime_flags set value = ${lit(keep)}::jsonb where key='write_ui_reroute_clients'`);
  }
  psql(DB, `delete from public.syncview_runtime_flags where key='settings_ef_clients'`);
  refused(write('missinglist', { name: 'Missing List' }), 'roster_routing_flag_invalid');
  psql(DB, `insert into public.syncview_runtime_flags (key, value) values ('settings_ef_clients', '{"clients":["existingone","sidneylaruel","alphaone","alphatwo","freshtestonly"]}')`);
  console.log('  enrolment: create/restore join the four lists, archive leaves them, test client untouched, bad lists refuse: ok');

  // ---- 5. managers ----
  r = parse(assign('alphaone', 'Alpha One', 'mgrone', 'Mgr One', 'U111'));
  assert.equal(r.manager_slug, 'mgrone');
  assert.equal(r.slack_profile_url, 'U111');
  assert.equal(q(`select source_clients::text from public.social_media_managers where slug='mgrone'`), '["Alpha One"]');
  parse(assign('alphatwo', 'Alpha Two', 'mgrone', 'Mgr One'));
  assert.equal(q(`select source_clients::text from public.social_media_managers where slug='mgrone'`), '["Alpha One", "Alpha Two"]');
  assert.equal(q(`select slack_profile_url from public.social_media_managers where slug='mgrone'`), 'U111', 'a blank Slack id keeps the old one');

  parse(assign('alphaone', 'alpha one', 'mgrtwo', 'Mgr Two', 'U222'));
  assert.equal(q(`select source_clients::text from public.social_media_managers where slug='mgrone'`), '["Alpha Two"]', 'moved off the old manager (case-insensitive)');
  assert.equal(q(`select count(*) from public.social_media_managers where source_clients @> '["Alpha One"]'::jsonb or source_clients @> '["alpha one"]'::jsonb`), '1', 'exactly one manager per client');
  assert.equal(q(`select old_manager_slug || '>' || new_manager_slug from public.smm_assignment_edits where client_name='Alpha One'`), 'mgrone>mgrtwo', 'the profile\'s own name is recorded, not the caller\'s spelling');

  const editsBefore = count('smm_assignment_edits');
  parse(assign('alphaone', 'Alpha One', 'mgrtwo', 'Mgr Two'));
  assert.equal(count('smm_assignment_edits'), editsBefore, 'assigning the same manager again writes no history');
  refused(assign('nobodyhere', 'Nobody Here', 'mgrtwo', 'Mgr Two'), 'client_profile_missing');
  psql(DB, `update public.client_profiles set archived_at = now() where slug = 'alphatwo'`);
  refused(assign('alphatwo', 'Alpha Two', 'mgrtwo', 'Mgr Two'), 'client_profile_missing');
  psql(DB, `update public.client_profiles set archived_at = null where slug = 'alphatwo'`);
  assert.equal(q(`select count(*) from public.social_media_managers where source_clients::text ilike '%nobody%'`), '0', 'a mistyped client is never added to a manager');

  parse(assign('alphaone', 'Alpha One', '', ''));
  assert.equal(q(`select count(*) from public.social_media_managers where source_clients::text ilike '%alpha one%'`), '0', 'a blank manager removes the client');
  refused(assign('alphaone', 'Alpha One', 'Bad Slug', 'Mgr Two'), 'smm_assign_bad_manager_slug');
  refused(assign('alphaone', '  ', 'mgrtwo', 'Mgr Two'), 'smm_assign_client_required');
  assert.equal(q(`select count(*) from public.roster_sheet_outbox where tab='Social Media Managers'`), '5');
  console.log('  managers: assign, move, keep Slack id, remove, one per client: ok');

  // ---- 5b. the Clients tab's own edit queues the Sheet copy only after the switch ----
  const adminEdit = (slug, changes) => asService(`select public.client_profile_admin_edit(${lit(slug)}, ${js(changes)}, (select updated_at from public.client_profiles where slug=${lit(slug)}), 'Admin QA', 'admin', 'm1', null, 'req-3');`);
  let boxN = count('roster_sheet_outbox');
  parse(adminEdit('alphaone', { keywords: 'one' }));
  assert.equal(count('roster_sheet_outbox'), boxN + 1, 'native admin edit queues the Sheet copy');
  parse(adminEdit('alphaone', { keywords: 'one' }));
  assert.equal(count('roster_sheet_outbox'), boxN + 1, 'a no-op admin edit queues nothing');
  psql(DB, `update public.syncview_runtime_flags set value = '{"source":"sheet"}' where key = 'client_profiles_authority';`);
  boxN = count('roster_sheet_outbox');
  parse(adminEdit('alphaone', { keywords: 'two' }));
  assert.equal(count('roster_sheet_outbox'), boxN, 'while the Sheet is main, the admin edit queues nothing (as before)');
  psql(DB, `update public.syncview_runtime_flags set value = '{"source":"syncview"}' where key = 'client_profiles_authority';`);
  console.log('  admin edit: queues the copy only once the database is main');

  // ---- 6. measured access, all four roles ----
  const ROLES = ['public_probe', 'anon', 'authenticated', 'service_role'];
  const attempt = (role, stmt) => psql(DB, `begin; set local role ${role}; ${stmt}; rollback;`, true).ok;
  const tables = {
    smm_assignment_edits: { cols: 'client_name, edited_by, edited_role', vals: "'p','q','n8n'", upd: 'client_name = client_name' },
    roster_sheet_outbox: { cols: 'tab, client_slug, client_name', vals: "'Clients Info','probe','P'", upd: 'client_name = client_name' },
  };
  const want = (role, table) => role !== 'service_role'
    ? { select: false, insert: false, update: false, delete: false, truncate: false }
    : { select: true, insert: true, update: table === 'roster_sheet_outbox', delete: false, truncate: false };
  for (const role of ROLES) {
    for (const [t, s] of Object.entries(tables)) {
      const got = {
        select: attempt(role, `select count(*) from public.${t}`),
        insert: attempt(role, `insert into public.${t} (${s.cols}) values (${s.vals})`),
        update: attempt(role, `update public.${t} set ${s.upd}`),
        delete: attempt(role, `delete from public.${t}`),
        truncate: attempt(role, `truncate public.${t}`),
      };
      console.log(`  ${role.padEnd(14)} ${t.padEnd(22)} ` + Object.entries(got).map(([k, v]) => k + '=' + (v ? 'ALLOWED' : 'denied')).join(' '));
      assert.deepEqual(got, want(role, t), `${role} on ${t}`);
    }
    const fn = (name, args) => attempt(role, `select public.${name}(${args})`);
    // Execute rights only: a refused call for a bad reason still proves the door is open.
    const execOk = {
      roster_authority: q(`select has_function_privilege('${role}', 'public.roster_authority()', 'EXECUTE')`) === 't',
      service_write: q(`select has_function_privilege('${role}', 'public.client_profile_service_write(text,text,jsonb,jsonb,jsonb,text,text,text)', 'EXECUTE')`) === 't',
      assign: q(`select has_function_privilege('${role}', 'public.smm_assign_client(text,text,text,text,text,text,text,text)', 'EXECUTE')`) === 't',
      archive: q(`select has_function_privilege('${role}', 'public.client_profile_archive(text,text,text,text)', 'EXECUTE')`) === 't',
      enrol: q(`select has_function_privilege('${role}', 'public.roster_route_enrol(text,boolean)', 'EXECUTE')`) === 't',
      testclient: q(`select has_function_privilege('${role}', 'public.roster_is_test_client(text)', 'EXECUTE')`) === 't',
    };
    const wantExec = role === 'service_role';
    assert.deepEqual(execOk, { roster_authority: wantExec, service_write: wantExec, assign: wantExec, archive: wantExec, enrol: wantExec, testclient: wantExec }, `${role} execute rights`);
    void fn;
  }
  const seqs = q(`select string_agg(format('%s:%s:%s', c.relname, r.rolname,
      has_sequence_privilege(r.rolname, c.oid, 'USAGE,SELECT,UPDATE')), ',')
    from pg_class c cross join (values ('anon'),('authenticated'),('service_role'),('public_probe')) r(rolname)
    where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace and c.relname ~ '^(smm_assignment_edits|roster_sheet_outbox)_';`);
  assert(seqs.length > 0, 'identity sequences exist');
  for (const e of seqs.split(',')) assert(e.endsWith(':f'), 'no role holds a sequence privilege: ' + e);
  assert.equal(q(`select bool_and(relrowsecurity)::text || '/' || (select count(*) from pg_policy p join pg_class c2 on c2.oid = p.polrelid where c2.relname in ('smm_assignment_edits','roster_sheet_outbox')) from pg_class where relnamespace='public'::regnamespace and relname in ('smm_assignment_edits','roster_sheet_outbox')`), 'true/0');
  console.log('  four roles measured: only service_role, only the minimum; RLS on, 0 policies');
  // ---- 7. the way back: rollback restores the Clients tab save, then drops the new functions ----
  psql(DB, read('migrations/2026-10-02-roster-native.ROLLBACK.sql'));
  assert.equal(q(`select count(*) from pg_proc where proname in ('roster_authority','client_profile_service_write','smm_assign_client','client_profile_archive','roster_route_enrol','roster_is_test_client')`), '0');
  assert.equal(q(`select position('roster_authority' in pg_get_functiondef(p.oid)) from pg_proc p where p.proname='client_profile_admin_edit'`), '0', 'the original admin edit body is back');
  parse(adminEdit('alphaone', { keywords: 'after-rollback' }));
  assert.equal(q(`select keywords from public.client_profiles where slug='alphaone'`), 'after-rollback', 'the Clients tab save still works after the rollback');
  psql(DB, MIGRATION);
  console.log('  rollback: restores the original save, drops the new functions; migration re-applies');
  console.log('roster-native-postgres checks passed');
} catch (e) {
  failed = true;
  console.error(e && e.stack || e);
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
process.exit(failed ? 1 : 0);
