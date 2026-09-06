const {spawn}=await import('node:child_process');
const {createHash}=await import('node:crypto');
const EDITOR_ONE='33333333-3333-4333-8333-333333333331';
const EDITOR_TWO='33333333-3333-4333-8333-333333333332';
const UNMAPPED='55555555-5555-4555-8555-555555555551';
const ROLE_WRONG='55555555-5555-4555-8555-555555555552';
const TEAM_WRONG='44444444-4444-4444-8444-444444444441';
function assignmentReset(){resetHooks();resetFaults();net.linear='down';net.requests.length=0;}
function assignmentNoProvider(){return !net.requests.some(r=>/api.linear.app|linear-outbound/.test(r.url));}
async function mode(mode,epoch=mode==='native'?'assignment-fixture-1':null){
  await sql("update public.syncview_runtime_flags set value="+j({video:{mode,epoch},graphics:{mode:'provider',epoch:null}})+" where key='native_assignment_epochs'");
}
async function eligibleFlag(value){
  await sql("delete from public.syncview_runtime_flags where key='production_assignee_eligibility'");
  if(value!==undefined)await sql("insert into public.syncview_runtime_flags(key,value) values('production_assignee_eligibility',"+j(value)+")");
}
async function row(id){return (await rows('select * from public.deliverables where id='+q(id)))[0];}
async function receipt(body){return (await rows("select * from public.mirror_outbox where dedup_key="+q('write-ui:assignee:deliverable:'+body.id+':'+body.request_id)))[0];}
async function op(id,assignee){const rid=requestId('production');return {operation:'assignee',surface:'production',entity:'deliverable',client_slug:'fixture-client',id,request_id:rid,source_edited_at:stamp(rid),assignee_id:assignee,expected_updated_at:(await row(id)).updated_at};}
async function state(){
  const tables=['deliverables','deliverable_events','mirror_outbox'];
  if(await count("select 1 from pg_tables where schemaname='public' and tablename='card_change_journal'"))tables.push('card_change_journal');
  const result={};
  for(const table of tables)result[table]=await rows('select * from public.'+table+' order by id');
  return JSON.stringify(result);
}
const options=id=>({action:'assignee_options',surface:'production',client_slug:'fixture-client',id});
let lockChild;
try {
  await sql(`insert into public.team_members(id,name,role,team,active) values
    ('${UNMAPPED}','Fixture Unmapped','editor','video',true),('${ROLE_WRONG}','Fixture Manager','smm','video',true)`);
  // Existing target is genuinely created through the unchanged native intake.
  await sql("update public.syncview_runtime_flags set value="+j({video:{enabled:true,epoch:'intake-fixture'},graphics:{enabled:false,epoch:null}})+" where key='native_intake_epochs'");
  assignmentReset(); const create=rootBody('video',requestId());create.items[0].assignee_id=EDITOR_ONE;
  const created=await post(create);
  ok('native-intake-control',created.status===201&&assignmentNoProvider(),{status:created.status});
  if(created.status!==201)throw Error('native target fixture unavailable');
  const target=(await rows('select id from public.deliverables where batch_id='+q(created.json.batch.id)))[0].id;
  // Exact pre-install compatibility: native intake flag cannot admit reassignment.
  assignmentReset();let before=await state();
  const blocked=await post(await op(target,EDITOR_TWO));
  ok('preinstall-provider-refusal-preserved',blocked.status===503&&blocked.json.error==='assignee_provider_unavailable'&&await state()===before,{status:blocked.status});
  assignmentReset();const pickerOld=await post(options(target));
  ok('preinstall-picker-provider-refusal-preserved',pickerOld.status===503&&pickerOld.json.error==='assignee_provider_unavailable');
  assignmentReset();const clearOld=await post(await op(target,null));
  ok('preinstall-clear-provider-read-free',clearOld.status===200&&(await row(target)).assignee_id===null&&assignmentNoProvider());
  // Missing RPC alone is never enough: a failed flag read must hold.
  assignmentReset();faults.selectFails=(table,filters)=>table==='syncview_runtime_flags'&&filters.some(f=>f.val==='native_assignment_epochs');
  const unavailable=await post(await op(target,null));
  ok('preinstall-flag-read-failure-held',unavailable.status===503&&unavailable.json.error==='authority_unavailable'&&assignmentNoProvider());
  assignmentReset();
  await sql(fs.readFileSync(path.join(ROOT,'migrations/2026-09-06-native-existing-assignment.sql'),'utf8'));
  before=await state();const installedProvider=await post(await op(target,EDITOR_ONE));
  ok('installed-default-provider-contract',installedProvider.status===503&&installedProvider.json.error==='assignee_provider_unavailable'&&await state()===before);
  await eligibleFlag({provider_mapping_required:false});
  assignmentReset();const providerBody=await op(target,EDITOR_ONE);const providerAccepted=await post(providerBody);
  const providerReceipt=await receipt(providerBody);
  ok('provider-retired-flag-original-pending-receipt',providerAccepted.status===200&&providerReceipt.status==='pending'&&!providerReceipt.payload._native_assignment_epoch);
  await eligibleFlag(undefined);
  await mode('native');assignmentReset();
  const picker=await post(options(target));
  ok('native-exact-card-picker-unmapped-visible',picker.status===200&&picker.json.complete===true&&picker.json.assignees.some(m=>m.id===UNMAPPED)&&!picker.json.assignees.some(m=>m.id===ROLE_WRONG||m.id===TEAM_WRONG)&&assignmentNoProvider());
  assignmentReset();faults.mutate=(table,result)=>table==='team_members'?{...result,count:result.count+1}:result;
  const incomplete=await post(options(target));
  ok('native-incomplete-picker-held',incomplete.status===503&&assignmentNoProvider());
  assignmentReset();faults.selectFails=table=>table==='team_members';
  const unreadable=await post(options(target));
  ok('native-unreadable-roster-held',unreadable.status>=400&&assignmentNoProvider());
  assignmentReset();const body=await op(target,UNMAPPED);const assigned=await post(body);
  const nativeReceipt=await receipt(body);
  ok('native-unmapped-assignment-terminal-one-receipt',assigned.status===200&&assigned.json.native_committed===true&&assigned.json.mirror_pending===false&&(await row(target)).assignee_id===UNMAPPED&&nativeReceipt.status==='skipped'&&nativeReceipt.linear_result.native_assignment===true&&assignmentNoProvider(),{status:assigned.status,error:assigned.json.error});
  if(assigned.status!==200)throw Error('native write fixture failed');
  for(const [label,assignee] of [['role',ROLE_WRONG],['team',TEAM_WRONG],['absent','66666666-6666-4666-8666-666666666666']]){
    assignmentReset();before=await state();const denied=await post(await op(target,assignee));
    ok('native-'+label+'-refused-zero-change',denied.status===403&&await state()===before&&assignmentNoProvider());
  }
  assignmentReset();before=await state();const conflict=await post({...body,assignee_id:EDITOR_ONE});
  ok('changed-original-assignee-conflicts',conflict.status===409&&conflict.json.error==='idempotency_conflict'&&await state()===before&&assignmentNoProvider());
  const wrongActor=await post(body,SMM);
  ok('different-author-cannot-adopt-receipt',wrongActor.status>=400&&await state()===before&&assignmentNoProvider());
  // Native replay is accepted history, not an automatic repeat of its assignment.
  assignmentReset();const second=await post(await op(target,EDITOR_TWO));
  ok('later-human-assignment-canary',second.status===200&&(await row(target)).assignee_id===EDITOR_TWO);
  await sql('update public.team_members set active=false where id='+q(UNMAPPED));
  for(const [label,lane,epoch] of [['hold','hold',null],['changed-epoch','native','assignment-fixture-2'],['provider-restored','provider',null]]){
    await mode(lane,epoch);assignmentReset();before=await state();const replay=await post(body);
    ok('accepted-native-replay-'+label,replay.status===200&&replay.json.row.assignee_id===EDITOR_TWO&&await state()===before&&assignmentNoProvider());
  }
  await mode('hold');assignmentReset();before=await state();
  const held=await post(await op(target,null));
  ok('hold-blocks-new-clear-with-zero-change',held.status===503&&await state()===before&&assignmentNoProvider());
  await eligibleFlag({provider_mapping_required:false});
  assignmentReset();before=await state();const providerHeld=await post(providerBody);
  ok('hold-does-not-drain-old-provider-receipt',providerHeld.status===503&&await state()===before&&assignmentNoProvider());
  await mode('provider');assignmentReset();const providerReplay=await post(providerBody);
  ok('explicit-provider-mode-retains-original-receipt',providerReplay.status===200&&JSON.stringify(await receipt(providerBody))===JSON.stringify(providerReceipt));
  await eligibleFlag(undefined);await mode('native','assignment-fixture-3');
  assignmentReset();before=await state();
  const anonymous=await post(body,{});
  ok('unauthenticated-receipt-access-refused',anonymous.status>=400&&await state()===before&&assignmentNoProvider());
  const foreignScope=await runSql('select public.production_assignment_context('+j({entity:'deliverable',entity_id:target,operation:'assignee',client_slug:'fixture-split',team:'video',actor:'Fixture Admin',role:'admin',test_only:false,legacy_parity:false,dedup_key:nativeReceipt.dedup_key,intent_fingerprint:nativeReceipt.payload._intent_fingerprint})+');');
  ok('receipt-cannot-be-adopted-across-client-scope',foreignScope.status!==0&&await state()===before);
  for(const modeValue of [{video:{mode:'unexpected'}},{video:{mode:'native',epoch:null}}]){
    await sql("update public.syncview_runtime_flags set value="+j(modeValue)+" where key='native_assignment_epochs'");
    assignmentReset();const malformed=await post(await op(target,null));
    ok('malformed-capability-held-'+modeValue.video.mode,malformed.status===503&&await state()===before&&assignmentNoProvider());
  }
  await mode('native','assignment-fixture-3');
  await sql('update public.team_members set active=true where id='+q(UNMAPPED));
  assignmentReset();const clearBody=await op(target,null);const clear=await post(clearBody);
  ok('native-null-clear-terminal',clear.status===200&&(await row(target)).assignee_id===null&&(await receipt(clearBody)).status==='skipped'&&assignmentNoProvider());
  // Pause an old unmarked provider caller after validation but before its RPC.
  await mode('provider');await eligibleFlag({provider_mapping_required:false});assignmentReset();before=await state();
  hooks.beforeRpc=async name=>{if(name==='production_deliverable_write'){hooks.beforeRpc=null;await mode('native','assignment-fixture-4');}};
  const staleProvider=await post(await op(target,EDITOR_ONE));
  ok('late-provider-write-refused-after-native-install',staleProvider.status===503&&await state()===before&&assignmentNoProvider());
  await eligibleFlag(undefined);
  // Target eligibility is re-read under the committing SQL transaction.
  assignmentReset();before=await state();hooks.beforeRpc=async name=>{if(name==='production_assignee_write'){hooks.beforeRpc=null;await sql('update public.team_members set active=false where id='+q(EDITOR_ONE));}};
  const rosterChanged=await post(await op(target,EDITOR_ONE));
  ok('fresh-roster-change-refused-at-rpc',rosterChanged.status===403&&await state()===before&&assignmentNoProvider());
  await sql('update public.team_members set active=true where id='+q(EDITOR_ONE));
  assignmentReset();before=await state();hooks.beforeRpc=async name=>{if(name==='production_assignee_write'){hooks.beforeRpc=null;await mode('hold');}};
  const epochChanged=await post(await op(target,EDITOR_ONE));
  ok('fresh-epoch-change-refused-at-rpc',epochChanged.status===503&&await state()===before&&assignmentNoProvider());
  await mode('native','assignment-fixture-5');
  assignmentReset();before=await state();hooks.beforeRpc=async name=>{if(name==='production_assignee_write'){hooks.beforeRpc=null;await sql("update public.track_b_f27_team_fences set generation=generation+1 where team='video'");}};
  const fenceChanged=await post(await op(target,EDITOR_ONE));
  ok('f27-generation-change-refuses-before-terminalization',fenceChanged.status>=400&&await state()===before&&assignmentNoProvider());
  // Real committed lost response; exact explicit retry does not add a receipt.
  assignmentReset();const lostBody=await op(target,EDITOR_ONE);hooks.afterRpc=(name,args,result)=>{if(name==='production_assignee_write'){hooks.afterRpc=null;throw Error('fixture response lost');}return result;};
  const lost=await post(lostBody);before=await state();const lostReceipt=await receipt(lostBody);
  assignmentReset();const retried=await post(lostBody);
  ok('lost-response-replay-conserves-committed-state',lost.status>=400&&lostReceipt.status==='skipped'&&retried.status===200&&await state()===before&&assignmentNoProvider());
  // Entity lookup happens before a racing winner; replay must return fresh state.
  assignmentReset();const racingBody=await op(target,EDITOR_TWO);let winner;
  hooks.beforeRpc=async name=>{if(name==='production_assignment_context'){hooks.beforeRpc=null;winner=await post(racingBody);}};
  const racingReplay=await post(racingBody);
  ok('racing-replay-returns-postwinner-row',winner?.status===200&&racingReplay.status===200&&racingReplay.json.row.assignee_id===EDITOR_TWO&&assignmentNoProvider());
  // Two real SQL sessions both wait on the same dedup advisory lock, proving
  // overlapping requests rather than merely calling Promise.all.
  assignmentReset();const same=await op(target,UNMAPPED);const dedup='write-ui:assignee:deliverable:'+target+':'+same.request_id;
  lockChild=spawn(process.env.NIR_PSQL,['-X','-q','-t','-A','-h',process.env.NIR_PGHOST,'-p',process.env.NIR_PGPORT,'-U',process.env.NIR_PGUSER,'-d',process.env.NIR_PGDATABASE],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('lock fixture timeout')),10000);lockChild.stdout.on('data',b=>{out+=b;if(out.includes('LOCK_READY')){clearTimeout(timer);resolve();}});lockChild.stdin.write('begin;select pg_advisory_xact_lock(hashtextextended('+q(dedup)+",0));select 'LOCK_READY';\n");});
  const pending=Promise.all([post(same),post(same)]);let waiting=0;
  for(let i=0;i<100;i++){waiting=await count("select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory' and query like '%production_assignee_write%'");if(waiting>=2)break;await new Promise(r=>setTimeout(r,30));}
  lockChild.stdin.end('commit;\n\\q\n');await new Promise(resolve=>lockChild.on('close',resolve));lockChild=null;
  const concurrent=await pending;
  ok('concurrent-sql-retry-one-terminal-receipt',waiting>=2&&concurrent.every(r=>r.status===200)&&await count('select 1 from public.mirror_outbox where dedup_key='+q(dedup))===1&&assignmentNoProvider(),{blocked_sql_sessions:waiting,statuses:concurrent.map(r=>r.status)});
  // Install the REAL journal after correcting only fixture owner keys. This
  // fixture is not a full live schema reconstruction or backup rehearsal.
  await sql('alter table public.calendar_posts drop constraint calendar_posts_pkey;alter table public.calendar_posts add primary key(client,id);alter table public.sample_reviews drop constraint sample_reviews_pkey;alter table public.sample_reviews add primary key(client,id);');
  await sql(fs.readFileSync(path.join(ROOT,'migrations/2026-07-19-workload-plan.sql'),'utf8'));
  await sql(fs.readFileSync(path.join(ROOT,'migrations/2026-09-05-card-change-journal.sql'),'utf8'));
  assignmentReset();const journalWrite=await post(await op(target,EDITOR_ONE));
  ok('real-journal-native-assignment-capture',journalWrite.status===200&&await count("select 1 from public.card_change_journal where relation_name='deliverables'")===1&&assignmentNoProvider());
  assignmentReset();let serviceCommit=false;
  hooks.beforeRpc=async(name,args)=>{if(name==='production_assignee_write'){
    hooks.beforeRpc=null;
    const service=await runSql('begin;set local role service_role;select to_json(public.production_assignee_write('+j(args.p_row)+','+j(args.p_event)+'));commit;');
    serviceCommit=service.status===0;
  }};
  const serviceWrite=await post(await op(target,EDITOR_TWO));
  ok('actual-service-role-rpc-commit-and-gateway-replay',serviceCommit&&serviceWrite.status===200&&(await row(target)).assignee_id===EDITOR_TWO&&assignmentNoProvider());
  before=await state();
  for(const guest of ['anon','authenticated']){
    const denied=await runSql("begin;set local role "+guest+";select public.production_assignment_context('{}'::jsonb);rollback;");
    ok(guest+'-rpc-execution-denied',denied.status!==0&&/42501/.test(denied.stderr)&&await state()===before);
  }
  for(const owner of ['card_change_journal','mirror_outbox']){
    await sql("create function public.fixture_assignment_failure() returns trigger language plpgsql as $$begin raise exception 'fixture_assignment_failure';end;$$;create trigger fixture_assignment_failure before insert on public."+owner+' for each row execute function public.fixture_assignment_failure();');
    assignmentReset();before=await state();const failure=await post(await op(target,EDITOR_TWO));
    ok(owner+'-failure-rolls-back-row-event-receipt-journal',failure.status>=400&&await state()===before&&assignmentNoProvider());
    await sql('drop trigger fixture_assignment_failure on public.'+owner+';drop function public.fixture_assignment_failure();');
  }
  before=await state();
  const nativeId=(await receipt(body)).id;
  for(const statement of ["update public.mirror_outbox set status='pending' where id="+nativeId,'delete from public.mirror_outbox where id='+nativeId,'truncate public.mirror_outbox']){
    const refused=await runSql(statement);
    ok('receipt-retained-'+statement.split(' ')[0],refused.status!==0&&await state()===before);
  }
  const outbound=fs.readFileSync(path.join(ROOT,'supabase/functions/linear-outbound/index.ts'),'utf8');
  const max=/const MAX_ATTEMPTS = (\d+);/.exec(outbound);
  if(!max)throw Error('actual drainer constant seam drift');
  const selectorFile=path.join(scratch,'actual-drainer-selector.ts');
  fs.writeFileSync(selectorFile,'type SupabaseClient=any;type OutboxRow=any;\nconst MAX_ATTEMPTS='+max[1]+';\n'+extractFunction(outbound,'clean')+'\n'+extractFunction(outbound,'isUnsendableRow')+'\nexport async '+extractFunction(outbound,'readRows'));
  const selector=await import(pathToFileURL(selectorFile).href);
  const {createClient}=await import(shimUrl);
  const backlog=await selector.readRows(createClient(),'live',5000,'',true,'',false,false);
  ok('actual-normal-drainer-selector-excludes-native-receipts',backlog.some(r=>r.id===providerReceipt.id)&&!backlog.some(r=>r.payload?._native_assignment_epoch));
  const targeted=await selector.readRows(createClient(),'live',1,'',true,nativeReceipt.dedup_key,true,false);
  ok('actual-targeted-drainer-selector-excludes-native-receipt',targeted.length===0);
  // F27 emergency replay deliberately selects skipped receipts under its own
  // operator-classified protocol. This slice neither invokes nor retires it.
  const report={suite:'native-existing-assignment',passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,
    journey_sha256:assignmentJourneySha,
    checks:checks.map(c=>({id:c.id,pass:c.pass,evidence:c.evidence})),classification:'ACTUAL_HANDLER_DISPOSABLE_SQL_SYNTHETIC_TRANSPORT',
    source_sha256:createHash('sha256').update(fs.readFileSync(INDEX_TS)).digest('hex'),migration_sha256:createHash('sha256').update(fs.readFileSync(path.join(ROOT,'migrations/2026-09-06-native-existing-assignment.sql'))).digest('hex')};
  console.log('EXISTING_ASSIGNMENT_RESULT '+JSON.stringify(report));
  if(report.failed)process.exitCode=1;
}finally{if(lockChild)lockChild.stdin.end('rollback;\n\\q\n');fs.rmSync(scratch,{recursive:true,force:true});}
