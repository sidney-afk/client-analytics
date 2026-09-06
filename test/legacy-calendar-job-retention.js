'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process'),assert=require('assert/strict');
const {extractFunction}=require('./helpers/extract-function');
const root=path.resolve(__dirname,'..'),current=fs.readFileSync(path.join(root,'index.html'),'utf8');
const base=cp.execFileSync('git',['show','a0c10ccd01414f07536e0f177818bfa1c3f8ab34:index.html'],{cwd:root,encoding:'utf8',maxBuffer:12e6,windowsHide:true});
const key='syncview_calCardJobs_v1',provider={video:'linear',graphics:'linear'},native={video:'syncview',graphics:'syncview'};
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
function fixture(source,job,authority=provider){
 let raw=JSON.stringify([job]);const notices=[],diagnostics=[],calls=[];
 const context={Date,Set,Promise,JSON,console:{log(){},warn(){}},CAL_CARD_JOBS_KEY:key,CAL_CARD_JOB_MAX_AGE_MS:172800000,CAL_CARD_JOB_MAX_RUNS:5,CAL_CARD_JOB_LIVE_HEARTBEAT_MS:180000,
 localStorage:{getItem:()=>raw,setItem(k,v){raw=v;}},_writeUiRefreshAuthority:async()=>authority,
 showNotify:(...args)=>notices.push(args),_writeUiQueueDiagnostic:(...args)=>diagnostics.push(args),
 _writeLinearVideoCardsToCalendar:async(...args)=>calls.push(args)};
 vm.createContext(context);
 for(const name of ['_calCardJobsRead','_calCardJobsWrite','_calCardJobRemove','_calCardJobTeams','_calCardJobRetain','_resumePendingCalCardJobs']){
   if(name==='_calCardJobRetain'&&!source.includes('function '+name+'('))continue;
   vm.runInContext(extractFunction(source,name),context);
 }
 vm.runInContext('let _calCardJobsResumePromise=null;let _calCardJobsRetentionNotified=false;',context);
 return{context,notices,diagnostics,calls,read:()=>raw,write:value=>raw=value,run:()=>context._resumePendingCalCardJobs()};
}
const job=extra=>({id:'fixture-job',clientName:'PRIVATE_FIXTURE_NAME',formTitle:'PRIVATE_FIXTURE_TITLE',mode:'both',videos:[{number:1},{number:2}],done:[1],runs:0,createdAt:Date.now(),heartbeatAt:0,...extra});
(async()=>{
 for(const [name,row,authority] of [['authority',job(),native],['age',job({createdAt:Date.now()-172800001}),provider],['attempts',job({runs:5}),provider],['invalid',job({clientName:''}),provider]]){
  await check('baseline deletes '+name,async()=>{const f=fixture(base,row,authority);await f.run();assert.deepEqual(JSON.parse(f.read()),[]);});
  await check('candidate preserves exact '+name+' record without transport',async()=>{const f=fixture(current,row,authority),before=f.read();await f.run();await f.run();assert.equal(f.read(),before);assert.equal(f.calls.length,0);assert.equal(f.notices.length,1);const visible=JSON.stringify([f.notices,f.diagnostics]);assert.ok(!visible.includes('PRIVATE_FIXTURE'));assert.ok(!visible.includes('fixture-job'));assert.ok(visible.includes('unconfirmed'));assert.ok(!visible.includes('Create Post'));});
 }
 await check('authority unavailable retains without side effects',async()=>{const f=fixture(current,job(),null),before=f.read();await f.run();assert.equal(f.read(),before);assert.equal(f.calls.length,0);assert.equal(f.notices.length,0);});
 await check('unreadable authority rejects without queue writes',async()=>{const f=fixture(current,job()),before=f.read();f.context._writeUiRefreshAuthority=async()=>{throw Error('fixture offline');};await assert.rejects(f.run());assert.equal(f.read(),before);assert.equal(f.calls.length,0);});
 await check('existing completed checkpoint cleanup is preserved after authority change',async()=>{const f=fixture(current,job({done:[1,2]}),native);await f.run();assert.deepEqual(JSON.parse(f.read()),[]);assert.equal(f.notices.length,0);assert.equal(f.calls.length,0);});
 await check('fresh other-tab heartbeat remains untouched',async()=>{const f=fixture(current,job({heartbeatAt:Date.now()})),before=f.read();await f.run();assert.equal(f.read(),before);assert.equal(f.calls.length,0);});
 await check('eligible provider job uses unchanged payload and writer',async()=>{const row=job(),f=fixture(current,row);await f.run();assert.equal(f.calls.length,1);assert.equal(JSON.stringify(f.calls[0][3].job),JSON.stringify(row));assert.equal(f.calls[0][0],row.clientName);});
 await check('retention does not overwrite a sibling progress checkpoint',async()=>{const f=fixture(current,job(),native);let updated;f.context._writeUiQueueDiagnostic=()=>{updated=JSON.stringify([job({done:[1,2],heartbeatAt:Date.now()})]);f.write(updated);};await f.run();assert.equal(f.read(),updated);});
 await check('notification failure cannot delete work',async()=>{const f=fixture(current,job(),native),before=f.read();f.context.showNotify=()=>{throw Error('fixture view unavailable');};await f.run();assert.equal(f.read(),before);});
 await check('retention requires no storage write or inferred actor',async()=>{const f=fixture(current,job(),native),before=f.read();f.context.localStorage.setItem=()=>{throw Error('fixture quota');};await f.run();assert.equal(f.read(),before);assert.equal(f.calls.length,0);});
 await check('parallel lifecycle calls retain the existing shared promise',async()=>{const f=fixture(current,job(),native);const a=f.run(),b=f.run();assert.equal(a,b);await a;assert.equal(f.notices.length,1);});
 await check('authority reversal remains explicit unresolved replay risk',async()=>{const f=fixture(current,job(),native);await f.run();assert.equal(f.calls.length,0);f.context._writeUiRefreshAuthority=async()=>provider;await f.run();assert.equal(f.calls.length,1);});
 for(const name of ['_writeLinearVideoCardsToCalendar','_calCardJobSave','_calCardJobCreate','_linearIntakeRequireActor','_runNativeIntakeJob'])await check('unchanged existing contract '+name,()=>assert.equal(extractFunction(current,name),extractFunction(base,name)));
 console.log(JSON.stringify({passed,baseline_deletions:4,classification:'OFFLINE_ACTUAL_SOURCE',external_requests:0,serving:'UNPROVEN'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
