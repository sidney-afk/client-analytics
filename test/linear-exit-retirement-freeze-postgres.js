'use strict';
// Isolated batch-description lock coverage; not a whole-application freeze proof.
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const crypto=require('crypto');const cp=require('child_process');
const {Cluster}=require('../scripts/f42-apply-rehearsal');const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
const cluster=new Cluster();assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
const owner='migrations/2026-09-01-batch-description-cas-timestamptz.sql';
let locker;let stage='install';
async function main(){try{
 const inventory=install({},()=>null);
 const source=fs.readFileSync(path.join(__dirname,'..',owner));const hash=crypto.createHash('sha256').update(source).digest('hex');
 assert.equal(hash,'e276e82b5c2fb7b8a65c62ec92294e8fa749f175f1c180e87916524b6a72dc36');
 cluster.runFile(path.join(__dirname,'..',owner));
 cluster.exec(`insert into public.clients(slug,display_name,active,kind) values('synthetic-freeze','Synthetic',true,'client');
 insert into public.batches(id,client_slug,team,name,description) values('synthetic-freeze-b','synthetic-freeze','video','Synthetic','before');
 update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}'::jsonb where key='prod_authority';`);
 const before=cluster.scalarJson(`select jsonb_build_object('events',(select count(*) from public.deliverable_events where batch_id='synthetic-freeze-b'),'outbox',(select count(*) from public.mirror_outbox))`);
 stage='outbox-lock';
 locker=cp.spawn(cluster.psql,['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h',cluster.host,'-p',cluster.port,'-U',cluster.user,'-d',cluster.db],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PGCLIENTENCODING:'UTF8'}});
 let errors='';locker.stderr.on('data',b=>errors+=b);
 await new Promise((resolve,reject)=>{let out='';const timeout=setTimeout(()=>reject(Error('LOCK_READY_TIMEOUT')),10000);locker.stdout.on('data',b=>{out+=b;if(out.includes('LOCK_READY')){clearTimeout(timeout);resolve();}});locker.on('error',reject);locker.on('exit',code=>{clearTimeout(timeout);if(code)reject(Error('LOCKER_FAILED'));});locker.stdin.write("begin; lock table public.mirror_outbox in share row exclusive mode; select 'LOCK_READY';\n");});
 const locked=()=>cluster.scalarJson(`select to_jsonb(exists(select 1 from pg_locks where relation='public.mirror_outbox'::regclass and mode='ShareRowExclusiveLock' and granted and pid<>pg_backend_pid()))`);
 assert.equal(locked(),true);
 stage='real-description-rpc';
 assert.throws(()=>cluster.exec(`set local lock_timeout='1500ms';set local statement_timeout='5s';set local role service_role;
 select public.production_batch_description_write('synthetic-freeze-b','synthetic-freeze','after',(select updated_at::text from public.batches where id='synthetic-freeze-b'),'{"actor":"synthetic","role":"admin","source":"ui"}'::jsonb);`), /canceling statement due to lock timeout/);
 assert.equal(locked(),true);
 const after=cluster.scalarJson(`select jsonb_build_object('description',(select description from public.batches where id='synthetic-freeze-b'),'events',(select count(*) from public.deliverable_events where batch_id='synthetic-freeze-b'),'action',(select action from public.deliverable_events where batch_id='synthetic-freeze-b' order by id desc limit 1),'outbox',(select count(*) from public.mirror_outbox))`);
 assert.equal(after.description,'before');assert.equal(after.events,before.events);assert.equal(after.outbox,before.outbox);
 locker.stdin.end('rollback;\n');await new Promise(resolve=>locker.once('close',resolve));locker=null;
 assert.equal(locked(),false);
 cluster.exec(`set local role service_role; select public.production_batch_description_write('synthetic-freeze-b','synthetic-freeze','after',(select updated_at::text from public.batches where id='synthetic-freeze-b'),'{"actor":"synthetic","role":"admin","source":"ui"}'::jsonb);`);
 const released=cluster.scalarJson(`select jsonb_build_object('description',(select description from public.batches where id='synthetic-freeze-b'),'events',(select count(*) from public.deliverable_events where batch_id='synthetic-freeze-b'),'outbox',(select count(*) from public.mirror_outbox))`);
 assert.equal(released.description,'after');assert.equal(released.events,before.events+1);assert.equal(released.outbox,before.outbox);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_GLOBAL_FREEZE_UNPROVEN',batch_description_lock_coverage_proven:true,global_freeze_proven:false,activation_authorized:false,source_owner:owner,source_sha256:hash,inventory_sha256:inventory.inventory_sha256,scope:'ISOLATED_POSTGRES',blocked_write_left_row_and_events_unchanged:true,released_lock_control_committed:true}));
 }catch(e){if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'retirement-freeze.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_RETIREMENT_PROBE_FAILED',stage}));process.exitCode=1;}finally{if(locker){locker.stdin.end('rollback;\n');await new Promise(resolve=>{locker.once('close',resolve);setTimeout(()=>{locker.kill();resolve();},2000);});}cluster.stop();}}
main();
