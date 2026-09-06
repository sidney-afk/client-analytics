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
assert.equal(currentIntake.replace(materializationBlock,'').replace(materializationField,''),extractFunction(oldGateway,'handleIntakeCreate'));
pass('intake authorization, commits and original response remain exact around accepted native routing metadata');
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
 context.fetch=async(url,init)=>{context.calls.push(JSON.parse(init.body));if(context.hold)await context.hold;return {ok:context.httpOk!==false,json:async()=>context.reply};};
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
