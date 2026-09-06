import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import vm from 'node:vm';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {spawn,execFileSync} from 'node:child_process';import crypto from 'node:crypto';
import {loadGateway} from './native-intake-reconcile/load-gateway.mjs';
const require=createRequire(import.meta.url),{LocalDatabase}=require('./card-change-journal-rehearsal'),{extractFunction}=require('../test/helpers/extract-function');
const root=path.resolve(import.meta.dirname,'..'),output=process.env.G8_TEST_OUTPUT;
const db=new LocalDatabase({host:'127.0.0.1',port:process.env.NIR_PGPORT,user:process.env.NIR_PGUSER,psql:process.env.NIR_PSQL,password:process.env.PGPASSWORD});db.name=process.env.NIR_PGDATABASE;
const q=v=>v==null?'null':typeof v==='boolean'?String(v):"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
const query=s=>db.query(s),row=id=>db.rows('select * from public.mirror_outbox where id='+Number(id))[0];
const checks=[],check=async(name,fn)=>{try{await fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false});fs.appendFileSync(path.join(output,'assertions.private.log'),name+'\n'+e.stack+'\n');}};
const files=['migrations/2026-09-06-linear-outbound-cutoff.sql','supabase/functions/linear-outbound/index.ts','scripts/linear-outbound-cutoff-lane.mjs','scripts/linear-outbound-cutoff-rehearsal.js'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),pins=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
// Only SQL transport is translated. Actual extracted helpers own policy.
const client={rpc:async(name,args)=>{try{const raw=query('set role service_role;select public.'+name+'('+Object.entries(args).map(([k,v])=>k+' := '+q(v)).join(',')+')::text');return{data:raw?JSON.parse(raw):null,error:null};}catch(e){return{data:null,error:{message:String(e)}};}},from:table=>{
 assert.equal(table,'mirror_outbox');let patch,where=[];const builder={update:p=>(patch=p,builder),eq:(k,v)=>(assert.match(k,/^[a-z_]+$/),where.push(k+'='+q(v)),builder),
 or:expr=>{assert.match(expr,/^lock_token\.is\.null,locked_at\.lt\.[0-9TZ:.-]+$/);where.push('(lock_token is null or locked_at < '+q(expr.split('locked_at.lt.')[1])+')');return builder;},select:()=>builder,
 execute:async()=>{try{const data=JSON.parse(query('with changed as(update public.mirror_outbox set '+Object.entries(patch).map(([k,v])=>k+'='+(v&&typeof v==='object'?j(v):q(v))).join(',')+' where '+where.join(' and ')+' returning *)select coalesce(json_agg(changed),\'[]\'::json) from changed'));return{data:data[0]||null,error:null};}catch(e){return{data:null,error:{message:String(e)}};}},maybeSingle:()=>builder.execute(),then:(a,b)=>builder.execute().then(a,b)};return builder;
}};
async function worker(source,label){const names=['clean','parseJson','claimRow','checkpointLinearResult','releaseRow','unlockPending'];if(source.includes('async function authorizeProviderDispatch'))names.push('authorizeProviderDispatch');
 const text=names.map(n=>(['clean','parseJson'].includes(n)?'':'async ')+extractFunction(source,n)).join('\n');
 const file=path.join(output,'worker-'+label+'.private.ts');fs.writeFileSync(file,'import {webcrypto as crypto} from "node:crypto";const LOCK_TIMEOUT_MS=600000;\n'+text+'\nexport {'+names.join(',')+'};');return import(pathToFileURL(file).href);}
