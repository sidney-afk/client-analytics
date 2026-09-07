// Full, unchanged request handler and shared authorization over disposable SQL.
// Only Supabase transport, Deno environment/serve and external fetch are replaced.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(process.env.WORKLOAD_TEST_CONFIRM!=='LOCAL_DISPOSABLE_ONLY'||!/^workload_[a-f0-9]{16}$/.test(process.env.WORKLOAD_TEST_DB||''))throw Error('Disposable SQL binding required');
const psql=process.env.WORKLOAD_TEST_PSQL,port=process.env.WORKLOAD_TEST_PORT,database=process.env.WORKLOAD_TEST_DB;
if(!path.isAbsolute(psql||'')||!/^\d{4,5}$/.test(port||''))throw Error('Explicit local transport required');
if(process.env.WORKLOAD_TEST_REQUIRE==='1'&&!process.env.WORKLOAD_TEST_PASSWORD)throw Error('Required Workload SQL lane needs an explicit fixture password');
const sqlEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
if(process.env.WORKLOAD_TEST_PASSWORD!==undefined)sqlEnv.PGPASSWORD=process.env.WORKLOAD_TEST_PASSWORD;
const quote=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'";
function sql(text){const r=spawnSync(psql,['-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',database],{input:text,encoding:'utf8',env:sqlEnv,windowsHide:true,timeout:10000,maxBuffer:16e6});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
let rpcFault=false, rpcCalls=0, legacyWrites=0, external=0;
const db={rpc:async(name,params={})=>{rpcCalls++;if(rpcFault)return {data:null,error:{code:'fixture-refusal'}};
 if(!['workload_native_snapshot_v1','workload_native_plan_target_v1','workload_native_plan_set_v1'].includes(name))throw Error('Unapproved SQL RPC');
 try {return {data:JSON.parse(sql(`select public.${name}(${Object.entries(params).map(([k,v])=>k+'=>'+quote(v)).join(',')});`)||'null'),error:null};}
 catch {return {data:null,error:{code:'sql_refused'}};}},
 from:table=>{if(!['workload_plan','workload_issues','syncview_runtime_flags','clients','client_access'].includes(table))throw Error('Unapproved SQL table');
 let columns='*',where=[],write=null,one=false;const run=()=>{try{let result;
 if(write){legacyWrites++;const cols=Object.keys(write);result=sql(`with written as(insert into ${table}(${cols.join(',')}) values(${cols.map(c=>quote(write[c])).join(',')}) on conflict(issue_id)do update set plan_date=excluded.plan_date,updated_by=excluded.updated_by,updated_at=excluded.updated_at returning *)select coalesce(jsonb_agg(to_jsonb(written)),'[]')from written;`);}
 else result=sql(`select coalesce(jsonb_agg(to_jsonb(r)),'[]')from(select ${columns} from ${table}${where.length?' where '+where.join(' and '):''})r;`);
 const rows=JSON.parse(result);return {data:one?(rows[0]||null):rows,error:null};}catch{return {data:null,error:{code:'sql_refused'}};}};
 const q={select(c){columns=c;return q;},eq(k,v){where.push(k+'='+quote(v));return q;},maybeSingle(){one=true;return Promise.resolve(run());},upsert(v){write=v;return q;},then(a,b){return Promise.resolve(run()).then(a,b);}};return q;}};
globalThis.__workloadDb=db;
globalThis.fetch=async()=>{external++;throw Error('External transport prohibited');};
const secrets={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',ROLE_KEY_ADMIN:'fixture-admin',ROLE_KEY_SMM:'fixture-smm',ROLE_KEY_CREATIVE:'fixture-creative'};
let handler;globalThis.Deno={env:{get:key=>secrets[key]},serve:value=>handler=value};
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'workload-handler-'));
const current=fs.readFileSync(path.join(root,'supabase/functions/workload-plan/index.ts'),'utf8');
function rewritten(source){const importPattern=/import \{\s*createClient,\s*type SupabaseClient,\s*\} from "npm:@supabase\/supabase-js@2\.49\.8";/;
 if(!importPattern.test(source))throw Error('Handler loader import drift');
 return source.replace(importPattern,'const createClient=()=>globalThis.__workloadDb; type SupabaseClient=any;')
 .replaceAll('"../_shared/browser-write-auth.ts"',JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/_shared/browser-write-auth.ts')).href))
 .replaceAll('"../_shared/staff-role-auth.ts"',JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/_shared/staff-role-auth.ts')).href))
 .replaceAll('"./native-snapshot.mjs"',JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/workload-plan/native-snapshot.mjs')).href));}
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
async function request(body,key='fixture-admin',extra={}){const response=await handler(new Request('https://fixture.invalid/workload-plan',{method:'POST',headers:{'content-type':'application/json',...(key?{'x-syncview-key':key}:{}),...extra},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};}
const log=console.log;console.log=()=>{};
try{
 const file=path.join(scratch,'candidate.ts');fs.writeFileSync(file,rewritten(current));await import(pathToFileURL(file).href);
 for(const key of ['fixture-admin','fixture-smm','fixture-creative']){const r=await request({action:'native_snapshot'},key);ok(r.status===200&&r.body.complete&&r.body.count===1009,'actual staff reader exposes complete native snapshot');}
 let before=rpcCalls;let r=await request({action:'native_snapshot'},'');ok(r.status===401&&rpcCalls===before,'anonymous refused before native roster/plan read');
 r=await request({action:'native_snapshot'},'bad',{'x-syncview-role':'admin'});ok(r.status===401&&rpcCalls===before,'forged role cannot read private snapshot');
 r=await request({action:'set',issue_id:'del_fixture',client:'Fixture',plan_date:'2030-03-01'},'fixture-creative');ok(r.status===403,'creative writer policy unchanged');
 r=await request({action:'set',issue_id:'del_fixture',client:'Other',plan_date:'2030-03-01'});ok(r.status===409,'wrong exact client refuses');
 for(const id of ['del_fixture','old-fixture']){r=await request({action:'set',issue_id:id,client:'Fixture',plan_date:'2030-03-01'});
 ok(r.status===200&&r.body.updated===1&&r.body.plan.issue_id===id,'actual native/old-ID writer preserves requested acknowledgement');}
 ok(sql("select count(*)from workload_plan where issue_id in('old-fixture','del_fixture');")==='1','actual handler never duplicates plan storage');
 r=await request({action:'list'});ok(r.status===200&&r.body.plans.filter(p=>p.plan_date==='2030-03-01').length===2,'old list exposes both aliases of one stored row');
 rpcFault=true;r=await request({action:'native_snapshot'});ok(r.status===503,'missing SQL capability is failed read, never empty success');
 before=legacyWrites;r=await request({action:'set',issue_id:'legacy-con',client:'Fixture',plan_date:'2030-03-01'});ok(r.status===503&&legacyWrites===before,'unreadable native ownership never falls through to legacy write');rpcFault=false;
 r=await request({action:'set',issue_id:'legacy-con',client:'Fixture',plan_date:'2030-03-01'});ok(r.status===200&&legacyWrites===before+1,'explicit CON compatibility writes existing sidecar path');
 sql("insert into workload_issues values('legacy-video-only',true,true,'VID','Video','Fixture','started');");
 r=await request({action:'set',issue_id:'legacy-video-only',client:'Fixture',plan_date:'2030-03-01'});ok(r.status===409,'native-authority orphan cannot be rescued by provider row');
 sql("update syncview_runtime_flags set value='{}';");r=await request({action:'set',issue_id:'legacy-video-only',client:'Fixture',plan_date:'2030-03-01'});ok(r.status===503,'unreadable authority cannot authorize provider fallback');
 sql("update syncview_runtime_flags set value='{\"video\":\"linear\",\"graphics\":\"syncview\"}';");r=await request({action:'set',issue_id:'legacy-video-only',client:'Fixture',plan_date:'2030-03-01'});ok(r.status===200,'explicit provider authority retains existing write contract');
 r=await request({action:'set',issue_id:'old-fixture',client:'Fixture',plan_date:'2030-03-02'});
 ok(r.status===200&&sql("select issue_id from workload_plan where issue_id in('old-fixture','del_fixture');")==='old-fixture','provider-era existing UUID plan retains its storage key');
 r=await request({action:'native_snapshot'});ok(r.status===200&&r.body.plans.some(p=>p.issue_id==='old-fixture'&&p.plan_date==='2030-03-02'),'provider-authority board sees its saved UUID plan');
 sql("delete from workload_plan where issue_id in('old-fixture','del_fixture');");
 r=await request({action:'set',issue_id:'old-fixture',client:'Fixture',plan_date:'2030-03-03'});
 ok(r.status===200&&sql("select issue_id from workload_plan where issue_id in('old-fixture','del_fixture');")==='old-fixture','provider first plan is stored under its historic UUID contract');
 sql("update syncview_runtime_flags set value='{\"video\":\"syncview\",\"graphics\":\"syncview\"}';");
 r=await request({action:'native_snapshot'});ok(r.status===200&&r.body.plans.some(p=>p.issue_id==='del_fixture'&&p.plan_date==='2030-03-03'),'native flip projects the existing UUID plan without rewriting it');
 sql("delete from workload_plan where issue_id in('old-fixture','del_fixture');");
 r=await request({action:'set',issue_id:'del_fixture',client:'Fixture',plan_date:'2030-03-04'});
 ok(r.status===200&&sql("select issue_id from workload_plan where issue_id in('old-fixture','del_fixture');")==='del_fixture','native first plan uses the canonical owner');
 sql("update syncview_runtime_flags set value='{\"video\":\"linear\",\"graphics\":\"syncview\"}';");
 r=await request({action:'native_snapshot'});ok(r.status===200&&r.body.plans.some(p=>p.issue_id==='old-fixture'&&p.storage_issue_id==='del_fixture'&&p.plan_date==='2030-03-04'),'flipback displays a native-stored plan on its provider card');
 r=await request({action:'set',issue_id:'old-fixture',client:'Fixture',plan_date:'2030-03-05'});
 ok(r.status===200&&sql("select issue_id from workload_plan where issue_id in('old-fixture','del_fixture');")==='del_fixture','old bundle update after flipback keeps the canonical storage row');
 sql("update syncview_runtime_flags set value='{\"video\":\"syncview\",\"graphics\":\"syncview\"}';");
 r=await request({action:'native_snapshot'});ok(r.status===200&&r.body.plans.some(p=>p.issue_id==='del_fixture'&&p.plan_date==='2030-03-05'),'second native flip preserves the latest plan');
 // The same public contract must work for Graphics, not just Video.
 sql("update deliverables set team='graphics',assignee_id='00000000-0000-0000-0000-000000000002' where id='del_fixture';update workload_issues set team_key='GRA',team_name='Graphics' where id='old-fixture';delete from workload_plan where issue_id in('old-fixture','del_fixture');update syncview_runtime_flags set value='{\"video\":\"syncview\",\"graphics\":\"linear\"}';");
 r=await request({action:'set',issue_id:'old-fixture',client:'Fixture',plan_date:'2030-03-06'});
 ok(r.status===200&&sql("select issue_id from workload_plan where issue_id in('old-fixture','del_fixture');")==='old-fixture','Graphics provider first plan preserves UUID storage');
 sql("update syncview_runtime_flags set value='{\"video\":\"syncview\",\"graphics\":\"syncview\"}';");
 r=await request({action:'native_snapshot'});
 ok(r.status===200&&r.body.rows.find(row=>row.id==='del_fixture').native_assignee_eligible===true
   &&r.body.plans.some(p=>p.issue_id==='del_fixture'&&p.plan_date==='2030-03-06'),'Graphics native flip retains its plan and eligible designer');
 const baseline=execFileSync('git',['show','99d31c815de3e1a46deeb01c45c09bf2937040ad:supabase/functions/workload-plan/index.ts'],{cwd:root,encoding:'utf8'});
 const oldFile=path.join(scratch,'baseline.ts');fs.writeFileSync(oldFile,rewritten(baseline));await import(pathToFileURL(oldFile).href);
 r=await request({action:'native_snapshot'});ok(r.status===400&&r.body.error==='invalid_action','exact baseline actual handler does not implement native snapshot');
 ok(external===0,'native handler/SQL journeys have zero external fetches');
 console.log=log;console.log(JSON.stringify({classification:'ISOLATED_HANDLER_POSTGRES',checks,external_calls:external,limits:['SDK shim over real SQL','actual shared auth','no Deno/serving proof']}));
}finally{console.log=log;for(const name of fs.readdirSync(scratch))fs.unlinkSync(path.join(scratch,name));fs.rmdirSync(scratch);}
