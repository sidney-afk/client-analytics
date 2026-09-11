'use strict';
// Full triple reconstruction with synthetic credential/history rows only.
const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const cp=require('child_process');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
const backup=require('../scripts/track-b-backup');const recovery=require('../scripts/track-b-recovery-package');
const credential=require('../scripts/linear-exit-credential-companion');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
const cluster=new Cluster();assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
let targetDb,stage='install';
async function main(){try{
 const inventory=install({},()=>null);
 require('../scripts/linear-exit-priority-schema-supplement').apply(cluster);
 require('../scripts/linear-exit-backup-observed-baseline').apply(cluster);
 const source=require('../scripts/linear-exit-credential-schema-supplement').apply(cluster);
 stage='synthetic-seed';
 cluster.exec(`insert into public.batches_parent_claim_backup_20260824(id,linear_parent_ids) values('synthetic-priority','[]'),('synthetic-priority','[]');
 insert into public.content_samples(client,id,label) values('synthetic-priority','synthetic-priority','Synthetic');
 insert into public.filming_plans(client_slug,client_name) values('synthetic-priority','Synthetic');
 insert into public.thumbnail_media_revisions(surface,client,source_id,thumbnail_url) values('calendar','synthetic-priority','synthetic-priority','https://example.invalid/synthetic');
 insert into public.production_comment_import_conflicts(import_run_id,source_surface,classification) values('synthetic-priority','calendar','missing_card_id');
 insert into public.production_comment_read_audit(actor_key,auth_kind,decision,reason) values('synthetic-priority','staff','allow','synthetic');
 insert into public.production_comment_read_budget(actor_key,window_start,requests) values('synthetic-priority',now(),119);
 insert into public.linear_archive_asset_rescue_config(config_key,destination_provider,approved_folder_id,rescue_capability_sha256,active) values('active','google_drive_private','synthetic_folder_000000',repeat('0',64),false);
 insert into public.workload_issues(id) values('synthetic-priority');
 insert into public.client_credentials(id,client_slug,client_name,platform,label,password,status,source,raw_import) values
 ('00000000-0000-4000-8000-000000000001','synthetic-credential','Synthetic','synthetic','main','SYNTHETIC_NOT_A_CREDENTIAL','archived','onboarding',E'synthetic\\nraw'),
 ('00000000-0000-4000-8000-000000000002','synthetic-credential','Synthetic','synthetic','main','SYNTHETIC_REPLACEMENT','active','manual',null),
 ('00000000-0000-4000-8000-000000000003','synthetic-credential','Synthetic','synthetic','review',null,'needs_review','bulk_import','synthetic raw');
 insert into public.client_credential_events(credential_id,client_slug,action,old_value,new_value,payload) values
 ('00000000-0000-4000-8000-000000000001','synthetic-credential','reveal',null,null,'{"synthetic":true}'),
 ('00000000-0000-4000-8000-000000000002','synthetic-credential','update','SYNTHETIC_OLD','SYNTHETIC_NEW','{"synthetic":true}'),
 (null,'synthetic-credential','delete','SYNTHETIC_HISTORY',null,null);
 insert into public.client_credentials_rev(client_slug,client_name,rev) values('synthetic-credential','Synthetic',7);`);
 const role='credential_capture_'+process.pid,restoreRole='credential_restore_'+process.pid;
 cluster.exec(`create role ${role} login nosuperuser nocreatedb nocreaterole bypassrls password 'synthetic-capture-only';grant usage on schema public,extensions to ${role};grant select on all tables in schema public to ${role};grant select on all sequences in schema public to ${role};`);
 const key=Buffer.alloc(32,31).toString('base64');
 const env={...process.env,PGHOST:cluster.host,PGPORT:String(cluster.port),PGDATABASE:cluster.db,PGUSER:role,PGPASSWORD:'synthetic-capture-only',PGOPTIONS:''};
 stage='capture-triple';let interveningWrite=false;
 const triple=await require('../scripts/linear-exit-credential-capture').captureTriple({env,corpusName:'history-v11',hmacInput:key,psql:cluster.psql,pgDump:path.join(path.dirname(cluster.psql),'pg_dump.exe'),sourceUrl:`postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`,hooks:{afterDumps:()=>{cluster.exec("update public.client_credentials set password='SYNTHETIC_LATER' where id='00000000-0000-4000-8000-000000000001';insert into public.client_credential_events(client_slug,action) values('synthetic-credential','reveal');update public.client_credentials_rev set rev=8 where client_slug='synthetic-credential';");interveningWrite=true;}}});
 stage='triple-storage';
 assert.ok(process.env.PROOF_OUTPUT_ROOT,'PRIVATE_OUTPUT_REQUIRED');
 const storage=require('../scripts/linear-exit-credential-triple-storage');
 const stored=storage.writeTriple({directory:process.env.PROOF_OUTPUT_ROOT,name:'credential-triple.private',...triple,hmacInput:key});
 const reopened=storage.readTriple(stored.path,key);
 for(const name of ['parentBytes','priorityBytes','credentialBytes'])assert.deepEqual(reopened[name],triple[name]);
 const args={...reopened,hmacInput:key};const verified=credential.verifyTriple(args);
 assert.deepEqual(Object.fromEntries(Object.entries(verified.credential.tables).map(([n,t])=>[n,t.rows.length])),{client_credential_events:3,client_credentials:3,client_credentials_rev:1});
 assert.equal(interveningWrite,true);
 const credentialTable=verified.credential.tables.client_credentials;const passwordAt=credentialTable.columns.findIndex(c=>c.name==='password');const idAt=credentialTable.columns.findIndex(c=>c.name==='id');
 assert.equal(credentialTable.rows.find(r=>r[idAt]==='00000000-0000-4000-8000-000000000001')[passwordAt],'SYNTHETIC_NOT_A_CREDENTIAL');
 const revTable=verified.credential.tables.client_credentials_rev;assert.equal(revTable.rows[0][revTable.columns.findIndex(c=>c.name==='rev')],'7');
 cluster.exec("do $newer$ begin if (select count(*) from public.client_credential_events)<>4 or (select rev from public.client_credentials_rev where client_slug='synthetic-credential') is distinct from 8::bigint then raise exception 'CREDENTIAL_LATER_SOURCE_NOT_VISIBLE';end if;end $newer$;");
 assert.equal(Object.keys(verified.companion.tables).length,9);assert.ok(Object.values(verified.companion.tables).every(t=>t.rows.length>0));
 assert.throws(()=>recovery.reconstructSql(verified.parent),/CREDENTIAL_TRIPLE_RENDERER_REQUIRED/);
 assert.throws(()=>recovery.reconstructPairSql(triple.priorityBytes,triple.parentBytes,key),/CREDENTIAL_TRIPLE_RENDERER_REQUIRED/);
 assert.throws(()=>recovery.reconstructPairSqlWithSequenceBounds(triple.priorityBytes,triple.parentBytes,key),/CREDENTIAL_TRIPLE_RENDERER_REQUIRED/);
 stage='target';targetDb='credential_target_'+process.pid;
 cluster.run('','postgres',{sql:`create database ${targetDb}`});
 cluster.exec(`create role ${restoreRole} login nosuperuser nocreatedb nocreaterole nobypassrls password 'synthetic-restore-only';create schema extensions;create extension pgcrypto with schema extensions;create publication supabase_realtime;`,targetDb);
 const base=['-X','-q','-h',cluster.host,'-p',String(cluster.port),'-d',targetDb,'-v','ON_ERROR_STOP=1'];
 const grant=cp.spawnSync(cluster.psql,[...base,'-U',cluster.user,'-v','mode=target','-v','existing_role='+restoreRole,'-v','confirmation=EMPTY_SCRATCH_TARGET_ONLY','-v','scratch_project_ref=abcdefghijklmnopqrst','-f',path.resolve(__dirname,'../scripts/track-b-recovery-prerequisites.sql')],{encoding:'utf8',windowsHide:true});
 assert.equal(grant.status,0,grant.stderr);
 const execute=(user,password,sql)=>cp.spawnSync(cluster.psql,[...base,'-U',user,'-f','-'],{input:sql,env:{...env,PGPASSWORD:password},encoding:'utf8',windowsHide:true});
 const owner=sql=>execute(restoreRole,'synthetic-restore-only',sql);
 stage='restore';const sql=recovery.reconstructTripleSql(args);
 const at=sql.lastIndexOf('do $priority_rows$',sql.indexOf('CREDENTIAL_RESTORE_MULTISET_MISMATCH'));assert.ok(at>0);
 for(const fault of ["delete from public.client_credential_events;", "update public.client_credentials set password='SYNTHETIC_ALTERED';"]){
  const failed=owner(sql.slice(0,at)+fault+'\n'+sql.slice(at));assert.notEqual(failed.status,0);assert.match(failed.stderr,/CREDENTIAL_RESTORE_MULTISET_MISMATCH/);
  const empty=owner("do $empty$ begin if exists(select from pg_class where relnamespace='public'::regnamespace) then raise exception 'CREDENTIAL_FAILED_RESTORE_NOT_EMPTY';end if;end $empty$;");assert.equal(empty.status,0,empty.stderr);
 }
 const restored=owner(sql);assert.equal(restored.status,0,restored.stderr);
 stage='role-acceptance';
 const quarantine=owner("do $quiet$ begin if exists(select from pg_publication_tables where schemaname='public') then raise exception 'CREDENTIAL_REALTIME_NOT_QUARANTINED';end if;end $quiet$;");assert.equal(quarantine.status,0,quarantine.stderr);
 let denied=0;
 for(const roleName of ['anon','authenticated']){
  for(const table of ['client_credentials','client_credential_events']){
   const r=execute(cluster.user,process.env.PGPASSWORD,`begin;set local role ${roleName};select * from public.${table} limit 0;rollback;`);
   assert.notEqual(r.status,0);assert.match(r.stderr,new RegExp('permission denied for table ' + table));denied++;
  }
  const r=execute(cluster.user,process.env.PGPASSWORD,`begin;set local role ${roleName};do $rev$ begin if (select rev from public.client_credentials_rev where client_slug='synthetic-credential') is distinct from 7::bigint then raise exception 'CREDENTIAL_REVISION_NOT_RESTORED';end if;end $rev$;rollback;`);
  assert.equal(r.status,0,r.stderr);
 }
 const uniqueness=owner(`begin;do $unique$ begin begin insert into public.client_credentials(client_slug,client_name,platform,label) values('synthetic-credential','Synthetic','SYNTHETIC','MAIN');raise exception 'CREDENTIAL_DUPLICATE_ACCEPTED';exception when unique_violation then null;end;end $unique$;rollback;`);assert.equal(uniqueness.status,0,uniqueness.stderr);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_CREDENTIAL_RECOVERY_OK',classification:'ISOLATED_POSTGRES_SYNTHETIC_TRIPLE',inventory_sha256:inventory.inventory_sha256,source,parent_tables:52,populated_priority_tables:9,populated_credential_tables:3,credential_rows:3,event_rows:3,revision_rows:1,legacy_renderers_refused:true,late_row_fault_rollbacks:2,protected_role_denials:denied,revision_role_reads:2,partial_unique_constraint_enforced:true,shared_snapshot_capture:true,concurrent_three_table_write_kept_out_of_snapshot:true,local_storage:{all_three_reopened_before_restore:true,container_sha256:stored.container_sha256,atomic_no_overwrite:stored.atomic_no_overwrite,power_loss_durability_proven:false,off_device_custody_proven:false},encryption_proven:false,handler_behavior_proven:false,realtime_quarantine_preserved:true,hosted_restore_proven:false}));
}catch(e){if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'credential-recovery.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_CREDENTIAL_RECOVERY_FAILED',stage}));process.exitCode=1;}
finally{if(targetDb)cluster.run('','postgres',{sql:`drop database if exists ${targetDb}`});cluster.stop();}}
main();
