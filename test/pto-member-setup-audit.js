'use strict';
/*
 * PTO Member setup leaves a record (OPEN_REPAIRS 399).
 *
 * THE FAILURE THIS EXISTS TO CATCH. The admin Member setup form saves a PTO
 * start date and the "PTO enabled" switch through the pto Edge Function's
 * set_start_date action. The function resolved the verified caller and then
 * dropped it (`setStartDate(supabase, data, body)`), and the database function
 * it called, pto_set_member_start_v1, overwrote pto_members in place: no
 * actor, no prior value, no event. The start date drives every accrual, so a
 * balance could move with no trace, against cross-tier invariant 3 in
 * docs/QUALITY_TIERS.md.
 *
 * Two halves:
 *   1. Always runs, offline: the Edge Function passes the caller and calls
 *      pto_set_member_start_v2 with p_actor; the migration creates the record
 *      table, writes it inside v2, and every revoke names all four roles; the
 *      deploy lane's schema latch moved with it.
 *   2. Runs when a disposable PostgreSQL 16 is installed (required with
 *      PTO_MEMBER_AUDIT_REQUIRE_POSTGRES=1): applies the repository's own PTO
 *      migrations to a throwaway cluster with Supabase's default privileges,
 *      applies the new migration twice, replays first setup / no-op / change /
 *      stale / blank actor / inactive / history / rollback-on-failure, and
 *      measures what each of the four roles can do. Invented ids and names
 *      only; never contacts a hosted backend.
 *
 * Run: node test/pto-member-setup-audit.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => {
  try { return fs.readFileSync(path.join(ROOT, relative), 'utf8'); } catch (_) { return ''; }
};
const FN = read('supabase/functions/pto/index.ts');
const BASE = read('migrations/2026-07-15-pto-tracker.sql');
const CANCELLATION = read('migrations/2026-07-15-pto-cancellation-audit.sql');
const MIGRATION_FILE = 'migrations/2026-10-10-pto-member-setup-audit.sql';
const STEP2_FILE = 'migrations/2026-10-10-pto-member-setup-audit-step2-revoke-v1.sql';
const MIGRATION = read(MIGRATION_FILE);
const STEP2 = read(STEP2_FILE);
const DEPLOY = read('.github/workflows/deploy-pto-edge-functions.yml');

let passed = 0;
let failed = 0;
const ok = (name, value) => {
  if (value) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) return '';
  let depth = 0;
  for (let j = source.indexOf('{', at); j >= 0 && j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') {
      depth--;
      if (depth === 0) return source.slice(at, j + 1);
    }
  }
  return '';
}
const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '');
const oneLine = (text) => text.replace(/\s+/g, ' ');

/* ---- 1. structure ---------------------------------------------------------- */
console.log('pto member setup audit: Edge Function');
const setStart = grabFunc(FN, 'setStartDate');
ok('set_start_date dispatch passes the verified caller',
  /if \(action === "set_start_date"\) return await setStartDate\(supabase, data, caller, body\);/.test(FN));
ok('setStartDate takes the caller',
  /async function setStartDate\(\s*supabase: SupabaseClient,\s*data: PtoData,\s*caller: MemberRow,\s*body: JsonMap,\s*\)/.test(FN));
ok('setStartDate calls pto_set_member_start_v2 with p_actor from the caller name',
  /const actor = clean\(caller\.name, 200\);/.test(setStart)
  && /\.rpc\("pto_set_member_start_v2", \{[\s\S]*?p_expected_state_version: expectedStateVersion,\s*p_actor: actor,\s*\}\)/.test(setStart));
ok('a blank caller name never reaches the database',
  /if \(!actor\) throw new Error\("pto_member_setup_actor_missing"\);/.test(setStart));
ok('no call to the record-less pto_set_member_start_v1 remains anywhere in the function',
  FN.length > 0 && !/pto_set_member_start_v1/.test(FN));
ok('deployed before its migration it refuses with 503 member_setup_audit_not_ready and never falls back',
  /error\.code === "PGRST202" \|\| error\.code === "42883"[\s\S]{0,200}error: "member_setup_audit_not_ready"[\s\S]{0,200}\}, 503\)/.test(setStart)
  && (setStart.match(/\.rpc\(/g) || []).length === 1);
