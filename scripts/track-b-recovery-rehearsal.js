'use strict';

// LOCAL ONLY. Proves the actual recovery-package capture/reconstruct path on
// an explicitly supplied, password-authenticated disposable PostgreSQL server:
// a synthetic migration-shaped source, an authenticated schema+data package,
// and reconstruction into a database that holds nothing but pinned platform
// prerequisites. No cloud, Drive, provider, alert or production connection.
//
// Groups 1-16 are the ORIGINAL 8fa163b rehearsal, preserved. Groups 17+ are the
// corrections: exact sequence state, the callable-dependency contract, the
// narrow extension EXECUTE contract, effective-permission recheck, ACL target
// validation, precommit-versus-postcommit failure recovery, and the explicitly
// versioned staged-catalog corpus (history-v6) with its immutable triggers.
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
const { reconstruct, observeTargetState, OUTCOMES } = require('./track-b-recovery-reconstruct');
const restore = require('./track-b-restore-rehearsal');
const ROOT = path.resolve(__dirname, '..');
const CORPUS = 'history-v6';
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const SOURCES = ['scripts/track-b-recovery-package.js', 'scripts/track-b-recovery-reconstruct.js', 'scripts/track-b-recovery-prerequisites.sql',
  'scripts/track-b-recovery-rehearsal.js', 'scripts/track-b-backup.js', 'scripts/track-b-restore-rehearsal.js',
  'migrations/2026-09-05-card-change-journal.sql', 'migrations/2026-09-05-native-label-catalog-foundation.sql'];
const LABEL_CATALOG_SQL = 'migrations/2026-09-05-native-label-catalog-foundation.sql';
const LABEL_CATALOG_SHA256 = 'ba19247491e2f809aaf211fb517838eeda9d1edb246cb1698943e70a14e1aa1a';
// Empty-target prerequisites: exactly what a managed platform owns and this
// package deliberately never recreates. Nothing else exists before restore.
const TARGET_PREREQUISITES = `create schema extensions; create extension pgcrypto schema extensions;
create schema auth; create schema storage; create publication supabase_realtime;
grant usage on schema public to anon, authenticated, service_role;`;
// Exactly the three signatures the target prerequisites grant, no more.
const EXTENSION_CONTRACT_GRANTS = ['digest(bytea,text)', 'gen_random_bytes(integer)', 'gen_random_uuid()'];

function connectionEnv(config, user, password, database) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  return { ...env, PGHOST: config.host, PGPORT: config.port, PGUSER: user, PGPASSWORD: password, PGDATABASE: database, PGCONNECT_TIMEOUT: '15' };
}
function rows(db) {
  return Object.fromEntries(backup.resolveCorpus(CORPUS).tables.map(({ name }) => [name,
    db.rows(`select to_jsonb(t) image from public.${name} t order by to_jsonb(t)::text`).map(r => r.image)]));
}
function sequenceStates(db) {
  return db.rows("select c.relname name from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='S' order by 1")
    .map(r => JSON.parse(db.query(recovery.sequenceStateSql(r.name))));
}
function publicObjectCount(db) {
  return Number(db.query("select (select count(*) from pg_class where relnamespace='public'::regnamespace) + (select count(*) from pg_proc where pronamespace='public'::regnamespace) + (select count(*) from pg_type where typnamespace='public'::regnamespace and typtype in ('e','d','r','c'))"));
}
function grants(db, role, mode) {
  return spawnSync(db.config.psql, [...db.args(), '-v', 'mode=' + mode, '-v', 'existing_role=' + role,
    '-v', 'confirmation=' + (mode === 'capture' ? 'RECOVERY_CAPTURE_GRANTS_ONLY' : 'EMPTY_SCRATCH_TARGET_ONLY'),
    '-v', 'scratch_project_ref=abcdefghijklmnopqrst', '-f', path.join(ROOT, 'scripts/track-b-recovery-prerequisites.sql')],
  { encoding: 'utf8', env: { ...process.env, PGPASSWORD: db.config.password ?? process.env.CARD_HISTORY_PGPASSWORD ?? '', PGOPTIONS: '' } });
}
function resign(bytes, hmac, mutate) {
  const magic = recovery.RECOVERY_MAGIC; const start = magic.length + 8; const length = Number(bytes.readBigUInt64BE(magic.length));
  const manifest = JSON.parse(bytes.subarray(start, start + length).toString('utf8'));
  mutate(manifest); manifest.binding = recovery.bindingDigest(manifest);
  const json = Buffer.from(backup.canonicalJson(manifest)); const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(json.length));
  const unsigned = Buffer.concat([magic, size, json, bytes.subarray(start + length, -backup.HMAC_BYTES)]);
  return Buffer.concat([unsigned, crypto.createHmac('sha256', Buffer.from(hmac, 'base64')).update(unsigned).digest()]);
}

