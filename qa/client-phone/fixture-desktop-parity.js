'use strict';
// Complements desktop-parity.js with the native states changed by this batch.
// Reuses the phone fixtures; every transport is intercepted, including writes.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const staff = require('../../docs/syncview-design/tests/staff-phone-browser');
const client = require('../../docs/syncview-design/tests/client-phone-review-browser');
const finch = require('../finch-phone/harness');
const { detailOptions,openNativeCardDetail,prepare } = require('../staff-phone-final-pass');
const { SCENARIOS } = require('../finch-phone/scenarios');
const { seedStaffGate, seedStaffIdentity } = require('../staff-gate-seed');
const root = path.resolve(__dirname, '../..');
const arg = key => process.argv.find(a => a.startsWith('--'+key+'='))?.slice(key.length+3);
const reference = path.resolve(arg('before-root') || '');
assert(arg('before-root') && fs.existsSync(path.join(reference,'index.html')), 'A saved before build is required');
const out = arg('out') && path.resolve(arg('out'));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const cors = {'access-control-allow-origin':'*','access-control-allow-headers':'*'};
const freeze = '*{animation:none!important;transition:none!important;caret-color:transparent!important}';
const fixtureNow = new Date();
const cases = [
  ...['calendar-long-content','samples-long-content','calendar-thumbnail-prompt-normal','calendar-month','calendar-loading','calendar-week-loading','samples-sheet','samples-loading'].flatMap(name=>['light','dark'].flatMap(theme=>[false,true].map(warm=>({name,theme,warm})))),
  ...['client-calendar-review-loading','client-calendar-sheet-loading'].flatMap(name=>[false,true].map(warm=>({name,theme:'light',warm}))),
  ...['today-rings','today-all-clear','today-loading','today-editor-all-clear'].flatMap(name => ['light','dark'].map(theme=>({name,theme}))),
  ...['calendar-notes','samples-notes','samples-notes-unlinked'].flatMap(name => [false,true].map(warm=>({name,theme:'light',warm}))),
  ...['analytics-loading','analytics-empty','analytics-pin','analytics-search','analytics-overview','analytics-detail','analytics-detail-dash','workload-loading','workload-month','workload-week','workload-popover','workload-plan-due','tiktok-client-ready','tiktok-no-account','linear-detail','linear-detail-empty','linear-detail-comment-draft','linear-detail-loading','linear-detail-menu','linear-detail-description-edit','linear-detail-asset-edit'].flatMap(name=>['light','dark'].flatMap(theme=>[false,true].map(warm=>({name,theme,warm,finch:true})))),
].filter(test => !arg('only') || new RegExp(arg('only')).test(test.name));
assert(cases.length, 'No native parity cases selected');
async function renderFinch(build,test) {
  const trace=step=>{if(process.argv.includes('--diagnostic')) console.log('Finch parity '+test.name+' '+build+' '+(test.warm?'warm':'cold')+': '+step);};
  const scenario=SCENARIOS.find(s=>s.id===test.name)||(test.name.startsWith('linear-detail-')?SCENARIOS.find(s=>s.id==='linear-detail'):null);
  trace('opening');
  const run=await finch.open({...scenario.open,...(test.name.startsWith('linear-detail')?detailOptions:{}),sourceRoot:build==='before'||process.argv.includes('--control')?reference:root,
    width:test.warm?393:1440,height:test.warm?852:900,theme:test.theme,dsf:1,desktop:!test.warm,
    vendor:process.env.POCKET_FONT_DIR});
  const {page,state}=run;
  trace('booted');
  try {
    await page.waitForTimeout(scenario.settle||2000);
    trace('settled');
    if(test.name.startsWith('linear-detail')) {
      if(test.name.endsWith('-loading')) await page.evaluate(()=>{Object.assign(_prodState,{loading:false,terminalTailLoadedAt:0,terminalTailPending:true,terminalTailFailed:false});_prodOpenDeliverable('fixture-missing-deliverable');});
      else await openNativeCardDetail(page,!test.warm);
      if(test.name.endsWith('-menu')) await page.locator('.prod-detail-top [data-prod-tip="More options"]')[test.warm?'tap':'click']();
      if(test.name.endsWith('-empty')) await page.evaluate(()=>{Object.assign(_prodState,{loading:false,terminalTailLoadedAt:Date.now(),terminalTailPending:false,terminalTailFailed:false});_prodOpenDeliverable('fixture-missing-deliverable');});
      if(test.name.endsWith('-comment-draft')) await page.locator('.prod-composer-input').fill('A fictional feedback draft kept on this card.');
      if(test.name.endsWith('-description-edit')) { await page.locator('[data-prod-description-control=edit]')[test.warm?'tap':'click']();await page.locator('[data-prod-description-control=rich]').fill('A fictional description draft.'); }
      if(test.name.endsWith('-asset-edit')) {await page.locator('[data-prod-asset-edit=deliverable_file]')[test.warm?'tap':'click']();await page.locator('.prod-assets-input').fill('https://example.invalid/draft');}
    } else if(/^analytics-detail/.test(test.name)) {
      const link=test.warm?'.card-client-link':'.overview-table a.client-name-link';
      await page.locator(link,{hasText:test.name.endsWith('dash')?'Client C':'Client A'}).first().click();
      await page.waitForTimeout(2200);
    } else if(scenario.steps) await scenario.steps(page);
    if(test.warm) await page.setViewportSize({width:1440,height:900});
    await page.mouse.move(1439,899);
    await page.addStyleTag({content:freeze});
    trace('waiting for fonts');
    await page.waitForFunction(()=>document.fonts.status==='loaded',null,{timeout:10000});
    trace('fonts ready');
    await page.waitForTimeout(850);await page.evaluate(()=>document.activeElement?.blur());
    // Native focus/resize scrolling can leave a fixed navbar at a different
    // position in a full-page image. Compare the same document scroll state.
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(()=>[scrollX,scrollY]),[0,0],'Desktop comparison starts at the document origin');
    assert.deepEqual(state.errors,[],'Finch native fixture page error');
    assert.equal(state.writes.length,0,'Finch parity must not send a write: '+JSON.stringify(state.writes));
    const png=await page.screenshot({animations:'disabled',fullPage:true});
    trace('captured');
    // Capture clears emulated touch hover asynchronously. Normalize the pointer
    // again before comparing every style, rather than sampling half that transition.
    await page.mouse.move(1438,898);
    await page.waitForFunction(()=>!document.querySelector('.prod-icon-btn:hover,.prod-icon-btn:active'));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const styles=await page.evaluate(()=>Array.from(document.body.querySelectorAll('*')).map(n=>{const s=getComputedStyle(n);return [n.tagName,n.id,n.className,Array.from(s).sort().map(p=>[p,s.getPropertyValue(p).replaceAll(location.origin,'__FIXTURE_ORIGIN__')])];}));
    const pointerState=await page.locator('.prod-icon-btn').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,title:n.dataset.prodTip,hover:n.matches(':hover'),active:n.matches(':active'),focus:n.matches(':focus'),color:getComputedStyle(n).color,index:[...document.body.querySelectorAll('*')].indexOf(n),parent:n.parentElement.outerHTML.slice(0,500)})));
    return {png,styles,pointerState,styleHash:digest(JSON.stringify(styles))};
  } finally {trace('closing fixture');await run.close();trace('fixture closed');}
}
async function render(browser, origin, build, test) {
  if(test.finch) return renderFinch(build,test);
  staff.resetScenario();
  const st = staff.S.find(s=>s.name===test.name)||(/^(calendar-(month|loading|week-loading|long-content|thumbnail-prompt-normal)|samples-(sheet|loading|long-content))$/.test(test.name)?{setup:page=>prepare(page,test.name)}:null);
  if(st?.beforeBoot) st.beforeBoot();
  const ctx = await browser.newContext({viewport:{width:test.warm?393:1440,height:test.warm?852:900},hasTouch:true,reducedMotion:'reduce',timezoneId:'America/Guatemala'});
  const writes=[];
  if(st) { await staff.installBackend(ctx,st.editor); if(st.editor) await seedStaffIdentity(ctx,{id:'qa_editor',name:'QA Editor',role:'editor',team:'video'}); else await seedStaffGate(ctx); }
  else {
    const samples=test.name.startsWith('samples');
    const row={...client.BASE_ROW,id:'fixture_notes_parity',name:'A fictional card for Notes',scheduled_date:fixtureNow.toISOString().slice(0,10),video_deliverable_id:'00000000-0000-4000-a000-000000000001',graphic_deliverable_id:'00000000-0000-4000-a000-000000000002'};
    if(test.name.endsWith('unlinked')) {delete row.video_deliverable_id;delete row.graphic_deliverable_id;}
    await client.installFixture(ctx,origin,row,writes,samples?'samples':'calendar');
    if(!samples) await ctx.route('**/rest/v1/calendar_posts?**',r=>r.fulfill({status:200,headers:cors,json:[row,{id:'p_cal_settings',client:row.client,caption:JSON.stringify({collab_mode:true})}]}));
    await ctx.route('**/functions/v1/production-comments', r=>r.fulfill({status:200,headers:cors,json:{ok:true,canonical_thread:true,audience_scope:'client',comments:[],next_cursor:null}}));
    await ctx.route('**/functions/v1/thumbnail-revision-read',r=>r.fulfill({status:200,headers:cors,json:{ok:true,items:[]}}));
    await ctx.route('**/rest/v1/deliverables?**',r=>r.fulfill({status:200,headers:cors,json:[{id:row.video_deliverable_id,card_id:row.id,client_slug:row.client,team:'video',origin:samples?'samples':'calendar'},{id:row.graphic_deliverable_id,card_id:row.id,client_slug:row.client,team:'graphics',origin:samples?'samples':'calendar'}].filter(d=>d.id)}));
  }
  if(process.env.POCKET_FONT_DIR) {
    const css=[400,500,600,700,800].map(w=>`@font-face{font-family:'Plus Jakarta Sans';font-weight:${w};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(process.env.POCKET_FONT_DIR,'plus-jakarta-'+w+'.ttf')).toString('base64')}) format('truetype');font-display:block}`).join('\n');
    await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:css}));
  }
  const source=build==='before'||process.argv.includes('--control')?reference:root;
  await ctx.route(origin+'/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname.includes('__fixture')) return route.fallback();
    const file=path.resolve(source,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    assert(file.startsWith(source+path.sep),'Reference path leaves build');
    if(!fs.existsSync(file)) return route.fulfill({status:404,body:'Fixture build asset unavailable'});
    return route.fulfill({status:200,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'image/svg+xml',body:fs.readFileSync(file)});
  });
  await ctx.addInitScript(theme=>localStorage.setItem('syncview_theme',theme),test.theme);
  const page=await ctx.newPage(), errors=[];
  await page.clock.setFixedTime(fixtureNow);
  page.on('pageerror',e=>errors.push(e.message));
  try {
    if(st) {
      await page.goto(origin+'/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof navTo==='function');
      await page.evaluate(names=>{WL_CLIENT_NAMES.splice(0,WL_CLIENT_NAMES.length,...names);WL_CLIENT_CANONICAL.clear();names.forEach(n=>WL_CLIENT_CANONICAL.set(wlNormalizeClient(n),n));},staff.NAMES);
      await st.setup(page);
    } else {
      const samples=test.name.startsWith('samples');
      await page.goto(origin+'/index.html?c=Phone%20Fixture%20Client&t=synthetic-phone-token&v='+(samples?'sample-reviews&sxr=1':'calendar'),{waitUntil:'domcontentloaded'});
      await page.locator('.cal-review-card').first().waitFor();
      if(test.name.startsWith('client-calendar-')) {
        await page.evaluate(view=>{calState.view=view;calState.loading=true;_calRenderShell();_calRenderBody();},test.name.includes('-review-')?'review':'organizer');
        await page.locator('.cal-skeleton-loader').waitFor({state:'visible'});
      } else {
        await page.locator('[data-cal-view=organizer]').click();
        await page.locator('.cal-comments-btn').first().click();
        await page.locator(samples?'#sxrCommentsModal':'#calCommentsModal').waitFor({state:'visible'});
        if(test.name.endsWith('unlinked')) await page.getByText('Notes are not available',{exact:true}).waitFor();
        else await page.locator('.cal-cm-composer textarea').waitFor({state:'visible'});
      }
    }
    if(test.warm) await page.setViewportSize({width:1440,height:900});
    await page.addStyleTag({content:freeze});await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(600);await page.evaluate(()=>document.activeElement?.blur());
    await page.mouse.move(1439,899);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.deepEqual(errors,[],'Native fixture page error');assert.equal(writes.length,0,'Parity must not send a write');
    const png=await page.screenshot({animations:'disabled',fullPage:true});
    const styles=await page.evaluate(()=>Array.from(document.body.querySelectorAll('*')).map(n=>{const s=getComputedStyle(n);return [n.tagName,n.id,n.className,Array.from(s).sort().map(p=>[p,s.getPropertyValue(p)])];}));
    return {png,styles,styleHash:digest(JSON.stringify(styles))};
  } catch(error) {
    console.log('FIXTURE_STATE_DIAGNOSTIC '+JSON.stringify(await page.evaluate(()=>({view:typeof calState==='undefined'?null:calState.view,posts:typeof calState==='undefined'?null:calState.posts.length,loading:typeof calState==='undefined'?null:calState.loading,cards:document.querySelectorAll('.cal-card').length,reviewCards:document.querySelectorAll('.cal-review-card').length,notesButtons:document.querySelectorAll('.cal-comments-btn').length,activeViews:Array.from(document.querySelectorAll('.cal-view-btn.active')).map(n=>n.dataset.calView)}))));
    if(out) await page.screenshot({path:path.join(out,test.name+'-'+build+'-failure.png'),fullPage:true});
    throw error;
  } finally {await ctx.close();}
}
(async()=>{
  const server=await staff.serve(),origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
  const rows=[];
  if(out) {
    fs.mkdirSync(out,{recursive:true});
    const names=fs.readFileSync(path.join(root,'src/index/manifest.txt'),'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
    fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify({sourceHash:digest(Buffer.concat(names.map(name=>fs.readFileSync(path.join(root,'src/index',name))))),generatedIndexHash:digest(fs.readFileSync(path.join(root,'index.html'))),cases:cases.map(c=>({name:c.name,theme:c.theme,warm:!!c.warm})),startedAt:new Date().toISOString()},null,2)+'\n');
  }
  try {for(const test of cases) {
    const a=await render(browser,origin,'before',test),b=await render(browser,origin,'after',test);
    const label=test.name+'-'+test.theme+(test.warm?'-warm':'-cold');
    const row={label,width:1440,height:900,pixels:a.png.equals(b.png),styles:a.styleHash===b.styleHash,beforeHash:digest(a.png),afterHash:digest(b.png)};
    rows.push(row);
    if (!row.styles) {
      console.log('DESKTOP_POINTER_DIAGNOSTIC '+JSON.stringify({before:a.pointerState,after:b.pointerState}));
      const index=a.styles.findIndex((s,i)=>JSON.stringify(s)!==JSON.stringify(b.styles[i]));
      const left=a.styles[index],right=b.styles[index];
      console.log('DESKTOP_STYLE_DIAGNOSTIC '+JSON.stringify({index,beforeCount:a.styles.length,afterCount:b.styles.length,beforeNode:left?.slice(0,3),afterNode:right?.slice(0,3),differences:left?.[3].filter(([p,v])=>right?.[3].find(([q])=>p===q)?.[1]!==v).slice(0,8)}));
    }
    if(out) {if(!row.styles)fs.writeFileSync(path.join(out,label+'-styles.json'),JSON.stringify({before:a.styles,after:b.styles},null,2));fs.writeFileSync(path.join(out,label+'-before.png'),a.png);fs.writeFileSync(path.join(out,label+'-after.png'),b.png);fs.writeFileSync(path.join(out,'parity.json'),JSON.stringify(rows,null,2)+'\n');}
    assert(row.pixels && row.styles,label+': desktop differs');
    console.log('ok '+label+': desktop pixels and computed styles identical');
  }} finally {await browser.close();server.close();}
  console.log('FIXTURE_DESKTOP_PARITY: '+rows.length+'/'+cases.length+' exact 1440 desktop pairs; native Today/Notes/Analytics/Workload/TikTok/Card detail fixtures; cold and phone-to-desktop; no live writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
