'use strict';
// Separate manual contract. Never writes legacy calendar/samples receipts.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {privatePath,persist,resolvePageSource}=require('./client-continuity-run');
const I=require('./samples-initial-read'),D=require('./client-continuity-delivery');
const ROOT=path.resolve(__dirname,'..'),UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ACTIVATION='OWNER_APPROVED_SAMPLES_INITIAL_READ';
function check(ok){if(!ok)throw Error('initial_operation_refused');}
function config(file,env,activation,mode,now=Date.now()) {
  check(['view','observe','drill'].includes(mode)&&activation===ACTIVATION);
  const c=JSON.parse(fs.readFileSync(privatePath(file),'utf8'));
  check(c.contract===I.CONTRACT&&c[mode+'Enabled']===true);
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  check(c.releaseSha===head&&/^[a-f0-9]{40}$/.test(head));
  check(!execFileSync('git',['status','--porcelain','--untracked-files=all','--','scripts','package.json','index.html','.github/workflows/samples-initial-read.yml'],{cwd:ROOT,encoding:'utf8'}).trim());
  const pageSource=resolvePageSource(c),output=privatePath(D.reference(env,c.outputDirectoryEnv));
  check(fs.statSync(output).isDirectory()&&/^[a-f0-9]{64}$/.test(c.expectedSdkSha256)&&
    Number.isFinite(c.activatedAt)&&c.activatedAt>0&&c.activatedAt<=now);
  check(c.censusAuthorityConfirmed===true&&c.censusReadOnlyRoleConfirmed===true&&
    UUID.test(c.canary?.approvalId)&&c.canary.ownerApproved===true&&c.canary.ownerDesignatedTestScope===true&&
    Number.isFinite(c.canary.approvedAt)&&c.canary.approvedAt<=now&&c.canary.approvedAt>0&&
    (c.canary.expiresAt==null||(Number.isFinite(c.canary.expiresAt)&&c.canary.expiresAt>now)));
  const pins={releaseSha:head,...pageSource,expectedSdkSha256:c.expectedSdkSha256,approvalId:c.canary.approvalId,approvalExpiresAt:c.canary.expiresAt??null};
  if(mode!=='view')return {c,pins,output};
  const spec=c.samples,ids=JSON.parse(D.reference(env,spec.requiredVisibleIdsEnv)),titles=JSON.parse(D.reference(env,spec.requiredVisibleTitlesEnv));
  check(Array.isArray(ids)&&ids.length>0&&ids.length<=10&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&id&&typeof titles[id]==='string'&&titles[id].trim())&&Object.keys(titles).length===ids.length);
  const lane={lane:'samples',initialRead:true,enabled:true,activation:'OWNER_APPROVED_VIEW_CHECKS',
    backendOrigin:D.reference(env,c.backendOriginEnv),fallbackOrigin:D.reference(env,c.fallbackOriginEnv),censusKey:D.reference(env,c.censusKeyEnv),
    shareLink:D.reference(env,spec.linkEnv),scope:D.reference(env,spec.scopeEnv),requiredVisibleIds:ids,requiredVisibleTitles:titles,
    expectedPageSha256:c.pageSha256,expectedSdkSha256:c.expectedSdkSha256,readOrigins:JSON.parse(D.reference(env,c.readOriginsEnv))};
  check(Array.isArray(lane.readOrigins)&&lane.readOrigins.every(v=>typeof v==='string'&&new URL(v).origin===v));
  require('./client-continuity-view').validateConfig(lane);
  return {c,pins,output,lane};
}
function records(directory,pins,now=Date.now()) {
  const result=[];
  for(const name of fs.readdirSync(directory)) {
    if(!/^samples-initial-[a-f0-9-]+\.(start|terminal)\.json$/.test(name))continue;
    const file=path.join(directory,name);check(fs.lstatSync(file).isFile()&&fs.statSync(file).size<16384);
    const v=JSON.parse(fs.readFileSync(file,'utf8')),terminal=name.endsWith('.terminal.json');
    check(v.version===1&&v.contract===I.CONTRACT&&v.lane==='samples_initial_read'&&UUID.test(v.runId)&&
      name===`samples-initial-${v.runId}.${terminal?'terminal':'start'}.json`&&Object.keys(pins).every(k=>v[k]===pins[k])&&
      Number.isFinite(v.startedAt)&&v.startedAt>0&&v.startedAt<=now&&(pins.approvalExpiresAt===null||v.startedAt<pins.approvalExpiresAt));
    const safe={version:1,contract:I.CONTRACT,lane:'samples_initial_read',runId:v.runId,...pins,startedAt:v.startedAt};
    if(terminal) {
      check(Number.isFinite(v.finishedAt)&&v.finishedAt>=v.startedAt&&v.finishedAt<=now&&(pins.approvalExpiresAt===null||v.finishedAt<pins.approvalExpiresAt));
      Object.assign(safe,{finishedAt:v.finishedAt,result:I.validateReceipt(v.result)});
    }
    result.push(safe);
  }
  return result;
}
function evaluate(items,activatedAt,now=Date.now()) {
  check(Number.isFinite(activatedAt)&&activatedAt>0&&activatedAt<=now);
  const starts=items.filter(v=>!v.finishedAt),ends=items.filter(v=>v.finishedAt);
  check(new Set(starts.map(v=>v.runId)).size===starts.length&&new Set(ends.map(v=>v.runId)).size===ends.length);
  for(const end of ends)check(starts.some(s=>s.runId===end.runId&&s.startedAt===end.startedAt));
  if(starts.some(s=>now-s.startedAt>=120000&&!ends.some(e=>e.runId===s.runId)))return I.alertResult('terminal_missing');
  const latest=ends.sort((a,b)=>b.startedAt-a.startedAt)[0];
  if(!latest||now-latest.startedAt>600000)return I.alertResult('monitor_missing');
  return I.alertResult(latest.result.code,latest.result.count);
}
function validateState(value,pins) {
  check(value?.version===1&&value.contract===I.CONTRACT&&Object.keys(pins).every(k=>value[k]===pins[k])&&Number.isFinite(value.observedAt));
  const clean={version:1,contract:I.CONTRACT,...pins,observedAt:value.observedAt};
  if(value.event){const e=value.event;check(UUID.test(e.id)&&['prepared','attempted','confirmed'].includes(e.status)&&Number.isFinite(e.openedAt));
    clean.event={id:e.id,status:e.status,openedAt:e.openedAt,result:I.alertResult(e.result.code,e.result.count)};
    check(e.result.contract===I.CONTRACT&&e.result.lane==='samples_initial_read');}
  return clean;
}
async function observe(result,previous,{pins,save,send,deliveryEnabled=false,now=Date.now()}) {
  const state=previous?validateState(previous,pins):{version:1,contract:I.CONTRACT,...pins};state.observedAt=now;
  let e=state.event;
  if(e?.status==='attempted'&&deliveryEnabled){if((await send(e.result,e.id,{reconcileOnly:true})).delivered)e.status='confirmed';await save(state);}
  if(e?.status!=='attempted') {
    const code=result.ok?'recovered':result.code;
    if((!result.ok||e)&&(!e||e.result.code!==code))state.event=e={id:randomUUID(),openedAt:now,status:'prepared',result:I.alertResult(code,result.count)};
    if(e?.status==='prepared'&&deliveryEnabled){e.status='attempted';await save(state);if((await send(e.result,e.id,{})).delivered)e.status='confirmed';}
  }
  await save(state);return {state,pendingDelivery:e?.status==='attempted'};
}
function acquireLock(directory) {
  const file=path.join(directory,'samples-initial.lock'),token=randomUUID(),fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,token);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  // Cooperative lock ownership: never remove a file replaced by another owner.
  // Manual replacement while a runner is alive is prohibited by the runbook.
  const identity=fs.statSync(file);
  return ()=>{
    if(!fs.existsSync(file))return;
    const current=fs.lstatSync(file);
    check(current.isFile()&&current.dev===identity.dev&&current.ino===identity.ino&&fs.readFileSync(file,'utf8')===token);
    fs.unlinkSync(file);
  };
}
async function main(args=process.argv.slice(2),env=process.env,deps={}) {
  if(args.length===1&&args[0]==='--fixture')return require('../qa/samples-initial-read').run();
  const option=name=>args[args.indexOf(name)+1],mode=args[0];
  check(args.length===5&&args[1]==='--config'&&args[3]==='--activate');
  const {c,pins,output,lane}=config(option('--config'),env,option('--activate'),mode);
  const releaseLock=acquireLock(output),write=deps.persist||persist;
  const deadline=setTimeout(()=>process.exit(2),120000);
  try {
    if(mode==='view') {
      const start={version:1,contract:I.CONTRACT,lane:'samples_initial_read',runId:randomUUID(),...pins,startedAt:Date.now()};
      write(output,`samples-initial-${start.runId}.start.json`,start);
      let browser,result;
      try {browser=await (deps.launch||(()=>require('playwright').chromium.launch({headless:true})))();result=await (deps.capture||I.captureInitialRead)(browser,lane);}
      catch{result=I.assess({safety:{version:1,setupComplete:false,teardownComplete:false,outcomes:['setup_failed']},proof:{stableDom:false,authoritativeEmpty:false,canaryCount:0,principalVerified:false,primaryComplete:false,sdkMatched:false}});}
      let closeTimer;
      try{if(browser)await Promise.race([browser.close(),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('cleanup_timeout')),3000);})]);}
      catch{result.safety.teardownComplete=false;result.safety.outcomes.push('teardown_failed');result=I.assess({...result.evidence,safety:result.safety,denialReasons:result.denialReasons});}
      finally{clearTimeout(closeTimer);}
      check(pins.approvalExpiresAt===null||Date.now()<pins.approvalExpiresAt);
      write(output,`samples-initial-${start.runId}.terminal.json`,{...start,finishedAt:Date.now(),result:I.validateReceipt(result)});
      return result;
    }
    const statePath=path.join(output,'samples-initial-observer-state.json');
    const save=async state=>{const tmp=statePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state)+'\n',{mode:0o600});fs.renameSync(tmp,statePath);};
    const send=(result,id,options)=>{
      check(c.delivery?.enabled===true&&c.delivery.contract===I.CONTRACT&&c.delivery.independenceConfirmed===true);
      return D.deliver(result,id,c.delivery,env,fetch,{...options,contract:I.CONTRACT});
    };
    if(mode==='drill') {
      check(c.delivery?.enabled===true);
      // Persist each intent first; an ambiguous first delivery stops the drill.
      for(const code of ['false_empty','recovered']) {
        const event={id:randomUUID(),status:'attempted',result:I.alertResult(code)};
        persist(output,`samples-initial-drill-${event.id}.intent.json`,event);
        const delivery=await send(event.result,event.id,{drill:true});
        persist(output,`samples-initial-drill-${event.id}.receipt.json`,delivery);
        if(!delivery.delivered)return {version:1,contract:I.CONTRACT,ok:false,code:'delivery_unconfirmed'};
      }
      return {version:1,contract:I.CONTRACT,ok:true,code:'drill_delivery_only',acknowledged:false,independentFallbackProven:false};
    }
    let result;try{result=evaluate(records(output,pins),c.activatedAt);}catch{result=I.alertResult('integration_missing');}
    const previous=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):undefined;
    const observed=await observe(result,previous,{pins,save,send,deliveryEnabled:c.delivery?.enabled===true});
    return {...result,pendingDelivery:observed.pendingDelivery};
  }finally{clearTimeout(deadline);releaseLock();}
}
if(require.main===module)main().then(r=>{console.log(JSON.stringify(r));process.exitCode=r.live===false||r.ok&&!r.pendingDelivery?0:1;})
  .catch(e=>{console.error(JSON.stringify({version:1,contract:I.CONTRACT,code:e.message==='samples_initial_sdk_setup_required'?e.message:'initial_operation_refused_or_failed'}));process.exitCode=2;});
module.exports={main,config,records,evaluate,observe,validateState,acquireLock,ACTIVATION};
