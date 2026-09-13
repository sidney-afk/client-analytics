export async function recoverProviderComment(db,{epoch,attemptId,expectedOutbox}){
 if(typeof db?.rpc!=='function'||typeof epoch!=='string'||typeof attemptId!=='string'||!expectedOutbox||typeof expectedOutbox!=='object'||Array.isArray(expectedOutbox))throw Error('provider_comment_arguments');
 const {data,error}=await db.rpc('production_provider_comment_recover_v1',{p_epoch:epoch,p_attempt_id:attemptId,p_expected_outbox:expectedOutbox});
 if(error||data?.completed!==true)throw Error('provider_comment_recovery_refused');return {completed:true,providerResent:false};
}
