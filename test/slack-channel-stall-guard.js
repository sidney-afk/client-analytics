'use strict';
/*
 * migrations/2026-11-02-slack-channel-stall-guard.sql (OPEN_REPAIRS 673): a new client's Slack
 * channels can no longer stall silently. Read as bytes, then (when a disposable PostgreSQL is
 * available) run for real through scripts/slack-channel-stall-proof.sql, whose last line is
 * SLACK_CHANNEL_STALL_PROOF_OK.
 *
 * The PostgreSQL half runs in the isolated PG CI lane (F63_REQUIRE_POSTGRES=1). Locally, point PG*
 * at a throwaway server and set CLIENT_CREATE_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY. It creates and
 * drops its own database.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'migrations', '2026-11-02-slack-channel-stall-guard.sql');
let passed = 0; let failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log('OK  ' + name); } else { failed++; console.log('FAIL ' + name); } }

const exists = fs.existsSync(FILE);
ok('the migration exists', exists);
const sql = exists ? fs.readFileSync(FILE, 'utf8') : '';
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const bodies = code.replace(/\$fn\$[\s\S]*?\$fn\$/g, '');

ok('one transaction', (code.match(/^begin;/gm) || []).length === 1 && (code.match(/^commit;/gm) || []).length === 1);
ok('no table is created or altered, and no row is written by applying it', !/create table|alter table|insert into|update public\.|delete from/i.test(bodies));
ok('the email is written only through Roster\'s own profile write, never if one is already there', /client_profile_service_write\(p_slug, null, jsonb_build_object\('email', v_email\), '\{\}'::jsonb,\s+jsonb_build_object\('email', ''\)/.test(code) && !/update public\.client_profiles/i.test(code));
ok('a form row in either form table fills the profile', /after insert on public\.client_onboarding\b/.test(code) && /after insert on public\.ai_client_onboarding\b/.test(code));
ok('a profile created after its form is filled once its create has finished (deferred)', /create constraint trigger client_profiles_email_from_form\s+after insert on public\.client_profiles\s+deferrable initially deferred/.test(code));
ok('an email arriving nudges through the existing nudge only, never a new web call', /perform public\.slack_finalizer_nudge\(new\.slug\)/.test(code) && !/net\.http_post|https?:\/\//.test(code));
ok('only for real, active clients with no channel, never a test client', (code.match(/c\.kind = 'client' and c\.active/g) || []).length >= 2 && /c\.slug !~ '\^zzthrowaway'/.test(code) && /display_name !~\* '\^zz throwaway'/.test(code));
ok('never guesses between two clients with the same name', /array_length\(v_slugs, 1\), 0\) = 1/.test(code));
ok('every trigger body sits inside an exception handler', (code.match(/exception when others then/g) || []).length >= 4);
ok('the watcher view lists waiting time and what is still missing', /create or replace view public\.client_slack_channel_stalls_v1/.test(code) && /hours_waiting/.test(code) && /waiting_for/.test(code) && /interval '30 days'/.test(code));
ok('every function and the view revoked from all four roles, granted to nobody', (code.match(/revoke all on (function )?public\.[^;]+ from public, anon, authenticated, service_role;/g) || []).length === 7 && !/\bgrant\b/i.test(code));
ok('every function SECURITY DEFINER has a pinned search_path', (code.match(/security definer\s+set search_path = pg_catalog, public, pg_temp/g) || []).length === (code.match(/security definer/g) || []).length);
ok('no long dash anywhere', !sql.includes('—'));
const proofPath = path.join(ROOT, 'scripts', 'slack-channel-stall-proof.sql');
const proof = fs.existsSync(proofPath) ? fs.readFileSync(proofPath, 'utf8') : '';
ok('the disposable-cluster proof ends with its marker', proof.includes("'SLACK_CHANNEL_STALL_PROOF_OK'"));

if (process.env.F63_REQUIRE_POSTGRES === '1' || process.env.CLIENT_CREATE_TEST_CONFIRM === 'LOCAL_DISPOSABLE_ONLY') {
  const db = 'slack_stall_' + process.pid;
  const run = (args, input) => spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], { input, cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  run(['-d', 'postgres'], `drop database if exists ${db}; create database ${db};`);
  const r = run(['-d', db, '-f', 'scripts/slack-channel-stall-proof.sql']);
  run(['-d', 'postgres'], `drop database if exists ${db};`);
  const last = (r.stdout || '').trim().split('\n').pop();
  ok('the proof runs on a disposable PostgreSQL and ends SLACK_CHANNEL_STALL_PROOF_OK', r.status === 0 && last === 'SLACK_CHANNEL_STALL_PROOF_OK');
  if (r.status !== 0) console.log((r.stderr || '').split('\n').filter((l) => !/NOTICE/.test(l)).slice(-8).join('\n'));
} else {
  console.log('SKIP the PostgreSQL half: needs a disposable PostgreSQL (CLIENT_CREATE_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY)');
}
console.log('\nslack-channel-stall-guard: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
