'use strict';
// Opt-in against an owner-started disposable LOOPBACK PostgreSQL instance.
// Creates one unique database; never manages the server or touches another DB.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync,spawn}=require('node:child_process');
const crypto=require('node:crypto');
if(process.env.WORKLOAD_TEST_CONFIRM!=='LOCAL_DISPOSABLE_ONLY'){
 console.log('SKIP Workload PostgreSQL lane: explicit disposable instance required');process.exit(0);
}
const root=path.resolve(__dirname,'..'),bin=process.env.WORKLOAD_TEST_PSQL,port=process.env.WORKLOAD_TEST_PORT;
if(!bin||!path.isAbsolute(bin)||!/^\d{4,5}$/.test(port||''))throw Error('Explicit psql and disposable port required');
const db='workload_'+crypto.randomBytes(8).toString('hex');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
const args=database=>['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',database];
function sql(text,database=db,refusal=false){const r=spawnSync(bin,args(database),{input:text,encoding:'utf8',env,windowsHide:true,timeout:30000,maxBuffer:16e6});
 if(refusal){assert.notEqual(r.status,0,'SQL negative control must refuse');return r.stderr;}
 if(r.status!==0)throw Error(r.stderr||'Local SQL failed');return r.stdout.trim();}
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function cut(file,start,end){const source=read(file),a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)throw Error('DDL seam drift');return source.slice(a,b);}
const json=query=>JSON.parse(sql(query));let checks=0,passed=false;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
(async()=>{
 sql(`create database ${db};`,'postgres');
 try{
 // Actual relevant B0/B1 owners, actual sidecar and native view. The legacy
 // mirror/flag fixture is intentionally minimal; its deployed schema is not
 // claimed. The production read view uses the actual label projection helper.
 sql(`do $$ begin create role anon; exception when duplicate_object then null; end $$;
 do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
 do $$ begin create role service_role; exception when duplicate_object then null; end $$;`);
 sql(cut('migrations/2026-07-05-b0-linear-auth-scaffold.sql','create extension','create table if not exists public.client_access'));
 sql(cut('migrations/2026-07-06-b1-linear-data-model.sql','create extension','create table if not exists public.deliverable_events'));
 sql(read('migrations/2026-07-19-workload-plan.sql'));
 sql(`create table syncview_runtime_flags(key text primary key,value jsonb);
 create table workload_issues(id text primary key,active boolean,is_sub_issue boolean,team_key text,team_name text,client_name text,status_type text);`);
 const labels=cut('migrations/2026-07-23-f34-f53-production-attachments.sql','create or replace function public.production_workload_label_projection','revoke all on function public.production_workload_label_projection');
 sql(labels+`create view production_deliverables_browser_v1 as select d.id,
 (p.value->>'complete')::boolean workload_labels_complete,p.value->'labels' workload_labels
 from deliverables d cross join lateral(select production_workload_label_projection(d.linear_raw) value) p;`);
 sql(read('migrations/2026-09-02-workload-native-view.sql'));
 sql(read('migrations/2026-09-05-workload-native-membership.sql'));
 checks++;
 sql(`insert into clients(slug,display_name)values('fixture','Fixture'),('other','Other');
 insert into team_members(id,name,role,team,active)values
 ('00000000-0000-0000-0000-000000000001','Fixture editor','editor','video',true),
 ('00000000-0000-0000-0000-000000000002','Fixture designer','designer','graphics',true),
 ('00000000-0000-0000-0000-000000000003','Fixture retired','editor','video',false),
 ('00000000-0000-0000-0000-000000000004','Fixture wrong role','smm','video',true);
 insert into batches(id,client_slug,name)values('bat_fixture','fixture','Fixture batch');
 insert into deliverables(id,batch_id,client_slug,team,kind,title,status,assignee_id,linear_issue_uuid,linear_raw)
 values('del_fixture','bat_fixture','fixture','video','video','Fixture work','todo',
 '00000000-0000-0000-0000-000000000001','old-fixture','{"issue":{"labels":{"nodes":[],"pageInfo":{"hasNextPage":false}}}}');
 insert into syncview_runtime_flags values('prod_authority','{"video":"syncview","graphics":"syncview"}');
 insert into workload_issues values('legacy-con',true,true,'CON','Content','Fixture','started'),
 ('legacy-str',true,true,'STR','Strategy','Fixture','started'),('old-fixture',true,true,'VID','Video','Fixture','started');
 insert into workload_plan values('old-fixture','fixture','2030-01-08','fixture',now());`);
 let value=json('select workload_native_snapshot_v1();');
 ok(value.count===4&&value.rows.length===4,'one parent/native work plus CON/STR, duplicate provider row omitted');
 ok(value.legacy_teams.sort().join(',')==='CON,STR','remaining team authorities explicit');
 ok(value.rows.find(r=>r.id==='del_fixture').native_assignee_eligible===true,'unmapped native editor eligible');
 ok(value.rows.find(r=>r.id==='del_fixture').native_metadata.workload_labels_complete===true,'actual complete native label projection');
 for(const member of [2,3,4]){sql(`update deliverables set assignee_id='00000000-0000-0000-0000-${String(member).padStart(12,'0')}' where id='del_fixture';`);
 ok(json('select workload_native_snapshot_v1();').rows.find(r=>r.id==='del_fixture').native_assignee_eligible===false,'wrong-team/inactive/wrong-role held');}
 sql(`update deliverables set assignee_id='00000000-0000-0000-0000-000000000001' where id='del_fixture';`);
 ok(json(`select workload_native_plan_target_v1('old-fixture');`).id==='del_fixture','old UUID resolves exact native owner');
 value=json(`select workload_native_plan_set_v1('del_fixture','fixture','fixture','2030-01-09','staff:admin');`);
 ok(value.updated===1&&value.plan.issue_id==='del_fixture'&&value.plan.storage_issue_id==='old-fixture','native save retains historical storage key');
 ok(sql('select count(*) from workload_plan;')==='1','no duplicate or migrated plan');
 sql(`select workload_native_plan_set_v1('del_fixture','other','fixture','2030-01-10','staff:admin');`,db,true);checks++;
 ok(sql(`select plan_date from workload_plan where issue_id='old-fixture';`)==='2030-01-09','scope refusal preserves plan');
 sql(`insert into workload_plan values('del_fixture','fixture','2030-01-11','fixture',now());`);
 sql(`select workload_native_plan_set_v1('del_fixture','fixture','fixture','2030-01-10','staff:admin');`,db,true);checks++;
 ok(sql('select count(*) from workload_plan;')==='2','conflicting aliases preserved on refusal');
 sql(`delete from workload_plan where issue_id='del_fixture';`);
 value=json(`select workload_native_plan_set_v1('del_fixture','fixture','fixture',null,'staff:admin');`);
 ok(value.updated===1&&value.plan.plan_date===null&&value.plan.storage_issue_id==='old-fixture','clear preserves historic row identity');
 for(const role of ['anon','authenticated']){
 for(const call of ['workload_native_snapshot_v1()',"workload_native_plan_target_v1('old-fixture')","workload_native_plan_set_v1('del_fixture','fixture','fixture',null,'fixture')"]){sql(`set role ${role};select ${call};`,db,true);checks++;}}
 ok(json('set role service_role;select workload_native_snapshot_v1();').complete===true,'service-only read capability');
 sql(`update syncview_runtime_flags set value='{"video":"linear","graphics":"syncview"}';`);
 value=json('select workload_native_snapshot_v1();');
 ok(value.rows.some(r=>r.id==='old-fixture'&&r.source==='legacy')&&!value.rows.some(r=>r.id==='del_fixture'),'provider authority keeps actual legacy membership');
 sql(`update syncview_runtime_flags set value='{}';`);sql('select workload_native_snapshot_v1();',db,true);checks++;
 sql(`update syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}';
 insert into deliverables(id,batch_id,client_slug,team,kind,title,status,linear_raw)
 select 'del_bulk_'||g,'bat_fixture','fixture','video','video','Synthetic work','todo',
 '{"issue":{"labels":{"nodes":[],"pageInfo":{"hasNextPage":false}}}}'::jsonb from generate_series(1,1005)g;`);
 value=json('select workload_native_snapshot_v1();');ok(value.count===1009&&new Set(value.rows.map(r=>r.id)).size===1009,'single RPC count covers population beyond REST page limit');
 // Real concurrent commit after the SELECT statement begins: the STABLE
 // function must retain its original statement snapshot, including plan rows.
 const child=spawn(bin,args(db),{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
 child.stdin.end("select pg_sleep(1),workload_native_snapshot_v1();");
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(stderr)));});
 await new Promise(r=>setTimeout(r,300));sql(`update workload_plan set plan_date='2030-02-01' where issue_id='old-fixture';`);
 await done;const during=JSON.parse(stdout.trim().replace(/^\|/,''));
 ok(during.plans.find(p=>p.issue_id==='old-fixture').plan_date===null,'snapshot cannot mix a later committed plan');
 ok(json('select workload_native_snapshot_v1();').plans.find(p=>p.issue_id==='old-fixture').plan_date==='2030-02-01','next snapshot observes plan-only update');
 const handler=spawnSync(process.execPath,['--experimental-strip-types',path.join(root,'qa/workload-native/handler.mjs')],{env:{...env,WORKLOAD_TEST_DB:db},encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4e6});
 process.stdout.write(handler.stdout||'');if(handler.status!==0)throw Error(handler.stderr||'Actual handler lane failed');
 passed=true;console.log(JSON.stringify({classification:'ISOLATED_POSTGRES',checks,source:'workload-native-membership',external_calls:0,limits:['minimal legacy/flag fixtures','consumed-column production view with real label helper','no installed schema or serving proof']}));
 }finally{if(passed)sql(`drop database ${db};`,'postgres');else console.error('Failed uniquely owned disposable database preserved: '+db);}
})().catch(e=>{console.error(e);process.exitCode=1;});
