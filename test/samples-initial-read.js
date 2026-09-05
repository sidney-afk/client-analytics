'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto'),I=require('../scripts/samples-initial-read'),R=require('../scripts/samples-initial-read-run');
const old=require('../scripts/client-continuity-observer'),D=require('../scripts/client-continuity-delivery');
const clone=v=>JSON.parse(JSON.stringify(v));
const positive=()=>({full:{code:'mutation_blocked',ok:false},read:{code:'healthy',count:1},
  proof:{stableDom:true,authoritativeEmpty:false,canaryCount:1,principalVerified:true,primaryComplete:true,sdkMatched:true},
  safety:{version:1,setupComplete:true,teardownComplete:true,outcomes:['mutation_blocked'],subscriptions:{known:4,unknown:0,matched:4,unmatched:0,realtimeDenied:4,realmRealtimeEvents:4,labels:['samples_rows','routing_flags','sample_flags','settings_flags']}},denialReasons:['realtime_transport_blocked']});
async function main(){let passed=0;const eq=(a,b)=>{assert.deepEqual(a,b);passed++;};
  const sdkManifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../qa/samples-initial-sdk/package.json'),'utf8'));
  eq(Object.keys(sdkManifest).sort(),['dependencies','description','name','private','version']);
  eq(sdkManifest.dependencies,{'@supabase/supabase-js':'2.115.0'});eq(sdkManifest.private,true);
  eq(I.assess(positive()).code,'initial_read_verified');
  const mutations=[
    d=>d.safety.outcomes.push('valid_link_auth'),d=>d.safety.outcomes.push('browser_error'),d=>d.safety.outcomes.push('read_failed'),
    d=>d.safety.outcomes.push('scope_mismatch'),d=>d.safety.outcomes.push('untracked_failure'),d=>d.safety.outcomes.push('teardown_failed'),
    d=>d.safety.outcomes.push('teardown_observation_failed'),d=>d.safety.outcomes.push('unknown'),
    d=>d.safety.outcomes=[],d=>delete d.full.ok,d=>d.full.ok=null,
    d=>d.safety.setupComplete=false,d=>d.safety.teardownComplete=false,d=>d.safety.subscriptions.unknown++,
    d=>d.safety.subscriptions.unmatched++,d=>d.safety.subscriptions.realmRealtimeEvents++,d=>d.safety.subscriptions.realtimeDenied++,
    d=>d.safety.subscriptions.labels=['routing_flags'],d=>d.safety.subscriptions.labels.push('unknown'),d=>d.denialReasons.push('metadata_post_blocked'),
    d=>d.denialReasons.push('proxy_socket_error'),d=>d.full.ok=true,d=>d.full.code='healthy',
    d=>d.proof.principalVerified=false,d=>d.proof.primaryComplete=false,d=>d.proof.sdkMatched=false,d=>d.proof.stableDom=false,
    d=>d.proof.canaryCount=0,d=>d.proof.authoritativeEmpty=true,d=>d.read.count=0,d=>d.read.code='false_empty',
    d=>d.read.code='render_failed',d=>d.read.code='stale_unwarned',d=>d.read.code='inconclusive',
  ];
  for(const change of mutations){const d=positive();change(d);eq(I.assess(d).ok,false);}
  const p=I.assess(positive());eq(I.validateReceipt(p).code,'initial_read_verified');
  for(const patch of [{count:0},{code:'recovered'},{contract:'client_continuity'},{safety:undefined},{evidence:undefined},{fullContinuity:{code:'healthy',ok:true}}]){assert.throws(()=>I.validateReceipt({...p,...patch}));passed++;}
  const privateExtra=clone(p);privateExtra.safety.secret='synthetic-private';assert.throws(()=>I.validateReceipt(privateExtra));passed++;
  for(const mutate of [v=>delete v.evidence.full.ok,v=>v.evidence.full.ok=null,v=>v.safety.outcomes=[]]) {
    const value=clone(p);mutate(value);assert.throws(()=>I.validateReceipt(value));passed++;
  }
  const now=Date.now(),sha='a'.repeat(40),pins={releaseSha:sha,pageSourceSha:'b'.repeat(40),pageBlobSha:'c'.repeat(40),pageSha256:'d'.repeat(64),expectedSdkSha256:'e'.repeat(64),approvalId:randomUUID(),approvalExpiresAt:now+60000};
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'samples-initial-unit-'));
  try {
    // Exercise the actual loader through the existing extractor, without
    // importing a Playwright harness into the dependency-free root unit job.
    const loaderSource=require('./helpers/extract-function').extractFunction(fs.readFileSync(path.join(__dirname,'../qa/samples-initial-read.js'),'utf8'),'loadSdk');
    const loadSdk=require('node:vm').runInNewContext(loaderSource+'; loadSdk',{fs,path,__dirname:path.join(__dirname,'../qa')});
    assert.throws(()=>loadSdk(path.join(temp,'missing-sdk')),{message:'samples_initial_sdk_setup_required'});passed++;
    const start={version:1,contract:I.CONTRACT,lane:'samples_initial_read',runId:randomUUID(),...pins,startedAt:now-1000};
    const name=kind=>path.join(temp,`samples-initial-${start.runId}.${kind}.json`);
    fs.writeFileSync(name('start'),JSON.stringify(start));fs.writeFileSync(name('terminal'),JSON.stringify({...start,finishedAt:now,result:p}));
    eq(R.evaluate(R.records(temp,pins,now),now-2000,now).code,'initial_read_verified');
    eq(old.receipts(temp,sha,now),[]);
    eq(old.evaluate(old.receipts(temp,sha,now),now-700000,now).every(r=>!r.ok),true);
    eq(R.evaluate([start],now-700000,now+120000).code,'terminal_missing');
    eq(R.evaluate([],now-700000,now).code,'monitor_missing');
    eq(R.evaluate(R.records(temp,pins,now),now-700000,now+700000).code,'monitor_missing');
    assert.throws(()=>R.records(temp,{...pins,pageSha256:'f'.repeat(64)},now));passed++;
    fs.writeFileSync(name('terminal'),JSON.stringify({...start,finishedAt:now,result:{...p,count:0}}));assert.throws(()=>R.records(temp,pins,now));passed++;
    const saved=[];let sends=0;
    const options={pins,now,save:async s=>saved.push(clone(s)),send:async()=>{sends++;return {delivered:false};}};
    let state=(await R.observe(I.alertResult('false_empty'),undefined,options)).state;
    eq(state.event.status,'prepared');eq(sends,0);
    state=(await R.observe(I.alertResult('false_empty'),state,{...options,deliveryEnabled:true})).state;
    eq(state.event.status,'attempted');eq(sends,1);eq(saved.some(s=>s.event.status==='attempted'),true);
    const attemptedId=state.event.id;
    state=(await R.observe(I.alertResult('initial_read_verified',1),state,{...options,deliveryEnabled:true,send:async(r,id,o)=>{eq(o.reconcileOnly,true);return {delivered:false};}})).state;
    eq(state.event.id,attemptedId);eq(state.event.result.code,'false_empty');
    state=(await R.observe(I.alertResult('initial_read_verified',1),state,{...options,deliveryEnabled:true,send:async(r,id,o)=>{if(id===attemptedId)eq(o.reconcileOnly,true);return {delivered:true};}})).state;
    eq(state.event.result.code,'recovered');eq(state.event.status,'confirmed');
    assert.throws(()=>R.validateState({...state,contract:'client_continuity'},pins));passed++;
    const alert=D.payloadFor(I.alertResult('false_empty'),randomUUID(),true,I.CONTRACT);
    eq(alert.type,'samples_initial_card_list_DRILL');eq(alert.issue_identifier.includes('INITIAL_READ_ONLY'),true);eq(alert.issue_identifier.includes('FULL_JOURNEY_UNPROVEN'),true);
    assert.throws(()=>D.payloadFor(p,randomUUID()));passed++;
    let network=0;const fetchImpl=async()=>{network++;throw Error('synthetic_refusal');};
    await assert.rejects(D.deliver(I.alertResult('false_empty'),randomUUID(),{}, {},fetchImpl,{contract:I.CONTRACT}));passed++;eq(network,0);
    // Same proven delivery adapter, explicit new namespace. Primary failure
    // falls back once; fake direct bot validates recipient and persisted text.
    const env={PRIMARY_URL:'https://relay.invalid/hook',PRIMARY_ORIGIN:'https://relay.invalid',PRIMARY_KEY:'synthetic',BOT_TOKEN:'synthetic',BOT_DM:'synthetic-dm',BOT_USER:'synthetic-bot',OWNER_USER:'synthetic-owner',BOT_TEAM:'synthetic-team'};
    const delivery={enabled:true,activation:'OWNER_APPROVED_CONTINUITY_DELIVERY',recipientConfirmed:true,primary:{kind:'relay',webhookEnv:'PRIMARY_URL',baseUrlEnv:'PRIMARY_ORIGIN',apiKeyEnv:'PRIMARY_KEY'},fallback:{kind:'syncviewbot',tokenEnv:'BOT_TOKEN',dmEnv:'BOT_DM',botUserEnv:'BOT_USER',ownerUserEnv:'OWNER_USER',teamEnv:'BOT_TEAM'}};
    let posts=0,text;
    const fake=async(url,init)=>{
      if(new URL(url).host==='relay.invalid')throw Error('synthetic_primary_down');
      const method=new URL(url).pathname.split('/').pop();let value;
      if(method==='auth.test')value={ok:true,user_id:env.BOT_USER,team_id:env.BOT_TEAM};
      else if(method==='conversations.info')value={ok:true,channel:{id:env.BOT_DM,is_im:true,user:env.OWNER_USER}};
      else if(method==='chat.postMessage'){posts++;text=JSON.parse(init.body).text;value={ok:true,channel:env.BOT_DM,ts:'1.0'};}
      else if(method==='conversations.history')value={ok:true,messages:[{user:env.BOT_USER,ts:'1.0',text}]};
      else throw Error('synthetic_unknown_route');
      return {ok:true,json:async()=>value};
    };
    const delivered=await D.deliver(I.alertResult('false_empty'),randomUUID(),delivery,env,fake,{contract:I.CONTRACT,drill:true});
    eq(delivered.primaryDelivered,false);eq(delivered.fallbackDelivered,true);eq(posts,1);eq(text.includes('INITIAL_READ_ONLY'),true);eq(delivered.independentFallbackProven,false);
    fs.writeFileSync(path.join(temp,'disabled.json'),JSON.stringify({contract:I.CONTRACT,viewEnabled:false}));
    assert.throws(()=>R.config(path.join(temp,'disabled.json'),{},R.ACTIVATION,'view'));passed++;
    await assert.rejects(R.main([]));passed++;
    const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto'),root=path.resolve(__dirname,'..');
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const c={...JSON.parse(fs.readFileSync(path.join(root,'docs/ops/samples-initial-read.example.json'),'utf8')),
      viewEnabled:true,releaseSha:head,pageSourceSha:head,pageSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),
      expectedSdkSha256:'a'.repeat(64),activatedAt:now-2000,censusAuthorityConfirmed:true,censusReadOnlyRoleConfirmed:true,
      canary:{approvalId:randomUUID(),ownerApproved:true,ownerDesignatedTestScope:true,approvedAt:now-1000,expiresAt:now+60000}};
    const refs={SAMPLES_INITIAL_OUTPUT:temp,SAMPLES_INITIAL_BACKEND:'https://backend.invalid',SAMPLES_INITIAL_READER_FALLBACK:'https://fallback.invalid',SAMPLES_INITIAL_CENSUS_READ_KEY:'synthetic',SAMPLES_INITIAL_READ_ORIGINS_JSON:'[]',SAMPLES_INITIAL_LINK:'https://fixture.invalid/?c=synthetic&t=synthetic&v=samples',SAMPLES_INITIAL_SCOPE:'synthetic',SAMPLES_INITIAL_CANARY_IDS_JSON:'["synthetic-card"]',SAMPLES_INITIAL_CANARY_TITLES_JSON:'{"synthetic-card":"Synthetic approved card"}'};
    const file=path.join(temp,'config.json'),write=v=>fs.writeFileSync(file,JSON.stringify(v));write(c);
    eq(R.config(file,refs,R.ACTIVATION,'view',now).lane.requiredVisibleIds,['synthetic-card']);
    for(const patch of [{viewEnabled:false},{censusAuthorityConfirmed:false},{censusReadOnlyRoleConfirmed:false},{releaseSha:'f'.repeat(40)},
      {expectedSdkSha256:'bad'},{canary:{...c.canary,expiresAt:now}},
      {canary:{...c.canary,ownerDesignatedTestScope:false}},{canary:{...c.canary,ownerApproved:false}},{canary:{...c.canary,approvalId:'bad'}}]) {
      write({...c,...patch});assert.throws(()=>R.config(file,refs,R.ACTIVATION,'view',now));passed++;
    }
    write(c);assert.throws(()=>R.config(file,{...refs,SAMPLES_INITIAL_CANARY_IDS_JSON:'[]'},R.ACTIVATION,'view',now));passed++;
    assert.throws(()=>R.config(file,{...refs,SAMPLES_INITIAL_CANARY_TITLES_JSON:'{}'},R.ACTIVATION,'view',now));passed++;
    assert.throws(()=>R.config(file,refs,'not-approved','view',now));passed++;
    write({...c,canary:{...c.canary,expiresAt:now+86400001}});eq(R.config(file,refs,R.ACTIVATION,'view',now).pins.approvalExpiresAt,now+86400001);
    write({...c,canary:{...c.canary,expiresAt:null}});eq(R.config(file,refs,R.ACTIVATION,'view',now).pins.approvalExpiresAt,null);
    // Actual launcher, synthetic capture: lock spans browser close AND terminal
    // persistence. A competing owner cannot acquire at either boundary.
    const persist=require('../scripts/client-continuity-run').persist;
    const assertExclusive=()=>{assert.throws(()=>R.acquireLock(temp),{code:'EEXIST'});passed++;};
    const completed=await R.main(['view','--config',file,'--activate',R.ACTIVATION],refs,{
      launch:async()=>({close:async()=>assertExclusive()}),capture:async()=>p,
      persist:(directory,name,value)=>{assertExclusive();persist(directory,name,value);assertExclusive();}});
    eq(completed.code,'initial_read_verified');eq(fs.existsSync(path.join(temp,'samples-initial.lock')),false);
    const release=R.acquireLock(temp),lock=path.join(temp,'samples-initial.lock');
    fs.unlinkSync(lock);const releaseOther=R.acquireLock(temp),other=fs.readFileSync(lock,'utf8');
    assert.throws(release);passed++;eq(fs.readFileSync(lock,'utf8'),other);releaseOther();eq(fs.existsSync(lock),false);
    // Future persistent-host crash: use the real lock owner in a child. No
    // browser, network, scheduler or live configuration is involved. Killing
    // that exact child proves why human quiescence/quarantine is required.
    const crash=fs.mkdtempSync(path.join(temp,'crash-'));
    const orphan={...start,runId:randomUUID()};
    const orphanName=`samples-initial-${orphan.runId}.start.json`;
    const childSource=`const R=require(${JSON.stringify(require.resolve('../scripts/samples-initial-read-run'))});
      const {persist}=require(${JSON.stringify(require.resolve('../scripts/client-continuity-run'))});
      R.acquireLock(${JSON.stringify(crash)});persist(${JSON.stringify(crash)},${JSON.stringify(orphanName)},${JSON.stringify(orphan)});
      process.send('locked');setInterval(()=>{},1000);`;
    const child=require('node:child_process').spawn(process.execPath,['-e',childSource],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
    const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    let childError='';child.stderr.on('data',v=>{childError+=v;});
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('synthetic_lock_child_timeout')),5000);
        child.once('message',message=>{clearTimeout(timer);message==='locked'?resolve():reject(Error('synthetic_lock_child_protocol'));});
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',()=>{clearTimeout(timer);reject(Error('synthetic_lock_child_early_exit'));});
      });
      const crashLock=path.join(crash,'samples-initial.lock'),token=fs.readFileSync(crashLock,'utf8');
      assert.throws(()=>R.acquireLock(crash),{code:'EEXIST'});passed++;
      child.kill('SIGKILL');await exited;eq(childError,'');
      eq(fs.readFileSync(crashLock,'utf8'),token);
      assert.throws(()=>R.acquireLock(crash),{code:'EEXIST'});passed++;
      const records=R.records(crash,pins,now);
      eq(R.evaluate(records,now-2000,now+120000).code,'terminal_missing');
      // Admissions are stopped and the exact sole child is confirmed exited.
      // Preserve the lock by renaming it, never deleting the run evidence.
      const quarantine=path.join(crash,'samples-initial.lock.quarantine-'+randomUUID());
      eq(fs.lstatSync(crashLock).isFile(),true);eq(fs.readFileSync(crashLock,'utf8'),token);eq(fs.existsSync(quarantine),false);
      fs.renameSync(crashLock,quarantine);
      const releaseNew=R.acquireLock(crash);releaseNew();
      eq(fs.readFileSync(quarantine,'utf8'),token);eq(fs.existsSync(path.join(crash,orphanName)),true);
      eq(R.evaluate(R.records(crash,pins,now),now-2000,now+120000).code,'terminal_missing');
    }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
  console.log(JSON.stringify({suite:'samples_initial_read',passed,live:false}));
}
if(require.main===module)main().catch(()=>{console.error('samples_initial_read_unit_failed');process.exitCode=1;});
module.exports={main,positive};
