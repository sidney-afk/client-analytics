'use strict';
// Prepared opt-in component. A reviewed stage/plan and dedicated connection are
// supplied explicitly. No bootstrap, network connection, activation or CLI.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),journalContract=require('./linear-exit-install-journal-catalog');
const {splitSqlStatements}=require('./track-b-recovery-package');
const {transactions}=require('./linear-exit-install-manifest');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(sort(x));
function sort(x){if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));return x;}
const fail=x=>{throw Error('INSTALL_JOURNAL_'+x);};
const HASH=/^[a-f0-9]{64}$/;
function chunks(sql){
 transactions(sql);const statements=splitSqlStatements(sql);let open=null;const out=[];
 for(const s of statements){if(s.kind!=='statement')fail('META_COMMAND');const t=s.text;
  if(/^(begin|start transaction)$/i.test(t)){if(open)fail('NESTED');open=[];continue;}
  if(/^(commit|end)$/i.test(t)){if(!open)fail('COMMIT');out.push({explicit:true,statements:open});open=null;continue;}
  if(/^(begin|start|commit|end|abort|prepare|call|copy|vacuum|reset|discard|listen|notify|unlisten)\b/i.test(t)||/\bconcurrently\b/i.test(t))fail('UNSUPPORTED_CONTROL');
  if(/^set\b/i.test(t)&&(!open||!/^set local\b/i.test(t)))fail('SESSION_STATE');
  if(!/^(create|alter|drop|grant|revoke|insert|update|delete|select|do|comment|set local|savepoint|release|rollback to)\b/i.test(t))fail('UNSUPPORTED_STATEMENT');
  if(open)open.push(t+';');else out.push({explicit:false,statements:[t+';']});
 }
 if(open)fail('UNCLOSED');if(!out.length)fail('EMPTY_SOURCE');return out.map((c,i)=>({...c,index:i,sha256:sha(c.statements.join('\n'))}));
}
function compile(bytes,expected){
 if(!Buffer.isBuffer(bytes)||bytes.length>4*1024*1024||!HASH.test(expected)||sha(bytes)!==expected)fail('PLAN_HASH');
 const p=JSON.parse(bytes);if(p.format!=='linear-exit-install-journal-plan-v1'||typeof p.stage_id!=='string'||!p.stage_id||!HASH.test(p.initial_catalog_sha256)||typeof p.catalog_sql!=='string'||!/^select\b/i.test(p.catalog_sql.trim())||splitSqlStatements(p.catalog_sql).length!==1||!Array.isArray(p.sources)||!p.sources.length||p.sources.length>128)fail('PLAN_SHAPE');
 const done=new Set(),steps=[];
 for(const source of p.sources){if(!source||typeof source.id!=='string'||done.has(source.id)||typeof source.sql!=='string'||sha(source.sql)!==source.sha256||!Array.isArray(source.dependencies)||source.dependencies.some(x=>!done.has(x)))fail('SOURCE_ORDER_OR_HASH');for(const chunk of chunks(source.sql))steps.push({...chunk,source_id:source.id,source_sha256:source.sha256});done.add(source.id);}
 return {...p,steps,sha256:expected};
}
const IDENTITY_SQL="select jsonb_build_object('database',current_database(),'database_oid',(select oid::text from pg_database where datname=current_database()),'system_identifier',(select system_identifier::text from pg_control_system()),'session_user',session_user) as identity";
async function run({session,planBytes,planSha256,expectedDatabaseIdentity,expectedStageId}){
 if(sha(fs.readFileSync(path.join(__dirname,'..',journalContract.owner_path)))!==journalContract.owner_sha256)fail('OWNER_SOURCE_DRIFT');
 const plan=compile(planBytes,planSha256);if(plan.stage_id!==expectedStageId)fail('STAGE');if(!session||typeof session.query!=='function')fail('SESSION');
 const query=(s,p=[])=>session.query(s,p);let locked=false,inTransaction=false;
 async function catalog(){const rows=await query(plan.catalog_sql);if(rows.length!==1||!Object.hasOwn(rows[0],'catalog'))fail('CATALOG_SHAPE');return sha(canonical(rows[0].catalog));}
 try{
  await query('set search_path=pg_catalog,public');
  const identities=await query(IDENTITY_SQL);if(identities.length!==1||canonical(identities[0].identity)!==canonical(expectedDatabaseIdentity))fail('IDENTITY');
  const lock=await query('select pg_try_advisory_lock(19370101,1) as acquired');if(lock[0]?.acquired!==true)fail('BUSY');locked=true;
  const inheritance=await query("select exists(select from pg_inherits where inhparent=to_regclass('linear_exit_install.journal_v1') or inhrelid=to_regclass('linear_exit_install.journal_v1')) as inherited");if(inheritance.length!==1||inheritance[0].inherited!==false)fail('OWNER_CATALOG_DRIFT');
  const structure=await query(journalContract.query);if(structure.length!==1||sha(canonical(structure[0].journal_catalog))!==journalContract.catalog_sha256)fail('OWNER_CATALOG_DRIFT');
  const rows=await query('select * from linear_exit_install.journal_v1');if(rows.length>1)fail('JOURNAL_SHAPE');let state=rows[0];
  if(state){if(state.plan_sha256!==plan.sha256||state.stage_id!==plan.stage_id||canonical(state.database_identity)!==canonical(expectedDatabaseIdentity)||state.initial_catalog_sha256!==plan.initial_catalog_sha256||!Array.isArray(state.completed)||state.completed.length>plan.steps.length)fail('JOURNAL_BINDING');
   for(const [i,saved] of state.completed.entries()){const step=plan.steps[i];if(canonical(saved)!==canonical({source_id:step.source_id,source_sha256:step.source_sha256,chunk_index:step.index,chunk_sha256:step.sha256}))fail('JOURNAL_PREFIX');}
  }
  if(await catalog()!==(state?state.after_catalog_sha256:plan.initial_catalog_sha256))fail('CATALOG_DRIFT');
  let completed=state?.completed||[];
  for(const step of plan.steps.slice(completed.length)){
   await query('begin');inTransaction=true;
   // One original explicit transaction or one original autocommit statement.
   // Progress joins that transaction; source COMMIT is represented by the
   // final COMMIT below, never an additional owner commit.
   for(const statement of step.statements)await query(statement);
   const after=await catalog();const next=[...completed,{source_id:step.source_id,source_sha256:step.source_sha256,chunk_index:step.index,chunk_sha256:step.sha256}];
   await query('insert into linear_exit_install.journal_v1(singleton,plan_sha256,stage_id,database_identity,initial_catalog_sha256,completed,after_catalog_sha256) values(true,$1,$2,$3::jsonb,$4,$5::jsonb,$6) on conflict(singleton) do update set completed=excluded.completed,after_catalog_sha256=excluded.after_catalog_sha256',[plan.sha256,plan.stage_id,expectedDatabaseIdentity,plan.initial_catalog_sha256,next,after]);
   await query('commit');inTransaction=false;completed=next;
  }
  return {status:'PREPARED_JOURNALED_PLAN_COMPLETE',completed_chunks:completed.length,installation_authorized:false,application_writer_freeze_proven:false,nontransactional_effects_rollback_proven:false};
 }catch(e){if(inTransaction){try{await query('rollback');}catch{}}throw e;}
 finally{if(locked){try{await query('select pg_advisory_unlock(19370101,1)');}catch{}}}
}
module.exports={compile,chunks,run,IDENTITY_SQL,sha,canonical};
