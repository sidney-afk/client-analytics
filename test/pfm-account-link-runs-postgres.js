'use strict';
/*
 * pfm-account-link-runs-postgres.js -- migrations/2026-11-02-pfm-account-link-runs.sql and
 * migrations/2026-11-02-pfm-account-link-schedule.sql on a disposable PostgreSQL (L1 of
 * docs/plans/2026-11-trial-and-posting/combined.md, OPEN_REPAIRS 666).
 *
 * Synthetic ids only (the repository is public). Proves:
 *  - the run log: pfm_account_link_run_record() stores one run (time, trigger, counts, and per account only
 *    network, username, reason, account id and the candidate clients) and drops ANY other key at any depth, so a
 *    token can never be stored even if one were sent; it keeps 30 days and deletes older rows on each record;
 *  - pfm_account_link_runs_read() reads them back, newest first;
 *  - all four roles (public, anon, authenticated, service_role) hold nothing on the table or its sequence;
 *    service_role may only EXECUTE the two security-definer functions; anon and authenticated may not;
 *  - the schedule file refuses to schedule while the Vault secret is missing, and schedules one hourly job
 *    signed with that secret once it exists; it applies twice (still one job);
 *  - both read-backs in the headers answer false before and true after; the run log applies twice.
 *
 * pg_cron, pg_net and Vault are stood in for by tiny local schemas with the same names and shapes this file
 * uses (cron.schedule / cron.unschedule / cron.job, net.http_post, vault.decrypted_secrets).
 *
 * Locally, point PG* at a throwaway server and set PFM_ACCOUNT_LINK_RUNS_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.PFM_ACCOUNT_LINK_RUNS_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  console.log('SKIP pfm-account-link-runs-postgres: needs a disposable PostgreSQL (PFM_ACCOUNT_LINK_RUNS_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY)');
  process.exit(0);
}
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DB = 'pfm_account_link_runs_' + process.pid;
const RUNS = read('migrations/2026-11-02-pfm-account-link-runs.sql');
const SCHEDULE = read('migrations/2026-11-02-pfm-account-link-schedule.sql');

function psql(database, text, allowFail = false) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input: text, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = text => psql(DB, text).out;
const lit = v => "'" + String(v).replace(/'/g, "''") + "'";
// A header probe: the comment lines after `from`, up to the next bare "--" line.
const probeOf = (text, from) => {
  const start = text.indexOf(from);
  return text.slice(start, text.indexOf('\n--\n', start)).split('\n').slice(1).map(l => l.replace(/^--\s?/, '')).join('\n').trim();
};

let failed = false;
try {
  for (const [name, t] of [['run log', RUNS], ['schedule', SCHEDULE]]) {
    assert(/^-- ef-auto-deploy: functions-cope-without-this$/m.test(t.split('\n').slice(0, 40).join('\n')), name + ': the cope marker is in the first 40 lines');
  }
  assert(/from public, anon, authenticated, service_role;/.test(RUNS), 'the run log revokes from all four roles');
  // Vault is the only copy of the timer key (supervisor, 3 Nov): no function secret, so nobody holds the value.
  assert(/pfm_account_link_key/.test(SCHEDULE) && /Vault only/.test(SCHEDULE) && !/PFM_ACCOUNT_LINK_KEY/.test(SCHEDULE + RUNS), 'the key lives in Vault only; no function secret is named');
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
    -- Stand-ins for pg_cron, pg_net and Vault (the extensions are not on a plain PostgreSQL).
    create schema cron; create schema net; create schema vault; create schema extensions;
    create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as
      $f$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $f$;
    create function cron.unschedule(id bigint) returns boolean language sql as $f$ delete from cron.job where jobid = id returning true $f$;
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $f$ select 1::bigint $f$;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
  `);
  const runsProbe = probeOf(RUNS, '-- HOW TO TELL IT IS APPLIED');
  const schedProbe = probeOf(SCHEDULE, '-- HOW TO TELL IT IS APPLIED');
  assert.equal(psql(DB, runsProbe).out, 'f', 'run log read-back false before');

  // The schedule refuses before the run log and before the secret.
  let r = psql(DB, SCHEDULE.replace(/create extension[^;]*;/g, ''), true);
  assert(!r.ok, 'the schedule refuses before the run log exists');
  psql(DB, RUNS);
  psql(DB, RUNS);
  assert.equal(psql(DB, runsProbe).out, 't', 'run log read-back true after');
  console.log('  run log: applies twice; read-back false before, true after');

  // Roles.
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    const grantee = role === 'public' ? 'PUBLIC' : role;
    assert.equal(q(`select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='pfm_account_link_runs' and grantee=${lit(grantee)}`), '0', role + ' holds nothing on the table');
    assert.equal(q(`select count(*) from information_schema.usage_privileges where object_schema='public' and object_name like 'pfm_account_link_runs%' and grantee=${lit(grantee)}`), '0', role + ' holds nothing on the sequence');
  }
  for (const role of ['anon', 'authenticated']) {
    assert.equal(q(`select has_table_privilege('${role}', 'public.pfm_account_link_runs', 'select')`), 'f');
    for (const f of ['pfm_account_link_run_record(jsonb)', 'pfm_account_link_runs_read(timestamptz)', 'pfm_account_link_key_ok(text)']) {
      assert.equal(q(`select has_function_privilege('${role}', 'public.${f}', 'EXECUTE')`), 'f', role + ' cannot run ' + f);
    }
  }
  assert.equal(q(`select has_table_privilege('service_role', 'public.pfm_account_link_runs', 'select')`), 'f', 'service_role cannot read the table directly');
  assert.equal(q(`select has_table_privilege('service_role', 'public.pfm_account_link_runs', 'insert')`), 'f', 'service_role cannot write the table directly');
  for (const f of ['pfm_account_link_run_record(jsonb)', 'pfm_account_link_runs_read(timestamptz)', 'pfm_account_link_key_ok(text)']) {
    assert.equal(q(`select has_function_privilege('service_role', 'public.${f}', 'EXECUTE')`), 't', 'service_role may run ' + f);
    assert.equal(q(`select prosecdef from pg_proc where oid = 'public.${f}'::regprocedure`), 't', f + ' is security definer');
  }
  assert.equal(q(`select count(*) from information_schema.routine_privileges where routine_schema = 'public' and routine_name like 'pfm_account_link%' and grantee = 'PUBLIC'`), '0', 'PUBLIC holds no EXECUTE on any of them');
  console.log('  four roles measured: nothing on the table or sequence; service_role only runs the three security-definer functions');

  // Record: whitelisted keys only, at every depth.
  const run = {
    trigger: 'timer', dry_run: false, ok: true, error: null, accounts: 9, already_linked: 4,
    linked: [{ account_id: 'spc_FixtureIg0001', network: 'instagram', username: 'fixture.one', slug: 'fixtureone', match: 'instagram_handle', access_token: 'tok-1' }],
    needs_person: [{ account_id: 'spc_FixtureFb0001', network: 'facebook', username: 'Fixture Page', reason: 'no_saved_handle_for_network', candidates: ['fixtureone'],
      refresh_token: 'ref-1', metadata: { access_token: 'tok-2' }, display_name: 'Fixture Page Name' }],
    access_token: 'tok-3',
  };
  const rec = r => psql(DB, `set role service_role; select public.pfm_account_link_run_record(${lit(JSON.stringify(r))}::jsonb);`, true);
  r = rec(run);
  assert(r.ok, 'service_role records a run: ' + r.err);
  const back = JSON.parse(q(`set role service_role; select coalesce(jsonb_agg(to_jsonb(x)), '[]')::text from public.pfm_account_link_runs_read(now() - interval '1 hour') x;`));
  assert.equal(back.length, 1);
  const row = back[0];
  assert.deepEqual([row.trigger, row.dry_run, row.ok, row.accounts, row.already_linked, row.linked_count, row.needs_person_count], ['timer', false, true, 9, 4, 1, 1]);
  assert.deepEqual(row.linked, [{ account_id: 'spc_FixtureIg0001', network: 'instagram', username: 'fixture.one', slug: 'fixtureone' }]);
  assert.deepEqual(row.needs_person, [{ account_id: 'spc_FixtureFb0001', network: 'facebook', username: 'Fixture Page', reason: 'no_saved_handle_for_network', candidates: ['fixtureone'] }]);
  const all = q(`select coalesce(string_agg(to_jsonb(r)::text, ''), '') from public.pfm_account_link_runs r`);
  assert(!/tok-|ref-|token|Fixture Page Name|display_name|metadata/.test(all), 'nothing outside the whitelist is stored, at any depth');
  console.log('  record: counts and per account network, username, reason, account id (and candidates); tokens and display names dropped at every depth');

  // Bad candidates (not text) and missing arrays are tolerated; a bad trigger is refused.
  assert(rec({ trigger: 'admin', dry_run: true, ok: false, error: 'postforme_unreachable' }).ok, 'a failed run with no lists records');
  assert(!rec({ trigger: 'someone', ok: true }).ok, 'an unknown trigger is refused');
  // 30 days.
  psql(DB, `update public.pfm_account_link_runs set ran_at = now() - interval '31 days' where trigger = 'timer';`);
  assert(rec({ trigger: 'admin', dry_run: false, ok: true, accounts: 0, already_linked: 0 }).ok);
  assert.equal(q(`select count(*) from public.pfm_account_link_runs where ran_at < now() - interval '30 days'`), '0', 'rows older than 30 days are deleted on the next record');
  assert.equal(q(`select string_agg(trigger || ':' || dry_run, ',' order by id) from public.pfm_account_link_runs`), 'admin:true,admin:false');
  const order = JSON.parse(q(`set role service_role; select jsonb_agg(x.id)::text from public.pfm_account_link_runs_read(now() - interval '1 day') x;`));
  assert(order[0] > order[1], 'the read is newest first');
  console.log('  keeps 30 days; failed runs record; an unknown trigger is refused; newest first');

  // The key check: Vault is the only copy; the function says yes only for the exact value of a 32+ character secret.
  const keyOk = k => q(`set role service_role; select public.pfm_account_link_key_ok(${k === null ? 'null' : lit(k)})`);
  assert.equal(keyOk('k'.repeat(64)), 'f', 'no Vault secret yet: every key is refused');
  assert.equal(keyOk(null), 'f', 'a missing key is refused');
  psql(DB, `insert into vault.decrypted_secrets values ('pfm_account_link_key', 'short');`);
  assert.equal(keyOk('short'), 'f', 'a Vault secret under 32 characters refuses even its own value');
  psql(DB, `update vault.decrypted_secrets set decrypted_secret = repeat('k', 64) where name = 'pfm_account_link_key';`);
  assert.equal(keyOk('k'.repeat(64)), 't', 'the exact Vault value is accepted');
  for (const bad of ['k'.repeat(63), 'k'.repeat(65), 'K'.repeat(64), '', ' ' + 'k'.repeat(64)]) assert.equal(keyOk(bad), 'f', 'a near miss is refused');
  const src = RUNS.slice(RUNS.indexOf('function public.pfm_account_link_key_ok'), RUNS.indexOf('$fn$;', RUNS.indexOf('function public.pfm_account_link_key_ok')));
  assert(/sha256\(/.test(src) && !/p_key\s*=\s*\w*secret/i.test(src), 'the comparison is over sha256 digests, never the raw secret');
  psql(DB, `delete from vault.decrypted_secrets where name = 'pfm_account_link_key';`);
  console.log('  key check: Vault only; no secret, a short secret, a near miss and a missing key are refused; the exact value passes');

  // Schedule: refuses without the Vault secret; schedules one job with it.
  const sched = SCHEDULE.replace(/create extension[^;]*;/g, '');
  assert.equal(psql(DB, schedProbe).out, 'f', 'schedule read-back false before');
  r = psql(DB, sched, true);
  assert(!r.ok && /pfm_account_link_key is missing from Vault/.test(r.err), 'refuses while the Vault secret is missing: ' + r.err);
  assert.equal(q(`select count(*) from cron.job`), '0');
  psql(DB, `insert into vault.decrypted_secrets values ('pfm_account_link_key', 'short');`);
  r = psql(DB, sched, true);
  assert(!r.ok, 'refuses a secret shorter than 32 characters');
  psql(DB, `update vault.decrypted_secrets set decrypted_secret = repeat('k', 64) where name = 'pfm_account_link_key';`);
  psql(DB, sched);
  psql(DB, sched);
  assert.equal(q(`select count(*) || ':' || min(schedule) from cron.job where jobname = 'pfm-account-link-hourly'`), '1:41 * * * *', 'one hourly job');
  const cmd = q(`select command from cron.job where jobname = 'pfm-account-link-hourly'`);
  assert(/functions\/v1\/client-profile-write/.test(cmd) && /x-pfm-link-key/.test(cmd) && /pfm_account_link_key/.test(cmd) && /"action":\s*"pfm_accounts_sync"/.test(cmd) && !/k{64}/.test(cmd),
    'the job calls pfm_accounts_sync signed with the Vault secret, read at run time (never copied into the job)');
  assert.equal(psql(DB, schedProbe).out, 't', 'schedule read-back true after');
  console.log('  schedule: refuses without a 32+ character Vault secret; one hourly job signed at run time; applies twice');
  console.log('pfm-account-link-runs-postgres checks passed');
} catch (e) {
  failed = true;
  console.error('FAIL ' + (e && e.stack || e));
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
if (failed) process.exit(1);
