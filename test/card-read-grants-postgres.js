'use strict';
// Real grants/readback on a database this process creates on an isolated cluster.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawnSync}=require('child_process');
if(process.env.WARDEN_PG_CONFIRM!=='LOCAL_DISPOSABLE_ONLY') throw Error('explicit_disposable_confirmation_required');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'migrations');
const port=process.env.WARDEN_PG_PORT;
assert(/^\d+$/.test(port||''));
const db='warden_grants_'+process.pid;
const pgEnv={...process.env,PGHOSTADDR:'127.0.0.1'}; delete pgEnv.PGSERVICE; delete pgEnv.PGSERVICEFILE;
function raw(sql,database=db){return spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',database],{input:sql,encoding:'utf8',env:pgEnv});}
function q(sql,database){const r=raw(sql,database);assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function migration(suffix){const names=fs.readdirSync(dir).filter(n=>n.endsWith(suffix));assert.equal(names.length,1);return fs.readFileSync(path.join(dir,names[0]),'utf8');}
const writes=migration('_warden_browser_write_grants.sql'),reads=migration('_warden_card_reads.sql');
const targets=[...new Set([...writes.matchAll(/public\.([a-z_]+)(?:,|\s)/g)].map(m=>m[1]))].filter(t=>t!=='syncview_runtime_flags');
targets.push('syncview_runtime_flags');
const exceptions=['workload_issues','workload_issues_native_v1','production_deliverables_browser_v1'];
const cards=['calendar_posts','sample_reviews'];
const all=[...new Set([...targets,...cards,...exceptions])];
let passed=0;
function check(name,fn){fn();passed++;console.log('OK '+name);}
q('create database '+db,'postgres');
try{
 q("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$; grant usage on schema public to anon,authenticated,service_role;");
 for(const t of all.filter(t=>!exceptions.slice(1).includes(t))){
  q(`create table public.${t}(id text,client text,value jsonb,key text); alter table public.${t} enable row level security; create policy public_read on public.${t} for select to anon,authenticated using(true); grant all on public.${t} to service_role; grant SELECT, MAINTAIN on public.${t} to anon,authenticated; insert into public.${t}(id,client) values('same','fixturea'),('same','fixtureb');`);
 }
 for(const t of exceptions.slice(1)) q(`create view public.${t} as select * from public.workload_issues; grant SELECT on public.${t} to anon,authenticated,service_role;`);
 for(const t of targets)q(`grant INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER on public.${t} to anon,authenticated;`);
 for(const t of ['team_members','thumbnail_media_revisions'])q(`revoke SELECT on public.${t} from anon,authenticated;`);
 q('grant SELECT(id) on public.team_members to anon,authenticated;');
 const acl=()=>q("select relname||':'||coalesce(relacl::text,'') from pg_class where oid in ('public.workload_issues_native_v1'::regclass,'public.production_deliverables_browser_v1'::regclass) order by relname");
 const priorExceptions=acl();
 const priorReads=new Map(all.map(t=>[t,q(`select has_table_privilege('anon','public.${t}','SELECT')`)]));
 check('read closure refuses before the function flag is enabled',()=>{const r=raw(reads);assert.notEqual(r.status,0);assert(r.stderr.includes('card_read_function_mode_required'));assert.equal(q("select has_table_privilege('anon','calendar_posts','SELECT')"),'t');});
 q("insert into public.syncview_runtime_flags(key,value) values('card_reads_source','{\"mode\":\"function\"}');");
 check('write migration refuses any new browser write policy',()=>{q('create policy new_write on public.templates for insert to anon with check(true);');assert.notEqual(raw(writes).status,0);q('drop policy new_write on public.templates;');});
 check('write migration refuses drift in measured server and browser column privileges',()=>{
  q('revoke UPDATE on public.templates from service_role;'); assert(raw(writes).stderr.includes('service_write_grant_drift')); q('grant UPDATE on public.templates to service_role;');
  q('grant UPDATE(id) on public.team_members to anon;'); assert(raw(writes).stderr.includes('browser_column_write_grant_drift')); q('revoke UPDATE(id) on public.team_members from anon;');
 });
 check('read migration refuses new browser column reads before changing any grants',()=>{
  q('grant SELECT(id) on public.calendar_posts to anon;'); assert(raw(reads).stderr.includes('card_column_grant_drift')); q('revoke SELECT(id) on public.calendar_posts from anon;');
  assert.equal(q("select has_table_privilege('anon','calendar_posts','SELECT')"),'t');
 });
 q(writes);
 check('all targeted browser I/U/T grants are gone, service I/U/T survive',()=>{
  for(const t of targets)for(const p of ['INSERT','UPDATE','TRUNCATE']){
   assert.equal(q(`select has_table_privilege('anon','public.${t}','${p}') or has_table_privilege('authenticated','public.${t}','${p}')`),'f');
   assert.equal(q(`select has_table_privilege('service_role','public.${t}','${p}')`),'t');
  }
 });
 check('write hardening preserves existing table and column reads and other privileges',()=>{
  for(const t of all)assert.equal(q(`select has_table_privilege('anon','public.${t}','SELECT')`),priorReads.get(t));
  assert.equal(q("select has_column_privilege('anon','team_members','id','SELECT')"),'t');
  assert.equal(q("select has_column_privilege('anon','team_members','client','SELECT')"),'f');
  assert.equal(q("select has_table_privilege('anon','templates','DELETE')"),'t');
 });
 q(reads);
 check('bare anon and authenticated card SELECT are denied; service reads still work',()=>{
  for(const t of cards){for(const role of ['anon','authenticated'])assert.notEqual(raw(`set role ${role};select count(*) from public.${t}`).status,0);assert.equal(q(`set role service_role;select count(*) from public.${t}`),'2');}
 });
 check('standing read exceptions and view ACLs remain exactly readable',()=>{
  assert.equal(acl(),priorExceptions);
  for(const t of exceptions)for(const role of ['anon','authenticated'])assert.equal(q(`set role ${role};select count(*) from public.${t}`),'2');
 });
 check('PUBLIC inherited grants cannot reopen either migration',()=>{
  assert.equal(q("select count(*) from pg_class c cross join lateral aclexplode(c.relacl) x where c.relnamespace='public'::regnamespace and x.grantee=0"),'0');
 });
 q(reads);q(writes);
 check('both forward migrations can be safely repeated',()=>assert.equal(q("select has_table_privilege('anon','calendar_posts','SELECT')"),'f'));
 q(migration('_warden_card_reads.ROLLBACK.sql'));
 check('one-step read rollback restores both card reads and the public flag, keeps write revocations',()=>{
  for(const t of cards)for(const role of ['anon','authenticated'])assert.equal(q(`set role ${role};select count(*) from public.${t}`),'2');
  assert.equal(q("select value->>'mode' from syncview_runtime_flags where key='card_reads_source'"),'public');
  assert.equal(q("select has_table_privilege('anon','templates','TRUNCATE')"),'f');
 });
 q(migration('_warden_browser_write_grants.ROLLBACK.sql'));
 check('write rollback restores only the measured browser and server I/U/T grants',()=>{
  for(const t of targets)for(const role of ['anon','authenticated','service_role'])for(const p of ['INSERT','UPDATE','TRUNCATE'])assert.equal(q(`select has_table_privilege('${role}','public.${t}','${p}')`),'t');
 });
 console.log(`card-read-grants-postgres: ${passed} checks passed; ${targets.length} write tables; isolated PostgreSQL only`);
} finally {q('drop database '+db,'postgres');}
