'use strict';
// Fixed control-owner selection. The retirement fence is installed only after
// public predata and archival private rows; callers cannot supply SQL callbacks.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..');
const RETIREMENT_OWNER='supabase/migrations/20260913062149_retirement_switch_preparation.sql';
const fail=code=>{throw Error('CONTROL_COMPANION_'+code);};
function isPrivateStatement(text){
 if(/^create index receipts_v1_recorded_at on write_refusal_diagnostics\.receipts_v1\b/i.test(text))return true;
 if(/^create trigger\b/i.test(text))return /\bon linear_exit_provider\.send_attempts_v1\b/i.test(text);
 return /^(?:create schema|create table|alter table|create (?:or replace )?function|revoke all on (?:schema |function |table )?)\s*(?:linear_exit_install|linear_exit_maintenance|linear_exit_provider|write_refusal_diagnostics)\b/i.test(text);
}
function retirementPhase(statements){
 const checks=[
  /^create function linear_exit_provider\.retirement_send_fence_v1\(\)\s+returns trigger language plpgsql security definer set search_path=pg_catalog,public as \$fence\$[\s\S]+\$fence\$$/i,
  /^revoke all on function linear_exit_provider\.retirement_send_fence_v1\(\) from public,anon,authenticated,service_role$/i,
  /^create trigger retirement_send_fence_v1 before insert on linear_exit_provider\.send_attempts_v1 for each row execute function linear_exit_provider\.retirement_send_fence_v1\(\)$/i,
  /^alter table linear_exit_provider\.send_attempts_v1 enable always trigger retirement_send_fence_v1$/i
 ];
 if(statements.length!==checks.length||statements.some((s,i)=>!checks[i].test(s)))fail('RETIREMENT_PRIVATE_PHASE');
 return statements.map(s=>require('./track-b-recovery-package').preserveFunctionBodyTransport(s)+';').join('\n');
}
function sourcePhases(owners){
 const before=[],after=[];
 const seen=new Set();
 for(const [file,pin] of owners){
  if(seen.has(file))fail('DUPLICATE_SOURCE');seen.add(file);
  const bytes=fs.readFileSync(path.join(ROOT,file));
  if(!/^[a-f0-9]{64}$/.test(pin)||crypto.createHash('sha256').update(bytes).digest('hex')!==pin)fail('SOURCE_DRIFT');
  const statements=require('./track-b-recovery-package').splitSqlStatements(bytes.toString('utf8'))
   .filter(s=>s.kind==='statement'&&isPrivateStatement(s.text)).map(s=>s.text);
  if(file===RETIREMENT_OWNER)after.push(retirementPhase(statements));
  else before.push(...statements.map(s=>s+';'));
 }
 return {beforePublic:before.join('\n'),afterPrivateRows:after.join('\n')};
}
// Called only by the authenticated retirement-profile renderer. The singleton
// remains archival except for its closed mode; verification uses this exact
// derived row, rather than mutating it after multiset verification has passed.
function quarantineAdmission(payload,parent){
 const name='card_write_admission_v1',table=payload.tables?.[name];
 if(payload.format!=='complete-application-data-v2'||!parent.manifest.omitted_data_tables.includes(name)
  ||!table||table.name!==name||!Array.isArray(table.columns)||!Array.isArray(table.rows)||table.rows.length!==1)fail('ADMISSION_QUARANTINE_SHAPE');
 const mode=table.columns.findIndex(c=>c.name==='mode'),singleton=table.columns.findIndex(c=>c.name==='singleton');
 if(mode<0||singleton<0||table.columns[mode].type!=='text'||table.columns[singleton].type!=='boolean'
  ||table.columns[mode].generated||table.columns[singleton].generated
  ||table.columns.filter(c=>c.name==='mode').length!==1||table.columns.filter(c=>c.name==='singleton').length!==1
  ||table.rows[0].length!==table.columns.length||table.rows[0][singleton]!=='true'
  ||!['open','closed','sealed'].includes(table.rows[0][mode]))fail('ADMISSION_QUARANTINE_SHAPE');
 const row=table.rows[0].slice();row[mode]='closed';
 return {...payload,tables:{...payload.tables,[name]:{...table,rows:[row]}}};
}
module.exports={sourcePhases,RETIREMENT_OWNER,quarantineAdmission};
