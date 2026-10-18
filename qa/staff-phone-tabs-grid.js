'use strict';
// Native staff navigation; all application requests are intercepted fiction.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const staff=require('../docs/syncview-design/tests/staff-phone-browser');
const {seedStaffGate}=require('./staff-gate-seed');
const arg=(name,fallback)=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3)||fallback;
const baseline=process.argv.includes('--baseline'),out=arg('out','');
const widths=arg('widths','390,430').split(',').map(Number);
const selected=new RegExp(arg('only','.*'));
const routes=['today','calendar','sample-reviews','templates','filming-plans','tiktok-upload','instagram','home','workload','production','linear','kasper','time-off','messages'];
const admin=['filming','editors','sales-intake','hiring-process','onboarding','client-credentials','clients','save-problems','ad-performance','quiz-leads','time-off'];
const rows=[],failures=[];
const trigger='.pocket-staff-tabs-btn,#fphTabsBtn,[data-staff-menu=tabs],.pocket-admin-heading button[aria-haspopup=dialog]';
async function main(){
 if(out)fs.mkdirSync(out,{recursive:true});
 const server=await staff.serve(),browser=await chromium.launch({headless:true});
 try {for(const width of widths)for(const theme of ['light','dark']){
  staff.resetScenario();const context=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true,colorScheme:theme});
  await staff.installBackend(context);await seedStaffGate(context);
  const pto=await require('./pto-lifecycle/mock-backend').createMockBackend();
  await context.route('**/rest/v1/syncview_runtime_flags?**',route=>new URL(route.request().url()).search.includes('pto_v1')?route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:[{key:'pto_v1',value:{mode:'on'}}]}):route.fallback());
  await context.route('**/functions/v1/pto**',route=>route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:pto.overview('admin').body}));
  await context.addInitScript(t=>localStorage.setItem('syncview_theme',t),theme);
  const page=await context.newPage();
  try {
   await page.goto('http://127.0.0.1:'+server.address().port+'/#today');await page.waitForFunction(()=>typeof navTo==='function');
   for(const route of [...routes,...admin.map(tab=>'admin:'+tab)].filter(x=>selected.test(x))){
    await page.evaluate(route=>navTo(route.startsWith('admin:')?'kasper':route==='instagram'?'tiktok-upload':route),route);await page.waitForTimeout(500);
    if(route.startsWith('admin:')){await page.evaluate(tab=>_kasperGotoTab(tab),route.slice(6));await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>_kasperState.tab),route.slice(6),'Requested admin surface was not reached');}
    if(route==='instagram')await page.locator('#tkPlatInstagram').tap();
    const button=page.locator(trigger).filter({visible:true}).first();await button.waitFor();
    for(let round=0;round<2;round++){
     await button.tap();const sheet=page.locator('dialog[open]').filter({visible:true}).first();await sheet.waitFor();
     await page.waitForTimeout(300);
     const state=await sheet.evaluate(d=>{
      const grid=d.querySelector('.sv-phone-tabs-grid'),head=d.querySelector('.sv-phone-tabs-head');
      const links=grid?[...grid.querySelectorAll('[data-nav]')]:[];
      const native=[...document.querySelectorAll('#headerNav > .header-nav-btn, #navMessages')].filter(n=>!n.hidden&&n.style.display!=='none'&&!(n.id==='navHome'&&!document.documentElement.classList.contains('sv-analytics-on')));/* Analytics is hidden by a stylesheet rule while analytics_hidden hides it (188), so the sheet leaves it out too */
      const rect=d.getBoundingClientRect(),close=head?.querySelector('button');
      const message=links.find(n=>n.dataset.nav==='navMessages'),label=message?.querySelector('.sv-phone-tab-label');
      return {messageLabel:!message||!!(label&&label.getBoundingClientRect().width>1&&getComputedStyle(label).clip==='auto'&&label.textContent==='Messages'),common:!!grid&&!!head,ids:links.map(n=>n.dataset.nav),expected:native.map(n=>n.id),current:links.filter(n=>n.getAttribute('aria-current')==='page').map(n=>n.dataset.nav),expectedCurrent:native.filter(n=>n.classList.contains('active')).map(n=>n.id),icons:links.every(n=>n.querySelector('.header-nav-ico,svg')?.outerHTML===document.getElementById(n.dataset.nav)?.querySelector('.header-nav-ico,svg')?.outerHTML),small:links.filter(n=>{const r=n.getBoundingClientRect();return r.width<44||r.height<44}).length,columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:0,gap:grid?getComputedStyle(grid).gap:'',close:close?.textContent,headSize:head?getComputedStyle(head.querySelector('strong,h2')).fontSize:'',closeSize:close?getComputedStyle(close).borderRadius:'',closePadding:close?getComputedStyle(close).padding:'',closeHeight:close?.getBoundingClientRect().height,backdrop:getComputedStyle(d,'::backdrop').backgroundColor,x:rect.x,right:rect.right,view:innerWidth,page:document.documentElement.scrollWidth};
     });
     if(!baseline){
      assert(state.messageLabel,route+' Messages needs a visible label alongside icon/count');
      assert(state.common,route+' does not use the common grid/header');assert.deepEqual(state.ids,state.expected,route+' changed native order/visibility');assert.deepEqual(state.current,state.expectedCurrent,route+' wrong current tab');
      assert(state.icons&&state.small===0&&state.columns===2&&state.gap==='8px'&&state.close==='Close',route+' inconsistent icons, spacing or Close');
      assert(state.headSize==='21px'&&state.closeSize==='12px'&&state.closePadding==='0px 12px'&&state.closeHeight>=44&&state.backdrop!=='rgba(0, 0, 0, 0)',route+' inconsistent header, Close or backdrop');
      assert(state.x>=0&&state.right<=state.view+1&&state.page<=state.view+1,route+' sideways overflow');
     }
     rows.push({route,width,theme,round,...state});
     await sheet.tap({position:{x:4,y:4}});assert(await sheet.isVisible(),route+' inside tap dismissed Tabs');
     if(out&&round===0){
      await page.evaluate(()=>{const name=window.__staffPhoneReviewerName||(window.__staffPhoneReviewerName=document.getElementById('navKasper')?.textContent.trim());if(!name)return;const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walk.nextNode()){const n=walk.currentNode;if(!n.parentElement.closest('script,style')&&n.textContent.includes(name))n.textContent=n.textContent.replaceAll(name,'Reviewer');}getSelection()?.removeAllRanges();});
      await page.waitForTimeout(100);
      fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,route.replace(':','-')+'-'+theme+'-'+width+'.png'),fullPage:false,animations:'disabled'});
     }
     const close=sheet.getByRole('button',{name:/^Close\b/}).first();await close.tap();await sheet.waitFor({state:'hidden'});
     assert(await button.evaluate(n=>document.activeElement===n),route+' Close lost focus');
    }
    if(!baseline&&route==='today'){
     await page.evaluate(()=>{window.__phoneNavCalls=0;document.getElementById('navCalendar').addEventListener('click',()=>window.__phoneNavCalls++);});
     await button.tap();await page.locator('dialog[open] [data-nav=navCalendar]').tap();
     await page.waitForFunction(()=>document.getElementById('navCalendar').classList.contains('active'));
     assert.equal(await page.evaluate(()=>window.__phoneNavCalls),1,'Grid dispatched the native destination more than once');
     await page.evaluate(()=>navTo('today'));await page.waitForTimeout(300);
    }
    if(!baseline&&['today','calendar','sample-reviews','workload','kasper'].includes(route)){
     await page.evaluate(()=>{document.getElementById('navSxr').hidden=true;document.getElementById('navFilmingPlans').disabled=true;});
     await button.tap();const sheet=page.locator('dialog[open]').first();
     assert.equal(await sheet.locator('[data-nav=navSxr]').count(),0,'Hidden permission became visible');
     // Force the probe past Playwright's enabled check; the app must itself
     // refuse a physical tap on this intentionally disabled fixture link.
     await sheet.locator('[data-nav=navFilmingPlans]').tap({force:true});assert(await sheet.isVisible(),'Disabled destination changed or dismissed the menu');
     await sheet.getByRole('button',{name:'Close Tabs'}).tap();
     await page.evaluate(()=>{document.getElementById('navSxr').hidden=false;document.getElementById('navFilmingPlans').disabled=false;});
    }
   }
  }catch(e){failures.push(width+' '+theme+': '+e.message);console.error('FAIL '+failures.at(-1));}finally{await context.close();}
 }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
 if(out)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({baseline,rows,failures},null,2)+'\n');
 console.log('STAFF_PHONE_TABS_GRID: '+rows.length+' twice-opened states; '+failures.length+' failures; native icons/order/current tab; fictional transports only');
 if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
