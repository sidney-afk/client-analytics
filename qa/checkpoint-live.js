'use strict';
// LIVE, opt-in: a private input file supplies a real staff identity, the test
// review link and a disposable native card created through the app. No seeds,
// SQL mutations, response substitution or raw identities in the output.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const pw = require('playwright');
const L = require('./sxr_courier_lib');
const normalizeClient = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9&]/g,'');
const LIVE = 'https://syncview.synchrosocial.com';
const input = JSON.parse(fs.readFileSync(process.env.CHECKPOINT_LIVE_INPUT, 'utf8'));
const out = path.resolve(process.env.CHECKPOINT_LIVE_OUT);
fs.mkdirSync(out, { recursive: true });
assert.equal(new URL(input.link).origin, LIVE);
assert.equal(normalizeClient(new URL(input.link).searchParams.get('c')), 'sidneylaruel');
assert(input.identity.key && input.id.startsWith('p_native_'));
const results = [];
let phase = 'preflight';
const wait = ms => new Promise(r => setTimeout(r, ms));
const columns = 'id,status,caption,video_status,graphic_status,caption_status,video_tweaks,graphic_tweaks,caption_tweaks,video_deliverable_id,graphic_deliverable_id,kasper_finished_at,kasper_closed_at';
function row() {
  const rows = L.supaCal('client=eq.sidneylaruel&id=eq.' + encodeURIComponent(input.id) + '&select=' + columns);
  assert(Array.isArray(rows) && rows.length === 1, 'scoped read must return one card');
  return rows[0];
}
const initial = row();
assert.notEqual(initial.status, 'Archived');
const ids = new Set([input.id, initial.video_deliverable_id, initial.graphic_deliverable_id]);
function notes(r, part) { return JSON.parse(r[part + '_tweaks'] || '[]'); }
async function poll(pred, ms = 25000) {
  const start = Date.now(); let current;
  do { current = row(); if (pred(current)) return Date.now() - start; await wait(200); } while (Date.now() - start < ms);
  throw new Error('database result did not match');
}
function report(cell, action, ok, detail = {}) {
  const result = { cell, action, ok, ...detail }; results.push(result);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(result));
}
async function check(cell, action, run) {
  const start = Date.now();
  try { const extra = await run(); report(cell, action, true, { ms: Date.now() - start, ...extra }); }
  catch (e) { report(cell, action, false, { ms: Date.now() - start, error: e.name }); }
}
async function context(browser, staff, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
  ctx.setDefaultTimeout(6000);
  if (staff) await ctx.addInitScript(s => localStorage.setItem('syncview_staff_identity_v1', s), JSON.stringify(input.identity));
  await ctx.route('**/*', route => {
    const req = route.request();
    if (['GET','HEAD','OPTIONS'].includes(req.method())) return route.continue();
    const url = new URL(req.url());
    if (!url.hostname.endsWith('.supabase.co')) return route.abort();
    const fn = url.pathname.split('/').pop(); let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { return route.abort(); }
    if (['key-verify','client-token-verify','card-read','frameio-view','write-diagnostics'].includes(fn)) return route.continue();
    if (fn === 'production-write' && ['reconcile_receipt','read','list'].includes(body.operation)) return route.continue();
    if (fn === 'production-comments' && ['list','inbox','unread_count'].includes(body.action)) return route.continue();
    const named = [body.client,body.client_slug,body.slug].filter(Boolean);
    if (named.some(v => normalizeClient(v) !== 'sidneylaruel')) return route.abort();
    const target = body.post?.id || body.id || body.card_id || body.deliverable_id;
    if (target && ids.has(target) && (named.length || fn === 'production-write' || fn === 'production-comments')) return route.continue();
    report('guard','unrecognised mutation aborted',false,{endpoint:/^[a-z0-9-]+$/.test(fn)?fn:'unknown'});
    return route.abort();
  });
  return ctx;
}
const stage = p => p.locator('#svReviewStage');
async function ready(p, staff) {
  if (staff) {
    await p.waitForFunction(id => typeof calState === 'object' && !calState.loading && calState.posts.some(x => x.id === id), input.id, { timeout: 25000 });
    await p.locator('[data-cal-view="smmreview"]').click();
  }
  await p.waitForSelector('#svReviewStage #stepper', { timeout: 25000 });
  const title = await p.evaluate(() => document.querySelector('#svReviewStage').shadowRoot.querySelector('#side')?.textContent || '');
  assert(title.includes('Checkpoint'), 'the disposable card must be on stage');
}
async function setAll(p, status) {
  phase = 'setup: open staff client';
  await p.goto(LIVE + '/#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 25000 });
  phase = 'setup: wait for scoped card';
  await p.waitForFunction(id=>typeof calState==='object'&&!calState.loading&&calState.posts.some(x=>x.id===id),input.id,{timeout:25000});
  phase = 'setup: open Sheet';
  await p.locator('[data-cal-view="organizer"]').click({timeout:15000});
  const card = p.locator('.cal-card[data-pid="' + input.id + '"]');
  await p.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});
  phase = 'setup: open status menu';
  await card.locator('.cal-fld-setall').click();
  phase = 'setup: choose status';
  const choice = p.locator(`.cal-fld-status-item[onclick*="${input.id}"][onclick*="'${status}'"]`);
  await p.locator('.cal-fld-status-menu.open').waitFor({timeout:4000}).catch(async()=>{report('setup','status menu lost during startup',false);await card.locator('.cal-fld-setall').click();});
  await choice.click();
  if(await p.locator('#resolveDestOverlay.active').isVisible()) {
    await p.locator(status==='Client Approval'?'#resolveDestClient':'#resolveDestStay').click();
  }
  phase = 'setup: read status back';
  await poll(r => ['video','graphic','caption'].every(k => r[k + '_status'] === status));
}
async function note(p, part, text, staff) {
  await stage(p).locator('[data-step="' + part + '"]').click();
  await stage(p).locator('#ta').fill(text);
  if (!staff) await stage(p).locator('[data-pc="' + part + '"]').click();
  await stage(p).locator(staff ? '#sendBtn' : '#cmtBtn').click();
  await poll(r => notes(r, part).filter(n => n.body === text && !n.deleted_at).length === 1);
}
async function removeNote(p, text, staff) {
  const saved = row();
  const target = ['video','graphic','caption'].flatMap(k=>notes(saved,k)).find(n=>n.body===text&&!n.deleted&&!n.deleted_at);
  assert(target,'own saved note must exist before deletion');
  await p.getByRole('button',{name:'Sheet',exact:true}).click();
  await p.locator('.cal-card[data-pid="'+input.id+'"] .cal-comments-btn').click();
  await p.locator('[data-cm-row="'+target.id+'"] button[title="Delete"]').click();
  await p.locator('#confirmYes').click();
  await poll(r=>!['video','graphic','caption'].flatMap(k=>notes(r,k)).some(n=>n.id===target.id&&!n.deleted&&!n.deleted_at));
  await p.keyboard.press('Escape');
}
async function slowNote(p,part,text,staff) {
  const pattern='**/functions/v1/'+(staff?'calendar-card-write':'calendar-upsert');
  const delay=async route=>{await wait(3500);await route.fallback();};
  await p.route(pattern,delay);
  try{await note(p,part,text,staff);}finally{await p.unroute(pattern,delay);}
}
async function offlineNote(p,ctx,text,staff) {
  let toggled=false;
  const interrupt=async req=>{if(!toggled&&req.method()==='POST'&&/\/functions\/v1\/(calendar-upsert|calendar-card-write)$/.test(new URL(req.url()).pathname)){toggled=true;await ctx.setOffline(true);}};
  p.on('request',interrupt);
  try {
    await stage(p).locator('#ta').fill(text);await stage(p).locator(staff?'#sendBtn':'#cmtBtn').click();
    await wait(2000);await ctx.setOffline(false);
    assert(toggled,'offline interruption must occur during a real save');
    await poll(r=>['video','caption','graphic'].flatMap(k=>notes(r,k)).filter(n=>n.body===text&&!n.deleted&&!n.deleted_at).length===1,30000);
  } finally {p.off('request',interrupt);await ctx.setOffline(false);}
}
async function shot(p, name) {
  const client = await p.evaluate(() => typeof calState === 'object' ? calState.client : '');
  await p.evaluate(names => {
    const walk = root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
      while ((n = walker.nextNode())) if (names.some(name => name && n.textContent.includes(name))) n.parentElement?.setAttribute('data-checkpoint-private','');
      root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) walk(e.shadowRoot); });
    }; walk(document);
  }, [...new Set([client,input.identity.member.name].flatMap(name=>[name,...String(name||'').split(/\s+/).filter(word=>word.length>2)]))]);
  await p.screenshot({ path: path.join(out,name+'.png'), mask: [p.locator('[data-checkpoint-private]')], fullPage: false });
}
async function reviewerReady(p) {
  await p.goto(LIVE+'/#kasper',{waitUntil:'domcontentloaded',timeout:25000});
  await p.locator('[data-kasper-tab="review"]').click({timeout:20000});
  await p.waitForSelector('#svReviewStage #stepper',{timeout:25000});
  const chip=stage(p).locator('.chipp[data-id="'+input.id+'"]');
  if(await chip.count()) await chip.click();
  await p.waitForFunction(()=>document.querySelector('#svReviewStage')?.shadowRoot?.querySelector('#side')?.textContent.includes('Checkpoint'),null,{timeout:15000});
}
async function confirmIfAsked(p) {
  if(await p.locator('#confirmOverlay.active').isVisible()) await p.locator('#confirmYes').click();
}
async function reviewerPass(setup) {
  for(const engine of ['chromium','firefox','webkit']) for(const width of [1440,390]) {
    const cell='reviewer-'+engine+'-'+width;
    await setAll(setup,'Kasper Approval');
    const browser=await pw[engine].launch(),ctx=await context(browser,true,width),p=await ctx.newPage();
    const errors=[];
    p.on('pageerror',e=>errors.push({kind:e.name,codes:e.message.match(/repair_[a-z_]+|_[A-Za-z0-9_]+ is not defined/g)||[],functions:[...String(e.stack||'').matchAll(/at ([A-Za-z_$][A-Za-z0-9_$]*)/g)].map(m=>m[1]).slice(0,5)}));
    try {
      await check(cell,'open',()=>reviewerReady(p));
      await check(cell,'play',async()=>{await stage(p).locator('.fv-play').click();await p.waitForFunction(()=>{const v=document.querySelector('#svReviewStage')?.shadowRoot?.querySelector('video');return v&&!v.paused&&v.currentTime>0.1;},null,{timeout:10000});});
      for(const part of ['video','caption'])await check(cell,part+' note',()=>note(p,part,'Checkpoint '+cell+' '+part,true));
      await check(cell,'reload typing',async()=>{await stage(p).locator('#ta').fill('Checkpoint '+cell+' draft');await p.reload({waitUntil:'domcontentloaded',timeout:25000});await reviewerReady(p);assert.equal(await stage(p).locator('#ta').inputValue(),'Checkpoint '+cell+' draft');await stage(p).locator('#ta').fill('');});
      await check(cell,'slow save',()=>slowNote(p,'video','Checkpoint '+cell+' slow',true));
      await check(cell,'offline save and return',()=>offlineNote(p,ctx,'Checkpoint '+cell+' offline',true));
      await check(cell,'two tabs',async()=>{const peer=await ctx.newPage();try{await reviewerReady(peer);await Promise.all([note(p,'video','Checkpoint '+cell+' tab A',true),note(peer,'video','Checkpoint '+cell+' tab B',true)]);}finally{await peer.close();}});
      await check(cell,'change video',async()=>{await stage(p).locator('[data-step="video"]').click();await stage(p).locator('[data-chg="video"]').click();await stage(p).locator('#ta').fill('Checkpoint '+cell+' change');await stage(p).locator('#sendBtn').click();await confirmIfAsked(p);await poll(r=>r.video_status==='Tweaks Needed'&&notes(r,'video').some(n=>n.body==='Checkpoint '+cell+' change'));});
      for(const part of ['graphic','caption'])await check(cell,'approve '+part,async()=>{await stage(p).locator('[data-step="'+part+'"]').click();await stage(p).locator('[data-ok="'+part+'"]').click();await confirmIfAsked(p);await poll(r=>r[part+'_status']==='Client Approval');});
      await check(cell,'finish after changes',async()=>{await stage(p).locator('#finishBtn').click();await poll(r=>!!r.kasper_finished_at);});
      await setAll(setup,'Kasper Approval');
      await check(cell,'approve video',async()=>{await reviewerReady(p);await stage(p).locator('[data-ok="video"]').click();await confirmIfAsked(p);await poll(r=>r.video_status==='Client Approval');});
      report(cell,'browser exceptions',errors.length===0,{errors});
    }finally{await ctx.setOffline(false).catch(()=>{});await browser.close();}
  }
}
(async () => {
  // Keep one staff browser solely for app-owned setup/cleanup. Every journey
  // uses the named engine and its own fresh staff/client contexts.
  const setupBrowser = await pw.chromium.launch();
  const setupCtx = await context(setupBrowser,true,1440), setup = await setupCtx.newPage();
  try {
    if(process.env.CHECKPOINT_REVIEWER_ONLY!=='1') for (const engine of ['chromium','firefox','webkit']) for (const width of [1440,390]) {
      const cell = engine+'-'+width;
      await setAll(setup,'Client Approval');
      const browser = await pw[engine].launch();
      const cc = await context(browser,false,width), client = await cc.newPage();
      const sc = await context(browser,true,width), staff = await sc.newPage();
      const errors = []; for (const p of [client,staff]) p.on('pageerror',()=>errors.push(1));
      try {
        await check(cell,'client open',async()=>{await client.goto(input.link,{waitUntil:'domcontentloaded',timeout:25000});await ready(client,false);});
        await check(cell,'client play',async()=>{
          await stage(client).locator('.fv-play').click();
          await client.waitForFunction(()=>{const v=document.querySelector('#svReviewStage')?.shadowRoot?.querySelector('video');return v&&!v.paused&&v.currentTime>0.1;},null,{timeout:10000});
        });
        for (const part of ['video','caption']) await check(cell,'client '+part+' note',()=>note(client,part,'Checkpoint '+cell+' client '+part,false));
        await check(cell,'client caption edit',async()=>{await stage(client).locator('[data-step="caption"]').click();await stage(client).locator('#editBtn').click();await stage(client).locator('#capTa').fill('Checkpoint '+cell+' caption');await stage(client).locator('#capSave').click();await poll(r=>r.caption==='Checkpoint '+cell+' caption');});
        await check(cell,'client reload typing',async()=>{await stage(client).locator('#ta').fill('Checkpoint '+cell+' reload draft');await client.reload({waitUntil:'domcontentloaded',timeout:25000});await ready(client,false);assert.equal(await stage(client).locator('#ta').inputValue(),'Checkpoint '+cell+' reload draft');await stage(client).locator('#ta').fill('');});
        await check(cell,'client slow save',()=>slowNote(client,'video','Checkpoint '+cell+' slow',false));
        await check(cell,'client offline save and return',()=>offlineNote(client,cc,'Checkpoint '+cell+' offline',false));
        await check(cell,'client two tabs',async()=>{
          const peer=await cc.newPage();try{await peer.goto(input.link,{waitUntil:'domcontentloaded',timeout:25000});await ready(peer,false);await Promise.all([note(client,'video','Checkpoint '+cell+' tab A',false),note(peer,'video','Checkpoint '+cell+' tab B',false)]);}finally{await peer.close();}
        });
        await check(cell,'client change request',async()=>{await stage(client).locator('[data-step="video"]').click();await stage(client).locator('[data-chg="video"]').click();await stage(client).locator('#ta').fill('Checkpoint '+cell+' change');await stage(client).locator('#sendBtn').click();await poll(r=>r.video_status==='Tweaks Needed'&&notes(r,'video').some(n=>n.body==='Checkpoint '+cell+' change'));});
        for(const part of ['graphic','caption']) await check(cell,'client approve '+part,async()=>{await stage(client).locator('[data-step="'+part+'"]').click();await stage(client).locator('[data-ok="'+part+'"]').click();await poll(r=>r[part+'_status']==='Approved');});
        await shot(client,cell+'-client');
        await check(cell,'client delete own note',()=>removeNote(client,'Checkpoint '+cell+' client video',false));
        await setAll(setup,'Client Approval');
        await check(cell,'client approve video',async()=>{await client.goto(input.link,{waitUntil:'domcontentloaded',timeout:25000});await ready(client,false);await stage(client).locator('[data-ok="video"]').click();await poll(r=>r.video_status==='Approved');});
        await setAll(setup,'For SMM Approval');
        await check(cell,'staff open',async()=>{await staff.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(staff,true);});
        await check(cell,'staff video note',()=>note(staff,'video','Checkpoint '+cell+' staff video',true));
        await check(cell,'staff caption note',()=>note(staff,'caption','Checkpoint '+cell+' staff caption',true));
        await check(cell,'staff play',async()=>{await stage(staff).locator('[data-step="video"]').click();await stage(staff).locator('.fv-play').click();await staff.waitForFunction(()=>{const v=document.querySelector('#svReviewStage')?.shadowRoot?.querySelector('video');return v&&!v.paused&&v.currentTime>0.1;},null,{timeout:10000});});
        await check(cell,'staff reload typing',async()=>{await stage(staff).locator('#ta').fill('Checkpoint '+cell+' staff reload draft');await staff.reload({waitUntil:'domcontentloaded',timeout:25000});await ready(staff,true);assert.equal(await stage(staff).locator('#ta').inputValue(),'Checkpoint '+cell+' staff reload draft');await stage(staff).locator('#ta').fill('');});
        await check(cell,'staff caption edit',async()=>{await stage(staff).locator('[data-step="caption"]').click();await stage(staff).locator('#editBtn').click();await stage(staff).locator('#capTa').fill('Checkpoint '+cell+' staff caption edit');await stage(staff).locator('#capSave').click();await poll(r=>r.caption==='Checkpoint '+cell+' staff caption edit');});
        await check(cell,'staff slow save',()=>slowNote(staff,'video','Checkpoint '+cell+' staff slow',true));
        await check(cell,'staff offline save and return',()=>offlineNote(staff,sc,'Checkpoint '+cell+' staff offline',true));
        await check(cell,'staff two tabs',async()=>{const peer=await sc.newPage();try{await peer.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(peer,true);await Promise.all([note(staff,'video','Checkpoint '+cell+' staff tab A',true),note(peer,'video','Checkpoint '+cell+' staff tab B',true)]);}finally{await peer.close();}});
        await check(cell,'staff change request',async()=>{await stage(staff).locator('[data-step="video"]').click();await stage(staff).locator('[data-chg="video"]').click();await stage(staff).locator('#ta').fill('Checkpoint '+cell+' staff change');await stage(staff).locator('#sendBtn').click();await poll(r=>r.video_status==='Tweaks Needed'&&notes(r,'video').some(n=>n.body==='Checkpoint '+cell+' staff change'));});
        for(const part of ['graphic','caption']) await check(cell,'staff approve '+part,async()=>{await stage(staff).locator('[data-step="'+part+'"]').click();await stage(staff).locator('[data-ok="'+part+'"]').click();await poll(r=>r[part+'_status']==='Kasper Approval');});
        await shot(staff,cell+'-staff');
        await check(cell,'staff delete own note',()=>removeNote(staff,'Checkpoint '+cell+' staff video',true));
        await setAll(setup,'For SMM Approval');
        await check(cell,'staff approve video',async()=>{await staff.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(staff,true);await stage(staff).locator('[data-ok="video"]').click();await poll(r=>r.video_status==='Kasper Approval');});
        report(cell,'browser exceptions',errors.length===0,{count:errors.length});
      } finally { await cc.setOffline(false).catch(()=>{});await browser.close(); }
    }
    await reviewerPass(setup);
  } finally {
    await setup.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});
    await setup.locator('.cal-card[data-pid="'+input.id+'"] .cal-card-del').click();
    await setup.locator('#confirmYes').click();
    await poll(r=>r.status==='Archived',30000);
    report('cleanup','disposable card archived through app',true);
    await setupBrowser.close();
  }
})().catch(e=>{report('run','unhandled harness failure',false,{error:e.name,phase});process.exitCode=1;});
