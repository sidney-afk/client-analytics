'use strict';
// Preparation artifact only: never connects, deploys, or activates a worker.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {compose}=require('./linear-exit-atomic-writer-compose');
const ROOT=path.resolve(__dirname,'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const SOURCES=[
 {surface:'calendar',name:'calendar-upsert',version:49,index:'qa/linear-exit-rehearsal/serving/functions/calendar-upsert/index.ts',dependency:'qa/linear-exit-rehearsal/serving/functions/_shared/thumbnail-revisions.ts',dependency_sha256:'fb32db55aedb8955a577a8ad67185acd5da68475a3eeccbbb8f593c077e6d4c9'},
 {surface:'samples',name:'sample-review-upsert',version:50,index:'qa/linear-exit-rehearsal/serving/samples-v50/functions/sample-review-upsert/index.ts',dependency:'qa/linear-exit-rehearsal/serving/samples-v50/functions/_shared/thumbnail-revisions.ts',dependency_sha256:'8e8478cb8812688656fb5dee5fe022dd32090722da9db78f12556459de81cb51'}
];
function buildBundle(outputDirectory){
 const extension=require('./linear-exit-admission-release-extension').verify();
 if(typeof outputDirectory!=='string'||!path.isAbsolute(outputDirectory))throw Error('BUNDLE_ABSOLUTE_DIRECTORY_REQUIRED');
 const dest=path.resolve(outputDirectory),parent=path.dirname(dest);
 if(!fs.statSync(parent).isDirectory())throw Error('BUNDLE_PARENT_REQUIRED');
 const files=[],functions=SOURCES.map(item=>{
  const input=fs.readFileSync(path.join(ROOT,item.index)),dep=fs.readFileSync(path.join(ROOT,item.dependency));
  if(sha(dep)!==item.dependency_sha256)throw Error('BUNDLE_DEPENDENCY_DRIFT');
  const made=compose(item.surface,input);
  if(!made.source.includes('Deno.serve(')||!made.source.includes('npm:@supabase/supabase-js@2.49.8')||made.source.includes('file://'))throw Error('BUNDLE_NOT_DEPLOYABLE_SOURCE');
  // Separate self-contained trees preserve each captured dependency byte-for-byte.
  const prefix=item.name+'/functions/';
  files.push([prefix+item.name+'/index.ts',Buffer.from(made.source)],[prefix+'_shared/thumbnail-revisions.ts',dep]);
  return {name:item.name,url_path:'/functions/v1/'+item.name,verify_jwt:false,captured_version:item.version,source_path:item.index,source_sha256:sha(input),candidate_sha256:made.sha256,dependency_source:item.dependency,dependency_sha256:sha(dep),index_path:prefix+item.name+'/index.ts'};
 });
 const prerequisitePaths=['migrations/2026-06-18-atomic-comment-merge.sql','qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql',...extension.sql_owners.map(x=>x.path)];
 const prerequisites=prerequisitePaths.map(p=>({path:p,sha256:sha(fs.readFileSync(path.join(ROOT,p)))}));
 if(prerequisites[1].sha256!=='31663a6b62bbc96efe85a8cdc8485c42f07f9455b5c043e2112ff07e36bba429')throw Error('BUNDLE_MERGE_DRIFT');
 const manifest={format:'syncview-atomic-writer-preparation-v1',functions,release_extension_inventory:'docs/independence/LINEAR_EXIT_ADMISSION_RELEASE_EXTENSION_V1.json',sql_prerequisites:prerequisites,sql_prerequisites_complete:false,hosted_baseline_observed_proven:false,source_inventory_required:true,worker_required:true,worker_release_proven:false,installation_authorized:false,deployment_authorized:false,release_order:['Review complete source inventory and SQL prerequisites.','Prepare and verify dormant follow-up worker and transactional completion owners.','Install approved prerequisites and prove worker drain before switching writers.','Release approved tokenless writers at existing canonical URLs; activate only after separate authorization.'],files:files.map(([p,b])=>({path:p,sha256:sha(b),bytes:b.length}))};
 // Exclusive directory ownership: an existing destination is never touched.
 fs.mkdirSync(dest,{mode:0o700});
 for(const [p,b] of files){const target=path.join(dest,p);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,b,{flag:'wx',mode:0o600});if(sha(fs.readFileSync(target))!==sha(b))throw Error('BUNDLE_READBACK_FAILED');}
 fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 return manifest;
}
if(require.main===module){if(process.argv.length!==3)throw Error('Usage: node scripts/linear-exit-atomic-writer-bundle.js ABSOLUTE_NEW_DIRECTORY');const result=buildBundle(process.argv[2]);console.log(JSON.stringify({format:result.format,function_count:result.functions.length,deployment_authorized:false}));}
module.exports={buildBundle};
