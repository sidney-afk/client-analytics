'use strict';
// Real PostgreSQL, synthetic data only, for the two NOT APPLIED migrations in
// docs/ops/ANON_READ_SCOPE_2026-09-26.md. Builds the five tables with the live
// read policies and grants (as measured 2026-09-26), then applies phase 0,
// phase 2 and both rollbacks, checking what anon, a staff session and a
// client session can read at each step. Explicit local opt-in:
//   ANON_SCOPE_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY node scripts/anon-read-scope-rehearsal.js
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.env.ANON_SCOPE_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') throw new Error('local_disposable_confirmation_required');
const host = process.env.ANON_SCOPE_PGHOST || '127.0.0.1';
if (!['127.0.0.1', '::1'].includes(host)) throw new Error('only_literal_loopback_allowed');
const port = String(process.env.ANON_SCOPE_PGPORT || '55440');
const ROOT = path.resolve(__dirname, '..');
const mig = f => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8');
const dbName = 'anon_scope_' + process.pid;
function raw(sql, db = dbName) {
  return spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', host, '-p', port, '-U', 'postgres', '-d', db], { input: sql, encoding: 'utf8' });
}
function q(sql, db) { const r = raw(sql, db); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); }

const FIXTURE = `
do $r$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $r$;
create table public.calendar_posts (client text, id text, name text, primary key (client, id));
create table public.sample_reviews (client text, id text, name text, primary key (client, id));
create table public.deliverables (id text primary key, identifier text, batch_id text, client_slug text, team text, kind text, title text, status text, status_at text, assignee_id text, due_date text, priority text, origin text, card_id text, sort_key text, sync_state text, created_by text, created_at text, updated_at text, linear_issue_uuid text, linear_identifier text, linear_issue_url text, linear_aliases text, artifact_revision text, brief text, file_url text, comments text, linear_raw text);
create table public.batches (id text primary key, client_slug text, team text, name text, description text, color text, status text, sort_key text, created_by text, created_at text, updated_at text, linear_parent_ids text, purpose text, filming_doc_url text, footage_folder_url text, delivery_folder_url text, comments text);
create table public.deliverable_events (id bigint primary key, client_slug text, action text, event_key text, payload text);
alter table public.calendar_posts enable row level security;
alter table public.sample_reviews enable row level security;
alter table public.deliverables enable row level security;
alter table public.batches enable row level security;
alter table public.deliverable_events enable row level security;
grant all on public.calendar_posts, public.sample_reviews, public.deliverable_events to anon, authenticated, service_role;
grant insert, update, delete, truncate, references, trigger on public.deliverables, public.batches to anon, authenticated;
grant all on public.deliverables, public.batches to service_role;
grant select (id, identifier, batch_id, client_slug, team, kind, title, status, status_at, assignee_id, due_date, priority, origin, card_id, sort_key, sync_state, created_by, created_at, updated_at, linear_issue_uuid, linear_identifier, linear_issue_url, linear_aliases, artifact_revision) on public.deliverables to anon, authenticated;
grant select (id, client_slug, team, name, description, color, status, sort_key, created_by, created_at, updated_at, linear_parent_ids, purpose) on public.batches to anon, authenticated;
create policy "anon read calendar_posts" on public.calendar_posts for select to anon using (true);
create policy "anon read sample_reviews" on public.sample_reviews for select to anon using (true);
create policy "anon read deliverables" on public.deliverables for select to authenticated, anon using (true);
create policy "anon read batches" on public.batches for select to authenticated, anon using (true);
create policy "anon read deliverable_events" on public.deliverable_events for select to authenticated, anon using (true);
create policy "protect production comment event bodies" on public.deliverable_events as restrictive for select to authenticated, anon
  using ((event_key is null) or (action <> all (array['comment_add'])));
create table public.calendar_post_events (id bigint primary key, client text, post_id text);
create table public.sample_review_events (id bigint primary key, client text, sample_id text);
alter table public.calendar_post_events enable row level security;
alter table public.sample_review_events enable row level security;
grant all on public.calendar_post_events, public.sample_review_events to anon, authenticated, service_role;
create policy "anon read calendar_post_events" on public.calendar_post_events for select to authenticated, anon using (true);
create policy "anon read sample_review_events" on public.sample_review_events for select to anon using (true);
insert into public.calendar_post_events values (1,'clienta','1'),(2,'clientb','2');
insert into public.sample_review_events values (1,'clienta','1'),(2,'clientb','2');
create table public.rename_propagation_outbox (id bigint primary key, client text, source_id text, state text);
alter table public.rename_propagation_outbox enable row level security;
insert into public.rename_propagation_outbox values (1,'clienta','1','done'),(2,'clientb','2','done');
-- Owner-rights views as live: one reads a column authenticated may not read.
create view public.production_deliverables_browser_v1 with (security_barrier = true) as
  select id, client_slug, title, linear_raw is not null as has_raw from public.deliverables;
create view public.workload_issues_native_v1 with (security_barrier = true) as
  select d.id, d.client_slug, b.name as batch_name from public.deliverables d left join public.batches b on b.client_slug = d.client_slug;
create view public.rename_propagation_status_v1 as select id, client, source_id, state from public.rename_propagation_outbox;
grant select on public.production_deliverables_browser_v1, public.workload_issues_native_v1, public.rename_propagation_status_v1 to anon, authenticated, service_role;
-- A server-side function that names a view, like the Workload snapshot.
create function public.workload_native_snapshot_v1() returns bigint language sql security definer set search_path = public as
  'select count(*) from public.workload_issues_native_v1';
revoke all on function public.workload_native_snapshot_v1() from public, anon, authenticated;
grant execute on function public.workload_native_snapshot_v1() to service_role;
grant usage on schema public to anon, authenticated, service_role;
insert into public.calendar_posts values ('clienta','1','a'),('clientb','2','b');
insert into public.sample_reviews values ('clienta','1','a'),('clientb','2','b');
insert into public.deliverables (id, client_slug, title, brief) values ('d1','clienta','t','brief'),('d2','clientb','t','brief');
insert into public.batches (id, client_slug, name) values ('b1','clienta','n'),('b2','clientb','n');
insert into public.deliverable_events values (1,'clienta','status_change',null,'p'),(2,'clientb','status_change',null,'p'),(3,'clienta','comment_add','k','secret');
`;
const TABLES = [['calendar_posts', 'client'], ['sample_reviews', 'client'], ['deliverables', 'client_slug'], ['batches', 'client_slug'], ['deliverable_events', 'client_slug']];
const LEDGERS = [['calendar_post_events', 'client'], ['sample_review_events', 'client']];
const VIEWS = [['production_deliverables_browser_v1', 'client_slug'], ['workload_issues_native_v1', 'client_slug'], ['rename_propagation_status_v1', 'client']];
const as = (role, claims, sql) => raw(`begin; select set_config('request.jwt.claims', '${JSON.stringify(claims || {})}', true); set local role ${role}; ${sql}; commit;`);
const count = (role, claims, t) => { const r = as(role, claims, `select count(*) from public.${t}`); return r.status === 0 ? Number(r.stdout.trim().split('\n').pop()) : 'denied'; };
const distinct = (role, claims, t, col) => as(role, claims, `select coalesce(string_agg(distinct ${col}, ','), '') from public.${t}`).stdout.trim().split('\n').pop();

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
q(`create database ${dbName}`, 'postgres');
let ok = false;
try {
  q(FIXTURE);
  check('BEFORE: the bare anon key reads every client\'s rows', () => {
    for (const [t] of TABLES.filter(([t]) => t !== 'deliverable_events')) assert.equal(count('anon', {}, t), 2, t);
    assert.equal(count('anon', {}, 'deliverable_events'), 2, 'comment event body stays hidden');
  });
  check('BEFORE: anon reads both card event ledgers and all three owner-rights views across clients', () => {
    for (const [t] of LEDGERS) assert.equal(count('anon', {}, t), 2, t);
    for (const [v, col] of VIEWS) assert.equal(distinct('anon', {}, v, col), 'clienta,clientb', v);
  });
  check('BEFORE: anon can TRUNCATE (row security does not apply to TRUNCATE)', () => {
    const r = raw('begin; set local role anon; truncate public.calendar_posts; rollback;');
    assert.equal(r.status, 0);
  });

  q(mig('2026-09-26-anon-write-grants-revoke.sql'));
  check('phase 0: anon and authenticated lose every write privilege, reads unchanged', () => {
    for (const [t] of TABLES) {
      assert.equal(q(`select has_table_privilege('anon','public.${t}','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`), 'f', t);
      assert.equal(q(`select has_table_privilege('authenticated','public.${t}','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`), 'f', t);
      assert.equal(q(`select has_table_privilege('service_role','public.${t}','INSERT,UPDATE,DELETE')`), 't', t);
    }
    assert.notEqual(raw('begin; set local role anon; truncate public.calendar_posts; rollback;').status, 0);
    assert.equal(count('anon', {}, 'calendar_posts'), 2);
  });
  check('phase 0 refuses when a write policy for anon exists', () => {
    const db2 = dbName + '_w';
    q(`create database ${db2}`, 'postgres');
    try {
      q(FIXTURE + `create policy w on public.batches for insert to anon with check (true);`, db2);
      const r = raw(mig('2026-09-26-anon-write-grants-revoke.sql'), db2);
      assert.notEqual(r.status, 0); assert.match(r.stderr, /anon_write_revoke_policy_exists/);
    } finally { q(`drop database ${db2}`, 'postgres'); }
  });

  q(mig('2026-09-26-scoped-read-policies.sql'));
  const staff = { role: 'authenticated', svc_scope: 'staff' };
  const clientA = { role: 'authenticated', svc_scope: 'client', svc_client: 'clienta' };
  check('phase 2: the bare anon key reads nothing', () => {
    for (const [t] of TABLES) assert.ok(count('anon', {}, t) === 'denied' || count('anon', {}, t) === 0, t);
    assert.equal(q("select has_column_privilege('anon','public.deliverables','title','SELECT')"), 'f');
  });
  check('phase 2: a staff session reads every client\'s rows', () => {
    for (const [t, col] of TABLES) assert.equal(distinct('authenticated', staff, t, col), 'clienta,clientb', t);
  });
  check('phase 2: a client session reads only its own client\'s rows', () => {
    for (const [t, col] of TABLES) assert.equal(distinct('authenticated', clientA, t, col), 'clienta', t);
  });
  check('phase 2: authenticated without a scope claim, or with a forged scope, reads nothing', () => {
    for (const [t] of TABLES) {
      assert.equal(count('authenticated', { role: 'authenticated' }, t), 0, t);
      assert.equal(count('authenticated', { role: 'authenticated', svc_scope: 'admin' }, t), 0, t);
      assert.equal(count('authenticated', { role: 'authenticated', svc_scope: 'client' }, t), 0, t);
    }
  });
  check('phase 2: hidden columns and comment event bodies stay hidden', () => {
    assert.notEqual(as('authenticated', staff, 'select brief from public.deliverables').status, 0);
    assert.equal(as('authenticated', staff, "select count(*) from public.deliverable_events where action='comment_add'").stdout.trim().split('\n').pop(), '0');
  });

  check('phase 2: both card event ledgers are scoped like the cards', () => {
    for (const [t, col] of LEDGERS) {
      assert.ok(count('anon', {}, t) === 'denied' || count('anon', {}, t) === 0, t);
      assert.equal(distinct('authenticated', staff, t, col), 'clienta,clientb', t);
      assert.equal(distinct('authenticated', clientA, t, col), 'clienta', t);
    }
  });
  check('phase 2: the original views are closed to anon and authenticated', () => {
    for (const [v] of VIEWS) {
      assert.equal(count('anon', {}, v), 'denied', v);
      assert.equal(count('authenticated', staff, v), 'denied', v);
    }
  });
  check('phase 2: each _session view gives staff every row and a client only its own', () => {
    for (const [v, col] of VIEWS) {
      assert.equal(count('anon', {}, v + '_session'), 'denied', v);
      assert.equal(distinct('authenticated', staff, v + '_session', col), 'clienta,clientb', v);
      assert.equal(distinct('authenticated', clientA, v + '_session', col), 'clienta', v);
      assert.equal(count('authenticated', { role: 'authenticated' }, v + '_session'), 0, v);
    }
    // The view still computes from a column authenticated cannot read directly.
    assert.equal(as('authenticated', staff, "select count(*) from public.production_deliverables_browser_v1_session where has_raw").stdout.trim().split('\n').pop(), '0');
  });
  check('phase 2: server-side functions that name the original views are unaffected', () => {
    assert.equal(q("begin; set local role service_role; select public.workload_native_snapshot_v1(); commit;").split('\n').pop(), '2');
  });

  q(mig('2026-09-26-scoped-read-policies.ROLLBACK.sql'));
  check('phase 2 rollback restores the prior reads exactly', () => {
    for (const [t] of TABLES.filter(([t]) => t !== 'deliverable_events')) assert.equal(count('anon', {}, t), 2, t);
    assert.equal(q("select has_column_privilege('anon','public.deliverables','title','SELECT')"), 't');
    assert.equal(q("select has_column_privilege('anon','public.deliverables','brief','SELECT')"), 'f');
    for (const [t] of LEDGERS) assert.equal(count('anon', {}, t), 2, t);
    for (const [v, col] of VIEWS) {
      assert.equal(distinct('anon', {}, v, col), 'clienta,clientb', v);
      assert.equal(q(`select count(*) from pg_class where relname = '${v}_session'`), '0');
    }
  });
  q(mig('2026-09-26-anon-write-grants-revoke.ROLLBACK.sql'));
  check('phase 0 rollback restores the default write grants', () => {
    assert.equal(q("select has_table_privilege('anon','public.calendar_posts','TRUNCATE')"), 't');
  });
  console.log(JSON.stringify({ status: 'PASS', passed: checks.length, checks, scope: 'synthetic_local_SQL_only_not_applied_to_any_shared_database' }));
  ok = true;
} finally {
  if (ok) q(`drop database ${dbName}`, 'postgres'); else console.error('FAILED rehearsal database retained: ' + dbName);
}
