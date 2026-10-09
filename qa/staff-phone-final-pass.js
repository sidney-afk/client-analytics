'use strict';
// Native generated app, invented data, headless browser by default.
// --before-root=<checkout> captures the identical journeys against main.
// --shots=<directory> --widths=360,390,430 --only=<regexp> --report=<json>
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require('playwright');
const { SCENARIOS } = require('./finch-phone/scenarios');
const staff = require('../docs/syncview-design/tests/staff-phone-browser');
const { seedStaffGate, seedStaffIdentity } = require('./staff-gate-seed');
const phoneRules = require('./staff-phone-rule-checks');
const { heightFor } = require('./client-phone/profiles');
const arg = (key, fallback) => process.argv.find(x => x.startsWith('--' + key + '='))?.slice(key.length + 3) || fallback;
const before = !!arg('before-root', '');
if (before) process.env.FINCH_ROOT = arg('before-root', '');
const { open } = require('./finch-phone/harness');
const widths = arg('widths', '360,390,430').split(',').map(Number);
const themes = arg('themes', 'light,dark').split(',');
assert(themes.every(theme=>['light','dark'].includes(theme)), 'Invalid themes');
const only = new RegExp(arg('only', '.*'));
const shots = arg('shots', ''), receipts = [], failures = [];
const allStates = process.argv.includes('--all-states');
const settle = p => p.waitForTimeout(850);
async function analyticsAxes(page) {
  return page.evaluate(()=>{
    const rgb=value=>{
      if(value.startsWith('#')) { let h=value.slice(1);if(h.length===3)h=h.split('').map(c=>c+c).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)); }
      return value.match(/[\d.]+/g).map(Number);
    };
    const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    return Object.values(window.Chart?.instances||{}).filter(chart=>chart.canvas.closest('.client-view')&&chart.canvas.checkVisibility({checkVisibilityCSS:true})).flatMap(chart=>{
      let background=[255,255,255];
      for(let parent=chart.canvas;parent;parent=parent.parentElement) {const color=rgb(getComputedStyle(parent).backgroundColor);if(color.length===3||color[3]===1){background=color;break;}}
      return Object.values(chart.scales).filter(scale=>scale.options.display!==false).map(scale=>{
        const front=luminance(rgb(scale.options.ticks.color)),back=luminance(background);
        return {chart:chart.canvas.id,axis:scale.id,font:scale.options.ticks.font.size,color:scale.options.ticks.color,contrast:(Math.max(front,back)+.05)/(Math.min(front,back)+.05)};
      });
    });
  });
}
const core = SCENARIOS.filter(s => ['analytics-overview','analytics-detail','workload-week','linear-list','linear-detail','tiktok-client-ready','instagram-client-ready','menu-tabs','menu-more','menu-client'].includes(s.id)).map(s => ({ ...s, name: s.id }));
core.push({...SCENARIOS.find(s=>s.id==='tiktok-client-ready'),name:'tiktok-client-search',steps:async p=>{
  await SCENARIOS.find(s=>s.id==='tiktok-client-ready').steps(p);
  await p.locator('#tkClientInput').fill('Client B');await settle(p);
}});
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
if (allStates) {
  for (const s of SCENARIOS) if (!core.some(c=>c.name===s.id)) core.push({...s,name:s.id});
  for (const s of staff.S) if (!states.some(c=>c.name===s.name)) states.push(s);
  // The old journey looked for the retired sheet class. Follow the current
  // visible native controls rather than treating a stale selector as a defect.
  const picker = states.find(s=>s.name==='client-picker');
  if (picker && !before) picker.setup=async p=>{
    await p.evaluate(()=>navTo('templates'));await settle(p);
    await p.locator('.pocket-staff-more-btn, #fphMoreBtn, [data-staff-menu=more]').filter({visible:true}).first().tap();
    await p.getByRole('button',{name:'Change client',exact:true}).tap();await settle(p);
  };
  // These journeys predate the phone's native card preference. Reach the
  // existing content link on the card; all downstream native controls remain.
  for (const s of core.filter(s=>/^analytics-(detail|content-calendar|brief)/.test(s.name))) s.steps=async p=>{
    await p.locator('.card-client-link').filter({hasText:s.name==='analytics-detail-dash'?'Client C':'Client A'}).first().tap();await p.waitForTimeout(2200);
    if(s.name==='analytics-content-calendar')await p.getByRole('button',{name:'Content Calendar',exact:true}).tap();
    if(s.name==='analytics-brief')await p.locator('.view-tab-btn').filter({hasText:'Brief'}).tap();
  };
}
const cases = ['calendar-sheet','calendar-empty','calendar-more','calendar-tabs','samples-sheet','samples-empty','samples-more','samples-tabs','today-cleared',
  ...['calendar','samples'].flatMap(tab=>['review','no-posts','loading','long-content','many'].map(kind=>tab+'-'+kind)),
  'calendar-month','calendar-week','calendar-card-detail','calendar-card-notes','samples-card-notes'];
