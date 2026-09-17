'use strict';
// Explicit additive recovery fixture profile. No private schema or default profile changes.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {splitSqlStatements,preserveFunctionBodyTransport}=require('../../scripts/track-b-recovery-package');
const PREREQUISITE={file:'live-routine-definitions-20260912.private.json',sha256:'3728b7b676cfd7971515f03bb90f9204ac7e764a901804f8318571ea496ba6a7',name:'production_issue_create_linkage',body_raw_md5:'cad02230ee9f1b4e963477586a39be3e',classification:'EXACT_OBSERVED_FUNCTION_ONLY_FIXTURE'};
const OWNERS=[
 ['supabase/migrations/20260913045704_provider_comment_recovery_preparation.sql','7b89ab00540e9cdf2cd4d0ce7bc1ac033f7b6510f8cf2b72619ff8a5e275da99'],
 ['supabase/migrations/20260913051511_provider_create_recovery_preparation.sql','196b6a2c92a5e9f20920960e52bc41471730b020a47ef7f703bebd6c7327446a'],
 ['supabase/migrations/20260913054339_provider_create_observation_recovery_preparation.sql','f2c9a80e6bc4871c81f01e8659d587d23aa16dfc90ffa3ef388069ebc5066ee5'],
 ['supabase/migrations/20260913055621_provider_recorded_create_linkage_recovery_preparation.sql','f9a5a1915c4adb96cc3c0ef90f8c4cfe769ce8b46ec989c9c1250a0bb532414e']
];
const hash=(x,kind='sha256')=>crypto.createHash(kind).update(x).digest('hex');
function expected(){const result=new Map([[PREREQUISITE.name,PREREQUISITE.body_raw_md5]]);for(const [file,pin] of OWNERS){const bytes=fs.readFileSync(file);assert.equal(hash(bytes),pin,'current public owner drift');for(const s of splitSqlStatements(bytes.toString('utf8'))){const m=s.text.match(/^create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)[\s\S]*?\bas\s+(\$[a-zA-Z_0-9]*\$)([\s\S]*?)\2/i);if(m)result.set(m[1],hash(m[3],'md5'));}}assert(result.size>=8);return result;}
function prerequisite(c){
 const dir=process.env.OBSERVED_INPUT_DIRECTORY;assert(dir&&path.isAbsolute(dir),'explicit private observed input directory required');
 const bytes=fs.readFileSync(path.join(dir,PREREQUISITE.file));assert.equal(hash(bytes),PREREQUISITE.sha256,'observed prerequisite input drift');
 const rows=JSON.parse(bytes).routines.filter(r=>r.name===PREREQUISITE.name);assert.equal(rows.length,1);const row=rows[0];assert.equal(hash(row.body,'md5'),PREREQUISITE.body_raw_md5);
 const parts=splitSqlStatements(row.definition+(row.definition.trimEnd().endsWith(';')?'':';'));assert.equal(parts.length,1);assert.match(parts[0].text,/^CREATE OR REPLACE FUNCTION public\.production_issue_create_linkage\(/i);
 const observed=require('../../scripts/linear-exit-observed-routines'),record=observed.load().contract.functions.find(f=>f.name===PREREQUISITE.name);assert.equal(hash(row.definition,'md5'),record.definition_raw_md5);
 const present=c.scalarJson("select to_jsonb(to_regprocedure('public.production_issue_create_linkage(text,bigint,jsonb,jsonb)') is not null)");
 if(!present)c.exec(preserveFunctionBodyTransport(row.definition)+';\n'+observed.aclSql(record));
 assert.equal(c.scalarJson("select to_jsonb(md5(pg_get_functiondef('public.production_issue_create_linkage(text,bigint,jsonb,jsonb)'::regprocedure)))"),record.definition_raw_md5,'exact observed prerequisite definition');
}
function query(){const names=[...expected().keys()];assert(names.every(n=>/^[a-z_0-9]+$/.test(n)));return `set search_path=pg_catalog,public;select jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'body_raw_md5',md5(p.prosrc),'result',pg_get_function_result(p.oid),'language',l.lanname,'security_definer',p.prosecdef,'config',p.proconfig,'strict',p.proisstrict,'volatility',p.provolatile,'parallel',p.proparallel,'leakproof',p.proleakproof,'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.proname) from pg_proc p join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and p.proname in (${names.map(n=>"'"+n+"'").join(',')});`;}
function apply(c){
 prerequisite(c);
 assert.equal(c.scalarJson("select to_jsonb(to_regprocedure('public.production_issue_create_linkage(text,bigint,jsonb,jsonb)') is not null and to_regprocedure('public.production_comment_bind_linear_id(text,text,bigint)') is not null)"),true,'explicit F203/comment binding prerequisite missing');
 expected();for(const [file] of OWNERS)c.runFile(file);
 const rows=c.scalarJson(query()),bodies=expected();assert.equal(rows.length,bodies.size);
 for(const row of rows){assert.equal(row.body_raw_md5,bodies.get(row.name));assert.equal(row.anon_execute,false);assert.equal(row.authenticated_execute,false);assert.equal(row.service_execute,!['production_application_dml_guard_v1','production_provider_create_autolinks_v1','production_provider_create_intent_v1','production_provider_create_uuid_v1','production_provider_parent_team_v1','production_provider_parent_merge_v1','production_provider_create_labels_v1'].includes(row.name));}
 return rows;
}
function verify(c,target,rows){assert.equal(hash(fs.readFileSync(path.join(process.env.OBSERVED_INPUT_DIRECTORY,PREREQUISITE.file))),PREREQUISITE.sha256);assert.deepEqual(c.scalarJson(query(),target),rows,'restored current public owner metadata drift');}
module.exports={OWNERS,PREREQUISITE,expected,apply,verify};
