'use strict';
// Existing F63 disposable-PG CI binding; never silently skip a CI invocation.
const fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');
if(process.env.F63_REQUIRE_POSTGRES!=='1'){
  if(process.env.CI) throw new Error('native_card_materialization_disposable_binding_required');
  console.log('SKIP native card materialization: explicit disposable PostgreSQL required');process.exit(0);
}
const host=process.env.F42_REHEARSAL_PGHOST||process.env.PGHOST||'';
if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('literal_disposable_loopback_required');
const port=process.env.F42_REHEARSAL_PGPORT||process.env.NATIVE_CARD_TEST_PORT||process.env.PGPORT||'5432';
const user=process.env.F42_REHEARSAL_PGUSER||process.env.NATIVE_CARD_TEST_USER||process.env.PGUSER||'postgres';
// Prevent libpq transport overrides before EVERY inherited fixture invocation.
for(const key of Object.keys(process.env))if(/^PG/i.test(key)&&key.toUpperCase()!=='PGPASSWORD')delete process.env[key];
const ROOT=path.resolve(__dirname,'..');
const {LocalDatabase,source}=require('../scripts/card-change-journal-rehearsal');
const {setup}=require('../scripts/card-history-integrated-rehearsal');
const config={host:host==='localhost'?'127.0.0.1':host,port,user,
  psql:process.env.NATIVE_CARD_TEST_PSQL||'psql',password:process.env.PGPASSWORD||''};
if(!/^\d{4,5}$/.test(config.port)||Number(config.port)>65535)throw new Error('invalid_disposable_port');
const db=new LocalDatabase(config),dir=process.env.NATIVE_CARD_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'native-card-boundary-'));
fs.mkdirSync(dir,{recursive:true});db.create();
try{
  setup(db,source('2026-09-05-calendar-feedback-recovery.sql'));
  db.query(source('2026-09-05-crosswalk-bind-and-import.sql'));
  db.query(source('2026-09-06-native-card-materialization-boundary.sql'));
  const r=spawnSync(process.execPath,['--experimental-strip-types',path.join(ROOT,'scripts/native-card-materialization/lane.mjs')],{
    encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024,windowsHide:true,
    env:{...process.env,NIR_PGHOST:config.host,NIR_PGPORT:config.port,NIR_PGUSER:config.user,NIR_PGDATABASE:db.name,NIR_PSQL:config.psql,
      PGPASSWORD:config.password,NATIVE_CARD_TEST_OUTPUT:dir}});
  fs.writeFileSync(path.join(dir,'lane.private.log'),(r.stdout||'')+(r.stderr||''));
  const summary=(r.stdout||'').match(/^NATIVE_CARD_RESULT (.+)$/m);
  if(summary)console.log(summary[0]);
  if(r.status!==0)throw new Error('native_card_materialization_failed; private fixture log retained');
}finally{db.drop();}
