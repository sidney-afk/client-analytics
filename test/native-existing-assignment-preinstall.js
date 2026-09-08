'use strict';
// Actual source function, with only TypeScript signature annotations removed.
// Pure in-process SDK-shaped envelopes: no network, database, or provider call.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {extractFunction}=require('./helpers/extract-function');
const edge=fs.readFileSync(path.join(__dirname,'../supabase/functions/production-write/index.ts'),'utf8');
const source=extractFunction(edge,'existingAssignmentContext')
  .replace('supabase: SupabaseClient, expected: JsonMap','supabase, expected').replace(': Promise<JsonMap>','');
class GatewayError extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
function load(text){
  const context={GatewayError,parseJson:value=>value&&typeof value==='object'?value:{}};
  vm.createContext(context);vm.runInContext('async '+text+';this.run=existingAssignmentContext;',context);
  return context.run;
}
const run=load(source);
const missing={data:null,error:{code:'PGRST202',message:'production_assignment_context missing'}};
function client(envelope,rpc=missing){
  let reads=0;
  return {get reads(){return reads;},rpc:async()=>rpc,from(table){
    assert.equal(table,'syncview_runtime_flags');
    return {select(columns){assert.equal(columns,'value');return this;},eq(key,value){assert.equal(key,'key');assert.equal(value,'native_assignment_epochs');return this;},async maybeSingle(){reads++;return envelope;}};
  }};
}
let passed=0;
async function held(label,envelope,rpc=missing){
  const db=client(envelope,rpc);
  await assert.rejects(()=>run(db,{}),error=>error.status===503&&error.code==='authority_unavailable',label);
  passed++;
}
(async()=>{
  for(const code of ['PGRST202','42883']){
    const db=client({data:null,error:null},{data:null,error:{code,message:'production_assignment_context missing'}});
    const result=await run(db,{});
    assert.equal(result.preinstall,true);assert.equal(result.epoch,'');assert.equal(db.reads,1);passed++;
  }
  for(const [label,value] of [['false',false],['zero',0],['empty-string',''],['undefined',undefined],['object',{}],['array',[]]]){
    await held(label,{data:value,error:null});
  }
  for(const error of [undefined,false,0,'',{message:'unavailable'}])await held('invalid error field',{data:null,error});
  for(const envelope of [undefined,null,false,0,'',[]])await held('invalid response envelope',envelope);
  await held('missing error code',{data:null,error:null},{data:null,error:{message:'production_assignment_context missing'}});
  await held('missing different RPC',{data:null,error:null},{data:null,error:{code:'PGRST202',message:'different_rpc missing'}});
  await held('transport error',{data:null,error:null},{data:null,error:{code:'PGRST000',message:'connection refused'}});
  const provider=client(undefined,{data:{contract:'existing-assignment-v1',epoch:'',replay:false},error:null});
  assert.equal((await run(provider,{})).epoch,'');assert.equal(provider.reads,0);passed++;
  const native=client(undefined,{data:{contract:'existing-assignment-v1',epoch:'fixture-epoch',replay:true},error:null});
  assert.equal((await run(native,{})).epoch,'fixture-epoch');assert.equal(native.reads,0);passed++;
  // The four original malformed falsy values must expose the original bug.
  // No git fetch/history dependency is introduced into the offline suite.
  const guard='flag.error === null && flag.data === null';
  assert.equal(source.split(guard).length,2);
  const oldFalsy=load(source.replace(guard,'!flag.error && !flag.data'));
  for(const value of [false,0,'',undefined]){
    assert.equal((await oldFalsy(client({data:value,error:null}),{})).preinstall,true);passed++;
  }
  console.log(JSON.stringify({suite:'native-existing-assignment-preinstall',passed,failed:0,classification:'ACTUAL_SOURCE_FUNCTION_OFFLINE',negative_control_falsy_cases:4,sdk_transport_shape_proof:'UNPROVEN'}));
})().catch(error=>{console.error('native-existing-assignment-preinstall: '+error.message);process.exitCode=1;});
