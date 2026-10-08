'use strict';
// Generated native cards, fictional data, fully intercepted transports.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const staff=require('../docs/syncview-design/tests/staff-phone-browser');
const {seedStaffGate}=require('./staff-gate-seed');
const rules=require('./staff-phone-rule-checks');
const {heightFor}=require('./client-phone/profiles');
const arg=(k,d)=>process.argv.find(x=>x.startsWith('--'+k+'='))?.slice(k.length+3)||d;
const out=arg('out',''),before=!!arg('before-root','');
const widths=arg('widths','390,430').split(',').map(Number),rows=[];
async function main(){
 const server=await staff.serve(),origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch();
 try{for(const route of ['calendar','sample-reviews'])for(const width of widths)for(const theme of ['light','dark'])for(const missing of [true,false]){
  const ctx=await browser.newContext({viewport:{width,height:heightFor(width,arg('height'))},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await staff.installBackend(ctx,false);await seedStaffGate(ctx);
  await ctx.route('**/*',r=>r.request().resourceType()==='image'?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400"><rect width="720" height="400" fill="#b5c5b5"/><path d="M0 320 200 90 430 350 570 190 720 340V400H0Z" fill="#708b79"/><circle cx="550" cy="90" r="38" fill="#f0dfb8"/></svg>'}):r.fallback());
  await ctx.addInitScript(theme=>localStorage.setItem('syncview_theme',theme),theme);
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  try{
   await p.goto(origin+'/');await p.waitForFunction(()=>typeof navTo==='function');
   await p.evaluate(names=>{WL_CLIENT_NAMES.splice(0,WL_CLIENT_NAMES.length,...names);WL_CLIENT_CANONICAL.clear();names.forEach(n=>WL_CLIENT_CANONICAL.set(wlNormalizeClient(n),n));},staff.NAMES);
   await p.evaluate(route=>navTo(route),route);await p.waitForTimeout(350);
   await p.evaluate(({route,missing})=>{
    const post={id:'phone_design_fixture',client:'sample-one',name:'A calmer start to the day',caption:'Small changes make tomorrow easier. Start with one habit you can keep, and make room for what matters. '.repeat(4),caption_alt:'',cta:'Save this for tomorrow.',platforms:['instagram','tiktok','youtube','linkedin','facebook'],color:'indigo',thumbnail_url:missing?'':'https://drive.google.com/file/d/fictional_thumbnail_fixture_0001/view',asset_url:missing?'':'https://media.example.invalid/movie.mp4',video_deliverable_id:'00000000-0000-4000-8000-000000000001',graphic_deliverable_id:'00000000-0000-4000-8000-000000000002',status:'In Progress',video_status:missing?'Kasper Approval':'In Progress',graphic_status:'In Progress',caption_status:'In Progress',scheduled_date:'2026-10-12'};
    const s=route==='calendar'?calState:sxrState;Object.assign(s,{loading:false,error:'',client:'Sample Client One',posts:[post],view:'organizer',monthFilter:'all',statusFilter:'all',settings:{enabled_platforms:['instagram','tiktok','youtube','linkedin','facebook']}});
    localStorage.setItem(CAL_ENABLED_PLATFORMS_KEY,JSON.stringify({sampleone:post.platforms}));
    if(route==='calendar'){_calInvalidateActiveLoad();_calRenderShell();_calRenderBody();}else{_sxrRenderShell();_sxrRenderBody();}
   },{route,missing});await p.waitForTimeout(650);await p.evaluate(()=>document.fonts.ready);
   const card=p.locator('.cal-card[data-pid=phone_design_fixture]'),label=route+'-'+width+'-'+theme+'-'+(missing?(route==='calendar'?'warning':'missing-media'):'linked');
   if(missing&&route==='calendar')assert.match(await card.locator('.cal-smm-warn-overlay').textContent(),/No video linked/);
   if(out){fs.mkdirSync(out,{recursive:true});await card.screenshot({path:path.join(out,label+'.png'),animations:'disabled'});}
   if(!before){
    await rules.assertLayout(p,label);
    const primary=card.locator('.sv-phone-card-primary'),more=card.locator('.sv-phone-card-more'),menu=card.locator('.sv-phone-card-menu');
    assert((await primary.boundingBox()).height<=45,label+': metadata must fit one quiet row');
    assert(!(await card.locator('.cal-card-del').isVisible()),label+': Archive exposed without opening More');
    if(route==='sample-reviews')assert.equal(await card.locator('.sv-phone-card-secondary').evaluate(el=>el.getBoundingClientRect().height),0,label+': redundant Samples action row');
    await more.tap();await menu.waitFor({state:'visible'});await rules.assertLayout(p,label+' actions','.sv-phone-card-menu[open]');await rules.scrollLock(p,'.sv-phone-card-menu[open]');
    if(out)await p.screenshot({path:path.join(out,label+'-actions.png'),animations:'disabled'});
    await menu.locator('strong').tap();assert(await menu.isVisible(),label+': inside tap dismissed card actions');
    await p.keyboard.press('Escape');await menu.waitFor({state:'hidden'});await p.waitForTimeout(100);
    assert(await more.evaluate(el=>el===document.activeElement),label+': More lost focus after Escape');
    await more.tap();await menu.getByRole('button',{name:'Close card actions',exact:true}).tap();await menu.waitFor({state:'hidden'});
    await p.waitForTimeout(100);assert(await more.evaluate(el=>el===document.activeElement),label+': More lost focus after Close');
    await more.tap();await p.touchscreen.tap(width/2,100);await menu.waitFor({state:'hidden'});
    await p.waitForTimeout(100);assert(await more.evaluate(el=>el===document.activeElement),label+': More lost focus after outside tap');
    await more.tap();await menu.locator('.cal-card-del').tap();await menu.waitFor({state:'hidden'});
    const confirm=p.locator('#confirmOverlay.active');await confirm.waitFor({state:'visible'});
    assert.match(await confirm.locator('#confirmTitle').textContent(),route==='calendar'?/Archive this post\?/:/Archive this sample\?/);
    await rules.assertLayout(p,label+' archive confirmation','#confirmOverlay.active');await rules.scrollLock(p,'#confirmOverlay.active');
    await confirm.getByRole('button',{name:'Cancel',exact:true}).tap();await confirm.waitFor({state:'hidden'});
    assert.equal(await card.count(),1,label+': cancelling Archive removed the card');
    await p.waitForTimeout(100);assert(await more.evaluate(el=>el===document.activeElement),label+': More lost focus after Archive cancellation');
    // Invoke the real media-error callback: native media replacement must retain
    // the SAME action nodes, their callbacks and their grouped parent container.
    const retained=await card.evaluate((el,route)=>{
     const tools=el.querySelector('.sv-phone-card-tools'),nodes=[...tools.querySelectorAll('button,a')],thumb=el.querySelector('.cal-card-thumb');
     const img=document.createElement('img');thumb.prepend(img);
     (route==='calendar'?_calOnThumbImgError:_sxrOnThumbImgError)(img);
     return tools.isConnected&&nodes.every(n=>n.isConnected&&tools.contains(n));
    },route);assert(retained,label+': thumbnail refresh removed native actions');
    await p.waitForTimeout(100);await rules.assertLayout(p,label+' refreshed');
    await p.setViewportSize({width:1024,height:844});await p.waitForTimeout(150);
    assert.equal(await p.locator('.sv-phone-card-tools').count(),0,label+': phone card container leaked onto desktop');
    assert.equal(await p.locator('.sv-phone-action-label').count(),0,label+': action labels leaked onto desktop');
    assert.equal(await card.locator('.cal-card-del').count(),1,label+': desktop native archive was lost');
   }
   rows.push({label,width,theme,missing,cardHeight:await card.evaluate(el=>el.getBoundingClientRect().height)});
   assert.deepEqual(errors,[],label+': browser errors');console.log('ok '+label);
  }finally{await ctx.close();}
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
 if(out)fs.writeFileSync(path.join(out,'receipts.json'),JSON.stringify({rows},null,2));
 console.log('STAFF_PHONE_DESIGN: '+rows.length+' native card states; 0 failures; fictional intercepted transports');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
