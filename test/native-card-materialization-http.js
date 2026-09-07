'use strict';
// Actual loopback HTTP/SQL lane. Existing F63 disposable binding, no live URL.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{spawnSync}=require('child_process');
if(process.env.F63_REQUIRE_POSTGRES!=='1'){
  if(process.env.CI)throw Error('native_card_http_disposable_binding_required');
  console.log('SKIP native card HTTP: explicit disposable PostgreSQL required');process.exit(0);
}
const root=path.resolve(__dirname,'..'),host=process.env.F42_REHEARSAL_PGHOST||process.env.PGHOST||'',
  port=String(process.env.F42_REHEARSAL_PGPORT||process.env.NATIVE_CARD_TEST_PORT||process.env.PGPORT||''),
  user=process.env.F42_REHEARSAL_PGUSER||process.env.NATIVE_CARD_TEST_USER||process.env.PGUSER||'postgres',
  password=process.env.PGPASSWORD||'';
assert.ok(['127.0.0.1','localhost','::1'].includes(host),'literal_disposable_loopback_required');
assert.match(port,/^\d{4,5}$/);assert.ok(+port<=65535);
for(const key of Object.keys(process.env))if(/^PG/i.test(key))delete process.env[key];
process.env.PGPASSWORD=password;
const {LocalDatabase,source}=require('../scripts/card-change-journal-rehearsal'),{setup}=require('../scripts/card-history-integrated-rehearsal');
const config={host:host==='localhost'?'127.0.0.1':host,port,user,password,psql:process.env.NATIVE_CARD_TEST_PSQL||'psql'};
const db=new LocalDatabase(config),output=process.env.NATIVE_CARD_HTTP_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'native-card-http-'));
fs.mkdirSync(output,{recursive:true});
// Keep every unique fixture DB and private failure, including successful runs.
fs.writeFileSync(path.join(output,'DATABASE.private.json'),JSON.stringify({database:db.name,retained:true}));
try{
  db.create();setup(db,source('2026-09-05-calendar-feedback-recovery.sql'));
  db.query(source('2026-09-05-crosswalk-bind-and-import.sql'));db.query(source('2026-09-06-native-card-materialization-boundary.sql'));
  const result=spawnSync(process.execPath,['--experimental-strip-types',path.join(root,'scripts/native-card-materialization/http-lane.mjs')],{
    encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024,windowsHide:true,
    env:{...process.env,NIR_PGHOST:config.host,NIR_PGPORT:port,NIR_PGUSER:user,NIR_PGDATABASE:db.name,NIR_PSQL:config.psql,NATIVE_CARD_HTTP_OUTPUT:output}});
  fs.writeFileSync(path.join(output,'lane.private.log'),(result.stdout||'')+(result.stderr||''));
  const summary=(result.stdout||'').match(/^NATIVE_CARD_HTTP_RESULT (.+)$/m);if(summary)console.log(summary[0]);
  assert.equal(result.status,0,'native_card_http_failed_private_evidence_retained');
}catch(error){fs.writeFileSync(path.join(output,'wrapper-failure.private.log'),String(error.stack));console.error('Native card HTTP failed; private evidence and fixture database retained');process.exitCode=1;}
