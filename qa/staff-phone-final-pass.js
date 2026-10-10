'use strict';
// Native generated app, invented data, headless browser by default.
// --before-root=<checkout> captures the identical journeys against main.
// --shots=<directory> --widths=360,390,430 --only=<regexp> --report=<json>
// CI: run the complete --all-states inventory separately at 390 and 430.
// Design-device runs at 393/412 cover a different viewport matrix.
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
// Detail review needs successful native reads, not the offline writer's refusal.
const detailFixture=SCENARIOS.find(s=>s.id==='linear-detail').open;
for(const scenario of core.filter(s=>s.name==='linear-detail'||s.name.startsWith('linear-detail-'))) scenario.open={...detailFixture,fn:{...detailFixture.fn,
  'production-write':body=>{
    const row=detailFixture.rest.deliverables.find(row=>String(row.id)===String(body.id));
    assert.ok(row,'Native detail reads stay on a fictional deliverable');
    if(body.action==='labels_read') return {ok:true,complete:true,authority:'syncview',catalog_version:'fixture-1',catalog:[],selected_label_ids:[],selected_labels:[]};
    if(body.action==='description_read') return {ok:true,complete:true,row:{id:body.id,client_slug:body.client_slug,team:row.team,brief:'Review the fictional morning routine clip and keep the opening clear.',updated_at:'2026-10-01T12:00:00Z'}};
    if(body.action==='asset_access_read') return {ok:true,complete:true,id:body.id,client_slug:body.client_slug,team:row.team,assets:['filming_plan','raw_footage','delivery_folder','deliverable_file'].map(slot=>({slot,url:'https://example.invalid/'+slot,state:'available',guidance:'Fictional access checked.'}))};
    return {ok:false,error:'offline_harness'};
  },
  'production-comments':()=>({ok:true,comments:[],next_cursor:null,feedback:{version:1,status:'complete',complete:true,rows:[],scope:{surface:'calendar',card_id:'fixture-card'}}})
}};
async function openNativeCardDetail(page,desktop=false) {
  const title=page.locator('.prod-row .prod-title b').first();
  const id=await title.locator('xpath=ancestor::*[@data-prod-row]').getAttribute('data-prod-row');
  await title[desktop?"click":"tap"]();
  await page.locator('[data-prod-detail="'+id+'"]').waitFor();
  await page.waitForFunction(id=>_prodState.descriptions.get(id)?.status==='ready'&&_prodState.assets.get(id)?.status==='ready',id);
  assert.ok(!(await page.locator('[data-prod-detail="'+id+'"] .prod-assets-error').count()),'Normal detail must show successful fixture reads');
  assert.equal(await page.locator('[data-prod-project-detail]').count(),0,'The card title must open the deliverable, not its project');
  await settle(page);
}
core.push({...core.find(s=>s.name==='analytics-overview'),name:'analytics-period-week',steps:async page=>{await page.locator('[data-analytics-period=week]').tap();await settle(page);}});
core.find(s=>s.name==='linear-detail').steps=openNativeCardDetail;
core.push({...core.find(s=>s.name==='linear-detail'),name:'linear-detail-comment-draft',steps:async page=>{
  await openNativeCardDetail(page);
  await page.locator('.prod-composer-input').fill('A fictional feedback draft kept on this card.');
  await page.locator('.prod-composer-input').scrollIntoViewIfNeeded();
}});
for(const kind of ['menu','description-edit','asset-edit','empty','loading']) core.push({...SCENARIOS.find(s=>s.id==='linear-detail'),open:core.find(s=>s.name==='linear-detail').open,name:'linear-detail-'+kind,steps:async page=>{
  if(['menu','description-edit','asset-edit'].includes(kind)) {
    await openNativeCardDetail(page);
    if(kind==='description-edit') {
      await page.locator('[data-prod-description-control=edit]').tap();
      await page.locator('[data-prod-description-control=rich]').fill('A fictional description draft.');
      return;
    }
    if(kind==='asset-edit') {
      await page.locator('[data-prod-asset-edit=deliverable_file]').tap();
      await page.locator('.prod-assets-input').fill('https://example.invalid/draft');
      return;
    }
    await page.locator('.prod-detail-top [data-prod-tip="More options"]').tap();
    await page.locator('.prod-pop').waitFor({state:'visible'});
  } else {
    await page.evaluate(kind=>{
      Object.assign(_prodState,{loading:false,terminalTailLoadedAt:kind==='empty'?Date.now():0,terminalTailPending:kind==='loading',terminalTailFailed:false});
      _prodOpenDeliverable('fixture-missing-deliverable');
    },kind);
    await settle(page);
    if(kind==='empty') assert.ok(await page.getByText('Deliverable not found.',{exact:true}).isVisible(),'A complete read distinguishes an absent card');
    else assert.ok(await page.locator('.prod-detail-skeleton').isVisible(),'An incomplete read shows native detail loading, not a missing card');
  }
}});
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
  const timeline=SCENARIOS.find(s=>s.id==='workload-plan-due');
  core.push({...timeline,name:'workload-plan-due-expanded',steps:async page=>{
    await timeline.steps(page);await page.locator('.workload-timeline-plan-chip').first().tap();await settle(page);
  }});
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
  ...['calendar','samples'].flatMap(tab=>['review','no-posts','loading','error','save-error','long-content','many'].map(kind=>tab+'-'+kind)),
  'today-long-content','today-many',
  'calendar-month','calendar-week','calendar-month-loading','calendar-week-loading','calendar-card-detail','calendar-card-notes','samples-card-notes','calendar-alt-caption-menu','calendar-alt-caption-tabs',
  ...['normal','loading','error','empty'].map(kind=>'calendar-thumbnail-prompt-'+kind),
  ...['control','required','optional','filled','discard'].map(kind=>'calendar-transcript-'+kind),
  'calendar-caption-prompt-normal','calendar-caption-prompt-empty'];
