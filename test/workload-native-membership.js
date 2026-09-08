'use strict';
// Actual source readers/adoption in an isolated JS realm. All transports are
// intercepted; these checks are not deployment, SQL or live membership proof.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const {extractFunction}=require('./helpers/extract-function');
const root=path.resolve(__dirname,'..'), html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const extract=(source,name)=>(source.includes('async function '+name+'(')?'async ':'')+extractFunction(source,name);
let checks=0;
function ok(value,message){assert.ok(value,message);checks++;}
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture(){return {ok:true,contract:'workload-native-snapshot-v1',complete:true,count:2,
 authority:{video:'syncview',graphics:'syncview'},legacy_teams:[],rows:[
 {id:'bat_fixture',source:'native',is_sub_issue:false,active:true,title:'Fixture batch'},
 {id:'del_fixture',linear_id:'old-fixture',source:'native',is_sub_issue:true,active:true,
 parent_id:'bat_fixture',client_slug:'fixture',client_name:'Fixture',team_key:'VID',team_name:'Video',
 status:'Todo',status_type:'unstarted',assignee_id:'member-fixture',native_client_active:true,
 native_assignee_eligible:true,native_metadata:{id:'del_fixture',client_slug:'fixture',team:'video',
 due_date:'2030-01-10',updated_at:'2030-01-01T00:00:00Z',workload_labels_complete:true,
 workload_labels:[{id:'weight',name:'3× Workload',color:'#123456'}]}}],
 plans:[{issue_id:'del_fixture',storage_issue_id:'old-fixture',client:'fixture',plan_date:'2030-01-08',updated_at:'2030-01-01T00:00:00Z'}]};}
