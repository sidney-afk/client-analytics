'use strict';
// Executes only in an explicitly owned disposable PG16 lane. This is a source
// ordering experiment, not a production installer or interruption/resume proof.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const inventory=require('../scripts/linear-exit-install-manifest');
const recovery=require('../scripts/track-b-recovery-package');
const {bootCluster,CHAIN,SUBJECTS,ROOT,scalar}=require('../scripts/linear-exit-composition/harness');
if(process.env.F63_REQUIRE_POSTGRES!=='1'){console.log('SKIP installation order: owned disposable PostgreSQL required');process.exit(0);}
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])assert.equal(process.env[key],undefined,'routing override forbidden: '+key);
const host=process.env.F42_REHEARSAL_SOCKET||process.env.F42_REHEARSAL_PGHOST||process.env.PGHOST||'';
assert.ok(['localhost','127.0.0.1','::1'].includes(host),'owned loopback PostgreSQL required');
const COVERED=[
 '2026-07-03-a1-calendar-upsert.sql','2026-07-05-b0-linear-auth-scaffold.sql',...CHAIN,...SUBJECTS,
 '2026-07-23-f201-production-labels.sql','2026-07-23-f202-production-descriptions.sql',
 '2026-07-23-production-comment-thread-lifecycle.sql','2026-07-23-f34-f53-production-attachments.sql',
 '2026-08-06-artifact-projection-scope-and-revision.sql','2026-08-30-artifact-video-projection.sql',
 '2026-09-05-artifact-card-binding-first.sql','2026-07-20-f27-team-rollback.sql',
];
let cluster,temp,current='bootstrap';const prefixes=[];
try{
 const inventoryPath=path.join(ROOT,'docs/independence/LINEAR_EXIT_INSTALL_SOURCE_INVENTORY_20260910.json');
 const inventoryBytes=fs.readFileSync(inventoryPath),manifest=JSON.parse(inventoryBytes.toString('utf8'));inventory.verify(manifest);
 const inventorySha256=crypto.createHash('sha256').update(inventoryBytes).digest('hex');
 const byId=new Map(manifest.entries.map(e=>[e.id,e]));
 for(const id of COVERED)assert.ok(byId.has(id),'bootstrap owner missing from inventory: '+id);
 console.log(JSON.stringify({classification:'ISOLATED_POSTGRES_ORDER_ONLY',inventory_sha256:inventorySha256,bootstrap_full_source_owners:COVERED,
   partial_capture:'live-schema-baseline-2026-07-03.sql: eight extracted Calendar/Samples statements only',
   scaffold:'existing F42 synthetic platform and fixture rows; current full hosted baseline UNPROVEN',
   installation_authorized:false,resume_proven:false,business_operations_proven:false}));
 cluster=bootCluster();
 const record=(id,transaction=null)=>{const fingerprint=scalar(cluster,recovery.fingerprintSql());assert.match(fingerprint,/^[a-f0-9]{32}$/);prefixes.push({id,fingerprint,transaction});console.log(JSON.stringify({prefix:prefixes.length,id,after_entry_catalog_md5:fingerprint,transaction,per_commit_interruption_proven:false}));};
 record('bootstrap_partial_baseline');
 const skip=new Set([...COVERED,'live-schema-baseline-2026-07-03.sql']);
 for(const id of manifest.dependency_order){
  if(skip.has(id))continue;current=id;const e=byId.get(id);let file;
  if(e.scope==='atomic_generated_owner'){
   const artifact=require('../scripts/native-intake-named-append-compose').fromRepository();
   assert.equal(crypto.createHash('sha256').update(artifact.sql).digest('hex'),e.sha256);
   temp=fs.mkdtempSync(path.join(os.tmpdir(),'linear-exit-install-order-'));file=path.join(temp,'atomic.sql');fs.writeFileSync(file,artifact.sql,{flag:'wx'});
  }else{file=path.join(ROOT,e.path);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),e.sha256);}
  // No implicit --single-transaction: preserve actual per-file boundaries.
  const r=cp.spawnSync(cluster.psql,['-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',cluster.host,'-p',String(cluster.port),'-U',cluster.user,'-d',cluster.db,'-f',file],{encoding:'utf8',windowsHide:true,env:{...process.env,PGCLIENTENCODING:'UTF8'}});
  if(r.status!==0){const error=new Error('installation_order_entry_failed');error.sqlstate=((r.stderr||'').match(/ERROR:\s+([0-9A-Z]{5}):/)||[])[1]||'UNAVAILABLE';error.detail=r.stderr||r.error&&r.error.message||'psql failed';throw error;}
  record(id,e.transaction);
 }
 assert.deepEqual(fs.readFileSync(inventoryPath),inventoryBytes,'published inventory changed during ordered run');
 inventory.verify(manifest);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_INSTALL_ORDER_OK',inventory_sha256:inventorySha256,applied_entries:prefixes.length-1,bootstrap_owners:COVERED.length,full_baseline_proven:false,resume_proven:false,business_operations_proven:false}));
}catch(error){
 console.error(JSON.stringify({marker:'LINEAR_EXIT_INSTALL_ORDER_FAILED',entry:current,sqlstate:error.sqlstate||'UNAVAILABLE',completed_prefixes:prefixes.length,code:error.message}));
 if(error.detail)console.error(error.detail);else console.error(error.stack);
 process.exitCode=1;
}finally{
 try{if(cluster)cluster.stop();}finally{if(temp){const file=path.join(temp,'atomic.sql');if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(temp);}}
}
