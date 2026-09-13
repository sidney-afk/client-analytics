// Used only by the separately composed preparation handler. No automatic retries.
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error||!data||typeof data!=='object')throw Error('provider_send_rpc_refused:'+name);return data;}
export async function admitProviderSend(db,row,mutation,replay){
 const {data:gate,error}=await db.from('card_write_admission_v1').select('epoch,mode').eq('singleton',true).single();
 if(error||gate?.mode!=='open')throw Error('provider_send_admission_closed');
 const request={kind:mutation.kind,query:mutation.query,variables:mutation.variables};
 const admitted=await rpc(db,'production_provider_send_admit_v1',{p_epoch:gate.epoch,p_outbox_id:String(row.id),p_lock_token:row.lock_token,p_request:request,p_replay_scope:replay});
 if(typeof admitted.attempt_id!=='string'||admitted.epoch!==gate.epoch||admitted.outbox_id!==String(row.id))throw Error('provider_send_admission_response');
 return {id:admitted.attempt_id,request,lockToken:row.lock_token};
}
export async function sendAdmittedProviderMutation(db,attempt,send){
 // Any exception/lost response leaves the durable attempt unresolved.
 const data=await send();
 const ack=await rpc(db,'production_provider_send_ack_v1',{p_attempt_id:attempt.id,p_lock_token:attempt.lockToken,p_request:attempt.request,p_response:data});
 if(ack.acknowledged!==true||ack.completed!==false)throw Error('provider_send_ack_response');
 return data;
}
export async function completeProviderSend(db,attempt,receipt){
 const result=await rpc(db,'production_provider_send_complete_v1',{p_attempt_id:attempt.id,p_lock_token:attempt.lockToken,p_receipt:receipt});
 if(result.completed!==true)throw Error('provider_send_complete_response');
}
