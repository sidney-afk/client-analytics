'use strict';
// Static rules for the two NOT APPLIED migrations in
// docs/ops/ANON_READ_SCOPE_2026-09-26.md. Behaviour is proven on real
// PostgreSQL by scripts/anon-read-scope-rehearsal.js.
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let passed = 0;
function ok(c, m) { if (!c) { console.error('FAIL ' + m); process.exit(1); } passed++; console.log('  ok  ' + m); }
const code = s => s.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const p0 = read('migrations/2026-09-26-anon-write-grants-revoke.sql');
const p2 = read('migrations/2026-09-26-scoped-read-policies.sql');
const TABLES = ['calendar_posts', 'sample_reviews', 'deliverables', 'batches', 'deliverable_events'];
ok(/^-- APPLIED LIVE 2026-09-27/m.test(p0), 'phase 0 is marked applied live 2026-09-27');
ok(/^-- NOT APPLIED/m.test(p2), 'phase 2 is still marked NOT APPLIED (deferred by the owner)');
ok(/DO NOT APPLY until phase 1 has shipped/.test(p2), 'phase 2 says it must wait for the browser change');
ok(/revoke insert, update, delete, truncate, references, trigger/.test(p0) && /from public, anon, authenticated;/.test(p0), 'phase 0 revokes every write privilege from public, anon and authenticated');
ok(!/\bselect\b/i.test(code(p0).replace(/select 1 from|select oid from/gi, '')), 'phase 0 does not touch SELECT');
ok(!/service_role/.test(code(p0)), 'phase 0 does not touch service_role');
ok(TABLES.every(t => code(p0).includes('public.' + t)), 'phase 0 covers all five tables');
ok(/anon_write_revoke_policy_exists/.test(p0), 'phase 0 refuses when a write policy exists');
for (const t of TABLES) {
  ok(new RegExp(`drop policy if exists "anon read ${t}"`).test(p2), `phase 2 drops the open policy on ${t}`);
  ok(new RegExp(`create policy "session read ${t}" on public\\.${t} for select to authenticated`).test(p2), `phase 2 scopes ${t} to a session`);
}
ok(!/to anon|to public/i.test(code(p2).replace(/from anon/g, '')), 'phase 2 grants nothing to anon or public');
ok(/syncview_session_scope\(\) = 'staff'/.test(p2) && /syncview_session_scope\(\) = 'client' and client/.test(p2), 'staff read all; a client only its own slug');
ok(/revoke all on function public\.syncview_session_scope\(\) from public, anon, authenticated, service_role;/.test(p2), 'claim helpers: all four roles revoked first');
ok(/revoke select \(%I\) on public\.%I from anon/.test(p2), 'phase 2 removes the per-column anon grants too');
for (const t of ['calendar_post_events', 'sample_review_events']) {
  ok(new RegExp(`drop policy if exists "anon read ${t}"`).test(p2) && new RegExp(`create policy "session read ${t}"`).test(p2), `phase 2 scopes the ${t} ledger`);
}
ok(/revoke select on public\.calendar_post_events, public\.sample_review_events from anon;/.test(p2), 'phase 2 revokes anon on both ledgers');
for (const v of ['production_deliverables_browser_v1', 'workload_issues_native_v1', 'rename_propagation_status_v1']) ok(p2.includes(`'${v}'`), `phase 2 covers the ${v} view`);
ok(/v\.name \|\| '_session'/.test(p2) && !/alter view[^;]*rename/i.test(code(p2)), 'views get _session twins; originals are never renamed (server functions name them)');
ok(/revoke select on public\.%I from public, anon, authenticated', v\.name\)/.test(p2), 'the original views are closed to anon and authenticated');
ok(!/security_invoker/.test(code(p2)), 'views are not switched to security_invoker (it would expose hidden columns or break them)');
console.log(`anon-read-scope-migrations: ${passed} checks passed`);
