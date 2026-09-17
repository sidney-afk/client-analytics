'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');const {pathToFileURL}=require('url');
const {Cluster}=require('../scripts/f42-apply-rehearsal');const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_REQUIRED');
const cluster=new Cluster(),owner='migrations/2026-06-18-atomic-comment-merge.sql';const original=process.env.PGOPTIONS;let stage='install';
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


 const samplesAcl=aclBytes.toString('utf8').match(/^grant (?:delete|insert|references|select|trigger|truncate|update) on table public\.(?:sample_reviews|sample_review_events) to service_role;$/gm);assert.equal(samplesAcl?.length,14);cluster.exec(samplesAcl.join('\n'));
 const merge='qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql';assert.equal(crypto.createHash('sha256').update(fs.readFileSync(merge)).digest('hex'),'31663a6b62bbc96efe85a8cdc8485c42f07f9455b5c043e2112ff07e36bba429');cluster.runFile(merge);
 cluster.runFile('supabase/migrations/20260912174907_card_atomic_admission_preparation.sql');
 cluster.exec("insert into clients(slug,display_name,active,kind) values('synthetic-atomic','Synthetic',true,'client');insert into calendar_posts(client,id,status) values('synthetic-atomic','atomic-card','Draft');insert into sample_reviews(client,id,status) values('synthetic-atomic','atomic-card','Draft');");
 Object.assign(process.env,{NIR_PGHOST:cluster.host,NIR_PGPORT:cluster.port,NIR_PGUSER:cluster.user,NIR_PGDATABASE:cluster.db,NIR_PSQL:cluster.psql});
 const pending=[];let escapes=0;globalThis.Deno={env:{get:n=>({SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only'}[n])}};globalThis.EdgeRuntime={waitUntil:p=>pending.push(Promise.resolve(p))};globalThis.fetch=async()=>{escapes++;throw Error('EGRESS_REFUSED');};
 const load=async n=>import(pathToFileURL(path.resolve('qa/linear-exit-rehearsal/harness',n)).href);
 const {loadCapturedCalendar}=await load('load-captured-calendar.mjs');const {loadAtomicCalendar}=await load('load-atomic-calendar.mjs');const {loadCapturedSamples}=await load('load-captured-samples.mjs');
 const options={};
 const {loadWriters}=await import(pathToFileURL(path.resolve('scripts/native-intake-reconcile/load-writers.mjs')).href);const repoControls=await loadWriters();for(const slug of ['calendar-upsert','sample-review-upsert']){const r=await repoControls.post(slug,{client:'synthetic-atomic',post:{id:'atomic-card'},sample:{id:'atomic-card'}});assert.equal(r.status,401);}
 const baseline=[await loadCapturedCalendar(),await loadCapturedSamples(options)];const candidates=[await loadAtomicCalendar(),await loadCapturedSamples({...options,atomic:true})];
 const shim=await import(pathToFileURL(path.resolve('scripts/native-intake-manifest/supabase-shim.mjs')).href);
 async function request(h,s,status){process.env.PGOPTIONS='-c role=service_role -c timezone=UTC';try{return await h.post({client:'synthetic-atomic',[s==='calendar'?'post':'sample']:{id:'atomic-card',status}},{'content-type':'application/json','x-syncview-source':'ui'});}finally{if(original===undefined)delete process.env.PGOPTIONS;else process.env.PGOPTIONS=original;}}
 const images=()=>cluster.scalarJson("select jsonb_build_object('calendar',(select to_jsonb(t) from calendar_posts t where id='atomic-card'),'samples',(select to_jsonb(t) from sample_reviews t where id='atomic-card'),'events',(select count(*) from calendar_post_events)+(select count(*) from sample_review_events),'operations',(select count(*) from card_write_operations_v1),'tasks',(select count(*) from card_write_followups_v1))");
 for(const [i,s] of ['calendar','samples'].entries()){
 stage=s+'-baseline';let r=await request(baseline[i],s,'Published');assert.equal(r.status,200);assert.equal((await r.json()).ok,true);await Promise.all(pending);
 stage=s+'-candidate';let before=images();r=await request(candidates[i],s,'Approved');assert.equal(r.status,200);assert.equal((await r.json()).ok,true);let after=images();assert.equal(after[s].status,'Approved');assert.equal(after.events,before.events+1);assert.equal(after.operations,before.operations+1);assert.equal(after.tasks,before.tasks+2);
 const table=s==='calendar'?'calendar_post_events':'sample_review_events';cluster.exec(`create function public.synthetic_atomic_fault() returns trigger language plpgsql as $$begin raise exception 'synthetic_event_fault_private';end$$;create trigger synthetic_atomic_fault before insert on ${table} for each row execute function public.synthetic_atomic_fault();`);
 stage=s+'-rollback';before=images();r=await request(candidates[i],s,'Draft');assert.equal(r.status,500);assert.ok(!(await r.text()).includes('synthetic_event_fault_private'));assert.deepEqual(images(),before);cluster.exec(`drop trigger synthetic_atomic_fault on ${table};drop function public.synthetic_atomic_fault();`);
 stage=s+'-cas';shim.hooks.beforeRpc=async name=>{if(name==='production_card_atomic_write_v1'){shim.hooks.beforeRpc=null;const opts=process.env.PGOPTIONS;delete process.env.PGOPTIONS;cluster.exec(`update ${s==='calendar'?'calendar_posts':'sample_reviews'} set status='Concurrent synthetic' where id='atomic-card'`);process.env.PGOPTIONS=opts;}};r=await request(candidates[i],s,'Draft');assert.equal(r.status,409);assert.equal((await r.json()).code,'write_conflict');assert.equal(images().operations,before.operations);assert.equal(images().tasks,before.tasks);
 }
 cluster.exec("select production_card_admission_close_v1((select epoch from card_write_admission_v1),'synthetic maintenance')");
 for(const [i,s] of ['calendar','samples'].entries()){stage=s+'-closed';const before=images();const r=await request(candidates[i],s,'Draft');assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,code:'maintenance',error:'Saving is temporarily paused for maintenance. Please try again shortly.'});assert.deepEqual(images(),before);}
 assert.equal(escapes,0);console.log(JSON.stringify({marker:'LINEAR_EXIT_CARD_ATOMIC_HANDLERS_OK',inventory_sha256:inventory.inventory_sha256,candidate_sha256:candidates.map(x=>x.production_sha256),network_attempts:escapes,durable_tasks_proven:true,worker_completion_proven:false,scope:'ISOLATED_HANDLER_SQL'}));
 }catch(e){fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'atomic-handlers.private-error.log'),String(e.stack||e));console.error(JSON.stringify({marker:'LINEAR_EXIT_CARD_ATOMIC_HANDLERS_FAILED',stage}));process.exitCode=1;}finally{if(original===undefined)delete process.env.PGOPTIONS;else process.env.PGOPTIONS=original;cluster.stop();}}
main();
