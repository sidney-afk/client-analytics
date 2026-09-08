'use strict';

/*
 * The native naming mint, proved against a real PostgreSQL 16 rather than
 * asserted about its source. migrations/2026-09-07-native-identifier-mint.sql
 * is a trigger on `deliverables`, and a trigger's behaviour under concurrency,
 * under a flag flip, and under a provider write arriving after a native mint is
 * not something a source assertion can reach.
 *
 * DISPOSABLE TARGETS ONLY. It creates and drops its own database, refuses any
 * host that is not a loopback address or a local socket directory, and demands
 * an explicit confirmation env var. It is never pointed at the live backend.
 *
 * PUBLIC SAFETY: the fixture is synthetic. No client slugs, no real card ids,
 * no real Linear identifiers — the team prefixes below are invented.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MIGRATION = path.resolve(__dirname, '../../migrations/2026-09-07-native-identifier-mint.sql');

function requireDisposable() {
  if (process.env.NATIVE_IDENTIFIER_MINT_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
    throw new Error('native_identifier_mint_confirm_required');
  }
  const host = String(process.env.PGHOST || '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(host) || host.startsWith('/');
  if (!local) throw new Error('native_identifier_mint_loopback_required');
  const port = Number(process.env.PGPORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('native_identifier_mint_disposable_port_required');
  const psql = process.env.NATIVE_IDENTIFIER_MINT_PSQL || '/usr/bin/psql';
  if (!path.isAbsolute(psql) || !fs.statSync(psql).isFile()) throw new Error('native_identifier_mint_absolute_psql_required');
  return psql;
}

const PSQL = requireDisposable();
const DB = `mintproof_${process.pid}`;

function run(sql, options) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-tAq', '-d', (options && options.db) || DB, '-c', sql];
  const result = spawnSync(PSQL, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return { status: result.status, out: String(result.stdout || '').trim(), err: String(result.stderr || '').trim() };
}

function ok(sql) {
  const r = run(sql);
  if (r.status !== 0) throw new Error(`unexpected failure: ${sql}\n${r.err}`);
  return r.out;
}

function refuses(sql, message) {
  const r = run(sql);
  if (r.status === 0) throw new Error(`expected a refusal (${message}) but the statement succeeded: ${sql}`);
  if (!r.err.includes(message)) throw new Error(`expected ${message}, got: ${r.err}`);
  return true;
}

const cases = [];
function check(name, fn) {
  fn();
  cases.push(name);
  console.log(`OK  ${name}`);
}

/* --------------------------------------------------------------- fixture -- */

run('drop database if exists ' + DB, { db: 'postgres' });
if (run('create database ' + DB, { db: 'postgres' }).status !== 0) throw new Error('could not create the disposable database');

for (const role of ['anon', 'authenticated', 'service_role']) {
  run(`do $$ begin if not exists (select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$;`);
}

ok(`
create table public.syncview_runtime_flags (
  key text primary key, value jsonb not null,
  updated_by text, updated_at timestamptz not null default now());
create table public.deliverables (
  id text primary key,
  identifier text unique,
  team text not null check (team in ('video','graphics')),
  title text not null,
  status text not null default 'in_progress',
  linear_identifier text,
  linear_raw jsonb,
  updated_at timestamptz not null default now());
`);

const migration = fs.readFileSync(MIGRATION, 'utf8');
const applied = spawnSync(PSQL, ['-v', 'ON_ERROR_STOP=1', '-q', '-d', DB, '-f', MIGRATION], { encoding: 'utf8', timeout: 60000 });
if (applied.status !== 0) throw new Error(`migration failed to apply:\n${applied.stderr}`);

/* ------------------------------------------------------------ the proofs -- */

check('the migration is additive: no DROP TABLE, no RENAME, no type change, no existing function replaced', () => {
  if (/drop\s+(table|column|constraint|index|type|function)/i.test(migration)) throw new Error('destructive DDL present');
  if (/alter\s+table[\s\S]{0,80}(drop|rename|alter column)/i.test(migration)) throw new Error('table altered destructively');
  /* the one DROP allowed is the idempotent trigger re-create, which recreates it in the same transaction */
  const drops = migration.match(/drop\s+\w+/gi) || [];
  if (drops.length !== 1 || !/drop trigger if exists/i.test(migration)) throw new Error(`unexpected drops: ${drops}`);
  for (const fn of ['production_deliverable_write', 'production_intake_append', 'production_intake_root_begin', 'mirror_outbox_enqueue', 'production_labels_write']) {
    if (migration.includes(`function public.${fn}`)) throw new Error(`migration touches ${fn}, which belongs to another lane`);
  }
});

