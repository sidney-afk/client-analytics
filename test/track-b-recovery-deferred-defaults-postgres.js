'use strict';
// Scoped real PostgreSQL proof of deferred-default nonexecution. This is not
// the full authenticated recovery/ACL rehearsal, which is a separate lane.
const assert=require('assert/strict'),crypto=require('crypto'),{spawnSync}=require('child_process');
const recovery=require('../scripts/track-b-recovery-package');
for(const name of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])if(Object.hasOwn(process.env,name))throw Error('inherited PostgreSQL routing override refused: '+name);
if(process.env.F63_REQUIRE_POSTGRES!=='1'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='postgres')throw Error('explicit disposable loopback runner required');
const psql=process.env.NATIVE_CARD_TEST_PSQL;if(!psql)throw Error('explicit local psql required');
const database='deferred_'+crypto.randomBytes(12).toString('hex');
function execute(sql,db=database){return spawnSync(psql,['-X','-v','ON_ERROR_STOP=1','-At','-d',db],{input:sql,encoding:'utf8',env:process.env,windowsHide:true});}
function ok(sql,db){const result=execute(sql,db);assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
const functions=[
 "CREATE FUNCTION public.raise_immutable() RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$begin raise exception 'immutable_generator_executed'; end$$",
 "CREATE FUNCTION public.direct_generator() RETURNS text LANGUAGE plpgsql VOLATILE AS $$begin raise exception 'direct_generator_executed'; end$$",
 "CREATE FUNCTION public.sql_generator() RETURNS text LANGUAGE sql VOLATILE SET search_path TO public AS $$select public.raise_immutable()$$",
];
const tables=[
 'CREATE TABLE public.deferred_direct (id text, review_token text DEFAULT public.direct_generator())',
 'CREATE TABLE public.deferred_sql (id text, review_token text DEFAULT public.sql_generator())',
];
const plan=recovery.deferredDefaultPlan([...functions,...tables],true);
assert.equal(plan.defaults.length,2);
const tokens={deferred_direct:'synthetic-direct-preserved',deferred_sql:'synthetic-sql-preserved'};
const copy=Object.entries(tokens).map(([table,token])=>`COPY public.${table} (id, review_token) FROM stdin;\n1\t${token}\n\\.\n`).join('');
const defaults=plan.defaults.map(item=>`ALTER TABLE public.${item.table} ALTER COLUMN ${item.column} SET DEFAULT ${item.expression};`).join('\n');
const transaction=['begin;','set local check_function_bodies=false;',...plan.statements.map(s=>s+';'),copy,defaults,'commit;'].join('\n');
let created=false;
try{
 ok('CREATE DATABASE '+database,'postgres');created=true;
 ok(transaction);
 for(const [table,token]of Object.entries(tokens)){
  assert.equal(ok('select review_token from public.'+table),token);
  assert.equal(ok("select pg_get_expr(adbin,adrelid) from pg_attrdef where adrelid='public."+table+"'::regclass"),table==='deferred_direct'?'direct_generator()':'sql_generator()');
 }
 // These functions really raise: a missing COPY column after restoration is
 // an intentional negative, not a silently unobservable counter assertion.
 for(const table of Object.keys(tokens)){
  const result=execute(`COPY public.${table} (id) FROM stdin;\n2\n\\.\n`);
  assert.notEqual(result.status,0);assert.match(result.stderr,/generator_executed/);assert.equal(ok('select count(*) from public.'+table),'1');
 }
 // A late failure must roll back DDL + copied token + restored default together.
 ok('DROP TABLE public.deferred_direct,public.deferred_sql; DROP FUNCTION public.direct_generator(),public.sql_generator(),public.raise_immutable();');
 const failed=execute(transaction.replace('commit;','DO $$begin raise exception \'synthetic_late_failure\'; end$$;\ncommit;'));
 assert.notEqual(failed.status,0);assert.match(failed.stderr,/synthetic_late_failure/);
 assert.equal(ok("select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r'"),'0');
 assert.equal(ok("select count(*) from pg_proc where pronamespace='public'::regnamespace"),'0');
 console.log('PASS PG deferred default proof: direct and SQL-inner raising generators not invoked; token bytes/defaults retained; omitted columns trigger real failure; late failure restores empty target');
}finally{if(created)ok('DROP DATABASE '+database,'postgres');}
