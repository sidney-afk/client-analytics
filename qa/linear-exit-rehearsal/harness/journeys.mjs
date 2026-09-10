import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=process.env.PROOF_REPO_ROOT,out=process.env.PROOF_OUTPUT_ROOT;
const servingMode=process.env.PROOF_SERVING_MODE;
assert.ok(['repository-negative','captured-positive'].includes(servingMode),'explicit serving mode required');
let useCapturedCalendar=false;
const {loadCapturedCalendar,captureHashes}=await import(pathToFileURL(path.join(process.env.PROOF_HARNESS_ROOT,'load-captured-calendar.mjs')).href);
const require=createRequire(path.join(root,'package.json'));
const imp=rel=>import(pathToFileURL(path.join(root,rel)).href);
let gatewayLoader=fs.readFileSync(path.join(root,'scripts/native-intake-reconcile/load-gateway.mjs'),'utf8');
gatewayLoader=gatewayLoader.replace("const HERE = path.dirname(fileURLToPath(import.meta.url));",'const HERE = '+JSON.stringify(path.join(root,'scripts/native-intake-reconcile'))+';').replace("const SHIM = path.join(ROOT, 'scripts', 'native-intake-manifest', 'supabase-shim.mjs');",'const SHIM = '+JSON.stringify(path.join(process.env.PROOF_HARNESS_ROOT,'sdk.mjs'))+';');
const loaderFile=path.join(out,'load-gateway-generated.mjs');fs.writeFileSync(loaderFile,gatewayLoader);
const {loadGateway}=await import(pathToFileURL(loaderFile).href);
let writerLoader=fs.readFileSync(path.join(root,'scripts/native-intake-reconcile/load-writers.mjs'),'utf8').replace("const HERE = path.dirname(fileURLToPath(import.meta.url));",'const HERE = '+JSON.stringify(path.join(root,'scripts/native-intake-reconcile'))+';').replace("async function post(slug, body, source = 'submission-native')", "async function post(slug, body, source = 'submission-native', requestHeaders = null)").replace("'x-syncview-source': source,", "'x-syncview-source': source,").replace("headers: {\n        'content-type'", "headers: requestHeaders || {\n        'content-type'");
const writerLoaderFile=path.join(out,'load-writers-generated.mjs');fs.writeFileSync(writerLoaderFile,writerLoader);const {loadWriters}=await import(pathToFileURL(writerLoaderFile).href);
const {runSql}=await imp('scripts/native-intake-manifest/supabase-shim.mjs');
const gw=await loadGateway(),writers=await loadWriters(),capturedCalendar=await loadCapturedCalendar();
let commentSource=fs.readFileSync(path.join(root,'supabase/functions/production-comments/index.ts'),'utf8');
commentSource=commentSource.replace('"npm:@supabase/supabase-js@2.49.8"',JSON.stringify(pathToFileURL(path.join(process.env.PROOF_HARNESS_ROOT,'sdk.mjs')).href));
commentSource=commentSource.replace(/from "(\.\.?\/[^"\n]+)"/g,(_,rel)=>'from '+JSON.stringify(pathToFileURL(path.resolve(root,'supabase/functions/production-comments',rel)).href));
commentSource=commentSource.replace('Deno.serve(','globalThis.__commentServe(');
let commentsHandler;globalThis.__commentServe=h=>commentsHandler=h;const commentFile=path.join(out,'comments-generated.ts');fs.writeFileSync(commentFile,commentSource);await import(pathToFileURL(commentFile).href);assert.equal(typeof commentsHandler,'function');
let workloadSource=fs.readFileSync(path.join(root,'supabase/functions/workload-plan/index.ts'),'utf8').replace('"npm:@supabase/supabase-js@2.49.8"',JSON.stringify(pathToFileURL(path.join(process.env.PROOF_HARNESS_ROOT,'sdk.mjs')).href)).replace(/from "(\.\.?\/[^"\n]+)"/g,(_,rel)=>'from '+JSON.stringify(pathToFileURL(path.resolve(root,'supabase/functions/workload-plan',rel)).href)).replace('Deno.serve(','globalThis.__workloadServe(');
let workloadHandler;globalThis.__workloadServe=h=>workloadHandler=h;const workloadFile=path.join(out,'workload-generated.ts');fs.writeFileSync(workloadFile,workloadSource);await import(pathToFileURL(workloadFile).href);
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
async function sql(text){const r=await runSql(text);if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
async function rows(text){return JSON.parse(await sql(`select coalesce(json_agg(t),'[]'::json) from (${text}) t;`));}
const receipt={serving_mode:servingMode,capture_hashes:captureHashes,capture_classification:'NEW_LIVE_READ_SOURCE_CAPTURE',source_commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),started_at:new Date().toISOString(),classification:'ISOLATED_CHROMIUM_HTTP_HANDLER_SQL',groups:[],requests:[],limits:['Synthetic staff/client verification','SDK-to-SQL adapter, not PostgREST or Deno runtime','Synthetic data and local provider only','Captured Calendar v49 used only for public positive case; all other writers are repository sources; no hosted proof']};
const ident=s=>{if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))throw Error('identifier refused');return '"'+s+'"';};
function split(value){let depth=0,start=0,out=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&depth===0){out.push(value.slice(start,i));start=i+1;}}out.push(value.slice(start));return out;}
function predicate(key,value){if(key==='or'||key==='and'){assert.ok(value.startsWith('(')&&value.endsWith(')'));return '('+split(value.slice(1,-1)).map(v=>{const i=v.indexOf('.');return predicate(v.slice(0,i),v.slice(i+1));}).join(key==='or'?' or ':' and ')+')';}const col=ident(key);if(value.startsWith('not.'))return 'not ('+predicate(key,value.slice(4))+')';if(value.startsWith('eq.'))return col+'='+q(value.slice(3));if(value.startsWith('gte.'))return col+'>='+q(value.slice(4));if(value.startsWith('neq.'))return col+'<>'+q(value.slice(4));if(value.startsWith('gt.'))return col+'>'+q(value.slice(3));if(value.startsWith('is.')){const v=value.slice(3);assert.ok(['null','true','false'].includes(v));return col+' is '+v;}if(value.startsWith('in.(')&&value.endsWith(')'))return col+' in ('+split(value.slice(4,-1)).map(v=>q(v.replace(/^"|"$/g,''))).join(',')+')';throw Error('filter unsupported '+key+' '+value);}
async function rest(url){const table=url.pathname.split('/').at(-1);const allowed=['clients','team_members','batches','deliverables','production_deliverables_browser_v1','syncview_runtime_flags','calendar_posts','sample_reviews','production_comments','deliverable_events','production_labels','deliverable_labels','entity_crosswalk','workload_issues'];assert.ok(allowed.includes(table),'unsupported table '+table);
 const filters=[];for(const [k,v] of url.searchParams){if(['select','order','limit','offset'].includes(k))continue;filters.push(predicate(k,v));}
 const where=filters.length?' where '+filters.join(' and '):'';const selection=(url.searchParams.get('select')||'*').split(',').map(c=>c==='*'?'*':ident(c)).join(',');
 const order=(url.searchParams.get('order')||'').split(',').filter(Boolean).map(o=>{const [key,dir]=o.split('.');return ident(key)+(dir==='desc'?' desc':' asc');}).join(',');
 const limit=Number(url.searchParams.get('limit')||1000),offset=Number(url.searchParams.get('offset')||0);assert.ok(Number.isInteger(limit)&&limit<=10000&&Number.isInteger(offset)&&offset>=0);
 const count=Number(await sql('select count(*) from '+ident(table)+where));const data=await rows('select '+selection+' from '+ident(table)+where+(order?' order by '+order:'')+' limit '+limit+' offset '+offset);
 return {data,range:(data.length?offset+'-'+(offset+data.length-1):'*')+'/'+count};}
