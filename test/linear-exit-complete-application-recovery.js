'use strict';
// Source-owned schema and synthetic data only, on an explicitly disposable server.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
const backup=require('../scripts/track-b-backup');
const applicationVersion=process.env.PROOF_APPLICATION_DATA_VERSION||'v1';assert.ok(['v1','v2'].includes(applicationVersion));
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
for(const name of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])if(process.env[name])throw Error('INHERITED_DATABASE_ROUTING_REFUSED:'+name);
const cluster=new Cluster();
assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
let stage='install',targetDb;
async function main(){try{
 const inventory=install({},()=>null);
 require('../scripts/linear-exit-priority-schema-supplement').apply(cluster);
 require('../scripts/linear-exit-backup-observed-baseline').apply(cluster);
 require('../scripts/linear-exit-credential-schema-supplement').apply(cluster);
 require('./helpers/complete-application-priority-seed')(cluster);
 const query=sql=>cluster.run('',null,{sql,tuplesOnly:true});
 stage='remaining-source-owners';
 const remaining=await require('./helpers/remaining-application-fixture').installAndPopulate({query});
 stage='native-source-seed';
 cluster.exec(`update public.syncview_runtime_flags set value='{"video":{"enabled":true,"epoch":"integrated-video"},"graphics":{"enabled":true,"epoch":"integrated-graphics"}}' where key='native_intake_epochs';
 set role service_role;select public.production_native_client_provision('schema-v10-native-client','schema-v10-native-client','Schema V10 Native Client');reset role;
 insert into public.description_images(id,storage_path,public_url,mime_type,byte_length,width,height,actor_key,actor_name,actor_role,client_slug) values ('00000000-0000-4000-8000-000000000910','schema-v10-image.png','https://storage.invalid/schema-v10-image.png','image/png',1,1,1,'schema-v10-actor','Schema V10 Actor','admin','schema-v10-native-client');
 insert into public.production_notification_config(key,value) values ('urgent_video_destination','{}'::jsonb);`);
 const phase=require('../scripts/track-b-recovery-rehearsal').phase;
 const cfg={output:process.env.PROOF_OUTPUT_ROOT,host:cluster.host,port:cluster.port,user:cluster.user,password:process.env.PGPASSWORD,psql:cluster.psql};
 const sourceDb={name:cluster.db,config:{user:cluster.user}};
 const native=phase(cfg,sourceDb,'seed','','complete-native-source',7);
 const continuity=phase(cfg,sourceDb,'seed','','complete-continuity-source',9);
 assert.equal(native.value.cases.length,4);assert.equal(native.value.provider_attempts,0);
 stage='remaining-native-historical-seed';
 require('./helpers/native-owner-recovery-fixture').seedNativeOwners(cluster);
 require('./helpers/complete-application-history-seed').seedHistory(cluster);
 const admissionSources=[];
 if(applicationVersion==='v2'){
  stage='admission-v2-install-seed';
  for(const [file,sha256] of [
   ['qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql','31663a6b62bbc96efe85a8cdc8485c42f07f9455b5c043e2112ff07e36bba429'],
   ['supabase/migrations/20260912174907_card_atomic_admission_preparation.sql','1699ab4a661558460eeb94b2c4b85244265bb9b890589efbc4876c6266107cea'],
   ['supabase/migrations/20260912183653_application_dml_admission_preparation.sql','c3d1e93127156b316ae7baf2176baf7892d5523248c3bbe4ef32c19676a0998e'],
   ['supabase/migrations/20260912184931_card_followup_outcome_proof.sql','e9691f160a7bbac302067156f4a7c8eb6682e5a214a6126b88776eaa1541a46a'],
   ['supabase/migrations/20260912190717_provider_debt_disposition_preparation.sql','2d014bc26cb72d1e096d40a4c406dfd8f0c39fe430adc327e7d8e0abf4c1142f'],
   ['supabase/migrations/20260912193102_followup_transactional_retry_preparation.sql','95804e6978f98fa251fad73bfa9c009d4ec46e70d42b77f30cb965cc577cf33e'],
   ['supabase/migrations/20260912193957_provider_closed_snapshot_preparation.sql','cdfbd974375381a273f314e0089790780a60423eaac39473c683845ff177768f'],
   ['supabase/migrations/20260912200637_thumbnail_parser_contract_alignment.sql','ae372bbb1b62df37d273c4539a6efe255bf4a7ed415149fbbb73b423dba63f4e']]){assert.equal(require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sha256);cluster.runFile(file);admissionSources.push({file,sha256});}
  cluster.exec(`set role service_role;
   select public.production_card_atomic_write_v1('00000000-0000-4000-8000-000000009090',jsonb_build_object('surface','calendar','client','schema-v10-native-client','id','synthetic-custody-atomic','row',jsonb_build_object('client','schema-v10-native-client','id','synthetic-custody-atomic','status','Draft'),'expected_existing',null,'events','[]'::jsonb,'followups',jsonb_build_array(jsonb_build_object('kind','graphic_baseline','payload',jsonb_build_object('surface','calendar','client','schema-v10-native-client','sourceId','synthetic-custody-atomic')))));
   select public.production_card_admission_close_v1((select epoch from public.card_write_admission_v1),'synthetic capture close');
   select public.production_card_admission_flag_control_v1((select epoch from public.card_write_admission_v1),'linear_outbound_enabled',(select value from public.syncview_runtime_flags where key='linear_outbound_enabled'),'{"mode":"off"}'::jsonb,'synthetic-capture','preserve control history');reset role;`);
  assert.equal(query('select count(*) from public.card_write_operations_v1').trim(),'1');assert.equal(query('select count(*) from public.card_write_followups_v1').trim(),'1');assert.equal(query('select count(*) from public.card_write_transaction_context_v1').trim(),'0');assert.equal(query('select jsonb_array_length(control_history) from public.card_write_admission_v1').trim(),'1');
  cluster.exec(`set role service_role;do $fixture$ declare t public.card_write_followups_v1%rowtype; recovered jsonb;begin
   select * into strict t from public.production_card_followup_claim_transactional_v1(1);
   perform public.production_card_followup_fail_v1(t.operation_id,t.kind,t.attempt,t.lease_token,'synthetic first failure');
   recovered:=public.production_card_followup_recover_v1((select epoch from public.card_write_admission_v1),t.operation_id,t.kind,t.attempt,t.lease_token);
   select * into strict t from public.card_write_followups_v1 where operation_id=t.operation_id and kind=t.kind;
   perform public.production_card_followup_fail_v1(t.operation_id,t.kind,t.attempt,t.lease_token,'synthetic retained retry failure');
  end $fixture$;reset role;`);
  assert.equal(query("select count(*) from public.card_write_followups_v1 where attempt=2 and state='failed' and history @> '[{\"event\":\"recovered_transactional_attempt\"}]'::jsonb").trim(),'1');
 }
 const complete=require('../scripts/linear-exit-complete-application-data');
 const role='complete_capture_'+process.pid,restoreRole='complete_restore_'+process.pid;
 cluster.exec(`create role ${role} login nosuperuser nocreatedb nocreaterole bypassrls password 'synthetic-capture-only';grant usage on schema public,extensions to ${role};grant select on all tables in schema public to ${role};grant select on all sequences in schema public to ${role};`);
 const key=Buffer.alloc(32,47).toString('base64');
 const env={...process.env,PGHOST:cluster.host,PGPORT:String(cluster.port),PGDATABASE:cluster.db,PGUSER:role,PGPASSWORD:'synthetic-capture-only',PGOPTIONS:''};
 stage='capture';
 assert.ok(process.env.PROOF_OUTPUT_ROOT,'PRIVATE_OUTPUT_REQUIRED');
 const artifact=await complete.capture({applicationDataVersion:applicationVersion,env,corpusName:'history-v11',hmacInput:key,psql:cluster.psql,pgDump:path.join(path.dirname(cluster.psql),'pg_dump.exe'),sourceUrl:`postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`});
 const artifactPath=path.join(process.env.PROOF_OUTPUT_ROOT,'complete-application.private');
 fs.writeFileSync(artifactPath,artifact.bytes,{flag:'wx'});
 const reopened=fs.readFileSync(artifactPath);
 assert.deepEqual(reopened,artifact.bytes);
 complete.read(reopened,key);
 let encryptedCustodyReopened=false;
 if(applicationVersion==='v2'){
  const custody=require('../scripts/linear-exit-complete-application-custody'),crypto=require('crypto');
  const encryptionKey=crypto.randomBytes(32),keyId=crypto.randomBytes(16).toString('hex'),packageDirectory=path.join(process.env.PROOF_OUTPUT_ROOT,'complete-encrypted'),restoredFile=path.join(process.env.PROOF_OUTPUT_ROOT,'complete-reopened.private');
  try{custody.pack({sourceFile:artifactPath,target:packageDirectory,hmacInput:key,encryptionKey,keyId});custody.restore({packageDirectory,target:restoredFile,hmacInput:key,encryptionKey,keyId});assert.deepEqual(fs.readFileSync(restoredFile),reopened);complete.read(fs.readFileSync(restoredFile),key);encryptedCustodyReopened=true;}finally{encryptionKey.fill(0);}
 }
 const corrupt=Buffer.from(reopened);corrupt[corrupt.length-1]^=1;
 assert.throws(()=>complete.read(corrupt,key));
 stage='target';targetDb='complete_target_'+process.pid;
 cluster.run('','postgres',{sql:`create database ${targetDb}`});
 cluster.exec(`create role ${restoreRole} login nosuperuser nocreatedb nocreaterole nobypassrls password 'synthetic-restore-only';create schema extensions;create extension pgcrypto with schema extensions;create publication supabase_realtime;`,targetDb);
 const base=['-X','-q','-h',cluster.host,'-p',String(cluster.port),'-d',targetDb,'-v','ON_ERROR_STOP=1'];
 const grant=cp.spawnSync(cluster.psql,[...base,'-U',cluster.user,'-v','mode=target','-v','existing_role='+restoreRole,'-v','confirmation=EMPTY_SCRATCH_TARGET_ONLY','-v','scratch_project_ref=abcdefghijklmnopqrst','-f',path.resolve(__dirname,'../scripts/track-b-recovery-prerequisites.sql')],{encoding:'utf8',windowsHide:true});
 assert.equal(grant.status,0,grant.stderr);
 stage='restore';
 const sql=complete.reconstruct(reopened,key);
 const lateAt=sql.lastIndexOf('do $complete_shape$');assert.ok(lateAt>sql.indexOf('COPY public.'));
 const faultStatement=applicationVersion==='v2'?"update public.card_write_operations_v1 set result=result||'{\"synthetic_corruption\":true}'::jsonb;\n":'insert into public.batches_parent_claim_backup_20260824 select * from public.batches_parent_claim_backup_20260824 limit 1;\n';
 let faultSql=sql.slice(0,lateAt)+faultStatement+sql.slice(lateAt);
 const fault=cp.spawnSync(cluster.psql,[...base,'-U',restoreRole,'-f','-'],{input:faultSql,env:{...env,PGPASSWORD:'synthetic-restore-only'},encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});
 assert.notEqual(fault.status,0,'late omitted-row corruption must fail');
 assert.match(fault.stderr,/COMPLETE_APPLICATION_MULTISET_MISMATCH/);
 assert.equal(cluster.run('',targetDb,{sql:"select count(*) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p');",tuplesOnly:true}).trim(),'0','late refusal rolls back complete schema and rows');
 const restored=cp.spawnSync(cluster.psql,[...base,'-U',restoreRole,'-f','-'],{input:sql,env:{...env,PGPASSWORD:'synthetic-restore-only'},encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});
 assert.equal(restored.status,0,restored.stderr);
 stage='independent-row-comparison';
 let populated=0;const emptyTables=[];
 for(const table of complete.expectedNames(applicationVersion)){
  assert.match(table,/^[a-z][a-z0-9_]*$/);
  const snapshot=`select coalesce(json_agg(r order by r::text),'[]'::json)::text from (select to_jsonb(t) r from public."${table}" t) q;`;
  const source=cluster.run('',null,{sql:snapshot,tuplesOnly:true}).trim(),target=cluster.run('',targetDb,{sql:snapshot,tuplesOnly:true}).trim();
  assert.equal(target,source,'restored row multiset: '+table);
  if(source!=='[]')populated++;else emptyTables.push(table);
 }
 fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'complete-empty-tables.private.json'),JSON.stringify(emptyTables,null,2),{flag:'wx'});
 assert.equal(populated,applicationVersion==='v2'?89:86,'all application tables populated except V2 consumed context');
 if(applicationVersion==='v2')assert.deepEqual(emptyTables,['card_write_transaction_context_v1']);
 const inventoryNow=require('./helpers/linear-exit-install-step').plan();assert.equal(inventoryNow.digest,inventory.inventory_sha256,'source inventory drift during recovery');
 console.log(JSON.stringify({marker:'LINEAR_EXIT_COMPLETE_APPLICATION_RECOVERY_OK',classification:'ISOLATED_POSTGRES',inventory_sha256:inventory.inventory_sha256,application_data_version:applicationVersion,encrypted_custody_reopened:encryptedCustodyReopened,encryption_key_operational_custody_proven:false,admission_sources:admissionSources,covered_tables:complete.expectedNames(applicationVersion).length,populated_tables:populated,remaining,artifact_sha256:require('node:crypto').createHash('sha256').update(reopened).digest('hex'),authenticated_tamper_refusal:true,late_omitted_row_corruption_refused:true,failed_restore_transaction_empty:true,independent_row_multiset_comparison:true,object_bytes_proven:false,hosted_restore_proven:false,off_device_custody_proven:false}));
}catch(e){if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'complete-application.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_COMPLETE_APPLICATION_RECOVERY_FAILED',stage}));process.exitCode=1;}
finally{try{if(targetDb)cluster.run('','postgres',{sql:`drop database if exists ${targetDb}`});}finally{cluster.stop();}}}
main();