ok('the response shape is unchanged (ok + member with name)',
  /return json\(\{\s*ok: true,\s*member: \{ name: member\.name, \.\.\.upserted \},\s*\}\);/.test(setStart));

console.log('pto member setup audit: migration');
const code = stripSqlComments(MIGRATION);
const flat = oneLine(code);
const v2Body = (() => {
  const a = code.indexOf('create or replace function public.pto_set_member_start_v2(');
  const b = code.indexOf('$fn$;', a);
  return a >= 0 && b > a ? code.slice(a, b) : '';
})();
ok(`${MIGRATION_FILE} exists`, MIGRATION.length > 0);
ok('marked NOT APPLIED in its header', /NOT APPLIED/.test(MIGRATION.slice(0, 400)));
ok('refuses to run before the base PTO migration',
  /to_regclass\('public\.pto_members'\) is null[\s\S]*raise exception 'pto_member_setup_audit needs/.test(code));
ok('creates the append-only record table with actor, before, after and time',
  /create table if not exists public\.pto_member_events \(/.test(code)
  && /id\s+bigint generated always as identity primary key/.test(code)
  && /member_id\s+uuid not null references public\.team_members \(id\)/.test(code)
  && /actor\s+text not null check \(btrim\(actor\) <> ''\)/.test(code)
  && /before_start_date date,/.test(code) && /before_enabled\s+boolean,/.test(code)
  && /after_start_date\s+date not null/.test(code) && /after_enabled\s+boolean not null/.test(code)
  && /at\s+timestamptz not null default now\(\)/.test(code));
ok('RLS on, no policy, not in realtime',
  /alter table public\.pto_member_events enable row level security;/.test(code)
  && !/create policy/i.test(code) && !/alter publication/i.test(code));
const revokes = flat.match(/revoke all on [^;]*;/g) || [];
ok(`every revoke names all four roles (${revokes.length} revokes: table, sequence, v2)`,
  revokes.length === 3
  && revokes.every(r => /from public, anon, authenticated, service_role(', s\))?;$/.test(r)));
ok('the table: service_role may only SELECT; nobody may INSERT, UPDATE, DELETE or TRUNCATE directly',
  /grant select on table public\.pto_member_events to service_role;/.test(flat)
  && (flat.match(/grant [^;]*pto_member_events[^;]*;/g) || []).length === 1
  && !/grant [^;]*(insert|update|delete|truncate|all)[^;]* on (table )?public\.pto_member_events/i.test(flat));
ok('no grant to anon, authenticated or public anywhere in the file',
  !/grant [^;]* to [^;]*\b(anon|authenticated|public)\b/i.test(flat));
ok('v2 is SECURITY DEFINER with a pinned search_path, like v1',
  /returns jsonb\s+language plpgsql\s+security definer\s+set search_path = public, pg_temp/.test(v2Body));
ok('v2 refuses a blank actor before any lock or write',
  /v_actor text := btrim\(coalesce\(p_actor, ''\)\);/.test(v2Body)
  && /if v_actor = '' then\s+raise exception 'pto_member_setup_actor_required'/.test(v2Body)
  && v2Body.indexOf("pto_member_setup_actor_required") < v2Body.indexOf('from public.team_members'));
ok("v2 keeps v1's checks: active roster lock, profile lock, state_version compare, history conflict",
  /from public\.team_members\s+where id = p_member_id\s+and active is true\s+for update;/.test(v2Body)
  && /from public\.pto_members\s+where member_id = p_member_id\s+for update;/.test(v2Body)
  && /v_member\.state_version <> p_expected_state_version then\s+return jsonb_build_object\('status', 'stale'\)/.test(v2Body)
  && /elsif p_expected_state_version is not null then\s+return jsonb_build_object\('status', 'stale'\)/.test(v2Body)
  && /return jsonb_build_object\('status', 'history_conflict'\)/.test(v2Body));
const upsertAt = v2Body.indexOf('on conflict (member_id) do update');
const eventAt = v2Body.indexOf('insert into public.pto_member_events');
const returnAt = v2Body.indexOf("return jsonb_build_object('status', 'ok'");
ok('v2 writes the event row inside the same function, after the profile write and before it returns',
  upsertAt > 0 && eventAt > upsertAt && returnAt > eventAt);
ok('only a new profile or a real change writes an event (before = the locked row, after = the written row)',
  /if not v_existed\s+or v_member\.pto_start_date is distinct from v_upserted\.pto_start_date\s+or v_member\.pto_enabled is distinct from v_upserted\.pto_enabled then\s+insert into public\.pto_member_events/.test(v2Body)
  && /v_member\.pto_start_date, v_member\.pto_enabled,\s+v_upserted\.pto_start_date, v_upserted\.pto_enabled/.test(v2Body));
ok('v2 EXECUTE: revoked from all four roles, granted to service_role only',
  /revoke all on function public\.pto_set_member_start_v2\(uuid, date, boolean, bigint, text\) from public, anon, authenticated, service_role;/.test(flat)
  && (flat.match(/grant execute[^;]*;/g) || []).join('|')
    === 'grant execute on function public.pto_set_member_start_v2(uuid, date, boolean, bigint, text) to service_role;');
ok('v1 is left in place for the deploy window (not replaced or dropped by this file)',
  !/function public\.pto_set_member_start_v1/.test(code) && !/drop function/i.test(code));
ok('no HR rows, member ids, emails or runtime-flag writes (the only PTO write is inside v2)',
  !/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(MIGRATION)
  && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(MIGRATION)
  && !/syncview_runtime_flags/i.test(code)
  && v2Body.length > 0
  && !/(insert into|update|delete from) public\.pto_(members|requests|adjustments)\b/i.test(code.replace(v2Body, '')));
ok('carries a rollback that keeps the record table', /ROLLBACK\. Keep public\.pto_member_events/.test(MIGRATION));

console.log('pto member setup audit: step 2 and the deploy lane');
const step2Flat = oneLine(stripSqlComments(STEP2));
ok(`${STEP2_FILE} exists and is marked NOT APPLIED`, STEP2.length > 0 && /NOT APPLIED/.test(STEP2.slice(0, 400)));
ok('step 2 refuses to run before v2 and its table exist',
  /to_regprocedure\('public\.pto_set_member_start_v2\(uuid,date,boolean,bigint,text\)'\) is null/.test(step2Flat)
  && /raise exception/.test(step2Flat));
ok('step 2 revokes v1 from all four roles and grants nothing',
  /revoke all on function public\.pto_set_member_start_v1\(uuid, date, boolean, bigint\) from public, anon, authenticated, service_role/.test(step2Flat)
  && !/\bgrant\b/i.test(step2Flat));
ok('the deploy lane latch moved to member-setup-audit-v1 so the new function cannot deploy before its migration',
  /REQUIRED_SCHEMA_CONTRACT: member-setup-audit-v1/.test(DEPLOY)
  && !/REQUIRED_SCHEMA_CONTRACT: transactional-writes-v1/.test(DEPLOY));
ok('a push carrying this SQL holds the automatic deploy (the file name matches the lane\'s pto SQL filter)',
  /migrations\/\.\*pto\.\*\\\.sql/.test(DEPLOY) && /^migrations\/.*pto.*\.sql$/.test(MIGRATION_FILE) && /^migrations\/.*pto.*\.sql$/.test(STEP2_FILE));

/* ---- 2. the PostgreSQL proof ----------------------------------------------- */
const PG_BIN = '/usr/lib/postgresql/16/bin';
const haveServer = fs.existsSync(path.join(PG_BIN, 'postgres')) && fs.existsSync(path.join(PG_BIN, 'initdb'));
const required = process.env.PTO_MEMBER_AUDIT_REQUIRE_POSTGRES === '1';
if (!MIGRATION || !STEP2) {
  console.log('SKIP pto member setup audit PostgreSQL proof: migration files are missing (failed above)');
} else if (!haveServer) {
  if (required) { failed += 1; console.log('  FAIL PostgreSQL 16 required but not installed'); }
  else console.log('SKIP pto member setup audit PostgreSQL proof: PostgreSQL 16 not installed');
} else {
  console.log('pto member setup audit: PostgreSQL');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const base = fs.mkdtempSync(path.join(asRoot ? '/var/tmp' : os.tmpdir(), 'pto-member-audit-'));
  fs.chmodSync(base, 0o755);
  const port = String(51000 + Math.floor(Math.random() * 4000));
  const as = (cmd, args, opts) => asRoot
    ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], Object.assign({ encoding: 'utf8' }, opts))
    : spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
  if (asRoot) spawnSync('chown', ['postgres', base]);
  const data = path.join(base, 'data');
  let started = false;
  const run = (db, input) => {
    const r = spawnSync(path.join(PG_BIN, 'psql'), ['-h', base, '-p', port, '-U', 'postgres', '-d', db,
      '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At'], { input, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  const psql = (db, input) => {
    const r = run(db, input);
    if (!r.ok) throw new Error('psql failed: ' + r.err);
    return r.out;
  };
  const one = (q) => psql('t', q);
  const svc = (q) => one('set role service_role;\n' + q);
  const svcTry = (q) => run('t', 'set role service_role;\n' + q);
  const M1 = '00000000-0000-4000-8000-0000000003a1';
  const M2 = '00000000-0000-4000-8000-0000000003a2';
  const M3 = '00000000-0000-4000-8000-0000000003a3';
  const V2 = 'public.pto_set_member_start_v2(uuid,date,boolean,bigint,text)';
  const V1 = 'public.pto_set_member_start_v1(uuid,date,boolean,bigint)';
  const lit = (v) => v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
  const v2 = (member, date, enabled, version, actor) => JSON.parse(svc(
    `select public.pto_set_member_start_v2(${lit(member)}, ${lit(date)}, ${enabled}, ${version === null ? 'null' : version}, ${lit(actor)})::text;`));
  const events = (member) => Number(one(`select count(*) from public.pto_member_events where member_id = '${member}';`));
  const lastEvent = (member) => one(`select actor || '|' || coalesce(before_start_date::text, '-') || '|' || coalesce(before_enabled::text, '-')
      || '|' || after_start_date::text || '|' || after_enabled::text
    from public.pto_member_events where member_id = '${member}' order by id desc limit 1;`);
  const profile = (member) => one(`select coalesce(pto_start_date::text, '-') || '|' || coalesce(pto_enabled::text, '-') || '|' || state_version
    from public.pto_members where member_id = '${member}';`);
  const SETUP = `
    do $r$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'public_probe') then create role public_probe nologin; end if;
    end $r$;
    grant usage on schema public to anon, authenticated, service_role, public_probe;
    -- Supabase's defaults: every new table, sequence and function is granted
    -- to anon, authenticated and service_role, so a revoke that names too few
    -- roles shows up below.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema if not exists extensions;
    create table public.team_members (id uuid primary key, name text not null, active boolean not null default true);
    create table public.syncview_runtime_flags (key text primary key, value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(), updated_by text);`;
  try {
    const init = as(path.join(PG_BIN, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust']);
    assert.equal(init.status, 0, 'initdb failed: ' + init.stderr);
    const start = as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${base} -c listen_addresses=''`,
      '-l', path.join(base, 'log'), '-w', 'start']);
    assert.equal(start.status, 0, 'pg_ctl start failed: ' + start.stderr);
    started = true;

    // Order guards on a second, bare database.
    psql('postgres', 'create database t2');
    psql('t2', SETUP);
    const early = run('t2', MIGRATION);
    ok('the migration refuses to run before the base PTO migration', !early.ok && /pto_member_setup_audit needs/.test(early.err));
    psql('t2', BASE);
    const earlyStep2 = run('t2', STEP2);
    ok('step 2 refuses to run before the migration, and leaves v1 granted',
      !earlyStep2.ok && /before step 2/.test(earlyStep2.err)
      && psql('t2', "select has_function_privilege('service_role', 'public.pto_set_member_start_v1(uuid,date,boolean,bigint)', 'EXECUTE');") === 't');

    psql('postgres', 'create database t');
    one(SETUP);
    one(`insert into public.team_members (id, name, active) values
      ('${M1}', 'Fixture Member One', true), ('${M2}', 'Fixture Member Two', true), ('${M3}', 'Fixture Member Three', false);`);
    one(BASE);
    one(CANCELLATION);
    ok('base and cancellation-audit PTO migrations apply', true);
    one(MIGRATION);
    one(MIGRATION);
    ok('the migration applies twice (idempotent)', true);

    // A: first-time setup writes one event with null "before" values.
    let r = v2(M1, '2026-03-02', true, null, 'Fixture Admin');
    ok('first-time setup succeeds with the v1 response shape', r.status === 'ok' && r.member.pto_start_date === '2026-03-02' && r.member.pto_enabled === true);
    ok('...and records who, before (none) and after', events(M1) === 1 && lastEvent(M1) === 'Fixture Admin|-|-|2026-03-02|true');

    // B: a save that changes nothing writes nothing.
    r = v2(M1, '2026-03-02', true, 0, 'Fixture Admin');
    ok('a no-op save succeeds and writes no event', r.status === 'ok' && events(M1) === 1);

    // C: a start-date change (no history yet) records before and after.
    r = v2(M1, '2026-04-01', true, 0, 'Fixture Second Admin');
    ok('a start-date change records the old date, the new date and the actor',
      r.status === 'ok' && events(M1) === 2 && lastEvent(M1) === 'Fixture Second Admin|2026-03-02|true|2026-04-01|true'
      && profile(M1) === '2026-04-01|true|1');

    // D/E: stale forms change nothing and record nothing.
    r = v2(M1, '2026-05-01', true, 0, 'Fixture Admin');
    ok('a stale state_version is refused, with no write and no event',
      r.status === 'stale' && profile(M1) === '2026-04-01|true|1' && events(M1) === 2);
    r = v2(M2, '2026-01-05', true, 5, 'Fixture Admin');
    ok('a first-time setup that expects a version is refused as stale',
      r.status === 'stale' && one(`select count(*) from public.pto_members where member_id = '${M2}';`) === '0' && events(M2) === 0);

    // F: no record without a name on it.
    for (const blank of ['   ', '', null]) {
      const f = svcTry(`select public.pto_set_member_start_v2('${M1}', '2026-05-01', true, 1, ${lit(blank)});`);
      ok(`a ${blank === null ? 'null' : JSON.stringify(blank)} actor is refused before any write`,
        !f.ok && /pto_member_setup_actor_required/.test(f.err) && profile(M1) === '2026-04-01|true|1' && events(M1) === 2);
    }

    // G: an inactive roster member.
    r = v2(M3, '2026-01-05', true, null, 'Fixture Admin');
    ok('an inactive member is refused with no event', r.status === 'member_not_found' && events(M3) === 0);

    // H: with history the date is locked, the switch is not, and switching is recorded.
    one(`insert into public.pto_adjustments (member_id, kind, delta, effective_date, reason, created_by)
      values ('${M1}', 'wellness', 1, '2026-04-02', 'fixture', 'Fixture Admin');`);
    const version = Number(one(`select state_version from public.pto_members where member_id = '${M1}';`));
    r = v2(M1, '2026-03-15', true, version, 'Fixture Admin');
    ok('with history a different start date is refused, with no event', r.status === 'history_conflict' && events(M1) === 2);
    r = v2(M1, '2026-04-01', false, version, 'Fixture Admin');
    ok('switching PTO off is recorded with the switch before and after',
      r.status === 'ok' && events(M1) === 3 && lastEvent(M1) === 'Fixture Admin|2026-04-01|true|2026-04-01|false');

    // I: the profile write and its record commit together or not at all.
    one(`create function public.fixture_block_event() returns trigger language plpgsql as $b$
        begin raise exception 'fixture_event_blocked'; end $b$;
      create trigger fixture_block_event before insert on public.pto_member_events
        for each row execute function public.fixture_block_event();`);
    const v3 = Number(one(`select state_version from public.pto_members where member_id = '${M1}';`));
    const blocked = svcTry(`select public.pto_set_member_start_v2('${M1}', '2026-04-01', true, ${v3}, 'Fixture Admin');`);
    ok('if the record cannot be written, the profile change rolls back with it',
      !blocked.ok && /fixture_event_blocked/.test(blocked.err) && profile(M1) === `2026-04-01|false|${v3}` && events(M1) === 3);
    one('drop trigger fixture_block_event on public.pto_member_events; drop function public.fixture_block_event();');

    // J: the deploy window. v1 still works for the old function, without a record.
    const old = JSON.parse(svc(`select public.pto_set_member_start_v1('${M2}', '2026-01-05', true, null)::text;`));
    ok('until step 2, v1 still serves the deployed function (and writes no record, which is why step 2 exists)',
      old.status === 'ok' && events(M2) === 0);

    // What each role can do with the record table.
    const ROLES = ['public_probe', 'anon', 'authenticated', 'service_role'];
    const attempt = (role, stmt) => run('t', `begin; set local role ${role}; ${stmt}; rollback;`).ok;
    for (const role of ROLES) {
      const got = {
        select: attempt(role, 'select count(*) from public.pto_member_events'),
        insert: attempt(role, `insert into public.pto_member_events (member_id, actor, after_start_date, after_enabled)
          values ('${M2}', 'Forged', '2026-01-01', true)`),
        update: attempt(role, "update public.pto_member_events set actor = 'Forged' where id > 0"),
        delete: attempt(role, 'delete from public.pto_member_events where id > 0'),
        truncate: attempt(role, 'truncate public.pto_member_events'),
      };
      const want = role === 'service_role'
        ? { select: true, insert: false, update: false, delete: false, truncate: false }
        : { select: false, insert: false, update: false, delete: false, truncate: false };
      console.log(`    ${role.padEnd(14)} pto_member_events ` + Object.entries(got).map(([k, v]) => `${k}=${v ? 'ALLOWED' : 'denied'}`).join(' '));
      ok(`${role} on pto_member_events is exactly ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));
    }
    ok('anon and authenticated cannot read a single event row (rows exist)',
      events(M1) === 3
      && !run('t', 'begin; set local role anon; select * from public.pto_member_events; rollback;').ok
      && !run('t', 'begin; set local role authenticated; select * from public.pto_member_events; rollback;').ok);
    const seqs = one(`select string_agg(format('%s:%s:%s', c.relname, r.rolname,
        has_sequence_privilege(r.rolname, c.oid, 'USAGE,SELECT,UPDATE')), ',' order by r.rolname)
      from pg_class c join pg_depend d on d.objid = c.oid and d.deptype = 'i'
      cross join (values ('anon'),('authenticated'),('service_role'),('public_probe')) r(rolname)
      where c.relkind = 'S' and d.refobjid = 'public.pto_member_events'::regclass;`);
    ok('no role holds a privilege on the identity sequence', seqs.length > 0 && seqs.split(',').every(e => e.endsWith(':f')));
    ok('RLS on with no policies',
      one(`select relrowsecurity::text || '|' || (select count(*) from pg_policy where polrelid = 'public.pto_member_events'::regclass)
        from pg_class where oid = 'public.pto_member_events'::regclass;`) === 'true|0');
    const execs = (fn) => ROLES.map(role => role + ':' + one(`select has_function_privilege('${role}', '${fn}', 'EXECUTE');`)).join(',');
    ok('v2 EXECUTE: service_role only', execs(V2) === 'public_probe:f,anon:f,authenticated:f,service_role:t');
    ok('anon cannot call v2', !run('t', `begin; set local role anon; select ${V2.replace(/\(.*$/, '')}('${M2}', '2026-01-05', true, 0, 'Forged'); rollback;`).ok);
    ok('v1 EXECUTE before step 2: service_role only (unchanged)', execs(V1) === 'public_probe:f,anon:f,authenticated:f,service_role:t');

    // Step 2, after the redeploy: v1 closed to all four roles; v2 keeps working.
    one(STEP2);
    one(STEP2);
    ok('step 2 applies twice (idempotent)', true);
    ok('after step 2 no role can execute v1', execs(V1) === 'public_probe:f,anon:f,authenticated:f,service_role:f');
    const v1Gone = svcTry(`select public.pto_set_member_start_v1('${M2}', '2026-01-06', true, 0);`);
    ok('...so service_role can no longer write a start date without a record', !v1Gone.ok && /permission denied/.test(v1Gone.err));
    r = v2(M2, '2026-01-06', true, 0, 'Fixture Admin');
    ok('...and v2 still works and records the change',
      r.status === 'ok' && events(M2) === 1 && lastEvent(M2) === 'Fixture Admin|2026-01-05|true|2026-01-06|true');
    ok('v2 EXECUTE after step 2: still service_role only', execs(V2) === 'public_probe:f,anon:f,authenticated:f,service_role:t');
  } catch (error) {
    failed += 1;
    console.log('  FAIL PostgreSQL proof: ' + (error && error.message || error));
  } finally {
    if (started) as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
    fs.rmSync(base, { recursive: true, force: true });
  }
}

console.log(`\npto-member-setup-audit: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
