'use strict';
// No PostgreSQL connection is possible: the Cluster module is replaced before load.
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'observed-full-isolation-'));
try{
 const preload=path.join(dir,'preload.cjs'),sentinel=path.join(dir,'started');
 fs.writeFileSync(preload,`const M=require('module'),fs=require('fs'),original=M._load;M._load=function(id,...args){if(String(id).endsWith('/scripts/f42-apply-rehearsal'))return {Cluster:class {constructor(){this.host=process.env.PGHOST;}start(){fs.writeFileSync(process.env.START_SENTINEL,'started');throw Error('LOCAL_START_SENTINEL');}stop(){}}};return original.call(this,id,...args);};`);
 const base={...process.env};for(const key of Object.keys(base))if(/^(PG|SUPABASE|F63_|PROOF_|OBSERVED_)/i.test(key))delete base[key];
 Object.assign(base,{F63_REQUIRE_POSTGRES:'1',PGHOST:'127.0.0.1',OBSERVED_INPUT_DIRECTORY:dir,PROOF_OUTPUT_ROOT:dir,START_SENTINEL:sentinel});
 const invoke=env=>cp.spawnSync(process.execPath,['--require',preload,path.resolve(__dirname,'linear-exit-observed-full-pipeline.js'),'--calibrate'],{env,encoding:'utf8',windowsHide:true});
 const cases=[['F63_REQUIRE_POSTGRES',''],['PGHOST','external.invalid'],['PGHOSTADDR','192.0.2.1'],['PGSERVICE','synthetic'],['PGSERVICEFILE','synthetic'],['PGOPTIONS','synthetic'],['SUPABASE_ACCESS_TOKEN','synthetic']];
 for(const [key,value] of cases){const r=invoke({...base,[key]:value});assert.notEqual(r.status,0);assert.equal(fs.existsSync(sentinel),false,'Cluster.start must not run for '+key);assert.match(r.stderr,/opt-in required|loopback only|routing override refused|hosted routing refused/);}
 const positive=invoke(base);assert.notEqual(positive.status,0);assert.equal(fs.readFileSync(sentinel,'utf8'),'started','sentinel proves the interception observes start');
 console.log('OBSERVED_FULL_ISOLATION_OK 8; no database connection');
}finally{assert(path.basename(dir).startsWith('observed-full-isolation-'));assert.equal(path.dirname(dir),fs.realpathSync(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});}
