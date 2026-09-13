'use strict';
// Explicit preparation orchestration over a caller-owned dedicated connection.
// No connection factory, deployment CLI, stage discovery or inferred install plan.
const fs=require('fs'),path=require('path'),journal=require('./linear-exit-install-journal'),contract=require('./linear-exit-install-journal-catalog');
const fail=s=>{throw Error('INSTALL_BOOTSTRAP_'+s);};
async function run(options){
 const {session,planBytes,planSha256,expectedDatabaseIdentity,expectedStageId}=options;
 const plan=journal.compile(planBytes,planSha256);if(plan.stage_id!==expectedStageId)fail('STAGE');
 if(!session||typeof session.query!=='function')fail('SESSION');
 const owner=fs.readFileSync(path.resolve(__dirname,'..',contract.owner_path));if(journal.sha(owner)!==contract.owner_sha256)fail('OWNER_SOURCE_DRIFT');
 const chunks=journal.chunks(owner.toString('utf8'));if(chunks.length!==1||!chunks[0].explicit)fail('OWNER_TRANSACTION');
 const query=(sql,params=[])=>session.query(sql,params);let locked=false,tx=false;
 async function catalog(){const r=await query(plan.catalog_sql);if(r.length!==1||!Object.hasOwn(r[0],'catalog'))fail('CATALOG_SHAPE');return journal.sha(journal.canonical(r[0].catalog));}
 async function verify(){const r=await query(contract.query);if(r.length!==1||journal.sha(journal.canonical(r[0].journal_catalog))!==contract.catalog_sha256)fail('OWNER_CATALOG_DRIFT');const h=await query("select exists(select from pg_inherits where inhparent=to_regclass('linear_exit_install.journal_v1') or inhrelid=to_regclass('linear_exit_install.journal_v1')) as inherited");if(h.length!==1||h[0].inherited!==false)fail('OWNER_CATALOG_DRIFT');}
 try{
  await query('set search_path=pg_catalog,public');const ids=await query(journal.IDENTITY_SQL);if(ids.length!==1||journal.canonical(ids[0].identity)!==journal.canonical(expectedDatabaseIdentity))fail('IDENTITY');
  const lock=await query('select pg_try_advisory_lock(19370101,1) as acquired');if(lock[0]?.acquired!==true)fail('BUSY');locked=true;
  const schemas=await query("select exists(select from pg_namespace where nspname='linear_exit_install') as present");if(schemas.length!==1||typeof schemas[0].present!=='boolean')fail('SCHEMA_SHAPE');
  if(!schemas[0].present){
   if(await catalog()!==plan.initial_catalog_sha256)fail('CATALOG_DRIFT');
   await query('begin');tx=true;for(const sql of chunks[0].statements)await query(sql);await verify();
   // The plan catalog must exclude private bootstrap objects, not silently rebase.
   if(await catalog()!==plan.initial_catalog_sha256)fail('BOOTSTRAP_CHANGED_STAGE');
   await query('insert into linear_exit_install.journal_v1(singleton,plan_sha256,stage_id,database_identity,initial_catalog_sha256,completed,after_catalog_sha256) values(true,$1,$2,$3::jsonb,$4,$5::jsonb,$6)',[plan.sha256,plan.stage_id,expectedDatabaseIdentity,plan.initial_catalog_sha256,[],plan.initial_catalog_sha256]);
   await query('commit');tx=false;
  }else await verify();
  // Reentrant advisory acquisition by the engine retains this wrapper lock.
  return {...await journal.run(options),bootstrap_verified:true};
 }catch(e){if(tx){try{await query('rollback');}catch{}}throw e;}
 finally{if(locked){try{await query('select pg_advisory_unlock(19370101,1)');}catch{}}}
}
module.exports={run};
