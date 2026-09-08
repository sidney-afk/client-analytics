'use strict';
// The actual label handler/SQL lane participates in the existing disposable CI
// service. No live credentials, network transport or public raw rows are used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
if(process.env.F63_REQUIRE_POSTGRES!=='1') {
  console.log('SKIP native label writes: explicit disposable PostgreSQL required');
  process.exit(0);
}
if(!['localhost','127.0.0.1'].includes(process.env.PGHOST||''))throw Error('native_labels_loopback_required');
const port=Number(process.env.PGPORT),user=process.env.PGUSER;
if(!Number.isInteger(port)||port<1024||port>65535||user!=='postgres')throw Error('native_labels_disposable_binding_required');
const psql=process.env.NATIVE_LABEL_TEST_PSQL||process.env.NATIVE_CARD_TEST_PSQL||'/usr/bin/psql';
if(!path.isAbsolute(psql)||!fs.statSync(psql).isFile())throw Error('native_labels_absolute_psql_required');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'native-label-ci-'));
const config=path.join(output,'config.private.json');
fs.writeFileSync(config,JSON.stringify({host:'127.0.0.1',port,user,psql,output,password:process.env.PGPASSWORD||''}),{mode:0o600});
const result=spawnSync(process.execPath,['--experimental-strip-types',path.join(__dirname,'../qa/native-label-catalog/write-proof.mjs')],{
  env:{...process.env,NATIVE_LABEL_WRITE_CONFIRM:'LOCAL_DISPOSABLE_ONLY',NATIVE_LABEL_WRITE_CONFIG:config},
  encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8*1024*1024,
});
fs.writeFileSync(path.join(output,'runner.private.log'),(result.stdout||'')+(result.stderr||''));
const reportFile=path.join(output,'REPORT.private.json');
const report=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,'utf8')):null;
if(result.status!==0||!report||report.status!=='PASS'||report.passed!==40||report.cases.length!==40) {
  throw Error('native_labels_actual_lane_failed_private_evidence_retained');
}
console.log('NATIVE_LABEL_WRITE_RESULT '+JSON.stringify({status:'PASS',passed:report.passed,classification:report.classification}));
