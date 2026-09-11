'use strict';
// Isolated sequence semantics only; does not establish application writer rules.
const assert=require('node:assert/strict');const cp=require('child_process');
const {Cluster}=require('../scripts/f42-apply-rehearsal');const {runPsql}=require('../scripts/track-b-recovery-package');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
const cluster=new Cluster();assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
function exporter(env){return new Promise((resolve,reject)=>{
 const child=cp.spawn(cluster.psql,['-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});let text='';let resolved=false;
 child.stdout.on('data',b=>{text+=b;const m=text.match(/[0-9A-F]{8}-[0-9A-F]{8}-\d+/);if(m&&!resolved){resolved=true;resolve({snapshot:m[0],close:()=>new Promise(done=>{child.once('close',done);child.stdin.end('rollback;\n');})});}});
 child.on('error',reject);child.on('close',()=>{if(!resolved)reject(Error('SEQUENCE_SNAPSHOT_SESSION_FAILED'));});child.stderr.resume();
 child.stdin.write('begin isolation level repeatable read read only;select pg_export_snapshot();\n');
});}
async function main(){let session;let checks=0;try{
 cluster.start();const env={...process.env,PGHOST:cluster.host,PGPORT:String(cluster.port),PGUSER:cluster.user,PGDATABASE:cluster.db};
 const query=sql=>runPsql(env,sql,{psql:cluster.psql});
 assert.equal(Math.floor(Number(query("select current_setting('server_version_num')"))/10000),17);
 query("create sequence public.sequence_probe cache 5;create table public.sequence_rows(id bigint primary key default nextval('public.sequence_probe'));insert into public.sequence_rows default values;");
 const initial=BigInt(query('select last_value from public.sequence_probe'));
 session=await exporter(env);const snapshot=sql=>runPsql(env,sql,{psql:cluster.psql,snapshot:session.snapshot});
 assert.equal(snapshot('select json_agg(id order by id) from public.sequence_rows'),'[1]');checks++;
 const later=BigInt(query('insert into public.sequence_rows default values returning id'));
 assert.ok(later>1n);assert.equal(snapshot('select count(*) from public.sequence_rows'),'1');assert.equal(query('select count(*) from public.sequence_rows'),'2');checks++;
 const issued=BigInt(query("begin;select nextval('public.sequence_probe');rollback;"));
 const highwater=BigInt(snapshot('select last_value from public.sequence_probe'));
 assert.ok(highwater>initial);assert.ok(highwater>issued,'cache reserves values beyond the returned nextval');
 assert.equal(query('select count(*) from public.sequence_rows'),'2','rolled back nextval creates no row');checks++;
 query(`create sequence public.restored_sequence cache 5;create table public.restored_rows(id bigint primary key default nextval('public.restored_sequence'));insert into public.restored_rows values(1);select setval('public.restored_sequence',${highwater},true);`);
 const resumed=BigInt(query('insert into public.restored_rows default values returning id'));
 assert.ok(resumed>highwater&&resumed>later&&resumed>issued);checks++;
 query("select setval('public.restored_sequence',1,false)");
 assert.throws(()=>query('insert into public.restored_rows default values'),e=>/duplicate key/.test(e.detail||''));checks++;
 // A manual ID can exceed an otherwise monotonic sequence high-water value.
 query("create sequence public.manual_sequence;create table public.manual_rows(id bigint primary key default nextval('public.manual_sequence'));insert into public.manual_rows values(2);select setval('public.manual_sequence',1,true)");
 assert.throws(()=>query('insert into public.manual_rows default values'),e=>/duplicate key/.test(e.detail||''));checks++;
 assert.equal(snapshot('select json_agg(id order by id) from public.sequence_rows'),'[1]');checks++;
 console.log(JSON.stringify({marker:'LINEAR_EXIT_SEQUENCE_CONSISTENCY_OK',checks,exported_snapshot_rows_frozen:true,sequence_state_non_mvcc:true,rollback_nextval_not_rolled_back:true,cache_highwater_exceeds_issued_value:true,monotonic_later_highwater_safe_for_frozen_rows:true,reset_and_manual_id_collisions_demonstrated:true,application_writer_contract_proven:false,global_sequence_fence_proven:false,hosted_operations:false}));
}finally{if(session)await session.close();cluster.stop();}}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
