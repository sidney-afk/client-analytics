'use strict';
// Recovery's source database uses the same pinned inventory and baseline as
// the ordered lane. No additional application prerequisites are manufactured.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {bootCluster,ROOT,scalar}=require('./harness');
const {plan,COVERED,sha}=require('../../test/helpers/linear-exit-install-step');
const recovery=require('../track-b-recovery-package');
function install(source,beforeLedger){
 const p=plan(),cluster=bootCluster();source.name=cluster.db;
 let temporary,current='bootstrap';const prefixes=[];
 try{
  for(const id of p.remaining){
   current=id;const entry=p.manifest.entries.find(e=>e.id===id);let file;
   const verifyLedger=id==='2026-09-10-kasper-urgent-ping-ledger.sql'?beforeLedger(source):null;
   if(entry.scope==='atomic_generated_owner'){
    const result=require('../native-intake-named-append-compose').fromRepository();assert.equal(sha(result.sql),entry.sha256);
    temporary=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-ordered-'));file=path.join(temporary,'atomic.sql');fs.writeFileSync(file,result.sql,{flag:'wx'});
   }else{file=path.join(ROOT,entry.path);assert.equal(sha(fs.readFileSync(file)),entry.sha256);}
   cluster.runFile(file);if(verifyLedger)verifyLedger();const catalog=scalar(cluster,recovery.fingerprintSql());prefixes.push({id,after_entry_catalog_md5:catalog});
   console.log(JSON.stringify({recovery_inventory_entry:id,after_entry_catalog_md5:catalog}));
  }
  assert.equal(plan().digest,p.digest,'published inventory changed');
  return {inventory_sha256:p.digest,bootstrap_source_owners:COVERED,partial_baseline:'eight dated Calendar/Samples statements plus F42 scaffold',applied_order:p.remaining,prefixes,full_baseline_proven:false};
 }catch(e){e.message='ordered_recovery_source_failed:'+current+':'+e.message;throw e;}
 finally{if(temporary){fs.unlinkSync(path.join(temporary,'atomic.sql'));fs.rmdirSync(temporary);}}
 // Source database deliberately retained by the recovery harness/outer owned
 // portable cluster on both success and failure, matching existing receipts.
}
module.exports={install};
