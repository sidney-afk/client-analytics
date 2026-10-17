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
const CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
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
  let authorityReads=0,creating=false;
  await context.route('**/rest/v1/syncview_runtime_flags*',route=>{
   const key=new URL(route.request().url()).searchParams.get('key')||'';
   if(creating&&key==='eq.sample_review_ef_clients')return route.fulfill({json:[{key:'sample_review_ef_clients',value:{clients:['sampleclientone']}}],headers:CORS});
   if(!key.includes('prod_authority'))return route.fallback();authorityReads++;
   return route.fulfill({json:[{key:'prod_authority',value:{video:'syncview',graphics:'syncview'}}],headers:CORS});
  });
  await context.addInitScript(names=>{
   const seed=()=>{
    if(typeof WL_CLIENT_NAMES==='undefined'||typeof WL_CLIENT_CANONICAL==='undefined'){setTimeout(seed,10);return;}
    WL_CLIENT_NAMES.splice(0,WL_CLIENT_NAMES.length,...names);WL_CLIENT_CANONICAL.clear();
    names.forEach(n=>WL_CLIENT_CANONICAL.set(wlNormalizeClient(n),n));
   };seed();
  },staff.NAMES);
  let intake=null,reloadedSamples=null;const materialized=[];
  await context.route('**/functions/v1/production-write',route=>{
   const body=route.request().postDataJSON();
   if(body.operation!=='intake_create')return route.fallback();
   assert.equal(body.surface,'sxr','Create sample keeps the native Samples intake lane');intake=body;
   return route.fulfill({status:201,headers:CORS,json:{ok:true,native_committed:true,mirror_pending:false,batch:{id:'00000000-0000-4000-a000-000000000090',name:body.batch?.name||'Fictional batch'},items:body.items.map((item,i)=>({item_index:i,id:'00000000-0000-4000-a000-'+String(i+91).padStart(12,'0'),team:item.team,card_id:item.card_id,title:'New fictional sample'}))}});
  });
  await context.route('**/functions/v1/sample-review-upsert',route=>{
   const body=route.request().postDataJSON();
   if(!intake||!body.sample||!intake.items.some(i=>i.card_id===body.sample.id))return route.fallback();
   materialized.push(body);reloadedSamples?.push(body.sample);return route.fulfill({headers:CORS,json:{ok:true,sample:body.sample}});
  });
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
    await page.getByRole('button',{name:'Tabs',exact:true}).tap();
    const post=page.getByRole('dialog',{name:'Tabs',exact:true}).locator('[data-nav=navTiktokUpload]');
    assert(await post.isVisible(),'Phone Tabs includes Post');
   assert.equal((await post.textContent()).trim(),'Post','Phone Tabs retains the current Post label');
    assert.equal(await post.locator('.ico-post').count(),1,'Phone Tabs retains the Post icon');
    await shot(page,type+'-tabs',width,theme);
    await page.getByRole('dialog',{name:'Tabs',exact:true}).getByRole('button',{name:'Close Tabs',exact:true}).tap();
    if(await root.getByRole('button',{name:'Grid view',exact:true}).getAttribute('aria-pressed')!=='true'){
     await root.getByRole('button',{name:'Grid view',exact:true}).tap();
     // Switching display puts back that display's remembered scroll in the
     // next animation frame. On a fast runner the scroll set below can land
     // first and be reset to 0, which reads as the tile moving. Frame
     // callbacks run in order, so one queued now runs after the page's.
     await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));
    }
    await root.locator('.thumb-tile').first().waitFor();
    assert.equal(await root.locator('.thumb-tile').count(),12,'Grid must keep all filtered cards');
    assert.equal(await root.locator('.thumb-collection-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),3,'Exactly three columns');
    // A complete row arriving above the viewport must keep the visible tile
    // and its keyboard focus in place in both collections.
    const anchor=await root.evaluate(n=>{
     const body=n.querySelector('.cal-body');body.scrollTop=150;
     const box=body.getBoundingClientRect(),tile=[...n.querySelectorAll('.thumb-tile')].find(t=>t.getBoundingClientRect().top>=box.top+8);
     tile.focus({preventScroll:true});return {id:tile.id,y:tile.getBoundingClientRect().top,scroll:body.scrollTop};
    });
    assert(anchor.scroll>0,'Grid refresh fixture must scroll away from the start');
    await page.evaluate(type=>{
     const state=type==='calendar'?calState:sxrState;window.__thumbOriginalPosts=state.posts;
     state.posts=[...state.posts.slice(0,3).map((p,i)=>({...p,id:'thumb_refresh_'+i,order_index:i-3,video_deliverable_id:null,graphic_deliverable_id:null})),...state.posts];
     (type==='calendar'?_calRenderBody:_sxrRenderBody)({preserveScroll:true});
    },type);
    await page.waitForTimeout(150);
    const held=await page.evaluate(id=>{const tile=document.getElementById(id);return {y:tile.getBoundingClientRect().top,focus:tile===document.activeElement};},anchor.id);
    assert(Math.abs(held.y-anchor.y)<=2,type+': a new grid row moved the tile in view');
    assert(held.focus,type+': background grid repaint lost tile focus');
    await page.evaluate(type=>{
     const state=type==='calendar'?calState:sxrState;state.posts=window.__thumbOriginalPosts;delete window.__thumbOriginalPosts;
     (type==='calendar'?_calRenderBody:_sxrRenderBody)({preserveScroll:true});
     document.querySelector(type==='calendar'?'#calBody':'#sxrBody').scrollTop=0;document.activeElement.blur();
    },type);
    await page.waitForTimeout(100);await root.locator('.cal-body').evaluate(n=>n.scrollTop=0);
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
    await page.goForward();await root.getByRole('button',{name:'Back to collection',exact:true}).waitFor();
    assert.equal(await root.locator('.cal-card').count(),1,'Forward restores the selected native card');
    assert.equal(await field.inputValue(),'Retained fictional title','Forward restores the selected card draft');
    const reloadRows=await page.evaluate(type=>(type==='calendar'?calState:sxrState).posts,type);
    if(type==='samples')reloadedSamples=reloadRows;
    const reloadPattern='**/rest/v1/'+(type==='calendar'?'calendar_posts':'sample_reviews')+'*';
    const reloadRead=route=>route.fulfill({json:reloadRows,headers:CORS});
    await context.route(reloadPattern,reloadRead);
    await page.reload();await root.getByRole('button',{name:'Back to collection',exact:true}).waitFor();
    await root.locator('.cal-card').waitFor();
    assert.equal(await root.locator('.cal-card').count(),1,'Reload restores the selected native card');
    assert.equal(await root.locator('.cal-card').getAttribute('data-pid'),reloadRows[0].id,'Reload keeps the selected card identity');
    await page.waitForFunction(type=>!(type==='calendar'?calState:sxrState).loading,type);await page.waitForTimeout(150);
    await page.goBack();await page.waitForTimeout(120);
    assert.equal(await root.locator('.thumb-tile').count(),12,'Back after Reload restores Grid: '+JSON.stringify(await page.evaluate(type=>({focus:!!(type==='calendar'?calState:sxrState).focusPid,loading:(type==='calendar'?calState:sxrState).loading,mode:document.querySelector(type==='calendar'?'#calView':'#sxrView')?.dataset.thumbMode,parent:history.state?.thumbCollectionParent,selected:!!history.state?.thumbCollectionCard}),type)));
    await page.goForward();await root.getByRole('button',{name:'Back to collection',exact:true}).waitFor();
    assert.equal(await root.locator('.cal-card').getAttribute('data-pid'),reloadRows[0].id,'Forward after Reload keeps the selected card');
    await page.goBack();await page.waitForTimeout(120);
    if(type==='calendar')await page.evaluate(()=>{clientMap[calState.client]={...(clientMap[calState.client]||{}),instagram_handle:'demo.profile'};_calRenderShell();_calRenderBody();});
    await root.locator('.thumb-tile img[data-drive="1"]').first().evaluate(n=>n.dispatchEvent(new Event('error')));
    await page.waitForTimeout(120);
    assert(await root.locator('.thumb-tile[data-thumb-media-error="drive"]').first().isVisible(),'Drive failures remain explicit in Grid');
    assert.match(await root.locator('.thumb-tile[data-thumb-media-error="drive"]').first().getAttribute('aria-label'),/Anyone with the link/,'Grid retains the native Drive sharing instructions');
    await shot(page,type+'-grid-drive-error',width,theme);
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
    }else{
     creating=true;
     await root.getByRole('button',{name:'Create sample',exact:true}).tap();await page.locator('#calNativePostCreate').waitFor();
     await page.locator('#calNativePostCreate').tap();
     await page.waitForFunction(()=>sxrState.posts.some(p=>p.name==='New fictional sample')).catch(async error=>{
      throw new Error(error.message+' Native Create fixture: '+JSON.stringify({intake:!!intake,authorityReads,materializations:materialized.length,error:await page.locator('#calNativePostError').textContent()}));
     });
     assert(intake&&materialized.length===1,'Native Create must commit and materialize exactly one sample');
     await page.locator('#confirmOverlay.active').waitFor();assert.equal(await page.locator('#confirmTitle').textContent(),'Sample created');
     await page.locator('#confirmYes').tap();
     await root.getByRole('button',{name:'Back to collection',exact:true}).waitFor();await page.waitForTimeout(150);
     const created=root.locator('.cal-card[data-pid="'+intake.items[0].card_id+'"]');
     assert.equal(await root.locator('.cal-card').count(),1,'New sample opens its native editor');
     assert(await created.locator('.cal-fld-name').evaluate(n=>n===document.activeElement),'Native Create focuses the new sample title');
     await shot(page,'samples-created',width,theme);await root.getByRole('button',{name:'Back to collection',exact:true}).tap();await page.waitForTimeout(120);
    }
    for(const kind of ['no-posts','loading','error','empty']){await prepare(page,type+'-'+kind);await shot(page,type+'-'+kind,width,theme);}
    await context.unroute(reloadPattern,reloadRead);
   }
   assert.deepEqual(errors,[],'Page errors');
   console.log('ok Thumb collections '+width+' '+theme+': native navigation, menu, selection, review, empty/loading/error, no overlap');
  }finally{await context.close();}
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
 if(out)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({receipt},null,2)+'\n');
 console.log('STAFF_PHONE_COLLECTIONS: '+receipt.length+' screen/theme/width captures; all assertions passed; fictional data; no live writes');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
