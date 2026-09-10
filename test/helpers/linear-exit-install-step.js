'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../..');
const inventory=require('../../scripts/linear-exit-install-manifest');
const recovery=require('../../scripts/track-b-recovery-package');
const {CHAIN,SUBJECTS}=require('../../scripts/linear-exit-composition/harness');
const COVERED=['2026-07-03-a1-calendar-upsert.sql','2026-07-05-b0-linear-auth-scaffold.sql',...CHAIN,...SUBJECTS,
 '2026-07-23-f201-production-labels.sql','2026-07-23-f202-production-descriptions.sql','2026-07-23-production-comment-thread-lifecycle.sql',
 '2026-07-23-f34-f53-production-attachments.sql','2026-08-06-artifact-projection-scope-and-revision.sql','2026-08-30-artifact-video-projection.sql',
 '2026-09-05-artifact-card-binding-first.sql','2026-07-20-f27-team-rollback.sql'];
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function plan(){const bytes=fs.readFileSync(path.join(ROOT,'docs/independence/LINEAR_EXIT_INSTALL_SOURCE_INVENTORY_20260910.json'));const manifest=JSON.parse(bytes.toString('utf8'));inventory.verify(manifest);const skip=new Set([...COVERED,'live-schema-baseline-2026-07-03.sql']);return{manifest,digest:sha(bytes),remaining:manifest.dependency_order.filter(id=>!skip.has(id))};}
function authenticate(checkpoint,key){
 const {mac,...payload}=checkpoint;
 return crypto.createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(payload)).digest('hex');
}
function signed(payload,key){return {...payload,mac:authenticate(payload,key)};}
function runSql(sql,file){
 const env={...process.env};
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])delete env[key];
 assert.equal(env.F63_REQUIRE_POSTGRES,'1');assert.ok(['127.0.0.1','localhost','::1'].includes(env.INSTALL_STEP_HOST));
 const args=['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',env.INSTALL_STEP_HOST,'-p',env.INSTALL_STEP_PORT,'-U',env.INSTALL_STEP_USER,'-d',env.INSTALL_STEP_DB,'-f',file||'-'];
 const r=cp.spawnSync(env.INSTALL_STEP_PSQL,args,{encoding:'utf8',windowsHide:true,env:{...env,PGCLIENTENCODING:'UTF8'},...(file?{}:{input:sql})});
 if(r.status!==0){const e=Error('step_sql_failed');e.sqlstate=((r.stderr||'').match(/ERROR:\s+([0-9A-Z]{5}):/)||[])[1]||'UNAVAILABLE';throw e;}
 return r.stdout.trim();
}
function fingerprint(){const value=runSql(recovery.fingerprintSql());assert.match(value,/^[a-f0-9]{32}$/);return value;}
function step(checkpointFile){
 const p=plan(),checkpoint=JSON.parse(fs.readFileSync(checkpointFile,'utf8'));
 const key=process.env.INSTALL_STEP_HMAC_KEY||'';
 assert.match(key,/^[a-f0-9]{64}$/,'checkpoint_key_required');
 const expectedMac=authenticate(checkpoint,key);
 if(typeof checkpoint.mac!=='string'||! /^[a-f0-9]{64}$/.test(checkpoint.mac)||!crypto.timingSafeEqual(Buffer.from(checkpoint.mac,'hex'),Buffer.from(expectedMac,'hex')))throw Error('checkpoint_auth_invalid');
 assert.equal(checkpoint.run_id,process.env.INSTALL_STEP_RUN_ID,'checkpoint_run_mismatch');
 assert.equal(checkpoint.database_identity,sha(JSON.stringify([process.env.INSTALL_STEP_HOST,process.env.INSTALL_STEP_PORT,process.env.INSTALL_STEP_USER,process.env.INSTALL_STEP_DB])),'checkpoint_database_mismatch');
 assert.equal(checkpoint.inventory_sha256,p.digest,'inventory_drift');
 assert.ok(Array.isArray(checkpoint.completed),'checkpoint_prefix_invalid');
 assert.deepEqual(checkpoint.completed,p.remaining.slice(0,checkpoint.completed.length),'checkpoint_prefix_invalid');
 assert.ok(checkpoint.completed.length<p.remaining.length,'checkpoint_already_complete');
 assert.equal(fingerprint(),checkpoint.catalog_md5,'catalog_prefix_drift');
 const id=p.remaining[checkpoint.completed.length],entry=p.manifest.entries.find(e=>e.id===id);
 console.log(JSON.stringify({stage:'owner_execution_started',id}));
 let file,temporary;
 try{
  if(entry.scope==='atomic_generated_owner'){
   const composed=require('../../scripts/native-intake-named-append-compose').fromRepository();assert.equal(sha(composed.sql),entry.sha256);
   temporary=path.join(path.dirname(checkpointFile),'atomic-'+process.pid+'.sql');fs.writeFileSync(temporary,composed.sql,{flag:'wx'});file=temporary;
  }else{file=path.join(ROOT,entry.path);assert.equal(sha(fs.readFileSync(file)),entry.sha256);}
  runSql(null,file);assert.equal(plan().digest,p.digest,'published_inventory_drift');
  const next=signed({inventory_sha256:p.digest,run_id:checkpoint.run_id,database_identity:checkpoint.database_identity,completed:[...checkpoint.completed,id],catalog_md5:fingerprint()},key);
  const tmp=checkpointFile+'.'+process.pid+'.next';fs.writeFileSync(tmp,JSON.stringify(next),{flag:'wx'});fs.renameSync(tmp,checkpointFile);
  console.log(JSON.stringify({stage:'entry_checkpoint_saved',id,completed:next.completed.length,catalog_md5:next.catalog_md5,transaction:entry.transaction,per_internal_commit_proven:false}));
 }finally{if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
module.exports={plan,COVERED,sha,signed};
if(require.main===module){try{step(process.argv[2]);}catch(e){console.error(JSON.stringify({code:e.message,sqlstate:e.sqlstate||null}));process.exitCode=1;}}
