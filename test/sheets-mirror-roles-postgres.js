'use strict';
/*
 * sheets-mirror-roles-postgres.js — migrations/2026-09-25-sheets-mirror-phase1.sql
 * and 2026-09-25-client-profile-edits.sql (the Clients tab edit history and
 * its edit function) on a disposable PostgreSQL, before anyone applies them live.
 *
 * "We revoked it" is not the same claim as "that role cannot do it" (CLAUDE.md),
 * so this MEASURES: for every new table and each of the four roles (a plain
 * login role standing in for PUBLIC, anon, authenticated, service_role) it
 * attempts SELECT, INSERT, UPDATE, DELETE and TRUNCATE for real and records
 * what the server allowed. It starts from Supabase's default privileges (every
 * new object granted to anon, authenticated and service_role), so a revoke
 * that names too few roles fails here.
 *
 * Runs in the isolated PG17 CI lane (`sheets-mirror-roles`). Locally, point it
 * at any disposable server with the usual PG* variables and
 * SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY. It creates and drops its
 * own database; it never touches another one.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-09-25-sheets-mirror-phase1.sql'), 'utf8');
const EDITS_MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-09-25-client-profile-edits.sql'), 'utf8');
const EDIT_FN = 'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)';
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.SHEETS_MIRROR_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  throw Error('DISPOSABLE_REQUIRED: run in the isolated PG17 lane, or set SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY with PG* pointing at a throwaway server');
}
const DB = 'sheets_mirror_roles_' + process.pid;

function psql(database, text, allowFail = false) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input: text, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const TABLES = {
  client_profiles: { upd: 'display_name = display_name', cols: "slug, display_name", vals: "'probe' || :n, 'Probe'" },
  analytics_metrics: { upd: 'client_name = client_name', cols: "row_hash, row_occurrence, client_slug, client_name, date, source, run_id",
    vals: "encode(sha256(convert_to(:n, 'UTF8')), 'hex'), 1, 'probe', 'Probe', date '2026-09-01', 'n8n', 'r'" },
  analytics_top_videos: { upd: 'client_name = client_name', cols: "row_hash, row_occurrence, client_slug, client_name, scraped_date, source, run_id",
    vals: "encode(sha256(convert_to(:n, 'UTF8')), 'hex'), 1, 'probe', 'Probe', date '2026-09-01', 'n8n', 'r'" },
  analytics_market_research_briefs: { upd: 'client_name = client_name', cols: "id, client_slug, client_name, row_hash, source, run_id",
    vals: "'probe' || :n, 'probe', 'Probe', repeat('c', 64), 'n8n', 'r'" },
  analytics_content_summaries: { upd: 'client_name = client_name', cols: "row_hash, row_occurrence, client_slug, client_name, source, run_id",
    vals: "encode(sha256(convert_to(:n, 'UTF8')), 'hex'), 1, 'probe', 'Probe', 'n8n', 'r'" },
  client_profile_edits: { upd: 'field = field', cols: "slug, field, edited_by, edited_role", vals: "'probeseed', 'email', 'QA', 'admin'" },
  analytics_ingest_receipts: { upd: 'complete = complete', cols: "dataset, source, run_id, rows_received, rows_written, complete",
    vals: "'metrics', 'n8n', 'r' || :n, 1, 1, true" },
};
// PUBLIC is not a role you can SET; a fresh login role with no grants of its
// own sees exactly what PUBLIC holds, so it stands in for it.
const ROLES = ['public_probe', 'anon', 'authenticated', 'service_role'];
const EXPECT = {
  public_probe: { select: false, insert: false, update: false, delete: false, truncate: false },
  anon: { select: false, insert: false, update: false, delete: false, truncate: false },
  authenticated: { select: false, insert: false, update: false, delete: false, truncate: false },
  service_role: { select: true, insert: true, update: true, delete: false, truncate: false },
};
// The edit history is append-only, even for service_role.
const EXPECT_FOR = (role, table) => (table === 'client_profile_edits' && role === 'service_role')
  ? { select: true, insert: true, update: false, delete: false, truncate: false }
  : EXPECT[role];

let failed = false;
try {
  psql('postgres', `drop database if exists ${DB}; create database ${DB};`);
  // Supabase's roles and default privileges, as a fresh project has them.
  psql(DB, `
    do $r$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'public_probe') then create role public_probe nologin; end if;
    end $r$;
    grant usage on schema public to anon, authenticated, service_role, public_probe;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table public.syncview_runtime_flags (key text primary key, value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(), updated_by text);
  `);
  // Apply twice: the file promises to be idempotent.
  psql(DB, MIGRATION);
  psql(DB, MIGRATION);
  psql(DB, EDITS_MIGRATION);
  psql(DB, EDITS_MIGRATION);
  psql(DB, `insert into public.client_profiles (slug, display_name) values ('probeseed', 'Probe Seed') on conflict do nothing;`);

  const results = {};
  let n = 0;
  for (const role of ROLES) {
    results[role] = {};
    for (const [table, spec] of Object.entries(TABLES)) {
      const attempt = (stmt) => {
        n++;
        const body = stmt.replace(/:n/g, "'k" + n + "'");
        return psql(DB, `begin; set local role ${role}; ${body}; rollback;`, true).ok;
      };
      // Seed one row as the owner so UPDATE/DELETE have something to hit.
      n++;
      psql(DB, `insert into public.${table} (${spec.cols}) values (${spec.vals.replace(/:n/g, "'s" + n + "'")}) on conflict do nothing;`);
      results[role][table] = {
        select: attempt(`select count(*) from public.${table}`),
        insert: attempt(`insert into public.${table} (${spec.cols}) values (${spec.vals})`),
        update: attempt(`update public.${table} set ${spec.upd}`),
        delete: attempt(`delete from public.${table}`),
        truncate: attempt(`truncate public.${table}`),
      };
    }
  }

  // Report the measurement, then check it.
  for (const role of ROLES) {
    for (const table of Object.keys(TABLES)) {
      const got = results[role][table];
      const line = Object.entries(got).map(([k, v]) => k + '=' + (v ? 'ALLOWED' : 'denied')).join(' ');
      console.log(`  ${role.padEnd(14)} ${table.padEnd(34)} ${line}`);
      assert.deepEqual(got, EXPECT_FOR(role, table), `${role} on ${table} must be exactly ${JSON.stringify(EXPECT_FOR(role, table))}`);
    }
  }

  // Sequences: no role may use them directly; identity inserts still worked above.
  const seqs = psql(DB, `select string_agg(format('%s:%s:%s', c.relname, r.rolname,
      has_sequence_privilege(r.rolname, c.oid, 'USAGE,SELECT,UPDATE')), ',' order by c.relname, r.rolname)
    from pg_class c cross join (values ('anon'),('authenticated'),('service_role'),('public_probe')) r(rolname)
    where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace;`).out;
  assert(seqs.length > 0, 'identity sequences exist');
  for (const entry of seqs.split(',')) assert(entry.endsWith(':f'), 'no role holds a sequence privilege: ' + entry);
  console.log('  sequences: no role holds USAGE, SELECT or UPDATE');

  // RLS on, no policies, flags default-off.
  const rls = psql(DB, `select bool_and(relrowsecurity), (select count(*) from pg_policy p join pg_class c2 on c2.oid = p.polrelid
      where c2.relname in (${Object.keys(TABLES).map(t => `'${t}'`).join(',')}))
    from pg_class where relnamespace = 'public'::regnamespace and relname in (${Object.keys(TABLES).map(t => `'${t}'`).join(',')});`).out;
  assert.equal(rls, 't|0', 'RLS enabled on every table, with no policies');
  const flags = psql(DB, `select string_agg(key || '=' || value::text, ';' order by key) from public.syncview_runtime_flags;`).out;
  assert.equal(flags, 'analytics_mirror_read_enabled={"enabled": false};analytics_mirror_write_enabled={"enabled": false};client_profiles_authority={"source": "sheet"}');
  console.log('  RLS on with no policies; flags seeded default-off');

  // The row-identity upsert the write function relies on is accepted as service_role.
  const up = psql(DB, `begin; set local role service_role;
    insert into public.analytics_top_videos (row_hash,row_occurrence,client_slug,client_name,scraped_date,source,run_id)
      values (repeat('e',64),1,'probe','Probe',date '2026-09-02','n8n','r1')
      on conflict (row_hash,row_occurrence) do update set run_id = excluded.run_id;
    insert into public.analytics_top_videos (row_hash,row_occurrence,client_slug,client_name,scraped_date,source,run_id)
      values (repeat('e',64),1,'probe','Probe',date '2026-09-02','n8n','r2')
      on conflict (row_hash,row_occurrence) do update set run_id = excluded.run_id;
    select count(*) || ':' || max(run_id) from public.analytics_top_videos where row_hash = repeat('e',64);
    rollback;`).out;
  assert.equal(up.split('\n').pop(), '1:r2', 'a repeated row upserts instead of duplicating');
  console.log('  a repeated row upserts in place (no double-count)');
  // The edit function: service_role only may run it.
  for (const role of ROLES) {
    const can = psql(DB, `select has_function_privilege('${role}', '${EDIT_FN}', 'EXECUTE');`).out;
    assert.equal(can, role === 'service_role' ? 't' : 'f', role + ' EXECUTE on the edit function');
  }
  console.log('  client_profile_admin_edit: EXECUTE for service_role only');

  // What it does, as service_role: version check, one history row per changed
  // field, source='syncview', and refusals for unknown fields and archived rows.
  psql(DB, `insert into public.client_profiles (slug, display_name, email, keywords, updated_at)
    values ('probeedit', 'Probe Edit', 'old@example.invalid', 'k1', timestamptz '2026-09-25 10:00:00.123456+00');`);
  const call = (changes, expected) => psql(DB, `begin; set local role service_role;
    select public.client_profile_admin_edit('probeedit', '${JSON.stringify(changes)}'::jsonb, timestamptz '${expected}',
      'QA Admin', 'admin', 'm1', 7, 'req1')::text; commit;`, true);
  const stale = call({ email: 'new@example.invalid' }, '2026-09-25 10:00:00+00');
  assert(!stale.ok && /client_profile_version_conflict/.test(stale.err), 'a stale version is refused');
  const bad = call({ display_name: 'x' }, '2026-09-25 10:00:00.123456+00');
  assert(!bad.ok && /field_not_editable/.test(bad.err), 'a non-editable field is refused');
  const good = call({ email: 'new@example.invalid', keywords: 'k1' }, '2026-09-25 10:00:00.123456+00');
  assert(good.ok, 'the edit applies: ' + good.err);
  assert.equal(JSON.parse(good.out.split('\n').pop()).changed, 1, 'only the field that changed counts');
  const after = psql(DB, `select email || '|' || source || '|' || updated_by from public.client_profiles where slug = 'probeedit';`).out;
  assert.equal(after, 'new@example.invalid|syncview|QA Admin', 'row updated with source syncview and the editor');
  const hist = psql(DB, `select string_agg(field || ':' || coalesce(old_value,'') || '>' || coalesce(new_value,'') || ':' || edited_by || ':' || sheet_row, ',')
    from public.client_profile_edits where slug = 'probeedit';`).out;
  assert.equal(hist, 'email:old@example.invalid>new@example.invalid:QA Admin:7', 'one history row for the one changed field');
  psql(DB, `update public.client_profiles set archived_at = now() where slug = 'probeedit';`);
  const arch = psql(DB, `begin; set local role service_role; select public.client_profile_admin_edit('probeedit', '{"email":"z"}'::jsonb,
    (select updated_at from public.client_profiles where slug = 'probeedit'), 'QA Admin', 'admin', 'm1', 7, 'r'); commit;`, true);
  assert(!arch.ok && /client_profile_archived/.test(arch.err), 'an archived client is refused');
  console.log('  client_profile_admin_edit: version-checked, history per changed field, source syncview');
  console.log('SHEETS_MIRROR_ROLES_OK');
} catch (e) {
  failed = true;
  console.error(e && e.stack || e);
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
if (failed) process.exit(1);
