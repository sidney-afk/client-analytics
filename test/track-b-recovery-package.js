'use strict';
// Offline only: synthetic SQL text and packages. Real database proof runs in
// scripts/track-b-recovery-rehearsal.js against a disposable server.
const assert = require('assert/strict');
const crypto = require('crypto');
const backup = require('../scripts/track-b-backup');
const recovery = require('../scripts/track-b-recovery-package');
const { assertRecoveryTarget, OUTCOMES } = require('../scripts/track-b-recovery-reconstruct');
const restore = require('../scripts/track-b-restore-rehearsal');
const { fixtureDump } = require('./track-b-backup-corpus');

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const hmac = crypto.randomBytes(32).toString('base64');
const CORPUS = 'history-v6';
const LARGE = '9007199254740993';

function syntheticPreData() {
  const lines = ['\\restrict AbC123', 'SET statement_timeout = 0;', 'SET client_encoding = \'UTF8\';', "SELECT pg_catalog.set_config('search_path', '', false);",
    'SET check_function_bodies = false;', 'CREATE SCHEMA public;', "COMMENT ON SCHEMA public IS 'standard public schema';"];
  for (const table of backup.resolveCorpus(CORPUS).tables) {
    const keys = Array.isArray(table.pk) ? table.pk : [table.pk];
    lines.push(`CREATE TABLE public.${table.name} (\n    ${keys.map(key => `${key} text NOT NULL`).join(',\n    ')},\n    body text DEFAULT 'a;b'::text\n);`);
    lines.push(`GRANT SELECT ON TABLE public.${table.name} TO service_role;`);
  }
  lines.push('CREATE SEQUENCE public.synthetic_large_seq AS bigint;');
  lines.push("CREATE FUNCTION public.synthetic_pure(p text) RETURNS boolean\n    LANGUAGE plpgsql IMMUTABLE\n    AS $$\nbegin\n  -- a ; inside a body $x$ nested $x$ stays inside\n  return pg_catalog.length(btrim(p)) > 0;\nend;\n$$;");
  lines.push("CREATE FUNCTION public.synthetic_trigger_fn() RETURNS trigger\n    LANGUAGE plpgsql SECURITY DEFINER\n    AS $$\nbegin\n  return null;\nend;\n$$;");
  lines.push('REVOKE ALL ON FUNCTION public.synthetic_pure(text) FROM PUBLIC;');
  lines.push('\\unrestrict AbC123');
  return lines.join('\n') + '\n';
}
function syntheticPostData() {
  return ['SET statement_timeout = 0;', 'ALTER TABLE ONLY public.clients\n    ADD CONSTRAINT clients_pkey PRIMARY KEY (slug);',
    'ALTER TABLE ONLY public.clients\n    ADD CONSTRAINT clients_body_check CHECK (public.synthetic_pure(body));',
    'CREATE TRIGGER synthetic_after AFTER INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION public.synthetic_trigger_fn();',
    'ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;', 'CREATE POLICY synthetic_read ON public.clients FOR SELECT TO anon USING (true);',
    'CREATE INDEX synthetic_idx ON public.clients USING btree (slug);'].join('\n') + '\n';
}
function manifestFor(preData, postData, data, overrides = {}) {
  const pre = recovery.validateSchemaSection(preData); const post = recovery.validateSchemaSection(postData);
  const inspected = backup.inspectPlainDump(data, CORPUS);
  for (const name of Object.keys(inspected)) inspected[name].digest_sha256 = crypto.createHash('sha256').update(name).digest('hex');
  const references = {};
  for (const item of recovery.evaluatedExpressionTexts([...pre.statements, ...post.statements])) {
    for (const token of recovery.callNamesIn(item.text)) {
      references[token] = token === 'public.synthetic_pure' ? { class: 'public_pure', name: 'synthetic_pure' }
        : token === 'extensions.digest' ? { class: 'extension', name: 'digest', extension: 'pgcrypto', schema: 'extensions' }
          : { class: 'pg_catalog', name: token.includes('.') ? token.split('.')[1] : token };
    }
  }
  references['pg_catalog.length'] = { class: 'pg_catalog', name: 'length' };
  references.btrim = { class: 'pg_catalog', name: 'btrim' };
  return {
    format: recovery.RECOVERY_FORMAT, recovery_version: recovery.RECOVERY_VERSION, corpus: CORPUS, corpus_version: 6,
    generated_at: new Date(Date.now() - 60000).toISOString(), completed_at: new Date().toISOString(), source_project_ref: backup.PRODUCTION_REF,
    source_commit: null, snapshot_isolation: 'synthetic', pg_dump_version: null,
    schema: { fingerprint: 'f'.repeat(32), inventory: { tables: 35, sequences: 1 }, pre_data: { statements: pre.statements.length, skipped_platform_statements: pre.skipped },
      post_data: { statements: post.statements.length, skipped_platform_statements: post.skipped }, statement_inventory: pre.inventory, egress_capable_functions: 0 },
    data: { table_count: 34, tables: inspected }, omitted_data_tables: ['synthetic_omitted'],
    sequences: [{ name: 'synthetic_large_seq', last_value: LARGE, is_called: true, start_value: '1', increment_by: '1', min_value: '1', max_value: '9223372036854775807', data_type: 'bigint' }],
    callable_references: references,
    prerequisites: { server_version: '16.13', server_version_num: 160013, roles: ['anon', 'authenticated', 'service_role'],
      required_extensions: [{ name: 'pgcrypto', schema: 'extensions', version: '1.3' }], observed_extensions: [], schemas: ['public', 'extensions'],
      extension_function_contract: [...recovery.EXTENSION_FUNCTION_CONTRACT],
      realtime_publication: { present: true, all_tables: false, tables: ['calendar_posts'] }, foreign_servers: 0 },
    ...overrides,
  };
}
function resign(bytes, mutate) {
  const magic = recovery.RECOVERY_MAGIC; const start = magic.length + 8; const length = Number(bytes.readBigUInt64BE(magic.length));
  const manifest = JSON.parse(bytes.subarray(start, start + length).toString('utf8'));
  mutate(manifest); manifest.binding = recovery.bindingDigest(manifest);
  const json = Buffer.from(backup.canonicalJson(manifest)); const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(json.length));
  const unsigned = Buffer.concat([magic, size, json, bytes.subarray(start + length, -backup.HMAC_BYTES)]);
  return Buffer.concat([unsigned, crypto.createHmac('sha256', Buffer.from(hmac, 'base64')).update(unsigned).digest()]);
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
    'DROP TABLE public.t', 'TRUNCATE public.t', 'SET role = anon', 'SET session_authorization = anon', 'ALTER SYSTEM SET x = 1', '\\! id', 'SELECT pg_catalog.setval(\'public.s\', 1, true)',
    "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS 'quoted body'"];
  for (const text of reject) assert.equal(recovery.classifySchemaStatement({ text, kind: text.startsWith('\\') ? 'meta' : 'statement' }).action, 'reject', text);
  assert.equal(recovery.classifySchemaStatement({ text: 'GRANT SELECT ON TABLE public.t TO extra_role', kind: 'statement' }, ['extra_role']).action, 'execute');
});
check('ACL classification validates EVERY target and rejects multi-target or cross-schema grants', () => {
  // The confirmed 8fa parser boundary: a comma-separated target list, and any
  // target outside `public`, must both be refused however the roles look.
  const gaps = ['GRANT SELECT ON TABLE public.review_card, auth.users TO anon',
    'GRANT SELECT ON TABLE auth.users TO anon',
    'GRANT SELECT ON TABLE public.review_card, public.other TO anon',
    'GRANT SELECT ON TABLE public.review_card, auth.users TO service_role',
    'REVOKE ALL ON FUNCTION public.f(), auth.g() FROM PUBLIC',
    'GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon',
    'GRANT SELECT ON TABLE public.t TO anon GRANTED BY postgres'];
  for (const text of gaps) {
    const verdict = recovery.classifySchemaStatement({ text, kind: 'statement' });
    assert.equal(verdict.action, 'reject', text);
  }
  assert.equal(recovery.classifySchemaStatement({ text: 'GRANT SELECT ON TABLE public.t TO anon, service_role', kind: 'statement' }).action, 'execute');
  assert.equal(recovery.classifySchemaStatement({ text: 'GRANT ALL ON FUNCTION public.f(a jsonb, b text) TO service_role', kind: 'statement' }).action, 'execute');
});
check('function purity contract admits an immutable invoker body and refuses every impure shape', () => {
  const pure = recovery.functionPurity("CREATE FUNCTION public.ok(a text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$select btrim(a) <> ''$$;");
  assert.equal(pure.pure, true); assert.equal(pure.name, 'ok'); assert.ok(pure.calls.includes('btrim'));
  const cases = [
    ['CREATE FUNCTION public.a() RETURNS void LANGUAGE plpgsql AS $$begin insert into public.t values (1); end$$;', 'writing_statement'],
    ['CREATE FUNCTION public.b() RETURNS void LANGUAGE plpgsql AS $$begin end$$;', 'not_immutable'],
    ['CREATE FUNCTION public.c() RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER AS $$begin end$$;', 'security_definer'],
    ['CREATE FUNCTION public.d() RETURNS void LANGUAGE c IMMUTABLE AS $$x$$;', 'language'],
  ];
  for (const [text, reason] of cases) {
    const verdict = recovery.functionPurity(text);
    assert.equal(verdict.pure, false, text); assert.ok(verdict.reasons.includes(reason), `${reason} in ${verdict.reasons}`);
  }
});
check('classifyCallable refuses denylisted, impure, unpinned-extension, volatile and foreign-schema callables', () => {
  const pinned = new Set(['pgcrypto']);
  const pureHit = { token: 'public.p', schema: 'public', name: 'p', volatility: 'i', security_definer: false, language: 'sql', extension: null, body: 'select 1', body_sha256: 'a' };
  assert.equal(recovery.classifyCallable('public.p', [pureHit], pinned, new Set(), () => {}).class, 'public_pure');
  assert.equal(recovery.classifyCallable('now', [{ token: 'now', schema: 'pg_catalog', name: 'now', volatility: 's', security_definer: false, language: 'internal', extension: null, body: '', body_sha256: 'b' }], pinned, new Set(), () => {}).class, 'pg_catalog');
  assert.equal(recovery.classifyCallable('unknown_token', [], pinned, new Set(), () => {}).class, 'not_a_function');
  assert.throws(() => recovery.classifyCallable('pg_read_file', [{ token: 'pg_read_file', schema: 'pg_catalog', name: 'pg_read_file', volatility: 'v', security_definer: false, language: 'internal', extension: null, body: '', body_sha256: 'c' }], pinned, new Set(), () => {}), /denylisted/);
  assert.throws(() => recovery.classifyCallable('public.p', [{ ...pureHit, volatility: 'v' }], pinned, new Set(), () => {}), /impure public callable/);
  assert.throws(() => recovery.classifyCallable('public.p', [{ ...pureHit, security_definer: true }], pinned, new Set(), () => {}), /impure public callable/);
  assert.throws(() => recovery.classifyCallable('public.p', [{ ...pureHit, body: 'begin update public.t set a=1; end' }], pinned, new Set(), () => {}), /writing statement/);
  assert.throws(() => recovery.classifyCallable('extensions.d', [{ token: 'extensions.d', schema: 'extensions', name: 'd', volatility: 'i', security_definer: false, language: 'c', extension: 'other', body: '', body_sha256: 'd' }], pinned, new Set(), () => {}), /unpinned extension/);
  assert.throws(() => recovery.classifyCallable('extensions.v', [{ token: 'extensions.v', schema: 'extensions', name: 'v', volatility: 'v', security_definer: false, language: 'c', extension: 'pgcrypto', body: '', body_sha256: 'e' }], pinned, new Set(), () => {}), /volatile extension callable/);
  assert.throws(() => recovery.classifyCallable('auth.x', [{ token: 'auth.x', schema: 'auth', name: 'x', volatility: 'i', security_definer: false, language: 'sql', extension: null, body: '', body_sha256: 'f' }], pinned, new Set(), () => {}), /unsupported schema/);
  assert.equal(recovery.classifyCallable('gen_random_uuid', [{ token: 'gen_random_uuid', schema: 'extensions', name: 'gen_random_uuid', volatility: 'v', security_definer: false, language: 'c', extension: 'pgcrypto', body: '', body_sha256: 'g' }], pinned, new Set(), () => {}).class, 'extension');
});
check('exact sequence state validation accepts full-width decimals and refuses every malformed shape', () => {
  const good = { name: 'synthetic_large_seq', last_value: LARGE, is_called: false, start_value: '1', increment_by: '1', min_value: '1', max_value: '9223372036854775807', data_type: 'bigint' };
  assert.deepEqual(recovery.validateSequenceState(good), { name: 'synthetic_large_seq', last_value: LARGE, is_called: false });
  assert.notEqual(String(Number(LARGE)), LARGE, 'the fixture value must be outside exact IEEE-754 integers');
  assert.throws(() => recovery.validateSequenceState({ ...good, last_value: Number(LARGE) }), /Unsafe sequence value/);
  assert.throws(() => recovery.validateSequenceState({ ...good, last_value: '9223372036854775808' }), /out of range/);
  assert.throws(() => recovery.validateSequenceState({ ...good, last_value: '92233720368547758079' }), /Unsafe sequence value/);
  assert.throws(() => recovery.validateSequenceState({ ...good, last_value: '01' }), /Unsafe sequence value/);
  assert.throws(() => recovery.validateSequenceState({ ...good, is_called: 'true' }), /is_called must be an explicit boolean/);
  assert.throws(() => recovery.validateSequenceState({ ...good, is_called: undefined }), /is_called must be an explicit boolean/);
  assert.throws(() => recovery.validateSequenceState({ ...good, data_type: 'numeric' }), /Unsupported sequence data type/);
  assert.throws(() => recovery.validateSequenceState({ ...good, data_type: 'smallint', max_value: '9223372036854775807' }), /out of range/);
  assert.throws(() => recovery.validateSequenceState({ ...good, name: 'bad name' }), /Unsafe sequence name/);
  assert.equal(recovery.sequenceValueSql({ sequences: [good] })[0], "select pg_catalog.setval('public.synthetic_large_seq', '9007199254740993'::bigint, false);");
  assert.equal(recovery.sequenceValueSql({ sequences: [{ ...good, is_called: true }] })[0], "select pg_catalog.setval('public.synthetic_large_seq', '9007199254740993'::bigint, true);");
  // An uncalled sequence is still emitted: its state is not "absent".
  assert.equal(recovery.sequenceValueSql({ sequences: [{ ...good, last_value: '9000', is_called: false }] }).length, 1);
});
check('schema section validation counts statements, refuses disallowed classes and records egress-capable functions', () => {
  const section = recovery.validateSchemaSection(syntheticPreData());
  assert.equal(section.skipped, 5); assert.equal(section.egress_capable_functions, 0);
  assert.equal(recovery.createdTables(section.statements).size, 34);
  assert.throws(() => recovery.validateSchemaSection(syntheticPreData() + 'ALTER TABLE public.clients OWNER TO postgres;\n'), /disallowed statement \(disallowed_alter_table\)/);
  assert.throws(() => recovery.validateSchemaSection('CREATE EXTENSION pg_net;\n'), /disallowed_create_extension/);
});
const data = fixtureDump(CORPUS);
const preData = Buffer.from(syntheticPreData()); const postData = Buffer.from(syntheticPostData());
const packed = recovery.packRecoveryPackage({ preData, postData, data, manifest: manifestFor(preData, postData, data) }, hmac);
check('package round-trips with authenticated schema/data/sequence/callable binding', () => {
  const pkg = recovery.readRecoveryPackage(packed.bytes, hmac);
  assert.equal(pkg.corpus, CORPUS); assert.equal(pkg.preData.toString(), preData.toString()); assert.equal(pkg.data.toString(), data.toString());
  assert.equal(pkg.manifest.binding, recovery.bindingDigest(pkg.manifest));
  assert.equal(pkg.manifest.recovery_version, 2);
  assert.equal(recovery.summarize(pkg.manifest).data_table_count, 34);
  assert.equal(recovery.summarize(pkg.manifest).sequence_count, 1);
  assert.ok(pkg.callable.evaluated_references > 0);
  assert.ok(pkg.callable.pure_functions.includes('synthetic_pure'));
});
check('tampering, wrong key, section splice, legacy version and non-production origin are refused', () => {
  const flipped = Buffer.from(packed.bytes); flipped[flipped.length - 1] ^= 1;
  assert.throws(() => recovery.readRecoveryPackage(flipped, hmac), /authentication failed/);
  assert.throws(() => recovery.readRecoveryPackage(packed.bytes, crypto.randomBytes(32).toString('base64')), /authentication failed/);
  assert.throws(() => recovery.readRecoveryPackage(Buffer.concat([backup.CORPORA[CORPUS].magic, packed.bytes.subarray(recovery.RECOVERY_MAGIC.length)]), hmac), /Unsupported/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.source_project_ref = 'abcdefghijklmnopqrst'; }), hmac), /not a production capture/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.data.sha256 = 'a'.repeat(64); }), hmac), /digest mismatch/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.schema.post_data.statements = 1; }), hmac), /statement count mismatch/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.generated_at = new Date(Date.now() + 3600000).toISOString(); }), hmac));
  assert.throws(() => backup.readSnapshotBytes(packed.bytes, hmac), /Unsupported Track-B snapshot package/);
  // Version 1 carried a lossy sequence projection: refuse, never reinterpret.
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.recovery_version = 1; }), hmac), /version 1 is refused/);
  assert.ok(recovery.LEGACY_RECOVERY_VERSIONS[1].includes('lossy sequence'));
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.recovery_version = 3; }), hmac), /Unsupported/);
});
check('a re-signed manifest that drops a digest, a sequence or a callable class is refused', () => {
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { delete m.data.tables.clients.digest_sha256; }), hmac), /lacks a content digest/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.data.tables.clients.digest_sha256 = 'zz'; }), hmac), /lacks a content digest/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.sequences = []; }), hmac), /lacks the state of a package sequence/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.sequences[0].is_called = 'yes'; }), hmac), /is_called must be an explicit boolean/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { delete m.callable_references['public.synthetic_pure']; }), hmac), /outside the manifest contract/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.callable_references['public.synthetic_pure'] = { class: 'pg_catalog', name: 'pg_read_file' }; }), hmac), /denylisted catalog function/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.callable_references['public.synthetic_pure'] = { class: 'extension', name: 'synthetic_pure', extension: 'absent', schema: 'extensions' }; }), hmac), /unpinned extension/);
  assert.throws(() => recovery.readRecoveryPackage(resign(packed.bytes, m => { m.callable_references['public.synthetic_pure'] = { class: 'invented', name: 'synthetic_pure' }; }), hmac), /unsupported class/);
});
check('a package whose pure function is not actually pure is refused at read time', () => {
  const impurePre = Buffer.from(syntheticPreData().replace(
    'CREATE FUNCTION public.synthetic_pure(p text) RETURNS boolean\n    LANGUAGE plpgsql IMMUTABLE',
    'CREATE FUNCTION public.synthetic_pure(p text) RETURNS boolean\n    LANGUAGE plpgsql'));
  const impure = recovery.packRecoveryPackage({ preData: impurePre, postData, data, manifest: manifestFor(impurePre, postData, data) }, hmac);
  assert.throws(() => recovery.readRecoveryPackage(impure.bytes, hmac), /violates the purity contract/);
});
check('reconstruction SQL is one transaction: prerequisites, pre-data, COPY, sequences, post-data, verification, commit', () => {
  const pkg = recovery.readRecoveryPackage(packed.bytes, hmac);
  const sql = recovery.reconstructSql(pkg);
  assert.match(sql, /^begin;\n/); assert.match(sql, /\ncommit;\n$/);
  const at = text => sql.indexOf(text);
  assert.ok(at('$recovery_target$') < at('CREATE TABLE public.team_members'));
  assert.ok(at('CREATE TABLE public.team_members') < at('COPY public."team_members"'));
  assert.ok(at('COPY public."production_label_catalog_versions"') < at("setval('public.synthetic_large_seq'"));
  assert.ok(at("setval('public.synthetic_large_seq'") < at('CREATE TRIGGER synthetic_after'));
  // Verification precedes COMMIT, so a detectable mismatch can never commit.
  assert.ok(at('$recovery_verify$') > at('CREATE TRIGGER synthetic_after'));
  assert.ok(at('$recovery_verify$') < sql.lastIndexOf('commit;'));
  assert.doesNotMatch(sql, /\b(TRUNCATE|DROP |CASCADE|OWNER TO|CREATE EXTENSION|CREATE SCHEMA|statement_timeout = 0)\b/i);
  assert.equal((sql.match(/COPY public\./g) || []).length, 34);
  assert.match(sql, /Track-B recovery target is not empty/);
  assert.match(sql, /rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolreplication/);
  assert.match(sql, /pg_read_server_files/);
  assert.match(sql, /can execute a dangerous catalog function/);
  assert.match(sql, /lacks EXECUTE on a contract callable/);
  assert.match(sql, /resolves a name the source did not/);
  assert.match(sql, /egress-capable schema/);
  assert.match(sql, /search_path', 'public'/);
});
check('in-transaction verification checks fingerprint, per-table digests, sequences and ownership', () => {
  const pkg = recovery.readRecoveryPackage(packed.bytes, hmac);
  const sql = recovery.inTransactionVerificationSql(pkg.manifest);
  assert.match(sql, /schema fingerprint mismatch/); assert.match(sql, /content digest mismatch/);
  assert.match(sql, /row count mismatch/); assert.match(sql, /sequence state mismatch/);
  assert.match(sql, /ownership mismatch/); assert.match(sql, /egress capability appeared/);
  assert.match(sql, new RegExp(`'${LARGE}'`));
  assert.equal((sql.match(/content digest mismatch/g) || []).length, 34);
});
check('target prerequisite SQL refuses unsafe manifest names before embedding them', () => {
  const pkg = recovery.readRecoveryPackage(packed.bytes, hmac);
  assert.throws(() => recovery.targetPrerequisiteSql({ ...pkg.manifest, prerequisites: { ...pkg.manifest.prerequisites, roles: ["evil'; drop"] } }), /Unsafe role/);
  assert.throws(() => recovery.sequenceValueSql({ sequences: [{ name: 'x', last_value: '1; drop', is_called: true, data_type: 'bigint', min_value: '1', max_value: '9', start_value: '1', increment_by: '1' }] }), /Unsafe sequence value/);
  assert.throws(() => recovery.targetPrerequisiteSql({ ...pkg.manifest, callable_references: { x: { class: 'pg_catalog', name: "evil'; drop" } } }), /Unsafe callable name/);
});
check('post-commit verification parsing enforces fingerprint, digests, sequences, egress and ownership', () => {
  const pkg = recovery.readRecoveryPackage(packed.bytes, hmac);
  const observed = { fingerprint: 'f'.repeat(32), egress_extensions: '0', foreign_servers: '0', realtime_tables: '0', owner_is_current_user: 'true',
    sequence_count: '1', 'seq:synthetic_large_seq': `${LARGE}|true`, extension_executable_beyond_contract: '0', extension_public_default_execute: '7' };
  for (const table of backup.resolveCorpus(CORPUS).tables) { observed[`rows:${table.name}`] = '1'; observed[`digest:${table.name}`] = pkg.manifest.data.tables[table.name].digest_sha256; }
  const receipt = recovery.verifyReconstruction(pkg.manifest, observed);
  assert.equal(receipt.schema_fingerprint_match, true); assert.equal(receipt.content_digests_match, true);
  assert.equal(receipt.omitted_data_table_count, 1); assert.equal(receipt.sequence_count, 1);
  assert.equal(receipt.extension_public_default_execute, 7);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, fingerprint: 'e'.repeat(32) }), /fingerprint mismatch/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, 'rows:clients': '2' }), /row-count mismatch/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, 'digest:clients': 'a'.repeat(64) }), /content digest mismatch/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, 'seq:synthetic_large_seq': `${LARGE}|false` }), /sequence state mismatch/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, sequence_count: '2' }), /sequence count mismatch/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, egress_extensions: '1' }), /egress/);
  assert.throws(() => recovery.verifyReconstruction(pkg.manifest, { ...observed, owner_is_current_user: 'false' }), /owned/);
  assert.equal(recovery.parseVerification('a\tb\nc\td\n').c, 'd'); assert.throws(() => recovery.parseVerification('broken'), /Malformed/);
});
check('v3/v4/v5 keep their exact meaning; v6 adds only the staged catalog and refuses the destructive path', () => {
  assert.equal(backup.TABLES.length, 14); assert.equal(backup.HISTORY_TABLES.length, 21);
  assert.equal(backup.CLOSED_HISTORY_TABLES.length, 33); assert.equal(backup.STAGED_CATALOG_TABLES.length, 34);
  assert.deepEqual(backup.CLOSED_HISTORY_TABLES.map(t => t.name), backup.STAGED_CATALOG_TABLES.slice(0, 33).map(t => t.name));
  assert.equal(backup.STAGED_CATALOG_TABLES.at(-1).name, 'production_label_catalog_versions');
  assert.equal(backup.STAGED_CATALOG_TABLES.at(-1).pk, 'version_id');
  assert.equal(backup.resolveCorpus('history-v6').version, 6);
  assert.equal(backup.resolveCorpus('history-v6').recovery_package_only, true);
  // Its rows are protected by UPDATE/DELETE/TRUNCATE triggers, so the
  // TRUNCATE + disable-triggers path must refuse it rather than bypass them.
  assert.throws(() => restore.restoreSql(fixtureDump('history-v6'), 'history-v6'), /must restore through the recovery package/);
  assert.doesNotThrow(() => restore.restoreSql(fixtureDump('history-v5'), 'history-v5'));
  assert.doesNotThrow(() => restore.restoreSql(fixtureDump('legacy-v3'), 'legacy-v3'));
  assert.throws(() => backup.parseStrictPgDump(fixtureDump('history-v6'), 'history-v5'), /Unexpected table/);
  assert.throws(() => backup.parseStrictPgDump(fixtureDump('history-v5'), 'history-v6'), /missing/);
});
check('dormant watcher evaluation emits public-safe alert codes and never schedules or sends', () => {
  const manifest = recovery.readRecoveryPackage(packed.bytes, hmac).manifest;
  const quiet = recovery.evaluateRecoveryWatch({ manifest: { ...manifest, package_sha256: 'p' }, liveFingerprint: manifest.schema.fingerprint, livePublicTableCount: 35, lastReconstruction: { ok: true, package_sha256: 'p' } });
  assert.deepEqual(quiet.alerts, []); assert.equal(quiet.dormant, true); assert.equal(quiet.retained_coverage.status, 'ok');
  const loud = recovery.evaluateRecoveryWatch({ manifest, nowMs: Date.parse(manifest.generated_at) + 26 * 3600000, liveFingerprint: 'x', livePublicTableCount: 99 });
  assert.deepEqual(loud.alerts, ['RECOVERY_PACKAGE_STALE', 'RECOVERY_SCHEMA_MISMATCH', 'RECOVERY_VERIFICATION_NEVER', 'RECOVERY_COVERAGE_CHANGED']);
  assert.deepEqual(recovery.evaluateRecoveryWatch({}).alerts, ['RECOVERY_PACKAGE_MISSING', 'RECOVERY_VERIFICATION_NEVER']);
  const held = recovery.evaluateRecoveryWatch({ manifest, liveFingerprint: manifest.schema.fingerprint, lastReconstruction: { ok: false, outcome: 'committed_unverified' } });
  assert.ok(held.alerts.includes('RECOVERY_VERIFICATION_COMMITTED_UNVERIFIED'));
  assert.ok(!JSON.stringify(loud).includes('COPY'));
});
check('reconstruct CLI guard refuses production, mismatched ref and missing confirmation; capture args pin the snapshot', () => {
  const scratch = 'postgresql://user:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';
  assert.throws(() => assertRecoveryTarget(scratch, 'abcdefghijklmnopqrst', 'SCRATCH_ONLY'), /EMPTY_SCRATCH_ONLY/);
  assert.throws(() => assertRecoveryTarget(`postgresql://user:pw@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`, backup.PRODUCTION_REF, 'EMPTY_SCRATCH_ONLY'), /forbidden/);
  assert.throws(() => assertRecoveryTarget(scratch, 'zzzzzzzzzzzzzzzzzzzz', 'EMPTY_SCRATCH_ONLY'), /does not match/);
  assert.equal(assertRecoveryTarget(scratch, 'abcdefghijklmnopqrst', 'EMPTY_SCRATCH_ONLY'), 'abcdefghijklmnopqrst');
  assert.deepEqual(Object.values(OUTCOMES).sort(), ['committed_unverified', 'rolled_back', 'verified']);
  for (const section of ['pre-data', 'post-data']) {
    const args = recovery.pgDumpSectionArgs(section, '/tmp/x.sql', CORPUS, '00000003-00000157-1');
    assert.ok(args.includes('--snapshot=00000003-00000157-1') && args.includes('--no-owner') && args.includes('--schema=public') && args.includes(`--section=${section}`));
    assert.ok(!args.includes('--serializable-deferrable'));
  }
  assert.equal(recovery.pgDumpSectionArgs('data', '/tmp/x.sql', CORPUS, 's').filter(a => a.startsWith('--table=')).length, 34);
  assert.equal(recovery.recoveryName('2026-09-05T12:34:56.000Z'), 'syncview-track-b-recovery-20260905T123456Z.recovery');
  assert.match(recovery.sourcePreflightSql(CORPUS), /omitted incoming foreign key/);
  assert.doesNotMatch(recovery.sourcePreflightSql('legacy-v3'), /omitted incoming/);
  assert.match(recovery.sequenceStateSql('synthetic_large_seq'), /is_called/);
  assert.throws(() => recovery.sequenceStateSql('bad name'), /Unsafe sequence name/);
});
console.log(JSON.stringify({ status: 'PASS', passed: checks.length, checks, proof: 'offline_only' }));
