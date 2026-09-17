'use strict';
// Application catalog dependencies and local numeric bounds only. Dynamic
// nextval calls/manual IDs/admin resets are outside this catalog proof.
const assert=require('node:assert/strict');const {Cluster}=require('../scripts/f42-apply-rehearsal');
const {scalar}=require('../scripts/linear-exit-composition/harness');const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
const supplement=require('../scripts/linear-exit-priority-schema-supplement');const observed=require('../scripts/linear-exit-backup-observed-baseline');
if(process.env.F63_REQUIRE_POSTGRES!=='1')throw Error('DISPOSABLE_POSTGRES_REQUIRED');
const cluster=new Cluster();assert.ok(['127.0.0.1','localhost','::1'].includes(cluster.host));
const qi=s=>'"'+s.replace(/"/g,'""')+'"';
try{
 const proof=install({},()=>null);supplement.apply(cluster);observed.apply(cluster);
 const metadata=JSON.parse(scalar(cluster,`with sequences as(select c.oid,c.relname,s.* from pg_class c join pg_sequence s on s.seqrelid=c.oid where c.relnamespace='public'::regnamespace), edges as(
 select s.oid sequence_oid,d.refobjid table_oid,d.refobjsubid attnum,'owned_or_identity' kind from sequences s join pg_depend d on d.classid='pg_class'::regclass and d.objid=s.oid and d.refclassid='pg_class'::regclass and d.deptype in ('a','i') and d.refobjsubid>0
 union all
 select s.oid,a.adrelid,a.adnum,'default_dependency' from sequences s join pg_depend d on d.refclassid='pg_class'::regclass and d.refobjid=s.oid and d.classid='pg_attrdef'::regclass join pg_attrdef a on a.oid=d.objid
 )select coalesce(jsonb_agg(jsonb_build_object('name',s.relname,'increment',s.seqincrement::text,'minimum',s.seqmin::text,'maximum',s.seqmax::text,'start',s.seqstart::text,'cache',s.seqcache::text,'cycle',s.seqcycle,'type',format_type(s.seqtypid,null),'consumers',(select coalesce(jsonb_agg(x order by x->>'schema',x->>'table',x->>'column'),'[]'::jsonb) from(select jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'edge_kinds',jsonb_agg(distinct e.kind order by e.kind)) x from edges e join pg_class c on c.oid=e.table_oid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=e.attnum and not a.attisdropped where e.sequence_oid=s.oid group by n.nspname,c.relname,a.attname,a.atttypid,a.atttypmod) q)) order by s.relname),'[]'::jsonb) from sequences s`));
 const sequences=metadata.map(s=>{
  const state=JSON.parse(scalar(cluster,`select json_build_object('last_value',last_value::text,'is_called',is_called) from public.${qi(s.name)}`));
  const increment=BigInt(s.increment);const next=BigInt(state.last_value)+(state.is_called?increment:0n);
  const positive=increment>0n;const inRange=next>=BigInt(s.minimum)&&next<=BigInt(s.maximum);
  const consumers=s.consumers.map(c=>{
   const supported=c.schema==='public'&&['smallint','integer','bigint'].includes(c.type);
   if(!supported)return {...c,status:'unsupported',next_above_maximum:false};
   const maximum=JSON.parse(scalar(cluster,`select json_build_object('maximum',max(${qi(c.column)})::text) from ${qi(c.schema)}.${qi(c.table)}`)).maximum;
   const safe=maximum===null||next>BigInt(maximum);
   return {...c,status:safe?'bound_pass':'unsafe_bound',empty:maximum===null,next_above_maximum:safe};
  });
  const safe=positive&&!s.cycle&&inRange&&consumers.length>0&&consumers.every(c=>c.status==='bound_pass');
  return {name:s.name,type:s.type,increment:s.increment,cache:s.cache,positive_increment:positive,cycle:s.cycle,next_in_sequence_range:inRange,catalog_consumers:consumers,status:!consumers.length?'unmapped':safe?'catalog_bound_pass':'unsafe_or_unsupported',complete_consumers_proven:false};
 });
 const safe=sequences.length>0&&sequences.every(s=>s.status==='catalog_bound_pass');
 console.log(JSON.stringify({marker:'LINEAR_EXIT_SEQUENCE_APPLICATION_REPORT',classification:'ISOLATED_POSTGRES_CATALOG_DEPENDENCIES_AND_BOUNDS',inventory_sha256:proof.inventory_sha256,sequences,catalog_mapped_bound_all_pass:safe,consumer_closure_proven:false,dynamic_calls_reviewed:false,source_sequence_fence_proven:false,concurrent_capture_consistency_proven:false}));
 if(safe)console.log('LINEAR_EXIT_SEQUENCE_APPLICATION_OK');else{console.error('LINEAR_EXIT_SEQUENCE_APPLICATION_UNSAFE_OR_UNKNOWN');process.exitCode=1;}
}catch(e){console.error('LINEAR_EXIT_SEQUENCE_APPLICATION_EXECUTION_FAILED');process.exitCode=1;}
finally{cluster.stop();}