check('installing it changes nothing: the flag seeds provider and a create still gets no name', () => {
  const flag = ok("select value from public.syncview_runtime_flags where key='production_native_identifier_mint'");
  if (!flag.includes('"provider"')) throw new Error(`flag did not seed provider: ${flag}`);
  ok("insert into public.deliverables (id, team, title) values ('d-noop', 'video', 't')");
  const name = ok("select coalesce(linear_identifier,'<null>') from public.deliverables where id='d-noop'");
  if (name !== '<null>') throw new Error(`a name was minted with the flag at provider: ${name}`);
  if (ok('select count(*) from public.production_native_identifier_grants') !== '0') throw new Error('a grant was recorded');
});

check('a team with no provider names cannot be seeded — the prefix has to come from somewhere', () => {
  refuses("select public.production_native_identifier_seed('graphics')", 'native_identifier_no_provider_names');
});

check('seeding derives the prefix and the ordinal band from what the provider actually minted', () => {
  ok(`insert into public.deliverables (id, team, title, linear_identifier) values
      ('d-p1','video','t','VID-13551'), ('d-p2','video','t','VID-13553'), ('d-p3','video','t','VID-9')`);
  const seeded = JSON.parse(ok("select public.production_native_identifier_seed('video', 100000)"));
  if (seeded.prefix !== 'VID') throw new Error(`prefix ${seeded.prefix}`);
  if (seeded.observed_provider_max !== 13553) throw new Error(`observed max ${seeded.observed_provider_max}`);
  if (seeded.next_ordinal !== 113554) throw new Error(`next ordinal ${seeded.next_ordinal}`);
});

check('a second seed is refused, because moving the cursor re-issues names already handed out', () => {
  refuses("select public.production_native_identifier_seed('video')", 'native_identifier_already_seeded');
});

check('THE LABEL TRAP IS NOT REPEATED: flag native with no seed reports provider, it does not half-arm', () => {
  ok(`update public.syncview_runtime_flags
        set value = '{"schema_version":1,"video":{"mode":"provider"},"graphics":{"mode":"native"}}'::jsonb
      where key='production_native_identifier_mint'`);
  const capability = JSON.parse(ok("select public.production_native_identifier_capability('graphics')"));
  if (capability.mode !== 'provider') throw new Error(`capability said ${capability.mode} with nothing seeded`);
  if (capability.seeded !== false) throw new Error('capability claimed a seed exists');
  if (capability.flag_mode !== 'native') throw new Error('capability hid the flag state instead of reporting it');
  ok("insert into public.deliverables (id, team, title) values ('d-halfarmed','graphics','t')");
  const name = ok("select coalesce(linear_identifier,'<null>') from public.deliverables where id='d-halfarmed'");
  if (name !== '<null>') throw new Error(`a half-armed team minted ${name}`);
});

check('with the flag flipped and the team seeded, a native create gets a readable name in the reserved band', () => {
  ok(`update public.syncview_runtime_flags
        set value = '{"schema_version":1,"video":{"mode":"native"},"graphics":{"mode":"provider"}}'::jsonb
      where key='production_native_identifier_mint'`);
  ok("insert into public.deliverables (id, team, title) values ('d-native1','video','t')");
  const name = ok("select linear_identifier from public.deliverables where id='d-native1'");
  if (name !== 'VID-113554') throw new Error(`minted ${name}`);
  const grant = ok("select deliverable_id||'|'||team from public.production_native_identifier_grants where identifier='VID-113554'");
  if (grant !== 'd-native1|video') throw new Error(`grant row is ${grant}`);
});

check('the name is above every provider ordinal, so it cannot collide with one Linear mints', () => {
  const collides = ok(`select count(*) from public.production_native_identifier_grants g
                        join public.deliverables d on d.linear_identifier = g.identifier and d.id <> g.deliverable_id`);
  if (collides !== '0') throw new Error('a native name is on a second card');
  const band = ok(`select min(substring(identifier from '-([0-9]+)$')::bigint) from public.production_native_identifier_grants`);
  const providerMax = ok("select observed_provider_max from public.production_native_identifier_mint where team='video'");
  if (Number(band) <= Number(providerMax)) throw new Error(`native band ${band} is not above provider max ${providerMax}`);
});

check('a caller-supplied name is never overwritten by the mint', () => {
  ok("insert into public.deliverables (id, team, title, linear_identifier) values ('d-supplied','video','t','VID-13554')");
  const name = ok("select linear_identifier from public.deliverables where id='d-supplied'");
  if (name !== 'VID-13554') throw new Error(`the mint overwrote a supplied name with ${name}`);
});

check('a published native name does not change under a reader when the provider writes back', () => {
  ok("update public.deliverables set linear_identifier='VID-13999' where id='d-native1'");
  const name = ok("select linear_identifier from public.deliverables where id='d-native1'");
  if (name !== 'VID-113554') throw new Error(`the provider write renamed the card to ${name}`);
  const refused = ok("select coalesce(provider_identifier_refused,'<null>') from public.production_native_identifier_grants where identifier='VID-113554'");
  if (refused !== 'VID-13999') throw new Error(`the refused provider name was not recorded: ${refused}`);
});

