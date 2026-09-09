'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
if(!process.execArgv.includes('--experimental-strip-types')){const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',__filename],{stdio:'inherit'});process.exit(r.status??1);}
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'notify-adapter-'));
(async()=>{try{
 const source=fs.readFileSync(path.join(root,'supabase/functions/notify/slack-api.ts'),'utf8');
 const entry=path.join(tmp,'slack-api.ts');fs.writeFileSync(entry,source);const {postSlackChannelMessage}=await import('file://'+entry);
 const channel='C1234567890',text='escaped ‹@U123› &amp; plain';
 async function call(response){let seen=null;const result=await postSlackChannelMessage('token',channel,text,'00000000-0000-4000-8000-000000000001',false,async(_u,o)=>{seen=JSON.parse(o.body);return response;});assert.equal(seen.parse,'none');assert.equal(seen.link_names,false);assert.equal(seen.mrkdwn,false);assert.equal(seen.text,text);return result;}
 assert.deepEqual(await call(new Response(JSON.stringify({ok:true,channel,ts:'1788800000.123456'}),{status:200})),{kind:'sent',messageId:'1788800000.123456'});
 assert.equal((await call(new Response('{',{status:200}))).kind,'unknown','malformed Slack body never succeeds');
 assert.equal((await call(new Response(JSON.stringify({ok:true,channel:'C9999999999',ts:'1788800000.123456'}),{status:200}))).kind,'blocked','wrong channel never becomes receipt');
 assert.equal((await call(new Response(JSON.stringify({ok:false,error:'internal_error'}),{status:500}))).kind,'unknown','5xx is not retried blindly');
 assert.equal((await call(new Response(JSON.stringify({ok:false,error:'ratelimited'}),{status:429}))).kind,'retryable','429 is known non-delivery');
 const hanging=await postSlackChannelMessage('token',channel,text,'00000000-0000-4000-8000-000000000001',false,async(_u,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted')))));
 assert.equal(hanging.kind,'unknown','deadline abort is unknown');
 console.log('native notification Slack adapter: ok');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
