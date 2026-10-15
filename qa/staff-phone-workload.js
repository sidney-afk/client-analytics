'use strict';
require('../test/helpers/single-file-index');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {open}=require('./finch-phone/harness'),{SCENARIOS}=require('./finch-phone/scenarios');
const captures=require('./client-phone/native-captures'),rules=require('./staff-phone-rule-checks');
const arg=(name,fallback)=>process.argv.find(s=>s.startsWith('--'+name+'='))?.split('=').slice(1).join('=')||fallback;
const widths=arg('widths','390,430').split(',').map(Number),out=arg('out','');
const receipts=[];
async function shot(page,name,width,theme){
 await captures.anonymizePlaceholders(page);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(120);
 if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,name+'-'+theme+'-'+width+'.png'),animations:'disabled'});}
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+': sideways overflow');
 assert.equal(await page.evaluate(()=>scrollY),0,name+': page must keep its header in the viewport');
 const g=await rules.inspect(page,await rules.activeSurface(page));assert.deepEqual(g.overlaps,[],name+': control overlap');
 receipts.push({name,width,theme});
}
(async()=>{
 const scenario=SCENARIOS.find(s=>s.id==='workload-week');
 for(const width of widths)for(const theme of ['light','dark']){
  const h=await open({...scenario.open,width,height:844,theme,dsf:1});const p=h.page;p.setDefaultTimeout(8000);captures.prepareCaptures(p);
  try{
   await p.locator('.thumb-wl-person').first().waitFor();await p.waitForTimeout(700);
   assert.equal(await p.locator('[data-thumb-workload]').getAttribute('data-thumb-workload'),'agenda');
   assert.equal(await p.locator('.thumb-wl-week [data-thumb-wl-date]').count(),7);
   assert(await p.locator('.thumb-wl-week button').evaluateAll(ns=>ns.every(n=>n.getBoundingClientRect().width>=44)),'Seven dates have 44px targets');
   await shot(p,'workload-agenda',width,theme);
   const person=p.locator('.thumb-wl-person').first();const id=await person.getAttribute('data-thumb-wl-person');
   await person.tap();await p.getByRole('button',{name:'Back to agenda'}).waitFor();
   const expected=await p.evaluate(id=>wlState.allActiveSubs.filter(s=>(s.assigneeId||'')===id).length,id);
   assert.equal(await p.locator('.thumb-wl-item').count(),expected,'The queue retains every native active item');
   await shot(p,'workload-queue',width,theme);
   await p.locator('.thumb-wl-item').first().tap();await p.locator('#wlPopover.open').waitFor();
   assert.equal(await p.locator('#wlPopover .workload-popover-item').count(),1,'Item opens its exact native planning editor');
   await shot(p,'workload-item',width,theme);await p.keyboard.press('Escape');
   await p.getByRole('button',{name:'Back to agenda'}).tap();
   assert(await p.locator('.thumb-wl-person').first().evaluate(n=>n===document.activeElement),'Back restores creative focus');
   await p.waitForTimeout(100);await p.locator('.thumb-wl-person').first().tap();await p.goBack();await p.waitForTimeout(100);
   assert(await p.locator('.thumb-wl-person').first().isVisible(),'Browser Back restores agenda without changing route');
   await p.goForward();await p.getByRole('button',{name:'Back to agenda'}).waitFor();
   assert.equal(await p.locator('.thumb-wl-item').count(),expected,'Browser Forward restores the complete creative queue');
   assert(await p.locator('.thumb-wl-item').evaluateAll((ns,id)=>ns.every(n=>n.dataset.wlAssigneeId===id),id),'Forward restores the selected creative');
   await p.getByRole('button',{name:'Back to agenda'}).tap();await p.waitForTimeout(100);
   await p.locator('.thumb-wl-person').first().tap();await p.locator('[data-thumb-wl-mode=agenda]').tap();
   await p.locator('.thumb-wl-person').nth(1).tap();await p.goBack();await p.waitForTimeout(120);
   assert(await p.locator('.thumb-wl-person').first().isVisible(),'Back from another creative must restore Agenda after using its bottom tab');
   const filter=p.locator('[data-thumb-wl-filter]');await filter.tap();
   await shot(p,'workload-filters',width,theme);
   assert.notEqual(await p.locator('.thumb-wl-filters').evaluate(n=>getComputedStyle(n,'::backdrop').backgroundColor),'rgba(0, 0, 0, 0)','Filters dim the background');
   assert(await p.evaluate(()=>document.documentElement.classList.contains('sv-phone-locked') || getComputedStyle(document.documentElement).overflow==='hidden'),'Filter sheet locks the page');
   await p.getByRole('button',{name:'All editors',exact:true}).tap();await shot(p,'workload-filter-editors',width,theme);
   await p.keyboard.press('Escape');assert(await p.locator('.thumb-wl-filters').evaluate(n=>n.open),'Escape closes only the nested filter');
   await p.locator('#wlClientSearchInput').fill('Client');await shot(p,'workload-filter-client',width,theme);
   await p.getByRole('button',{name:'Done',exact:true}).tap();await filter.tap();
   assert.equal(await p.locator('#wlClientSearchInput').inputValue(),'Client','Dismissing filters keeps typed search');
   await p.keyboard.press('Escape');assert(await filter.evaluate(n=>n===document.activeElement),'Escape restores filter trigger focus');
   await p.locator('[data-thumb-wl-mode=week]').tap();
   assert(await p.locator('.workload-grid-wrap').isVisible(),'Week retains the native planning grid');await shot(p,'workload-week',width,theme);
   await p.locator('[data-thumb-wl-mode=month]').tap();await shot(p,'workload-month',width,theme);
   await filter.tap();await p.locator('[data-wl-deadline-mode=deadlines]').tap();await p.getByRole('button',{name:'Done',exact:true}).tap();
   assert.equal(await p.locator('[data-thumb-workload]').getAttribute('data-thumb-workload'),'week','Native deadline guard must synchronize the phone view');
   assert.equal(await p.locator('[data-thumb-wl-mode=week]').getAttribute('aria-current'),'page');
   assert.equal(await p.locator('.thumb-wl-header strong').textContent(),'Plan the week');
   assert(await p.locator('.workload-grid-wrap').isVisible(),'Deadline mode must show the native Week planner');
   await shot(p,'workload-plan-and-due',width,theme);
   assert(await p.locator('[data-thumb-wl-mode=month]').isDisabled(),'Native Plan + Due Date Month guard is preserved');
   await p.locator('[data-thumb-wl-mode=agenda]').tap();
   await p.evaluate(()=>{window.__thumbUndated=wlState.undated;wlState.undated=[wlState.allActiveSubs[0]];wlState.client='Client B';wlState.editor='ed-1';wlState.error='Fictional failed refresh';renderWorkloadAll();});
   assert(await p.locator('.thumb-wl-person[data-thumb-wl-person="ed-1"]').getByText('Video · 0 active',{exact:true}).isVisible(),'A failed refresh must retain the zero-work creative in a filtered cached board');
   assert.equal(await p.locator('.thumb-wl-agenda .workload-error').count(),0,'Cached work cannot become a fatal loading failure');
   await shot(p,'workload-filtered-refresh-error',width,theme);
   await p.evaluate(()=>{wlState.undated=window.__thumbUndated;delete window.__thumbUndated;wlState.client='all';wlState.editor='all';wlState.error=null;renderWorkloadAll();});
   await p.evaluate(()=>{wlState.allActiveSubs=[];wlState.planned=[];wlState.nowWorking=[];wlState.undated=[];wlState.unassigned=[];wlState.overdue=[];wlState.tweaksNeeded=[];wlState.calendarByDate=new Map();wlState.editorRoster=[];wlState.loading=false;wlState.planStatus='ready';wlState.error=null;renderWorkloadAll();});
   await shot(p,'workload-empty',width,theme);
   assert(await p.getByText('No work matches these filters.',{exact:true}).isVisible());
   await p.evaluate(()=>{wlState.loading=true;wlState.planStatus='loading';renderWorkloadAll();});await shot(p,'workload-loading',width,theme);
   assert.equal(await p.locator('.thumb-wl-person').count(),0,'Loading never claims free creatives');
   await p.evaluate(()=>{wlState.loading=false;wlState.planStatus='ready';wlState.error='Fictional offline response';renderWorkloadAll();});await shot(p,'workload-error',width,theme);
   assert(await p.getByRole('button',{name:'Try again',exact:true}).isVisible());
   assert.deepEqual(h.state.errors,[],'No page errors');assert(h.state.writes.every(w=>w.name==='production-comments' && w.body.include_feedback===true && w.body.limit===50 && !w.body.action),'Only native feedback reads may be requested');
   console.log('ok Workload '+width+' '+theme+': agenda, queue, exact native item, filters, planning, empty/loading/error');
  }finally{await h.close();}
 }
 if(out)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(receipts,null,2)+'\n');
 console.log('STAFF_PHONE_WORKLOAD: '+receipts.length+' screen/theme/width captures; all assertions passed; fictional transports; no live writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
