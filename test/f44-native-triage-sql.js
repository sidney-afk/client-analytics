'use strict';
// One explicit disposable PostgreSQL database; no endpoint/live credentials.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{spawnSync}=require('child_process');
if(process.env.F44_NATIVE_DISPOSABLE!=='LOCAL_DISPOSABLE_ONLY'){
  if(process.env.F44_NATIVE_REQUIRE==='1')throw Error('f44_native_disposable_binding_required');
  console.log('SKIP F44 native triage SQL: explicit disposable binding required');process.exit(0);
}
const root=path.resolve(__dirname,'..'),host=process.env.PGHOST,port=String(process.env.PGPORT||'');
assert.equal(host,'127.0.0.1');assert.match(port,/^\d{4,5}$/);
const {LocalDatabase,source}=require('../scripts/card-change-journal-rehearsal');
const {setup}=require('../scripts/card-history-integrated-rehearsal');
const config={host,port,user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD||'',psql:process.env.F44_NATIVE_PSQL||'psql'};
const db=new LocalDatabase(config),output=process.env.F44_NATIVE_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'f44-native-'));
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'DATABASE.private.json'),JSON.stringify({database:db.name,retained:true}));
try{
  db.create();setup(db,source('2026-09-05-calendar-feedback-recovery.sql'));
  for(const file of ['2026-09-05-crosswalk-bind-and-import.sql','2026-09-06-native-card-materialization-boundary.sql',
    '2026-07-14-linear-intake-receipts.sql','2026-09-07-legacy-intake-native-triage.sql'])db.query(source(file));
  // Platform baseline for the old ledger's INVOKER pgcrypto hash constraint.
  // The minimal generic fixture does not otherwise expose its extension schema.
  db.query('grant usage on schema extensions to service_role');
  const run=spawnSync(process.execPath,['--experimental-strip-types',path.join(root,'scripts/f44-native-triage-lane.mjs')],{
    encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024,windowsHide:true,
    env:{...process.env,NIR_PGHOST:host,NIR_PGPORT:port,NIR_PGUSER:config.user,NIR_PGDATABASE:db.name,NIR_PSQL:config.psql,F44_NATIVE_OUTPUT:output}});
  fs.writeFileSync(path.join(output,'lane.private.log'),(run.stdout||'')+(run.stderr||''));
  const summary=(run.stdout||'').match(/^F44_NATIVE_RESULT .+$/m);if(summary)console.log(summary[0]);
  assert.equal(run.status,0,'f44_native_handler_sql_failed_private_evidence_retained');
}catch(error){fs.writeFileSync(path.join(output,'failure.private.log'),String(error.stack));console.error('F44 triage SQL failed; private evidence retained');process.exitCode=1;}
