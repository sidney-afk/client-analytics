// Actual Deno request handlers behind loopback HTTP. Only SDK transport is
// replaced with the existing real-SQL seam. No authentication import is mocked.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import http from 'node:http';import net from 'node:net';import tls from 'node:tls';import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';import crypto from 'node:crypto';
const require=createRequire(import.meta.url),{PgSupabase,pgError}=require('../../qa/calendar-feedback-recovery/seam');
const {LocalDatabase}=require('../card-change-journal-rehearsal');
export const sourceRoot=path.resolve(process.env.NATIVE_CARD_HTTP_SOURCE_ROOT||path.join(import.meta.dirname,'../..'));
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'native-card-http-handlers-'));
export const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const rawDb=new LocalDatabase({host:process.env.NIR_PGHOST,port:process.env.NIR_PGPORT,user:process.env.NIR_PGUSER,psql:process.env.NIR_PSQL,password:process.env.PGPASSWORD});
rawDb.name=process.env.NIR_PGDATABASE;
const db={run:s=>rawDb.query(s),rows:s=>rawDb.rows(s),scalar:s=>rawDb.rows(`select (${s}) as value`)[0].value};
export const seam=new PgSupabase(db),events={external:0,http:0,background:0,logs:[],calls:[],fault:null};
const originalRpc=seam.rpc.bind(seam);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
function nativeRpc(args){
  assert.deepEqual(Object.keys(args).sort(),['p_raw_body','p_source','p_surface']);
  try{return {data:JSON.parse(rawDb.query(`set role service_role;select public.production_card_materialize(${quote(args.p_surface)},${quote(args.p_source)},${quote(args.p_raw_body)})::text;`)),error:null};}
  catch(error){return {data:null,error:pgError(error)};}
}
seam.rpc=async(name,args)=>{
  events.calls.push({name,args});
  if(name==='production_card_materialize')return events.fault?events.fault(name,args,()=>nativeRpc(args)):nativeRpc(args);
  return originalRpc(name,args);
};
const sources={},handlers=new Map(),pending=[];
export function sourcePins(){return {...sources};}
function pinned(file){const bytes=fs.readFileSync(file);sources[file]=sha(bytes);return bytes.toString('utf8');}
function once(text,needle,replacement){assert.equal(text.split(needle).length,2,'exact loader seam');return text.replace(needle,replacement);}
export async function load(slug,{capture=null,derived=false}={}){
  const file=capture||path.join(sourceRoot,'supabase/functions',slug,'index.ts');let text=pinned(file);
  const originalHash=sha(text);let scope=capture?'DATED_CAPTURE_SOURCE':'REPOSITORY_AUTH_SOURCE';
  if(derived){
    // Graft only adapter-specific parse/terminal branch from the actual candidate.
    // Captured actorFrom/auth behavior remains unchanged; no deployed claim.
    const candidate=pinned(path.join(sourceRoot,'supabase/functions',slug,'index.ts'));
    const adapterImport=candidate.match(/import\s*\{[^}]+\}\s*from "\.\.\/_shared\/native-card-materialization\.mjs";/s);
    assert.ok(adapterImport,'candidate adapter import');text=adapterImport[0]+'\n'+text;
    const oldParse='  let body: JsonMap;\n  try { body = JSON.parse(await req.text()) as JsonMap; }\n  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }';
    const parse=candidate.slice(candidate.indexOf('  const nativeSource =',candidate.indexOf('Deno.serve(')),candidate.indexOf('\n  const now = isoNow();',candidate.indexOf('Deno.serve(')));
    assert.ok(parse.includes('readNativeCardRequest'),'native parse seam');text=once(text,oldParse,parse);
    const branch=candidate.match(/    if \(nativeSource\) \{[\s\S]*?\n    \}/);assert.ok(branch,'native terminal branch');
    text=once(text,'    id = clean(built.row.id);','    id = clean(built.row.id);\n'+branch[0]);scope='DATED_CAPTURE_PLUS_EXACT_ADAPTER_GRAFT';
  }
  const derivedHash=sha(text);
  const shim='data:text/javascript,'+encodeURIComponent('export class SupabaseClient{};export function createClient(){return globalThis.__cardHttpClient();}');
  text=once(text,'import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";',`import { createClient, SupabaseClient } from "${shim}";`);
  text=text.replace(/from "(\.\.?\/[^\"]+)";/g,(_all,relative)=>{
    const target=relative.endsWith('native-card-materialization.mjs')?path.join(sourceRoot,'supabase/functions/_shared/native-card-materialization.mjs')
      :path.resolve(path.dirname(file),relative);pinned(target);return `from "${pathToFileURL(target).href}";`;
  });
  const target=path.join(scratch,slug+'-'+handlers.size+'.ts');fs.writeFileSync(target,text);
  let handler;globalThis.Deno={env:{get:name=>process.env[name]},serve:fn=>{handler=fn;}};
  globalThis.__cardHttpClient=()=>seam;globalThis.EdgeRuntime={waitUntil:p=>{events.background++;pending.push(Promise.resolve(p).catch(e=>events.logs.push(String(e))));}};
  await import(pathToFileURL(target).href);assert.equal(typeof handler,'function');
  const route='/'+handlers.size;handlers.set(route,handler);return {route,scope,original_sha256:originalHash,derived_sha256:derivedHash};
}
let server,port,originalConnect,originalTls;
export async function start(){
  globalThis.fetch=async()=>{events.external++;throw Error('external_fetch_refused');};
  server=http.createServer(async(req,res)=>{
    events.http++;const handler=handlers.get(req.url);if(!handler){res.writeHead(404).end();return;}
    try{
      const request=new Request('http://127.0.0.1:'+port+req.url,{method:req.method,headers:req.headers,
        ...(req.method==='GET'||req.method==='HEAD'?{}:{body:Readable.toWeb(req),duplex:'half'})});
      const response=await handler(request);await drain();
      if(req.headers['x-fixture-lose-response']==='yes'){res.destroy();return;}
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){events.logs.push(String(error.stack));res.writeHead(500).end('{"ok":false,"error":"fixture_handler_failure"}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
  originalConnect=net.Socket.prototype.connect;originalTls=tls.connect;
  net.Socket.prototype.connect=function(...args){const first=Array.isArray(args[0])?args[0][0]:args[0];
    if(!first||typeof first!=='object'||first.host!=='127.0.0.1'||Number(first.port)!==port){events.external++;throw Error('external_socket_refused');}
    return originalConnect.apply(this,args);
  };
  tls.connect=()=>{events.external++;throw Error('external_tls_refused');};
}
export function send(route,body,headers={},method='POST'){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:route,method,headers:{'content-type':'application/json',...headers}},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const raw=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(raw);}catch{}resolve({status:res.statusCode,body:value,raw});});});
    req.setTimeout(15000,()=>req.destroy(Error('fixture_http_timeout')));req.on('error',reject);req.end(bytes);
  });
}
export async function drain(){while(pending.length)await Promise.all(pending.splice(0));}
export async function close(){await drain();if(originalConnect)net.Socket.prototype.connect=originalConnect;if(originalTls)tls.connect=originalTls;
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}fs.rmSync(scratch,{recursive:true,force:true});}
export function assertStable(){for(const[file,hash]of Object.entries(sources))assert.equal(sha(fs.readFileSync(file)),hash,'runtime changed during proof');}
