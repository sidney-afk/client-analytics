'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])if(process.env[k])throw Error('INHERITED_DATABASE_ROUTING_REFUSED');
const c=new Cluster();assert.equal(c.host,'127.0.0.1');const root=path.resolve(__dirname,'..'),q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';let stage='install',count=0;
const raw=sql=>cp.spawnSync(c.psql,['-X','-q','-h',c.host,'-p',c.port,'-U',c.user,'-d',c.db,'-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',windowsHide:true});
async function main(){try{
 require('../scripts/linear-exit-composition/recovery-ordered').install({},()=>null);require('../scripts/linear-exit-priority-schema-supplement').apply(c);require('../scripts/linear-exit-backup-observed-baseline').apply(c);require('../scripts/linear-exit-credential-schema-supplement').apply(c);await require('./helpers/remaining-application-fixture').installAndPopulate({query:sql=>c.run('',null,{sql,tuplesOnly:true})});
 c.runFile(path.join(root,'migrations/2026-06-18-atomic-comment-merge.sql'));c.runFile(path.join(root,'qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql'));
 for(const file of ['20260912174907_card_atomic_admission_preparation.sql','20260912183653_application_dml_admission_preparation.sql','20260912184931_card_followup_outcome_proof.sql','20260912190717_provider_debt_disposition_preparation.sql','20260912193102_followup_transactional_retry_preparation.sql','20260912193957_provider_closed_snapshot_preparation.sql'])c.runFile(path.join(root,'supabase/migrations',file));
 stage='source-fixture';
 c.exec(`update syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}' where key='prod_authority';update syncview_runtime_flags set value='{"mode":"off"}' where key='linear_outbound_enabled';update syncview_runtime_flags set value='{"enabled":false}' where key='linear_legacy_parity_enabled';`);
 const ids=[];for(let n=0;n<3;n++){const team=n===2?'video':'graphics';ids.push(c.scalarJson(`select to_jsonb(mirror_outbox_enqueue('deliverable','closed-snapshot-${n}','title',jsonb_build_object('title','synthetic',${q(n===2?'_native_unknown':'fixture_marker')},true,'_f27_authority_generation',(select generation from track_b_f27_team_fences where team=${q(team)})),'closed-snapshot-${n}',now(),'fixture-client',${q(team)}))`));}
 c.exec(`update mirror_outbox set lock_token=gen_random_uuid(),locked_at=now()-interval '1 day' where id=${ids[0]};`);
 const rows=team=>c.scalarJson(`select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]'::jsonb) from mirror_outbox o where lower(team)=${q(team)} and status in ('pending','failed','shadow_ok')`);
 let epoch=c.scalarJson('select to_jsonb(epoch) from card_write_admission_v1 where singleton');
 const close=()=>c.exec(`select production_card_admission_close_v1(${q(epoch)},'synthetic snapshot proof');`);close();
 const authority={video:'syncview',graphics:'syncview'};
 const call=(team='graphics',expected=rows(team),e=epoch)=>`select production_provider_closed_snapshot_v1(${q(e)},${q(team)},${j(authority)},${j(expected)},'synthetic-owner','exact final snapshot');`;
 function refuse(sql,label){const r=raw('set role service_role;'+sql);assert.notEqual(r.status,0,label);count++;}
 stage='expired-lock-refused';refuse(call(),'expired provider lock is not worker-fence proof');
 const reopened=c.scalarJson(`select production_card_admission_reopen_v1(${q(epoch)},'synthetic-owner','release synthetic lock while open','REOPEN_PRESERVING_ACCEPTED_WORK')`);epoch=reopened.epoch;c.exec(`update mirror_outbox set lock_token=null,locked_at=null where id=${ids[0]};`);close();
 const expected=rows('graphics'),other=rows('video');
 stage='scope-refusals';refuse(call('graphics',expected,crypto.randomUUID()),'stale epoch');refuse(call('video',expected),'wrong team scope');refuse(call('graphics',expected.slice(1)),'omitted row');refuse(call('graphics',[...expected,expected[0]]),'duplicate row');refuse(call('video',other),'native masquerade');refuse(`update mirror_outbox set status='written' where id=${ids[0]};`,'no direct closed write');
 const rollbackCount=c.scalarJson('select count(*)::int from track_b_team_rollbacks');
 stage='late-rollback';refuse(`begin;${call()}do $$begin raise exception 'synthetic late snapshot fault';end$$;commit;`,'whole snapshot rollback');assert.equal(c.scalarJson('select count(*)::int from track_b_team_rollbacks'),rollbackCount);assert.deepEqual(rows('graphics'),expected);
 stage='actual-source-snapshot';const r=raw('set role service_role;'+call());assert.equal(r.status,0,r.stderr);
 const snap=c.scalarJson("select to_jsonb(r) from track_b_team_rollbacks r where team='graphics' and state='open'");assert.equal(snap.snapshot_count,2);
 const stored=c.scalarJson(`select jsonb_agg(row_snapshot order by outbox_id) from track_b_team_rollback_intents where rollback_id=${q(snap.id)}`);assert.deepEqual(stored,expected);assert.deepEqual(rows('video'),other);
 const o=c.scalarJson(`select to_jsonb(o) from mirror_outbox o where id=${ids[0]}`),i=c.scalarJson(`select to_jsonb(i) from track_b_team_rollback_intents i where rollback_id=${q(snap.id)} and outbox_id=${ids[0]}`);
 const disposition=raw(`set role service_role;select production_provider_debt_disposition_v1(${q(epoch)},${q(snap.id)},${ids[0]},${j(o)},${j(i)},'discard','synthetic-owner','explicit synthetic cancellation');`);assert.equal(disposition.status,0,disposition.stderr);
 assert.equal(c.scalarJson('select count(*)::int from card_write_transaction_context_v1'),0);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_PROVIDER_CLOSED_SNAPSHOT_OK',classification:'ISOLATED_POSTGRES',rows:2,refusals:count,late_rollback:true,closed_disposition:true,other_team_preserved:true,external_worker_fenced:false}));
}catch(e){if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'provider-snapshot.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_PROVIDER_CLOSED_SNAPSHOT_FAILED',stage}));process.exitCode=1;}finally{c.stop();}}
main();