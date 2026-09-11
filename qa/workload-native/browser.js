'use strict';
// Full integrated HTML in Chromium; only network/storage/time fixtures are supplied.
// No product loader, renderer, date writer or receipt callback is replaced.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {startStreamServer,openCase}=require('../boot/client-entry-sequence');
const root=path.resolve(__dirname,'../..');
const copy=value=>JSON.parse(JSON.stringify(value));
const member={id:'synthetic-staff-1',name:'Synthetic Test Operator',role:'smm',team:'test'};
const slug='bootfixtureclient',client='Boot Fixture Client',nativeId='del_native_browser_fixture',mappedId='del_mapped_browser_fixture';
const source=fs.readFileSync(path.join(root,'index.html'));
let date='2026-09-08',due='2026-09-11',updated='2026-09-01T00:00:00Z';
function row(id,mapped){return {id,linear_id:mapped?'synthetic-legacy-plan':null,source:'native',is_sub_issue:true,active:true,
 parent_id:'bat_browser_fixture',title:mapped?'Synthetic mapped work':'Synthetic native-only work',
 client_slug:slug,client_name:client,team_key:'VID',team_name:'Video',status:'Todo',status_type:'unstarted',
 due_date:due,assignee_id:'synthetic-editor',assignee_name:'Synthetic Native Editor',native_client_active:true,native_assignee_eligible:true,
 native_metadata:{id,client_slug:slug,team:'video',due_date:due,updated_at:updated,workload_labels_complete:true,workload_labels:[]}};}
function snapshot(){return {ok:true,contract:'workload-native-snapshot-v1',complete:true,count:3,authority:{video:'syncview',graphics:'syncview'},legacy_teams:[],rows:[
 {id:'bat_browser_fixture',source:'native',is_sub_issue:false,active:true,title:'Synthetic browser batch'},row(nativeId,false),row(mappedId,true)],
 plans:[{issue_id:nativeId,storage_issue_id:nativeId,client:slug,plan_date:'2026-09-08'},
 {issue_id:mappedId,storage_issue_id:'synthetic-legacy-plan',client:slug,plan_date:date}]};}
