// Whole-handler Node loader. Only Deno, Supabase HTTP and fetch are translated;
// every SQL read/claim/authorization/checkpoint uses the disposable database.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export const literal = v => v == null ? 'null' : typeof v === 'object'
  ? "'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb"
  : typeof v === 'boolean' || typeof v === 'number' ? String(v) : "'"+String(v).replaceAll("'","''")+"'";
const ident = v => { assert.match(v,/^[a-z_][a-z_0-9]*$/); return '"'+v+'"'; };
const column = v => { const parts=v.split('->>');assert.ok(parts.length<=2);return ident(parts[0])+(parts.length===2?'->>'+literal(parts[1]):''); };
export function sqlClient(db) {
  const seam={beforeRead:null,beforeRpc:null,afterRpc:null,rpcs:[],errors:[]};
  const read = sql => {try{return {data:JSON.parse(db.query('set role service_role;'+sql)),error:null};}catch(e){seam.errors.push(String(e));return{data:null,error:{message:String(e)}};}};
  seam.client={rpc:async(name,args={})=>{
    if(seam.beforeRpc)await seam.beforeRpc(name,args);
    seam.rpcs.push({name,args});
    const result=read('select coalesce(to_jsonb(public.'+ident(name)+'('+Object.entries(args).map(([k,v])=>ident(k)+' := '+literal(v)).join(',')+')),\'null\'::jsonb)');
    return seam.afterRpc?await seam.afterRpc(name,args,result):result;
  },from:table=>{
    assert.ok(['mirror_outbox','deliverables','batches','deliverable_events','clients','syncview_runtime_flags','team_members','track_b_team_rollbacks','track_b_team_rollback_intents'].includes(table));
    let op='select',cols='*',payload,filters=[],orders=[],limit,mode='many',count=false;
    const b={select:(c='*',opts={})=>(cols=c,count=opts.count==='exact',b),
      eq:(k,v)=>(filters.push(column(k)+(v==null?' is null':' = '+literal(v))),b),
      neq:(k,v)=>(filters.push(column(k)+' <> '+literal(v)),b),
      gte:(k,v)=>(filters.push(column(k)+' >= '+literal(v)),b),
      is:(k,v)=>(assert.equal(v,null),filters.push(column(k)+' is null'),b),
      in:(k,v)=>(filters.push(v.length?column(k)+' in ('+v.map(literal).join(',')+')':'false'),b),
      order:(k,o={})=>(orders.push(column(k)+(o.ascending===false?' desc':' asc')),b),limit:n=>(assert.ok(Number.isInteger(n)&&n>0),limit=n,b),
      update:p=>(op='update',payload=p,b),insert:p=>(op='insert',payload=p,b),
      maybeSingle:()=>(mode='maybe',b),single:()=>(mode='one',b),
      execute:async()=>{
        if(op==='select'&&seam.beforeRead){const injected=await seam.beforeRead(table,filters);if(injected)return injected;}
        const t='public.'+ident(table),where=filters.length?' where '+filters.join(' and '):'';
        const projection=cols==='*'?'*':cols.split(',').map(c=>column(c)+(c.includes('->>')?' as '+ident(c.split('->>')[1]):'')).join(',');
        let sql;
        if(op==='select')sql='select '+projection+' from '+t+where+(orders.length?' order by '+orders.join(','):'')+(limit?' limit '+limit:'');
        else if(op==='update')sql='update '+t+' set '+Object.entries(payload).map(([k,v])=>ident(k)+' = '+literal(v)).join(',')+where+' returning '+projection;
        else sql='insert into '+t+' ('+Object.keys(payload).map(ident).join(',')+') values ('+Object.values(payload).map(literal).join(',')+') returning '+projection;
        const result=read((op==='select'?'select coalesce(jsonb_agg(x),\'[]\'::jsonb) from ('+sql+') x':'with x as ('+sql+') select coalesce(jsonb_agg(x),\'[]\'::jsonb) from x'));
        if(result.error)return result;
        const rows=result.data;
        if(mode!=='many'&&(rows.length>1||(mode==='one'&&rows.length!==1)))return{data:null,error:{message:'single cardinality mismatch'}};
        return{data:mode==='many'?rows:rows[0]??null,error:null,...(count?{count:rows.length}:{})};
      },then:(a,c)=>b.execute().then(a,c)};
    return b;
  }};
  return seam;
}
export async function loadWorker(source,root,output,label,seam) {
  const key='__g8_worker_'+label;
  globalThis[key]=seam;
  let handler;
  seam.serve=fn=>{assert.equal(handler,undefined);handler=fn;};
  const once=(needle,replacement)=>{assert.equal(source.split(needle).length,2,'exact loader anchor');source=source.replace(needle,replacement);};
  once('import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";',
    `type SupabaseClient = any; const createClient=()=>globalThis[${JSON.stringify(key)}].client;`);
  source=source.replace(/from "(\.\.?\/[^\"]+)";/g,(_m,rel)=>'from '+JSON.stringify(pathToFileURL(path.resolve(root,'supabase/functions/linear-outbound',rel)).href)+';');
  source=`const seam=globalThis[${JSON.stringify(key)}];const Deno={env:{get:k=>seam.env[k]},serve:seam.serve};const fetch=(...args)=>seam.fetch(...args);\n`+source;
  source+='\nexport {readViewer,readIssue,readLinearComment,readCommentByMarker,readAttachmentRevisionPresent,readTeam,readTeamByRowTeam,linearGraphql,claimRow,authorizeProviderDispatch};\n';
  const file=path.join(output,label+'.private.ts');fs.writeFileSync(file,source);
  const functions=await import(pathToFileURL(file).href);
  assert.equal(typeof handler,'function');
  return{...functions,handler};
}
