'use strict';
// Real browser functions and controls; every HTTP request is intercepted.
// The fixture substitutes catalogs/transports, not intake business rules.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { extract, html, FUNCTIONS, RECOVERY_FUNCTIONS, gatewayOk } = require('../test/helpers/native-intake-world');
const root=path.resolve(__dirname,'..');
const functions=[...FUNCTIONS, ...RECOVERY_FUNCTIONS,
  '_submitLinearFormRoutedOnce','submitLinearForm','saveLinearForm','_linearDraftSnapshot','_linearStableJson','_linearStorageError','_linearCompareRemove','_linearIntakeItemsPerVideo',
  '_calSubmitNativePost','_calNativePostErrorText','_linearResolveClientRow',
  'renderLinearView','renderVideoCard','loadLinearForm'];
const script=functions.filter(n=>html.includes('function '+n+'(')).map(extract).join('\n');
const env=`
var NATIVE_INTAKE_PENDING_KEY='fixture-pending', LINEAR_FORM_KEY='fixture-form', LAST_LINK_KEY='fixture-link', LINEAR_RECEIPTS_KEY='fixture-receipts';
var WRITE_UI_QUEUE_DIAG_KEY='fixture-diagnostics', WRITE_UI_DIAG_IDS=[], WRITE_UI_DIAG_PAYLOAD_IDS=[], _writeUiQueueDiagnosticSink=null;
var PROD_WRITE_EF_URL='https://gateway.fixture.invalid/write', CAL_SUPABASE_ANON_KEY='fixture', LOG_SUBMISSION_WEBHOOK='https://log.fixture.invalid/request';
var PROD_CREATED_STATUS=${JSON.stringify(/const PROD_CREATED_STATUS = '([a-z_]+)';/.exec(html)[1])};
var _nativeIntakeResumePromise=null, linearSubmitInFlight=null, _isIntake=false, _linearResolvedPlanUrl='', linearJustCreated=false;
var LINEAR_DEFAULT_VIDEO_COUNT=1, linearVideoCount=1;
var linearClientRows=[{slug:'fixture-client',name:'Fixture Client',display_name:'Fixture Client'}], LINEAR_INTAKE_MAX_ITEMS=100;
var calState={client:'fixture-client',posts:[]}, notices=[], navigation=0;
var identity={role:'admin',member:{id:'actor-a',name:'Fixture Admin'}};
function _syncviewStaffIdentityForHeaders(){return identity;}
function _syncviewStaffRoleValue(i){return i && i.role || '';}
async function _syncviewRequireStaffIdentity(){return identity;}
function _syncviewEfHeaders(h){return h;}
function _writeUiRerouteUseGatewayWhenReady(){return Promise.resolve(true);}
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
    let mode='hold', release, gateway=[], cards=[], unexpected=[], flagMode='off', flagReads=0;
    let holdFlag=false, releaseFlag, holdCatalog=false, releaseCatalog, catalogFailure=false;
    const catalogReads=[];
    const catalog=[{slug:'fixture-client',display_name:'Fixture Client'}, {slug:'fixture-unrelated',display_name:'Fixture Unrelated'}];
    const legacyProjects=['Fixture Client','Fixture Unrelated'];
    await context.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url());
      if(url.hostname==='app.fixture.invalid') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
      if(url.hostname==='log.fixture.invalid') return route.fulfill({json:{ok:true}});
      if(url.hostname==='catalog.fixture.invalid') {
        catalogReads.push(url.pathname);
        assert.equal(url.pathname,'/projects');
        return route.fulfill({json:legacyProjects});
      }
      if(url.hostname==='flags.fixture.invalid' && url.pathname==='/rest/v1/syncview_runtime_flags') {
        flagReads++;
        if(holdFlag) await new Promise(resolve=>{releaseFlag=resolve;});
        return flagMode==='failed' ? route.fulfill({status:503,json:{error:'fixture unavailable'}})
          : route.fulfill({json:[]});
      }
      if(url.hostname==='flags.fixture.invalid' && url.pathname==='/rest/v1/clients') {
        catalogReads.push(url.pathname);
        if(holdCatalog) await new Promise(resolve=>{releaseCatalog=resolve;});
        return catalogFailure ? route.fulfill({status:503,json:{error:'fixture unavailable'}})
          : route.fulfill({json:[...catalog,{slug:'fixture-unenrolled',display_name:'Native Only Unenrolled'}]});
      }
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

    const originalA=await page.evaluate(()=>_linearIntakeRead().payload.request_id);
    await page.evaluate(()=>_linearIntakePurgeSensitiveState());
    await boot();
    async function scope(actor,slug){
      await page.evaluate(({actor,slug})=>{
        identity={role:'admin',member:{id:actor,name:'Fixture Staff'}};
        linearClientRows=[{slug,name:slug,display_name:slug}];
        const input=document.getElementById('linearClientSearch');input.value=slug;input.dataset.clientSlug=slug;
        _linearIntakeRefreshRecovery();
      },{actor,slug});
    }
    async function submit(){await page.getByRole('button',{name:'Create deliverables'}).click();await page.waitForFunction(()=>!linearSubmitInFlight);}
    await scope('actor-b','fixture-other');
    assert.equal(await page.locator('[data-native-intake-recovery]').innerText(),'');
    mode='success';const beforeB=gateway.length;await submit();
    assert.equal(gateway.length,beforeB+1);assert.equal(gateway.at(-1).client_slug,'fixture-other');
    assert.equal(await page.evaluate(()=>_linearIntakeUnresolvedRead()[0].payload.request_id),originalA);
    await scope('actor-a','fixture-client');
    assert.match(await page.locator('[data-native-intake-recovery]').innerText(),/Staff recovery is needed/);
    assert.equal(await page.getByRole('button',{name:'Retry saved request'}).count(),0);
    await page.evaluate(()=>{
      window.legacyRequests=0;
      _submitLinearFormLegacy=async()=>{window.legacyRequests++;};
      _writeUiRerouteUseGatewayWhenReady=()=>Promise.resolve(false);
    });
    const beforeDuplicate=gateway.length;await submit();await submit();assert.equal(gateway.length,beforeDuplicate);
    assert.equal(await page.evaluate(()=>window.legacyRequests),0,'same-scope marker cannot fall through to legacy submission');
    await page.evaluate(()=>{_writeUiRerouteUseGatewayWhenReady=()=>Promise.resolve(true);});
    assert.match(await page.locator('#linearStatus').innerText(),/See its recovery notice/);
    await scope('actor-a','fixture-second');mode='outage';await submit();
    await page.evaluate(()=>_linearIntakePurgeSensitiveState());await boot();
    assert.equal(await page.evaluate(()=>_linearIntakeUnresolvedRead().length),2);
    assert.equal((await page.locator('[data-native-intake-recovery]').innerText()).match(/Staff recovery is needed/g).length,2);
    await scope('actor-b','fixture-other');assert.equal(await page.locator('[data-native-intake-recovery]').innerText(),'');

    await scope('actor-c','fixture-third');mode='outage';await submit();
    await page.evaluate(()=>{
      window.archiveStorageSet=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='fixture-pending:unresolved')throw new Error('fixture archive quota');return window.archiveStorageSet.call(this,key,value);};
    });
    await page.evaluate(()=>_linearIntakePurgeSensitiveState());
    assert.equal(await page.evaluate(()=>_linearIntakeRead().requires_original_payload),true);
    assert.equal(await page.evaluate(()=>_linearIntakeUnresolvedRead().length),2);
    await scope('actor-b','fixture-other');const beforeBlocked=gateway.length;await submit();
    assert.equal(gateway.length,beforeBlocked);assert.match(await page.locator('#linearStatus').innerText(),/could not be saved safely/);
    await page.evaluate(()=>{Storage.prototype.setItem=window.archiveStorageSet;});
    mode='success';await submit();assert.equal(gateway.length,beforeBlocked+1);
    assert.equal(await page.evaluate(()=>_linearIntakeUnresolvedRead().length),3);
    assert.equal(await page.evaluate(()=>_linearIntakeRead()),null);
    await scope('actor-a','fixture-client');assert.match(await page.locator('[data-native-intake-recovery]').innerText(),/Staff recovery is needed/);
    await page.setViewportSize({width:360,height:850});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(output,'markers-360.png')});
    assert.deepEqual(unexpected,[]);
    console.log('ok visible scope isolation: A uncertainty/sign-out, B succeeds, A duplicate blocked, multiple markers survive reload');
    console.log('ok visible archive failure: safe pending feedback, no dispatch/lost marker, successful verified move after storage recovers');

    // Use the actual restored form, canonical resolver and flag-failure path.
    await page.addScriptTag({content:`
      var CAL_SUPABASE_URL='https://flags.fixture.invalid', WRITE_UI_REROUTE_FLAG_KEY='fixture-routing', CLIENT_COMMENT_GATEWAY_FLAG_KEY='fixture-comments';
      var WRITE_UI_REROUTE_FLAG_TIMEOUT_MS=2000, _writeUiRerouteFlagGeneration=0, _writeUiRerouteFlagPromise=null, _writeUiRerouteFlagFailed=false;
      var _writeUiRerouteClients=new Set(), _clientCommentGatewayEnabled=false;
      window.legacyRequests=0;
      function _submitLinearFormOnce(){window.legacyRequests++;return Promise.resolve();}
      function _calV2Log(){}
    `+['_calRuntimeFlagClients','_clientCommentGatewaySetFlagValue','_writeUiSetRerouteFlagValue',
      '_writeUiFetchRerouteFlagOnce','_writeUiPrimeRerouteFlag','_writeUiRerouteUseGateway','_writeUiRerouteUseGatewayWhenReady','wlNormalizeClient','_submitLinearFormLegacy'].map(extract).join('\n')});
    async function restoreForm(name,slug,rows=catalog) {
      await page.evaluate(({name,slug,rows})=>{
        identity={role:'admin',member:{id:'actor-a',name:'Fixture Staff'}};
        linearClientRows=rows;
        localStorage.setItem(LINEAR_FORM_KEY,JSON.stringify({client:name,...(slug===null?{}:{clientSlug:slug})}));
        const restored=document.createElement('div');restored.innerHTML=renderLinearView();
        document.getElementById('linearClientSearch').replaceWith(restored.querySelector('#linearClientSearch'));
        document.getElementById('linearStatus').textContent='';
        _linearIntakeRefreshRecovery();
      },{name,slug,rows});
    }
    for(const state of ['off','failed']) {
      flagMode=state;
      await page.evaluate(()=>{_writeUiRerouteFlagPromise=null;});
      const beforeFlags=flagReads;
      await page.evaluate(()=>_writeUiPrimeRerouteFlag());
      assert.equal(flagReads,beforeFlags+1);
      assert.equal(await page.evaluate(()=>_writeUiRerouteFlagFailed),state==='failed');
      assert.equal(await page.evaluate(()=>_writeUiRerouteUseGatewayWhenReady('fixture-client')),false);
      for(const slug of ['fixture-client',null]) {
        await restoreForm('Fixture Client',slug);
        assert.equal(await page.locator('#linearClientSearch').getAttribute('data-client-slug'),slug||'');
        assert.equal(await page.evaluate(()=>_linearResolveClientRow('Fixture Client','').slug),'fixture-client');
        const beforeLegacy=await page.evaluate(()=>window.legacyRequests), beforeNative=gateway.length;
        await submit();
        assert.equal(await page.evaluate(()=>window.legacyRequests),beforeLegacy,`${state}: restored ${slug?'slug':'name-only'} form cannot bypass the unresolved marker`);
        assert.equal(gateway.length,beforeNative);
        assert.match(await page.locator('#linearStatus').innerText(),/See its recovery notice/);
      }
    }
    for(const [name,rows] of [['Missing Fixture',catalog],['Duplicate Fixture',[
      {slug:'fixture-client',display_name:'Duplicate Fixture'},{slug:'fixture-unrelated',display_name:'Duplicate Fixture'}]]]) {
      await restoreForm(name,null,rows);
      const beforeLegacy=await page.evaluate(()=>window.legacyRequests), beforeNative=gateway.length;
      await submit();
      assert.equal(await page.evaluate(()=>window.legacyRequests),beforeLegacy);assert.equal(gateway.length,beforeNative);
      assert.match(await page.locator('#linearStatus').innerText(),/Select one client/);
    }
    await restoreForm('Fixture Unrelated',null);
    const beforeUnrelated=await page.evaluate(()=>window.legacyRequests);
    await submit();assert.equal(await page.evaluate(()=>window.legacyRequests),beforeUnrelated+1,'unrelated canonical client retains established failed-flag legacy routing');
    // Compose the actual loader, dropdown source, flag reader, resolver and
    // handler. Delay intercepted HTTP responses, never replace the loader.
    await page.addScriptTag({content:`
      var LINEAR_PROJECTS_WEBHOOK='https://catalog.fixture.invalid/projects';
      var linearProjectsLoadGeneration=0, linearProjectsLoading=false, linearProjectsLoaded=false;
      var linearLegacyProjects=[], linearProjects=[];
    `+['_linearPendingNativeClientSlug','_linearRebuildProjectSource','_linearRenderProjectSource',
      'renderLinearSearchResults','fetchLinearProjects'].map(extract).join('\n')});
    const composedFailures=[];
    async function checkCase(name,run) {
      try {await run();console.log('ok composed '+name);}
      catch(error) {composedFailures.push(name+': '+error.message);console.error('FAIL composed '+name+': '+error.message);}
    }
    async function prepare(actor,name,state,{cold=true,failedCatalog=false}={}) {
      holdFlag=false;releaseFlag=null;holdCatalog=false;releaseCatalog=null;catalogFailure=failedCatalog;flagMode=state;
      await restoreForm(name,null,cold?[]:catalog);
      await page.evaluate(actor=>{
        identity={role:'admin',member:{id:actor,name:'Fixture Staff'}};
        _writeUiRerouteFlagPromise=null;_writeUiRerouteFlagFailed=false;_writeUiRerouteClients=new Set();
        linearLegacyProjects=[];linearProjects=[];linearProjectsLoaded=false;linearProjectsLoading=false;
        _linearIntakeRefreshRecovery();
      },actor);
      assert.equal(await page.evaluate(()=>_linearIntakeRead()),null,'only archived markers, no active pending job');
      return {legacy:await page.evaluate(()=>window.legacyRequests),native:gateway.length,reads:catalogReads.length};
    }
    async function noDispatch(before,message) {
      assert.equal(await page.evaluate(()=>window.legacyRequests),before.legacy,'zero legacy dispatch');
      assert.equal(gateway.length,before.native,'zero native dispatch');
      assert.match(await page.locator('#linearStatus').innerText(),message);
    }
    async function releaseAfterChange(kind,{actor,selection=false}={}) {
      await page.getByRole('button',{name:'Create deliverables'}).click();
      // A baseline loader can skip /clients entirely. Await the real request or
      // completion so that a regression produces an assertion, not a hung test.
      const deadline=Date.now()+5000;
      while(!(kind==='catalog'?releaseCatalog:releaseFlag)) {
        if(!await page.evaluate(()=>!!linearSubmitInFlight) || Date.now()>deadline) break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      const releaseResponse=kind==='catalog'?releaseCatalog:releaseFlag;
      assert.equal(typeof releaseResponse,'function',kind+' HTTP response must be reached');
      await page.evaluate(({actor,selection})=>{
        if(actor) identity={role:'admin',member:{id:actor,name:'Fixture Staff'}};
        if(selection){const input=document.getElementById('linearClientSearch');input.value='Fixture Unrelated';input.dataset.clientSlug='fixture-unrelated';}
      },{actor,selection});
      releaseResponse();await page.waitForFunction(()=>!linearSubmitInFlight);
    }
    for(const state of ['off','failed']) {
      await checkCase('cold archive-only unrelated client / '+state,async()=>{
        const before=await prepare('actor-a','Fixture Unrelated',state);
        await submit();
        assert.equal(await page.evaluate(()=>window.legacyRequests),before.legacy+1,'unrelated cold client retains legacy fallback');
        assert.equal(gateway.length,before.native);
        assert.deepEqual(catalogReads.slice(before.reads),['/projects','/rest/v1/clients']);
        assert.deepEqual(await page.evaluate(()=>linearProjects),legacyProjects,'archive read cannot enroll dropdown names');
        assert.equal(await page.evaluate(()=>_writeUiRerouteClients.size),0);
        assert.equal(await page.evaluate(()=>_writeUiRerouteFlagFailed),state==='failed');
      });
      await checkCase('cold archive-only protected client / '+state,async()=>{
        const before=await prepare('actor-a','Fixture Client',state);
        await submit();await noDispatch(before,/See its recovery notice/);
      });
      await checkCase('real catalog failure / '+state,async()=>{
        const before=await prepare('actor-a','Fixture Client',state,{failedCatalog:true});
        await submit();await noDispatch(before,/Select one client/);
        assert.deepEqual(catalogReads.slice(before.reads),['/projects','/rest/v1/clients']);
        assert.deepEqual(await page.evaluate(()=>linearProjects),legacyProjects);
      });
      for(const selection of [false,true]) {
        await checkCase('actor C -> A during catalog / '+state+' / selection '+selection,async()=>{
          const before=await prepare('actor-c','Fixture Client',state);
          holdCatalog=true;
          await releaseAfterChange('catalog',{actor:'actor-a',selection});
          await noDispatch(before,/signed-in account changed/);
        });
        await checkCase('unmarked actor B -> A during flag / '+state+' / selection '+selection,async()=>{
          const before=await prepare('actor-b','Fixture Client',state);
          holdFlag=true;
          await releaseAfterChange('flag',{actor:'actor-a',selection});
          await noDispatch(before,/signed-in account changed/);
        });
      }
      await checkCase('unchanged unmarked actor / '+state,async()=>{
        const before=await prepare('actor-b','Fixture Unrelated',state);
        await submit();assert.equal(await page.evaluate(()=>window.legacyRequests),before.legacy+1);
        assert.equal(gateway.length,before.native);
      });
    }
    await checkCase('actor changes during failing catalog',async()=>{
      const before=await prepare('actor-c','Fixture Client','failed',{failedCatalog:true});
      holdCatalog=true;await releaseAfterChange('catalog',{actor:'actor-a'});
      await noDispatch(before,/signed-in account changed/);
    });
    await checkCase('unchanged actor, changed selection during real catalog',async()=>{
      const before=await prepare('actor-a','Fixture Client','off');
      holdCatalog=true;await releaseAfterChange('catalog',{selection:true});
      await noDispatch(before,/client selection changed/);
    });
    // Existing F44 receipts keep priority and their transport, even if catalog
    // resolution is unavailable. F44 semantics remain exercised by its suite.
    const beforeF44=await prepare('actor-a','Fixture Client','failed',{failedCatalog:true});
    await page.evaluate(()=>localStorage.setItem(LINEAR_RECEIPTS_KEY,'fixture-existing-receipt'));
    await submit();assert.equal(await page.evaluate(()=>window.legacyRequests),beforeF44.legacy+1);
    assert.equal(gateway.length,beforeF44.native);assert.equal(catalogReads.length,beforeF44.reads);
    await page.evaluate(()=>localStorage.removeItem(LINEAR_RECEIPTS_KEY));
    assert.deepEqual(unexpected,[]);
    console.log('ok canonical marker routing: actual restored name-only/slug forms, false/failed flags, ambiguous/unresolved names, unrelated client');
    console.log('ok existing F44 receipt recovery retains priority without catalog access');
    assert.deepEqual(composedFailures,[],'all actual loader/flag/actor composition cases must pass');
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
