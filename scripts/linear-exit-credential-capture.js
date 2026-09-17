'use strict';
// Prepared, opt-in API only. Returns a complete verified pair in memory; never
// publishes output paths. Shared row snapshot does not fence sequence state.
const fs=require('fs');const os=require('os');const path=require('path');
const crypto=require('crypto');
const companion=require('./linear-exit-credential-companion');
const recovery=require('./track-b-recovery-package');
const qi=s=>'"'+s.replace(/"/g,'""')+'"';
function captureRows(query){
 const snapshotQuery=query;
 query=sql=>snapshotQuery("set local datestyle='ISO, YMD';\n"+sql);
 const contract=companion.schema();const names=contract.tables.map(t=>"'"+t.name+"'").join(',');
 const actual=JSON.parse(query(`select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'primary_key',coalesce((select jsonb_agg(a.attname order by k.ord) from pg_constraint p cross join lateral unnest(p.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum where p.conrelid=c.oid and p.contype='p'),'[]'::jsonb)) order by c.relname),'[]'::jsonb) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname in (${names})`));
 const expected=contract.tables.map(t=>({name:t.name,columns:t.columns,primary_key:t.primary_key}));
 const {canonicalJson}=require('./track-b-backup');
 if(canonicalJson(actual)!==canonicalJson(expected))throw Error('CREDENTIAL_CAPTURE_ROW_SCHEMA_MISMATCH');
 return Object.fromEntries(contract.tables.map(t=>[t.name,{columns:t.columns,primary_key:t.primary_key,rows:JSON.parse(query(`select coalesce(jsonb_agg(jsonb_build_array(${t.columns.map(c=>qi(c.name)+'::text').join(',')})),'[]'::jsonb) from public.${qi(t.name)}`))}]));
}
async function captureTriple(options){
 if(options.corpusName!=='history-v11')throw Error('CREDENTIAL_CAPTURE_HISTORY_V11_REQUIRED');
 if(typeof options.hmacInput!=='string')throw Error('CREDENTIAL_CAPTURE_EXPLICIT_KEY_REQUIRED');
 if(options.output||options.tempDir||options.hooks?.captureSnapshot)throw Error('CREDENTIAL_CAPTURE_OUTPUT_OVERRIDE_REFUSED');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'credential-triple-private-'));
 try{
  let rows;let priorityRows;
  await recovery.captureRecoveryPackage({...options,requireCredentialCompanion:true,output:path.join(dir,'parent.private'),tempDir:dir,hooks:{...options.hooks,captureSnapshot:query=>{priorityRows=require('./linear-exit-priority-capture').captureRows(query);rows=captureRows(query);}}});
  const parentBytes=fs.readFileSync(path.join(dir,'parent.private'));
  const parent=recovery.readRecoveryPackage(parentBytes,options.hmacInput);
  const identity={package_sha256:crypto.createHash('sha256').update(parentBytes).digest('hex'),schema_fingerprint:parent.manifest.schema.fingerprint};
  const priorityBytes=require('./linear-exit-priority-companion').encode(priorityRows,identity,options.hmacInput);
  const credentialBytes=companion.encode({tables:rows,parentBytes,priorityBytes,hmacInput:options.hmacInput});
  companion.verifyTriple({credentialBytes,priorityBytes,parentBytes,hmacInput:options.hmacInput});
  return {parentBytes,priorityBytes,credentialBytes,shared_exported_snapshot:true,complete_storage_proven:false,encryption_proven:false,full_restore_proven:false};
 }finally{
  const resolved=path.resolve(dir);
  if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('credential-triple-private-'))throw Error('CREDENTIAL_CAPTURE_CLEANUP_PATH_REFUSED');
  fs.rmSync(resolved,{recursive:true,force:true});
 }
}
module.exports={captureRows,captureTriple};