async function main(){const server=await startStreamServer();let browser,run;const groups=[],requests=[],deniedSockets=[];
 const receipt={classification:'ISOLATED_CHROMIUM',source_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 html_sha256:crypto.createHash('sha256').update(source).digest('hex'),started_at:new Date().toISOString(),groups,
 limits:['synthetic authenticated endpoint responses, not actual SQL or serving','real full HTML and DOM; third-party SDK/Chart fixture inherited from boot harness','no live membership census or production writes','no OS sandbox or universal transport certification']};
 let mode='healthy',held=null;
 try{
 browser=await chromium.launch({headless:true,channel:'chromium',args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
 run=await openCase(browser,server,{storage:{local:{syncview_auth_v1:'ok',syncview_nav:'workload',
 syncview_staff_identity_v1:JSON.stringify({key:'synthetic-role-key',role:'smm',member})},session:{syncview_staff_identity_prompted_v1:'1'}}});
 await run.context.routeWebSocket('**/*',socket=>{deniedSockets.push('blocked');socket.close();});
 const reply=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(value)});
 await run.context.route('**/functions/v1/key-verify',async route=>{assert.equal(route.request().method(),'POST');requests.push('key-verify');await reply(route,{ok:true,role:'smm',member});});
 await run.context.route('**/functions/v1/workload-plan',async route=>{
  assert.equal(route.request().method(),'POST');const body=route.request().postDataJSON();
  assert.equal(route.request().headers()['x-syncview-key'],'synthetic-role-key');
  requests.push(body.action);
  if(body.action==='native_snapshot'){
   if(mode==='missing-sql')return reply(route,{ok:false,error:'Synthetic SQL prerequisite unavailable'},503);
   const value=snapshot();if(mode==='held'){mode='healthy';await new Promise(resolve=>held={resolve,value});}
   return reply(route,value);
  }
  assert.equal(body.action,'set','only the exact offered synthetic plan action is writable');
  assert.equal(body.issue_id,mappedId);assert.equal(body.client,client);assert.equal(body.plan_date,'2026-09-09');
  date=body.plan_date;return reply(route,{ok:true,updated:1,plan:{issue_id:mappedId,storage_issue_id:'synthetic-legacy-plan',client:slug,plan_date:date}});
 });
 await run.page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
 const navigation=run.page.goto(server.origin+'/index.html#workload',{waitUntil:'load',timeout:20000});
 const chunk=await server.nextChunk();chunk.release();await navigation;
 await run.page.waitForFunction(()=>typeof wlState!=='undefined'&&!wlState.loading&&wlState.planStatus==='ready',{},{timeout:12000});
 const visible=async id=>{const card=run.page.locator('[data-wl-issue-id="'+id+'"]').first();
  const group=card.locator('xpath=ancestor::details[1]');
  if(await group.count()&&!(await group.evaluate(e=>e.open)))await group.locator('summary').click();
  await card.waitFor({state:'visible',timeout:5000});assert.equal(await card.isVisible(),true,'native card must be visibly rendered after its offered client-group expander');};
 await visible(nativeId);await visible(mappedId);
 assert.equal(await run.page.evaluate(id=>wlState.issueSnapshot.find(r=>r.id===id).nativeId,nativeId),nativeId);
 assert.equal(requests.includes('native_snapshot'),true);groups.push('actual staff boot and native-only DOM card');
 assert.equal(await run.page.evaluate(async id=>wlSetPlanDate(id,'2026-09-09'),mappedId),true);
 await run.page.locator('[data-wl-nav="refresh"]').click();
 await run.page.waitForFunction(()=>!wlState.refreshing&&wlState.planStatus==='ready');
 assert.equal(await run.page.evaluate(id=>wlPlanDate(wlState.allActiveSubs.find(r=>r.id===id)),mappedId),'2026-09-09');
 await visible(mappedId);assert.equal(requests.filter(v=>v==='set').length,1);groups.push('real plan handler ack and forced native alias refresh preserve date');
 mode='missing-sql';const beforeFail=requests.filter(v=>v==='native_snapshot').length;
 await run.page.locator('[data-wl-nav="refresh"]').click();
 await run.page.waitForFunction(()=>!wlState.refreshing&&wlState.planStatus==='stale');
 await visible(nativeId);await visible(mappedId);
 assert.match(await run.page.locator('#wlPlanStatus').innerText(),/last good calendar is still shown/);
 assert.equal(await run.page.evaluate(()=>wlPlanEditingEnabled()),false);
 assert.equal(await run.page.evaluate(()=>wlState.dueAuthorityByIssueId.size),0);
 assert.equal(requests.filter(v=>v==='native_snapshot').length,beforeFail+1);groups.push('missing SQL on actual refresh preserves DOM with warning and holds writes');
 mode='healthy';await run.page.locator('[data-wl-nav="refresh"]').click();
 await run.page.waitForFunction(()=>!wlState.refreshing&&wlState.planStatus==='ready');
 await visible(nativeId);assert.equal(await run.page.evaluate(()=>wlPlanEditingEnabled()),true);
 assert.equal(await run.page.locator('#wlPlanStatus').isVisible(),false);groups.push('actual retry restores ready state and original saved date');
 mode='held';await run.page.evaluate(()=>{window.__workloadSyntheticRefresh=wlRefetchSilent();});
 const deadline=Date.now()+5000;while(!held&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(held,'actual background snapshot must be held');
 due='2026-09-14';updated='2026-09-07T13:00:00Z';
 const signal={schema:'syncview.workload.native-due-receipt.v1',native_committed:true,authority:'syncview',nonce:'synthetic-receipt-one',row:{id:nativeId,client_slug:slug,team:'video',due_date:due,updated_at:updated}};
 await run.page.evaluate(value=>window.dispatchEvent(new StorageEvent('storage',{key:'syncview_workload_native_due_receipt_v1',newValue:JSON.stringify(value),storageArea:localStorage})),signal);
 assert.equal(await run.page.evaluate(()=>_wlPendingNativeDueReceiptByTarget.size),1);
 const beforeRelease=requests.filter(v=>v==='native_snapshot').length;held.resolve();held=null;
 await run.page.waitForFunction(({id,expected})=>_wlPendingNativeDueReceiptByTarget.size===0&&wlState.issueSnapshot.find(r=>r.id===id)?.dueDate===expected,{id:nativeId,expected:due},{timeout:12000});
 assert.ok(requests.filter(v=>v==='native_snapshot').length>beforeRelease,'post-flight receipt must cause a new read');
 await visible(nativeId);groups.push('storage receipt during held background read triggers post-flight refresh');
 assert.deepEqual(run.network.unmocked,[]);assert.deepEqual(run.pageErrors,[]);assert.deepEqual(deniedSockets,[]);
 const providerRequests=run.network.requests.filter(r=>/linear-issues|linear-tweak-comments|workload-linear|api\.linear\.app/.test(r.url));assert.equal(providerRequests.length,0);
 const unexpectedErrors=run.consoleErrors.filter(v=>!v.includes('503 (Service Unavailable)'));assert.deepEqual(unexpectedErrors,[]);
 assert.equal(groups.length,5);receipt.result='PASS';receipt.requests={native_snapshot:requests.filter(v=>v==='native_snapshot').length,set:requests.filter(v=>v==='set').length,unmocked:0,provider:0,websocket:0};
 }catch(error){receipt.result='FAIL';receipt.failure=String(error.message);if(run)receipt.diagnostic=await run.page.evaluate(()=>({
  nav:currentNav,loading:wlState.loading,plan:wlState.planStatus,issues:wlState.issueSnapshot.length,active:wlState.allActiveSubs.length,
  days:[...wlState.calendarByDate.keys()],week:wlState.weekStart,mode:wlState.viewMode,year:wlState.year,month:wlState.month,
  cards:[...document.querySelectorAll('[data-wl-issue-id]')].map(e=>({id:e.getAttribute('data-wl-issue-id'),classes:e.className,style:e.getAttribute('style'),rects:e.getClientRects().length,parent:e.parentElement.className,checkVisibility:e.checkVisibility(),visibility:getComputedStyle(e).visibility,display:getComputedStyle(e).display,rect:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height},ancestors:(()=>{const rows=[];for(let p=e.parentElement;p;p=p.parentElement)rows.push({tag:p.tagName,open:p.open,hidden:p.hidden,class:p.className,visibility:getComputedStyle(p).visibility,display:getComputedStyle(p).display,content:getComputedStyle(p).contentVisibility});return rows;})()})),syntheticTitles:[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/Synthetic (native-only|mapped) work/.test(e.textContent)).map(e=>({tag:e.tagName,class:e.className,visible:!!e.getClientRects().length})),
 })).catch(()=>null);throw error;}
 finally{if(held)held.resolve();if(run)await run.context.close();if(browser)await browser.close();await server.close();receipt.finished_at=new Date().toISOString();
  const target=path.join(root,'.codex-tmp/workload-chromium');fs.mkdirSync(target,{recursive:true});
  const bytes=JSON.stringify(receipt,null,2);fs.writeFileSync(path.join(target,receipt.started_at.replace(/[:.]/g,'-')+'.json'),bytes);fs.writeFileSync(path.join(target,'receipt.json'),bytes);}
 console.log(JSON.stringify(receipt));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
