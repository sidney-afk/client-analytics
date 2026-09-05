'use strict';

// LOCAL ONLY. Proves the actual recovery-package capture/reconstruct path on
// an explicitly supplied, password-authenticated disposable PostgreSQL server:
// a synthetic migration-shaped source, an authenticated schema+data package,
// and reconstruction into a database that holds nothing but pinned platform
// prerequisites. No cloud, Drive, provider, alert or production connection.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { LocalDatabase, localConfig } = require('./card-change-journal-rehearsal');
const { prerequisite, prepare, seed } = require('./card-history-backup-rehearsal');
const closed = require('./card-history-closed-corpus-rehearsal');
const backup = require('./track-b-backup');
const recovery = require('./track-b-recovery-package');
const { reconstruct } = require('./track-b-recovery-reconstruct');
const restore = require('./track-b-restore-rehearsal');
const ROOT = path.resolve(__dirname, '..');
const CORPUS = 'history-v5';
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const SOURCES = ['scripts/track-b-recovery-package.js', 'scripts/track-b-recovery-reconstruct.js', 'scripts/track-b-recovery-prerequisites.sql',
  'scripts/track-b-recovery-rehearsal.js', 'scripts/track-b-backup.js', 'migrations/2026-09-05-card-change-journal.sql'];
// Empty-target prerequisites: exactly what a managed platform owns and this
// package deliberately never recreates. Nothing else exists before restore.
const TARGET_PREREQUISITES = `create schema extensions; create extension pgcrypto schema extensions;
create schema auth; create schema storage; create publication supabase_realtime;
grant usage on schema public to anon, authenticated, service_role;`;

function connectionEnv(config, user, password, database) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  return { ...env, PGHOST: config.host, PGPORT: config.port, PGUSER: user, PGPASSWORD: password, PGDATABASE: database, PGCONNECT_TIMEOUT: '15' };
}
function rows(db) {
  return Object.fromEntries(backup.CLOSED_HISTORY_TABLES.map(({ name }) => [name,
    db.rows(`select to_jsonb(t) image from public.${name} t order by to_jsonb(t)::text`).map(r => r.image)]));
}
function sequences(db) { return db.rows("select sequencename name, last_value, start_value, increment_by from pg_sequences where schemaname='public' order by 1"); }
function publicObjectCount(db) {
  return Number(db.query("select (select count(*) from pg_class where relnamespace='public'::regnamespace) + (select count(*) from pg_proc where pronamespace='public'::regnamespace) + (select count(*) from pg_type where typnamespace='public'::regnamespace and typtype in ('e','d','r','c'))"));
}
function grants(db, role, mode) {
  const r = spawnSync(db.config.psql, [...db.args(), '-v', 'mode=' + mode, '-v', 'existing_role=' + role,
    '-v', 'confirmation=' + (mode === 'capture' ? 'RECOVERY_CAPTURE_GRANTS_ONLY' : 'EMPTY_SCRATCH_TARGET_ONLY'),
    '-v', 'scratch_project_ref=abcdefghijklmnopqrst', '-f', path.join(ROOT, 'scripts/track-b-recovery-prerequisites.sql')],
  { encoding: 'utf8', env: { ...process.env, PGPASSWORD: db.config.password ?? process.env.CARD_HISTORY_PGPASSWORD ?? '', PGOPTIONS: '' } });
  return r;
}
function resign(bytes, hmac, mutate) {
  const magic = recovery.RECOVERY_MAGIC; const start = magic.length + 8; const length = Number(bytes.readBigUInt64BE(magic.length));
  const manifest = JSON.parse(bytes.subarray(start, start + length).toString('utf8'));
  mutate(manifest); manifest.binding = recovery.bindingDigest(manifest);
  const json = Buffer.from(backup.canonicalJson(manifest)); const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(json.length));
  const unsigned = Buffer.concat([magic, size, json, bytes.subarray(start + length, -backup.HMAC_BYTES)]);
  return Buffer.concat([unsigned, crypto.createHmac('sha256', Buffer.from(hmac, 'base64')).update(unsigned).digest()]);
}