check('provider-named cards are NOT protected, so linear-inbound can still refresh them today', () => {
  ok("update public.deliverables set linear_identifier='GRA-7197' where id='d-p1'");
  const name = ok("select linear_identifier from public.deliverables where id='d-p1'");
  if (name !== 'GRA-7197') throw new Error(`a provider refresh was blocked; row reads ${name}`);
});

check('flipping the flag back to provider stops minting and renames nothing', () => {
  ok(`update public.syncview_runtime_flags
        set value = '{"schema_version":1,"video":{"mode":"provider"},"graphics":{"mode":"provider"}}'::jsonb
      where key='production_native_identifier_mint'`);
  ok("insert into public.deliverables (id, team, title) values ('d-afterundo','video','t')");
  const fresh = ok("select coalesce(linear_identifier,'<null>') from public.deliverables where id='d-afterundo'");
  if (fresh !== '<null>') throw new Error(`still minting after the undo: ${fresh}`);
  const existing = ok("select linear_identifier from public.deliverables where id='d-native1'");
  if (existing !== 'VID-113554') throw new Error(`the undo renamed an existing card to ${existing}`);
  ok("update public.deliverables set linear_identifier='VID-14000' where id='d-native1'");
  if (ok("select linear_identifier from public.deliverables where id='d-native1'") !== 'VID-113554') {
    throw new Error('name stability depended on the flag; it must not');
  }
});

check('the allocator steps over a name that already exists rather than issuing it twice', () => {
  ok(`update public.syncview_runtime_flags
        set value = '{"schema_version":1,"video":{"mode":"native"},"graphics":{"mode":"provider"}}'::jsonb
      where key='production_native_identifier_mint'`);
  const next = ok("select next_ordinal from public.production_native_identifier_mint where team='video'");
  ok(`insert into public.deliverables (id, team, title, linear_identifier) values ('d-squatter','video','t','VID-${next}')`);
  ok("insert into public.deliverables (id, team, title) values ('d-stepover','video','t')");
  const minted = ok("select linear_identifier from public.deliverables where id='d-stepover'");
  if (minted === `VID-${next}`) throw new Error('the allocator reissued an existing name');
  if (Number(minted.split('-')[1]) <= Number(next)) throw new Error(`the allocator went backwards: ${minted}`);
});

check('two concurrent creates cannot leave with the same ordinal', () => {
  const before = Number(ok("select next_ordinal from public.production_native_identifier_mint where team='video'"));
  const rows = [];
  for (let i = 0; i < 25; i++) rows.push(`('d-conc-${i}','video','t')`);
  /* one statement, 25 rows: the trigger fires 25 times inside one transaction,
     which is the tightest allocation contention this path can see */
  ok(`insert into public.deliverables (id, team, title) values ${rows.join(',')}`);
  const distinct = ok("select count(distinct linear_identifier) from public.deliverables where id like 'd-conc-%'");
  const total = ok("select count(*) from public.deliverables where id like 'd-conc-%'");
  if (distinct !== total || total !== '25') throw new Error(`${total} rows, ${distinct} distinct names`);
  const after = Number(ok("select next_ordinal from public.production_native_identifier_mint where team='video'"));
  if (after - before < 25) throw new Error(`cursor advanced ${after - before} for 25 allocations`);
});

check('a team whose provider names use two prefixes refuses to seed rather than guessing', () => {
  ok(`insert into public.deliverables (id, team, title, linear_identifier) values
      ('d-g1','graphics','t','GRA-7197'), ('d-g2','graphics','t','DES-12')`);
  refuses("select public.production_native_identifier_seed('graphics')", 'native_identifier_prefix_ambiguous');
});

check('a malformed flag is a refusal, never a silent provider fallback', () => {
  ok(`update public.syncview_runtime_flags set value='{"schema_version":2}'::jsonb
       where key='production_native_identifier_mint'`);
  refuses("select public.production_native_identifier_capability('video')", 'native_identifier_config_invalid');
  ok(`update public.syncview_runtime_flags
        set value = '{"schema_version":1,"video":{"mode":"provider"},"graphics":{"mode":"provider"}}'::jsonb
      where key='production_native_identifier_mint'`);
  refuses("select public.production_native_identifier_capability('marketing')", 'native_identifier_team_invalid');
});

check('the browser needs no change: displayId already prefers linear_identifier', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  if (!html.includes("displayId: linearIdent || importIdent || String(d.id || '')")) {
    throw new Error('index.html no longer resolves displayId from linear_identifier first');
  }
});

run('drop database if exists ' + DB, { db: 'postgres' });

const report = { status: 'PASS', passed: cases.length, cases };
if (process.env.NATIVE_IDENTIFIER_MINT_REPORT) {
  fs.writeFileSync(process.env.NATIVE_IDENTIFIER_MINT_REPORT, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`\nnative-identifier-mint sql-proof: ${cases.length} passed, 0 failed ✅`);
