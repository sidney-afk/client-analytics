'use strict';
// Composable INPUT to a separately reviewed v9 closure. Does not redefine v8,
// activate a snapshot schedule, grant privileges, or claim installed coverage.
const EXTENSION = Object.freeze({
  id: 'f44-native-triage-v1', requiredBase: 'history-v8',
  tables: Object.freeze([
    Object.freeze({name:'public_intake_log',pk:'id',identity:true}),
    Object.freeze({name:'legacy_intake_native_triage',pk:'payload_hash'}),
  ]),
  migrations: Object.freeze(['2026-08-24-public-intake-log.sql','2026-09-07-legacy-intake-native-triage.sql']),
  triggers: Object.freeze([
    Object.freeze({table:'linear_intake_receipts',name:'aaa_legacy_intake_native_provider_guard'}),
    Object.freeze({table:'production_intake_manifests',name:'legacy_intake_native_acceptance_guard'}),
  ]),
  existingOwners: Object.freeze(['clients','team_members','syncview_runtime_flags','linear_intake_receipts',
    'production_intake_manifests','mirror_outbox','batches','deliverables','calendar_posts',
    'production_card_provenance','production_card_materialization_receipts','production_card_materialization_ingress']),
  privateBytes: Object.freeze(['payload_json','received.*.raw_body','native_request','completion_actor','completed_by']),
});
function compose(baseTables, otherExtensions = []) {
  const seen = new Map(baseTables.map(row => [row.name,row]));
  for (const extension of [EXTENSION,...otherExtensions]) for (const row of extension.tables) {
    const old=seen.get(row.name);
    if(old && JSON.stringify(old)!==JSON.stringify(row))throw Error('recovery_owner_definition_conflict');
    seen.set(row.name,row);
  }
  for(const name of EXTENSION.existingOwners)if(!seen.has(name))throw Error('f44_recovery_dependency_missing:'+name);
  return [...seen.values()];
}
module.exports={EXTENSION,compose};
