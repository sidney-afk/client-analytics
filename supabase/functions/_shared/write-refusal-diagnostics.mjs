import {REFUSAL_CODES,BROWSER_REFUSAL_CODES} from './write-refusal-codes.mjs';
// Separate WR101 preparation. Raw identifiers become lookup hashes; no prose is retained.
const contexts=new WeakMap(),fields=['id','client_slug','card','component','comment','parent','request_id'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const enumValue=(x,values,fallback)=>values.includes(x)?x:fallback;
export function captureRefusalContext(req,body){const identifiers={};for(const key of fields)if(typeof body?.[key]==='string'&&body[key].length<=256)identifiers[key]=body[key];contexts.set(req,{identifiers,surface:body?.surface,operation:body?.operation});}
export function captureVerifiedPrincipal(req,principal){const c=contexts.get(req)||{identifiers:{}};c.principal_kind=enumValue(principal?.kind,['staff','client','test','public'],'unverified');c.member_id=typeof principal?.memberId==='string'&&uuid.test(principal.memberId)?principal.memberId:null;contexts.set(req,c);}
export async function identifierHash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function makeRefusalReceipt(context,code,status,origin='gateway'){
 const identifiers={};for(const key of fields){const value=context?.identifiers?.[key];if(typeof value==='string'&&value.length<=256)identifiers[key]=await identifierHash(value);}
 return {attempt_id:crypto.randomUUID(),origin,surface:enumValue(context?.surface,['calendar','sxr','production'],'unknown'),operation:enumValue(context?.operation,['comment','status','create','update','archive','restore','due','assignee','labels','description','attachment','intake_create','batch_asset','batch_description','component_fill','title'],'other'),code:origin==='browser_claim'?(REFUSAL_CODES.includes(code)||BROWSER_REFUSAL_CODES.includes(code)?code:'browser_refusal'):REFUSAL_CODES.includes(code)?code:'write_refused',status:Number.isInteger(status)&&status>=400&&status<=599?status:500,principal_kind:origin==='browser_claim'?'unverified':context?.principal_kind||'unverified',member_id:origin==='browser_claim'?null:context?.member_id||null,identifiers};
}
export async function reportGatewayRefusal(db,req,error,response){
 let timer;let outcome='unavailable';try{const receipt=await makeRefusalReceipt(contexts.get(req)||{},error.code,error.status);outcome=await Promise.race([(async()=>{const {data,error}=await db.rpc('production_write_refusal_record_v1',{p_receipt:receipt});return !error&&data?.recorded===true?'recorded':'unavailable';})(),new Promise(resolve=>{timer=setTimeout(()=>resolve('unknown'),500);})]);}catch{}finally{clearTimeout(timer);contexts.delete(req);}
 const headers=new Headers(response.headers);headers.set('x-write-diagnostic-status',outcome);headers.append('access-control-expose-headers','x-write-diagnostic-status');if(outcome!=='recorded')console.error('write_refusal_telemetry_'+outcome);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
