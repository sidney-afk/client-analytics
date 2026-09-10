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
try{
 const p=plan(),crypto=require('node:crypto'),key=crypto.randomBytes(32).toString('hex'),runId=crypto.randomUUID();cluster=bootCluster();directory=fs.mkdtempSync(path.join(os.tmpdir(),'linear-exit-resume-'));
 const checkpoint=path.join(directory,'checkpoint.json');
 fs.writeFileSync(checkpoint,JSON.stringify(signed({inventory_sha256:p.digest,run_id:runId,database_identity:sha(JSON.stringify([cluster.host,String(cluster.port),cluster.user,cluster.db])),completed:[],catalog_md5:scalar(cluster,recovery.fingerprintSql())},key)),{flag:'wx'});
 const child=()=>cp.spawnSync(process.execPath,[path.join(__dirname,'helpers/linear-exit-install-step.js'),checkpoint],{encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,INSTALL_STEP_HMAC_KEY:key,INSTALL_STEP_RUN_ID:runId,INSTALL_STEP_PSQL:cluster.psql,INSTALL_STEP_HOST:cluster.host,INSTALL_STEP_PORT:String(cluster.port),INSTALL_STEP_USER:cluster.user,INSTALL_STEP_DB:cluster.db}});
 console.log(JSON.stringify({classification:'ISOLATED_POSTGRES_ENTRY_RESUME',inventory_sha256:p.digest,bootstrap_source_owners:COVERED,partial_baseline:'eight dated Calendar/Samples statements plus existing F42 platform scaffold',entries:p.remaining.length,full_baseline_proven:false,process_kill_recovery_proven:false,per_internal_commit_proven:false}));
 for(const id of p.remaining){
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
 }
 assert.equal(plan().digest,p.digest);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_INSTALL_RESUME_OK',entries:completed,fresh_child_processes:completed+2,divergence_refusal:true,forged_prefix_refusal:true,parent_crash_key_custody_proven:false,concurrent_worker_safety_proven:false,full_baseline_proven:false,process_kill_recovery_proven:false,per_internal_commit_proven:false}));
}catch(e){console.error(JSON.stringify({marker:'LINEAR_EXIT_INSTALL_RESUME_FAILED',completed,code:e.message}));process.exitCode=1;
}finally{
 try{if(cluster){try{if(probeCreated)cluster.exec('drop table public.synthetic_install_resume_catalog_probe');}finally{cluster.stop();}}}
 finally{if(directory){for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);}}
}
