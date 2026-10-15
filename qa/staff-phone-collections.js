'use strict';
// The approved Thumb flows, using the existing intercepted staff fixtures.
require('../test/helpers/single-file-index');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const staff=require('../docs/syncview-design/tests/staff-phone-browser');
const {prepare}=require('./staff-phone-final-pass'),{seedStaffGate}=require('./staff-gate-seed');
const rules=require('./staff-phone-rule-checks');
const captures=require('./client-phone/native-captures');
const arg=(k,d)=>process.argv.find(s=>s.startsWith('--'+k+'='))?.slice(k.length+3)||d;
const out=arg('out',''),widths=arg('widths','390,430').split(',').map(Number);
const receipt=[];
async function shot(page,name,width,theme){
 await captures.anonymizePlaceholders(page);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(120);
 if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,name+'-'+theme+'-'+width+'.png'),animations:'disabled'});}
 const geometry=await rules.inspect(page,await rules.activeSurface(page));
 assert.deepEqual(geometry.overlaps,[],name+': controls overlap');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+': sideways overflow');
 if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,name+'-'+theme+'-'+width+'.png'),animations:'disabled'});}
 receipt.push({name,width,theme});
}
async function main(){
 const server=await staff.serve(),browser=await chromium.launch();
 try{for(const width of widths)for(const theme of ['light','dark']){
  staff.resetScenario();const context=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  await staff.installBackend(context);await seedStaffGate(context);
  await context.route('**/*',route=>route.request().resourceType()==='image'?route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960"><rect width="720" height="960" fill="#6b8881"/><circle cx="360" cy="330" r="170" fill="#cbd5cb"/><path d="M90 960V680Q360 400 630 680V960Z" fill="#3c5551"/><text x="360" y="180" font-size="55" fill="white" text-anchor="middle">DEMO CLIP</text></svg>'}):route.fallback());
  await context.addInitScript(t=>localStorage.setItem('syncview_theme',t),theme);
  const page=await context.newPage(),errors=[];captures.prepareCaptures(page);page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
  try{
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>typeof navTo==='function');
   for(const type of ['calendar','samples']){
    await prepare(page,type+'-many');
    await page.evaluate(type=>{
     const state=type==='calendar'?calState:sxrState;
     state.posts.forEach((p,i)=>Object.assign(p,{name:['A calmer start','Three small habits','Make room for more'][i%3],thumbnail_url:'https://drive.google.com/file/d/fictional_thumbnail_fixture_0001/view',video_deliverable_id:'00000000-0000-4000-a000-'+String(i*2+1).padStart(12,'0'),graphic_deliverable_id:'00000000-0000-4000-a000-'+String(i*2+2).padStart(12,'0')}));
     if(type==='calendar') { clientMap[state.client]={...(clientMap[state.client]||{}),instagram_handle:'demo.profile'}; _calRenderBody(); } else _sxrRenderBody();
    },type);
    const root=page.locator(type==='calendar'?'#calView':'#sxrView');
    if(await root.getByRole('button',{name:'Grid view',exact:true}).getAttribute('aria-pressed')!=='true')await root.getByRole('button',{name:'Grid view',exact:true}).tap();
    await root.locator('.thumb-tile').first().waitFor();
    assert.equal(await root.locator('.thumb-tile').count(),12,'Grid must keep all filtered cards');
    assert.equal(await root.locator('.thumb-collection-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),3,'Exactly three columns');
    await shot(page,type+'-grid',width,theme);
    await root.getByRole('button',{name:'List view',exact:true}).tap();
    assert.equal(await root.locator('.cal-card').count(),12,'Existing List keeps every native card');
    assert.equal(await root.getByRole('button',{name:'List view',exact:true}).getAttribute('aria-pressed'),'true');
    await shot(page,type+'-list',width,theme);
    await root.getByRole('button',{name:'Grid view',exact:true}).tap();
    await root.locator('.thumb-tile').first().tap();
    assert.equal(await root.locator('.cal-card').count(),1,'A tile opens only its selected native card');
    assert(await root.getByRole('button',{name:'Back to collection',exact:true}).isVisible());
    await shot(page,type+'-card',width,theme);
    // Native free-text edits survive leaving and reopening the card. No new
    // save transport is introduced by the collection navigation.
    const field=root.locator('textarea[data-pocket-title],input.cal-fld-name').filter({visible:true}).first();
    await field.fill('Retained fictional title');
    await root.getByRole('button',{name:'Back to collection',exact:true}).tap();
    await page.waitForTimeout(150);
    assert.equal(await root.locator('.thumb-tile').count(),12,'Back restores collection without remounting its client');
    assert(await root.locator('.thumb-tile').first().evaluate(n=>n===document.activeElement),'Back restores tile focus');
    await root.locator('.thumb-tile').first().tap();
    assert.equal(await root.locator('textarea[data-pocket-title],input.cal-fld-name').filter({visible:true}).first().inputValue(),'Retained fictional title','Card draft was lost');
    await page.goBack();await page.waitForTimeout(120);
    assert.equal(await root.locator('.thumb-tile').count(),12,'Browser Back restores the collection');
    await root.locator('[data-staff-menu=more]').tap();
    const dialog=root.locator('dialog[open]');
    assert.deepEqual(await dialog.locator('h3').allTextContents(),['Work on content','View & organize','Preferences','Tools & account']);
    assert(await dialog.getByRole('button',{name:'Select cards',exact:true}).isVisible());
    if(type==='calendar')assert(await dialog.getByRole('button',{name:'Write captions',exact:true}).isVisible());
    else assert.equal(await dialog.getByRole('button',{name:'Write captions',exact:true}).count(),0,'Samples must not gain an unsupported caption writer');
    await rules.scrollLock(page,'dialog[open]');
    await shot(page,type+'-more',width,theme);
    if(type==='calendar') { assert.equal(await dialog.getByText('Open profile',{exact:true}).count(),1,'Profile belongs in More exactly once'); assert.equal(await root.locator('.cal-toolbar .cal-client-links').count(),0,'Profile must not occupy a toolbar row'); }
    await dialog.locator('[class$="-body"]').evaluate(n=>n.scrollTop=n.scrollHeight);
    await shot(page,type+'-more-account',width,theme);
    await page.keyboard.press('Escape');assert(await root.locator('[data-staff-menu=more]').evaluate(n=>n===document.activeElement));
    await root.locator('[data-staff-menu=more]').tap();
    await root.locator('dialog[open]').getByRole('button',{name:'Select cards',exact:true}).tap();
    await page.waitForTimeout(120);
    assert(await root.locator('.cal-select-bar').isVisible(),'More must enter the existing bulk selection mode');
    await shot(page,type+'-selection',width,theme);
    await root.locator('.cal-select-cancel').tap();
    await root.locator('.thumb-review-dock button').tap();
    await shot(page,type+'-review',width,theme);
    await root.locator('[data-cal-view=organizer]').tap();
    if(type==='calendar'){
     await root.locator('.thumb-calendar-view').tap();await shot(page,'calendar-view-picker',width,theme);
     await root.locator('.thumb-view-sheet').getByRole('button',{name:'Month',exact:true}).tap();await shot(page,'calendar-month',width,theme);
     await root.locator('.thumb-calendar-view').tap();await root.locator('.thumb-view-sheet').getByRole('button',{name:'Week',exact:true}).tap();await shot(page,'calendar-week',width,theme);
    }
    for(const kind of ['no-posts','loading','error','empty']){await prepare(page,type+'-'+kind);await shot(page,type+'-'+kind,width,theme);}
   }
   assert.deepEqual(errors,[],'Page errors');
   console.log('ok Thumb collections '+width+' '+theme+': native navigation, menu, selection, review, empty/loading/error, no overlap');
  }finally{await context.close();}
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
 if(out)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({receipt},null,2)+'\n');
 console.log('STAFF_PHONE_COLLECTIONS: '+receipt.length+' screen/theme/width captures; all assertions passed; fictional data; no live writes');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
