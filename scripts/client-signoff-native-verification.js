'use strict';
// Evidence is attached only to the exact row object read and verified by transport.
const evidenceByRow=new WeakMap();
const candidate=r=>r&&r.status==='skipped'&&r.role==='client'&&r.payload?.status==='approved';
const clock=s=>{if(typeof s!=='string')return null;const m=/^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(s);return m?m[1]+'T'+m[2]+'.'+(m[3]||'').padEnd(6,'0')+'Z':null;};
const id=s=>typeof s==='string'&&/^[1-9][0-9]{0,18}$/.test(s)&&BigInt(s)<=9223372036854775807n;
async function verifyRows(rows,transport){
 const selected=rows.filter(candidate);for(const row of selected)evidenceByRow.delete(row);
 const snapshots=selected.map(r=>JSON.stringify(r));
 const ids=selected.map(r=>r.id_text);if(ids.some(x=>!id(x))||new Set(ids).size!==ids.length)return;
 const pending=[];
 try{for(let i=0;i<ids.length;i+=200){const batch=ids.slice(i,i+200);const result=await transport(batch);if(!Array.isArray(result)||result.length!==batch.length)throw Error('native_verification_incomplete');
 for(let j=0;j<batch.length;j++){const value=result[j],row=selected[i+j];if(!value||Object.keys(value).sort().join(',')!=='client_slug,entity_id,receipt_id,source_edited_at,verified'||value.receipt_id!==batch[j]||typeof value.verified!=='boolean')throw Error('native_verification_shape');
 if(value.verified){const timestamp=clock(value.source_edited_at);if(!timestamp||timestamp!==clock(row.source_edited_at)||value.entity_id!==row.entity_id||value.client_slug!==row.client_slug)throw Error('native_verification_binding');pending.push([row,{receipt_id:value.receipt_id,source_edited_at:timestamp,entity_id:value.entity_id,client_slug:value.client_slug}]);}
 else if(value.entity_id!==null||value.client_slug!==null||value.source_edited_at!==null)throw Error('native_verification_shape');}
 }}catch(_){return;}
 if(selected.some((row,i)=>JSON.stringify(row)!==snapshots[i]))return;
 for(const [row,binding] of pending)evidenceByRow.set(row,{snapshot:snapshots[selected.indexOf(row)],binding:Object.freeze(binding)});
}
function evidence(row){const e=evidenceByRow.get(row);return e&&e.snapshot===JSON.stringify(row)?e.binding:null;}
module.exports={verifyRows,evidence,candidate,clock};
