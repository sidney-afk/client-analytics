'use strict';
// Native generated app, invented data, retained visible browser when preloaded.
// --before-root=<checkout> captures the identical journeys against main.
// --shots=<directory> --widths=360,390,430 --only=<regexp> --report=<json>
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require('playwright');
const { SCENARIOS } = require('./finch-phone/scenarios');
const staff = require('../docs/syncview-design/tests/staff-phone-browser');
const { seedStaffGate } = require('./staff-gate-seed');
const arg = (key, fallback) => process.argv.find(x => x.startsWith('--' + key + '='))?.slice(key.length + 3) || fallback;
const before = !!arg('before-root', '');
if (before) process.env.FINCH_ROOT = arg('before-root', '');
const { open } = require('./finch-phone/harness');
const widths = arg('widths', '360,390,430').split(',').map(Number);
const only = new RegExp(arg('only', '.*'));
const shots = arg('shots', ''), receipts = [], failures = [];
const settle = p => p.waitForTimeout(850);
const core = SCENARIOS.filter(s => ['analytics-overview','analytics-detail','workload-week','linear-list','linear-detail','tiktok-client-ready','instagram-client-ready','menu-tabs','menu-more','menu-client'].includes(s.id)).map(s => ({ ...s, name: s.id }));
core.push({...SCENARIOS.find(s=>s.id==='linear-list'),name:'linear-project',steps:async p=>{
  await p.evaluate(()=>{const id=Object.keys(_prodProjects()).find(k=>_prodIssues().some(i=>i.project===k));if(!id)throw new Error('Missing fictional project fixture');_prodOpenProject(id);});
  await p.waitForSelector('[data-prod-project-detail]');await settle(p);
}});
for (const [name, base] of [['analytics-client-picker','analytics-overview'],['workload-client-picker','workload-week'],['linear-client-picker','linear-list']]) {
  core.push({...SCENARIOS.find(s=>s.id===base),name,steps:async p=>{
    if(before) await p.evaluate(()=>document.getElementById('svClientBadge').click());
    else {await p.locator('#fphMoreBtn').click();await p.getByRole('button',{name:'Change client',exact:true}).click();}
    await settle(p);
  }});
}
const states = staff.S.filter(s => /^(templates-client|templates-client-edit|templates-client-spec-form|today-rings|today-walk|submit|sheet-tabs|sheet-more)$/.test(s.name));
const cases = ['calendar-sheet','calendar-empty','calendar-more','calendar-tabs','samples-sheet','samples-empty','samples-more','samples-tabs','today-cleared'];
async function phoneMeasure(page) {
  return page.evaluate(() => {
    const visible = el => el.checkVisibility({ checkVisibilityCSS: true }) && !el.closest('dialog:not([open]), .header');
    const controls = [...document.querySelectorAll('button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, [role=button]')].filter(visible);
    return { width: innerWidth, pageWidth: document.documentElement.scrollWidth,
      small: controls.map(el => { const r = el.getBoundingClientRect(); return { selector: el.id || el.className, w: r.width, h: r.height }; }).filter(r => r.w < 43.5 || r.h < 43.5),
      smallText: controls.filter(el => /INPUT|TEXTAREA|SELECT/.test(el.tagName) && el.type !== 'color' && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id || el.className) };
  });
}
async function verify(page, name, width, theme) {
  await settle(page); await page.evaluate(() => document.fonts.ready);
  const m = await phoneMeasure(page);
  const faults = [];
  if (!before) {
    if (m.pageWidth > width + 1) faults.push('sideways page scroll');
    if (m.small.length) faults.push('targets under 44px: ' + JSON.stringify(m.small.slice(0, 5)));
    if (m.smallText.length) faults.push('fields below 16px: ' + m.smallText.join(', '));
    if (name === 'analytics-overview' && await page.locator('.overview-table').count()) faults.push('phone defaults to desktop table');
    if (/^(calendar|samples)-more$/.test(name) && await page.locator('dialog[open] #svClientBadgeWrap, dialog[open] #staffIdentityWrap, dialog[open] .sv-jump-touch').count()) faults.push('raw desktop controls in More');
    if (name.endsWith('more')) {
      if (!await page.locator('#staffIdentitySignOut').evaluate(button => typeof button.onclick === 'function')) faults.push('staff proxy has no native handler');
      if (!await page.locator('#staffAccountPopover').isHidden()) faults.push('old staff popover remained open');
    }
    if (/^(calendar|samples)-empty$/.test(name) && await page.getByRole('button', {name: 'Choose client', exact: true}).count() !== 1) faults.push('missing Choose client action');
    if (/^(calendar|samples)-sheet$/.test(name)) {
      const segments = await page.locator('.cal-view-toggle .cal-view-btn').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {width:r.width,badge:n.querySelector('.cal-view-badge')?.getBoundingClientRect().right,right:r.right};}));
      if(Math.max(...segments.map(x=>x.width))-Math.min(...segments.map(x=>x.width))>1) faults.push('unequal segments');
      if(segments.some(x=>x.badge&&x.badge>x.right-1)) faults.push('review count spills into next segment');
    }
    if (name === 'menu-client' || name.endsWith('client-picker')) {
      if (!await page.locator('.sv-phone-client-sheet[open]').count()) faults.push('picker lacks modal sheet');
      await page.locator('#svClientSearch').fill('Client A'); await settle(page);
      await page.locator('.sv-phone-client-sheet [data-sv-client]').first().click(); await settle(page);
      if (await page.locator('.sv-phone-client-sheet[open]').count()) faults.push('native picker did not close after choice');
      if (name === 'menu-client' && width === 390 && theme === 'light') {
        await page.evaluate(() => { svPhoneOpenClientPicker(); svPhoneOpenClientPicker(); });
        assert.equal(await page.locator('.sv-phone-client-sheet[open]').count(), 1, 'duplicate picker sheet');
        await page.keyboard.press('Escape'); await settle(page);
        assert.equal(await page.locator('.sv-phone-client-sheet').count(), 0, 'Escape did not remove picker');
        await page.evaluate(() => svPhoneOpenClientPicker());
        await page.getByRole('button', {name:'Close choose client'}).click(); await settle(page);
        assert.equal(await page.locator('.sv-phone-client-sheet').count(), 0, 'close button did not remove picker');
        await page.evaluate(() => svPhoneOpenClientPicker());
        await page.setViewportSize({width:1024,height:844}); await settle(page);
        assert.equal(await page.locator('.sv-phone-client-sheet').count(), 0, 'picker remained open at desktop width');
        assert.ok(await page.locator('#svClientPop').evaluate(pop => !!pop.closest('#svClientBar')), 'native picker was not restored to its desktop parent');
        await page.setViewportSize({width,height:844}); await settle(page);
      }
    }
    if (/^(calendar|samples)-tabs$/.test(name)) {
      const reviewerLabel = await page.locator('#headerNav > .header-nav-btn').last().textContent();
      const b = await page.locator('dialog[open] button', {hasText:reviewerLabel.trim()}).boundingBox();
      if (b && b.y + b.height > 843) faults.push('reviewer tab below fold');
    }
  }
  // Screenshot the picker before exercising its choice above.
  if (name !== 'menu-client' && !name.endsWith('client-picker') && shots) await capture(page, name, width, theme);
  if (!before && name === 'analytics-overview' && width === 390 && theme === 'light') {
    const saved = await page.evaluate(()=>localStorage.getItem('syncview_viewMode'));
    await page.getByTitle('Show as table').click(); await settle(page);
    assert.equal(await page.locator('.overview-table').count(),1,'table choice was removed');
    await page.getByTitle('Show as cards').click(); await settle(page);
    await page.setViewportSize({width:1024,height:844});await settle(page);
    assert.equal(await page.locator('.overview-table').count(),1,'phone overwrote desktop view choice');
    await page.setViewportSize({width,height:844});await settle(page);
    assert.equal(await page.locator('.overview-table').count(),0,'phone card choice did not survive resize');
    assert.equal(await page.evaluate(()=>localStorage.getItem('syncview_viewMode')),saved,'desktop saved preference changed');
  }
  if (!before && /^(tiktok|instagram)-client-ready$/.test(name) && width === 390) {
    const label=page.locator('.tk-drop-title').first();
    await page.evaluate(()=>window.__phoneDropTitle=document.querySelector('.tk-drop-title'));
    assert.match(await label.textContent(),/tap to (browse|add)/,'phone browse copy is missing');
    await page.setViewportSize({width:1024,height:844});await settle(page);
    assert.match(await label.textContent(),/click to (browse|add)/,'phone browse copy remained on desktop');
    assert.ok(await page.evaluate(()=>window.__phoneDropTitle===document.querySelector('.tk-drop-title')),'resize rebuilt the file chooser');
    await page.setViewportSize({width,height:844});await settle(page);
    assert.match(await label.textContent(),/tap to (browse|add)/,'phone browse copy did not return');
  }
  if (!before && name === 'linear-detail' && width === 390) {
    await page.evaluate(() => {const rows=_prodIssues();if(rows.length<2)throw new Error('Missing fictional hierarchy fixture');rows[1].parent=rows[0].id;_prodOpenDeliverable(rows[1].id);});
    await settle(page);
    const crumb=page.locator('.prod-detail-crumb');
    const original=await crumb.innerHTML();
    assert.equal(await crumb.locator(':scope > b').count(),0,'child breadcrumb changed the native desktop markup');
    assert.notEqual(await crumb.evaluate(n=>getComputedStyle(n,'::after').content),'none','phone issue ID is missing');
    await page.setViewportSize({width:1024,height:844});await settle(page);
    assert.equal(await crumb.innerHTML(),original,'resize rebuilt the issue breadcrumb/editor');
    assert.equal(await crumb.evaluate(n=>getComputedStyle(n,'::after').content),'none','phone abbreviation remained on desktop');
    assert.ok(await crumb.locator('[data-prod-crumb-batch]').isVisible(),'desktop parent breadcrumb did not return');
    await page.setViewportSize({width,height:844});await settle(page);
  }
  if (!before && name === 'sheet-tabs') {
    await page.evaluate(() => {window.__phoneNavClicks=0;document.getElementById('navCalendar').addEventListener('click',()=>window.__phoneNavClicks++);});
    await page.locator('dialog[open] [data-nav="navCalendar"]').click();
    assert.equal(await page.evaluate(()=>window.__phoneNavClicks),1,'shared Tabs dispatched the native action more than once');
    assert.equal(await page.evaluate(()=>currentNav),'calendar','shared Tabs did not reach Calendar');
  }
  if (!before && name === 'linear-project') {
    const targets = await page.locator('[data-prod-project-issue] .prod-status, [data-prod-project-issue] .prod-check, [data-prod-project-issue] .prod-due, [data-prod-project-issue] .prod-assign-hot').evaluateAll(nodes => nodes.map(n => {const r=n.getBoundingClientRect();return {w:r.width,h:r.height};}));
    assert.ok(targets.length && targets.every(r => r.w >= 43.5 && r.h >= 43.5), 'project status/selection/date/assignee target below 44px');
    const check = page.locator('[data-prod-project-issue] [data-prod-row-check]').first();
    const id = await check.getAttribute('data-prod-row-check');
    await check.click();
    assert.ok(await page.evaluate(id => _prodState.selected.has(id), id), 'native row selection did not activate');
    const selected = page.locator('[data-prod-project-issue] [data-prod-row-check].on').first();
    assert.equal(await selected.getAttribute('data-prod-row-check'), id, 'selected row changed');
    await selected.click();
    assert.ok(!await page.evaluate(id => _prodState.selected.has(id), id), 'native row selection did not clear');
  }
  receipts.push({name,width,theme,...m,problems:faults});
  failures.push(...faults.map(x => `${name} ${width} ${theme}: ${x}`));
  console.log((faults.length ? 'FAIL ' : 'ok ') + name + ' ' + width + ' ' + theme + (faults.length ? ': ' + faults.join('; ') : ''));
}
async function capture(page,name,width,theme) {
  fs.mkdirSync(shots,{recursive:true});
  // Public pictures name the reviewer surface generically; destinations and handlers stay native.
  await page.evaluate(() => {
    const label=document.querySelector('#headerNav > .header-nav-btn:last-child')?.textContent.trim();
    if(!label||label.length<3)return;
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {const n=walker.currentNode;if(!n.parentElement.closest('script,style')&&n.textContent.includes(label))n.textContent=n.textContent.split(label).join('Reviewer');}
  });
  await page.screenshot({path:path.join(shots,`${name}-${theme}-${width}.png`),fullPage:!await page.locator('dialog[open]').count()});
}
async function prepare(page,name) {
  if (name === 'today-cleared') {
    await page.evaluate(() => navTo('today')); await page.waitForFunction(() => !!tdyState.data);
    await page.evaluate(() => { tdyState.data.done = [{id:'fixture-cleared',client_slug:'sample-one',title:'A longer cleared task title for a narrow phone',status_at:new Date().toISOString()}]; _tdyPaint(); }); return;
  }
  const samples=name.startsWith('samples');
  await page.evaluate(samples => navTo(samples ? 'sample-reviews' : 'calendar'), samples); await settle(page);
  await page.evaluate(({samples,empty}) => {
    const row = {id:'phone_fixture_post',client:'sample-one',name:'A calmer start to the day',status:'For SMM Approval',video_status:'For SMM Approval',graphic_status:'For SMM Approval',caption_status:'For SMM Approval',caption:'A fictional caption.',scheduled_date:'2026-10-06',thumbnail_url:'https://images.example.invalid/phone-fixture.svg',asset_url:'https://example.invalid/fixture-video.mp4'};
    if (samples) { sxrState.loading=false; sxrState.error='';sxrState.client=empty?'':'Sample Client One';sxrState.posts=empty?[]:[row];sxrState.view='organizer';_sxrRenderShell();_sxrRenderBody(); }
    else { _calInvalidateActiveLoad();calState.loading=false;calState.error='';calState.client=empty?'':'Sample Client One';calState.posts=empty?[]:[row];calState.view='organizer';calState.monthFilter='all';calState.statusFilter='all';_calRenderShell();_calRenderBody(); }
  }, {samples,empty:name.endsWith('empty')});
  await settle(page);
  if (name.endsWith('more') || name.endsWith('tabs')) await page.locator('[data-staff-menu='+(name.endsWith('more')?'more':'tabs')+']').click();
}
(async()=>{
  for (const s of core.filter(s=>only.test(s.name))) for(const width of widths) for(const theme of ['light','dark']) {
    const h=await open({...s.open,width,theme,dsf:1});
    try { await h.page.waitForTimeout(s.settle||3000);
      if(s.name==='analytics-detail') { await h.page.locator(before?'.overview-table a.client-name-link':'.card-client-link',{hasText:'Client A'}).first().click();await h.page.waitForTimeout(2200); }
      else if(s.steps) await s.steps(h.page);
      if((s.name==='menu-client'||s.name.endsWith('client-picker'))&&shots) {await settle(h.page);await capture(h.page,s.name,width,theme);}
      await verify(h.page,s.name,width,theme);
      assert.equal(h.state.errors.length,0,'page errors');
    }catch(e){failures.push(s.name+' '+width+' '+theme+': '+e.message.split('\n')[0]);console.log('FAIL '+failures.at(-1));}finally{await h.close();}
  }
  const server=await staff.serve(), origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch();
  try {for(const st of [...states,...cases.map(name=>({name,setup:p=>prepare(p,name)}))].filter(s=>only.test(s.name))) for(const width of widths) for(const theme of ['light','dark']) {
    staff.resetScenario();const ctx=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    await staff.installBackend(ctx,false);await seedStaffGate(ctx);await ctx.addInitScript(t=>localStorage.setItem('syncview_theme',t),theme);
    await ctx.route('https://images.example.invalid/**', r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="lavender"/><circle cx="750" cy="380" r="210" fill="thistle"/><path d="M0 950Q500 600 1080 1000V1350H0Z" fill="slateblue"/></svg>'}));
    const p=await ctx.newPage();
    try {await p.goto(origin+'/');await p.waitForFunction(()=>typeof navTo==='function');await settle(p);
      await p.evaluate(names=>{window.__seedRoster=WL_CLIENT_NAMES.slice();WL_CLIENT_NAMES.splice(0,WL_CLIENT_NAMES.length,...names);WL_CLIENT_CANONICAL.clear();names.forEach(n=>{WL_CLIENT_CANONICAL.set(wlNormalizeClient(n),n);clientMap[n]={instagram_handle:'sample.one',tiktok_handle:'sampleone',youtube_channel_id:'UCsample0000000000000000'};});wlMergeClientsFromSheet(names);},staff.NAMES);
      await st.setup(p);await verify(p,st.name,width,theme);
      const leaked=await p.evaluate(()=> (window.__seedRoster||[]).filter(n=>n&&document.body.innerText.toLowerCase().includes(n.toLowerCase())).length);assert.equal(leaked,0,'built-in identity visible');
    }catch(e){failures.push(st.name+' '+width+' '+theme+': '+e.message.split('\n')[0]);console.log('FAIL '+failures.at(-1));}finally{await ctx.close();}
  }}finally{await browser.close();server.close();}
  if(arg('report',''))fs.writeFileSync(arg('report',''),JSON.stringify({receipts,failures},null,2)+'\n');
  console.log(`staff-phone-final-pass: ${receipts.length} renders, ${failures.length} problems${before?' (baseline capture)':''}`);
  if(failures.length&&!before)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
