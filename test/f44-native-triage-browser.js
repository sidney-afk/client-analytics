'use strict';
// Actual inbox functions and repository CSS in Chromium, modeled gateway only.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {extractFunction}=require('./helpers/extract-function');
let chromium;try{({chromium}=require(process.env.F44_BROWSER_MODULE||'playwright'));}catch(error){
  if(process.env.F44_BROWSER_REQUIRED==='1')throw error;
  console.log('SKIP F44 triage browser: explicit existing Playwright runtime required');process.exit(0);
}
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const funcs=['_legacyTriageCanRead','_legacyTriagePurge','_legacyTriageRequest','_legacyTriageLoad']
  .map(n=>(['_legacyTriageRequest','_legacyTriageLoad'].includes(n)?'async ':'')+extractFunction(html,n)).join('\n');
const css=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>']});let checks=0;
 try{const context=await browser.newContext();await context.route('**/*',r=>r.abort('blockedbyclient'));const page=await context.newPage();
  await page.setContent('<style>'+css+'</style><div class="linear-view"><details open class="linear-form" id="legacyTriagePanel"><summary>Submissions needing team confirmation</summary><div id="legacyTriageStatus" role="status"></div><div id="legacyTriageRows"></div></details></div>');
  await page.evaluate(`window.identity={member:{id:'fixture-admin'},role:'admin'};
    window._syncviewStaffIdentityForHeaders=()=>window.identity;
    window._syncviewStaffRoleValue=i=>i&&i.role;
    window._syncviewEfHeaders=h=>h;window.PROD_WRITE_EF_URL='https://fixture.invalid/functions/v1/production-write';window.CAL_SUPABASE_ANON_KEY='fixture';
    window.sent=[];window.fixture={payload_hash:'a'.repeat(64),revision:2,state:'triage',reason:'confirm_intended_teams',received:{video:{},graphics:{}},payload_json:JSON.stringify({clientName:'Fictional Client',title:'Submission fixture',notes:'<img src=x onerror=alert(1)> Original notes',filmingPlans:'',videos:[{number:1,main_cam:'Main',side_cam:'Side',audio:'Audio',dueDate:'2026-09-12'}]})};
    window.fetch=async(u,o)=>{const b=JSON.parse(o.body);window.sent.push(b);if(b.action==='legacy_intake_triage_complete')window.fixture={...window.fixture,state:'complete',reason:'native_completed'};return {ok:true,json:async()=>b.action==='legacy_intake_triage_list'?{ok:true,rows:[window.fixture],next_after:null}:{ok:true,state:'complete'}}};
    let _legacyTriageEpoch=0;${funcs}`);
  await page.evaluate(()=>_legacyTriageLoad());assert.equal(await page.locator('input:checked').count(),0);checks++;
  assert.equal(await page.locator('#legacyTriageRows img').count(),0);await page.getByText('Read the complete original submission').click();assert.match(await page.locator('pre').innerText(),/Main/);checks++;
  await page.getByRole('button',{name:'Confirm teams and complete'}).click();assert.equal(await page.evaluate(()=>sent.filter(b=>b.action==='legacy_intake_triage_complete').length),0);checks++;
  for(const theme of ['light','dark'])for(const width of [360,768,1280]){
    await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.ok((await page.locator('label').first().boundingBox()).height>=44);checks++;
  }
  await page.getByLabel('Video',{exact:true}).focus();await page.keyboard.press('Space');assert.equal(await page.getByLabel('Video',{exact:true}).isChecked(),true);checks++;
  await page.getByLabel('Graphics',{exact:true}).check();await page.getByRole('button',{name:'Confirm teams and complete'}).click();
  await page.waitForFunction(()=>document.getElementById('legacyTriageRows').textContent.includes('native_completed'));
  const request=await page.evaluate(()=>sent.find(b=>b.action==='legacy_intake_triage_complete'));assert.deepEqual(request.intended_teams,['video','graphics']);assert.equal(request.revision,2);assert.equal(request.confirm,'CONFIRM_ORIGINAL_SUBMISSION_TEAMS');checks++;
  await page.evaluate(()=>{window.fixture={...window.fixture,state:'held',reason:'late_team_conflict'};return _legacyTriageLoad();});
  assert.equal(await page.getByRole('button',{name:'Confirm teams and complete'}).count(),0);assert.match(await page.locator('#legacyTriageRows').innerText(),/late_team_conflict/);checks++;
  await page.evaluate(()=>{window.fetch=()=>new Promise(r=>window.release=r);window.pending=_legacyTriageLoad();});
  await page.evaluate(()=>{window.identity=null;_legacyTriagePurge();window.release({ok:true,json:async()=>({ok:true,rows:[window.fixture]})});return window.pending;});
  assert.equal(await page.locator('#legacyTriagePanel').count(),0);checks++;
  console.log('PASS F44 native triage browser: '+checks+' checks; actual inbox functions, modeled gateway, refusing proxy');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
