'use strict';
// Explicit local fixture; no server management and no production credentials.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const capture=require('./native-capture'),adapter=require('./native-adapter'),exact=require('./lossless-json'),harness=require('./source-harness');
const {Fixture}=require('./native-capture-rehearsal'),{setup}=require('../../scripts/card-history-integrated-rehearsal'),{source}=require('../../scripts/card-change-journal-rehearsal');
const lit=s=>"'"+String(s).replaceAll("'","''")+"'";
function mutate(input,key,fn){const next=structuredClone(input),body=exact.parse(next.packet.body.raw_database_json);
 fn(body,(name,change)=>{const part=body.sections[name],rows=exact.parse(part.rows_json);change(rows);const text=exact.stringify(rows);
 Object.assign(part,{rows_json:text,count:rows.length,rows_bytes:Buffer.byteLength(text),rows_sha256:capture.sha(text)});});
 next.packet=capture.seal({...next.packet.body,raw_database_json:exact.stringify(body)},key);return next;
}
async function run(cfg,output){
 const db=new Fixture(cfg);cfg={...cfg,database:db.name};capture.config(cfg);
 output=capture.privatePath(output);if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');fs.mkdirSync(output);
 const key=crypto.randomBytes(32).toString('hex'),head=spawnSync('git',['rev-parse','HEAD'],{cwd:capture.ROOT,encoding:'utf8',env:capture.gitEnv()}).stdout.trim();
 const options={today:'2030-01-07',reviewedAdapterCommit:head},checks=[];let passed=false;
 const check=(name,fn)=>{fn();checks.push(name);};
 const bad=async(name,packet)=>{let result;try{result=await adapter.compareCapture(packet,key,options);}catch{checks.push(name);return;}assert.notEqual(result.comparison,'MATCH');checks.push(name);};
 db.create();fs.writeFileSync(path.join(output,'DATABASE.private.json'),JSON.stringify({database:db.name,port:cfg.port}));
 try{
  setup(db,source('2026-09-05-calendar-feedback-recovery.sql'));
  db.query(source('live-schema-baseline-2026-07-03.sql').match(/create table if not exists public\.workload_issues \([\s\S]*?\n\);/)[0]);
  db.query(source('2026-09-02-workload-native-view.sql'));db.query(source('2026-09-05-workload-native-membership.sql'));
  db.query(`insert into clients(slug,display_name,active) values('nativefixture','Native Fixture',true),('inactivefixture','Inactive Fixture',false);
   insert into team_members(id,name,role,team,active,linear_user_id) values
   ('00000000-0000-4000-8000-000000000047','Synthetic Video','editor','video',true,null),
   ('00000000-0000-4000-8000-000000000048','Synthetic Graphics','designer','graphics',true,null),
   ('00000000-0000-4000-8000-000000000049','Synthetic Inactive','editor','video',false,null),
   ('00000000-0000-4000-8000-000000000050','Synthetic Wrong Role','smm','video',true,null),
   ('00000000-0000-4000-8000-000000000051','Synthetic Mapped','editor','video',true,'mapped-editor');
   insert into batches(id,client_slug,name,status,linear_parent_ids) values
   ('bat_native','nativefixture','Native Batch','active','{"video":{"uuid":"provider-parent"}}'),
   ('bat_archived','nativefixture','Archived Batch','archived','{}'),
   ('bat_inactive','inactivefixture','Inactive Client Batch','active','{}');
   update syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}' where key='prod_authority';`);
  const work=(id,extra={})=>({id,batch_id:'bat_native',client_slug:'nativefixture',team:'video',kind:'video',title:'Synthetic work '+id,status:'todo',
   assignee_id:'00000000-0000-4000-8000-000000000047',due_date:'2030-01-10',identifier:'VID-'+id.match(/\d+$/)?.[0],
   linear_raw:{precision_probe:new exact.ExactNumber('9007199254740993'),issue:{labels:{nodes:[],pageInfo:{hasNextPage:false}}}},...extra});
  const fixtures=[work('del_native_2',{sort_key:new exact.ExactNumber('9007199254740993')}),work('del_native_10',{sort_key:new exact.ExactNumber('-123.456789012345678901')}),
   work('del_old_5',{linear_issue_uuid:'old-work-alias',assignee_id:'00000000-0000-4000-8000-000000000051'}),
   work('del_graphics_3',{team:'graphics',kind:'graphic',assignee_id:'00000000-0000-4000-8000-000000000048'}),
   work('del_wrong_team_4',{assignee_id:'00000000-0000-4000-8000-000000000048'}),work('del_inactive_6',{assignee_id:'00000000-0000-4000-8000-000000000049'}),
   work('del_wrong_role_7',{assignee_id:'00000000-0000-4000-8000-000000000050'}),work('del_unassigned_empty_8',{assignee_id:null,due_date:null}),
   work('del_unassigned_work_9',{assignee_id:null,due_date:null,status:'in_progress'}),work('del_unassigned_date_11',{assignee_id:null}),
   work('del_archived_12',{batch_id:'bat_archived'}),work('del_inactive_client_13',{batch_id:'bat_inactive',client_slug:'inactivefixture'}),
   work('del_container_14',{linear_issue_uuid:'provider-parent'}),work('b1_container_15'),
   work('b1_child_16',{linear_raw:{issue:{parent:{id:'provider-parent'},labels:{nodes:[],pageInfo:{hasNextPage:false}}}}})];
  for(const status of ['triage','backlog','in_progress','smm_approval','kasper_approval','client_approval','tweak','approved','scheduled','posted','canceled','duplicate'])fixtures.push(work('del_status_'+status,{status,identifier:'STATUS-'+status}));
  fixtures[0].linear_raw.issue.labels.nodes=[{id:'weight-fixture',name:'3× Workload',color:'#abc123'}];fixtures[0].linear_raw.issue.labelIds=['weight-fixture'];
  for(const row of fixtures){const keys=Object.keys(row);db.query('insert into deliverables('+keys.join(',')+')values('+keys.map(k=>row[k]===null?'null':row[k] instanceof exact.ExactNumber?row[k].raw:typeof row[k]==='object'?lit(exact.stringify(row[k]))+'::jsonb':lit(row[k])).join(',')+');');}
  db.query("insert into workload_plan(issue_id,client,plan_date,updated_by)values('old-work-alias','nativefixture','2030-01-09','synthetic'),('del_native_2','nativefixture','2030-01-08','synthetic'),('retired-plan','nativefixture',null,'synthetic');");
  const catalog=await capture.inspectCatalog(cfg),result=await capture.capture(cfg,catalog,head,key);
  fs.writeFileSync(path.join(output,'CAPTURE.private.json'),JSON.stringify(result));
  const correct=await adapter.compareCapture(result,key,options);fs.writeFileSync(path.join(output,'COMPARISON.json'),JSON.stringify(correct,null,2));
  check('actual SQL capture with empty mirror reports only scoped MATCH',()=>{assert.equal(correct.comparison,'MATCH');assert.equal(correct.populationVerdict,'UNPROVEN');assert.equal(correct.G5,'HELD');assert.equal(result.summary.counts.workload_issues,0);assert.ok(correct.accounting.native_visible>5);});
  check('every base row has exactly one structural/archive/authority/source category',()=>{const a=correct.accounting;assert.equal(a.base_deliverables,fixtures.length);assert.equal(a.structural_containers,2);assert.equal(a.archived_noncontainers,1);assert.equal(a.structural_containers+a.archived_noncontainers+a.provider_authority_noncontainers+a.native_rpc_work,a.base_deliverables);});
  check('numeric capture precision survives adapter parsing',()=>{const rows=adapter.decode(result,key,head).sections.deliverables;assert.equal(rows.find(r=>r.id==='del_native_2').sort_key.raw,'9007199254740993');assert.equal(rows.find(r=>r.id==='del_native_10').sort_key.raw,'-123.456789012345678901');});
  check('label whitespace follows PostgreSQL btrim rather than JavaScript trim',()=>assert.deepEqual(adapter.labels({issue:{labels:{nodes:[{id:'id',name:'\t3× Workload\t'}],pageInfo:{hasNextPage:false}}}}),{complete:true,labels:[]}));
  const noChange=mutate(result,key,()=>{});check('lossless fixture reseal preserves exact numeric distinction',()=>assert.notEqual(noChange.packet.body.raw_database_json.indexOf('9007199254740993'),-1));
  check('ordinary JSON reconstruction would lose that precision',()=>assert.notEqual(JSON.stringify(JSON.parse('{"n":9007199254740993}')),'{"n":9007199254740993}'));
  assert.equal((await adapter.compareCapture(noChange,key,options)).comparison,'MATCH');checks.push('semantically unchanged lossless packet still matches');
  const removeNative=(body,change)=>{change('workload_issues_native_v1',rows=>{rows.splice(rows.findIndex(r=>r.id==='del_native_2'),1);});body.native_snapshot.rows=body.native_snapshot.rows.filter(r=>r.id!=='del_native_2');body.native_snapshot.count=body.native_snapshot.rows.length;};
  await bad('omitted native-only work cannot disappear with an empty mirror and matching observed counts',mutate(result,key,removeNative));
  await bad('extra native RPC row fails against base denominator',mutate(result,key,body=>{body.native_snapshot.rows.push({...body.native_snapshot.rows.find(r=>r.id==='del_native_2'),id:'del_unowned'});body.native_snapshot.count=body.native_snapshot.rows.length;}));
  await bad('duplicate rows refuse despite replacement count',mutate(result,key,(body,change)=>change('workload_issues_native_v1',rows=>rows.push(rows[0]))));
  await bad('malformed native identity refuses',mutate(result,key,body=>{body.native_snapshot.rows[0].id=null;}));
  await bad('wrong role cannot gain eligibility through a claimed RPC flag',mutate(result,key,body=>{body.native_snapshot.rows.find(r=>r.id==='del_wrong_role_7').native_assignee_eligible=true;}));
  await bad('inactive client cannot become visible through a claimed RPC flag',mutate(result,key,body=>{body.native_snapshot.rows.find(r=>r.id==='del_inactive_client_13').native_client_active=true;}));
  await bad('changed roster assembled from a different read refuses',mutate(result,key,(body,change)=>change('team_members',rows=>{rows.find(r=>r.id.endsWith('047')).active=false;})));
  await bad('native saved plan alias cannot point at another row',mutate(result,key,body=>{body.native_snapshot.rows.find(r=>r.id==='del_old_5').linear_id='unrelated-alias';}));
  await bad('saved date changed only in RPC refuses',mutate(result,key,body=>{body.native_snapshot.plans.find(r=>r.issue_id==='old-work-alias').plan_date='2030-01-10';}));
  await bad('new sort_order cannot silently replace current identifier ordering',mutate(result,key,body=>{body.native_snapshot.rows.filter(r=>r.is_sub_issue).forEach((r,i)=>{r.sort_order=100-i;});}));
  await bad('same-count exact numeric field substitution is detected',mutate(result,key,(body,change)=>change('workload_issues_native_v1',rows=>{rows.find(r=>r.id==='del_native_2').native_sort_key=new exact.ExactNumber('9007199254740992');})));
  await bad('wrong workload weights in captured metadata are detected',mutate(result,key,(body,change)=>change('production_deliverables_browser_v1',rows=>{rows.find(r=>r.id==='del_native_2').workload_labels=[];})));
  await bad('moving authority cannot be made into a successful mixed snapshot',mutate(result,key,(body,change)=>change('syncview_runtime_flags',rows=>{rows[0].value.video='linear';})));
  const unsigned=structuredClone(result);unsigned.packet.body.raw_database_json=unsigned.packet.body.raw_database_json.replace('9007199254740993','9007199254740992');
  await bad('unsigned content change refuses before comparison',unsigned);
  // Full captured server projection plus real reader/adoption/buckets, with
  // deterministic synthetic day; the VM exposes no actual external transport.
  const decoded=adapter.decode(result,key,head),d=adapter.derive(decoded.sections),{pathToFileURL}=require('node:url');
  const {projectNativeSnapshot}=await import(pathToFileURL(path.join(capture.ROOT,'supabase/functions/workload-plan/native-snapshot.mjs')).href);
  const projected=projectNativeSnapshot(exact.browserValue(decoded.snapshot),harness.context(['wlNormalizeClient']).wlNormalizeClient),board=await harness.nativeBoard(projected,options.today);
  check('actual reader and adoption retain old-key date under native identity',()=>assert.equal(board.dates.del_old_5.plan,'2030-01-09'));
  check('actual browser ordering ignores native_sort_key and orders numeric identifiers',()=>assert.ok(board.ordering.indexOf('del_native_2')<board.ordering.indexOf('del_native_10')));
  check('actual browser excludes inactive/wrong-role/wrong-team and retains assigned/undated distinctions',()=>{for(const id of ['del_inactive_6','del_wrong_role_7','del_wrong_team_4','del_unassigned_empty_8','del_inactive_client_13'])assert.ok(!board.visible.has(id));assert.ok(board.visible.has('del_unassigned_work_9'));assert.ok(board.visible.has('del_unassigned_date_11'));});
  check('actual browser uses exact native workload weight',()=>assert.equal(board.dates.del_native_2.weight,3));
  db.query("insert into workload_issues(id,active,is_sub_issue,team_key,team_name,client_name,status,status_type)values('legacy-con-fixture',true,true,'CON','Content','Native Fixture','Todo','unstarted');");
  const legacy=await adapter.compareCapture(await capture.capture(cfg,catalog,head,key),key,options);
  check('CON presence remains explicitly outside native comparison',()=>{assert.equal(legacy.comparison,'MATCH');assert.ok(legacy.excluded_scope.includes('CON'));assert.equal(legacy.G5,'HELD');});
  db.query("update syncview_runtime_flags set value='{"+'"video":"linear","graphics":"syncview"'+"}' where key='prod_authority';");
  const transitioned=await adapter.compareCapture(await capture.capture(cfg,catalog,head,key),key,options);
  check('coherent provider epoch transition withholds VID and compares only native GRA',()=>{assert.equal(transitioned.comparison,'MATCH');assert.deepEqual(transitioned.scope.teams,['graphics']);assert.ok(transitioned.accounting.provider_authority_noncontainers>0);});
  const packetFile=path.join(output,'CLI-CAPTURE.private.json'),configFile=path.join(output,'CLI-CONFIG.private.json');
  fs.writeFileSync(packetFile,JSON.stringify(result));fs.writeFileSync(configFile,JSON.stringify({integrity_key:key,today:options.today,reviewed_adapter_commit:head}),{mode:0o600});
  const cli=spawnSync(process.execPath,[path.join(__dirname,'native-adapter.js'),packetFile,configFile],{encoding:'utf8',timeout:60000,windowsHide:true});
  check('actual CLI reports scoped match with no private identities or credentials',()=>{assert.equal(cli.status,0);assert.equal(JSON.parse(cli.stdout).comparison,'MATCH');for(const forbidden of ['nativefixture','del_native','Native Fixture',key,cfg.password,db.name])assert.ok(!cli.stdout.includes(forbidden));assert.equal(cli.stderr,'');});
  const resultReport={status:'PASS',classification:'ISOLATED_POSTGRES_AND_SOURCE_VM',passed:checks.length,checks,source_commit:head,
   limits:'Actual SQL native capture and pinned browser VM/normalized comparator; no Chromium, live serving, independent provenance, DDL freeze, provider census or G5 closure.'};
  fs.writeFileSync(path.join(output,'REPORT.json'),JSON.stringify(resultReport,null,2));passed=true;return resultReport;
 }finally{if(passed)db.drop();}
}
module.exports={run,mutate};
if(require.main===module){Promise.resolve().then(()=>run(JSON.parse(fs.readFileSync(capture.privatePath(process.argv[2],true),'utf8')),process.argv[3]))
 .then(r=>console.log(JSON.stringify({status:r.status,passed:r.passed,classification:r.classification})))
 .catch(()=>{console.log(JSON.stringify({status:'FAIL',code:'NATIVE_ADAPTER_REHEARSAL_FAILED'}));process.exitCode=1;});}
