'use strict';
// Offline only: synthetic SQL text and packages. Real database proof runs in
// scripts/track-b-recovery-rehearsal.js against a disposable server.
const assert = require('assert/strict');
const crypto = require('crypto');
const backup = require('../scripts/track-b-backup');
const recovery = require('../scripts/track-b-recovery-package');
const { assertRecoveryTarget } = require('../scripts/track-b-recovery-reconstruct');
const { fixtureDump } = require('./track-b-backup-corpus');

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const hmac = crypto.randomBytes(32).toString('base64');
const CORPUS = 'history-v5';

function syntheticPreData() {
  const lines = ['\\restrict AbC123', 'SET statement_timeout = 0;', 'SET client_encoding = \'UTF8\';', "SELECT pg_catalog.set_config('search_path', '', false);",
    'SET check_function_bodies = false;', 'CREATE SCHEMA public;', "COMMENT ON SCHEMA public IS 'standard public schema';"];
  for (const table of backup.resolveCorpus(CORPUS).tables) {
    const keys = Array.isArray(table.pk) ? table.pk : [table.pk];
    lines.push(`CREATE TABLE public.${table.name} (\n    ${keys.map(key => `${key} text NOT NULL`).join(',\n    ')},\n    body text DEFAULT 'a;b'::text\n);`);
    lines.push(`GRANT SELECT ON TABLE public.${table.name} TO service_role;`);
  }
  lines.push("CREATE FUNCTION public.synthetic_fn() RETURNS trigger\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\nbegin\n  -- a ; inside a body $x$ nested $x$ stays inside\n  return null;\nend;\n$$;");
  lines.push('REVOKE ALL ON FUNCTION public.synthetic_fn() FROM PUBLIC;');
  lines.push('\\unrestrict AbC123');
  return lines.join('\n') + '\n';
}
function syntheticPostData() {
  return ['SET statement_timeout = 0;', 'ALTER TABLE ONLY public.clients\n    ADD CONSTRAINT clients_pkey PRIMARY KEY (slug);',
    'CREATE TRIGGER synthetic_after AFTER INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION public.synthetic_fn();',
    'ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;', 'CREATE POLICY synthetic_read ON public.clients FOR SELECT TO anon USING (true);',
    'CREATE INDEX synthetic_idx ON public.clients USING btree (slug);'].join('\n') + '\n';
}
function manifestFor(preData, postData, data, overrides = {}) {
  const pre = recovery.validateSchemaSection(preData); const post = recovery.validateSchemaSection(postData);
  const inspected = backup.inspectPlainDump(data, CORPUS);
  return {
    format: recovery.RECOVERY_FORMAT, recovery_version: recovery.RECOVERY_VERSION, corpus: CORPUS, corpus_version: 5,
    generated_at: new Date(Date.now() - 60000).toISOString(), completed_at: new Date().toISOString(), source_project_ref: backup.PRODUCTION_REF,
    source_commit: null, snapshot_isolation: 'synthetic', pg_dump_version: null,
    schema: { fingerprint: 'f'.repeat(32), inventory: { tables: 34 }, pre_data: { statements: pre.statements.length, skipped_platform_statements: pre.skipped },
      post_data: { statements: post.statements.length, skipped_platform_statements: post.skipped }, statement_inventory: pre.inventory, egress_capable_functions: 0 },
    data: { table_count: 33, tables: inspected }, omitted_data_tables: ['synthetic_omitted'],
    sequences: [{ name: 'card_change_journal_id_seq', last_value: 14, start_value: 1, increment_by: 1, data_type: 'bigint' }, { name: 'synthetic_untouched_seq', last_value: null, start_value: 1, increment_by: 1, data_type: 'bigint' }],
    prerequisites: { server_version: '16.13', server_version_num: 160013, roles: ['anon', 'authenticated', 'service_role'],
      required_extensions: [{ name: 'pgcrypto', schema: 'extensions', version: '1.3' }], observed_extensions: [], schemas: ['public', 'extensions'],
      realtime_publication: { present: true, all_tables: false, tables: ['calendar_posts'] }, foreign_servers: 0 },
    ...overrides,
  };
}

