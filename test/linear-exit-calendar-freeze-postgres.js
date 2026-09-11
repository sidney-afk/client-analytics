'use strict';
// Isolated captured Calendar lock counterexample; no whole-application freeze proof.
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const crypto=require('crypto');const cp=require('child_process');const {pathToFileURL}=require('url');
const {Cluster}=require('../scripts/f42-apply-rehearsal');const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
const cluster=new Cluster();assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
const owner='migrations/2026-06-18-atomic-comment-merge.sql';
let locker;let stage='install';const originalPgOptions=process.env.PGOPTIONS;
async function main(){try{
 const inventory=install({},()=>null);
 const source=fs.readFileSync(path.join(__dirname,'..',owner));const hash=crypto.createHash('sha256').update(source).digest('hex');
 assert.equal(hash,'c354f499112921e8c6056f5ac9018cfd480d46e173c036e29cfe8165f7769927');
 cluster.runFile(path.join(__dirname,'..',owner));
 const aclSource='migrations/live-schema-baseline-2026-07-03.sql';const aclBytes=fs.readFileSync(path.join(__dirname,'..',aclSource));
 const aclHash=crypto.createHash('sha256').update(aclBytes).digest('hex');assert.equal(aclHash,'0fe101d62b3c03200e007a943ec442c75366f7467e25357085a623d21c68243f');
 const aclStatements=aclBytes.toString('utf8').match(/^grant (?:delete|insert|references|select|trigger|truncate|update) on table public\.calendar_posts to service_role;$/gm);assert.equal(aclStatements?.length,7);assert.equal(new Set(aclStatements).size,7);cluster.exec(aclStatements.join('\n'));
 assert.equal(cluster.scalarJson("select to_jsonb(has_table_privilege('service_role','public.calendar_posts','SELECT,INSERT,UPDATE'))"),true);
 assert.equal(cluster.scalarJson("select to_jsonb(has_table_privilege('service_role','public.calendar_post_events','INSERT') and has_sequence_privilege('service_role','public.calendar_post_events_id_seq','USAGE'))"),true);

 cluster.exec(`insert into public.clients(slug,display_name,active,kind) values('synthetic-freeze','Synthetic',true,'client');
 insert into public.calendar_posts(client,id,status) values('synthetic-freeze','synthetic-freeze-card','Draft');`);
 Object.assign(process.env,{PROOF_REPO_ROOT:path.resolve(__dirname,'..'),PROOF_HARNESS_ROOT:path.resolve(__dirname,'../qa/linear-exit-rehearsal/harness'),NIR_PGHOST:cluster.host,NIR_PGPORT:cluster.port,NIR_PGUSER:cluster.user,NIR_PGDATABASE:cluster.db,NIR_PSQL:cluster.psql,PGOPTIONS:'-c lock_timeout=1500 -c statement_timeout=5000'});
 const pending=[];let fetchAttempts=0;
 globalThis.Deno={env:{get:n=>({SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only'}[n])}};
 globalThis.EdgeRuntime={waitUntil:p=>pending.push(Promise.resolve(p))};
 globalThis.fetch=async()=>{fetchAttempts++;throw Error('NETWORK_FORBIDDEN');};
 const {loadCapturedCalendar,captureHashes}=await import(pathToFileURL(path.join(process.env.PROOF_HARNESS_ROOT,'load-captured-calendar.mjs')).href);
 const handler=await loadCapturedCalendar();
 const before=cluster.scalarJson(`select jsonb_build_object('events',(select count(*) from public.calendar_post_events where post_id='synthetic-freeze-card'),'outbox',(select count(*) from public.mirror_outbox))`);
 stage='outbox-lock';
 locker=cp.spawn(cluster.psql,['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h',cluster.host,'-p',cluster.port,'-U',cluster.user,'-d',cluster.db],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PGCLIENTENCODING:'UTF8'}});
 let errors='';locker.stderr.on('data',b=>errors+=b);
 await new Promise((resolve,reject)=>{let out='';const timeout=setTimeout(()=>reject(Error('LOCK_READY_TIMEOUT')),10000);locker.stdout.on('data',b=>{out+=b;if(out.includes('LOCK_READY')){clearTimeout(timeout);resolve();}});locker.on('error',reject);locker.on('exit',code=>{clearTimeout(timeout);if(code)reject(Error('LOCKER_FAILED'));});locker.stdin.write("begin; lock table public.mirror_outbox in share row exclusive mode; select 'LOCK_READY';\n");});
 const locked=()=>cluster.scalarJson(`select to_jsonb(exists(select 1 from pg_locks where relation='public.mirror_outbox'::regclass and mode='ShareRowExclusiveLock' and granted and pid<>pg_backend_pid()))`);
 assert.equal(locked(),true);
 stage='captured-calendar-handler';
 const priorOptions=process.env.PGOPTIONS;process.env.PGOPTIONS=priorOptions+' -c role=service_role';
 const shim=await import(pathToFileURL(path.join(process.env.PROOF_REPO_ROOT,'scripts/native-intake-manifest/supabase-shim.mjs')).href);
 const role=await shim.runSql('select current_user;');assert.equal(role.status,0);assert.equal(role.stdout.trim(),'service_role');
 const response=await handler.post({client:'synthetic-freeze',post:{id:'synthetic-freeze-card',status:'Published'}},{'content-type':'application/json','x-syncview-source':'ui'});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.notEqual(result._conflict,true);
 await Promise.all(pending);process.env.PGOPTIONS=priorOptions;assert.equal(locked(),true);assert.equal(fetchAttempts,0);
 const after=cluster.scalarJson(`select jsonb_build_object('status',(select status from public.calendar_posts where id='synthetic-freeze-card' and client='synthetic-freeze'),'events',(select count(*) from public.calendar_post_events where post_id='synthetic-freeze-card'),'action',(select action from public.calendar_post_events where post_id='synthetic-freeze-card' order by id desc limit 1),'outbox',(select count(*) from public.mirror_outbox))`);
 assert.equal(after.status,'Published');assert.equal(after.events,before.events+1);assert.equal(after.action,'status_change');assert.equal(after.outbox,before.outbox);
 locker.stdin.end('rollback;\n');await new Promise(resolve=>locker.once('close',resolve));locker=null;
 assert.equal(locked(),false);
 console.log(JSON.stringify({marker:'LINEAR_EXIT_CALENDAR_FREEZE_GAP_PROVEN',calendar_row_and_event_committed_under_outbox_lock:true,global_freeze_proven:false,activation_authorized:false,source_owner:owner,source_sha256:hash,selective_acl_supplement:{source:aclSource,source_sha256:aclHash,statement_count:aclStatements.length,statements:aclStatements},inventory_sha256:inventory.inventory_sha256,capture_hashes:captureHashes,scope:'ISOLATED_CAPTURED_HANDLER_SQL',sdk_transport:'SQL adapter, not hosted PostgREST',deferred_callbacks_drained:true,network_attempts:fetchAttempts,handler_database_role:"service_role"}));
 }catch(e){if(process.env.PROOF_OUTPUT_ROOT)fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'calendar-freeze.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_CALENDAR_FREEZE_FAILED',stage}));process.exitCode=1;}finally{if(originalPgOptions===undefined)delete process.env.PGOPTIONS;else process.env.PGOPTIONS=originalPgOptions;if(locker){locker.stdin.end('rollback;\n');await new Promise(resolve=>{locker.once('close',resolve);setTimeout(()=>{locker.kill();resolve();},2000);});}cluster.stop();}}
main();

