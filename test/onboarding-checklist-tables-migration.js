'use strict';
/*
 * migrations/2026-10-03-onboarding-checklist-tables.sql, read as bytes: the
 * access contract and the catalog the owner approved (admin only, every role
 * named in every revoke, nobody writes a table directly, the kickoff call is
 * out, one optional step). The behaviour itself is proved on a disposable
 * PostgreSQL by scripts/onboarding-checklist-tables-proof.sql (last line
 * ONBOARDING_CHECKLIST_TABLES_PROOF_OK).
 */
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-10-03-onboarding-checklist-tables.sql'), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
let passed = 0; let failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log('OK  ' + name); } else { failed++; console.log('FAIL ' + name); } }

const tables = ['onboarding_steps', 'client_onboarding_progress', 'client_onboarding_events', 'client_resources', 'client_sales_state', 'client_backfill_proposals'];
ok('one transaction', (code.match(/^begin;/gm) || []).length === 1 && (code.match(/^commit;/gm) || []).length === 1);
ok('every table has RLS on', tables.every((t) => new RegExp('alter table public\\.' + t + '\\s+enable row level security').test(code)));
ok('every table is revoked from all four roles', tables.every((t) => /revoke all on table[\s\S]*?from public, anon, authenticated, service_role;/.test(code) && code.includes('public.' + t)));
ok('both views and both functions are revoked from all four roles', /client_resource_status_v1,\s*public\.client_onboarding_summary_v1\s+from public, anon, authenticated, service_role/.test(code)
  && (code.match(/revoke all on function[^;]*from public, anon, authenticated, service_role;/g) || []).length === 3);
ok('the history sequence is revoked from all four roles', /revoke all on sequence public\.client_onboarding_events_id_seq from public, anon, authenticated, service_role/.test(code));
const grants = (code.match(/^grant [^;]*;/gm) || []).join('\n');
ok('service_role gets SELECT and EXECUTE only (never insert, update, delete, truncate)', /to service_role/.test(grants) && !/\b(insert|update|delete|truncate|all)\b/i.test(grants.replace(/execute on function/gi, '')));
ok('nothing is granted to anon, authenticated or public', !/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(grants));
ok('write functions are SECURITY DEFINER with a pinned search_path', (code.match(/security definer\s+set search_path = pg_catalog, public, pg_temp/g) || []).length === 2);
ok('set_step is admin only and version checked', /p_role is distinct from 'admin'/.test(code) && /client_onboarding_version_conflict/.test(code) && /client_onboarding_skip_needs_note/.test(code));
ok('history is append only (update, delete and truncate refused)', /before update or delete on public\.client_onboarding_events/.test(code) && /before truncate on public\.client_onboarding_events/.test(code));
ok('client data cascades with the profile row and references client_profiles only', (code.match(/references public\.client_profiles \(slug\) on delete cascade/g) || []).length === 4 && !/references public\.clients\b/.test(code));
const viewBody = code.slice(code.indexOf('create or replace view public.client_resource_status_v1'), code.indexOf('create or replace view public.client_onboarding_summary_v1'));
const stripped = viewBody.replace(/btrim\(coalesce\([a-z_.]+, ''\)\)/g, '').replace(/coalesce\(t\.data->>'thumbnails_canva_link', ''\)/g, '');
ok('views show presence only (no token, credential or client value is selected)', !/\b(review_token|email|instagram_handle|tiktok_handle|youtube_channel_id|slack_channel_id|creative_channel_id|postforme_account_id|competitors|keywords|content_description|password|doc_url)\b/.test(stripped));
ok('the status view reports the facts stored in client_resources (found only)', /drive_client_folder_found/.test(viewBody) && /hubspot_deal_found/.test(viewBody) && (viewBody.match(/r\.status = 'found'/g) || []).length === 6);
const summaryBody = code.slice(code.indexOf('create or replace view public.client_onboarding_summary_v1'), code.indexOf('create or replace function public.client_onboarding_ensure'));
ok('the summary crosses profiles with the catalog and counts a missing row as todo', /cross join public\.onboarding_steps/.test(summaryBody) && /left join public\.client_onboarding_progress/.test(summaryBody) && /coalesce\(g\.status, 'todo'\)/.test(summaryBody) && !/\bjoin public\.client_onboarding_progress/.test(summaryBody.replace('left join', '')));
const seed = code.slice(code.indexOf('insert into public.onboarding_steps'));
const steps = seed.match(/^\s+\('[a-z_]+',\s*\d+,/gm) || [];
ok('27 catalog steps', steps.length === 27);
ok('exactly two optional steps: the SyncView link and Post For Me', (seed.match(/,\s*false,\s*(true|false),\s*'/g) || []).length === 2 && /'syncview_link_sent',\s+\d+[^\n]*'owner',\s+false/.test(seed) && /'social_posting_ids',\s+\d+[^\n]*'owner',\s+false/.test(seed));
ok('the monthly check-in is not a step', !/monthly/i.test(seed));
ok('a required handle step exists and is detectable', /'social_handle_saved',\s+\d+,[^\n]*'owner',\s+true,\s+true/.test(seed));
ok('the kickoff call is not a step', !/kickoff_call|kickoff call/i.test(seed.replace('Kickoff message placeholders filled', '')));
ok('never deletes, truncates or drops', !/\bdelete\s+from\b/i.test(code) && !/\btruncate\s+table\b/i.test(code) && !/\bdrop\s+(table|view|function)\b/i.test(code));
ok('no long dash anywhere', !sql.includes('—'));
const proof = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'onboarding-checklist-tables-proof.sql'), 'utf8');
ok('the disposable-cluster proof ends with its marker', proof.includes('ONBOARDING_CHECKLIST_TABLES_PROOF_OK'));
console.log('\nonboarding-checklist-tables-migration: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
