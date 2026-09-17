'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{bindInstallationPlan,buildBoundBundle}=require('../scripts/linear-exit-atomic-writer-bound-bundle');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.throws(()=>bindInstallationPlan({observedCatalogBytes:Buffer.from('{}'),observedCatalogSha256:'0'.repeat(64)}),/CATALOG_BYTES/);
const invalid=Buffer.from('{}');assert.throws(()=>bindInstallationPlan({observedCatalogBytes:invalid,observedCatalogSha256:sha(invalid)}),/exact starting public catalog|catalog/i);
if(process.argv.length!==3)throw Error('Explicit observed catalog JSON fixture path required for full offline packaging proof');
const observedCatalogBytes=fs.readFileSync(process.argv[2]),options={observedCatalogBytes,observedCatalogSha256:sha(observedCatalogBytes)},root=fs.mkdtempSync(path.join(os.tmpdir(),'writer-bound-package-'));
try{
 const destination=path.join(root,'bundle'),result=buildBoundBundle(destination,options),b=result.binding;
 assert.equal(b.sources.length,48);assert.equal(b.historical_owner_replay_authorized,false);assert.equal(b.reviewed_target_required,true);assert.equal(b.target_catalog_sha256,null);assert.equal(b.legacy_manifest_prerequisites_role,'SOURCE_PROVENANCE_ONLY_NOT_INSTALL_STEPS');
 const actual=require('../scripts/linear-exit-observed-full-install-plan').build(JSON.parse(observedCatalogBytes));assert.equal(b.plan_sha256,actual.planSha256);
 assert.deepEqual(result.manifest.files.map(f=>f.sha256),['379e7fd9e7120f0ff3c5af41a90a578f2965dfb80a09f6b491804f4a5db349dd','fb32db55aedb8955a577a8ad67185acd5da68475a3eeccbbb8f593c077e6d4c9','5b877a4bf02c8e6203afd5e2bd944cbb7d757647cbb68a75ec306925a3236465','8e8478cb8812688656fb5dee5fe022dd32090722da9db78f12556459de81cb51']);
 for(const f of result.manifest.files)assert.equal(sha(fs.readFileSync(path.join(destination,f.path))),f.sha256);
 assert.equal(sha(fs.readFileSync(path.join(destination,'installation-plan-binding.json'))),result.binding_sha256);
 const before=fs.readFileSync(path.join(destination,'manifest.json'));assert.throws(()=>buildBoundBundle(destination,options),/EEXIST/);assert.deepEqual(fs.readFileSync(path.join(destination,'manifest.json')),before);
 const changed=JSON.parse(observedCatalogBytes);changed.server_major=0;const bad=Buffer.from(JSON.stringify(changed));assert.throws(()=>bindInstallationPlan({observedCatalogBytes:bad,observedCatalogSha256:sha(bad)}),/exact starting public catalog/);
 assert(b.baseline_decisions.some(x=>x.action==='OBSERVED_BASELINE_NO_REPLAY'));
 console.log(JSON.stringify({marker:'LINEAR_EXIT_ATOMIC_WRITER_BOUND_BUNDLE_OK',source_count:48,plan_sha256:b.plan_sha256,handler_bytes_unchanged:true,actual_database_calls:0}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
