'use strict';
// Offline refusals only. No private captures or database execution.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const api=require('../scripts/linear-exit-observed-schema'),certificate=require('../scripts/linear-exit-observed-public-catalog');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'observed-schema-controls-')),input=path.join(root,'input'),output=path.join(root,'output');fs.mkdirSync(input);fs.mkdirSync(output);
const prior=process.env.F63_REQUIRE_POSTGRES,originalCompare=certificate.compare;let ddl=0,queries=0,checks=0;
const c={host:'127.0.0.1',exec(){ddl++;throw Error('DDL must not run');},scalarJson(){queries++;return 1;}};
function refuses(fn,pattern){assert.throws(fn,pattern);assert.equal(ddl,0);checks++;}
try{
 delete process.env.F63_REQUIRE_POSTGRES;refuses(()=>api.applyObservedSchema(c,{inputDirectory:input,outputDirectory:output}));
 process.env.F63_REQUIRE_POSTGRES='1';refuses(()=>api.applyObservedSchema({...c,host:'hosted.invalid'},{inputDirectory:input,outputDirectory:output}),/loopback/);assert.equal(queries,0);
 refuses(()=>api.applyObservedSchema(c,{inputDirectory:'relative',outputDirectory:output}),/absolute/);
 refuses(()=>api.applyObservedSchema(c,{inputDirectory:input,outputDirectory:input}),/separate/);
 fs.writeFileSync(path.join(input,'live-full-catalog-20260912.private.json'),JSON.stringify({catalog:{tables:[]}}));
 for(const [file,value]of [['live-routine-definitions-20260912.private.json',{routines:[]}],['live-structural-definitions-20260912.private.json',{definitions:{}}],['live-sequence-ownership-20260912.private.json',{ownership:[]}]])fs.writeFileSync(path.join(input,file),JSON.stringify(value));
 refuses(()=>api.applyObservedSchema(c,{inputDirectory:input,outputDirectory:output}),/certificate mismatch/);assert.equal(queries,0);
 fs.writeFileSync(path.join(input,'live-full-catalog-20260912.private.json'),'{malformed');refuses(()=>api.applyObservedSchema(c,{inputDirectory:input,outputDirectory:output}));assert.equal(queries,0);
 // Isolate pre-DDL emptiness guard, explicitly mocking only the certificate decision.
 certificate.compare=()=>({status:'MATCHED_OBSERVED_PUBLIC_CATALOG'});
 fs.writeFileSync(path.join(input,'live-full-catalog-20260912.private.json'),JSON.stringify({catalog:{tables:Array(67).fill({}),functions:Array(115).fill({}),sequences:Array(14).fill({}),types:[],server_major:17}}));
 fs.writeFileSync(path.join(input,'live-sequence-ownership-20260912.private.json'),JSON.stringify({ownership:Array(14).fill({})}));
 refuses(()=>api.applyObservedSchema(c,{inputDirectory:input,outputDirectory:output}),/public relations must be empty/);assert.equal(queries,1);
 assert.deepEqual(fs.readdirSync(output),[]);console.log(JSON.stringify({marker:'LINEAR_EXIT_OBSERVED_SCHEMA_OFFLINE_OK',checks,ddl_calls:ddl,actual_catalog_reconstruction_proven:false}));
}finally{certificate.compare=originalCompare;if(prior===undefined)delete process.env.F63_REQUIRE_POSTGRES;else process.env.F63_REQUIRE_POSTGRES=prior;assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true});}
