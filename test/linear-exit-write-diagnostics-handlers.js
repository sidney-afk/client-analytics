'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url'),{spawnSync}=require('child_process');
if(!process.execArgv.includes('--experimental-strip-types')){const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',__filename],{stdio:'inherit'});process.exit(r.status??1);}
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wr101-handlers-'));let handler,calls=[],fail=false;const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',WRITE_DIAGNOSTICS_RUNNER_KEY:'synthetic-operator',WRITE_DIAGNOSTICS_ENABLED:'true'};
(async()=>{const oldDeno=globalThis.Deno,oldFetch=globalThis.fetch;try{
 globalThis.fetch=async()=>{throw Error('external prohibited');};globalThis.Deno={env:{get:k=>env[k]},serve:fn=>handler=fn};globalThis.__wr101db={rpc:async(name,args)=>{calls.push({name,args});return fail?{error:{message:'PRIVATE_TOKEN'}}:{data:{recorded:true},error:null};}};
 const diagnostics=await import('../supabase/functions/_shared/write-refusal-diagnostics.mjs');for(const code of ['synthetic_person_name','token_abcdef0123456789'])assert.equal((await diagnostics.makeRefusalReceipt({},code,409)).code,'write_refused');
 const {OPERATIONS}=await import('../supabase/functions/production-write/policy.mjs');for(const operation of OPERATIONS)assert.equal((await diagnostics.makeRefusalReceipt({operation},'write_conflict',409)).operation,operation);
 let source=fs.readFileSync(path.join(root,'supabase/functions/write-diagnostics/index.ts'),'utf8').replace("import {createClient} from 'npm:@supabase/supabase-js@2.49.8';",'const createClient=()=>globalThis.__wr101db;');source=source.replaceAll("'../_shared/staff-role-auth.ts'",JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/_shared/staff-role-auth.ts')).href)).replaceAll("'../_shared/write-refusal-diagnostics.mjs'",JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/_shared/write-refusal-diagnostics.mjs')).href)).replaceAll("'./browser-detail.mjs'",JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/write-diagnostics/browser-detail.mjs')).href));
 const file=path.join(tmp,'endpoint.ts');fs.writeFileSync(file,source);await import(pathToFileURL(file));
 const request=body=>new Request('http://127.0.0.1/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 env.WRITE_DIAGNOSTICS_ENABLED='false';assert.equal((await handler(request({action:'browser_claim'}))).status,503);assert.equal(calls.length,0);env.WRITE_DIAGNOSTICS_ENABLED='true';
 assert.equal((await handler(request({action:'lookup'}))).status,401);assert.equal(calls.length,0);
 assert.equal((await handler(request({action:'browser_claim',padding:'x'.repeat(3000)}))).status,413);assert.equal(calls.length,0);
 const browser=await handler(request({action:'browser_claim',identifiers:{card:'synthetic-card',body:'PRIVATE_PROSE'},principal_kind:'staff',member_id:'PRIVATE_TOKEN',author_name:'PRIVATE_NAME',code:'write_conflict',status:409}));assert.equal(browser.status,202);assert.equal(calls[0].args.p_receipt.principal_kind,'unverified');assert(!JSON.stringify(calls).includes('PRIVATE_'));calls=[];
 // OPEN_REPAIRS 101 release A: detail fields, verified staff role, v1 fallback, staff list.
 env.ROLE_KEY_ADMIN='synthetic-admin';env.ROLE_KEY_SMM='synthetic-smm';
 const withKey=(body,key,agent)=>new Request('http://127.0.0.1/',{method:'POST',headers:{'content-type':'application/json',...(key?{'x-syncview-key':key}:{}),...(agent?{'user-agent':agent}:{})},body:JSON.stringify(body)});
 const safari='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
 assert.equal((await handler(withKey({action:'browser_claim',surface:'calendar',operation:'approve',identifiers:{card:'p_card_1'},code:'write_conflict',status:409,message:'Changed elsewhere',app_version:'2026-09-27T14:05',page:'staff_page'},'synthetic-smm',safari))).status,202);
 assert.equal(calls[0].name,'production_write_refusal_record_browser_v2');assert.deepEqual(calls[0].args.p_detail,{card_ref:'p_card_1',ui_action:'approve',detail:'Changed elsewhere',browser:'safari',os:'ios',app_version:'2026-09-27T14:05',staff_role:'smm'});
 assert(!JSON.stringify(calls).includes('synthetic-smm'),'the staff key is never passed on');calls=[];
 await handler(withKey({action:'browser_claim',code:'write_conflict',status:409,page:'staff_page'},'not-a-key'));assert.equal(calls[0].args.p_detail.staff_role,null,'an unverified key records no role');calls=[];
 await handler(withKey({action:'browser_claim',code:'write_conflict',status:409,app_version:'yesterday',operation:'Bad Action!'}));assert.equal(calls[0].args.p_detail.app_version,null);assert.equal(calls[0].args.p_detail.ui_action,null);calls=[];
 // 2026-09-28: the page's attempt id is kept (one record per click) and a network failure has no status.
 const att='0f8fad5b-d9cb-469f-a165-70867728950e';
 await handler(withKey({action:'browser_claim',code:'write_conflict',status:409,attempt:att}));assert.equal(calls[0].args.p_receipt.attempt_id,att);calls=[];
 await handler(withKey({action:'browser_claim',attempt:'not-a-uuid'}));assert.notEqual(calls[0].args.p_receipt.attempt_id,'not-a-uuid');calls=[];
 await handler(withKey({action:'browser_claim',failure:'network',message:'Failed to fetch'}));assert.equal(calls[0].args.p_receipt.code,'network_failure');assert.equal(calls[0].args.p_receipt.status,null,'no invented 500');calls=[];
 await handler(withKey({action:'browser_claim',code:'write_conflict',status:409}));assert.equal(calls[0].args.p_receipt.status,409);assert.equal(calls[0].args.p_receipt.code,'write_conflict');calls=[];
 const realRpc=globalThis.__wr101db.rpc;globalThis.__wr101db.rpc=async(name,args)=>{calls.push({name,args});return name==='production_write_refusal_record_browser_v2'?{error:{code:'PGRST202'}}:{data:{recorded:true},error:null};};
 assert.equal((await handler(request({action:'browser_claim',code:'write_conflict',status:409}))).status,202);assert.deepEqual(calls.map(c=>c.name),['production_write_refusal_record_browser_v2','production_write_refusal_record_v1'],'before the migration a claim still records through v1');globalThis.__wr101db.rpc=realRpc;calls=[];
 assert.equal((await handler(request({action:'staff_list'}))).status,401);assert.equal((await handler(withKey({action:'staff_list'},'synthetic-smm'))).status,403);assert.equal(calls.length,0,'only an admin key reads the list');
 assert.equal((await handler(withKey({action:'staff_list',days:30,include_automation:true,surface:'production',page:'client_link'},'synthetic-admin'))).status,200);assert.deepEqual(calls[0],{name:'production_write_refusal_list_v1',args:{p_days:30,p_include_automation:true,p_limit:300,p_surface:'production',p_page:'client_link'}});calls=[];
 await handler(withKey({action:'staff_list',surface:'drop table',page:'x'},'synthetic-admin'));assert.equal(calls[0].args.p_surface,null);assert.equal(calls[0].args.p_page,null,'unknown filter values are dropped');calls=[];
 // Real composed top-level GatewayError path. Business handlers are not invoked by this invalid action.
 const composed=require('../scripts/linear-exit-write-diagnostics-compose').gateway().source;
 // The Deno.serve block now runs to end of file. It used to be bounded by the
 // appended `authenticate` wrapper, which no longer exists: the principal
 // capture moved onto authenticate's own success returns, and authenticate is
 // declared far ABOVE Deno.serve, so searching forward for it found nothing.
 const start=composed.indexOf('Deno.serve(async (req: Request)'),end=composed.length;assert(start>0&&end>start);
 assert(composed.indexOf('async function authenticate(')<start,'authenticate is declared before the served handler');
 const errorStart=composed.indexOf('class GatewayError extends Error'),errorEnd=composed.indexOf('function waitUntil(',errorStart);
 const prelude=`import {captureRefusalContext,reportGatewayRefusal} from ${JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/_shared/write-refusal-diagnostics.mjs')).href)};\ntype JsonMap=Record<string,unknown>;const CORS={};const clean=(v)=>String(v||'').trim(),lower=(v)=>clean(v).toLowerCase();const createClient=()=>globalThis.__wr101db;\n`;
 const gateway=path.join(tmp,'gateway.ts');fs.writeFileSync(gateway,prelude+composed.slice(errorStart,errorEnd)+composed.slice(start,end));await import(pathToFileURL(gateway));
 const body={action:'synthetic_unsupported',id:'synthetic-card',surface:'calendar',operation:'comment',body:'PRIVATE_PROSE',token:'PRIVATE_TOKEN'};
 let r=await handler(request(body));assert.equal(r.status,400);assert.deepEqual(await r.json(),{ok:false,error:'unsupported_action'});assert.equal(r.headers.get('x-write-diagnostic-status'),'recorded');assert.equal(calls.length,1);assert.equal(calls[0].args.p_receipt.code,'unsupported_action');assert(!JSON.stringify(calls).includes('PRIVATE_'));
 fail=true;const oldLog=console.error;let logs=[];console.error=x=>logs.push(x);try{r=await handler(request(body));assert.equal(r.status,400);assert.deepEqual(await r.json(),{ok:false,error:'unsupported_action'});assert.equal(r.headers.get('x-write-diagnostic-status'),'unavailable');assert.deepEqual(logs,['write_refusal_telemetry_unavailable']);}finally{console.error=oldLog;}
 console.log('LINEAR_EXIT_WRITE_DIAGNOSTICS_HANDLERS_OK endpoint claims/auth/dormancy + actual generated gateway catch; business-handler coverage separate');
 }finally{globalThis.Deno=oldDeno;globalThis.fetch=oldFetch;delete globalThis.__wr101db;assert(fs.realpathSync(tmp).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
