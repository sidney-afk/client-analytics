'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const D=require('../scripts/client-continuity-delivery'),O=require('../scripts/client-continuity-observer');
const H=require('../scripts/client-continuity-hosted'),U=require('../scripts/client-continuity-test-ui');
const {report}=require('../scripts/client-continuity-monitor');
const {requestDenialReason,requestPolicy}=require('../scripts/client-continuity-transport');
const sha='a'.repeat(40),id=randomUUID(),now=1000000;
let passed=0;function eq(a,b){assert.deepEqual(a,b);passed++;}
async function rejects(fn){await assert.rejects(fn);passed++;}
const response=value=>({ok:true,status:200,json:async()=>value,text:async()=>''});
const route={kind:'relay',webhookEnv:'TEST_HOOK',baseUrlEnv:'TEST_BASE',apiKeyEnv:'TEST_KEY'};
const env={TEST_HOOK:'https://relay.invalid/hook',TEST_BASE:'https://relay.invalid',TEST_KEY:'synthetic'};
const cfg={enabled:true,activation:'OWNER_APPROVED_CONTINUITY_DELIVERY',recipientConfirmed:true,primary:route};
function execution(status,run=id,type='client_continuity_DRILL') {
  return {id:'fictional',status,data:{resultData:{runData:{'Receive Edge Alert':[{data:{main:[[{json:{body:{type,details:{run_id:run}}}}]]}}]}}}};
}
async function main(){
  const readConfig={backendOrigin:'https://backend.invalid',fallbackOrigin:'https://fallback.invalid',shareLink:'https://fixture.invalid/'};
  for(const [url,method,redirected,expected] of [
    ['https://fallback.invalid/webhook/linear-issue-statuses','POST',false,'metadata_post_blocked'],
    ['https://other.invalid/webhook/linear-issue-statuses','POST',false,'other_request_blocked'],
    ['https://fallback.invalid/webhook/linear-issue-statuses?secret=synthetic','POST',false,'other_request_blocked'],
    ['https://fallback.invalid/webhook/linear-issue-statuses','POST',true,'other_request_blocked'],
    ['https://fallback.invalid/webhook/linear-add-comment','POST',false,'other_request_blocked'],
  ]) {
    const request={url:()=>url,method:()=>method,redirectedFrom:()=>redirected};
    eq(requestDenialReason(request,readConfig),expected);eq(requestPolicy(request,readConfig),'mutation_blocked');
  }
  let requests=0,posts=0,polls=0,sleeps=0;
  const fake=async(url,init)=>{
    requests++;eq(init.redirect,'error');
    if(init.method==='POST') {posts++;const p=JSON.parse(init.body);eq(p.type,'client_continuity_DRILL');eq(p.issue_identifier,'DRILL_samples_false_empty');eq(p.details.run_id,id);return response({});}
    polls++;return response({data:[execution(polls===1?'running':'success')]});
  };
  const result=await D.deliver(report('samples','false_empty'),id,cfg,env,fake,{drill:true,sleepImpl:async()=>{sleeps++;}});
  eq(result.delivered,true);eq(result.independentFallbackProven,false);eq(result.acknowledged,false);eq(posts,1);eq(polls,2);eq(sleeps,1);
  eq(result.primaryEvidence,'relay_terminal_success');eq(result.recipientReadbackProven,false);
  await D.deliver(report('samples','false_empty'),id,cfg,env,fake,{drill:true,reconcileOnly:true,sleepImpl:async()=>{}});eq(posts,1);
  await rejects(()=>D.deliver(report('samples','false_empty'),id,{...cfg,enabled:false},env,fake));
  await rejects(()=>D.deliver(report('samples','false_empty'),id,{...cfg,recipientConfirmed:false},env,fake));
  await rejects(()=>D.deliver({lane:'samples',code:'private content',count:0},id,cfg,env,fake));
  eq(requests,4);
  polls=0;posts=0;
  const unknown=await D.deliver(report('samples','false_empty'),id,cfg,env,async(url,init)=>{if(init.method==='POST'){posts++;return response({});}polls++;return response({data:[execution('success',randomUUID())]});},{drill:true,sleepImpl:async()=>{}});
  eq(unknown.delivered,false);eq(posts,1);eq(polls,20);
  const bot={kind:'syncviewbot',tokenEnv:'TEST_TOKEN',dmEnv:'TEST_DM',botUserEnv:'TEST_BOT',ownerUserEnv:'TEST_OWNER',teamEnv:'TEST_TEAM'};
  const botEnv={TEST_TOKEN:'synthetic',TEST_DM:'D_fixture',TEST_BOT:'U_bot',TEST_OWNER:'U_owner',TEST_TEAM:'T_fixture'};
  posts=0;let body;
  const botFetch=async(url,init)=>{
    const method=new URL(url).pathname.split('/').pop();
    if(method==='auth.test')return response({ok:true,user_id:'U_bot',team_id:'T_fixture'});
    if(method==='conversations.info')return response({ok:true,channel:{id:'D_fixture',is_im:true,user:'U_owner'}});
    if(method==='chat.postMessage'){posts++;body=JSON.parse(init.body);return response({ok:true,channel:'D_fixture',ts:'1.0'});}
    return response({ok:true,messages:[{user:'U_bot',ts:'1.0',text:body.text}]});
  };
  eq((await D.deliver(report('samples','false_empty'),id,{...cfg,primary:bot},botEnv,botFetch)).delivered,true);eq(posts,1);
  eq((await D.deliver(report('samples','false_empty'),id,{...cfg,primary:bot},botEnv,async(url,init)=>new URL(url).pathname.endsWith('conversations.info')?response({ok:true,channel:{id:'D_wrong',is_im:true,user:'U_owner'}}):botFetch(url,init))).delivered,false);eq(posts,1);
  eq((await D.deliver(report('samples','false_empty'),id,{...cfg,fallback:bot},{...env,...botEnv},async(url,init)=>String(url).includes('relay.invalid')?Promise.reject(Error('private')):botFetch(url,init))).fallbackDelivered,true);eq(posts,2);
  eq(O.evaluate([],1,now).map(r=>r.code),['monitor_missing','monitor_missing']);
  const start={version:1,releaseSha:sha,lane:'samples',runId:id,startedAt:now-1000};
  const end={...start,finishedAt:now,code:'healthy',count:1};
  eq(O.evaluate([start,end],1,now)[1].code,'healthy');
  eq(O.evaluate([{...start,runId:randomUUID(),startedAt:now-120001},start,end],1,now)[1].code,'terminal_missing');
  assert.throws(()=>O.evaluate([start,start,end],1,now));passed++;
  assert.throws(()=>O.evaluate([end],1,now));passed++;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-operations-test-'));
  try {
    fs.writeFileSync(path.join(temp,`samples-${id}.start.json`),JSON.stringify({...start,privateContent:'must drop'}));
    eq(O.receipts(temp,sha,now),[start]);
    const bound={...start,pageSourceSha:'b'.repeat(40),pageBlobSha:'c'.repeat(40),pageSha256:'d'.repeat(64)};
    fs.writeFileSync(path.join(temp,`samples-${id}.start.json`),JSON.stringify(bound));
    eq(O.receipts(temp,sha,now),[bound]);
    assert.throws(()=>O.evaluate([bound,{...end,pageSourceSha:'e'.repeat(40),pageBlobSha:bound.pageBlobSha,pageSha256:bound.pageSha256}],1,now));passed++;
    fs.writeFileSync(path.join(temp,`samples-${id}.start.json`),JSON.stringify({...bound,pageBlobSha:undefined}));
    assert.throws(()=>O.receipts(temp,sha,now));passed++;
    fs.writeFileSync(path.join(temp,`samples-${id}.start.json`),JSON.stringify(start));
    const terminalFile=path.join(temp,`samples-${id}.terminal.json`);
    fs.writeFileSync(terminalFile,JSON.stringify({...end,denialReasons:['realtime_transport_blocked']}));
    eq(O.receipts(temp,sha,now).find(r=>'finishedAt' in r).denialReasons,['realtime_transport_blocked']);
    fs.writeFileSync(terminalFile,JSON.stringify({...end,denialReasons:['https://fixture.invalid/private']}));
    assert.throws(()=>O.receipts(temp,sha,now));passed++;
    fs.unlinkSync(terminalFile);
    assert.throws(()=>O.receipts(temp,'b'.repeat(40),now));passed++;
    assert.throws(()=>O.receipts(temp,sha,1));passed++;
    let persisted=[],sent=[];
    const options={sha,now,persist:async s=>{persisted.push(structuredClone(s));},send:async(r,i,o)=>{sent.push(o);return {delivered:true};},deliveryEnabled:true};
    let state=(await O.observe([report('samples','healthy')],null,options)).state;eq(sent.length,0);
    state=(await O.observe([report('samples','false_empty')],state,options)).state;eq(sent.length,1);eq(persisted[1].lanes.samples.status,'attempted');
    state=(await O.observe([report('samples','false_empty')],state,options)).state;eq(sent.length,1);
    state=(await O.observe([report('samples','healthy')],state,options)).state;eq(sent.length,2);eq(state.lanes.samples.result.code,'recovered');
    let deferred=(await O.observe([report('samples','read_failed')],null,{...options,deliveryEnabled:false})).state;
    eq(deferred.lanes.samples.status,'prepared');
    deferred=(await O.observe([report('samples','read_failed')],deferred,options)).state;eq(deferred.lanes.samples.status,'confirmed');
    let ambiguous=(await O.observe([report('samples','false_empty')],null,{...options,send:async()=>({delivered:false})})).state;
    eq(ambiguous.lanes.samples.status,'attempted');
    let reconcile=[];
    const pending=await O.observe([report('samples','healthy')],ambiguous,{...options,send:async(r,i,o)=>{reconcile.push(o);return {delivered:false};}});
    eq(reconcile,[{reconcileOnly:true}]);eq(pending.pendingDelivery,true);eq(pending.state.lanes.samples.result.code,'false_empty');
    eq(O.validateState({...state,privateContent:'drop'},sha),state);
    eq(H.recoveryState({},{}),undefined);
    assert.throws(()=>H.recoveryState({recoveryEnabled:true},{}));passed++;
    const recoveryFile=path.join(temp,'recovery.json');fs.writeFileSync(recoveryFile,JSON.stringify(ambiguous));
    eq(H.recoveryState({recoveryEnabled:true,releaseSha:sha},{CONTINUITY_RECOVERY_ACTIVATION:'OWNER_APPROVED_CONTINUITY_STATE_RECOVERY',CONTINUITY_RECOVERY_STATE:recoveryFile}),ambiguous);
    let calls=0;const forbidden=async()=>{calls++;throw Error('must not run');};
    await rejects(()=>H.main('view',{}, {fetchImpl:forbidden}));eq(calls,0);
    await rejects(()=>H.main('drill',{}, {fetchImpl:forbidden}));eq(calls,0);
    const run={id:1,head_sha:sha,event:'schedule',status:'completed',conclusion:'success',created_at:new Date(now-1000).toISOString(),updated_at:new Date(now).toISOString()};
    const ghEnv={GH_TOKEN:'synthetic'},fetchRuns=async()=>response({workflow_runs:[run,{...run,id:2,head_sha:'b'.repeat(40)},{...run,id:3,event:'pull_request'}]});
    eq((await H.runs('client-continuity-hosted-view.yml',sha,ghEnv,fetchRuns)).length,1);
    eq((await H.sentinel({releaseSha:sha},ghEnv,fetchRuns,now)).code,'healthy');
    eq((await H.sentinel({releaseSha:sha},ghEnv,fetchRuns,now+600001)).code,'monitor_missing');
    eq((await H.sentinel({releaseSha:sha},ghEnv,async()=>{throw Error('private');},now)).code,'monitor_missing');
    await rejects(()=>H.collect({releaseSha:sha},ghEnv,temp,fetchRuns,async()=>{throw Error('artifact unavailable');}));
    eq((await U.main(['--live'])).ready,false);
    const checkout=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}).trim();
    let drillPayload,drillPosts=0;
    const hosted=await H.main('drill',{...env,CONTINUITY_ACTIVATION:'OWNER_APPROVED_CONTINUITY_DRILL',CONTINUITY_PUBLIC_OUTPUT:temp,
      CONTINUITY_OPERATIONS_JSON:JSON.stringify({releaseSha:checkout,drillEnabled:true,delivery:cfg})},{fetchImpl:async(url,init)=>{
      if(init.method==='POST'){drillPosts++;drillPayload=JSON.parse(init.body);return response({});}
      return response({data:[execution('success',drillPayload.details.run_id,drillPayload.type)]});
    }});
    eq(hosted.ok,true);eq(drillPosts,2);
    const drillArtifact=JSON.parse(fs.readFileSync(path.join(temp,'delivery-drill.json'),'utf8'));
    eq(drillArtifact.events.map(e=>[e.code,e.status,e.evidence]),[['false_empty','confirmed','relay_terminal_success'],['recovered','confirmed','relay_terminal_success']]);
    eq(JSON.stringify(drillArtifact).includes('https:'),false);
    const expected={rowId:'fixture',scope:'synthetic',action:'comment',text:'Synthetic message'};
    const comment={body:expected.text,role:'client',audience:'client',is_tweak:false};
    const row={id:expected.rowId,client:expected.scope,graphic_status:'Client Approval',graphic_tweaks:[comment]};
    eq(U.persisted(row,expected),true);eq(U.persisted({...row,graphic_tweaks:[comment,comment]},expected),false);
    eq(U.persisted({...row,graphic_status:'Approved'},expected),false);
    eq(U.persisted({...row,graphic_tweaks:[{...comment,role:'staff'}]},expected),false);
    assert.throws(()=>U.persisted({...row,client:'other'},expected));passed++;
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
  console.log(JSON.stringify({version:1,passed,mode:'synthetic',live:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