// Synthetic sequence fixtures reproducing the coordinator's three baseline
// probes exactly: a value beyond IEEE-754 integer range, an uncalled sequence
// with a non-default start, and an untouched fresh sequence.
const LARGE_LAST = '9007199254740993';   // next allocation is 9007199254740994
const UNCALLED_START = '9000';           // next allocation is 9000
function seedSequences(db) {
  db.query(`create sequence public.synthetic_large_seq as bigint;
    select setval('public.synthetic_large_seq', ${LARGE_LAST}::bigint, true);
    create sequence public.synthetic_uncalled_seq as bigint start with ${UNCALLED_START};
    create sequence public.synthetic_fresh_seq as bigint;`);
}

async function run() {
  const pins = Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))]));
  assert.equal(pins[LABEL_CATALOG_SQL], LABEL_CATALOG_SHA256, 'pinned PR #1316 label catalog migration hash');
  const labelCatalogSql = fs.readFileSync(path.join(ROOT, LABEL_CATALOG_SQL), 'utf8');
  const config = localConfig(); const manifestSql = prerequisite();
  const from = new LocalDatabase(config); const to = new LocalDatabase(config);
  const captureRole = from.name + '_capture'; const targetRole = to.name + '_target';
  const capturePassword = crypto.randomBytes(24).toString('hex'); const targetPassword = crypto.randomBytes(24).toString('hex');
  const hmac = crypto.randomBytes(32).toString('base64');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-b-recovery-'));
  const diagnosticDir = path.join(dir, 'diagnostics');
  const sourceUrl = `postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres?sslmode=require`;
  const checks = []; const check = (name, fn) => { fn(); checks.push(name); };
  const options = { psql: config.psql, pgDump: process.env.CARD_HISTORY_PGDUMP || 'pg_dump' };
  let complete = false;
  from.create(); to.create();
  try {
    prepare(from, manifestSql); closed.dependencies(from); seed(from); const replay = closed.seedDependencies(from);
    from.query(labelCatalogSql); seedSequences(from);
    // Staged catalog content: the exact structure PR #1316's validator accepts.
    const capture = '11111111-2222-4333-8444-555555555555';
    const manifestJson = JSON.stringify({ schema_version: 1, source_kind: 'linear_workspace_issue_labels', capture_id: capture,
      source_sha256: 'a'.repeat(64), workspace_fingerprint: 'b'.repeat(64), captured_at: '2026-09-05T00:00:00Z', include_archived: true,
      teams: { video: '11111111-1111-4111-8111-111111111111', graphics: '22222222-2222-4222-8222-222222222222' }, expected_count: 1,
      pages: [{ after: null, nodes: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Synthetic label', color: '#abcdef',
        description: 'Synthetic staged catalog entry', isGroup: false, archivedAt: null, team: null }],
        pageInfo: { hasNextPage: false, endCursor: null } }] });
    from.query(`set role service_role; select public.production_label_catalog_stage('${capture}'::uuid, ${literal(manifestJson)}::jsonb);`);
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
    check('narrow extension EXECUTE contract: only the three declared signatures are executable by the target role', () => {
      // DIRECT grants only: the extension's PUBLIC default EXECUTE is a pinned
      // platform property this slice verifies and reports but never widens.
      const beyond = to.query(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        cross join lateral aclexplode(p.proacl) e join pg_roles g on g.oid=e.grantee
        where n.nspname='extensions' and g.rolname='${targetRole}' and e.privilege_type='EXECUTE'
        and replace(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', ' ', '') not in (${EXTENSION_CONTRACT_GRANTS.map(literal).join(',')});`);
      assert.equal(beyond, '0', 'target role must not hold blanket EXECUTE in extensions');
      const granted = to.query(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        cross join lateral aclexplode(p.proacl) e join pg_roles g on g.oid=e.grantee
        where n.nspname='extensions' and g.rolname='${targetRole}' and e.privilege_type='EXECUTE';`);
      assert.equal(granted, String(EXTENSION_CONTRACT_GRANTS.length), 'exactly the contract signatures are granted directly');
      const total = Number(to.query("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='extensions'"));
      assert.ok(total > EXTENSION_CONTRACT_GRANTS.length, 'fixture must contain extension functions outside the contract');
      for (const signature of EXTENSION_CONTRACT_GRANTS) {
        assert.equal(to.query(`select has_function_privilege('${targetRole}', 'extensions.${signature}', 'execute')::text`), 'true', signature);
      }
    });

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

    // The coordinator's executing-CHECK probe: a CHECK constraint whose function
    // writes to another copied corpus row. Capture must now refuse it outright.
    from.query(`create function public.synthetic_writing_check(p text) returns boolean language plpgsql as $$
      begin update public.calendar_posts set name=name where false; return true; end $$;
      create table public.synthetic_executing_check(id text primary key, body text check (public.synthetic_writing_check(body)));`);
    // Re-run the capture grants so the ONLY remaining objection is the callable
    // contract, not a stale SELECT grant on the newly created table.
    assert.equal(grants(from, captureRole, 'capture').status, 0);
    const impurePath = path.join(dir, 'impure.recovery');
    let impureError = null;
    try {
      await recovery.captureRecoveryPackage({ env: captureEnv, corpusName: CORPUS, output: impurePath, hmacInput: hmac, sourceUrl, ...options });
    } catch (error) { impureError = error; }
    from.query('drop table public.synthetic_executing_check; drop function public.synthetic_writing_check(text);');
    check('capture refuses an impure callable an expression would execute, and writes no package', () => {
      assert.ok(impureError, 'capture must refuse a writing CHECK function');
      assert.match(impureError.message, /impure public callable|writing statement/);
      assert.equal(fs.existsSync(impurePath), false);
    });

    const packagePath = path.join(dir, 'package.recovery');
    const summary = await recovery.captureRecoveryPackage({ env: captureEnv, corpusName: CORPUS, output: packagePath, hmacInput: hmac, sourceUrl, ...options });
    const original = rows(from); const originalSequences = sequenceStates(from);
    const sourceFingerprint = from.query(recovery.fingerprintSql());
    const bytes = fs.readFileSync(packagePath);
    const pkg = recovery.readRecoveryPackage(bytes, hmac);

    check('real snapshot capture authenticates schema and all34 data tables under one binding', () => {
      assert.equal(summary.ok, true); assert.equal(summary.corpus, CORPUS); assert.equal(summary.data_table_count, 34);
      assert.equal(summary.recovery_version, 2);
      assert.equal(pkg.manifest.schema.fingerprint, sourceFingerprint);
      assert.ok(pkg.manifest.omitted_data_tables.length > 0, 'fixture must include public tables outside the corpus');
      assert.ok(summary.schema_statements > 100);
      assert.equal(pkg.manifest.schema.egress_capable_functions, 0);
      assert.deepEqual(pkg.manifest.prerequisites.required_extensions.map(e => e.name), ['pgcrypto']);
      assert.ok(pkg.manifest.prerequisites.roles.includes('service_role'));
      assert.ok(Object.values(pkg.manifest.data.tables).every(t => t.rows > 0 && /^[0-9a-f]{64}$/.test(t.digest_sha256)));
      assert.ok(!bytes.toString('latin1').includes(capturePassword) && !bytes.toString('latin1').includes(targetPassword));
    });
    check('callable contract classifies every evaluated reference and admits only pure public functions', () => {
      const classes = summary.callable_classes;
      assert.ok(classes.pg_catalog > 0 && classes.public_pure > 0, JSON.stringify(classes));
      assert.equal(Object.values(pkg.manifest.callable_references).some(item => !['pg_catalog', 'extension', 'public_pure', 'not_a_function', 'keyword'].includes(item.class)), false);
      // The real intake validators and the workload projection are the pure
      // public functions the migration-shaped fixture actually evaluates.
      const pure = Object.values(pkg.manifest.callable_references).filter(item => item.class === 'public_pure').map(item => item.name).sort();
      for (const name of ['_linear_intake_is_string_array', '_linear_intake_payload_is_canonical', '_linear_intake_sha256_hex', 'production_workload_label_projection']) {
        assert.ok(pure.includes(name), `${name} must be classified pure: ${pure.join(',')}`);
      }
      assert.deepEqual(pkg.callable.pure_functions.length > 0, true);
      assert.equal(recovery.verifyCallableContract([...pkg.schema.pre.statements, ...pkg.schema.post.statements], pkg.manifest).evaluated_references > 0, true);
    });
    check('exact sequence state travels as decimal strings with the real is_called flag', () => {
      const byName = Object.fromEntries(pkg.manifest.sequences.map(item => [item.name, item]));
      assert.equal(byName.synthetic_large_seq.last_value, LARGE_LAST);
      assert.equal(byName.synthetic_large_seq.is_called, true);
      assert.equal(byName.synthetic_uncalled_seq.last_value, UNCALLED_START);
      assert.equal(byName.synthetic_uncalled_seq.is_called, false);
      assert.equal(byName.synthetic_fresh_seq.is_called, false);
      assert.equal(typeof byName.synthetic_large_seq.last_value, 'string');
      // The value is beyond IEEE-754 exact integers: a Number round-trip loses it.
      assert.notEqual(String(Number(LARGE_LAST)), LARGE_LAST);
      assert.equal(pkg.manifest.sequences.length, originalSequences.length);
      assert.match(recovery.sequenceValueSql(pkg.manifest).join('\n'), new RegExp(`setval\\('public\\.synthetic_large_seq', '${LARGE_LAST}'::bigint, true\\)`));
      assert.match(recovery.sequenceValueSql(pkg.manifest).join('\n'), /setval\('public\.synthetic_uncalled_seq', '9000'::bigint, false\)/);
    });
    check('tampered, spliced and re-signed mismatched packages are refused before any target work', () => {
      const flipped = Buffer.from(bytes); flipped[flipped.length - 1] ^= 1;
      assert.throws(() => recovery.readRecoveryPackage(flipped, hmac), /authentication failed/);
      const body = Buffer.from(bytes); body[recovery.RECOVERY_MAGIC.length + 8 + Number(bytes.readBigUInt64BE(recovery.RECOVERY_MAGIC.length)) + 9] ^= 1;
      assert.throws(() => recovery.readRecoveryPackage(body, hmac), /authentication failed/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.data.sha256 = sha('other'); }), hmac), /digest mismatch/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.schema.pre_data.statements += 1; }), hmac), /statement count mismatch/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.data.tables.calendar_posts.rows += 1; }), hmac), /manifest mismatch/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.corpus = 'history-v5'; m.corpus_version = 5; }), hmac));
      assert.throws(() => recovery.readRecoveryPackage(bytes, crypto.randomBytes(32).toString('base64')), /authentication failed/);
    });
    check('a re-signed malformed sequence value or callable class is refused AT READ TIME', () => {
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => {
        m.sequences = m.sequences.map(item => (item.name === 'synthetic_large_seq' ? { ...item, last_value: 9007199254740994 } : item)); }), hmac), /Unsafe sequence value/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => {
        m.sequences = m.sequences.map(item => (item.name === 'synthetic_large_seq' ? { ...item, last_value: '99999999999999999999999' } : item)); }), hmac), /Unsafe sequence value/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => {
        m.sequences = m.sequences.map(item => (item.name === 'synthetic_large_seq' ? { ...item, is_called: 'true' } : item)); }), hmac), /is_called must be an explicit boolean/);
      // pg_dump renders with an empty search_path, so the executed statements
      // name the QUALIFIED callable; that is the key the reader must require.
      assert.ok(pkg.manifest.callable_references['public._linear_intake_sha256_hex']);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => {
        delete m.callable_references['public._linear_intake_sha256_hex']; }), hmac), /callable reference is outside the manifest contract/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => {
        m.callable_references['public._linear_intake_sha256_hex'] = { class: 'pg_catalog', name: 'pg_read_file' }; }), hmac), /denylisted catalog function/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => {
        m.callable_references['public._linear_intake_sha256_hex'] = { class: 'extension', name: '_linear_intake_sha256_hex', extension: 'synthetic_absent', schema: 'extensions' }; }), hmac), /unpinned extension/);
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => {
        delete m.data.tables.clients.digest_sha256; }), hmac), /lacks a content digest/);
    });
    check('a re-signed content digest is caught IN-TRANSACTION; a re-signed sequence value is applied, and only the HMAC protects it', () => {
      // The reader cannot recompute a row digest from COPY text without a
      // database, so this is deliberately NOT a read-time refusal. It is the
      // in-transaction verifier that rejects it, before COMMIT.
      const forgedDigest = recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.data.tables.clients.digest_sha256 = 'c'.repeat(64); }), hmac);
      let error = null; try { reconstruct(forgedDigest, targetEnv, { psql: config.psql, diagnosticDir }); } catch (e) { error = e; }
      assert.ok(error); assert.equal(error.outcome, OUTCOMES.ROLLED_BACK); assert.equal(publicObjectCount(to), 0);
      // A re-signed sequence VALUE is authoritative input, not a checksum over
      // restored rows: it is applied verbatim and the verifier then agrees with
      // it. Only the HMAC key protects it. State that boundary explicitly rather
      // than implying a detection that does not exist; the target stays empty
      // because this case is proven from the generated SQL, not by running it.
      const forgedSequence = recovery.readRecoveryPackage(resign(bytes, hmac, m => {
        m.sequences = m.sequences.map(item => (item.name === 'synthetic_large_seq' ? { ...item, last_value: '9007199254740994' } : item)); }), hmac);
      assert.match(recovery.sequenceValueSql(forgedSequence.manifest).join('\n'), /synthetic_large_seq', '9007199254740994'::bigint, true/);
      assert.match(recovery.inTransactionVerificationSql(forgedSequence.manifest), /9007199254740994/);
      assert.equal(publicObjectCount(to), 0);
    });
    check('legacy recovery_version 1 is refused rather than reinterpreted', () => {
      assert.throws(() => recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.recovery_version = 1; }), hmac), /version 1 is refused/);
      assert.ok(recovery.LEGACY_RECOVERY_VERSIONS[1]);
    });
    check('missing target dependencies and unexpected target state refuse before any DDL', () => {
      const missingExtension = recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.prerequisites.required_extensions.push({ name: 'synthetic_missing', schema: 'extensions', version: '1.0' }); }), hmac);
      assert.throws(() => reconstruct(missingExtension, targetEnv, { psql: config.psql, diagnosticDir }), /reconstruction failed/);
      assert.equal(publicObjectCount(to), 0);
      const missingRole = recovery.readRecoveryPackage(resign(bytes, hmac, m => { m.prerequisites.roles.push('synthetic_missing_role'); }), hmac);
      assert.throws(() => reconstruct(missingRole, targetEnv, { psql: config.psql, diagnosticDir }), /reconstruction failed/);
      assert.equal(publicObjectCount(to), 0);
      to.query('create table public.synthetic_unexpected(id int);');
      assert.throws(() => reconstruct(pkg, targetEnv, { psql: config.psql, diagnosticDir }), /reconstruction failed/);
      assert.equal(publicObjectCount(to), 2, 'only the unexpected table and its row type may exist');
      to.query('drop table public.synthetic_unexpected;');
    });
    check('effective-permission recheck refuses a role that gained BYPASSRLS or a dangerous membership after setup', () => {
      to.query(`alter role ${targetRole} bypassrls;`);
      let error = null; try { reconstruct(pkg, targetEnv, { psql: config.psql, diagnosticDir }); } catch (e) { error = e; }
      assert.ok(error); assert.equal(error.outcome, OUTCOMES.ROLLED_BACK); assert.equal(publicObjectCount(to), 0);
      to.query(`alter role ${targetRole} nobypassrls; grant pg_read_server_files to ${targetRole};`);
      error = null; try { reconstruct(pkg, targetEnv, { psql: config.psql, diagnosticDir }); } catch (e) { error = e; }
      assert.ok(error); assert.equal(error.outcome, OUTCOMES.ROLLED_BACK); assert.equal(publicObjectCount(to), 0);
      to.query(`revoke pg_read_server_files from ${targetRole};`);
    });
    check('baseline control: the data-only payload alone cannot reconstruct the same empty target', () => {
      // Exactly what a data-only snapshot carries: COPY sections, no schema.
      const copyOnly = backup.renderSafeCopySections(pkg.data, CORPUS);
      const legacy = spawnSync(config.psql, ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1'],
        { input: `begin;\n${copyOnly}\ncommit;\n`, encoding: 'utf8', env: targetEnv });
      assert.notEqual(legacy.status, 0); assert.match(legacy.stderr, /does not exist/);
      assert.equal(publicObjectCount(to), 0);
      // And a v5 reader refuses a v6 dump outright rather than silently
      // dropping the staged catalog table it does not cover.
      assert.throws(() => backup.parseStrictPgDump(pkg.data, 'history-v5'), /Unexpected table/);
    });
    check('the destructive snapshot path refuses the retained-data corpus outright', () => {
      assert.throws(() => restore.restoreSql(pkg.data, CORPUS), /retained-data relations and must restore through the recovery package/);
      assert.equal(backup.resolveCorpus('history-v5').tables.length, 33);
      assert.equal(backup.resolveCorpus(CORPUS).tables.length, 34);
      assert.equal(backup.resolveCorpus(CORPUS).tables.at(-1).name, 'production_label_catalog_versions');
    });
    check('a failing COPY inside reconstruction rolls back and leaves the target genuinely empty', () => {
      const corrupt = { ...pkg, data: Buffer.from(pkg.data.toString('utf8').replace('After retained edit', 'After retained edit\textra-column')) };
      let error = null; try { reconstruct(corrupt, targetEnv, { psql: config.psql, diagnosticDir }); } catch (e) { error = e; }
      assert.ok(error); assert.equal(error.outcome, OUTCOMES.ROLLED_BACK);
      assert.equal(error.receipt.retry_in_place_allowed, true); assert.equal(error.receipt.quarantine_required, false);
      assert.equal(error.receipt.target_was_empty_before, true);
      assert.equal(publicObjectCount(to), 0);
    });
    check('a detectable mismatch fails IN-TRANSACTION and never commits: precommit rollback, retryable in place', () => {
      // A manifest whose signed row count disagrees with the data section is
      // caught by readRecoveryPackage; to exercise the in-transaction verifier
      // itself, corrupt only the in-transaction expectation.
      const mismatched = { ...pkg, manifest: { ...pkg.manifest, data: { ...pkg.manifest.data,
        tables: { ...pkg.manifest.data.tables, clients: { ...pkg.manifest.data.tables.clients, digest_sha256: 'd'.repeat(64) } } } } };
      const sql = recovery.reconstructSql(mismatched);
      assert.match(sql, /recovery_verify/);
      assert.ok(sql.indexOf('$recovery_verify$') < sql.lastIndexOf('commit;'), 'verification must precede COMMIT');
      let error = null; try { reconstruct(mismatched, targetEnv, { psql: config.psql, diagnosticDir }); } catch (e) { error = e; }
      assert.ok(error); assert.equal(error.outcome, OUTCOMES.ROLLED_BACK);
      assert.equal(publicObjectCount(to), 0, 'in-transaction verification failure must leave nothing committed');
    });
    const receipt = reconstruct(pkg, targetEnv, { psql: config.psql, diagnosticDir, targetRef: 'abcdefghijklmnopqrst' });
    check('empty-target reconstruction reports verified, fingerprint equality, exact counts and no egress', () => {
      assert.equal(receipt.ok, true); assert.equal(receipt.outcome, OUTCOMES.VERIFIED);
      assert.equal(receipt.schema_fingerprint_match, true); assert.equal(receipt.content_digests_match, true);
      assert.equal(receipt.data_table_count, 34); assert.equal(receipt.egress_capable_functions, 0);
      assert.equal(receipt.extension_executable_beyond_contract, 0);
      assert.equal(receipt.realtime_membership_restored, 0);
      assert.equal(to.query(recovery.fingerprintSql()), sourceFingerprint);
    });
    check('all34 restored typed rows, keys and content digests equal the source', () => {
      assert.deepEqual(rows(to), original);
      for (const config2 of backup.resolveCorpus(CORPUS).tables) {
        assert.equal(to.query(recovery.dataDigestSql(config2.name)), pkg.manifest.data.tables[config2.name].digest_sha256, config2.name);
      }
    });
    check('exact sequence state and the NEXT allocation survive for large, uncalled and fresh sequences', () => {
      assert.deepEqual(sequenceStates(to), originalSequences);
      assert.equal(to.query("select nextval('public.synthetic_large_seq')::text"), '9007199254740994');
      assert.equal(to.query("select nextval('public.synthetic_uncalled_seq')::text"), UNCALLED_START);
      assert.equal(to.query("select nextval('public.synthetic_fresh_seq')::text"), '1');
      assert.equal(Number(from.query("select nextval('public.synthetic_large_seq')::text")), Number('9007199254740994'));
      assert.equal(from.query("select nextval('public.synthetic_uncalled_seq')::text"), UNCALLED_START);
      const journal = to.query("select nextval('public.card_change_journal_id_seq')::text");
      assert.equal(journal, from.query("select nextval('public.card_change_journal_id_seq')::text"));
    });
    check('reconstructed objects are owned by the restricted target role, not a superuser', () => {
      assert.equal(to.query(`select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls from pg_roles where rolname='${targetRole}'`), 'f');
      assert.equal(to.query(`select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','S') and pg_get_userbyid(c.relowner)<>'${targetRole}'`), '0');
    });
    check('intended RLS, grants and immutable/capture triggers behave on the reconstructed target', () => {
      for (const role of ['anon', 'authenticated']) for (const name of ['card_change_journal', 'pto_requests', 'production_comment_mutation_receipts', 'linear_intake_receipts', 'production_label_catalog_versions'])
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
    check('staged label catalog content, identity and immutable behavior survive recovery', () => {
      const staged = to.rows('select version_id, manifest_sha256, verification_state, staged_db_session from public.production_label_catalog_versions');
      assert.equal(staged.length, 1);
      assert.equal(staged[0].version_id, capture);
      assert.equal(staged[0].verification_state, 'structure_validated_only');
      assert.deepEqual(staged[0], from.rows('select version_id, manifest_sha256, verification_state, staged_db_session from public.production_label_catalog_versions')[0]);
      for (const sql of ['update public.production_label_catalog_versions set schema_version=schema_version',
        'delete from public.production_label_catalog_versions', 'truncate public.production_label_catalog_versions']) {
        assert.match(to.raw(sql).stderr, /label_catalog_immutable/, sql);
      }
      assert.equal(to.query("select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='production_label_catalog_versions' and not t.tgisinternal and t.tgenabled='O'"), '2');
      // Activation stays held on the restored copy, exactly as staged.
      assert.match(to.raw("set role service_role; select public.production_label_catalog_read_active('video');").stderr, /label_catalog_activation_held/);
      assert.match(to.raw(`set role service_role; select public.production_label_catalog_activate('${capture}'::uuid);`).stderr, /label_catalog_activation_held/);
      assert.equal(to.raw(`set role service_role; select public.production_label_catalog_read_version('${capture}'::uuid, 'video');`).status, 0);
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
    check('a POSTCOMMIT transport failure is reported committed_unverified, quarantined, with a private diagnostic', () => {
      // A drift the in-transaction verifier can see never commits (proven above).
      // The committed_unverified path is reached when the transaction COMMITS and
      // the independent post-commit read cannot be completed. Simulate exactly
      // that: a psql wrapper that forwards everything except the verify file.
      const wrapper = path.join(dir, 'psql-verify-fails.sh');
      fs.writeFileSync(wrapper, `#!/bin/sh\nfor a in "$@"; do case "$a" in *verify.sql) exit 3;; esac; done\nexec ${config.psql} "$@"\n`, { mode: 0o700 });
      const quarantined = new LocalDatabase(config); quarantined.create();
      const qRole = quarantined.name + '_target'; const qPassword = crypto.randomBytes(24).toString('hex');
      try {
        quarantined.query(TARGET_PREREQUISITES);
        quarantined.query(`create role ${qRole} login password ${literal(qPassword)};`);
        assert.equal(grants(quarantined, qRole, 'target').status, 0);
        const qEnv = connectionEnv(config, qRole, qPassword, quarantined.name);
        let error = null;
        try { reconstruct(pkg, qEnv, { psql: wrapper, diagnosticDir, targetRef: 'abcdefghijklmnopqrst' }); } catch (e) { error = e; }
        assert.ok(error); assert.equal(error.outcome, OUTCOMES.COMMITTED_UNVERIFIED);
        assert.equal(error.receipt.stage, 'post_commit_verification_transport');
        assert.equal(error.receipt.quarantine_required, true); assert.equal(error.receipt.retry_in_place_allowed, false);
        assert.ok(fs.existsSync(error.receipt.diagnostic_file));
        const written = JSON.parse(fs.readFileSync(error.receipt.diagnostic_file, 'utf8'));
        assert.equal(written.outcome, OUTCOMES.COMMITTED_UNVERIFIED);
        assert.ok(!JSON.stringify(written).includes('Final calendar'), 'diagnostic receipt must not carry row content');
        // The target really did commit: it holds the restored data.
        const state = observeTargetState(qEnv, config.psql);
        assert.equal(state.known, true); assert.ok(state.public_relations > 0);
        assert.deepEqual(rows(quarantined), original);
        // Retrying in place is refused by the empty-target guard, as designed,
        // and is classified a rollback that is NOT retryable in place.
        let retry = null; try { reconstruct(pkg, qEnv, { psql: config.psql, diagnosticDir }); } catch (e) { retry = e; }
        assert.ok(retry); assert.equal(retry.outcome, OUTCOMES.ROLLED_BACK);
        assert.match(String(retry.detail), /not empty/);
        assert.equal(retry.receipt.retry_in_place_allowed, false);
        assert.equal(retry.receipt.target_was_empty_before, false);
        assert.deepEqual(rows(quarantined), original, 'a refused retry must not disturb the quarantined target');
      } finally {
        // Discarding the disposable database IS the documented revert. Deleting
        // the package would not have been one.
        quarantined.drop(); quarantined.query(`drop role ${qRole};`, 'postgres');
      }
    });
    check('a FRESH empty target completes the documented recovery path after quarantine', () => {
      const fresh = new LocalDatabase(config); fresh.create();
      const freshRole = fresh.name + '_target'; const freshPassword = crypto.randomBytes(24).toString('hex');
      try {
        fresh.query(TARGET_PREREQUISITES);
        fresh.query(`create role ${freshRole} login password ${literal(freshPassword)};`);
        const ok = grants(fresh, freshRole, 'target'); assert.equal(ok.status, 0, ok.stderr);
        const env = connectionEnv(config, freshRole, freshPassword, fresh.name);
        const second = reconstruct(pkg, env, { psql: config.psql, diagnosticDir, targetRef: 'abcdefghijklmnopqrst' });
        assert.equal(second.outcome, OUTCOMES.VERIFIED);
        assert.equal(fresh.query(recovery.fingerprintSql()), sourceFingerprint);
        assert.equal(fresh.query("select last_value::text || '|' || is_called::text from public.synthetic_large_seq"), `${LARGE_LAST}|true`);
      } finally { fresh.drop(); fresh.query(`drop role ${freshRole};`, 'postgres'); }
    });
    check('dormant watcher evaluation classifies freshness, schema drift, verification and coverage', () => {
      const now = Date.parse(pkg.manifest.generated_at) + 60000;
      const ok = recovery.evaluateRecoveryWatch({ manifest: { ...pkg.manifest, package_sha256: sha(bytes) }, nowMs: now, liveFingerprint: sourceFingerprint,
        livePublicTableCount: 34 + pkg.manifest.omitted_data_tables.length, lastReconstruction: { ok: true, package_sha256: sha(bytes) } });
      assert.deepEqual(ok.alerts, []); assert.equal(ok.dormant, true);
      const bad = recovery.evaluateRecoveryWatch({ manifest: pkg.manifest, nowMs: now + 30 * 3600000, liveFingerprint: 'other', livePublicTableCount: 99, lastReconstruction: { ok: false } });
      assert.deepEqual(bad.alerts, ['RECOVERY_PACKAGE_STALE', 'RECOVERY_SCHEMA_MISMATCH', 'RECOVERY_VERIFICATION_FAILED', 'RECOVERY_COVERAGE_CHANGED']);
      const held = recovery.evaluateRecoveryWatch({ manifest: pkg.manifest, nowMs: now, liveFingerprint: sourceFingerprint,
        lastReconstruction: { ok: false, outcome: OUTCOMES.COMMITTED_UNVERIFIED } });
      assert.ok(held.alerts.includes('RECOVERY_VERIFICATION_COMMITTED_UNVERIFIED'));
    });
    assert.deepEqual(Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))])), pins, 'proof source changed during execution');
    const result = { status: 'PASS', passed: checks.length, checks, corpus: CORPUS, data_table_count: 34,
      omitted_data_table_count: pkg.manifest.omitted_data_tables.length, schema_statements: summary.schema_statements,
      schema_inventory: pkg.manifest.schema.inventory, callable_classes: summary.callable_classes,
      sequence_count: pkg.manifest.sequences.length, server_version: from.query('show server_version'),
      package_sha256: sha(bytes), source_sha256: pins, label_catalog_sha256: LABEL_CATALOG_SHA256,
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
