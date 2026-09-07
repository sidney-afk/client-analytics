// Actual PostgreSQL proof of the new standalone catalog owner. Synthetic rows
// only; no business-schema stand-ins and no installed/serving claim.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync, spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
if(process.env.NATIVE_LABEL_SQL_CONFIRM!=='LOCAL_DISPOSABLE_ONLY')throw Error('local_disposable_confirmation_required');
const cfg = JSON.parse(fs.readFileSync(process.env.NATIVE_LABEL_PG_CONFIG, 'utf8'));
assert.equal(cfg.host, '127.0.0.1');
assert.ok(Number.isInteger(cfg.port) && cfg.port >= 1024 && cfg.port <=65535);
assert.match(cfg.database, /^native_labels_[a-z0-9_]+$/);
assert.equal(cfg.user, 'postgres');
assert(path.isAbsolute(cfg.psql)&&path.isAbsolute(cfg.createdb));
const migration = 'migrations/2026-09-05-native-label-catalog-foundation.sql';
const passwords = Object.fromEntries(['anon','authenticated','service_role'].map(r=>[r,crypto.randomBytes(32).toString('hex')]));
const env = role=>{
  const value={...process.env};for(const key of Object.keys(value))if(/^PG/i.test(key))delete value[key];
  return Object.assign(value,{PGHOST:cfg.host,PGPORT:String(cfg.port),PGUSER:role,PGPASSWORD:role==='postgres'?cfg.password:passwords[role],PGDATABASE:cfg.database,PGCONNECT_TIMEOUT:'5',PGCLIENTENCODING:'UTF8',PGOPTIONS:'-c statement_timeout=15000'});
};
const args = ['-X','-w','-qAt','-v','ON_ERROR_STOP=1'];
const quote = s=>"'"+String(s).replace(/'/g,"''")+"'";
const json = v=>quote(JSON.stringify(v))+'::jsonb';
let checks=0; const cases=[];
function sql(s,role='service_role',expected=null){
  const r=spawnSync(cfg.psql,args,{input:s,env:env(role),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
  if(expected){assert.notEqual(r.status,0);assert.ok((r.stderr||'').includes(expected),'wrong refusal classification');return null;}
  assert.equal(r.status,0,'local PostgreSQL command refused; inspect synthetic query locally');return r.stdout.trim();
}
const parsed=s=>JSON.parse(sql(s));
function pass(name){checks++;cases.push(name);}
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const label=(n,team=null,extra={})=>({id:uuid(n),name:'Synthetic label '+n,color:'#abcdef',description:null,archivedAt:null,isGroup:false,team:team?{id:team}:null,...extra});
const manifest=nodes=>({schema_version:1,capture_id:uuid(800),source_kind:'linear_workspace_issue_labels',source_sha256:'a'.repeat(64),workspace_fingerprint:'b'.repeat(64),captured_at:'2026-09-05T12:00:00Z',include_archived:true,teams:{video:uuid(900),graphics:uuid(901)},expected_count:nodes.length,pages:[{after:null,nodes,pageInfo:{hasNextPage:false,endCursor:null}}]});
const copy=v=>JSON.parse(JSON.stringify(v));
const stage=(id,m)=>`select public.production_label_catalog_stage(${quote(id)}::uuid,${json(m)});`;
const read=(id,team='video')=>`select public.production_label_catalog_read_version(${quote(id)}::uuid,${quote(team)});`;
const validate=(id,selected,ids,team='video')=>`select public.production_label_catalog_validate_selection(${quote(id)}::uuid,${quote(team)},${json(selected)},${json(ids)});`;
async function concurrently(s){
  return new Promise(resolve=>{const p=spawn(cfg.psql,args,{env:env('service_role'),windowsHide:true});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',status=>resolve({status,out,err}));p.stdin.end(s);});
}
(async()=>{
  // A new isolated database only: existing database refusal stops the proof.
  const created=spawnSync(cfg.createdb,['-w','--maintenance-db','postgres','--host',cfg.host,'--port',String(cfg.port),'--username',cfg.user,cfg.database],{env:env('postgres'),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  assert.equal(created.status,0,'new proof database must not already exist');
  sql(Object.entries(passwords).map(([r,p])=>`create role ${r} login password ${quote(p)};`).join('\n'),'postgres');
  sql(fs.readFileSync(path.join(root,migration),'utf8'),'postgres');pass('actual additive migration applies with only PostgreSQL roles as prerequisites');
  const all=[label(1),label(2,uuid(900)),label(3,uuid(901)),label(4,uuid(902)),label(5,null,{isGroup:true}),label(6,null,{archivedAt:'2026-09-01T12:00:00Z'})];
  const m=manifest(all),id=uuid(700),receipt=parsed(stage(id,m));
  assert.equal(receipt.verification_state,'structure_validated_only');assert.equal(receipt.native_activation_allowed,false);assert.equal(receipt.native_commit_allowed,false);assert.match(receipt.manifest_sha256,/^[a-f0-9]{64}$/);pass('valid full metadata stages without activation or completeness claim');
  assert.deepEqual(parsed(stage(id,m)),receipt);pass('identical version replay preserves original staged receipt');
  const changed=copy(m);changed.pages[0].nodes[0].name='Changed';sql(stage(id,changed),'service_role','label_catalog_version_conflict');pass('same version changed intent refuses');
  assert.deepEqual(JSON.parse(sql(`select manifest from public.production_label_catalog_versions where version_id=${quote(id)};`,'postgres')),m);pass('full archived/group/foreign metadata preserved exactly');
  for(const team of ['video','graphics']){const r=parsed(read(id,team));assert.equal(r.structure_complete,true);assert.equal(r.provider_completeness_verified,false);assert.deepEqual(r.catalog.map(x=>x.id),[uuid(1),uuid(team==='video'?2:3)]);pass(team+' global and team scope exclude groups/archived/other teams');}
  sql(read(id,'unknown'),'service_role','label_catalog_team_invalid');pass('unknown requested team refuses');
  sql(read(uuid(799)),'service_role','label_catalog_version_unavailable');pass('missing version refuses instead of empty catalog');
  const empty=uuid(701);parsed(stage(empty,manifest([])));assert.deepEqual(parsed(read(empty)).catalog,[]);assert.equal(parsed(read(empty)).provider_completeness_verified,false);pass('known structurally empty is explicit but never certified provider-complete');
  const paged=manifest([label(20),label(21)]);paged.pages=[{after:null,nodes:[label(20)],pageInfo:{hasNextPage:true,endCursor:'synthetic-cursor'}},{after:'synthetic-cursor',nodes:[label(21)],pageInfo:{hasNextPage:false,endCursor:null}}];
  parsed(stage(uuid(702),paged));assert.equal(parsed(read(uuid(702))).catalog.length,2);pass('multiple pages retain the complete declared set');
  const bad=[];
  const fault=(name,base,mutate,error)=>{const x=copy(base);mutate(x);bad.push({name,m:x,error});};
  fault('missing expected count',m,x=>delete x.expected_count,'label_catalog_manifest_invalid');
  fault('mismatched count',m,x=>x.expected_count++,'label_catalog_count_mismatch');
  fault('duplicate across pages',paged,x=>x.pages[1].nodes=[label(20)],'label_catalog_duplicate_identity');
  fault('missing page',paged,x=>x.pages.pop(),'label_catalog_page_incomplete');
  fault('repeated cursor',paged,x=>x.pages[1].pageInfo.endCursor='synthetic-cursor','label_catalog_page_incomplete');
  fault('wrong continuation cursor',paged,x=>x.pages[1].after='other','label_catalog_page_invalid');
  fault('missing terminal boolean',m,x=>delete x.pages[0].pageInfo.hasNextPage,'label_catalog_page_invalid');
  fault('missing source hash',m,x=>delete x.source_sha256,'label_catalog_manifest_invalid');
  fault('archive scope omitted',m,x=>delete x.include_archived,'label_catalog_manifest_invalid');
  fault('same mapping for both teams',m,x=>x.teams.graphics=x.teams.video,'label_catalog_manifest_invalid');
  fault('invalid mapping',m,x=>x.teams.video='unknown','label_catalog_manifest_invalid');
  fault('missing applicability metadata',m,x=>delete x.pages[0].nodes[3].team,'label_catalog_label_invalid');
  fault('empty foreign team is not global',m,x=>x.pages[0].nodes[3].team={},'label_catalog_team_invalid');
  fault('invalid archived label metadata still refuses',m,x=>delete x.pages[0].nodes[5].color,'label_catalog_label_invalid');
  fault('invalid group metadata still refuses',m,x=>delete x.pages[0].nodes[4].name,'label_catalog_label_invalid');
  fault('duplicate hidden foreign identity',m,x=>x.pages[0].nodes[3].id=x.pages[0].nodes[2].id,'label_catalog_duplicate_identity');
  fault('oversized page',m,x=>{x.pages[0].nodes=Array.from({length:101},(_,i)=>label(i+1000));x.expected_count=101;},'label_catalog_page_incomplete');
  for(const [i,b] of bad.entries()){sql(stage(uuid(2000+i),b.m),'service_role',b.error);pass(b.name+' fails before staging');}
  assert.equal(Number(sql('select count(*) from public.production_label_catalog_versions;','postgres')),3);pass('all invalid stage transactions leave no residue');
  const historical=all.filter(x=>[4,6].map(uuid).includes(x.id)).map(({id,name,color,description})=>({id,name,color,description}));
  const kept=parsed(validate(id,historical,[uuid(6),uuid(1),uuid(4)]));assert.deepEqual(kept.selected_label_ids,[uuid(1),uuid(4),uuid(6)]);assert.equal(kept.native_commit_allowed,false);assert.equal(kept.validation_only,true);pass('selected archived and foreign history may be retained with canonical UUID ordering');
  for(const n of [3,4,5,6,999]){sql(validate(id,[],[uuid(n)]),'service_role','label_not_applicable');pass('unselected inapplicable identity '+n+' cannot be newly added');}
  assert.deepEqual(parsed(validate(id,historical,[])).selected_labels,[]);pass('empty replacement removes historical selections without deleting catalog history');
  sql(validate(id,[],[uuid(1),uuid(1)]),'service_role','invalid_label_ids');pass('duplicate requested identities refuse');
  sql(validate(id,[],[' '+uuid(1)]),'service_role','invalid_label_ids');pass('noncanonical request identity refuses');
  sql(validate(id,[...historical,historical[0]],[]),'service_role','native_label_state_incomplete');pass('incomplete selected relation refuses');
  const stale=[{id:uuid(1),name:'Stale name',color:'#123456',description:null}];assert.equal(parsed(validate(id,stale,[uuid(1)])).selected_labels[0].name,all[0].name);pass('active catalog metadata wins without identity change');
  for(const role of ['anon','authenticated']){
    for(const query of ['select * from public.production_label_catalog_versions;',stage(uuid(3000),m),read(id),validate(id,[],[])])sql(query,role,'permission denied');pass(role+' cannot read data or execute staging/validation');
  }
  for(const query of ['select * from public.production_label_catalog_versions;',`delete from public.production_label_catalog_versions where version_id=${quote(id)};`,`insert into public.production_label_catalog_versions(version_id,schema_version,manifest,manifest_sha256) values(${quote(uuid(3001))},1,${json(m)},${quote('a'.repeat(64))});`])sql(query,'service_role','permission denied');pass('service role has RPC-only access, not direct table read/write');
  for(const query of [`update public.production_label_catalog_versions set manifest=${json(changed)} where version_id=${quote(id)};`,`delete from public.production_label_catalog_versions where version_id=${quote(id)};`,'truncate public.production_label_catalog_versions;'])sql(query,'postgres','label_catalog_immutable');pass('ordinary owner update/delete/truncate refuse immutable evidence loss');
  for(const query of [`select public.production_label_catalog_activate(${quote(id)});`,`select public.production_label_catalog_read_active('video');`])sql(query,'service_role','label_catalog_activation_held');pass('service credentials cannot activate or obtain an active catalog');
  const concurrentId=uuid(7020);const identical=await Promise.all([concurrently(stage(concurrentId,m)),concurrently(stage(concurrentId,m))]);assert.ok(identical.every(x=>x.status===0));assert.deepEqual(JSON.parse(identical[0].out),JSON.parse(identical[1].out));pass('concurrent identical stages conserve one version and receipt');
  const raceId=uuid(7021);const raced=await Promise.all([concurrently(stage(raceId,m)),concurrently(stage(raceId,changed))]);assert.equal(raced.filter(x=>x.status===0).length,1);assert.ok(raced.find(x=>x.status!==0).err.includes('label_catalog_version_conflict'));pass('concurrent conflicting stages accept exactly one immutable manifest');
  assert.equal(Number(sql(`select count(*) from public.production_label_catalog_versions where version_id in (${quote(concurrentId)},${quote(raceId)});`,'postgres')),2);pass('concurrent stages do not duplicate identities');
  const report={status:'PASS',checks,cases,source_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,migration))).digest('hex'),proof:'actual disposable PostgreSQL with synthetic catalogs and distinct authenticated roles; no provider completeness, installed schema, serving, native activation, commits, backup or recovery claim'};
  if(process.env.NATIVE_LABEL_SQL_REPORT)fs.writeFileSync(process.env.NATIVE_LABEL_SQL_REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
})().catch(error=>{
  if(process.env.NATIVE_LABEL_SQL_REPORT)fs.writeFileSync(process.env.NATIVE_LABEL_SQL_REPORT+'.failure.private.json',JSON.stringify({status:'FAIL',checks,cases,error:String(error.stack)},null,2)+'\n');
  console.error('Native label catalog local SQL proof FAILED; no sensitive query/connection output emitted.');process.exitCode=1;
});
