'use strict';
// Real notify Request/Response path, injected SQL result; no Slack or network calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawnSync}=require('node:child_process');
if(!process.execArgv.includes('--experimental-strip-types')){const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',__filename],{stdio:'inherit'});process.exit(r.status??1);}
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'notify-health-'));
(async()=>{const originalDeno=globalThis.Deno,originalFetch=globalThis.fetch;let handler,calls=[],response,external=0;
 try{
 globalThis.fetch=async()=>{external++;throw Error('external transport refused');};
 globalThis.Deno={env:{get:k=>({NOTIFY_RUNNER_KEY:'synthetic-private-key',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'}[k])},serve:fn=>{handler=fn;}};
 globalThis.__notifyHealthDb={rpc:async name=>{calls.push(name);assert.equal(name,'production_notification_health_summary');return response;}};
 let source=fs.readFileSync(path.join(root,'supabase/functions/notify/index.ts'),'utf8');
 const sdk='import { createClient } from "npm:@supabase/supabase-js@2.49.8";';assert.equal(source.split(sdk).length,2);source=source.replace(sdk,'const createClient = () => globalThis.__notifyHealthDb;');
 source=source.replace('"../_shared/staff-role-auth.ts"',JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/_shared/staff-role-auth.ts')).href)).replace('"./slack-api.ts"',JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/notify/slack-api.ts')).href));
 const file=path.join(tmp,'notify.ts');fs.writeFileSync(file,source,{flag:'wx'});await import(pathToFileURL(file));assert.equal(typeof handler,'function');
 const counts={pending_stale:0,sending_stale:0,blocked:0,unknown:0,retryable_overdue:0,total_open:0};
 async function health(data,key='synthetic-private-key'){response={data,error:null};calls=[];const r=await handler(new Request('http://127.0.0.1/notify',{method:'POST',headers:{'content-type':'application/json','x-notify-runner-key':key},body:JSON.stringify({action:'health'})}));return {status:r.status,body:await r.json()};}
 assert.deepEqual(await health(counts),{status:200,body:{ok:true,...counts}});
 const overdue={...counts,retryable_overdue:1,total_open:1};assert.deepEqual(await health(overdue),{status:503,body:{ok:false,...overdue}});assert.deepEqual(calls,['production_notification_health_summary']);
 // SQL alone defines overdue as next_attempt_at <= now(); no new grace threshold.
 assert.equal((await health({...counts,total_open:1})).status,200,'future retry/young pending is not overdue');
 for(const field of ['pending_stale','sending_stale','blocked','unknown'])assert.equal((await health({...counts,[field]:1,total_open:1})).status,503);
 assert.equal((await health({...counts,retryable_overdue:-1})).body.error,'notification_monitor_unavailable');
 assert.equal((await health(counts,'wrong')).status,401);assert.deepEqual(calls,[]);assert.equal(external,0);
 console.log('NATIVE_NOTIFICATION_HEALTH_HANDLER_OK 9 cases; external calls 0');
 }finally{globalThis.Deno=originalDeno;globalThis.fetch=originalFetch;delete globalThis.__notifyHealthDb;assert(fs.realpathSync(tmp).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
