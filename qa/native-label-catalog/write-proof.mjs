// Actual gateway + existing combined migration fixture. All HTTP is replaced;
// each database operation is real disposable PostgreSQL. No installed claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(process.env.NATIVE_LABEL_WRITE_CONFIRM!=='LOCAL_DISPOSABLE_ONLY')throw Error('local_disposable_confirmation_required');
const cfg=JSON.parse(fs.readFileSync(process.env.NATIVE_LABEL_WRITE_CONFIG,'utf8'));
assert.equal(cfg.host,'127.0.0.1');assert(Number.isInteger(cfg.port)&&cfg.port>=1024&&cfg.port<=65535);
assert.equal(cfg.user,'postgres');assert(path.isAbsolute(cfg.psql));assert(path.isAbsolute(cfg.output));
assert(!path.resolve(cfg.output).startsWith(ROOT+path.sep),'private_output_required');fs.mkdirSync(cfg.output,{recursive:true});
for(const key of Object.keys(process.env))if(/^PG/i.test(key))delete process.env[key];
Object.assign(process.env,{PGPASSWORD:cfg.password,PGCLIENTENCODING:'UTF8',PGCONNECT_TIMEOUT:'5'});
const {LocalDatabase}=require('../../scripts/card-change-journal-rehearsal.js');
const {setup}=require('../../scripts/card-history-integrated-rehearsal.js');
const db=new LocalDatabase({...cfg,port:String(cfg.port)});
const sqlFile=path.join(cfg.output,'statement.private.sql');
db.raw=function(sql,database){fs.writeFileSync(sqlFile,"set time zone 'UTC';\n"+sql);return spawnSync(cfg.psql,[...this.args(database),'-w','-f',sqlFile],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,env:{...process.env,PGPASSWORD:cfg.password,PGOPTIONS:'-c statement_timeout=20000'}});};
const lit=v=>"'"+String(v).replace(/'/g,"''")+"'",j=v=>lit(JSON.stringify(v))+'::jsonb',uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cases=[],sha=x=>crypto.createHash('sha256').update(x).digest('hex');let providerCalls=0,background=0,provider='denied';
const report={classification:'DISPOSABLE_SQL_AND_ACTUAL_HANDLER',status:'RUNNING',cases};
const pinned=['supabase/functions/production-write/index.ts','index.html','migrations/2026-09-05-native-label-catalog-foundation.sql','migrations/2026-09-06-native-label-writes.sql','qa/native-label-catalog/write-proof.mjs'];
report.source_pins=Object.fromEntries(pinned.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))]));
function save(){fs.writeFileSync(path.join(cfg.output,'REPORT.private.json'),JSON.stringify(report,null,2)+'\n');}
function pass(name){cases.push(name);save();}
let handler;
try{
 db.create();report.database=db.name;save();setup(db,fs.readFileSync(path.join(ROOT,'migrations/2026-09-05-calendar-feedback-recovery.sql'),'utf8'));
 for(const name of ['2026-09-05-native-label-catalog-foundation.sql','2026-09-06-native-label-writes.sql'])db.query(fs.readFileSync(path.join(ROOT,'migrations',name),'utf8'));
 const servicePassword=crypto.randomBytes(24).toString('hex');
 db.query(`alter role service_role login password ${lit(servicePassword)}; grant select on public.deliverables,public.team_members,public.clients,public.client_access,public.mirror_outbox,public.syncview_runtime_flags to service_role;`);
 Object.assign(process.env,{NIR_PGHOST:cfg.host,NIR_PGPORT:String(cfg.port),NIR_PGUSER:'service_role',NIR_PGDATABASE:db.name,NIR_PSQL:cfg.psql,PGPASSWORD:servicePassword,
  ROLE_KEY_ADMIN:'synthetic-admin',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',LINEAR_MIRROR_API_KEY:'synthetic-provider'});
 const shim=await import(pathToFileURL(path.join(ROOT,'scripts/native-intake-manifest/supabase-shim.mjs')).href);
 globalThis.Deno={env:{get:name=>process.env[name]},serve:fn=>{handler=fn;}};
 globalThis.EdgeRuntime={waitUntil:()=>{background++;throw Error('unexpected drain');}};
 globalThis.fetch=async(url,options)=>{
  providerCalls++;if(url!=='https://api.linear.app/graphql'||provider==='denied')throw Error('provider refused');
  const {query,variables}=JSON.parse(options.body);let data;
  if(query.includes('SyncViewProductionLabelIssue'))data={issue:{id:uuid(500),team:{id:uuid(900)}}};
  else if(query.includes('SyncViewProductionLabelCatalog'))data={team:{id:uuid(900),key:'VIDEO'},issueLabels:{nodes:[node(1)],pageInfo:{hasNextPage:false,endCursor:null}}};
  else if(query.includes('SyncViewProductionSelectedLabels'))data={issue:{id:variables.id,team:{id:uuid(900)},labels:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}};
  else throw Error('unexpected provider operation');
  return new Response(JSON.stringify({data}),{headers:{'content-type':'application/json'}});
 };
 const edge='supabase/functions/production-write/index.ts',src=fs.readFileSync(path.join(ROOT,edge),'utf8');
 async function load(source,tag){
  const change=(a,b)=>{assert.equal(source.split(a).length,2);source=source.replace(a,b);};
  change('import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";',`import { createClient, SupabaseClient } from "${pathToFileURL(path.join(ROOT,'scripts/native-intake-manifest/supabase-shim.mjs')).href}";`);
  for(const rel of ['../_shared/staff-role-auth.ts','./selected-label-pages.mjs','../_shared/linear-create-id.mjs','./policy.mjs'])change(`from "${rel}";`,`from "${pathToFileURL(path.resolve(ROOT,'supabase/functions/production-write',rel)).href}";`);
  const file=path.join(cfg.output,tag+'.ts');fs.writeFileSync(file,source);await import(pathToFileURL(file).href);return handler;
 }
 const candidate=await load(src,'candidate');report.source_sha256=sha(src);
 const cloud=execFileSync('git',['--no-replace-objects','-c','extensions.partialClone=','show','892894e1b:supabase/functions/production-write/index.ts'],{cwd:ROOT,encoding:'utf8',env:{...process.env,GIT_NO_LAZY_FETCH:'1'}});
 const baseline=await load(cloud,'cloud-baseline');report.baseline_sha256=sha(cloud);
 const keyHeaders={'content-type':'application/json','x-syncview-key':'synthetic-admin','x-syncview-actor':'Fixture Admin'};
 const call=async(fn,body,headers=keyHeaders)=>{const response=await fn(new Request('http://synthetic.invalid',{method:'POST',headers,body:JSON.stringify(body)}));return{status:response.status,body:await response.json()};};
 const row=id=>db.rows(`select * from public.deliverables where id=${lit(id)}`)[0];
 const state=()=>Object.fromEntries(['deliverables','deliverable_events','mirror_outbox','card_change_journal'].map(t=>[t,db.rows(`select to_jsonb(t) row from public.${t} t order by to_jsonb(t)::text`)]));
 const policy=(mode,version=null)=>db.query(`update public.syncview_runtime_flags set value=${j({schema_version:1,mode,version_id:version,enabled:mode==='native'})} where key='production_native_label_catalog';`);
 const readBody=id=>({action:'labels_read',surface:'production',id});
 let seq=0;const operation=(id,ids,version=uuid(700))=>({operation:'labels',entity:'deliverable',surface:'production',id,request_id:'label-request-'+(++seq),
  source_edited_at:'2026-09-06T12:00:00Z',expected_updated_at:row(id).updated_at,label_ids:ids,catalog_version:version});
 const node=(n,extra={})=>({id:uuid(n),name:'Synthetic '+n,color:'#123456',description:null,isGroup:false,archivedAt:null,team:null,...extra});
 const manifest=nodes=>({schema_version:1,capture_id:uuid(800),source_kind:'linear_workspace_issue_labels',source_sha256:'a'.repeat(64),workspace_fingerprint:'b'.repeat(64),captured_at:'2026-09-06T10:00:00Z',include_archived:true,teams:{video:uuid(900),graphics:uuid(901)},expected_count:nodes.length,pages:[{after:null,nodes,pageInfo:{hasNextPage:false,endCursor:null}}]});
 const attestation=m=>({contract:'operator-reviewed-complete-export-v1',source_sha256:m.source_sha256,workspace_fingerprint:m.workspace_fingerprint,teams:m.teams,expected_count:m.expected_count,capture_id:m.capture_id,
  export_package_sha256:'c'.repeat(64),review_evidence_sha256:'d'.repeat(64),operator_subject:'fictional-operator',archived_pages_verified:true,independent_count_reconciled:true,reviewed_at:'2026-09-06T11:00:00Z'});
 const m=manifest([node(1),node(2,{team:{id:uuid(900)}}),node(3,{team:{id:uuid(901)}}),node(4,{archivedAt:'2026-09-01T00:00:00Z'}),node(5,{isGroup:true})]);
 const stage=(id,m,a=attestation(m))=>db.query(`set role service_role;select public.production_label_catalog_stage_attested(${lit(id)}::uuid,${j(m)},${j(a)});`);
 stage(uuid(700),m);stage(uuid(701),manifest([]));
 const attestedBefore=db.rows('select * from public.production_label_catalog_versions order by version_id');stage(uuid(700),m);assert.deepEqual(db.rows('select * from public.production_label_catalog_versions order by version_id'),attestedBefore);
 for(const [manifestValue,attestedValue,expected] of [[m,{...attestation(m),review_evidence_sha256:'bad'},'native_label_catalog_unverified'],[{...m,expected_count:6},attestation(m),'label_catalog_count_mismatch'],[m,{...attestation(m),operator_subject:'different-reviewer'},'label_catalog_version_conflict']]){
  const failed=db.raw(`set role service_role;select public.production_label_catalog_stage_attested(${lit(uuid(700))},${j(manifestValue)},${j(attestedValue)});`);assert.notEqual(failed.status,0);assert(failed.stderr.includes(expected));assert.deepEqual(db.rows('select * from public.production_label_catalog_versions order by version_id'),attestedBefore);
 }pass('attested stage exact replay is immutable; malformed evidence/incomplete manifest/changed attestation leave no residue');
 db.query("insert into public.batches(id,client_slug,name,purpose) values('labels-batch','fixture-client','Synthetic label batch','calendar');");
 for(const [id,team]of[['labelsv','video'],['labelsg','graphics'],['labelsp','video']])db.query(`insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,linear_raw) values(${lit(id)},'labels-batch','fixture-client',${lit(team)},${lit(team==='video'?'video':'thumbnail')},'Synthetic work','todo',${j({issue:{labelIds:[],labels:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}})});`);
 db.query(`update public.deliverables set linear_issue_uuid=${lit(uuid(500))} where id='labelsp';`);
 pass('actual existing F27/journal schema plus attested and empty immutable catalog installed in disposable fixture');
 policy('native',uuid(700));
 const old=await call(baseline,readBody('labelsv'));assert.equal(old.status,409);assert.equal(old.body.error,'linear_issue_unavailable');pass('cloud negative: native-only card still refused before catalog');
 for(const [id,ids]of[['labelsv',[uuid(1),uuid(2)]],['labelsg',[uuid(1),uuid(3)]]]){const start=providerCalls,r=await call(candidate,readBody(id));assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.body.catalog.map(x=>x.id),ids);assert.equal(providerCalls,start);pass(id+' actual native catalog read without provider issue identity');}
 let acceptedArgs;shim.hooks.beforeRpc=async(name,args)=>{if(name==='production_labels_write')acceptedArgs=structuredClone(args);};
 const write=operation('labelsv',[uuid(2),uuid(1)]);let start=providerCalls,r=await call(candidate,write);shim.hooks.beforeRpc=null;assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.mirror.not_applicable,true);assert.equal(providerCalls,start);
 const receipt=db.rows("select * from public.mirror_outbox where dedup_key like 'write-ui:labels:deliverable:labelsv:%'")[0];assert.equal(receipt.status,'skipped');assert.equal(receipt.linear_result.native_labels,true);assert.equal(receipt.payload._native_label_catalog_version,uuid(700));pass('native labels commit event/journal/terminal original-fingerprint receipt atomically with no provider attempt');
 policy('native',uuid(701));const before=state();r=await call(baseline,write);assert.equal(r.status,409);assert.equal(r.body.error,'write_conflict');pass('cloud negative: later catalog policy/CAS prevents accepted replay');
 policy('hold');
 r=await call(candidate,write);assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(state(),before);assert.equal(providerCalls,start);assert.equal(r.body.catalog_version,uuid(700));pass('accepted native replay survives hold with original version/fingerprint and no extra effects');
 r=await call(candidate,{...write,label_ids:[]});assert.equal(r.status,409);assert.equal(r.body.error,'idempotency_conflict');pass('changed intent on accepted identity conflicts before policy');
 db.query("update public.deliverables set title='Human edit after acceptance',status='in_progress' where id='labelsv';");const humanState=state();r=await call(candidate,write);assert.equal(r.status,200);assert.deepEqual(state(),humanState);assert.equal(row('labelsv').title,'Human edit after acceptance');pass('accepted replay preserves later human state and returns current row');
 const authorityValue=db.rows("select value from public.syncview_runtime_flags where key='prod_authority'")[0].value;
 db.query("update public.syncview_runtime_flags set value='{\"video\":\"linear\",\"graphics\":\"syncview\"}' where key='prod_authority';");start=providerCalls;const replayStart=state(),rpcStart=shim.hooks.log.filter(x=>x.kind==='rpc').length;
 r=await call(candidate,write);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.read_only,true);assert.equal(r.body.authority_source,'accepted_native_receipt');assert.deepEqual(state(),replayStart);assert.equal(providerCalls,start);assert.equal(shim.hooks.log.filter(x=>x.kind==='rpc').length,rpcStart);pass('exact native receipt adopts current row after authority flip with no RPC/write/provider');
 db.query(`set role service_role;select public.production_labels_write(${j(acceptedArgs.p_row)},${j(acceptedArgs.p_event)});`);assert.deepEqual(state(),replayStart);pass('actual service SQL exact native receipt is read-only across authority flip');
 const newAfterFlip=await call(candidate,operation('labelsv',[]));assert.equal(newAfterFlip.status,409);assert.equal(newAfterFlip.body.error,'team_is_linear_authoritative');assert.deepEqual(state(),replayStart);assert.equal(providerCalls,start);pass('new request remains refused under changed authority');
 db.query(`insert into public.team_members(id,name,role,active) values(${lit(uuid(887799))},'Other Admin','admin',true);`);
 const wrongActor=await call(candidate,write,{...keyHeaders,'x-syncview-actor':'Other Admin'});assert.equal(wrongActor.status,409);assert.equal(wrongActor.body.error,'idempotency_conflict');assert.deepEqual(state(),replayStart);assert.equal(providerCalls,start);pass('current authenticated different actor cannot adopt another native receipt');
 db.query("delete from public.syncview_runtime_flags where key='prod_authority';");r=await call(candidate,write);assert.equal(r.status,200);assert.deepEqual(state(),replayStart);assert.equal(providerCalls,start);assert.equal((await call(candidate,operation('labelsv',[]))).status,503);pass('missing current authority permits only exact read-only receipt adoption');
 db.query(`insert into public.syncview_runtime_flags(key,value) values('prod_authority',${j(authorityValue)});revoke select on public.syncview_runtime_flags from service_role;`);
 r=await call(candidate,write);assert.equal(r.status,200);assert.deepEqual(state(),replayStart);assert.equal(providerCalls,start);assert.equal((await call(candidate,operation('labelsv',[]))).status,503);db.query('grant select on public.syncview_runtime_flags to service_role;');pass('actual denied authority read permits only exact read-only receipt adoption');
 for(const value of [false,0,'',{},null]){db.query(`update public.syncview_runtime_flags set value=${j(value)} where key='production_native_label_catalog';`);start=providerCalls;r=await call(baseline,readBody('labelsp'));assert.equal(r.status,503);assert(providerCalls>start);start=providerCalls;r=await call(candidate,readBody('labelsv'));assert.equal(r.status,503);assert.equal(providerCalls,start);pass('cloud false-fallback / candidate refusal for malformed capability '+JSON.stringify(value));}
 policy('native',uuid(700));r=await call(candidate,operation('labelsv',[],uuid(701)));assert.equal(r.status,409);assert.equal(r.body.error,'native_label_catalog_changed');pass('stale picker catalog version cannot authorize a new write');
 for(const bad of [uuid(3),uuid(4),uuid(5),uuid(999)]){const before=state();r=await call(candidate,operation('labelsv',[bad]));assert.equal(r.status,400,JSON.stringify(r));assert.equal(r.body.error,'label_not_applicable');assert.deepEqual(state(),before);pass('foreign/archive/group/unknown new selection refused '+bad.slice(-3));}
 const historical=[{id:uuid(4),name:'Historical archived'},{id:uuid(999),name:'Historical absent',color:'#abcdef'}];
 db.query(`update public.deliverables set linear_raw=${j({issue:{labelIds:historical.map(n=>n.id),labels:{nodes:historical,pageInfo:{hasNextPage:false,endCursor:null}}},unrelated:'preserved'})} where id='labelsv';`);
 r=await call(candidate,operation('labelsv',[uuid(4),uuid(999),uuid(1)]));assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.body.selected_label_ids,[uuid(1),uuid(4),uuid(999)]);assert.equal(row('labelsv').linear_raw.unrelated,'preserved');pass('archived and absent selected UUIDs remain selectable with legacy color defaults and unrelated metadata conserved');
 const clear=operation('labelsv',[]);r=await call(candidate,clear);assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.body.selected_label_ids,[]);pass('explicit clear commits through actual SQL');
 const noop=operation('labelsv',[]);r=await call(candidate,noop);assert.equal(r.status,200);const afterNoop=state();assert.equal((await call(candidate,noop)).status,200);assert.deepEqual(state(),afterNoop);pass('legitimate empty no-op receives one idempotent receipt');
 policy('native',uuid(701));r=await call(candidate,readBody('labelsg'));assert.equal(r.status,200);assert.deepEqual(r.body.catalog,[]);r=await call(candidate,operation('labelsg',[],uuid(701)));assert.equal(r.status,200,JSON.stringify(r));pass('attested complete-empty catalog supports read and clear');
 policy('native',uuid(700));let savedArgs;shim.hooks.beforeRpc=async(name,args)=>{if(name==='production_labels_write'){savedArgs=structuredClone(args);policy('native',uuid(701));}};
 const raceBefore=state();r=await call(candidate,operation('labelsv',[uuid(1)]));shim.hooks.beforeRpc=null;assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.error,'native_label_catalog_changed');assert.deepEqual(state(),raceBefore);pass('catalog activation race refused under atomic SQL capability lock');
 policy('native',uuid(700));const generationBefore=state();let staleGenerationArgs;shim.hooks.beforeRpc=async(name,args)=>{if(name==='production_labels_write'){staleGenerationArgs=structuredClone(args);db.query("update public.track_b_f27_team_fences set generation=generation+1 where team='video';");}};
 r=await call(candidate,operation('labelsv',[uuid(1)]));shim.hooks.beforeRpc=null;assert.equal(r.status,500,JSON.stringify(r));assert.equal(r.body.error,'native_write_failed');assert.deepEqual(state(),generationBefore);
 const staleSql=db.raw(`set role service_role;select public.production_labels_write(${j(staleGenerationArgs.p_row)},${j(staleGenerationArgs.p_event)});`);assert.notEqual(staleSql.status,0);assert.match(staleSql.stderr,/f27_authority_generation_stale:video/);assert.deepEqual(state(),generationBefore);pass('actual F27 generation race refuses labels/event/receipt transaction with existing wait-class response');
 // A real writer transaction waits inside its event insert AFTER taking the
 // capability SHARE lock. A concurrent activation must wait until it commits.
 policy('native',uuid(700));
 db.query("create function public.label_lock_probe() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(7654321);return new;end;$$;create trigger label_lock_probe before insert on public.deliverable_events for each row execute function public.label_lock_probe();");
 function session(sql,keepOpen=false){const child=spawn(cfg.psql,[...db.args(),'-w'],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PGPASSWORD:cfg.password,PGOPTIONS:'-c statement_timeout=20000'}});let out='',err='';const done=new Promise(resolve=>{child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('close',status=>resolve({status,out,err}));});if(keepOpen)child.stdin.write(sql+'\n');else child.stdin.end(sql+'\n');return{child,done};}
 async function observed(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('required_database_wait_not_observed');}
 const blocker=session("set application_name='label_blocker';select pg_advisory_lock(7654321);",true);let concurrentWrite,activation;
 try{
  await observed(()=>Number(db.rows("select count(*) n from pg_locks l join pg_stat_activity a using(pid) where a.application_name='label_blocker' and l.locktype='advisory' and l.granted")[0].n)===1);
  concurrentWrite=call(candidate,operation('labelsv',[uuid(1)]));
  await observed(()=>Number(db.rows("select count(*) n from pg_stat_activity where wait_event='advisory' and query like '%production_labels_write%'")[0].n)===1);
  activation=session(`set application_name='label_activation';update public.syncview_runtime_flags set value=${j({schema_version:1,mode:'native',version_id:uuid(701)})} where key='production_native_label_catalog';`);
  await observed(()=>Number(db.rows("select count(*) n from pg_stat_activity where application_name='label_activation' and wait_event_type='Lock'")[0].n)===1);
 }finally{blocker.child.stdin.end('select pg_advisory_unlock(7654321);\n\\q\n');await blocker.done;}
 r=await concurrentWrite;assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.catalog_version,uuid(700));assert.equal((await activation.done).status,0);assert.equal(db.rows("select value from public.syncview_runtime_flags where key='production_native_label_catalog'")[0].value.version_id,uuid(701));
 db.query('drop trigger label_lock_probe on public.deliverable_events;drop function public.label_lock_probe();');pass('observed concurrent catalog activation waits for native commit and cannot change its accepted version');
 policy('native',uuid(700));db.query("create function public.label_journal_fault() returns trigger language plpgsql as $$begin raise exception 'synthetic_journal_failure';end;$$;create trigger label_journal_fault before insert on public.card_change_journal for each row execute function public.label_journal_fault();");
 const faultBefore=state();r=await call(candidate,operation('labelsv',[uuid(1)]));assert(r.status>=500);assert.deepEqual(state(),faultBefore);db.query('drop trigger label_journal_fault on public.card_change_journal;drop function public.label_journal_fault();');pass('journal refusal rolls labels/event/native receipt back together');
 for(const query of ["delete from public.mirror_outbox where id="+receipt.id,"truncate public.mirror_outbox,public.track_b_team_rollback_intents restrict"]){const before=state(),failure=db.raw(query);assert.notEqual(failure.status,0);assert.match(failure.stderr,/native_label_receipt_retained/);assert.deepEqual(state(),before);pass('native receipt retention refuses '+query.split(' ')[0]);}
 for(const role of ['anon','authenticated']){const failure=db.raw(`set role ${role};select public.production_labels_write('{}','{}');`);assert.notEqual(failure.status,0);assert.match(failure.stderr,/permission denied/);pass(role+' cannot invoke native label writer');}
 db.query("insert into public.client_access(slug,review_token) values('fixture-client','synthetic-token') on conflict(slug) do update set review_token=excluded.review_token;");
 const forbidden=await call(candidate,readBody('labelsv'),{'content-type':'application/json','x-syncview-client-token':'synthetic-token'});assert.equal(forbidden.status,403,JSON.stringify(forbidden));pass('active client caller cannot obtain native staff label catalog');
 // Provider history remains an original provider receipt, even while new work
 // is held. A replay must not launch the provider drainer.
 policy('provider');provider='healthy';db.query(`update public.deliverables set linear_issue_uuid=${lit(uuid(500))} where id='labelsp';`);
 const providerWrite=operation('labelsp',[uuid(1)]);r=await call(candidate,providerWrite);assert.equal(r.status,200,JSON.stringify(r));const providerState=state();policy('hold');provider='denied';start=providerCalls;r=await call(candidate,providerWrite);assert.equal(r.status,200);assert.equal(r.body.mirror_pending,true);assert.equal(providerCalls,start);assert.deepEqual(state(),providerState);pass('provider-era accepted receipt survives hold without conversion or drainer restart');
 assert.equal(background,0);report.status='PASS';report.passed=cases.length;report.provider_requests_synthetic_or_denied=providerCalls;report.background_drains=background;
 assert.deepEqual(Object.fromEntries(pinned.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))])),report.source_pins,'tested source must remain unchanged');
 report.migration_hashes=Object.fromEntries(['2026-09-05-native-label-catalog-foundation.sql','2026-09-06-native-label-writes.sql'].map(f=>[f,sha(fs.readFileSync(path.join(ROOT,'migrations',f)))]));
 report.limits=['Synthetic operator attestation is not verified live export evidence','Existing combined migration fixture is not installed schema reconstruction','No live calls, activation, recovery coverage or serving proof','HTTP fetch entirely substituted; not an external socket receiver proof'];save();console.log(JSON.stringify({status:report.status,passed:report.passed,provider_requests_synthetic_or_denied:providerCalls}));
}catch(error){report.status='FAIL';report.error=String(error.stack);save();console.error('Native label actual-source/SQL proof failed; inspect private retained receipt.');process.exitCode=1;}
