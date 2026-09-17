'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])if(process.env[k])throw Error('INHERITED_DATABASE_ROUTING_REFUSED');
const c=new Cluster();assert.equal(c.host,'127.0.0.1');const root=path.resolve(__dirname,'..'),q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';let stage='install',count=0;
const raw=sql=>cp.spawnSync(c.psql,['-X','-q','-h',c.host,'-p',c.port,'-U',c.user,'-d',c.db,'-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',windowsHide:true});
async function main(){try{
 require('../scripts/linear-exit-composition/recovery-ordered').install({},()=>null);require('../scripts/linear-exit-priority-schema-supplement').apply(c);require('../scripts/linear-exit-backup-observed-baseline').apply(c);require('../scripts/linear-exit-credential-schema-supplement').apply(c);await require('./helpers/remaining-application-fixture').installAndPopulate({query:sql=>c.run('',null,{sql,tuplesOnly:true})});
 c.runFile(path.join(root,'migrations/2026-06-18-atomic-comment-merge.sql'));c.runFile(path.join(root,'qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql'));
 for(const file of ['20260912174907_card_atomic_admission_preparation.sql','20260912183653_application_dml_admission_preparation.sql','20260912184931_card_followup_outcome_proof.sql','20260912190717_provider_debt_disposition_preparation.sql'])c.runFile(path.join(root,'supabase/migrations',file));
 stage='synthetic-source-owned-hold';
 c.exec(`update syncview_runtime_flags set value='{"video":"linear","graphics":"linear"}' where key='prod_authority';update syncview_runtime_flags set value='{"mode":"off"}' where key='linear_outbound_enabled';update syncview_runtime_flags set value='{"enabled":false}' where key='linear_legacy_parity_enabled';`);
 const drill=c.scalarJson(`select track_b_f27_begin_drill('{"video":"linear","graphics":"linear"}','synthetic-owner')`);
 const drillRows=()=>c.scalarJson(`select jsonb_build_object('outbox',(select to_jsonb(o) from mirror_outbox o where f27_drill_rollback_id=${q(drill.rollback_id)}),'rollback',(select to_jsonb(r) from track_b_team_rollbacks r where id=${q(drill.rollback_id)}),'intents',(select jsonb_agg(to_jsonb(i)) from track_b_team_rollback_intents i where rollback_id=${q(drill.rollback_id)}))`);
 const drillBefore=drillRows();
 c.exec(`update syncview_runtime_flags set value='{"video":"linear","graphics":"syncview"}' where key='prod_authority';update syncview_runtime_flags set value='{"mode":"off"}' where key='linear_outbound_enabled';update syncview_runtime_flags set value='{"enabled":false}' where key='linear_legacy_parity_enabled';`);
 const ids=[];for(let n=0;n<3;n++)ids.push(c.scalarJson(`select to_jsonb(mirror_outbox_enqueue('deliverable','provider-disposition-${n}','title',jsonb_build_object('title','synthetic title',${q(n===2?'_native_unrecognized':'fixture_marker')},true,'_f27_authority_generation',(select generation from track_b_f27_team_fences where team='graphics')),'provider-disposition-${n}',now(),'fixture-client','graphics'))`));
 const held=c.scalarJson(`select track_b_f27_begin('graphics','{"video":"linear","graphics":"syncview"}','synthetic-owner')`);
 const epoch=c.scalarJson('select to_jsonb(epoch) from card_write_admission_v1 where singleton');
 c.exec(`select production_card_admission_close_v1(${q(epoch)},'synthetic-disposition-proof');`);
 const row=id=>c.scalarJson(`select to_jsonb(o) from mirror_outbox o where id=${id}`),intent=id=>c.scalarJson(`select to_jsonb(i) from track_b_team_rollback_intents i where rollback_id=${q(held.rollback_id)} and outbox_id=${id}`);
 const call=(id,classification,e=epoch,o=row(id),i=intent(id))=>`select production_provider_debt_disposition_v1(${q(e)},${q(held.rollback_id)},${id},${j(o)},${j(i)},${q(classification)},'synthetic-owner','explicit synthetic cancellation');`;
 function refuse(sql,label){const result=raw(`set role service_role;${sql}`);assert.notEqual(result.status,0,label);count++;}
 stage='refusal-controls';
 refuse(call(ids[0],'discard',crypto.randomUUID()),'stale epoch');
 refuse(call(ids[0],'replay'),'external replay cannot be authorized here');
 refuse(call(ids[0],'already_reflected'),'caller success not accepted');
 refuse(call(ids[0],'discard',epoch,{...row(ids[0]),attempts:999}),'outbox preimage');
 refuse(call(ids[0],'discard',epoch,row(ids[0]),{...intent(ids[0]),row_sha256:'0'.repeat(64)}),'intent preimage');
 refuse(`update mirror_outbox set last_error='forged' where id=${ids[0]};`,'direct closed write');
 refuse(`select set_config('app.f27_rollback_bypass','1',false);update mirror_outbox set last_error='forged' where id=${ids[0]};`,'legacy GUC not admission bypass');
 refuse(call(ids[2],'discard'),'native masquerade remains unresolved');
 const rollbackBefore=intent(ids[0]);
 refuse(`begin;${call(ids[0],'discard')}do $$begin raise exception 'synthetic late fault';end$$;commit;`,'late rollback');assert.deepEqual(intent(ids[0]),rollbackBefore);
 stage='actual-f27-disposition';
 const before=ids.map(row);
 for(const [n,classification] of ['discard','quarantine'].entries()){
  const result=raw(`set role service_role;${call(ids[n],classification)}`);assert.equal(result.status,0,result.stderr);
  assert.equal(intent(ids[n]).classification,classification);assert.equal(row(ids[n]).linear_result,null);
  if(classification==='quarantine')assert.deepEqual(row(ids[n]),before[n]);
  refuse(call(ids[n],classification),'classification cannot be rewritten');
 }
 assert.deepEqual(drillRows(),drillBefore,'reserved F27 receipt rows preserved');
 assert.equal(c.scalarJson('select to_jsonb(count(*)) from card_write_transaction_context_v1'),0);
 const history=c.scalarJson("select control_history from card_write_admission_v1 where singleton").filter(x=>x.action==='provider_disposition');assert.equal(history.length,2);assert(history.every(x=>x.provider_success_proven===false&&x.external_worker_fenced===false));
 console.log(JSON.stringify({marker:'LINEAR_EXIT_PROVIDER_DEBT_DISPOSITION_OK',classification:'ISOLATED_POSTGRES',dispositions:2,refusals:count,provider_success_proven:false,external_worker_fenced:false,closed_gate_snapshot_creation_proven:false}));
}catch(e){if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'provider-disposition.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_PROVIDER_DEBT_DISPOSITION_FAILED',stage}));process.exitCode=1;}finally{c.stop();}}
main();