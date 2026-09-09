'use strict';
/* F63 actual PostgreSQL transaction proof. Synthetic rows only. */
const assert=require('node:assert/strict'),path=require('node:path');
const {bootCluster,MIGRATIONS,count}=require('../scripts/native-intake-manifest/harness');
if(process.env.F63_REQUIRE_POSTGRES!=='1'){console.log('SKIP native ordinary receipts PostgreSQL: F63 disposable PostgreSQL required');process.exit(0)}
const host=process.env.F42_REHEARSAL_SOCKET||process.env.F42_REHEARSAL_PGHOST||process.env.PGHOST||'';
if(!['localhost','127.0.0.1','::1'].includes(host))throw Error('native ordinary receipt proof requires loopback disposable PostgreSQL');
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])delete process.env[k];
let c; const ok=(n,v)=>{assert.ok(v,n);console.log('  ok '+n)};
const q=s=>c.exec(s);
try{
 c=bootCluster();
 for(const f of ['2026-09-09-native-ordinary-receipts.sql','2026-09-11-native-ordinary-receipt-repair.sql','2026-09-12-native-ordinary-envelope-repair.sql'])c.runFile(path.join(MIGRATIONS,f));
 q("insert into public.deliverables(id,client_slug,team,title,status,updated_at) values('nor-d','fixture-client','video','before','draft',now())");
 q("update public.syncview_runtime_flags set value='{\"schema_version\":1,\"video\":{\"mode\":\"provider\",\"epoch\":null},\"graphics\":{\"mode\":\"provider\",\"epoch\":null}}'::jsonb where key='production_native_ordinary_receipts'");
 const event=(dedup,test=false,parity=false)=>`'{"actor":"Fixture Admin","role":"admin","outbound":{"entity":"deliverable","entity_id":"nor-d","operation":"status","dedup_key":"${dedup}","source_edited_at":"2026-09-09T00:00:00Z","test_only":${test},"legacy_parity":${parity},"payload":{"_intent_fingerprint":"fp-${dedup}"}}}'::jsonb`;
 const row="'{\"id\":\"nor-d\",\"client_slug\":\"fixture-client\",\"team\":\"video\",\"status\":\"doing\"}'::jsonb";
 q(`select public.production_deliverable_write(${row},${event('provider-test',true,false)})`);
 ok('provider TEST envelope survives native helper provider default',q("select status='pending' from public.mirror_outbox where dedup_key='provider-test'").includes('t'));
 q("update public.syncview_runtime_flags set value='{\"schema_version\":1,\"video\":{\"mode\":\"native\",\"epoch\":\"proof-1\"},\"graphics\":{\"mode\":\"provider\",\"epoch\":null}}'::jsonb where key='production_native_ordinary_receipts'");
 q(`select public.production_deliverable_write(${row},${event('native-one')})`);
 ok('native owner commits terminal typed receipt',q("select status='skipped' and linear_result->>'native_ordinary'='true' from public.mirror_outbox where dedup_key='native-one'").includes('t'));
 const before=count(c,"select * from public.deliverable_events where deliverable_id='nor-d'");
 q(`select public.production_deliverable_write(${row},${event('native-one')})`);
 ok('exact replay creates no additional event',count(c,"select * from public.deliverable_events where deliverable_id='nor-d'")===before);
 let forged=false;try{q("insert into public.mirror_outbox(deliverable_id,op,payload,entity,entity_id,operation,client_slug,team,dedup_key,source_edited_at,status,actor,role,test_only,legacy_parity) values('nor-d','update_state','{\"_native_ordinary_receipt\":{\"schema\":1,\"epoch\":\"proof-1\",\"owner\":\"deliverable\",\"operation\":\"status\",\"token\":\"00000000-0000-4000-8000-000000000000\"}}','deliverable','nor-d','status','fixture-client','video','forged',now(),'pending','Fixture Admin','admin',false,false)")}catch(e){forged=/native_ordinary_receipt_invalid/.test(e.message)}
 ok('forged marker cannot become a receipt',forged);
 const admissions=count(c,'select * from public.production_native_ordinary_receipt_admissions');
 let rolled=false;try{q("begin; select public.production_native_ordinary_event('{\"actor\":\"Fixture Admin\",\"role\":\"admin\",\"outbound\":{\"entity\":\"deliverable\",\"entity_id\":\"nor-d\",\"operation\":\"status\",\"dedup_key\":\"rollback\",\"source_edited_at\":\"2026-09-09T00:00:00Z\",\"test_only\":false,\"legacy_parity\":false,\"payload\":{\"_intent_fingerprint\":\"rollback\"}}}'::jsonb,'{\"owner\":\"deliverable\",\"entity\":\"deliverable\",\"entity_id\":\"nor-d\",\"receipt_operation\":\"status\",\"native_operation\":\"status\",\"client_slug\":\"fixture-client\",\"team\":\"video\",\"actor\":\"Fixture Admin\",\"role\":\"admin\"}'::jsonb); select 1/0; commit;")}catch(e){rolled=true;q('rollback')}
 ok('failed transaction leaves no admission token',rolled&&count(c,'select * from public.production_native_ordinary_receipt_admissions')===admissions);
 console.log('NATIVE_ORDINARY_RECEIPTS_POSTGRES_OK');
}finally{if(c)c.stop()}
