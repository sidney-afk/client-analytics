import postgres from 'npm:postgres@3.4.7';
// Internal execution adapter only. Importing does not connect or start a worker.
// Postgres.js begin pins its scoped connection; no application retry is installed.
export function connectFollowupDatabase(url,{isolated=false}={}) {
  const parsed=new URL(url);
  if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error('FOLLOWUP_DATABASE_URL');
  const loopback=['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);
  if(isolated&&!loopback||!isolated&&loopback)throw Error('FOLLOWUP_DATABASE_SCOPE');
  if(parsed.search)throw Error('FOLLOWUP_DATABASE_URL_OPTIONS');
  const sql=postgres(url,{ssl:isolated?false:'require',prepare:false,max:1,connect_timeout:5,idle_timeout:1,max_lifetime:60});
  return {
    query:(text,params=[])=>sql.begin(async transaction=>{
      await transaction.unsafe('set local role service_role');
      await transaction.unsafe("set local statement_timeout='7s'");
      await transaction.unsafe("set local lock_timeout='5s'");
      return transaction.unsafe(text,params);
    }),
    begin:callback=>sql.begin(async transaction=>{
      await transaction.unsafe('set local role service_role');
      return callback((text,params=[])=>transaction.unsafe(text,params));
    }),
    close:()=>sql.end({timeout:5}),
  };
}
