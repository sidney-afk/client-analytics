'use strict';
// Actual anonymous DOM actions; no evaluated product function or synthetic click
// dispatcher. Only the offline fixture entry point is currently executable.
const ACTIONS=['comment','approve','request_changes'];
function requireValue(ok){if(!ok)throw new Error('test_action_refused');}
const LIMITS=Object.freeze(['no_atomic_test_scope_version_fence','no_run_owned_row_cas',
  'no_request_quiescence_or_ambiguous_commit_receipt']);
function liveReadiness(){return {version:1,mode:'live',ready:false,code:'existing_writer_contract_insufficient',requirements:[...LIMITS]};}
async function driveAction(page,{rowId,action,text}) {
  requireValue(/^[A-Za-z0-9_-]{1,120}$/.test(rowId)&&ACTIONS.includes(action));
  const card=page.locator(`.cal-review-card[data-cal-review-pid="${rowId}"]`);
  await card.waitFor({state:'visible',timeout:10000});
  if(await card.locator('.cal-review-panel').count()===0)await card.locator('.kcard-strip').click();
  const panel=card.locator(`.cal-review-panel[data-comp="${action==='approve'?'video':'graphic'}"]`);
  await panel.waitFor({state:'visible',timeout:10000});
  if(action!=='approve') {
    requireValue(typeof text==='string'&&text.length>0&&text.length<=200);
    await panel.locator('.cal-review-textarea').fill(text);
  }
  await panel.locator(action==='approve'?'.cal-review-approve-btn':action==='comment'?'.cal-review-comment-btn':'.cal-review-tweak-btn').click({timeout:10000});
}
function persisted(row,{rowId,scope,action,text}) {
  requireValue(row?.id===rowId&&row.client===scope);
  if(action==='approve')return row.video_status==='Approved'&&!!row.client_video_approved_at;
  let comments=row.graphic_tweaks;if(typeof comments==='string')try{comments=JSON.parse(comments);}catch{return false;}
  return Array.isArray(comments)&&comments.filter(c=>!c.deleted&&c.body===text&&c.role==='client'&&c.audience==='client'&&c.is_tweak===(action==='request_changes')).length===1&&
    row.graphic_status===(action==='comment'?'Client Approval':'Tweaks Needed');
}
async function main(args=process.argv.slice(2)) {
  if(args.length!==1||args[0]!=='--fixture')return liveReadiness();
  return require('../qa/client-continuity-test-ui').run();
}
module.exports={driveAction,persisted,liveReadiness,main};
if(require.main===module)main().then(r=>{console.log(JSON.stringify(r));process.exitCode=r.ready?0:2;})
  .catch(()=>{console.error(JSON.stringify({version:1,code:'test_action_fixture_failed'}));process.exitCode=1;});
