'use strict';
// Actual exported capture/reader classifiers and authenticated synthetic bytes.
// No SQL execution, target privilege, installation or serving claim.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const recovery = require('../scripts/track-b-recovery-package');
const backup = require('../scripts/track-b-backup');
const { fixtureDump } = require('./track-b-backup-corpus');
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
const manifest = refs => ({ callable_references: refs, prerequisites: { required_extensions: [{ name: 'pgcrypto', schema: 'extensions', version: '1.3' }] } });
const fn = (name, body, mode = 'STABLE', language = 'plpgsql') => `CREATE FUNCTION public.${name}() RETURNS integer LANGUAGE ${language} ${mode} SECURITY INVOKER AS $body$${body}$body$`;
const stable = (name = 'reader') => ({ class: 'public_stable_view', name });
const pure = (name = 'helper') => ({ class: 'public_pure', name });
const builtin = (name, volatility = 'i', security_definer = false) => ({ class: 'pg_catalog', name, volatility, security_definer });
const hit = (body, overrides = {}) => ({ schema: 'public', name: 'reader', language: 'plpgsql', volatility: 's', security_definer: false, body, body_sha256: crypto.createHash('sha256').update(String(body)).digest('hex'), ...overrides });
const classify = (body, overrides = {}, options = { allowStableView: true }) => recovery.classifyCallable('public.reader', [hit(body, overrides)], new Set(['pgcrypto']), new Set(), () => {}, options);
const view = 'CREATE VIEW public.synthetic_view AS SELECT public.reader()';
const reader = fn('reader', 'BEGIN RETURN 1; END');
const refs = { 'public.reader': stable() };
const verify = (statements, references = refs) => recovery.verifyCallableContract(statements, manifest(references));

check('stable invoker ordinary view passes with separately named class', () => {
  assert.equal(classify('BEGIN RETURN 1; END').class, 'public_stable_view');
  assert.deepEqual(verify([reader, view]).stable_view_functions, ['reader']);
  assert.deepEqual(verify([reader, view]).pure_functions, []);
});
check('existing strict classifier APIs still refuse stable public functions', () => {
  assert.equal(recovery.functionPurity(reader).pure, false);
  assert.throws(() => classify('BEGIN RETURN 1; END', {}, {}), /impure public callable/);
});
check('actual debt reader body needs only metadata correction; missing-control raise retained', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-09-06-linear-outbound-cutoff.sql'), 'utf8');
  const definition = sql.match(/create function public\.linear_outbound_cutoff_debt_rows_v1\(\)[\s\S]*?\$fn\$;/i)?.[0];
  assert.ok(definition, 'actual owner function must exist');
  const corrected = definition.replace(/language plpgsql(?: stable)? security (?:definer|invoker)/i, 'language plpgsql stable security invoker');
  const body = corrected.split('$fn$')[1];
  assert.match(body, /raise exception 'linear_cutoff_control_unavailable'/);
  assert.match(body, /return query select/i);
  assert.equal(recovery.functionPurity(corrected, { allowStableView: true }).pure, true);
  assert.equal(classify(body).class, 'public_stable_view');
  assert.throws(() => classify(body, { volatility: 'v', security_definer: true }), /impure/);
  assert.deepEqual(verify([corrected, 'CREATE VIEW public.debt AS SELECT * FROM public.linear_outbound_cutoff_debt_rows_v1()'], {
    'public.linear_outbound_cutoff_debt_rows_v1': stable('linear_outbound_cutoff_debt_rows_v1'),
  }).stable_view_functions, ['linear_outbound_cutoff_debt_rows_v1']);
});

