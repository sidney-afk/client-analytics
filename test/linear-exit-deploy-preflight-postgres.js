'use strict';
const assert=require('node:assert/strict');
const {bootCluster,scalar}=require('../scripts/linear-exit-composition/harness');
const {contractQuery,readContract}=require('../scripts/linear-exit-deploy-preflight');
if(process.env.F63_REQUIRE_POSTGRES!=='1'){console.log('SKIP preflight PostgreSQL: disposable lane required');process.exit(0);}
const host=process.env.F42_REHEARSAL_SOCKET||process.env.F42_REHEARSAL_PGHOST||process.env.PGHOST||'';
assert.ok(['127.0.0.1','localhost','::1'].includes(host));
async function main(){let cluster;try{
 cluster=bootCluster();const rows=query=>JSON.parse(scalar(cluster,`select json_agg(t) from (${query}) t`));
 assert.equal(scalar(cluster,"select to_regclass('public.production_notification_config') is null"),'t');
 let requests=0;
 await assert.rejects(()=>readContract({token:'synthetic-test-only',projectRef:'a'.repeat(20),fetchImpl:async(_url,init)=>{
  requests++;const result=rows(JSON.parse(init.body).query);return {ok:true,status:200,json:async()=>result};
 }}),error=>error.code==='CONTRACT_ABSENT'&&error.objectKeys.includes('relation:production_notification_config'));
 assert.equal(requests,1,'missing real relation must prevent configuration query');
 // Only substitute a synthetic row source to exercise malformed values that
 // production's CHECK constraint normally rejects. SQL predicates are exact.
 for(const [value,compatible] of [[null,false],[[],false],['scalar',false],[3,false],[{},false],[{channel_id:'C12345678'},true],[{channel_id:'C12345678',extra:true},false]]){
  const literal="'"+JSON.stringify(value).replace(/'/g,"''")+"'::jsonb";
  const query=contractQuery('configuration').replace('public.production_notification_config c',`(select 'urgent_video_destination'::text as key,${literal} as value) c`);
  const result=rows(query).find(row=>row.object_key==='config:urgent_video_destination');assert.equal(result.present,true);assert.equal(result.compatible,compatible);
 }
 console.log('LINEAR_EXIT_PREFLIGHT_POSTGRES_OK absent relation stops read; seven real SQL JSON-shape cases');
}finally{if(cluster)cluster.stop();}}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