async function run() {
  const pins = Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))]));
  const config = localConfig(); const manifestSql = prerequisite();
  const from = new LocalDatabase(config); const to = new LocalDatabase(config);
  const captureRole = from.name + '_capture'; const targetRole = to.name + '_target';
  const capturePassword = crypto.randomBytes(24).toString('hex'); const targetPassword = crypto.randomBytes(24).toString('hex');
  const hmac = crypto.randomBytes(32).toString('base64');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-b-recovery-'));
  const sourceUrl = `postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres?sslmode=require`;
  const checks = []; const check = (name, fn) => { fn(); checks.push(name); };
  let complete = false;
  from.create(); to.create();
  try {
    prepare(from, manifestSql); closed.dependencies(from); seed(from); const replay = closed.seedDependencies(from);
    from.query(`create role ${captureRole} login bypassrls password ${literal(capturePassword)}; create role ${targetRole} login password ${literal(targetPassword)};`);
    to.query(TARGET_PREREQUISITES);
    check('capture prerequisites refuse a role holding a write privilege, then grant whole-schema SELECT', () => {
      from.query(`grant insert on public.calendar_posts to ${captureRole};`);
      assert.notEqual(grants(from, captureRole, 'capture').status, 0);
      from.query(`revoke insert on public.calendar_posts from ${captureRole};`);
      const ok = grants(from, captureRole, 'capture'); assert.equal(ok.status, 0, ok.stderr);
    });
    check('target prerequisites refuse a BYPASSRLS role and a non-empty target before granting', () => {
      to.query(`alter role ${targetRole} bypassrls;`); assert.notEqual(grants(to, targetRole, 'target').status, 0);
      to.query(`alter role ${targetRole} nobypassrls; create table public.synthetic_leftover(id int);`);
      assert.notEqual(grants(to, targetRole, 'target').status, 0);
      to.query('drop table public.synthetic_leftover;');
      const ok = grants(to, targetRole, 'target'); assert.equal(ok.status, 0, ok.stderr);
      assert.equal(publicObjectCount(to), 0);
    });
    const captureEnv = connectionEnv(config, captureRole, capturePassword, from.name);
    const targetEnv = connectionEnv(config, targetRole, targetPassword, to.name);
    check('server enforces password authentication: wrong passwords are refused for both disposable roles', () => {
      for (const [env, tool, args] of [
        [{ ...captureEnv, PGPASSWORD: 'wrong-' + capturePassword }, 'pg_dump', ['--schema-only', '--schema=public', '--file=' + path.join(dir, 'never.sql')]],
        [{ ...captureEnv, PGPASSWORD: 'wrong-' + capturePassword }, config.psql, ['-X', '-c', 'select 1']],
        [{ ...targetEnv, PGPASSWORD: 'wrong-' + targetPassword }, config.psql, ['-X', '-c', 'select 1']],
        [{ ...targetEnv, PGPASSWORD: '' }, config.psql, ['-X', '-c', 'select 1']],
      ]) {
        const r = spawnSync(process.env.CARD_HISTORY_PGDUMP && tool === 'pg_dump' ? process.env.CARD_HISTORY_PGDUMP : tool, args, { encoding: 'utf8', env });
        assert.notEqual(r.status, 0, 'local server must require passwords (scram-sha-256) for this proof');
        assert.match(r.stderr, /password authentication failed|no password supplied|fe_sendauth/);
      }
      assert.equal(spawnSync(config.psql, ['-X', '-tA', '-c', 'select current_user'], { encoding: 'utf8', env: captureEnv }).stdout.trim(), captureRole);
    });
    const options = { psql: config.psql, pgDump: process.env.CARD_HISTORY_PGDUMP || 'pg_dump' };
    const raced = path.join(dir, 'raced.recovery');
    let raceError = null;
    try {
      await recovery.captureRecoveryPackage({ env: captureEnv, corpusName: CORPUS, output: raced, hmacInput: hmac, sourceUrl, ...options,
        hooks: { afterDumps: () => from.query('alter table public.calendar_posts add column synthetic_race text;') } });
    } catch (error) { raceError = error; }
    from.query('alter table public.calendar_posts drop column synthetic_race;');
    check('capture refuses a source whose catalog changes inside the snapshot window and writes no package', () => {
      assert.ok(raceError); assert.match(raceError.message, /catalog change/); assert.equal(fs.existsSync(raced), false);
    });
    const packagePath = path.join(dir, 'package.recovery');
    const summary = await recovery.captureRecoveryPackage({ env: captureEnv, corpusName: CORPUS, output: packagePath, hmacInput: hmac, sourceUrl, ...options });
    const original = rows(from); const originalSequences = sequences(from);
    const sourceFingerprint = from.query(recovery.fingerprintSql());
    const bytes = fs.readFileSync(packagePath);
    const pkg = recovery.readRecoveryPackage(bytes, hmac);
    check('real snapshot capture authenticates schema and all33 data tables under one binding', () => {
      assert.equal(summary.ok, true); assert.equal(summary.corpus, CORPUS); assert.equal(summary.data_table_count, 33);
      assert.equal(pkg.manifest.schema.fingerprint, sourceFingerprint);
      assert.ok(pkg.manifest.omitted_data_tables.length > 0, 'fixture must include public tables outside the corpus');
      assert.ok(summary.schema_statements > 100);
      assert.equal(pkg.manifest.schema.egress_capable_functions, 0);
      assert.deepEqual(pkg.manifest.prerequisites.required_extensions.map(e => e.name), ['pgcrypto']);
      assert.ok(pkg.manifest.prerequisites.roles.includes('service_role'));
      assert.ok(Object.values(pkg.manifest.data.tables).every(t => t.rows > 0));
      assert.ok(!bytes.toString('latin1').includes(capturePassword) && !bytes.toString('latin1').includes(targetPassword));
    });
    check('tampered, spliced and re-signed mismatched packages are refused before any target work', () => {
      const flipped = Buffer.from(bytes); flipped[flipped.length - 1] ^= 1;
      assert.throws(() => recovery.readRecoveryPackage(flipped, hmac), /authentication failed/);
      const body = Buffer.from(bytes); body[recovery.RECOVERY_MAGIC.length + 8 + Number(bytes.readBigUInt64BE(recovery.RECOVERY_MAGIC.length)) + 9] ^= 1;
      assert.throws(() => recovery.readRecoveryPackage(body, hmac), /authentication failed/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.data.sha256 = sha('other'); }), hmac), /digest mismatch/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.schema.pre_data.statements += 1; }), hmac), /statement count mismatch/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.data.tables.calendar_posts.rows += 1; }), hmac), /manifest mismatch/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.corpus = 'history-v4'; m.corpus_version = 4; }), hmac));
      assert.throws(() => recovery.readRecoveryPackage(bytes, crypto.randomBytes(32).toString('base64')), /authentication failed/);
    });
    check('missing target dependencies and unexpected target state refuse before any DDL', () => {
      const missingExtension = recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.prerequisites.required_extensions.push({ name: 'synthetic_missing', schema: 'extensions', version: '1.0' }); }), hmac);
      assert.throws(() => reconstruct(missingExtension, targetEnv, { psql: config.psql }), /reconstruction failed/);
      assert.equal(publicObjectCount(to), 0);
      const missingRole = recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.prerequisites.roles.push('synthetic_missing_role'); }), hmac);
      assert.throws(() => reconstruct(missingRole, targetEnv, { psql: config.psql }), /reconstruction failed/);
      assert.equal(publicObjectCount(to), 0);
      to.query('create table public.synthetic_unexpected(id int);');
      assert.throws(() => reconstruct(pkg, targetEnv, { psql: config.psql }), /reconstruction failed/);
      assert.equal(publicObjectCount(to), 2, 'only the unexpected table and its row type may exist');
      to.query('drop table public.synthetic_unexpected;');
    });
    check('baseline control: the existing data-only v5 package cannot reconstruct the same empty target', () => {
      // Same bytes the existing package format carries, same target, same
      // restricted role: without a schema section there is nothing to load into.
      const legacy = spawnSync(config.psql, ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1'], { input: restore.restoreSql(pkg.data, CORPUS), encoding: 'utf8', env: targetEnv });
      assert.notEqual(legacy.status, 0); assert.match(legacy.stderr, /does not exist/);
      assert.equal(publicObjectCount(to), 0);
    });
    check('a failing COPY inside reconstruction leaves the target genuinely empty', () => {
      const corrupt = { ...pkg, data: Buffer.from(pkg.data.toString('utf8').replace('After retained edit', 'After retained edit\textra-column')) };
      assert.throws(() => reconstruct(corrupt, targetEnv, { psql: config.psql }), /reconstruction failed/);
      assert.equal(publicObjectCount(to), 0);
    });
    const receipt = reconstruct(pkg, targetEnv, { psql: config.psql });
    check('empty-target reconstruction reports fingerprint equality, exact counts and no egress', () => {
      assert.equal(receipt.ok, true); assert.equal(receipt.schema_fingerprint_match, true);
      assert.equal(receipt.data_table_count, 33); assert.equal(receipt.egress_capable_functions, 0);
      assert.equal(receipt.realtime_membership_restored, 0);
      assert.equal(to.query(recovery.fingerprintSql()), sourceFingerprint);
    });
    check('all33 restored typed rows, keys and sequence next values equal the source', () => {
      assert.deepEqual(rows(to), original); assert.deepEqual(sequences(to), originalSequences);
      const nextSource = Number(from.query("select nextval('public.card_change_journal_id_seq')")); const nextTarget = Number(to.query("select nextval('public.card_change_journal_id_seq')"));
      assert.equal(nextSource, nextTarget);
    });
    check('reconstructed objects are owned by the restricted target role, not a superuser', () => {
      assert.equal(to.query(`select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls from pg_roles where rolname='${targetRole}'`), 'f');
      assert.equal(to.query(`select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','S') and pg_get_userbyid(c.relowner)<>'${targetRole}'`), '0');
    });
    check('intended RLS, grants and immutable/capture triggers behave on the reconstructed target', () => {
      for (const role of ['anon', 'authenticated']) for (const name of ['card_change_journal', 'pto_requests', 'production_comment_mutation_receipts', 'linear_intake_receipts'])
        assert.notEqual(to.raw(`set role ${role}; select * from public.${name};`).status, 0);
      assert.equal(to.raw('set role service_role; select count(*) from public.card_change_journal;').status, 0);
      assert.notEqual(to.raw('set role service_role; insert into public.card_change_journal default values;').status, 0);
      for (const sql of ['update public.card_change_journal set operation=operation', 'delete from public.card_change_journal', 'truncate public.card_change_journal'])
        assert.match(to.raw(sql).stderr, /card_change_journal_immutable/);
      const before = Number(to.query('select max(id) from public.card_change_journal'));
      to.query("set role service_role; update public.calendar_posts set name='Post-recovery save' where id='backup-card';");
      const latest = to.rows("select id, row_before->>'name' previous, row_after->>'name' next from public.card_change_journal order by id desc limit 1")[0];
      assert.ok(latest.id > before); assert.equal(latest.next, 'Post-recovery save'); assert.equal(latest.previous, 'Final calendar');
      to.query("set role service_role; update public.calendar_posts set name='Final calendar' where id='backup-card';");
    });
    check('replaying an already accepted comment mutation makes no duplicate action; a changed fingerprint still conflicts', () => {
      const snapshot = rows(to); to.query(replay); assert.deepEqual(rows(to), snapshot);
      const refused = to.raw(replay.replace('synthetic-closed-edit', 'different-fingerprint'));
      assert.notEqual(refused.status, 0); assert.match(refused.stderr, /idempotency_conflict/); assert.deepEqual(rows(to), snapshot);
    });
    check('no worker, egress extension, foreign server or provider replay participates', () => {
      assert.equal(to.query('select count(*) from pg_foreign_server'), '0');
      assert.equal(to.query("select count(*) from pg_extension where extname not in ('plpgsql','pgcrypto')"), '0');
      assert.deepEqual(rows(to).mirror_outbox, original.mirror_outbox);
    });
    check('dormant watcher evaluation classifies freshness, schema drift, verification and coverage', () => {
      const now = Date.parse(pkg.manifest.generated_at) + 60000;
      const ok = recovery.evaluateRecoveryWatch({ manifest: { ...pkg.manifest, package_sha256: sha(bytes) }, nowMs: now, liveFingerprint: sourceFingerprint,
        livePublicTableCount: 33 + pkg.manifest.omitted_data_tables.length, lastReconstruction: { ok: true, package_sha256: sha(bytes) } });
      assert.deepEqual(ok.alerts, []); assert.equal(ok.dormant, true);
      const bad = recovery.evaluateRecoveryWatch({ manifest: pkg.manifest, nowMs: now + 30 * 3600000, liveFingerprint: 'other', livePublicTableCount: 99, lastReconstruction: { ok: false } });
      assert.deepEqual(bad.alerts, ['RECOVERY_PACKAGE_STALE', 'RECOVERY_SCHEMA_MISMATCH', 'RECOVERY_VERIFICATION_FAILED', 'RECOVERY_COVERAGE_CHANGED']);
    });
    assert.deepEqual(Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))])), pins, 'proof source changed during execution');
    const result = { status: 'PASS', passed: checks.length, checks, corpus: CORPUS, data_table_count: 33,
      omitted_data_table_count: pkg.manifest.omitted_data_tables.length, schema_statements: summary.schema_statements,
      schema_inventory: pkg.manifest.schema.inventory, server_version: from.query('show server_version'),
      package_sha256: sha(bytes), source_sha256: pins,
      proof_limits: 'synthetic migration-shaped source; pinned local platform prerequisites; no cloud retrieval, installed-schema parity, asset bytes, key custody or retention claim' };
    if (process.env.CARD_HISTORY_RECOVERY_REPORT) fs.writeFileSync(process.env.CARD_HISTORY_RECOVERY_REPORT, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result)); complete = true; return result;
  } finally {
    if (complete) {
      from.drop(); to.drop(); from.query(`drop role ${captureRole}; drop role ${targetRole};`, 'postgres');
      fs.rmSync(dir, { recursive: true, force: true });
    } else console.error('Failed local recovery proof retained in databases ' + from.name + ' / ' + to.name + '; files ' + dir);
  }
}
if (require.main === module) run().catch(error => { console.error(error.stack, error.detail ? '\n' + String(error.detail).slice(0, 2000) : ''); process.exitCode = 1; });
module.exports = { run };
