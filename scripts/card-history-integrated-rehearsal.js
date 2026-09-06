'use strict';
// LOCAL ONLY. One combined SQL fixture, never a deployed-schema reconstruction.
// Does not start/stop servers and retains proof databases/artifacts on failure.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {spawnSync}=require('child_process');
const {LocalDatabase,localConfig,source}=require('./card-change-journal-rehearsal');
const {prepare,triggerRows}=require('./card-history-backup-rehearsal');
const {dependencies}=require('./card-history-closed-corpus-rehearsal');
const {FIXTURE_SQL}=require('./native-intake-manifest/harness');
const backup=require('./track-b-backup'),restore=require('./track-b-restore-rehearsal');
const ROOT=path.resolve(__dirname,'..'),CORPUS='history-v6';
const lit=v=>v==null?'null':"'"+String(v).replace(/'/g,"''")+"'",j=v=>lit(JSON.stringify(v))+'::jsonb';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function setup(db,feedback){
 prepare(db,source('2026-09-05-native-intake-root-manifest.sql'));dependencies(db);
 for(const file of ['2026-07-28-f27-write-authorization-only.sql','2026-08-19-samples-batch-purpose.sql','2026-08-19-samples-batch-write-purpose.sql','2026-08-24-public-intake-log.sql','2026-08-26-production-intake-append-v7.sql','2026-08-31-production-component-fill.sql','2026-09-05-native-only-intake.sql','2026-09-05-native-intake-reconcile.sql'])db.query(source(file));
 const f27=source('2026-07-20-f27-team-rollback.sql').replace(/\r\n/g,'\n');
 for(const name of ['mirror_outbox_enqueue','track_b_f27_hold_guard']){const start=f27.indexOf('create or replace function public.'+name+'('),end=f27.indexOf('$fn$;',start);assert.ok(start>=0&&end>start);db.query(f27.slice(start,end+5));}
 const start=f27.indexOf('create trigger track_b_f27_hold_guard\n'),tail='for each row execute function public.track_b_f27_hold_guard();',end=f27.indexOf(tail,start);assert.ok(start>=0&&end>start);db.query(f27.slice(start,end+tail.length));
 const filming=source('2026-07-09-filming-plans-source.sql'),seedAt=filming.indexOf('insert into public.filming_plans');assert.ok(seedAt>0);db.query(filming.slice(0,seedAt));
 db.query(feedback);db.query(FIXTURE_SQL);
 // Existing bootstrap uses the same fictional admin UUID with a different name.
 // Align that fixture identity with the real handler loader, not an auth bypass.
 db.query("update public.team_members set name='Fixture Admin' where id='11111111-1111-4111-8111-111111111111';");
 db.query("update public.syncview_runtime_flags set value='{\"video\":{\"enabled\":true,\"epoch\":\"integrated-video\"},\"graphics\":{\"enabled\":true,\"epoch\":\"integrated-graphics\"}}' where key='native_intake_epochs';");
}
const allRows=db=>Object.fromEntries(backup.INTEGRATED_HISTORY_TABLES.map(t=>[t.name,db.rows('select to_jsonb(t) image from public.'+t.name+' t order by to_jsonb(t)::text').map(r=>r.image)]));
function grants(db,role,mode){const r=spawnSync(db.config.psql,[...db.args(),'-v','mode='+mode,'-v','existing_role='+role,'-v','confirmation='+(mode==='backup'?'HISTORY_V6_BACKUP_GRANTS_ONLY':'DISPOSABLE_SCRATCH_ONLY'),'-v','scratch_project_ref=abcdefghijklmnopqrst','-f',path.join(ROOT,'scripts/track-b-history-v6-backup-prerequisites.sql')],{encoding:'utf8',env:{...process.env,PGPASSWORD:db.config.password??process.env.CARD_HISTORY_PGPASSWORD??'',PGOPTIONS:''}});if(r.status)throw new Error('integrated_private_grants_failed: '+r.stderr);}
async function run(){
 const feedbackFile=process.env.CARD_HISTORY_FEEDBACK_SQL||path.join(ROOT,'migrations/2026-09-05-calendar-feedback-recovery.sql');
 if(!fs.existsSync(feedbackFile))throw new Error('integrated_feedback_migration_required');
 const feedback=fs.readFileSync(feedbackFile,'utf8');
 if(!process.env.CARD_HISTORY_FEEDBACK_SHA256||sha(feedback)!==process.env.CARD_HISTORY_FEEDBACK_SHA256)throw new Error('explicit_feedback_source_pin_required');
 const config=localConfig(),from=new LocalDatabase(config),to=new LocalDatabase(config),checks=[];const check=(name,fn)=>{fn();checks.push(name);};
 const dir=process.env.CARD_HISTORY_INTEGRATED_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'history-v6-sql-'));fs.mkdirSync(dir,{recursive:true});
 const password=crypto.randomBytes(24).toString('hex'),key=crypto.randomBytes(32).toString('base64'),backupRole=from.name+'_backup',restoreRole=to.name+'_restore';
 let completed=false;from.create();to.create();
 try{
  setup(from,feedback);setup(to,feedback);
  check('combined migrations install native epoch, journal and both recovery owners',()=>{assert.equal(from.query("select count(*) from pg_tables where schemaname='public' and tablename in('card_change_journal','production_card_provenance','calendar_feedback_materializations')"),'3');});
  const reportFile=path.join(dir,'acceptance.private.json');
  const accepted=spawnSync(process.execPath,['--experimental-strip-types',path.join(ROOT,'scripts/card-history-integrated-acceptance.mjs')],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,env:{...process.env,NIR_PGHOST:config.host,NIR_PGPORT:config.port,NIR_PGUSER:config.user,NIR_PGDATABASE:from.name,NIR_PSQL:config.psql,PGPASSWORD:process.env.CARD_HISTORY_PGPASSWORD||'',CARD_HISTORY_ACCEPTANCE_REPORT:reportFile}});
  fs.writeFileSync(path.join(dir,'handler.stdout.txt'),accepted.stdout||'');fs.writeFileSync(path.join(dir,'handler.stderr.txt'),accepted.stderr||'');if(accepted.status)throw new Error('integrated_handler_acceptance_failed');
  const acceptance=JSON.parse(fs.readFileSync(reportFile)),request=acceptance.request_id;
  const m=from.rows('select * from public.production_intake_manifests where request_id='+lit(request))[0];assert.ok(m);
  check('accepted interrupted native parent and first child are journaled with epoch receipts',()=>{assert.equal(from.query('select count(*) from public.deliverables where batch_id='+lit(m.batch_id)),'1');assert.ok(from.rows("select * from public.card_change_journal where relation_name='batches' and entity_key_after->>'id'="+lit(m.batch_id)).length);assert.ok(Object.values(m.native_epochs).every(Boolean));});
  from.query(`set role service_role;select public.production_intake_reconcile_children(${lit(request)},'synthetic',true);`);
  const children=from.rows('select * from public.deliverables where batch_id='+lit(m.batch_id)),cid=m.expected_items[0].row.card_id,video=children.find(d=>d.team==='video'),graphic=children.find(d=>d.team==='graphics');assert.equal(children.length,2);
  from.query(`insert into public.calendar_posts(client,id,name,status,video_deliverable_id) values('fixture-client',${lit(cid)},'Synthetic integrated card','In Progress',${lit(video.id)});`);
  from.query(`set role service_role;select public.production_intake_reconcile_cards(${lit(request)},'synthetic',true);`);
  check('successful bind commits card, journal and provenance together',()=>{assert.equal(from.query('select graphic_deliverable_id from public.calendar_posts where id='+lit(cid)),graphic.id);assert.equal(from.query("select count(*) from public.production_card_provenance where card_id="+lit(cid)+" and kind='slots_changed'"),'1');assert.equal(from.query("select count(*) from public.card_change_journal where relation_name='calendar_posts' and entity_key_after->>'id'="+lit(cid)), '2');});
  const comment={id:'integrated-comment',native_comment_id:'integrated-comment',idempotency_key:'integrated-add',deliverable_id:video.id,team:'video',author_key:'synthetic-staff',author_name:'Synthetic staff',role:'admin',body:'Synthetic accepted note',audience:'internal',source_updated_at:'2026-09-05T00:00:00Z'};
  const event={actor:'synthetic-staff',role:'admin',action:'add',source:'ui',outbound:{entity:'comment',entity_id:video.id,operation:'comment',team:'video',dedup_key:'integrated-add',payload:{_intent_fingerprint:'synthetic-add',_f27_authority_generation:Number(from.query("select generation from public.track_b_f27_team_fences where team='video'")),_f27_legacy_parity:false}}};
  from.query(`set role service_role;select public.production_comment_write(${j(comment)},${j(event)});`);
  check('actual canonical comment receipt and journal coexist with native intake receipts',()=>{assert.equal(from.query("select count(*) from public.production_comments where id='integrated-comment'"),'1');assert.ok(from.rows("select * from public.card_change_journal where relation_name='production_comments' and entity_key_after->>'id'='integrated-comment'").length);});
  for(const target of ['card_change_journal','production_card_provenance']){
   from.query(`create function public.integrated_fault() returns trigger language plpgsql as $$begin raise exception 'synthetic_capture_failure';end;$$;create trigger integrated_fault before insert on public.${target} for each row execute function public.integrated_fault();`);
   const before=allRows(from);const result=from.raw(`update public.calendar_posts set graphic_deliverable_id=null,name='Must roll back' where id=${lit(cid)};`);
   check(target+' refusal rolls card, journal and provenance back atomically',()=>{assert.notEqual(result.status,0);assert.deepEqual(allRows(from),before);});
   from.query(`drop trigger integrated_fault on public.${target};drop function public.integrated_fault();`);
  }
  // Explicit schema-level fixture for the new feedback receipt, not an RPC
  // acceptance claim. The separate handler lane owns exact recovery semantics.
  from.query(`insert into public.calendar_feedback_materializations(attempt_key,client,card_id,component,native_comment_id,canonical_comment_id,comment_dedup_key,request_fingerprint,outcome,applied,source_updated_at_before,source_updated_at_after) values('synthetic-recovery','fixture-client',${lit(cid)},'video','integrated-comment','integrated-comment','integrated-add','synthetic-fingerprint','materialized','{}',null,null);`);
  for(const db of [from,to])assert.equal(db.query('select count(*) from pg_foreign_server'),'0');
  from.query(`create role ${backupRole} login nosuperuser nocreatedb nocreaterole noinherit bypassrls password ${lit(password)};create role ${restoreRole} login nosuperuser nocreatedb nocreaterole noinherit bypassrls password ${lit(password)};`,'postgres');grants(from,backupRole,'backup');grants(to,restoreRole,'scratch');
  const full=allRows(from),triggers=triggerRows(to),dumpFile=path.join(dir,'history.sql');
  const dumped=spawnSync(process.env.CARD_HISTORY_PG_DUMP||'pg_dump',[...backup.pgDumpArgs(dumpFile,CORPUS),'-h',config.host,'-p',config.port,'-U',backupRole,'-d',from.name],{encoding:'utf8',env:{...process.env,PGPASSWORD:password,PGOPTIONS:''}});if(dumped.status)throw new Error('integrated_dump_failed: '+dumped.stderr);
  const pack=path.join(dir,'history.snapshot');backup.packSnapshot(dumpFile,pack,new Date().toISOString(),`postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`,key,CORPUS);const snapshot=backup.readSnapshotFile(pack,key);
  const target=new LocalDatabase({...config,user:restoreRole,password});target.name=to.name;
  check('old v5 restore refuses FK-free retained evidence before changing target',()=>{const prior=allRows(to),bad=target.raw(restore.restoreSql(require('../test/track-b-backup-corpus').fixtureDump('history-v5'),'history-v5'));assert.notEqual(bad.status,0);assert.match(bad.stderr,/omits integrated recovery evidence/);assert.deepEqual(allRows(to),prior);});
  target.query(restore.restoreSql(snapshot.dumpBytes,CORPUS));
  check('v6 restores exact35 current and historical row images with receipts',()=>{assert.deepEqual(allRows(to),full);assert.deepEqual(triggerRows(to),triggers);restore.verifyCounts(snapshot.manifest,restore.parseVerification(target.query(restore.verifySql(CORPUS))));});
  check('restored reciprocal state and accepted native epochs agree',()=>{assert.equal(to.query(`select (public.production_intake_reconcile_state(${lit(request)})->>'complete')`),'true');assert.deepEqual(to.rows('select native_epochs from public.production_intake_manifests where request_id='+lit(request))[0].native_epochs,m.native_epochs);});
  const before=allRows(to);target.query(restore.restoreSql(snapshot.dumpBytes,CORPUS));check('repeat restore does not synthesize new provenance or journal entries',()=>assert.deepEqual(allRows(to),before));
  const result={status:'PASS',passed:checks.length,checks,table_count:35,feedback_sql_sha256:sha(feedback),source_sha256:Object.fromEntries(['scripts/card-history-integrated-rehearsal.js','scripts/card-history-integrated-acceptance.mjs','scripts/track-b-backup.js','scripts/track-b-restore-rehearsal.js','scripts/track-b-history-v6-backup-prerequisites.sql','migrations/2026-09-05-card-change-journal.sql','migrations/2026-09-05-native-only-intake.sql','migrations/2026-09-05-native-intake-reconcile.sql'].map(p=>[p,sha(fs.readFileSync(path.join(ROOT,p)))])),limits:'Synthetic migration-shaped combined SQL with actual intake handler and canonical comment RPC; feedback receipt retention fixture only, NOT feedback recovery RPC proof; no installed schema, schema artifact, cloud, workload or capacity proof; no provider transport.'};fs.writeFileSync(path.join(dir,'RESULT.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,passed:result.passed,table_count:35}));completed=true;return result;
 }finally{fs.writeFileSync(path.join(dir,'DATABASES.private.json'),JSON.stringify({from:from.name,to:to.name,backupRole,restoreRole,retained:true,completed}));}
}
if(require.main===module)run().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={run,setup};
