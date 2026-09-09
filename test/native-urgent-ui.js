'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),{extractFunction}=require('./helpers/extract-function');
const names=['_calUrgentSlackDispatch','_calCheckQueuedUrgent','_calSendUrgentSlack','_sxrSendUrgentSlack','_sxrKasperSendUrgentSlack','_kasperSendUrgentSlack','_calShowUrgent','_sxrShowUrgent','_writeUiComponentHasWorkItem','_writeUiNativeId','_syncviewEfHeaders'];
const gatewayDeclaration=html.match(/^\s*const WRITE_UI_PRODUCTION_WRITE_URL = [^;]+;/m);
assert.ok(gatewayDeclaration, 'actual shared gateway URL declaration exists');
const failureTables=html.slice(html.indexOf('const WRITE_UI_FAILURE_CLASS_TEXT'),html.indexOf('function _writeUiReportFailure('));
const source=gatewayDeclaration[0]+'\n'+failureTables+'\n'+names.map(n=>(n==='_calCheckQueuedUrgent'?'async ':'')+extractFunction(html,n)).join('\n'),round='2030-01-01T00:00:00.000Z';let passed=0;
function world(surface='calendar',store=new Map()){
 const post={id:'card-1',video_deliverable_id:'native-video-1',video_status:'Tweaks Needed',video_status_at:round,name:'Synthetic card'},sent=[],persisted=[],notices=[],confirms=[];
 const button=()=>({disabled:false,textContent:'URGENT',dataset:{},classList:{add(){}}});
 const item={post,slug:'fixture',client:'Fixture'},ctx={console:{warn(){}},JSON,String,Date,Map,AbortSignal,crypto:require('node:crypto').webcrypto,CAL_SUPABASE_URL:'https://project.invalid',CAL_SUPABASE_ANON_KEY:'synthetic-public',URGENT_SLACK_URL:'https://n8n.invalid/urgent',_isClientLink:false,
 _syncviewStaffIdentityForHeaders:()=>({key:'synthetic-staff',member:{name:'Synthetic Staff'},role:'smm'}),
 _calNormStatus:x=>x,_sxrNormStatus:x=>x,calClientSlug:()=>ctx.scope,sxrClientSlug:()=>ctx.scope,scope:'fixture',wlCanonicalClient:()=> 'Fixture',
 calState:{client:'Fixture',posts:[post]},sxrState:{client:'Fixture',posts:[post]},_kasperState:{items:[item],replies:[]},_sxrKasperFindItem:()=>item,
 localStorage:{getItem:k=>{if(ctx.readFailure)throw Error('storage');return store.get(k)||null;},setItem:(k,v)=>{if(ctx.writeFailure)throw Error('quota');store.set(k,v);},removeItem:k=>store.delete(k)},
 showNotify:(...x)=>notices.push(x),showConfirm:(title,text,fn)=>confirms.push(fn),
 _calPersistUrgentSentForPost:async(...x)=>{persisted.push(x);if(ctx.persistFailure)throw Error('save');},_sxrPersistUrgentSentForPost:async(...x)=>{persisted.push(x);if(ctx.persistFailure)throw Error('save');},
 fetch:async(url,options)=>{sent.push({url,options,body:JSON.parse(options.body)});if(ctx.afterFetch)await ctx.afterFetch();if(ctx.lost)throw Error('lost');
 // `staged` answers successive requests in order, so one attempt can cross lanes.
 const staged=Array.isArray(ctx.staged)&&ctx.staged.length?ctx.staged.shift():null,status=staged?staged.status:ctx.status,reply=staged?staged.reply:ctx.reply;
 return {ok:status===200,status,json:async()=>{if(ctx.invalidJson)throw Error('parse');return reply;}}},status:200,reply:{ok:true,delivery:'sent',dispatch_id:'dispatch-1',slack_ts:'123.456'}};
 vm.createContext(ctx);vm.runInContext(source,ctx);const fn={calendar:'_calSendUrgentSlack',samples:'_sxrSendUrgentSlack',samples_queue:'_sxrKasperSendUrgentSlack',calendar_queue:'_kasperSendUrgentSlack'}[surface];
 const click=(b=button())=>{ctx[fn]({currentTarget:b,preventDefault(){},stopPropagation(){}},post.id);return b;};
 return {ctx,post,item,store,sent,persisted,notices,confirms,button,click,confirm:async()=>{assert.equal(confirms.length,1);confirms.shift()();await new Promise(r=>setImmediate(r));}};
}
async function check(label,fn){await fn();passed++;console.log('PASS '+label);}
(async()=>{
 for(const surface of ['calendar','samples','samples_queue','calendar_queue']){
  await check(surface+' native context uses protected origin and explicit sent receipt',async()=>{const w=world(surface),b=w.click();assert.equal(w.sent.length,0);await w.confirm();assert.equal(w.sent.length,1);const r=w.sent[0];assert.equal(r.url,vm.runInContext('WRITE_UI_PRODUCTION_WRITE_URL',w.ctx));assert.equal(vm.runInContext('typeof PROD_WRITE_EF_URL',w.ctx),'undefined');assert.equal(r.options.headers['X-Syncview-Key'],'synthetic-staff');assert.deepEqual(Object.keys(r.body).sort(),['action','card_id','client_slug','deliverable_id','surface','video_status_at']);assert.equal(r.body.surface,surface.startsWith('samples')?'samples':'calendar');assert.equal(r.body.client_slug,'fixture');assert.equal(r.body.deliverable_id,w.post.video_deliverable_id);assert.equal(r.body.video_status_at,round);assert.equal(w.persisted.length,1);assert.equal(b.dataset.urgentSent,'1');assert.equal(b.textContent,'Sent');});
  await check(surface+' legacy webhook never receives staff credentials',async()=>{const w=world(surface);delete w.post.video_deliverable_id;w.post.linear_issue_id='https://linear.invalid/issue/1';w.ctx.reply={ok:true,editor:'Synthetic editor'};w.click();await w.confirm();assert.equal(w.sent[0].url,w.ctx.URGENT_SLACK_URL);assert.deepEqual(Object.keys(w.sent[0].options.headers),['Content-Type']);assert.equal(w.sent[0].body.issue,w.post.linear_issue_id);assert.equal(w.persisted.length,1);});
 }
 for(const scenario of ['lost','invalid_json','ok_without_sent','sent_missing_receipt','unknown'])await check(scenario+' holds without Sent, persistence or retry after reload',async()=>{const w=world(),b=w.click();if(scenario==='lost')w.ctx.lost=true;if(scenario==='invalid_json')w.ctx.invalidJson=true;if(scenario==='ok_without_sent')w.ctx.reply={ok:true};if(scenario==='sent_missing_receipt')w.ctx.reply={ok:true,delivery:'sent'};if(scenario==='unknown'){w.ctx.status=502;w.ctx.reply={ok:false,delivery:'unknown',retry_safe:false};}await w.confirm();assert.equal(w.sent.length,1);assert.equal(w.persisted.length,0);assert.equal(b.textContent,'Check delivery');assert.notEqual(b.dataset.urgentSent,'1');const reload=world('calendar',w.store);reload.click();assert.equal(reload.confirms.length,0);assert.equal(reload.sent.length,0);assert.match(reload.notices[0][1],/manually/);});
 await check('queued native admission stays visibly queued without Sent and checks its receipt before another attempt',async()=>{const w=world(),b=w.click();w.ctx.status=202;w.ctx.reply={ok:true,delivery:'pending',dispatch_id:'dispatch-queued'};await w.confirm();assert.equal(w.persisted.length,0);assert.equal(b.textContent,'Queued');assert.notEqual(b.dataset.urgentSent,'1');const reload=world('calendar',w.store);reload.ctx.reply={ok:true,delivery:'pending',sent:false};reload.click();await new Promise(r=>setImmediate(r));assert.equal(reload.sent.length,1);assert.equal(reload.confirms.length,0);assert.equal(reload.persisted.length,0);assert.equal(reload.notices[0][0],'Urgent ping queued');});
 for(const surface of ['calendar','samples','samples_queue','calendar_queue'])await check(surface+' deterministic urgent refusals show actionable guidance without blanket retry',async()=>{
  for(const code of ['invalid_urgent_request','native_urgent_not_configured','urgent_assignment_unavailable','urgent_context_unavailable','urgent_editor_unavailable','urgent_round_unavailable','urgent_target_changed']){
   const w=world(surface),b=w.click();w.ctx.status=409;w.ctx.reply={ok:false,delivery:'not_sent',retry_safe:true,error:code};await w.confirm();
   assert.equal(w.sent.length,1);assert.equal(w.persisted.length,0);assert.equal(w.store.size,0);assert.equal(b.disabled,false);
   assert.match(w.notices[0][1],new RegExp('code: '+code));assert.doesNotMatch(w.notices[0][1],/try again|trying again/i);
  }
 });
 for(const storage of ['readFailure','writeFailure'])await check(storage+' refuses before network',async()=>{const w=world();w.ctx[storage]=true;w.click();if(w.confirms.length)await w.confirm();assert.equal(w.sent.length,0);assert.equal(w.persisted.length,0);assert.match(w.notices[0][1],/Nothing (new )?was sent/);});
 await check('equivalent timestamp formatting cannot bypass a retained round',async()=>{const w=world();w.ctx.lost=true;w.click();await w.confirm();const reload=world('calendar',w.store);reload.post.video_status_at='2030-01-01T00:00:00+00:00';reload.click();assert.equal(reload.sent.length,0);assert.equal(reload.confirms.length,0);});
 await check('two confirmation callbacks still issue one native attempt',async()=>{const w=world();w.click();const confirm=w.confirms.shift();confirm();confirm();await new Promise(r=>setImmediate(r));assert.equal(w.sent.length,1);});
 await check('header preparation failure removes its own hold and permits a new explicit attempt',async()=>{const w=world(),headers=w.ctx._syncviewEfHeaders,b=w.click();w.ctx._syncviewEfHeaders=()=>{throw Error('header preparation');};await w.confirm();assert.equal(w.sent.length,0);assert.equal(w.persisted.length,0);assert.equal(w.store.size,0);assert.equal(b.disabled,false);assert.match(w.notices[0][1],/Nothing was sent/);w.ctx._syncviewEfHeaders=headers;w.click();await w.confirm();assert.equal(w.sent.length,1);assert.equal(w.persisted.length,1);});
 await check('pretransport cleanup cannot erase a replacement hold',async()=>{const w=world();w.ctx._syncviewEfHeaders=()=>{assert.equal(w.store.size,1);for(const k of w.store.keys())w.store.set(k,'replacement-unknown');throw Error('header preparation');};w.click();await w.confirm();assert.equal(w.sent.length,0);assert.deepEqual([...w.store.values()],['replacement-unknown']);const reload=world('calendar',w.store);reload.click();assert.equal(reload.confirms.length,0);assert.equal(reload.sent.length,0);});
 await check('timeout signal preparation failure is known no-send and releases only its own hold',async()=>{const w=world();w.ctx.AbortSignal={timeout(){throw Error('signal preparation');}};w.click();await w.confirm();assert.equal(w.sent.length,0);assert.equal(w.store.size,0);});
 await check('explicit pretransport refusal alone releases the local hold for manual retry',async()=>{const w=world(),b=w.click();w.ctx.status=409;w.ctx.reply={ok:false,delivery:'not_sent',retry_safe:true,error:'round_changed'};await w.confirm();assert.equal(w.store.size,0);assert.equal(w.persisted.length,0);assert.equal(b.disabled,false);w.click();assert.equal(w.confirms.length,1);assert.equal(w.sent.length,1);});
 for(const drift of ['round','identity','client','status'])await check('known delivery cannot mark changed '+drift,async()=>{const w=world(),b=w.click();w.ctx.afterFetch=()=>{if(drift==='round')w.post.video_status_at='2030-01-02T00:00:00.000Z';if(drift==='identity')w.post.video_deliverable_id='changed';if(drift==='client')w.ctx.scope='other';if(drift==='status')w.post.video_status='Approved';};await w.confirm();assert.equal(w.persisted.length,0);assert.notEqual(b.dataset.urgentSent,'1');assert.equal(b.textContent,'Earlier round sent');});
 await check('persistent marker failure never opens an acknowledged send to automatic retry',async()=>{const w=world(),b=w.click();w.ctx.persistFailure=true;await w.confirm();assert.equal(b.dataset.urgentSent,'1');const next=world('calendar',w.store);next.click();assert.equal(next.sent.length,0);assert.equal(next.confirms.length,0);});
 // The gateway that knows this action deploys AFTER this file reaches Pages.
 // Until it does, the deployed gateway answers `400 unsupported_action` with no
 // `delivery` field, and a card that works today must keep working.
 const UNSUPPORTED={status:400,reply:{ok:false,error:'unsupported_action'}};
 for(const surface of ['calendar','samples','samples_queue','calendar_queue'])
  await check(surface+' pre-deployment gateway falls back to the legacy webhook without staff credentials',async()=>{
   const w=world(surface);w.post.linear_issue_id='https://linear.invalid/issue/1';const b=w.click();
   w.ctx.staged=[UNSUPPORTED,{status:200,reply:{ok:true,editor:'Synthetic editor'}}];
   await w.confirm();
   assert.equal(w.sent.length,2);
   assert.equal(w.sent[0].url,vm.runInContext('WRITE_UI_PRODUCTION_WRITE_URL',w.ctx));
   assert.equal(w.sent[1].url,w.ctx.URGENT_SLACK_URL);
   assert.deepEqual(Object.keys(w.sent[1].options.headers),['Content-Type']);
   assert.equal(w.sent[1].body.issue,w.post.linear_issue_id);
   assert.equal(w.store.size,0);
   assert.equal(w.persisted.length,1);
   assert.equal(b.dataset.urgentSent,'1');assert.equal(b.textContent,'Sent');
   const reload=world(surface,w.store);reload.post.linear_issue_id=w.post.linear_issue_id;reload.click();assert.equal(reload.confirms.length,1);
  });
 await check('pre-deployment gateway leaves a native-only card explicitly unsent and retryable',async()=>{
  const w=world(),b=w.click();w.ctx.staged=[UNSUPPORTED];
  await w.confirm();
  assert.equal(w.sent.length,1);assert.equal(w.persisted.length,0);assert.equal(w.store.size,0);
  assert.equal(b.disabled,false);assert.equal(b.textContent,'URGENT');
  assert.match(w.notices[0][1],/Nothing was sent|nothing was sent/);assert.match(w.notices[0][1],/manually/);
  const reload=world('calendar',w.store);reload.click();assert.equal(reload.confirms.length,1);
 });
 await check('a 400 the live gateway can produce never reaches the legacy webhook',async()=>{
  const w=world();w.post.linear_issue_id='https://linear.invalid/issue/1';const b=w.click();
  w.ctx.status=400;w.ctx.reply={ok:false,delivery:'not_sent',retry_safe:true,error:'invalid_urgent_request'};
  await w.confirm();
  assert.equal(w.sent.length,1);assert.equal(w.persisted.length,0);assert.equal(w.store.size,0);assert.equal(b.disabled,false);
  assert.match(w.notices[0][1],/code: invalid_urgent_request/);
 });
 await check('an unrecognised 400 stays conservative rather than guessing a lane',async()=>{
  const w=world();w.post.linear_issue_id='https://linear.invalid/issue/1';const b=w.click();
  w.ctx.status=400;w.ctx.reply={ok:false,error:'invalid_urgent_request'};
  await w.confirm();
  assert.equal(w.sent.length,1);assert.equal(w.persisted.length,0);assert.equal(b.textContent,'Check delivery');
 });
 await check('client link cannot dispatch native urgent',async()=>{const w=world();w.ctx._isClientLink=true;w.click();assert.equal(w.confirms.length,0);assert.equal(w.sent.length,0);});
 await check('native video visibility preserves component and tweak status gates',async()=>{const w=world();for(const n of ['_calShowUrgent','_sxrShowUrgent']){assert.equal(w.ctx[n](w.post,'video'),true);assert.equal(w.ctx[n](w.post,'graphic'),false);assert.equal(w.ctx[n]({...w.post,video_status:'Approved'},'video'),false);assert.equal(w.ctx[n]({...w.post,video_deliverable_id:''},'video'),false);}});
 console.log(JSON.stringify({status:'PASS',passed,classification:'OFFLINE_ACTUAL_VM',external_requests:0,limitations:['Synthetic delivery replies; no server, Slack, installed auth, browser layout or global exactly-once proof']}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
