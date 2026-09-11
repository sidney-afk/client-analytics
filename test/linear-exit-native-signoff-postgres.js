'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
const c=new Cluster();assert.equal(c.host,'127.0.0.1');
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
try{
 const inventory=install({},()=>null);
 c.runFile(path.join(__dirname,'../migrations/2026-09-11-native-signoff-verifier.sql'));
 c.exec(`insert into clients(slug,display_name,active,kind) values('synthetic-signoff','Synthetic',true,'client');
 insert into batches(id,client_slug,team,name,status) values('synthetic-signoff-b','synthetic-signoff','video','Synthetic','active');
 insert into deliverables(id,batch_id,client_slug,team,kind,title,status,origin) values('synthetic-signoff-d','synthetic-signoff-b','synthetic-signoff','video','video','Synthetic','in_progress','manual');
 update syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}' where key='prod_authority';
 update syncview_runtime_flags set value='{"schema_version":1,"video":{"mode":"native","epoch":"signoff-v1"},"graphics":{"mode":"native","epoch":"signoff-g1"}}' where key='production_native_ordinary_receipts';`);
 const ev={source:'ui',action:'status_change',actor:'Synthetic',role:'client',ts:'2026-09-11T00:00:00Z',outbound:{entity:'deliverable',entity_id:'synthetic-signoff-d',operation:'status',dedup_key:'synthetic-signoff-key',source_edited_at:'2026-09-11T00:00:00Z',test_only:false,legacy_parity:false,payload:{status:'approved',_intent_fingerprint:'synthetic-signoff-fp',_f27_authority_generation:0,_f27_legacy_parity:false}}};
 c.exec(`set local role service_role;select production_deliverable_write('{"id":"synthetic-signoff-d","client_slug":"synthetic-signoff","team":"video","status":"approved"}',${lit(JSON.stringify(ev))}::jsonb);`);
 const second=JSON.parse(JSON.stringify(ev));second.outbound.dedup_key='synthetic-signoff-second';second.outbound.payload._intent_fingerprint='synthetic-signoff-second-fp';second.outbound.source_edited_at='2026-09-11T00:01:00Z';
 c.exec(`set local role service_role;select production_deliverable_write('{"id":"synthetic-signoff-d","client_slug":"synthetic-signoff","team":"video","status":"approved"}',${lit(JSON.stringify(second))}::jsonb);`);
 const id=c.scalarJson("select to_jsonb(id::text) from mirror_outbox where dedup_key='synthetic-signoff-key'");assert.match(id,/^[1-9][0-9]*$/);
 const query=`select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) from public.production_native_signoff_verify(array[${lit(id)}]::text[]) v`;
 const read=()=>c.scalarJson('set local role service_role;'+query);
 const first=read();check(first.length,1);check(first[0].verified,true);check(first[0].receipt_id,id);check(first[0].entity_id,'synthetic-signoff-d');check(first[0].client_slug,'synthetic-signoff');check(Date.parse(first[0].source_edited_at),Date.parse('2026-09-11T00:00:00Z'));
 const snap=()=>c.scalarJson(`select jsonb_build_object('outbox',(select jsonb_agg(to_jsonb(o)) from mirror_outbox o),'admissions',(select jsonb_agg(to_jsonb(a)) from production_native_ordinary_receipt_admissions a),'deliverables',(select jsonb_agg(to_jsonb(d)) from deliverables d),'events',(select jsonb_agg(to_jsonb(e)) from deliverable_events e))`);
 const before=snap();
 for(const role of ['anon','authenticated']){assert.throws(()=>c.exec(`set local role ${role};${query}`),/permission denied/);checks++;}
 assert.throws(()=>c.exec('set local role service_role;select * from production_native_ordinary_receipt_admissions'),/permission denied/);checks++;
 const invalid=['null::text[]',"array[]::text[]","array[null]::text[]","array['0']","array['01']","array['-1']","array['1.0']","array['9223372036854775808']",`array[${lit(id)},${lit(id)}]`,`array(select g::text from generate_series(1,201) g)`];
 for(const input of invalid){assert.throws(()=>c.exec(`set local role service_role;select * from production_native_signoff_verify(${input})`));checks++;}
 const missing=c.scalarJson("set local role service_role;select to_jsonb(v) from production_native_signoff_verify(array['9223372036854775807']) v");check(missing,{receipt_id:'9223372036854775807',verified:false,entity_id:null,client_slug:null,source_edited_at:null});
 const mutations=[
 "update mirror_outbox set payload=jsonb_set(payload,'{_native_ordinary_receipt,token}',to_jsonb((select token::text from production_native_ordinary_receipt_admissions where dedup_key='synthetic-signoff-second'))) where dedup_key='synthetic-signoff-key'",
 "update mirror_outbox set payload=jsonb_set(payload,'{_native_ordinary_receipt,owner}','\"comment\"')",
 "update mirror_outbox set role='admin'",
 "update mirror_outbox set team='graphics'",

 "update production_native_ordinary_receipt_admissions set receipt_id=null",
 "delete from production_native_ordinary_receipt_admissions",
 "update mirror_outbox set payload=jsonb_set(payload,'{_native_ordinary_receipt,token}','\"00000000-0000-4000-8000-000000000099\"')",
 "update mirror_outbox set payload=payload-'_native_ordinary_receipt'",
 "update mirror_outbox set payload=jsonb_set(payload,'{_native_ordinary_receipt,schema}','2')",
 "update mirror_outbox set payload=jsonb_set(payload,'{_native_ordinary_receipt,epoch}','\"other-v1\"')",
 "update mirror_outbox set payload=jsonb_set(payload,'{_intent_fingerprint}','\"different\"')",
 "update mirror_outbox set payload=jsonb_set(payload,'{status}','\"in_progress\"')",
 "update mirror_outbox set actor='Other'",
 "update mirror_outbox set client_slug='different-client'",
 "update mirror_outbox set entity_id='different-entity'",
 "update mirror_outbox set source_edited_at=source_edited_at+interval '1 second'",
 "update mirror_outbox set test_only=true",
 "update mirror_outbox set legacy_parity=true",
 "update mirror_outbox set linear_result='{}'",
 "update mirror_outbox set operation='due'",
 ];
 for(const mutation of mutations){
  const result=c.scalarJson(`set local session_replication_role=replica;savepoint negative;${mutation};set local role service_role;${query};reset role;rollback to negative;`);
  check(result,[{receipt_id:id,verified:false,entity_id:null,client_slug:null,source_edited_at:null}]);
 }
 check(snap(),before);
 c.exec(`update syncview_runtime_flags set value=jsonb_set(value,'{video,epoch}','"signoff-v2"') where key='production_native_ordinary_receipts'`);
 check(read(),first);check(snap(),before);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_NATIVE_SIGNOFF_VERIFIER_OK',checks,scope:'ISOLATED_POSTGRES',actual_native_client_write:true,protected_ledger_select_denied:true,lookup_and_negative_probes_left_rows_unchanged:true,historical_epoch_valid:true,inventory_sha256:inventory.inventory_sha256,reconciler_integration:false,installation:'HOLD'}));
}catch(e){if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'native-signoff.private-error.log'),String(e.stack||e));console.error('LINEAR_EXIT_NATIVE_SIGNOFF_VERIFIER_FAILED');process.exitCode=1;}finally{c.stop();}
