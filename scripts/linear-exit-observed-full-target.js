'use strict';
// Read-only, explicitly source-derived target. Never labels a derived target hosted truth.
const assert=require('assert/strict'),j=require('./linear-exit-install-journal');
function create({planBytes,planSha256,catalog,privateCatalog}){
 const plan=j.compile(planBytes,planSha256);
 assert(catalog&&Array.isArray(catalog.tables)&&catalog.tables.length===90);
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
