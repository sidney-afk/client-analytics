'use strict';
const assert=require('node:assert/strict');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
const {scalar}=require('../scripts/linear-exit-composition/harness');
const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
const cluster=new Cluster();assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
const names=['client_credential_events','client_credentials','client_credentials_rev'];
try{
 const inventory=install({},()=>null);
 const before=JSON.parse(scalar(cluster,`select jsonb_agg(jsonb_build_object('name',n,'present',to_regclass('public.'||n) is not null) order by n) from unnest(array[${names.map(n=>"'"+n+"'").join(',')}]) n`));
 const source=require('../scripts/linear-exit-credential-schema-supplement').apply(cluster);
 const tables=names.map(name=>JSON.parse(scalar(cluster,`select jsonb_build_object('name','${name}','columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a where a.attrelid='public.${name}'::regclass and a.attnum>0 and not a.attisdropped),'primary_key',(select jsonb_agg(a.attname order by k.ord) from pg_constraint p cross join lateral unnest(p.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=p.conrelid and a.attnum=k.attnum where p.conrelid='public.${name}'::regclass and p.contype='p'))`)));
 assert.deepEqual(tables.map(t=>t.columns.length),[14,17,4]);
 assert.deepEqual(tables.map(t=>t.primary_key),[['id'],['id'],['client_slug']]);
 const acl=JSON.parse(scalar(cluster,`select jsonb_agg(jsonb_build_object('table',n,'rls',(select relrowsecurity from pg_class where oid=('public.'||n)::regclass),'anon_select',has_table_privilege('anon','public.'||n,'SELECT'),'authenticated_select',has_table_privilege('authenticated','public.'||n,'SELECT')) order by n) from unnest(array[${names.map(n=>"'"+n+"'").join(',')}]) n`));
 for(const row of acl){assert.equal(row.rls,true);assert.equal(row.anon_select,row.table==='client_credentials_rev');assert.equal(row.authenticated_select,row.table==='client_credentials_rev');}
 assert.equal(scalar(cluster,"select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='client_credentials_rev'"),'1');
 console.log(JSON.stringify({marker:'LINEAR_EXIT_CREDENTIAL_SCHEMA_OK',classification:'ISOLATED_POSTGRES_SOURCE_SCHEMA',inventory_sha256:inventory.inventory_sha256,source,before,tables,acl,source_revision_publication_present:true,application_rows_read:false,hosted_schema_equivalence_proven:false}));
}catch(error){console.error('LINEAR_EXIT_CREDENTIAL_SCHEMA_FAILED');process.exitCode=1;}
finally{cluster.stop();}
