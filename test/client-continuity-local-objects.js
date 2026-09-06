'use strict';
// Actual Git promisor-object behavior. Both repositories and the only origin
// are local temporary directories; every non-file transport is prohibited.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Module=require('node:module'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {resolvePageSource}=require('../scripts/client-continuity-run');
const ROOT=path.resolve(__dirname,'..'),BASE='688947308c96e6f00b09a495a1f16f939fde479d';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-local-object-'));
const repo=path.join(temp,'promisor'),origin=path.join(temp,'empty-origin.git');
const savedEnv=process.env,report={baseline:BASE,checks:0,observations:[],external_transports_allowed:false};
const sha=v=>createHash('sha256').update(v).digest('hex');
const check=(value,label)=>{assert.ok(value,label);report.checks++;};
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);report.checks++;};
const cleanEnv=Object.fromEntries(Object.entries(savedEnv).filter(([key])=>!key.toUpperCase().startsWith('GIT_')));
const env={...cleanEnv,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(temp,'empty-config'),
  GIT_ALLOW_PROTOCOL:'file',GIT_PROTOCOL_FROM_USER:'0',GIT_TERMINAL_PROMPT:'0',
  GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@fixture.invalid',
  GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@fixture.invalid'};
fs.writeFileSync(env.GIT_CONFIG_GLOBAL,'');fs.mkdirSync(repo);
const git=(args,input,cwd=repo)=>execFileSync('git',args,{cwd,input,encoding:'utf8',timeout:10000,
  windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...env,GIT_NO_LAZY_FETCH:'1'}}).trim();
function compileBaseline(){
  const bytes=execFileSync('git',['--no-replace-objects','show',BASE+':scripts/client-continuity-run.js'],
    {cwd:ROOT,timeout:10000,windowsHide:true,maxBuffer:16000000,env:{...env,GIT_NO_LAZY_FETCH:'1'}});
  report.baseline_module_sha256=sha(bytes);
  const file=path.join(ROOT,'scripts','client-continuity-run.local-baseline.cjs');
  const loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));
  loaded.require=Module.createRequire(file);loaded._compile(bytes.toString('utf8'),file);
  return loaded.exports.resolvePageSource;
}
function exercise(label,resolver,binding,missing){
  const trace=path.join(temp,label+'.trace');
  process.env={...env,GIT_TRACE:trace.replace(/\\/g,'/')};
  let value;
  try{
    if(missing){assert.throws(()=>resolver(binding,repo),{message:'release_mismatch'});report.checks++;}
    else value=resolver(binding,repo);
  }finally{process.env=savedEnv;}
  const text=fs.existsSync(trace)?fs.readFileSync(trace,'utf8'):'';
  const fetches=(text.match(/built-in: git fetch\b/g)||[]).length;
  const uploads=(text.match(/built-in: git upload-pack\b/g)||[]).length;
  report.observations.push({label,fetches,uploads,trace_sha256:sha(text)});
  if(process.env.CONTINUITY_LOCAL_SOURCE_REPORT){
    const dir=path.dirname(path.resolve(process.env.CONTINUITY_LOCAL_SOURCE_REPORT));fs.mkdirSync(dir,{recursive:true});
    fs.copyFileSync(trace,path.join(dir,label+'.private.trace'));
  }
  return {value,fetches,uploads};
}
try{
  git(['init','--bare','--quiet',origin],undefined,temp);git(['init','--quiet']);
  git(['remote','add','origin',origin]);git(['config','remote.origin.promisor','true']);
  git(['config','remote.origin.partialclonefilter','blob:none']);
  git(['config','extensions.partialClone','origin']);
  eq(git(['remote','get-url','origin']),origin,'only local origin configured');
  const document='Synthetic local release document\n',digest=sha(document);
  const blob=git(['hash-object','-w','--stdin'],document);
  const tree=git(['mktree'],`100644 blob ${blob}\tindex.html\n`);
  const commit=git(['commit-tree',tree,'-m','Synthetic local document']);
  fs.writeFileSync(path.join(repo,'index.html'),document);
  const binding={releaseSha:commit,pageSourceSha:commit,pageSha256:digest};
  const baseline=compileBaseline();
  report.candidate_module_sha256=sha(fs.readFileSync(path.join(ROOT,'scripts/client-continuity-run.js')));
  for(const [name,resolver] of [['baseline',baseline],['candidate',resolvePageSource]]){
    const result=exercise(name+'-present',resolver,binding,false);
    eq(result.value,{pageSourceSha:commit,pageBlobSha:blob,pageSha256:digest});eq(result.fetches,0);eq(result.uploads,0);
  }
  // Exercise absent data at each of the resolver's three actual Git reads.
  const missing='f'.repeat(40),blobTree=git(['mktree','--missing'],`100644 blob ${missing}\tindex.html\n`);
  const missingBlobCommit=git(['commit-tree',blobTree,'-m','Missing local blob']);
  const missingTreeCommit=git(['hash-object','-w','-t','commit','--stdin'],
    `tree ${missing}\nauthor Synthetic <synthetic@fixture.invalid> 1 +0000\ncommitter Synthetic <synthetic@fixture.invalid> 1 +0000\n\nMissing local tree\n`);
  for(const [label,id] of [['commit',missing],['tree',missingTreeCommit],['blob',missingBlobCommit]]){
    const requested={...binding,pageSourceSha:id};
    const old=exercise('baseline-missing-'+label,baseline,requested,true);
    check(old.fetches>0,'baseline must actually invoke implicit fetch for missing '+label);
    check(old.uploads>0,'baseline fetch must reach only the empty local bare origin');
    const fixed=exercise('candidate-missing-'+label,resolvePageSource,requested,true);
    eq(fixed.fetches,0,'candidate must never fetch absent '+label);eq(fixed.uploads,0);
  }
  report.status='PASS';
  console.log(JSON.stringify({suite:'client_continuity_local_objects',status:'PASS',checks:report.checks,
    baseline_implicit_fetches:report.observations.filter(x=>x.label.startsWith('baseline-missing')).reduce((n,x)=>n+x.fetches,0),
    candidate_implicit_fetches:report.observations.filter(x=>x.label.startsWith('candidate')).reduce((n,x)=>n+x.fetches,0),external_transports_allowed:false}));
}catch(error){report.status='FAIL';report.error=String(error.stack);throw error;}
finally{
  process.env=savedEnv;
  if(savedEnv.CONTINUITY_LOCAL_SOURCE_REPORT)fs.writeFileSync(savedEnv.CONTINUITY_LOCAL_SOURCE_REPORT,JSON.stringify(report,null,2)+'\n');
  const allowed=path.resolve(os.tmpdir())+path.sep;
  if(!path.resolve(temp).startsWith(allowed))throw new Error('temporary_fixture_path_refused');
  fs.rmSync(temp,{recursive:true,force:true});
}
