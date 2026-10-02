'use strict';
/*
 * migrations/2026-10-03-native-client-test-provision.sql, read as bytes: the
 * test-only create path must stay clearly separate from the real provisioning
 * function (kind 'test', a deletable receipt, throwaway names only, no Slack,
 * no Sheet row), and the real function and its immutable receipt must not be
 * touched. The behaviour is proved on a disposable PostgreSQL by
 * scripts/native-client-test-provision-proof.sql (last line
 * NATIVE_CLIENT_TEST_PROVISION_PROOF_OK).
 */
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-10-03-native-client-test-provision.sql'), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const real = fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-09-09-native-client-provisioning.sql'), 'utf8');
let passed = 0; let failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log('OK  ' + name); } else { failed++; console.log('FAIL ' + name); } }

ok('one transaction', (code.match(/^begin;/gm) || []).length === 1 && (code.match(/^commit;/gm) || []).length === 1);
ok('creates kind test with its own source, never kind client', /values \(v_slug, v_display_name, true, 'test', 'syncview_native_test'/.test(code) && !/'client', 'syncview_native'/.test(code));
ok('does not touch the real function or its receipt table', !/production_native_client_provision\s*\(/.test(code.replace(/production_native_client_test_provision/g, '')) && !/production_native_client_provisions\b/.test(code) && !/alter table public\.production_native_client_provisions/.test(code));
ok('the test receipt is deletable (cascade, no immutability trigger)', /production_native_client_test_provisions[\s\S]*?on delete cascade/.test(code) && !/immutable/i.test(code));
ok('throwaway names only (slug and display name)', /\^zzthrowaway\[a-z0-9\]\{0,60\}\$/.test(code) && /\^ZZ THROWAWAY/.test(code));
ok('never touches Slack or the channel finalizer', !/slack/i.test(code.replace(/'slack', 'not_queued'/g, '')) && /'slack', 'not_queued'/.test(code));
ok('the Sheet outbox row Roster queues is removed in the same transaction', /perform public\.client_profile_service_write\(/.test(code) && /delete from public\.roster_sheet_outbox where client_slug = v_slug;/.test(code));
ok('the profile comes from Roster\'s function, never an insert into client_profiles', !/insert into public\.client_profiles/.test(code));
ok('the checklist rows are started', /perform public\.client_onboarding_ensure\(v_slug\)/.test(code));
ok('teardown verifies kind, source, name and receipt before deleting', /v_client\.kind is distinct from 'test'/.test(code) && /syncview_native_test/.test(code) && /display_name !~ '\^ZZ THROWAWAY'/.test(code) && /production_native_client_test_provisions where client_slug = v_slug\)/.test(code));
ok('teardown refuses a throwaway that gained work', ['calendar_posts', 'sample_reviews', 'filming_plans', 'templates', 'caption_prompts', 'client_credentials', 'batches', 'deliverables', 'legacy_intake_native_triage', 'production_notification_intents'].every((t) => code.includes('public.' + t)) && /native_client_test_teardown_blocked/.test(code));
ok('every DELETE has a WHERE (API connections reject a bare delete)', (code.match(/\bdelete\s+from\b[^;]*;/gi) || []).every((s) => /\bwhere\b/i.test(s)));
ok('both functions are SECURITY DEFINER with a pinned search_path', (code.match(/security definer\s+set search_path = pg_catalog, public, extensions, pg_temp/g) || []).length === 2);
ok('all four roles are revoked on the table and both functions, service_role gets EXECUTE only', /revoke all on table public\.production_native_client_test_provisions from public, anon, authenticated, service_role/.test(code) && (code.match(/revoke all on function[^;]*from public, anon, authenticated, service_role;/g) || []).length === 2 && !/grant\s+(select|insert|update|delete|all)/i.test(code) && (code.match(/grant execute on function[^;]*to service_role;/g) || []).length === 2);
ok('a replay refuses a throwaway that lost its token, a routing entry, its profile or its checklist (like the real function)', /native_client_test_provision_token_missing/.test(code) && /native_client_test_provision_routing_drift/.test(code) && /native_client_test_provision_profile_missing/.test(code) && /native_client_test_provision_checklist_incomplete/.test(code) && /v_client\.active is distinct from true/.test(code));
ok('the real function still creates kind client with an immutable receipt (the thing this path exists to avoid)', /'client', 'syncview_native'/.test(real) && /on delete restrict/i.test(real));
ok('no long dash anywhere', !sql.includes('—'));
const proof = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'native-client-test-provision-proof.sql'), 'utf8');
ok('the disposable-cluster proof ends with its marker', proof.includes('NATIVE_CLIENT_TEST_PROVISION_PROOF_OK'));
console.log('\nnative-client-test-provision-migration: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
