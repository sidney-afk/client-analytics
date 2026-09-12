'use strict';
// Read-only four-owner admission contract. No deployment or activation.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..');
const CONTRACT='docs/independence/LINEAR_EXIT_ADMISSION_SCHEMA_CONTRACT_20260912.json';
const CONTRACT_SHA='7521ab5169fa272a7add4d7d45dc62c82ca22f75c69d2ea8371b22c1c5107a79';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function loadContract({readFile=fs.readFileSync}={}) {
 const bytes=readFile(path.join(ROOT,CONTRACT));if(sha(bytes)!==CONTRACT_SHA)throw Error('ADMISSION_CONTRACT_HASH_DRIFT');
 const contract=JSON.parse(bytes);for(const source of contract.sources){if(sha(readFile(path.join(ROOT,'supabase/migrations',source.file)))!==source.sha256)throw Error('ADMISSION_SOURCE_HASH_DRIFT');}return contract;
}
const contractQuery="begin read only; set local search_path=public,pg_catalog; select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'language',(select lanname from pg_language where oid=p.prolang),'owner',pg_get_userbyid(p.proowner),'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,'body_lf_md5',md5(replace(p.prosrc,chr(13),'')),'volatility',p.provolatile,'security_definer',p.prosecdef,'config',p.proconfig,'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'production_card_%v1' or p.proname in ('production_application_dml_guard_v1','production_provider_debt_disposition_v1') or p.proname like 'card_followup_%v1')),'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid)) order by k.conname) from pg_constraint k where k.conrelid=c.oid)) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('card_write_admission_v1','card_write_operations_v1','card_write_followups_v1','card_write_transaction_context_v1')),'triggers',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'initially_deferred',t.tginitdeferred) order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal and (t.tgname like 'aaa_application_dml_admission_%' or c.relname in ('card_write_admission_v1','card_write_operations_v1','card_write_followups_v1','card_write_transaction_context_v1')))) ; commit;";
const extendedQuery=contractQuery;
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function compareMetadata(actual,contract=loadContract()) {
 const failures=[];if(!actual||typeof actual!=='object'||Array.isArray(actual)||Object.keys(actual).sort().join(',')!=='functions,tables,triggers')return {ok:false,failures:['ADMISSION_METADATA_SHAPE'],deployment_authorized:false};
 for(const group of ['functions','tables','triggers']){
  if(!Array.isArray(actual[group])){failures.push('ADMISSION_'+group.toUpperCase()+'_SHAPE');continue;}
  const identity=x=>group==='functions'?x.name+'('+x.identity_arguments+')':group==='triggers'?x.table+'.'+x.name:x.name;
  const seen=new Set();for(const row of actual[group]){if(!row||typeof row!=='object'||seen.has(identity(row))){failures.push('ADMISSION_'+group.toUpperCase()+'_DUPLICATE_OR_INVALID');break;}seen.add(identity(row));}
  if(actual[group].length!==contract[group].length)failures.push('ADMISSION_'+group.toUpperCase()+'_COUNT');
  for(const expected of contract[group]){const found=actual[group].find(x=>x&&identity(x)===identity(expected));if(!found)failures.push('MISSING:'+group+':'+identity(expected));else if(JSON.stringify(canonical(found))!==JSON.stringify(canonical(expected)))failures.push('MISMATCH:'+group+':'+identity(expected));}
 }
 // Failure identifiers come exclusively from the pinned public contract.
 return {ok:failures.length===0,failures,deployment_authorized:false,provider_maintenance_contract_included:true};
}
async function verifyAdmission(query){const contract=loadContract();if(typeof query!=='function')throw Error('ADMISSION_QUERY_REQUIRED');const actual=await query(contractQuery);loadContract();return compareMetadata(actual,contract);}
module.exports={loadContract,compareMetadata,verifyAdmission,contractQuery,extendedQuery,CONTRACT_SHA};
