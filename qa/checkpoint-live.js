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
const RUN = 'Checkpoint ' + Date.now().toString(36);
const FOLLOWUP = process.env.CHECKPOINT_FOLLOWUP_ONLY || '';
assert(['','client','reviewer','offline','staff','finish','cleanup'].includes(FOLLOWUP),'unknown live follow-up selector');
const ONLY_CELLS=(process.env.CHECKPOINT_LIVE_CELLS||'').split(',').filter(Boolean);
assert(!ONLY_CELLS.length||(FOLLOWUP==='offline'&&ONLY_CELLS.every(cell=>/^offline-(client|smm|reviewer)-(chromium|firefox|webkit)-(1440|390)$/.test(cell))),'cell selection is only for named offline follow-ups');
const input = JSON.parse(fs.readFileSync(process.env.CHECKPOINT_LIVE_INPUT, 'utf8'));
const out = path.resolve(process.env.CHECKPOINT_LIVE_OUT);
fs.mkdirSync(out, { recursive: true });
assert.equal(new URL(input.link).origin, LIVE);
assert.equal(normalizeClient(new URL(input.link).searchParams.get('c')), 'sidneylaruel');
assert(input.identity.key && input.id.startsWith('p_native_'));
const results = [];
let phase = 'preflight';
const wait = ms => new Promise(r => setTimeout(r, ms));
const columns = 'id,name,status,caption,video_status,graphic_status,caption_status,video_tweaks,graphic_tweaks,caption_tweaks,video_deliverable_id,graphic_deliverable_id,kasper_finished_at,kasper_closed_at';
function row() {
  const rows = L.supaCal('client=eq.sidneylaruel&id=eq.' + encodeURIComponent(input.id) + '&select=' + columns);
  assert(Array.isArray(rows) && rows.length === 1, 'scoped read must return one card');
  return rows[0];
}
const initial = row();
assert.notEqual(initial.status, 'Archived');
assert(String(initial.name||'').includes('Checkpoint QA disposable'),'input must identify the app-created disposable card');
const ids = new Set([input.id, initial.video_deliverable_id, initial.graphic_deliverable_id]);
async function parkedNativeItems() {
  const nativeIds=[initial.video_deliverable_id,initial.graphic_deliverable_id];
  assert(nativeIds.every(id=>/^del_[a-f0-9-]+$/.test(id)));
  const response=L.filelessHttpRequest('GET',L.SUPA+'/rest/v1/production_deliverables_browser_v1?client_slug=eq.sidneylaruel&id=in.('+nativeIds.join(',')+')&select=id,status',{apikey:L.KEY,Authorization:'Bearer '+L.KEY});
  const rows=JSON.parse(response.body.toString('utf8'));
  assert(Array.isArray(rows)&&rows.length===2&&rows.every(r=>nativeIds.includes(r.id)),'scoped native read must return both work items');
  return rows.every(r=>r.status==='backlog');
}
function notes(r, part) { return JSON.parse(r[part + '_tweaks'] || '[]'); }
async function poll(pred, ms = 25000) {
  const start = Date.now(); let current;
  do { current = row(); if (pred(current)) return Date.now() - start; await wait(200); } while (Date.now() - start < ms);
  throw new Error('database result did not match');
}
function report(cell, action, ok, detail = {}) {
  const result = { run: RUN, cell, action, ok, ...detail }; results.push(result);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(result));
}
async function check(cell, action, run) {
  phase=cell+': '+action;
  const start = Date.now();
  try { const extra = await run(); report(cell, action, true, { ms: Date.now() - start, ...extra }); }
  catch (e) { report(cell, action, false, { ms: Date.now() - start, error: e.name, ...e.detail }); }
}
async function context(browser, staff, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
  ctx.setDefaultTimeout(6000);
  if (staff) await ctx.addInitScript(s => localStorage.setItem('syncview_staff_identity_v1', s), JSON.stringify(input.identity));
  ctx.on('page',page=>page.on('response',async response=>{
    const fn=new URL(response.url()).pathname.split('/').pop();
    if(!['production-write','calendar-card-write','calendar-upsert','production-comments'].includes(fn)||response.request().method()!=='POST')return;
    const body=await response.json().catch(()=>null);
    const code=typeof body?.error==='string'?body.error:(body?.error?.code||body?.code||'');
    if(!response.ok()||body?.ok===false)report('server','write refused',false,{phase,endpoint:fn,status:response.status(),code:/^[a-z][a-z0-9_]{1,79}$/.test(String(code))?code:'unclassified',conflict:body?.conflict===true,messageClass:/^Not saved: someone else updated this card/.test(String(body?.error||''))?'stale_card':undefined,errorKeys:body?.error&&typeof body.error==='object'?Object.keys(body.error):[]});
  }));
  await ctx.route('**/*', route => {
    const req = route.request();
    if (['GET','HEAD','OPTIONS'].includes(req.method())) return route.continue();
    const url = new URL(req.url());
    if (!url.hostname.endsWith('.supabase.co')) return route.abort();
    const fn = url.pathname.split('/').pop(); let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { return route.abort(); }
    if (['key-verify','client-token-verify','card-read','frameio-view','write-diagnostics','analytics-read','thumbnail-revision-read'].includes(fn)
      || (fn==='brain'&&['read','folders'].includes(body.action))) return route.continue();
    if (fn === 'production-write' && ['reconcile_receipt','read','list'].includes(body.operation)) return route.continue();
    if (fn === 'production-comments' && ['list','inbox','unread_count'].includes(body.action)) return route.continue();
    if (fn === 'workload-plan' && ['list','native_snapshot','native_snapshot_v2'].includes(body.action)) return route.continue();
    const named = [body.client,body.client_slug,body.slug].filter(Boolean);
    if (named.some(v => normalizeClient(v) !== 'sidneylaruel')) return route.abort();
    const target = body.post?.id || body.id || body.card_id || body.deliverable_id;
    if (target && ids.has(target) && (named.length || fn === 'production-write' || fn === 'production-comments')) return route.continue();
    report('guard','unrecognised mutation aborted',false,{endpoint:/^[a-z0-9-]+$/.test(fn)?fn:'unknown',phase,operation:/^[a-z_]{1,60}$/.test(String(body.action||''))?body.action:undefined,keys:Object.keys(body),postKeys:Object.keys(body.post||{}),targetKnown:ids.has(target),namedCount:named.length});
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
  await stage(p).locator('[data-step="'+part+'"][aria-current="step"]').waitFor();
  await stage(p).locator('#ta').fill(text);
  if (!staff) await stage(p).locator('[data-pc="' + part + '"]').click();
  const noteButton=stage(p).locator('#noteBtn');
  await (staff&&await noteButton.isVisible()?noteButton:stage(p).locator(staff ? '#sendBtn' : '#cmtBtn')).click();
  await poll(r => notes(r, part).filter(n => n.body === text && !n.deleted_at).length === 1);
}
async function removeNote(p, text, staff) {
  const saved = row();
  const target = ['video','graphic','caption'].flatMap(k=>notes(saved,k)).find(n=>n.body===text&&!n.deleted&&!n.deleted_at);
  assert(target,'own saved note must exist before deletion');
  await p.getByRole('button',{name:'Sheet',exact:true}).click();
  await p.locator('.cal-card[data-pid="'+input.id+'"] .cal-comments-btn').click();
  await p.locator('[data-cm-row="'+target.id+'"]').hover();
  await p.locator('[data-cm-row="'+target.id+'"]').getByRole('button',{name:'Delete',exact:true}).click();
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
  let toggled=false,togglePromise,interruptedEndpoint;
  const interrupt=async req=>{const endpoint=new URL(req.url()).pathname.split('/').pop();if(!toggled&&req.method()==='POST'&&(req.postData()||'').includes(text)&&['calendar-upsert','calendar-card-write','production-write','production-comments'].includes(endpoint)){toggled=true;interruptedEndpoint=endpoint;togglePromise=ctx.setOffline(true);await togglePromise;}};
  p.on('request',interrupt);
  try {
    await stage(p).locator('[data-step="video"]').click();
    await stage(p).locator('[data-step="video"][aria-current="step"]').waitFor();
    await stage(p).locator('#ta').fill(text);const nb=stage(p).locator('#noteBtn');await (staff&&await nb.isVisible()?nb:stage(p).locator(staff?'#sendBtn':'#cmtBtn')).click();
    const sentAt=Date.now();while(!toggled&&Date.now()-sentAt<15000)await wait(50);
    if(!toggled){const e=new Error('offline interruption did not observe the save request');e.detail={interruptionOccurred:false};throw e;}
    await togglePromise;await wait(2000);await ctx.setOffline(false);
    try {
      await poll(r=>['video','caption','graphic'].flatMap(k=>notes(r,k)).filter(n=>n.body===text&&!n.deleted&&!n.deleted_at).length===1,30000);
    } catch(e) {
      const ui=await p.evaluate(text=>{
        const root=document.querySelector('#svReviewStage')?.shadowRoot;
        const contains=store=>{try{return Object.keys(store).some(key=>String(store.getItem(key)||'').includes(text));}catch{return null;}};
        return {draftVisible:root?.querySelector('#ta')?.value===text,legacyDraftRetained:typeof _calReviewState==='object'&&Object.values(_calReviewState.drafts||{}).includes(text),reviewerDraftRetained:typeof _kasperState==='object'&&(_kasperState.items||[]).some(item=>Object.values(item._drafts||{}).includes(text)),localCopyRetained:contains(localStorage),sessionCopyRetained:contains(sessionStorage),wordBubbleShown:!!root?.textContent.includes(text),alertCount:root?.querySelectorAll('.err').length||0,retryOffered:!!root?.querySelector('[data-retry]'),promisesAutomaticFinish:!!root?.textContent.includes('Nothing is lost: it finishes here on its own.')};
      },text);
      const count=()=>['video','caption','graphic'].flatMap(k=>notes(row(),k)).filter(n=>n.body===text&&!n.deleted&&!n.deleted_at).length;
      e.detail={interruptionOccurred:true,interruptedEndpoint,...ui,savedCount:count()};
      // Retain the failed 30-second observation even if an explicit app-owned
      // retry or reload later recovers the same durable operation.
      if(ui.retryOffered||ui.localCopyRetained) {
        try {
          if(ui.retryOffered){await stage(p).locator('[data-retry]').first().click();e.detail.recoveryAction='visible retry';}
          else{await p.reload({waitUntil:'domcontentloaded',timeout:25000});if(new URL(p.url()).hash==='#kasper')await reviewerReady(p,false);else await ready(p,staff);e.detail.recoveryAction='reload';}
          await poll(r=>['video','caption','graphic'].flatMap(k=>notes(r,k)).filter(n=>n.body===text&&!n.deleted&&!n.deleted_at).length===1,15000);
        }catch(recoveryError){e.detail.recoveryError=recoveryError.name;}
        e.detail.afterRecoverySavedCount=count();
      }
      throw e;
    }
    return {interruptionOccurred:true,interruptedEndpoint};
  } finally {p.off('request',interrupt);await ctx.setOffline(false);}
}
async function offlinePass(setup) {
  for(const engine of ['chromium','firefox','webkit'])for(const width of [1440,390])for(const role of ['client','smm','reviewer']) {
    const cell='offline-'+role+'-'+engine+'-'+width,staff=role!=='client';
    if(ONLY_CELLS.length&&!ONLY_CELLS.includes(cell))continue;
    await setAll(setup,role==='client'?'Client Approval':role==='smm'?'For SMM Approval':'Kasper Approval');
    const browser=await pw[engine].launch(),ctx=await context(browser,staff,width),p=await ctx.newPage();
    try {
      if(role==='reviewer')await reviewerReady(p);
      else{await p.goto(staff?LIVE+'/#calendar/sidneylaruel':input.link,{waitUntil:'domcontentloaded',timeout:25000});await ready(p,staff);}
      await check(cell,'interrupted save with draft and message inspection',()=>offlineNote(p,ctx,RUN + ' '+cell+' retention',staff));
    }finally{await ctx.setOffline(false).catch(()=>{});await browser.close();}
  }
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
async function reviewerReady(p, navigate=true) {
  if(navigate) {
    if(new URL(p.url()).hash==='#kasper') await p.reload({waitUntil:'domcontentloaded',timeout:25000});
    else await p.goto(LIVE+'/#kasper',{waitUntil:'domcontentloaded',timeout:25000});
  }
  await p.locator('[data-kasper-tab="review"]').click({timeout:20000});
  await p.waitForSelector('#svReviewStage #stepper',{timeout:25000});
  const chip=stage(p).locator('.chipp[data-id="'+input.id+'"]');
  if(await chip.count()) await chip.click();
  await p.waitForFunction(()=>document.querySelector('#svReviewStage')?.shadowRoot?.querySelector('#side')?.textContent.includes('Checkpoint'),null,{timeout:15000});
}
async function confirmIfAsked(p) {
  if(await p.locator('#confirmOverlay.active').isVisible()) await p.locator('#confirmYes').click();
}
async function extraClientPass(setup) {
  for(const engine of ['chromium','firefox','webkit']) for(const width of [1440,390]) {
    const cell='followup-'+engine+'-'+width;
    await setAll(setup,'Client Approval');
    const browser=await pw[engine].launch(),cc=await context(browser,false,width),p=await cc.newPage(),sc=await context(browser,true,width),staff=await sc.newPage();
    try {
      await p.goto(input.link,{waitUntil:'domcontentloaded',timeout:25000});await ready(p,false);
      await check(cell,'client caption draft reload',async()=>{
        const before=row().caption;await stage(p).locator('[data-step="caption"]').click();await stage(p).locator('#editBtn').click();await stage(p).locator('#capTa').fill(RUN + ' '+cell+' unsent caption');
        await p.reload({waitUntil:'domcontentloaded',timeout:25000});await ready(p,false);
        assert.equal(row().caption,before,'typing and reload must not save a caption');
        assert.equal(await stage(p).locator('#capTa').count(),1,'unsent caption editor must reopen');
        assert.equal(await stage(p).locator('#capTa').inputValue(),RUN + ' '+cell+' unsent caption');await stage(p).locator('#capCancel').click();
      });
      await check(cell,'client delete with real hover',async()=>{await note(p,'video',RUN + ' '+cell+' delete',false);await removeNote(p,RUN + ' '+cell+' delete',false);});
      await p.goto(input.link,{waitUntil:'domcontentloaded',timeout:25000});await ready(p,false);
      await check(cell,'client Finish',async()=>{
        for(const part of ['video','graphic','caption']){await stage(p).locator('[data-step="'+part+'"]').click();await stage(p).locator('[data-ok="'+part+'"]').click();await poll(r=>r[part+'_status']==='Approved');}
        await stage(p).locator('#finishBtn').click();assert(['video','graphic','caption'].every(k=>row()[k+'_status']==='Approved'));
      });
      await setAll(setup,'For SMM Approval');await staff.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(staff,true);
      await check(cell,'staff caption note after visible part selection',()=>note(staff,'caption',RUN + ' '+cell+' staff caption',true));
      await check(cell,'staff slow note after visible part selection',()=>slowNote(staff,'video',RUN + ' '+cell+' staff slow',true));
      await check(cell,'staff delete with real hover',async()=>{await note(staff,'video',RUN + ' '+cell+' staff delete',true);await removeNote(staff,RUN + ' '+cell+' staff delete',true);});
      await staff.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(staff,true);
      await check(cell,'staff video approval with offered resolution chooser',async()=>{await stage(staff).locator('[data-ok="video"]').click();if(await staff.locator('#resolveDestOverlay.active').isVisible())await staff.locator('#resolveDestKasper').click();await confirmIfAsked(staff);await poll(r=>r.video_status==='Kasper Approval');});
    }finally{await browser.close();}
  }
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
      for(const part of ['video','caption'])await check(cell,part+' note',()=>note(p,part,RUN + ' '+cell+' '+part,true));
      await check(cell,'reload typing',async()=>{await stage(p).locator('#ta').fill(RUN + ' '+cell+' draft');await p.reload({waitUntil:'domcontentloaded',timeout:25000});await reviewerReady(p,false);assert.equal(await stage(p).locator('#ta').inputValue(),RUN + ' '+cell+' draft');await stage(p).locator('#ta').fill('');});
      await check(cell,'slow save',()=>slowNote(p,'video',RUN + ' '+cell+' slow',true));
      await check(cell,'offline save and return',()=>offlineNote(p,ctx,RUN + ' '+cell+' offline',true));
      await check(cell,'two tabs',async()=>{const peer=await ctx.newPage();try{await reviewerReady(peer);await Promise.all([note(p,'video',RUN + ' '+cell+' tab A',true),note(peer,'video',RUN + ' '+cell+' tab B',true)]);}finally{await peer.close();}});
      await check(cell,'change video',async()=>{await stage(p).locator('[data-step="video"]').click();await stage(p).locator('[data-chg="video"]').click();await stage(p).locator('#ta').fill(RUN + ' '+cell+' change');await stage(p).locator('#sendBtn').click();await confirmIfAsked(p);await poll(r=>r.video_status==='Tweaks Needed'&&notes(r,'video').some(n=>n.body===RUN + ' '+cell+' change'));});
      for(const part of ['graphic','caption'])await check(cell,'approve '+part,async()=>{await stage(p).locator('[data-step="'+part+'"]').click();await stage(p).locator('[data-ok="'+part+'"]').click();await confirmIfAsked(p);await poll(r=>r[part+'_status']==='Client Approval');});
      await check(cell,'finish after changes',async()=>{await stage(p).locator('#finishBtn').click();await poll(r=>!!r.kasper_finished_at);});
      await setAll(setup,'Kasper Approval');
      await check(cell,'approve video',async()=>{await reviewerReady(p);await stage(p).locator('[data-ok="video"]').click();await confirmIfAsked(p);await poll(r=>r.video_status==='Client Approval');});
      report(cell,'browser exceptions',errors.length===0,{errors});
    }finally{await ctx.setOffline(false).catch(()=>{});await browser.close();}
  }
}
async function staffDiagnostics(setup) {
  for(const engine of ['chromium','firefox','webkit']) for(const width of [1440,390]) {
    const cell='staff-check-'+engine+'-'+width;
    await setAll(setup,'For SMM Approval');
    const browser=await pw[engine].launch(),ctx=await context(browser,true,width),p=await ctx.newPage();
    try {
      await p.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(p,true);
      await check(cell,'fresh staff note delete',async()=>{
        const text=RUN+' '+cell+' delete';await note(p,'video',text,true);
        await removeNote(p,text,true);
      });
      await setAll(setup,'Kasper Approval');await reviewerReady(p);
      await check(cell,'fresh reviewer caption approval',async()=>{
        await stage(p).locator('[data-step="caption"]').click();
        await stage(p).locator('[data-step="caption"][aria-current="step"]').waitFor();
        await stage(p).locator('[data-ok="caption"]').click();await confirmIfAsked(p);
        await poll(r=>r.caption_status==='Client Approval');
      });
      await setAll(setup,'Kasper Approval');await reviewerReady(p);
      await check(cell,'reviewer graphic then caption approval',async()=>{
        for(const part of ['graphic','caption']) {
          await stage(p).locator('[data-step="'+part+'"]').click();
          await stage(p).locator('[data-step="'+part+'"][aria-current="step"]').waitFor();
          await stage(p).locator('[data-ok="'+part+'"]').click();await confirmIfAsked(p);
          await poll(r=>r[part+'_status']==='Client Approval');
        }
      });
    }finally{await browser.close();}
  }
}
async function smmFinishPass(setup) {
  for(const engine of ['chromium','firefox','webkit'])for(const width of [1440,390]) {
    const cell='smm-finish-'+engine+'-'+width;await setAll(setup,'For SMM Approval');
    const browser=await pw[engine].launch(),ctx=await context(browser,true,width),p=await ctx.newPage();
    try {
      await p.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(p,true);
      await check(cell,'approve all parts and Finish',async()=>{
        for(const part of ['caption','video','graphic']) {
          await stage(p).locator('[data-step="'+part+'"]').click();await stage(p).locator('[data-step="'+part+'"][aria-current="step"]').waitFor();
          await stage(p).locator('[data-ok="'+part+'"]').click();
          if(await p.locator('#resolveDestOverlay.active').isVisible())await p.locator('#resolveDestKasper').click();
          await confirmIfAsked(p);await poll(r=>r[part+'_status']==='Kasper Approval');
        }
        await stage(p).locator('#finishBtn').click();
        await stage(p).locator('#rsToast.on').waitFor();
        const after=row();assert(['video','graphic','caption'].every(k=>after[k+'_status']==='Kasper Approval'));
      });
    }finally{await browser.close();}
  }
}
(async () => {
  // Keep one staff browser solely for app-owned setup/cleanup. Every journey
  // uses the named engine and its own fresh staff/client contexts.
  const setupBrowser = await pw.chromium.launch();
  const setupCtx = await context(setupBrowser,true,1440), setup = await setupCtx.newPage();
  try {
    if(!FOLLOWUP) for (const engine of ['chromium','firefox','webkit']) for (const width of [1440,390]) {
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
        for (const part of ['video','caption']) await check(cell,'client '+part+' note',()=>note(client,part,RUN + ' '+cell+' client '+part,false));
        await check(cell,'client caption edit',async()=>{await stage(client).locator('[data-step="caption"]').click();await stage(client).locator('#editBtn').click();await stage(client).locator('#capTa').fill(RUN + ' '+cell+' caption');await stage(client).locator('#capSave').click();await poll(r=>r.caption===RUN + ' '+cell+' caption');});
        await check(cell,'client reload typing',async()=>{await stage(client).locator('#ta').fill(RUN + ' '+cell+' reload draft');await client.reload({waitUntil:'domcontentloaded',timeout:25000});await ready(client,false);assert.equal(await stage(client).locator('#ta').inputValue(),RUN + ' '+cell+' reload draft');await stage(client).locator('#ta').fill('');});
        await check(cell,'client slow save',()=>slowNote(client,'video',RUN + ' '+cell+' slow',false));
        await check(cell,'client offline save and return',()=>offlineNote(client,cc,RUN + ' '+cell+' offline',false));
        await check(cell,'client two tabs',async()=>{
          const peer=await cc.newPage();try{await peer.goto(input.link,{waitUntil:'domcontentloaded',timeout:25000});await ready(peer,false);await Promise.all([note(client,'video',RUN + ' '+cell+' tab A',false),note(peer,'video',RUN + ' '+cell+' tab B',false)]);}finally{await peer.close();}
        });
        await check(cell,'client change request',async()=>{await stage(client).locator('[data-step="video"]').click();await stage(client).locator('[data-chg="video"]').click();await stage(client).locator('#ta').fill(RUN + ' '+cell+' change');await stage(client).locator('#sendBtn').click();await poll(r=>r.video_status==='Tweaks Needed'&&notes(r,'video').some(n=>n.body===RUN + ' '+cell+' change'));});
        for(const part of ['graphic','caption']) await check(cell,'client approve '+part,async()=>{await stage(client).locator('[data-step="'+part+'"]').click();await stage(client).locator('[data-ok="'+part+'"]').click();await poll(r=>r[part+'_status']==='Approved');});
        await shot(client,cell+'-client');
        await check(cell,'client delete own note',()=>removeNote(client,RUN + ' '+cell+' client video',false));
        await setAll(setup,'Client Approval');
        await check(cell,'client approve video',async()=>{await client.goto(input.link,{waitUntil:'domcontentloaded',timeout:25000});await ready(client,false);await stage(client).locator('[data-ok="video"]').click();await poll(r=>r.video_status==='Approved');});
        await setAll(setup,'For SMM Approval');
        await check(cell,'staff open',async()=>{await staff.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(staff,true);});
        await check(cell,'staff video note',()=>note(staff,'video',RUN + ' '+cell+' staff video',true));
        await check(cell,'staff caption note',()=>note(staff,'caption',RUN + ' '+cell+' staff caption',true));
        await check(cell,'staff play',async()=>{await stage(staff).locator('[data-step="video"]').click();await stage(staff).locator('.fv-play').click();await staff.waitForFunction(()=>{const v=document.querySelector('#svReviewStage')?.shadowRoot?.querySelector('video');return v&&!v.paused&&v.currentTime>0.1;},null,{timeout:10000});});
        await check(cell,'staff reload typing',async()=>{await stage(staff).locator('#ta').fill(RUN + ' '+cell+' staff reload draft');await staff.reload({waitUntil:'domcontentloaded',timeout:25000});await ready(staff,true);assert.equal(await stage(staff).locator('#ta').inputValue(),RUN + ' '+cell+' staff reload draft');await stage(staff).locator('#ta').fill('');});
        await check(cell,'staff caption edit',async()=>{await stage(staff).locator('[data-step="caption"]').click();await stage(staff).locator('#editBtn').click();await stage(staff).locator('#capTa').fill(RUN + ' '+cell+' staff caption edit');await stage(staff).locator('#capSave').click();await poll(r=>r.caption===RUN + ' '+cell+' staff caption edit');});
        await check(cell,'staff slow save',()=>slowNote(staff,'video',RUN + ' '+cell+' staff slow',true));
        await check(cell,'staff offline save and return',()=>offlineNote(staff,sc,RUN + ' '+cell+' staff offline',true));
        await check(cell,'staff two tabs',async()=>{const peer=await sc.newPage();try{await peer.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(peer,true);await Promise.all([note(staff,'video',RUN + ' '+cell+' staff tab A',true),note(peer,'video',RUN + ' '+cell+' staff tab B',true)]);}finally{await peer.close();}});
        await check(cell,'staff change request',async()=>{await stage(staff).locator('[data-step="video"]').click();await stage(staff).locator('[data-chg="video"]').click();await stage(staff).locator('#ta').fill(RUN + ' '+cell+' staff change');await stage(staff).locator('#sendBtn').click();await poll(r=>r.video_status==='Tweaks Needed'&&notes(r,'video').some(n=>n.body===RUN + ' '+cell+' staff change'));});
        for(const part of ['graphic','caption']) await check(cell,'staff approve '+part,async()=>{await stage(staff).locator('[data-step="'+part+'"]').click();await stage(staff).locator('[data-ok="'+part+'"]').click();await poll(r=>r[part+'_status']==='Kasper Approval');});
        await shot(staff,cell+'-staff');
        await check(cell,'staff delete own note',()=>removeNote(staff,RUN + ' '+cell+' staff video',true));
        await setAll(setup,'For SMM Approval');
        await check(cell,'staff approve video',async()=>{await staff.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});await ready(staff,true);await stage(staff).locator('[data-ok="video"]').click();await poll(r=>r.video_status==='Kasper Approval');});
        report(cell,'browser exceptions',errors.length===0,{count:errors.length});
      } finally { await cc.setOffline(false).catch(()=>{});await browser.close(); }
    }
    if(!FOLLOWUP||FOLLOWUP==='client') await extraClientPass(setup);
    if(!FOLLOWUP||FOLLOWUP==='reviewer') await reviewerPass(setup);
    if(!FOLLOWUP||FOLLOWUP==='offline') await offlinePass(setup);
    if(!FOLLOWUP||FOLLOWUP==='staff') await staffDiagnostics(setup);
    if(!FOLLOWUP||FOLLOWUP==='finish') await smmFinishPass(setup);
  } finally {
    try {
    await setup.goto(LIVE+'/#calendar/sidneylaruel',{waitUntil:'domcontentloaded',timeout:25000});
    await setup.locator('.cal-card[data-pid="'+input.id+'"] .cal-card-del').click();
    await setup.locator('#confirmYes').click();
    await poll(r=>r.status==='Archived',30000);
    const parkStarted=Date.now();while(!await parkedNativeItems()){assert(Date.now()-parkStarted<30000,'archive must park both linked native work items');await wait(250);}
    report('cleanup','disposable card archived through app',true,{nativeItemsParked:2});
    }finally{await setupBrowser.close();}
    if(results.some(result=>!result.ok&&result.cell!=='guard'))process.exitCode=1;
  }
})().catch(e=>{report('run','unhandled harness failure',false,{error:e.name,phase});process.exitCode=1;});
