'use strict';
// Adapter for the existing PR1279 comparator, not a new population scanner.
// All inputs are private capture packets; this module performs no SQL or HTTP.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const capture=require('./native-capture'),exact=require('./lossless-json');
const {compare}=require('./compare'),harness=require('./source-harness');
const ROOT=capture.ROOT,own=(x,k)=>Object.hasOwn(x,k),obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&!(x instanceof exact.ExactNumber);
const fail=code=>{throw Error(code);};
// PostgreSQL btrim(text) removes ASCII spaces by default, not JS whitespace.
const trim=x=>typeof x==='string'?x.replace(/^ +| +$/g,''):'';
const TEAM={video:['VID','Video','editor'],graphics:['GRA','Graphics','designer']};
const STATUS={triage:['Triage','triage'],backlog:['Backlog','backlog'],todo:['Todo','unstarted'],in_progress:['In Progress','started'],
 smm_approval:['For SMM approval','started'],kasper_approval:['For Kasper approval','started'],client_approval:['For Client approval','started'],
 tweak:['Tweak Needed','started'],approved:['Approved','completed'],scheduled:['Scheduled','completed'],posted:['Posted','completed'],canceled:['Canceled','canceled'],duplicate:['Duplicate','duplicate']};
const ADAPTER_FILES=['qa/workload-consistency/native-adapter.js','qa/workload-consistency/compare.js','qa/workload-consistency/source-harness.js',
 'qa/workload-consistency/lossless-json.js','supabase/functions/linear-outbound/mapping.mjs','test/helpers/extract-function.js'];
