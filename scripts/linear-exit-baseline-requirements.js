'use strict';
// Read-only classification of selected prerequisite evidence. Never executes owners.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..'),FILE='docs/independence/LINEAR_EXIT_BASELINE_REQUIREMENTS_V1.json';
const PIN='b3d4ac7465d9f733c41a1d943201bd289db24bcca7e40cd30057efc2123934fd';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),canon=require('./track-b-backup').canonicalJson;
function verify({readFile=fs.readFileSync}={}){const bytes=readFile(path.join(ROOT,FILE));if(sha(bytes)!==PIN)throw Error('BASELINE_MANIFEST_DRIFT');const p=JSON.parse(bytes);for(const source of [...p.sources,...p.contracts])if(sha(readFile(path.join(ROOT,source.path)))!==source.sha256)throw Error('BASELINE_SOURCE_DRIFT');return p;}
function classify(observed){const p=verify(),failures=[],matched=[];if(!observed||!Array.isArray(observed.tables))return {status:'REFUSE',failures:['BASELINE_OBSERVATION_SHAPE'],installation_authorized:false};const names=observed.tables.map(t=>t.name);if(new Set(names).size!==names.length)return {status:'REFUSE',failures:['BASELINE_DUPLICATE_TABLE'],installation_authorized:false};
 for(const item of p.tables){const found=observed.tables.find(t=>t.name===item.name);if(!found){failures.push('MISSING:'+item.name);continue;}if(item.row_contract){const contract=JSON.parse(fs.readFileSync(path.join(ROOT,item.row_contract))),expected=contract.tables.find(t=>t.name===item.name);if(canon(found)!==canon(expected))failures.push('ROW_METADATA_DIVERGENT:'+item.name);else matched.push(item.name);}else failures.push('EXACT_CATALOG_EXPECTATION_UNAVAILABLE:'+item.name);}
 const historical=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/independence/LINEAR_EXIT_BACKUP_TABLE_BASELINE_20260911.json'))).metadata;
 const normalize=value=>{const v=structuredClone(value);delete v.observed_at;delete v.server_version_num;if(Array.isArray(v.grants))v.grants.sort((a,b)=>(a.role+'|'+a.privilege).localeCompare(b.role+'|'+b.privilege));return v;};
 const historicalMatched=!!observed.backup_catalog&&canon(normalize(observed.backup_catalog))===canon(normalize(historical));if(!historicalMatched)failures.push('OBSERVED_BACKUP_CATALOG_MISSING_OR_DIVERGENT');
 // Row signatures intentionally omit defaults, ACLs, triggers and dependencies.
 // Matching them must not satisfy the full baseline gate.
 return {status:'REFUSE',matched_selected_row_contracts:matched,observed_backup_catalog_matched:historicalMatched,failures,unresolved:['COMPLETE_BASELINE_CATALOG_CONTRACT_UNAVAILABLE','HOSTED_OBSERVATION_NOT_AUTHENTICATED_BY_THIS_MODULE','EXTERNAL_PLATFORM_PREREQUISITES_UNPROVEN'],installation_authorized:false,sql_execution_performed:false};}
module.exports={verify,classify};
