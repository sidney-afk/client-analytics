'use strict';
// Actual metadata SQL against the same published inventory's ordered local
// schema. Configuration readiness and current hosted baseline are not proven.
const assert=require('node:assert/strict');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
const {scalar}=require('../scripts/linear-exit-composition/harness');
const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
const {contractQuery,expectedObjects,validateRows,PreflightError}=require('../scripts/linear-exit-deploy-preflight');
if(process.env.F63_REQUIRE_POSTGRES!=='1'){console.log('SKIP ordered preflight: owned disposable PostgreSQL required');process.exit(0);}
const cluster=new Cluster();assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
try{
 const source={};const proof=install(source,()=>null);assert.equal(source.name,cluster.db);
 const rows=JSON.parse(scalar(cluster,`select json_agg(t) from (${contractQuery('metadata')}) t`));
 const keys=expectedObjects().keys.filter(key=>!key.startsWith('config:'));
 // Enforce exact response keys before any externally visible diagnostic.
 assert.deepEqual(rows.map(r=>r.object_key).sort(),keys.slice().sort(),'metadata_key_set_invalid');
 console.log(JSON.stringify({classification:'ISOLATED_POSTGRES_METADATA',objects:rows.map(r=>({object_key:r.object_key,present:r.present===true,compatible:r.compatible===true})),configuration_readiness_proven:false}));
 const result=validateRows(rows,keys);
 cluster.exec('alter function public.production_native_signoff_verify(text[]) volatile');
 const wrongVolatility=JSON.parse(scalar(cluster,`select json_agg(t) from (${contractQuery('metadata')}) t`));
 assert.equal(wrongVolatility.find(r=>r.object_key==='routine:production_native_signoff_verify(text[])')?.compatible,false);
 assert.throws(()=>validateRows(wrongVolatility,keys),PreflightError);
 cluster.exec('alter function public.production_native_signoff_verify(text[]) stable');

 console.log(JSON.stringify({marker:'LINEAR_EXIT_PREFLIGHT_ORDERED_OK',checked_objects:result.checked_objects,inventory_sha256:proof.inventory_sha256,configuration_readiness_proven:false,hosted_readiness_proven:false}));
}catch(error){
 console.error(JSON.stringify({marker:'LINEAR_EXIT_PREFLIGHT_ORDERED_FAILED',code:error instanceof PreflightError?error.code:'ISOLATED_METADATA_PROOF_FAILED',object_keys:error instanceof PreflightError?error.objectKeys:[]}));process.exitCode=1;
}finally{cluster.stop();}
