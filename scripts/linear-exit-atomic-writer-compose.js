'use strict';
const crypto=require('crypto');
const HASHES={calendar:'5592a10798acabe2670e61867edbab73847c6eda65b0b2253b7f86756851fada',samples:'edef156c8a0c067a2ef512f8070ac8e8072c8e6b337bbe553dab0ca854c04953'};
function compose(surface,bytes){if(!HASHES[surface]||crypto.createHash('sha256').update(bytes).digest('hex')!==HASHES[surface])throw Error('ATOMIC_CAPTURE_HASH_MISMATCH');let source=bytes.toString('utf8');const row=surface==='calendar'?'post':'sample',write=surface==='calendar'?'writeCalendarRow':'writeSampleRow';const start=source.indexOf(`    await ${write}(supabase, client, ${row}, existsAlready);`),end=source.indexOf('    outcome = "ok";',start);if(start<0||end<start||(source.slice(start,end).match(/waitUntil\(/g)||[]).length!==3)throw Error('ATOMIC_SEAM_DRIFT');const payload=surface==='calendar'?'updatePayload(client, post)':'mirrorPayload(client, sample, existsAlready)';source=source.slice(0,start)+`    const operationId=crypto.randomUUID();
    const followupInput={surface:${JSON.stringify(surface)},client,sourceId:id,incoming:${row},patch:built.row,existing:existingRead.row,actor,now:isoNow()};
    const events=buildEvents(client,${row},built.row,existingRead.row,actor,isoNow());
    const {data:committed,error:commitError}=await supabase.rpc("production_card_atomic_write_v1",{p_operation_id:operationId,p_request:{surface:${JSON.stringify(surface)},client,id,expected_existing:existsAlready?existingRead.row:null,row:${payload},events,followups:[{kind:"graphic_baseline",payload:followupInput},{kind:"graphic_resolution",payload:followupInput}]}});
    if(commitError){
      if(commitError.message==="card_atomic_admission_closed")return json({ok:false,code:"maintenance",error:"Saving is temporarily paused for maintenance. Please try again shortly."},503);
      if(commitError.message==="card_atomic_preimage_conflict")return json({ok:false,code:"write_conflict",error:"This card changed. Please refresh and try again."},409);
      throw new Error("atomic card write refused");
    }
    if(!committed||committed.ok!==true)throw new Error("atomic card write refused");

`+source.slice(end);return {source,sha256:crypto.createHash('sha256').update(source).digest('hex'),baseline_sha256:HASHES[surface]};}
module.exports={compose,HASHES};