const loadExpressions = {
  check: 'ALTER TABLE public.t ADD CONSTRAINT safe CHECK (public.reader()>0)',
  default: 'ALTER TABLE public.t ALTER COLUMN n SET DEFAULT public.reader()',
  index: 'CREATE INDEX synthetic_idx ON public.t USING btree (public.reader())',
  index_predicate: 'CREATE INDEX synthetic_idx ON public.t USING btree (n) WHERE public.reader()>0',
  generated: 'CREATE TABLE public.t (n integer GENERATED ALWAYS AS (public.reader()) STORED)',
  inline_default: 'CREATE TABLE public.t (n integer DEFAULT public.reader())',
  domain: 'CREATE DOMAIN public.t AS integer CHECK(public.reader()>0)',
  materialized_view: 'CREATE MATERIALIZED VIEW public.mv AS SELECT public.reader() WITH NO DATA',
};
for (const [kind, expression] of Object.entries(loadExpressions)) {
  check(`stable ${kind} refuses in both visitation orders despite prior view approval`, () => {
    assert.throws(() => verify([reader, view, expression]), /only in an ordinary view/);
    assert.throws(() => verify([reader, expression, view]), /only in an ordinary view/);
  });
}
check('materialized view gets distinct capture and reader kind', () => {
  assert.equal(recovery.evaluatedExpressionTexts([loadExpressions.materialized_view])[0].kind, 'materialized_view');
  assert.match(recovery.evaluatedSourceTextsSql(), /when 'v' then 'view' else 'materialized_view'/);
});
check('line comments in ordinary views cannot swallow a later executed callable', () => {
  const expression = 'CREATE VIEW public.v AS -- ordinary comment\nSELECT public.reader()';
  assert.throws(() => verify([reader, expression], {}), /outside the manifest/);
  assert.deepEqual(verify([reader, expression]).stable_view_functions, ['reader']);
});

