'use strict';
const path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process');
const root=process.env.PROOF_REPO_ROOT,req=createRequire(path.join(root,'package.json'));
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.F63_REQUIRE_POSTGRES,'1');
const r=spawnSync(process.execPath,[path.join(root,'test/client-access-provisioning.js')],{env:{...process.env,CLIENT_ACCESS_REQUIRE_POSTGRES:'1'},stdio:'inherit',windowsHide:true});
assert.equal(r.status,0,'client-access SQL proof');
for(const name of ['component-fill','crosswalk-bind']){
 assert.equal(req(path.join(root,'scripts',name+'-rehearsal.js')).rehearse(),true,name+' actual SQL rehearsal');
 console.log('OPTIONAL_SQL_PASS '+name);
}

const batch=spawnSync(process.execPath,[path.join(root,'test/batch-description-cas-timestamptz.js')],{cwd:root,env:{...process.env,BATCH_DESCRIPTION_CAS_PROBE:'1'},stdio:'inherit',windowsHide:true});
assert.equal(batch.status,0,'batch description real PostgreSQL probe');
console.log('OPTIONAL_SQL_PASS batch-description-cas');
