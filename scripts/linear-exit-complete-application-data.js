'use strict';
// Separate authenticated application-row package. HMAC is not encryption.
// No object bytes, hosted platform custody, or concurrent sequence fencing claim.
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const backup=require('./track-b-backup');
const FORMAT='complete-application-data-v1';
const MAGIC=Buffer.from('SYNCVIEW-COMPLETE-APPLICATION-DATA-V1\n');
const INVENTORY_SHA256='fb24bcc7fce59194e92fa1b10e41909d46a9e87e305948273fd216f985d7a10f';
const VERSIONS=Object.freeze({v1:{format:FORMAT,magic:MAGIC,hash:INVENTORY_SHA256,file:'LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V1.json'},v2:{format:'complete-application-data-v2',magic:Buffer.from('SYNCVIEW-COMPLETE-APPLICATION-DATA-V2\n'),hash:'4436b3f6f663a974c5d02d67d81653e0cd14981b6ed0a860b47e32f3f81a10ac',file:'LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V2.json'}});
function version(name='v1'){const v=VERSIONS[name];if(!v)fail('VERSION');return v;}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canon=backup.canonicalJson;
const fail=s=>{throw Error('COMPLETE_APPLICATION_'+s);};
const qi=s=>'"'+s.replace(/"/g,'""')+'"';
const lit=s=>`convert_from(decode('${Buffer.from(s).toString('hex')}','hex'),'UTF8')`;
const identifier=s=>typeof s==='string'&&/^[a-z_][a-z0-9_]{0,62}$/.test(s);
function exact(o,keys){if(!o||Array.isArray(o)||typeof o!=='object'||canon(Object.keys(o).sort())!==canon([...keys].sort()))fail('SHAPE');}
function expectedNames(name='v1'){
 const v=version(name),bytes=fs.readFileSync(path.join(__dirname,'../docs/independence',v.file));
 if(sha(bytes)!==v.hash)fail('INVENTORY_DRIFT');
 return JSON.parse(bytes).tables;
}
function catalogSql(){return `select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'primary_key',coalesce((select jsonb_agg(a.attname order by k.ord) from pg_constraint p cross join lateral unnest(p.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=p.conrelid and a.attnum=k.attnum where p.conrelid=c.oid and p.contype='p'),'[]'::jsonb)) order by c.relname),'[]'::jsonb) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'`;}
function dependencySql(){return `select jsonb_build_object('unsupported_relations',(select count(*) from pg_class c where c.relnamespace='public'::regnamespace and (c.relkind in ('p','f','m') or c.relispartition)),'external_foreign_keys',(select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_class r on r.oid=k.confrelid where k.contype='f' and c.relnamespace='public'::regnamespace and r.relnamespace<>'public'::regnamespace),'external_column_types',(select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attnum>0 and not a.attisdropped and n.nspname not in ('public','pg_catalog'))) `;}
function captureRows(query,name='v1'){
 const run=sql=>query("set local timezone='UTC';set local datestyle='ISO,YMD';set local intervalstyle='postgres';set local bytea_output='hex';\n"+sql);
 const deps=JSON.parse(run(dependencySql()));if(Object.values(deps).some(n=>n!==0))fail('EXTERNAL_OR_UNSUPPORTED_DEPENDENCY');
 const catalog=JSON.parse(run(catalogSql()));
 if(canon(catalog.map(t=>t.name))!==canon(expectedNames(name)))fail('UNCLASSIFIED_OR_MISSING_TABLE');
 return Object.fromEntries(catalog.map(t=>[t.name,{...t,rows:JSON.parse(run(`select coalesce(jsonb_agg(jsonb_build_array(${t.columns.map(c=>qi(c.name)+'::text').join(',')})),'[]'::jsonb) from public.${qi(t.name)}`))}]));
}
function validate(payload,parent){
 exact(payload,['format','inventory_sha256','parent_sha256','parent_base64','tables','sequence_bounds','sequence_states']);
 const entry=Object.entries(VERSIONS).find(([,v])=>v.format===payload.format&&v.hash===payload.inventory_sha256);if(!entry)fail('VERSION');const [versionName]=entry;
 if(parent.corpus!=='history-v11'||Object.hasOwn(parent.manifest,'credential_companion_v1'))fail('PARENT_CONTRACT');
 if(canon(payload.sequence_states)!==canon(parent.manifest.sequences))fail('SEQUENCE_STATE_DRIFT');
 require('./linear-exit-complete-sequence-bounds').validate(payload.sequence_bounds,parent.manifest.sequences);
 const names=expectedNames(versionName);exact(payload.tables,names);
 if(versionName==='v2'&&payload.tables.card_write_transaction_context_v1?.rows?.length!==0)fail('ACTIVE_TRANSACTION_CONTEXT');
 const parentNames=Object.keys(parent.manifest.data.tables).sort();
 if(canon([...parentNames,...parent.manifest.omitted_data_tables].sort())!==canon(names))fail('PARENT_COVERAGE');
 const plan=require('./track-b-recovery-package').deferredDefaultPlan(parent.schema.pre.statements,true);
 for(const name of names){
  const t=payload.tables[name];exact(t,['name','columns','primary_key','rows']);
  if(t.name!==name||!Array.isArray(t.columns)||!t.columns.length||!Array.isArray(t.primary_key)||!Array.isArray(t.rows))fail('TABLE_SHAPE');
  const cols=t.columns.map(c=>c.name);if(new Set(cols).size!==cols.length||cols.some(n=>!identifier(n)))fail('COLUMNS');
  for(const c of t.columns){exact(c,['name','type','not_null','identity','generated']);if(typeof c.type!=='string'||typeof c.not_null!=='boolean'||!['','a','d'].includes(c.identity)||!['','s'].includes(c.generated))fail('COLUMN_METADATA');}
  if(new Set(t.primary_key).size!==t.primary_key.length||t.primary_key.some(n=>!cols.includes(n)))fail('PRIMARY_KEY');
  if(canon(t.columns.filter(c=>!c.generated).map(c=>c.name))!==canon(plan.storedColumns[name]))fail('STORED_COLUMNS');
  const seen=new Set();for(const row of t.rows){
   if(!Array.isArray(row)||row.length!==cols.length||row.some((v,i)=>(v!==null&&typeof v!=='string')||(v===null&&t.columns[i].not_null)))fail('ROW_SHAPE');
   if(row.some(v=>typeof v==='string'&&v.includes('\0')))fail('NUL_CELL');
   if(t.primary_key.length){const k=t.primary_key.map(n=>row[cols.indexOf(n)]);if(k.includes(null)||seen.has(canon(k)))fail('PRIMARY_KEY_DUPLICATE_OR_NULL');seen.add(canon(k));}
  }
 }
 return payload;
}
function encode(parentBytes,tables,hmacInput,sequenceBounds,sequenceStates,versionName='v1'){
 const v=version(versionName);
 const parent=require('./track-b-recovery-package').readRecoveryPackage(parentBytes,hmacInput);
 const payload=validate({format:v.format,inventory_sha256:v.hash,parent_sha256:sha(parentBytes),parent_base64:parentBytes.toString('base64'),tables,sequence_bounds:sequenceBounds,sequence_states:sequenceStates},parent);
 const unsigned=Buffer.concat([v.magic,Buffer.from(canon(payload))]);
 return Buffer.concat([unsigned,crypto.createHmac('sha256',backup.parseHmacKey(hmacInput)).update(unsigned).digest()]);
}
function read(bytes,hmacInput){
 if(typeof hmacInput!=='string')fail('EXPLICIT_KEY');
 const v=Buffer.isBuffer(bytes)&&Object.values(VERSIONS).find(v=>bytes.length>=v.magic.length+34&&bytes.subarray(0,v.magic.length).equals(v.magic));if(!v)fail('FORMAT');
 const unsigned=bytes.subarray(0,-32),mac=crypto.createHmac('sha256',backup.parseHmacKey(hmacInput)).update(unsigned).digest();
 if(!crypto.timingSafeEqual(mac,bytes.subarray(-32)))fail('AUTHENTICATION');
 const text=unsigned.subarray(v.magic.length).toString('utf8');let payload;try{payload=JSON.parse(text);}catch{fail('JSON');}
 if(payload.format!==v.format||payload.inventory_sha256!==v.hash)fail('VERSION');
 if(canon(payload)!==text)fail('NONCANONICAL');
 if(typeof payload.parent_base64!=='string')fail('PARENT_BYTES');
 const parentBytes=Buffer.from(payload.parent_base64,'base64');
 if(parentBytes.toString('base64')!==payload.parent_base64||sha(parentBytes)!==payload.parent_sha256)fail('PARENT_HASH');
 const parent=require('./track-b-recovery-package').readRecoveryPackage(parentBytes,hmacInput);
 validate(payload,parent);return {parent,payload};
}
const copyCell=v=>v===null?'\\N':v.replace(/\\/g,'\\\\').replace(/\t/g,'\\t').replace(/\n/g,'\\n').replace(/\r/g,'\\r');
function sections(payload,parent){
 const omitted=new Set(parent.manifest.omitted_data_tables),tables=Object.values(payload.tables);
 const guard=pk=>`do $complete_shape$ begin if (${catalogSql().replace(/^select /,'select ')}) is distinct from ${lit(JSON.stringify(tables.map(({rows,...t})=>pk?t:{...t,primary_key:[]})))}::jsonb then raise exception 'COMPLETE_APPLICATION_CATALOG_MISMATCH';end if;end $complete_shape$;`;
 // Pre-data has no PK constraints yet, but exact stored column metadata must match.
 const preCatalog=catalogSql().replace(/'primary_key',coalesce\(\(select jsonb_agg[\s\S]*?\),'\[\]'::jsonb\)/,"'primary_key','[]'::jsonb");
 const preGuard=`do $complete_shape$ begin if (${preCatalog}) is distinct from ${lit(JSON.stringify(tables.map(({rows,...t})=>({...t,primary_key:[]}))))}::jsonb then raise exception 'COMPLETE_APPLICATION_CATALOG_MISMATCH';end if;end $complete_shape$;`;
 const copies=tables.filter(t=>omitted.has(t.name)).map(t=>{const ix=t.columns.flatMap((c,i)=>c.generated?[]:[i]);return `COPY public.${qi(t.name)} (${ix.map(i=>qi(t.columns[i].name)).join(',')}) FROM stdin;\n${t.rows.map(r=>ix.map(i=>copyCell(r[i])).join('\t')+'\n').join('')}\\.\n`;}).join('\n');
 const bags=tables.map(t=>{const rows=lit(JSON.stringify(t.rows));const actual=`select jsonb_build_array(${t.columns.map(c=>qi(c.name)+'::text').join(',')}) row from public.${qi(t.name)}`;return `do $complete_rows$ begin if exists(select row from (${actual}) a except all select value from jsonb_array_elements(${rows}::jsonb)) or exists(select value from jsonb_array_elements(${rows}::jsonb) except all select row from (${actual}) a) then raise exception 'COMPLETE_APPLICATION_MULTISET_MISMATCH';end if;end $complete_rows$;`;}).join('\n');
 return {beforePost:"set local timezone='UTC';set local datestyle='ISO,YMD';set local intervalstyle='postgres';set local bytea_output='hex';\n"+preGuard+'\n'+copies,verify:guard(true)+'\n'+bags+'\n'+require('./linear-exit-complete-sequence-bounds').targetSql(payload.sequence_bounds,parent.manifest.sequences)};
}
async function capture(options){
 const versionName=options.applicationDataVersion??'v1';version(versionName);
 if(options.corpusName!=='history-v11'||typeof options.hmacInput!=='string'||options.output||options.tempDir||options.hooks?.captureSnapshot||options.requireCredentialCompanion)fail('CAPTURE_OPTIONS');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'complete-application-private-'));
 try{let tables,sequenceBounds,sequenceStates;const recovery=require('./track-b-recovery-package');await recovery.captureRecoveryPackage({...options,captureSequenceBounds:false,output:path.join(dir,'parent.private'),tempDir:dir,hooks:{...options.hooks,captureSnapshot:query=>{tables=captureRows(query,versionName);const names=JSON.parse(query(recovery.inventorySql())).sequences||[];sequenceStates=names.map(name=>JSON.parse(query(recovery.sequenceStateSql(name))));sequenceBounds=require('./linear-exit-complete-sequence-bounds').capture(query,sequenceStates);}}});
  const bytes=encode(fs.readFileSync(path.join(dir,'parent.private')),tables,options.hmacInput,sequenceBounds,sequenceStates,versionName);read(bytes,options.hmacInput);return {bytes,shared_exported_snapshot:true,table_count:expectedNames(versionName).length,object_bytes_proven:false,encryption_proven:false};
 }finally{if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('complete-application-private-'))fail('CLEANUP_PATH');fs.rmSync(dir,{recursive:true,force:true});}
}
function reconstruct(bytes,hmacInput){return require('./track-b-recovery-package').reconstructCompleteApplicationSql(bytes,hmacInput);}
module.exports={FORMAT,INVENTORY_SHA256,expectedNames,catalogSql,dependencySql,captureRows,encode,read,sections,capture,reconstruct};
