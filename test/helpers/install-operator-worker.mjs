import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import postgres from 'npm:postgres@3.4.7';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),ROOT=path.resolve(''),api=require(ROOT+'/scripts/linear-exit-install-operator'),j=require(ROOT+'/scripts/linear-exit-install-journal');
assert.equal(Deno.env.get('PGHOST'),'127.0.0.1');
const db=postgres({host:'127.0.0.1',port:Number(Deno.env.get('PGPORT')),username:Deno.env.get('PGUSER'),password:Deno.env.get('PGPASSWORD'),database:Deno.env.get('JOURNAL_DATABASE'),ssl:false,max:1,prepare:false}),conn=await db.reserve();
const planBytes=fs.readFileSync(Deno.env.get('JOURNAL_PLAN')),plan=j.compile(planBytes,j.sha(planBytes));
if(Deno.env.get('INSTALL_OPERATOR_CALIBRATE')==='1'){
 const maintenance=require(ROOT+'/scripts/linear-exit-install-maintenance'),finalize=require(ROOT+'/scripts/linear-exit-install-finalize'),control=require(ROOT+'/scripts/linear-exit-control-companion').forProfile('core+diagnostics+retirement'),targetApi=require(ROOT+'/scripts/linear-exit-observed-full-target');
 const opts={session:{query:(s,p=[])=>conn.unsafe(s,p)},planBytes,planSha256:j.sha(planBytes),expectedDatabaseIdentity:JSON.parse(Deno.env.get('JOURNAL_IDENTITY')),expectedStageId:plan.stage_id};
 try{await maintenance.run(opts);let artifact;await conn.unsafe('begin');try{const guards=await conn.unsafe("select c.relname from pg_class c join pg_trigger t on t.tgrelid=c.oid where c.relnamespace='public'::regnamespace and t.tgname='linear_exit_maintenance_dml_v1'");assert.equal(guards.length,require(ROOT+'/scripts/linear-exit-observed-public-catalog').postInstallPublicTables(plan.initial_catalog_sha256).expected);for(const g of guards)await conn.unsafe('drop trigger linear_exit_maintenance_dml_v1 on public."'+g.relname.replaceAll('"','""')+'"');await conn.unsafe('select public.production_retirement_contract_assert_v1()');const [pub]=await conn.unsafe(plan.catalog_sql),[priv]=await conn.unsafe('select ('+control.catalogSql()+') as catalog');artifact=targetApi.create({...opts,catalog:pub.catalog,privateCatalog:priv.catalog});}finally{await conn.unsafe('rollback');}await finalize.run({...opts,expectedFinalCatalogSha256:artifact.catalog_sha256});fs.writeFileSync(path.join(Deno.env.get('PROOF_OUTPUT_ROOT'),'optout-target.private.json'),JSON.stringify(artifact,null,2)+'\n');fs.writeFileSync(path.join(Deno.env.get('PROOF_OUTPUT_ROOT'),'operator-result.private.json'),JSON.stringify({status:'CALIBRATION_ONLY',plan_sha256:opts.planSha256,target_sha256:j.sha(Buffer.from(JSON.stringify(artifact,null,2)+'\n')),activation_performed:false}));}finally{conn.release();await db.end({timeout:5});}Deno.exit(0);
}
const targetBytes=fs.readFileSync(Deno.env.get('INSTALL_OPERATOR_TARGET'));
assert.equal(j.sha(targetBytes),require(ROOT+'/scripts/linear-exit-install-profiles').get(Deno.env.get('INSTALL_OPERATOR_PROFILE')||'observed67').target);
const profile=Deno.env.get('INSTALL_OPERATOR_PROFILE')||'observed67',prepared={plan,planBytes,targetBytes,target:JSON.parse(targetBytes)},c={profile,expectedDatabaseIdentity:JSON.parse(Deno.env.get('JOURNAL_IDENTITY')),ownerWindowEvidenceSha256:'a'.repeat(64)};
// Only transport attestation is shimmed; all installer SQL runs on real PG17.
const session={query:(s,p=[])=>s==='select ssl from pg_stat_ssl where pid=pg_backend_pid()'?Promise.resolve([{ssl:true}]):conn.unsafe(s,p)};
try{
 const seedBefore=await conn.unsafe("select to_jsonb(t) as row from public.team_members t where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'");if(profile==='observed67_optout'){assert.equal(seedBefore.length,1);assert.equal(seedBefore[0].row.auto_assign_opt_out,true);}
 assert.equal((await api.execute(c,prepared,session)).status,'READ_ONLY_OBSERVATION');
 await assert.rejects(api.execute({...c,expectedDatabaseIdentity:{...c.expectedDatabaseIdentity,database_oid:'0'}},prepared,session,api.consent(c)));
 const result=await api.execute(c,prepared,session,api.consent(c));assert.equal(result.status,'INSTALLED_SCHEMA_TARGET_MATCH');assert.equal(result.runtime_dormancy_verified,false);
 const replay=await api.execute(c,prepared,session,api.consent(c));assert.equal(replay.finalizer.already_finalized,true);
 await assert.rejects(api.execute(c,prepared,session,'wrong-consent'));
 const [guards]=await conn.unsafe("select count(*)::int as n from pg_trigger where tgname='linear_exit_maintenance_dml_v1'");assert.equal(guards.n,0);
 const prerequisite=fs.readFileSync(Deno.env.get('INSTALL_OPERATOR_PREREQUISITE'));assert.equal(j.sha(prerequisite),'fbd5ae8ecbef6e28cce913878791cb5f2a2a7fc70a7c930d3c0d3b508966fbaa');
 await conn.unsafe('begin');try{
  const before=await conn.unsafe("select to_jsonb(t)-'auto_assign_opt_out' as row from public.team_members t order by id");
  for(const chunk of j.chunks(prerequisite.toString('utf8')))for(const sql of chunk.statements)await conn.unsafe(sql);
  const [column]=await conn.unsafe("select a.attnotnull as required,format_type(a.atttypid,a.atttypmod) as type,pg_get_expr(d.adbin,d.adrelid) as def from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.team_members'::regclass and a.attname='auto_assign_opt_out'");assert.deepEqual(column,{required:true,type:'boolean',def:'false'});
  const after=await conn.unsafe("select to_jsonb(t)-'auto_assign_opt_out' as row from public.team_members t order by id");assert.deepEqual(after,before);
  for(const role of ['anon','authenticated']){const [r]=await conn.unsafe("select has_column_privilege($1,'public.team_members','auto_assign_opt_out','SELECT') as flag, has_column_privilege($1,'public.team_members','name','SELECT') as old",[role]);assert.equal(r.flag,false);assert.equal(r.old,true);}
  const [service]=await conn.unsafe("select has_column_privilege('service_role','public.team_members','auto_assign_opt_out','SELECT') as readable");assert.equal(service.readable,true);
 }finally{await conn.unsafe('rollback');}
 const [absent]=await conn.unsafe("select count(*)::int as n from pg_attribute where attrelid='public.team_members'::regclass and attname='auto_assign_opt_out' and not attisdropped");assert.equal(absent.n,profile==='observed67_optout'?1:0);
 assert.deepEqual(await conn.unsafe("select to_jsonb(t) as row from public.team_members t where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'"),seedBefore);
 fs.writeFileSync(path.join(Deno.env.get('PROOF_OUTPUT_ROOT'),'operator-result.private.json'),JSON.stringify({status:'PASS',profile,actual_sql_apply:true,exact_final_target:true,exact_finalized_replay:true,wrong_identity_refused:true,wrong_consent_refused:true,zero_guards:true,separate_main_prerequisite_rollback:true,populated_optout_preserved:profile==='observed67_optout',hosted_tls_transport_proven:false,activation_performed:false}));
}finally{conn.release();await db.end({timeout:5});}
