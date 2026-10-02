'use strict';
/*
 * migrations/2026-10-04-client-hubspot-sync.sql and ...-schedule.sql, read as bytes: the access
 * contract (all four roles named in every revoke, service_role EXECUTE only), the single writer of
 * client_sales_state, the rules it enforces, and a timer that cannot run without its Vault secret
 * or write a secret into a file. The behaviour is proved on a disposable PostgreSQL by
 * scripts/client-hubspot-sync-proof.sql (last line CLIENT_HUBSPOT_SYNC_PROOF_OK).
 */
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8');
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const sync = strip(read('2026-10-04-client-hubspot-sync.sql'));
const sched = strip(read('2026-10-04-client-hubspot-sync-schedule.sql'));
let passed = 0; let failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log('OK  ' + name); } else { failed++; console.log('FAIL ' + name); } }

ok('one transaction each', (sync.match(/^begin;/gm) || []).length === 1 && (sync.match(/^commit;/gm) || []).length === 1 && (sched.match(/^begin;/gm) || []).length === 1 && (sched.match(/^commit;/gm) || []).length === 1);
ok('it refuses to run before the checklist tables exist', /to_regclass\('public\.client_sales_state'\) is null/.test(sync) && /2026-10-03-onboarding-checklist-tables\.sql first/.test(sync));
ok('both functions are SECURITY DEFINER with a pinned search_path', (sync.match(/security definer\s+set search_path = pg_catalog, public, pg_temp/g) || []).length === 2);
ok('both functions are revoked from all four roles, then service_role alone may execute',
  (sync.match(/revoke all on function[^;]*from public, anon, authenticated, service_role;/g) || []).length === 2
  && (sync.match(/grant execute on function[^;]* to service_role;/g) || []).length === 2
  && !/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(sync));
ok('it grants nothing on the tables (nobody writes client_sales_state directly)', !/grant\s+(select|insert|update|delete|all)[^;]*on\s+(table\s+)?public\./i.test(sync));
ok('imports stay unknown whatever HubSpot says', /if cur\.imported_unknown then contract_v := 'unknown'; payment_v := 'unknown'; end if;/.test(sync));
ok('only a unique match saves ids and states', /if p_match = 'matched' then[\s\S]*?else[\s\S]*?set hubspot_match = p_match, synced_at = now\(\), updated_at = now\(\)/.test(sync) && /client_sales_state_match_needs_ids/.test(sync));
ok('a history row is written only when something changed', /if changed then[\s\S]*?insert into public\.client_onboarding_events/.test(sync));
ok('the writer refuses bad match, bad state, no actor and a missing or archived client', ['client_sales_state_bad_match', 'client_sales_state_bad_state', 'client_sales_state_actor_required', 'client_sales_state_client_missing'].every((m) => sync.includes(m)));
ok('the target list is bounded, never-synced first, active clients of kind client (test kind only when named)',
  /least\(greatest\(coalesce\(p_limit, 6\), 1\), 50\)/.test(sync) && /s\.synced_at asc nulls first/.test(sync) && /c\.kind in \('client', 'test'\)/.test(sync) && /p_slug is null and c\.kind = 'client'/.test(sync));
ok('it names no HubSpot token, email or credential', !/(pat-|bearer|hubspot_read_token|review_token|client_credentials)/i.test(sync));
ok('the timer needs the Vault secret and the sync migration, and writes no secret value', /name = 'hubspot_sync_key' and length\(decrypted_secret\) >= 32/.test(sched) && /client_hubspot_sync_targets/.test(sched)
  && /vault\.decrypted_secrets where name = 'hubspot_sync_key'/.test(sched) && !/create_secret\s*\(\s*'[^<]/i.test(sched) && !/[A-Za-z0-9]{40,}/.test(sched));
ok('the timer is one job, daily, eight calls one minute apart', /cron\.schedule\('client-hubspot-sync-daily', '30-37 5 \* \* \*'/.test(sched) && (sched.match(/cron\.schedule\(/g) || []).length === 1 && /"action":"tick"/.test(sched));
ok('the timer calls our own function, not n8n', /uzltbbrjidmjwwfakwve\.supabase\.co\/functions\/v1\/client-hubspot-sync/.test(sched) && !/n8n/i.test(sched));
console.log(`client-hubspot-sync-migration: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
