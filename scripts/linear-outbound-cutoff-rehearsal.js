'use strict';
// Actual repository migrations + retained gateway/worker functions. Only an
// explicitly owned disposable loopback server; never starts/stops servers.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{spawnSync}=require('child_process');
if(process.env.G8_TEST_CONFIRM!=='LOCAL_DISPOSABLE_ONLY'){
 if(process.env.G8_TEST_REQUIRE==='1'||process.env.CI)throw Error('g8_disposable_confirmation_required');
 console.log('SKIP G8: explicit disposable PostgreSQL required');process.exit(0);
}
const psql=process.env.G8_TEST_PSQL,port=String(process.env.G8_TEST_PORT||'');
assert.ok(psql&&path.isAbsolute(psql),'explicit_psql_required');assert.match(port,/^\d{4,5}$/);assert.ok(+port<=65535);
const password=process.env.G8_TEST_PASSWORD||'';
for(const k of Object.keys(process.env))if(/^PG/i.test(k))delete process.env[k];process.env.PGPASSWORD=password;
const {LocalDatabase,source}=require('./card-change-journal-rehearsal'),{setup}=require('./card-history-integrated-rehearsal');
const config={host:'127.0.0.1',port,user:'postgres',psql,password},db=new LocalDatabase(config);
const argv=process.argv.slice(2);assert.ok(argv.length===0||(argv.length===1&&argv[0]==='--read-fence'),'unknown_rehearsal_lane');
const output=process.env.G8_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'g8-cutoff-'));
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'DATABASE.private.json'),JSON.stringify({database:db.name,retained:true}));
try{
 db.create();setup(db,source('2026-09-05-calendar-feedback-recovery.sql'));
 const r=spawnSync(process.execPath,['--experimental-strip-types',path.join(__dirname,argv.length?'linear-outbound-read-lane.mjs':'linear-outbound-cutoff-lane.mjs')],{
  encoding:'utf8',timeout:180000,maxBuffer:8e6,windowsHide:true,env:{...process.env,NIR_PGHOST:config.host,NIR_PGPORT:port,NIR_PGUSER:config.user,NIR_PGDATABASE:db.name,NIR_PSQL:psql,G8_TEST_OUTPUT:output}});
 fs.writeFileSync(path.join(output,'lane.private.log'),(r.stdout||'')+(r.stderr||''));
 const summary=(r.stdout||'').match(/^G8_RESULT (.+)$/m);if(summary)console.log(summary[0]);
 assert.equal(r.status,0,'g8_lane_failed_private_evidence_retained');
}catch(error){fs.writeFileSync(path.join(output,'failure.private.log'),String(error.stack));console.error('G8 proof failed; private evidence retained');process.exitCode=1;}
