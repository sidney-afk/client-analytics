'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'migrations/2026-09-05-native-label-catalog-foundation.sql'),'utf8');
// Structural controls complement, and never substitute for, the disposable
// PostgreSQL proof. Activation must remain a refusal under service credentials.
for(const name of ['activate','read_active']){
  const body=sql.split('create function public.production_label_catalog_'+name+'(')[1].split('$fn$;')[0];
  assert.match(body,/raise exception[\s\S]*label_catalog_activation_held/);
  assert.doesNotMatch(body,/\binsert\b|\bupdate\b|\bdelete\b|\bexecute\b/i);
}
assert.match(sql,/revoke all on public\.production_label_catalog_versions from public, anon, authenticated, service_role/);
assert.match(sql,/before truncate[\s\S]*production_label_catalog_immutable/);
assert.doesNotMatch(sql,/create (?:or replace )?function public\.(?:production_deliverable_write|mirror_outbox_enqueue)/i);
const r=spawnSync(process.execPath,['--experimental-strip-types',path.join(root,'qa/native-label-catalog/handler-proof.mjs')],{cwd:root,stdio:'inherit',windowsHide:true});
assert.equal(r.status,0);console.log('Native label catalog held foundation contracts PASS');
