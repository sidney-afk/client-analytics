import {createTransactionClient,verifyHelperOutcome} from './linear-exit-followup-transaction.mjs';

// Database adapter contract: begin(callback) pins ONE connection and commits only
// after callback resolves; a disconnect aborts without reconnecting/replaying.
// query() outside begin is used solely for a bounded failure-ledger update.
export async function runClaimedFollowup({database,task,createHelpers,storageFactory,fetch:transport,timeoutMs=40000}) {
  if(!database||typeof database.begin!=='function'||typeof database.query!=='function'
    ||typeof createHelpers!=='function'||typeof storageFactory!=='function'||typeof transport!=='function'
    ||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>40000)throw Error('FOLLOWUP_WORKER_CONFIG');
  if(!task||!['graphic_baseline','graphic_resolution'].includes(task.kind)||!Number.isInteger(task.attempt)||task.attempt<1
    ||![task.operation_id,task.lease_token].every(x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x)))throw Error('FOLLOWUP_WORKER_TASK');
  const binding=[task.operation_id,task.kind,task.attempt,task.lease_token];
  const controller=new AbortController();
  const deadline=performance.now()+timeoutMs;
  let active=true,phase='begin';
  const alive=()=>active&&!controller.signal.aborted&&performance.now()<deadline;
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const boundedFetch=async(input,options={})=>{
    if(!alive())throw Error('FOLLOWUP_DEADLINE');
    const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
    const result=await transport(input,{...options,signal});
    if(!alive())throw Error('FOLLOWUP_DEADLINE');
    return result;
  };
  try {
    const result=await database.begin(async query=>{
      await query("set local statement_timeout='45s'",[]);
      await query("set local idle_in_transaction_session_timeout='45s'",[]);
      const started=await query('select public.production_card_followup_begin_v1($1,$2,$3,$4) as result',binding);
      if(started.length!==1||!started[0].result?.payload||!alive())throw Error('FOLLOWUP_BEGIN_REFUSED');
      // Immutable database-owned payload wins over any task payload supplied by
      // the caller. A claimed task is only an identifier/attempt envelope.
      const payload=started[0].result.payload;
      const sdk=createTransactionClient({query,scope:payload,alive,storage:storageFactory({alive,signal:controller.signal,fetch:boundedFetch})});
      phase='helper';
      const helpers=createHelpers(boundedFetch);
      const helper=task.kind==='graphic_baseline'?helpers.captureGraphicTweakBaseline:helpers.scanGraphicTweakResolution;
      const outcome=await helper({...payload,supabase:sdk});
      sdk.assertHealthy();verifyHelperOutcome(task.kind,outcome);
      phase='complete';
      const completed=await query('select public.production_card_followup_complete_v1($1,$2,$3,$4,$5::jsonb) as result',[...binding,outcome]);
      if(completed.length!==1||completed[0].result?.completed!==true||!alive())throw Error('FOLLOWUP_COMPLETE_REFUSED');
      phase='commit';
      return {status:'completed',operation_id:task.operation_id,kind:task.kind,result:completed[0].result};
    });
    // A successful callback alone is not enough: begin must have committed.
    return result;
  } catch (_) {
    active=false;controller.abort();
    try {
      await database.query('select public.production_card_followup_fail_v1($1,$2,$3,$4,$5)',[...binding,'worker_transaction_unconfirmed']);
      return {status:'failed',operation_id:task.operation_id,kind:task.kind,phase,retry_automatic:false};
    } catch (_) {
      // Includes ambiguous COMMIT: never blindly retry or rewrite completion.
      return {status:'unknown',operation_id:task.operation_id,kind:task.kind,phase,retry_automatic:false,requires_ledger_readback:true};
    }
  } finally {active=false;controller.abort();clearTimeout(timer);}
}
