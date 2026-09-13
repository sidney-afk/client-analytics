'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {Cluster,FOUNDATION_SQL}=require('../scripts/f42-apply-rehearsal');
const retirement=process.argv.includes('--retirement');
const control=require('../scripts/linear-exit-control-companion').forProfile(retirement||process.argv.includes('--diagnostics')?'core+diagnostics':'core');
assert.equal(process.env.F63_REQUIRE_POSTGRES,'1');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])assert(!process.env[key],'inherited routing refused');
assert(process.env.PROOF_OUTPUT_ROOT&&path.isAbsolute(process.env.PROOF_OUTPUT_ROOT));
const c=new Cluster();assert.equal(c.host,'127.0.0.1');
try{
 c.start();c.exec(FOUNDATION_SQL.slice(0,FOUNDATION_SQL.indexOf('create table if not exists public.team_members')));c.exec(control.sourceSql());
 const prerequisite=[];let selectedPrivate=null;
 if(retirement){
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),split=require('../scripts/track-b-recovery-package').splitSqlStatements;
  const file='supabase/migrations/20260912174907_card_atomic_admission_preparation.sql',bytes=fs.readFileSync(file);
  assert.equal(sha(bytes),'1699ab4a661558460eeb94b2c4b85244265bb9b890589efbc4876c6266107cea');
  const statements=split(bytes.toString('utf8')).filter(s=>/^create table public\.card_write_admission_v1\s*\(/i.test(s.text));assert.equal(statements.length,1);
  c.exec(statements[0].text+';');prerequisite.push({file,sha256:sha(bytes),selected_statement_sha256:sha(statements[0].text),classification:'EXACT_SOURCE_TABLE_METADATA_PREREQUISITE_ONLY_NO_SEED'});
  const phases=require('../scripts/linear-exit-control-source-phases'),ownerBytes=fs.readFileSync(phases.RETIREMENT_OWNER),ownerSql=ownerBytes.toString('utf8');
  const start=ownerSql.indexOf('create function linear_exit_provider.retirement_send_fence_v1()'),last='alter table linear_exit_provider.send_attempts_v1 enable always trigger retirement_send_fence_v1;';
  assert(start>=0);const finish=ownerSql.indexOf(last,start);assert(finish>start);
  const fragment=ownerSql.slice(start,finish+last.length);assert.equal(Buffer.byteLength(fragment),960);assert.equal(sha(fragment),'ec51f3cf98710a7325463cf93f5be5433281c2306fc56d289b25454afe93e073');
  const pieces=phases.sourcePhases([[phases.RETIREMENT_OWNER,sha(ownerBytes)]]);assert.equal(pieces.beforePublic,'');c.exec(pieces.afterPrivateRows);
  selectedPrivate={file:phases.RETIREMENT_OWNER,observed_file_sha256:sha(ownerBytes),selected_private_sha256:sha(fragment),statement_count:4};
 }
 const catalog=c.scalarJson('set search_path=pg_catalog,public;'+control.catalogSql());for(const name of control.NAMES)assert(catalog[name].table);
 if(retirement)assert.equal(catalog['linear_exit_provider.send_attempts_v1'].functions.find(f=>f.name==='retirement_send_fence_v1').body_md5,'575f10ca7b9865005d9666393628c395');
 fs.writeFileSync(path.join(process.env.PROOF_OUTPUT_ROOT,'control-schema.private.json'),JSON.stringify({classification:'ISOLATED_SOURCE_CONTROL_SCHEMA',owners:control.OWNERS,prerequisite,selected_private:selectedPrivate,catalog},null,2)+'\n',{flag:'wx'});
 console.log('LINEAR_EXIT_CONTROL_SCHEMA_OK');
}finally{c.stop();}
