'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const staff=require('../docs/syncview-design/tests/staff-phone-browser');
const {seedStaffGate}=require('./staff-gate-seed');
const checks=require('./staff-phone-rule-checks');
const {heightFor}=require('./client-phone/profiles');
const arg=(key,fallback)=>process.argv.find(s=>s.startsWith('--'+key+'='))?.slice(key.length+3)||fallback;
const out=arg('out',''),only=new RegExp(arg('only','.*'));
const widths=arg('widths','390,430').split(',').map(Number);
const failures=[],receipts=[];
const ROOT=path.resolve(__dirname,'..');
const routes=['today','calendar','sample-reviews','templates','filming-plans','tiktok-upload','home','workload','production','linear','kasper','time-off'];
const settle=page=>page.waitForTimeout(250);
async function capture(page,label) {
  if(!out)return;fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,label+'.png'),fullPage:false,animations:'disabled'});
}
async function layout(page,label) {
  const surface=await checks.activeSurface(page);
  const result=await checks.inspect(page,surface);
  await capture(page,label);
  assert(result.pageWidth<=result.width+1,label+': sideways scroll');
  assert.deepEqual(result.overlaps,[],label+': overlaps');
  assert.deepEqual(result.misalignedActions,[],label+': caption action placement');
  assert.deepEqual(result.small,[],label+': small controls');
  assert.deepEqual(result.fields,[],label+': small field text');
  receipts.push({label,controls:result.controls,surface});
}
async function detectorControls(browser) {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage();require('./client-phone/native-captures').prepareCaptures(page);
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{height:3000px}button{position:absolute;left:10px;top:10px;width:60px;height:60px}.test-overlay{position:fixed;top:300px;left:10px;width:300px;height:200px;background:white}</style><button>A</button><button>B</button><div class="test-overlay">Popup</div>');
  assert((await checks.inspect(page)).overlaps.length,'overlap detector missed injected collision');
  await assert.rejects(()=>checks.scrollLock(page,'.test-overlay'),/background moved/,'scroll checker accepted unlocked background');
  await page.evaluate(()=>{
    window.scrollTo(0,0);
    document.querySelectorAll('button').forEach(el=>el.remove());
    const scroller=document.createElement('div');scroller.id='clip-control';scroller.style.cssText='position:absolute;left:10px;top:160px;width:120px;height:50px;overflow:hidden';
    scroller.innerHTML='<button style="left:0;top:40px">Clipped row</button>';document.body.append(scroller);
    const footer=document.createElement('button');footer.id='clip-footer';footer.textContent='Footer';footer.style.top='220px';document.body.append(footer);
  });
  assert.deepEqual((await checks.inspect(page)).overlaps,[],'detector treated clipped scroller content as painted over its footer');
  await page.locator('#clip-footer').evaluate(el=>el.style.top='200px');
  assert((await checks.inspect(page)).overlaps.length,'detector missed a real collision in the visible part of a clipped row');
  await page.evaluate(()=>{document.querySelector('#clip-control').remove();document.querySelector('#clip-footer').remove();});
  await page.evaluate(()=>{
    const clip=document.createElement('div');clip.id='fixed-clip-control';clip.style.cssText='position:absolute;left:10px;top:160px;width:120px;height:50px;overflow:hidden';
    clip.innerHTML='<div style="position:fixed;left:10px;top:260px;width:120px;height:100px"><button style="top:0;left:0">A</button><button style="top:0;left:0">B</button></div>';document.body.append(clip);
  });
  assert((await checks.inspect(page)).overlaps.length,'detector missed a fixed popup collision outside a clipped ancestor');
  await page.locator('#fixed-clip-control').evaluate(el=>el.remove());
  await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'docs/syncview-design/staff-phone-rules.js'),'utf8')});
  await page.addStyleTag({content:fs.readFileSync(path.join(ROOT,'docs/syncview-design/staff-phone-rules.css'),'utf8')});
  await settle(page);await checks.scrollLock(page,'.test-overlay');
  await page.evaluate(()=>{
    const parent=document.querySelector('.test-overlay');parent.style.overflow='auto';parent.innerHTML='<div style="height:900px">Sheet content</div><div class="nested-popup" style="position:fixed;left:80px;top:350px;width:100px;height:80px;overflow:auto;background:white"><div style="height:500px">Nested choices</div></div>';parent.scrollTop=100;
  });
  await settle(page);await page.mouse.move(30,330);await page.mouse.wheel(0,300);await settle(page);
  assert.equal(await page.locator('.test-overlay').evaluate(el=>el.scrollTop),100,'nested popup allowed its underlying sheet to scroll');
  await page.mouse.move(100,380);await page.mouse.wheel(0,100);await settle(page);
  assert((await page.locator('.nested-popup').evaluate(el=>el.scrollTop))>0,'nested popup cannot scroll its own choices');
  await page.locator('.nested-popup').evaluate(el=>el.remove());await settle(page);
  assert(await page.locator('html').evaluate(el=>el.classList.contains('sv-phone-locked')),'closing nested popup unlocked its parent');
  await page.locator('.test-overlay').evaluate(el=>el.remove());await settle(page);
  assert.equal(await page.locator('body').evaluate(el=>el.style.position),'','closing final overlay did not restore body');
  // A class named "overlay" also paints normal card content. It must never
  // acquire modal ownership or prevent reaching fields farther down the page.
  await page.evaluate(()=>{
    const card=document.createElement('div');card.style.cssText='position:relative;height:300px';
    card.innerHTML='<div class="cal-review-video-overlay" style="position:absolute;inset:0">Video play layer</div><div class="cal-card-select-overlay" style="position:absolute;inset:0">Card selection layer</div><div class="kasper-hero-poster-overlay" style="position:absolute;inset:0">Poster layer</div>';
    document.body.append(card);
  });
  await settle(page);assert.equal(await checks.activeSurface(page),'body','inline card layers became a popup');
  const normalY=await page.evaluate(()=>scrollY);await page.mouse.move(3,300);await page.mouse.wheel(0,300);await settle(page);
  assert((await page.evaluate(()=>scrollY))>normalY,'normal card content cannot scroll');
  for(const name of ['cal-lightbox','kasper-lightbox']){
    await page.evaluate(name=>{const box=document.createElement('div');box.className=name+' open';box.style.cssText='position:fixed;inset:0;background:white;z-index:500';document.body.append(box);},name);
    await settle(page);assert.notEqual(await checks.activeSurface(page),'body',name+' was not recognized as a dialog');
    await checks.scrollLock(page,'.'+name+'.open');
    await page.locator('.'+name+'.open').evaluate(el=>el.remove());await settle(page);
    assert.equal(await checks.activeSurface(page),'body',name+' retained its lock after close');
  }
  console.log('ok normal scrolling: video, selection and poster layers do not lock the page');
  console.log('ok detector controls: injected overlap and absent scroll lock fail; artifact lock passes');
  await context.close();
}
async function screen(browser,origin,width,theme,route) {
  const context=await browser.newContext({viewport:{width,height:heightFor(width,arg('height'))},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await staff.installBackend(context,false);await seedStaffGate(context);
  await context.addInitScript(theme=>{localStorage.setItem('syncview_theme',theme);sessionStorage.setItem('syncview_kasper_unlocked','ok');},theme);
  const page=await context.newPage();require('./client-phone/native-captures').prepareCaptures(page);page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const prefix=route+'-'+theme+'-'+width;
  try {
    await page.goto(origin+'/');await page.waitForFunction(()=>typeof navTo==='function');
    await page.evaluate(names=>{WL_CLIENT_NAMES.splice(0,WL_CLIENT_NAMES.length,...names);WL_CLIENT_CANONICAL.clear();names.forEach(n=>WL_CLIENT_CANONICAL.set(wlNormalizeClient(n),n));},staff.NAMES);
    await page.evaluate(route=>navTo(route),route);await settle(page);
    if(route==='calendar'||route==='sample-reviews')await page.evaluate(route=>{
      const p={id:'phone_rules_fixture',client:'sample-one',name:'A calm start',caption:'A longer caption. '.repeat(35),caption_alt:'An alternate caption. '.repeat(25),caption_alt_platform:'linkedin',platforms:['instagram','tiktok','youtube','linkedin','facebook'],color:'purple',asset_url:'',thumbnail_url:'',video_deliverable_id:'00000000-0000-4000-8000-000000000001',graphic_deliverable_id:'00000000-0000-4000-8000-000000000002',status:'In Progress',video_status:'In Progress',graphic_status:'In Progress',caption_status:'In Progress',scheduled_date:'2026-10-07'};
      const state=route==='calendar'?calState:sxrState;state.loading=false;state.error='';state.client='Sample Client One';state.posts=[p];state.view='organizer';state.monthFilter='all';state.statusFilter='all';
      localStorage.setItem(CAL_ENABLED_PLATFORMS_KEY,JSON.stringify({'sampleone':['instagram','tiktok','youtube','linkedin','facebook']}));
      state.settings={enabled_platforms:['instagram','tiktok','youtube','linkedin','facebook']};
      if(route==='calendar'){_calInvalidateActiveLoad();_calRenderShell();_calRenderBody();}else{_sxrRenderShell();_sxrRenderBody();}
    },route);
    await settle(page);await layout(page,prefix);
    // Every screen's Tabs and More, including menu-only personal Time Off.
    for(const kind of ['tabs','more']) {
      const opener=page.locator(kind==='tabs'?'.pocket-staff-tabs-btn, #fphTabsBtn, [data-staff-menu=tabs], .pocket-admin-heading button[aria-haspopup=dialog]':'.pocket-staff-more-btn, #fphMoreBtn, [data-staff-menu=more], [data-kasper-more-trigger]').filter({visible:true}).first();
      assert(await opener.count(),prefix+': missing '+kind+' opener');
      await opener.tap();await settle(page);
      const surface=await checks.activeSurface(page);assert.notEqual(surface,'body',prefix+': '+kind+' did not open');
      await checks.scrollLock(page,surface);
      await layout(page,prefix+'-'+kind);
      if(surface==='dialog[open]') {
        await page.locator(surface).first().tap({position:{x:6,y:6}});await settle(page);
        assert(await page.locator('dialog[open]').count(),prefix+': inside padding tap closed '+kind);
      }
      await page.keyboard.press('Escape');await settle(page);
      assert.equal(await checks.activeSurface(page),'body',prefix+': Escape left '+kind+' open');
      assert(await opener.evaluate(el=>document.activeElement===el),prefix+': focus did not return from '+kind);
    }
    if(route==='calendar') {
      const wrap=page.locator('.cal-cap-wrap').filter({visible:true}).first(),ta=wrap.locator('textarea'),toggle=wrap.locator('.cal-cap-toggle');
      const actions=await wrap.evaluate(el=>{
        const field=el.querySelector('textarea').getBoundingClientRect();
        return [...el.querySelectorAll('.cal-cap-gen, .cal-cap-gen-x, .cal-cap-toggle')]
          .filter(button=>button.checkVisibility({checkVisibilityCSS:true}))
          .map(button=>{const r=button.getBoundingClientRect();return {name:button.className,gap:r.top-field.bottom,center:r.top+r.height/2,height:r.height};});
      });
      assert(actions.length>=2,prefix+': caption action row missing');
      assert(actions.every(a=>a.gap>=-1&&a.gap<=24),prefix+': caption action detached from its field');
      assert(Math.max(...actions.map(a=>a.center))-Math.min(...actions.map(a=>a.center))<=1,prefix+': caption actions misaligned '+JSON.stringify(actions));
      const height=await ta.evaluate(el=>el.clientHeight);
      await toggle.tap();await settle(page);assert((await ta.evaluate(el=>el.clientHeight))>height+20,prefix+': caption did not expand');
      assert.equal(await toggle.getAttribute('aria-expanded'),'true');
      await layout(page,prefix+'-caption-open');
      await toggle.tap();await settle(page);assert.equal(await ta.evaluate(el=>el.clientHeight),height,prefix+': caption did not collapse');
      assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      await ta.tap();await page.keyboard.press('Escape');await settle(page);
      await page.locator('.cal-fld-setall').first().tap();await settle(page);await checks.scrollLock(page,'.cal-fld-status-menu');
      await page.locator('.cal-fld-setall-menu-head').tap();assert(await page.locator('.cal-fld-status-menu').count(),prefix+': Set all inside tap closed popup');
      await layout(page,prefix+'-set-all');await page.keyboard.press('Escape');await settle(page);
      await page.locator('.cal-card-color-tag').first().tap();await settle(page);await checks.scrollLock(page,'.cal-card-color-picker');
      await layout(page,prefix+'-color');await page.keyboard.press('Escape');await settle(page);
      assert.equal(await page.locator('.cal-card-color-picker').count(),0,prefix+': color picker ignored Escape');
      assert(await page.locator('.cal-card-color-tag').first().evaluate(el=>document.activeElement===el),prefix+': color focus did not return');
      // Keyboard viewport simulation is explicitly separate from real OS proof.
      await ta.tap();await page.setViewportSize({width,height:400});await settle(page);
      const r=await ta.boundingBox();assert(r.y>=15&&r.y+r.height<=385,prefix+': focused caption hidden by keyboard viewport '+JSON.stringify(r));
      await capture(page,prefix+'-keyboard');await page.keyboard.press('Escape');
      await page.setViewportSize({width,height:heightFor(width,arg('height'))});
      await page.evaluate(()=>{calState.posts[0].caption='';calState.posts[0].caption_alt='';_calRenderBody();});await settle(page);
      assert(await page.locator('.cal-cap-toggle').first().evaluate(el=>el.hidden&&getComputedStyle(el).display==='none'),prefix+': empty caption exposes a phantom toggle');
      await layout(page,prefix+'-empty-caption');
    }
    assert.deepEqual(errors,[],prefix+': app errors');console.log('ok '+prefix+' screen, menus, layout and scroll lock');
  } catch(error) { failures.push(prefix+': '+error.message);console.error('FAIL '+failures.at(-1)); }
  finally {await context.close();}
}
(async()=>{
  const server=await staff.serve(),origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch();
  try {await detectorControls(browser);for(const route of routes.filter(x=>only.test(x)))for(const width of widths)for(const theme of ['light','dark']){staff.resetScenario();await screen(browser,origin,width,theme,route);}}
  finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
  if(out)fs.writeFileSync(path.join(out,'receipts.json'),JSON.stringify({receipts,failures},null,2));
  console.log('STAFF_PHONE_RULES: '+receipts.length+' states; '+failures.length+' failures; '+widths.join('/')+' touch; synthetic transports; no live writes');
  if(failures.length)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
