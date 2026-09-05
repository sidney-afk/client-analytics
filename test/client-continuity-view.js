'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {readCensus,snapshot,validateConfig}=require('../scripts/client-continuity-view');
const {privatePath,persist,resolveConfig}=require('../scripts/client-continuity-run');
let passed=0;
const eq=(a,b)=>{assert.deepEqual(a,b);passed++;};
const config={lane:'samples',enabled:true,activation:'OWNER_APPROVED_VIEW_CHECKS',scope:'synthetic',censusKey:'synthetic',
  shareLink:'https://fixture.invalid/?c=synthetic&t=synthetic',backendOrigin:'https://backend.invalid',fallbackOrigin:'https://fallback.invalid',requiredVisibleIds:[]};
const row=i=>({id:String(i).padStart(4,'0'),client:'synthetic',name:'Synthetic card',status:'Client Approval'});
const response=(rows,count=rows.length)=>({ok:true,headers:{get:()=>rows.length?`0-${rows.length-1}/${count}`:`*/${count}`},json:async()=>rows});
async function main(){
  let requests=[];
  const value=await readCensus(config,async(url,init)=>{
    const u=new URL(url);requests.push(u);
    eq(u.searchParams.get('client'),'eq.synthetic');eq(init.method,'GET');eq(init.redirect,'error');
    return requests.length===1?response(Array.from({length:1000},(_,i)=>row(i)),1001):response([row(1000)]);
  });
  eq(value.count,1001);eq(requests.length,2);eq(requests[1].searchParams.get('id'),'gt.0999');
  const cases=[
    [()=>response([row(1)],2),'census_incomplete'],
    [()=>response([{...row(1),client:'foreign'}]),'census_scope'],
    [()=>response([row(1),row(1)]),'census_scope'],
    [()=>({ok:true,headers:{get:()=>null},json:async()=>[] }),'census_incomplete'],
    [()=>({ok:false}),'census_unavailable'],
  ];
  for(const [fn,code] of cases){await assert.rejects(readCensus(config,async()=>fn()),{message:code});passed++;}
  eq((await readCensus(config,async()=>response([]))).count,0);
  eq(snapshot([row(1)],'synthetic').digest===snapshot([{...row(1),name:'Changed'}],'synthetic').digest,false);
  eq(snapshot([row(1),row(2)],'synthetic').digest,snapshot([row(2),row(1)],'synthetic').digest);
  for(const patch of [{enabled:false},{scope:'synthetic,other'},{requiredVisibleIds:['']},{backendOrigin:'private-invalid-value'}]) {
    assert.throws(()=>validateConfig({...config,...patch}));passed++;
  }
  let page=0;
  await assert.rejects(readCensus(config,async()=>++page===1?response(Array.from({length:1000},(_,i)=>row(i)),1001):response([],0)),{message:'census_changed'});passed++;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-private-test-'));
  try{
    const file=path.join(temp,'config.json');fs.writeFileSync(file,JSON.stringify({enabled:false}));
    assert.throws(()=>resolveConfig(file,{},'OWNER_APPROVED_VIEW_CHECKS'),{message:'inactive'});passed++;
    fs.writeFileSync(file,JSON.stringify({enabled:true}));
    assert.throws(()=>resolveConfig(file,{},'wrong'),{message:'activation_required'});passed++;
    assert.throws(()=>privatePath(path.resolve(__dirname)),{message:'private_path_required'});passed++;
    persist(temp,'terminal.json',{code:'healthy',count:1});eq(JSON.parse(fs.readFileSync(path.join(temp,'terminal.json'),'utf8')),{code:'healthy',count:1});
    const result=spawnSync(process.execPath,['scripts/client-continuity-run.js'],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:5000});
    eq(result.status,2);eq(JSON.parse(result.stderr).code,'inactive');eq(result.stdout,'');
    const bad=spawnSync(process.execPath,['scripts/client-continuity-run.js','--config',path.join(temp,'private-secret-not-found')],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:5000});
    eq(bad.status,2);eq(bad.stderr.includes('private-secret-not-found'),false);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/client-entry-visible-boot.yml'),'utf8');
  eq(workflow.includes('node qa/client-continuity.js'),true);eq(workflow.includes('fetch-depth: 0'),true);
  eq(/secrets\.|schedule:/.test(workflow),false);
  console.log(JSON.stringify({suite:'client_continuity_view',passed,live:false}));
}
main().catch(error=>{console.error(JSON.stringify({suite:'client_continuity_view',code:error.name==='AssertionError'?'assertion_failed':'fixture_failed'}));process.exitCode=1;});
