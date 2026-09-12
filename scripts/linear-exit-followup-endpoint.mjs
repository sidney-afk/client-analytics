// Private runner endpoint factory. Disabled by default; no background scheduling.
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const equal=(a,b)=>{const enc=new TextEncoder(),x=enc.encode(a),y=enc.encode(b);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);return diff===0;};
export function createFollowupEndpoint({env,openDatabase,runTask,createHelpers,storageFactory,fetch:transport}) {
  return async request=>{
    if(request.method!=='POST')return json({ok:false,code:'method'},405);
    const key=env('LINEAR_EXIT_FOLLOWUP_RUNNER_KEY');
    if(typeof key!=='string'||key.length<32)return json({ok:false,code:'not_configured'},503);
    const provided=request.headers.get('x-followup-runner-key')||'';
    if(provided.length>1024||!equal(provided,key))return json({ok:false,code:'unauthorized'},401);
    let body;
    try {
      const declared=Number(request.headers.get('content-length')||0);
      if(declared>1024)return json({ok:false,code:'payload_too_large'},413);
      const reader=request.body?.getReader(),chunks=[];let size=0;
      if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024){await reader.cancel();return json({ok:false,code:'payload_too_large'},413);}chunks.push(value);}}finally{reader.releaseLock();}
      const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
      body=JSON.parse(new TextDecoder().decode(bytes)||'{}');
      if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>k!=='action'))return json({ok:false,code:'body'},400);
    } catch(_){return json({ok:false,code:'body'},400);}
    const action=body.action||'run';
    if(!['run','health'].includes(action))return json({ok:false,code:'action'},400);
    if(action==='run'&&env('LINEAR_EXIT_FOLLOWUP_ENABLED')!=='true')return json({ok:false,code:'disabled'},503);
    if(!env('SUPABASE_DB_URL')||!env('SUPABASE_URL')||!env('SUPABASE_SERVICE_ROLE_KEY'))return json({ok:false,code:'not_configured'},503);
    let database;
    try {
      database=openDatabase(env('SUPABASE_DB_URL'));
      if(action==='health') {
        const rows=await database.query("select count(*) filter(where t.state='pending')::int as pending,count(*) filter(where t.state='pending' and o.committed_at<clock_timestamp()-interval '5 minutes')::int as pending_stale,count(*) filter(where t.state in ('failed','unknown') or (t.state='running' and t.lease_until<clock_timestamp()))::int as unresolved from public.card_write_followups_v1 t join public.card_write_operations_v1 o using(operation_id)",[]);
        if(rows.length!==1||!['pending','pending_stale','unresolved'].every(k=>Number.isSafeInteger(rows[0][k])&&rows[0][k]>=0))throw Error('HEALTH');
        const enabled=env('LINEAR_EXIT_FOLLOWUP_ENABLED')==='true',ok=enabled&&rows[0].unresolved===0&&rows[0].pending_stale===0;
        return json({ok,enabled,...rows[0]},ok?200:503);
      }
      // One claim per invocation keeps its lease behind the bounded work deadline.
      const rows=await database.query('select to_jsonb(t) as task from public.production_card_followup_claim_v1(1) t',[]);
      if(!Array.isArray(rows)||rows.length>1)throw Error('CLAIM');
      if(!rows.length)return json({ok:true,processed:0});
      const result=await runTask({database,task:rows[0].task,createHelpers,storageFactory,fetch:transport});
      if(!['completed','failed','unknown'].includes(result?.status))throw Error('RESULT');
      return json({ok:result.status==='completed',processed:1,status:result.status},result.status==='completed'?200:503);
    } catch(_){return json({ok:false,code:'worker_unavailable'},503);}
    finally {if(database)try{await database.close();}catch(_){/* Ledger readback, never a retry, resolves a lost connection. */}}
  };
}
