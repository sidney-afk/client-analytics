'use strict';
// Offline authenticated package/reader compatibility. Runtime proof belongs to
// the disposable recovery rehearsal; this file never calls a database.
const assert=require('assert/strict'),crypto=require('crypto'),fs=require('fs'),path=require('path'),Module=require('module');
const {execFileSync}=require('child_process');
const recovery=require('../scripts/track-b-recovery-package'),backup=require('../scripts/track-b-backup');
const {fixtureDump}=require('./track-b-backup-corpus');
const corpus='legacy-v3',config=backup.resolveCorpus(corpus),hmac=crypto.randomBytes(32).toString('base64');
const data=fixtureDump(corpus).toString().replace(/COPY public\.client_access \(slug\) FROM stdin;\n1\n/, 'COPY public.client_access (slug, review_token) FROM stdin;\n1\tsynthetic-kept-token\n'),parsed=backup.parseStrictPgDump(data,corpus);
const fn="CREATE FUNCTION public.synthetic_generator() RETURNS text LANGUAGE plpgsql VOLATILE SET search_path TO 'public' AS $$begin raise exception 'generator must never execute'; end$$";
const definitions=config.tables.map(t=>`CREATE TABLE public.${t.name} (${parsed.tables[t.name].columns.map(c=>`${c} text${t.name==='client_access'&&c==='review_token'?' DEFAULT public.synthetic_generator()':''}`).join(', ')})`);
assert.ok(parsed.tables.client_access.columns.includes('review_token'));
const statements=[fn,...definitions],plan=recovery.deferredDefaultPlan(statements,true);
assert.equal(plan.defaults.length,1);
const contract={version:1,defaults:plan.defaults,stored_columns:plan.storedColumns};
assert.equal(recovery.verifyDeferredDefaults(statements,{deferred_defaults:contract},parsed).defaults.length,1);
assert.equal(recovery.deferredDefaultPlan(statements,false).defaults.length,0);
assert.deepEqual(recovery.verifyDeferredDefaults(statements,{},parsed).statements,statements);
function packageFor(source=statements,copy=data,override={}){
 const preData=source.map(s=>s+';').join('\n'),postData='';const pre=recovery.validateSchemaSection(preData),post=recovery.validateSchemaSection(postData);
 const tables=backup.inspectPlainDump(copy,corpus);for(const table of Object.values(tables))table.digest_sha256='a'.repeat(64);
 const manifest={format:recovery.RECOVERY_FORMAT,recovery_version:recovery.RECOVERY_VERSION,corpus,corpus_version:config.version,source_project_ref:backup.PRODUCTION_REF,generated_at:'2026-09-10T00:00:00.000Z',completed_at:'2026-09-10T00:01:00.000Z',schema:{fingerprint:'b'.repeat(32),pre_data:{statements:pre.statements.length,skipped_platform_statements:pre.skipped},post_data:{statements:post.statements.length,skipped_platform_statements:post.skipped}},data:{table_count:config.tables.length,tables},sequences:[],callable_references:{},prerequisites:{roles:['anon','authenticated','service_role'],required_extensions:[]},deferred_defaults:contract,...override};
 return recovery.packRecoveryPackage({preData,postData,data:copy,manifest},hmac).bytes;
}
const bytes=packageFor(),pkg=recovery.readRecoveryPackage(bytes,hmac);
const sql=recovery.reconstructSql(pkg),copyAt=sql.indexOf('COPY public.'),defaultAt=sql.indexOf('ALTER TABLE public.client_access ALTER COLUMN review_token SET DEFAULT');
assert.ok(defaultAt>copyAt);assert.ok(defaultAt<sql.indexOf(recovery.inTransactionVerificationSql(pkg.manifest)));assert.ok(!sql.slice(0,copyAt).includes('DEFAULT public.synthetic_generator()'));
// Load the actual prior committed reader, not a facsimile of its rules.
const oldFile=path.resolve(__dirname,'../scripts/track-b-recovery-package.js');
const oldSource=execFileSync('git',['show','8616df2219f289c263a6c367155fafc952aba470:scripts/track-b-recovery-package.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',windowsHide:true});
assert.ok(!oldSource.includes('function deferredDefaultPlan('),'compatibility reference must predate deferred defaults');
const oldModule=new Module(oldFile,module);oldModule.filename=oldFile;oldModule.paths=Module._nodeModulePaths(path.dirname(oldFile));oldModule._compile(oldSource,oldFile);
assert.throws(()=>oldModule.exports.readRecoveryPackage(bytes,hmac),/callable|contract/);
for(const expression of ['public.synthetic_generator()::text','public.synthetic_generator(1)','public.synthetic_generator() || public.bad_immutable()']){
 const changed=statements.map(s=>s.replace('DEFAULT public.synthetic_generator()','DEFAULT '+expression));
 assert.throws(()=>recovery.readRecoveryPackage(packageFor(changed),hmac),/Deferred|callable|contract/);
}
for(const suffix of [' IMMUTABLE',' SECURITY DEFINER'])assert.throws(()=>recovery.readRecoveryPackage(packageFor([fn.replace(' VOLATILE',suffix),...definitions]),hmac),/Deferred|callable|contract/);
const missing=structuredClone(parsed);missing.tables.client_access.columns=missing.tables.client_access.columns.filter(c=>c!=='review_token');
assert.throws(()=>recovery.verifyDeferredDefaults(statements,{deferred_defaults:contract},missing),/every stored COPY column/);
const duplicate=structuredClone(parsed);duplicate.tables.client_access.columns.push('review_token');assert.throws(()=>recovery.verifyDeferredDefaults(statements,{deferred_defaults:contract},duplicate),/every stored COPY column/);
assert.throws(()=>recovery.verifyDeferredDefaults(statements,{deferred_defaults:{...contract,version:2}},parsed),/Unsupported/);
assert.throws(()=>recovery.readRecoveryPackage(packageFor(statements,data,{deferred_defaults:{...contract,defaults:[]}}),hmac),/differs/);
assert.throws(()=>recovery.readRecoveryPackage(packageFor([...statements,'ALTER TABLE public.client_access ADD CONSTRAINT bad CHECK (public.synthetic_generator() IS NOT NULL)']),hmac),/callable|contract/);
const mismatched=statements.map(s=>s.replace('review_token text DEFAULT','review_token uuid DEFAULT'));assert.throws(()=>recovery.deferredDefaultPlan(mismatched,true),/exact builtin/);
const unsafeSql="CREATE FUNCTION public.synthetic_generator() RETURNS text LANGUAGE sql VOLATILE AS $$select public.bad_immutable()$$";
assert.equal(recovery.deferredDefaultPlan([unsafeSql,...definitions],true).defaults.length,0,'inlineable SQL wrapper must remain strict');
assert.throws(()=>recovery.readRecoveryPackage(packageFor([unsafeSql,...definitions]),hmac),/Deferred|callable|contract/);
assert.equal(recovery.deferredDefaultPlan([unsafeSql.replace(' VOLATILE',' VOLATILE SET search_path TO public'),...definitions],true).defaults.length,1,'configured SQL cannot scalar-inline');
console.log('PASS deferred defaults: authenticated roundtrip, prior reader refusal, exact COPY, strict evaluated expressions, and restoration order (offline only)');
