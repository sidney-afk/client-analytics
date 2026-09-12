'use strict';
// Reviewed additive source extension, not a complete hosted baseline or installer.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..'),ARTIFACT='docs/independence/LINEAR_EXIT_ADMISSION_RELEASE_EXTENSION_V1.json';
const PIN='984a5b08f3081154a845ee0af35f4074660993f7188caa661fff58af441e835c';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=require('./track-b-backup').canonicalJson;
const OWNERS=['20260912174907_card_atomic_admission_preparation.sql','20260912183653_application_dml_admission_preparation.sql','20260912184931_card_followup_outcome_proof.sql','20260912190717_provider_debt_disposition_preparation.sql','20260912193102_followup_transactional_retry_preparation.sql','20260912193957_provider_closed_snapshot_preparation.sql'];
function generate({readFile=fs.readFileSync}={}){const pin=p=>({path:p,sha256:sha(readFile(path.join(ROOT,p)))});return {
 format:'admission-release-extension-v1',scope:'additive reviewed source extension; not complete hosted baseline',
 base_install_inventory:pin('docs/independence/LINEAR_EXIT_INSTALL_SOURCE_INVENTORY_20260910.json'),
 application_inventories:['V1','V2'].map(v=>pin('docs/independence/LINEAR_EXIT_COMPLETE_APPLICATION_DATA_'+v+'.json')),
 prerequisites:['migrations/2026-06-18-atomic-comment-merge.sql','qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql','qa/linear-exit-rehearsal/serving/functions/calendar-upsert/index.ts','qa/linear-exit-rehearsal/serving/functions/_shared/thumbnail-revisions.ts','qa/linear-exit-rehearsal/serving/samples-v50/functions/sample-review-upsert/index.ts','qa/linear-exit-rehearsal/serving/samples-v50/functions/_shared/thumbnail-revisions.ts'].map(pin),
 sql_owners:OWNERS.map((name,i)=>({...pin('supabase/migrations/'+name),order:i+1})),
 admission_preflight_contract:pin('docs/independence/LINEAR_EXIT_ADMISSION_SCHEMA_CONTRACT_20260912.json'),
 writer_sources:['scripts/linear-exit-atomic-writer-compose.js','scripts/linear-exit-atomic-writer-bundle.js'].map(pin),
 worker_sources:['compose','bundle','endpoint','postgres','transaction','worker'].map(n=>pin('scripts/linear-exit-followup-'+n+'.mjs')),
 hosted_prestate_classification:'PENDING',hosted_prerequisite_classification:'PENDING',hosted_configuration:'PENDING',hosted_baseline_observed_proven:false,complete_hosted_closure_proven:false,
 runtime_worker_enabled:false,final_activation:'REFUSING',installation_authorized:false,deployment_authorized:false,merge_authorized:false
 };}
function verify(options={}){const read=options.readFile||fs.readFileSync,bytes=read(path.join(ROOT,ARTIFACT));if(sha(bytes)!==PIN)throw Error('ADMISSION_EXTENSION_ARTIFACT_DRIFT');const stored=JSON.parse(bytes);if(canonical(stored)!==canonical(generate(options)))throw Error('ADMISSION_EXTENSION_SOURCE_OR_ORDER_DRIFT');return stored;}
if(require.main===module){verify();console.log('ADMISSION_RELEASE_EXTENSION_VERIFIED; hosted baseline pending; activation refusing');}
module.exports={generate,verify};
