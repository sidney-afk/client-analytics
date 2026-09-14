'use strict';
// Preparation only: exact observed starting catalog + pinned pending sources.
// No connection factory, SQL execution, activation or hosted authorization.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const inventory=require('./linear-exit-install-manifest'),extension=require('./linear-exit-admission-release-extension');
const observed=require('./linear-exit-observed-public-catalog'),journal=require('./linear-exit-install-journal');
const {splitSqlStatements}=require('./track-b-recovery-package');
const ROOT=path.resolve(__dirname,'..');
const PREEXISTING={
 '2026-09-05-workload-native-membership.sql':'All four routines already exist in the exact observed catalog with service-only grants; preserve them rather than replay CREATE-only setup. Later label-state and roster correction owners still apply.',
 '2026-09-05-description-images.sql':'Preserve observed existing table and separately verify Storage configuration; do not reseed platform data.',
 '2026-09-09-kasper-urgent-pings.sql':'Preserve observed columns and current status trigger; no new ping operation is required.',
 '2026-09-10-kasper-urgent-ping-ledger.sql':'Preserve observed ledger routine and four triggers; historical event backfill is separate accepted-work reconciliation, never automatic installation replay.'
};
function sqlTransport(sql){
 const meta=splitSqlStatements(sql).filter(s=>s.kind!=='statement');
 if(!meta.length)return sql;
 assert.equal(meta.length,1,'unsupported source meta commands');assert.equal(meta[0].text,'\\set ON_ERROR_STOP on');
 assert(/^\\set ON_ERROR_STOP on\r?\n/.test(sql),'meta command must be exact first line');
 // Dedicated-query execution already aborts on every SQL error. Only remove
 // this psql client directive; preserve every remaining source byte.
 return sql.replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
}
function build(catalog){
 const expected=observed.load(),queryBytes=fs.readFileSync(path.join(ROOT,expected.query.path));
 assert.equal(observed.compare(catalog,expected,{projectRef:expected.project_ref,queryBytes}).status,'MATCHED_OBSERVED_PUBLIC_CATALOG','exact starting public catalog required');
 const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/independence/LINEAR_EXIT_INSTALL_SOURCE_INVENTORY_20260910.json')));inventory.verify(manifest);
 const added=extension.verify(),sources=[],decisions=[];
 for(const id of manifest.dependency_order){
  const e=manifest.entries.find(x=>x.id===id);
  if(inventory.BASELINE.includes(id)){decisions.push({id,action:'OBSERVED_BASELINE_NO_REPLAY',source_sha256:e.sha256});continue;}
  if(Object.hasOwn(PREEXISTING,id)){decisions.push({id,action:'PRESERVE_OBSERVED_PREEXISTING',reason:PREEXISTING[id],source_sha256:e.sha256});continue;}
  const raw=e.path?fs.readFileSync(path.join(ROOT,e.path),'utf8'):require('./native-intake-named-append-compose').fromRepository().sql;
  assert.equal(journal.sha(raw),e.sha256,'source pin');const sql=sqlTransport(raw);
  sources.push({id,sql,sha256:journal.sha(sql),original_sha256:e.sha256,dependencies:sources.length?[sources.at(-1).id]:[]});
  decisions.push({id,action:'APPLY_REVIEWED_NEW_OR_UPGRADE_OWNER',source_sha256:e.sha256});
 }
 for(const e of added.sql_owners){const raw=fs.readFileSync(path.join(ROOT,e.path),'utf8');assert.equal(journal.sha(raw),e.sha256);const sql=sqlTransport(raw);sources.push({id:e.path,sql,sha256:journal.sha(sql),original_sha256:e.sha256,dependencies:[sources.at(-1).id]});}
 const selects=splitSqlStatements(queryBytes.toString('utf8')).filter(s=>s.kind==='statement'&&/^select\b/i.test(s.text));assert.equal(selects.length,1);
 const plan={format:'linear-exit-install-journal-plan-v1',stage_id:'OBSERVED_PUBLIC_20260912_PENDING_PREPARATION_V1',initial_catalog_sha256:expected.catalog_sha256,catalog_sql:selects[0].text.replace(/;\s*$/,'')+' as catalog;',sources};
 const planBytes=Buffer.from(JSON.stringify(plan,null,2)+'\n'),planSha256=journal.sha(planBytes);journal.compile(planBytes,planSha256);
 return {planBytes,planSha256,decisions,scope:'ISOLATED_PENDING_SOURCE_PLAN_PREPARATION',installation_authorized:false,full_transition_rehearsed:false,application_write_boundary_proven:false,external_platform_prerequisites_proven:false,historical_backfill_reconciled:false};
}
module.exports={build,sqlTransport,PREEXISTING};
