'use strict';
// Real notify Request/Response path, injected SQL result; no Slack or network calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawnSync}=require('node:child_process');
if(!process.execArgv.includes('--experimental-strip-types')){const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',__filename],{stdio:'inherit'});process.exit(r.status??1);}
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'notify-urgent-'));
(async()=>{const originalDeno=globalThis.Deno,originalFetch=globalThis.fetch;let handler,calls=[],response,external=0;
 try{
 globalThis.fetch=async()=>{external++;throw Error('external transport refused');};
 let claim, intent, lookupError=false, receipts=[], posts=[];
 globalThis.Deno={env:{get:k=>({NOTIFY_RUNNER_KEY:'synthetic-private-key',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SLACK_BOT_TOKEN:'synthetic-token'}[k])},serve:fn=>{handler=fn;}};
 globalThis.__notifyUrgentDb={rpc:async(name,args)=>{
 if(name==='production_notification_claim')return {data:[claim],error:null};
 assert.equal(name,'production_notification_record_delivery');receipts.push(args);return {error:null};
 },from:name=>{assert.equal(name,'production_notification_intents');return {select:()=>({eq:(key,id)=>{assert.equal(key,'id');assert.equal(id,claim.intent_id);return {single:async()=>({data:intent,error:lookupError?{}:null})};}})};}};
 globalThis.__urgentPost=async(...args)=>{posts.push(args);return {kind:'sent',messageId:'1788800000.123456'};};
 let source=fs.readFileSync(path.join(root,'supabase/functions/notify/index.ts'),'utf8');
 const sdk='import { createClient } from "npm:@supabase/supabase-js@2.49.8";';assert.equal(source.split(sdk).length,2);source=source.replace(sdk,'const createClient = () => globalThis.__notifyUrgentDb;');
 source=source.replace('"../_shared/staff-role-auth.ts"',JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/_shared/staff-role-auth.ts')).href)).replace('"./slack-api.ts"',JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/notify/slack-api.ts')).href));
 source=source.replace('import { postSlackDirectPreview } from "./slack-api.ts";','const postSlackDirectPreview = () => { throw Error("preview not under test"); };').replace('"./format.ts"',JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/notify/format.ts')).href));
 source=source.replace('"./urgent-link.ts"',JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/notify/urgent-link.ts')).href));
 source=source.replace(/import \{ postSlackChannelMessage \} from [^;]+;/,'const postSlackChannelMessage = (...args) => globalThis.__urgentPost(...args);');
 const file=path.join(tmp,'notify.ts');fs.writeFileSync(file,source,{flag:'wx'});await import(pathToFileURL(file));assert.equal(typeof handler,'function');
 const id='00000000-0000-4000-8000-000000000001';
 const base={intent_id:id,attempt:2,destination_channel_id:'C1234567890',text:'<@U123> URGENT: Synthetic needs tweaks.',client_msg_id:id,allow_mentions:true};
 const stored={id,kind:'urgent',state:'sending',attempt_count:2,destination_channel_id:base.destination_channel_id,deliverable_id:'synthetic a/b',message:{text:base.text,allow_mentions:true}};
 async function run(c=base,i=stored,err=false){claim=c;intent=i;lookupError=err;posts=[];receipts=[];const r=await handler(new Request('http://127.0.0.1/notify',{method:'POST',headers:{'content-type':'application/json','x-notify-runner-key':'synthetic-private-key'},body:'{}'}));return r.json();}
 const url='https://syncview.synchrosocial.com/?prod=1&d=synthetic+a%2Fb#production';
 assert.equal((await run()).sent,1);assert.equal(posts.length,1);assert.equal(posts[0][1],base.destination_channel_id);assert.equal(posts[0][2],base.text+'\nOpen in SyncView: '+url);assert.equal(posts[0][3],id);assert.equal(receipts[0].p_attempt,2);
 const linked={...base,text:base.text+'\n'+url};await run(linked,{...stored,message:{...stored.message,text:linked.text}});assert.equal(posts[0][2],linked.text);
 await run({...base,allow_mentions:false},null);assert.equal(posts[0][2],base.text);
 let refused=0;
 for(const bad of [null,{...stored,id:'wrong'},{...stored,kind:'comment'},{...stored,state:'sent'},{...stored,attempt_count:3},{...stored,destination_channel_id:'C9999999999'},{...stored,message:{text:'changed',allow_mentions:true}},{...stored,deliverable_id:''},{...stored,deliverable_id:'bad\nvalue'}]){assert.equal((await run(base,bad)).retryable,1);assert.equal(posts.length,0);assert.equal(receipts[0].p_failure_code,'urgent_link_context_unavailable');refused++;}
 assert.equal((await run(base,stored,true)).retryable,1);assert.equal(posts.length,0);
 assert.equal((await run({...base,client_msg_id:'wrong'})).retryable,1);assert.equal(posts.length,0);
 assert.equal(external,0);console.log('NATIVE_NOTIFICATION_URGENT_LINK_OK: link, existing link, nonurgent, '+(refused+2)+' refusal controls; external calls 0');
 }finally{globalThis.Deno=originalDeno;globalThis.fetch=originalFetch;delete globalThis.__notifyUrgentDb;delete globalThis.__urgentPost;assert(fs.realpathSync(tmp).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
