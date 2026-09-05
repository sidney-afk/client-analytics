'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {chromium}=require('playwright');
const H=require('./boot/client-entry-sequence'),{fixture,fixtureRow}=require('./client-continuity-fixtures');
const {captureInitialRead}=require('../scripts/samples-initial-read');
const sdk=fs.readFileSync(path.join(__dirname,'../node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
const sdkHash=createHash('sha256').update(sdk).digest('hex');
function initialFixture(browser,server,scenario='healthy') {
  const f=fixture(browser,server,'samples',['empty','concurrent','stale_dom'].includes(scenario)?scenario:'healthy');
  f.config.initialRead=true;f.config.expectedSdkSha256=sdkHash;
  f.config.requiredVisibleTitles=Object.fromEntries(f.config.requiredVisibleIds.map(id=>[id,fixtureRow('samples').name]));
  if(scenario==='wrong_approved_title')f.config.requiredVisibleTitles[f.config.requiredVisibleIds[0]]='Synthetic obsolete approved title';
  if(scenario==='sdk_mismatch')f.config.expectedSdkSha256='0'.repeat(64);
  if(scenario==='document_mismatch')f.config.expectedPageSha256='0'.repeat(64);
  const observer=H.installBootObserver.toString(),marker='  const makeChannel = name => {';
  assert.ok(observer.includes(marker),'fixture must remove the actual no-network SDK stub');
  const bootWithoutSdk=observer.slice(0,observer.indexOf(marker))+'}';
  const configure=f.deps.configureContext,forward=f.deps.forward,navigate=f.deps.navigate,read=f.deps.fetchImpl;
  let page,censusCalls=0,restoreClose;
  f.deps.configureContext=async context=>{
    // Retain the boot observer/Chart fixture, but never install Fake Supabase.
    const add=context.addInitScript.bind(context);
    context.addInitScript=async(fn,arg)=>fn===H.installBootObserver?add({content:`(${bootWithoutSdk})(${JSON.stringify(arg)});`}):add(fn,arg);
    try{await configure(context);}finally{context.addInitScript=add;}
    if(scenario==='teardown') {restoreClose=context.close.bind(context);context.close=async()=>{throw Error('synthetic_cleanup_failure');};}
  };
  f.deps.forward=async(route,direct)=>{
    const url=new URL(route.request().url());
    if(url.href==='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')return {status:()=>200,headers:()=>({'content-type':'application/javascript'}),body:async()=>sdk};
    const response=(status,body,range)=>({status:()=>status,headers:()=>({'content-type':'application/json','access-control-allow-origin':'*','content-range':range||'0-0/1'}),body:async()=>Buffer.from(JSON.stringify(body))});
    if(url.pathname==='/rest/v1/late_auth')return response(401,{});
    if(url.pathname==='/rest/v1/sample_reviews') {
      if(scenario==='false_empty')return response(500,{});
      if(scenario==='wrong_scope')return response(200,[{...fixtureRow('samples'),client:'syntheticforeign'}]);
      if(scenario==='orphan_count')return response(200,[fixtureRow('samples')],'0-0/2');
    }
    return forward(route,direct);
  };
  f.deps.navigate=async(p,url)=>{
    page=p;await navigate(p,url);
    if(scenario==='false_empty') {
      await p.locator('#sxrBody .cal-error').waitFor({state:'visible'});
      await p.locator('#sxrBody').evaluate(el=>{el.innerHTML='<div class="cal-empty">Synthetic empty success</div>';});
    }
    if(scenario==='warning') {
      await p.locator('#sxrBody .kcard-title').first().waitFor({state:'visible'});
      await p.evaluate(()=>{const notice=document.getElementById('sxrStaleNotice');if(!notice)throw Error('fixture_missing_warning_hook');notice.hidden=false;notice.style.display='block';});
    }
  };
  f.deps.fetchImpl=async(...args)=>{
    censusCalls++;
    if(censusCalls===2) {
      assert.ok(await page.evaluate(()=>window.__continuityReadSubscriptionState.matched>0),'fault must follow actual SDK subscription block');
      if(scenario==='late_auth')await page.evaluate(origin=>fetch(origin+'/rest/v1/late_auth').catch(()=>{}),f.config.backendOrigin);
      if(scenario==='late_browser') {
        const error=page.waitForEvent('pageerror');await page.evaluate(()=>{setTimeout(()=>{throw Error('synthetic_late_error');},0);});await error;
      }
      if(scenario==='unknown_socket')await page.evaluate(()=>{try{new WebSocket('wss://fixture.invalid/unknown');}catch{}});
      if(scenario==='unknown_realm')await page.evaluate(()=>{const f=document.createElement('iframe');document.body.appendChild(f);try{new f.contentWindow.WebSocket('wss://fixture.invalid/unknown');}catch{}});
      if(scenario==='unknown_http'||scenario==='metadata')await page.evaluate(({origin,metadata})=>fetch(origin+(metadata?'/webhook/linear-issue-statuses':'/functions/v1/sample-review-upsert'),{method:'POST',body:'{}'}).catch(()=>{}),{origin:scenario==='metadata'?f.config.fallbackOrigin:f.config.backendOrigin,metadata:scenario==='metadata'});
      if(scenario==='unknown_channel')await page.evaluate(()=>{try{window.supabase.createClient(CAL_SUPABASE_URL,CAL_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{params:{eventsPerSecond:5}}}).channel('unknown').on('broadcast',{event:'*'},()=>{}).subscribe();}catch{}});
    }
    return read(...args);
  };
  f.cleanup=async()=>{if(restoreClose)await restoreClose();};
  return f;
}
async function run(){
  const browser=await chromium.launch({headless:true}),server=await H.startStreamServer();
  try {
    let passed=0;
    for(const [scenario,code] of Object.entries({healthy:'initial_read_verified',empty:'canary_required',late_auth:'auth_failed',late_browser:'browser_error',teardown:'safety_failed',unknown_socket:'safety_failed',unknown_realm:'safety_failed',unknown_http:'browser_error',metadata:'browser_error',unknown_channel:'safety_failed',false_empty:'false_empty',wrong_scope:'scope_mismatch',orphan_count:'browser_error',concurrent:'inconclusive',stale_dom:'render_failed',warning:'stale_content',wrong_approved_title:'inconclusive',sdk_mismatch:'integration_missing',document_mismatch:'inconclusive',fresh_recovery:'initial_read_verified'})) {
      const f=initialFixture(browser,server,scenario);
      try {
        const result=await captureInitialRead(browser,f.config,f.deps);
        assert.equal(result.code,code,scenario+': '+JSON.stringify(result));
        assert.equal(result.fullContinuity.code,'mutation_blocked',scenario);
        assert.equal(result.fullContinuity.ok,false,scenario);
        assert.ok(result.safety.subscriptions.matched>0,scenario);
        passed++;
      }finally{await f.cleanup();}
    }
    return {version:1,passed,live:false};
  }finally{await browser.close();await server.close();}
}
if(require.main===module)run().then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('samples_initial_read_fixture_failed');process.exitCode=1;});
module.exports={run,initialFixture,sdkHash};
