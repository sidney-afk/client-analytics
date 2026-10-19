'use strict';
// Real browser storage and Web Locks, actual production helpers, fictional transport only.
// The gates fix the ordering: recovery completes while the original acknowledgement waits.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, webkit } = require('playwright');
const { extractFunction } = require('./helpers/extract-function');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils');
const fixture = require('./fixtures/review-stage-fixture');
require('../scripts/ensure-built').ensureBuilt();
const source = ['120-calendar-flags-write-repair.js.part','290-samples-writes-review.js.part'].map(n =>
  process.env.CHECKPOINT_SOURCE_REF
    ? require('node:child_process').execFileSync('git',['show',process.env.CHECKPOINT_SOURCE_REF+':src/index/'+n],{encoding:'utf8'})
    : fs.readFileSync(path.join(__dirname,'../src/index',n),'utf8')).join('\n');
const names = ['_writeUiRepairJournalRead', '_writeUiRepairEvictDisplayCaches', '_writeUiRepairJournalWrite',
  '_writeUiRequireRepairStorage', '_writeUiRepairWithLock', '_writeUiReserveSourceRepair', '_writeUiPrepareRepairAttempt',
  '_writeUiMarkRepairCommitted', '_writeUiRepairCompanions', '_writeUiDiscardSourceRepairUnlocked',
  '_writeUiDiscardSourceRepair', '_writeUiCompleteSourceRepairRefsUnlocked', '_writeUiCompleteSourceRepairRefs',
  '_writeUiGatewayWithRepair', '_writeUiRepairRecordForIntent', '_writeUiRepairGroups'];
