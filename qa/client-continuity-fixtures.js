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
  let censusCalls=0,contexts=0;
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
    async createContext() {
      contexts++;
      const run=await H.openCase(browser,server,{network:scenario==='auth'?{verifierPlan:[{status:401}]}:{}});
      await run.page.close();
      await run.context.route(`**/rest/v1/${lane==='samples'?'sample_reviews':'calendar_posts'}?**`,route=>route.fulfill({
        status:(scenario==='failure'||(scenario==='transient'&&contexts===1))?500:200,contentType:'application/json',
        headers:{'access-control-allow-origin':'*','access-control-expose-headers':'content-range',
          'content-range':rows.length?`0-${rows.length-1}/${rows.length}`:'*/0'},body:JSON.stringify(scenario==='failure'?{}:rows)}));
      await run.context.route(`**/webhook/${lane==='samples'?'sample-review-get':'calendar-get'}?**`,route=>route.fulfill({status:500,body:'{}'}));
      return run.context;
    },
    async navigate(page,url) {
      await H.streamedNavigation(page,server,()=>page.goto(url,{waitUntil:'load',timeout:15000}),'static:client-verify');
      if(scenario==='stale_dom') {
        await page.locator('.kcard-title, .cal-fld-name').first().waitFor({state:'visible'});
        await page.locator('.kcard-title, .cal-fld-name').first().evaluate(el=>{if('value' in el)el.value='Synthetic stale title';else el.textContent='Synthetic stale title';});
      }
    },
  };
  return {config,deps,contextCount:()=>contexts};
}
module.exports={fixture,fixtureRow};