for (const overrides of [{ volatility: 'v' }, { volatility: 'unknown' }, { security_definer: true }, { security_definer: undefined }, { language: 'c' }]) {
  check('stable candidate rejects unsafe metadata ' + JSON.stringify(overrides), () => assert.throws(() => classify('BEGIN RETURN 1; END', overrides), /impure/));
}
for (const body of [
  'BEGIN INSERT INTO public.t VALUES(1); RETURN 1; END',
  'BEGIN UPDATE public.t SET n=1; RETURN 1; END',
  'BEGIN DELETE FROM public.t; RETURN 1; END',
  'BEGIN PERFORM public.writer(); RETURN 1; END',
  "BEGIN EXECUTE 'SELECT 1'; RETURN 1; END",
  'BEGIN LOCK TABLE public.t; RETURN 1; END',
  'BEGIN SELECT n FROM public.t FOR SHARE; RETURN 1; END',
  'BEGIN SELECT n FROM public.t FOR KEY SHARE; RETURN 1; END',
  "BEGIN marker := '/*'; PERFORM public.writer(); marker := '*/'; RETURN 1; END",
]) {
  check('capture and reader refuse executed write or lock ' + checks.length, () => {
    assert.throws(() => classify(body), /writing statement|locking/);
    assert.throws(() => verify([fn('reader', body), view]), /purity contract/);
  });
}
check('stable SQL SELECT INTO refuses while PLpgSQL local INTO remains admissible', () => {
  assert.throws(() => classify('SELECT 1 INTO public.new_table', { language: 'sql' }), /SQL INTO/);
  assert.throws(() => verify([fn('reader', 'SELECT 1 INTO public.new_table', 'STABLE', 'sql'), view]), /purity contract/);
  assert.equal(classify('DECLARE n integer; BEGIN SELECT 1 INTO n; RETURN n; END').class, 'public_stable_view');
});
check('transitive quoted writing function cannot masquerade as an immutable helper', () => {
  const wrapper = fn('reader', 'BEGIN RETURN public."helper"(); END');
  const writer = fn('helper', 'BEGIN DELETE FROM public.t; RETURN 1; END', 'IMMUTABLE');
  assert.throws(() => verify([wrapper, writer, view], { ...refs, 'public.helper': pure() }), /purity contract/);
});
check('stable to immutable to nonvolatile catalog closure passes', () => {
  const wrapper = fn('reader', 'BEGIN RETURN public.helper(); END');
  const helper = fn('helper', "SELECT pg_catalog.length('a')", 'IMMUTABLE', 'sql');
  const result = verify([wrapper, helper, view], { ...refs, 'public.helper': pure(), 'pg_catalog.length': builtin('length') });
  assert.deepEqual(result.pure_functions, ['helper']);
});
check('immutable wrapper cannot smuggle a stable callee into load expressions', () => {
  const wrapper = fn('helper', 'SELECT public.reader()', 'IMMUTABLE', 'sql');
  const references = { ...refs, 'public.helper': pure() };
  const wrapperView = 'CREATE VIEW public.v AS SELECT public.helper()';
  assert.deepEqual(verify([reader, wrapper, wrapperView], references).stable_view_functions, ['reader']);
  assert.throws(() => verify([reader, wrapper, wrapperView, 'CREATE TABLE public.t (n integer DEFAULT public.helper())'], references), /only in an ordinary view/);
});
for (const [body, language] of [['BEGIN SELECT n FROM public.t FOR SHARE; RETURN 1; END', 'plpgsql'], ['SELECT 1 INTO public.new_table', 'sql']]) {
  check('immutable declaration cannot hide a locking/INTO dependency inside stable view ' + language, () => {
    const wrapper = fn('reader', 'BEGIN RETURN public.helper(); END');
    const helper = fn('helper', body, 'IMMUTABLE', language);
    assert.throws(() => verify([helper, wrapper, view], { ...refs, 'public.helper': pure() }), /locking or SQL INTO/);
  });
}
for (const name of ['nextval', 'pg_notify', 'pg_advisory_lock']) {
  check('stable closure refuses dangerous or volatile catalog callee ' + name, () => {
    const body = fn('reader', `BEGIN RETURN pg_catalog.${name}(); END`);
    assert.throws(() => verify([body, view], { ...refs, ['pg_catalog.' + name]: builtin(name, 'v') }), /denylisted|nonvolatile/);
  });
}
check('earlier immutable visit cannot bypass later stable closure volatile-callee check', () => {
  const helper = fn('helper', "SELECT pg_catalog.nextval('synthetic_seq')", 'IMMUTABLE', 'sql');
  const wrapper = fn('reader', 'BEGIN RETURN public.helper(); END');
  const references = { ...refs, 'public.helper': pure(), 'pg_catalog.nextval': builtin('nextval', 'v') };
  const oldDefault = 'CREATE TABLE public.t (n bigint DEFAULT public.helper())';
  assert.deepEqual(verify([helper, oldDefault], references).pure_functions, ['helper']);
  assert.throws(() => verify([helper, wrapper, oldDefault, view], references), /nonvolatile/);
});
check('legacy direct nextval default still passes; stable closure cannot reuse it', () => {
  const reference = { 'pg_catalog.nextval': { class: 'pg_catalog', name: 'nextval' } };
  assert.equal(verify(["CREATE TABLE public.t (n bigint DEFAULT pg_catalog.nextval('s'))"], reference).evaluated_references, 1);
  assert.throws(() => verify([fn('reader', 'BEGIN RETURN pg_catalog.nextval(); END'), view], { ...refs, ...reference }), /nonvolatile/);
});
for (const metadata of [{}, { volatility: 'i' }, { volatility: 'v', security_definer: false }, { volatility: 's', security_definer: true }]) {
  check('stable closure refuses missing or unsafe callee evidence ' + JSON.stringify(metadata), () => {
    assert.throws(() => verify([fn('reader', 'BEGIN RETURN pg_catalog.length(); END'), view], { ...refs, 'pg_catalog.length': { class: 'pg_catalog', name: 'length', ...metadata } }), /nonvolatile/);
  });
}
check('stable extension closure requires pinned nonvolatile invoker metadata', () => {
  const wrapper = fn('reader', 'BEGIN RETURN extensions.digest(); END');
  const extension = { class: 'extension', name: 'digest', extension: 'pgcrypto', schema: 'extensions', volatility: 'i', security_definer: false };
  assert.deepEqual(verify([wrapper, view], { ...refs, 'extensions.digest': extension }).stable_view_functions, ['reader']);
  for (const delta of [{ volatility: 'v' }, { security_definer: true }, { extension: 'untrusted' }]) {
    assert.throws(() => verify([wrapper, view], { ...refs, 'extensions.digest': { ...extension, ...delta } }), /nonvolatile|unpinned/);
  }
});
check('reader verifies declaration class instead of trusting a relabeled manifest', () => {
  assert.throws(() => verify([reader, view], { 'public.reader': pure('reader') }), /volatility disagrees/);
  assert.throws(() => verify([fn('reader', 'BEGIN RETURN 1; END', 'IMMUTABLE'), view]), /volatility disagrees/);
  assert.throws(() => verify([reader.replace('SECURITY INVOKER', 'SECURITY DEFINER'), view]), /purity contract/);
});
check('all overloads checked; a safe final declaration cannot hide unsafe earlier body', () => {
  const unsafe = fn('reader', 'BEGIN DELETE FROM public.t; RETURN 1; END').replace('reader()', 'reader(n integer)');
  assert.throws(() => verify([unsafe, reader, view]), /purity contract/);
  assert.throws(() => recovery.classifyCallable('public.reader', [hit('BEGIN RETURN 1; END'), hit('BEGIN RETURN 1; END', { volatility: 'v' })], new Set(), new Set(), () => {}, { allowStableView: true }), /impure/);
});
check('unknown transitive qualified reference stays fail-closed', () => assert.throws(() => verify([fn('reader', 'BEGIN RETURN public.missing(); END'), view]), /outside the manifest/));
check('new metadata is aggregate and contains no body text', () => {
  const result = recovery.classifyCallable('length', [hit('', { schema: 'pg_catalog', volatility: 'i' }), hit('', { schema: 'pg_catalog', volatility: 's' })], new Set(), new Set(), () => {});
  assert.equal(result.volatility, 's'); assert.equal(result.security_definer, false); assert.equal(Object.hasOwn(result, 'body'), false);
});
check('target SQL rechecks recorded builtin metadata; malformed evidence refuses before SQL', () => {
  const m = manifest({ 'pg_catalog.length': builtin('length') });
  assert.match(recovery.targetPrerequisiteSql(m), /bool_or\(p\.prosecdef\)=v_ext\.security_definer/);
  assert.match(recovery.targetPrerequisiteSql(m), /target callable metadata differs from source/);
  assert.throws(() => recovery.targetPrerequisiteSql(manifest({ n: builtin('length', 'unknown') })), /metadata is malformed/);
});

