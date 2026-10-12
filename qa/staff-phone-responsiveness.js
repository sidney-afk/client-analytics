'use strict';
// Native app, touch input and fictional transports only. Cold useful paint and
// touch-to-sheet paint use browser timestamps, not driver polling durations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const staff=require('../docs/syncview-design/tests/staff-phone-browser');
const {seedStaffGate}=require('./staff-gate-seed');
const {SCENARIOS}=require('./finch-phone/scenarios');
const {open}=require('./finch-phone/harness');
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
 {name:'Time Off',route:'time-off',ready:'.pto-title'},
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
    const open=[...document.querySelectorAll('dialog[open],.cal-fld-status-menu.open,.kasper-more.open')].some(n=>n.checkVisibility({checkVisibilityCSS:true}));
    if(!open&&performance.now()-start<1000){requestAnimationFrame(painted);return;}
    perf.taps.push({ms:performance.now()-start,opened:open});
   }requestAnimationFrame(painted);
  },true);
 },{ready:screen.ready});
}
async function boot(screen,width,theme){
 if(screen.fixture){
  const f=SCENARIOS.find(s=>s.id===screen.fixture);assert(f,'Fixture missing: '+screen.fixture);
  return open({...f.open,sourceRoot:arg('before-root',undefined),width,height:width===430?932:844,theme,dsf:1,beforeNavigate:(p,c)=>instrument(p,c,screen)});
 }
 const server=await staff.serve(),browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width,height:width===430?932:844},hasTouch:true,isMobile:true,colorScheme:theme});
 await staff.installBackend(context);await seedStaffGate(context);
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
  const label=document.getElementById('navKasper')?.textContent.trim();
  if(!label)return;const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(w.nextNode()){const n=w.currentNode;if(!n.parentElement.closest('script,style')&&n.textContent.includes(label))n.textContent=n.textContent.replaceAll(label,'Reviewer');}
 });
 await page.screenshot({path:path.join(out,name+'.png'),animations:'disabled',fullPage:false});
}
async function menuJourney(page,label){
 for(const kind of ['more','tabs'])for(let round=0;round<2;round++){
  const selector=kind==='more'?'.pocket-staff-more-btn,#fphMoreBtn,[data-staff-menu=more],[data-kasper-more-trigger]':'.pocket-staff-tabs-btn,#fphTabsBtn,[data-staff-menu=tabs],.pocket-admin-heading button[aria-haspopup=dialog]';
  const trigger=page.locator(selector).filter({visible:true}).first();
  await page.evaluate(()=>window.__measureNextTap=true);await trigger.tap();
  const sheet=page.locator('dialog[open],.kasper-more.open').filter({visible:true}).first();await sheet.waitFor();
  await page.waitForTimeout(60);
  const box=await sheet.boundingBox();assert(box&&box.x>=-1&&box.x+box.width<=await page.evaluate(()=>innerWidth)+1,label+' sheet clipped');
  await sheet.tap({position:{x:8,y:8}});assert(await sheet.isVisible(),label+' inside tap closed sheet');
  if(round===0)await capture(page,label+'-'+kind);
  await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});
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
   rows.push({screen:screen.name,width,theme,usefulMs:Math.round(perf.useful),tapMs:Math.round(Math.max(...perf.taps.map(t=>t.ms))),cls:perf.shifts.filter(s=>!s.recentInput).reduce((n,s)=>n+s.value,0),longTasks:perf.longTasks.length});
   if(['Calendar','Samples'].includes(screen.name))await calendarRules(page,screen,label,width);
   await capture(page,label+'-screen');
   console.log('ok '+label+' useful='+Math.round(perf.useful)+'ms tap='+Math.round(Math.max(...perf.taps.map(t=>t.ms)))+'ms');
  }catch(e){failures.push(label+': '+e.message);console.error('FAIL '+failures.at(-1));}
  finally{if(h)await h.close();}
 }
 if(out)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({profile:speed?{downloadBytesPerSecond:200000,uploadBytesPerSecond:93750,rttMs:150,cpuSlowdown:4,backend:'fictional replies with 150ms RTT; CDP throttles real loopback assets',cache:'disabled'}:'unthrottled touch regression',baseline,rows,failures},null,2)+'\n');
 console.log('STAFF_PHONE_RESPONSIVENESS: '+rows.length+' measurements; '+failures.length+' failures; fictional transports only');
 if(failures.length&&!baseline)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
