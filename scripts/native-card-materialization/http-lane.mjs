// Finite actual-handler loopback HTTP + service RPC + real SQL. Synthetic data.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';
import {accepted as gatewayAccepted,sql,rows,gw} from './fixture.mjs';
import {load,start,send,close,seam,events,sourcePins,assertStable,sha,sourceRoot} from './http-edge.mjs';
const require=createRequire(import.meta.url),{extractFunction}=require('../../test/helpers/extract-function');
const output=process.env.NATIVE_CARD_HTTP_OUTPUT,checks=[],q=v=>"'"+String(v).replaceAll("'","''")+"'",copy=v=>JSON.parse(JSON.stringify(v));
const proofRoot=path.resolve(import.meta.dirname,'../..');
const proofFiles=['test/native-card-materialization-http.js','scripts/native-card-materialization/http-edge.mjs',
  'scripts/native-card-materialization/http-lane.mjs','scripts/native-card-materialization/fixture.mjs',
  'scripts/native-intake-reconcile/load-gateway.mjs','scripts/native-intake-manifest/supabase-shim.mjs',
  'qa/calendar-feedback-recovery/seam.js','scripts/card-history-integrated-rehearsal.js',
  'supabase/functions/production-write/index.ts','index.html',
  'migrations/2026-09-06-native-card-materialization-boundary.sql'];