// Exercise the authenticated package reader, not only standalone helpers.
function packageWith(expression, declaration = reader, references = refs) {
  const corpus = backup.resolveCorpus('history-v7');
  const preData = Buffer.from(corpus.tables.map(t => `CREATE TABLE public.${t.name} (${(Array.isArray(t.pk) ? t.pk : [t.pk]).map(k => `${k} text NOT NULL`).join(', ')}, body text);`).join('\n') + '\n' + declaration + ';\n');
  const postData = Buffer.from(expression + ';\n'); const data = Buffer.from(fixtureDump('history-v7'));
  const pre = recovery.validateSchemaSection(preData); const post = recovery.validateSchemaSection(postData);
  const tables = backup.inspectPlainDump(data, 'history-v7');
  for (const [name, value] of Object.entries(tables)) value.digest_sha256 = crypto.createHash('sha256').update(name).digest('hex');
  const m = { ...manifest(references), format: recovery.RECOVERY_FORMAT, recovery_version: recovery.RECOVERY_VERSION, corpus: 'history-v7', corpus_version: 7,
    generated_at: '2026-09-06T00:00:00.000Z', completed_at: '2026-09-06T00:01:00.000Z', source_project_ref: backup.PRODUCTION_REF,
    schema: { fingerprint: 'a'.repeat(32), inventory: { tables: 37, sequences: 0 }, pre_data: { statements: pre.statements.length, skipped_platform_statements: pre.skipped }, post_data: { statements: post.statements.length, skipped_platform_statements: post.skipped } }, data: { table_count: 37, tables }, omitted_data_tables: [], sequences: [],
  };
  const key = Buffer.alloc(32, 17).toString('base64');
  return () => recovery.readRecoveryPackage(recovery.packRecoveryPackage({ preData, postData, data, manifest: m }, key).bytes, key);
}
check('authenticated v2/history-v7 package admits ordinary stable view without redefining corpus', () => {
  const pkg = packageWith(view)(); assert.equal(pkg.corpus, 'history-v7'); assert.equal(pkg.manifest.data.table_count, 37);
  assert.deepEqual(pkg.callable.stable_view_functions, ['reader']);
});
check('authenticated package rejects stable callable moved to CHECK', () => assert.throws(packageWith(loadExpressions.check), /only in an ordinary view/));
check('authenticated package rejects malicious nested writer with a forged pure class', () => {
  const body = fn('reader', 'BEGIN RETURN public."helper"(); END') + ';\n' + fn('helper', 'BEGIN DELETE FROM public.t; RETURN 1; END', 'IMMUTABLE');
  assert.throws(packageWith(view, body, { ...refs, 'public.helper': pure() }), /purity contract/);
});
check('capture validates context before emitting a package and retains builtin metadata', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/track-b-recovery-package.js'), 'utf8');
  const capture = source.slice(source.indexOf('async function captureRecoveryPackage'), source.indexOf('\nfunction summarize'));
  assert.ok(capture.indexOf('verifyCallableContract([...pre.statements, ...post.statements], manifest)') < capture.indexOf('fs.writeFileSync(path.resolve(output)'));
  assert.match(capture, /volatility: item\.volatility, security_definer: item\.security_definer/);
});
console.log(JSON.stringify({ status: 'PASS', passed: checks.length, checks, proof: 'OFFLINE_TEST_actual_classifiers_and_authenticated_synthetic_packages_no_SQL' }));
