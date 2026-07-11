// Master interaction sweep — hover + click EVERY interactive element on EVERY screen,
// open every menu, exercise every picker, assert zero JS errors throughout.
const { chromium } = require('playwright');
const OUT = 'C:/Users/Sidney/linear-design-probe/out';
const URL = 'file:///' + OUT + '/_sv.html';
const errors = [];
const stat = { hovered: 0, clicked: 0, menus: 0, screens: 0 };
const note = [];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const clear = () => page.evaluate(() => { try { clearLayer(); } catch (e) {} });
  const esc = async () => { await page.keyboard.press('Escape').catch(()=>{}); await page.waitForTimeout(30); };
  async function hoverAll(sel) {
    const els = await page.$$(sel);
    for (const el of els) { try { await el.hover({ timeout: 500 }); stat.hovered++; await page.waitForTimeout(4); } catch (e) {} }
  }
  // click each element matching sel (fresh query each time as DOM changes), then run closer
  async function clickEach(sel, { close = 'clear', max = 99 } = {}) {
    const n = Math.min(await page.$$eval(sel, els => els.length).catch(()=>0), max);
    for (let i = 0; i < n; i++) {
      const els = await page.$$(sel);
      if (!els[i]) break;
      try { await els[i].click({ timeout: 800 }); stat.clicked++; await page.waitForTimeout(40); } catch (e) {}
      if (close === 'clear') await clear();
      else if (close === 'esc') await esc();
      await page.waitForTimeout(15);
    }
  }
  // open a menu, hover all its items (+ submenus), then close
  async function openAndHoverMenu(openSel, idx = 0) {
    const els = await page.$$(openSel);
    if (!els[idx]) return;
    try { await els[idx].click({ timeout: 800 }); } catch (e) { return; }
    await page.waitForTimeout(120);
    if (await page.$('#layer .pop')) {
      stat.menus++;
      // hover every menu item + any submenu triggers
      const items = await page.$$('#layer .mi, #layer [data-fv], #layer .cal-d, #layer [data-day], #layer [data-i], #layer [data-ctx], #layer [data-ffield], #layer [data-grp]');
      for (const it of items) { try { await it.hover({ timeout: 400 }); stat.hovered++; await page.waitForTimeout(20); } catch (e) {} }
    }
    await clear();
  }

  await page.goto(URL);
  await page.waitForSelector('.row');

  // =================== SCREEN 1: ISSUE LIST ===================
  stat.screens++; note.push('--- LIST ---');
  await hoverAll('[data-tip]');                 // sidebar, topbar, subbar, rows, chips, dues, avatars, group headers
  await hoverAll('.row');                        // row hover states
  await hoverAll('.grp-hd');                     // group header hover (reveals checkbox + add)
  // open every row-level picker (status/assignee/due/project) on the first row
  await openAndHoverMenu('.row .st', 0);         // status picker
  await openAndHoverMenu('#filterbtn', 0);       // filter menu
  // filter field submenus
  for (const f of ['status','assignee','client']) {
    await page.click('#filterbtn').catch(()=>{});
    await page.waitForTimeout(80);
    const field = await page.$('[data-ffield="'+f+'"]');
    if (field) { await field.click().catch(()=>{}); await page.waitForTimeout(100);
      const vals = await page.$$('#layer [data-fv]');
      for (const v of vals.slice(0,3)) { try { await v.hover(); stat.hovered++; } catch(e){} }
      stat.menus++;
    }
    await clear();
  }
  await openAndHoverMenu('#groupbtn', 0);        // group-by menu
  // tabs
  await clickEach('[data-tab]', { close: 'none' });
  await page.evaluate(()=>{ S.tab='active'; render(); });
  // context menu on a row + submenus
  { const row = await page.$('.row[data-row]');
    if (row) { const box = await row.boundingBox();
      await page.mouse.click(box.x + 120, box.y + 15, { button:'right' });
      await page.waitForTimeout(150);
      if (await page.$('#layer .pop')) { stat.menus++;
        // hover each ctx item (opens submenus for those with chevrons)
        const ctx = await page.$$('#layer [data-ctx]');
        for (const c of ctx) { try { await c.hover(); stat.hovered++; await page.waitForTimeout(70); } catch(e){} }
      }
      await clear();
    } }
  // selection + action bar
  await page.hover('.row').catch(()=>{});
  await page.keyboard.press('x').catch(()=>{});   // select hovered row
  await page.waitForTimeout(60);
  if (await page.$('.actionbar')) { note.push('action bar shown on select');
    await page.hover('.actionbar').catch(()=>{});
    const ab = await page.$('#ab-actions'); if (ab) { await ab.click().catch(()=>{}); await page.waitForTimeout(100); stat.menus++; await clear(); }
    const clr = await page.$('#ab-clear'); if (clr) await clr.click().catch(()=>{});
  }
  await page.keyboard.press('Escape').catch(()=>{});

  // =================== SCREEN 2: ISSUE DETAIL (parent) ===================
  await page.evaluate(()=>openIssue('VID-12586'));
  await page.waitForSelector('#descblock');
  stat.screens++; note.push('--- DETAIL (parent) ---');
  await hoverAll('[data-tip]');
  await hoverAll('.d-subrow');
  await hoverAll('.ds-row');
  // properties pickers
  await openAndHoverMenu('.ds-row[data-st]', 0);
  await openAndHoverMenu('.ds-row[data-assign]', 0);
  await openAndHoverMenu('.ds-row[data-due]', 0);
  await openAndHoverMenu('.ds-row[data-client]', 0);
  // options menu
  await openAndHoverMenu('[data-more]', 0);
  // card collapse toggles
  await clickEach('[data-cardtoggle]', { close: 'none' });
  await clickEach('[data-cardtoggle]', { close: 'none' });   // toggle back
  // description edit open + escape
  { const d = await page.$('#descblock [data-editdesc]'); if (d) { await d.click().catch(()=>{}); await page.waitForTimeout(60); await esc(); } }
  // add sub-issue open + escape
  { const a = await page.$('[data-addsub]'); if (a) { await a.click().catch(()=>{}); await page.waitForTimeout(60); const inp = await page.$('#subinput'); if (inp) { await inp.press('Escape').catch(()=>{}); } } }
  // comment composer focus
  { const c = await page.$('#cinput'); if (c) { await c.click().catch(()=>{}); await c.type('sweep').catch(()=>{}); } }

  // =================== SCREEN 3: SUB-ISSUE DETAIL ===================
  await page.evaluate(()=>openIssue('VID-12587'));
  await page.waitForSelector('#descblock');
  stat.screens++; note.push('--- SUB-ISSUE DETAIL ---');
  await hoverAll('[data-tip]');
  await openAndHoverMenu('.ds-row[data-st]', 0);
  // parent card click (navigates up)
  { const pc = await page.$('.ds-card [data-row]'); if (pc) { await pc.click().catch(()=>{}); await page.waitForTimeout(80); } }
  // back to list
  await page.evaluate(()=>backToList());
  await page.waitForSelector('.row');

  // =================== SCREEN 4: PROJECTS BOARD ===================
  await page.evaluate(()=>{ const n=document.querySelector('[data-nav="video-proj"]'); n&&n.click(); });
  await page.waitForSelector('.pcard');
  stat.screens++; note.push('--- PROJECTS BOARD ---');
  await hoverAll('[data-tip]');
  await hoverAll('.pcard');                       // reveals card ⋯
  await hoverAll('.pcol-hd');
  await clickEach('.pcol-btn', { close: 'none' });  // toast stubs
  await clickEach('.pcard-dots', { close: 'none' });  // now opens a real ⋯ menu (Change status/Set lead/Set target/Copy link)
  await page.evaluate(()=>clearLayer());              // close the last-opened card menu before navigating
  await page.waitForTimeout(40);

  // =================== SCREEN 5: PROJECT DETAIL ===================
  await page.click('.pcard[data-project="aaron"]').catch(()=>{});
  await page.waitForSelector('.detail-side');
  stat.screens++; note.push('--- PROJECT DETAIL ---');
  await hoverAll('[data-tip]');
  await hoverAll('.ds-row');
  await hoverAll('.d-subrow');
  await clickEach('[data-cardtoggle]', { close: 'none' });
  await clickEach('[data-cardtoggle]', { close: 'none' });

  // =================== SCREEN 6: MY ISSUES ===================
  await page.evaluate(()=>{ const n=document.querySelector('[data-nav="my"]'); n&&n.click(); });
  await page.waitForTimeout(200);
  stat.screens++; note.push('--- MY ISSUES ---');
  await hoverAll('[data-tip]');

  // =================== SIDEBAR: team collapse + nav ===================
  await clickEach('[data-team]', { close: 'none' });   // collapse teams
  await clickEach('[data-team]', { close: 'none' });   // expand
  await clickEach('[data-sec]', { close: 'none' });    // collapse Workspace/Your teams sections
  await clickEach('[data-sec]', { close: 'none' });    // expand sections back
  await page.evaluate(()=>{ const n=document.querySelector('[data-nav="video-issues"]'); n&&n.click(); });
  await page.waitForSelector('.row');

  await page.waitForTimeout(150);
  await browser.close();

  console.log('SCREENS: '+stat.screens+' | HOVERED: '+stat.hovered+' | CLICKED: '+stat.clicked+' | MENUS: '+stat.menus);
  console.log(note.join('\n'));
  console.log('\n=== JS ERRORS during sweep: '+errors.length+' ===');
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('SWEEP CLEAN — no JS errors across all interactions.');
})().catch(e => { console.error('SWEEP CRASH:', e); process.exit(2); });
