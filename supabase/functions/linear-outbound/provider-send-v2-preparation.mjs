// Versioned preparation closure; default deployed handler and V1 remain unchanged.
export {sendAdmittedProviderMutation,completeProviderSend} from './provider-send-preparation.mjs';
export async function admitProviderSend(db,row,mutation,replay,receiptContext){
 const {data:gate,error}=await db.from('card_write_admission_v1').select('epoch,mode').eq('singleton',true).single();
 if(error||gate?.mode!=='open')throw Error('provider_send_admission_closed');
 const request={kind:mutation.kind,query:mutation.query,variables:mutation.variables};
 const {data,error:refusal}=await db.rpc('production_provider_send_admit_v2',{p_epoch:gate.epoch,p_outbox_id:String(row.id),p_lock_token:row.lock_token,p_request:request,p_replay_scope:replay,p_receipt_context:receiptContext});
 if(refusal||typeof data?.attempt_id!=='string'||data.epoch!==gate.epoch||data.outbox_id!==String(row.id))throw Error('provider_send_admission_response');
 return {id:data.attempt_id,request,lockToken:row.lock_token};
}