function browser(response=fixture()) {
 const calls=[], state={issueSnapshot:[],planByIssueId:new Map(),planStatus:'unknown',planHasSnapshot:false,
 workloadByIssueId:new Map(),dueAuthorityByIssueId:new Map(),nativeDueTargetByIssueId:new Map(),linearMetadataStatus:'unknown'};
 const context={console,URL,Date,Map,Set,JSON,Promise,Error,AbortController,setTimeout,clearTimeout,
 WL_PLAN_READ_TIMEOUT_MS:500,WORKLOAD_PLAN_URL:'https://fixture.invalid/functions/v1/workload-plan',
 CAL_SUPABASE_URL:'https://fixture.invalid',_wlPlanSessionGeneration:1,_wlPlanWriteGeneration:0,_wlPlanLoadGeneration:0,
 _wlPlanWriteInFlight:new Map(),_wlDueWriteInFlight:new Map(),_wlPlanLastWriteGeneration:new Map(),
 _wlBackgroundRefreshPromise:null,_wlNativeDueReceiptRetryPromise:null,wlScheduleNativeDueReceiptRetry:()=>{},wlState:state,
 identity:{key:'fixture-key',role:'admin',member:{id:'fixture-member'}},
 _syncviewRequireStaffIdentity:async()=>{},_syncviewEfHeaders:h=>h,
 _syncviewStaffIdentityForHeaders:()=>context.identity,
 wlIsAllowedClient:()=>false,wlIsAllowedEditor:()=>false,
 wlIsActiveStatus:i=>!['completed','canceled','duplicate'].includes(i.statusType),
 wlFetchForeignLinearMetadata:async()=>{throw Error('unexpected provider read');},
 _syncviewStaffIdentityClear:()=>{context.identity=null;},wlPurgePlanSensitiveState:()=>{state.planByIssueId.clear();},
 wlApplyData:(issues,time)=>{state.issueSnapshot=issues;state.fetchedAt=time;},
 LINEAR_ISSUES_TTL_MS:5*60*1000,cacheWrites:[],
 wlAdoptLinearMetadata:(rows,issues,fetchedAt,options)=>{
  state.workloadByIssueId=new Map(rows.map(r=>[r.issue_id,r.workload]));state.linearMetadataStatus='ready';
  if(Array.isArray(issues)&&!(options&&options.skipIssueCacheWrite))context.cacheWrites.push({issues,fetchedAt});},
 wlBackgroundBusinessFingerprint:()=>JSON.stringify([state.issueSnapshot,state.planStatus]),
 wlPlanEditingEnabled:()=>state.planStatus==='ready',wlLinearEditingEnabled:()=>state.linearMetadataStatus==='ready',
 // A REAL status element and the REAL renderer. The two previous passes at the
 // dropped-plan warning both died between wlLoadSnapshot and the screen, and
 // both had a green check asserting wlState. A stubbed renderer is what made
 // that possible, so it is gone: every check in this file now runs the shipped
 // renderWorkloadPlanStatus against a real element it can be read out of.
 planStatusEl:{id:'wlPlanStatus',hidden:true,className:'',textContent:''},
 document:{querySelector:()=>({}),
  getElementById:id=>id==='wlPlanStatus'?context.planStatusEl:null},
 // Mirrors the shipped renderWorkloadAll, which calls renderWorkloadPlanStatus
 // unconditionally once past its popover-defer guard. Pinned in source below so
 // this stub cannot quietly stop being true.
 renderWorkloadAll:()=>{context.renders++;context.renderWorkloadPlanStatus();},renders:0,
 wlSpinnerOn:()=>{},wlSpinnerOff:()=>{},
 fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});if(typeof response==='function')return response(url,init);
 return {ok:true,status:200,json:async()=>copy(response)};}};
 vm.createContext(context);
 ['_wlV2MapRow','wlIssueClientAllowed','wlIssueEditorAllowed','wlSnapshotIdentity','wlProductionAuthorityValue',
 'wlProductionAuthorityFingerprint','wlMetadataTeamBucket','wlNativeWorkloadLabel','wlNativeDueDate','wlValidRfc3339Timestamp','wlNativeMetadataRow',
 'wlFetchNativeSnapshot','loadLinearIssues','wlAdoptPlanRows','wlLoadSnapshot','wlRefetchSilent','wlIsFresh',
 'wlExcludedSummaryText','wlVisibleSubCount','wlDroppedPlanWarningText','renderWorkloadPlanStatus','wlManualRefresh']
 .forEach(name=>vm.runInContext(extract(html,name),context));
 return {context,state,calls};
}
(async()=>{
 const {projectNativeSnapshot,legacyPlanAliases}=await import(pathToFileURL(path.join(root,'supabase/functions/workload-plan/native-snapshot.mjs')).href);
 const raw=fixture();raw.plans[0].issue_id='old-fixture';
 const projected=projectNativeSnapshot(raw,s=>s.toLowerCase());
 ok(projected.plans[0].issue_id==='del_fixture'&&projected.plans[0].storage_issue_id==='old-fixture','retained UUID projects onto canonical owner');
 ok(raw.plans[0].issue_id==='old-fixture','projection never rewrites stored input');
 ok(legacyPlanAliases(projected).map(p=>p.issue_id).sort().join(',')==='del_fixture,old-fixture','old bundle and native bundle both see one stored plan');
 const mutations=[v=>v.count++,v=>v.rows.push(v.rows[1]),v=>v.complete=false,v=>delete v.authority,
 v=>v.authority.video='linear',v=>delete v.rows[1].native_client_active,v=>v.rows[1].linear_id='bat_fixture',
 v=>v.plans.push({...v.plans[0],issue_id:'del_fixture'}),v=>v.plans[0].plan_date='bad',v=>delete v.legacy_teams];
 for(const mutate of mutations){const value=copy(raw);mutate(value);assert.throws(()=>projectNativeSnapshot(value,s=>s.toLowerCase()));checks++;}
 // A drifted plan client USED TO be in the throw list above, and that is the
 // defect this test now pins instead. On 2026-09-08 six real rows saved under a
 // retired client name blanked a 5,241-row board for every editor: raw due dates
 // everywhere, editing disabled. A mismatch must still never attach a saved work
 // day to another client's card, so the row is dropped -- but only that row.
 const drift=copy(raw);drift.plans[0].client='other';
 const drifted=projectNativeSnapshot(drift,s=>s.toLowerCase());
 ok(drifted.plans_dropped===1,'a drifted plan client drops exactly one plan');
 ok(!drifted.plans.some(p=>p.storage_issue_id===drift.plans[0].issue_id),'the drifted plan is not projected onto its owner');
 ok(drifted.rows.length===raw.rows.length,'every row still projects when a plan drifts');
 const many=copy(raw);many.plans.push({issue_id:'retired-drift',client:'nobody',plan_date:'2026-09-08'});
 many.plans[0].client='other';
 ok(projectNativeSnapshot(many,s=>s.toLowerCase()).plans_dropped===1,'an unowned plan is kept, not counted as dropped');
 ok(projectNativeSnapshot(copy(raw),s=>s.toLowerCase()).plans_dropped===0,'a clean snapshot drops nothing');
 const history=copy(raw);history.plans.push({issue_id:'retired-fixture',client:'fixture',plan_date:null});
 ok(projectNativeSnapshot(history,s=>s.toLowerCase()).plans.length===2,'completed/cleared history retained');
 for(const force of [false,true]){const b=browser();const result=await b.context.loadLinearIssues(force);
 ok(b.calls.length===1&&b.calls[0].body.action==='native_snapshot','normal and forced loads use one native snapshot');
 ok(result.issues[1].id==='del_fixture'&&result.issues[1].nativeId==='del_fixture'&&result.issues[1].url==='','native direct identity has no Linear link');
 ok(result.metadata[0].workload.weight===3&&result.metadata[0].native_target.id==='del_fixture','native complete weight and due target');
 ok(b.context.wlIssueClientAllowed(result.issues[1])&&b.context.wlIssueEditorAllowed(result.issues[1]),'native membership ignores obsolete name allowlists');}
 const b=browser();await b.context.wlLoadSnapshot(false,null);
 ok(b.state.planByIssueId.get('del_fixture')==='2030-01-08'&&b.state.planStatus==='ready','actual plan adoption retains historical pin');
 // ---- The dropped-plan warning REACHES A PERSON -----------------------------
 //
 // A dropped plan is a work day somebody DRAGGED and can no longer see: the card
 // silently reverts to automatic placement, so staff plan against the wrong day
 // believing it is current.
 //
 // This is the THIRD pass on one defect and both earlier ones shipped green:
 //   pass 1 counted the drop into a field nothing read;
 //   pass 2 wrote an explanatory sentence into wlState.backgroundError, which
 //          renderWorkloadPlanStatus replaces with the generic "could not check
 //          for newer changes" text for every string but one legacy sentinel,
 //          and which wlManualRefresh clears outright when legacyTeams is empty.
 // Both passes had a check asserting wlState held the right string. That check
 // is exactly what let this through twice, so it is NOT what is asserted here.
 //
 // Everything below drives the shipped composition end to end -- the gateway's
 // own projectNativeSnapshot, then the real wlLoadSnapshot, then the real
 // renderWorkloadPlanStatus -- and reads the RENDERED TEXT off the element.
 ok(/renderWorkloadPlanStatus\(\);/.test(extract(html,'renderWorkloadAll')),
  'harness fidelity: the shipped renderWorkloadAll really does call renderWorkloadPlanStatus');
 {const drift=fixture();drift.plans[0].client='other';
  const projectedDrift=projectNativeSnapshot(drift,s=>s.toLowerCase());
  ok(projectedDrift.plans_dropped===1&&projectedDrift.legacy_teams.length===0,
   'the fixture under test is the reported one: a drop, and NO legacy teams');
  const d=browser(projectedDrift);
  await d.context.wlLoadSnapshot(false,null);
  d.context.renderWorkloadPlanStatus();
  ok(/saved work day/i.test(d.context.planStatusEl.textContent),
   'a dropped plan is VISIBLE in the rendered status, not just held in state');
  ok(d.context.planStatusEl.hidden===false&&/is-warning/.test(d.context.planStatusEl.className),
   'the dropped-plan status is shown, and shown as a warning');
  ok(!/could not check for newer changes/.test(d.context.planStatusEl.textContent),
   'it is NOT replaced by the generic refresh-failure sentence -- the exact Codex finding');
  ok(d.state.issueSnapshot.length,'the dropped-plan warning never blanks the board');

  // 2. ACROSS A MANUAL REFRESH WITH legacyTeams EMPTY. wlManualRefresh clears
  //    backgroundError on exactly this condition, which is how pass 2's sentence
  //    vanished the moment a person pressed the refresh button they were told to
  //    press. The whole path runs: refresh -> load -> renderWorkloadAll -> render.
  const m=browser(projectedDrift);
  await m.context.wlManualRefresh();
  ok(m.context.renders>0,'the manual refresh really repainted (harness is not vacuous)');
  ok(/saved work day/i.test(m.context.planStatusEl.textContent),
   'a manual refresh with no legacy teams KEEPS the dropped-plan warning on screen');

  // 3. A refresh failure on top of a drop must not swallow either sentence.
  const both=browser(projectedDrift);
  await both.context.wlLoadSnapshot(false,null);
  both.state.backgroundError='Workload could not refresh. Previously loaded work is shown; retry to update it.';
  both.context.renderWorkloadPlanStatus();
  ok(/saved work day/i.test(both.context.planStatusEl.textContent)
   &&/could not check for newer changes/.test(both.context.planStatusEl.textContent),
   'a stale board that is ALSO missing saved days says both things');

  // 3b. AND WITH EVERY OTHER NOTICE. Codex round 3, on the fix above: the
  //     branch chain returned on the first true notice, so a dropped plan
  //     silenced "capacity may be understated; due-date editing is paused" and
  //     "Nothing is shown here, but this is not an empty board". Those states
  //     are independent of a drifted plan client, and suppressing them makes
  //     the board read as MORE complete than it is -- the absence AGENTS.md
  //     calls the one failure a reader cannot debug or report. Precedence is
  //     now ordering, not suppression.
  const withMeta=browser(projectedDrift);
  await withMeta.context.wlLoadSnapshot(false,null);
  withMeta.state.planStatus='ready';
  withMeta.state.linearMetadataStatus='stale';
  withMeta.state.linearMetadataWithheldOnly=0;
  withMeta.context.renderWorkloadPlanStatus();
  ok(/saved work day/i.test(withMeta.context.planStatusEl.textContent),
   'a dropped plan alongside unprovable labels still reports the dropped day');
  ok(/due-date editing is paused/.test(withMeta.context.planStatusEl.textContent),
   'and no longer silences the label failure -- capacity understatement is not made invisible by a drifted plan');

  const withWithheld=browser(projectedDrift);
  await withWithheld.context.wlLoadSnapshot(false,null);
  withWithheld.state.planStatus='ready';
  withWithheld.state.linearMetadataStatus='stale';
  withWithheld.state.linearMetadataWithheldOnly=2;
  withWithheld.context.renderWorkloadPlanStatus();
  ok(/2 items are missing their workload label/.test(withWithheld.context.planStatusEl.textContent)
   &&/saved work day/i.test(withWithheld.context.planStatusEl.textContent),
   'the withheld-only wording survives composition too, rather than being replaced by the read-failure sentence');

  const withExcluded=browser(projectedDrift);
  await withExcluded.context.wlLoadSnapshot(false,null);
  withExcluded.state.planStatus='ready';
  withExcluded.state.linearMetadataStatus='ready';
  withExcluded.state.excluded={noAssigneeNoDate:['a','b'],offTeamAssignee:[]};
  withExcluded.state.planned=[];withExcluded.state.nowWorking=[];withExcluded.state.tweaksNeeded=[];
  withExcluded.state.overdue=[];withExcluded.state.undated=[];withExcluded.state.unassigned=[];
  withExcluded.context.renderWorkloadPlanStatus();
  ok(/not an empty board/.test(withExcluded.context.planStatusEl.textContent),
   'an empty board with a dropped plan still says it is not actually empty -- the sentence a reader needs most');
  ok(/saved work day/i.test(withExcluded.context.planStatusEl.textContent),
   'and the dropped day is still named alongside it');
  ok(withExcluded.context.planStatusEl.textContent.indexOf('saved work day')
   < withExcluded.context.planStatusEl.textContent.indexOf('not an empty board'),
   'the completeness note keeps its LOWEST rank -- it speaks last, not first, and not never');

  // 4. And it clears when the snapshot is clean -- a warning that never goes
  //    away is the next way to make it unreadable.
  const clean=browser(projectNativeSnapshot(fixture(),s=>s.toLowerCase()));
  await clean.context.wlLoadSnapshot(false,null);
  clean.context.renderWorkloadPlanStatus();
  ok(!clean.state.backgroundError&&clean.state.nativePlansDropped===0,
   'a clean snapshot raises no dropped-plan warning');
  ok(!/saved work day/i.test(clean.context.planStatusEl.textContent),
   'and nothing about missing work days is rendered');
  // 5. THE COUNTERFACTUAL, against the actual pre-fix source. Same drift, same
  //    state, the renderer as it shipped at 996d61f5 -- and the sentence the
  //    board showed instead. This is the negative control for the whole block.
  const prefix=execFileSync('git',['show','996d61f5:index.html'],{cwd:root,encoding:'utf8',maxBuffer:8e6});
  const before={wlState:{backgroundError:null,planStatus:'ready',linearMetadataStatus:'ready',
   linearMetadataWithheldOnly:0,excluded:null},
   el:{hidden:true,className:'',textContent:''},Number,String};
  before.document={getElementById:()=>before.el};
  vm.createContext(before);
  ['wlExcludedSummaryText','wlVisibleSubCount','renderWorkloadPlanStatus']
   .forEach(name=>vm.runInContext(extract(prefix,name),before));
  const p2=browser(projectedDrift);
  await p2.context.wlLoadSnapshot(false,null);
  before.wlState.backgroundError='Some saved work days could not be shown because their client no longer matches the card. Those cards are placed automatically; check them before planning around them.';
  before.renderWorkloadPlanStatus();
  ok(/could not check for newer changes/.test(before.el.textContent)
   &&!/saved work day/i.test(before.el.textContent),
   'exact baseline negative control: the pre-fix renderer threw the explanation away and said "could not check for newer changes"');}
 b.context._wlPlanWriteGeneration=2;b.context._wlPlanLastWriteGeneration.set('del_fixture',2);b.state.planByIssueId.set('del_fixture','2030-01-09');
 b.context.wlAdoptPlanRows({rows:[],readGeneration:1});ok(b.state.planByIssueId.get('del_fixture')==='2030-01-09','late snapshot cannot erase newer saved pin');
 for(const mutate of [v=>v.count--,
 v=>delete v.rows[1].native_assignee_eligible,v=>v.authority.video='unknown']) {
 const value=fixture();mutate(value);const h=browser(value);h.state.issueSnapshot=[{id:'previous'}];h.state.planHasSnapshot=true;
 await assert.rejects(h.context.wlLoadSnapshot(true,null));checks++;
 ok(h.state.issueSnapshot[0].id==='previous'&&h.state.planStatus==='stale'&&h.state.backgroundError,'failed native read preserves visible old work and warns');
 ok(h.calls.length===1,'native failure never retries through a provider');
 // Codex round 4. wlLoadSnapshot's failure path sets backgroundError and
 // planStatus='stale' on adjacent lines, so the terminal stale sentence lived in
 // a branch that could never run in the one case it exists for. That is not
 // cosmetic: wlPlanEditingEnabled() requires 'ready', so editing really is off
 // and the generic freshness sentence never says so. Asserted through the real
 // renderer on the state the real failure path produced -- not a hand-set one.
 h.context.renderWorkloadPlanStatus();
 ok(/editing is paused/.test(h.context.planStatusEl.textContent),
  'a failed refresh SAYS that saved-work-day editing is paused, which is what actually happened');
 ok(/could not check for newer changes/.test(h.context.planStatusEl.textContent),
  'and still reports the failed refresh alongside it');}
 // The cold-start shape of the same thing: nothing was ever loaded, so the plan
 // is 'unknown' and editing is DISABLED rather than paused. Different sentence,
 // same suppression before this fix.
 {const cold=browser(async()=>{throw Error('offline');});
  await assert.rejects(cold.context.wlLoadSnapshot(true,null));checks++;
  ok(cold.state.planStatus==='unknown','precondition: no prior snapshot leaves the plan unknown');
  cold.context.renderWorkloadPlanStatus();
  ok(/editing is disabled/.test(cold.context.planStatusEl.textContent),
   'a cold failed load says editing is disabled, not merely that a refresh failed');}
 const fail=browser(async()=>{throw Error('offline');});fail.state.issueSnapshot=[{id:'previous'}];
 ok(await fail.context.wlRefetchSilent()===false&&fail.state.issueSnapshot[0].id==='previous','background refusal keeps prior board');
 let release;const late=browser(async()=>{await new Promise(r=>release=r);return {ok:true,status:200,json:async()=>fixture()};});
 const pending=late.context.loadLinearIssues(false);await new Promise(r=>setImmediate(r));late.context.identity={key:'other',role:'admin',member:{id:'other'}};release();
 await assert.rejects(pending,/session changed/);checks++;
 const fresh=browser();ok(await fresh.context.wlRefetchSilent()===true&&fresh.calls.length===1,'background refresh uses the same complete native snapshot');
 // The Tweak Needed popover reader (wlFetchTweakComments / wlRenderTweakComments)
 // is lane D's exclusive region, so its assertions are deliberately not carried
 // here -- they belong with the code. Lane D restores them; see OPEN_REPAIRS 169.

 // ---- A3, the release gate --------------------------------------------------
 // The exact shape of every deliverable created after the outbound flip: no
 // provider label state at all. It must appear on the board at weight 1x, and
 // it must NOT take the snapshot -- or anyone else's rows -- down with it.
 {
  const value=fixture();
  value.rows[1].linear_id=null;
  value.rows[1].native_metadata.workload_labels_complete=false;
  value.rows[1].native_metadata.workload_labels=[];
  value.plans=[];
  const h=browser(value);
  const result=await h.context.loadLinearIssues(false);
  ok(result.issues.length===2,'A3: a row with no provable label state does not reject the snapshot');
  ok(result.issues[1].id==='del_fixture','A3: the affected row still reaches the board');
  ok(!result.metadata.some(r=>r.issue_id==='del_fixture'),'A3: its unprovable weight is withheld, never downgraded silently');
  ok(result.metadata.partialFailure&&result.metadata.partialFailure.partitionFailed===false,
   'A3: withheld-only, so every other row stays fully editable');
  ok(result.metadata.partialFailure.nativeIssueIds.join(',')==='del_fixture',
   'A3: exactly the unprovable row is reported, by id');
 }
 {
  // Two rows, one unprovable: the provable one keeps its weight and due target.
  const value=fixture();
  value.count=3;
  const second=copy(value.rows[1]);
  second.id='del_fixture_two';second.linear_id=null;
  second.native_metadata={...copy(second.native_metadata),id:'del_fixture_two',
   workload_labels_complete:false,workload_labels:[]};
  value.rows.push(second);value.plans=[];
  const h=browser(value);
  const result=await h.context.loadLinearIssues(false);
  ok(result.issues.length===3,'A3: one unprovable row never blanks its siblings');
  ok(result.metadata.length===1&&result.metadata[0].issue_id==='del_fixture'
   &&result.metadata[0].workload.weight===3,'A3: the provable sibling keeps its full weight');
  ok(result.metadata.partialFailure.nativeIssueIds.join(',')==='del_fixture_two',
   'A3: only the unprovable sibling is withheld');
 }
 {
  // A malformed label relation is still refused -- A3 opens the ABSENT case only.
  const value=fixture();value.plans=[];
  value.rows[1].native_metadata.workload_labels_complete=true;
  value.rows[1].native_metadata.workload_labels=[{id:'weight',name:''}];
  const h=browser(value);
  const result=await h.context.loadLinearIssues(false);
  ok(result.metadata.partialFailure&&result.metadata.partialFailure.nativeIssueIds.join(',')==='del_fixture',
   'A3: a malformed label node is withheld, not accepted as complete');
 }
 // ---- A6, the cold-start net is wired at both ends ---------------------------
 {
  const warm=browser();await warm.context.wlLoadSnapshot(false,null);
  ok(warm.context.cacheWrites.length===1&&warm.context.cacheWrites[0].issues.length===2,
   'A6: a good native load writes the cold-start cache');
  const cold=browser(async()=>{throw Error('offline');});
  await assert.rejects(cold.context.wlLoadSnapshot(false,{issues:[{id:'warm'}],fetchedAt:Date.now()}));checks++;
  ok(cold.state.issueSnapshot[0].id==='warm','A6: a fresh cached board is shown when the first load fails');
  const stale=browser(async()=>{throw Error('offline');});
  await assert.rejects(stale.context.wlLoadSnapshot(false,{issues:[{id:'ancient'}],fetchedAt:1}));checks++;
  ok(stale.state.issueSnapshot.length===0,'A6: an out-of-TTL cached board is never presented as current');
 }
 const baseline=execFileSync('git',['show','99d31c815de3e1a46deeb01c45c09bf2937040ad:index.html'],{cwd:root,encoding:'utf8',maxBuffer:8e6});
 const baselineCalls=[];const old={wlReadCache:()=>null,_wlV2Ready:()=>true,LINEAR_ISSUES_WEBHOOK:'https://fixture.invalid/legacy',wlWriteCache:()=>{},Date,
 fetch:async url=>{baselineCalls.push(url);return {ok:true,json:async()=>({issues:[]})};}};
 vm.createContext(old);vm.runInContext(extract(baseline,'loadLinearIssues'),old);await old.loadLinearIssues(true);
 ok(baselineCalls[0].startsWith('https://fixture.invalid/legacy?t='),'exact baseline negative control: forced refresh enters provider transport');
 console.log(`PASS workload native membership: ${checks} focused checks; zero external calls. SQL and serving unproven in this lane.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
