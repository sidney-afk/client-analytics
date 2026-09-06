// Count-aware adapter over the unchanged pinned SQL shim. The data and exact
// total are read in ONE SQL statement; faults alter only its returned envelope.
import * as shim from './supabase-shim.mjs';
export const faults = { selectFails: null, mutate: null, attempted: [] };
export const resetFaults = () => { faults.selectFails=null; faults.mutate=null; faults.attempted.length=0; };
export const hooks=shim.hooks, resetHooks=shim.resetHooks, runSql=shim.runSql;
export class SupabaseClient {}
export function createClient() {
  const client=shim.createClient();
  return { ...client, rpc:(...args)=>client.rpc(...args), from(table) {
    const builder=client.from(table); let exact=false;
    const proxy=new Proxy(builder, { get(target,key) {
      if(key==='select') return (columns,options) => {exact=options?.count==='exact'; target.select(columns); return proxy;};
      if(key==='then') return (resolve,reject) => (async()=>{
        if(faults.selectFails?.(table,target.filters)) return {data:null,error:{message:'injected read failure'},count:null};
        if(!exact) return target.execute();
        if(!/^[a-z_][a-z0-9_]*$/.test(table)) throw Error('unexpected table');
        hooks.log.push({kind:'select',table});
        const dataSql=target.sql().replace(/;\s*$/,'');
        const totalSql='select count(*) from public."'+table+'" t'+target.where('t');
        const result=await shim.runSql("select json_build_object('data',("+dataSql+"),'count',("+totalSql+"));");
        if(result.status!==0) return {data:null,error:{message:'SQL count read failed'},count:null};
        const envelope={...JSON.parse(result.stdout.trim()),error:null};
        return faults.mutate ? faults.mutate(table,envelope) : envelope;
      })().then(resolve,reject);
      const value=target[key];
      return typeof value==='function' ? (...args)=>value.apply(target,args)===target?proxy:target : value;
    }});
    return proxy;
  }};
}