check('statement splitter respects dollar quotes, strings, identifiers, comments and psql meta lines', () => {
  const parts = recovery.splitSqlStatements("-- c;omment\n\\restrict X1\nSELECT 'a;b', \"q;i\", $$x;y$$, $t$z;$t$ /* n;e /* s;t */ */;\nSET a = 1;\n");
  assert.deepEqual(parts.map(p => [p.kind, p.text.slice(0, 12)]), [['meta', '\\restrict X1'], ['statement', "SELECT 'a;b'"], ['statement', 'SET a = 1']]);
  assert.throws(() => recovery.splitSqlStatements('SELECT $$open'), /Unterminated dollar/);
  assert.throws(() => recovery.splitSqlStatements('SELECT 1'), /unterminated statement/);
});
check('classifier executes only allowlisted DDL classes and skips platform-owned statements', () => {
  const accept = ['CREATE TABLE public.t (id text)', 'CREATE UNIQUE INDEX i ON public.t USING btree (id)', 'ALTER TABLE ONLY public.t ADD CONSTRAINT c PRIMARY KEY (id)',
    'ALTER TABLE public.t ENABLE ROW LEVEL SECURITY', 'ALTER TABLE public.t FORCE ROW LEVEL SECURITY', 'ALTER TABLE public.t REPLICA IDENTITY FULL',
    'ALTER TABLE public.t ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.t_id_seq START WITH 1)', 'ALTER TABLE ONLY public.t ALTER COLUMN x SET DEFAULT now()',
    'CREATE TRIGGER g AFTER INSERT OR UPDATE ON public.t FOR EACH ROW EXECUTE FUNCTION public.f()', 'CREATE POLICY p ON public.t FOR SELECT TO service_role USING (true)',
    'CREATE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $$begin return null; end$$', 'CREATE FUNCTION public.g(a text) RETURNS text LANGUAGE sql IMMUTABLE AS $$select a$$',
    'GRANT SELECT(id) ON TABLE public.t TO anon', 'GRANT SELECT,INSERT ON TABLE public.t TO service_role', 'REVOKE ALL ON FUNCTION public.f() FROM PUBLIC',
    'GRANT ALL ON FUNCTION public.f() TO service_role', 'GRANT SELECT,USAGE ON SEQUENCE public.t_id_seq TO service_role', "COMMENT ON TABLE public.t IS 'x'",
    "COMMENT ON COLUMN public.t.id IS 'x'", 'CREATE TYPE public.k AS ENUM (\'a\')', 'CREATE DOMAIN public.d AS text', 'CREATE VIEW public.v AS SELECT 1', 'ALTER TABLE public.t DISABLE TRIGGER g',
    "SET client_encoding = 'UTF8'", "SELECT pg_catalog.set_config('search_path', '', false)", 'ALTER SEQUENCE public.s OWNED BY public.t.id'];
  for (const text of accept) assert.equal(recovery.classifySchemaStatement({ text, kind: 'statement' }).action, 'execute', text);
  const skip = ['CREATE SCHEMA public', "COMMENT ON SCHEMA public IS 'x'", 'GRANT USAGE ON SCHEMA public TO anon', 'SET statement_timeout = 0', 'SET lock_timeout = 0'];
  for (const text of skip) assert.equal(recovery.classifySchemaStatement({ text, kind: 'statement' }).action, 'skip', text);
  assert.equal(recovery.classifySchemaStatement({ text: '\\restrict Abc', kind: 'meta' }).action, 'skip');
  const reject = ['ALTER TABLE public.t OWNER TO postgres', 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public', 'CREATE ROLE evil', 'ALTER ROLE anon SET x = 1',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon', 'DO $$begin end$$', 'CREATE PUBLICATION p FOR ALL TABLES',
    'CREATE SUBSCRIPTION s CONNECTION \'x\' PUBLICATION p', 'CREATE SERVER s FOREIGN DATA WRAPPER postgres_fdw', 'CREATE EVENT TRIGGER e ON ddl_command_start EXECUTE FUNCTION public.f()',
    'COPY public.t FROM PROGRAM \'id\'', 'SECURITY LABEL FOR x ON TABLE public.t IS \'y\'', 'CREATE FUNCTION public.f() RETURNS void LANGUAGE c AS \'x\', \'y\'',
    'CREATE FUNCTION public.f() RETURNS void LANGUAGE plpython3u AS $$pass$$', 'CREATE TABLE auth.users (id int)', 'CREATE TRIGGER g AFTER INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION net.http_post()',
    'GRANT SELECT ON TABLE public.t TO evil_role', 'GRANT SELECT ON TABLE public.t TO anon WITH GRANT OPTION', 'CREATE POLICY p ON public.t TO evil_role USING (true)',
    'DROP TABLE public.t', 'TRUNCATE public.t', 'SET role = anon', 'SET session_authorization = anon', 'ALTER SYSTEM SET x = 1', '\\! id', 'SELECT pg_catalog.setval(\'public.s\', 1, true)'];
  for (const text of reject) assert.equal(recovery.classifySchemaStatement({ text, kind: text.startsWith('\\') ? 'meta' : 'statement' }).action, 'reject', text);
  assert.equal(recovery.classifySchemaStatement({ text: 'GRANT SELECT ON TABLE public.t TO extra_role', kind: 'statement' }, ['extra_role']).action, 'execute');
  assert.equal(recovery.classifySchemaStatement({ text: 'CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$begin perform net.http_post(1); end$$', kind: 'statement' }).egress, true);
});
check('schema section validation counts statements, refuses disallowed classes and records egress-capable functions', () => {
  const section = recovery.validateSchemaSection(syntheticPreData());
  assert.equal(section.skipped, 5); assert.equal(section.statements.length, 3 + 33 * 2 + 2); assert.equal(section.egress_capable_functions, 0);
  assert.equal(recovery.createdTables(section.statements).size, 33);
  assert.throws(() => recovery.validateSchemaSection(syntheticPreData() + 'ALTER TABLE public.clients OWNER TO postgres;\n'), /disallowed statement \(disallowed_alter_table\)/);
  assert.throws(() => recovery.validateSchemaSection('CREATE EXTENSION pg_net;\n'), /disallowed_create_extension/);
});
const data = fixtureDump(CORPUS);
const preData = Buffer.from(syntheticPreData()); const postData = Buffer.from(syntheticPostData());
const packed = recovery.packRecoveryPackage({ preData, postData, data, manifest: manifestFor(preData, postData, data) }, hmac);
check('package round-trips with authenticated schema/data binding and exact section digests', () => {
  const pkg = recovery.readRecoveryPackage(packed.bytes, hmac);
  assert.equal(pkg.corpus, CORPUS); assert.equal(pkg.preData.toString(), preData.toString()); assert.equal(pkg.data.toString(), data.toString());
  assert.equal(pkg.manifest.binding, recovery.bindingDigest(pkg.manifest)); assert.equal(pkg.schema.pre.statements.length, 71);
  assert.equal(recovery.summarize(pkg.manifest).data_table_count, 33);
});
check('tampering, wrong key, section splice, stale/legacy meanings and non-production origin are refused', () => {
  const flipped = Buffer.from(packed.bytes); flipped[flipped.length - 1] ^= 1;
  assert.throws(() => recovery.readRecoveryPackage(flipped, hmac), /authentication failed/);
  assert.throws(() => recovery.readRecoveryPackage(packed.bytes, crypto.randomBytes(32).toString('base64')), /authentication failed/);
  assert.throws(() => recovery.readRecoveryPackage(Buffer.concat([backup.CORPORA[CORPUS].magic, packed.bytes.subarray(recovery.RECOVERY_MAGIC.length)]), hmac), /Unsupported/);
  const other = recovery.packRecoveryPackage({ preData, postData, data: Buffer.from(data.toString().replace(/\n1\t/g, '\n2\t')), manifest: manifestFor(preData, postData, data) }, hmac);
  const spliced = Buffer.concat([packed.bytes.subarray(0, packed.bytes.length - backup.HMAC_BYTES - other.manifest.data.compressed_bytes), other.bytes.subarray(other.bytes.length - backup.HMAC_BYTES - other.manifest.data.compressed_bytes)]);
  assert.throws(() => recovery.readRecoveryPackage(spliced, hmac), /authentication failed/);
  const resigned = mutate => {
    const bytes = packed.bytes; const magic = recovery.RECOVERY_MAGIC; const start = magic.length + 8; const length = Number(bytes.readBigUInt64BE(magic.length));
    const manifest = JSON.parse(bytes.subarray(start, start + length).toString()); mutate(manifest); manifest.binding = recovery.bindingDigest(manifest);
    const json = Buffer.from(backup.canonicalJson(manifest)); const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(json.length));
    const unsigned = Buffer.concat([magic, size, json, bytes.subarray(start + length, -backup.HMAC_BYTES)]);
    return Buffer.concat([unsigned, crypto.createHmac('sha256', Buffer.from(hmac, 'base64')).update(unsigned).digest()]);
  };
  assert.throws(() => recovery.readRecoveryPackage(resigned(m => { m.source_project_ref = 'abcdefghijklmnopqrst'; }), hmac), /not a production capture/);
  assert.throws(() => recovery.readRecoveryPackage(resigned(m => { m.data.sha256 = 'a'.repeat(64); }), hmac), /digest mismatch/);
  assert.throws(() => recovery.readRecoveryPackage(resigned(m => { m.schema.post_data.statements = 1; }), hmac), /statement count mismatch/);
  assert.throws(() => recovery.readRecoveryPackage(resigned(m => { m.recovery_version = 2; }), hmac), /Unsupported/);
  assert.throws(() => recovery.readRecoveryPackage(resigned(m => { m.generated_at = new Date(Date.now() + 3600000).toISOString(); }), hmac));
  assert.throws(() => backup.readSnapshotBytes(packed.bytes, hmac), /Unsupported Track-B snapshot package/);
});
check('reconstruction SQL is one transaction ordered prerequisites, pre-data, COPY, sequences, post-data with no destructive statement', () => {
  const pkg = recovery.readRecoveryPackage(packed.bytes, hmac);
  const sql = recovery.reconstructSql(pkg);
  assert.match(sql, /^begin;\n/); assert.match(sql, /\ncommit;\n$/);
  const at = text => sql.indexOf(text);
  assert.ok(at('$recovery_target$') < at('CREATE TABLE public.team_members') && at('CREATE TABLE public.team_members') < at('COPY public."team_members"'));
  assert.ok(at('COPY public."linear_intake_receipts"') < at("setval('public.card_change_journal_id_seq', 14, true)") && at('setval(') < at('CREATE TRIGGER synthetic_after'));
  assert.ok(at('CREATE TRIGGER synthetic_after') < at('\ncommit;'));
  assert.doesNotMatch(sql, /\b(TRUNCATE|DROP |CASCADE|OWNER TO|CREATE EXTENSION|CREATE SCHEMA|statement_timeout = 0)\b/i);
  assert.doesNotMatch(sql, /synthetic_untouched_seq/);
  assert.match(sql, /Track-B recovery target is not empty/); assert.match(sql, /'synthetic_missing'|pgcrypto/);
  assert.match(sql, /extname in \('pg_net','dblink','http','postgres_fdw','pg_cron'\)/); assert.match(sql, /pubname='supabase_realtime'/);
  assert.equal((sql.match(/COPY public\./g) || []).length, 33);
});
check('target prerequisite SQL refuses unsafe manifest names before embedding them', () => {
  const pkg = recovery.readRecoveryPackage(packed.bytes, hmac);
  assert.throws(() => recovery.targetPrerequisiteSql({ ...pkg.manifest, prerequisites: { ...pkg.manifest.prerequisites, roles: ["evil'; drop"] } }), /Unsafe role/);
  assert.throws(() => recovery.sequenceValueSql({ sequences: [{ name: 'x', last_value: '1; drop' }] }), /Unsafe sequence value/);
});
check('verification parsing enforces fingerprint, counts, sequences, egress and ownership', () => {
  const pkg = recovery.readRecoveryPackage(packed.bytes, hmac);
  const observed = { fingerprint: 'f'.repeat(32), sequences: JSON.stringify(pkg.manifest.sequences), egress_extensions: '0', foreign_servers: '0', realtime_tables: '0', owner_is_current_user: 'true' };
  for (const table of backup.resolveCorpus(CORPUS).tables) observed[`rows:${table.name}`] = '1';
  const receipt = recovery.verifyReconstruction(pkg.manifest, observed);
  assert.equal(receipt.schema_fingerprint_match, true); assert.equal(receipt.omitted_data_table_count, 1); assert.equal(receipt.realtime_membership_expected, 1);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, fingerprint: 'e'.repeat(32) }), /fingerprint mismatch/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, 'rows:clients': '2' }), /row-count mismatch/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, sequences: '[]' }), /sequence state mismatch/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, egress_extensions: '1' }), /egress/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, owner_is_current_user: 'f' }), /owned/);
  assert.equal(recovery.parseVerification('a\tb\nc\td\n').c, 'd'); assert.throws(() => recovery.parseVerification('broken'), /Malformed/);
});
check('dormant watcher evaluation emits public-safe alert codes and never schedules or sends', () => {
  const manifest = recovery.readRecoveryPackage(packed.bytes, hmac).manifest;
  const quiet = recovery.evaluateRecoveryWatch({ manifest: { ...manifest, package_sha256: 'p' }, liveFingerprint: manifest.schema.fingerprint, livePublicTableCount: 34, lastReconstruction: { ok: true, package_sha256: 'p' } });
  assert.deepEqual(quiet.alerts, []); assert.equal(quiet.dormant, true); assert.equal(quiet.retained_coverage.status, 'ok');
  const loud = recovery.evaluateRecoveryWatch({ manifest, nowMs: Date.parse(manifest.generated_at) + 26 * 3600000, liveFingerprint: 'x', livePublicTableCount: 35 });
  assert.deepEqual(loud.alerts, ['RECOVERY_PACKAGE_STALE', 'RECOVERY_SCHEMA_MISMATCH', 'RECOVERY_VERIFICATION_NEVER', 'RECOVERY_COVERAGE_CHANGED']);
  assert.deepEqual(recovery.evaluateRecoveryWatch({}).alerts, ['RECOVERY_PACKAGE_MISSING', 'RECOVERY_VERIFICATION_NEVER']);
  assert.ok(!JSON.stringify(loud).includes('COPY'));
});
check('reconstruct CLI guard refuses production, mismatched ref and missing confirmation; capture args pin the snapshot', () => {
  const scratch = 'postgresql://user:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';
  assert.throws(() => assertRecoveryTarget(scratch, 'abcdefghijklmnopqrst', 'SCRATCH_ONLY'), /EMPTY_SCRATCH_ONLY/);
  assert.throws(() => assertRecoveryTarget(`postgresql://user:pw@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`, backup.PRODUCTION_REF, 'EMPTY_SCRATCH_ONLY'), /forbidden/);
  assert.throws(() => assertRecoveryTarget(scratch, 'zzzzzzzzzzzzzzzzzzzz', 'EMPTY_SCRATCH_ONLY'), /does not match/);
  assert.equal(assertRecoveryTarget(scratch, 'abcdefghijklmnopqrst', 'EMPTY_SCRATCH_ONLY'), 'abcdefghijklmnopqrst');
  for (const section of ['pre-data', 'post-data']) {
    const args = recovery.pgDumpSectionArgs(section, '/tmp/x.sql', CORPUS, '00000003-00000157-1');
    assert.ok(args.includes('--snapshot=00000003-00000157-1') && args.includes('--no-owner') && args.includes('--schema=public') && args.includes(`--section=${section}`));
    assert.ok(!args.includes('--serializable-deferrable'));
  }
  assert.equal(recovery.pgDumpSectionArgs('data', '/tmp/x.sql', CORPUS, 's').filter(a => a.startsWith('--table=')).length, 33);
  assert.equal(recovery.recoveryName('2026-09-05T12:34:56.000Z'), 'syncview-track-b-recovery-20260905T123456Z.recovery');
  assert.match(recovery.sourcePreflightSql(CORPUS), /omitted incoming foreign key/); assert.doesNotMatch(recovery.sourcePreflightSql('legacy-v3'), /omitted incoming/);
});
console.log(JSON.stringify({ status: 'PASS', passed: checks.length, checks, proof: 'offline_only' }));
