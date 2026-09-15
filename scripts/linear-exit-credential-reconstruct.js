'use strict';
// Internal SQL construction from already authenticated row contracts. No free SQL.
const companion=require('./linear-exit-credential-companion');
const qi=s=>'"'+s.replace(/"/g,'""')+'"';
const lit=s=>s===null?'NULL':`convert_from(decode('${Buffer.from(s).toString('hex')}','hex'),'UTF8')`;
function sections(payload,manifest){
 const tables=companion.schema().tables;
 const omitted=manifest.omitted_data_tables;
 if(!Array.isArray(omitted)||new Set(omitted).size!==omitted.length||omitted.some(n=>typeof n!=='string'||!/^[_a-z][_a-z0-9]{0,62}$/.test(n)))throw Error('CREDENTIAL_RESTORE_OMITTED_CONTRACT');
 if(tables.some(t=>!omitted.includes(t.name)||Object.hasOwn(manifest.data.tables,t.name)))throw Error('CREDENTIAL_RESTORE_COVERAGE_MISMATCH');
 const guards=pk=>tables.map(t=>{
  const expected={columns:t.columns,...(pk?{primary_key:t.primary_key}:{})};
  const actual=`select jsonb_build_object('columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a where a.attrelid='public.${t.name}'::regclass and a.attnum>0 and not a.attisdropped)${pk?`, 'primary_key',coalesce((select jsonb_agg(a.attname order by k.ord) from pg_constraint p cross join lateral unnest(p.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=p.conrelid and a.attnum=k.attnum where p.conrelid='public.${t.name}'::regclass and p.contype='p'),'[]'::jsonb)`:''})`;
  return `do $priority_shape$ begin if (${actual}) is distinct from ${lit(JSON.stringify(expected))}::jsonb then raise exception 'CREDENTIAL_RESTORE_SCHEMA_MISMATCH';end if;end $priority_shape$;`;
 }).join('\n');
 const inserts=tables.map(t=>{
  const rows=payload.tables[t.name].rows;
  return rows.length?`insert into public.${qi(t.name)} (${t.columns.map(c=>qi(c.name)).join(',')}) values ${rows.map(r=>'('+r.map((v,i)=>lit(v)+'::'+t.columns[i].type).join(',')+')').join(',')};`:'';
 }).join('\n');
 const bags=tables.map(t=>{
  const expected=lit(JSON.stringify(payload.tables[t.name].rows));
  const actual=`select jsonb_build_array(${t.columns.map(c=>qi(c.name)+'::text').join(',')}) row from public.${qi(t.name)}`;
  return `do $priority_rows$ begin if exists(select row from (${actual}) a except all select value from jsonb_array_elements(${expected}::jsonb)) or exists(select value from jsonb_array_elements(${expected}::jsonb) except all select row from (${actual}) a) then raise exception 'CREDENTIAL_RESTORE_MULTISET_MISMATCH';end if;end $priority_rows$;`;
 }).join('\n');
 const priorityNames=require('./linear-exit-priority-companion').schema().tables.map(t=>t.name);
 const other=omitted.filter(n=>!tables.some(t=>t.name===n)&&!priorityNames.includes(n)).map(n=>`do $priority_omitted$ begin if exists(select from public.${qi(n)}) then raise exception 'CREDENTIAL_RESTORE_UNCOVERED_TABLE_NOT_EMPTY';end if;end $priority_omitted$;`).join('\n');
 return {beforePost:["set local timezone='UTC';set local datestyle='ISO,YMD';",guards(false),inserts].join('\n'),verify:[guards(true),bags,other].join('\n')};
}
module.exports={sections};
