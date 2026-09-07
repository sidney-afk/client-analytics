'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {readCensus,snapshot,validateConfig}=require('../scripts/client-continuity-view');
const {privatePath,persist,resolveConfig,resolvePageSource,main:runMain}=require('../scripts/client-continuity-run');
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
    const repo=path.join(temp,'synthetic-source');fs.mkdirSync(repo);
    const git=(args,input)=>execFileSync('git',args,{cwd:repo,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@fixture.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@fixture.invalid'}}).trim();
    git(['init','--quiet']);
    const document='Synthetic approved old document\n',documentHash=createHash('sha256').update(document).digest('hex');
    const blob=git(['hash-object','-w','--stdin'],document);
    const tree=git(['mktree'],`100644 blob ${blob}\tindex.html\n`);
    const source=git(['commit-tree',tree,'-m','Synthetic document']);
    const current='Synthetic newer tooling document\n',currentHash=createHash('sha256').update(current).digest('hex');
    const currentBlob=git(['hash-object','-w','--stdin'],current);
    const currentTree=git(['mktree'],`100644 blob ${currentBlob}\tindex.html\n`);
    const tooling=git(['commit-tree',currentTree,'-p',source,'-m','Synthetic tooling']);
    fs.writeFileSync(path.join(repo,'index.html'),current);
    const binding={releaseSha:tooling,pageSourceSha:source,pageSha256:documentHash};
    eq(resolvePageSource(binding,repo),{pageSourceSha:source,pageBlobSha:blob,pageSha256:documentHash});
    eq(resolvePageSource({releaseSha:tooling,pageSha256:currentHash},repo).pageSourceSha,tooling);
    for(const patch of [{pageSourceSha:'HEAD'},{pageSourceSha:source.slice(0,12)},{pageSourceSha:'https://fixture.invalid/ref'},{pageSourceSha:'f'.repeat(40)},{pageSourceSha:blob},{pageSourceSha:tree},{pageSourceSha:null},{pageSha256:currentHash},{pageSha256:'invalid'}]) {
      assert.throws(()=>resolvePageSource({...binding,...patch},repo),{message:'release_mismatch'});passed++;
    }
    assert.throws(()=>resolvePageSource({releaseSha:tooling,pageSha256:documentHash},repo),{message:'release_mismatch'});passed++;
    git(['update-ref','refs/heads/moving',source]);
    git(['update-ref','refs/heads/moving',tooling]);
    eq(resolvePageSource(binding,repo).pageBlobSha,blob);
    git(['replace',source,tooling]);eq(resolvePageSource(binding,repo).pageBlobSha,blob);
    assert.throws(()=>resolvePageSource({...binding,pageSourceSha:'refs/heads/moving'},repo),{message:'release_mismatch'});passed++;
    const emptyTree=git(['mktree'],'');const missing=git(['commit-tree',emptyTree,'-m','Missing document']);
    assert.throws(()=>resolvePageSource({...binding,pageSourceSha:missing},repo),{message:'release_mismatch'});passed++;
    const linkTree=git(['mktree'],`120000 blob ${blob}\tindex.html\n`);const link=git(['commit-tree',linkTree,'-m','Symlink document']);
    assert.throws(()=>resolvePageSource({...binding,pageSourceSha:link},repo),{message:'release_mismatch'});passed++;
    fs.writeFileSync(path.join(repo,'index.html'),'Local drift');
    assert.throws(()=>resolvePageSource({releaseSha:tooling,pageSha256:currentHash},repo),{message:'release_mismatch'});passed++;
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
    const root=path.join(__dirname,'..'),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const prior=execFileSync('git',['rev-parse','HEAD^'],{cwd:root,encoding:'utf8'}).trim();
    const hash=createHash('sha256').update(execFileSync('git',['show',prior+':index.html'],{cwd:root,maxBuffer:16000000})).digest('hex');
    const liveConfig={enabled:true,releaseSha:head,pageSourceSha:prior,pageSha256:hash,outputDirectoryEnv:'TEST_OUTPUT',backendOriginEnv:'TEST_BACKEND',fallbackOriginEnv:'TEST_FALLBACK',censusKeyEnv:'TEST_KEY',readOriginsEnv:'TEST_ORIGINS',lanes:{calendar:{linkEnv:'TEST_LINK',scopeEnv:'TEST_SCOPE',requiredVisibleIdsEnv:'TEST_IDS'},samples:{linkEnv:'TEST_LINK',scopeEnv:'TEST_SCOPE',requiredVisibleIdsEnv:'TEST_IDS'}}};
    const refs={TEST_OUTPUT:temp,TEST_BACKEND:'https://backend.invalid',TEST_FALLBACK:'https://fallback.invalid',TEST_KEY:'synthetic',TEST_ORIGINS:'[]',TEST_LINK:'https://fixture.invalid/?c=synthetic&t=synthetic',TEST_SCOPE:'synthetic',TEST_IDS:'[]'};
    fs.writeFileSync(file,JSON.stringify(liveConfig));
    const resolved=resolveConfig(file,refs,'OWNER_APPROVED_VIEW_CHECKS');eq(resolved.pageSource.pageSourceSha,prior);eq(resolved.config.releaseSha,head);eq(resolved.lanes[0].expectedPageSha256,hash);
    const savedFetch=global.fetch;let network=0;global.fetch=async()=>{network++;throw Error('network prohibited');};
    try {
      fs.writeFileSync(file,JSON.stringify({...liveConfig,pageSourceSha:'f'.repeat(40)}));
      await assert.rejects(runMain(['--config',file,'--activate','OWNER_APPROVED_VIEW_CHECKS'],refs),{message:'release_mismatch'});passed++;eq(network,0);
    }finally{global.fetch=savedFetch;}
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/client-entry-visible-boot.yml'),'utf8');
  eq(workflow.includes('node qa/client-continuity.js'),true);eq(workflow.includes('fetch-depth: 0'),true);
  eq(/secrets\.|schedule:/.test(workflow),false);
  console.log(JSON.stringify({suite:'client_continuity_view',passed,live:false}));
}
main().catch(error=>{console.error(JSON.stringify({suite:'client_continuity_view',code:error.name==='AssertionError'?'assertion_failed':'fixture_failed'}));process.exitCode=1;});
