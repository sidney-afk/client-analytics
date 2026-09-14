// Explicit local recovery RPC only. No provider transport or resend.
export async function recoverProviderCreate(db,{epoch,attemptId,expectedOutbox}) { const {data,error}=await db.rpc('production_provider_create_recover_v1',{p_epoch:epoch,p_attempt_id:attemptId,p_expected_outbox:expectedOutbox});if(error)throw error;return data;}
