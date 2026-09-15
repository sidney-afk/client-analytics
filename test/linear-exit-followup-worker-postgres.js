'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_REQUIRED');
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])if(process.env[k])throw Error('INHERITED_ROUTING');
const c=new Cluster();assert.equal(c.host,'127.0.0.1');const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const sqlOwners=['supabase/migrations/20260912174907_card_atomic_admission_preparation.sql','supabase/migrations/20260912183653_application_dml_admission_preparation.sql','supabase/migrations/20260912184931_card_followup_outcome_proof.sql','supabase/migrations/20260912190717_provider_debt_disposition_preparation.sql','supabase/migrations/20260912193102_followup_transactional_retry_preparation.sql','supabase/migrations/20260912193957_provider_closed_snapshot_preparation.sql'];const sourceHashes=()=>sqlOwners.map(path=>({path,sha256:require('crypto').createHash('sha256').update(fs.readFileSync(path)).digest('hex')}));const sqlHashes=sourceHashes();
const runtimeSources=['scripts/linear-exit-followup-endpoint.mjs','scripts/linear-exit-followup-postgres.mjs','scripts/linear-exit-followup-worker.mjs','scripts/linear-exit-followup-transaction.mjs','scripts/linear-exit-followup-compose.mjs','test/helpers/followup-worker-deno.mjs','test/linear-exit-followup-worker-postgres.js','qa/linear-exit-rehearsal/followup-deno.lock','qa/linear-exit-rehearsal/serving/samples-v50/functions/_shared/thumbnail-revisions.ts'];
const runtimeHashes=()=>runtimeSources.map(path=>({path,sha256:require('crypto').createHash('sha256').update(fs.readFileSync(path)).digest('hex')}));const initialRuntimeHashes=runtimeHashes();
let stage='install';
async function main(){try{
 require('../scripts/linear-exit-composition/recovery-ordered').install({},()=>null);
 require('../scripts/linear-exit-priority-schema-supplement').apply(c);require('../scripts/linear-exit-backup-observed-baseline').apply(c);require('../scripts/linear-exit-credential-schema-supplement').apply(c);
 await require('./helpers/remaining-application-fixture').installAndPopulate({query:sql=>c.run('',null,{sql,tuplesOnly:true})});
 const acl=fs.readFileSync('migrations/live-schema-baseline-2026-07-03.sql');assert.equal(require('crypto').createHash('sha256').update(acl).digest('hex'),'0fe101d62b3c03200e007a943ec442c75366f7467e25357085a623d21c68243f');const grants=acl.toString('utf8').match(/^grant (?:delete|insert|references|select|trigger|truncate|update) on table public\.calendar_posts to service_role;$/gm);assert.equal(grants.length,7);c.exec(grants.join('\n'));
 c.runFile('migrations/2026-06-18-atomic-comment-merge.sql');c.runFile('qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql');
 for(const owner of sqlOwners)c.runFile(owner);
 for(const [i,surface] of ['calendar','samples'].entries()){
  const id='00000000-0000-4000-8000-00000000800'+i,payload={surface,client:'fixture-client',sourceId:'worker-card',patch:{},incoming:{},existing:{}};
  const request={surface,client:payload.client,id:payload.sourceId,expected_existing:null,row:{client:payload.client,id:payload.sourceId,name:'Worker fixture'},events:[],followups:['graphic_baseline','graphic_resolution'].map(kind=>({kind,payload}))};
  c.exec('select production_card_atomic_write_v1('+q(id)+','+q(JSON.stringify(request))+'::jsonb)');
 }
 c.exec("insert into syncview_runtime_flags(key,value) values('thumbnail_revision_v2','{\"mode\":\"on\"}'::jsonb) on conflict(key) do update set value=excluded.value;update clients set active=true where slug='fixture-client';");
 for(const [j,id] of ['positive-worker','fault-worker'].entries()){
 const surface='calendar',url='https://drive.google.com/file/d/syntheticDriveFile12345/view';
 const payload={surface,client:'fixture-client',sourceId:id,patch:{graphic_status:'Tweaks Needed'},incoming:{graphic_status:'Tweaks Needed',thumbnail_url:url},existing:{graphic_status:'In Progress',thumbnail_url:url},now:'2026-09-12T00:00:00Z'};
 const request={surface,client:payload.client,id,expected_existing:null,row:{client:payload.client,id,name:'Synthetic',graphic_status:'Tweaks Needed',thumbnail_url:url},events:[],followups:[{kind:'graphic_baseline',payload}]};
 c.exec('select production_card_atomic_write_v1('+q('00000000-0000-4000-8000-00000000801'+j)+','+q(JSON.stringify(request))+'::jsonb)');
 if(j===0){const expected=c.scalarJson("select to_jsonb(t) from calendar_posts t where client='fixture-client' and id='positive-worker'");const resolution={...request,expected_existing:expected,row:{client:payload.client,id,graphic_status:'Done'},followups:[{kind:'graphic_resolution',payload:{...payload,patch:{graphic_status:'Done'},incoming:{graphic_status:'Done',thumbnail_url:url},existing:expected}}]};c.exec('select production_card_atomic_write_v1('+q('00000000-0000-4000-8000-000000008020')+','+q(JSON.stringify(resolution))+'::jsonb)');}
 }
 c.exec("create function synthetic_worker_fault() returns trigger language plpgsql as $$begin if new.source_id='fault-worker' and new.reason='graphic_tweaks_needed' then raise exception 'synthetic_worker_insert_fault';end if;return new;end$$;create trigger synthetic_worker_fault before insert on thumbnail_media_revisions for each row execute function synthetic_worker_fault();");
 c.exec("select production_card_admission_close_v1((select epoch from card_write_admission_v1),'worker proof')");
 const tasks=c.scalarJson('select jsonb_agg(t) from production_card_followup_claim_transactional_v1(10) t');assert.equal(tasks.length,7);
 fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'worker-tasks.private.json'),JSON.stringify(tasks));
 assert.equal(c.scalarJson('select to_jsonb(mode) from card_write_admission_v1'),'closed');
 const faultBefore=c.scalarJson("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from thumbnail_media_revisions t where source_id='fault-worker'");
 stage='actual-worker';
 const result=cp.spawnSync('deno',['run','--no-config','--lock=qa/linear-exit-rehearsal/followup-deno.lock','--frozen','--cached-only','--allow-read','--allow-write='+process.env.PROOF_OUTPUT_ROOT,'--allow-env','--allow-net=127.0.0.1','test/helpers/followup-worker-deno.mjs'],{env:{...process.env,WORKER_TEST_DATABASE:c.db},encoding:'utf8',windowsHide:true,timeout:90000});
 fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'worker-deno.private.log'),result.stdout||'');fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'worker-deno.private-error.log'),result.stderr||'');assert.equal(result.status,0,'worker runtime');
 const report=JSON.parse(fs.readFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'worker-results.private.json')));assert.ok(report.attempts>0);assert.equal(report.results.filter(x=>x.status==='completed').length,6);assert.equal(report.results.filter(x=>x.status==='failed').length,1);assert.equal(report.stale_refused,true);assert.ok(report.object_count>0);
 assert.equal(c.scalarJson("select count(*)::int from card_write_followups_v1 where state='completed'"),6);assert.equal(c.scalarJson('select count(*)::int from card_write_transaction_context_v1'),0);
 assert.deepEqual(c.scalarJson("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from thumbnail_media_revisions t where source_id='fault-worker'"),faultBefore);
 assert.equal(c.scalarJson("select (outcome->'worker_result'->>'changed')::int from card_write_followups_v1 where operation_id='00000000-0000-4000-8000-000000008020' and kind='graphic_resolution'"),1);
 assert.equal(c.scalarJson("select count(*)::int from thumbnail_media_revisions where source_id='fault-worker' and reason='graphic_tweaks_needed'"),0);
 assert.ok(c.scalarJson("select count(*)::int from thumbnail_media_revisions where source_id='positive-worker' and baseline_storage_path like 'immutable-sha256/%'")>0);

 assert.equal(c.scalarJson('select to_jsonb(mode) from card_write_admission_v1'),'closed');
 assert.deepEqual(sourceHashes(),sqlHashes);assert.deepEqual(runtimeHashes(),initialRuntimeHashes);assert.deepEqual(report.standalone_query_deadlines,{statement_timeout:'7s',lock_timeout:'5s',role:'service_role'});
 console.log(JSON.stringify({runtime_sources:initialRuntimeHashes,standalone_query_deadlines:report.standalone_query_deadlines,sql_owners:sqlHashes,marker:'LINEAR_EXIT_FOLLOWUP_WORKER_POSTGRES_OK',classification:'ISOLATED_ACTUAL_HELPER_TRANSACTION_SQL',completed:6,no_transition_only:false,helper_sha256:report.helper_sha256,external_requests:0,synthetic_transport_requests:report.attempts,immutable_objects:report.object_count,storage_effects_proven:true,storage_hosted_proven:false,sql_fault_rollback_proven:true,stale_attempt_refused:true,retirement_activated:false}));
 }catch(e){fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'followup-worker.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_FOLLOWUP_WORKER_POSTGRES_FAILED',stage}));process.exitCode=1;}finally{c.stop();}}
main();
