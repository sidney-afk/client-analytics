const { chromium } = require('playwright');
const path = require('path');

const OUT = 'C:/Users/Sidney/linear-design-probe/out';
const URL = 'file:///' + OUT + '/_sv.html';
const errors = [];
const log = [];
function ok(cond, msg){ log.push((cond?'PASS':'FAIL')+': '+msg); if(!cond) errors.push('ASSERT FAIL: '+msg); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  page.on('console', m => { if(m.type()==='error') errors.push('CONSOLE.ERROR: '+m.text()); });

  const openId = () => page.evaluate(()=>{ const el=document.querySelector('.crumb-detail b'); return el?el.textContent.trim():null; });
  const isList = () => page.evaluate(()=> !!document.querySelector('.listwrap') && !document.querySelector('.detail'));
  const shot = (n) => page.screenshot({ path: OUT+'/_qa-'+n+'.png' });

  await page.goto(URL);
  await page.waitForSelector('.row');
  await shot('01-list');

  // ============ FEATURE 1: editable description (parent) ============
  await page.evaluate(()=>openIssue('VID-12586'));
  await page.waitForSelector('#descblock');
  ok(await openId()==='VID-12586', 'opened parent VID-12586');
  ok(await page.$('[data-addsub]')!==null, 'parent detail shows Add sub-issue button');
  await page.click('#descblock [data-editdesc]');
  await page.waitForSelector('#descedit', { timeout:2000 });
  await page.fill('#descedit', 'QA-EDITED: four long-form YouTube edits, revised.');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(120);
  const d1 = await page.evaluate(()=>byId('VID-12586').desc);
  ok(d1==='QA-EDITED: four long-form YouTube edits, revised.', 'parent desc saved via Cmd/Ctrl+Enter (got: '+d1+')');
  ok(await page.$('#descedit')===null, 'desc textarea closed after save');
  await shot('02-desc-saved');

  // Escape cancels an edit (no save)
  await page.click('#descblock [data-editdesc]');
  await page.waitForSelector('#descedit');
  await page.fill('#descedit', 'THIS SHOULD NOT PERSIST');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  const d2 = await page.evaluate(()=>byId('VID-12586').desc);
  ok(d2==='QA-EDITED: four long-form YouTube edits, revised.', 'Escape cancels desc edit (unchanged)');

  // Empty-desc editing on a sub-issue (placeholder path) + blur-to-save
  await page.evaluate(()=>openIssue('VID-12587'));
  await page.waitForSelector('#descblock');
  ok(await page.$('#descblock .d-desctext.empty')!==null, 'empty sub desc shows placeholder styling');
  ok(await page.$('[data-addsub]')===null, 'sub-issue detail has NO Add sub-issue button');
  await page.click('#descblock [data-editdesc]');
  await page.waitForSelector('#descedit');
  await page.fill('#descedit', 'Sub note added by QA.');
  await page.evaluate(()=>{ const t=document.getElementById('descedit'); if(t) t.blur(); }); // blur -> save
  await page.waitForTimeout(120);
  const d3 = await page.evaluate(()=>byId('VID-12587').desc);
  ok(d3==='Sub note added by QA.', 'sub desc saved on blur (got: '+d3+')');

  // ============ FEATURE 2: add sub-issue ============
  await page.evaluate(()=>openIssue('VID-12586'));
  await page.waitForSelector('[data-addsub]');
  const kidsBefore = await page.evaluate(()=>childrenOf('VID-12586').length);
  const subBefore = await page.evaluate(()=>{const s=byId('VID-12586').sub; return s?s.slice():null;});
  await page.click('[data-addsub]');
  await page.waitForSelector('#subinput', { timeout:2000 });
  await page.fill('#subinput', 'QA new sub-issue');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const kidsAfter = await page.evaluate(()=>childrenOf('VID-12586').length);
  ok(kidsAfter===kidsBefore+1, 'child count incremented ('+kidsBefore+'→'+kidsAfter+')');
  // Linear behavior: plain Enter creates the sub, KEEPS the composer open, stays on the parent
  ok(await openId()==='VID-12586', 'stayed on parent after adding sub (composer stays open)');
  ok(await page.$('#subinput')!==null, 'sub-issue composer stays open for rapid entry');
  const newChild = await page.evaluate(()=>{const ks=childrenOf('VID-12586'); return ks[ks.length-1];});
  ok(newChild && newChild.title==='QA new sub-issue', 'new sub created with typed title (got: '+(newChild&&newChild.title)+')');
  ok(newChild && newChild.parent==='VID-12586', 'new sub parent set correctly');
  const subAfter = await page.evaluate(()=>{const s=byId('VID-12586').sub; return s?s.slice():null;});
  ok(subAfter && subBefore && subAfter[1]===subBefore[1]+1, 'parent sub-count total bumped ('+JSON.stringify(subBefore)+'→'+JSON.stringify(subAfter)+')');
  // Cmd/Ctrl+Enter creates AND opens the new sub
  await page.fill('#subinput', 'QA cmd sub');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(150);
  const cmdTitle = await page.evaluate(()=>{const id=document.querySelector('.crumb-detail b').textContent.trim(); return byId(id).title;});
  ok(cmdTitle==='QA cmd sub', 'Cmd+Enter creates and opens the new sub (got: '+cmdTitle+')');
  await shot('03-new-sub-open');
  // empty title: Enter creates NO phantom sub-issue and keeps the composer open (Linear behavior)
  await page.evaluate(()=>openIssue('VID-12586'));
  await page.waitForSelector('[data-addsub]');
  const emptyCountBefore = await page.evaluate(()=>childrenOf('VID-12586').length);
  await page.click('[data-addsub]');
  await page.waitForSelector('#subinput');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const emptyCountAfter = await page.evaluate(()=>childrenOf('VID-12586').length);
  ok(emptyCountAfter===emptyCountBefore, 'empty title creates no sub-issue ('+emptyCountBefore+'→'+emptyCountAfter+')');
  ok(await page.$('#subinput')!==null, 'sub composer stays open after empty Enter');

  // ============ FEATURE 3: browser back / forward ============
  // Reset to list, then drill: list -> parent -> sub, then back x2, then forward.
  await page.evaluate(()=>backToList());
  await page.waitForSelector('.listwrap');
  ok(await isList(), 'reset to list view');
  await page.evaluate(()=>openIssue('VID-12578'));   // parent
  await page.waitForSelector('.d-subrow');
  ok(await openId()==='VID-12578', 'drilled into parent VID-12578');
  await page.click('.d-subrow[data-row="VID-12579"]'); // sub
  await page.waitForSelector('#descblock');
  ok(await openId()==='VID-12579', 'drilled into sub VID-12579');

  await page.evaluate(()=>history.back());
  await page.waitForTimeout(150);
  ok(await openId()==='VID-12578', 'browser BACK -> parent VID-12578');
  await page.evaluate(()=>history.back());
  await page.waitForTimeout(150);
  ok(await isList(), 'browser BACK -> list');
  await page.evaluate(()=>history.forward());
  await page.waitForTimeout(150);
  ok(await openId()==='VID-12578', 'browser FORWARD -> parent VID-12578');

  // Top-bar back arrow should mirror browser back
  await page.click('[data-act="back"]');
  await page.waitForTimeout(150);
  ok(await isList(), 'top-bar back arrow -> list');

  // History hygiene: re-opening the SAME issue must not add a duplicate entry
  await page.evaluate(()=>backToList());
  await page.waitForSelector('.listwrap');
  await page.evaluate(()=>openIssue('VID-12578'));
  await page.waitForSelector('#descblock');
  const hlen1 = await page.evaluate(()=>history.length);
  await page.evaluate(()=>openIssue('VID-12578'));
  await page.waitForTimeout(80);
  const hlen2 = await page.evaluate(()=>history.length);
  ok(hlen2===hlen1, 're-opening same issue adds no history entry ('+hlen1+'->'+hlen2+')');
  ok(await openId()==='VID-12578', 'still on VID-12578 after re-open');
  // "Back to list" must not stack a redundant entry -> browser back lands on a list, not the issue
  await page.evaluate(()=>{ const b=document.querySelector('[data-act="close-detail"]'); b&&b.click(); });
  await page.waitForSelector('.listwrap');
  ok(await isList(), 'sidebar "Back to list" -> list');
  await page.evaluate(()=>history.back());
  await page.waitForTimeout(150);
  ok(await isList(), 'browser BACK after "Back to list" stays on a list (no issue ping-pong)');

  // ---- Richer Filter (stackable conditions) ----
  await page.click('#filterbtn');
  await page.waitForSelector('[data-ffield="status"]', { timeout:2000 });
  await page.click('[data-ffield="status"]');
  await page.waitForSelector('#layer [data-fv]');
  await page.evaluate(()=>{ const pick=n=>{ const el=[...document.querySelectorAll('#layer [data-fv]')].find(e=>e.textContent.trim()===n); el&&el.click(); }; pick('In Progress'); pick('For Client Approval'); });
  await page.waitForTimeout(100);
  ok(await page.$('.fpill')!==null, 'Status filter pill appears');
  const pillTxt = await page.$eval('.fpill', el=>el.textContent);
  ok(/is any of/.test(pillTxt) && /2 statuses/.test(pillTxt), 'pill reads "is any of 2 statuses" (got: '+pillTxt+')');
  const onlyMatching = await page.evaluate(()=> [...document.querySelectorAll('.row')].every(r=>{ const id=r.getAttribute('data-row'); const s=byId(id).status; return s==='prog'||s==='client'; }));
  ok(onlyMatching, 'list shows only In Progress / For Client Approval rows');
  await page.evaluate(()=>clearLayer());
  // add a second condition (Client)
  await page.click('#filterbtn');
  await page.waitForSelector('[data-ffield="client"]');
  await page.click('[data-ffield="client"]');
  await page.waitForSelector('#layer [data-fv]');
  await page.evaluate(()=>{ const el=[...document.querySelectorAll('#layer [data-fv]')].find(e=>e.textContent.includes('John Wineland')); el&&el.click(); });
  await page.waitForTimeout(80);
  await page.evaluate(()=>clearLayer());
  ok((await page.$$('.fpill')).length===2, 'two filter pills stack (Status + Client)');
  // filters preserved across browser BACK
  const firstRow = await page.$eval('.row', el=>el.getAttribute('data-row'));
  await page.evaluate(id=>openIssue(id), firstRow);
  await page.waitForSelector('#descblock');
  await page.evaluate(()=>history.back());
  await page.waitForTimeout(150);
  ok((await page.$$('.fpill')).length===2, 'filters PRESERVED after browser BACK to list');
  // remove one condition via the pill ✕
  await page.click('.fpill .fx');
  await page.waitForTimeout(80);
  ok((await page.$$('.fpill')).length===1, 'pill ✕ removes one condition');
  // nav reset clears all filters
  await page.evaluate(()=>{ const n=document.querySelector('[data-nav="video-issues"]'); n&&n.click(); });
  await page.waitForSelector('.row');
  ok((await page.$$('.fpill')).length===0, 'nav reset clears all filters');

  // ---- Project detail (Properties card style) ----
  await page.evaluate(()=>{ const n=document.querySelector('[data-nav="video-proj"]'); n&&n.click(); });
  await page.waitForSelector('.pcard');
  await page.click('.pcard[data-project="aaron"]');
  await page.waitForSelector('.detail-side');
  ok(await page.$('.detail-side .ds-card')!==null, 'project detail uses Properties card (.ds-card)');
  ok(await page.$('.detail-side .ds-prop')===null, 'project detail no longer uses legacy .ds-prop rows');
  await page.evaluate(()=>history.back());
  await page.waitForTimeout(120);

  // Project drill + back
  await page.evaluate(()=>{ const n=document.querySelector('[data-nav="video-proj"]'); n&&n.click(); });
  await page.waitForSelector('.board', { timeout:2000 });
  await page.click('.pcard[data-project="aaron"]');
  await page.waitForSelector('.detail', { timeout:2000 });
  ok(await page.$('.crumb-detail')!==null, 'opened project detail');
  await page.evaluate(()=>history.back());
  await page.waitForTimeout(150);
  ok(await page.$('.board')!==null, 'browser BACK -> projects board');
  await shot('04-projects');

  // ============ REGRESSION: existing menus still work, no errors ============
  await page.evaluate(()=>{ const n=document.querySelector('[data-nav="video-issues"]'); n&&n.click(); });
  await page.waitForSelector('.row');
  // status menu
  await page.click('.row .st');
  await page.waitForSelector('.pop', { timeout:2000 });
  ok(await page.$('.pop [data-search]')!==null, 'status picker opens with search');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  // context menu + submenu cascade
  await page.click('.row .rid', { button:'right' });
  await page.waitForSelector('.pop', { timeout:2000 });
  await page.hover('[data-ctx="due"]');
  await page.waitForTimeout(120);
  ok((await page.$$('.pop')).length>=2, 'context menu -> due submenu cascades');
  await shot('05-ctx-due');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  // group-by menu
  await page.click('#groupbtn');
  await page.waitForSelector('.pop', { timeout:2000 });
  ok((await page.$$('.pop [data-grp]')).length===3, 'group-by menu has 3 options');
  await page.keyboard.press('Escape');

  await page.waitForTimeout(100);
  await browser.close();

  console.log(log.join('\n'));
  console.log('\n=== JS ERRORS: '+errors.filter(e=>e.startsWith('PAGEERROR')||e.startsWith('CONSOLE')).length+' ===');
  console.log('=== ASSERT FAILS: '+errors.filter(e=>e.startsWith('ASSERT')).length+' ===');
  if(errors.length){ console.log('\nERRORS:\n'+errors.join('\n')); process.exit(1); }
  console.log('\nALL GREEN');
})().catch(e=>{ console.error('HARNESS CRASH:', e); process.exit(2); });
