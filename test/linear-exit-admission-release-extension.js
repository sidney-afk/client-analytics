'use strict';
const assert=require('assert/strict'),fs=require('fs');
const moduleUnderTest=require('../scripts/linear-exit-admission-release-extension');
const result=moduleUnderTest.verify();assert.equal(result.sql_owners.length,4);assert.deepEqual(result.sql_owners.map(x=>x.order),[1,2,3,4]);assert.equal(result.application_inventories.length,2);assert.equal(result.hosted_baseline_observed_proven,false);assert.equal(result.complete_hosted_closure_proven,false);assert.equal(result.runtime_worker_enabled,false);assert.equal(result.final_activation,'REFUSING');
assert.equal(result.base_install_inventory.sha256,'6c57462d97876157322b8ecffbc6d46b0b40d9cfc669c14be61df871c5e43122');
for(const group of ['sql_owners','prerequisites','writer_sources','worker_sources','application_inventories']){const selected=result[group][0].path;assert.throws(()=>moduleUnderTest.verify({readFile:p=>String(p).replace(/\\/g,'/').endsWith(selected)?Buffer.concat([fs.readFileSync(p),Buffer.from('drift')]):fs.readFileSync(p)}),/SOURCE_OR_ORDER_DRIFT/);}
const changed=structuredClone(result);changed.sql_owners.reverse();assert.throws(()=>moduleUnderTest.verify({readFile:p=>String(p).endsWith('LINEAR_EXIT_ADMISSION_RELEASE_EXTENSION_V1.json')?Buffer.from(JSON.stringify(changed)):fs.readFileSync(p)}),/ARTIFACT_DRIFT/);
console.log('ADMISSION_RELEASE_EXTENSION_PASS exact source pins, four-owner order, immutable baseline inventory, refused drift, incomplete hosted flags');
