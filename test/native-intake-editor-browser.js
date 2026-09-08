'use strict';
// Always-offline actual browser functions. No credential, network or SQL input.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {extractFunction}=require('./helpers/extract-function');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const base='69ae5d338486bd8084e6bbdbe65be1c44f63dbe1';
const oldHtml=execFileSync('git',['show',base+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const oldGateway=execFileSync('git',['show',base+':supabase/functions/production-write/index.ts'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
const gateway=fs.readFileSync(path.join(root,'supabase/functions/production-write/index.ts'),'utf8');
let checks=0;
function pass(label){checks++;console.log('ok '+label);}
assert.equal(extractFunction(html,'_calLegacyVideoEditorPool').replace('_calLegacyVideoEditorPool','_calNativeVideoEditorPool'),extractFunction(oldHtml,'_calNativeVideoEditorPool'));
pass('provider browser loader body remains exact');
for(const symbol of ['autoAssigneeForIntake','intakeAssigneePool','assertEligibleAssignee','handleCreateOptions']) {
 assert.equal(extractFunction(gateway,symbol),extractFunction(oldGateway,symbol));pass(symbol+' remains exact');
}
// Accepted native intake now adds routing metadata to its terminal response.
// Remove ONLY these exact additive bytes before pinning the entire historical
// handler. Authorization, intake/receipt creation and every old response field
// must still match; this does not waive arbitrary handler drift.
const currentIntake=extractFunction(gateway,'handleIntakeCreate');
const materializationBlock=`  // Browser routing metadata only. The epoch was resolved server-side from
  // the accepted manifest/receipt before any provider read; absent metadata
  // intentionally leaves existing provider-era browser jobs unchanged.
  const cardMaterialization = teamList.length > 0
    && currentResponseItems.length === plannedItems.length
    && teamList.every(team => !!clean(nativeEpochByTeam[team]))
    && currentResponseItems.every(item => !!clean(nativeEpochByTeam[normalizeTeam(item.team)]))
    ? { version: 1, native_epochs: Object.fromEntries(teamList.map(team => [team, nativeEpochByTeam[team]])) }
    : null;
`;
const materializationField='    ...(cardMaterialization ? { card_materialization: cardMaterialization } : {}),\n';
assert.equal(currentIntake.split(materializationBlock).length,2);
assert.equal(currentIntake.split(materializationField).length,2);
const legacyParameter='  requireNativeCompletion = false,\n';
const legacyGuard=`  // Server-owned legacy triage may NEVER fall back to provider preparation.
  // The existing epoch RPC binds prior acceptance and fails closed on drift.
  if (requireNativeCompletion && teamList.some(team => !nativeEpochByTeam[team])) {
    throw new GatewayError(409, "legacy_intake_native_epoch_required");
  }
`;
assert.equal(currentIntake.split(legacyParameter).length,2);
assert.equal(currentIntake.split(legacyGuard).length,2);
// The owner's merged post-naming release is an independently pinned change.
// Account for its exact three handler additions, retaining the whole-handler
// equality check around them rather than waiving unrelated intake drift.
const namingRelease='70715496a44e7120f0b819deafdb84cd62d78f9b';
const namedGateway=execFileSync('git',['show',namingRelease+':supabase/functions/production-write/index.ts'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
const namedIntake=extractFunction(namedGateway,'handleIntakeCreate');
function pinnedSlice(start,end){const a=namedIntake.indexOf(start),b=namedIntake.indexOf(end,a);assert(a>=0&&b>a);return namedIntake.slice(a,b);}
let intakeWithoutNaming=currentIntake;
for(const block of [pinnedSlice('    /* The optional post name','    if ((!appendToBatch'),pinnedSlice('  /*\n   * ONE NAME PER CARD','  const plannedItems: JsonMap[] = [];')]){
 assert.equal(intakeWithoutNaming.split(block).length,2);intakeWithoutNaming=intakeWithoutNaming.replace(block,'');
}
const titleBlock=pinnedSlice('    /*\n     * v8 (2026-09-07)','    const sourceBrief');
assert.equal(intakeWithoutNaming.split(titleBlock).length,2);
intakeWithoutNaming=intakeWithoutNaming.replace(titleBlock,'    const title = team === "graphics" ? `${intakeTitlePrefix}Thumbnail ${videoNumber}` : clean(item.title) || fallbackTitle;\n');
const namedIntent='["team", "title", "name", "brief", "videoNumber", "number", "status", "assignee_id", "due_date", "priority", "card_id", "sort_key"]';
assert.equal(intakeWithoutNaming.split(namedIntent).length,2);
intakeWithoutNaming=intakeWithoutNaming.replace(namedIntent,namedIntent.replace('"name", ',''));
assert.equal(intakeWithoutNaming.replace(materializationBlock,'').replace(materializationField,'')
 .replace(legacyParameter,'').replace(legacyGuard,''),extractFunction(oldGateway,'handleIntakeCreate'));
const intentSelector=currentIntake.slice(currentIntake.indexOf('  const intakeFields'),currentIntake.indexOf('  const rootManifest'))
 .replace('(input: JsonMap, keys: string[]): JsonMap','(input, keys)');
function selected(input){return JSON.parse(JSON.stringify(vm.runInNewContext(intentSelector+'\nintakeFields(input,keys)',{input,keys:JSON.parse(namedIntent)})));}
assert.deepEqual(selected({team:'video',name:'Launch',card_id:'card',credential:'secret'}),{team:'video',name:'Launch',card_id:'card'});
assert.deepEqual(selected({team:'video',card_id:'card'}),{team:'video',card_id:'card'});
pass('original native caller intent preserves a supplied post name, excludes credentials and leaves unnamed shape unchanged');
assert.ok(currentIntake.indexOf(legacyGuard)<currentIntake.indexOf('await projectForIntake('));
for(const [required,epochs,refused]of [[false,{},false],[true,{},true],[true,{video:'native'},false]]) {
 const invoke=()=>vm.runInNewContext(legacyGuard,{requireNativeCompletion:required,teamList:['video'],nativeEpochByTeam:epochs,
  GatewayError:class extends Error {constructor(status,code){super(code);this.status=status;}}});
 if(refused)assert.throws(invoke,error=>error.status===409&&error.message==='legacy_intake_native_epoch_required');else assert.doesNotThrow(invoke);
}
pass('intake remains exact around native routing metadata and the explicit native-only legacy completion guard');
const metadataSource=currentIntake.slice(currentIntake.indexOf(materializationBlock),currentIntake.indexOf(materializationBlock)+materializationBlock.length);
function metadata(teams,epochs,items,plannedCount=items.length) {
 return JSON.parse(JSON.stringify(vm.runInNewContext(metadataSource+'\n({'+materializationField+'})',{
  teamList:teams,nativeEpochByTeam:epochs,currentResponseItems:items,plannedItems:Array(plannedCount),
  clean:value=>String(value??'').trim(),normalizeTeam:value=>String(value??'').toLowerCase(),
 })));
}
for(const teams of [['video'],['graphics'],['video','graphics']]) {
 const epochs=Object.fromEntries(teams.map(team=>[team,'accepted-'+team]));
 assert.deepEqual(metadata(teams,epochs,teams.map(team=>({team}))),{card_materialization:{version:1,native_epochs:epochs}});
 pass('complete accepted '+teams.join('+')+' receipt emits its original routing epochs');
}
for(const [label,teams,epochs,items,count] of [
 ['no-team',[],{},[],0],['provider',['video'],{},[{team:'video'}],1],
 ['mixed-provider',['video','graphics'],{video:'accepted-video'},[{team:'video'},{team:'graphics'}],2],
 ['blank-epoch',['video'],{video:' '},[{team:'video'}],1],
 ['partial-items',['video'],{video:'accepted-video'},[],1],
 ['foreign-response-team',['video'],{video:'accepted-video'},[{team:'graphics'}],1],
]) {
 assert.deepEqual(metadata(teams,epochs,items,count),{});pass(label+' response cannot advertise native card transport');
}
// Existing-card options gained a separate capability after the intake picker.
// Keep its entire old authorization prefix and response contract pinned; only
// the reviewed capability lookup and eligible-roster provider are different.
const oldOptions=extractFunction(oldGateway,'handleAssigneeOptions');
const currentOptions=extractFunction(gateway,'handleAssigneeOptions');
const capabilityStart=currentOptions.indexOf('  const assignment = await existingAssignmentContext(');
const oldResponse=oldOptions.indexOf('  return json({');
const currentResponse=currentOptions.indexOf('  return json({');
assert.ok(capabilityStart>0 && currentResponse>capabilityStart && oldResponse>0);
assert.equal(currentOptions.slice(0,capabilityStart),oldOptions.slice(0,oldResponse));
assert.equal(currentOptions.slice(currentResponse).replace(
 'existingAssignmentOptions(supabase, team, clean(assignment.epoch))',
 'mappedCreateAssignees(supabase, team)'),oldOptions.slice(oldResponse));
pass('existing-card options preserve exact authorization and response around the separate assignment capability');
function world(result) {
 const context={console,Set,Number,JSON,Error,CAL_SUPABASE_URL:'https://synthetic.invalid',CAL_SUPABASE_ANON_KEY:'synthetic',
  _calNativePostState:{surface:'calendar',clientSlug:'synthetic-client'},actor:{key:'synthetic-key',role:'admin',member:{id:'synthetic-actor'}},
  rest:0,calls:[],reply:result};
 context._syncviewStaffIdentityForHeaders=()=>context.actor;
 context._nativePostViewSlug=()=>context._calNativePostState.clientSlug;
 context._syncviewEfHeaders=h=>h;
 context._calLegacyVideoEditorPool=async()=>{context.rest++;return [{id:'mapped',name:'Mapped',openCount:1}];};
 context.fetch=async(url,init)=>{context.calls.push(JSON.parse(init.body));if(context.hold)await context.hold;
  return {ok:context.httpOk!==false,status:context.httpStatus||(context.httpOk===false?503:200),json:async()=>context.reply};};
 vm.createContext(context);vm.runInContext('async '+extractFunction(html,'_calNativeVideoEditorPool'),context);return context;
}
const good={ok:true,complete:true,contract:'intake-editor-options-v1',surface:'calendar',client_slug:'synthetic-client',team:'video',lane:'native',editors:[{id:'unmapped',name:'Unmapped',openCount:0}]};
(async()=>{
 let c=world(good);assert.equal((await c._calNativeVideoEditorPool())[0].id,'unmapped');assert.equal(c.rest,0);pass('native minimal projection adopted without provider loader');
 c=world({...good,lane:'provider',editors:undefined});assert.equal((await c._calNativeVideoEditorPool())[0].id,'mapped');assert.equal(c.rest,1);pass('positive provider decision selects unchanged loader');
 for(const [label,result] of [
  ['null',null],['not-ok',{...good,ok:false}],['incomplete',{...good,complete:false}],['wrong-contract',{...good,contract:'old'}],
  ['wrong-surface',{...good,surface:'sxr'}],['wrong-client',{...good,client_slug:'other'}],['wrong-team',{...good,team:'graphics'}],
  ['unknown-lane',{...good,lane:'unknown'}],['empty',{...good,editors:[]}],['object',{...good,editors:{}}],
  ['duplicate',{...good,editors:[good.editors[0],good.editors[0]]}],['missing-id',{...good,editors:[{name:'Editor',openCount:0}]}],
  ['missing-name',{...good,editors:[{id:'id',openCount:0}]}],['bad-count',{...good,editors:[{id:'id',name:'Editor',openCount:-1}]}],
  ['missing-count',{...good,editors:[{id:'id',name:'Editor'}]}],['provider-roster',{...good,lane:'provider'}]]) {
  c=world(result);await assert.rejects(c._calNativeVideoEditorPool());assert.equal(c.rest,0);pass(label+' refuses without provider fallback');
 }
 c=world(good);c.httpOk=false;await assert.rejects(c._calNativeVideoEditorPool());assert.equal(c.rest,0);pass('failed HTTP refuses');
 // A 400 IS the provider lane. This browser ships to Pages on merge and the
 // gateway that answers this action ships later, so the deployed gateway
 // answers 400 unsupported_action for the whole window in between. Throwing
 // there would break the picker for every SMM until the Edge Function deploy;
 // no retry and no later state can turn a refused request SHAPE into an
 // answer. Every other non-200 still refuses rather than guessing a lane.
 c=world(good);c.httpOk=false;c.httpStatus=400;c.reply={ok:false,error:'unsupported_action'};
 assert.equal((await c._calNativeVideoEditorPool())[0].id,'mapped');assert.equal(c.rest,1);pass('400 from an older gateway degrades to the provider loader');
 for(const status of [401,403,404,409,500,502,503]) {
  c=world(good);c.httpOk=false;c.httpStatus=status;await assert.rejects(c._calNativeVideoEditorPool());assert.equal(c.rest,0);
  pass('HTTP '+status+' refuses rather than guessing the provider lane');
 }
 for(const change of ['dialog','surface','client','actor','key','role','actor-in-place','key-in-place','role-in-place']) {
  c=world(good);let release;c.hold=new Promise(resolve=>{release=resolve;});const pending=c._calNativeVideoEditorPool();
  if(change==='dialog')c._calNativePostState={...c._calNativePostState};
  else if(change==='surface')c._calNativePostState.surface='sxr';
  else if(change==='client')c._calNativePostState.clientSlug='other';
  else if(change==='actor')c.actor={...c.actor,member:{id:'other'}};
  else if(change==='actor-in-place')c.actor.member.id='other';
  else if(change==='key-in-place')c.actor.key='other';
  else if(change==='role-in-place')c.actor.role='other';
  else c.actor={...c.actor,[change]:'other'};
  release();await assert.rejects(pending);assert.equal(c.rest,0);pass('late '+change+' response withheld');
 }
 c=world(good);c.actor=null;await assert.rejects(c._calNativeVideoEditorPool());assert.equal(c.calls.length,0);pass('no local actor sends no roster request');
 c=world(good);c.actor.role='creative';await assert.rejects(c._calNativeVideoEditorPool());assert.equal(c.calls.length,0);pass('creative cannot invoke new browser projection');
 console.log(JSON.stringify({suite:'native-intake-editor-browser',checks,status:'PASS'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
