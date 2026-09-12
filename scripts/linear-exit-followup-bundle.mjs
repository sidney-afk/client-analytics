import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {composeFollowupHelper} from './linear-exit-followup-compose.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
export function buildFollowupBundle(target) {
  if(!path.isAbsolute(target))throw Error('FOLLOWUP_BUNDLE_ABSOLUTE_DIRECTORY');
  const dest=path.resolve(target),parent=fs.realpathSync(path.dirname(dest));
  if(parent!==path.dirname(dest))throw Error('FOLLOWUP_BUNDLE_PARENT');
  const files=new Map(),sources=[];
  const add=(name,source)=>{const b=fs.readFileSync(path.join(ROOT,source));sources.push({path:source,sha256:sha(b)});files.set(name,b);};
  add('endpoint.mjs','scripts/linear-exit-followup-endpoint.mjs');
  add('worker.mjs','scripts/linear-exit-followup-worker.mjs');
  files.set('worker.mjs',Buffer.from(files.get('worker.mjs').toString().replace("'./linear-exit-followup-transaction.mjs'","'./transaction.mjs'")));
  add('transaction.mjs','scripts/linear-exit-followup-transaction.mjs');
  add('postgres.mjs','scripts/linear-exit-followup-postgres.mjs');
  add('deno.lock','qa/linear-exit-rehearsal/followup-deno.lock');
  const helperPath='qa/linear-exit-rehearsal/serving/samples-v50/functions/_shared/thumbnail-revisions.ts';
  const helper=composeFollowupHelper(fs.readFileSync(path.join(ROOT,helperPath)));
  sources.push({path:helperPath,sha256:helper.source_sha256});files.set('thumbnail-helper.ts',Buffer.from(helper.source));
  files.set('index.ts',Buffer.from(`// Prepared private worker. No schedule or enablement is installed by this bundle.
import {createClient} from 'npm:@supabase/supabase-js@2.49.8';
import {createFollowupEndpoint} from './endpoint.mjs';
import {connectFollowupDatabase} from './postgres.mjs';
import {runClaimedFollowup} from './worker.mjs';
import {createImmutableSnapshotStorage} from './transaction.mjs';
import {createFollowupHelpers} from './thumbnail-helper.ts';
const env=(name:string)=>Deno.env.get(name);
const maxBytes=6*1024*1024;
function configuredDatabase(url:string) {
 const reference=env('LINEAR_EXIT_PROJECT_REF')||'',api=new URL(env('SUPABASE_URL')||''),database=new URL(url);
 if(!/^[a-z0-9]{20}$/.test(reference)||api.protocol!=='https:'||api.hostname!==reference+'.supabase.co'||api.port||api.username||api.password||api.search||api.hash||!['','/'].includes(api.pathname))throw Error('project_binding');
 const direct=database.hostname==='db.'+reference+'.supabase.co';
 const pooler=database.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(database.username).endsWith('.'+reference);
 if(!direct&&!pooler)throw Error('database_project_binding');
 return connectFollowupDatabase(url);
}
const storageFactory=({alive,fetch:boundedFetch}:{alive:()=>boolean,fetch:typeof fetch})=>{
 const api=env('SUPABASE_URL')!,key=env('SUPABASE_SERVICE_ROLE_KEY')!;
 const client=createClient(api,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFetch}});
 return createImmutableSnapshotStorage({alive,maxBytes,
  digest:async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(n=>n.toString(16).padStart(2,'0')).join(''),
  upload:async(bucket:string,name:string,bytes:Uint8Array,options:object)=>client.storage.from(bucket).upload(name,bytes,options),
  download:async(bucket:string,name:string)=>{
   const encoded=[bucket,...name.split('/')].map(encodeURIComponent).join('/');
   const base=api.endsWith('/')?api.slice(0,-1):api;
   const response=await boundedFetch(base+'/storage/v1/object/authenticated/'+encoded,{headers:{apikey:key,authorization:'Bearer '+key},redirect:'error'});
   if(!response.ok||!response.body)throw Error('storage_readback');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maxBytes){await reader.cancel();throw Error('storage_size');}chunks.push(value);}}finally{reader.releaseLock();}
   const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
  }
 });
};
Deno.serve(createFollowupEndpoint({env,openDatabase:configuredDatabase,runTask:runClaimedFollowup,createHelpers:createFollowupHelpers,storageFactory,fetch:globalThis.fetch}));
`));
  const prefix='functions/card-followup-worker/';
  const manifest={format:'syncview-followup-worker-preparation-v1',function_name:'card-followup-worker',verify_jwt:false,enabled_default:false,
    prerequisites:['source-exact admission SQL preflight','reviewed TLS database credentials matching the Storage project','private runner key of at least 32 characters','reviewed Drive credentials','verified immutable Storage read/write access','separately authorized manual run and later scheduling'],
    required_environment:['LINEAR_EXIT_PROJECT_REF','LINEAR_EXIT_FOLLOWUP_RUNNER_KEY','SUPABASE_DB_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'],
    enable_environment:{name:'LINEAR_EXIT_FOLLOWUP_ENABLED',required_value:'true'},
    sources,files:[...files].map(([name,b])=>({path:prefix+name,sha256:sha(b),bytes:b.length})),
    deployment_authorized:false,installed:false,schedule_installed:false,hosted_runtime_proven:false};
  fs.mkdirSync(dest,{mode:0o700});
  const tree=path.join(dest,prefix);fs.mkdirSync(tree,{recursive:true,mode:0o700});
  for(const [name,bytes] of files){const file=path.join(tree,name);fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});if(sha(fs.readFileSync(file))!==sha(bytes))throw Error('FOLLOWUP_BUNDLE_READBACK');}
  fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==3)throw Error('Usage: node scripts/linear-exit-followup-bundle.mjs ABSOLUTE_NEW_DIRECTORY');
  const result=buildFollowupBundle(process.argv[2]);console.log(JSON.stringify({format:result.format,files:result.files.length,installed:false}));
}
