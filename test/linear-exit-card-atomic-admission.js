'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])if(process.env[key])throw Error('INHERITED_DATABASE_ROUTING_REFUSED');
const c=new Cluster();assert.equal(c.host,'127.0.0.1');
const quote=v=>"'"+String(v).replaceAll("'","''")+"'",json=v=>quote(JSON.stringify(v))+'::jsonb';
const root=path.resolve(__dirname,'..');let stage='install',child;
const raw=sql=>cp.spawnSync(c.psql,['-X','-q','-h',c.host,'-p',c.port,'-U',c.user,'-d',c.db,'-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',windowsHide:true});
const call=(id,request)=>c.scalarJson(`set local role service_role;select public.production_card_atomic_write_v1(${quote(id)},${json(request)})`);
async function main(){try{
 const inventory=require('../scripts/linear-exit-composition/recovery-ordered').install({},()=>null);
 c.runFile(path.join(root,'migrations/2026-06-18-atomic-comment-merge.sql'));
 c.runFile(path.join(root,'supabase/migrations/20260912174907_card_atomic_admission_preparation.sql'));
 const epoch=c.scalarJson('select to_jsonb(epoch) from card_write_admission_v1');
 const requests={};let count=0;
 for(const surface of ['calendar','samples']){
  stage=surface+'-atomic';const id='00000000-0000-4000-8000-0000000009'+(++count)+'0',table=surface==='calendar'?'calendar_posts':'sample_reviews',eventKey=surface==='calendar'?'post_id':'sample_id';
  const request={surface,client:'fixture-client',id:'atomic-'+surface,expected_existing:null,row:{client:'fixture-client',id:'atomic-'+surface,name:'Before',status:'In Progress'},events:[{client:'fixture-client',[eventKey]:'atomic-'+surface,action:'create',payload:{synthetic:true}}],followups:[{kind:'graphic_baseline',payload:{surface,client:'fixture-client',sourceId:'atomic-'+surface}},{kind:'graphic_resolution',payload:{surface,client:'fixture-client',sourceId:'atomic-'+surface}}]};
  const first=call(id,request);assert.equal(first.ok,true);assert.equal(first.replayed,false);assert.equal(call(id,request).replayed,true);requests[surface]={id,request};
  const before=c.scalarJson(`select to_jsonb(t) from ${table} t where client='fixture-client' and id='atomic-${surface}'`);
  const bad={...request,expected_existing:before,row:{...request.row,name:'Must roll back',video_tweaks:'[{"id":"synthetic-comment","body":"retained","created_at":"2026-09-12T00:00:00Z"}]'},events:[{client:'fixture-client',[eventKey]:'atomic-'+surface}],followups:[]};
  const failed=raw(`set role service_role;select production_card_atomic_write_v1(${quote(id.slice(0,-1)+'1')},${json(bad)});`);assert.notEqual(failed.status,0);
  assert.deepEqual(c.scalarJson(`select to_jsonb(t) from ${table} t where client='fixture-client' and id='atomic-${surface}'`),before,'event refusal rolls back merged comment and scalar update');
  assert.equal(c.scalarJson(`select count(*)::int from card_write_operations_v1 where operation_id=${quote(id.slice(0,-1)+'1')}`),0);
  const good={...bad,events:[{client:'fixture-client',[eventKey]:'atomic-'+surface,action:'comment_add'}],row:{...bad.row,name:'After'}};
  assert.equal(call(id.slice(0,-1)+'2',good).row.name,'After');
  assert.notEqual(raw(`set role service_role;select production_card_atomic_write_v1(${quote(id.slice(0,-1)+'3')},${json(good)});`).status,0,'stale preimage refused');
 }
 stage='admitted-transaction-versus-close';
 const lockId='00000000-0000-4000-8000-000000000999';const lockRequest={surface:'calendar',client:'fixture-client',id:'atomic-race',expected_existing:null,row:{client:'fixture-client',id:'atomic-race',name:'Race'},events:[],followups:[]};
 child=cp.spawn(c.psql,['-X','-q','-t','-A','-h',c.host,'-p',c.port,'-U',c.user,'-d',c.db,'-v','ON_ERROR_STOP=1','-f','-'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b);
 const done=new Promise(resolve=>child.on('close',resolve));
 const admitted=new Promise((resolve,reject)=>{let text='';child.stdout.on('data',b=>{text+=b;if(text.includes('ATOMIC_ADMITTED'))resolve();});child.on('error',reject);child.on('close',code=>{if(code!==0)reject(Error('admission child failed'));});});
 child.stdin.end(`begin;set local role service_role;select production_card_atomic_write_v1(${quote(lockId)},${json(lockRequest)});select 'ATOMIC_ADMITTED';select pg_sleep(2);commit;`);
 await admitted;
 assert.notEqual(raw(`set role service_role;set lock_timeout='100ms';select production_card_admission_close_v1(${quote(epoch)},'synthetic close');`).status,0,'close must wait for owning transaction');
 assert.equal(await done,0,stderr);child=null;
 c.exec(`set local role service_role;select production_card_admission_close_v1(${quote(epoch)},'synthetic close');`);
 assert.equal(call(requests.calendar.id,requests.calendar.request).replayed,true,'exact replay allowed after close');
 assert.notEqual(raw(`set role service_role;select production_card_atomic_write_v1('00000000-0000-4000-8000-000000000998',${json({...lockRequest,id:'after-cutoff',row:{client:'fixture-client',id:'after-cutoff'}})});`).status,0);
 assert.notEqual(raw(`set role service_role;select production_card_admission_seal_v1(${quote(epoch)});`).status,0,'pending tasks block seal');
 stage='durable-failure-disposition';
 const tasks=c.scalarJson('set local role service_role;select jsonb_agg(t) from production_card_followup_claim_v1(10) t');assert.equal(tasks.length,4);
 for(const task of tasks){
  assert.notEqual(raw(`set role service_role;select production_card_followup_fail_v1(${quote(task.operation_id)},${quote(task.kind)},${task.attempt+1},${quote(task.lease_token)},'wrong attempt');`).status,0);
  c.exec(`set local role service_role;select production_card_followup_fail_v1(${quote(task.operation_id)},${quote(task.kind)},${task.attempt},${quote(task.lease_token)},'synthetic interrupted effect');`);
 }
 assert.notEqual(raw(`set role service_role;select production_card_admission_seal_v1(${quote(epoch)});`).status,0,'failed tasks block seal');
 for(const task of tasks){const hash=c.scalarJson(`select to_jsonb(request_sha256) from card_write_operations_v1 where operation_id=${quote(task.operation_id)}`);c.exec(`set local role service_role;select production_card_followup_dispose_v1(${quote(task.operation_id)},${quote(task.kind)},${quote(hash)},repeat('a',64),'synthetic-reviewer','synthetic manually reviewed no-op','REVIEWED_EXACT_FOLLOWUP_DISPOSITION');`);}
 const unfenced=raw(`set role service_role;select production_card_admission_seal_v1(${quote(epoch)});`);assert.notEqual(unfenced.status,0);assert.match(unfenced.stderr,/card_admission_claimed_effect_fence_unproven/);
 assert.equal(c.scalarJson("select to_jsonb(mode) from card_write_admission_v1"),'closed');
 assert.equal(c.scalarJson("select to_jsonb(bool_and(jsonb_array_length(history)=3)) from card_write_followups_v1"),true,'claim/failure/disposition history retained');
 assert.notEqual(raw('set role service_role;select production_card_followup_claim_v1(null);').status,0);
 assert.notEqual(raw("set role anon;select production_card_followup_claim_v1(1);").status,0);
 assert.notEqual(raw("set role service_role;select production_syncview_retirement_activate('synthetic');").status,0);
 assert.equal(require('./helpers/linear-exit-install-step').plan().digest,inventory.inventory_sha256);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_CARD_ATOMIC_ADMISSION_OK',classification:'ISOLATED_POSTGRES',surfaces:2,atomic_row_comment_events:true,replay_after_close:true,admitted_transaction_blocks_close:true,durable_failures_prevent_seal:true,manual_disposition_only:true,global_freeze_proven:false,retirement_activated:false}));
}catch(e){if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'card-atomic.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_CARD_ATOMIC_ADMISSION_FAILED',stage}));process.exitCode=1;}finally{if(child)child.kill();c.stop();}}
main();
