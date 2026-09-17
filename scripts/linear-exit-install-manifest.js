'use strict';
// Inventory and dependency checks only. This module never executes SQL.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {splitSqlStatements}=require('./track-b-recovery-package');
const composer=require('./native-intake-named-append-compose');
const ROOT=path.resolve(__dirname,'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const BASELINE=[
 'live-schema-baseline-2026-07-03.sql','2026-07-03-a1-calendar-upsert.sql','2026-07-05-b0-linear-auth-scaffold.sql',
 '2026-07-06-b1-linear-data-model.sql','2026-07-11-b4-linear-outbound.sql','2026-07-12-production-comments.sql',
 '2026-07-12-write-ui-outbox-parity.sql','2026-07-28-f27-write-authorization-only.sql',
 '2026-08-19-samples-batch-purpose.sql','2026-08-19-samples-batch-write-purpose.sql','2026-08-24-public-intake-log.sql',
 '2026-08-26-production-intake-append-v7.sql','2026-08-31-production-component-fill.sql',
 '2026-07-23-f201-production-labels.sql','2026-07-23-f202-production-descriptions.sql','2026-07-23-production-comment-thread-lifecycle.sql',
 '2026-07-23-f34-f53-production-attachments.sql','2026-08-06-artifact-projection-scope-and-revision.sql',
 '2026-08-30-artifact-video-projection.sql','2026-09-05-artifact-card-binding-first.sql','2026-07-20-f27-team-rollback.sql',
 '2026-07-04-a2-writer-edge-functions.sql','2026-07-04-a4-settings-edge-functions.sql','2026-07-13-write-ui-reroute-allowlist.sql',
 '2026-08-04-client-access-auto-provision.sql','workload-issues-supabase-migration.sql','2026-07-19-workload-plan.sql',
 'sample-reviews-migration.sql','2026-07-11-b4-write-attribution.sql','2026-07-14-linear-intake-receipts.sql',
 '2026-07-15-pto-tracker.sql','2026-07-28-linear-project-ids-team-shape.sql',
];
const CANDIDATE=[
 '2026-09-05-card-change-journal.sql','2026-09-05-calendar-feedback-recovery.sql','2026-09-05-crosswalk-bind-and-import.sql',
 '2026-09-05-native-intake-root-manifest.sql','2026-09-05-native-label-catalog-foundation.sql',
 '2026-09-08-native-intake-receipt-retention.sql','2026-09-05-native-intake-reconcile.sql',
 '2026-09-06-native-card-materialization-boundary.sql','2026-09-07-legacy-intake-native-triage.sql',
 '2026-09-07-native-brief-media.sql','2026-09-06-linear-outbound-cutoff.sql',
 '2026-09-06-native-existing-assignment.sql','2026-09-06-native-label-writes.sql',
 '2026-09-07-native-identifier-mint.sql','2026-09-09-native-client-provisioning.sql',
 '2026-09-02-workload-native-view.sql','2026-09-05-workload-native-membership.sql',
 '2026-09-08-workload-native-label-state-shape.sql','2026-09-09-workload-native-roster.sql',
 '2026-09-09-native-attribution-browser-projection.sql','2026-09-09-editors-event-assignee.sql',
 '2026-09-09-native-ordinary-receipts.sql','2026-09-09-syncview-retirement-admission.sql',
 '2026-09-10-syncview-retirement-native-ordinary-recognizer.sql','2026-09-11-native-ordinary-receipt-repair.sql',
 '2026-09-12-native-ordinary-envelope-repair.sql','2026-09-11-native-signoff-verifier.sql','2026-09-09-native-notification-outbox.sql',
 '2026-09-05-description-images.sql','2026-09-09-kasper-urgent-pings.sql','2026-09-10-kasper-urgent-ping-ledger.sql',
];
const ATOMIC='atomic-native-intake';
// Explicit minimum known edges, not inferred migration-date order. Their
// closure is deliberately marked incomplete until target baseline review.
const DEPENDENCIES={
 '2026-07-20-f27-team-rollback.sql':['2026-07-28-f27-write-authorization-only.sql','2026-09-05-artifact-card-binding-first.sql','2026-07-23-production-comment-thread-lifecycle.sql'],
 [ATOMIC]:['2026-07-20-f27-team-rollback.sql','2026-09-05-native-intake-root-manifest.sql','2026-09-05-native-label-catalog-foundation.sql','2026-08-26-production-intake-append-v7.sql'],
 '2026-09-08-native-intake-receipt-retention.sql':[ATOMIC],
 '2026-09-05-native-intake-reconcile.sql':[ATOMIC,'2026-09-08-native-intake-receipt-retention.sql'],
 '2026-09-06-native-card-materialization-boundary.sql':['2026-09-05-native-intake-reconcile.sql'],
 '2026-09-07-legacy-intake-native-triage.sql':['2026-09-06-native-card-materialization-boundary.sql'],
 '2026-09-06-native-existing-assignment.sql':['2026-07-20-f27-team-rollback.sql'],
 '2026-09-06-native-label-writes.sql':['2026-07-20-f27-team-rollback.sql','2026-09-05-native-label-catalog-foundation.sql'],
 '2026-09-09-native-ordinary-receipts.sql':['2026-07-20-f27-team-rollback.sql','2026-07-23-production-comment-thread-lifecycle.sql'],
 '2026-09-09-syncview-retirement-admission.sql':['2026-07-20-f27-team-rollback.sql','2026-09-08-native-intake-receipt-retention.sql','2026-09-06-native-existing-assignment.sql','2026-09-06-native-label-writes.sql'],
 '2026-09-09-native-client-provisioning.sql':['2026-08-04-client-access-auto-provision.sql',ATOMIC],
 '2026-09-05-workload-native-membership.sql':['2026-09-02-workload-native-view.sql'],
 '2026-09-08-workload-native-label-state-shape.sql':['2026-09-05-workload-native-membership.sql'],
 '2026-09-09-workload-native-roster.sql':['2026-09-08-workload-native-label-state-shape.sql'],
 '2026-09-09-native-attribution-browser-projection.sql':['2026-09-09-native-client-provisioning.sql','2026-09-09-workload-native-roster.sql'],
 '2026-09-10-syncview-retirement-native-ordinary-recognizer.sql':['2026-09-09-syncview-retirement-admission.sql','2026-09-09-native-ordinary-receipts.sql'],
 '2026-09-11-native-ordinary-receipt-repair.sql':['2026-09-09-native-ordinary-receipts.sql'],
 '2026-09-12-native-ordinary-envelope-repair.sql':['2026-09-11-native-ordinary-receipt-repair.sql'],
 '2026-09-11-native-signoff-verifier.sql':['2026-09-12-native-ordinary-envelope-repair.sql'],
 '2026-09-09-native-notification-outbox.sql':['2026-07-05-b0-linear-auth-scaffold.sql','2026-07-06-b1-linear-data-model.sql','2026-07-12-production-comments.sql','2026-09-09-editors-event-assignee.sql','2026-09-12-native-ordinary-envelope-repair.sql'],
 '2026-09-05-calendar-feedback-recovery.sql':['2026-09-05-card-change-journal.sql'],
 '2026-09-10-kasper-urgent-ping-ledger.sql':['2026-07-03-a1-calendar-upsert.sql','2026-09-09-kasper-urgent-pings.sql','sample-reviews-migration.sql'],
};
function transactions(sql){
 const statements=splitSqlStatements(sql);let open=false,commits=0,outside=0;const boundaries=[],savepoints=[];
 for(const [index,s] of statements.entries()){
  if(s.kind!=='statement')continue;
  if(/^(begin|start\s+transaction)\b/i.test(s.text)){if(open)throw Error('nested_transaction');open=true;savepoints.length=0;boundaries.push({index,line:s.line,kind:'begin'});}
  else if(/^(commit|end)\s*$/i.test(s.text)){if(!open)throw Error('commit_without_begin');open=false;savepoints.length=0;commits++;boundaries.push({index,line:s.line,kind:'commit'});}
  else if(/^savepoint\s+\w+$/i.test(s.text)){if(!open)throw Error('savepoint_without_begin');savepoints.push(s.text.split(/\s+/)[1].toLowerCase());boundaries.push({index,line:s.line,kind:'savepoint'});}
  else if(/^(rollback to(?: savepoint)?|release(?: savepoint)?)\s+\w+$/i.test(s.text)){const name=s.text.split(/\s+/).at(-1).toLowerCase(),at=savepoints.lastIndexOf(name);if(!open||at<0)throw Error('unknown_savepoint');savepoints.length=at+(/^release/i.test(s.text)?0:1);boundaries.push({index,line:s.line,kind:/^release/i.test(s.text)?'release_savepoint':'rollback_to_savepoint'});}
  else if(/^(rollback|abort|prepare\s+transaction)\b/i.test(s.text))throw Error('unsupported_transaction_control');
  else if(!open)outside++;
 }
 if(open)throw Error('unclosed_transaction');
 return {classification:commits===1&&outside===0?'single_explicit_transaction':commits?'mixed_or_multiple_transactions':'autocommit_statements',explicit_commits:commits,outside_transaction_statements:outside,boundaries,meta_commands:statements.filter(s=>s.kind!=='statement').map(s=>s.text)};
}
function validate(entries){
 const byId=new Map(),paths=new Set();
 for(const e of entries){if(byId.has(e.id))throw Error('duplicate_owner');byId.set(e.id,e);if(e.path){if(paths.has(e.path))throw Error('duplicate_source');paths.add(e.path);}}
 const done=new Set(),active=new Set(),order=[];
 function visit(id){if(done.has(id))return;if(active.has(id))throw Error('dependency_cycle');const e=byId.get(id);if(!e)throw Error('missing_dependency:'+id);active.add(id);for(const d of e.dependencies)visit(d);active.delete(id);done.add(id);order.push(id);}
 for(const id of byId.keys())visit(id);return order;
}
function build({read=relative=>fs.readFileSync(path.join(ROOT,relative))}={}){
 const entries=[...BASELINE,...CANDIDATE].map(id=>{const file='migrations/'+id,bytes=read(file);return{id,path:file,sha256:sha(bytes),bytes:bytes.length,scope:BASELINE.includes(id)?'baseline_source_inventory':'candidate_owner',dependencies:DEPENDENCIES[id]||[],transaction:transactions(bytes.toString('utf8')),installed_catalog:'UNRESOLVED',resume_policy:'UNREVIEWED_DO_NOT_REAPPLY'};});
 const inputs=['migrations/2026-09-05-native-only-intake.sql','migrations/2026-09-07-native-intake-named-append.sql'];
 const bytes=inputs.map(read),composed=composer.compose(...bytes.map(b=>b.toString('utf8')));
 entries.push({id:ATOMIC,path:null,sha256:sha(composed.sql),bytes:Buffer.byteLength(composed.sql),scope:'atomic_generated_owner',dependencies:DEPENDENCIES[ATOMIC],inputs:inputs.map((file,i)=>({path:file,sha256:sha(bytes[i])})),composer:{path:'scripts/native-intake-named-append-compose.js',sha256:sha(read('scripts/native-intake-named-append-compose.js'))},transaction:transactions(composed.sql),installed_catalog:'UNRESOLVED',resume_policy:'UNREVIEWED_DO_NOT_REAPPLY'});
 return {contract:'linear-exit-install-inventory-v1',classification:'SOURCE_ONLY',executable:false,installation_authorized:false,install_ready:false,installation_complete:false,dependency_closure_complete:false,baseline:'UNRESOLVED_CURRENT_HOSTED_CATALOG; dated capture is not a full baseline',external_platform:'SYNTHETIC auth/roles/storage scaffold is not platform custody proof',interruption_rehearsal:'UNPROVEN_PER_COMMIT',order_review:'DOCUMENT_ORDER_PROPOSED; intermediate-state database equivalence unproven',resume_signatures:'UNRESOLVED_CUMULATIVE_PREFIX_CATALOG; isolated file hashes cannot describe later owner replacements',entries,dependency_order:validate(entries)};
}
function verify(manifest,options){const fresh=build(options);if(JSON.stringify(manifest)!==JSON.stringify(fresh))throw Error('manifest_source_or_contract_drift');return true;}
module.exports={build,verify,validate,transactions,BASELINE,CANDIDATE,DEPENDENCIES};
if(require.main===module)process.stdout.write(JSON.stringify(build(),null,2)+'\n');
