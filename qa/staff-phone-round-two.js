'use strict';
// All transport answers and media are fictional. Never run against a live URL.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const staff=require('../docs/syncview-design/tests/staff-phone-browser');
const {seedStaffGate}=require('./staff-gate-seed');
const {prepare}=require('./staff-phone-final-pass');
const sourceRoot=path.resolve(__dirname,'..');
const constructors=['130-calendar-model-cache.js.part','170-calendar-links-status.js.part','270-samples-model.js.part'].map(file=>(fs.readFileSync(path.join(sourceRoot,'src/index',file),'utf8').match(/className\s*=\s*['"]cal-fld-status-menu['"]/g)||[]).length);
assert.deepEqual(constructors,[1,2,2],'A new shared-sheet constructor needs dismissal coverage');
const arg=(k,d)=>process.argv.find(s=>s.startsWith('--'+k+'='))?.slice(k.length+3)||d;
const before=process.argv.includes('--baseline'),out=arg('out',''),widths=arg('widths','390').split(',').map(Number);
const receipt=[],sheetChecks=[],failures=[],matrix=process.argv.includes('--matrix');
const media='<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="lavender"/><rect x="40" y="40" width="1000" height="1840" fill="none" stroke="slateblue" stroke-width="40"/><circle cx="540" cy="700" r="240" fill="thistle"/><text x="540" y="130" text-anchor="middle" font-size="70">TOP</text><text x="540" y="1800" text-anchor="middle" font-size="70">BOTTOM</text><text x="540" y="1400" text-anchor="middle" font-size="80">FICTIONAL CLIP</text></svg>';
async function capture(page,name,theme,width){
 await page.evaluate(()=>{const name=window.__roundTwoReviewerName||(window.__roundTwoReviewerName=document.getElementById('navKasper')?.textContent.trim());if(!name)return;const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walk.nextNode()){const n=walk.currentNode;if(!n.parentElement.closest('script,style')&&n.textContent.includes(name))n.textContent=n.textContent.replaceAll(name,'Reviewer');}});
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);
 if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,name+'-'+theme+'-'+width+'.png'),animations:'disabled'});}
}
async function main(){
 const server=await staff.serve(),browser=await chromium.launch({headless:!process.argv.includes('--visible')});
 try{for(const width of widths)for(const theme of ['light','dark']){
  staff.resetScenario();const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  await staff.installBackend(context);await seedStaffGate(context);
  await context.route('https://images.example.invalid/**',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:r.request().url().includes('landscape')?media.replace('width="1080" height="1920"','width="1920" height="1080"'):r.request().url().includes('square')?media.replace('width="1080" height="1920"','width="1080" height="1080"'):media}));
  await context.addInitScript(t=>localStorage.setItem('syncview_theme',t),theme);
  const page=await context.newPage();
  try{
   await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>typeof navTo==='function');
   await prepare(page,'calendar-sheet');
   await page.evaluate(()=>{Object.assign(calState.posts[0],{thumbnail_url:'https://images.example.invalid/portrait.png',video_deliverable_id:'00000000-0000-4000-a000-000000000001',graphic_deliverable_id:'00000000-0000-4000-a000-000000000002'});_calRenderBody();});
   await page.evaluate(()=>{localStorage.setItem('syncview_shared_client','Sample Client One');svClientBarSync();});
   const tabs=page.locator('[data-staff-menu=tabs]');await tabs.tap();
   await capture(page,'01-change-client',theme,width);
   if(!before){const row=page.locator('dialog[open] .sv-phone-change-client');assert.match(await row.textContent(),/Sample Client One/);assert.equal(await row.locator('svg').count(),1);await row.tap();await page.locator('.sv-phone-client-sheet[open]').waitFor();await page.getByRole('button',{name:'Close choose client'}).tap();}
   else await page.locator('dialog[open]').getByRole('button',{name:/Close/}).first().tap();
   await page.locator('[data-staff-menu=more]').tap();await capture(page,'02-more',theme,width);
   if(!before){assert.equal(await page.locator('dialog[open] .sv-phone-change-client').count(),0);assert.equal(await page.locator('dialog[open] [data-proxy=svClientBadge]').count(),0);const group=page.locator('dialog[open] .sv-phone-proxies');assert.deepEqual(await group.locator('h3').allTextContents(),['Appearance','Tools','Account']);assert.equal(await group.locator('button:not(:has(svg))').count(),0);assert.equal(await group.locator('button').last().getAttribute('data-proxy'),'staffIdentitySignOut');}
   await page.locator('dialog[open] > [class$="-body"]').evaluate(n=>n.scrollTop=n.scrollHeight);
   await capture(page,'02-more-account',theme,width);
   await page.locator('dialog[open]').getByRole('button',{name:/Close/}).first().tap();
   for(const palette of ['vibrant','classic']){
    await page.evaluate(palette=>{_syncviewApplyStatusPalette(palette,false);const row=calState.posts[0];row.video_status='Scheduled';row.graphic_status='Posted';row.caption_status='Approved';_calRenderBody();},palette);
    await page.waitForTimeout(300);await page.locator('.cal-card-substatus-row').first().scrollIntoViewIfNeeded();await capture(page,'03-status-'+palette,theme,width);
    if(!before){const checks=await page.locator('.cal-fld-substatus-trigger').evaluateAll(nodes=>nodes.map(n=>{const slug=[...n.classList].find(c=>c!=='cal-fld-status-item'&&c.startsWith('cal-fld-status-'))?.slice(15),probe=document.createElement('span');probe.style.background='var(--cal-status-'+slug+'-bg)';document.body.append(probe);const expected=getComputedStyle(probe).backgroundColor;probe.remove();return {actual:getComputedStyle(n).backgroundColor,expected};}));assert.equal(checks.length,3);checks.forEach(c=>assert.equal(c.actual,c.expected));const text=await page.locator('.cal-card-substatus-row').textContent();assert.match(text,/Scheduled/);assert.match(text,/Posted/);assert.match(text,/Approved/);}
    await page.locator('.cal-fld-setall').first().tap();await page.locator('.cal-fld-status-menu.open').waitFor();await capture(page,'03-status-menu-'+palette,theme,width);
    if(!before){const checks=await page.locator('.cal-fld-status-menu.open .cal-fld-status-item').evaluateAll(nodes=>nodes.map(n=>{const slug=[...n.classList].find(c=>c!=='cal-fld-status-item'&&c.startsWith('cal-fld-status-'))?.slice(15),probe=document.createElement('span');probe.style.background='var(--cal-status-'+slug+'-bg)';probe.style.color='var(--cal-status-'+slug+'-fg)';document.body.append(probe);const expected=getComputedStyle(probe),actual=getComputedStyle(n),match=actual.backgroundColor===expected.backgroundColor&&actual.color===expected.color;probe.remove();return match;}));assert.equal(checks.length,9);assert(checks.every(Boolean),'Every menu status must keep desktop palette colours');}
    await page.evaluate(()=>_calCloseStatusMenu());
   }
   await page.locator('.cal-fld-setall').first().tap();await page.locator('.cal-fld-status-menu.open').waitFor();await capture(page,'04-sheet-handle',theme,width);
   if(!before){const handle=page.locator('.cal-fld-status-menu.open .sv-phone-sheet-handle');await handle.tap();await page.waitForFunction(()=>!document.querySelector('.cal-fld-status-menu.open'));await page.locator('.cal-fld-setall').first().tap();const h=page.locator('.cal-fld-status-menu.open .sv-phone-sheet-handle');await h.waitFor();await h.evaluate(n=>{n.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:7,clientY:100}));n.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:7,clientY:185}));});await page.waitForFunction(()=>!document.querySelector('.cal-fld-status-menu.open'));}
   else await page.evaluate(()=>_calCloseStatusMenu());
   await page.evaluate(()=>{const row=calState.posts[0];row.video_status=row.graphic_status=row.caption_status='For SMM Approval';_calRenderBody();});
   await page.locator('.cal-card-thumb > img').first().waitFor();await page.waitForFunction(()=>document.querySelector('.cal-card-thumb>img')?.naturalWidth>0);
   await page.evaluate(()=>window.scrollTo(0,0));await capture(page,'05-thumbnail',theme,width);
   if(!before){const m=await page.locator('.cal-card-thumb > img').first().evaluate(n=>({w:n.width,h:n.height,nw:n.naturalWidth,nh:n.naturalHeight,fit:getComputedStyle(n).objectFit}));assert.equal(m.fit,'contain');assert(Math.abs(m.w/m.h-m.nw/m.nh)<.01);assert(m.h>=300);}
   if(matrix&&!before){
    for(const surface of ['calendar','samples']){
     await prepare(page,surface+'-sheet');
     await page.evaluate(surface=>{const row=(surface==='samples'?sxrState:calState).posts[0];Object.assign(row,{video_deliverable_id:'00000000-0000-4000-a000-000000000001',graphic_deliverable_id:'00000000-0000-4000-a000-000000000002',title_status:'For SMM Approval',thumbnail_url:'https://images.example.invalid/portrait.png'});surface==='samples'?_sxrRenderBody():_calRenderBody();},surface);
     for(const component of surface==='samples'?['video','graphic','all']:['video','graphic','caption','title','all','alternate-caption'])for(const dismiss of ['tap','drag','touch-drag','escape']){
      await page.evaluate(({surface,component})=>{const row=(surface==='samples'?sxrState:calState).posts[0],trigger=document.querySelector('.cal-fld-setall'),event={stopPropagation(){},preventDefault(){}};if(component==='alternate-caption')_calCapTabAddMenu(event,row.id,trigger);else if(component==='all')(surface==='samples'?_sxrOpenSetAllMenu:_calOpenSetAllMenu)(event,row.id,trigger);else (surface==='samples'?_sxrStatusToggleMenu:_calStatusToggleMenu)(event,row.id,trigger,component);},{surface,component});
      const handle=page.locator('.cal-fld-status-menu.open .sv-phone-sheet-handle');await handle.waitFor();
      const size=await handle.boundingBox();assert(size.width>=44&&size.height>=44);
      if(dismiss==='tap')await handle.tap();else if(dismiss==='escape')await page.keyboard.press('Escape');else if(dismiss==='touch-drag'){const cdp=await context.newCDPSession(page);const x=size.x+size.width/2,y=size.y+size.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+80}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else{await page.mouse.move(size.x+size.width/2,size.y+size.height/2);await page.mouse.down();await page.mouse.move(size.x+size.width/2,size.y+size.height/2+80,{steps:8});await page.mouse.up();}
      await page.waitForFunction(()=>!document.querySelector('.cal-fld-status-menu.open'));
      assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('sv-phone-locked')),false,'Dismissal must unlock the page');
      sheetChecks.push({surface,component,dismiss,width,theme});
     }
     // Reopening More keeps the native controls; resizing restores their labels/icons.
     for(let i=0;i<2;i++){await page.locator('[data-staff-menu=more]').tap();const dialog=page.locator('dialog[open]');assert.equal(await dialog.locator('.sv-phone-proxies').count(),1);assert.equal(await dialog.locator('.cal-zoom').count(),1);await dialog.getByRole('button',{name:/Close/}).first().tap();}
     await page.setViewportSize({width:1024,height:844});await page.waitForTimeout(400);
     assert.equal(await page.locator('.sv-phone-more-icon,[data-sv-phone-original-label],.sv-phone-sheet-handle').count(),0,'Phone adornments leaked after resize');
     await page.setViewportSize({width,height:844});await page.waitForTimeout(400);
     for(const shape of ['portrait','landscape','square']){
      await prepare(page,surface+'-sheet');await page.evaluate(({surface,shape})=>{(surface==='samples'?sxrState:calState).posts[0].thumbnail_url='https://images.example.invalid/'+shape+'.png';surface==='samples'?_sxrRenderBody():_calRenderBody();},{surface,shape});
      const image=page.locator('.cal-card-thumb > img').first();await image.scrollIntoViewIfNeeded();await image.evaluate(n=>n.decode());
      const box=await image.evaluate(n=>{const r=n.getBoundingClientRect();return {ratio:r.width/r.height,natural:n.naturalWidth/n.naturalHeight,fit:getComputedStyle(n).objectFit};});assert.equal(box.fit,'contain');assert(Math.abs(box.ratio-box.natural)<.01,surface+' '+shape+' thumbnail stretched');
     }
    }
   }
   receipt.push({width,theme});console.log('ok round-two '+width+' '+theme);
  }catch(e){failures.push(width+' '+theme+': '+e.message);console.error('FAIL '+failures.at(-1));}finally{await context.close();}
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
 if(out)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({before,receipt,sheetChecks,failures},null,2)+'\n');
 console.log('STAFF_PHONE_ROUND_TWO: '+receipt.length+' width/theme journeys; '+sheetChecks.length+' sheet dismissals; '+failures.length+' failures; fictional data only');
 if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
