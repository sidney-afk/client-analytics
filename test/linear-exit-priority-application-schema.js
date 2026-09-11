'use strict';
// Gap probe over actual published installation order. No priority-table fixture
// or guessed owner is added. Only catalog metadata is read after installation.
const assert=require('node:assert/strict');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
const {scalar}=require('../scripts/linear-exit-composition/harness');
const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
const companion=require('../scripts/linear-exit-priority-companion');
const {canonicalJson}=require('../scripts/track-b-backup');
const scope=require('../docs/independence/LINEAR_EXIT_RECOVERY_SCOPE_20260910.json');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
const cluster=new Cluster();assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
try{
 const source={};const proof=install(source,()=>null);assert.equal(source.name,cluster.db);
 const supplement=process.argv.includes('--supplement-three')?require('../scripts/linear-exit-priority-schema-supplement').apply(cluster):null;
 const tables=companion.schema().tables.map(t=>{
  const actual=JSON.parse(scalar(cluster,`select json_build_object('present',to_regclass('public.${t.name}') is not null,'columns',coalesce((select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a where a.attrelid=to_regclass('public.${t.name}') and a.attnum>0 and not a.attisdropped),'[]'::jsonb),'primary_key',coalesce((select jsonb_agg(a.attname order by k.ord) from pg_constraint p cross join lateral unnest(p.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=p.conrelid and a.attnum=k.attnum where p.conrelid=to_regclass('public.${t.name}') and p.contype='p'),'[]'::jsonb))`));
  const missing=t.columns.filter(c=>!actual.columns.some(a=>a.name===c.name)).map(c=>c.name);
  const extra=actual.columns.filter(c=>!t.columns.some(a=>a.name===c.name)).map(c=>c.name);
  const changed=t.columns.filter(c=>actual.columns.some(a=>a.name===c.name&&canonicalJson(a)!==canonicalJson(c))).map(c=>c.name);
  const columnOrder=canonicalJson(t.columns.map(c=>c.name))===canonicalJson(actual.columns.map(c=>c.name));
  const primaryKey=canonicalJson(t.primary_key)===canonicalJson(actual.primary_key);
  const exact=actual.present&&missing.length===0&&extra.length===0&&changed.length===0&&columnOrder&&primaryKey;
  return {table:t.name,status:!actual.present?'missing':exact?'exact':'mismatch',present:actual.present,exact,missing_columns:missing,extra_columns:extra,changed_columns:changed,column_order_matches:columnOrder,primary_key_matches:primaryKey,source_declarations:(scope.tables.find(s=>s.table===t.name)||{}).source_declarations||[]};
 });
 const exact=tables.filter(t=>t.exact).length;
 console.log(JSON.stringify({marker:'LINEAR_EXIT_PRIORITY_APPLICATION_SCHEMA_REPORT',classification:'ISOLATED_POSTGRES_CATALOG_GAP_PROBE',inventory_sha256:proof.inventory_sha256,row_schema_sha256:companion.SCHEMA_SHA256,expected_tables:9,exact_tables:exact,tables,additional_application_owners_applied:!!supplement,supplement,full_application_schema_proven:false,application_rows_read:false}));
 if(exact!==9){console.error('LINEAR_EXIT_PRIORITY_APPLICATION_SCHEMA_INCOMPLETE');process.exitCode=1;}
 else console.log('LINEAR_EXIT_PRIORITY_APPLICATION_SCHEMA_OK');
}catch(error){console.error('LINEAR_EXIT_PRIORITY_APPLICATION_SCHEMA_EXECUTION_FAILED');process.exitCode=1;}
finally{cluster.stop();}
