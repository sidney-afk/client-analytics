'use strict';
/*
 * migrations/2026-10-08-create-client.sql ("Create client", step 2.5), read as bytes, then (when a
 * disposable PostgreSQL is available) run for real through scripts/client-create-proof.sql, whose
 * last line is CLIENT_CREATE_PROOF_OK.
 *
 * The PostgreSQL half runs in the isolated PG17 CI lane (F63_REQUIRE_POSTGRES=1). Locally, point PG*
 * at a throwaway server and set CLIENT_CREATE_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY. It creates and
 * drops its own database.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(ROOT, 'migrations', '2026-10-08-create-client.sql'), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
let passed = 0; let failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log('OK  ' + name); } else { failed++; console.log('FAIL ' + name); } }

ok('one transaction', (code.match(/^begin;/gm) || []).length === 1 && (code.match(/^commit;/gm) || []).length === 1);
ok('no table is created and no data is changed by applying it (functions only)', !/create table|insert into public\.(?!client_onboarding_events)|alter table/i.test(code.replace(/\$fn\$[\s\S]*?\$fn\$/g, '')));
ok('the real path goes through the real provisioning function, Roster\'s profile write and its manager assignment', /production_native_client_provision\(v_request_id, v_slug, v_name\)/.test(code) && /client_profile_service_write\(v_slug, v_name/.test(code) && /smm_assign_client\(v_slug, v_name, v_mgr\.slug/.test(code));
ok('the throwaway path goes through the test-only function', /production_native_client_test_provision\(v_request_id, v_slug, v_name, v_actor\)/.test(code));
ok('never inserts into the roster, profile or token tables directly', !/insert into public\.(clients|client_profiles|client_access)\b/.test(code));
ok('a throwaway never reaches the Sheet outbox', /if v_mode = 'test' then\s+delete from public\.roster_sheet_outbox where client_slug = v_slug;/.test(code));
ok('never touches Slack or the channel finalizer', !/slack/i.test(code.replace(/'slack', 'not_queued'/g, '').replace(/v_mgr\.name, ''/g, '')) && /'slack', 'not_queued'/.test(code));
ok('the throwaway and real names cannot cross paths', /client_create_test_needs_throwaway_name/.test(code) && /client_create_throwaway_name_needs_test_mode/.test(code));
ok('a reused name, a name on a manager list and a reused slug are refused', /client_create_name_taken/.test(code) && /client_create_name_on_a_manager_list/.test(code) && /client_create_slug_taken/.test(code));
ok('only active managers can be picked', /from public\.social_media_managers where slug = v_mgr_slug and active/.test(code));
ok('every tick writes one checklist history row', /insert into public\.client_onboarding_events[\s\S]*?'create_client'/.test(code));
ok('teardown only for verified throwaways, then the existing teardown', /client_create_teardown_not_throwaway/.test(code) && /production_native_client_test_teardown\(v_slug, p_actor\)/.test(code));
ok('every DELETE has a WHERE', (code.match(/\bdelete\s+from\b[^;]*;/gi) || []).every((s) => /\bwhere\b/i.test(s)));
ok('both functions are SECURITY DEFINER with a pinned search_path', (code.match(/security definer\s+set search_path = pg_catalog, public, extensions, pg_temp/g) || []).length === 2);
ok('all four roles revoked on both functions, service_role gets EXECUTE only', (code.match(/revoke all on function[^;]*from public, anon, authenticated, service_role;/g) || []).length === 2 && (code.match(/grant execute on function[^;]*to service_role;/g) || []).length === 2 && !/grant\s+(select|insert|update|delete|all)/i.test(code));
ok('no long dash anywhere', !sql.includes('—'));

// migrations/2026-10-09-create-client-slack-nudge.sql: the Slack nudge, on top of the live file (never an edit of it).
const nudgeSql = fs.readFileSync(path.join(ROOT, 'migrations', '2026-10-09-create-client-slack-nudge.sql'), 'utf8');
const nudge = nudgeSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const fnBody = (text) => { const a = text.indexOf('create or replace function public.client_create_native('); return text.slice(a, text.indexOf('$fn$;', a)); };
ok('nudge file: one transaction', (nudge.match(/^begin;/gm) || []).length === 1 && (nudge.match(/^commit;/gm) || []).length === 1);
ok('nudge file: client_create_native differs from the live one only by the email rule and the nudge', (() => {
  const live = fnBody(code).split('\n'); const next = fnBody(nudge).split('\n');
  const added = next.filter((l) => !live.includes(l)); const removed = live.filter((l) => !next.includes(l));
  return added.length === 2 && removed.length === 1 && /client_create_email_required/.test(added.join('\n')) && /slack_finalizer_nudge\(v_slug\)/.test(added.join('\n')) && /'slack', 'not_queued'\);/.test(removed[0]);
})());
ok('nudge file: only a call to the existing finalizer webhook, for real active clients without a channel, never a test client', /net\.http_post\(\s*url := 'https:\/\/synchrosocial\.app\.n8n\.cloud\/webhook\/slack-creative-finalize'/.test(nudge) && /c\.kind = 'client' and c\.active/.test(nudge) && /c\.slug !~ '\^zzthrowaway'/.test(nudge) && /display_name !~\* '\^zz throwaway'/.test(nudge) && (nudge.match(/net\.http_post/g) || []).length === 1);
ok('nudge file: the whole nudge body, lookup included, sits inside one exception handler', (() => {
  const a = nudge.indexOf('create or replace function public.slack_finalizer_nudge'); const body = nudge.slice(a, nudge.indexOf('$fn$;', a));
  const begin = body.indexOf('\nbegin\n'); const sel = body.indexOf('select pr.display_name'); const exc = body.indexOf('exception when others then');
  return begin > 0 && sel > begin && exc > body.indexOf('net.http_post') && (body.match(/\bbegin\b/g) || []).length === 1;
})());
ok('nudge file: a filming plan link save nudges through a trigger', /after insert or update of doc_url, doc_id on public\.filming_plans/.test(nudge));
ok('nudge file: nobody may call the nudge directly; create stays service_role only', /revoke all on function public\.slack_finalizer_nudge\(text\) from public, anon, authenticated, service_role;/.test(nudge) && /revoke all on function public\.filming_plans_slack_finalizer_nudge\(\) from public, anon, authenticated, service_role;/.test(nudge) && !/grant execute on function public\.(slack_finalizer_nudge|filming_plans_slack_finalizer_nudge)/.test(nudge) && /grant execute on function public\.client_create_native\(text, text, text, text, text, text, text\) to service_role;/.test(nudge) && !/grant\s+(select|insert|update|delete|all)/i.test(nudge));
ok('nudge file: no table is created or altered', !/create table|alter table/i.test(nudge));
ok('nudge file: no long dash anywhere', !nudgeSql.includes('—'));
const proof = fs.readFileSync(path.join(ROOT, 'scripts', 'client-create-proof.sql'), 'utf8');
ok('the disposable-cluster proof ends with its marker', proof.includes("'CLIENT_CREATE_PROOF_OK'"));

if (process.env.F63_REQUIRE_POSTGRES === '1' || process.env.CLIENT_CREATE_TEST_CONFIRM === 'LOCAL_DISPOSABLE_ONLY') {
  const db = 'client_create_' + process.pid;
  const run = (args, input) => spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], { input, cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  run(['-d', 'postgres'], `drop database if exists ${db}; create database ${db};`);
  const r = run(['-d', db, '-f', 'scripts/client-create-proof.sql']);
  run(['-d', 'postgres'], `drop database if exists ${db};`);
  const last = (r.stdout || '').trim().split('\n').pop();
  ok('the proof runs on a disposable PostgreSQL and ends CLIENT_CREATE_PROOF_OK', r.status === 0 && last === 'CLIENT_CREATE_PROOF_OK');
  if (r.status !== 0) console.log((r.stderr || '').split('\n').filter((l) => !/NOTICE/.test(l)).slice(-8).join('\n'));
} else {
  console.log('SKIP the PostgreSQL half: needs a disposable PostgreSQL (CLIENT_CREATE_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY)');
}
console.log('\nclient-create-migration: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
