// Preparation-only local checkpoint recovery. Deliberately has no provider
// transport, mutation callback, automatic retry, or inferred observation path.
export async function recoverProviderCheckpoint(db,{epoch,attemptId,expectedOutbox}){
 if(!db||typeof db.rpc!=='function'||typeof epoch!=='string'||typeof attemptId!=='string'||!expectedOutbox||Array.isArray(expectedOutbox)||typeof expectedOutbox!=='object')throw Error('provider_checkpoint_arguments');
 const {data,error}=await db.rpc('production_provider_checkpoint_recover_v1',{p_epoch:epoch,p_attempt_id:attemptId,p_expected_outbox:expectedOutbox});
 if(error||!data||data.completed!==true)throw Error('provider_checkpoint_recovery_refused');
 return {completed:true,providerResent:false,externalObservationVerified:false};
}
