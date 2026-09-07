'use strict';
// Finite LOCAL_DISPOSABLE_ONLY proof. Never starts/stops a server or drops a DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {LocalDatabase,localConfig,source}=require('./card-change-journal-rehearsal');
const {setup}=require('./card-history-integrated-rehearsal');
const {triggerRows}=require('./card-history-backup-rehearsal');
const backup=require('./track-b-backup'),restore=require('./track-b-restore-rehearsal');
const ROOT=path.resolve(__dirname,'..'),CORPUS='history-v6';
const lit=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'";
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function safeEnv(password='') {
  return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key))),
    PGPASSWORD:password,PGOPTIONS:'',PGCLIENTENCODING:'UTF8'};
}
class OwnedDatabase extends LocalDatabase {
  raw(sql,database) {
    return spawnSync(this.config.psql,['-w',...this.args(database)],{input:sql,encoding:'utf8',windowsHide:true,
      timeout:30000,maxBuffer:64*1024*1024,env:safeEnv(this.config.password)});
  }
}
function config() {
  if(!process.env.CARD_HISTORY_PGPORT||!path.isAbsolute(process.env.CARD_HISTORY_PSQL||'')
    ||!path.isAbsolute(process.env.CARD_HISTORY_PG_DUMP||''))throw Error('explicit_disposable_port_and_executables_required');
  return {...localConfig(),password:process.env.CARD_HISTORY_PGPASSWORD||''};
}
const allRows=db=>Object.fromEntries(backup.INTEGRATED_HISTORY_TABLES.map(t=>[t.name,
  db.rows('select to_jsonb(t) image from public.'+t.name+' t order by to_jsonb(t)::text').map(r=>r.image)]));
