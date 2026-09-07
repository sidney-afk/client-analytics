'use strict';
// Existing GitHub Actions execution/artifacts are the hosted primary. This CLI
// can also run on an independent always-on host; it never installs a schedule.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {main:viewMain,privatePath}=require('./client-continuity-run');
const {receipts,evaluate,observe,validateState}=require('./client-continuity-observer');
const {deliver}=require('./client-continuity-delivery');
const {report}=require('./client-continuity-monitor');
const ROOT=path.resolve(__dirname,'..'),REPO='sidney-afk/client-analytics';
function requireValue(ok){if(!ok)throw new Error('operations_refused');}
function atomic(file,value){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value)+'\n',{mode:0o600});fs.renameSync(temp,file);}
function config(env,mode) {
  requireValue(['view','observe','drill','sentinel'].includes(mode));
  const c=JSON.parse(env.CONTINUITY_OPERATIONS_JSON||'{}');
  requireValue(c[mode+'Enabled']===true&&env.CONTINUITY_ACTIVATION==='OWNER_APPROVED_CONTINUITY_'+mode.toUpperCase());
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  requireValue(c.releaseSha===head&&/^[a-f0-9]{40}$/.test(head));
  execFileSync('git',['diff','--quiet','HEAD','--','scripts','index.html','.github/workflows/client-continuity-hosted-view.yml','.github/workflows/client-continuity-hosted-observer.yml','.github/workflows/client-continuity-hosted-delivery-drill.yml'],{cwd:ROOT});
  return c;
}
async function runs(workflow,sha,env,fetchImpl=fetch) {
  requireValue(['client-continuity-hosted-view.yml','client-continuity-hosted-observer.yml'].includes(workflow)&&!!env.GH_TOKEN);
  const url=`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/runs?per_page=20`;
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${env.GH_TOKEN}`,Accept:'application/vnd.github+json'}});
  requireValue(response.ok);const body=await response.json();requireValue(Array.isArray(body.workflow_runs));
  return body.workflow_runs.filter(r=>r.head_sha===sha&&['schedule','workflow_dispatch'].includes(r.event)&&Number.isSafeInteger(r.id)&&String(r.id)!==env.GITHUB_RUN_ID)
    .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
}
function download(run,name,directory,env) {
  requireValue(Number.isSafeInteger(run.id)&&['continuity-receipts','continuity-observer'].includes(name));
  fs.mkdirSync(directory,{recursive:true});
  execFileSync('gh',['run','download',String(run.id),'--repo',REPO,'--name',name,'--dir',directory],
    {env:{...env,GH_TOKEN:env.GH_TOKEN},timeout:20000,stdio:['ignore','ignore','pipe'],maxBuffer:16384});
}
function recoveryState(c,env) {
  if(c.recoveryEnabled!==true)return undefined;
  requireValue(env.CONTINUITY_RECOVERY_ACTIVATION==='OWNER_APPROVED_CONTINUITY_STATE_RECOVERY');
  const file=privatePath(env.CONTINUITY_RECOVERY_STATE);
  requireValue(fs.statSync(file).isFile()&&fs.statSync(file).size<16384);
  return validateState(JSON.parse(fs.readFileSync(file,'utf8')),c.releaseSha);
}
async function collect(c,env,temp,fetchImpl=fetch,downloadImpl=download,restored) {
  const viewRuns=await runs('client-continuity-hosted-view.yml',c.releaseSha,env,fetchImpl),records=[];
  let unavailable=false;
  for(const run of viewRuns.slice(0,6)) {
    const dir=path.join(temp,'view-'+run.id);
    try{await downloadImpl(run,'continuity-receipts',dir,env);records.push(...receipts(dir,c.releaseSha));}
    catch{
      // A started/failed job without an artifact is an absent terminal, not
      // evidence of healthy viewing. Young queued/in-progress runs get 2 min.
      if(run.status==='completed'||Date.now()-Date.parse(run.created_at)>120000)unavailable=true;
    }
  }
  if(restored)return {records,previous:restored,unavailable};
  const previousRuns=await runs('client-continuity-hosted-observer.yml',c.releaseSha,env,fetchImpl);
  let previous;
  if(previousRuns.length) {
    const dir=path.join(temp,'previous');
    // Do not erase a delivery intent because an observer crashed. No older-state
    // fallback: ambiguous history must be investigated, not used to resend.
    await downloadImpl(previousRuns[0],'continuity-observer',dir,env);
    previous=validateState(JSON.parse(fs.readFileSync(path.join(dir,'observer-state.json'),'utf8')),c.releaseSha);
  }
  return {records,previous,unavailable};
}
async function sentinel(c,env,fetchImpl=fetch,now=Date.now()) {
  // Independent-host command: no notification call or observer-state writes.
  // Its host must page on nonzero exit AND missed invocation independently.
  try {
    for(const workflow of ['client-continuity-hosted-view.yml','client-continuity-hosted-observer.yml']) {
      const history=await runs(workflow,c.releaseSha,env,fetchImpl);
      const latest=history[0],age=now-Date.parse(latest?.created_at);
      requireValue(latest&&age>=0&&age<=600000);
      const recentSuccess=history.find(r=>r.status==='completed'&&r.conclusion==='success'&&now-Date.parse(r.updated_at)>=0&&now-Date.parse(r.updated_at)<=600000);
      requireValue(recentSuccess&&!(latest.status==='completed'&&latest.conclusion!=='success'));
    }
    return report('observer','healthy');
  }catch{return report('observer','monitor_missing');}
}
async function main(mode,env=process.env,deps={}) {
  const c=config(env,mode);
  if(mode==='sentinel')return sentinel(c,env,deps.fetchImpl||fetch);
  const output=privatePath(env.CONTINUITY_PUBLIC_OUTPUT);requireValue(fs.statSync(output).isDirectory());
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-operations-'));
  try {
    if(mode==='view') {
      const view=JSON.parse(env.CONTINUITY_PRIVATE_VIEW_JSON||'{}');
      requireValue(view.releaseSha===c.releaseSha&&view.outputDirectoryEnv==='CONTINUITY_OUTPUT_DIR');
      const file=path.join(temp,'view.json');atomic(file,view);
      const result=await viewMain(['--config',file,'--activate','OWNER_APPROVED_VIEW_CHECKS'],{...env,CONTINUITY_OUTPUT_DIR:output});
      return {version:1,mode,ok:result.results.every(r=>r.ok)};
    }
    const stateFile=path.join(output,'observer-state.json');
    const save=async state=>atomic(stateFile,state);
    const send=(result,id,options)=>deliver(result,id,c.delivery,env,deps.fetchImpl||fetch,options);
    if(mode==='drill') {
      // Exact synthetic failure then recovery, each with persisted intent. A
      // failed/ambiguous delivery stops the drill; it never retries a POST.
      const events=[];
      for(const code of ['false_empty','recovered']) {
        const id=randomUUID();events.push({id,code,status:'attempted'});atomic(path.join(output,'delivery-drill.json'),{version:1,events});
        const receipt=await send(report('samples',code),id,{drill:true});events[events.length-1].status=receipt.delivered?'confirmed':'unknown';
        events[events.length-1].evidence=receipt.primaryDelivered?receipt.primaryEvidence:receipt.fallbackEvidence;
        atomic(path.join(output,'delivery-drill.json'),{version:1,events});if(!receipt.delivered)return {version:1,mode,ok:false};
      }
      return {version:1,mode,ok:true,code:'delivery_drill_complete',independentFallbackProven:false,acknowledged:false};
    }
    const input=await collect(c,env,temp,deps.fetchImpl||fetch,deps.download||download,recoveryState(c,env));
    const results=input.unavailable?['calendar','samples'].map(l=>report(l,'terminal_missing')):evaluate(input.records,c.activatedAt);
    const result=await observe(results,input.previous,{sha:c.releaseSha,persist:save,send,deliveryEnabled:c.delivery?.enabled===true});
    await save(result.state);
    const summary={version:1,releaseSha:c.releaseSha,observedAt:Date.now(),results,pendingDelivery:result.pendingDelivery};
    atomic(path.join(output,'observer-terminal.json'),summary);
    return {version:1,mode,ok:results.every(r=>r.ok)&&!result.pendingDelivery};
  } finally {
    // Only our newly created temporary directory; never caller-selected paths.
    if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('continuity-operations-'))fs.rmSync(temp,{recursive:true,force:true});
  }
}
if(require.main===module) {
  const deadline=setTimeout(()=>process.exit(2),120000);
  main(process.argv[2]).then(r=>{console.log(JSON.stringify(r));process.exitCode=r.ok?0:1;})
    .catch(()=>{console.error(JSON.stringify({version:1,code:'operations_refused_or_failed'}));process.exitCode=2;})
    .finally(()=>clearTimeout(deadline));
}
module.exports={main,config,runs,collect,atomic,sentinel,recoveryState};