const baseSource=execFileSync('git',['show','8514a83ed1a65145a3a51ffe52e5fcbb2976be31:supabase/functions/linear-outbound/index.ts'],{cwd:root,encoding:'utf8'});
const old=await worker(baseSource,'base'),current=await worker(fs.readFileSync(path.join(root,'supabase/functions/linear-outbound/index.ts'),'utf8'),'candidate');
function session(){const cp=spawn(db.config.psql,[...db.args(),'-w'],{env:{...process.env,PGAPPNAME:'g8_owned_concurrent'},stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='',closed=false;
 cp.stdout.on('data',x=>out+=x);cp.stderr.on('data',x=>err+=x);const done=new Promise((resolve,reject)=>{cp.once('error',reject);cp.once('close',status=>{closed=true;resolve({status,out,err});});});
 return{send:s=>cp.stdin.write(s+'\n'),finish:()=>{cp.stdin.end();return done;},wait:async marker=>{const until=Date.now()+10000;while(!out.includes(marker)){if(closed||Date.now()>until)throw Error('concurrent_phase_missing:'+err);await new Promise(r=>setTimeout(r,20));}},done};}
let gw;
try{
 gw=await loadGateway();const initial=await gw.post(gw.rootBody('video',gw.requestId()));assert.equal(initial.status,201);const d=db.rows('select * from public.deliverables order by created_at limit 1')[0];
 // The integrated fixture already installs the real F27 hold guard and
 // enqueue path. Load the retained terminal RPCs from the owning migration so
 // the cutoff exception is exercised through their actual SQL transitions.
 const f27=fs.readFileSync(path.join(root,'migrations/2026-07-20-f27-team-rollback.sql'),'utf8').replace(/\r\n/g,'\n');
 for(const name of ['track_b_f27_begin','track_b_f27_begin_drill','track_b_f27_classify','track_b_f27_execute_drill_replay']){
  const start=f27.indexOf('create or replace function public.'+name+'('),end=f27.indexOf('$fn$;',start);assert.ok(start>=0&&end>start,'f27_rpc_source_missing:'+name);query(f27.slice(start,end+5));
 }
 const enqueue=key=>Number(query(`select public.mirror_outbox_enqueue('deliverable',${q(d.id)},'status',jsonb_build_object('status','in_progress','_f27_authority_generation',(select generation from public.track_b_f27_team_fences where team='video')),${q(key)},clock_timestamp(),${q(d.client_slug)},'video','Fixture Admin','admin',${q(d.id)},${q(d.batch_id)})`));
 await check('unchanged base worker applies a delayed terminal receipt after existing mode goes off',async()=>{
  const id=enqueue('g8-base-negative'),lease=await old.claimRow(client,row(id));assert.ok(lease?.lock_token);
  query("update public.syncview_runtime_flags set value='{\"mode\":\"off\"}' where key='linear_outbound_enabled'");
  await old.releaseRow(client,lease,{status:'written'});assert.equal(row(id).status,'written');
 });
 query(fs.readFileSync(path.join(root,files[0]),'utf8'));
 await check('installed cutoff is inactive by default',async()=>assert.equal(db.rows('select * from public.linear_outbound_cutoff_control')[0].cutoff_enabled,false));
 const normal=enqueue('g8-normal'),debt=enqueue('g8-unclaimed'),claimed=enqueue('g8-claimed'),authorized=enqueue('g8-authorized'),race=enqueue('g8-race');
 await check('actual worker claim authorize checkpoint and terminal replay work while inactive',async()=>{
  const lease=await current.claimRow(client,row(normal));assert.ok(lease?.lock_token);await current.authorizeProviderDispatch(client,lease);
  await current.checkpointLinearResult(client,lease,{synthetic_receipt:true});await current.releaseRow(client,lease,{status:'written'});
  assert.equal(await current.claimRow(client,{...row(normal),status:'pending'}),null);assert.equal(row(normal).status,'written');
 });
 const oldClaim=await current.claimRow(client,row(claimed)),oldAuth=await current.claimRow(client,row(authorized));await current.authorizeProviderDispatch(client,oldAuth);
 for(const operation of ['claim','authorize'])await check(operation+' takes the outbox table lock before control alongside an F27-shaped table fence',async()=>{
  const id=enqueue('g8-lock-order-'+operation),lease=operation==='authorize'?await current.claimRow(client,row(id)):null;
  const a=session();a.send('begin;lock table public.mirror_outbox in share row exclusive mode;\n\\echo TABLE_READY');await a.wait('TABLE_READY');
  const b=session();b.send(operation==='claim'?`select public.linear_outbound_claim_v1(${id},'pending',600);`:`select public.linear_outbound_authorize_dispatch_v1(${id},${q(lease.lock_token)}::uuid,0);`);
  let result;
  try{
   const until=Date.now()+10000;let blocked=false;while(Date.now()<until){blocked=query("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='g8_owned_concurrent' and wait_event_type='Lock' and wait_event='relation')")==='t';if(blocked)break;await new Promise(r=>setTimeout(r,20));}
   assert.equal(blocked,true,'observed claim/authorize waiting for the table');
   assert.equal(query("select generation from public.linear_outbound_cutoff_control where lane='mirror_outbox' for update nowait"),'0','blocked RPC has not acquired control first');
  }finally{a.send('commit;');assert.equal((await a.finish()).status,0);result=await b.finish();}
  assert.equal(result.status,0);
 });
 await check('two real sessions serialize competing claims without double ownership',async()=>{
  const a=session();a.send(`begin;select public.linear_outbound_claim_v1(${race},'pending',600);\n\\echo CLAIM_READY`);await a.wait('CLAIM_READY');
  const b=session();b.send(`select public.linear_outbound_claim_v1(${race},'pending',600);`);
  a.send('commit;');assert.equal((await a.finish()).status,0);const r=await b.finish();assert.equal(r.status,0);assert.equal(r.out.trim(),'');assert.ok(row(race).lock_token);
 });
 await check('activation waits for in-flight enqueue and records its committed high-water',async()=>{
  const originalRows=db.rows('select * from public.mirror_outbox order by id');
  const a=session();a.send(`begin;select public.mirror_outbox_enqueue('deliverable',${q(d.id)},'status',jsonb_build_object('status','in_progress','_f27_authority_generation',(select generation from public.track_b_f27_team_fences where team='video')),'g8-inflight',clock_timestamp(),${q(d.client_slug)},'video','Fixture Admin','admin',${q(d.id)},${q(d.batch_id)});\n\\echo ENQUEUE_READY`);await a.wait('ENQUEUE_READY');
  const b=session();b.send("select public.linear_outbound_cutoff_activate_v1(0,'synthetic operator');");
  const until=Date.now()+10000;let blocked=false;while(Date.now()<until){blocked=query("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='g8_owned_concurrent' and wait_event_type='Lock' and query like '%cutoff_activate_v1%')")==='t';if(blocked)break;await new Promise(r=>setTimeout(r,20));}
  a.send('commit;');assert.equal((await a.finish()).status,0);const result=await b.finish();assert.equal(result.status,0);assert.equal(blocked,true,'observed genuine blocked cutoff session');
  const receipt=JSON.parse(result.out.trim());assert.equal(String(receipt.high_water_id),query('select max(id) from public.mirror_outbox'));assert.equal(receipt.generation,1);
  assert.deepEqual(db.rows('select * from public.mirror_outbox where id in('+originalRows.map(x=>Number(x.id)).join(',')+') order by id'),originalRows,'activation preserves all accepted queue bytes');
 });
 await check('stale actual worker checkpoint and release refuse after cutoff',async()=>{
  const before=JSON.stringify(row(authorized));await assert.rejects(current.checkpointLinearResult(client,oldAuth,{late:true}));await assert.rejects(current.releaseRow(client,oldAuth,{status:'written'}));assert.equal(JSON.stringify(row(authorized)),before);
 });
 await check('old direct claimant cannot acquire an unclaimed row after cutoff',async()=>{
  const before=JSON.stringify(row(debt)),lease=await old.claimRow(client,row(debt));assert.equal(lease,null);assert.equal(JSON.stringify(row(debt)),before);
 });
 await check('current gate refuses stale authorization and new claims without relabeling success',async()=>{
  await assert.rejects(current.authorizeProviderDispatch(client,oldClaim));assert.equal(await current.claimRow(client,row(debt)),null);assert.equal(row(claimed).status,'pending');assert.equal(row(authorized).status,'pending');
 });
 await check('real native gateway acceptance and exact retry stay terminal and are not provider debt',async()=>{
  const body=gw.rootBody('both',gw.requestId()),r=await gw.post(body);assert.equal(r.status,201);const receiptRows=db.rows("select status,cutoff_disposition,payload from public.mirror_outbox where payload->>'_native_intake_request'="+q(body.request_id));assert.equal(receiptRows.length,3);
  assert.ok(receiptRows.every(x=>x.status==='skipped'&&x.cutoff_disposition===null));const before=query('select count(*) from public.mirror_outbox');const replay=await gw.post(body);assert.equal(replay.status,201);assert.equal(query('select count(*) from public.mirror_outbox'),before);
 });
 await check('actual client feedback SQL stores comment mutation receipt and held mirror debt idempotently',async()=>{
  query("update public.syncview_runtime_flags set value='{\"mode\":\"live\"}' where key='linear_outbound_enabled'");
  const comment={id:'g8-client-note',native_comment_id:'g8-client-note',idempotency_key:'g8-client-note',deliverable_id:d.id,author_key:'synthetic-client',author_name:'Synthetic client',role:'client',body:'Synthetic retained feedback',audience:'client',source_updated_at:'2026-09-06T12:00:00Z'};
  const event={source:'ui',outbound:{dedup_key:'g8-client-note',operation:'comment',payload:{_intent_fingerprint:'synthetic-feedback-fingerprint',_f27_authority_generation:0}}};
  const expression='set role service_role;select to_jsonb(public.production_comment_write('+j(comment)+','+j(event)+'))::text';const saved=JSON.parse(query(expression));assert.equal(saved.body,comment.body);
  const before=query("select to_jsonb(o)::text from public.mirror_outbox o where dedup_key='g8-client-note'");assert.equal(JSON.parse(before).cutoff_disposition,'accepted_after_cutoff');assert.equal(JSON.parse(before).status,'pending');
  query(expression);assert.equal(query("select count(*) from public.production_comment_mutation_receipts where dedup_key='g8-client-note'"),'1');assert.equal(query("select to_jsonb(o)::text from public.mirror_outbox o where dedup_key='g8-client-note'"),before);
 });
 await check('F27 snapshot, evidence-bound classification, and the SQL-only drill terminal survive cutoff without a provider dispatch',async()=>{
  query("update public.syncview_runtime_flags set value='{\"mode\":\"off\"}' where key='linear_outbound_enabled'");
  query("update public.syncview_runtime_flags set value='{\"enabled\":false}' where key='linear_legacy_parity_enabled'");
  const graphics=Number(query(`select public.mirror_outbox_enqueue('deliverable',${q(d.id)},'status',jsonb_build_object('status','in_progress','_f27_authority_generation',(select generation from public.track_b_f27_team_fences where team='graphics')),'g8-f27-graphics',clock_timestamp(),${q(d.client_slug)},'graphics','Fixture Admin','admin',${q(d.id)},${q(d.batch_id)})`));
  const hold=JSON.parse(query("set role service_role;select public.track_b_f27_begin('graphics','{\"video\":\"syncview\",\"graphics\":\"syncview\"}'::jsonb,'synthetic f27 hold')::text"));
  assert.equal(hold.type,'f27_snapshot_terminal');assert.equal(row(graphics).status,'skipped');
  assert.throws(()=>query(`set role service_role;select set_config('app.f27_rollback_bypass','1',true);update public.mirror_outbox set status='written' where id=${graphics}`),/linear_cutoff_stale_worker_refused/);
  const discarded=JSON.parse(query(`set role service_role;select public.track_b_f27_classify(${q(hold.rollback_id)}::uuid,${graphics},'discard','synthetic evidence-bound discard','synthetic f27 operator',null)::text`));
  assert.equal(discarded.type,'f27_classification_terminal');assert.equal(row(graphics).status,'skipped');
  query("update public.syncview_runtime_flags set value='{\"video\":\"linear\",\"graphics\":\"linear\"}' where key='prod_authority'");
  const drill=JSON.parse(query("set role service_role;select public.track_b_f27_begin_drill('{\"video\":\"linear\",\"graphics\":\"linear\"}'::jsonb,'synthetic f27 drill')::text"));
  assert.equal(drill.type,'f27_drill_snapshot_terminal');assert.equal(row(drill.outbox_id).status,'skipped');
  query(`set role service_role;select public.track_b_f27_classify(${q(drill.rollback_id)}::uuid,${Number(drill.outbox_id)},'replay','synthetic no-egress drill','synthetic f27 operator',null)`);
  const lease=JSON.parse(query(`set role service_role;select public.linear_outbound_claim_v1(${Number(drill.outbox_id)},'skipped',600)::text`));assert.ok(lease.lock_token);
  const terminal=JSON.parse(query(`set role service_role;select public.track_b_f27_execute_drill_replay(${q(drill.rollback_id)}::uuid,${Number(drill.outbox_id)},${q(lease.lock_token)}::uuid)::text`));
  assert.equal(terminal.no_external_call,true);assert.equal(row(drill.outbox_id).status,'written');
 });
 await check('unavailable control refuses rather than silently treating empty claim as healthy',async()=>{
  const debtRows=JSON.parse(query("set role service_role;select coalesce(json_agg(t),'[]'::json) from (select * from public.linear_outbound_cutoff_debt_v1 order by id) t"));
  assert.equal(debtRows.length,Number(query('select count(*) from public.mirror_outbox')));
  assert.equal(debtRows.find(x=>Number(x.id)===debt).disposition,'unclaimed_before_cutoff');
  assert.equal(debtRows.find(x=>Number(x.id)===claimed).disposition,'claimed_before_cutoff');
  assert.equal(debtRows.find(x=>Number(x.id)===authorized).disposition,'authorized_before_cutoff');
  assert.equal(debtRows.find(x=>Number(x.id)===normal).disposition,'terminal_receipt');
  query('delete from public.linear_outbound_cutoff_control');await assert.rejects(current.claimRow(client,row(debt)));
  assert.throws(()=>query('set role service_role;select count(*) from public.linear_outbound_cutoff_debt_v1'),/linear_cutoff_control_unavailable/);
 });
 for(const[f,h]of Object.entries(pins))assert.equal(hash(fs.readFileSync(path.join(root,f))),h);
}catch(error){checks.push({name:'fixture_completed',pass:false});fs.appendFileSync(path.join(output,'assertions.private.log'),String(error.stack));}
const report={classification:'DISPOSABLE_POSTGRES_ACTUAL_GATEWAY_AND_WORKER_HELPERS',passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checks,source_sha256:pins,external_requests:gw?.net.requests.length??null,
 limits:['No provider request executed; preauthorized in-flight external work remains debt','Actual gateway staff acceptance and service-role client-comment RPC are distinct from live browser authentication','F27 emergency, inbound, reconciliation, other runtimes and credential cutoff remain held','No installed schema/data recovery proof']};
fs.writeFileSync(path.join(output,'REPORT.private.json'),JSON.stringify(report,null,2));console.log('G8_RESULT '+JSON.stringify({passed:report.passed,failed:report.failed}));process.exitCode=report.failed?1:0;
