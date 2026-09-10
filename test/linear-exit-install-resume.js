'use strict';
// One fresh Node process per completed-entry boundary, using an owned local
// cluster. Does not prove kill recovery or partial internal SQL commits.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {bootCluster,scalar}=require('../scripts/linear-exit-composition/harness');
const recovery=require('../scripts/track-b-recovery-package');
const {plan,COVERED,sha,signed}=require('./helpers/linear-exit-install-step');
if(process.env.F63_REQUIRE_POSTGRES!=='1'){console.log('SKIP installation resume: owned disposable PostgreSQL required');process.exit(0);}
const host=process.env.F42_REHEARSAL_SOCKET||process.env.F42_REHEARSAL_PGHOST||process.env.PGHOST||'';
assert.ok(['127.0.0.1','localhost','::1'].includes(host));
let cluster,directory,probeCreated=false;let completed=0;
const literal=v=>"'"+String(v).replace(/'/g,"''")+"'",json=v=>literal(JSON.stringify(v))+'::jsonb';
let accepted=null,preservedBoundaries=0;
const noProviderDebt=()=>assert.equal(scalar(cluster,"select count(*) from public.mirror_outbox where status in ('pending','inflight','failed')"),'0');
const admittedTables={batches:"id='resume-work-batch'",deliverables:"id='resume-work-child'",production_intake_manifests:"request_id='resume-work-request'",mirror_outbox:"entity_id in ('resume-work-batch','resume-work-child')",deliverable_events:"batch_id='resume-work-batch' or deliverable_id='resume-work-child'"};
function admittedRows(){return Object.fromEntries(Object.entries(admittedTables).map(([table,where])=>[table,JSON.parse(scalar(cluster,`select coalesce(json_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${table} t where ${where}`))]));}
function preserve(before,after){for(const table of Object.keys(before)){assert.equal(after[table].length,before[table].length,'admitted row count changed: '+table);for(const row of before[table]){const key=table==='production_intake_manifests'?'request_id':'id';const current=after[table].find(r=>r[key]===row[key]);assert.ok(current,'admitted identity missing: '+table);for(const col of Object.keys(row))assert.deepEqual(current[col],row[col],'admitted value changed: '+table+'.'+col);}}}
function seedAccepted(){
 const generationText=scalar(cluster,"select generation from public.track_b_f27_team_fences where team='video'");assert.match(generationText,/^\d+$/);const generation=Number(generationText);assert.ok(Number.isSafeInteger(generation));
 const epoch='resume-native-epoch',request='resume-work-request';
 cluster.exec(`update public.syncview_runtime_flags set value=${json({video:{enabled:true,epoch},graphics:{enabled:false,epoch:null}})} where key='native_intake_epochs'`);
 const batch={id:'resume-work-batch',client_slug:'fixture-client',team:'video',name:'Original resume parent',purpose:'calendar'};
 const row={id:'resume-work-child',batch_id:batch.id,client_slug:batch.client_slug,team:'video',kind:'video',title:'Original resume child'};
 const payload=fp=>({_intent_fingerprint:fp,_f27_authority_generation:generation,_f27_legacy_parity:false,_native_intake_epoch:epoch,_native_intake_request:request});
 const event={actor:'Fixture Admin',actor_key:'fixture-admin',role:'admin',auth_kind:'staff',surface:'submit',action:'create',source:'ui',ts:'2030-01-01T00:00:00Z',outbound:{entity:'batch',entity_id:batch.id,operation:'create',team:'video',dedup_key:'write-ui:create:batch:'+batch.id+':'+request+':video',source_edited_at:'2030-01-01T00:00:00Z',payload:payload('resume-parent-fingerprint')}};
 const childDedup='write-ui:create:deliverable:'+row.id+':'+request;
 const manifest={request_id:request,request_intent:{surface:'submit',synthetic:true},native_epochs:{video:epoch},authority_generations:{video:generation},expected_items:[{item_index:0,row,child_dedup:childDedup,child_fingerprint:'resume-child-fingerprint'}]};
 const childEvent={...event,outbound:{...event.outbound,entity:'deliverable',entity_id:row.id,dedup_key:childDedup,payload:payload('resume-child-fingerprint')}};
 const replay=`set role service_role;select public.production_intake_root_begin(${json(batch)},${json(event)},${json(manifest)});select public.production_deliverable_write(${json(row)},${json(childEvent)});`;
 cluster.exec(replay);const rows=admittedRows();
 assert.equal(rows.batches.length,1);assert.equal(rows.deliverables.length,1);assert.equal(rows.production_intake_manifests.length,1);assert.equal(rows.mirror_outbox.length,2);assert.ok(rows.deliverable_events.length>0);
 assert.equal(rows.production_intake_manifests[0].native_epochs.video,epoch);
 for(const receipt of rows.mirror_outbox){assert.equal(receipt.status,'skipped');assert.equal(receipt.payload._native_intake_request,request);assert.equal(receipt.payload._native_intake_epoch,epoch);}
 assert.equal(scalar(cluster,"select count(*) from public.mirror_outbox where status in ('pending','inflight','failed')"),'0');
 return {rows,replay};
}
try{
 const p=plan(),crypto=require('node:crypto'),key=crypto.randomBytes(32).toString('hex'),runId=crypto.randomUUID();cluster=bootCluster();directory=fs.mkdtempSync(path.join(os.tmpdir(),'linear-exit-resume-'));
 const checkpoint=path.join(directory,'checkpoint.json');
 fs.writeFileSync(checkpoint,JSON.stringify(signed({inventory_sha256:p.digest,run_id:runId,database_identity:sha(JSON.stringify([cluster.host,String(cluster.port),cluster.user,cluster.db])),completed:[],catalog_md5:scalar(cluster,recovery.fingerprintSql())},key)),{flag:'wx'});
 const child=()=>cp.spawnSync(process.execPath,[path.join(__dirname,'helpers/linear-exit-install-step.js'),checkpoint],{encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,INSTALL_STEP_HMAC_KEY:key,INSTALL_STEP_RUN_ID:runId,INSTALL_STEP_PSQL:cluster.psql,INSTALL_STEP_HOST:cluster.host,INSTALL_STEP_PORT:String(cluster.port),INSTALL_STEP_USER:cluster.user,INSTALL_STEP_DB:cluster.db}});
 console.log(JSON.stringify({classification:'ISOLATED_POSTGRES_ENTRY_RESUME',inventory_sha256:p.digest,bootstrap_source_owners:COVERED,partial_baseline:'eight dated Calendar/Samples statements plus existing F42 platform scaffold',entries:p.remaining.length,full_baseline_proven:false,process_kill_recovery_proven:false,per_internal_commit_proven:false}));
 for(const id of p.remaining){
  if(accepted){preserve(accepted.rows,admittedRows());noProviderDebt();}
  if(completed===1){
   const before=fs.readFileSync(checkpoint,'utf8');
   const edited=JSON.parse(before);edited.completed=p.remaining.slice(0,completed+1);fs.writeFileSync(checkpoint,JSON.stringify(edited));
   const forged=child();assert.notEqual(forged.status,0);assert.match(forged.stderr,/checkpoint_auth_invalid/);assert.doesNotMatch(forged.stdout,/owner_execution_started/);
   fs.writeFileSync(checkpoint,before);
   console.log('PASS edited longer valid prefix with current catalog refused before owner execution');
   // A deliberate fault-injection object, never an application prerequisite.
   assert.equal(scalar(cluster,"select to_regclass('public.synthetic_install_resume_catalog_probe') is null"),'t');
   cluster.exec('create table public.synthetic_install_resume_catalog_probe(probe integer)');probeCreated=true;
   const refused=child();assert.notEqual(refused.status,0);assert.match(refused.stderr,/catalog_prefix_drift/);assert.doesNotMatch(refused.stdout,/owner_execution_started/);assert.equal(fs.readFileSync(checkpoint,'utf8'),before);
   cluster.exec('drop table public.synthetic_install_resume_catalog_probe');probeCreated=false;
   assert.equal(scalar(cluster,recovery.fingerprintSql()),JSON.parse(before).catalog_md5);
   console.log('PASS fresh child refused committed catalog drift before owner execution; checkpoint unchanged; diagnostic probe removed');
  }
  const result=child();if(result.stdout)process.stdout.write(result.stdout);if(result.status!==0){if(result.stderr)process.stderr.write(result.stderr);throw Error('entry_resume_failed:'+id);}
  completed++;const saved=JSON.parse(fs.readFileSync(checkpoint,'utf8'));assert.deepEqual(saved.completed,p.remaining.slice(0,completed));assert.equal(saved.inventory_sha256,p.digest);
  if(id==='atomic-native-intake'){accepted=seedAccepted();console.log('PASS actual native parent/child accepted with exact manifest dedup, skipped receipts and zero provider debt');}
  else if(accepted){preserve(accepted.rows,admittedRows());noProviderDebt();preservedBoundaries++;console.log(JSON.stringify({accepted_work_preserved_after:id}));}
 }
 assert.ok(accepted,'atomic intake acceptance case must run');const beforeReplay=admittedRows();cluster.exec(accepted.replay);assert.deepEqual(admittedRows(),beforeReplay,'exact accepted-call replay changed rows');preserve(accepted.rows,admittedRows());
 noProviderDebt();
 console.log('PASS exact accepted parent/child replay preserves all final row images without duplicates');
 assert.equal(plan().digest,p.digest);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_INSTALL_RESUME_OK',accepted_business_work_preservation_proven:true,accepted_work_later_boundaries:preservedBoundaries,entries:completed,fresh_child_processes:completed+2,divergence_refusal:true,forged_prefix_refusal:true,parent_crash_key_custody_proven:false,concurrent_worker_safety_proven:false,full_baseline_proven:false,process_kill_recovery_proven:false,per_internal_commit_proven:false}));
}catch(e){console.error(JSON.stringify({marker:'LINEAR_EXIT_INSTALL_RESUME_FAILED',completed,code:e.message}));process.exitCode=1;
}finally{
 try{if(cluster){try{if(probeCreated)cluster.exec('drop table public.synthetic_install_resume_catalog_probe');}finally{cluster.stop();}}}
 finally{if(directory){for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);}}
}
