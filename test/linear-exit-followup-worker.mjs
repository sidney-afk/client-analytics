import assert from 'node:assert/strict';
import {runClaimedFollowup} from '../scripts/linear-exit-followup-worker.mjs';
const task={operation_id:'00000000-0000-4000-8000-000000000001',kind:'graphic_baseline',attempt:1,lease_token:'00000000-0000-4000-8000-000000000002',payload:{client:'untrusted'}};
const payload={surface:'calendar',client:'fixture-client',sourceId:'fixture-card',incoming:{},existing:{},patch:{}};
function fixture({helper,commitFails=false,failFails=false}={}) {
 const log=[];
 const query=async(sql,params)=>{log.push(sql);if(sql.includes('_begin_'))return [{result:{payload,epoch:'synthetic'}}];if(sql.includes('_complete_'))return [{result:{completed:true}}];return [];};
 const database={begin:async cb=>{log.push('BEGIN');try{const result=await cb(query);if(commitFails)throw Error('ambiguous commit');log.push('COMMIT');return result;}catch(e){log.push('ROLLBACK');throw e;}},query:async(sql,params)=>{log.push('FAIL_LEDGER');if(failFails)throw Error('unavailable');return [];}};
 return {log,options:{database,task,storageFactory:()=>({}),fetch:async()=>{throw Error('network prohibited');},createHelpers:()=>({captureGraphicTweakBaseline:helper|| (async input=>{assert.equal(input.client,'fixture-client');return {captured:false,reason:'not_graphic_tweaks_needed_transition'};})})}};
}
const good=fixture();assert.equal((await runClaimedFollowup(good.options)).status,'completed');assert.equal(good.log.at(-1),'COMMIT');assert(good.log.some(x=>x.includes('idle_in_transaction_session_timeout')));
const soft=fixture({helper:async()=>({captured:false,reason:'feature_config_unavailable'})});assert.equal((await runClaimedFollowup(soft.options)).status,'failed');assert(!soft.log.some(x=>x.includes('_complete_')));assert.deepEqual(soft.log.slice(-2),['ROLLBACK','FAIL_LEDGER']);
const ambiguous=fixture({commitFails:true,failFails:true});assert.equal((await runClaimedFollowup(ambiguous.options)).status,'unknown');assert.equal(ambiguous.log.filter(x=>x==='BEGIN').length,1);
const delayed=fixture({helper:async()=>{await new Promise(r=>setTimeout(r,20));return {captured:true};}});assert.equal((await runClaimedFollowup({...delayed.options,timeoutMs:5})).status,'failed');assert(!delayed.log.some(x=>x.includes('_complete_')));
console.log('FOLLOWUP_WORKER_OFFLINE_PASS source-owned payload, transaction order, soft error rollback, deadline refusal, ambiguous commit no retry; actual SQL completion separate');
