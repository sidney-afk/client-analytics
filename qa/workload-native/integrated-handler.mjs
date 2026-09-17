// Actual Workload request handler; only Deno/Supabase transports are replaced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const quote=value=>value==null?'null':"'"+String(value).replaceAll("'","''")+"'";
export async function loadIntegratedWorkloadHandler(database, output) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const calls={rpc:0,external:0,legacyWrites:0};
  const db={
    async rpc(name,params={}) {
      if(!['workload_native_snapshot_v1','workload_native_plan_target_v1','workload_native_plan_set_v1'].includes(name))throw Error('unapproved_rpc');
      calls.rpc++;
      try{return {data:JSON.parse(database.query('set role service_role;select public.'+name+'('+Object.entries(params).map(([k,v])=>k+'=>'+quote(v)).join(',')+');')||'null'),error:null};}
      catch{return {data:null,error:{code:'isolated_sql_refused'}};}
    },
    from(table) {
      if(!['clients','client_access','syncview_runtime_flags','workload_plan','workload_issues'].includes(table))throw Error('unapproved_table');
      let cols='*',where=[],one=false;
      const run=()=>{try{const sql='select '+cols+' from public.'+table+(where.length?' where '+where.join(' and '):'');
        const rows=JSON.parse(database.query("set role service_role;select coalesce(json_agg(t),'[]'::json) from ("+sql+") t;"));
        return {data:one?(rows[0]||null):rows,error:null};}
        catch{return {data:null,error:{code:'isolated_sql_refused'}};}};
      const q={select(v){cols=v;return q;},eq(k,v){where.push(k+'='+quote(v));return q;},maybeSingle(){one=true;return Promise.resolve(run());},
        upsert(){calls.legacyWrites++;throw Error('legacy_write_unexpected');},then(a,b){return Promise.resolve(run()).then(a,b);}};
      return q;
    }
  };
  const prior={Deno:globalThis.Deno,fetch:globalThis.fetch,db:globalThis.__workloadIntegratedDb};
  let handler;
  const values={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',ROLE_KEY_ADMIN:'fixture-admin',ROLE_KEY_SMM:'fixture-smm',ROLE_KEY_CREATIVE:'fixture-creative'};
  globalThis.__workloadIntegratedDb=db;
  globalThis.fetch=async()=>{calls.external++;throw Error('external_transport_prohibited');};
  globalThis.Deno={env:{get:key=>values[key]},serve:value=>{handler=value;}};
  const file=path.join(root,'supabase/functions/workload-plan/index.ts');
  const source=fs.readFileSync(file,'utf8');
  const pattern=/import \{\s*createClient,\s*type SupabaseClient,\s*\} from "npm:@supabase\/supabase-js@2\.49\.8";/;
  if(!pattern.test(source))throw Error('handler_import_seam_drift');
  let text=source.replace(pattern,'const createClient=()=>globalThis.__workloadIntegratedDb; type SupabaseClient=any;');
  for(const [name,target] of [
    ['../_shared/browser-write-auth.ts','supabase/functions/_shared/browser-write-auth.ts'],
    ['../_shared/staff-role-auth.ts','supabase/functions/_shared/staff-role-auth.ts'],
    ['./native-snapshot.mjs','supabase/functions/workload-plan/native-snapshot.mjs']
  ])text=text.replaceAll('"'+name+'"',JSON.stringify(pathToFileURL(path.join(root,target)).href));
  const target=path.join(output,'workload-handler-'+database.name+'.ts');fs.writeFileSync(target,text);
  await import(pathToFileURL(target).href);
  if(typeof handler!=='function')throw Error('actual_handler_missing');
  return {
    calls,
    async request(body,key='fixture-admin') {
      const response=await handler(new Request('https://fixture.invalid/workload-plan',{method:'POST',
        headers:{'content-type':'application/json',...(key?{'x-syncview-key':key}:{})},body:JSON.stringify(body)}));
      return {status:response.status,body:await response.json()};
    },
    close(){globalThis.Deno=prior.Deno;globalThis.fetch=prior.fetch;globalThis.__workloadIntegratedDb=prior.db;}
  };
}
