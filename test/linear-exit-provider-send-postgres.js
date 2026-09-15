'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
assert.equal(process.env.F63_REQUIRE_POSTGRES,'1');for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])assert(!process.env[k]);
const c=new Cluster();assert.equal(c.host,'127.0.0.1');const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
const owner='supabase/migrations/20260913034324_provider_send_admission_preparation.sql',sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),pin=sha(owner);
let stage='install',checks=0;
const args=['-X','-q','-h',c.host,'-p',c.port,'-U',c.user,'-d',c.db,'-v','ON_ERROR_STOP=1','-f','-'];
const raw=sql=>cp.spawnSync(c.psql,args,{input:sql,encoding:'utf8',windowsHide:true});
function refuse(sql,pattern){const r=raw('set role service_role;'+sql);assert.notEqual(r.status,0);assert.match(r.stderr,pattern);checks++;}
(async()=>{try{
 require('../scripts/linear-exit-composition/recovery-ordered').install({},()=>null);
 c.runFile('migrations/2026-06-18-atomic-comment-merge.sql');c.runFile('supabase/migrations/20260912174907_card_atomic_admission_preparation.sql');c.runFile(owner);
 c.exec(`update syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}' where key='prod_authority';`);
 const ids=[];for(let n=0;n<3;n++)ids.push(c.scalarJson(`select to_jsonb(mirror_outbox_enqueue('deliverable','send-proof-${n}','title',jsonb_build_object('title','synthetic','_f27_authority_generation',(select generation from track_b_f27_team_fences where team='graphics')),'send-proof-${n}',now(),'fixture-client','graphics'))`));
 const token=crypto.randomUUID(),epoch=c.scalarJson('select to_jsonb(epoch) from card_write_admission_v1');c.exec(`update mirror_outbox set lock_token=${q(token)},locked_at=now() where id in (${ids.join(',')});`);
 const request={kind:'issueUpdate',query:'mutation Synthetic { synthetic }',variables:{input:{title:'synthetic'}}};
 const admit=(id=ids[0],lock=token,e=epoch,replay=null)=>`select production_provider_send_admit_v1(${q(e)},${id},${q(lock)},${j(request)},${j(replay)});`;
 stage='refusals';for(const role of ['anon','authenticated','service_role']){const r=raw(`set role ${role};select * from linear_exit_provider.send_attempts_v1;`);assert.notEqual(r.status,0);checks++;}
 refuse(admit(ids[0],crypto.randomUUID()),/provider_send_outbox_binding/);refuse(admit(ids[0],token,crypto.randomUUID()),/provider_send_admission_closed/);refuse(admit(ids[0],token,epoch,{rollbackId:crypto.randomUUID()}),/provider_send_replay_not_prepared/);
 stage='admitted-transaction-race';const child=cp.spawn(c.psql,args,{env:{...process.env,PGAPPNAME:'provider-admit-proof'},windowsHide:true,stdio:['pipe','ignore','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);const done=new Promise(resolve=>child.once('exit',resolve));child.stdin.end('begin;set local role service_role;'+admit()+"select pg_sleep(3);commit;");
 let sleeping=false;for(let n=0;n<100;n++){sleeping=c.scalarJson("select to_jsonb(exists(select from pg_stat_activity where application_name='provider-admit-proof' and wait_event='PgSleep'))");if(sleeping)break;await new Promise(r=>setTimeout(r,20));}assert(sleeping);
 refuse(`set lock_timeout='150ms';select production_card_admission_close_v1(${q(epoch)},'synthetic close');`,/lock timeout/);assert.equal(await done,0,stderr);checks++;
 stage='duplicate-no-resend';refuse(admit(),/existing_attempt_requires_reconciliation/);
 const a=c.scalarJson(`select to_jsonb(t) from linear_exit_provider.send_attempts_v1 t where outbox_id=${ids[0]}`);
 c.exec(`select production_card_admission_close_v1(${q(epoch)},'synthetic close');`);
 refuse(admit(ids[1]),/provider_send_admission_closed/);refuse(`select production_provider_send_drain_v1(${q(epoch)});`,/unresolved_attempts/);
 refuse(`select production_card_admission_seal_v1(${q(epoch)});`,/unresolved_attempts/);
 stage='provider-response-before-local-checkpoint';const response={issueUpdate:{success:true,issue:{id:'synthetic'}}};
 const ack=`select production_provider_send_ack_v1(${q(a.attempt_id)},${q(token)},${j(request)},${j(response)});`;
 assert.equal(raw('set role service_role;'+ack).status,0);checks++;
 refuse(`select production_provider_send_drain_v1(${q(epoch)});`,/unresolved_attempts/);
 const receipt={mutation:'issueUpdate',expected:request.variables,issue_id:'synthetic'};
 refuse(`select production_provider_send_complete_v1(${q(a.attempt_id)},${q(token)},${j(receipt)});`,/complete_binding/);
 // Test-only owner reset. This lane does not install/prove the complete application's recovery owner.
 stage='reopen-before-local-checkpoint';c.exec(`update card_write_admission_v1 set mode='open',epoch=gen_random_uuid(),closed_at=null,reason=null where singleton;update mirror_outbox set status='written',lock_token=null,locked_at=null,linear_result=${j(receipt)} where id=${ids[0]};`);
 const unrelated={...receipt,expected:{input:{title:'different'}}};c.exec(`update mirror_outbox set linear_result=${j(unrelated)} where id=${ids[0]};`);
 refuse(`select production_provider_send_complete_v1(${q(a.attempt_id)},${q(token)},${j(unrelated)});`,/complete_evidence/);
 c.exec(`update mirror_outbox set linear_result=${j(receipt)} where id=${ids[0]};`);
 assert.equal(raw('set role service_role;'+`select production_provider_send_complete_v1(${q(a.attempt_id)},${q(token)},${j(receipt)});`).status,0);checks++;
 const nextEpoch=c.scalarJson('select to_jsonb(epoch) from card_write_admission_v1');c.exec(`select production_card_admission_close_v1(${q(nextEpoch)},'synthetic close');`);
 const drained=c.scalarJson(`set local role service_role;select production_provider_send_drain_v1(${q(nextEpoch)});`);assert.equal(drained.tracked_attempts_drained,true);assert.equal(drained.activation_authorized,false);checks++;
 assert.equal(sha(owner),pin);console.log(JSON.stringify({marker:'LINEAR_EXIT_PROVIDER_SEND_OK',classification:'ISOLATED_POSTGRES',checks,owner_sha256:pin,admitted_close_race:true,ambiguous_attempt_blocks_drain:true,replay_prepared:false,closed_guard_completion_proven:false,external_worker_coverage_proven:false}));
 }catch(e){fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'provider-send.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_PROVIDER_SEND_FAILED',stage}));process.exitCode=1;}finally{c.stop();}})();
