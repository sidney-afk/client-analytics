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
/* Slice a top-level `const NAME = ...;` by balancing brackets to its terminator.
   These tables are data, not functions, so extractFunction cannot reach them. */
function constSrc(name){
 const at=html.indexOf('const '+name+' ');
 if(at<0)throw Error('const seam drift: '+name);
 let depth=0;
 for(let i=at;i<html.length;i++){
  const c=html[i];
  if(c==='('||c==='['||c==='{')depth++;
  else if(c===')'||c===']'||c==='}')depth--;
  else if(c===';'&&depth===0)return html.slice(at,i+1);
 }
 throw Error('unterminated const: '+name);
}
/* The transitive closure of wlApplyData, computed rather than listed, so a new
   dependency cannot silently fall back to a stub. */
function closureOf(root){
 const seen=[],pending=[root];
 while(pending.length){
  const name=pending.shift();
  if(seen.includes(name))continue;
  let src;
  try{src=extract(html,name);}catch(e){continue;}
  seen.push(name);
  for(const m of new Set(src.match(/\b(wl[A-Z]\w*|_wl[A-Za-z]\w*)\s*\(/g)||[]))
   pending.push(m.replace(/\s*\($/,''));
 }
 return seen.map(n=>extract(html,n)).join('\n');
}
const WL_CONSTS=['WL_PARKED_STATUSES','WL_WORKLOAD_TIME_ZONE','WL_PLACEMENT_WALK_LIMIT',
 'WL_INACTIVE_EDITORS','WL_ALLOWED_EDITORS','WL_ALLOWED_GRAPHICS',
 'WL_CLIENT_NAMES','WL_CLIENT_CANONICAL'].map(constSrc).join('\n');
const WL_BUCKETER=closureOf('wlApplyData');
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
 // wlIsActiveStatus is NOT here: it is compiled from source below, with its
 // WL_PARKED_STATUSES and wlNormStatus dependencies. The hand-written lambda
 // that used to sit on this line modelled three terminal types and missed
 // `triage`, `backlog` and every parked status NAME -- so a cached fallback of a
 // single backlog or parked row bucketed here and rendered nothing in reality
 // (Codex round 9, the same defect as round 8 one level down).
 wlFetchForeignLinearMetadata:async()=>{throw Error('unexpected provider read');},
 _syncviewStaffIdentityClear:()=>{context.identity=null;},wlPurgePlanSensitiveState:()=>{state.planByIssueId.clear();},
 // NO wlApplyData STUB. The real one is compiled below and overwrites anything
 // put here; three rounds of Codex findings were all a model of it admitting
 // rows the shipped code drops.
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
 // THE REAL BUCKETER, not a model of it. Codex rounds 8, 9 and 10 were three
 // successive failures of the same shape: a stub admitted rows the shipped
 // wlApplyData drops, so `boardShown` assertions passed against boards that do
 // not exist. Each round I patched one predicate and left the rest modelled,
 // and each round the next gap was found in the patch. The closure turns out to
 // be self-contained -- 29 functions and a handful of const tables, every
 // dependency resolvable from source -- so it is compiled and executed whole,
 // and the modelling stops.
 vm.runInContext(WL_CONSTS+'\n'+WL_BUCKETER,context);
 ['_wlV2MapRow','wlIssueClientAllowed','wlIssueEditorAllowed','wlSnapshotIdentity','wlProductionAuthorityValue',
 'wlProductionAuthorityFingerprint','wlMetadataTeamBucket','wlNativeWorkloadLabel','wlNativeDueDate','wlValidRfc3339Timestamp','wlNativeMetadataRow',
 'wlFetchNativeSnapshot','loadLinearIssues','wlAdoptPlanRows','wlLoadSnapshot','wlRefetchSilent','wlIsFresh',
 'wlExcludedSummaryText','wlVisibleSubCount','wlDroppedPlanWarningText','renderWorkloadPlanStatus','wlManualRefresh']
 .forEach(name=>vm.runInContext(extract(html,name),context));
 return {context,state,calls};
}
/* A cached row that the REAL admission predicates accept. The harness sets
   wlIsAllowedClient to false, so a legacy-shaped row is refused -- which is
   exactly how the round-7 fixture ({id, isSubIssue:true}) passed a capacity
   assertion the shipped bucketer would never have reached. A native row carries
   its membership on the row itself. */
/* A cached row the REAL wlApplyData renders. Every field here is load-bearing:
   drop the assignee or the date and the shipped bucketer moves it to
   excluded.noAssigneeNoDate, which is how the round-10 fixture claimed a
   capacity warning for a board showing nothing. */
const CACHED_ROW={id:'warm',isSubIssue:true,workloadSource:'native',
 nativeClientActive:true,nativeAssigneeEligible:true,assigneeId:'member-fixture',
 assigneeName:'Fixture Editor',clientName:'Fixture',teamKey:'VID',teamName:'Video',
 statusType:'unstarted',status:'Todo',dueDate:'2030-01-10'};
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
 // A CLEARED day that later drifts is not a LOST day. Codex round 6. The
 // mismatch check ran regardless of plan_date, so a row somebody deliberately
 // cleared -- card already on automatic placement, correctly -- was counted as
 // dropped and the board warned, permanently, that a saved work day was missing
 // when none existed. A standing false warning is how a true one stops being
 // read, which would undo the point of surfacing this at all.
 {const cleared=copy(raw);cleared.plans[0].plan_date=null;cleared.plans[0].client='other';
  const out=projectNativeSnapshot(cleared,s=>s.toLowerCase());
  ok(out.plans_dropped===0,'a drifted row with no work day on it is not counted as a dropped work day');
  ok(!out.plans.some(p=>p.storage_issue_id===cleared.plans[0].issue_id),
   'but it is still not projected onto its owner -- the safety property does not depend on plan_date');
  const mixed=copy(raw);mixed.plans[0].client='other';
  mixed.plans.push({issue_id:'del_fixture_cleared',client:'other',plan_date:null});
  mixed.rows.push({...copy(mixed.rows[1]),id:'del_fixture_cleared',linear_id:'old-cleared',
   native_metadata:{...copy(mixed.rows[1].native_metadata),id:'del_fixture_cleared'}});
  mixed.count=3;
  ok(projectNativeSnapshot(mixed,s=>s.toLowerCase()).plans_dropped===1,
   'a real lost day beside a cleared one counts exactly the real one');}
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
 // The bucketing stub admits a row on exactly these two predicates plus
 // isSubIssue. If wlApplyData ever gates on something else, the stub is lying
 // again and this goes red rather than the assertions quietly passing.
 {const apply=extract(html,'wlApplyData');
  ok(/wlIsActiveStatus\(/.test(apply)&&/wlIssueClientAllowed\(/.test(apply),
   'harness fidelity: the shipped bucketer still admits rows on active status and client membership');
  // Driven through the REAL wlApplyData. `live()` is a row the shipped bucketer
  // will actually render: a sub-issue, active, client-allowed, with an eligible
  // assignee and a date. Codex round 10: the previous fixture had neither an
  // assignee nor a date, so the real bucketer would have put it in
  // excluded.noAssigneeNoDate while the harness claimed it was planned.
  const live=(id,extra)=>({id,isSubIssue:true,workloadSource:'native',
   nativeClientActive:true,nativeAssigneeEligible:true,assigneeId:'member-fixture',
   assigneeName:'Fixture Editor',clientName:'Fixture',teamKey:'VID',teamName:'Video',
   statusType:'unstarted',status:'Todo',dueDate:'2030-01-10',...extra});
  const probe=browser();
  probe.context.wlApplyData([
   live('a'),
   live('b',{nativeClientActive:false}),
   live('c',{statusType:'completed'}),
   live('d',{isSubIssue:false}),
   {id:'e',isSubIssue:true,clientName:'Someone',assigneeId:'x',dueDate:'2030-01-10'},
   live('f',{statusType:'backlog'}),
   live('g',{statusType:'triage'}),
   live('h',{status:'For SMM approval'})],Date.now());
  const rendered=probe.context.wlVisibleSubCount();
  const bucketed=[...probe.state.planned,...probe.state.nowWorking,...probe.state.tweaksNeeded,
   ...probe.state.overdue,...probe.state.undated,...probe.state.unassigned].map(r=>r.id);
  ok(bucketed.join(',')==='a'&&rendered===1,
   'the REAL bucketer renders the live row and drops off-roster, completed, parent, legacy-unallowed, backlog, triage and parked rows');
  const excludedIds=[...(probe.state.excluded.noAssigneeNoDate||[]),
   ...(probe.state.excluded.offTeamAssignee||[])].map(r=>r.id);
  ok(!excludedIds.includes('a'),
   'and the live row is genuinely renderable, not merely admitted and then excluded -- the round-10 defect');}
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

  // 3c. NOTICES ABOUT THE BOARD SURVIVE A DEGRADED PLAN. Codex round 5. Both
  //     the metadata and exclusion notices were gated on planStatus==='ready',
  //     which couples them to a state they have nothing to do with: a warm board
  //     whose refresh just failed shows the SAME rows with the SAME exclusions
  //     and goes to 'stale', so the notice vanished exactly when the board got
  //     worse. Driven through the real failure path, not hand-set status.
  {const warm=browser();
   await warm.context.wlLoadSnapshot(false,null);
   warm.state.excluded={noAssigneeNoDate:['a','b'],offTeamAssignee:[]};
   warm.state.planned=[];warm.state.nowWorking=[];warm.state.tweaksNeeded=[];
   warm.state.overdue=[];warm.state.undated=[];warm.state.unassigned=[];
   ok(warm.state.issueSnapshot.length&&warm.state.planStatus==='ready','precondition: a warm, ready board with excluded rows');
   warm.context.renderWorkloadPlanStatus();
   ok(/not an empty board/.test(warm.context.planStatusEl.textContent),'precondition: it reports them while ready');
   // Now the next refresh rejects. wlLoadSnapshot retains issueSnapshot and
   // excluded, and moves planStatus to 'stale'.
   warm.context.fetch=async()=>{throw Error('offline');};
   await assert.rejects(warm.context.wlLoadSnapshot(false,null));checks++;
   ok(warm.state.planStatus==='stale'&&warm.state.issueSnapshot.length,'the retained board is still displayed after the failure');
   warm.context.renderWorkloadPlanStatus();
   ok(/not an empty board/.test(warm.context.planStatusEl.textContent),
    'a stale board still says it was already incomplete -- staff must not read missing work as absence');
   ok(/editing is paused/.test(warm.context.planStatusEl.textContent),
    'and still says editing is paused, so the two notices coexist');}

  // 3d. The cached cold-start board: issues render from cache but the workload
  //     map is empty, so 2x/3x work counts as 1x. planStatus and
  //     linearMetadataStatus are BOTH 'unknown', so the old ready-gate hid the
  //     one notice that says capacity is understated.
  {const cached=browser(async()=>{throw Error('offline');});
   // A cached board of RENDERABLE rows. A cache holding only batch parents or
   // completed rows displays nothing, and claiming its capacity is understated
   // would be a warning about an empty screen -- pinned separately below.
   await assert.rejects(cached.context.wlLoadSnapshot(false,{issues:[CACHED_ROW],fetchedAt:Date.now()}));checks++;
   ok(cached.state.issueSnapshot.length===1&&cached.state.linearMetadataStatus==='unknown',
    'precondition: a cached board is shown with no proven label metadata');
   cached.context.renderWorkloadPlanStatus();
   ok(/capacity may be understated/i.test(cached.context.planStatusEl.textContent),
    'a cached fallback board says its capacity is understated rather than presenting 1x weights as fact');}

  // 3e2. A cached board of rows that RENDER NOTHING must not warn about the
  //      capacity of a screen with nothing on it. Codex round 7: issueSnapshot
  //      carries batch parents and completed/parked rows that reach no bucket.
  {const parentsOnly=browser(async()=>{throw Error('offline');});
   await assert.rejects(parentsOnly.context.wlLoadSnapshot(false,
    {issues:[{...CACHED_ROW,id:'bat_only',isSubIssue:false}],fetchedAt:Date.now()}));checks++;
   ok(parentsOnly.state.issueSnapshot.length===1,'precondition: the snapshot is not empty');
   parentsOnly.context.renderWorkloadPlanStatus();
   ok(!/capacity may be understated/i.test(parentsOnly.context.planStatusEl.textContent),
    'a board whose only rows render nowhere does not claim its displayed capacity is understated');
   ok(/editing is disabled/.test(parentsOnly.context.planStatusEl.textContent),
    'while the plan-state notice, which is not about the board, still speaks');}

  // 3e3. An ALL-EXCLUDED board renders no rows and is exactly the board that
  //      most needs to say why, so it counts as shown.
  {const allExcluded=browser(async()=>{throw Error('offline');});
   await assert.rejects(allExcluded.context.wlLoadSnapshot(false,
    {issues:[{...CACHED_ROW,id:'bat_only',isSubIssue:false}],fetchedAt:Date.now()}));checks++;
   allExcluded.state.excluded={noAssigneeNoDate:['a','b'],offTeamAssignee:[]};
   allExcluded.context.renderWorkloadPlanStatus();
   ok(/not an empty board/.test(allExcluded.context.planStatusEl.textContent),
    'an all-excluded board still says it is not actually empty');
   ok(/capacity may be understated/i.test(allExcluded.context.planStatusEl.textContent),
    'and its unprovable labels are reported too, because rows exist to be understated');}

  // 3e. And none of that leaks into a first load with nothing painted yet.
  {const cold=browser(async()=>{throw Error('offline');});
   await assert.rejects(cold.context.wlLoadSnapshot(false,null));checks++;
   ok(cold.state.issueSnapshot.length===0,'precondition: nothing is painted');
   cold.context.renderWorkloadPlanStatus();
   ok(!/capacity may be understated/i.test(cold.context.planStatusEl.textContent)
    &&!/not an empty board/.test(cold.context.planStatusEl.textContent),
    'with no board on screen, notices ABOUT the board stay silent');
   ok(/editing is disabled/.test(cold.context.planStatusEl.textContent),
    'while the plan-state notice, which is not about the board, still speaks');}

  // 3f. End to end: a board whose only drift is a CLEARED day says nothing.
  {const clearedDrift=fixture();clearedDrift.plans[0].plan_date=null;clearedDrift.plans[0].client='other';
   const projectedCleared=projectNativeSnapshot(clearedDrift,s=>s.toLowerCase());
   ok(projectedCleared.plans_dropped===0,'precondition: the gateway counts nothing');
   const c=browser(projectedCleared);
   await c.context.wlLoadSnapshot(false,null);
   c.context.renderWorkloadPlanStatus();
   ok(!/saved work day/i.test(c.context.planStatusEl.textContent),
    'the board does not warn about a work day nobody lost');}

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
