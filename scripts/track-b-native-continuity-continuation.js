'use strict';
// One positive continuation of an explicitly retained, owned disposable source.
// Never reseeds old cases or weakens the authenticated schema engine. Negative
// controls remain in the original rehearsal; its timeout is not a PASS receipt.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const backup=require('./track-b-backup'),restore=require('./track-b-restore-rehearsal');
const recovery=require('./track-b-recovery-package'),{reconstruct,OUTCOMES}=require('./track-b-recovery-reconstruct');
const lane=require('./track-b-recovery-rehearsal');
const ROOT=path.resolve(__dirname,'..'),q=v=>"'"+String(v).replaceAll("'","''")+"'",sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const MIGRATION='migrations/2026-09-07-native-comment-media.sql';
async function run(){
  assert.equal(process.env.TRACK_B_RECOVERY_TEST_CORPUS,'history-v9');
  const cfg=lane.config(),sourceName=process.env.TRACK_B_RECOVERY_CONTINUATION_SOURCE,seedFile=process.env.TRACK_B_RECOVERY_CONTINUATION_SEED;
  assert.match(sourceName||'',/^card_history_\d+_[a-f0-9]{8}$/);
  assert.ok(path.isAbsolute(seedFile||''));
  const seed=JSON.parse(fs.readFileSync(seedFile,'utf8'));assert.equal(seed.group.state,'complete');assert.equal(seed.provider_attempts,0);
  assert.equal(sha(fs.readFileSync(path.join(ROOT,MIGRATION))),'6de5febbb7dda475e3f2e14eaff4615c9641b6bcd33ed7e14469cd66130cb508');
  cfg.output=fs.mkdtempSync(path.join(cfg.output,'positive-continuation-'));
  const source=new lane.DB(cfg),target=new lane.DB(cfg);source.name=sourceName;
  const checks=[],check=(name,fn)=>{fn();checks.push(name);};let success=false;
  const captureRole=target.name+'_capture',targetRole=target.name+'_target',dataRole=target.name+'_data';
  const capturePassword=crypto.randomBytes(24).toString('hex'),targetPassword=crypto.randomBytes(24).toString('hex'),hmac=crypto.randomBytes(32).toString('base64');
  const files=[...lane.SOURCES,MIGRATION,'scripts/track-b-native-continuity-continuation.js','supabase/functions/production-write/index.ts','scripts/native-intake-reconcile/load-gateway.mjs','scripts/native-intake-manifest/supabase-shim.mjs'];
  const pins=Object.fromEntries([...new Set(files)].map(file=>[file,sha(fs.readFileSync(path.join(ROOT,file)))]));
  fs.writeFileSync(path.join(cfg.output,'KEYS.private.json'),JSON.stringify({hmac,captureRole,capturePassword,targetRole,targetPassword,dataRole}));
  fs.writeFileSync(path.join(cfg.output,'SOURCE.private.json'),JSON.stringify({source:sourceName,seedFile,seed_sha256:sha(fs.readFileSync(seedFile)),source_sha256:pins}));
  try{
    check('exact retained source has original F44 ownership and no unfinished synthetic capture negatives',()=>{
      assert.equal(source.query(`select native_request->>'request_id' from public.legacy_intake_native_triage where payload_hash=${q(seed.accepted.hash)}`),seed.group.native_request.request_id);
      assert.equal(source.query("select to_regclass('public.synthetic_capture_negative') is null and not exists(select 1 from pg_attribute where attrelid='public.calendar_posts'::regclass and attname='synthetic_race' and not attisdropped)"),'t');
      assert.equal(source.query("select count(*) from pg_attribute where attrelid='public.native_brief_media_occurrences'::regclass and attname='source_audience' and not attisdropped"),'0');
    });
    source.query(fs.readFileSync(path.join(ROOT,MIGRATION),'utf8'));
    const originalUrl='https://fixture.invalid/synthetic-comment.mov',body='Retained comment '+originalUrl;
    // A later synthetic human edit belongs to the existing canonical comment
    // owner. Both that owner and its version-bound media occurrence are selected.
    source.query(`update public.production_comments set body=${q(body)},version=version+1,source_updated_at=now() where id='schema-v7-comment';`);
    const comment=source.rows("select * from public.production_comments where id='schema-v7-comment'")[0];assert.ok(comment);
    const id=crypto.randomUUID(),content=sha('synthetic comment content identity; no object bytes claimed');
    const media={id,deliverable_id:comment.deliverable_id,source_kind:'native_comment',source_entity_id:comment.id,client_slug:comment.client_slug,team:comment.team,
      source_audience:comment.audience,source_version:comment.version,source_updated_at:comment.source_updated_at,source_sha256:sha(body),source_offset:body.indexOf(originalUrl),source_length:originalUrl.length,
      original_url_sha256:sha(originalUrl),audience:'staff',state:'verified',content_sha256:content,readback_sha256:content,storage_path:content+'/'+id,byte_length:104857600,mime_type:'video/quicktime',verified_at:comment.source_updated_at,source_receipt_sha256:sha('synthetic private comment source receipt'),created_at:comment.source_updated_at};
    source.query(`set role service_role;insert into public.native_brief_media_occurrences select (jsonb_populate_record(null::public.native_brief_media_occurrences,${q(JSON.stringify(media))}::jsonb)).*;`);
    seed.media=JSON.parse(source.query("set time zone 'UTC';select json_agg(t) from (select * from public.native_brief_media_occurrences order by id) t"));
    const amendedSeed=path.join(cfg.output,'continuity-seed.private.json');fs.writeFileSync(amendedSeed,JSON.stringify(seed,null,2));
    check('additive comment schema and real canonical owner bind audience version and large-video identity',()=>{
      assert.equal(source.query("select file_size_limit from storage.buckets where id='syncview-native-brief-media'"),'104857600');
      assert.equal(source.query(`select count(*) from public.native_brief_media_occurrences m join public.production_comments c on c.id=m.source_entity_id where m.id=${q(id)}::uuid and m.source_audience=c.audience and m.source_version=c.version and m.source_sha256=encode(extensions.digest(convert_to(c.body,'UTF8'),'sha256'),'hex')`),'1');
    });
    target.create();target.query(lane.TARGET_PREREQUISITES);
    source.query(`create role ${captureRole} login bypassrls password ${q(capturePassword)};create role ${targetRole} login password ${q(targetPassword)};create role ${dataRole} login noinherit bypassrls password ${q(targetPassword)};`);
    for(const [db,role,mode] of [[source,captureRole,'capture'],[target,targetRole,'target']]){
      const r=lane.grants(cfg,db,role,mode);fs.writeFileSync(path.join(cfg.output,'grants-'+mode+'.private.log'),r.stdout+r.stderr);assert.equal(r.status,0);
    }
    const sourceEnv=lane.connectionEnv(cfg,source,captureRole,capturePassword),targetEnv=lane.connectionEnv(cfg,target,targetRole,targetPassword),packet=path.join(cfg.output,'continuity.private.recovery');
    await recovery.captureRecoveryPackage({psql:cfg.psql,pgDump:cfg.pgDump,env:sourceEnv,corpusName:'history-v9',hmacInput:hmac,output:packet,sourceUrl:`postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`});
    const bytes=fs.readFileSync(packet),pkg=recovery.readRecoveryPackage(bytes,hmac),before=lane.unionImages(source),sequences=lane.captureSequences(source);
    check('fresh authenticated positive package binds42 tables and separate media custody limits',()=>{
      assert.equal(pkg.manifest.data.table_count,42);assert.equal(pkg.manifest.corpus,'history-v9');
      assert.equal(Object.keys(pkg.manifest.data.tables).length,42);
      assert.ok(pkg.manifest.sequences.some(s=>s.name==='public_intake_log_id_seq'));
    });
    const outcome=reconstruct(pkg,targetEnv,{psql:cfg.psql,diagnosticDir:path.join(cfg.output,'diagnostics')});
    check('restricted empty-target schema reconstruction preserves exact42-owner images and all sequences',()=>{
      assert.equal(outcome.outcome,OUTCOMES.VERIFIED);assert.equal(outcome.schema_fingerprint_match,true);assert.equal(outcome.content_digests_match,true);
      assert.deepEqual(lane.unionImages(target),before);assert.deepEqual(lane.captureSequences(target),sequences);
    });
    const replay=lane.phase(cfg,target,'replay',amendedSeed,'schema-replay',9);
    check('schema-restored staff completion pending and provider debt fences remain usable',()=>{assert.equal(replay.value.replayed,1);assert.equal(replay.value.provider_attempts,0);});
    lane.dataGrants(cfg,source,captureRole,'backup');lane.dataGrants(cfg,target,dataRole,'scratch');
    const dataTarget=new lane.DB({...cfg,user:dataRole,password:targetPassword});dataTarget.name=target.name;
    const triggers=db=>db.rows("select c.relname,t.tgname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal order by c.relname,t.tgname");
    const triggerStates=triggers(target);dataTarget.query(restore.restoreSql(pkg.data,'history-v9'));
    check('distinct restricted data restore retains42 images user triggers and public intake identity sequence',()=>{
      assert.deepEqual(lane.unionImages(target),before);assert.deepEqual(triggers(target),triggerStates);
      assert.deepEqual(JSON.parse(target.query(recovery.sequenceStateSql('public_intake_log_id_seq'))),sequences.find(s=>s.name==='public_intake_log_id_seq'));
    });
    const dataReplay=lane.phase(cfg,target,'replay',amendedSeed,'data-replay',9);
    check('data-restored ownership and comment media audience version survive actual replay',()=>{
      assert.equal(dataReplay.value.replayed,1);assert.equal(dataReplay.value.provider_attempts,0);
      const restored=target.rows(`select * from public.native_brief_media_occurrences where id=${q(id)}::uuid`)[0];assert.equal(restored.source_kind,'native_comment');assert.equal(restored.source_audience,comment.audience);assert.equal(restored.source_version,comment.version);
      assert.equal(target.query(`select count(*) from public.native_brief_media_occurrences m join public.production_comments c on c.id=m.source_entity_id where m.id=${q(id)}::uuid and m.source_version=c.version and m.source_audience=c.audience`),'1');
      const old=target.raw('begin;'+backup.corpusBoundarySql('history-v8')+'rollback;');assert.notEqual(old.status,0);assert.match(old.stderr,/omits native continuity/);
    });
    const report={status:'PASS',classification:'ISOLATED_RETAINED_SOURCE_POSITIVE_CONTINUATION',passed:checks.length,checks,table_count:42,package_sha256:sha(bytes),source_sha256:pins,
      original_full_rehearsal:'TIMED_OUT_NOT_PASS',source_seed_sha256:sha(fs.readFileSync(seedFile)),object_bytes_recovered:false,owner_receipt_bytes_recovered:false,
      limits:['Synthetic retained disposable source; installed schema and live recovery unproven','Original full matrix timeout retained separately; this continuation does not claim its uncompleted checks','Media bucket configuration and objects/private receipt bytes require separate custody and readback','No external/provider/workflow/live action']};
    fs.writeFileSync(path.join(cfg.output,'REPORT.private.json'),JSON.stringify(report,null,2));success=true;console.log(JSON.stringify({status:'PASS',passed:checks.length,table_count:42,output:cfg.output}));
  }catch(e){fs.writeFileSync(path.join(cfg.output,'FAILURE.private.log'),String(e.stack)+'\n'+String(e.detail||''));console.log(JSON.stringify({status:'FAIL',completed_checks:checks.length,output:cfg.output}));process.exitCode=1;}
  finally{fs.writeFileSync(path.join(cfg.output,'DATABASES.private.json'),JSON.stringify({source:source.name,target:target.name,retained:true,success}));}
}
if(require.main===module)run().catch(e=>{console.error('continuation_configuration_refused');process.exitCode=1;});
module.exports={run};
