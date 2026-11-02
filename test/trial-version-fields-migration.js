'use strict';
/*
 * trial-version-fields-migration (plan combined.md row F2, D1): studio_trial_versions gains thumbnail_url, caption
 * and change_part, and nothing else.
 *
 *   1. Offline: the file's header (cope marker, applied-when query, rollback), no client_ok_by (D1), the four roles
 *      named in the read-back, no grant to a browser role, no data rewrite.
 *   2. With PostgreSQL 16 (required with TRIAL_VERSION_FIELDS_REQUIRE_POSTGRES=1): applies the table's whole
 *      migration chain in a throwaway cluster, then this file twice (it must be re-runnable), and proves the three
 *      columns, their checks, that an existing row reads null in all three, that the applied-when query answers
 *      true, and that no role gained or lost a privilege (table and column level, all four roles).
 *      Only invented values. Never contacts a backend.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FILE = 'supabase/migrations/20261102200000_trial_version_fields.sql';
const CHAIN = [
  'supabase/migrations/20261026200000_studio_trial_versions.sql',
  'supabase/migrations/20261027090000_trial_reels.sql',
  'supabase/migrations/20261028150000_trial_reels_client_pass.sql',
];
let passed = 0;
let failed = 0;
const ok = (name, value) => {
  if (value) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};

console.log('trial-version-fields-migration: offline');
if (!fs.existsSync(path.join(ROOT, FILE))) {
  ok(FILE + ' exists', false);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}
const mig = read(FILE);
const code = mig.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const appliedWhen = (mig.match(/^-- ef-auto-deploy-applied-when: (.+)$/m) || [])[1] || '';
ok('carries the cope marker', /^-- ef-auto-deploy: functions-cope-without-this$/m.test(mig));
ok('says how to tell it is applied', /change_part/.test(appliedWhen) && /caption/.test(appliedWhen) && /thumbnail_url/.test(appliedWhen));
ok('gives a rollback', /Rollback:[\s\S]*drop column if exists thumbnail_url[\s\S]*drop column if exists caption[\s\S]*drop column if exists change_part/.test(mig));
ok('adds exactly the three columns', (code.match(/add column if not exists/g) || []).length === 3
  && /add column if not exists thumbnail_url\b/.test(code) && /add column if not exists caption\b/.test(code)
  && /add column if not exists change_part\b/.test(code));
ok('no client_ok_by (D1)', !/client_ok_by/.test(code));
ok('no grant to a browser role', !/grant[^;]*to[^;]*\b(anon|authenticated|public)\b/i.test(code));
ok('no grant or revoke at all (the table keeps its grants)', !/\b(grant|revoke)\s/i.test(code));
ok('rewrites no row', !/\b(update|delete\s+from|truncate|insert\s+into)\s+(public\.)?studio_trial_versions\b/i.test(code));
ok('the read-back names all four roles', ['anon', 'authenticated', 'service_role'].every((r) => code.includes(`'${r}'::regrole`)) && /0::oid/.test(code));
ok('stops plainly when the table chain is missing', /raise exception 'Apply supabase\/migrations\/20261028150000_trial_reels_client_pass\.sql first/.test(code));

const PG_BIN = '/usr/lib/postgresql/16/bin';
const haveServer = fs.existsSync(path.join(PG_BIN, 'postgres')) && fs.existsSync(path.join(PG_BIN, 'initdb'));
if (!haveServer) {
  if (process.env.TRIAL_VERSION_FIELDS_REQUIRE_POSTGRES === '1') { failed += 1; console.log('  FAIL PostgreSQL 16 required but not installed'); }
  else console.log('SKIP PostgreSQL proof: PostgreSQL 16 not installed');
} else {
  console.log('trial-version-fields-migration: PostgreSQL');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const base = fs.mkdtempSync(path.join(asRoot ? '/var/tmp' : os.tmpdir(), 'trial-version-fields-'));
  fs.chmodSync(base, 0o755);
  const port = String(55000 + Math.floor(Math.random() * 4000));
  const as = (cmd, args) => asRoot
    ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { encoding: 'utf8' })
    : spawnSync(cmd, args, { encoding: 'utf8' });
  if (asRoot) spawnSync('chown', ['postgres', base]);
  const data = path.join(base, 'data');
  let started = false;
  const run = (db, input, allowFail) => {
    const r = spawnSync(path.join(PG_BIN, 'psql'), ['-h', base, '-p', port, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-At'],
      { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0 && !allowFail) throw new Error('psql failed: ' + (r.stderr || '').trim());
    return allowFail ? r : r.stdout.trim();
  };
  const q = (s) => run('t', s);
  const acl = `select coalesce(string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by 1), '')
    from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.studio_trial_versions'::regclass and a.grantee <> c.relowner;`;
  const colAcl = `select count(*) from pg_attribute where attrelid = 'public.studio_trial_versions'::regclass and attacl is not null;`;
  try {
    assert.equal(as(path.join(PG_BIN, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale']).status, 0);
    assert.equal(as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${base} -c listen_addresses=''`, '-l', path.join(base, 'log'), '-w', 'start']).status, 0);
    started = true;
    run('postgres', 'create database t');
    q(`create role anon; create role authenticated; create role service_role bypassrls;`);

    const early = run('t', mig, true);
    ok('refuses plainly before the table exists', early.status !== 0 && /Apply supabase\/migrations\/20261028150000/.test(early.stderr));

    for (const f of CHAIN) q(read(f));
    q(`insert into public.studio_trial_versions (client, video, letter, member) values ('test-client', '1', 'B', 'tester');`);
    const aclBefore = q(acl);
    q(mig);
    q(mig);
    ok('applies, and applies again unchanged', true);
    const cols = q(`select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)
      from information_schema.columns where table_schema = 'public' and table_name = 'studio_trial_versions'
      and column_name in ('thumbnail_url', 'caption', 'change_part', 'client_ok_by');`);
    ok('three nullable text columns, no client_ok_by', cols === 'caption:text:YES,change_part:text:YES,thumbnail_url:text:YES');
    ok('an existing row reads null in all three', q(`select count(*) from public.studio_trial_versions where thumbnail_url is null and caption is null and change_part is null;`) === '1');
    ok('the applied-when query answers true', q(appliedWhen + ';') === 't');
    ok('no role gained or lost a table privilege', q(acl) === aclBefore && aclBefore === 'service_role:INSERT,service_role:SELECT,service_role:UPDATE');
    ok('no column-level privilege anywhere', q(colAcl) === '0');
    for (const role of ['anon', 'authenticated']) {
      const r = run('t', `set role ${role}; select caption from public.studio_trial_versions;`, true);
      ok(`${role} cannot read the new columns`, r.status !== 0 && /permission denied/.test(r.stderr));
    }
    ok('service_role can read and write them', q(`set role service_role; update public.studio_trial_versions set caption = 'c', thumbnail_url = 'https://e.example/t.jpg', change_part = 'caption' returning change_part;`).split('\n').pop() === 'caption');

    const bad = (sql) => run('t', `update public.studio_trial_versions set ${sql};`, true).status !== 0;
    ok('thumbnail must be https', bad(`thumbnail_url = 'http://e.example/t.jpg'`));
    ok('thumbnail at most 2048', bad(`thumbnail_url = 'https://' || repeat('a', 2041)`) && !bad(`thumbnail_url = 'https://' || repeat('a', 2040)`));
    ok('caption at most 4000', bad(`caption = repeat('a', 4001)`) && !bad(`caption = repeat('a', 4000)`));
    ok('empty caption refused (null means the card\'s)', bad(`caption = ''`));
    ok('change_part only video, thumbnail or caption', bad(`change_part = 'title'`)
      && ['video', 'thumbnail', 'caption'].every((p) => !bad(`change_part = '${p}'`)) && !bad('change_part = null'));
  } catch (e) {
    failed += 1;
    console.log('  FAIL PostgreSQL proof: ' + (e && e.message || e));
  } finally {
    if (started) as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
    fs.rmSync(base, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