function git(argv){const r=spawnSync('git',['--no-replace-objects',...argv],{cwd:ROOT,windowsHide:true,env:capture.gitEnv(),timeout:10000,maxBuffer:16*1024*1024});if(r.status!==0)fail('LOCAL_SOURCE_OBJECT_UNAVAILABLE');return r.stdout;}
function sourceProof(result,reviewedAdapterCommit){
  const current=capture.sourceBinding(reviewedAdapterCommit),recorded=result.packet.body.source;
  if(!recorded||!/^[a-f0-9]{40}$/.test(recorded.observed_commit||'')||recorded.observed_commit!==recorded.declared_reviewed_commit)fail('CAPTURE_SOURCE_PIN_INVALID');
  git(['cat-file','-e',recorded.observed_commit+'^{commit}']);
  if(capture.stable(current.observed_files)!==capture.stable(recorded.observed_files))fail('CAPTURE_SOURCE_BYTES_CHANGED');
  for(const [file,hash] of Object.entries(recorded.observed_files))if(capture.sha(git(['show',recorded.observed_commit+':'+file]))!==hash)fail('CAPTURE_SOURCE_OBJECT_MISMATCH');
  const files=Object.fromEntries(ADAPTER_FILES.map(file=>{const bytes=fs.readFileSync(path.join(ROOT,file));if(!bytes.equals(git(['show',reviewedAdapterCommit+':'+file])))fail('ADAPTER_SOURCE_DRIFT');return[file,capture.sha(bytes)];}));
  const sql=fs.readFileSync(path.join(ROOT,'migrations/2026-09-02-workload-native-view.sql'),'utf8');
  for(const [key,[name,type]] of Object.entries(STATUS)){
    if(!new RegExp("when '"+key+"'\\s+then '"+name+"'").test(sql)||!new RegExp("when '"+key+"'\\s+then '"+type+"'").test(sql))fail('STATUS_SOURCE_MAPPING_DRIFT');
    if(harness.workStatus[key]!==name)fail('NORMALIZED_STATUS_MAPPING_DRIFT');
  }
  return {adapter_commit:reviewedAdapterCommit,capture_commit:recorded.observed_commit,adapter_files:files,serving:'UNPROVEN'};
}
function decode(result,key,reviewedAdapterCommit){
  const verified=capture.verify(result.packet,key,result.expected),source=sourceProof(result,reviewedAdapterCommit);
  const raw=JSON.parse(result.packet.body.raw_database_json),sections=Object.fromEntries(Object.entries(raw.sections).map(([name,s])=>[name,exact.parse(s.rows_json)]));
  if(capture.sha(capture.captureSql(raw.capture_id,raw.catalog))!==result.expected.query_sha256)fail('CAPTURE_QUERY_SOURCE_MISMATCH');
  return {raw,sections,snapshot:exact.parse(result.packet.body.raw_database_json).native_snapshot,source,verified};
}
function labels(raw){
  const bad={complete:false,labels:[]};
  if(!obj(raw)||!obj(raw.issue)||!obj(raw.issue.labels)||!Array.isArray(raw.issue.labels.nodes)||!obj(raw.issue.labels.pageInfo)
    ||raw.issue.labels.pageInfo.hasNextPage!==false||raw.issue.labels.nodes.length>250)return bad;
  const ids=new Set(),names=new Set(),chosen=[];
  for(const node of raw.issue.labels.nodes){
    if(!obj(node))return bad;
    // SQL ->> also stringifies non-string scalars/objects. Those unusual input
    // shapes are explicitly held rather than approximated by JS coercion.
    if((node.id!=null&&typeof node.id!=='string')||(node.name!=null&&typeof node.name!=='string'))fail('LABEL_SCALAR_SHAPE_UNREPRESENTED');
    const id=trim(node.id),name=trim(node.name);
    if(!id||id.length>200||!name||name.length>200||ids.has(id)||names.has(name))return bad;
    ids.add(id);names.add(name);
    if(['2× Workload','3× Workload'].includes(name))chosen.push({id,name,color:typeof node.color==='string'&&/^#[0-9a-f]{6}$/i.test(node.color)?node.color.toUpperCase():null});
  }
  if(own(raw.issue,'labelIds')){
    const selected=raw.issue.labelIds;
    if(!Array.isArray(selected)||selected.length>250||selected.some(v=>typeof v!=='string'||!trim(v)||trim(v).length>200))return bad;
    const set=new Set(selected.map(trim));if(set.size!==selected.length||set.size!==ids.size||[...set].some(v=>!ids.has(v)))return bad;
  }
  return {complete:true,labels:chosen};
}
function timestamp(value){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail('BASE_TIMESTAMP_INVALID');return new Date(value).toISOString().replace(/\.\d{3}Z$/,'Z');}
function day(value){if(value===null)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('BASE_DATE_INVALID');return value;}
function container(d,b){
  const parents=obj(b.linear_parent_ids)?Object.values(b.linear_parent_ids):[];
  const matched=d.linear_issue_uuid!==null&&parents.some(v=>(obj(v)?v.uuid:typeof v==='string'?v:null)===d.linear_issue_uuid);
  const parent=obj(d.linear_raw)&&obj(d.linear_raw.issue)&&obj(d.linear_raw.issue.parent)?d.linear_raw.issue.parent.id:null;
  if(parent!=null&&typeof parent!=='string')fail('CONTAINER_PARENT_SHAPE_UNREPRESENTED');
  return matched||(d.id.startsWith('b1_')&&!trim(parent));
}
function derive(sections){
  const maps={};for(const [name,key] of [['deliverables','id'],['batches','id'],['clients','slug'],['team_members','id']])maps[name]=new Map(sections[name].map(r=>[r[key],r]));
  const authority=sections.syncview_runtime_flags[0].value;
  const view=[],rpc=[],metadata=[],containers=new Set(),byBatch=new Map();
  for(const d of sections.deliverables){
    const b=maps.batches.get(d.batch_id),c=maps.clients.get(d.client_slug),m=maps.team_members.get(d.assignee_id);
    if(!b||!c||b.client_slug!==d.client_slug)fail('BASE_WORK_SCOPE_UNRESOLVED');
    if(!TEAM[d.team]||!STATUS[d.status]||typeof c.active!=='boolean'||typeof d.title!=='string'||(d.assignee_id!==null&&!m))fail('BASE_WORK_FIELDS_UNPROVEN');
    if(m&&(typeof m.active!=='boolean'||typeof m.name!=='string'||typeof m.role!=='string'||typeof m.team!=='string'))fail('BASE_MEMBER_FIELDS_UNPROVEN');
    if(!byBatch.has(b.id))byBatch.set(b.id,[]);byBatch.get(b.id).push(d);
    const projection=labels(d.linear_raw);metadata.push({id:d.id,workload_labels_complete:projection.complete,workload_labels:projection.labels});
    if(container(d,b)){containers.add(d.id);continue;}
    const row={id:d.id,linear_id:d.linear_issue_uuid,identifier:d.linear_identifier??d.identifier,title:d.title,
      is_sub_issue:true,parent_id:b.id,linear_parent_ids:b.linear_parent_ids,parent_identifier:b.name,due_date:day(d.due_date),
      linear_created_at:timestamp(d.created_at),linear_updated_at:timestamp(d.updated_at),synced_at:null,
      status:STATUS[d.status][0],status_type:STATUS[d.status][1],team_key:TEAM[d.team][0],team_name:TEAM[d.team][1],
      assignee_id:m?.linear_user_id??d.assignee_id,native_assignee_id:d.assignee_id,assignee_name:m?.name??null,
      client_name:c.display_name,client_slug:d.client_slug,active:b.status!=='archived',native_sort_key:d.sort_key,native_kind:d.kind,native_sync_state:d.sync_state};
    view.push(row);
    if(row.active&&authority[d.team]==='syncview')rpc.push({...row,source:'native',native_client_active:c.active,
      native_assignee_eligible:!!(m&&m.active&&m.team===d.team&&m.role===TEAM[d.team][2]),native_metadata:{id:d.id,client_slug:d.client_slug,team:d.team,
        due_date:d.due_date,updated_at:d.updated_at,workload_labels_complete:projection.complete,workload_labels:projection.labels}});
  }
  for(const [id,children] of byBatch){
    const b=maps.batches.get(id),c=maps.clients.get(b.client_slug);if(!c)fail('BASE_BATCH_CLIENT_UNRESOLVED');
    const teams=[...new Set(children.map(d=>d.team))],team=teams.length===1?TEAM[teams[0]]:null;
    const row={id:b.id,linear_id:null,identifier:b.name,title:b.name,is_sub_issue:false,parent_id:null,linear_parent_ids:b.linear_parent_ids,
      parent_identifier:null,due_date:null,linear_created_at:timestamp(b.created_at),linear_updated_at:timestamp(b.updated_at),synced_at:null,
      status:null,status_type:null,team_key:team?.[0]??null,team_name:team?.[1]??null,assignee_id:null,native_assignee_id:null,assignee_name:null,
      client_name:c.display_name,client_slug:b.client_slug,active:b.status!=='archived',native_sort_key:b.sort_key,native_kind:null,native_sync_state:null};
    view.push(row);
    if(row.active&&children.some(d=>authority[d.team]==='syncview'))rpc.push({...row,source:'native',native_client_active:c.active,native_assignee_eligible:false,native_metadata:null});
  }
  // Legacy rows are retained only to validate exact plan alias ownership. Their
  // mirror content is never treated as an independent provider denominator.
  for(const w of sections.workload_issues){
    if(w.active!==true)continue;const team=w.team_key==='VID'?'video':w.team_key==='GRA'?'graphics':null;
    if(team&&authority[team]!=='linear')continue;
    const owners=view.filter(n=>n.is_sub_issue&&n.linear_id===w.id);
    if(owners.length>1)fail('PLAN_ALIAS_AMBIGUOUS');
    rpc.push({...w,source:'legacy',native_plan_id:owners[0]?.id??null,native_plan_client_name:owners[0]?.client_name??null});
  }
  return {view,rpc,metadata,containers,maps,authority};
}
function collector(){const counts={},findings=[],refs=new Map();return {counts,findings,add(code,row){counts[code]=(counts[code]||0)+1;if(!refs.has(row))refs.set(row,'r'+String(refs.size+1).padStart(4,'0'));findings.push({code,ref:refs.get(row)});}};}
function compareRows(expected,actual,label,report,ignored=[]){
  const seen=new Set(),byId=new Map();
  for(const row of actual){if(!row||typeof row.id!=='string'||!row.id||seen.has(row.id)){report.add(label+'_identity_invalid',row||{});continue;}seen.add(row.id);byId.set(row.id,row);}
  for(const row of expected){const found=byId.get(row.id);if(!found){report.add(label+'_missing',row);continue;}
    for(const [key,value] of Object.entries(row))if(!ignored.includes(key)&&!exact.equal(value,found[key]))report.add(label+'_field_mismatch',row);
    if(found.sort_order!==undefined)report.add(label+'_unexpected_sort_order',row);
    byId.delete(row.id);
  }
  for(const row of byId.values())report.add(label+'_extra',row);
}
function sameState(expected,actual,report){
  for(const property of ['buckets','dates','excluded','calendar','ordering'])if(capture.stable(expected[property])!==capture.stable(actual[property]))report.add('browser_'+property+'_mismatch',{});
}
async function compareCapture(result,key,options){
  if(!options||!/^\d{4}-\d{2}-\d{2}$/.test(options.today||''))fail('EXPLICIT_COMPARISON_DAY_REQUIRED');day(options.today);
  const decoded=decode(result,key,options.reviewedAdapterCommit),derived=derive(decoded.sections),report=collector();
  compareRows(derived.view,decoded.sections.workload_issues_native_v1,'native_view',report);
  compareRows(derived.metadata,decoded.sections.production_deliverables_browser_v1,'metadata',report);
  const observedNative=decoded.snapshot.rows.filter(r=>r.source==='native');
  compareRows(derived.rpc.filter(r=>r.source==='native'),observedNative,'native_rpc',report);
  const plans=exact.browserValue(decoded.sections.workload_plan);
  const {projectNativeSnapshot}=await import(pathToFileURL(path.join(ROOT,'supabase/functions/workload-plan/native-snapshot.mjs')).href);
  const normalize=harness.context(['wlNormalizeClient']).wlNormalizeClient;
  const envelope=rows=>({ok:true,complete:true,contract:'workload-native-snapshot-v1',count:rows.length,rows:exact.browserValue(rows),plans,
    authority:exact.browserValue(derived.authority),legacy_teams:[]});
  let expectedProjected,observedProjected,expectedBoard,observedBoard;
  try {
    expectedProjected=projectNativeSnapshot(envelope(derived.rpc),normalize);
    observedProjected=projectNativeSnapshot(exact.browserValue(decoded.snapshot),normalize);
    const scoped=projection=>({...projection,rows:projection.rows.filter(r=>r.source==='native'),count:projection.rows.filter(r=>r.source==='native').length,legacy_teams:[]});
    expectedBoard=await harness.nativeBoard(scoped(expectedProjected),options.today);
    observedBoard=await harness.nativeBoard(scoped(observedProjected),options.today);
    sameState(expectedBoard,observedBoard,report);
    if(capture.stable(expectedProjected.plans)!==capture.stable(observedProjected.plans))report.add('saved_plan_alias_mismatch',{});
  } catch {report.add('native_browser_or_alias_refused',{});}
  let normalized=null;
  if(expectedBoard&&observedBoard){
    const native=decoded.sections.deliverables.filter(d=>expectedBoard.visible.has(d.id)).map(d=>({id:d.id,linearId:d.linear_issue_uuid,
      kind:d.kind,scope:d.client_slug,team:d.team,status:d.status,ownerId:d.assignee_id,dueDate:d.due_date,archived:false,container:false}));
    const workload=observedBoard.issues.filter(r=>observedBoard.visible.has(r.id)).map(r=>({id:r.id,nativeId:r.id,linearId:r.linearId,kind:derived.maps.deliverables.get(r.id)?.kind,
      scope:derived.maps.deliverables.get(r.id)?.client_slug,ownerId:r.assigneeId,status:r.status,dueDate:r.dueDate,dateSemantics:'canonical_due',visible:true}));
    const members=decoded.sections.team_members.map(m=>({id:m.id,linearId:m.linear_user_id,active:m.active,teams:[m.team],roles:[['editor','designer'].includes(m.role)?'creative':m.role]}));
    normalized=compare({schema:'workload-consistency/v1',native,workload,members,provider:[],production:[],calendar:[],samples:[],expected:[],
      coverage:{native:{complete:true},workload:{complete:true},members:{complete:true}}},{scope:'native_workload',eligibility:row=>expectedBoard.visible.has(row.id)?'eligible':'excluded'});
    for(const finding of normalized.findings)if(!['native_only','legitimate_workload_exclusion'].includes(finding.code))report.add(finding.code,finding);
  }
  const nativeTeams=Object.keys(TEAM).filter(team=>derived.authority[team]==='syncview');
  const accounting={base_deliverables:decoded.sections.deliverables.length,structural_containers:derived.containers.size,
    archived_noncontainers:decoded.sections.deliverables.filter(d=>!derived.containers.has(d.id)&&derived.maps.batches.get(d.batch_id).status==='archived').length,
    provider_authority_noncontainers:decoded.sections.deliverables.filter(d=>!derived.containers.has(d.id)&&derived.maps.batches.get(d.batch_id).status!=='archived'&&derived.authority[d.team]==='linear').length,
    native_rpc_work:derived.rpc.filter(r=>r.source==='native'&&r.is_sub_issue).length,
    native_visible:expectedBoard?.visible.size??null,native_excluded:expectedBoard?derived.rpc.filter(r=>r.source==='native'&&r.is_sub_issue&&!expectedBoard.visible.has(r.id)).length:null};
  if(accounting.structural_containers+accounting.archived_noncontainers+accounting.provider_authority_noncontainers+accounting.native_rpc_work!==accounting.base_deliverables)fail('BASE_ACCOUNTING_INCOMPLETE');
  return {schema:'workload-native-comparison-v1',comparison:report.findings.length?'MISMATCH':nativeTeams.length?'MATCH':'WITHHELD',scope:{teams:nativeTeams},
    evidence:'OFFLINE_CAPTURE_COMPARISON',populationVerdict:'UNPROVEN',executable_binding:'UNPROVEN',serving:'UNPROVEN',G5:'HELD',
    excluded_scope:['CON','STR','provider_authority_population','provider_workspace','client_surfaces','legacy_contract_tests','assignee_email','legacy_url'],
    counts:report.counts,findings:report.findings,accounting,normalized:normalized?{counts:normalized.counts,workloadEligibilityCounts:normalized.workloadEligibilityCounts}:null,
    source:decoded.source,capture_sha256:decoded.verified.body_sha256,comparison_day:options.today,
    proof_limits:'A scoped match compares supplied-key capture content and current pinned source; it does not establish independent provenance, DDL quiescence, serving, live population or release readiness.'};
}
async function main(){const [packetPath,configPath]=process.argv.slice(2);if(!packetPath||!configPath||process.argv.length!==4)fail('PRIVATE_PACKET_AND_CONFIG_REQUIRED');
 const input=JSON.parse(fs.readFileSync(capture.privatePath(packetPath,true),'utf8')),cfg=JSON.parse(fs.readFileSync(capture.privatePath(configPath,true),'utf8'));
 const result=await compareCapture(input,cfg.integrity_key,{today:cfg.today,reviewedAdapterCommit:cfg.reviewed_adapter_commit});
 console.log(JSON.stringify(result));if(result.comparison!=='MATCH')process.exitCode=2;
}
if(require.main===module)main().catch(()=>{console.log(JSON.stringify({comparison:'REFUSED',populationVerdict:'UNPROVEN',G5:'HELD',code:'NATIVE_CAPTURE_COMPARISON_REFUSED'}));process.exitCode=1;});
module.exports={compareCapture,decode,derive,labels,container,sourceProof,ADAPTER_FILES};
