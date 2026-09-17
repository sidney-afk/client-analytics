'use strict';
// Exact pinned PRE67 bootstrap; candidate loop is removed, never replayed after it.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),Module=require('module');
const api=require('../scripts/linear-exit-observed-routines'),snapshot=api.load(),file=path.join(__dirname,'linear-exit-source-phases-postgres.js'),source=fs.readFileSync(file,'utf8');
/* THIS SUITE USES THAT FILE AS A TEMPLATE: it splices its own call into one
 * region and runs the result. Its real dependency is THAT REGION, not the
 * file. Until 2026-09-17 it pinned the whole file's bytes, so an unrelated
 * edit elsewhere in the template broke this suite -- which is exactly what
 * happened when D24 changed a table count near the top of it, and it went
 * unnoticed because both suites are deferred. A changed test file does not
 * mean a changed contract. The pin is now over the spliced region alone, and
 * the anchors are resolved BEFORE it so the pin describes what was found. */
const start=source.indexOf('for(const id of manifest.dependency_order.filter(id=>!inventory.BASELINE'),end=source.indexOf('}catch(e)',start);assert(start>0&&end>start);
assert.equal(crypto.createHash('sha256').update(source.slice(start,end)).digest('hex'),snapshot.contract.pre_test_region_sha256,'spliced template region drift');assert.equal(source.indexOf('for(const id of manifest.dependency_order.filter(id=>!inventory.BASELINE',start+1),-1);assert(source.slice(0,start).includes("capture('PRE_CANDIDATE',pre);"));
const injected=source.slice(0,start)+"require('../scripts/linear-exit-observed-routines').applyAndCompare(c,pre.length);assert.deepEqual(api.sourcePins(),sourcePins);\n"+source.slice(end);
const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(injected,file);