const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('access-control-allow-origin','*');res.setHeader('content-type','application/json');
 try{let result,status=200;if(url.pathname.startsWith('/rest/v1/')){assert.equal(req.method,'GET');const r=await rest(url);result=r.data;res.setHeader('content-range',r.range);}
 else if(url.pathname.endsWith('/production-comments')){const r=await commentsHandler(new Request('http://local.invalid/production-comments',{method:'POST',headers:req.headers,body}));status=r.status;result=await r.json();receipt.requests.push({operation:'comments_read',status,error:result.error});}
 else if(url.pathname.endsWith('/workload-plan')){const r=await workloadHandler(new Request('http://localhost/functions/v1/workload-plan',{method:req.method,headers:req.headers,body}));status=r.status;result=await r.json();receipt.requests.push({workload:JSON.parse(body).action,status,error:result.error});}
 else if(url.pathname.endsWith('/production-write')){const value=JSON.parse(body);const r=await gw.post(value,req.headers);status=r.status;result=r.json;receipt.requests.push({operation:value.operation||value.action,status,error:r.json.error});}
 else if(/\/(calendar-upsert|sample-review-upsert)$/.test(url.pathname)){const r=useCapturedCalendar&&url.pathname.endsWith('/calendar-upsert')?await capturedCalendar.post(JSON.parse(body),req.headers):await writers.post(url.pathname.split('/').at(-1),JSON.parse(body),req.headers['x-syncview-source']||'ui',req.headers);status=r.status;result=await r.json();receipt.requests.push({writer:url.pathname.split('/').at(-1),status});}
 else throw Error('local route refused');res.writeHead(status);res.end(JSON.stringify(result));}
 catch(error){receipt.requests.push({error:String(error.message),path:url.pathname});res.writeHead(500);res.end(JSON.stringify({error:String(error.message)}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=require('playwright');const {startStreamServer,openCase}=require(path.join(root,'qa/boot/client-entry-sequence.js'));
const ui=await startStreamServer();let browser,run,closing=false;
const proxyDenied=[],proxyForwarded=[];
const proxyAllowedOrigins=new Set([ui.origin,'http://127.0.0.1:'+server.address().port]);
for(const origin of proxyAllowedOrigins){const parsed=new URL(origin);assert.equal(parsed.protocol,'http:');assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));}
const refusalProxy=http.createServer((req,res)=>{
 let target;try{target=new URL(req.url);}catch{}
 if(!target||!proxyAllowedOrigins.has(target.origin)||target.username||target.password){proxyDenied.push(req.method+' '+req.url);res.writeHead(502);res.end('isolated refusal');return;}
 const headers={...req.headers,host:target.host};delete headers['proxy-connection'];delete headers['proxy-authorization'];
 // Forward only the two dynamically verified owned listeners; DNS is never used.
 proxyForwarded.push({origin:target.origin,hostname:'127.0.0.1',port:target.port});
 const upstream=http.request({hostname:'127.0.0.1',port:target.port,method:req.method,path:target.pathname+target.search,headers},answer=>{
  if(answer.statusCode>=300&&answer.statusCode<400&&answer.headers.location){proxyDenied.push('REDIRECT '+answer.headers.location);answer.resume();res.writeHead(502);res.end('redirect refused');return;}
  res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);
 });
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('owned listener unavailable');});
 req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