async function phoneMeasure(page) {
  return page.evaluate(() => {
    const visible = el => el.checkVisibility({ checkVisibilityCSS: true }) && !el.closest('dialog:not([open]), .header');
    const controls = [...document.querySelectorAll('button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, [role=button]')].filter(visible);
    return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
      small: controls.map(el => { const r = el.getBoundingClientRect(); return { selector: el.id || el.className, w: r.width, h: r.height }; }).filter(r => r.w < 43.5 || r.h < 43.5),
      smallText: controls.filter(el => /INPUT|TEXTAREA|SELECT/.test(el.tagName) && el.type !== 'color' && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id || el.className) };
  });
}
async function verify(page, name, width, theme) {
  await settle(page); await page.evaluate(() => document.fonts.ready);
  let fonts;
  if(shots) {
    fonts=await page.evaluate(async()=>{
      const weights=[400,500,600,700,800];
      for(const weight of weights) await document.fonts.load(weight+' 16px "Plus Jakarta Sans"');
      return weights.map(weight=>({weight,loaded:[...document.fonts].some(face=>face.family.replace(/["']/g,'')==='Plus Jakarta Sans' && Number(face.weight)===weight && face.status==='loaded')}));
    });
    assert.ok(fonts.every(face=>face.loaded),'Native screenshot requires every fixture font weight; fallback typography is not acceptance proof');
  }
  const m = await phoneMeasure(page);
  const faults = [];
  if (!before) {
    if(name==='workload-loading') {
      const loading=await page.locator('.workload-overview-row.is-skeleton').evaluateAll(rows=>rows.map(row=>({empty:getComputedStyle(row,'::after').content,shape:getComputedStyle(row.querySelector('.sv-skeleton')).backgroundColor,card:getComputedStyle(row).backgroundColor})));
      assert.ok(loading.length && loading.every(row=>!row.empty.includes('Nothing overdue') && row.shape!==row.card),'Unknown workload must not claim empty work; loading shapes must remain visible in both themes');
      assert.ok(await page.locator('.workload-skeleton-card .sv-skeleton').evaluateAll(shapes=>shapes.length>0&&shapes.every(shape=>getComputedStyle(shape).backgroundColor!==getComputedStyle(shape.parentElement).backgroundColor)),'Workload calendar loading shapes remain visible against their cards in both themes');
    }
    if(name==='tiktok-client-ready') {
      const text=await page.evaluate(()=>{
        const rgb=value=>value.match(/[\d.]+/g).map(Number);
        const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const nodes=[...document.querySelectorAll('.tk-queue-empty,.tk-preview-card h3,.tk-preview-card h3 span,.tk-card textarea[placeholder],.tk-card input[placeholder]')].filter(node=>node.checkVisibility({checkVisibilityCSS:true}));
        return nodes.map(node=>{
          const placeholder=node.matches('textarea,input'),style=getComputedStyle(node,placeholder?'::placeholder':null);
          let background=[255,255,255,1];
          for(let parent=node;parent;parent=parent.parentElement){const color=rgb(getComputedStyle(parent).backgroundColor);if(color.length===3||color[3]===1){background=color;break;}}
          const foreground=luminance(rgb(style.color)),back=luminance(background);
          return {selector:node.id||node.className,font:parseFloat(style.fontSize),opacity:Number(style.opacity),contrast:(Math.max(foreground,back)+.05)/(Math.min(foreground,back)+.05)};
        });
      });
      assert.ok(text.length&&text.every(node=>node.font>=13&&node.opacity===1&&node.contrast>=4.5),'TikTok supporting text and placeholders are readable: '+JSON.stringify(text));
    }
    if(name==='workload-empty') assert.ok(await page.locator('.workload-overview-row:not(.is-skeleton)').evaluateAll(rows=>rows.length>0 && rows.every(row=>getComputedStyle(row,'::after').content.includes('Nothing overdue'))),'Loaded empty workload keeps its truthful empty explanation');
    if(name==='analytics-loading') {
      const loader=await page.locator('.analytics-overview-skeleton').evaluate(node=>({gap:node.getBoundingClientRect().top-document.getElementById('pageTop').getBoundingClientRect().bottom,label:getComputedStyle(node,'::before').content,rows:[...node.querySelectorAll('tbody tr')].map(row=>{const box=row.getBoundingClientRect();return {left:box.left,right:box.right,height:box.height,radius:parseFloat(getComputedStyle(row).borderRadius)};})}));
      assert.ok(loader.label.includes('Loading analytics') && loader.gap>=8 && loader.gap<=32,'Analytics loading identifies its state with a compact gap after search');
      assert.ok(loader.rows.length && loader.rows.every(row=>row.left>=15 && row.right<=width-15 && row.height>=200 && row.height<=350 && row.radius>=20),'Analytics loading cards are complete, rounded and contained in the phone');
      assert.ok(await page.locator('.analytics-overview-skeleton tbody td').evaluateAll(cells=>cells.filter(cell=>cell.checkVisibility({checkVisibilityCSS:true})).every(cell=>['Top','Right','Bottom','Left'].every(side=>parseFloat(getComputedStyle(cell)['border'+side+'Width'])===0))),'Analytics loading bars must not inherit colored metric-cell borders');
    }
    if(name.startsWith('analytics-') && name!=='analytics-loading') {
      const text=await page.evaluate(()=>{
        const rgb=value=>value.match(/[\d.]+/g).map(Number);
        const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        return [...document.querySelectorAll('.card-platform-label,.card-metric-label,.card-metric-gain,.card-platform a span,.platform-handle-link,.m-label,.m-value.empty,.m-delta,.gain-chip-label,.gain-delta,.card-platform .analytics-state-badge')].filter(node=>node.checkVisibility({checkVisibilityCSS:true})).map(node=>{
          const style=getComputedStyle(node);let background=[255,255,255,1];
          for(let parent=node;parent;parent=parent.parentElement){const color=rgb(getComputedStyle(parent).backgroundColor);if(color.length===3||color[3]===1){background=color;break;}}
          const color=rgb(style.color),alpha=color[3]??1;
          const front=luminance(color.map((v,i)=>i<3?v*alpha+background[i]*(1-alpha):v)),back=luminance(background);
          return {selector:node.className||node.parentElement.className,font:parseFloat(style.fontSize),opacity:Number(style.opacity),contrast:(Math.max(front,back)+.05)/(Math.min(front,back)+.05)};
        });
      });
      const unreadable=text.filter(node=>node.font<13||node.opacity!==1||node.contrast<4.5);
      if(unreadable.length) faults.push('Analytics supporting text below 13px or 4.5 contrast: '+JSON.stringify(unreadable.slice(0,12)));
      if(name.startsWith('analytics-detail')) {
        const axes=await analyticsAxes(page);
        if(axes.length<4||axes.some(axis=>axis.font<13||axis.contrast<4.5)) faults.push('Analytics chart labels below 13px or 4.5 contrast: '+JSON.stringify(axes));
      }
    }
    if (name === 'today-all-clear') {
      assert.ok(await page.locator('.tdy-rings').isHidden(), 'empty day must not repeat five zero-item job tiles');
      const heading = await page.locator('.tdy-win h2').boundingBox();
      assert.ok(heading && heading.y + heading.height < heightFor(width, arg('height')), 'All clear must be visible without scrolling');
    }
    if (name === 'today-loading') assert.ok(await page.locator('.tdy-rings').isVisible(), 'held Today loading must keep its skeleton');
    if (name === 'today-rings') assert.ok(await page.locator('.tdy-rings').isVisible(), 'nonempty jobs must remain available');
    const surface = await phoneRules.activeSurface(page);
    const geometry = await phoneRules.inspect(page, surface);
    if (geometry.overlaps.length) faults.push('independent controls overlap: ' + JSON.stringify(geometry.overlaps.slice(0, 8)));
    if (geometry.misalignedActions.length) faults.push('caption actions detached or misaligned: '+JSON.stringify(geometry.misalignedActions));
    if (surface !== 'body') await phoneRules.scrollLock(page, surface);
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
      await page.locator('#svClientSearch').fill(name==='client-picker'?staff.NAMES[0]:'Client A'); await settle(page);
      await page.locator('.sv-phone-client-sheet [data-sv-client]').first().click(); await settle(page);
      if (await page.locator('.sv-phone-client-sheet[open]').count()) faults.push('native picker did not close after choice');
      if (name === 'menu-client' && [390,393,412].includes(width) && theme === 'light') {
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
        await page.setViewportSize({width,height:heightFor(width,arg('height'))}); await settle(page);
      }
    }
    if (/^(calendar|samples)-tabs$/.test(name)) {
      const reviewerLabel = await page.locator('#headerNav > .header-nav-btn').last().textContent();
      const b = await page.locator('dialog[open] button', {hasText:reviewerLabel.trim()}).boundingBox();
      if (b && b.y + b.height > heightFor(width,arg('height'))-1) faults.push('reviewer tab below fold');
    }
  }
  // Screenshot the picker before exercising its choice above.
  if (name !== 'menu-client' && !name.endsWith('client-picker') && shots) await capture(page, name, width, theme);
  if(!before && name==='analytics-detail') {
    const follower=page.locator('.chart-section').first();
    await follower.getByRole('button',{name:'TikTok',exact:true}).tap();await settle(page);
    assert.equal(await page.evaluate(()=>growthChart.data.datasets[0].label),'TikTok','Native chart series did not change');
    await follower.getByRole('button',{name:'Daily Change',exact:true}).tap();await settle(page);
    assert.equal(await page.evaluate(()=>growthChart.config.type),'bar','Daily Change did not change the native chart mode');
    for(const next of [theme==='light'?'dark':'light',theme]) {
      const values=await page.evaluate(()=>JSON.stringify(growthChart.data.datasets[0].data));
      await page.evaluate(next=>document.documentElement.setAttribute('data-theme',next),next);await settle(page);
      const axes=await analyticsAxes(page);
      assert.ok(axes.length>=4&&axes.every(axis=>axis.font>=13&&axis.contrast>=4.5),'Series/mode/theme repaint lost readable chart axes: '+JSON.stringify(axes));
      assert.equal(await page.evaluate(()=>JSON.stringify(growthChart.data.datasets[0].data)),values,'Theme repaint changed chart data');
    }
    await page.setViewportSize({width:1440,height:900});await settle(page);
    assert.ok((await analyticsAxes(page)).every(axis=>axis.font===11),'Phone chart font remained at desktop width');
    await page.setViewportSize({width,height:heightFor(width,arg('height'))});await settle(page);
    assert.ok((await analyticsAxes(page)).every(axis=>axis.font===13&&axis.contrast>=4.5),'Chart readability did not return after resize');
    await page.getByRole('button',{name:'Back',exact:true}).tap();await settle(page);
    assert.ok(await page.locator('.cards-grid').isVisible(),'Native Back did not return to the Analytics client cards');
  }
  if (!before && name === 'analytics-overview' && [390,393,412].includes(width) && theme === 'light') {
    const saved = await page.evaluate(()=>localStorage.getItem('syncview_viewMode'));
    await page.getByTitle('Show as table').click(); await settle(page);
    assert.equal(await page.locator('.overview-table').count(),1,'table choice was removed');
    await page.getByTitle('Show as cards').click(); await settle(page);
    await page.setViewportSize({width:1024,height:844});await settle(page);
    assert.equal(await page.locator('.overview-table').count(),1,'phone overwrote desktop view choice');
    await page.setViewportSize({width,height:heightFor(width,arg('height'))});await settle(page);
    assert.equal(await page.locator('.overview-table').count(),0,'phone card choice did not survive resize');
    assert.equal(await page.evaluate(()=>localStorage.getItem('syncview_viewMode')),saved,'desktop saved preference changed');
  }
  if (!before && /^(tiktok-client-(ready|search)|instagram-client-ready)$/.test(name)) {
    const label=page.locator('.tk-drop-title').first();
    const account=page.locator('.tk-profile-chip').first();
    let humanAccount;
    if(name.startsWith('tiktok-client-')) {
      humanAccount='@client_a';
      assert.equal(await account.textContent(),humanAccount,'TikTok phone account uses the human-readable handle or selected name');
      assert.match(await page.locator('.tk-profile-line').first().textContent(),/^Posting (to|for) /,'TikTok account wording explains the destination without a provider identifier');
      if(name==='tiktok-client-ready') {
        const input=page.locator('#tkClientInput');
        for(const query of ['Client B','Cli','']) {
          await input.fill(query);await settle(page);
          assert.equal(await account.textContent(),humanAccount,'Typing '+JSON.stringify(query)+' must not change the picked TikTok destination');
        }
        await input.fill('Client B');
        await page.locator('[data-tk-client-pick="Client B"]').tap();await settle(page);
        assert.equal(await account.textContent(),'@client_b','Choosing another client updates the destination');
        await page.evaluate(()=>{clientMap['Client C'].tiktok_handle='';});
        await page.locator('#tkClientInput').fill('Client C');
        await page.locator('[data-tk-client-pick="Client C"]').tap();await settle(page);
        assert.equal(await account.textContent(),'Client C','A picked client without a handle uses its selected name');
        await page.locator('#tkClientInput').fill('Client A');
        await page.locator('[data-tk-client-pick="Client A"]').tap();await settle(page);
      }
    }
    await page.evaluate(()=>window.__phoneDropTitle=document.querySelector('.tk-drop-title'));
    assert.match(await label.textContent(),/tap to (browse|add)/,'phone browse copy is missing');
    await page.setViewportSize({width:1024,height:844});await settle(page);
    if(name.startsWith('tiktok-client-')) assert.match(await page.locator('.tk-profile-line').first().textContent(),/^Posts to Post For Me account\s+spc_example_0/,'TikTok desktop restores the original provider account wording and id');
    assert.match(await label.textContent(),/click to (browse|add)/,'phone browse copy remained on desktop');
    assert.ok(await page.evaluate(()=>window.__phoneDropTitle===document.querySelector('.tk-drop-title')),'resize rebuilt the file chooser');
    await page.setViewportSize({width,height:heightFor(width,arg('height'))});await settle(page);
    if(name.startsWith('tiktok-client-')) assert.equal(await account.textContent(),humanAccount,'TikTok human-readable phone destination returns after resize');
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
    await page.setViewportSize({width,height:heightFor(width,arg('height'))});await settle(page);
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
  receipts.push({name,width,theme,...m,fonts,problems:faults});
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
  const overlay=await page.locator('dialog[open],.cal-preview-overlay.open,.cal-comments-overlay.open,.cal-lightbox.open').count();
  await page.screenshot({path:path.join(shots,`${name}-${theme}-${width}-viewport.png`),animations:'disabled'});
  await page.screenshot({path:path.join(shots,`${name}-${theme}-${width}.png`),fullPage:!overlay,animations:'disabled'});
}
async function prepare(page,name) {
  if (name === 'today-cleared') {
    await page.evaluate(() => navTo('today')); await page.waitForFunction(() => !!tdyState.data);
    await page.evaluate(() => { tdyState.data.done = [{id:'fixture-cleared',client_slug:'sample-one',title:'A longer cleared task title for a narrow phone',status_at:new Date().toISOString()}]; _tdyPaint(); }); return;
  }
  const samples=name.startsWith('samples');
  await page.evaluate(samples => navTo(samples ? 'sample-reviews' : 'calendar'), samples); await settle(page);
  await page.evaluate(({samples,name}) => {
    const empty=name.endsWith('empty'),noPosts=name.endsWith('no-posts');
    const row = {id:'phone_fixture_post',client:'sample-one',name:'A calmer start to the day',status:'For SMM Approval',video_status:'For SMM Approval',graphic_status:'For SMM Approval',caption_status:'For SMM Approval',caption:'A fictional caption.',scheduled_date:'2026-10-06',thumbnail_url:'https://images.example.invalid/phone-fixture.svg',asset_url:'https://example.invalid/fixture-video.mp4'};
    if(name.endsWith('long-content')) {row.name='A longer fictional title about building a calmer morning with enough room for all the important details';row.caption='A longer fictional caption that needs to wrap comfortably without hiding its actions. '.repeat(12);}
    const posts=empty||noPosts?[]:name.endsWith('many')?Array.from({length:12},(_,i)=>({...row,id:row.id+'_'+i,name:row.name+' '+(i+1),order_index:i+1})):[row];
    if (samples) { sxrState.loading=name.endsWith('loading'); sxrState.error='';sxrState.client=empty?'':'Sample Client One';sxrState.posts=posts;sxrState.view='organizer';_sxrRenderShell();_sxrRenderBody(); }
    else { _calInvalidateActiveLoad();calState.loading=name.endsWith('loading');calState.error='';calState.client=empty?'':'Sample Client One';calState.posts=posts;calState.view='organizer';calState.monthFilter='all';calState.statusFilter='all';_calRenderShell();_calRenderBody(); }
  }, {samples,name});
  await settle(page);
  if(name.endsWith('loading')) assert.ok(await page.locator('.cal-skeleton-loader').isVisible(),'held loader must actually be visible');
  if(name.endsWith('no-posts')) assert.equal(await page.locator('.cal-card,.cal-review-card').count(),0,'empty client has no cards');
  if(/-(review|month|week)$/.test(name)) {
    const view=name.endsWith('review')?'smmreview':name.split('-').at(-1);
    await page.locator('[data-cal-view="'+view+'"]').tap();await settle(page);
  }
  if(name==='calendar-card-detail') {
    await page.locator('[data-cal-view="month"]').tap();await settle(page);await page.locator('.cal-month-pill').first().tap();
    await page.locator('.cal-preview-overlay.open').waitFor();
  }
  if(name.endsWith('card-notes')) {
    await page.locator('.cal-comments-btn').first().tap();await page.locator('.cal-comments-overlay.open').waitFor();
  }
  if (name.endsWith('more') || name.endsWith('tabs')) await page.locator('[data-staff-menu='+(name.endsWith('more')?'more':'tabs')+']').click();
}
async function main(){
  if (process.argv.includes('--list')) {
    console.log(JSON.stringify([...core.map(s=>({name:s.name,lane:'finch'})),...states.map(s=>({name:s.name,lane:'staff'})),...cases.map(name=>({name,lane:'staff'}))],null,2));
    return;
  }
  // CI blocks CDN requests too. Reuse the hash-checked production asset loader
  // so native axis assertions never depend on a private FINCH_VENDOR directory.
  const chartSource = core.some(s=>only.test(s.name)&&s.name.startsWith('analytics-detail'))
    ? await require('../docs/syncview-design/tests/kasper-admin-expanded-browser').loadChartSource() : null;
  for (const s of core.filter(s=>only.test(s.name))) for(const width of widths) for(const theme of themes) {
    const h=await open({...s.open,chartSource:s.name.startsWith('analytics-detail')?chartSource:null,width,height:heightFor(width,arg('height')),theme,dsf:1});
    try { await h.page.waitForTimeout(s.settle||3000);
      await h.page.evaluate(names=>{WL_CLIENT_NAMES.splice(0,WL_CLIENT_NAMES.length,...names);WL_CLIENT_CANONICAL.clear();names.forEach(n=>WL_CLIENT_CANONICAL.set(wlNormalizeClient(n),n));if(typeof wlState!=='undefined')wlState.clientOptions=names.slice();},require('./finch-phone/fixtures').CLIENTS);
      if(s.name==='analytics-detail') { await h.page.locator(before?'.overview-table a.client-name-link':'.card-client-link',{hasText:'Client A'}).first().click();await h.page.waitForTimeout(2200); }
      else if(s.steps) await s.steps(h.page);
      if((s.name==='menu-client'||s.name.endsWith('client-picker'))&&shots) {await settle(h.page);await capture(h.page,s.name,width,theme);}
      await verify(h.page,s.name,width,theme);
      assert.equal(h.state.errors.length,0,'page errors');
    }catch(e){failures.push(s.name+' '+width+' '+theme+': '+e.message.split('\n')[0]);console.log('FAIL '+failures.at(-1));}finally{await h.close();}
  }
  const server=await staff.serve(), origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch();
  try {for(const st of [...states,...cases.map(name=>({name,setup:p=>prepare(p,name)}))].filter(s=>only.test(s.name))) for(const width of widths) for(const theme of themes) {
    staff.resetScenario();if(st.beforeBoot)st.beforeBoot();const ctx=await browser.newContext({viewport:{width,height:heightFor(width,arg('height'))},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    await staff.installBackend(ctx,st.editor);
    if(st.editor) await seedStaffIdentity(ctx,{id:'qa_editor',name:'Casey Fixture',role:'editor',team:'video'}); else await seedStaffGate(ctx);
    await ctx.addInitScript(t=>localStorage.setItem('syncview_theme',t),theme);
    await ctx.route('https://images.example.invalid/**', r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="lavender"/><circle cx="750" cy="380" r="210" fill="thistle"/><path d="M0 950Q500 600 1080 1000V1350H0Z" fill="slateblue"/></svg>'}));
    const p=await ctx.newPage();
    try {await p.goto(origin+'/');await p.waitForFunction(()=>typeof navTo==='function');await settle(p);
      await p.evaluate(names=>{window.__seedRoster=WL_CLIENT_NAMES.slice();WL_CLIENT_NAMES.splice(0,WL_CLIENT_NAMES.length,...names);WL_CLIENT_CANONICAL.clear();names.forEach(n=>{WL_CLIENT_CANONICAL.set(wlNormalizeClient(n),n);clientMap[n]={instagram_handle:'sample.one',tiktok_handle:'sampleone',youtube_channel_id:'UCsample0000000000000000'};});wlMergeClientsFromSheet(names);},staff.NAMES);
      await st.setup(p);
      if(st.name==='client-picker'&&shots)await capture(p,st.name,width,theme);
      await verify(p,st.name,width,theme);
      const leaked=await p.evaluate(()=> (window.__seedRoster||[]).filter(n=>n&&document.body.innerText.toLowerCase().includes(n.toLowerCase())).length);assert.equal(leaked,0,'built-in identity visible');
    }catch(e){failures.push(st.name+' '+width+' '+theme+': '+e.message.split('\n')[0]);console.log('FAIL '+failures.at(-1));}finally{await ctx.close();}
  }}finally{await browser.close();server.close();}
  if(arg('report',''))fs.writeFileSync(arg('report',''),JSON.stringify({receipts,failures},null,2)+'\n');
  console.log(`staff-phone-final-pass: ${receipts.length} renders, ${failures.length} problems${before?' (baseline capture)':''}`);
  if(failures.length&&!before)process.exitCode=1;
}
if (require.main === module) main().catch(e=>{console.error(e);process.exitCode=1;});
