'use strict';
// Source plan and offline evidence classifier only; deliberately no SQL executor.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const manifest=require('./linear-exit-install-manifest'),extension=require('./linear-exit-admission-release-extension'),baselineRequirements=require('./linear-exit-baseline-requirements');
const ROOT=path.resolve(__dirname,'..'),canon=require('./track-b-backup').canonicalJson;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function build({addonBytes,addonSha256}={}){
 const ext=extension.verify(),extensionBytes=fs.readFileSync(path.join(ROOT,'docs/independence/LINEAR_EXIT_ADMISSION_RELEASE_EXTENSION_V1.json'));if(canon(JSON.parse(extensionBytes))!==canon(ext))throw Error('PLAN_EXTENSION_DRIFT');const bytes=fs.readFileSync(path.join(ROOT,ext.base_install_inventory.path));
 if(sha(bytes)!==ext.base_install_inventory.sha256)throw Error('PLAN_BASE_DRIFT');const base=JSON.parse(bytes);manifest.verify(base);
 const entries=base.dependency_order.map(id=>structuredClone(base.entries.find(x=>x.id===id)));
 let prior=base.dependency_order.slice();
 for(const input of [...ext.prerequisites.filter(x=>x.path.endsWith('.sql')),...ext.sql_owners]){
  const id=input.path;if(entries.some(x=>x.path===id))throw Error('PLAN_DUPLICATE_SOURCE');const b=fs.readFileSync(path.join(ROOT,id));if(sha(b)!==input.sha256)throw Error('PLAN_SOURCE_DRIFT');
  entries.push({id,path:id,sha256:input.sha256,scope:'additive_source_owner',dependencies:prior,transaction:manifest.transactions(b.toString('utf8'))});prior=[id];
 }
 let addon_hash=null;
 if(addonBytes!==undefined){
  if(!Buffer.isBuffer(addonBytes)||!(/^[a-f0-9]{64}$/).test(addonSha256)||sha(addonBytes)!==addonSha256)throw Error('PLAN_ADDON_PIN');
  const addon=JSON.parse(addonBytes);if(addon.format!=='admission-plan-addon-v1'||!Array.isArray(addon.owners)||!addon.owners.length||addon.owners.length>16)throw Error('PLAN_ADDON_SHAPE');
  for(const owner of addon.owners){if(!owner||typeof owner.path!=='string'||!/^supabase\/migrations\/[a-z0-9_]+\.sql$/.test(owner.path)||owner.id!==owner.path||!Array.isArray(owner.dependencies)||!owner.dependencies.includes(prior[0])||entries.some(x=>x.path===owner.path))throw Error('PLAN_ADDON_DEPENDENCY');const b=fs.readFileSync(path.join(ROOT,owner.path));if(sha(b)!==owner.sha256)throw Error('PLAN_ADDON_SOURCE_DRIFT');entries.push({...owner,scope:'explicit_pinned_addon',transaction:manifest.transactions(b.toString('utf8'))});prior=[owner.id];}addon_hash=addonSha256;
 }else if(addonSha256!==undefined)throw Error('PLAN_ADDON_BYTES_REQUIRED');
 const baseline=baselineRequirements.verify(),baselinePath='docs/independence/LINEAR_EXIT_BASELINE_REQUIREMENTS_V1.json',baselineBytes=fs.readFileSync(path.join(ROOT,baselinePath));if(canon(JSON.parse(baselineBytes))!==canon(baseline))throw Error('PLAN_BASELINE_DRIFT');
 const requirements={path:baselinePath,sha256:sha(baselineBytes),tables:baseline.tables,platform_prerequisites:baseline.platform_prerequisites,limits:baseline.limits,observation_provided:false,classification:baselineRequirements.classify({tables:[]}),satisfied:false};
 const order=manifest.validate(entries);
 const payload={format:'linear-exit-integrated-source-plan-v1',base_inventory_sha256:sha(bytes),extension_sha256:sha(extensionBytes),addon_sha256:addon_hash,baseline_requirements:requirements,entries,dependency_order:order,executable:false,installation_authorized:false,blockers:['HOSTED_BASELINE_UNOBSERVED','ADDITIONAL_APPLICATION_SCHEMA_OWNER_COMPOSITION_NOT_IN_BASE_64','EXTERNAL_PLATFORM_SCAFFOLD_NOT_INSTALL_PROOF','CUMULATIVE_HOSTED_PREFIX_SIGNATURES_UNOBSERVED','INTERNAL_COMMIT_RECOVERY_UNPROVEN']};
 if(canon(baselineRequirements.verify())!==canon(baseline))throw Error('PLAN_BASELINE_DRIFT');manifest.verify(base);if(canon(extension.verify())!==canon(ext))throw Error('PLAN_EXTENSION_DRIFT');for(const e of entries)if(e.path&&sha(fs.readFileSync(path.join(ROOT,e.path)))!==e.sha256)throw Error('PLAN_SOURCE_DRIFT');
 return {...payload,plan_sha256:sha(Buffer.from(canon(payload)))};
}
function keyBytes(key){if(!Buffer.isBuffer(key)||key.length!==32)throw Error('PREFIX_EXPLICIT_KEY_REQUIRED');return key;}
function signObservation(payload,key){return {payload,mac:crypto.createHmac('sha256',keyBytes(key)).update(canon(payload)).digest('hex')};}
function classify(plan,evidence,current,key){
 keyBytes(key);const refuse=code=>({status:'REFUSE',code,resume_authorized:false});
 const {plan_sha256,...body}=plan;if(sha(Buffer.from(canon(body)))!==plan_sha256)return refuse('PLAN_TAMPER');
 if(!evidence||!evidence.payload||typeof evidence.mac!=='string'||!(/^[a-f0-9]{64}$/).test(evidence.mac))return refuse('OBSERVATION_AUTH');
 const expected=signObservation(evidence.payload,key).mac;if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(evidence.mac,'hex')))return refuse('OBSERVATION_AUTH');
 const e=evidence.payload;if(Object.keys(e).sort().join(',')!=='database_identity,initial_catalog_md5,plan_sha256,prefix,run_id')return refuse('OBSERVATION_SHAPE');if(e.plan_sha256!==plan_sha256)return refuse('PLAN_DRIFT');
 if(!current||typeof e.run_id!=='string'||!e.run_id||typeof e.database_identity!=='string'||!e.database_identity||e.run_id!==current.run_id||e.database_identity!==current.database_identity)return refuse('OBSERVATION_IDENTITY');
 if(!Array.isArray(e.prefix)||e.prefix.length>plan.dependency_order.length||!(/^[a-f0-9]{32}$/).test(e.initial_catalog_md5))return refuse('PREFIX_SHAPE');
 let last=e.initial_catalog_md5;
 for(const [i,entry] of e.prefix.entries()){const owner=plan.entries.find(x=>x.id===plan.dependency_order[i]);if(!entry||Object.keys(entry).sort().join(',')!=='after_catalog_md5,before_catalog_md5,id,source_sha256'||entry.id!==owner.id||entry.source_sha256!==owner.sha256||entry.before_catalog_md5!==last||!(/^[a-f0-9]{32}$/).test(entry.after_catalog_md5))return refuse('PREFIX_ORDER_OR_SOURCE');last=entry.after_catalog_md5;}
 if(current.catalog_md5!==last)return refuse('UNRECOGNIZED_CATALOG_AFTER_INTERRUPTION');
 return {status:'MATCHED_OBSERVED_PREFIX_PREPARATION_ONLY',completed_entries:e.prefix.length,next_entry:plan.dependency_order[e.prefix.length]??null,resume_authorized:false,sql_execution_performed:false,per_internal_commit_proven:false,observation_collected_by_this_module:false,blockers:plan.blockers};
}
module.exports={build,signObservation,classify};
if(require.main===module)console.log(JSON.stringify(build(),null,2));
