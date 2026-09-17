'use strict';
// Preparation packaging only. Never executes the derived plan or connects to a database.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..');
const BUILDER='scripts/linear-exit-observed-full-install-plan.js';
const BUILDER_SHA256='5b67fe972eb15af8293045f09e386f587285c3af074a37f30acc795b563d93c8';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
/* ONE function both enforces the builder pin and re-derives it, so the value
 * above can only ever be produced by the same code path that checks it.
 * `BUILDER_SHA256` had been stale since 03d18fb3 and moved again at B10, and
 * nothing running noticed: the only gate is the throw below, inside a
 * function only a DEFERRED suite calls. Re-pin with
 *   node -e "console.log(require('./scripts/linear-exit-atomic-writer-bound-bundle').builderSha256())"
 * and never by pasting a shell digest. */
function builderSha256(){return sha(fs.readFileSync(path.join(ROOT,BUILDER)));}
function bindInstallationPlan({observedCatalogBytes,observedCatalogSha256}){
 if(!Buffer.isBuffer(observedCatalogBytes)||observedCatalogBytes.length>67108864||typeof observedCatalogSha256!=='string'||sha(observedCatalogBytes)!==observedCatalogSha256)throw Error('WRITER_BINDING_CATALOG_BYTES');
 if(builderSha256()!==BUILDER_SHA256)throw Error('WRITER_BINDING_BUILDER_DRIFT');
 const api=require('./linear-exit-observed-full-install-plan');
 // The existing builder verifies every baseline/extension/additional owner and
 // requires the exact reviewed observed catalog before producing the plan.
 const result=api.build(JSON.parse(observedCatalogBytes.toString('utf8'))),plan=JSON.parse(result.planBytes);
 if(plan.sources.length!==48||plan.stage_id!=='OBSERVED_PUBLIC_20260912_FULL_PREPARATION_V1')throw Error('WRITER_BINDING_PLAN_SCOPE');
 const dependencies=['scripts/linear-exit-observed-install-plan.js','scripts/linear-exit-install-journal.js','docs/independence/LINEAR_EXIT_INSTALL_SOURCE_INVENTORY_20260910.json','docs/independence/LINEAR_EXIT_ADMISSION_RELEASE_EXTENSION_V1.json'].map(file=>({path:file,sha256:sha(fs.readFileSync(path.join(ROOT,file)))}));
 return {format:'atomic-writer-observed-installation-binding-v1',builder:{path:BUILDER,sha256:BUILDER_SHA256},dependencies,observed_input_sha256:observedCatalogSha256,initial_catalog_sha256:plan.initial_catalog_sha256,plan_sha256:result.planSha256,stage_id:plan.stage_id,sources:plan.sources.map(s=>({id:s.id,original_sha256:s.original_sha256,transport_sha256:s.sha256,dependencies:s.dependencies})),baseline_decisions:result.decisions,legacy_manifest_prerequisites_role:'SOURCE_PROVENANCE_ONLY_NOT_INSTALL_STEPS',historical_owner_replay_authorized:false,target_catalog_sha256:null,reviewed_target_required:true,installation_authorized:false,deployment_authorized:false};
}
function buildBoundBundle(outputDirectory,options){
 // Validate before the frozen bundler creates its exclusively owned directory.
 const binding=bindInstallationPlan(options),manifest=require('./linear-exit-atomic-writer-bundle').buildBundle(outputDirectory);
 const bytes=Buffer.from(JSON.stringify(binding,null,2)+'\n');
 fs.writeFileSync(path.join(outputDirectory,'installation-plan-binding.json'),bytes,{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(outputDirectory,'INSTALLATION_BINDING_REQUIRED.txt'),'Preparation only. Use installation-plan-binding.json and its exact observed plan. The older manifest.json sql_prerequisites list is source provenance, not installation steps. Never replay historical owners from that list. Review the final target and obtain separate installation/deployment authorization.\n',{flag:'wx',mode:0o600});
 if(!fs.readFileSync(path.join(outputDirectory,'installation-plan-binding.json')).equals(bytes))throw Error('WRITER_BINDING_READBACK');
 return {manifest,binding,binding_sha256:sha(bytes)};
}
if(require.main===module){if(process.argv.length!==5)throw Error('Usage: node scripts/linear-exit-atomic-writer-bound-bundle.js ABSOLUTE_NEW_DIRECTORY OBSERVED_CATALOG_JSON SHA256');const result=buildBoundBundle(process.argv[2],{observedCatalogBytes:fs.readFileSync(process.argv[3]),observedCatalogSha256:process.argv[4]});console.log(JSON.stringify({format:result.binding.format,binding_sha256:result.binding_sha256,plan_sha256:result.binding.plan_sha256,source_count:result.binding.sources.length,deployment_authorized:false}));}
module.exports={bindInstallationPlan,buildBoundBundle,builderSha256,BUILDER};
