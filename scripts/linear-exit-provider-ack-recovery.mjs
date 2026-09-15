// No provider transport or resend path: source ACK and immutable context only.
export async function recoverProviderAcknowledgement(db,{epoch,attemptId,expectedOutbox}){
 if(!db||typeof db.rpc!=='function'||typeof epoch!=='string'||typeof attemptId!=='string'||!expectedOutbox||Array.isArray(expectedOutbox)||typeof expectedOutbox!=='object')throw Error('provider_ack_arguments');
 const {data,error}=await db.rpc('production_provider_ack_recover_v1',{p_epoch:epoch,p_attempt_id:attemptId,p_expected_outbox:expectedOutbox});
 if(error||data?.completed!==true)throw Error('provider_ack_recovery_refused');
 return {completed:true,providerResent:false};
}
