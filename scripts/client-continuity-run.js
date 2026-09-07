'use strict';
// Manual launcher. No schedules, default secrets, implicit env-file loading or
// automatic alert delivery. Public output contains only reconstructed fields.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {viewingJourney}=require('./client-continuity-view');
const {routeAlert,report}=require('./client-continuity-monitor');
const ROOT=path.resolve(__dirname,'..');
const ACTIVATION='OWNER_APPROVED_VIEW_CHECKS';
function requireValue(ok,code){if(!ok)throw new Error(code);}
function privatePath(value) {
  requireValue(typeof value==='string'&&path.isAbsolute(value),'private_path_required');
  const resolved=fs.realpathSync(value);
  for(let p=resolved;;p=path.dirname(p)) {
    requireValue(!fs.existsSync(path.join(p,'.git')),'private_path_required');
    if(path.dirname(p)===p)break;
  }
  return resolved;
}
function secret(env,reference) {
  requireValue(typeof reference==='string'&&/^[A-Z][A-Z0-9_]+$/.test(reference)&&!!env[reference],'private_config_required');
  return env[reference];
}
function resolvePageSource(config,root=ROOT) {
  const pageSourceSha=config.pageSourceSha===undefined?config.releaseSha:config.pageSourceSha;
  requireValue(typeof pageSourceSha==='string'&&/^[a-f0-9]{40}$/.test(pageSourceSha),'release_mismatch');
  requireValue(typeof config.pageSha256==='string'&&/^[a-f0-9]{64}$/.test(config.pageSha256),'release_mismatch');
  const git=args=>execFileSync('git',['--no-replace-objects',...args],{
    cwd:root,stdio:['ignore','pipe','pipe'],maxBuffer:16000000,timeout:10000,windowsHide:true,
    // cat-file may otherwise fetch absent objects in a partial clone. A local
    // release proof must neither contact the remote nor wait for credentials.
    env:{...process.env,GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'},
  });
  try {
    // Full local commit IDs only. No fetch, branch, tag, URL or revision syntax.
    requireValue(git(['cat-file','-t',pageSourceSha]).toString().trim()==='commit','release_mismatch');
    const entry=git(['ls-tree',pageSourceSha,'--','index.html']).toString();
    const match=/^100644 blob ([a-f0-9]{40})\tindex\.html\n$/.exec(entry);
    requireValue(!!match,'release_mismatch');
    const pageSha256=createHash('sha256').update(git(['cat-file','blob',match[1]])).digest('hex');
    requireValue(pageSha256===config.pageSha256,'release_mismatch');
    // Omission preserves the original current-checkout byte check too.
    if(config.pageSourceSha===undefined)requireValue(pageSha256===createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),'release_mismatch');
    return {pageSourceSha,pageBlobSha:match[1],pageSha256};
  }catch{throw new Error('release_mismatch');}
}
function resolveConfig(file,env,activation,kind='view') {
  const config=JSON.parse(fs.readFileSync(privatePath(file),'utf8'));
  requireValue(config[kind==='view'?'enabled':'deliveryEnabled']===true,'inactive');
  requireValue(activation===(kind==='view'?ACTIVATION:'OWNER_APPROVED_DELIVERY_DRILL'),'activation_required');
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  requireValue(/^[a-f0-9]{40}$/.test(config.releaseSha)&&config.releaseSha===head,'release_mismatch');
  execFileSync('git',['diff','--quiet','HEAD','--','index.html','scripts/client-continuity-run.js','scripts/client-continuity-view.js','scripts/client-continuity-transport.js','scripts/client-continuity-monitor.js'],{cwd:ROOT});
  const output=privatePath(secret(env,config.outputDirectoryEnv));
  requireValue(fs.statSync(output).isDirectory(),'private_path_required');
  if(kind==='delivery')return {config,output,lanes:[]};
  const pageSource=resolvePageSource(config);
  const common={enabled:true,activation:ACTIVATION,backendOrigin:secret(env,config.backendOriginEnv),
    fallbackOrigin:secret(env,config.fallbackOriginEnv),censusKey:secret(env,config.censusKeyEnv),
    expectedPageSha256:config.pageSha256,readOrigins:JSON.parse(secret(env,config.readOriginsEnv))};
  requireValue(Array.isArray(common.readOrigins)&&common.readOrigins.every(v=>typeof v==='string'&&new URL(v).origin===v),'private_config_required');
  const lanes=['calendar','samples'].map(lane=>{
    const spec=config.lanes[lane];
    return {...common,lane,shareLink:secret(env,spec.linkEnv),scope:secret(env,spec.scopeEnv),
      requiredVisibleIds:JSON.parse(secret(env,spec.requiredVisibleIdsEnv))};
  });
  return {config,output,lanes,pageSource};
}
function persist(directory,name,value) {
  const target=path.join(directory,name),temp=target+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,target);
}
async function fixtureRun() {
  const {chromium}=require('playwright');
  const H=require('../qa/boot/client-entry-sequence');
  const {fixture}=require('../qa/client-continuity-fixtures');
  const server=await H.startStreamServer();let browser;
  try {
    browser=await chromium.launch({headless:true});
    const results=[];
    for(const lane of ['calendar','samples']) {
      const {config,deps}=fixture(browser,server,lane);
      results.push(await viewingJourney(browser,config,deps));
    }
    return {version:1,fixture:true,results};
  } finally {if(browser)await browser.close();await server.close();}
}
async function main(args=process.argv.slice(2),env=process.env) {
  if(args.length===1&&args[0]==='--fixture')return fixtureRun();
  const kind=args.includes('--alert-drill')?'delivery':'view';
  const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  requireValue(option('--config'),'inactive');
  const {config,output,lanes,pageSource}=resolveConfig(option('--config'),env,option('--activate'),kind);
  const lock=path.join(output,'continuity.lock');
  const lockFd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(lockFd,String(process.pid));fs.closeSync(lockFd);
  let browser;
  // A killed worker leaves its start without a terminal. Never manufacture a
  // success receipt on timeout. Independent observation must alarm on absence.
  const deadline=setTimeout(()=>process.exit(2),120000);
  try {
    if(kind==='delivery') {
      const delivery=config.delivery;
      requireValue(delivery.independenceConfirmed===true&&delivery.recipientsConfirmed===true,'delivery_confirmation_required');
      const receipt=await routeAlert(report('samples','false_empty'),{enabled:true,activation:'OWNER_APPROVED_DELIVERY_DRILL',
        primaryUrl:secret(env,delivery.primaryUrlEnv),fallbackUrl:secret(env,delivery.fallbackUrlEnv),
        fallbackToken:secret(env,delivery.fallbackTokenEnv),n8nApiKey:secret(env,delivery.n8nApiKeyEnv),
        n8nBaseUrl:secret(env,delivery.n8nBaseUrlEnv)});
      persist(output,`delivery-${receipt.runId}.json`,receipt);
      return receipt;
    }
    const {chromium}=require('playwright');
    const results=[];
    for(const lane of lanes) {
      const runId=randomUUID(),startedAt=Date.now();
      const start={version:1,runId,lane:lane.lane,releaseSha:config.releaseSha,...pageSource,startedAt};
      persist(output,`${lane.lane}-${runId}.start.json`,start);
      let result;
      try {
        if(!browser)browser=await chromium.launch({headless:true});
        result=await viewingJourney(browser,lane);
      }catch{result=report(lane.lane,'read_failed');}
      const terminal={...start,finishedAt:Date.now(),code:result.code,count:result.count,denialReasons:result.denialReasons||[]};
      persist(output,`${lane.lane}-${runId}.terminal.json`,terminal);results.push(result);
    }
    return {version:1,fixture:false,releaseSha:config.releaseSha,...pageSource,results};
  } finally {
    if(browser)await browser.close().catch(()=>{});
    clearTimeout(deadline);fs.unlinkSync(lock);
  }
}
if(require.main===module)main().then(result=>{
  console.log(JSON.stringify(result));
  process.exitCode=result.results?Number(result.results.some(r=>!r.ok)):result.exitCode;
}).catch(error=>{
  const codes=['inactive','private_path_required','activation_required','private_config_required','release_mismatch','delivery_confirmation_required'];
  console.error(JSON.stringify({version:1,code:codes.includes(error.message)?error.message:'launcher_failed'}));process.exitCode=2;
});
module.exports={main,privatePath,resolveConfig,persist,resolvePageSource};