const proofPins=Object.fromEntries(proofFiles.map(file=>[file,sha(fs.readFileSync(path.join(proofRoot,file)))]));
const browserPin=sha(fs.readFileSync(path.join(sourceRoot,'index.html')));
const header=source=>({'x-syncview-source':source,'x-syncview-key':'fixture-admin-key'});
// The existing SQL-only fixture's hyphenated slug is not a browser writer slug.
// Keep its gateway/browser implementation, with one valid fictional client.
const accepted=(kind='both',surface='calendar',failAt=0)=>gatewayAccepted(kind,surface,failAt,{client_slug:'fixtureclient'});
const names=['batches','deliverables','mirror_outbox','calendar_posts','sample_reviews','production_card_provenance','card_change_journal','production_card_materialization_receipts'];
async function facts(){return sql('select jsonb_object_agg(name,images)::text from ('+names.map(t=>`select '${t}' name,(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${t} t) images`).join(' union all ')+') t');}
async function row(c){return (await rows(`select * from public.${c.surface==='samples'?'sample_reviews':'calendar_posts'} where client=${q(c.body.client)} and id=${q(c.body[c.surface==='samples'?'sample':'post'].id)}`))[0];}
async function mode(value){await sql(`update public.syncview_runtime_flags set value=value||${q(JSON.stringify({mode:value,epoch:'synthetic-http-coverage'}))}::jsonb where key='native_card_materialization'`);}
const check=async(name,fn)=>{try{await fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false});throw error;}};
async function nativeRequest(route,c,{body=c.body,headers=header(c.source)}={}){
  const at=events.calls.length,tableAt=seam.calls.length,bg=events.background;
  const r=await send(route,body,headers);
  assert.equal(events.calls.length-at,1,'one native RPC');assert.equal(events.calls.at(-1).name,'production_card_materialize');
  assert.equal(seam.calls.length,tableAt,'native branch never enters old read/scalar/comment path');assert.equal(events.background,bg,'native branch never schedules old event/thumbnail tail');return r;
}
const routes={},captureProof=[];
try{
  await sql("insert into public.clients select (jsonb_populate_record(null::public.clients,(select to_jsonb(c)||'{\"slug\":\"fixtureclient\"}'::jsonb from public.clients c where slug='fixture-client'))).*;");
  for(const surface of ['calendar','samples'])routes[surface]=await load(surface==='calendar'?'calendar-upsert':'sample-review-upsert');
  const captures=process.env.NATIVE_CARD_HTTP_CAPTURE_CONFIG?JSON.parse(fs.readFileSync(process.env.NATIVE_CARD_HTTP_CAPTURE_CONFIG,'utf8')):null;
  if(captures)for(const surface of ['calendar','samples']){
    const c=captures[surface];assert.equal(sha(fs.readFileSync(c.path)),c.sha256,'exact dated capture');
    const slug=surface==='calendar'?'calendar-upsert':'sample-review-upsert';
    captureProof.push({surface,baseline:await load(slug,{capture:c.path}),candidate:await load(slug,{capture:c.path,derived:true})});
  }
  await start();
  await check('repository source retains unauthenticated refusal before native RPC',async()=>{
    for(const surface of ['calendar','samples']){const c=await accepted('video',surface),at=events.calls.length,r=await send(routes[surface].route,c.body,{'x-syncview-source':c.source});assert.equal(r.status,401);assert.equal(r.body.ok,false);assert.equal(events.calls.length,at);}
  });
  await check('default admission hold conserves one exact raw HTTP body with no card mutation',async()=>{
    const c=await accepted(),before=await facts(),raw=' \n'+JSON.stringify(c.body)+'\n';const r=await nativeRequest(routes.calendar.route,c,{body:raw});
    assert.equal(r.body.ok,false);assert.equal(r.body.conserved,true);assert.notEqual(r.status,200);assert.equal(await facts(),before);
    const ingress=(await rows('select raw_body,raw_sha256 from public.production_card_materialization_ingress order by received_at desc limit 1'))[0];
    assert.equal(ingress.raw_body,raw);assert.equal(ingress.raw_sha256,sha(raw));
  });
  await mode('native');const cases=[];
  for(const surface of ['calendar','samples'])for(const kind of ['video','thumbnail','both'])await check(surface+' '+kind+' actual native envelope creates full scoped row via HTTP',async()=>{
    const c=await accepted(kind,surface),r=await nativeRequest(routes[surface].route,c);assert.equal(r.body.ok,true);assert.ok(r.status>=200&&r.status<300);
    assert.deepEqual(r.body[surface==='calendar'?'post':'sample'],await row(c));cases.push(c);
  });
  for(const[index,field]of [[0,'graphic_deliverable_id'],[4,'video_deliverable_id']])await check(cases[index].surface+' malformed success cannot populate an originally absent native slot',async()=>{
    const c=cases[index],key=c.surface==='calendar'?'post':'sample',before=await facts();
    events.fault=(_name,_args,real)=>{const reply=real();assert.equal(reply.data.ok,true);reply.data[key][field]='99999999-9999-4999-8999-999999999999';return reply;};
    try{const r=await nativeRequest(routes[c.surface].route,c);assert.equal(r.status,503);assert.equal(r.body.ok,false);assert.equal(r.body.conserved,null);assert.equal(await facts(),before);}
    finally{events.fault=null;}
  });
  for(const c of [cases[2],cases[5]])await check(c.surface+' lost HTTP response retries current human-edited row without rewriting owners',async()=>{
    const route=routes[c.surface].route,table=c.surface==='calendar'?'calendar_posts':'sample_reviews',key=c.surface==='calendar'?'post':'sample';
    const first=await accepted('both',c.surface);
    await assert.rejects(send(route,first.body,{...header(first.source),'x-fixture-lose-response':'yes'}));
    assert.ok(await row(first),'commit preceded lost HTTP response');
    await sql(`update public.${table} set name='Later human title',status='Approved',asset_url='synthetic-independent-asset',order_index='923',video_tweaks='[{"id":"human-note","text":"Later human note"}]' where client=${q(first.body.client)} and id=${q(first.body[key].id)};`);
    const expected=await row(first),before=await facts(),replay=copy(first.body);replay[key].order_index+=19;
    const r=await nativeRequest(route,first,{body:replay});assert.equal(r.body.ok,true);assert.deepEqual(r.body[key],expected);assert.equal(await facts(),before);
  });
  const c=cases[2];
  for(const [name,edit]of [['client',p=>p.client='wrongsyntheticclient'],['card',p=>p.post.id='wrong-synthetic-card'],['child',p=>p.post.video_deliverable_id='wrong-synthetic-child'],['body',p=>p.post.caption='Different incoming intent']])
    await check('changed '+name+' cannot adopt accepted receipt over HTTP',async()=>{const p=copy(c.body);edit(p);const before=await facts(),r=await nativeRequest(routes.calendar.route,c,{body:p});assert.equal(r.body.ok,false);assert.equal(await facts(),before);});
  await check('unknown manifest is retained and visibly held',async()=>{
    const before=await facts(),r=await nativeRequest(routes.calendar.route,c,{body:{client:c.body.client,post:{id:'p_native_synthetic_unknown'}}});assert.equal(r.body.ok,false);assert.equal(r.body.conserved,true);assert.equal(await facts(),before);
  });
  await check('accepted replay remains available in hold while a fresh request is held',async()=>{
    const fresh=await accepted('thumbnail','samples');await mode('hold');
    try{const prior=await facts(),replay=await nativeRequest(routes.samples.route,cases[5]),held=await nativeRequest(routes.samples.route,fresh);
      assert.equal(replay.body.ok,true);assert.equal(held.body.ok,false);assert.equal(held.body.conserved,true);assert.equal(await facts(),prior);
    }finally{await mode('native');}
  });
  await check('wrong endpoint and invalid staff credential cannot reach an accepted native card',async()=>{
    const before=await facts(),at=events.calls.length;
    for(const[route,headers]of [[routes.samples.route,header(c.source)],[routes.calendar.route,{...header(c.source),'x-syncview-key':'invalid-synthetic-key'}]]){
      const r=await send(route,c.body,headers);assert.equal(r.body.ok,false);assert.ok(r.status>=400);
    }assert.equal(events.calls.length,at);assert.equal(await facts(),before);
  });
  await check('ingress storage failure never acknowledges conservation or leaves untracked card',async()=>{
    const next=await accepted('video'),before=await facts();await sql('alter table public.production_card_materialization_ingress add constraint synthetic_http_ingress_failure check(false) not valid');
    try{const r=await nativeRequest(routes.calendar.route,next);assert.equal(r.body.ok,false);assert.notEqual(r.body.conserved,true);assert.ok(r.status>=400);assert.equal(await facts(),before);}
    finally{await sql('alter table public.production_card_materialization_ingress drop constraint synthetic_http_ingress_failure');}
  });
  for(const [name,value]of [['null',null],['sparse_success',{ok:true}],['wrong_row',{ok:true,conserved:true,post:{id:'wrong',client:'wrong'}}],['string','not-an-object'],['transport_error','THROW']])
    await check('RPC '+name+' cannot become successful browser consumption',async()=>{
      const before=await facts();events.fault=()=>{if(value==='THROW')throw Error('synthetic_private_rpc_failure');return {data:value,error:null};};
      try{const r=await nativeRequest(routes.calendar.route,c);assert.equal(r.body.ok,false);assert.ok(r.status>=400);assert.equal(await facts(),before);assert.ok(!r.raw.includes('synthetic_private_rpc_failure'));}finally{events.fault=null;}
    });
  for(const [name,body]of [['oversize','x'.repeat(1048577)],['invalid_UTF8',Buffer.from([0xff,0xfe])],['malformed_JSON','{broken']])
    await check(name+' HTTP input refuses without native/ordinary mutation',async()=>{
      const before=await facts(),at=events.calls.length,tableAt=seam.calls.length,r=await send(routes.calendar.route,body,header(c.source));
      assert.equal(r.body.ok,false);assert.ok(r.status>=400);assert.notEqual(r.body.conserved,true);assert.equal(await facts(),before);assert.equal(events.calls.length,at);assert.equal(seam.calls.length,tableAt);
    });
  for(const surface of ['calendar','samples'])await check(surface+' ordinary UI rename-back remains an ordinary authenticated source write',async()=>{
    const c=cases.find(x=>x.surface===surface),key=surface==='calendar'?'post':'sample',table=surface==='calendar'?'calendar_posts':'sample_reviews';
    await sql(`update public.${table} set name='Later title' where client=${q(c.body.client)} and id=${q(c.body[key].id)}`);
    const at=events.calls.filter(x=>x.name==='production_card_materialize').length,r=await send(routes[surface].route,{client:c.body.client,[key]:{id:c.body[key].id,name:c.body[key].name}},header('ui'));
    assert.equal(r.body.ok,true);assert.equal((await row(c)).name,c.body[key].name);assert.equal(events.calls.filter(x=>x.name==='production_card_materialize').length,at);
  });
  for(const proof of captureProof)await check(proof.surface+' dated anonymous capture retains ordinary writes and derived adapter protects native replay',async()=>{
    const c=cases.find(x=>x.surface===proof.surface),key=proof.surface==='calendar'?'post':'sample',table=proof.surface==='calendar'?'calendar_posts':'sample_reviews';
    for(const route of [proof.baseline.route,proof.candidate.route]){
      const at=events.calls.filter(x=>x.name==='production_card_materialize').length;
      const r=await send(route,{client:c.body.client,[key]:{id:c.body[key].id,name:'Anonymous retained edit'}},{'x-syncview-source':'ui'});
      assert.equal(r.body.ok,true);assert.equal((await row(c)).name,'Anonymous retained edit');assert.equal(events.calls.filter(x=>x.name==='production_card_materialize').length,at);
    }
    const old=await send(proof.baseline.route,c.body,{'x-syncview-source':c.source});
    assert.equal(old.body.ok,true);assert.equal((await row(c)).name,c.body[key].name,'preserved captured writer reproduces old native overwrite');
    await sql(`update public.${table} set name='Anonymous retained edit' where client=${q(c.body.client)} and id=${q(c.body[key].id)}`);
    const before=await facts(),r=await nativeRequest(proof.candidate.route,c,{headers:{'x-syncview-source':c.source}});
    assert.equal(r.body.ok,true);assert.equal(r.body[key].name,'Anonymous retained edit');assert.equal(await facts(),before);
  });
  for(const surface of ['calendar','samples'])for(const fixture of [{route:routes[surface].route,scope:'repository authenticated',headers:header('ui')},
    ...captureProof.filter(x=>x.surface===surface).flatMap(x=>[{route:x.baseline.route,scope:'dated anonymous baseline',headers:{'x-syncview-source':'ui'}},{route:x.candidate.route,scope:'dated anonymous derived',headers:{'x-syncview-source':'ui'}}])])
    await check(surface+' '+fixture.scope+' ordinary approval note and tweak keep original writer ownership',async()=>{
      const c=cases.find(x=>x.surface===surface),key=surface==='calendar'?'post':'sample',stamp=new Date().toISOString(),nativeAt=events.calls.filter(x=>x.name==='production_card_materialize').length;
      const id='ordinary-'+surface+'-'+checks.length;
      for(const patch of [{video_status:'Approved',client_video_approved_at:stamp},
        {video_tweaks:JSON.stringify([{id:id+'-note',text:'Synthetic ordinary note',ts:stamp}])},
        {video_status:'Tweaks Needed',client_video_approved_at:'',video_tweaks:JSON.stringify([{id:id+'-tweak',text:'Synthetic ordinary tweak',ts:stamp}])}]){
        const r=await send(fixture.route,{client:c.body.client,[key]:{id:c.body[key].id,...patch}},fixture.headers);
        assert.equal(r.body.ok,true);const current=await row(c);
        for(const[k,v]of Object.entries(patch))if(k==='video_tweaks')assert.ok(current[k].includes(JSON.parse(v)[0].id));else assert.equal(current[k],v);
      }assert.equal(events.calls.filter(x=>x.name==='production_card_materialize').length,nativeAt);
    });
  await check('actual retained browser pins accepted job to EF before marking completed',async()=>{
    const c=cases[2],ctx={console,_isIntake:true,_linearIntakeCheckpointOrSuspend:()=>{},_calCacheRead:()=>null,_sxrCacheRead:()=>null,_calCacheWrite:()=>{},_calRenderBody:()=>{},calClientSlug:x=>x,
      calState:{client:c.body.client,posts:[]},_linearIntakeRead:()=>ctx.__job,_calUpsertFetchPinned:async(_client,body,source,transport)=>{
        assert.equal(transport,'supabase');assert.equal(source,'submission-native');const r=await send(routes.calendar.route,body,header(source));return new Response(r.raw,{status:r.status});}};
    vm.createContext(ctx);const html=fs.readFileSync(path.join(sourceRoot,'index.html'),'utf8');
    vm.runInContext(['async '+extractFunction(html,'_writeNativeSubmissionCardsToCalendar'),extractFunction(html,'_nativeAcceptedCardTransport'),extractFunction(html,'_linearIntakeValidateResult'),extractFunction(html,'_linearIntakeRequireActor'),extractFunction(html,'_linearIntakeJobId')].join('\n'),ctx);
    const job={version:3,payload:c.intake_body,result:c.response.json,context:{surface:c.intake_body.surface,materialization_source:c.source},completed_card_ids:[]};ctx.__job=job;await ctx._writeNativeSubmissionCardsToCalendar(job);
    assert.deepEqual(JSON.parse(JSON.stringify(job.completed_card_ids)),[c.body.post.id]);assert.deepEqual(JSON.parse(JSON.stringify(ctx.calState.posts[0])),await row(c));
  });
  for(const surface of ['calendar','samples'])await check(surface+' actual cold and failed-flag router still exposes the held legacy transport',async()=>{
    const html=fs.readFileSync(path.join(sourceRoot,'index.html'),'utf8'),c=cases.find(x=>x.surface===surface),sx=surface==='samples';
    const functions=['_calRuntimeFlagClients',...(sx?['_sxrSetSampleFlagValue','_sxrFetchSampleFlagOnce','_sxrPrimeSampleRoutingFlag','_sxrSampleUseEf','_sxrUpsertUrlForClient','_sxrUpsertFetch']:
      ['_calSetUpsertFlagValue','_calFetchUpsertFlagOnce','_calPrimeUpsertRoutingFlag','_calUpsertUseEf','_calUpsertUrlForClient','_calUpsertFetch'])];
    const source=functions.map(name=>(name.includes('FetchUpsertFlagOnce')||name.includes('FetchSampleFlagOnce')?'async ':'')+extractFunction(html,name)).join('\n');
    for(const failed of [false,true]){
      let settle;const pending=new Promise((resolve,reject)=>{settle=failed?()=>reject(Error('synthetic flag failure')):()=>resolve(new Response(JSON.stringify([{value:{clients:[c.body.client]}}]),{status:200}));}),destinations=[];
      const ctx={console:{warn:()=>{}},Response,Set,Promise,calClientSlug:x=>x,sxrClientSlug:x=>x,CAL_SUPABASE_URL:'flag-fixture',CAL_SUPABASE_ANON_KEY:'synthetic',
        CALENDAR_UPSERT_FLAG_KEY:'calendar_upsert_ef_clients',SXR_SAMPLE_REVIEW_FLAG_KEY:'sample_review_ef_clients',CALENDAR_UPSERT_EF_URL:'ef-fixture',SXR_UPSERT_EF_URL:'ef-fixture',CALENDAR_UPSERT_N8N_URL:'legacy-fixture',SXR_UPSERT_N8N_URL:'legacy-fixture',
        _calUpsertEfClients:new Set(),_sxrSampleEfClients:new Set(),_calUpsertFlagPromise:null,_sxrSampleFlagPromise:null,_calV2Log:()=>{},_writeUiPrimeRerouteFlag:()=>Promise.resolve(),_calSubscribeUpsertFlag:()=>{},_sxrSubscribeSampleFlag:()=>{},
        _calUpsertHeaders:s=>header(s),_sxrWriteHeaders:s=>header(s),fetch:async(url,options)=>{
          if(url.startsWith('flag-fixture'))return pending;destinations.push(url);
          if(url==='legacy-fixture')return new Response('{"ok":false,"error":"legacy_adapter_unimplemented"}',{status:503});
          assert.equal(url,'ef-fixture');const r=await send(routes[surface].route,options.body,options.headers);return new Response(r.raw,{status:r.status});
        }};
      vm.createContext(ctx);vm.runInContext(source,ctx);const invoke=ctx[sx?'_sxrUpsertFetch':'_calUpsertFetch'];
      assert.equal((await invoke(c.body.client,c.body,c.source)).status,503);assert.deepEqual(destinations,['legacy-fixture']);
      settle();await ctx[sx?'_sxrSampleFlagPromise':'_calUpsertFlagPromise'];
      const response=await invoke(c.body.client,c.body,c.source);assert.equal(response.status,failed?503:200);
      assert.equal(destinations.at(-1),failed?'legacy-fixture':'ef-fixture');
    }
  });
  await check('no provider request or external socket left the fixture',async()=>{
    assert.equal(events.external,0);assert.equal(gw.net.requests.filter(r=>/linear|n8n/.test(r.url)).length,0);assertStable();
    for(const[file,hash]of Object.entries(proofPins))assert.equal(sha(fs.readFileSync(path.join(proofRoot,file))),hash,'proof source changed during run');
    assert.equal(sha(fs.readFileSync(path.join(sourceRoot,'index.html'))),browserPin,'browser source changed during run');
  });
}catch(error){fs.writeFileSync(path.join(output,'failure.private.log'),String(error.stack));if(!checks.some(c=>!c.pass))checks.push({name:'fixture_completed',pass:false});}
finally{await close();}
const report={classification:'ACTUAL_LOOPBACK_HTTP_SERVICE_RPC_SQL_SYNTHETIC',passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length,checks,
  source_sha256:sourcePins(),proof_sources_sha256:proofPins,browser_source_sha256:browserPin,
  http_requests:events.http,external_attempts:events.external,captured_fixture: captureProof.length?captureProof:'NOT_RUN_PRIVATE_CAPTURES_REQUIRED',
  limits:['No serving equality or live client proof','Repository authentication and dated anonymous captures are distinct','n8n graph unchanged: cold/failed-flag fallback remains held','No full37 restore repeated; selected SQL/auth/grants are fixture-shaped']};
fs.writeFileSync(path.join(output,'REPORT.private.json'),JSON.stringify(report,null,2));
console.log('NATIVE_CARD_HTTP_RESULT '+JSON.stringify({status:report.failed?'FAIL':'PASS',passed:report.passed,failed:report.failed,http_requests:report.http_requests,external_attempts:report.external_attempts}));process.exitCode=report.failed?1:0;