async function phoneMeasure(page) {
  return page.evaluate(() => {
    const visible = el => el.checkVisibility({ checkVisibilityCSS: true }) && !el.closest('dialog:not([open]), .header');
    const controls = [...document.querySelectorAll('button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, [role=button], [contenteditable=true], .prod-asset-value a[href]')].filter(visible);
    return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
      small: controls.map(el => { const r = el.getBoundingClientRect(); return { selector: el.id || el.className, w: r.width, h: r.height }; }).filter(r => r.w < 43.5 || r.h < 43.5),
      smallText: controls.filter(el => (/INPUT|TEXTAREA|SELECT/.test(el.tagName)||el.matches('[contenteditable=true]')) && el.type !== 'color' && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id || el.className) };
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
    if(/^linear-detail-(empty|loading)$/.test(name)) assert.equal(await page.locator('[data-phone-issue-label]').getAttribute('data-phone-issue-label'),'Card','An unavailable deliverable must not claim to be a Batch');
    if(name==='calendar-month') {
      const markers=await page.locator('#calView .cal-month-cell.today .cal-month-num').evaluateAll(nodes=>nodes.filter(node=>node.checkVisibility({checkVisibilityCSS:true})).map(node=>{const mark=node.getBoundingClientRect(),cell=node.closest('.cal-month-cell').getBoundingClientRect();return {width:mark.width,height:mark.height,top:mark.top-cell.top,bottom:cell.bottom-mark.bottom};}));
      assert.ok(markers.length&&markers.every(mark=>mark.width===36&&mark.height===36&&mark.top>=0&&mark.bottom>=0),'The complete Today circle stays inside its phone agenda row: '+JSON.stringify(markers));
    }
    if(name==='calendar-loading') {
      const loading=await page.locator('#calView .cal-skeleton-loader').evaluate(node=>({label:getComputedStyle(node,'::before').content,padding:parseFloat(getComputedStyle(node).paddingTop),statuses:[...node.querySelectorAll('.cal-skeleton-status')].map(bar=>({color:getComputedStyle(bar).backgroundColor,body:getComputedStyle(bar.parentElement.parentElement).backgroundColor}))}));
      assert.ok(loading.label.includes('Loading your calendar')&&loading.padding<=24,'Calendar loading has a visible label and a compact gap');
      assert.ok(loading.statuses.length&&new Set(loading.statuses.map(bar=>bar.color)).size===1&&loading.statuses.every(bar=>bar.color!==bar.body),'Unknown statuses use visible neutral loading bars');
    }
    if(name==='samples-loading') {
      const loading=await page.locator('#sxrView .cal-skeleton-loader').evaluate(node=>({label:getComputedStyle(node,'::before').content,padding:parseFloat(getComputedStyle(node).paddingTop),width:node.getBoundingClientRect().width,cards:[...node.querySelectorAll('.cal-skeleton-review-card')].map(card=>({width:card.getBoundingClientRect().width,columns:getComputedStyle(card).gridTemplateColumns,shape:getComputedStyle(card.querySelector('.sv-skeleton')).backgroundColor,body:getComputedStyle(card).backgroundColor}))}));
      assert.ok(loading.label.includes('Loading samples')&&loading.padding<=24,'Samples loading has a visible label and a compact gap');
      assert.ok(loading.cards.length&&loading.cards.every(card=>Math.abs(card.width-loading.width)<=2&&card.columns.startsWith('68px')&&card.shape!==card.body),'Samples loading previews match full-width review cards with visible neutral shapes: '+JSON.stringify(loading));
    }
    if(name==='samples-sheet') {
      const field=await page.locator('.sxr-cd-input').first().evaluate(node=>{const style=getComputedStyle(node,'::placeholder'),body=getComputedStyle(node);const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);const lum=s=>rgb(s).map(v=>v/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const a=lum(style.color),b=lum(body.backgroundColor);return {opacity:Number(style.opacity),contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
      assert.ok(field.opacity===1&&field.contrast>=4.5,'Creative-direction placeholder remains readable: '+JSON.stringify(field));
    }
    if(name==='linear-detail-description-edit') {
      const editor=await page.locator('[data-prod-description-control=rich]').evaluate(node=>({height:node.getBoundingClientRect().height,font:parseFloat(getComputedStyle(node).fontSize)}));
      assert.ok(editor.height>=96&&editor.font>=16,'Native rich description editor has room to compose on a phone');
      assert.ok(await page.locator('.prod-description-hint,.prod-description-action').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility({checkVisibilityCSS:true})).every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)),'Description actions and image guidance stay readable');
    }
    if(/^linear-detail(?:-menu)?$/.test(name)) {
      const labels=await page.locator('.prod-asset-label,.prod-asset-state,.prod-assets-title,.prod-feedback-status').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility({checkVisibilityCSS:true})).map(n=>parseFloat(getComputedStyle(n).fontSize)));
      assert.ok(labels.length&&labels.every(font=>font>=13),'Card detail asset and feedback labels stay readable');
      if(name.endsWith('-menu')) assert.ok(await page.locator('.prod-tip').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).display==='none')),'A hover tooltip must not overlap the open phone card menu');
    }
    if(/^analytics-(pin|search)$/.test(name)) {
      const selector=name.endsWith('pin')?'.pin-selector-item':'.search-suggestion';
      const rows=await page.locator(selector).evaluateAll(nodes=>nodes.map(node=>({height:node.getBoundingClientRect().height,font:parseFloat(getComputedStyle(node).fontSize)})));
      assert.ok(rows.length&&rows.every(row=>row.height>=44&&row.font>=14),'Analytics menu rows have comfortable native tap targets: '+JSON.stringify(rows));
      if(name.endsWith('pin')) assert.ok(await page.locator('.pin-selector-count').evaluate(node=>node.scrollWidth<=node.clientWidth&&getComputedStyle(node).whiteSpace==='nowrap'),'Pin count stays on one line');
    }
    if(name.startsWith('workload-plan-due')) {
      const geometry=await page.locator('.workload-timeline-wrap').evaluate(root=>{
        const header=root.querySelector('.workload-timeline-header'),stage=root.querySelector('.workload-timeline-stage');
        const bounds=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
        return {header:bounds(header),stage:bounds(stage),headers:[...header.querySelector('.workload-timeline-weekdays').children].map(bounds),days:[...stage.querySelector('.workload-timeline-day-columns').children].map(bounds),hint:getComputedStyle(root,'::before').content};
      });
      assert.equal(geometry.header.width,geometry.stage.width,'Plan+Due header and body use the same timeline width');
      assert.equal(geometry.headers.length,5,'Every workday has a header');
      geometry.headers.forEach((header,i)=>assert.deepEqual(header,geometry.days[i],'Weekday header aligns with its native day column'));
      assert.ok(geometry.hint.includes('Swipe'),'The phone explains horizontal timeline navigation');
      assert.ok(await page.locator('.workload-timeline-plan-chip').evaluateAll(nodes=>nodes.every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)),'Timeline client labels stay readable');
    }
    if(name==='workload-popover') {
      assert.ok(await page.locator('.workload-plan-item,.workload-grid .wl-deadline-tag').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility({checkVisibilityCSS:true})).every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)),'Expanded plan titles and deadline explanations stay readable');
    }
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
    if(name==='analytics-empty') assert.ok(await page.locator('[data-analytics-pending]').count()>0,'Pending analytics cards expose their native state label');
    if(name.startsWith('analytics-') && name!=='analytics-loading') {
      const text=await page.evaluate(()=>{
        const rgb=value=>value.match(/[\d.]+/g).map(Number);
        const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        return [...document.querySelectorAll('.card-platform-label,.card-metric-label,.card-metric-gain,.card-platform a span,.platform-handle-link,.m-label,.m-value.empty,.m-delta,.gain-chip-label,.gain-delta,.card-platform .analytics-state-badge,[data-analytics-pending]')].filter(node=>node.checkVisibility({checkVisibilityCSS:true})).map(node=>{
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
    if (name === 'today-loading') {
      assert.ok(await page.locator('.tdy-rings').isVisible(), 'held Today loading must keep its skeleton');
      assert.ok(await page.locator('.tdy-skel').evaluate(root=>getComputedStyle(root,'::before').content.includes('Loading your day')&&[...root.querySelectorAll('.sv-skeleton')].every(shape=>getComputedStyle(shape).backgroundColor!==getComputedStyle(shape.parentElement).backgroundColor)),'Today loading keeps its explanation and visible skeleton shapes in either theme');
    }
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
      if(await page.locator('.sv-phone-client-sheet').count()) {
        const readability=await page.locator('.sv-phone-client-sheet .sv-client-search,.sv-phone-client-sheet .sv-client-none').evaluateAll(nodes=>nodes.map(node=>{
          const style=getComputedStyle(node,node.matches('input')?'::placeholder':null);
          const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=s=>rgb(s).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
          const front=lum(style.color),back=lum(getComputedStyle(node.closest('.sv-phone-client-sheet')).backgroundColor);
          return {font:parseFloat(style.fontSize),opacity:Number(style.opacity),contrast:(Math.max(front,back)+.05)/(Math.min(front,back)+.05)};
        }));
        assert.ok(readability.length&&readability.every(row=>row.font>=13&&row.opacity===1&&row.contrast>=4.5),'Client-picker prompt and placeholder stay readable: '+JSON.stringify(readability));
      }
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
  if(!before && name.startsWith('calendar-thumbnail-prompt-')) {
    if(name.endsWith('-empty')) assert.equal(await page.locator('#calPromptTA').inputValue(),'','Empty thumbnail prompt fixture must stay empty through capture');
    assert.equal(await page.locator('.cal-card').count(),1,'An empty/error/loading prompt keeps its normal Calendar background');
    if(name.endsWith('-normal')) {
      const value=await page.locator('#calPromptTA').inputValue();
      await page.locator('.cal-prompt-foot button').filter({hasText:'Reset to default'}).tap();
      assert.equal(await page.locator('#calPromptTA').inputValue(),value,'Reset preserves the native default prompt');
    }
    await page.locator('.cal-prompt-close').tap();
    assert.equal(await page.locator('#calPromptOverlay.open').count(),0,'Prompt closes through its native close control');
  }
  if(!before && name.startsWith('calendar-caption-prompt-')) {
    if(name.endsWith('-empty')) assert.equal(await page.locator('#calPromptTA').inputValue(),'','Empty prompt fixture must stay empty through capture');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#calPromptOverlay.open').count(),0,'Caption prompt Escape closes the native sheet');
  }
  if(!before && name.startsWith('calendar-transcript-')) {
    if(name.endsWith('-control')) {
      assert.ok(await page.locator('.cal-cap-tx').first().isVisible(),'Function-route video offers the native optional Transcript button');
      await page.locator('.cal-cap-tx').first().tap();
      await page.locator('#calTxTA').waitFor();
    }
    if(name.endsWith('-discard')) {
      await page.locator('#confirmOverlay.active button').filter({hasText:/^Cancel$/}).tap();
      assert.ok(await page.locator('#calPromptOverlay.open').count(),'Cancel discard preserves the transcript sheet');
      assert.ok((await page.locator('#calTxTA').inputValue()).length>0,'Cancel discard keeps the draft');
    }
    const required=name.endsWith('-required');
    if(required) {
      assert.ok(await page.locator('#calTxGo').isDisabled(),'Required transcript prevents an empty generation');
      await page.locator('#calTxTA').fill('A fictional opening and closing line.');
      assert.ok(await page.locator('#calTxGo').isEnabled(),'Typing enables the native required-transcript action');
      await page.locator('#calTxTA').fill('');
      assert.ok(await page.locator('#calTxGo').isDisabled(),'Clearing disables generation again');
    } else assert.ok(await page.locator('#calTxGo').isEnabled(),'Optional transcript permits the existing video path');
    await page.locator('.cal-prompt-foot button').filter({hasText:'Cancel'}).tap();
    if(/-(filled|discard)$/.test(name)) {
      await page.locator('#confirmOverlay.active').waitFor();
      await page.locator('#confirmOverlay.active button').filter({hasText:/^Discard$/}).tap();
    }
    assert.equal(await page.locator('#calPromptOverlay.open').count(),0,'Transcript Cancel closes the native sheet without generating');
  }
  if(!before && name==='calendar-alt-caption-menu') {
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.cal-fld-status-menu.open').count(),0,'Alternate caption menu closes with Escape');
    await page.locator('.cal-altcap-add').first().tap();
    await page.locator('.cal-cap-tab-menu-item').filter({hasText:'LinkedIn'}).tap();
    assert.ok(await page.locator('.cal-cap-tab[data-captab="alt"]').first().isVisible(),'Native platform choice creates a caption tab');
  }
  if(!before && name==='calendar-alt-caption-tabs') {
    const card=page.locator('.cal-card:has(.cal-cap-tab[data-captab="alt"])').first();
    await card.locator('.cal-cap-tab[data-captab="main"]').tap();
    assert.ok(await card.locator('[data-capwrap="main"] textarea').isVisible(),'Main caption tab exposes its native editor');
    await card.locator('.cal-cap-tab[data-captab="alt"]').tap();
    assert.ok(await card.locator('[data-capwrap="alt"] textarea').isVisible(),'Alternate caption tab exposes its native editor');
    await card.locator('.cal-cap-tab-x').tap();
    assert.equal(await card.locator('.cal-cap-tab[data-captab="alt"]').count(),0,'Remove target clears the empty alternate caption without opening the platform menu');
    assert.equal(await page.locator('.cal-fld-status-menu.open').count(),0,'Remove target does not trigger its parent tab action');
  }
  if(!before && /^(calendar|samples)-long-content$/.test(name) && process.env.PRISM_MOCKUP !== '1') {
    const editor=page.locator('textarea[data-pocket-title]').first();
    const original=await editor.inputValue();
    await editor.tap();
    const value=original+' Updated.';
    await editor.fill(value);
    assert.equal(await page.evaluate(samples=>(samples?sxrState:calState).posts[0].name,name.startsWith('samples')),value,'Wrapping title keeps the native optimistic field edit');
    await page.keyboard.press('Enter');
    assert.equal(await editor.inputValue(),value,'Enter commits the title without adding a newline');
    await page.setViewportSize({width:1440,height:900});await settle(page);
    assert.equal(await page.locator('textarea[data-pocket-title]').count(),0,'Desktop restores the original single-line title control');
    assert.equal(await page.locator('input.cal-fld-name').first().inputValue(),value,'Desktop transition preserves the edited title');
    await page.setViewportSize({width,height:heightFor(width,arg('height'))});await settle(page);
    assert.equal(await page.locator('textarea[data-pocket-title]').first().inputValue(),value,'Returning to phone preserves the same title');
  }
  if(!before && name.startsWith('workload-plan-due')) {
    const chip=page.locator('.workload-timeline-plan-chip').first();
    if(await chip.locator('xpath=..').getAttribute('open')!==null) await chip.tap();
    await chip.tap();
    const group=chip.locator('xpath=..');
    assert.equal(await group.getAttribute('open'),'','Timeline chip expands its own native group');
    assert.ok(await group.locator('.workload-plan-item').first().isVisible(),'Expanded timeline exposes native work items');
    assert.ok(await group.locator('.workload-plan-item,.wl-deadline-tag').evaluateAll(nodes=>nodes.every(node=>parseFloat(getComputedStyle(node).fontSize)>=13)),'Expanded timeline title and deadline stay readable');
    await chip.tap();assert.equal(await group.getAttribute('open'),null,'Timeline group collapses again');
  }
  if(!before && name==='workload-week') {
    const groups=await page.locator('.workload-overview-status-clients').evaluateAll(groups=>groups.map(group=>[...group.querySelectorAll('.wl-now-client-chip')].map(chip=>({client:chip.dataset.wlClient,parent:chip.dataset.wlParentId,label:chip.innerText,context:chip.querySelector('.fph-workload-post')?.textContent}))));
    for(const chips of groups) for(const chip of chips) if(chips.filter(other=>other.client===chip.client).length>1) assert.ok(chip.context && !chips.some(other=>other.parent!==chip.parent && other.label===chip.label),'Separate posts with identical client/count labels need visible context');
    const chip=page.locator('.wl-now-client-chip:has(.fph-workload-post)').first();
    if(await chip.count()) {
      const parent=await chip.getAttribute('data-wl-parent-id'),count=Number(await chip.locator('.wl-now-client-chip-count').innerText());
      await chip.tap();await page.locator('#wlPopover.open').waitFor();
      assert.equal(await page.locator('#wlPopover .workload-popover-item').count(),count,'Post context retains the native group count and destination');
      assert.equal(await page.evaluate(()=>wlState.popoverAnchor.dataset.wlParentId),parent,'Post context must not redirect its native action');
      const desktopCount=await page.evaluate(()=>{
        const chip=wlState.popoverAnchor,source=chip.dataset.wlSource==='tweaks'?wlState.tweaksNeeded:chip.dataset.wlSource==='inprogress'?wlState.nowWorking:wlState.overdue;
        return source.filter(s=>s.assigneeId===chip.dataset.wlAssigneeId && s.clientName===chip.dataset.wlClient).length;
      });
      await page.setViewportSize({width:1440,height:900});
      await page.waitForFunction(count=>document.querySelectorAll('#wlPopover .workload-popover-item').length===count,desktopCount);
      assert.equal(await page.locator('#wlPopover .workload-popover-item').count(),desktopCount,'Desktop restores its original client rollup');
      await page.setViewportSize({width,height:heightFor(width,arg('height'))});
      await page.waitForFunction(count=>document.querySelectorAll('#wlPopover .workload-popover-item').length===count,count);
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(150);
    assert.equal(await page.locator('.fph-workload-post').count(),0,'Desktop removes every phone post label');
    await page.setViewportSize({width,height:heightFor(width,arg('height'))});await settle(page);
  }
  if(!before && name==='analytics-pin') {
    const original=await page.evaluate(()=>getPins());
    await page.locator('.pin-selector-item').filter({hasText:'Client A'}).tap();
    assert.ok(await page.evaluate(()=>getPins().includes('Client A')),'Native pin action selects the chosen client');
    await page.locator('.pin-selector-item').filter({hasText:'Client A'}).tap();
    assert.deepEqual(await page.evaluate(()=>getPins()),original,'Native unpin restores the fixture preference');
    await page.locator('#pinDropCloseBtn').tap();
    await page.waitForFunction(()=>{const dropdown=document.getElementById('pinSelectorDropdown'),style=getComputedStyle(dropdown);return !dropdown.classList.contains('open')&&style.opacity==='0'&&style.pointerEvents==='none';});
  }
  if(!before && name==='analytics-search') {
    await page.locator('.search-suggestion').filter({hasText:'Client A'}).first().tap();
    await page.locator('.client-view').waitFor({state:'visible'});
    assert.ok(await page.locator('.client-view').getByText('Client A',{exact:true}).first().isVisible(),'Search reaches the chosen native client detail');
    await page.getByRole('button',{name:'Back',exact:true}).tap();assert.ok(await page.locator('.cards-grid').isVisible(),'Search detail returns to Analytics');
  }
  if(!before && name==='linear-detail') {
    const link=page.locator('.prod-asset-value a[href]').first();
    const destination=await link.getAttribute('href');
    await page.context().route('https://example.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>Fictional asset destination</p>'}));
    const popup=page.waitForEvent('popup');await link.tap();const opened=await popup;
    await opened.waitForURL(destination);await opened.waitForLoadState('domcontentloaded');assert.equal(opened.url(),destination,'Native asset link opens the chosen fixture URL');await opened.close();
  }
  if(!before && name==='analytics-period-week') {
    assert.equal(await page.locator('[data-analytics-period=week]').getAttribute('aria-pressed'),'true','Native Week action selects its period');
    await page.locator('[data-analytics-period=day]').tap();await settle(page);
    assert.equal(await page.locator('[data-analytics-period=day]').getAttribute('aria-pressed'),'true','Native Day action restores its period');
  }
  if(!before && name==='linear-detail-comment-draft') {
    const input=page.locator('.prod-composer-input');
    assert.equal(await input.inputValue(),'A fictional feedback draft kept on this card.','Typing keeps the native comment draft');
    await page.locator('.prod-detail-main').evaluate(n=>n.scrollTo({top:n.scrollHeight,behavior:'instant'}));
    const footer=await page.locator('.prod-composer-submit').boundingBox();
    assert.ok(footer&&footer.y>=0&&footer.y+footer.height<=page.viewportSize().height-12,'Comment footer remains fully reachable at the bottom of the native card');
  }
  if(!before && name==='linear-detail-menu') {
    await page.keyboard.press('Escape');assert.equal(await page.locator('.prod-pop').count(),0,'Escape closes the native detail menu');
  }
  if(!before && name==='linear-detail-description-edit') {
    await page.locator('[data-prod-description-control=cancel]').tap();
    assert.equal(await page.locator('[data-prod-description-control=rich]').count(),0,'Cancel dismisses the description draft');
  }
  if(!before && name==='linear-detail-asset-edit') {
    await page.locator('.prod-assets-editor').getByRole('button',{name:'Cancel',exact:true}).tap();
    assert.equal(await page.locator('.prod-assets-editor').count(),0,'Cancel dismisses the asset draft');
  }
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
  if (!before && name === 'linear-detail') {
    const hierarchy=await page.evaluate(() => {
      const rows=_prodIssues(),parent=rows[0];
      const child=rows.find(row=>row.id!==parent?.id && row.project===parent.project);
      if(!parent || !child)throw new Error('Missing fictional hierarchy fixture');
      const parentRow=_prodState.deliverables.find(row=>row.id===parent.id);
      const childRow=_prodState.deliverables.find(row=>row.id===child.id);
      // Detail reads rebuild the adapter. Seed its raw source, not a cached
      // issue object whose temporary parent field disappears on that rebuild.
      parentRow.linear_issue_uuid='fixture-parent-'+parent.id;
      childRow.raw_issue_parent_id=parentRow.linear_issue_uuid;
      _prodState.adapter=null;
      _prodOpenDeliverable(child.id);
      return {parentId:parent.id,childId:child.id,label:_prodIssueDisplayLabel(_prodIssue(child.id))};
    });
    await settle(page);
    assert.equal(await page.evaluate(id=>_prodIssue(id).parent,hierarchy.childId),hierarchy.parentId,'Native detail reads must preserve the raw fixture hierarchy');
    const crumb=page.locator('.prod-detail-crumb');
    const original=await crumb.innerHTML();
    assert.equal(await crumb.locator(':scope > b').count(),0,'child breadcrumb changed the native desktop markup');
    assert.equal(await crumb.locator('[data-prod-crumb-batch]').getAttribute('data-prod-crumb-batch'),hierarchy.parentId,'Child breadcrumb must link to its fixture parent');
    assert.equal(await crumb.getAttribute('data-phone-issue-label'),hierarchy.label,'Phone breadcrumb must identify the child issue');
    assert.equal(await crumb.evaluate(n=>getComputedStyle(n,'::after').content),JSON.stringify(hierarchy.label),'phone issue ID is missing');
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
  await require('./client-phone/native-captures').anonymizePlaceholders(page);
  await page.screenshot({path:path.join(shots,`${name}-${theme}-${width}-viewport.png`),animations:'disabled'});
  await require('./client-phone/native-captures').capture(page,{path:path.join(shots,`${name}-${theme}-${width}.png`),fullPage:!overlay,animations:'disabled'});
}
async function prepare(page,name) {
  if(['today-long-content','today-many'].includes(name)) {
    await page.evaluate(()=>navTo('today'));await page.waitForFunction(()=>tdyState.data && tdyState.data.posts.length);
    await page.evaluate(name=>{
      const data=tdyState.data,original=data.posts[0];
      const title='A longer fictional post title about making a calmer start to the day with room for every important detail';
      data.posts=name.endsWith('many')?Array.from({length:18},(_,i)=>({...original,id:original.id+'-fixture-'+i,name:title+' '+(i+1)})):[{...original,name:title}];
      data.names[original.client]='A fictional workspace with an unusually long display label';
      _tdyPaint();
    },name);await settle(page);return;
  }
  if (name === 'today-cleared') {
    await page.evaluate(() => navTo('today')); await page.waitForFunction(() => !!tdyState.data);
    await page.evaluate(() => { tdyState.data.done = [{id:'fixture-cleared',client_slug:'sample-one',title:'A longer cleared task title for a narrow phone',status_at:new Date().toISOString()}]; _tdyPaint(); }); return;
  }
  const samples=name.startsWith('samples');
  await page.evaluate(samples => navTo(samples ? 'sample-reviews' : 'calendar'), samples); await settle(page);
  if(name.startsWith('calendar-transcript-')) {
    await page.evaluate(async()=>{calState.client='Sample Client One';await loadCalendarPosts();});
    await settle(page);
  }
  await page.evaluate(({samples,name}) => {
    const empty=/^(calendar|samples)-empty$/.test(name),noPosts=/^(calendar|samples)-no-posts$/.test(name),readError=/^(calendar|samples)-error$/.test(name);
    const loading=/^(calendar|samples)-loading$|^calendar-(month|week)-loading$/.test(name);
    const row = {id:'phone_fixture_post',client:'sample-one',name:'A calmer start to the day',status:'For SMM Approval',video_status:'For SMM Approval',graphic_status:'For SMM Approval',caption_status:'For SMM Approval',caption:'A fictional caption.',scheduled_date:'2026-10-06',thumbnail_url:'https://images.example.invalid/phone-fixture.svg',asset_url:'https://example.invalid/fixture-video.mp4'};
    if(name.endsWith('save-error')) Object.assign(row,{type:'Reel',post_type:'Reel',video_deliverable_id:'00000000-0000-4000-a000-000000000001',graphic_deliverable_id:'00000000-0000-4000-a000-000000000002'});
    if(name.endsWith('long-content')) {row.name='A longer fictional title about building a calmer morning with enough room for all the important details';row.caption='A longer fictional caption that needs to wrap comfortably without hiding its actions. '.repeat(12);}
    const posts=empty||noPosts||readError?[]:name.endsWith('many')?Array.from({length:12},(_,i)=>({...row,id:row.id+'_'+i,name:row.name+' '+(i+1),order_index:i+1})):[row];
    if (samples) { sxrState.loading=loading; sxrState.error=readError?'Fictional read failure':'';sxrState.client=empty?'':'Sample Client One';sxrState.posts=posts;sxrState.view='organizer';_sxrRenderShell();_sxrRenderBody(); }
    else { _calInvalidateActiveLoad();calState.loading=loading;calState.error=readError?'Fictional read failure':'';calState.client=empty?'':'Sample Client One';calState.posts=posts;calState.view=name==='calendar-month-loading'?'month':name==='calendar-week-loading'?'week':'organizer';calState.monthFilter='all';calState.statusFilter='all';_calRenderShell();_calRenderBody(); }
  }, {samples,name});
  await settle(page);
  if(name.startsWith('calendar-thumbnail-prompt-')) {
    await page.route('**/functions/v1/thumbnail-title-prompts',async route=>{
      const body=route.request().postDataJSON();
      assert.equal(body.action,'get','Prompt visual fixture only reads the synthetic client prompt');
      if(name.endsWith('-loading')) await new Promise(resolve=>setTimeout(resolve,15000));
      return route.fulfill({status:name.endsWith('-error')?503:200,headers:{'access-control-allow-origin':'*'},json:name.endsWith('-error')?{ok:false,error:'fixture_unavailable'}:{ok:true,is_custom:false,prompt:'',default_prompt:'Write a clear, concise title based on the fictional filming plan.'}}).catch(()=>{});
    });
    await page.evaluate(()=>{_calOpenThumbTitlePromptModal();});
    await page.locator('#calPromptOverlay.open').waitFor();
    if(!name.endsWith('-loading')&&!name.endsWith('-error')) await page.locator('#calPromptTA').waitFor();
    if(name.endsWith('-empty')) {
      // Native delayed focus resets selection; let it finish before fill selects all.
      await page.waitForFunction(()=>document.activeElement===document.getElementById('calPromptTA'));
      await page.locator('#calPromptTA').fill('');
      assert.equal(await page.locator('#calPromptTA').inputValue(),'','Empty thumbnail prompt fixture starts empty');
    }
    await settle(page);return;
  }
  if(name.startsWith('calendar-caption-prompt-')) {
    await page.evaluate(()=>_calOpenCaptionPromptModal());
    await page.locator('#calPromptTA').waitFor();
    // Wait for the dialog's native delayed focus before Playwright selects all.
    // Otherwise its selection reset can race fill and delete only one letter.
    await page.waitForFunction(()=>document.activeElement===document.getElementById('calPromptTA'));
    if(name.endsWith('-empty')) await page.locator('#calPromptTA').fill('');
    await settle(page);return;
  }
  if(name.startsWith('calendar-transcript-')) {
    await page.evaluate(name=>{
      calState.posts[0].caption='';
      calState.posts[0].asset_url=name.endsWith('-required')?'':'https://f.io/fixture-video';
      _calRenderBody();
      // Eligibility reads the live URL field; settle the new fixture card
      // before re-rendering its controls rather than using the previous card.
      _calRenderBody();
    },name);await settle(page);
    if(name.endsWith('-control')) return;
    if(name.endsWith('-required')) await page.locator('.cal-cap-gen').first().tap();
    else await page.locator('.cal-cap-tx').first().tap();
    await page.locator('#calTxTA').waitFor();
    if(/-(filled|discard)$/.test(name)) await page.locator('#calTxTA').fill('A fictional video transcript with one opening idea and a clear ending.');
    if(name.endsWith('-discard')) {await page.locator('.cal-prompt-foot button').filter({hasText:'Cancel'}).tap();await page.locator('#confirmOverlay.active').waitFor();}
    await settle(page);return;
  }
  if(name.startsWith('calendar-alt-caption-')) {
    await page.locator('.cal-altcap-add').first().tap();
    await page.locator('.cal-fld-status-menu.open .cal-cap-tab-menu-item').first().waitFor();
    if(name.endsWith('-tabs')) {
      await page.locator('.cal-cap-tab-menu-item').filter({hasText:'LinkedIn'}).tap();
      await page.locator('[data-capwrap="alt"] textarea').first().waitFor({state:'visible'});
    }
  }
  if(name.endsWith('loading')) assert.ok(await page.locator('.cal-skeleton-loader').isVisible(),'held loader must actually be visible');
  if(name.endsWith('no-posts')) assert.equal(await page.locator('.cal-card,.cal-review-card').count(),0,'empty client has no cards');
  if(name.endsWith('save-error')) {
    let refused=0;
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()==='POST' && (/calendar-upsert|sample-upsert|production-write/.test(url.pathname)||url.pathname.includes('/webhook/'))) {refused++;return route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'{"ok":false,"error":"fixture_save_refused"}'});}
      return route.fallback();
    });
    await page.locator('[data-cal-view="smmreview"]').tap();await settle(page);
    if(!await page.locator('[data-comp=video] .cal-review-approve-btn').first().isVisible()) await page.locator('.kcard-expand-btn').first().tap();
    await page.locator('[data-comp=video] .cal-review-approve-btn').first().tap();
    if(await page.locator('#confirmOverlay.active').count()) await page.locator('#confirmYes').tap();
    await page.waitForFunction(samples=>{const state=samples?_sxrReviewState:_calReviewState;return Object.keys(state.errors).length>0&&!Object.values(state.saving).some(Boolean);},samples);
    const saveErrors=await page.evaluate(samples=>Object.values((samples?_sxrReviewState:_calReviewState).errors),samples);
    assert.ok(refused>0,'Refused-save fixture must exercise the native writer: '+JSON.stringify(saveErrors));
    await settle(page);
  }
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
  if (/^(calendar|samples)-(more|tabs)$/.test(name)) await page.locator('[data-staff-menu='+(name.endsWith('more')?'more':'tabs')+']').click();
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
      if(s.name.startsWith('linear-detail')) assert.deepEqual(h.state.writes,[],'Detail actions must not send fixture mutations');
    }catch(e){failures.push(s.name+' '+width+' '+theme+': '+e.message.split('\n')[0]);console.log('FAIL '+failures.at(-1));}finally{await h.close();}
  }
  const server=await staff.serve(), origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch();
  try {for(const st of [...states,...cases.map(name=>({name,setup:p=>prepare(p,name)}))].filter(s=>only.test(s.name))) for(const width of widths) for(const theme of themes) {
    staff.resetScenario();if(st.beforeBoot)st.beforeBoot();const ctx=await browser.newContext({viewport:{width,height:heightFor(width,arg('height'))},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    await staff.installBackend(ctx,st.editor);
    if(st.name.startsWith('calendar-transcript-')) await ctx.route('**/rest/v1/syncview_runtime_flags?**',route=>{
      const key=new URL(route.request().url()).searchParams.get('key')||'';
      if(!key.includes('caption_generate_ef_clients')) return route.fallback();
      return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:[{value:{all:true}}]});
    });
    if(st.name.endsWith('save-error')) await ctx.route('**/rest/v1/syncview_runtime_flags?**',route=>{
      const raw=new URL(route.request().url()).searchParams.get('key')||'';
      const keys=raw.startsWith('in.(')?raw.slice(4,-1).split(','):[raw.replace(/^eq\./,'')];
      return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(keys.map(key=>({key,value:key==='prod_authority'?{video:'syncview',graphics:'syncview'}:/_clients$/.test(key)?{clients:['sampleone','sampleclientone','sample-one']}:{enabled:false}})))});
    });
    if(st.editor) await seedStaffIdentity(ctx,{id:'qa_editor',name:'QA Editor',role:'editor',team:'video'}); else await seedStaffGate(ctx);
    await ctx.addInitScript(t=>localStorage.setItem('syncview_theme',t),theme);
    await ctx.route('https://images.example.invalid/**', r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="lavender"/><circle cx="750" cy="380" r="210" fill="thistle"/><path d="M0 950Q500 600 1080 1000V1350H0Z" fill="slateblue"/></svg>'}));
    const p=await ctx.newPage();require('./client-phone/native-captures').prepareCaptures(p);
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

module.exports={detailOptions:core.find(s=>s.name==='linear-detail').open,openNativeCardDetail,prepare};
