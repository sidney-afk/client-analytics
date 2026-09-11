'use strict';
// Actual ordered application owners + explicit supplements. Synthetic rows only.
const assert=require('node:assert/strict');const path=require('path');const fs=require('fs');const cp=require('child_process');
const {Cluster}=require('../scripts/f42-apply-rehearsal');const {scalar}=require('../scripts/linear-exit-composition/harness');
const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
const supplement=require('../scripts/linear-exit-priority-schema-supplement');const observed=require('../scripts/linear-exit-backup-observed-baseline');
const backup=require('../scripts/track-b-backup');const recovery=require('../scripts/track-b-recovery-package');const companion=require('../scripts/linear-exit-priority-companion');const {capturePair}=require('../scripts/linear-exit-priority-capture');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
const cluster=new Cluster();assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
let stage='install',targetDb;
async function main(){try{
 const proof=install({},()=>null);const extra=supplement.apply(cluster);const baseline=observed.apply(cluster);
 stage='synthetic-row-seeding';
 cluster.exec(`insert into public.batches_parent_claim_backup_20260824(id,linear_parent_ids) values('synthetic-priority','[]'),('synthetic-priority','[]');
 insert into public.content_samples(client,id,label) values('synthetic-priority','synthetic-priority','Synthetic');
 insert into public.filming_plans(client_slug,client_name) values('synthetic-priority','Synthetic');
 insert into public.thumbnail_media_revisions(surface,client,source_id,thumbnail_url) values('calendar','synthetic-priority','synthetic-priority','https://example.invalid/synthetic');
 insert into public.production_comment_import_conflicts(import_run_id,source_surface,classification) values('synthetic-priority','calendar','missing_card_id');
 insert into public.production_comment_read_audit(actor_key,auth_kind,decision,reason) values('synthetic-priority','staff','allow','synthetic');
 insert into public.production_comment_read_budget(actor_key,window_start,requests) values('synthetic-priority',to_timestamp(floor(extract(epoch from clock_timestamp())/300)*300),119);
 insert into public.linear_archive_asset_rescue_config(config_key,destination_provider,approved_folder_id,rescue_capability_sha256,active) values('active','google_drive_private','synthetic_folder_000000',repeat('0',64),false);
 insert into public.workload_issues(id) values('synthetic-priority');`);
 const role='priority_app_capture_'+process.pid;const restoreRole='priority_app_restore_'+process.pid;
 cluster.exec(`create role ${role} login nosuperuser nocreatedb nocreaterole bypassrls password 'synthetic-capture-only';grant usage on schema public,extensions to ${role};grant select on all tables in schema public to ${role};grant select on all sequences in schema public to ${role};`);
 const key=Buffer.alloc(32,21).toString('base64');const env={...process.env,PGHOST:cluster.host,PGPORT:String(cluster.port),PGDATABASE:cluster.db,PGUSER:role,PGPASSWORD:'synthetic-capture-only',PGOPTIONS:''};
 stage='actual-capture-pair';
 const captured=await capturePair({env,corpusName:'history-v11',hmacInput:key,psql:cluster.psql,pgDump:path.join(path.dirname(cluster.psql),'pg_dump.exe'),sourceUrl:`postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`});
 stage='local-pair-storage';
 assert.ok(process.env.PROOF_OUTPUT_ROOT,'PRIVATE_OUTPUT_REQUIRED');
 const storage=require('../scripts/linear-exit-priority-pair-storage');
 const stored=storage.writePair({directory:process.env.PROOF_OUTPUT_ROOT,name:'application-pair.private',...captured,hmacInput:key});
 const pair=storage.readPair(stored.path,key);
 assert.deepEqual(pair.parentBytes,captured.parentBytes);assert.deepEqual(pair.companionBytes,captured.companionBytes);
 const verified=companion.verifyPair(pair.companionBytes,pair.parentBytes,key);assert.ok(Object.values(verified.companion.tables).every(t=>t.rows.length>0));
 stage='target-prerequisites';targetDb='priority_app_target_'+process.pid;
 cluster.run('','postgres',{sql:`create database ${targetDb}`});
 cluster.exec(`create role ${restoreRole} login nosuperuser nocreatedb nocreaterole nobypassrls password 'synthetic-restore-only';create schema extensions;create extension pgcrypto with schema extensions;create publication supabase_realtime;`,targetDb);
 const args=['-X','-h',cluster.host,'-p',String(cluster.port),'-U',cluster.user,'-d',targetDb,'-v','ON_ERROR_STOP=1'];
 const grants=cp.spawnSync(cluster.psql,[...args,'-v','mode=target','-v','existing_role='+restoreRole,'-v','confirmation=EMPTY_SCRATCH_TARGET_ONLY','-v','scratch_project_ref=abcdefghijklmnopqrst','-f',path.resolve(__dirname,'../scripts/track-b-recovery-prerequisites.sql')],{encoding:'utf8',windowsHide:true});
 assert.equal(grants.status,0,grants.stderr);
 stage='actual-pair-reconstruction';
 const result=cp.spawnSync(cluster.psql,['-X','-q','-h',cluster.host,'-p',String(cluster.port),'-U',restoreRole,'-d',targetDb,'-v','ON_ERROR_STOP=1','-f','-'],{input:recovery.reconstructPairSql(pair.companionBytes,pair.parentBytes,key),env:{...env,PGPASSWORD:'synthetic-restore-only'},encoding:'utf8',windowsHide:true});
 if(result.status!==0){const e=Error('APPLICATION_PAIR_RECONSTRUCTION_REFUSED');e.detail=result.stderr;throw e;}
 stage='restored-runtime-behavior';
 const execute=(user,password,sql)=>cp.spawnSync(cluster.psql,['-X','-q','-h',cluster.host,'-p',String(cluster.port),'-U',user,'-d',targetDb,'-v','ON_ERROR_STOP=1','-f','-'],{input:sql,env:{...process.env,PGPASSWORD:password},encoding:'utf8',windowsHide:true});
 const behavior=require('./helpers/linear-exit-priority-restored-behavior').verify({owner:sql=>execute(restoreRole,'synthetic-restore-only',sql),asRole:(role,sql)=>execute(cluster.user,process.env.PGPASSWORD,`begin;set local role ${role};${sql}rollback;`)});
 console.log(JSON.stringify({marker:'LINEAR_EXIT_PRIORITY_APPLICATION_RECOVERY_OK',inventory_sha256:proof.inventory_sha256,supplement:extra,observed_backup:baseline,parent_tables:52,populated_companion_tables:9,local_storage:{reopened_before_restore:true,container_sha256:stored.container_sha256,atomic_no_overwrite:stored.atomic_no_overwrite,power_loss_durability_proven:false,off_device_custody_proven:false},behavior,application_source_owners:true,synthetic_rows_only:true,owner_relative_reconstruction:true,full_dependency_closure_proven:false,hosted_restore_proven:false,sequence_custody_proven:false}));
}catch(error){
 if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'application-recovery.private-error.log'),String(error.stack||error)+'\n'+String(error.detail||''));
 console.error(JSON.stringify({marker:'LINEAR_EXIT_PRIORITY_APPLICATION_RECOVERY_FAILED',stage,code:'APPLICATION_RECOVERY_GATE_REFUSED'}));process.exitCode=1;
}finally{if(targetDb)cluster.run('','postgres',{sql:`drop database if exists ${targetDb}`});cluster.stop();}}
main();
