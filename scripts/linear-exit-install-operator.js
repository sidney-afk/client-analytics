'use strict';
// Explicit operator adapter. No default connection, activation or credential output.
const fs=require('fs'),path=require('path'),j=require('./linear-exit-install-journal');
const maintenance=require('./linear-exit-install-maintenance'),finalize=require('./linear-exit-install-finalize');
const profiles=require('./linear-exit-install-profiles'),targetApi=require('./linear-exit-observed-full-target');
const observedCatalog=require('./linear-exit-observed-public-catalog');
const control=require('./linear-exit-control-companion').forProfile('core+diagnostics+retirement');
const ROOT=path.resolve(__dirname,'..'),PLAN='3c000b76db5cf6dc31a90b61ad7dc7751d6ce02c74b6d40939dbbcccbe6acbfb',TARGET='f3db4b7cd0649800e4811d1c4b32cf3f37e5c2bf951d4b12d22009faf08aa28f';
const fail=x=>{throw Error('INSTALL_OPERATOR_'+x);};
function absolute(p){if(typeof p!=='string'||!path.isAbsolute(p))fail('ABSOLUTE_PATH');return p;}
function load(c){
 if(!c||!/^[a-z]{20}$/.test(c.projectRef)||c.host!=='db.'+c.projectRef+'.supabase.co'||c.port!==5432||c.database!=='postgres'||c.user!=='postgres'||typeof c.password!=='string'||!c.password)fail('CONNECTION');
 const ca=fs.readFileSync(absolute(c.caFile),'utf8');if(!ca.includes('BEGIN CERTIFICATE'))fail('CA');
 if(!c.expectedDatabaseIdentity||c.expectedDatabaseIdentity.database!==c.database||c.expectedDatabaseIdentity.session_user!==c.user)fail('IDENTITY_CONFIG');
 const {plan:PLAN,target:TARGET}=profiles.get(c.profile);const baseline=JSON.parse(fs.readFileSync(absolute(c.baselineFile))),built=profiles.build(baseline,c.profile);
 if(built.planSha256!==PLAN)fail('PLAN');const plan=j.compile(built.planBytes,PLAN);if(plan.steps.length!==55)fail('CHUNKS');
 const targetBytes=fs.readFileSync(absolute(c.targetFile));if(j.sha(targetBytes)!==TARGET)fail('TARGET');const target=JSON.parse(targetBytes);
 if(target.plan_sha256!==PLAN||target.stage_id!==plan.stage_id)fail('TARGET_BINDING');
 const proof=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json')));
 for(const p of proof.source_pins)if(j.sha(fs.readFileSync(path.join(ROOT,p.file)))!==p.sha256)fail('SOURCE_PIN');
 return {ca,plan,target,targetBytes,planBytes:built.planBytes};
}
function consent(c){if(!/^[a-f0-9]{64}$/.test(c.ownerWindowEvidenceSha256||''))fail('WINDOW_EVIDENCE');return 'APPLY:'+profiles.get(c.profile).plan+':'+j.sha(j.canonical(c.expectedDatabaseIdentity))+':'+c.ownerWindowEvidenceSha256;}
async function execute(c,prepared,session,applyToken){
 const {plan:PLAN,target:TARGET}=profiles.get(c.profile);const {plan,planBytes,target,targetBytes}=prepared,q=(s,p=[])=>session.query(s,p);let locked=false,stage='read_only_observation';
 const opts={session,planBytes,planSha256:PLAN,expectedStageId:plan.stage_id,expectedDatabaseIdentity:c.expectedDatabaseIdentity};
 try{
  await q('begin read only');try{await q('set local search_path=pg_catalog,public');const ids=await q(j.IDENTITY_SQL);if(ids.length!==1||j.canonical(ids[0].identity)!==j.canonical(c.expectedDatabaseIdentity))fail('IDENTITY');const tls=await q('select ssl from pg_stat_ssl where pid=pg_backend_pid()');if(tls.length!==1||tls[0].ssl!==true)fail('TLS');const rows=await q(plan.catalog_sql);if(rows.length!==1||!rows[0].catalog)fail('CATALOG');const namespaces=await q("select to_regnamespace('linear_exit_maintenance') is not null as maintenance, to_regnamespace('linear_exit_install') is not null as journal");if(namespaces.length!==1)fail('NAMESPACE');if(!namespaces[0].maintenance&&!namespaces[0].journal&&j.sha(j.canonical(rows[0].catalog))!==plan.initial_catalog_sha256)fail('BASELINE');if(!applyToken)return {status:'READ_ONLY_OBSERVATION',existing_install_state:namespaces[0],resume_validated:false,installation_authorized:false};}finally{await q('rollback');}
  if(applyToken!==consent(c))fail('CONSENT');
  await q('set search_path=pg_catalog,public');const l=await q('select pg_try_advisory_lock(19370101,1) as acquired');if(l[0]?.acquired!==true)fail('BUSY');locked=true;
  const existing=await q("select to_regnamespace('linear_exit_maintenance') is not null as present");let alreadyFinal=false;
  if(existing[0]?.present){const guards=await q("select count(*)::int as n from pg_trigger where tgname='linear_exit_maintenance_dml_v1' and tgrelid in(select oid from pg_class where relnamespace='public'::regnamespace)");alreadyFinal=guards[0]?.n===0;}
  stage='maintenance_install';if(!alreadyFinal)await maintenance.run(opts);stage='target_comparison';
  // Compare the independent bare target while rollback restores protection.
  await q('begin');try{const guards=await q("select c.relname from pg_class c join pg_trigger t on t.tgrelid=c.oid where c.relnamespace='public'::regnamespace and t.tgname='linear_exit_maintenance_dml_v1' order by c.relname");const expectedGuards=observedCatalog.postInstallPublicTables(plan.initial_catalog_sha256).expected;if(guards.length!==(alreadyFinal?0:expectedGuards))fail('GUARD_COUNT');for(const g of guards)await q('drop trigger linear_exit_maintenance_dml_v1 on public."'+g.relname.replaceAll('"','""')+'"');await q('select public.production_retirement_contract_assert_v1()');const [pub]=await q(plan.catalog_sql),[priv]=await q('select ('+control.catalogSql()+') as catalog');targetApi.compare({targetBytes,targetSha256:TARGET,planBytes,planSha256:PLAN,catalog:pub.catalog,privateCatalog:priv.catalog});}finally{await q('rollback');}
  stage='finalization';const result=await finalize.run({...opts,expectedFinalCatalogSha256:target.catalog_sha256});
  await q('select public.production_retirement_contract_assert_v1()');const [pub]=await q(plan.catalog_sql),[priv]=await q('select ('+control.catalogSql()+') as catalog');targetApi.compare({targetBytes,targetSha256:TARGET,planBytes,planSha256:PLAN,catalog:pub.catalog,privateCatalog:priv.catalog});
  return {status:'INSTALLED_SCHEMA_TARGET_MATCH',runtime_dormancy_verified:false,plan_sha256:PLAN,target_sha256:TARGET,finalizer:result,external_fencing_attested:false,activation_performed:false};
 }catch(e){const safe=Error('INSTALL_OPERATOR_EXECUTION_REFUSED');safe.operatorStage=stage;throw safe;}finally{if(locked)await q('select pg_advisory_unlock(19370101,1)');}
}
let diagnostics;
async function main(){
 const args=process.argv.slice(2);if(args.length<1||args.length>2)fail('ARGUMENTS');
 const c=JSON.parse(fs.readFileSync(absolute(args[0])));diagnostics=path.join(fs.realpathSync(absolute(c.diagnosticsDirectory)),'install-operator-failure-'+require('crypto').randomUUID()+'.private.json');const prepared=load(c);
 if(args[1]&&args[1]!==consent(c))fail('CONSENT');
 // Driver is an explicitly installed local postgres package; no npm/network install.
 const postgres=require('postgres'),db=postgres({host:c.host,port:c.port,database:c.database,username:c.user,password:c.password,ssl:{ca:prepared.ca,rejectUnauthorized:true,servername:c.host},max:1,prepare:false,connect_timeout:20}),conn=await db.reserve();
 try{const result=await execute(c,prepared,{query:(s,p=[])=>conn.unsafe(s,p)},args[1]);process.stdout.write(JSON.stringify(result)+'\n');}finally{conn.release();await db.end({timeout:5});}
}
if(require.main===module)main().catch(e=>{if(diagnostics){try{fs.writeFileSync(diagnostics,JSON.stringify({status:'REFUSED',code:'INSTALL_OPERATOR_REFUSED',stage:e.operatorStage||'configuration_or_connection',automatic_retry:false})+'\n',{flag:'wx',mode:0o600});}catch{}}process.stderr.write('INSTALL_OPERATOR_REFUSED; inspect configured private diagnostics and installed state. No automatic retry.\n');process.exitCode=1;});
module.exports={load,execute,consent};