refusalProxy.on('connect',(req,socket)=>{proxyDenied.push('CONNECT '+req.url);socket.destroy();});
await new Promise(resolve=>refusalProxy.listen(0,'127.0.0.1',resolve));
try{
 browser=await chromium.launch({headless:true,proxy:{server:'http://127.0.0.1:'+refusalProxy.address().port,bypass:'127.0.0.1,localhost'},args:['--disable-quic','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
 const member={id:'11111111-1111-4111-8111-111111111111',name:'Fixture Admin',role:'admin',team:'video'};
 run=await openCase(browser,ui,{storage:{local:{syncview_auth_v1:'ok',syncview_nav:'production',syncview_staff_identity_v1:JSON.stringify({key:'fixture-admin-key',role:'admin',member})},session:{syncview_staff_identity_prompted_v1:'1'}}});
 run.page.on('dialog',dialog=>dialog.accept());
 await run.context.routeWebSocket('**/*',s=>s.close());
 await run.context.route('**/functions/v1/key-verify',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,role:'admin',member})}));
 for(const pattern of ['**/rest/v1/**','**/functions/v1/production-write','**/functions/v1/workload-plan','**/functions/v1/production-comments','**/functions/v1/calendar-upsert','**/functions/v1/sample-review-upsert'])await run.context.route(pattern,async route=>{try{const u=new URL(route.request().url());const r=await route.fetch({url:'http://127.0.0.1:'+server.address().port+u.pathname+u.search,maxRedirects:0});await route.fulfill({response:r});}catch(error){if(!closing){receipt.requests.push({transport_error:String(error.message)});await route.abort().catch(()=>{});}}});
 let navigation=0;
 async function navigate(url){const target=new URL(ui.origin+url);target.searchParams.set('proof_reload',String(++navigation));if(navigation>1)await run.page.evaluate(url=>history.replaceState(null,'',url),target.href);const promise=navigation===1?run.page.goto(target.href,{waitUntil:'load',timeout:30000}):run.page.reload({waitUntil:'load',timeout:30000});try{(await ui.nextChunk()).release();await promise;}catch(error){console.log('NAV_DEBUG',run.page.url(),JSON.stringify(run.network.requests.slice(-12)));throw error;}}
 await navigate('/index.html?prod=1#production');
 await run.page.waitForFunction(()=>_prodState.loaded&&!_prodState.loading&&!_prodState.refreshing&&!_prodState.error,null,{timeout:20000});
 assert.equal(receipt.requests.filter(r=>r.error).length,0,JSON.stringify(receipt.requests));
 receipt.groups.push('local SQL-backed browser boot');
 await run.page.evaluate(async()=>{calState.client='Fixture Client';calState.posts=[];await _calOpenNativePost();});
 await run.page.locator('#calNativePostCreate').waitFor({state:'visible'});
 const initialResponse=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='intake_create');
 await run.page.locator('#calNativePostCreate').click();
 assert.equal((await initialResponse).status(),201);
 await run.page.waitForFunction(()=>_linearIntakeRead()===null,null,{timeout:20000});
 console.log('CREATE',JSON.stringify(receipt.requests),JSON.stringify(await run.page.evaluate(()=>({error:document.querySelector('#calNativePostError')?.textContent,pending:_linearIntakeRead(),state:_calNativePostState}))));
 const created=await rows("select * from deliverables where client_slug='fixtureclient'");assert.ok(created.length>0,'actual browser create persisted children');
 assert.equal(await sql("select count(*) from calendar_posts where client='fixtureclient'"),'1','actual browser materializer persisted card');
 receipt.groups.push('Calendar actual UI create -> gateway -> materializer -> SQL');
 await navigate('/index.html?prod=1#production');
 await run.page.waitForFunction(()=>_prodState.loaded&&!_prodState.loading&&!_prodState.refreshing&&!_prodState.error,null,{timeout:20000});
 for(const child of created){
  assert.equal(await run.page.evaluate(id=>_prodIssue(id)?.project,child.id),'fixtureclient','same newly created child resolves actual projection');
  await run.page.evaluate(id=>_prodOpenDeliverable(id),child.id);
  await run.page.locator('[data-prod-prop="status"]').waitFor({state:'visible'});
  await run.page.locator('[data-prod-prop="status"]').click();
  const response=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='status');
  await run.page.locator('[data-prod-pick]').filter({hasText:'In Progress'}).click();
  const statusResult=await response;assert.equal(statusResult.status(),200,await statusResult.text());
  assert.equal(await sql('select status from deliverables where id='+q(child.id)),'in_progress');
  receipt.groups.push(child.team+' mapped new-card open -> visible status picker -> actual handler SQL');
 }
 await navigate('/index.html?prod=1#production');
 await run.page.waitForFunction(()=>_prodState.loaded&&!_prodState.loading&&!_prodState.refreshing&&!_prodState.error,null,{timeout:20000});
 for(const child of created)assert.equal(await run.page.evaluate(id=>_prodIssue(id)?.raw.status,child.id),'in_progress','full reload re-reads persisted edit');
 receipt.groups.push('both mapped teams full reload preserves edits');
 for(const config of [
  {name:'Fixture Native Client',slug:'fixturenativeclient',surface:'calendar',mode:'both'},
  {name:'Fixture Native Client',slug:'fixturenativeclient',surface:'calendar',mode:'both',append:true},
  {name:'Fixture Client',slug:'fixtureclient',surface:'sxr',mode:'video'},
  {name:'Fixture Native Client',slug:'fixturenativeclient',surface:'sxr',mode:'thumbnail'},
 ]){
  const previous=new Set((await rows('select id from deliverables')).map(r=>r.id));
  await run.page.evaluate(async c=>{if(c.surface==='sxr'){sxrState.client=c.name;sxrState.posts=[];}else{calState.client=c.name;calState.posts=[];}await _calOpenNativePost(c.name,c.slug,c.surface);},config);
  await run.page.locator('#calNativePostCreate').waitFor({state:'visible'});
  if(config.mode!=='both')await run.page.locator('input[name="calNativeModeChoice"][value="'+config.mode+'"]').check();
  if(config.append)await run.page.locator('#calNativePrevBatchRadio').check();
  const response=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='intake_create');
  await run.page.locator('#calNativePostCreate').click();
  const responseValue=await response;assert.equal(responseValue.status(),201,await responseValue.text());
  await run.page.waitForFunction(()=>_linearIntakeRead()===null,null,{timeout:20000});
  const children=(await rows('select id,team,card_id,batch_id from deliverables')).filter(r=>!previous.has(r.id));
  assert.deepEqual(children.map(r=>r.team).sort(),config.mode==='both'?['graphics','video']:config.mode==='video'?['video']:['graphics']);
  const table=config.surface==='sxr'?'sample_reviews':'calendar_posts';
  assert.equal(await sql('select count(*) from '+table+' where id='+q(children[0].card_id)+' and client='+q(config.slug)),'1');
  await navigate('/index.html?prod=1#production');
  await run.page.waitForFunction(()=>_prodState.loaded&&!_prodState.loading&&!_prodState.refreshing&&!_prodState.error,null,{timeout:20000});
  for(const child of children){assert.equal(await run.page.evaluate(id=>_prodIssue(id)?.project,child.id),config.slug);await run.page.evaluate(id=>_prodOpenDeliverable(id),child.id);
   await run.page.locator('[data-prod-prop="due"]').waitFor({state:'visible'});await run.page.locator('[data-prod-prop="due"]').click();
   const written=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='due');
   await run.page.locator('[data-prod-day]').first().click();const answer=await written;assert.equal(answer.status(),200,await answer.text());
   const due=await sql('select due_date from deliverables where id='+q(child.id));assert.ok(due);child.due=due;
  }
  await navigate('/index.html?prod=1#production');await run.page.waitForFunction(()=>_prodState.loaded&&!_prodState.loading&&!_prodState.refreshing&&!_prodState.error,null,{timeout:20000});
  for(const child of children)assert.equal(await run.page.evaluate(id=>_prodIssue(id)?.raw.due_date,child.id),child.due);
  receipt.groups.push(config.surface+' '+config.slug+' '+config.mode+' '+(config.append?'append':'new')+' -> open -> due picker -> SQL -> full reload');
 }
 const first=created.find(r=>r.team==='video');await run.page.evaluate(id=>_prodOpenDeliverable(id),first.id);
 await run.page.waitForFunction(id=>_prodLabelState(id)?.status==='ready',first.id,{timeout:15000});
 await run.page.locator('[data-prod-prop="labels"]').click();
 const labelWrite=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='labels');
 await run.page.locator('[data-prod-label-option]').filter({hasText:'Synthetic Label'}).click();const labelAnswer=await labelWrite;assert.equal(labelAnswer.status(),200,await labelAnswer.text());
 assert.equal(await sql('select linear_raw->\'issue\'->\'labelIds\' from deliverables where id='+q(first.id)),'["00000000-0000-4000-8000-000000000001"]');
 receipt.groups.push('fresh native card label picker -> native catalog -> real SQL label owner and receipt');
 await run.page.evaluate(()=>_prodClearLayer());
 const form=run.page.locator('[data-prod-comment-form="'+first.id+'"]');
 await form.locator('textarea').fill('Synthetic browser comment');
 const commentResponse=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='comment');
 await form.locator('button[type="submit"]').click();const commentAnswer=await commentResponse;assert.equal(commentAnswer.status(),200,await commentAnswer.text());
 const comment=(await rows('select id from production_comments where deliverable_id='+q(first.id)+" and body='Synthetic browser comment'"))[0];assert.ok(comment);
 await run.page.locator('[data-prod-comment-id="'+comment.id+'"]').waitFor({state:'visible'});
 await navigate('/index.html?prod=1#production');await run.page.waitForFunction(()=>_prodState.loaded&&!_prodState.loading&&!_prodState.refreshing&&!_prodState.error,null,{timeout:20000});await run.page.evaluate(id=>_prodOpenDeliverable(id),first.id);
 await run.page.locator('[data-prod-comment-id="'+comment.id+'"]').waitFor({state:'visible'});
 const resolved=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='comment');
 await run.page.locator('[data-prod-comment-id="'+comment.id+'"] button').filter({hasText:'Resolve'}).click();const resolvedAnswer=await resolved;assert.equal(resolvedAnswer.status(),200,await resolvedAnswer.text());
 assert.equal(await sql('select resolved_at is not null from production_comments where id='+q(comment.id)),'t');
 receipt.groups.push('browser comment -> actual writer -> protected SQL reader -> reload -> resolve');


 await sql("insert into team_members(id,name,role,team,active,slack_user_id) values ('77777777-7777-4777-8777-777777777777','Synthetic Native Editor','editor','video',true,'U1234567890'),('88888888-8888-4888-8888-888888888888','Synthetic Free Editor','editor','video',true,'U1234567891'),('99999999-9999-4999-8999-999999999999','Synthetic Inactive Editor','editor','video',false,'U1234567892')");
 await run.page.evaluate(id=>_prodOpenDeliverable(id),first.id);
 await run.page.locator('[data-prod-prop="assignee"]').click();
 await run.page.locator('[data-prod-pick]').filter({hasText:'Synthetic Native Editor'}).waitFor({state:'visible'});
 assert.equal(await run.page.locator('[data-prod-pick]').filter({hasText:'Synthetic Inactive Editor'}).count(),0);
 const assigned=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='assignee');
 await run.page.locator('[data-prod-pick]').filter({hasText:'Synthetic Native Editor'}).click();assert.equal((await assigned).status(),200);
 assert.equal(await sql('select assignee_id from deliverables where id='+q(first.id)),'77777777-7777-4777-8777-777777777777');
 await run.page.evaluate(async()=>{navTo('workload');await wlLoadSnapshot(true);renderWorkloadAll();});
 await run.page.getByText('Synthetic Free Editor',{exact:true}).waitFor({state:'visible'});
 const work=await run.page.evaluate(id=>({row:wlState.issueSnapshot.find(r=>r.id===id),roster:wlState.editorRoster,text:document.querySelector('#workloadContent')?.textContent}),first.id);
 assert.equal(work.row.assigneeId,'77777777-7777-4777-8777-777777777777');assert.ok(work.roster.some(r=>r.name==='Synthetic Free Editor'));assert.ok(!work.roster.some(r=>r.name==='Synthetic Inactive Editor'));
 await run.page.evaluate(async id=>{await wlSetPlanDate(id,'2026-09-16');},first.id);
 assert.equal(await sql('select plan_date from workload_plan where issue_id='+q(first.id)),'2026-09-16');
 await navigate('/index.html?prod=1#production');await run.page.waitForFunction(()=>_prodState.loaded&&!_prodState.loading&&!_prodState.refreshing&&!_prodState.error,null,{timeout:20000});
 const reloadedWork=await run.page.evaluate(async()=>{const r=await wlLoadSnapshot(true);return r;});assert.ok(reloadedWork.plans.rows.some(r=>r.issue_id===first.id&&r.plan_date==='2026-09-16'));
 receipt.groups.push('SQL-added synthetic editor -> visible assignment -> SQL Workload snapshot -> native UUID and zero-task roster -> saved plan -> full reload');
 await run.page.evaluate(()=>navTo('calendar'));
 await run.page.locator('#calCommentsOverlay').waitFor({state:'attached'});
 await run.page.evaluate(async()=>{const result=await _calV2FetchPosts('fixtureclient');if(!result.ok)throw Error('Calendar reader failed');calState.client='Fixture Client';calState.posts=result.posts;calState.posts.forEach(p=>_calMigratePostShape(p));});
 await run.page.evaluate(id=>openCalComments(id),first.card_id);
 await run.page.locator('#calCommentsOverlay .cal-comments-hist').waitFor({state:'visible'});
 await run.page.locator('#calCommentsOverlay .cal-comments-hist').click();
 await run.page.locator('#calCommentsFeed .cal-cm-row-body').filter({hasText:'Synthetic browser comment'}).waitFor({state:'visible'});
 receipt.groups.push('resolved canonical comment -> actual Calendar reader -> visible History click');
 await run.page.evaluate(()=>closeCalComments());
 for(const config of [{name:'Fixture Client',slug:'fixtureclient',which:'graphic'},{name:'Fixture Native Client',slug:'fixturenativeclient',which:'video'}]){
  const card=(await rows('select id from sample_reviews where client='+q(config.slug)))[0];
  await run.page.evaluate(async c=>{const r=await _sxrFetchPosts(c.slug);if(!r.ok)throw Error('Samples read failed');sxrState.client=c.name;sxrState.posts=r.posts;sxrState.posts.forEach(p=>_sxrMigrateShape(p));await _sxrFillComponent(c.id,c.which);},{...config,id:card.id});
  assert.match(await run.page.locator('#confirmTitle').textContent(),/Add the missing/);
  const response=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='component_fill');
  const materialized=run.page.waitForResponse(r=>r.url().endsWith('/sample-review-upsert')&&r.status()===200);
  await run.page.locator('#confirmYes').click();const answer=await response;assert.equal(answer.status(),200,await answer.text());await materialized;
  await run.page.waitForFunction(()=>_linearIntakeRead()===null,null,{timeout:20000});
  const children=await rows('select id,team from deliverables where card_id='+q(card.id));assert.deepEqual(children.map(r=>r.team).sort(),['graphics','video']);
  await navigate('/index.html?prod=1#production');await run.page.waitForFunction(()=>_prodState.loaded&&!_prodState.loading&&!_prodState.refreshing&&!_prodState.error,null,{timeout:20000});
  for(const child of children)assert.equal(await run.page.evaluate(id=>_prodIssue(id)?.project,child.id),config.slug);
  receipt.groups.push('Samples '+config.which+' component fill confirmation -> gateway -> SQL -> projection reload');
 }




 const capabilityUrl=url=>url.pathname.endsWith('/rest/v1/syncview_runtime_flags')&&url.searchParams.get('key')==='eq.native_intake_epochs';
 for(const fault of ['http_failure','malformed_epoch']){
  await run.context.route(capabilityUrl,r=>r.fulfill({status:fault==='http_failure'?503:200,contentType:'application/json',body:JSON.stringify(fault==='http_failure'?{error:'synthetic outage'}:[{key:'native_intake_epochs',value:{video:{enabled:true,epoch:''},graphics:{enabled:true,epoch:''}}}])}));
  try{const options=await run.page.evaluate(async()=>{const rows=await _calLatestNativeBatches('fixturenativeclient','calendar');return {count:rows.length,allowed:rows.filter(r=>_calNativeBatchCompatible(r,'both')).length};});assert.ok(options.count>0);assert.equal(options.allowed,0);}finally{await run.context.unroute(capabilityUrl);}
  receipt.groups.push('native parentless append '+fault+' -> existing rows preserved, create option refused');
 }
 // Replay a request accepted by the supplied older gateway using the new one.
 const baselineSource=require('node:child_process').execFileSync('git',['show','c3397f93f7851964a39dc99ca6c16551aec6e377:supabase/functions/production-write/index.ts'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true});
 const baselineLoaderFile=path.join(out,'load-baseline-generated.mjs');fs.writeFileSync(baselineLoaderFile,gatewayLoader.replace("let source = fs.readFileSync(path.join(FN_DIR, 'index.ts'), 'utf8');",'let source = '+JSON.stringify(baselineSource)+';'));
 const oldGateway=await(await import(pathToFileURL(baselineLoaderFile).href)).loadGateway();
 const replayBody=gw.rootBody('video','submission:abcabcab-1234-4234-8234-123456789abc',{client_slug:'fixturenativeclient'});
 const oldAccepted=await oldGateway.post(replayBody);assert.equal(oldAccepted.status,201,JSON.stringify(oldAccepted.json));const countBefore=await sql('select count(*) from deliverables');
 const retried=await gw.post(replayBody);assert.equal(retried.status,201,JSON.stringify(retried.json));assert.equal(await sql('select count(*) from deliverables'),countBefore);
 assert.deepEqual(retried.json.items,oldAccepted.json.items);assert.equal(oldGateway.net.requests.length,0);
 const oldLabels=await gw.post({action:'labels_read',surface:'production',entity:'deliverable',id:oldAccepted.json.items[0].id,client_slug:'fixturenativeclient'});assert.equal(oldLabels.status,409,JSON.stringify(oldLabels.json));assert.equal(oldLabels.json.error,'native_label_state_incomplete');
 receipt.groups.push('older native row with unknown label state remains refused; no backfill or silent empty-state conversion');
 receipt.groups.push('supplied older gateway accepts -> repaired gateway exact retry -> same items and no duplicate child');
 // The real writer events, not manually stamped events, own these intents.
 await run.page.evaluate(id=>{navTo('production');_prodOpenDeliverable(id);},first.id);
 for(const name of ['SMM Approval','Tweak Needed']){
  await run.page.locator('[data-prod-prop="status"]').click();
  await run.page.locator('[data-prod-pick]').filter({hasText:name}).waitFor({state:'visible'});
  const changed=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='status');
  await run.page.locator('[data-prod-pick]').filter({hasText:name}).click();const answer=await changed;assert.equal(answer.status(),200,await answer.text());
  const eventCount=await sql('select count(*) from deliverable_events');const intentCount=await sql('select count(*) from production_notification_intents');const retriedStatus=await gw.post(answer.request().postDataJSON());assert.equal(retriedStatus.status,200,JSON.stringify(retriedStatus.json));assert.equal(await sql('select count(*) from deliverable_events'),eventCount);assert.equal(await sql('select count(*) from production_notification_intents'),intentCount);
 }

 const urgentRound=new Date().toISOString();const cardStatus=await writers.post('calendar-upsert',{action:'upsert',client:'fixtureclient',post:{id:first.card_id,video_status:'Tweaks Needed',video_status_at:urgentRound}},'ui');assert.equal(cardStatus.status,200,await cardStatus.text());
 const persistedRound=await sql('select video_status_at from calendar_posts where id='+q(first.card_id));
 const urgentBody={action:'native_urgent_dispatch',client_slug:'fixtureclient',deliverable_id:first.id,card_id:first.card_id,surface:'calendar',video_status_at:new Date(persistedRound).toISOString()};
 const urgent=await gw.post(urgentBody);assert.equal(urgent.status,202,JSON.stringify(urgent.json));
 const urgentRetry=await gw.post(urgentBody);assert.equal(urgentRetry.status,202,JSON.stringify(urgentRetry.json));
 const urgentIntents=await rows("select kind,intended_member_id,destination_channel_id from production_notification_intents where destination_kind='video_editing_channel'");assert.equal(urgentIntents.length,1);assert.equal(urgentIntents[0].intended_member_id,'77777777-7777-4777-8777-777777777777');assert.equal(urgentIntents[0].destination_channel_id,'C0987654321');
 receipt.groups.push('frozen card status writer + real urgent gateway -> exact native editor / separate channel -> retry no duplicate intent (handler-level)');
 const intents=await rows('select kind,message,destination_channel_id from production_notification_intents where deliverable_id='+q(first.id));
 for(const kind of ['comment','status_smm_approval','status_tweak'])assert.ok(intents.some(r=>r.kind===kind),kind);
 assert.ok(intents.filter(r=>r.kind!=='urgent').every(r=>r.destination_channel_id==='C1234567890'&&!r.message.text.includes('<@')));assert.match(intents.find(r=>r.kind==='comment').message.text,/Fixture Admin/);
 let notifySource=fs.readFileSync(path.join(root,'supabase/functions/notify/index.ts'),'utf8').replace('"npm:@supabase/supabase-js@2.49.8"',JSON.stringify(pathToFileURL(path.join(process.env.PROOF_HARNESS_ROOT,'sdk.mjs')).href)).replace(/from "(\.\.?\/[^"\n]+)"/g,(_,rel)=>'from '+JSON.stringify(pathToFileURL(path.resolve(root,'supabase/functions/notify',rel)).href)).replace('Deno.serve(','globalThis.__notifyServe(');
 let notify;globalThis.__notifyServe=h=>notify=h;const notifyFile=path.join(out,'notify-generated.ts');fs.writeFileSync(notifyFile,notifySource);await import(pathToFileURL(notifyFile).href);
 process.env.NOTIFY_RUNNER_KEY='synthetic-notify-key';process.env.SLACK_BOT_TOKEN='synthetic-slack-key';
 const savedFetch=globalThis.fetch,deliveries=[];globalThis.fetch=async(input,init)=>{assert.equal(String(input),'https://slack.com/api/chat.postMessage');const body=JSON.parse(init.body);deliveries.push(body);return new Response(JSON.stringify({ok:true,channel:body.channel,ts:'1788800000.123456'}),{status:200});};
 try{const result=await notify(new Request('http://localhost/notify',{method:'POST',headers:{'x-notify-runner-key':'synthetic-notify-key'},body:'{"limit":10}'}));assert.equal(result.status,200,await result.text());}finally{globalThis.fetch=savedFetch;}
 assert.ok(deliveries.length>=3);assert.equal(await sql("select count(*) from production_notification_delivery_receipts where outcome='sent'"),String(deliveries.length));
 receipt.notification_receipts={local_provider_sent:deliveries.length,channels:deliveries.map(r=>r.channel),kinds:intents.map(r=>r.kind),no_real_slack:true};
 const typed=await rows("select operation,status,linear_result from mirror_outbox where payload ? '_native_ordinary_receipt'");assert.ok(typed.some(r=>r.operation==='status'));assert.ok(typed.some(r=>r.operation==='due'));assert.ok(typed.every(r=>r.status==='skipped'&&r.linear_result.native_ordinary===true));
 assert.equal(await sql("select count(*) from mirror_outbox where status in ('pending','processing','failed')"),'0');
 receipt.ordinary_receipts={count:typed.length,operations:[...new Set(typed.map(r=>r.operation))],pending_provider_debt:0};
 receipt.groups.push('actual ordinary typed native receipts retained, status retry adds no event/intent, zero pending provider outbox debt');
 receipt.groups.push('real browser status/comment writers -> durable intents -> actual notify and Slack adapter with in-process provider -> SQL sent receipts');
 for(const publicLink of [false,true]){
  if(publicLink){useCapturedCalendar=servingMode==='captured-positive';await run.page.evaluate(()=>{localStorage.removeItem('syncview_staff_identity_v1');localStorage.removeItem('syncview_auth_v1');sessionStorage.clear();});await navigate('/index.html?intake=1');}
  else await run.page.evaluate(()=>navTo('linear'));
  await run.page.locator('#linearClientSearch').waitFor({state:'visible'});
  await run.page.evaluate(()=>{selectLinearProject('Fixture Client','fixtureclient');Array.from(document.querySelectorAll('[id^="videoCard_"]')).slice(1).forEach(c=>c.remove());renumberVideoCards();linearVideoCount=1;saveLinearForm();});
  await run.page.locator('#vid_main_1').fill('https://drive.invalid/synthetic-main');
  const before=new Set((await rows('select id from deliverables')).map(r=>r.id));
  const submitted=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='intake_create');
  const materialization=publicLink?run.page.waitForResponse(r=>r.url().endsWith('/calendar-upsert')):null;
  await run.page.locator('#linearSubmitBtnVideo').click();const answer=await submitted;assert.equal(answer.status(),201,await answer.text());
  if(publicLink&&servingMode==='repository-negative'){const blocked=await materialization;assert.equal(blocked.status(),401,await blocked.text());const children=(await rows('select id,team,card_id from deliverables')).filter(r=>!before.has(r.id));assert.equal(children.length,1);assert.equal(await sql('select count(*) from calendar_posts where id='+q(children[0].card_id)),'0');assert.ok(await run.page.evaluate(()=>_linearIntakeRead()!==null));receipt.blockers=['PUBLIC_INTAKE_MATERIALIZATION_401: actual public intake commits one child; unchanged repository card writer refuses unauthenticated materialization; recovery stays pending and no card exists. Frozen-writer restriction prevents changing its authentication contract.'];await run.page.screenshot({path:path.join(out,'public-intake-failure.png')});break;}
  await run.page.waitForFunction(()=>_linearIntakeRead()===null,null,{timeout:20000});
  if(publicLink){const accepted=await materialization;assert.equal(accepted.status(),200,await accepted.text());const sent=accepted.request().headers();assert.ok(!sent['x-syncview-key'],'public request must remain staff-key-free');}
  const children=(await rows('select id,team,card_id from deliverables')).filter(r=>!before.has(r.id));assert.equal(children.length,1);assert.equal(children[0].team,'video');
  if(publicLink)assert.equal(await sql('select count(*) from calendar_posts where id='+q(children[0].card_id)),'1','captured public writer persists exactly one linked card');
  if(publicLink)await run.page.evaluate(member=>{localStorage.setItem('syncview_auth_v1','ok');localStorage.setItem('syncview_staff_identity_v1',JSON.stringify({key:'fixture-admin-key',role:'admin',member}));},member);
  await navigate('/index.html?prod=1#production');await run.page.waitForFunction(()=>_prodState.loaded&&!_prodState.loading&&!_prodState.refreshing&&!_prodState.error,null,{timeout:20000});
  assert.equal(await run.page.evaluate(id=>_prodIssue(id)?.project,children[0].id),'fixtureclient');await run.page.evaluate(id=>_prodOpenDeliverable(id),children[0].id);
  await run.page.locator('[data-prod-prop="due"]').click();const due=run.page.waitForResponse(r=>r.url().endsWith('/production-write')&&r.request().postDataJSON()?.operation==='due');await run.page.locator('[data-prod-day]').first().click();assert.equal((await due).status(),200);
  receipt.groups.push((publicLink?'public intake link':'staff Submit')+' actual form -> SQL -> staff reload/open/edit');
 }
 receipt.result=receipt.blockers?.length?'FAIL':'PASS';if(receipt.blockers?.length){console.error('JOURNEY_BLOCKED',JSON.stringify(receipt.blockers));process.exitCode=1;}
}catch(error){receipt.result='FAIL';receipt.failure=String(error.stack);console.error('JOURNEY_FAILURE',String(error.stack));if(run)await run.page.screenshot({path:path.join(out,'browser-failure.png')});throw error;}
finally{closing=true;if(run){receipt.page_errors=run.pageErrors;receipt.denied=run.network.unmocked;await run.context.close();}if(browser)await browser.close();await ui.close();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>refusalProxy.close(resolve));receipt.proxy_denied=proxyDenied;
receipt.proxy_forwarded=proxyForwarded;
receipt.isolation={checked_after_teardown:true,allowed_origins:[...proxyAllowedOrigins],blocked_attempts:proxyDenied.length,external_forwards:proxyForwarded.filter(item=>!proxyAllowedOrigins.has(item.origin)||item.hostname!=='127.0.0.1'||item.port!==new URL(item.origin).port).length};
try{assert.equal(receipt.isolation.external_forwards,0,'proxy must forward only exact owned loopback origins');}catch(error){receipt.result='FAIL';receipt.isolation_failure=String(error.stack);process.exitCode=1;}
receipt.provider_requests=gw.net.requests;receipt.finished_at=new Date().toISOString();fs.writeFileSync(path.join(out,'journeys-result.json'),JSON.stringify(receipt,null,2));fs.writeFileSync(path.join(out,'journeys-'+receipt.finished_at.replace(/[:.]/g,'-')+'.json'),JSON.stringify(receipt,null,2));}
