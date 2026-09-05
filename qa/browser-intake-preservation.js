'use strict';
// Real browser functions and controls; every HTTP request is intercepted.
// The fixture substitutes catalogs/transports, not intake business rules.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { extract, html, FUNCTIONS, gatewayOk } = require('../test/helpers/native-intake-world');
const root=path.resolve(__dirname,'..');
const functions=[...FUNCTIONS, '_linearIntakeRecoveryText','_linearIntakeRecoveryHtml','_linearIntakeRefreshRecovery','_linearIntakeRetrySaved',
  '_submitLinearFormRoutedOnce','submitLinearForm','saveLinearForm','_linearDraftSnapshot','_linearStableJson','_linearStorageError','_linearCompareRemove','_linearIntakeItemsPerVideo',
  '_calSubmitNativePost','_calNativePostErrorText'];
const script=functions.filter(n=>html.includes('function '+n+'(')).map(extract).join('\n');
const env=`
var NATIVE_INTAKE_PENDING_KEY='fixture-pending', LINEAR_FORM_KEY='fixture-form', LAST_LINK_KEY='fixture-link', LINEAR_RECEIPTS_KEY='fixture-receipts';
var WRITE_UI_QUEUE_DIAG_KEY='fixture-diagnostics', WRITE_UI_DIAG_IDS=[], WRITE_UI_DIAG_PAYLOAD_IDS=[], _writeUiQueueDiagnosticSink=null;
var PROD_WRITE_EF_URL='https://gateway.fixture.invalid/write', CAL_SUPABASE_ANON_KEY='fixture', LOG_SUBMISSION_WEBHOOK='https://log.fixture.invalid/request';
var PROD_CREATED_STATUS=${JSON.stringify(/const PROD_CREATED_STATUS = '([a-z_]+)';/.exec(html)[1])};
var _nativeIntakeResumePromise=null, linearSubmitInFlight=null, _isIntake=false, _linearResolvedPlanUrl='', linearJustCreated=false;
var linearClientRows=[{slug:'fixture-client',name:'Fixture Client'}], LINEAR_INTAKE_MAX_ITEMS=100;
var calState={client:'fixture-client',posts:[]}, notices=[], navigation=0;
var identity={role:'admin',member:{id:'actor-a',name:'Fixture Admin'}};
function _syncviewStaffIdentityForHeaders(){return identity;}
function _syncviewStaffRoleValue(i){return i && i.role || '';}
async function _syncviewRequireStaffIdentity(){return identity;}
function _syncviewEfHeaders(h){return h;}
function _writeUiRerouteUseGatewayWhenReady(){return Promise.resolve(true);}
function _linearResolveClientRow(){return linearClientRows[0];}
function buildLinearTitle(){return 'Fixture batch';}
function wlTodayISO(){return '2026-09-05';}
function wlAddWorkingDays(){return '2026-09-12';}
function calClientSlug(c){return c;}
function _calCacheRead(){return {posts:[]};}
function _calCacheWrite(){}
function _calRenderBody(){}
function _kasperCalCachePrune(){}
var _calNativePostState={surface:'calendar',clientSlug:'fixture-client',clientName:'Fixture Client',mode:'both'};
function _nativePostViewSlug(){return 'fixture-client';}
function _calNativePostCount(){return 1;}
function _calUpsertFetch(slug,payload){return fetch('https://cards.fixture.invalid/'+slug,{method:'POST',body:JSON.stringify(payload)});}
function showNotify(title,text){notices.push({title,text});}
function navTo(){navigation++;}
function _calEsc(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');}
`;
const controls=`<main style="max-width:600px;padding:16px">
<label>Client<input class="linear-input" id="linearClientSearch" value="Fixture Client" data-client-slug="fixture-client"></label>
<label>Notes<textarea class="linear-textarea" id="linearNotes" oninput="saveLinearForm()">Original notes</textarea></label>
<input id="linearGeneralDrive" value="" hidden>
<div id="videoCard_1"><input id="vid_main_1" value="https://assets.fixture.invalid/camera" hidden><input id="vid_notes_1" value="Fictional video" hidden></div>
<button class="linear-submit-btn" id="linearSubmitBtnBoth" onclick="submitLinearForm('both')">Create deliverables</button>
<div data-native-intake-recovery=""></div><div id="linearStatus" role="status"></div></main>`;
async function main(){
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext(); const page=await context.newPage();
    let mode='hold', release, gateway=[], cards=[], unexpected=[];
    await context.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url());
      if(url.hostname==='app.fixture.invalid') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
      if(url.hostname==='log.fixture.invalid') return route.fulfill({json:{ok:true}});
      if(url.hostname==='gateway.fixture.invalid'){
        const payload=req.postDataJSON(); gateway.push(payload);
        if(mode==='hold') await new Promise(resolve=>{release=resolve;});
        if(mode==='outage') return route.fulfill({status:503,json:{ok:false,error:'project_mapping_validation_unavailable'}});
        if(mode==='refusal') return route.fulfill({status:409,json:{ok:false,error:'write_conflict'}});
        const response=gatewayOk({payload}); return route.fulfill({status:response.status,json:response.body});
      }
      if(url.hostname==='cards.fixture.invalid') {cards.push(req.postDataJSON());return route.fulfill({json:{ok:true}});}
      unexpected.push(url.hostname);return route.abort();
    });
    async function boot(){
      await page.goto('https://app.fixture.invalid');
      await page.setContent(controls);
      await page.addStyleTag({content:[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')});
      await page.addScriptTag({content:env+'\n'+script});
      await page.evaluate(()=>{if(typeof _linearIntakeRefreshRecovery==='function') _linearIntakeRefreshRecovery();});
    }
    await boot();
    await page.getByRole('button',{name:'Create deliverables'}).click();
    await page.waitForFunction(()=>!!localStorage.getItem('fixture-pending'));
    while(!release) await new Promise(r=>setTimeout(r,10));
    await page.locator('#linearNotes').fill('Newer notes typed while the original request is in flight');
    const newDraft=await page.evaluate(()=>localStorage.getItem('fixture-form'));
    mode='success'; release();
    await page.waitForFunction(()=>!linearSubmitInFlight);
    assert.equal(await page.evaluate(()=>localStorage.getItem('fixture-form')),newDraft,'native success must preserve newer form edits');
    assert.equal(await page.evaluate(()=>navigation),0,'native success must not replace the edited form');
    assert.equal(gateway[0].batch.notes,'Original notes');
    assert.equal(cards.length,1);
    console.log('ok real Submit handler: changed edits survive completion; original payload only');

    mode='hold'; release=null;
    await page.getByRole('button',{name:'Create deliverables'}).click();
    while(!release) await new Promise(r=>setTimeout(r,10));
    await page.evaluate(()=>{
      window.restoreStorage=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='fixture-form')throw new Error('fixture quota');return window.restoreStorage.call(this,key,value);};
      document.getElementById('linearNotes').value='Unsaved new edits after quota failure';
      try{saveLinearForm();}catch(e){}
    });
    mode='success';release();await page.waitForFunction(()=>!linearSubmitInFlight);
    assert.equal(await page.locator('#linearNotes').inputValue(),'Unsaved new edits after quota failure');
    assert.equal(await page.evaluate(()=>navigation),0);
    await page.evaluate(()=>{Storage.prototype.setItem=window.restoreStorage;document.getElementById('linearNotes').value='Newer notes typed while the original request is in flight';saveLinearForm();});
    console.log('ok native completion preserves visible edits even when their storage write failed');

    const priorRequests=gateway.length;
    mode='outage';
    await page.getByRole('button',{name:'Create deliverables'}).click();
    await page.waitForFunction(()=>!linearSubmitInFlight);
    const original=JSON.stringify(gateway.at(-1));
    for(let i=0;i<7;i++) {await boot(); await page.evaluate(()=>_resumeNativeIntakeJob('startup').catch(()=>{}));}
    assert.equal(gateway.length,priorRequests+4,'failed live click + three automatic requests');
    assert.ok(gateway.slice(priorRequests).every(p=>JSON.stringify(p)===original));
    assert.match(await page.locator('[data-native-intake-recovery]').innerText(),/Acceptance is unconfirmed/);
    assert.match(await page.locator('[data-native-intake-recovery]').innerText(),/Automatic retries are paused/);
    const output=path.join(root,'.codex-tmp','intake-browser');fs.mkdirSync(output,{recursive:true});
    for(const width of [360,768,1280]) for(const dark of [false,true]) {
      await page.setViewportSize({width,height:850});
      await page.evaluate(d=>{document.documentElement.dataset.theme=d?'dark':'light';document.body.classList.toggle('dark',d);},dark);
      const retry=page.getByRole('button',{name:'Retry saved request'});await retry.focus();
      assert.equal(await retry.evaluate(el=>document.activeElement===el),true);
      const box=await retry.boundingBox();assert.ok(box.height>=44 && box.x>=0 && box.x+box.width<=width);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(output,`pending-${width}-${dark?'dark':'light'}.png`)});
    }
    await page.getByRole('button',{name:'Retry saved request'}).click();
    await page.waitForFunction(()=>!_nativeIntakeResumePromise);
    assert.equal(await page.getByRole('button',{name:'Retry saved request'}).evaluate(el=>el===document.activeElement),true,'failed retry restores keyboard focus');
    assert.equal(JSON.stringify(gateway.at(-1)),original);
    mode='success';
    await page.getByRole('button',{name:'Retry saved request'}).press('Enter');
    await page.waitForFunction(()=>!localStorage.getItem('fixture-pending'));
    assert.equal(JSON.stringify(gateway.at(-1)),original);
    assert.equal(await page.evaluate(()=>localStorage.getItem('fixture-form')),newDraft);
    assert.equal(await page.getByRole('button',{name:'Retry saved request'}).count(),0);
    mode='refusal';
    await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend', '<div id="calNativePostOverlay"><input type="radio" name="calNativeBatchChoice" value="new" checked><button id="calNativePostCreate" onclick="_calSubmitNativePost()">Create post</button><div id="calNativePostError"></div></div>'));
    await page.getByRole('button',{name:'Create post',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('calNativePostError').textContent.length>0);
    assert.ok(await page.evaluate(()=>localStorage.getItem('fixture-pending')),'Create Post 409 must retain the exact request');
    assert.match(await page.locator('#calNativePostError').innerText(),/Acceptance is unconfirmed/);
    assert.deepEqual(unexpected,[]);
    console.log('ok visible recovery: seven refreshes, three automatic attempts, keyboard recovery, immutable payload, newer draft retained');
    console.log('ok 360/768/1280 light/dark: keyboard focus, 44px target, contained controls; zero unhandled external requests');
    console.log('ok actual Create Post handler retains a 409 request and describes unknown acceptance');
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
