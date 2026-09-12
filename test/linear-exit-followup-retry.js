'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])if(process.env[k])throw Error('INHERITED_DATABASE_ROUTING_REFUSED');
const c=new Cluster();assert.equal(c.host,'127.0.0.1');const root=path.resolve(__dirname,'..'),q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';let stage='install',count=0;
const raw=sql=>cp.spawnSync(c.psql,['-X','-q','-h',c.host,'-p',c.port,'-U',c.user,'-d',c.db,'-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',windowsHide:true});
async function main(){try{
 require('../scripts/linear-exit-composition/recovery-ordered').install({},()=>null);require('../scripts/linear-exit-priority-schema-supplement').apply(c);require('../scripts/linear-exit-backup-observed-baseline').apply(c);require('../scripts/linear-exit-credential-schema-supplement').apply(c);await require('./helpers/remaining-application-fixture').installAndPopulate({query:sql=>c.run('',null,{sql,tuplesOnly:true})});
 c.runFile(path.join(root,'migrations/2026-06-18-atomic-comment-merge.sql'));c.runFile(path.join(root,'qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql'));
 for(const file of ['20260912174907_card_atomic_admission_preparation.sql','20260912183653_application_dml_admission_preparation.sql','20260912184931_card_followup_outcome_proof.sql','20260912190717_provider_debt_disposition_preparation.sql','20260912193102_followup_transactional_retry_preparation.sql'])c.runFile(path.join(root,'supabase/migrations',file));
 const acl=fs.readFileSync('migrations/live-schema-baseline-2026-07-03.sql');assert.equal(crypto.createHash('sha256').update(acl).digest('hex'),'0fe101d62b3c03200e007a943ec442c75366f7467e25357085a623d21c68243f');const grants=acl.toString('utf8').match(/^grant (?:delete|insert|references|select|trigger|truncate|update) on table public\.calendar_posts to service_role;$/gm);assert.equal(grants.length,7);c.exec(grants.join('\n'));
 const epoch=c.scalarJson('select to_jsonb(epoch) from card_write_admission_v1 where singleton');let index=0;
 function make(legacy=false){const op=crypto.randomUUID(),id='retry-'+(++index),payload={surface:'calendar',client:'fixture-client',sourceId:id,patch:{},incoming:{},existing:{}};c.exec(`select production_card_atomic_write_v1(${q(op)},${j({surface:'calendar',client:'fixture-client',id,expected_existing:null,row:{client:'fixture-client',id,name:'Original'},events:[],followups:[{kind:'graphic_baseline',payload}]})});`);const task=c.scalarJson(`select to_jsonb(t) from ${legacy?'production_card_followup_claim_v1':'production_card_followup_claim_transactional_v1'}(1) t`);assert.equal(task.operation_id,op);return task;}
 const bind=t=>`${q(t.operation_id)},${q(t.kind)},${t.attempt},${q(t.lease_token)}`;
 const recover=(t,e=epoch)=>`select production_card_followup_recover_v1(${q(e)},${bind(t)});`;
 const before=t=>c.scalarJson(`select to_jsonb(t) from card_write_followups_v1 t where operation_id=${q(t.operation_id)} and kind=${q(t.kind)}`);
 const fail=t=>c.exec(`select production_card_followup_fail_v1(${bind(t)},'synthetic rollback');`);
 const complete=t=>`select production_card_followup_complete_v1(${bind(t)},'{"captured":false,"reason":"not_graphic_tweaks_needed_transition"}');`;
 function refuse(sql,label){const result=raw('set role service_role;'+sql);assert.notEqual(result.status,0,label);count++;}
 stage='legacy-and-new-claims';
 const legacy=make(true);fail(legacy);refuse(recover(legacy),'unproven legacy attempt');
 refuse('select production_card_followup_claim_v1(1);','old claim unavailable to worker');
 let task=make();refuse(recover(task),'live attempt cannot be retried');fail(task);
 refuse(recover(task,crypto.randomUUID()),'stale epoch');refuse(recover({...task,lease_token:crypto.randomUUID()}),'stale lease');
 const old=task;task=c.scalarJson(recover(task).replace(/;$/,'' )).task;assert.equal(task.attempt,old.attempt+1);assert.notEqual(task.lease_token,old.lease_token);refuse(recover(old),'duplicate recovery stale');
 refuse(`begin;select production_card_followup_begin_v1(${bind(old)});${complete(old)}commit;`,'stale worker effects');
 c.exec(`begin;select production_card_followup_begin_v1(${bind(task)});${complete(task)}commit;`);
 const finished=before(task);const readback=c.scalarJson(recover(task).replace(/;$/,''));assert.equal(readback.status,'completed');assert.equal(readback.retry_started,false);assert.deepEqual(before(task),finished);
 stage='expired-unknown';
 const expired=make();c.exec(`update card_write_followups_v1 set lease_until=clock_timestamp()-interval '1 second' where operation_id=${q(expired.operation_id)};`);const retried=c.scalarJson(recover(expired).replace(/;$/,'' )).task;assert.equal(retried.attempt,2);fail(retried);
 const unknown=make();c.exec(`update card_write_followups_v1 set lease_until=clock_timestamp()-interval '1 second' where operation_id=${q(unknown.operation_id)};select production_card_followup_claim_transactional_v1(1);`);assert.equal(before(unknown).state,'unknown');assert.equal(c.scalarJson(recover(unknown).replace(/;$/,'' )).task.attempt,2);
 async function race(t,rollback){
  const name='retry-race-'+crypto.randomUUID();
  const sql=`set application_name=${q(name)};begin;set local role service_role;select production_card_followup_begin_v1(${bind(t)});${rollback?`update calendar_posts set name='Uncommitted' where client='fixture-client' and id=${q(t.payload.sourceId)};`:''}select pg_sleep(2);${rollback?'rollback;':complete(t)+'commit;'}`;
  const child=cp.spawn(c.psql,['-X','-q','-h',c.host,'-p',c.port,'-U',c.user,'-d',c.db,'-v','ON_ERROR_STOP=1','-f','-'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let err='';child.stderr.on('data',b=>err+=b);child.stdout.resume();const exited=new Promise(resolve=>child.on('close',code=>resolve(code)));child.stdin.end(sql);
  let locked=false;for(let n=0;n<50;n++){if(c.scalarJson(`select to_jsonb(exists(select from pg_stat_activity where application_name=${q(name)} and wait_event='PgSleep'))`)){locked=true;break;}await new Promise(resolve=>setTimeout(resolve,50));}assert(locked,'actual worker transaction reached held-lock phase: '+err);
  const result=raw('set role service_role;'+recover(t));assert.equal(await exited,0,err);
  if(rollback){assert.notEqual(result.status,0,'unexpired rolled back worker requires failure classification');assert.equal(c.scalarJson(`select to_jsonb(name) from calendar_posts where client='fixture-client' and id=${q(t.payload.sourceId)}`),'Original');fail(t);assert.equal(c.scalarJson(recover(t).replace(/;$/,'' )).task.attempt,2);}
  else{assert.equal(result.status,0,result.stderr);assert.equal(before(t).state,'completed');assert.equal(before(t).attempt,1);}
 }
 stage='commit-readback-race';await race(make(),false);
 stage='rollback-race';await race(make(),true);
 assert.equal(c.scalarJson('select count(*)::int from card_write_transaction_context_v1'),0);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_FOLLOWUP_RETRY_OK',classification:'ISOLATED_POSTGRES',refusals:count,commit_readback_race:true,rollback_race:true,legacy_refused:true,stale_attempt_refused:true,external_worker_identity_proven:false}));
}catch(e){if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'followup-retry.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_FOLLOWUP_RETRY_FAILED',stage}));process.exitCode=1;}finally{c.stop();}}
main();