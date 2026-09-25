// Separate dormant WR101 release. Browser claims never become verified principals.
import {createClient} from 'npm:@supabase/supabase-js@2.49.8';
import {timingSafeEqual} from '../_shared/staff-role-auth.ts';
import {makeRefusalReceipt,requestTraffic} from '../_shared/write-refusal-diagnostics.mjs';
const headers={'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-diagnostics-runner-key,x-syncview-traffic','access-control-allow-methods':'POST,OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return json({ok:false},405);
 if(Deno.env.get('WRITE_DIAGNOSTICS_ENABLED')!=='true')return json({ok:false,error:'dormant'},503);
 let body;try{const reader=req.body?.getReader();if(!reader)throw Error();let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2048){await reader.cancel();return json({ok:false},413);}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return json({ok:false},400);}
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)return json({ok:false},503);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 if(body.action==='browser_claim'){
  const receipt=await makeRefusalReceipt({surface:body.surface,operation:body.operation,identifiers:body.identifiers},body.code,body.status,'browser_claim',{traffic:requestTraffic(req),claimed_page:body.page});
  const result=await db.rpc('production_write_refusal_record_v1',{p_receipt:receipt});return json({ok:!result.error&&result.data?.recorded===true},result.error?503:202);
 }
 const runner=Deno.env.get('WRITE_DIAGNOSTICS_RUNNER_KEY');if(!runner||!timingSafeEqual(req.headers.get('x-diagnostics-runner-key')||'',runner))return json({ok:false},401);
 if(!['health','lookup','retention'].includes(body.action))return json({ok:false},400);
 const result=body.action==='retention'?await db.rpc('production_write_refusal_retention_v1'):await db.rpc('production_write_refusal_read_v1',{p_identifier_hash:body.action==='lookup'?body.identifier_hash:null});
 return result.error?json({ok:false,error:'telemetry_unavailable'},503):json({ok:true,result:result.data});
});
