'use strict';
// Cold-resume only the retained positive continuation after host interruption.
// Authenticate first; never recreate the source or repeat capture/schema restore.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const lane=require('./track-b-recovery-rehearsal'),backup=require('./track-b-backup'),recovery=require('./track-b-recovery-package'),restore=require('./track-b-restore-rehearsal');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function run(){
  assert.equal(process.env.TRACK_B_RECOVERY_TEST_CORPUS,'history-v9');const cfg=lane.config(),dir=process.env.TRACK_B_RECOVERY_RESUME_DIRECTORY;
  assert.ok(path.isAbsolute(dir||''));const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
  const keys=read('KEYS.private.json'),saved=read('SOURCE.private.json'),prior=read('schema-replay.private.json');
  for(const [file,digest] of Object.entries(saved.source_sha256))assert.equal(sha(fs.readFileSync(path.join(ROOT,file))),digest,'captured source changed: '+file);
  const bytes=fs.readFileSync(path.join(dir,'continuity.private.recovery')),pkg=recovery.readRecoveryPackage(bytes,keys.hmac);
  assert.equal(pkg.manifest.corpus,'history-v9');assert.equal(pkg.manifest.data.table_count,42);assert.equal(prior.replayed,1);assert.equal(prior.provider_attempts,0);
  const source=new lane.DB(cfg),target=new lane.DB(cfg);source.name=saved.source;target.name=keys.targetRole.replace(/_target$/,'');
  for(const name of [source.name,target.name])assert.match(name,/^card_history_\d+_[a-f0-9]{8}$/);
  cfg.output=fs.mkdtempSync(path.join(dir,'cold-resume-'));const checks=[],check=(name,fn)=>{fn();checks.push(name);};
  const sql=(db,s)=>db.query("set time zone 'UTC';set search_path='public';"+s);
  const digestSql='select json_build_object('+backup.resolveCorpus('history-v9').tables.map(t=>"'"+t.name+"',("+recovery.dataDigestSql(t.name)+')').join(',')+')';
  const expected=Object.fromEntries(Object.entries(pkg.manifest.data.tables).map(([name,r])=>[name,r.digest_sha256]));
  const triggers=db=>db.rows("select c.relname,t.tgname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal order by c.relname,t.tgname");
  try{
    check('authenticated saved package still matches exact retained source schema and42 data digests',()=>{
      assert.equal(sql(source,recovery.fingerprintSql()),pkg.manifest.schema.fingerprint);assert.deepEqual(JSON.parse(sql(source,digestSql)),expected);
    });
    const helper='track_b_restore_set_history_v9_user_triggers';
    const setup=fs.readFileSync(path.join(ROOT,'scripts/track-b-history-v9-backup-prerequisites.sql'),'utf8'),body=setup.match(/as \$helper\$([\s\S]*?)end \$helper\$/)[1]+'end ';
    check('retained scratch helper is the exact reviewed body and unavailable to runtime roles',()=>{
      const actual=target.rows(`select prosrc,prosecdef,pg_get_userbyid(proowner) owner from pg_proc where oid='public.${helper}(boolean)'::regprocedure`)[0];
      assert.equal(actual.prosrc.replaceAll('\r\n','\n').trim(),body.replaceAll('\r\n','\n').trim());assert.equal(actual.prosecdef,true);assert.equal(actual.owner,cfg.user);
      for(const role of ['anon','authenticated','service_role'])assert.equal(target.query(`select has_function_privilege('${role}','public.${helper}(boolean)','EXECUTE')`),'f');
    });
    // The scratch grants intentionally change non-runtime ACLs and add one
    // helper after verified schema reconstruction. Compare all other catalog
    // lines and runtime privileges; this does not alter the engine fingerprint.
    const tail="select coalesce(md5(string_agg(line, E'\\n' order by line)), md5('')) from lines";
    const query=recovery.fingerprintSql();assert.equal(query.split(tail).length,2);
    const lineSql=query.replace(tail,"select coalesce(json_agg(line order by line),'[]') from lines");
    const catalog=db=>JSON.parse(sql(db,lineSql)).filter(s=>!s.startsWith('F|'+helper+'(')).map(s=>/^[RAF]\|/.test(s)?s.slice(0,s.lastIndexOf('|')):s);
    const runtimeSql="select json_agg(t order by name,role) from (select c.relname name,r.role,has_table_privilege(r.role,c.oid,'SELECT') s,has_table_privilege(r.role,c.oid,'INSERT') i,has_table_privilege(r.role,c.oid,'UPDATE') u,has_table_privilege(r.role,c.oid,'DELETE') d,has_table_privilege(r.role,c.oid,'TRUNCATE') tr from pg_class c cross join (values('anon'),('authenticated'),('service_role')) r(role) where c.relnamespace='public'::regnamespace and c.relkind in('r','p','v','m')) t";
    check('cold target retains source structure runtime table ACLs and normally enabled triggers',()=>{
      assert.deepEqual(catalog(target),catalog(source));assert.deepEqual(JSON.parse(sql(target,runtimeSql)),JSON.parse(sql(source,runtimeSql)));
      assert.deepEqual(triggers(target),triggers(source));assert.ok(triggers(target).every(t=>t.tgenabled==='O'));
    });
    const before=JSON.parse(sql(target,digestSql)),alreadyCommitted=Object.keys(expected).every(name=>before[name]===expected[name]);
    if(!alreadyCommitted){
      const changed=Object.keys(expected).filter(n=>before[n]!==expected[n]);
      assert.ok(changed.every(n=>['legacy_intake_native_triage','production_card_materialization_ingress'].includes(n)),'unexpected cold target changes require quarantine');
      const db=new lane.DB({...cfg,user:keys.dataRole,password:keys.targetPassword});db.name=target.name;db.query(restore.restoreSql(pkg.data,'history-v9'));
    }
    check('restricted data restoration is complete with42 exact digests triggers and intake sequence',()=>{
      assert.deepEqual(JSON.parse(sql(target,digestSql)),expected);assert.deepEqual(triggers(target),triggers(source));
      assert.deepEqual(JSON.parse(target.query(recovery.sequenceStateSql('public_intake_log_id_seq'))),pkg.manifest.sequences.find(s=>s.name==='public_intake_log_id_seq'));
    });
    const replay=lane.phase(cfg,target,'replay',path.join(dir,'continuity-seed.private.json'),'data-replay',9);
    check('cold-restored F44 completion holds fences and private media ownership replay without provider work',()=>{assert.equal(replay.value.replayed,1);assert.equal(replay.value.provider_attempts,0);});
    const report={status:'PASS',classification:'ISOLATED_COLD_RESUME_RETAINED_V9_CONTINUATION',passed:checks.length,checks,table_count:42,data_restore_already_committed:alreadyCommitted,
      package_sha256:sha(bytes),source_sha256:saved.source_sha256,resume_source_sha256:sha(fs.readFileSync(__filename)),prior_schema_replay_sha256:sha(fs.readFileSync(path.join(dir,'schema-replay.private.json'))),
      original_full_run:'TIMED_OUT_NOT_PASS',positive_continuation:'HOST_SHUTDOWN_AFTER_VERIFIED_SCHEMA_REPLAY',object_bytes_recovered:false,owner_receipt_bytes_recovered:false,
      limits:['Exact older pinned source; later main naming append and runtime integration not covered','No repeat capture or empty-schema reconstruction after shutdown','Media object bytes bucket configuration and private receipt bytes remain separate custody','No live/provider/workflow action']};
    fs.writeFileSync(path.join(cfg.output,'REPORT.private.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:'PASS',passed:checks.length,output:cfg.output}));
  }catch(e){fs.writeFileSync(path.join(cfg.output,'FAILURE.private.log'),String(e.stack)+'\n'+String(e.detail||''));console.log(JSON.stringify({status:'FAIL',completed_checks:checks.length,output:cfg.output}));process.exitCode=1;}
}
if(require.main===module)run().catch(()=>{console.error('cold_resume_configuration_refused');process.exitCode=1;});
module.exports={run};
