'use strict';
// Optional assurance over catalog-visible consumers only. Dynamic calls and
// external writers are not inferred from ownership/default dependencies.
const {canonicalJson}=require('./track-b-backup');

const qi=s=>'"'+s.replace(/"/g,'""')+'"';const literal=s=>"'"+s.replace(/'/g,"''")+"'";
const fail=c=>{throw Error('SEQUENCE_BOUNDS_'+c);};
const decimal=v=>{if(typeof v!=='string'||! /^-?(0|[1-9][0-9]{0,18})$/.test(v))fail('DECIMAL');return BigInt(v);};
function catalogSql(){return `with sequences as(select c.oid,c.relname,s.* from pg_class c join pg_sequence s on s.seqrelid=c.oid where c.relnamespace='public'::regnamespace),edges as(
 select s.oid sequence_oid,d.refobjid table_oid,d.refobjsubid attnum,'owned_or_identity' kind from sequences s join pg_depend d on d.classid='pg_class'::regclass and d.objid=s.oid and d.refclassid='pg_class'::regclass and d.deptype in ('a','i') and d.refobjsubid>0
 union all select s.oid,a.adrelid,a.adnum,'default_dependency' from sequences s join pg_depend d on d.refclassid='pg_class'::regclass and d.refobjid=s.oid and d.classid='pg_attrdef'::regclass join pg_attrdef a on a.oid=d.objid)
 select coalesce(jsonb_agg(jsonb_build_object('name',s.relname,'increment',s.seqincrement::text,'minimum',s.seqmin::text,'maximum',s.seqmax::text,'start',s.seqstart::text,'cache',s.seqcache::text,'cycle',s.seqcycle,'type',format_type(s.seqtypid,null),'consumers',(select coalesce(jsonb_agg(x order by x->>'schema',x->>'table',x->>'column'),'[]'::jsonb) from(select jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'identity',a.attidentity,'default',(select pg_get_expr(adbin,adrelid) from pg_attrdef where adrelid=c.oid and adnum=a.attnum),'edge_kinds',jsonb_agg(distinct e.kind order by e.kind)) x from edges e join pg_class c on c.oid=e.table_oid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=e.attnum and not a.attisdropped where e.sequence_oid=s.oid group by n.nspname,c.relname,c.oid,a.attname,a.attnum,a.atttypid,a.atttypmod,a.attidentity) q)) order by s.relname),'[]'::jsonb) from sequences s`;}
function validate(proof,states){
 if(!proof||proof.version!==1||proof.consumer_closure_proven!==false||!Array.isArray(proof.sequences))fail('CONTRACT_REQUIRED');
 if(new Set(states.map(s=>s.name)).size!==states.length||canonicalJson(proof.sequences.map(s=>s.name))!==canonicalJson(states.map(s=>s.name).sort()))fail('SEQUENCE_COVERAGE');
 const allowed=new Set(require('./linear-exit-complete-application-data').expectedNames());
 for(const s of proof.sequences){
  const state=states.find(x=>x.name===s.name);
  if(s.increment!==state.increment_by||s.minimum!==state.min_value||s.maximum!==state.max_value||s.start!==state.start_value||s.type!==state.data_type||decimal(s.increment)<=0n||s.cycle!==false||decimal(s.cache)<1n)fail('CONFIGURATION');
  const next=decimal(state.last_value)+(state.is_called?decimal(state.increment_by):0n);
  if(typeof state.is_called!=='boolean'||next<decimal(s.minimum)||next>decimal(s.maximum))fail('NEXT_RANGE');
  if(!Array.isArray(s.consumers)||!s.consumers.length)fail('CONSUMER_COVERAGE');const seen=new Set();let prior='';
  for(const c of s.consumers){
   if(c.schema!=='public'||!allowed.has(c.table)||typeof c.column!=='string'||!/^[_a-z][_a-z0-9]{0,62}$/.test(c.column)||!['smallint','integer','bigint'].includes(c.type)||!['','a','d'].includes(c.identity)||(c.default!==null&&typeof c.default!=='string')||!Array.isArray(c.edge_kinds)||!c.edge_kinds.length||c.edge_kinds.some(k=>!['owned_or_identity','default_dependency'].includes(k)))fail('CONSUMER_DEFINITION');
   // A dependency does not imply that the stored value equals nextval: e.g.
   // nextval(seq)-100 can collide despite a safe raw sequence high water.
   const directDefaults=[`nextval('${s.name}'::regclass)`,`nextval('public.${s.name}'::regclass)`];
   const direct=c.identity===''&&c.edge_kinds.includes('default_dependency')&&directDefaults.includes(c.default);
   const identity=['a','d'].includes(c.identity)&&c.default===null&&c.edge_kinds.includes('owned_or_identity');
   if(!direct&&!identity)fail('NON_DIRECT_CONSUMER');
   const id=c.table+'.'+c.column;if(seen.has(id))fail('CONSUMER_DUPLICATE');if(prior&&id<prior)fail('CONSUMER_ORDER');prior=id;seen.add(id);
   const limit={smallint:32767n,integer:2147483647n,bigint:9223372036854775807n}[c.type];if(next>limit||next< -limit-1n)fail('CONSUMER_TYPE_RANGE');
   if(c.maximum_value!==null&&next<=decimal(c.maximum_value))fail('UNSAFE_MAXIMUM');
  }
 }
 return proof;
}
function capture(query,states){
 const sequences=JSON.parse(query(catalogSql()));
 for(const s of sequences)for(const c of s.consumers){
  if(c.schema!=='public'||!['smallint','integer','bigint'].includes(c.type))fail('CONSUMER_DEFINITION');
  c.maximum_value=JSON.parse(query(`select json_build_object('maximum',max(${qi(c.column)})::text) from public.${qi(c.table)}`)).maximum;
 }
 return validate({version:1,consumer_closure_proven:false,sequences},states);
}
function targetSql(proof,states){
 validate(proof,states);
 const definitions=proof.sequences.map(s=>({...s,consumers:s.consumers.map(({maximum_value,...c})=>c)}));
 const lines=[`do $sequence_bounds$ declare actual jsonb;maximum_text text;begin select (${catalogSql()}) into actual;if actual is distinct from ${literal(canonicalJson(definitions))}::jsonb then raise exception 'SEQUENCE_BOUNDS_TARGET_MAPPING_MISMATCH';end if;`];
 for(const s of proof.sequences){const state=states.find(x=>x.name===s.name);const next=decimal(state.last_value)+(state.is_called?decimal(state.increment_by):0n);
  for(const c of s.consumers)lines.push(`select max(${qi(c.column)})::text into maximum_text from public.${qi(c.table)};if maximum_text is distinct from ${c.maximum_value===null?'null':literal(c.maximum_value)} then raise exception 'SEQUENCE_BOUNDS_TARGET_MAXIMUM_MISMATCH';end if;if maximum_text is not null and ${next}::numeric<=maximum_text::numeric then raise exception 'SEQUENCE_BOUNDS_TARGET_UNSAFE';end if;`);
 }
 lines.push('end $sequence_bounds$;');return lines.join('\n');
}
module.exports={catalogSql,capture,validate,targetSql};
