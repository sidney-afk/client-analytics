'use strict';
// Documentation renderer. Real before screens use existing isolated fixtures.
// After screens render only the proposal HTML; no live system is contacted.
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const staff = require(path.join(root, 'docs/syncview-design/tests/staff-phone-browser'));
const { seedStaffGate } = require(path.join(root, 'qa/staff-gate-seed'));
const { prepare } = require(path.join(root, 'qa/staff-phone-final-pass'));
const { anonymizePlaceholders } = require(path.join(root, 'qa/client-phone/native-captures'));
const shots = path.join(__dirname, 'screenshots');
const screens = ['calendar-grid','calendar-list','calendar-card','calendar-more','samples-grid','samples-list','samples-card','samples-more','workload-agenda','workload-person','workload-filters','messages-list','messages-thread','messages-tabs'];
async function clean(page) {
  await anonymizePlaceholders(page);
  await page.evaluate(() => {
    const name = document.getElementById('navKasper')?.textContent.trim();
    if (!name) return;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) if (!walk.currentNode.parentElement.closest('script,style')) walk.currentNode.textContent = walk.currentNode.textContent.replaceAll(name, 'Reviewer');
  });
}
(async () => {
  fs.mkdirSync(shots, { recursive:true });
  const server = await staff.serve(), browser = await chromium.launch();
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    if (process.argv.includes('--before')) {
      for (const theme of ['light','dark']) {
        staff.resetScenario();
        const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
        await staff.installBackend(context); await seedStaffGate(context);
        await context.addInitScript(t => localStorage.setItem('syncview_theme',t),theme);
        const page = await context.newPage();
        await page.goto(base); await page.waitForFunction(() => typeof navTo === 'function');
        for (const area of ['calendar','samples']) {
          await prepare(page,area+'-many'); await clean(page);
          await page.screenshot({path:path.join(shots,`before-${area}-${theme}.png`)});
          await page.locator('.cal-card').first().screenshot({path:path.join(shots,`current-${area}-list-card-${theme}.png`)});
          if (area === 'calendar') {
            await page.locator('[data-staff-menu=more]').tap(); await page.waitForTimeout(200); await clean(page);
            await page.screenshot({path:path.join(shots,`before-more-${theme}.png`)});
            await page.keyboard.press('Escape');
          }
        }
        if (theme === 'light') {
          await page.setViewportSize({width:1440,height:900});await prepare(page,'calendar-many');await clean(page);
          await page.screenshot({path:path.join(shots,'desktop-current-main-1440.png')});
        }
        await context.close();
        const { open } = require(path.join(root,'qa/finch-phone/harness'));
        const scenario = require(path.join(root,'qa/finch-phone/scenarios')).SCENARIOS.find(s=>s.id==='workload-week');
        const env = await open({...scenario.open,width:390,height:844,theme,dsf:1,realTiming:true});
        try { await env.page.waitForTimeout(4500); await clean(env.page); await env.page.screenshot({path:path.join(shots,`before-workload-${theme}.png`)}); }
        finally { await env.close(); }
      }
      console.log('BEFORE: 8 current-app viewport captures; isolated fictional fixtures');
    }
    if (process.argv.includes('--messages-before')) {
      const S = await require(path.join(root,'docs/syncview-design/tests/lost-work-lib')).createEnv();
      try {
        const conversations = [0,1,2].map(i=>({post_id:i?'mock-'+i:'p_t1',client_slug:'fixtureclient',client_name:'Studio demo',title:['A calmer start','Three small habits','Make room for more'][i],status:'In Progress',thumbnail_url:'',asset_url:'',last_at:'2026-10-14T09:41:00Z',last_author:'Client',last_role:'client',last_body:'Could we shorten the opening?',unread:i===2?0:1,messages:[{id:'mock-note-'+i,parent_id:null,root_id:'mock-note-'+i,author:'Client',role:'client',audience:'client',is_tweak:false,component:'caption',body:'Could we shorten the opening?',created_at:'2026-10-14T09:41:00Z'}]}));
        await S.ctx.route('**/functions/v1/production-comments',route=>{
          const body=route.request().postDataJSON();
          if(body?.action!=='inbox'&&body?.action!=='inbox_mark')return route.fallback();
          return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:{ok:true,scope:'all',conversations}});
        });
        const page=await S.newPage();await page.setViewportSize({width:390,height:844});await S.openCalendar(page);
        await page.evaluate(()=>navTo('kasper'));
        await page.waitForFunction(()=>typeof svAreaApi==='function'&&!!svAreaApi('kasper'));
        await page.evaluate(()=>_kasperGotoTab('replies'));
        await page.locator('#kasperContent .msg-conv').first().waitFor();
        for(const theme of ['light','dark']) {
          await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await clean(page);
          await page.screenshot({path:path.join(shots,`before-messages-${theme}.png`)});
        }
        console.log('MESSAGES BEFORE: 2 current-app viewport captures; isolated fictional fixtures');
      } finally { await S.close(); }
    }
    if (fs.existsSync(path.join(__dirname,'index.html'))) {
      const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true,isMobile:true});
      await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
      const page = await context.newPage();
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      for (const theme of ['light','dark']) for (const screen of screens) {
        await page.goto(base+`/docs/mockups/thumb-phone/index.html?screen=${screen}&theme=${theme}`);
        await page.evaluate(()=>document.fonts.ready);
        const metrics = await page.evaluate(()=>({width:document.documentElement.scrollWidth,small:[...document.querySelectorAll('button,input,textarea,a')].filter(n=>n.checkVisibility()).filter(n=>{const r=n.getBoundingClientRect();return r.width<44||r.height<44;}).map(n=>n.textContent||n.ariaLabel)}));
        if(metrics.width>390 || metrics.small.length) throw Error(screen+': '+JSON.stringify(metrics));
        await page.screenshot({path:path.join(shots,`${screen}-${theme}-390.png`)});
      }
      // Review the same proposal at the upper requested width.
      await page.setViewportSize({width:430,height:844});
      for (const screen of screens) {
        await page.goto(base+`/docs/mockups/thumb-phone/index.html?screen=${screen}`);
        if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('430 overflow: '+screen);
      }
      if(errors.length) throw Error(errors.join('\n'));
      await page.setViewportSize({width:390,height:844});
      await page.goto(base+'/docs/mockups/thumb-phone/index.html?screen=calendar-grid');
      await page.getByRole('button',{name:'List view',exact:true}).click();
      await page.locator('.legacy-card img').waitFor();
      await page.getByRole('button',{name:'Grid view',exact:true}).click();
      await page.getByRole('button',{name:'Open A calmer start',exact:true}).click();
      await page.getByRole('button',{name:'Back',exact:true}).click();
      await page.getByRole('button',{name:'More options',exact:true}).click();
      await page.getByRole('button',{name:'Close Calendar options',exact:true}).click();
      await page.goto(base+'/docs/mockups/thumb-phone/index.html?screen=workload-agenda');
      await page.locator('.person').first().click();
      await page.getByRole('button',{name:'Back',exact:true}).click();
      await page.getByRole('button',{name:'Filter',exact:true}).click();
      await page.getByRole('button',{name:'Video',exact:true}).click();
      await page.getByRole('button',{name:'Show 12 items',exact:true}).click();
      await page.goto(base+'/docs/mockups/thumb-phone/index.html?screen=messages-list');
      await page.getByRole('button',{name:'Unread 3',exact:true}).click();
      if(await page.locator('.conversation:visible').count()!==2) throw Error('Unread filter must show only unread conversations');
      await page.locator('.conversation:visible').first().click();
      const composer = await page.locator('.composer').boundingBox();
      if(Math.abs(composer.y+composer.height-844)>1) throw Error('Composer must be docked to the viewport');
      await page.getByRole('textbox',{name:'Reply to client',exact:true}).fill('An unsent prototype draft');
      await page.getByRole('button',{name:'Back',exact:true}).click();
      await page.locator('.conversation').first().click();
      if(await page.getByRole('textbox',{name:'Reply to client',exact:true}).inputValue()!=='An unsent prototype draft') throw Error('Back navigation lost the prototype draft');
      await page.getByRole('button',{name:'Back',exact:true}).click();
      await page.getByRole('button',{name:'Tabs',exact:true}).click();
      const messageTab=page.getByRole('button',{name:'Messages 3',exact:true});
      if(await messageTab.locator('svg').count()!==1) throw Error('Messages navigation needs its icon');
      await messageTab.click();
      console.log('PROTOTYPE FLOWS: grid/list/card/back, More, creative queue, filters, unread list, docked composer, retained draft and labelled Messages tab passed');
      await context.close();
      const gallery = await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
      for (const theme of ['light','dark']) for (const area of ['calendar','samples','workload','messages']) {
        await gallery.goto(base+`/docs/mockups/thumb-phone/index.html?theme=${theme}`);
        await gallery.addStyleTag({content:'.gallery-nav{position:static}'});
        await gallery.locator('#'+area+' iframe').evaluate(n=>new Promise(resolve=>n.contentDocument?.readyState==='complete'?resolve():n.addEventListener('load',resolve,{once:true})));
        await gallery.locator('#'+area).screenshot({path:path.join(shots,`comparison-${area}-${theme}.png`)});
      }
      for(const theme of ['light','dark']) {
        await gallery.setViewportSize({width:880,height:1000});
        await gallery.setContent(`<style>body{margin:0;padding:16px;background:${theme==='dark'?'#101114':'#f4f4f2'};color:${theme==='dark'?'#fff':'#111'};font:13px sans-serif}.grid{display:grid;grid-template-columns:repeat(4,195px);gap:22px 16px}img{width:195px;height:422px;display:block;border:1px solid #8885;border-radius:10px}p{margin:0 0 7px}</style><div class="grid">${screens.map(screen=>`<div><p>${screen}</p><img src="${base}/docs/mockups/thumb-phone/screenshots/${screen}-${theme}-390.png"></div>`).join('')}</div>`);
        await gallery.evaluate(()=>Promise.all([...document.images].map(n=>n.decode())));
        await gallery.screenshot({path:path.join(shots,`all-flows-${theme}.png`),fullPage:true});
      }
      await gallery.close();
      console.log(`MOCKUP: ${screens.length*2} phone screenshots; ${screens.length} screens checked at 390/430; 8 before/after comparisons; 0 page errors`);
    }
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1;});
