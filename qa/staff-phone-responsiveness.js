'use strict';
// Native app, touch input and fictional transports only. Cold useful paint and
// touch-to-sheet paint use browser timestamps, not driver polling durations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const staff=require('../docs/syncview-design/tests/staff-phone-browser');
const {seedStaffGate}=require('./staff-gate-seed');
const {SCENARIOS}=require('./finch-phone/scenarios');
const {open,dateOnlyClock}=require('./finch-phone/harness');
const {prepare}=require('./staff-phone-final-pass');
const arg=(k,d)=>process.argv.find(x=>x.startsWith('--'+k+'='))?.slice(k.length+3)||d;
const baseline=process.argv.includes('--baseline'),speed=process.argv.includes('--speed');
const out=arg('out',''),only=new RegExp(arg('only','.*'));
const widths=arg('widths','390,430').split(',').map(Number);
const rows=[],failures=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const screens=[
 {name:'Calendar',route:'calendar',ready:'#calView .cal-card, #calView .kcard'},
 {name:'Samples',route:'sample-reviews',ready:'#sxrView .cal-card, #sxrView .kcard'},
 {name:'Workload',fixture:'workload-week',ready:'.workload-overview-row:not(.is-skeleton)'},
 {name:'SyncLinear',fixture:'linear-list',ready:'.prod-row'},
 {name:'Today',route:'today',ready:'.tdy-rings button, .tdy-win'},
 {name:'Templates',route:'templates',ready:'.tpl-index, .tpl-card, #tplSearchInput'},
 {name:'Filming Plans',route:'filming-plans',ready:'.fp-row, .fp-empty'},
 {name:'Submit',route:'linear',ready:'#linearClientSearch'},
 {name:'Upload',fixture:'tiktok-client-ready',ready:'#tkFormCol'},
 {name:'Analytics',fixture:'analytics-overview',ready:'.client-card, .card-client-link'},
 {name:'Reviewer',route:'kasper',ready:'.kasper-subtabs'},
 {name:'Time Off',route:'time-off',ready:'.pto-balance-card'},
];
async function instrument(page,context,screen){
 if(speed){
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750,connectionType:'cellular4g'});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  // CDP throttles real loopback assets. Fulfilled fictional backend replies
  // also get one 4G round trip; they never reach an external service.
  await context.route(/\.supabase\.co\/(rest|functions)\/v1\//,async route=>{await sleep(150);await route.fallback();});
 }
 await context.addInitScript(({ready})=>{
  if(!performance.now.toString().includes('[native code]')||!requestAnimationFrame.toString().includes('[native code]'))throw new Error('Responsiveness measurements require native performance and animation-frame clocks');
  const perf=window.__phonePerf={useful:null,taps:[],shifts:[],longTasks:[]};
  new PerformanceObserver(list=>list.getEntries().forEach(e=>perf.shifts.push({at:e.startTime,value:e.value,recentInput:e.hadRecentInput}))).observe({type:'layout-shift',buffered:true});
  new PerformanceObserver(list=>list.getEntries().forEach(e=>perf.longTasks.push({at:e.startTime,duration:e.duration}))).observe({type:'longtask',buffered:true});
  function useful(){
   const node=[...document.querySelectorAll(ready)].find(n=>n.checkVisibility({checkVisibilityCSS:true}));
   if(node&&document.fonts.status==='loaded'){perf.useful=performance.now();return;}
   requestAnimationFrame(useful);
  }
  requestAnimationFrame(useful);
  document.addEventListener('pointerup',()=>{
   if(!window.__measureNextTap)return;window.__measureNextTap=false;
   const start=performance.now();function painted(){
    const target=window.__tapTarget||'dialog[open],.cal-fld-status-menu.open,.kasper-more.open';
    const open=[...document.querySelectorAll(target)].some(n=>n.checkVisibility({checkVisibilityCSS:true}));
    if(!open&&performance.now()-start<1000){requestAnimationFrame(painted);return;}
    perf.taps.push({ms:performance.now()-start,opened:open});
   }requestAnimationFrame(painted);
  },true);
 },{ready:screen.ready});
}
async function boot(screen,width,theme){
 if(screen.fixture){
  const f=SCENARIOS.find(s=>s.id===screen.fixture);assert(f,'Fixture missing: '+screen.fixture);
  return open({...f.open,realTiming:true,gzip:speed,sourceRoot:arg('before-root',undefined),width,height:width===430?932:844,theme,dsf:1,beforeNavigate:(p,c)=>instrument(p,c,screen)});
 }
 const server=await staff.serve({gzip:speed}),browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width,height:width===430?932:844},hasTouch:true,isMobile:true,colorScheme:theme});
 await dateOnlyClock(context,'2026-10-12T15:00:00.000Z');
 await staff.installBackend(context);await seedStaffGate(context);
 if(screen.route==='time-off'){
  const service=await require('./pto-lifecycle/mock-backend').createMockBackend();
  await context.route('**/rest/v1/syncview_runtime_flags?**',route=>{
   if(!new URL(route.request().url()).search.includes('pto_v1'))return route.fallback();
   return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:[{key:'pto_v1',value:{mode:'on'}}]});
  });
  await context.route('**/functions/v1/pto**',route=>route.fulfill({status:route.request().method()==='GET'?200:403,headers:{'access-control-allow-origin':'*'},json:route.request().method()==='GET'?service.overview('admin').body:{ok:false,error:'fictional_read_only'}}));
 }
 await context.addInitScript(t=>localStorage.setItem('syncview_theme',t),theme);
 const row={id:'responsive_fixture',client:'sample-one',name:'A calmer start to the day',status:'In Progress',video_status:'In Progress',graphic_status:'In Progress',caption_status:'In Progress',caption:'A fictional caption. '.repeat(12),scheduled_date:new Date().toISOString().slice(0,10),video_deliverable_id:'00000000-0000-4000-8000-000000000001',graphic_deliverable_id:'00000000-0000-4000-8000-000000000002'};
 for(const table of ['calendar_posts','sample_reviews'])await context.route('**/rest/v1/'+table+'?**',r=>r.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:[row]}));
 const page=await context.newPage();await instrument(page,context,screen);
 await page.goto('http://127.0.0.1:'+server.address().port+'/#'+screen.route,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof navTo==='function');
 await page.evaluate(names=>{WL_CLIENT_NAMES.splice(0,WL_CLIENT_NAMES.length,...names);WL_CLIENT_CANONICAL.clear();names.forEach(n=>WL_CLIENT_CANONICAL.set(wlNormalizeClient(n),n));},staff.NAMES);
 await page.evaluate(route=>navTo(route),screen.route);
 if(screen.route==='calendar')await page.evaluate(()=>{_calSetClient('Sample Client One');calState.view='organizer';_calRenderShell();loadCalendarPosts();});
 if(screen.route==='sample-reviews')await page.evaluate(()=>{sxrState.client='Sample Client One';sxrState.view='organizer';_sxrRenderShell();loadSxrCards();});
 return{page,context,close:async()=>{await context.close();await browser.close();await new Promise(r=>server.close(r));}};
}
async function capture(page,name){
 if(!out)return;fs.mkdirSync(out,{recursive:true});
 // The existing feature label names a person. Public evidence uses its role.
 await page.evaluate(()=>{
  const nav=document.getElementById('navKasper');
  const label=window.__phoneFixtureReviewerLabel||nav?.textContent.replace(/[0-9]/g,'').replace(/\s+/g,' ').trim();
  if(!label)return;window.__phoneFixtureReviewerLabel=label;
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(w.nextNode()){const n=w.currentNode;if(!n.parentElement.closest('script,style')&&n.textContent.includes(label))n.textContent=n.textContent.replaceAll(label,'Reviewer');}
 });
 await page.screenshot({path:path.join(out,name+'.png'),animations:'disabled',fullPage:false});
}
async function menuJourney(page,label){
 for(const kind of ['more','tabs'])for(let round=0;round<2;round++){
  const selector=kind==='more'?'.pocket-staff-more-btn,#fphMoreBtn,[data-staff-menu=more],[data-kasper-more-trigger]':'.pocket-staff-tabs-btn,#fphTabsBtn,[data-staff-menu=tabs],.pocket-admin-heading button[aria-haspopup=dialog]';
  const trigger=page.locator(selector).filter({visible:true}).first();
  await page.evaluate(()=>{window.__tapTarget=null;window.__measureNextTap=true;});await trigger.tap();
  const sheet=page.locator('dialog[open],.kasper-more.open .kasper-more-menu').filter({visible:true}).first();await sheet.waitFor();
  await page.waitForTimeout(60);
  const box=await sheet.boundingBox();assert(box&&box.x>=-1&&box.x+box.width<=await page.evaluate(()=>innerWidth)+1,label+' sheet clipped');
  await sheet.tap({position:{x:8,y:8}});assert(await sheet.isVisible(),label+' inside tap closed sheet');
  if(round===0)await capture(page,label+'-'+kind);
  const close=sheet.getByRole('button',{name:/^Close\b/}).filter({visible:true}).first();
  if(kind==='more'&&await sheet.evaluate(n=>n.matches('.kasper-more-menu'))){
   rows.push({rule:'legacy More has a labelled touch close',label,passed:await close.count()===1});
   if(!baseline)assert.equal(await close.count(),1,label+' More lacks a touch close');
   const readable=await sheet.locator('.kasper-more-heading,.kasper-more-item:not(:disabled):not([aria-disabled=true])').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility({checkVisibilityCSS:true})).every(n=>{const s=getComputedStyle(n);return Number(s.opacity)===1&&parseFloat(s.fontSize)>=(n.matches('.kasper-more-heading')?12:15);}));
   rows.push({rule:'legacy More enabled rows and labels are readable',label,passed:readable});
   if(!baseline)assert(readable,label+' enabled More rows appear faded');
  }
  if(round===0&&await close.count())await close.tap();else await page.keyboard.press('Escape');
  await sheet.waitFor({state:'hidden'});
 }
}
async function calendarRules(page,screen,label,width){
 const samples=screen.name==='Samples';await prepare(page,samples?'samples-sheet':'calendar-sheet');
 const setAll=page.locator('.cal-fld-setall').first();
 for(let i=0;i<2;i++){
  await setAll.tap();await page.locator('.cal-fld-status-menu.open').waitFor();await page.waitForTimeout(60);
  await capture(page,label+'-set-all');
  await page.setViewportSize({width,height:600});await page.waitForTimeout(70);
  const survived=await page.locator('.cal-fld-status-menu.open').count();
  rows.push({rule:'status menu survives phone height resize',screen:screen.name,label,passed:survived===1});
  if(!baseline)assert.equal(survived,1,label+' status menu flickered closed on height resize');
  if(survived){await page.locator('.cal-fld-setall-menu-head').tap();assert.equal(await page.locator('.cal-fld-status-menu.open').count(),1,'Inside tap dismissed status sheet');}
  await page.keyboard.press('Escape');await page.setViewportSize({width,height:width===430?932:844});
 }
 // A manual revalidation must never replace useful phone cards with skeletons.
 await page.route('**/rest/v1/'+(samples?'sample_reviews':'calendar_posts')+'?**',async route=>{await sleep(450);await route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:await page.evaluate(samples=>(samples?sxrState:calState).posts,samples)});});
 const kept=await page.evaluate(samples=>{const state=samples?sxrState:calState;window.__refreshDone=false;const root=document.getElementById(samples?'sxrBody':'calBody');const card=root.querySelector('.cal-card');const draft=card?.querySelector('textarea');if(draft)draft.value='A draft kept while refreshing';(samples?loadSxrCards:loadCalendarPosts)({skipCache:true}).finally(()=>window.__refreshDone=true);return{kept:!!root.querySelector('.cal-card'),draft:!!draft&&draft.isConnected};},samples);
 rows.push({rule:'manual refresh retains cards and draft',screen:screen.name,label,passed:kept.kept&&kept.draft});
 if(!baseline)assert(kept.kept&&kept.draft,label+' refresh blanked useful content');
 await page.waitForFunction(()=>window.__refreshDone);await capture(page,label+'-refresh');
 const table=samples?'sample_reviews':'calendar_posts';
 await page.route('**/rest/v1/'+table+'?**',route=>route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},json:{message:'Fictional refresh failure'}}));
 await page.evaluate(samples=>{window.__refreshDone=false;(samples?loadSxrCards:loadCalendarPosts)({background:true,skipCache:true}).finally(()=>window.__refreshDone=true);},samples);
 await page.waitForFunction(()=>window.__refreshDone);
 const retry=page.locator(samples?'#sxrStaleNotice':'#calStaleNotice');await retry.waitFor({state:'visible'});
 const hit=await retry.boundingBox();
 rows.push({rule:'refresh recovery has a 44px labelled touch target',label,passed:hit.width>=44&&hit.height>=44&&await retry.getAttribute('role')==='button',width:hit.width,height:hit.height});
 if(!baseline)assert(hit.width>=44&&hit.height>=44&&await retry.getAttribute('role')==='button',label+' retry is a tiny unlabelled control');
 await capture(page,label+'-refresh-error');
 await page.route('**/rest/v1/'+table+'?**',async route=>{await sleep(450);await route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:await page.evaluate(samples=>(samples?sxrState:calState).posts,samples)});});
 await retry.tap();
 const retryKept=await page.locator(samples?'#sxrBody .cal-card':'#calBody .cal-card').count();
 rows.push({rule:'native Retry tap keeps useful cards',label,passed:retryKept>0});
 if(!baseline)assert(retryKept>0,label+' first Retry tap blanked the cards');
 await page.waitForFunction(samples=>document.getElementById(samples?'sxrStaleNotice':'calStaleNotice')?.hidden,samples);
 // Typing/layout changes must not re-scan every card's controls on each key.
 await prepare(page,samples?'samples-sheet':'calendar-sheet');
 const scans=await page.evaluate(async()=>{
  const original=document.querySelectorAll;let scans=0;
  document.querySelectorAll=function(q){if(q==='#calView .cal-card, #sxrView .cal-card')scans++;return original.call(this,q);};
  const ta=document.querySelector('#calView textarea.cal-cap-ta,#sxrView textarea.cal-cap-ta')||document.querySelector('.cal-card textarea');
  for(let i=0;i<5;i++){ta.style.height=(200+i)+'px';await new Promise(r=>setTimeout(r,0));}
  document.querySelectorAll=original;return scans;
 });
 rows.push({rule:'field layout avoids whole card scans',screen:screen.name,label,passed:scans===0,scans});
 if(!baseline)assert.equal(scans,0,label+' field changes scan every card');
 if(samples){assert.equal(await page.locator('#sxrView .cal-cap-toggle').count(),0,'Samples retains its two-part workflow without caption controls');return;}
 const captionScans=await page.evaluate(async()=>{
  const original=document.querySelectorAll;let scans=0;
  document.querySelectorAll=function(q){if(q==='#calView .cal-card, #sxrView .cal-card')scans++;return original.call(this,q);};
  const toggle=document.querySelector('#calView .cal-cap-toggle,#sxrView .cal-cap-toggle');
  toggle.click();await new Promise(r=>setTimeout(r,50));
  const label=toggle.querySelector('.cal-cap-toggle-txt').textContent;
  document.querySelectorAll=original;return{scans,label,expanded:toggle.getAttribute('aria-expanded')};
 });
 rows.push({rule:'caption disclosure updates locally',label,passed:captionScans.scans===0&&captionScans.expanded==='true'&&captionScans.label==='Show less',...captionScans});
 if(!baseline)assert(captionScans.scans===0&&captionScans.expanded==='true'&&captionScans.label==='Show less',label+' disclosure rescanned all cards or lost its label');
 await page.evaluate(()=>{
  const node=document.createElement('div');node.id='phone-explanation-probe';
  node.innerHTML=_svExplainLabel('phone-probe','Caption help','A fictional explanation that must remain available on touch.');
  document.querySelector('#calView .cal-card').append(node);
 });
 await page.locator('#phone-explanation-probe [data-sv-explain]').tap();
 const explanation=page.locator('#globalTooltip[data-label-explainer=true]');await explanation.waitFor({state:'visible'});
 const box=await explanation.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1,'Phone explanation escaped the viewport');
 await page.keyboard.press('Escape');await explanation.waitFor({state:'hidden'});
 await page.locator('#phone-explanation-probe').evaluate(n=>n.remove());
}
async function regularAction(page,screen){
 if(!['Calendar','Samples','SyncLinear'].includes(screen.name))return null;
 let trigger,target;
 if(screen.name==='Calendar'){
  await prepare(page,'calendar-sheet');
  await page.evaluate(()=>{const row=calState.posts[0];calState.posts=Array.from({length:20},(_,i)=>({...row,id:'disclosure-fixture-'+i,caption:'A longer fictional caption for a phone. '.repeat(25)}));_calRenderBody();});
  await page.waitForTimeout(150);
  await page.evaluate(()=>{
   window.__titleHeightWrites=0;
   window.__titleWatch=new MutationObserver(records=>{window.__titleHeightWrites+=records.length;});
   document.querySelectorAll('textarea[data-pocket-title]').forEach(n=>window.__titleWatch.observe(n,{attributes:true,attributeFilter:['style']}));
  });
  trigger=page.locator('#calView .cal-cap-toggle').first();target='#calView .cal-cap-toggle[aria-expanded="true"]';
 }else if(screen.name==='Samples'){
  await prepare(page,'samples-sheet');trigger=page.locator('#sxrView .cal-fld-setall').first();target='.cal-fld-status-menu.open';
 }else{trigger=page.locator('.prod-row .prod-status').first();target='.prod-pop';}
 await page.evaluate(target=>{window.__tapTarget=target;window.__measureNextTap=true;},target);
 const before=await page.evaluate(()=>window.__phonePerf.taps.length);
 let profiler;
 if(process.env.PHONE_PROFILE){profiler=await page.context().newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
 await trigger.tap();await page.waitForFunction(before=>window.__phonePerf.taps.length>before,before);
 if(profiler){const result=await profiler.send('Profiler.stop');fs.writeFileSync(path.join(process.env.PHONE_PROFILE,screen.name+'.json'),JSON.stringify(result));}
 const tap=await page.evaluate(()=>window.__phonePerf.taps.at(-1));assert(tap.opened,'Regular action ignored its first tap');
 if(screen.name==='Calendar'){
  const writes=await page.evaluate(()=>{window.__titleWatch.disconnect();return window.__titleHeightWrites;});
  rows.push({rule:'caption expansion does not re-size unchanged titles',passed:writes===0,writes});
  if(!baseline)assert.equal(writes,0,'Caption tap re-sized unchanged titles');
  const invisibleTip=await page.locator('#globalTooltip:not([data-label-explainer=true])').count();
  rows.push({rule:'ordinary phone action does not build hidden hover tooltip',passed:invisibleTip===0,invisibleTip});
  if(!baseline)assert.equal(invisibleTip,0,'Caption tap built an invisible hover tooltip');
 }
 if(screen.name!=='Calendar')await page.keyboard.press('Escape');
 return{action:screen.name==='Calendar'?'Expand caption in a 20-card list':screen.name==='Samples'?'Open Set all':'Open native status',ms:Math.round(tap.ms)};
}
async function workloadRules(page,label){
 // Put seven fictional video tasks on one day through the native state model.
 // The regular fixture has no overloaded day and missed the cramped badge.
 await page.evaluate(()=>{
  const original=wlState.planned.find(s=>wlTeamBucket(s.teamKey,s.teamName)==='video');
  if(!original)throw new Error('No native video fixture');
  const tasks=Array.from({length:7},(_,i)=>({...original,id:'overload-fixture-'+i,title:'Fictional planned task '+(i+1)}));
  const day=wlState.calendarByDate.keys().next().value;
  wlState.calendarByDate.set(day,tasks);renderWorkloadAll();
 });
 const badge=page.locator('.workload-day-card-total.over-capacity').first();await badge.waitFor();
 const geometry=await badge.evaluate(n=>{const r=n.getBoundingClientRect();return {width:r.width,height:r.height,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,text:n.textContent.trim(),wrap:getComputedStyle(n).whiteSpace};});
 rows.push({rule:'overloaded editor count stays on one line',label,passed:geometry.wrap==='nowrap'&&geometry.height<=45&&geometry.scrollWidth<=geometry.clientWidth,...geometry});
 if(!baseline)assert(geometry.wrap==='nowrap'&&geometry.height<=45&&geometry.scrollWidth<=geometry.clientWidth,label+' overload badge cramped');
 await badge.scrollIntoViewIfNeeded();
 await capture(page,label+'-overload');
 await badge.tap();const popup=page.locator('.wl-popover,.workload-popover').filter({visible:true}).first();await popup.waitFor();
 await page.keyboard.press('Escape');
}
async function tabRules(page,screen,label){
 const selectors={Calendar:'.cal-view-toggle',Samples:'.cal-view-toggle',Workload:'.workload-pills',SyncLinear:'.prod-tabs',Today:'.tdy-vw',Upload:'.tk-platform-switch',Reviewer:'.kasper-wrap[data-pocket-reviewer] > .kasper-subtabs'};
 if(!selectors[screen.name])return;
 const bars=await page.locator(selectors[screen.name]).filter({visible:true}).evaluateAll(nodes=>nodes.map(node=>{
  const s=getComputedStyle(node),buttons=[...node.children].filter(n=>n.matches('button')&&!n.hidden);
  return {radius:s.borderRadius,border:s.borderTopWidth,gap:s.gap,padding:s.paddingTop,buttons:buttons.map(n=>{const t=getComputedStyle(n),r=n.getBoundingClientRect();return {radius:t.borderRadius,height:r.height,font:t.fontSize,align:t.justifyContent};})};
 }));
 const consistent=bars.length>0&&bars.every(b=>b.radius==='15px'&&b.border==='0px'&&b.gap==='3px'&&b.padding==='4px'&&b.buttons.every(n=>n.radius==='11px'&&n.height>=44&&n.align==='center'));
 rows.push({rule:'shared reviewer-style tab bars',screen:screen.name,label,passed:consistent,bars});
 if(!baseline)assert(consistent,label+' inconsistent tab bar');
}
async function main(){
 for(const screen of screens.filter(s=>only.test(s.name)))for(const width of widths)for(const theme of ['light','dark']){
  const label=screen.name.replaceAll(' ','-')+'-'+theme+'-'+width;let h;
  try{
   console.log('start '+label);staff.resetScenario();h=await boot(screen,width,theme);const page=h.page;
   await page.waitForFunction(()=>Number.isFinite(window.__phonePerf?.useful),{},{timeout:45000});
   await menuJourney(page,label);
   await page.waitForFunction(()=>window.__phonePerf.taps.length===4);
   const perf=await page.evaluate(()=>window.__phonePerf);
   assert(perf.taps.length===4&&perf.taps.every(t=>t.opened),label+' a menu ignored its first tap');
   if(!baseline)assert(perf.taps.every(t=>t.ms<=250),label+' tap-to-sheet paint exceeds 250ms');
   const action=await regularAction(page,screen);
   rows.push({screen:screen.name,width,theme,usefulMs:Math.round(perf.useful),tapMs:Math.round(Math.max(...perf.taps.map(t=>t.ms),action?.ms||0)),regularAction:action,cls:perf.shifts.filter(s=>!s.recentInput).reduce((n,s)=>n+s.value,0),longTasks:perf.longTasks.length});
   if(!baseline&&action)assert(action.ms<=250,label+' regular action '+action.action+' took '+action.ms+'ms (budget 250ms)');
   await tabRules(page,screen,label);
   if(['Calendar','Samples'].includes(screen.name))await calendarRules(page,screen,label,width);
   if(screen.name==='Workload')await workloadRules(page,label);
   await capture(page,label+'-screen');
   console.log('ok '+label+' useful='+Math.round(perf.useful)+'ms tap='+Math.round(Math.max(...perf.taps.map(t=>t.ms)))+'ms');
  }catch(e){failures.push(label+': '+e.message);console.error('FAIL '+failures.at(-1));}
  finally{if(h)await h.close();}
 }
 if(out)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({profile:speed?{downloadBytesPerSecond:200000,uploadBytesPerSecond:93750,rttMs:150,cpuSlowdown:4,backend:'fictional replies with 150ms RTT; CDP throttles gzip-compressed loopback assets',cache:'disabled'}:'unthrottled touch regression',baseline,rows,failures},null,2)+'\n');
 console.log('STAFF_PHONE_RESPONSIVENESS: '+rows.length+' measurements; '+failures.length+' failures; fictional transports only');
 if(failures.length&&!baseline)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
