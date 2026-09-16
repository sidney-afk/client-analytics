'use strict';
// Read-only, explicitly source-derived target. Never labels a derived target hosted truth.
const assert=require('assert/strict'),j=require('./linear-exit-install-journal'),observed=require('./linear-exit-observed-public-catalog');
function create({planBytes,planSha256,catalog,privateCatalog}){
 const plan=j.compile(planBytes,planSha256);
 // The plan names its own starting catalog, so this derives the expected
 // post-install table count rather than restating one. It used to assert 90,
 // a number this function had no way to be right about: create() takes no
 // profile and cannot see which world it is in.
 assert(catalog&&Array.isArray(catalog.tables));
 const expectedTables=observed.postInstallPublicTables(plan.initial_catalog_sha256).expected;
 assert.equal(catalog.tables.length,expectedTables,'post-install public table count');
 assert(privateCatalog&&typeof privateCatalog==='object'&&!Array.isArray(privateCatalog));
 return {format:'linear-exit-observed-full-target-v1',classification:'ISOLATED_SOURCE_DERIVED_TARGET',
  plan_sha256:plan.sha256,stage_id:plan.stage_id,catalog_sha256:j.sha(j.canonical(catalog)),
  private_catalog_sha256:j.sha(j.canonical(privateCatalog)),catalog,private_catalog:privateCatalog,
  installation_authorized:false,hosted_target_verified:false};
}
function compare({targetBytes,targetSha256,planBytes,planSha256,catalog,privateCatalog}){
 assert.equal(j.sha(targetBytes),targetSha256,'target bytes drift');
 const expected=JSON.parse(targetBytes),actual=create({planBytes,planSha256,catalog,privateCatalog});
 assert.deepEqual(actual,expected,'full target mismatch');
 return {status:'MATCHED_SOURCE_DERIVED_TARGET',installation_authorized:false,hosted_target_verified:false};
}
module.exports={create,compare};
