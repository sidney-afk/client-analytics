'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {extractFunction}=require('./helpers/extract-function');
const {bootCluster,connectionEnv}=require('../scripts/native-intake-manifest/harness');
if(process.env.F63_REQUIRE_POSTGRES!=='1'&&process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES!=='1') {
  console.log('SKIP existing assignment SQL: explicit disposable PostgreSQL required'); process.exit(0);
}
const host=process.env.F42_REHEARSAL_SOCKET||process.env.F42_REHEARSAL_PGHOST||process.env.PGHOST||'';
if(!['localhost','127.0.0.1','::1'].includes(host))throw Error('disposable loopback PostgreSQL required');
// Prevent ambient libpq routing from overriding the explicit local fixture.
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'])delete process.env[key];
const existing=fs.readFileSync(path.join(__dirname,'native-assignee-eligibility.js'),'utf8');
const applyChain=new Function('fs','path','__dirname',extractFunction(existing,'applyChain')+';return applyChain;')(fs,path,__dirname);
let cluster;
try {
  cluster=bootCluster(); applyChain(cluster);
  const r=spawnSync(process.execPath,['--experimental-strip-types',path.join(__dirname,'../scripts/native-intake-manifest/existing-assignment-lane.mjs')],{
    env:{...process.env,...connectionEnv(cluster)},encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:4*1024*1024});
  const result=/EXISTING_ASSIGNMENT_RESULT (.+)/.exec(r.stdout||'');
  if(!result) throw Error('existing assignment lane missing finite receipt; inspect private local output');
  const receipt=JSON.parse(result[1]);
  console.log(JSON.stringify(receipt));
  if(r.status!==0||receipt.failed!==0)throw Error('existing assignment SQL proof failed');
}finally{if(cluster)cluster.stop();}
