import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
import {loadGateway} from './native-intake-reconcile/load-gateway.mjs';
import {sqlClient,loadWorker,literal as q} from './linear-outbound-read-seam.mjs';
const require=createRequire(import.meta.url),{LocalDatabase}=require('./card-change-journal-rehearsal');
const root=path.resolve(import.meta.dirname,'..'),output=process.env.G8_TEST_OUTPUT;
assert.equal(process.env.G8_TEST_CONFIRM,'LOCAL_DISPOSABLE_ONLY','owned disposable confirmation required');
assert.equal(process.env.NIR_PGHOST,'127.0.0.1','literal loopback required');
assert.match(process.env.NIR_PGPORT||'',/^\d{4,5}$/);assert.ok(Number(process.env.NIR_PGPORT)<=65535);
assert.ok(path.isAbsolute(process.env.NIR_PSQL||'')&&path.isAbsolute(output||''),'explicit tools/private output required');
for(const key of Object.keys(process.env))if(/^(PGHOSTADDR|PGSERVICE|PGSERVICEFILE)$/i.test(key))delete process.env[key];
const db=new LocalDatabase({host:'127.0.0.1',port:process.env.NIR_PGPORT,user:process.env.NIR_PGUSER,psql:process.env.NIR_PSQL,password:process.env.PGPASSWORD});db.name=process.env.NIR_PGDATABASE;
const files=['supabase/functions/linear-outbound/index.ts','migrations/2026-09-06-linear-outbound-cutoff.sql','scripts/linear-outbound-read-seam.mjs','scripts/linear-outbound-read-lane.mjs','scripts/linear-outbound-cutoff-rehearsal.js'];
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),pins=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
const checks=[],requests=[],check=async(name,fn)=>{const start=requests.length;await fn();checks.push({name,pass:true,recorded_provider_attempts:requests.length-start});};
const query=s=>db.query(s),row=id=>db.rows('select * from public.mirror_outbox where id='+Number(id))[0];
let gw,seam,candidate,old,d,seq=0,replyHook=null;
const syntheticIssue={id:'synthetic-issue',identifier:'FIX-1',title:'Synthetic',updatedAt:'2020-01-01T00:00:00Z',dueDate:null,team:{id:'synthetic-team',key:'VID',states:{nodes:[]}},labels:{nodes:[]},assignee:null,creator:{id:'fixture-human'}};
const provider=async(input,init)=>{
  // This is the only supplied fetch. Record BEFORE rejecting an unknown route.
  const url=String(input),body=JSON.parse(init?.body||'{}');requests.push({provider:url==='https://api.linear.app/graphql',query:String(body.query||''),variables:body.variables});
  assert.equal(url,'https://api.linear.app/graphql','unexpected transport refused');
  if(replyHook)return replyHook(body);
  let data;
  if(body.query.includes('SyncViewMirrorViewer'))data={viewer:{id:'fixture-mirror',name:'Fixture Mirror'}};
  else if(body.query.includes('SyncViewMirrorTeams'))data={teams:{nodes:[syntheticIssue.team]}};
  else if(body.query.includes('SyncViewMirrorTeam('))data={team:syntheticIssue.team};
  else if(body.query.includes('SyncViewMirrorComment('))data={comment:{id:'synthetic-comment',body:'Synthetic'}};
  else if(body.query.includes('SyncViewMirrorIssueComments'))data={issue:{comments:{nodes:[],pageInfo:{hasNextPage:false}}}};
  else if(body.query.includes('SyncViewMirrorIssueAttachments'))data={issue:{attachments:{nodes:[],pageInfo:{hasNextPage:false}}}};
  else if(body.query.includes('SyncViewMirrorIssue('))data={issue:syntheticIssue};
  else if(body.query.includes('issueUpdate'))data={issueUpdate:{success:true,issue:{...syntheticIssue,dueDate:body.variables.input.dueDate}}};
  else throw Error('unhandled synthetic provider request');
  return new Response(JSON.stringify({data}),{status:200});
};
const activate=()=>JSON.parse(query('set role service_role;select public.linear_outbound_cutoff_activate_v1((select generation from public.linear_outbound_cutoff_control),\'synthetic operator\')::text'));
// Admin-only fixture reset between independent cases. No re-enable API exists.
const reopenFixture=()=>{query('update public.linear_outbound_cutoff_control set cutoff_enabled=false');seam.beforeRead=null;seam.beforeRpc=null;seam.afterRpc=null;replyHook=null;};
const enqueue=()=>Number(query(`select public.mirror_outbox_enqueue('deliverable',${q(d.id)},'due',${q({due_date:'2030-09-12',linear_issue_id:'synthetic-issue',_f27_authority_generation:0})},${q('g8-read-'+(++seq))},clock_timestamp(),${q(d.client_slug)},'video','Fixture Admin','admin',${q(d.id)},${q(d.batch_id)})`));
const invoke=(worker,id,extra={})=>worker.handler(new Request('http://127.0.0.1/worker',{method:'POST',headers:{authorization:'Bearer fixture-service','content-type':'application/json'},body:JSON.stringify(id?{target_dedup_key:row(id).dedup_key,syncview_live:true,confirm:'WRITE_UI_SYNCVIEW_LIVE',...extra}:extra)}));
const noAttempts=async fn=>{const n=requests.length;await fn();assert.equal(requests.length,n);};
try{
  gw=await loadGateway();assert.equal((await gw.post(gw.rootBody('video',gw.requestId()))).status,201);d=db.rows('select * from public.deliverables order by created_at limit 1')[0];
  query(fs.readFileSync(path.join(root,files[1]),'utf8'));
  query("update public.syncview_runtime_flags set value='{\"mode\":\"live\"}' where key='linear_outbound_enabled';update public.syncview_runtime_flags set value='{\"enabled\":false}' where key='linear_legacy_parity_enabled';update public.syncview_runtime_flags set value='{\"video\":\"syncview\",\"graphics\":\"syncview\"}' where key='prod_authority'");
  seam=sqlClient(db);seam.env={SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',LINEAR_MIRROR_API_KEY:'fixture-provider'};seam.fetch=provider;
  const source=fs.readFileSync(path.join(root,files[0]),'utf8');
  candidate=await loadWorker(source,root,output,'candidate',seam);
  for(const malformed of [null,'',false,'0',undefined,-1,0.5])await check('generation zero rejects malformed '+String(malformed)+' authorization before transport',()=>noAttempts(async()=>{
    const id=enqueue(),lease=await candidate.claimRow(seam.client,row(id));assert.equal(lease.outbound_generation,0);
    seam.afterRpc=(name,args,result)=>name==='linear_outbound_authorize_dispatch_v1'?{data:{...result.data,generation:malformed},error:null}:result;
    await assert.rejects(candidate.readViewer({supabase:seam.client,row:lease}));seam.afterRpc=null;
    // Retain the tested receipt while preventing it from entering the later empty invocation.
    query('update public.mirror_outbox set status=\'written\',lock_token=null,locked_at=null where id='+id);
  }));
  await check('missing synthetic provider key refuses without an authorization or transport attempt',()=>noAttempts(async()=>{
    const id=enqueue(),lease=await candidate.claimRow(seam.client,row(id)),n=seam.rpcs.length;delete seam.env.LINEAR_MIRROR_API_KEY;
    await assert.rejects(candidate.readViewer({supabase:seam.client,row:lease}),/API_KEY unavailable/);assert.equal(seam.rpcs.length,n);seam.env.LINEAR_MIRROR_API_KEY='fixture-provider';
    query('update public.mirror_outbox set status=\'written\',lock_token=null,locked_at=null where id='+id);
  }));
  const env={...process.env};for(const k of Object.keys(env))if(/^GIT_/i.test(k))delete env[k];
  const baseline=execFileSync('git',['--no-replace-objects','--no-lazy-fetch','show','8e3d0865041a26010bc2d2f6ee78346357eb2aa3:'+files[0]],{cwd:root,env,encoding:'utf8'});
  old=await loadWorker(baseline,root,output,'base-8e',seam);
  await check('unchanged base empty invocation attempts viewer despite active cutoff',async()=>{activate();const n=requests.length;const r=await invoke(old);assert.equal(r.status,200);assert.equal(requests.length,n+1);assert.match(requests.at(-1).query,/SyncViewMirrorViewer/);});
  await check('candidate ordinary empty invocation makes no provider attempt after cutoff',()=>noAttempts(async()=>{assert.equal((await invoke(candidate)).status,200);}));
  await check('inactive positive actual handler retains viewer issue mutation checkpoint and terminal receipt',async()=>{reopenFixture();const id=enqueue(),n=requests.length;const r=await invoke(candidate,id);assert.equal(r.status,200);assert.equal(row(id).status,'written');assert.equal(requests.length-n,3);assert.equal(row(id).linear_result.mutation,'issueUpdate');});
  await check('post-cutoff queued/new debt cannot claim and remains retained without provider attempts',()=>noAttempts(async()=>{activate();const id=enqueue(),before=row(id);assert.equal(before.cutoff_disposition,'accepted_after_cutoff');await invoke(candidate,id);assert.deepEqual(row(id),before);}));
  await check('failed runtime flag read refuses before any provider attempt',()=>noAttempts(async()=>{seam.beforeRead=(table,filters)=>table==='syncview_runtime_flags'&&filters.some(x=>x.includes('linear_outbound_enabled'))?{data:null,error:{message:'injected flag refusal'}}:null;await assert.rejects(invoke(candidate));seam.beforeRead=null;}));
  await check('cutoff committed after claim but before first read refuses without relabeling success',()=>noAttempts(async()=>{reopenFixture();const id=enqueue();seam.afterRpc=(name,args,result)=>{if(name==='linear_outbound_claim_v1'&&result.data){activate();seam.afterRpc=null;}return result;};await invoke(candidate,id);assert.equal(row(id).status,'pending');assert.ok(row(id).lock_token);}));
  await check('unchanged base retained lease makes an issue read after cutoff',async()=>{reopenFixture();const id=enqueue(),lease=await candidate.claimRow(seam.client,row(id));activate();const n=requests.length;await old.readIssue('synthetic-issue',false,{supabase:seam.client,row:lease});assert.equal(requests.length,n+1);});
  const helperCases=[['viewer',(w,x)=>w.readViewer(x)],['issue',(w,x)=>w.readIssue('synthetic-issue',false,x)],['comment',(w,x)=>w.readLinearComment('synthetic-comment',false,x)],['comment marker',(w,x)=>w.readCommentByMarker('synthetic-issue','absent-marker',x)],['team',(w,x)=>w.readTeam('synthetic-team',x)],['team catalog',(w,x)=>w.readTeamByRowTeam('video',x)],['attachment page',(w,x)=>w.readAttachmentRevisionPresent('synthetic-issue',{attachments:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'first'}}},{artifact_revision:1,url:'https://drive.google.com/file/d/synthetic-artifact'},x)],['mutation',(w,x)=>w.linearGraphql('mutation { issueUpdate { success } }',{},x)]];
  for(const[name,fn]of helperCases)await check('actual '+name+' transport rejects old generation lease before fetch',()=>noAttempts(async()=>{reopenFixture();const id=enqueue(),lease=await candidate.claimRow(seam.client,row(id));activate();await assert.rejects(fn(candidate,{supabase:seam.client,row:lease}),/dispatch refused/);}));
  for(const kind of ['Comments','Attachments'])await check(kind+' pagination reauthorizes each next page',async()=>{reopenFixture();const id=enqueue(),lease=await candidate.claimRow(seam.client,row(id));const n=requests.length;replyHook=body=>{assert.match(body.query,new RegExp(kind));activate();return new Response(JSON.stringify({data:{issue:{[kind.toLowerCase()]:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'second'}}}}}));};const ctx={supabase:seam.client,row:lease};await assert.rejects(kind==='Comments'?candidate.readCommentByMarker('synthetic-issue','missing',ctx):candidate.readAttachmentRevisionPresent('synthetic-issue',{attachments:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'first'}}},{artifact_revision:1,url:'https://drive.google.com/file/d/synthetic-artifact'},ctx));assert.equal(requests.length,n+1);replyHook=null;});
  await check('cutoff between issue read and mutation refuses mutation and leaves prior authorization debt',async()=>{reopenFixture();const id=enqueue(),n=requests.length;replyHook=body=>{if(body.query.includes('SyncViewMirrorViewer'))return new Response(JSON.stringify({data:{viewer:{id:'fixture-mirror'}}}));assert.match(body.query,/SyncViewMirrorIssue\(/);activate();return new Response(JSON.stringify({data:{issue:syntheticIssue}}));};await invoke(candidate,id);assert.equal(requests.length,n+2);assert.equal(row(id).status,'pending');assert.ok(row(id).dispatch_authorization);replyHook=null;});
  await check('grant before activation is explicitly in flight; next provider request refuses',async()=>{reopenFixture();const id=enqueue(),lease=await candidate.claimRow(seam.client,row(id)),n=requests.length;seam.afterRpc=(name,args,r)=>{if(name==='linear_outbound_authorize_dispatch_v1'&&r.data){activate();seam.afterRpc=null;}return r;};await candidate.readViewer({supabase:seam.client,row:lease});assert.equal(requests.length,n+1);await noAttempts(()=>assert.rejects(candidate.readIssue('synthetic-issue',false,{supabase:seam.client,row:lease})));assert.equal(db.rows('select * from public.linear_outbound_cutoff_debt_v1 where id='+id)[0].disposition,'authorized_before_cutoff');});
  for(const mutation of [r=>({...r,outbox_id:r.outbox_id+1}),r=>({...r,generation:r.generation+1}),r=>({...r,authorization:'invalid'}),_r=>null])await check('malformed authorization receipt cannot reach provider',()=>noAttempts(async()=>{reopenFixture();const id=enqueue(),lease=await candidate.claimRow(seam.client,row(id));seam.afterRpc=(name,args,r)=>name==='linear_outbound_authorize_dispatch_v1'?{data:mutation(r.data),error:null}:r;await assert.rejects(candidate.readViewer({supabase:seam.client,row:lease}));seam.afterRpc=null;}));
  await check('missing cutoff control refuses before fetch and preserves queued intent',()=>noAttempts(async()=>{reopenFixture();const id=enqueue();query('delete from public.linear_outbound_cutoff_control');await assert.rejects(invoke(candidate,id));assert.equal(row(id).status,'pending');query("insert into public.linear_outbound_cutoff_control(lane,generation) values('mirror_outbox',100)");}));
  await check('real native gateway accept and replay after cutoff remain terminal without provider intent',()=>noAttempts(async()=>{activate();const body=gw.rootBody('both',gw.requestId());assert.equal((await gw.post(body)).status,201);const rows=db.rows("select * from public.mirror_outbox where payload->>'_native_intake_request'="+q(body.request_id));assert.equal(rows.length,3);assert.ok(rows.every(r=>r.status==='skipped'&&r.cutoff_disposition===null));assert.equal((await gw.post(body)).status,201);assert.deepEqual(db.rows("select * from public.mirror_outbox where payload->>'_native_intake_request'="+q(body.request_id)),rows);}));
  await check('reserved F27 actual SQL-only handler stays provider-free after active cutoff',()=>noAttempts(async()=>{
    const f27=fs.readFileSync(path.join(root,'migrations/2026-07-20-f27-team-rollback.sql'),'utf8').replaceAll('\r\n','\n');
    for(const name of ['track_b_f27_begin_drill','track_b_f27_classify','track_b_f27_execute_drill_replay']){const start=f27.indexOf('create or replace function public.'+name+'('),end=f27.indexOf('$fn$;',start);assert.ok(start>=0&&end>start);query(f27.slice(start,end+5));}
    for(const table of ['track_b_f27_team_fences','track_b_team_rollbacks','track_b_team_rollback_intents']){const grant='grant select on table public.'+table+' to service_role;';assert.ok(f27.includes(grant));query(grant);}
    query("update public.syncview_runtime_flags set value='{\"mode\":\"off\"}' where key='linear_outbound_enabled';update public.syncview_runtime_flags set value='{\"video\":\"linear\",\"graphics\":\"linear\"}' where key='prod_authority'");
    const drill=JSON.parse(query("set role service_role;select public.track_b_f27_begin_drill('{\"video\":\"linear\",\"graphics\":\"linear\"}', 'synthetic read fence')::text"));
    query(`set role service_role;select public.track_b_f27_classify(${q(drill.rollback_id)}::uuid,${Number(drill.outbox_id)},'replay','synthetic evidence','synthetic operator',null)`);
    const r=await candidate.handler(new Request('http://127.0.0.1/worker',{method:'POST',headers:{authorization:'Bearer fixture-service'},body:JSON.stringify({rollback_id:drill.rollback_id,target_dedup_key:row(drill.outbox_id).dedup_key,confirm:'F27_ROLLBACK_DRILL'})}));
    const body=await r.json();assert.equal(r.status,200);assert.equal(row(drill.outbox_id).status,'written');assert.equal(body.ok,true);
  }));
  for(const[f,h]of Object.entries(pins))assert.equal(hash(fs.readFileSync(path.join(root,f))),h);
  assert.equal(gw.net.requests.length,0);assert.ok(requests.every(r=>r.provider));
}catch(e){checks.push({name:'finite_lane_completed',pass:false});fs.writeFileSync(path.join(output,'lane-failure.private.log'),String(e.stack));}
const report={classification:'DISPOSABLE_SQL_WHOLE_HANDLER_RECORDING_FETCH',source_sha256:pins,checks,passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length,recorded_provider_attempts:requests.length,external_requests:0,
 limits:['Provider responses are synthetic; SQL and complete worker handler are actual source','Fixture administrator reopens control between independent cases only; no product re-enable API','Baseline old isolate can still read; exact deployment and old-worker quiescence required','A grant committed before activation is in flight, not atomically network-revoked','Other provider runtimes, webhook and credential cutoff remain held; no serving or installation proof']};
fs.writeFileSync(path.join(output,'REPORT.private.json'),JSON.stringify(report,null,2));if(seam)fs.writeFileSync(path.join(output,'seam-errors.private.json'),JSON.stringify(seam.errors));
console.log('G8_RESULT '+JSON.stringify({passed:report.passed,failed:report.failed}));process.exitCode=report.failed?1:0;
