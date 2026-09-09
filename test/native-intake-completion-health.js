'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const canonical=require('../scripts/native-intake-reconcile/reconcile-lib');
const completion=require('../scripts/native-intake-completion/completion-lib');
const { limits }=require('../scripts/native-intake-completion/monitor');
const { LANES }=require('../scripts/monitoring-watchdog');
const good={manifests:2,requests_complete:1,requests_owed:1,owed:{children_native:0,children_provider:0,cards:1,identity_conflicts:0,missing_terminal_receipts:0},backlog_age_seconds:60,latest_outcomes:{'cards:unresolved':1},observed_at:new Date().toISOString()};
async function run(){
  assert.equal(completion,canonical,'completion uses canonical reconciliation protocol');
  assert.equal(canonical.boundReason('card_creation_held'),'card_creation_held');
  assert.equal(canonical.boundReason('card_slot_cleared'),'card_slot_cleared');
  assert.equal(canonical.boundReason('card_missing_under_lock'),'card_missing_under_lock');
  assert.deepEqual(canonical.assessSummary(good,{maxBacklogAgeSeconds:120,maxRequestsOwed:1}).failures,[]);
  assert.deepEqual(canonical.assessSummary(good,{maxBacklogAgeSeconds:30,maxRequestsOwed:0}).failures.sort(),['backlog_age','requests_owed']);
  assert.throws(()=>canonical.validateSummary({...good,owed:{}}),/reconcile_protocol_summary/);
  assert.throws(()=>canonical.validateSummary({...good,observed_at:'2026-09-08T00:00:00.000Z'}),/reconcile_protocol_summary_stale/);
  assert.throws(()=>canonical.validateStage('children',{stage:'cards',request_id:'request-a',applied:false,outcome:'complete'},'request-a'),/reconcile_protocol_children/);
  assert.throws(()=>canonical.validateStage('children',{stage:'children',request_id:'wrong-request',applied:false,outcome:'complete'},'request-a'),/reconcile_protocol_children/);
  assert.throws(()=>canonical.validateStage('children',{stage:'children',request_id:'request-a',outcome:'complete'},'request-a'),/reconcile_protocol_children/);
  assert.throws(()=>limits({NATIVE_INTAKE_COMPLETION_MAX_REQUESTS_OWED:'not-a-number'}),/config_error/);
  let calls=0;
  await assert.rejects(()=>canonical.runReconcile({actor:'fixture',apply:false,limit:5,requestIds:['different-request'],rpc:async name=>{
    calls++;if(name==='production_intake_reconcile_backlog')return {items:[{request_id:'request-a',surface:'calendar'}],next_after:'same',exhausted:false,examined:1};
    throw new Error('unexpected:'+name);
  }}),/reconcile_protocol_backlog_cursor/);
  assert.equal(calls,2,'stalled cursor refuses after one cursor advance and before a third page');
  const lane=fs.readFileSync(path.join(__dirname,'../scripts/native-intake-completion/lane.mjs'),'utf8');
  assert.match(lane,/native-intake-reconcile\/lane\.mjs/);
  assert.equal(fs.existsSync(path.join(__dirname,'../scripts/native-intake-completion/load-writers.mjs')),false);
  for(const [file,key] of [['native-intake-completion.yml','native_intake_completion'],['native-intake-completion-monitor.yml','native_intake_completion_monitor']]){
    const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows',file),'utf8');
    assert.match(workflow,/NATIVE_INTAKE_COMPLETION_ENABLED/);assert.match(workflow,new RegExp('monitoring-watchdog\\.js --heartbeat='+key));
  }
  assert.ok(LANES.some(row=>row.key==='native_intake_completion')&&LANES.some(row=>row.key==='native_intake_completion_monitor'));
  console.log('native intake completion health checks passed');
}
run().catch(error=>{console.error(error.stack||error);process.exit(1);});
