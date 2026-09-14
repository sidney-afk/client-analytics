'use strict';
// Exact pinned PRE67 bootstrap; candidate loop is removed, never replayed after it.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),Module=require('module');
const api=require('../scripts/linear-exit-observed-routines'),snapshot=api.load(),file=path.join(__dirname,'linear-exit-source-phases-postgres.js'),source=fs.readFileSync(file,'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),snapshot.contract.pre_test_sha256);
const start=source.indexOf('for(const id of manifest.dependency_order.filter(id=>!inventory.BASELINE'),end=source.indexOf('}catch(e)',start);assert(start>0&&end>start);assert.equal(source.indexOf('for(const id of manifest.dependency_order.filter(id=>!inventory.BASELINE',start+1),-1);assert(source.slice(0,start).includes("capture('PRE_CANDIDATE',pre);"));
const injected=source.slice(0,start)+"require('../scripts/linear-exit-observed-routines').applyAndCompare(c);assert.deepEqual(api.sourcePins(),sourcePins);\n"+source.slice(end);
const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(injected,file);
