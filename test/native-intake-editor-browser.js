'use strict';
// Always-offline actual browser functions. No credential, network or SQL input.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {extractFunction}=require('./helpers/extract-function');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const base='69ae5d338486bd8084e6bbdbe65be1c44f63dbe1';
const oldHtml=execFileSync('git',['show',base+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const oldGateway=execFileSync('git',['show',base+':supabase/functions/production-write/index.ts'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
const gateway=fs.readFileSync(path.join(root,'supabase/functions/production-write/index.ts'),'utf8');
let checks=0;
function pass(label){checks++;console.log('ok '+label);}
assert.equal(extractFunction(html,'_calLegacyVideoEditorPool').replace('_calLegacyVideoEditorPool','_calNativeVideoEditorPool'),extractFunction(oldHtml,'_calNativeVideoEditorPool'));
pass('provider browser loader body remains exact');
for(const symbol of ['autoAssigneeForIntake','intakeAssigneePool','assertEligibleAssignee','handleIntakeCreate','handleAssigneeOptions','handleCreateOptions']) {
 assert.equal(extractFunction(gateway,symbol),extractFunction(oldGateway,symbol));pass(symbol+' remains exact');
}
function world(result) {
 const context={console,Set,Number,JSON,Error,CAL_SUPABASE_URL:'https://synthetic.invalid',CAL_SUPABASE_ANON_KEY:'synthetic',
  _calNativePostState:{surface:'calendar',clientSlug:'synthetic-client'},actor:{key:'synthetic-key',role:'admin',member:{id:'synthetic-actor'}},
  rest:0,calls:[],reply:result};
 context._syncviewStaffIdentityForHeaders=()=>context.actor;
 context._nativePostViewSlug=()=>context._calNativePostState.clientSlug;
 context._syncviewEfHeaders=h=>h;
 context._calLegacyVideoEditorPool=async()=>{context.rest++;return [{id:'mapped',name:'Mapped',openCount:1}];};
 context.fetch=async(url,init)=>{context.calls.push(JSON.parse(init.body));if(context.hold)await context.hold;return {ok:context.httpOk!==false,json:async()=>context.reply};};
 vm.createContext(context);vm.runInContext('async '+extractFunction(html,'_calNativeVideoEditorPool'),context);return context;
}
const good={ok:true,complete:true,contract:'intake-editor-options-v1',surface:'calendar',client_slug:'synthetic-client',team:'video',lane:'native',editors:[{id:'unmapped',name:'Unmapped',openCount:0}]};
(async()=>{
 let c=world(good);assert.equal((await c._calNativeVideoEditorPool())[0].id,'unmapped');assert.equal(c.rest,0);pass('native minimal projection adopted without provider loader');
 c=world({...good,lane:'provider',editors:undefined});assert.equal((await c._calNativeVideoEditorPool())[0].id,'mapped');assert.equal(c.rest,1);pass('positive provider decision selects unchanged loader');
 for(const [label,result] of [
  ['null',null],['not-ok',{...good,ok:false}],['incomplete',{...good,complete:false}],['wrong-contract',{...good,contract:'old'}],
  ['wrong-surface',{...good,surface:'sxr'}],['wrong-client',{...good,client_slug:'other'}],['wrong-team',{...good,team:'graphics'}],
  ['unknown-lane',{...good,lane:'unknown'}],['empty',{...good,editors:[]}],['object',{...good,editors:{}}],
  ['duplicate',{...good,editors:[good.editors[0],good.editors[0]]}],['missing-id',{...good,editors:[{name:'Editor',openCount:0}]}],
  ['missing-name',{...good,editors:[{id:'id',openCount:0}]}],['bad-count',{...good,editors:[{id:'id',name:'Editor',openCount:-1}]}],
  ['missing-count',{...good,editors:[{id:'id',name:'Editor'}]}],['provider-roster',{...good,lane:'provider'}]]) {
  c=world(result);await assert.rejects(c._calNativeVideoEditorPool());assert.equal(c.rest,0);pass(label+' refuses without provider fallback');
 }
 c=world(good);c.httpOk=false;await assert.rejects(c._calNativeVideoEditorPool());assert.equal(c.rest,0);pass('failed HTTP refuses');
 for(const change of ['dialog','surface','client','actor','key','role','actor-in-place','key-in-place','role-in-place']) {
  c=world(good);let release;c.hold=new Promise(resolve=>{release=resolve;});const pending=c._calNativeVideoEditorPool();
  if(change==='dialog')c._calNativePostState={...c._calNativePostState};
  else if(change==='surface')c._calNativePostState.surface='sxr';
  else if(change==='client')c._calNativePostState.clientSlug='other';
  else if(change==='actor')c.actor={...c.actor,member:{id:'other'}};
  else if(change==='actor-in-place')c.actor.member.id='other';
  else if(change==='key-in-place')c.actor.key='other';
  else if(change==='role-in-place')c.actor.role='other';
  else c.actor={...c.actor,[change]:'other'};
  release();await assert.rejects(pending);assert.equal(c.rest,0);pass('late '+change+' response withheld');
 }
 c=world(good);c.actor=null;await assert.rejects(c._calNativeVideoEditorPool());assert.equal(c.calls.length,0);pass('no local actor sends no roster request');
 c=world(good);c.actor.role='creative';await assert.rejects(c._calNativeVideoEditorPool());assert.equal(c.calls.length,0);pass('creative cannot invoke new browser projection');
 console.log(JSON.stringify({suite:'native-intake-editor-browser',checks,status:'PASS'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
