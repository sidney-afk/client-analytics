// Appended to the reviewed loader by editor-projection-lane.mjs. All identities
// and state below are invented; HTTP handler and RPCs execute real source.
const A='33333333-3333-4333-8333-333333333331';
const B='33333333-3333-4333-8333-333333333332';
const U='55555555-5555-4555-8555-555555555551';
const X='55555555-5555-4555-8555-555555555552';
const W='55555555-5555-4555-8555-555555555553';
const G='44444444-4444-4444-8444-444444444441';
await sql(`insert into public.team_members(id,name,role,team,linear_user_id,default_for_team,active) values
 ('${U}','Fixture A Unmapped','editor','video',null,false,true),
 ('${X}','Fixture Inactive','editor','video','lin_inactive',false,false),
 ('${W}','Fixture Wrong Role','smm','video',null,false,true);
 create table if not exists public.client_access(slug text,review_token text);
 insert into public.client_access(slug,review_token) values('fixture-client','synthetic-review-token');`);
function options(surface='calendar') {return {action:'intake_editor_options',surface,client_slug:'fixture-client'};}
function selected(id,surface='calendar') {
  const result=rootBody('video',requestId(surface),{surface});
  if(id) result.items.forEach(item=>{item.assignee_id=id;});
  return result;
}
const selectedAssignee=result=>(result.json.items||[]).find(item=>item.team==='video')?.assignee_id;
function nativePass(label,pass,evidence) {ok(label,pass&&noProvider(),evidence);}
let browserChecks=0;
try {
  reset(); await flags('native-editor-1','native-graphics-1'); net.linear='down';
  const before=await inventory();
  for(const surface of ['calendar','sxr']) {
    const r=await post(options(surface));
    nativePass(surface+'-native-unmapped-visible',r.status===200 && r.json.editors.some(e=>e.id===U),r);
    nativePass(surface+'-exact-role-team-active',r.json.editors.length===3 && !r.json.editors.some(e=>[X,W,G].includes(e.id)),r);
    nativePass(surface+'-minimal-projection',r.json.editors.every(e=>Object.keys(e).sort().join(',')==='id,name,openCount'),r);
    nativePass(surface+'-suggested-count-and-tie',r.json.editors[0].id===U && r.json.editors.every(e=>e.openCount===0),r);
  }
  ok('options-read-does-not-write',await unchanged(before));
  const smm=await post(options(),SMM); ok('existing-smm-role-may-read',smm.status===200,smm);
  for(const [label,headers,status] of [
    ['anonymous',{},401],['client',{'x-syncview-client-token':'synthetic-review-token'},403],
    ['creative',{'x-syncview-key':'fixture-creative-key','x-syncview-actor':'Fixture Editor One'},403]]) {
    const r=await post(options(),headers);ok(label+'-cannot-read-new-roster',r.status===status&&!r.json.editors,r);
  }
  for(const surface of ['submission','production']) {const r=await post(options(surface));ok(surface+'-unsupported-read',r.status===400,r);}
  const inactive=await post({...options(),client_slug:'fixture-inactive'});ok('inactive-client-refused',inactive.status===403,inactive);
  reset(); net.linear='down';
  const preview=await post(options());
  const automatic=await post(selected());
  nativePass('default-preview-matches-actual-native-assignment',automatic.status===201&&selectedAssignee(automatic)===preview.json.editors[0].id,automatic.status);
  const explicitPayload=selected(U,'sxr');
  const explicit=await post(explicitPayload);
  nativePass('explicit-unmapped-native-accepted',explicit.status===201&&selectedAssignee(explicit)===U,explicit.status);
  for(const id of [X,W,G]) {const saved=await inventory(),r=await post(selected(id));nativePass('ineligible-'+id.slice(-1)+'-refused',r.status===403&&await unchanged(saved),r);}
  const current=await post(options());
  nativePass('open-count-reflects-actual-owned-work',current.json.editors.find(e=>e.id===U).openCount===2,current.json.editors);
  // Same original accepted request reuses its epoch after admission is disabled.
  await flags('',''); reset();net.linear='down';
  const replay=await post(explicitPayload);
  nativePass('accepted-native-epoch-replay-after-disable',replay.status===201&&selectedAssignee(replay)===U,replay);
  const next=await post(selected(U));
  ok('new-submit-after-disable-uses-current-provider-contract',next.status===503&&net.requests.some(r=>/api.linear.app/.test(r.url)),next);
  reset(); await flags('native-editor-1','native-graphics-1'); net.linear='down';
  await post(options());await sql('update public.team_members set active=false where id='+q(U));
  const refused=await post(selected(U));nativePass('deactivated-after-open-refused-on-submit',refused.status===403,refused);
  const replayRefused=await post(explicitPayload);nativePass('deactivated-accepted-replay-keeps-existing-refusal',replayRefused.status===403,replayRefused);
  await sql('update public.team_members set active=true where id='+q(U));
  await sql('update public.deliverables set linear_issue_uuid=\'fixture-parent\' where id='+q(automatic.json.items[0].id));
  await sql("update public.deliverables set linear_raw=jsonb_set(coalesce(linear_raw,'{}'),'{issue}',"
    +j({parent:{id:'fixture-parent'}})+') where id='+q(explicit.json.items[0].id));
  const parentPreview=await post(options());
  nativePass('real-view-parent-excluded-from-count',parentPreview.json.editors.find(e=>e.id===U).openCount===1,parentPreview);
  await sql("update public.team_members set name='' where id="+q(B));
  const blankPreview=await post(options());const blankAssignment=await post(selected());
  nativePass('blank-display-name-keeps-server-tie-order',blankPreview.json.editors[0].id===B&&selectedAssignee(blankAssignment)===B,blankPreview);
  await sql("update public.team_members set name='Fixture Editor Two' where id="+q(B));
  for(const [label,mutate] of [
    ['null-body',r=>({...r,data:null})],['non-array',r=>({...r,data:{}})],
    ['missing-count',r=>({...r,count:null})],['truncated',r=>({...r,data:r.data.slice(0,-1)})],
    ['duplicate',r=>({...r,data:[r.data[0],r.data[0],...r.data.slice(2)]})],
    ['missing-id',r=>({...r,data:r.data.map((row,i)=>i?row:{...row,id:null})})]]) {
    reset();net.linear='down';faults.mutate=(table,r)=>table==='team_members'?mutate(r):r;
    const r=await post(options());nativePass('native-roster-'+label+'-refused',r.status===503&&!r.json.editors,r);
  }
  for(const table of ['deliverables','production_deliverables_browser_v1']) {
    reset();net.linear='down';faults.mutate=(name,r)=>name===table?({...r,count:r.count+1}):r;
    const r=await post(options());nativePass('incomplete-'+table+'-refused',r.status===503&&!r.json.editors,r);
  }
  reset();net.linear='down';
  await sql("update public.syncview_runtime_flags set value='{}' where key='native_intake_epochs'");
  const unknown=await post(options());nativePass('unreadable-epoch-does-not-fallback',unknown.status>=400&&!unknown.json.lane,unknown);
  await flags('native-editor-1','native-graphics-1');
  reset();faults.mutate=(table,r)=>table==='team_members'?{...r,data:[],count:0}:r;
  const empty=await post(options());ok('proven-empty-native-roster-is-explicit-refusal',empty.status===409&&!empty.json.editors,empty);
  reset();await flags('','');
  const provider=await post(options());
  ok('provider-projection-is-only-routing-no-roster',provider.status===200&&provider.json.lane==='provider'&&!provider.json.editors,provider);
  const providerUnmapped=await post(selected(U));ok('provider-unmapped-explicit-still-refused',providerUnmapped.status===409,providerUnmapped);
  // Exact original public head still lacks this read; no hand-made success is
  // accepted as the baseline negative control.
  const baseline=execFileSync('git',['show','69ae5d338486bd8084e6bbdbe65be1c44f63dbe1:supabase/functions/production-write/index.ts'],{cwd:ROOT,encoding:'utf8',maxBuffer:4*1024*1024});
  let baselineSource=rewriteOnce(baseline,'import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";',
    'import { createClient, SupabaseClient } from '+JSON.stringify(shimUrl)+';');
  for(const file of ['../_shared/staff-role-auth.ts','./policy.mjs','./selected-label-pages.mjs','../_shared/linear-create-id.mjs']) {
    baselineSource=rewriteOnce(baselineSource,'from "'+file+'";','from '+JSON.stringify(pathToFileURL(path.resolve(FN_DIR,file)).href)+';');
  }
  baselineSource=rewriteOnce(baselineSource,'Deno.serve(','globalThis.__nirServe(');
  const baselineFile=path.join(scratch,'baseline.ts'),candidateHandler=handler;
  try {
    fs.writeFileSync(baselineFile,baselineSource);await import(pathToFileURL(baselineFile).href);
    const rejected=await post(options());ok('actual-baseline-handler-refuses-new-projection',rejected.status===400&&rejected.json.error==='unsupported_action',rejected);
  } finally {handler=candidateHandler;fs.unlinkSync(baselineFile);}

  // Optional real Chromium exercises the actual browser picker against this
  // same HTTP handler/SQL store; all routes intercepted, no external transport.
  if(process.env.INTAKE_EDITOR_BROWSER==='1') {
    const {createRequire}=await import('node:module');
    const {chromium}=createRequire(path.join(ROOT,'package.json'))('playwright');
    const chromiumBrowser=await chromium.launch({headless:true});
    try {
      const page=await chromiumBrowser.newPage();let requests=[];const pageErrors=[];
      page.on('pageerror',error=>pageErrors.push(String(error)));
      await page.route('**/*',async route=>{
        const request=route.request(); requests.push(request.url());
        if(request.url().endsWith('/functions/v1/production-write')) {
          const r=await post(request.postDataJSON(),request.headers());
          return route.fulfill({status:r.status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(r.json)});
        }
        if(request.url().includes('/rest/v1/team_members?')) {
          const roster=await rows("select id,name from public.team_members where active=true and team='video' and role='editor' and linear_user_id is not null order by name");
          return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(roster)});
        }
        if(request.url().includes('/rest/v1/production_deliverables_browser_v1?')) {
          const query=request.url().includes('raw_issue_parent_id=not.is.null')
            ?"select raw_issue_parent_id from public.production_deliverables_browser_v1 where team='video' and raw_issue_parent_id is not null"
            :"select assignee_id,linear_issue_uuid from public.production_deliverables_browser_v1 where team='video' and status in ('todo','in_progress','tweak')";
          return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(await rows(query))});
        }
        throw Error('unexpected browser request');
      });
      await page.setContent('<!doctype html><body><input id="calNativeEditor"><div id="editorResult"></div></body>');
      const browserSource=['async '+extractFunction(html,'_calNativeVideoEditorPool'),'async '+extractFunction(html,'_calLegacyVideoEditorPool'),extractFunction(html,'_calSetNativePostEditor')].join('\n');
      await page.addScriptTag({content:`const CAL_SUPABASE_URL='http://browser.fixture.invalid',CAL_SUPABASE_ANON_KEY='synthetic',CAL_NATIVE_LIVE_VIDEO_STATUSES=['todo','in_progress','tweak'];
        let _calNativePostState={surface:'calendar',clientSlug:'fixture-client',videoEditors:[]};
        let actor={key:'fixture-admin-key',role:'admin',member:{id:'synthetic-admin',name:'Fixture Admin'}};
        function _syncviewStaffIdentityForHeaders(){return actor;}
        function _nativePostViewSlug(){return 'fixture-client';}
        function _syncviewEfHeaders(h){return {...h,'x-syncview-key':actor.key,'x-syncview-actor':actor.member.name};}
        function _calRenderNativePostChoice(){document.getElementById('editorResult').textContent=_calNativePostState.videoEditorId||'';}
        ${browserSource}`});
      if(pageErrors.length) throw Error('browser fixture parse failure: '+pageErrors.join(','));
      await flags('native-editor-1','native-graphics-1');reset();net.linear='down';requests=[];
      const actual=await page.evaluate(async()=>{const list=await _calNativeVideoEditorPool();_calNativePostState.videoEditors=list;return list;});
      nativePass('chromium-native-unmapped-visible-no-browser-roster-read',actual.some(e=>e.id===U)&&requests.length===1,requests);browserChecks++;
      await page.locator('#calNativeEditor').fill(U);await page.evaluate(()=>_calSetNativePostEditor());
      ok('chromium-actual-choice-handler-retains-unmapped-id',await page.locator('#editorResult').textContent()===U);browserChecks++;
      await flags('','');requests=[];
      const legacy=await page.evaluate(()=>_calNativeVideoEditorPool());
      ok('chromium-provider-loader-preserved',!legacy.some(e=>e.id===U)&&legacy.some(e=>e.id===A)&&requests.length===4,requests);browserChecks++;
      const oldHtml=execFileSync('git',['show','69ae5d338486bd8084e6bbdbe65be1c44f63dbe1:index.html'],{cwd:ROOT,encoding:'utf8',maxBuffer:8*1024*1024});
      await page.addScriptTag({content:'async '+extractFunction(oldHtml,'_calNativeVideoEditorPool').replace('function _calNativeVideoEditorPool(','function _baselineVideoEditorPool(')});
      await flags('native-editor-1','native-graphics-1');requests=[];
      const old=await page.evaluate(()=>_baselineVideoEditorPool());
      ok('chromium-exact-baseline-negative-hides-native-unmapped-editor',!old.some(e=>e.id===U),old.map(e=>e.id));browserChecks++;
      await sql("update public.syncview_runtime_flags set value='{}' where key='native_intake_epochs'");requests=[];
      const failed=await page.evaluate(async()=>{try{await _calNativeVideoEditorPool();return false;}catch{return true;}});
      ok('chromium-unreadable-policy-does-not-run-legacy-loader',failed&&requests.length===1,requests);browserChecks++;
      ok('chromium-no-page-errors',pageErrors.length===0,pageErrors);browserChecks++;
    } finally {await chromiumBrowser.close();}
  }
  const {createHash}=await import('node:crypto');
  const report={suite:'native-intake-editor-projection',checks:checks.length,failed:checks.filter(c=>!c.pass).map(c=>c.label),browser_checks:browserChecks,
    source_sha256:createHash('sha256').update(fs.readFileSync(INDEX_TS)).digest('hex'),proof:'actual HTTP handler + disposable PostgreSQL; optional intercepted Chromium picker; provider responses simulated; no serving proof'};
  if(process.env.INTAKE_EDITOR_REPORT) fs.writeFileSync(process.env.INTAKE_EDITOR_REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(report.failed.length) process.exitCode=1;
} finally {
  if(path.dirname(path.resolve(scratch))!==path.resolve(os.tmpdir())) throw Error('unsafe scratch directory');
  fs.unlinkSync(rewritten);fs.rmdirSync(scratch);
}
