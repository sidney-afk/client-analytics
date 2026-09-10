'use strict';

// Private evidence acquisition, NOT a native completeness verdict. No HTTP or
// arbitrary SQL input. This first lane accepts explicitly owned local fixtures.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const LIMIT = 50000;
const MAX_BYTES = 64 * 1024 * 1024;
const SOURCE_FILES = [
  'index.html', 'supabase/functions/workload-plan/index.ts',
  'supabase/functions/workload-plan/native-snapshot.mjs',
  'migrations/2026-09-05-workload-native-membership.sql',
  'migrations/2026-09-02-workload-native-view.sql',
  'migrations/2026-07-23-f34-f53-production-attachments.sql',
  'qa/workload-consistency/native-capture.js',
];
const SECTIONS = {
  deliverables: {key:'id', columns:'id,batch_id,client_slug,team,kind,status,assignee_id,due_date,created_at,updated_at,sort_key,linear_issue_uuid,linear_identifier,identifier,title,linear_raw,sync_state'},
  batches: {key:'id', columns:'id,client_slug,name,status,team,linear_parent_ids,created_at,updated_at,sort_key'},
  clients: {key:'slug', columns:'slug,display_name,active,kind'},
  team_members: {key:'id', columns:'id,name,role,team,active,linear_user_id'},
  workload_plan: {key:'issue_id', columns:'issue_id,client,plan_date,updated_at'},
  syncview_runtime_flags: {key:'key', columns:'key,value', filter:" where key='prod_authority'"},
  workload_issues: {key:'id', columns:'*'},
  workload_issues_native_v1: {key:'id', columns:'*'},
  production_deliverables_browser_v1: {key:'id', columns:'id,workload_labels_complete,workload_labels'},
};
const FUNCTIONS = ['workload_native_snapshot_v1()', 'production_workload_label_projection(jsonb)'];
const fail = code => {throw new Error(code);};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const lit = value => "'" + String(value).replaceAll("'", "''") + "'";
const digest = value => sha(stable(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function safeEnv(password) {
  return {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key))),
    PGPASSWORD:password, PGCLIENTENCODING:'UTF8'};
}
function privatePath(filename, mustExist = false) {
  if (!path.isAbsolute(filename || '')) fail('private_absolute_path_required');
  const absolute = path.resolve(filename);
  const resolved = fs.existsSync(absolute) ? fs.realpathSync(absolute)
    : path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
  for (let current = path.dirname(resolved);; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current,'.git'))) fail('private_path_inside_git');
    if (current === path.dirname(current)) break;
  }
  if (mustExist && !fs.statSync(resolved).isFile()) fail('private_file_required');
  return resolved;
}
function config(value) {
  if (!plain(value) || value.confirmation !== 'LOCAL_DISPOSABLE_ONLY') fail('explicit_disposable_confirmation_required');
  if (!['127.0.0.1','::1'].includes(value.host) || !/^\d+$/.test(String(value.port))
      || Number(value.port) < 1024 || Number(value.port) > 65535) fail('explicit_loopback_port_required');
  if (!/^card_history_[a-z0-9_]+$/.test(value.database || '')
      || !/^(postgres|workload_capture_[a-z0-9_]+)$/.test(value.user || '')) fail('disposable_database_identity_required');
  if (!path.isAbsolute(value.psql || '') || !fs.statSync(value.psql).isFile()) fail('absolute_psql_required');
  if (typeof value.password !== 'string' || value.password.length < 16) fail('purpose_specific_fixture_password_required');
  return value;
}
function args(value) {
  return ['-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',value.host,'-p',String(value.port),'-U',value.user,'-d',value.database];
}
function runSqlText(value, sql, spawnProcess=spawn) {
  config(value);
  return new Promise((resolve,reject) => {
    const child = spawnProcess(value.psql,args(value), {windowsHide:true,env:safeEnv(value.password),stdio:['pipe','pipe','pipe']});
    const chunks=[]; let size=0, done=false, refusal=null;
    const stop=code => {refusal=refusal||code;child.kill();};
    const timer=setTimeout(() => stop('capture_timeout'), 45000);
    child.stdout.on('data',data => {size+=data.length;if(size>MAX_BYTES)stop('capture_output_limit');else chunks.push(data);});
    // Database diagnostics may contain private values, SQL, or connection data.
    // Drain them but never attach them to public exceptions or console output.
    child.stderr.on('data',() => {});
    child.on('error',() => {if(!done){done=true;clearTimeout(timer);reject(Error('capture_process_failed'));}});
    child.on('close',code => {
      if(done)return;done=true;clearTimeout(timer);
      if(refusal)return reject(Error(refusal));
      if(code !== 0) return reject(Error(code === 3 ? 'capture_query_or_catalog_refused' : 'capture_query_failed'));
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.on('error',() => {});
    child.stdin.end(sql);
  });
}
async function runSql(value,sql) {
  const raw=await runSqlText(value,sql);
  try{return JSON.parse(raw);}catch{fail('capture_invalid_json');}
}
function gitEnv() {
  return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key))),
    GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'};
}
function sourceBinding(expectedCommit,sourceRoot=ROOT) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || '')) fail('reviewed_source_pin_required');
  const git = argv => {
    const r=spawnSync('git',['--no-replace-objects',...argv],{cwd:sourceRoot,env:gitEnv(),windowsHide:true,timeout:10000,maxBuffer:16*1024*1024});
    if(r.status !== 0)fail('source_git_unavailable');return r.stdout;
  };
  const commit=git(['rev-parse','HEAD']).toString().trim();
  if(commit !== expectedCommit) fail('source_pin_mismatch');
  const hashes=Object.fromEntries(SOURCE_FILES.map(file => {
    const bytes=fs.readFileSync(path.join(sourceRoot,file));
    if(!bytes.equals(git(['show',commit+':'+file])))fail('source_working_file_drift');
    return [file,sha(bytes)];
  }));
  return {observed_commit:commit, observed_files:hashes, declared_reviewed_commit:expectedCommit,
    authority:'local_git_bytes_only_not_serving_or_independent_review'};
}
function catalogSql() {
  const names=Object.keys(SECTIONS).map(lit).join(',');
  const functions=FUNCTIONS.map(signature => `select ${lit(signature)} name,to_regprocedure(${lit('public.'+signature)}) oid`).join(' union all ');
  return `(select jsonb_build_object('relations', (select jsonb_agg(jsonb_build_object(
    'name',n.name,'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull) order by a.attnum)
      from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'primary_key',(select jsonb_agg(a.attname order by k.ordinality) from pg_constraint p
      cross join lateral unnest(p.conkey) with ordinality k(attnum,ordinality)
      join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum where p.conrelid=c.oid and p.contype='p'),
    'definition',case when c.relkind='v' then pg_get_viewdef(c.oid,true) else null end) order by n.name)
    from (select unnest(array[${names}]) name) n left join pg_class c on c.oid=to_regclass('public.'||n.name)),
    'functions',(select jsonb_agg(jsonb_build_object('name',f.name,'definition',pg_get_functiondef(p.oid),
      'volatile',p.provolatile,'security_definer',p.prosecdef,'config',p.proconfig) order by f.name)
      from (${functions}) f left join pg_proc p on p.oid=f.oid)))`;
}
const begin = `begin isolation level repeatable read read only;
set local statement_timeout='30000ms';set local lock_timeout='10000ms';set local row_security=off;
set local search_path=pg_catalog,public;set local timezone='UTC';set local datestyle='ISO, YMD';
set local standard_conforming_strings=on;
`;
function validateCatalog(catalog) {
  if(!plain(catalog) || !Array.isArray(catalog.relations) || !Array.isArray(catalog.functions))fail('catalog_incomplete');
  if(stable(catalog.relations.map(x=>x.name).sort())!==stable(Object.keys(SECTIONS).sort())
    ||stable(catalog.functions.map(x=>x.name).sort())!==stable([...FUNCTIONS].sort()))fail('catalog_coverage_mismatch');
  for(const relation of catalog.relations) {
    const view=relation.name.endsWith('_v1');
    if(relation.kind !== (view?'v':'r') || !Array.isArray(relation.columns)
      || (view ? typeof relation.definition !== 'string' : relation.name==='workload_issues'
        ? relation.primary_key!==null && stable(relation.primary_key)!==stable(['id'])
        : stable(relation.primary_key)!==stable([SECTIONS[relation.name].key])))fail('catalog_relation_contract');
    const required=SECTIONS[relation.name].columns.split(',');
    if(required[0]!=='*' && required.some(name=>!relation.columns.some(c=>c.name===name)))fail('catalog_column_missing');
  }
  for(const func of catalog.functions)if(typeof func.definition!=='string'||!['s','i'].includes(func.volatile))fail('catalog_function_contract');
}
async function inspectCatalog(value) {
  const catalog=await runSql(value,begin+'select '+catalogSql()+';\nrollback;\n');
  validateCatalog(catalog);return catalog;
}
function captureSql(captureId, expectedCatalog) {
  validateCatalog(expectedCatalog);
  const sections=Object.entries(SECTIONS).map(([name,s]) => {
    const filter=s.filter||'';
    return `${lit(name)}, (select jsonb_build_object('count',(select count(*) from public.${name}${filter}),
      'rows_json',v.value::text,'rows_bytes',octet_length(convert_to(v.value::text,'UTF8')),
      'rows_sha256',encode(sha256(convert_to(v.value::text,'UTF8')),'hex'))
      from (select coalesce(jsonb_agg(to_jsonb(r) order by r.${s.key}::text),'[]'::jsonb) value
        from (select ${s.columns} from public.${name}${filter} order by ${s.key}::text limit ${LIMIT+1}) r) v)`;
  }).join(',\n');
  // The approved catalog is checked before the observed RPC can execute. Both
  // this check and every following read use this one transaction's snapshot.
  return begin+`select (${catalogSql()} = ${lit(stable(expectedCatalog))}::jsonb) as catalog_matches \\gset
\\if :catalog_matches
select jsonb_build_object('contract','workload-native-private-capture-v1','capture_id',${lit(captureId)},
  'database',jsonb_build_object('name',current_database(),'user',current_user,'address',host(inet_server_addr()),'port',inet_server_port()),
  'transaction',jsonb_build_object('snapshot',pg_current_snapshot()::text,'isolation',current_setting('transaction_isolation'),
    'read_only',current_setting('transaction_read_only'),'started_at',transaction_timestamp(),'observed_at',clock_timestamp()),
  'catalog',${catalogSql()},'sections',jsonb_build_object(${sections}),
  'native_snapshot',public.workload_native_snapshot_v1());
select ${catalogSql()};
rollback;
\\else
rollback;
select 1/0;
\\endif
`;
}
function validateBody(body, expected) {
  if(!plain(body)||body.contract!=='workload-native-private-capture-v1'
      ||!/^[-a-f0-9]{36}$/.test(body.capture_id||'')||!plain(body.sections))fail('capture_envelope_invalid');
  if(body.database?.name!==expected.database||body.database?.user!==expected.user
    ||body.database?.address!==expected.host||body.database?.port!==Number(expected.port))fail('observed_database_mismatch');
  if(body.transaction?.isolation!=='repeatable read'||body.transaction?.read_only!=='on'
    ||!/^\d+:\d+:[\d,]*$/.test(body.transaction.snapshot||'')
    ||!Number.isFinite(Date.parse(body.transaction.started_at))||!Number.isFinite(Date.parse(body.transaction.observed_at)))fail('snapshot_binding_invalid');
  validateCatalog(body.catalog);
  if(digest(body.catalog)!==expected.catalog_sha256)fail('observed_catalog_mismatch');
  if(stable(Object.keys(body.sections).sort())!==stable(Object.keys(SECTIONS).sort()))fail('capture_section_missing');
  const decoded={};
  for(const [name,spec] of Object.entries(SECTIONS)) {
    const part=body.sections[name];
    if(!plain(part)||!Number.isSafeInteger(part.count)||part.count<0||part.count>LIMIT
      ||typeof part.rows_json!=='string'||Buffer.byteLength(part.rows_json)!==part.rows_bytes
      ||sha(part.rows_json)!==part.rows_sha256)fail('capture_count_or_content_mismatch');
    let rows;try{rows=JSON.parse(part.rows_json);}catch{fail('capture_rows_invalid');}
    if(!Array.isArray(rows)||rows.length!==part.count)fail('capture_count_mismatch');
    decoded[name]=rows;
    const ids=new Set();
    const columns=spec.columns==='*'?body.catalog.relations.find(r=>r.name===name).columns.map(c=>c.name):spec.columns.split(',');
    for(const row of rows){const id=row?.[spec.key];if(!plain(row)||typeof id!=='string'||!id.trim()||ids.has(id))fail('capture_identity_invalid');ids.add(id);
      if(stable(Object.keys(row).sort())!==stable([...columns].sort()))fail('capture_row_columns_invalid');}
  }
  const flag=body.sections.syncview_runtime_flags;
  const authority=decoded.syncview_runtime_flags[0];
  if(flag.count!==1||authority.key!=='prod_authority'
    ||!['video','graphics'].every(team=>['linear','syncview'].includes(authority.value?.[team])))fail('capture_authority_invalid');
  const snapshot=body.native_snapshot;
  if(!plain(snapshot)||snapshot.ok!==true||snapshot.complete!==true||snapshot.contract!=='workload-native-snapshot-v1'
    ||!Array.isArray(snapshot.rows)||!Array.isArray(snapshot.plans)||!Number.isSafeInteger(snapshot.count)
    ||snapshot.count!==snapshot.rows.length||snapshot.count>LIMIT||snapshot.plans.length>LIMIT
    ||digest(snapshot.authority)!==digest(authority.value))fail('captured_rpc_invalid');
  const unique=rows=>rows.every(r=>plain(r)&&typeof r.id==='string'&&r.id.trim())&&new Set(rows.map(r=>r.id)).size===rows.length;
  if(!unique(snapshot.rows))fail('captured_rpc_identity_invalid');
  if(digest(snapshot.plans)!==digest(decoded.workload_plan))fail('captured_plan_content_mismatch');
}
function seal(body, key) {
  if(!/^[a-f0-9]{64}$/.test(key||''))fail('private_integrity_key_required');
  const encoded=stable(body);
  return {format:'workload-capture-hmac-v1',body,body_sha256:sha(encoded),
    hmac_sha256:crypto.createHmac('sha256',Buffer.from(key,'hex')).update(encoded).digest('hex')};
}
function verify(packet, key, expected) {
  if(!plain(packet)||packet.format!=='workload-capture-hmac-v1')fail('packet_format_invalid');
  const signed=seal(packet.body,key);
  if(packet.body_sha256!==signed.body_sha256||packet.hmac_sha256!==signed.hmac_sha256)fail('packet_integrity_mismatch');
  if(typeof packet.body.raw_database_json!=='string'||Buffer.byteLength(packet.body.raw_database_json)>MAX_BYTES)fail('packet_raw_content_invalid');
  let observed;try{observed=JSON.parse(packet.body.raw_database_json);}catch{fail('capture_invalid_json');}
  validateBody(observed,expected);
  let after;try{after=JSON.parse(packet.body.raw_catalog_after_json);}catch{fail('catalog_after_invalid');}
  validateCatalog(after);
  if(digest(after)!==expected.catalog_sha256)fail('observed_catalog_after_mismatch');
  if(digest(packet.body.source)!==expected.source_sha256||packet.body.query_sha256!==expected.query_sha256
    ||packet.body.declared_catalog_sha256!==expected.catalog_sha256)fail('packet_binding_mismatch');
  return {classification:'ISOLATED_POSTGRES',capture_valid:true,populationVerdict:'UNPROVEN',
    body_sha256:packet.body_sha256,catalog_sha256:expected.catalog_sha256,
    raw_database_sha256:sha(packet.body.raw_database_json),
    counts:Object.fromEntries(Object.entries(observed.sections).map(([name,s])=>[name,s.count])),
    snapshot_rows:observed.native_snapshot.count,
    executable_binding:'UNPROVEN_requires_independent_DDL_quiescence_and_serving_closure',
    native_comparison:'NOT_IMPLEMENTED',
    provenance:'supplied_key_integrity_local_observations_not_trusted_serving_attestation'};
}
async function capture(value, reviewedCatalog, expectedCommit, key) {
  config(value);validateCatalog(reviewedCatalog);
  const source=sourceBinding(expectedCommit),id=crypto.randomUUID(),sql=captureSql(id,reviewedCatalog);
  const expected={database:value.database,user:value.user,host:value.host,port:Number(value.port),
    catalog_sha256:digest(reviewedCatalog),source_sha256:digest(source),query_sha256:sha(sql)};
  const transcript=await runSqlText(value,sql);
  const lines=transcript.trimEnd().split(/\r?\n/);
  if(lines.length!==2)fail('capture_transcript_incomplete');
  const raw=lines[0]+'\n',after=lines[1]+'\n';
  let observed;try{observed=JSON.parse(raw);}catch{fail('capture_invalid_json');}
  if(observed.capture_id!==id)fail('capture_identity_mismatch');
  // Preserve the exact PostgreSQL JSON bytes, including numeric lexemes too
  // large for JavaScript Number. Parsed values serve validation only; future
  // comparator adapters must use a lossless parser for numeric row content.
  const body={raw_database_json:raw,raw_catalog_after_json:after,source,query_sha256:expected.query_sha256,
    declared_catalog_sha256:expected.catalog_sha256};
  const packet=seal(body,key);const summary=verify(packet,key,expected);
  return {packet,expected,summary};
}
async function main(argv=process.argv.slice(2)) {
  if(argv.length!==2)fail('usage_private_config_private_output');
  const input=privatePath(argv[0],true),output=privatePath(argv[1]);
  if(fs.existsSync(output))fail('private_output_exists');
  const cfg=JSON.parse(fs.readFileSync(input,'utf8'));
  const result=await capture(cfg.connection,cfg.reviewed_catalog,cfg.reviewed_commit,cfg.integrity_key);
  // Exclusive creation preserves every previous receipt, including refusals.
  fs.writeFileSync(output,stable({packet:result.packet,expected:result.expected})+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify(result.summary)+'\n');
}
if(require.main===module)main().catch(error=>{process.stdout.write(JSON.stringify({capture_valid:false,populationVerdict:'UNPROVEN',code:
  /^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'capture_refused'})+'\n');process.exitCode=1;});
module.exports={ROOT,LIMIT,SECTIONS,SOURCE_FILES,config,args,safeEnv,gitEnv,privatePath,sourceBinding,catalogSql,validateCatalog,
  inspectCatalog,captureSql,validateBody,seal,verify,capture,runSql,runSqlText,sha,digest,stable};