for (const name of ['_writeUiWithRepairFlight', '_writeUiGatewayWithRepairOwned']) {
  if (source.includes('function ' + name + '(')) names.push(name);
}
const helpers = names.map(n => (source.includes('async function ' + n + '(') ? 'async ' : '') + extractFunction(source, n)).join('\n');
const setup = `
const WRITE_UI_SOURCE_REPAIR_KEY = 'syncview_write_ui_source_repairs_v1';
const _writeUiRepairReplayOwners = new WeakSet();
function _writeUiGatewayError(status, code) { return Object.assign(new Error(code), {status, code}); }
window.hits=0;
window.record=()=>({version:1,key:'calendar|card|fixture|card-1|comment',surface:'calendar',lane:'card',client_slug:'fixture',
post_id:'card-1',source_at:'2026-10-18T19:31:00.000Z',principal:'staff:fixture:admin',edits:{video_tweaks:'[{"id":"note-1","body":"Keep every word"}]'},
primary_intent_key:'comment:video:note-1',token:'fixture-token',intents:[{key:'comment:video:note-1',operation:'comment',component:'video',attempted:false,native_committed:false},
{key:'status:video:change',operation:'status',component:'video',status:'Tweaks Needed',attempted:false,native_committed:false}]});
window.sent = new Promise(r=>window.onSent=r);
window.release = null;
window._writeUiGatewayPost=async(_intent,hooks)=>{
 await hooks.beforeAttempt('{"request_id":"fixture-request"}'); window.hits++; window.onSent();
 await new Promise(r=>window.release=r);
 const ack={ok:true,native_committed:true,row:{id:'fixture-deliverable'}};
 await hooks.afterCommit(ack); return ack;
};
${helpers}
`;
(async () => {
  const server = await serveStatic(path.join(__dirname, '..'));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let failures = 0;
  try {
    for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
      const browser = await type.launch({ headless: true });
      try {
        const ctx = await browser.newContext();
        const a = await ctx.newPage(), b = await ctx.newPage();
        for (const page of [a,b]) { await page.route('**/checkpoint-test', r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Checkpoint fixture</title>'})); await page.goto(origin + '/checkpoint-test'); await page.evaluate(setup); }
        for (const mode of ['background', 'cleared', 'companion', 'cleanup-during-flight', 'overlap', 'quota', 'read-blocked', 'reload', 'postcommit-quota', 'missing-unproven', 'recovery-storage-clear']) {
          try {
            await a.evaluate(() => { localStorage.clear(); window.hits=0; window.sent=new Promise(r=>window.onSent=r); });
            if(mode==='recovery-storage-clear') {
              const restored=await a.evaluate(async()=>{
                const r=record();await _writeUiPrepareRepairAttempt(r,'{"request_id":"fixture-request"}');
                const group=_writeUiRepairGroups(r.principal).groups[0];
                const recover=async owner=>{
                  Object.defineProperty(group,'_flightOwner',{value:owner||{}});
                  localStorage.clear();
                  const saved=_writeUiRepairRecordForIntent(group.intents[0],group);
                  await _writeUiMarkRepairCommitted(saved,{native_committed:true});
                  return _writeUiRepairJournalRead().rows[0].edits.video_tweaks;
                };
                return typeof _writeUiWithRepairFlight==='function'?_writeUiWithRepairFlight(group,recover,true):recover();
              });
              assert.equal(JSON.parse(restored)[0].body,'Keep every word');
              assert.equal(await a.evaluate(()=>hits),0,'restoring an authenticated checkpoint sends no mutation');
            } else if(mode==='missing-unproven') {
              const code=await a.evaluate(async()=>{try{await _writeUiMarkRepairCommitted({key:'missing',token:'missing',primary_intent_key:'missing'},{native_committed:true});}catch(e){return e.code;}});
              assert.equal(code,'repair_checkpoint_missing','a partial reference must never invent checkpoint data');
            } else if (mode === 'quota' || mode === 'read-blocked') {
              const result = await a.evaluate(async mode => {
                const method=mode==='quota'?'setItem':'getItem', old=Storage.prototype[method];
                Storage.prototype[method]=function(){throw new DOMException('Unavailable','QuotaExceededError');};
                try { await _writeUiGatewayWithRepair({},record()); return {code:'no refusal',hits}; }
                catch(e){return {code:e.code,hits};} finally {Storage.prototype[method]=old;}
              }, mode);
              assert.equal(result.hits,0); assert.equal(result.code,mode==='quota'?'repair_storage_unavailable':'repair_storage_unknown');
            } else {
              await a.evaluate(() => { window.r=record(); window.outcome=_writeUiGatewayWithRepair({},r).then(ack=>({ack}),e=>({error:e.code})); });
              await a.evaluate(() => sent);
              if(mode==='cleanup-during-flight') {
                const cleared=await b.evaluate(()=>_writeUiCompleteSourceRepairRefs([{key:record().key,token:record().token}]));
                assert.equal(cleared,false,'source cleanup must not delete a checkpoint under a foreground save');
              }
              if (mode === 'background' || mode === 'overlap') {
                const removed=await b.evaluate(async () => {
                  const recover=async()=>{await _writeUiCompleteSourceRepairRefs([{key:record().key,token:record().token}]);return true;};
                  return typeof _writeUiWithRepairFlight==='function' ? _writeUiWithRepairFlight(record(),recover,true) : recover();
                });
                assert.equal(removed,false,'recovery must defer while another tab owns the foreground save');
              }
              if(mode==='overlap') {
                await b.evaluate(()=>{window.hits=0;window.sent=new Promise(r=>window.onSent=r);window.outcome=_writeUiGatewayWithRepair({},record()).then(ack=>({ack}),e=>({error:e.code}));});
                assert.equal(await b.evaluate(()=>hits),0,'a second foreground write waits for this card');
              }
              if (mode==='cleared') await b.evaluate(()=>localStorage.clear());
              if (mode==='reload') {
                // Closing an owner releases its lock, while its exact pinned envelope survives.
                await a.reload(); await a.evaluate(setup);
                assert.equal(await b.evaluate(()=>_writeUiRepairJournalRead().rows[0].intents[0].gateway_payload),'{"request_id":"fixture-request"}');
                console.log('PASS '+engine+' '+mode);
                continue;
              }
              if(mode==='postcommit-quota') await a.evaluate(()=>{window.oldSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});
              await a.evaluate(()=>release());
              const result=await a.evaluate(()=>outcome);
              if(mode==='postcommit-quota') {
                await a.evaluate(()=>{Storage.prototype.setItem=oldSet;});
                assert.equal(result.error,'repair_storage_unavailable');
                assert.equal(await a.evaluate(()=>hits),1,'postcommit bookkeeping cannot retry transport');
                assert.equal(await a.evaluate(()=>_writeUiRepairJournalRead().rows[0].intents[0].gateway_payload),'{"request_id":"fixture-request"}');
                console.log('PASS '+engine+' '+mode);
                continue;
              }
              assert(!result.error,'acknowledged native save must not become '+result.error);
              if(mode==='overlap') {
                await b.evaluate(()=>sent);
                await b.evaluate(()=>release());
                assert(!(await b.evaluate(()=>outcome)).error,'the second same-card save keeps its checkpoint');
                assert.equal(await b.evaluate(()=>hits),1);
              }
              if(mode==='companion') {
                await b.evaluate(()=>_writeUiCompleteSourceRepairRefs([{key:record().key,token:record().token}]));
                const companions=await a.evaluate(async()=>_writeUiRepairCompanions((await outcome).ack.source_repair));
                assert.equal(companions.length,1,'the acknowledged companion survives journal cleanup');
                assert.equal(companions[0].operation,'status');
                const rebound=await a.evaluate(async()=>{
                  const c=_writeUiRepairCompanions((await outcome).ack.source_repair)[0];
                  const r=_writeUiRepairRecordForIntent(c.intent);
                  await _writeUiMarkRepairCommitted(r,{row:{id:'fixture-deliverable'}},{reconciled:true,reason:'matching_native_status'});
                  return _writeUiRepairJournalRead().rows[0].edits.video_tweaks;
                });
                assert.equal(JSON.parse(rebound)[0].body,'Keep every word','a companion reconciles after another tab consumes the journal');
              }
              assert.equal(await a.evaluate(()=>hits),1,'one foreground native transport');
              await a.evaluate(()=>_writeUiCompleteSourceRepairRefs([{key:r.key,token:r.token}]));
            }
            console.log('PASS '+engine+' '+mode);
          } catch(e) { failures++; console.error('FAIL '+engine+' '+mode+': '+e.message); await a.evaluate(()=>window.release&&release()).catch(()=>{}); }
        }
        await ctx.close();
        // The real page's controls and writers, including the three reported
        // action families. Remove storage after native delivery, before its ack.
        for(const width of [1440,390]) for(const role of ['client','smm']) for(const action of ['note','change','approve-graphic']) {
          let t;
          try {
            t=await fixture.open(browser,origin,{stage:role,staff:role==='smm'?fixture.STAFF:null,flags:'on',width,height:900});
            t.ctx.setDefaultTimeout(10000);
            t.state.cards[0].graphic_deliverable_id='del_graphic_fixture';
            let nativeWrites=0;
            const nativeRows=new Map(['del_rs1','del_graphic_fixture'].map(id=>[id,{id,status:role==='client'?'client_approval':'smm_approval',updated_at:'2026-10-10T12:00:00.000Z',status_at:'2026-10-10T12:00:00.000Z'}]));
            await t.page.route('**/rest/v1/deliverables?**',r=>{
              const id=new URL(r.request().url()).searchParams.get('id')?.replace(/^eq\./,'');
              return r.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(nativeRows.has(id)?[nativeRows.get(id)]:[])});
            });
            await t.page.route('**/functions/v1/production-write',async r=>{
              if(r.request().method()==='OPTIONS') return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'}});
              const b=JSON.parse(r.request().postData()||'{}'); nativeWrites++;
              if(b.operation==='status') nativeRows.set(b.id,{id:b.id,status:b.status,updated_at:new Date().toISOString(),status_at:new Date().toISOString()});
              await t.page.evaluate(()=>localStorage.removeItem('syncview_write_ui_source_repairs_v1'));
              return r.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({ok:true,native_committed:true,row:nativeRows.get(b.id)})});
            });
            await t.page.goto(role==='client'?origin+'/?'+new URLSearchParams({c:fixture.CLIENT,v:'calendar',t:fixture.TOKEN}):origin+'/index.html?v=calendar',{waitUntil:'domcontentloaded'});
            if(role==='smm') {
              await t.page.waitForFunction(()=>typeof _calSavePins==='function'&&typeof navTo==='function');
              await t.page.evaluate(name=>{_syncviewStaffIdentityVerified=true;_calSavePins([name]);calState.client=name;navTo('calendar');},fixture.CLIENT);
              await t.page.waitForFunction(()=>typeof calState==='object'&&!calState.loading&&calState.posts.length>0);
              await t.page.evaluate(()=>onCalViewChange('smmreview'));
            }
            await fixture.waitNew(t);
            const stage=s=>fixture.inS(t.page,s);
            if(action==='approve-graphic') {
              await stage('[data-step="graphic"]').click();
              await stage('[data-ok="graphic"]').click();
            } else {
              if(action==='change') await stage('[data-chg="video"]').click();
              await stage('textarea').fill('Keep every checkpoint word.');
              await stage(action==='note'&&role==='client'?'#cmtBtn':'#sendBtn').click();
            }
            await t.page.waitForFunction(()=>Object.keys(_calSaveInFlight).length===0&&Object.keys(_calReviewState.saving).every(k=>!_calReviewState.saving[k]),null,{timeout:15000});
            const limit=Date.now()+15000;
            while(Date.now()<limit) {
              const saved=t.state.cards.find(p=>p.id==='rs1');
              if(action==='approve-graphic'?saved.graphic_status===(role==='client'?'Approved':'Kasper Approval'):JSON.parse(saved.video_tweaks||'[]').some(n=>n.body==='Keep every checkpoint word.')) break;
              await fixture.sleep(50);
            }
            assert(action==='note'?t.state.upserts.length>0:nativeWrites>0,'the actual action writer was exercised');
            const row=t.state.cards.find(p=>p.id==='rs1');
            if(action==='approve-graphic') assert.equal(row.graphic_status,role==='client'?'Approved':'Kasper Approval');
            else { const notes=JSON.parse(row.video_tweaks||'[]').filter(n=>n.body==='Keep every checkpoint word.');assert.equal(notes.length,1,'the words land once');if(action==='change')assert.equal(row.video_status,'Tweaks Needed'); }
            assert.equal(t.errors.length,0,'no browser exception');
            console.log('PASS '+engine+' '+width+' '+role+' '+action);
          } catch(e){failures++;console.error('FAIL '+engine+' '+width+' '+role+' '+action+': '+e.message.split('\n')[0]);if(t){console.error('fixture alerts: '+await fixture.inS(t.page,'.err').allTextContents().then(a=>a.join('|')).catch(()=>''));console.error('fixture errors: '+t.errors.join('|'));}}
          finally{if(t)await t.ctx.close();}
        }
      } finally { await browser.close(); }
    }
  } finally { await server.close(); }
  assert.equal(failures,0,failures+' checkpoint cases failed');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
