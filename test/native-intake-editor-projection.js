'use strict';
// SQL/HTTP lane is explicitly opt-in and loopback-only, using the same real
// migration foundation as the reviewed native-assignee lane. No live URLs.
const fs=require('node:fs'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const {extractFunction}=require('./helpers/extract-function');
const {bootCluster,connectionEnv}=require('../scripts/native-intake-manifest/harness');
if(process.env.F63_REQUIRE_POSTGRES!=='1' && process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES!=='1') {
  console.log('SKIP native intake editor SQL lane: disposable PostgreSQL not explicitly required');
  process.exit(0);
}
const host=process.env.F42_REHEARSAL_SOCKET||process.env.F42_REHEARSAL_PGHOST||process.env.PGHOST||'';
if(!['localhost','127.0.0.1','::1'].includes(host)) throw Error('disposable loopback PostgreSQL required');
const existing=fs.readFileSync(path.join(__dirname,'native-assignee-eligibility.js'),'utf8');
const applyChain=new Function('fs','path','__dirname',extractFunction(existing,'applyChain')+';return applyChain;')(fs,path,__dirname);
let cluster, passed=false;
try {
  cluster=bootCluster(); applyChain(cluster);
  // The browser projection and the open-work aggregate are installed by
  // bootCluster (they moved into the harness when the count moved into SQL,
  // because every lane on that foundation needs them, not just this one).
  const result=spawnSync(process.execPath,['--experimental-strip-types',path.join(__dirname,'../scripts/native-intake-manifest/editor-projection-lane.mjs')],{
    env:{...process.env,...connectionEnv(cluster)},encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});
  process.stdout.write(result.stdout||''); process.stderr.write(result.stderr||'');
  if(result.status!==0) throw Error('native intake editor lane failed');
  passed=true;
} finally {
  if(cluster && passed) cluster.stop();
  else if(cluster) console.error('Failed disposable fixture preserved for diagnosis.');
}
