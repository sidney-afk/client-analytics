'use strict';
// Opt-in against an owner-started disposable LOOPBACK PostgreSQL instance.
// Creates one unique database; never manages the server or touches another DB.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync,spawn}=require('node:child_process');
const crypto=require('node:crypto');
if(process.env.WORKLOAD_TEST_CONFIRM!=='LOCAL_DISPOSABLE_ONLY'){
 if(process.env.WORKLOAD_TEST_REQUIRE==='1')throw Error('Required Workload SQL lane needs explicit disposable confirmation');
 console.log('SKIP Workload PostgreSQL lane: explicit disposable instance required');process.exit(0);
}
const root=path.resolve(__dirname,'..'),bin=process.env.WORKLOAD_TEST_PSQL,port=process.env.WORKLOAD_TEST_PORT;
if(!bin||!path.isAbsolute(bin)||!/^\d{4,5}$/.test(port||''))throw Error('Explicit psql and disposable port required');
if(process.env.WORKLOAD_TEST_REQUIRE==='1'&&!process.env.WORKLOAD_TEST_PASSWORD)throw Error('Required Workload SQL lane needs an explicit fixture password');
const db='workload_'+crypto.randomBytes(8).toString('hex');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
// Discard ambient PG* environment variables, restoring only the explicit fixture
// password. Every client command fixes its loopback host, port, user and database.
if(process.env.WORKLOAD_TEST_PASSWORD!==undefined)env.PGPASSWORD=process.env.WORKLOAD_TEST_PASSWORD;
const args=database=>['-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',database];
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
 create table workload_issues(id text primary key,active boolean,is_sub_issue boolean,team_key text,team_name text,client_name text,status_type text,assignee_id text);`);
 const labels=cut('migrations/2026-07-23-f34-f53-production-attachments.sql','create or replace function public.production_workload_label_projection','revoke all on function public.production_workload_label_projection');
 sql(labels+`create view production_deliverables_browser_v1 as select d.id,
 (p.value->>'complete')::boolean workload_labels_complete,p.value->'labels' workload_labels
 from deliverables d cross join lateral(select production_workload_label_projection(d.linear_raw) value) p;`);
 sql(read('migrations/2026-09-02-workload-native-view.sql'));
 sql(read('migrations/2026-09-05-workload-native-membership.sql'));
 sql(read('migrations/2026-09-08-workload-native-label-state-shape.sql'));
 sql(read('migrations/2026-09-09-workload-native-roster.sql'));
 checks++;
 sql(`insert into clients(slug,display_name)values('fixture','Fixture'),('other','Other');
 insert into team_members(id,name,role,team,active,linear_user_id)values
 ('00000000-0000-0000-0000-000000000001','Fixture editor','editor','video',true,'provider-editor'),
 ('00000000-0000-0000-0000-000000000002','Fixture designer','designer','graphics',true,'provider-designer'),
 ('00000000-0000-0000-0000-000000000003','Fixture retired','editor','video',false,'provider-retired'),
 ('00000000-0000-0000-0000-000000000004','Fixture wrong role','smm','video',true,'provider-manager'),
 ('00000000-0000-0000-0000-000000000005','Fixture zero work','editor','video',true,null);
 -- Active cross-role/cross-team rows must never leak into the creative roster.
 insert into team_members(id,name,role,team,active,linear_user_id)values
 ('00000000-0000-0000-0000-000000000006','Fixture cross role','designer','video',true,'provider-cross');
 insert into batches(id,client_slug,name)values('bat_fixture','fixture','Fixture batch');
 insert into deliverables(id,batch_id,client_slug,team,kind,title,status,assignee_id,linear_issue_uuid,linear_raw)
 values('del_fixture','bat_fixture','fixture','video','video','Fixture work','todo',
 '00000000-0000-0000-0000-000000000001','old-fixture','{"issue":{"labels":{"nodes":[],"pageInfo":{"hasNextPage":false}}}}');
 insert into syncview_runtime_flags values('prod_authority','{"video":"syncview","graphics":"syncview"}');
 insert into workload_issues values('legacy-con',true,true,'CON','Content','Fixture','started',null),
 ('legacy-str',true,true,'STR','Strategy','Fixture','started',null),
 ('old-fixture',true,true,'VID','Video','Fixture','started','provider-editor');
 insert into workload_plan values('old-fixture','fixture','2030-01-08','fixture',now());`);
 let value=json('select workload_native_snapshot_v1();');
 ok(value.count===4&&value.rows.length===4,'one parent/native work plus CON/STR, duplicate provider row omitted');
 ok(value.legacy_teams.sort().join(',')==='CON,STR','remaining team authorities explicit');
 ok(value.rows.find(r=>r.id==='del_fixture').native_assignee_eligible===true,'mapped native editor eligible');
 ok(value.rows.find(r=>r.id==='del_fixture').native_metadata.workload_labels_complete===true,'actual complete native label projection');
 const rosterIds=value.roster.map(r=>r.id);
 ok(value.roster.length===3&&new Set(rosterIds).size===3,'roster contains each active exact-role creative member once');
 ok(rosterIds.includes('provider-editor')&&value.rows.find(r=>r.id==='del_fixture').assignee_id==='provider-editor',
  'retained provider alias keys both the active roster card and native work, preventing a free/busy split');
 ok(value.roster.some(r=>r.native_id==='00000000-0000-0000-0000-000000000005'
  &&r.id==='00000000-0000-0000-0000-000000000005'),'active zero-task editor is returned under the stable native fallback id');
 ok(!value.roster.some(r=>['00000000-0000-0000-0000-000000000003','provider-manager','provider-cross'].includes(r.id)),
  'inactive, wrong-role and cross-role members cannot leak into the roster');
 // A3, the release gate, EXECUTED rather than pattern-matched. `linear_raw`
 // with no `issue` at all is the exact and permanent shape of every deliverable
 // the native intake paths write once `linear_outbound_enabled` is off, because
 // linear-outbound is what adds `issue` on drain. If that reads back as an
 // incomplete label state the browser blanks the entire board on the first post
 // created after the flip. It must read back complete-with-no-labels (weight 1x),
 // while a genuinely MALFORMED relation must still read back incomplete.
 sql(`insert into deliverables(id,batch_id,client_slug,team,kind,title,status,linear_raw)values
 ('del_a3_absent','bat_fixture','fixture','video','video','Post-cutoff intake row','todo','{"attribution":{"client":"fixture"}}'),
 ('del_a3_nullraw','bat_fixture','fixture','video','video','No raw at all','todo',null),
 ('del_a3_noissue','bat_fixture','fixture','video','video','Issue stamped without labels','todo','{"issue":{"id":"x"}}'),
 ('del_a3_broken','bat_fixture','fixture','video','video','Paginated label relation','todo',
  '{"issue":{"labels":{"nodes":[],"pageInfo":{"hasNextPage":true}}}}');`);
 const a3=json('select workload_native_snapshot_v1();');
 const a3row=id=>a3.rows.find(r=>r.id===id).native_metadata;
 for(const id of ['del_a3_absent','del_a3_nullraw','del_a3_noissue']){
  ok(a3row(id).workload_labels_complete===true,`A3: ${id} reads back complete with no provider label state`);
  ok(Array.isArray(a3row(id).workload_labels)&&a3row(id).workload_labels.length===0,`A3: ${id} carries an empty label array, so it weighs 1x`);}
 ok(a3row('del_a3_broken').workload_labels_complete===false,
  'A3: a paginated/malformed label relation is still refused -- only the ABSENT case is opened');
 // ABSENT vs WRONG-TYPE. `is distinct from 'object'` was true for a scalar or an
 // array as well as for absence, so a linear_raw of the wrong SHAPE was
 // certified provably-unlabelled -- weight 1x, projection skipped -- instead of
 // refused. That inverts the rule the migration states for itself. Only real
 // absence may answer true; a present-but-wrong type is unprovable.
 for(const raw of ['\'"a string"\'','\'[]\'','\'42\'','\'true\'','\'{"issue":[]}\'','\'{"issue":"x"}\''])
  ok(sql(`select workload_native_label_state_absent(${raw}::jsonb);`)==='f',
   `a malformed label state stays unprovable, not absent: ${raw}`);
 ok(sql(`select workload_native_label_state_absent(null::jsonb);`)===''
  ||sql(`select workload_native_label_state_absent('null'::jsonb);`)==='t','a genuinely absent raw is still absent');
 ok(sql(`select workload_native_label_state_absent('{}'::jsonb);`)==='t','an object with no issue is still the post-cutoff absent shape');
 ok(sql(`select workload_native_label_state_absent('{"issue":{}}'::jsonb);`)==='t','an issue with no labels relation is still absent');
 ok(sql(`select workload_native_label_state_absent('{"attribution":{}}'::jsonb);`)==='t'
  &&sql(`select workload_native_label_state_absent('{"issue":{"labels":{"nodes":[],"pageInfo":{"hasNextPage":false}}}}'::jsonb);`)==='f',
  'A3: the predicate separates absent label state from a present one');
 sql(`delete from deliverables where id like 'del_a3_%';`);
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
 const serviceSnapshot=json('set role service_role;select workload_native_snapshot_v1();');
 ok(serviceSnapshot.complete===true&&serviceSnapshot.roster.length===3,'service-only read returns the complete roster');
 sql(`update syncview_runtime_flags set value='{"video":"linear","graphics":"syncview"}';`);
 value=json('select workload_native_snapshot_v1();');
 const legacy=value.rows.find(r=>r.id==='old-fixture'&&r.source==='legacy');
 ok(legacy&&legacy.native_assignee_eligible===true&&!value.rows.some(r=>r.id==='del_fixture'),'provider authority keeps exact server-derived legacy membership');
 ok(value.roster.some(r=>r.id==='provider-editor')&&new Set(value.roster.map(r=>r.id)).size===value.roster.length,
  'rollback roster uses the same retained alias without duplicate capacity cards');
 sql(`update workload_issues set assignee_id='provider-manager' where id='old-fixture';`);
 ok(json('select workload_native_snapshot_v1();').rows.find(r=>r.id==='old-fixture').native_assignee_eligible===false,
  'legacy wrong-role assignee is refused by server membership');
 sql(`update workload_issues set assignee_id='provider-editor' where id='old-fixture';`);
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