function workloadSchema(db) {
  const baseline=source('live-schema-baseline-2026-07-03.sql');
  const table=baseline.match(/create table if not exists public\.workload_issues \([\s\S]*?\n\);/);
  assert.ok(table,'actual legacy relation declaration required');
  db.query(table[0]);
  db.query(source('2026-09-02-workload-native-view.sql'));
  db.query(source('2026-09-05-workload-native-membership.sql'));
}
function grantPrivate(db,role,mode) {
  const args=['-w',...db.args(),'-v','mode='+mode,'-v','existing_role='+role,
    '-v','confirmation='+(mode==='backup'?'HISTORY_V6_BACKUP_GRANTS_ONLY':'DISPOSABLE_SCRATCH_ONLY'),
    '-v','scratch_project_ref=abcdefghijklmnopqrst','-f',path.join(ROOT,'scripts/track-b-history-v6-backup-prerequisites.sql')];
  const r=spawnSync(db.config.psql,args,{encoding:'utf8',windowsHide:true,timeout:30000,env:safeEnv(db.config.password)});
  if(r.status)throw Error('private_grants_failed: '+r.stderr);
}
async function run() {
  const cfg=config(),from=new OwnedDatabase(cfg),to=new OwnedDatabase(cfg);
  const output=process.env.CARD_HISTORY_WORKLOAD_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'workload-history-'));
  fs.mkdirSync(output,{recursive:true});
  const checks=[],check=(name,fn)=>{fn();checks.push(name);};
  const file='migrations/2026-09-05-calendar-feedback-recovery.sql',feedback=fs.readFileSync(path.join(ROOT,file),'utf8');
  const password=crypto.randomBytes(24).toString('hex'),key=crypto.randomBytes(32).toString('base64');
  const backupRole=from.name+'_backup',restoreRole=to.name+'_restore';
  let completed=false,handler;
  from.create();to.create();
  try {
    for(const db of [from,to]){setup(db,feedback);workloadSchema(db);}
    check('real six-owner journal is installed on workload_plan with all recovery tables',()=>{
      assert.equal(from.query("select count(*) from pg_trigger where tgrelid='public.workload_plan'::regclass and tgname='card_change_journal_after' and tgenabled='O'"),'1');
      assert.equal(from.query("select count(*) from pg_tables where schemaname='public' and tablename in('card_change_journal','production_card_provenance','calendar_feedback_materializations','production_intake_manifests')"),'4');
      assert.equal(from.query('select count(*) from pg_foreign_server'),'0');
    });
    from.query(`insert into public.clients(slug,display_name,active) values('workloadfixture','Workload Fixture',true);
      insert into public.batches(id,client_slug,name)values('bat_workload_integrated','workloadfixture','Synthetic workload batch');
      insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,linear_issue_uuid,linear_raw)values
      ('del_workload_old','bat_workload_integrated','workloadfixture','video','video','Old-key work','todo','old-workload-uuid','{"issue":{"labels":{"nodes":[],"pageInfo":{"hasNextPage":false}}}}'),
      ('del_workload_new','bat_workload_integrated','workloadfixture','video','video','New-key work','todo',null,'{"issue":{"labels":{"nodes":[],"pageInfo":{"hasNextPage":false}}}}');
      insert into public.workload_plan(issue_id,client,plan_date,updated_by)values('old-workload-uuid','workloadfixture','2030-01-08','synthetic-prior');
      insert into public.calendar_posts(client,id,name,status,video_deliverable_id)values('workloadfixture','p_workload_integrated','Synthetic retained card','In Progress','del_workload_old');`);
    const {loadIntegratedWorkloadHandler}=await import(pathToFileURL(path.join(ROOT,'qa/workload-native/integrated-handler.mjs')).href);
    handler=await loadIntegratedWorkloadHandler(from,output);
    let r=await handler.request({action:'set',issue_id:'old-workload-uuid',client:'workloadfixture',plan_date:'2030-01-09'});
    check('actual handler updates old UUID plan without changing storage identity',()=>{
      assert.equal(r.status,200);assert.equal(r.body.plan.issue_id,'old-workload-uuid');
      assert.deepEqual(from.rows("select issue_id,plan_date from workload_plan"),[{issue_id:'old-workload-uuid',plan_date:'2030-01-09'}]);
    });
    const image=from.rows("select row_before,row_after from card_change_journal where relation_name='workload_plan' and operation='UPDATE' order by id desc limit 1")[0];
    check('successful plan mutation journals actual old and new day atomically',()=>{assert.equal(image.row_before.plan_date,'2030-01-08');assert.equal(image.row_after.plan_date,'2030-01-09');});
    r=await handler.request({action:'set',issue_id:'del_workload_new',client:'workloadfixture',plan_date:'2030-01-11'});
    check('actual handler creates native-key plan without a provider mapping',()=>{assert.equal(r.status,200);assert.equal(from.query("select plan_date from workload_plan where issue_id='del_workload_new'"),'2030-01-11');});
    r=await handler.request({action:'set',issue_id:'del_workload_old',client:'workloadfixture',plan_date:'2030-01-12'});
    check('new caller updates retained UUID storage through exact alias',()=>{assert.equal(r.status,200);assert.equal(from.query("select plan_date from workload_plan where issue_id='old-workload-uuid'"),'2030-01-12');assert.equal(from.query("select count(*) from workload_plan where issue_id='del_workload_old'"),'0');});
    from.query("insert into workload_plan(issue_id,client,plan_date,updated_by) values('del_workload_old','workloadfixture','2030-01-15','synthetic-dual');");
    let before=allRows(from);
    r=await handler.request({action:'set',issue_id:'del_workload_old',client:'workloadfixture',plan_date:'2030-01-16'});
    check('dual alias refusal preserves all current and historical rows',()=>{assert.equal(r.status,409);assert.deepEqual(allRows(from),before);});
    from.query("delete from workload_plan where issue_id='del_workload_old';");
    from.query(`create function public.workload_journal_fault() returns trigger language plpgsql as $fn$
      begin if new.relation_name='workload_plan' then raise exception 'synthetic_plan_journal_failure';end if;return new;end;$fn$;
      create trigger workload_journal_fault before insert on public.card_change_journal for each row execute function public.workload_journal_fault();`);
    before=allRows(from);
    r=await handler.request({action:'set',issue_id:'old-workload-uuid',client:'workloadfixture',plan_date:'2030-02-01'});
    check('real journal failure refuses accepted-plan update and rolls back every owner',()=>{assert.equal(r.status,409);assert.deepEqual(allRows(from),before);assert.equal(from.query("select plan_date from workload_plan where issue_id='old-workload-uuid'"),'2030-01-12');});
    from.query('drop trigger workload_journal_fault on public.card_change_journal;drop function public.workload_journal_fault();');
    r=await handler.request({action:'list'});const expectedList=r.body.plans;
    check('legacy list exposes old and native aliases with the same retained day',()=>{
      assert.equal(r.status,200);for(const id of ['old-workload-uuid','del_workload_old'])assert.equal(expectedList.find(p=>p.issue_id===id).plan_date,'2030-01-12');
    });
    r=await handler.request({action:'native_snapshot'});const expectedSnapshot=r.body;
    check('native snapshot projects stored days onto native identity',()=>{assert.equal(r.status,200);assert.equal(expectedSnapshot.plans.find(p=>p.issue_id==='del_workload_old').storage_issue_id,'old-workload-uuid');});
    for(const role of ['anon','authenticated']){const refused=from.raw(`set role ${role};select workload_native_snapshot_v1();`);check(role+' cannot execute private Workload snapshot',()=>assert.notEqual(refused.status,0));}
    check('actual handler never uses legacy mutation or external transport',()=>{assert.equal(handler.calls.external,0);assert.equal(handler.calls.legacyWrites,0);});
    handler.close();handler=null;
    from.query(`create role ${backupRole} login nosuperuser nocreatedb nocreaterole noinherit bypassrls password ${lit(password)};
      create role ${restoreRole} login nosuperuser nocreatedb nocreaterole noinherit bypassrls password ${lit(password)};`,'postgres');
    grantPrivate(from,backupRole,'backup');grantPrivate(to,restoreRole,'scratch');
    const full=allRows(from),triggers=triggerRows(to),dump=path.join(output,'history.sql');
    const dumped=spawnSync(process.env.CARD_HISTORY_PG_DUMP,['-w',...backup.pgDumpArgs(dump,CORPUS),'-h',cfg.host,'-p',cfg.port,'-U',backupRole,'-d',from.name],{encoding:'utf8',windowsHide:true,timeout:30000,env:safeEnv(password)});
    if(dumped.status)throw Error('workload_history_dump_failed: '+dumped.stderr);
    const packet=path.join(output,'history.snapshot');
    backup.packSnapshot(dump,packet,new Date().toISOString(),`postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`,key,CORPUS);
    const snapshot=backup.readSnapshotFile(packet,key);
    const target=new OwnedDatabase({...cfg,user:restoreRole,password});target.name=to.name;
    target.query(restore.restoreSql(snapshot.dumpBytes,CORPUS));
    check('v6 restores exact35 row images and recorder trigger state',()=>{assert.deepEqual(allRows(to),full);assert.deepEqual(triggerRows(to),triggers);restore.verifyCounts(snapshot.manifest,restore.parseVerification(target.query(restore.verifySql(CORPUS))));});
    handler=await loadIntegratedWorkloadHandler(to,output);
    r=await handler.request({action:'list'});check('restored actual legacy handler returns identical aliases and dates',()=>{assert.equal(r.status,200);assert.deepEqual(r.body.plans,expectedList);});
    r=await handler.request({action:'native_snapshot'});check('restored actual native handler returns identical identity/day projection',()=>{assert.equal(r.status,200);assert.deepEqual(r.body,expectedSnapshot);});
    before=allRows(to);
    r=await handler.request({action:'set',issue_id:'old-workload-uuid',client:'workloadfixture',plan_date:'2030-01-20'});
    check('restored alias write retains old storage and resumes actual journal capture',()=>{
      assert.equal(r.status,200);assert.equal(to.query("select plan_date from workload_plan where issue_id='old-workload-uuid'"),'2030-01-20');
      assert.equal(allRows(to).card_change_journal.length,before.card_change_journal.length+1);
    });
    check('restored path retains zero external transport and no legacy mutation',()=>{assert.equal(handler.calls.external,0);assert.equal(handler.calls.legacyWrites,0);});
    const proofFiles=['scripts/card-history-workload-rehearsal.js','qa/workload-native/integrated-handler.mjs','scripts/card-history-integrated-rehearsal.js','scripts/track-b-backup.js','scripts/track-b-restore-rehearsal.js','migrations/2026-09-05-workload-native-membership.sql','migrations/2026-09-05-card-change-journal.sql',file,'supabase/functions/workload-plan/index.ts','supabase/functions/workload-plan/native-snapshot.mjs'];
    const result={classification:'ISOLATED_POSTGRES',status:'PASS',passed:checks.length,checks,table_count:35,
      source_sha256:Object.fromEntries(proofFiles.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))])),
      limits:['Synthetic migration-shaped history-v6 setup, not installed schema reconstruction','Real Workload handler and RPC plus real recorder triggers; native intake/feedback RPCs installed but not exercised by this lane','Legacy workload mirror table empty and outside35: no CON/STR/provider population recovery claim','No serving, live capacity, browser or schema-artifact proof','SQL statement failures intentionally logged; no external calls']};
    fs.writeFileSync(path.join(output,'RESULT.json'),JSON.stringify(result,null,2)+'\n');completed=true;
    console.log(JSON.stringify({classification:result.classification,status:'PASS',passed:checks.length,table_count:35}));
    return result;
  }finally{
    if(handler)handler.close();
    fs.writeFileSync(path.join(output,'DATABASES.private.json'),JSON.stringify({from:from.name,to:to.name,backupRole,restoreRole,retained:true,completed}));
  }
}
if(require.main===module)run().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={run,safeEnv};
