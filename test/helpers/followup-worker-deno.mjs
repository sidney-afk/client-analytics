import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {connectFollowupDatabase} from '../../scripts/linear-exit-followup-postgres.mjs';
import {createImmutableSnapshotStorage} from '../../scripts/linear-exit-followup-transaction.mjs';
import {createHash} from 'node:crypto';
import {runClaimedFollowup} from '../../scripts/linear-exit-followup-worker.mjs';
import {composeFollowupHelper} from '../../scripts/linear-exit-followup-compose.mjs';
if(Deno.env.get('F63_REQUIRE_POSTGRES')!=='1'||Deno.env.get('PGHOST')!=='127.0.0.1')throw Error('DISPOSABLE_REQUIRED');
const url=new URL('postgresql://127.0.0.1');url.port=Deno.env.get('PGPORT');url.username=Deno.env.get('PGUSER');url.password=Deno.env.get('PGPASSWORD');url.pathname='/'+Deno.env.get('WORKER_TEST_DATABASE');
const database=connectFollowupDatabase(url.href,{isolated:true});
const realBegin=database.begin;
database.begin=async callback=>{try{return await realBegin(query=>callback(async(...args)=>{try{return await query(...args);}catch(e){fs.appendFileSync(path.join(Deno.env.get('PROOF_OUTPUT_ROOT'),'worker-sql.private-errors.log'),String(e)+'\n');throw e;}}));}catch(error){fs.appendFileSync(path.join(Deno.env.get('PROOF_OUTPUT_ROOT'),'worker-transaction.private-errors.log'),String(error.stack||error)+'\n');throw error;}};
let attempts=0;
try {
 const [deadlines]=await database.query("select current_setting('statement_timeout') as statement_timeout,current_setting('lock_timeout') as lock_timeout,current_user as role");
 if(deadlines.statement_timeout!=='7s'||deadlines.lock_timeout!=='5s'||deadlines.role!=='service_role')throw Error('STANDALONE_QUERY_BOUNDARIES');
 const capture=fs.readFileSync('qa/linear-exit-rehearsal/serving/samples-v50/functions/_shared/thumbnail-revisions.ts');
 const composed=composeFollowupHelper(capture),generated=path.join(Deno.env.get('PROOF_OUTPUT_ROOT'),'followup-helper-candidate.ts');fs.writeFileSync(generated,composed.source);
 const {createFollowupHelpers}=await import(pathToFileURL(generated).href);
 const tasks=JSON.parse(fs.readFileSync(path.join(Deno.env.get('PROOF_OUTPUT_ROOT'),'worker-tasks.private.json'),'utf8'));
 const results=[],objects=new Map();let uploads=0;
 Deno.env.set('GOOGLE_DRIVE_API_KEY','synthetic-local-only');
 tasks.sort((a,b)=>Number(a.kind==='graphic_resolution')-Number(b.kind==='graphic_resolution'));
 async function run(task){return runClaimedFollowup({database,task,createHelpers:createFollowupHelpers,storageFactory:({alive})=>createImmutableSnapshotStorage({alive,digest:async bytes=>createHash('sha256').update(bytes).digest('hex'),upload:async(bucket,key,bytes,options)=>{if(options.upsert!==false)throw Error('OVERWRITE');uploads++;if(objects.has(key))return {error:{statusCode:'409'}};objects.set(key,new Uint8Array(bytes));return {data:{path:key},error:null};},download:async(bucket,key)=>objects.get(key)}),fetch:async input=>{attempts++;const u=new URL(String(input));if(u.hostname!=='www.googleapis.com'||!u.pathname.startsWith('/drive/v3/files/'))throw Error('EGRESS_REFUSED');const v=task.kind==='graphic_resolution'?'2':'1';if(u.searchParams.get('alt')==='media')return new Response(new Uint8Array([137,80,78,71,Number(v)]),{headers:{'content-type':'image/png'}});return Response.json({id:'syntheticDriveFile12345',name:'Synthetic',mimeType:'image/png',modifiedTime:'2026-09-12T00:00:0'+v+'Z',md5Checksum:v.repeat(32),headRevisionId:v,size:'5'});}});}
 for(const task of tasks)results.push(await run(task));
 const snapshot=async()=>JSON.stringify(await database.query("select (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from thumbnail_media_revisions t) as revisions,(select coalesce(jsonb_agg(to_jsonb(t) order by operation_id,kind),'[]'::jsonb) from card_write_followups_v1 t) as tasks"));const priorRows=await snapshot();
 const priorUploads=uploads,priorObjects=objects.size;const stale=await run(tasks.find(t=>t.payload?.sourceId==='positive-worker'&&t.kind==='graphic_baseline'));
 if(stale.status==='completed'||uploads!==priorUploads||objects.size!==priorObjects||await snapshot()!==priorRows)throw Error('STALE_TASK_EFFECT');

 fs.writeFileSync(path.join(Deno.env.get('PROOF_OUTPUT_ROOT'),'worker-results.private.json'),JSON.stringify({standalone_query_deadlines:deadlines,results,attempts,uploads,object_count:objects.size,stale_refused:true,helper_sha256:composed.candidate_sha256}));
} finally {await database.close();}
