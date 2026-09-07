'use strict';
const H = require('./boot/client-entry-sequence');
const SCOPE='bootfixtureclient';
const ORIGIN='https://uzltbbrjidmjwwfakwve.supabase.co'; // public serving host, all requests intercepted
const FALLBACK='https://synchrosocial.app.n8n.cloud';
const fixtureRow=lane=>({id:`synthetic-${lane}-continuity`,client:SCOPE,name:'Synthetic continuity card',
  status:'Client Approval',video_status:'Client Approval',graphic_status:'In Progress',order_index:1,
  scheduled_date:new Date().toISOString().slice(0,10),updated_at:'2026-09-05T00:00:00.000Z',comments:[],graphic_comments:[]});
function fixture(browser,server,lane,scenario='healthy') {
  const rows=scenario==='empty'?[]:[fixtureRow(lane)];
  let censusCalls=0,contexts=0,networkHandler;
  const config={lane,fixture:true,enabled:true,activation:'OWNER_APPROVED_VIEW_CHECKS',scope:SCOPE,censusKey:'synthetic',
    expectedPageSha256:require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(require('node:path').join(__dirname,'../index.html'))).digest('hex'),
    backendOrigin:ORIGIN,fallbackOrigin:FALLBACK,
    shareLink:server.origin+'/index.html?'+new URLSearchParams({c:'Boot Fixture Client',v:lane==='samples'?'samples':'calendar',t:'synthetic-current-token'}),
    requiredVisibleIds:rows.map(r=>r.id),readOrigins:['https://fonts.googleapis.com','https://cdn.jsdelivr.net','https://docs.google.com']};
  const bodyResponse=rows=>({ok:true,headers:{get:()=>rows.length?`0-${rows.length-1}/${rows.length}`:'*/0'},json:async()=>rows});
  const deps={
    async fetchImpl(url,init) {
      if(init.method!=='GET'||new URL(url).searchParams.get('client')!==`eq.${SCOPE}`)throw new Error('fixture_scope');
      censusCalls++;
      return bodyResponse(scenario==='concurrent'&&censusCalls%2===0?rows.map(r=>({...r,name:'Synthetic concurrent change'})):rows);
    },
    async configureContext(context) {
      contexts++;
      await context.addInitScript(H.installBootObserver,{storage:{},historyState:null,forbiddenClients:[]});
      await H.installSyntheticNetwork({route:async(_,handler)=>{networkHandler=handler;}},server.origin,
        scenario==='auth'?{verifierPlan:[{status:401}]}:{});
    },
    async forward(route,directRead) {
      // Reuse the boot fixture's response generator, with no browser route
      // fallback. The production guard still validates every forwarded response.
      let result;
      const proxy={request:()=>route.request(),
        fulfill:async value=>{result={status:()=>value.status||200,headers:()=>({...value.headers,...(value.contentType?{'content-type':value.contentType}:{})}),body:async()=>Buffer.from(value.body||'')};},
        abort:async()=>{throw new Error('fixture_refused');},
        continue:async()=>{result=await directRead(route.request());}};
      const url=new URL(route.request().url());
      if(url.origin===ORIGIN && url.pathname===`/rest/v1/${lane==='samples'?'sample_reviews':'calendar_posts'}`)await proxy.fulfill({
        status:(scenario==='failure'||(scenario==='transient'&&contexts===1))?500:200,contentType:'application/json',
        headers:{'access-control-allow-origin':'*','access-control-expose-headers':'content-range',
          'content-range':rows.length?`0-${rows.length-1}/${rows.length}`:'*/0'},body:JSON.stringify(scenario==='failure'?{}:rows)});
      else if(url.origin===FALLBACK && url.pathname===`/webhook/${lane==='samples'?'sample-review-get':'calendar-get'}`)await proxy.fulfill({status:500,body:'{}'});
      else await networkHandler(proxy);
      return result;
    },
    async navigate(page,url) {
      // Forwarding buffers the document to reject redirects before the browser
      // receives it. Streamed first-paint assertions remain in the original boot
      // suite; release this fixture's response before awaiting navigation.
      const navigation=page.goto(url,{waitUntil:'load',timeout:15000});
      void navigation.catch(()=>{});
      const chunk=await server.nextChunk();chunk.release();await navigation;
      if(scenario==='stale_dom') {
        await page.locator('.kcard-title, .cal-fld-name').first().waitFor({state:'visible'});
        await page.locator('.kcard-title, .cal-fld-name').first().evaluate(el=>{if('value' in el)el.value='Synthetic stale title';else el.textContent='Synthetic stale title';});
      }
    },
  };
  return {config,deps,contextCount:()=>contexts};
}
module.exports={fixture,fixtureRow};
