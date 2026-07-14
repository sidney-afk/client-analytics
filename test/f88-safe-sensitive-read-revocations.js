'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const INDEX = read('index.html');
const MIGRATION = read('migrations/2026-07-14-f88-safe-sensitive-read-revocations.sql');
const WEEKLY = read('supabase/functions/smm-weekly-reports/index.ts');

function ok(value, message) {
  if (!value) {
    console.error('FAIL f88-safe-sensitive-read-revocations:', message);
    process.exit(1);
  }
}

const expected = [
  'filming_plans',
  'smm_weekly_reports',
  'social_media_managers',
  'thumbnail_media_revisions',
].sort();

const revoked = [...MIGRATION.matchAll(/revoke select on table public\.([a-z0-9_]+) from anon/gi)]
  .map(match => match[1].toLowerCase())
  .sort();

ok(JSON.stringify(revoked) === JSON.stringify(expected),
  `migration anon-SELECT allowlist changed: ${revoked.join(', ') || '(none)'}`);
ok((MIGRATION.match(/to_regclass\('public\.[a-z0-9_]+'\)/gi) || []).length === expected.length,
  'every safe-subset revoke must be guarded for repeatable/partial-schema execution');

for (const table of [
  'syncview_runtime_flags',
  'calendar_posts',
  'content_samples',
  'templates',
  'caption_prompts',
  'workload_issues',
  'team_members',
]) {
  ok(!new RegExp(`revoke select on table public\\.${table} from anon`, 'i').test(MIGRATION),
    `migration must not revoke the direct-use table ${table}`);
}

// The requested clients-table decision is evidence-based, not an assumption:
// Production still calls the generic PostgREST reader with the raw table name.
ok(/_prodRestRows\('clients',/.test(INDEX),
  'clients-table holdback requires the direct Production PostgREST dependency to remain visible');
ok(!/revoke select on table public\.clients from anon/i.test(MIGRATION),
  'clients anon SELECT must remain until Production has a scoped reader');

ok(/\.from\("social_media_managers"\)/.test(WEEKLY),
  'weekly-report Edge Function must still identify social_media_managers as an underlying table');
ok(/\.from\("smm_weekly_reports"\)/.test(WEEKLY),
  'weekly-report Edge Function must still identify smm_weekly_reports as an underlying table');

console.log('F88 safe sensitive-read revocation checks passed');
