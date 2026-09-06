'use strict';
// One owner-started local PostgreSQL fixture. No server management, provider
// traffic, live data, service grants or schema installation outside its own DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const capture=require('./native-capture');
const {LocalDatabase,source}=require('../../scripts/card-change-journal-rehearsal');
const {setup}=require('../../scripts/card-history-integrated-rehearsal');
const ROOT=capture.ROOT;
class Fixture extends LocalDatabase {
  raw(sql,database) {
    return spawnSync(this.config.psql,['-w',...this.args(database)],{input:sql,encoding:'utf8',windowsHide:true,
      timeout:30000,maxBuffer:64*1024*1024,env:capture.safeEnv(this.config.password)});
  }
}
const readPacket=result=>JSON.parse(result.packet.body.raw_database_json);
const rows=(observation,name)=>JSON.parse(observation.sections[name].rows_json);
const sha=capture.sha;
async function run(cfg,output) {
  // Validation occurs before create(); this is never a permissive DB launcher.
  const db=new Fixture({...cfg});cfg={...cfg,database:db.name};capture.config(cfg);
  output=capture.privatePath(output);if(fs.existsSync(output))throw Error('fixture_output_exists');fs.mkdirSync(output);
  const checks=[];const check=(name,fn)=>{fn();checks.push(name);};
  const reject=async(name,fn,pattern)=>{await assert.rejects(fn,pattern);checks.push(name);};
  const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).stdout.trim();
  const key=crypto.randomBytes(32).toString('hex');let passed=false,blocker,privateRole;
  db.create();
  fs.writeFileSync(path.join(output,'DATABASE.private.json'),JSON.stringify({name:db.name,port:cfg.port,retained_on_failure:true}));
  try {
    setup(db,source('2026-09-05-calendar-feedback-recovery.sql'));
    const declaration=source('live-schema-baseline-2026-07-03.sql').match(/create table if not exists public\.workload_issues \([\s\S]*?\n\);/);
    assert.ok(declaration);db.query(declaration[0]);
    db.query(source('2026-09-02-workload-native-view.sql'));db.query(source('2026-09-05-workload-native-membership.sql'));
    db.query(`insert into clients(slug,display_name,active) values('capturefixture','Synthetic Capture Client',true);
      insert into team_members(id,name,role,team,active) values('00000000-0000-4000-8000-000000000047','Synthetic Capture Editor','editor','video',true);
      insert into batches(id,client_slug,name) values('bat_capture','capturefixture','Synthetic Capture Batch');
      insert into deliverables(id,batch_id,client_slug,team,kind,title,status,assignee_id,linear_raw) values
      ('del_capture','bat_capture','capturefixture','video','video','Synthetic capture body','todo','00000000-0000-4000-8000-000000000047',
      '{"precision_probe":9007199254740993,"issue":{"labels":{"nodes":[],"pageInfo":{"hasNextPage":false}}}}');
      update syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}' where key='prod_authority';
      insert into workload_plan(issue_id,client,plan_date,updated_by) values('del_capture','capturefixture','2030-01-08','synthetic');`);
    const catalog=await capture.inspectCatalog(cfg);
    fs.writeFileSync(path.join(output,'CATALOG.private.json'),JSON.stringify(catalog));
    const before=db.query("select jsonb_build_object('d',(select jsonb_agg(to_jsonb(d)) from deliverables d),'p',(select jsonb_agg(to_jsonb(p)) from workload_plan p),'f',(select jsonb_agg(to_jsonb(f)) from syncview_runtime_flags f))");
    const result=await capture.capture(cfg,catalog,commit,key),observed=readPacket(result);
    fs.writeFileSync(path.join(output,'CAPTURE.private.json'),JSON.stringify(result));
    check('actual migration-shaped native-only row is in independent base with empty mirror',()=>{
      assert.equal(observed.sections.workload_issues.count,0);assert.ok(rows(observed,'deliverables').some(r=>r.id==='del_capture'));
      assert.ok(observed.native_snapshot.rows.some(r=>r.id==='del_capture'&&r.native_assignee_eligible===true));
      assert.equal(result.summary.populationVerdict,'UNPROVEN');
    });
    check('all nine sections preserve complete counts and exact raw section bytes',()=>{
      assert.equal(Object.keys(observed.sections).length,9);
      for(const part of Object.values(observed.sections)){assert.equal(JSON.parse(part.rows_json).length,part.count);assert.equal(sha(part.rows_json),part.rows_sha256);assert.equal(Buffer.byteLength(part.rows_json),part.rows_bytes);}
      assert.ok(observed.sections.deliverables.rows_json.includes('9007199254740993'));
      assert.ok(result.packet.body.raw_database_json.includes('9007199254740993'));
    });
    check('capture leaves current records and saved plans unchanged',()=>assert.equal(db.query("select jsonb_build_object('d',(select jsonb_agg(to_jsonb(d)) from deliverables d),'p',(select jsonb_agg(to_jsonb(p)) from workload_plan p),'f',(select jsonb_agg(to_jsonb(f)) from syncview_runtime_flags f))"),before));
    check('observed transaction is explicitly read-only repeatable-read',()=>{
      assert.equal(observed.transaction.read_only,'on');assert.equal(observed.transaction.isolation,'repeatable read');
      assert.equal(observed.database.name,db.name);assert.equal(observed.database.port,Number(cfg.port));
    });
    const bad=structuredClone(result.packet);bad.body.raw_database_json=bad.body.raw_database_json.replace('9007199254740993','9007199254740992');
    check('same-count numeric content substitution cannot retain its signature',()=>assert.throws(()=>capture.verify(bad,key,result.expected),/packet_integrity_mismatch/));
    check('lossy JavaScript baseline aliases distinct PostgreSQL numbers; exact packet does not',()=>{
      assert.equal(JSON.stringify(JSON.parse('{"n":9007199254740993}')),JSON.stringify(JSON.parse('{"n":9007199254740992}')));
      assert.notEqual(sha('{"n":9007199254740993}'),sha('{"n":9007199254740992}'));
    });
    // A synthetic transcript deliberately re-signed by its author must still
    // fail shape/accounting guards. The HMAC is not independent provenance.
    function changed(mutator){const body=structuredClone(result.packet.body),value=JSON.parse(body.raw_database_json);mutator(value);body.raw_database_json=JSON.stringify(value);return capture.seal(body,key);}
    function replaceRows(value,name,list){const json=JSON.stringify(list);Object.assign(value.sections[name],{rows_json:json,rows_bytes:Buffer.byteLength(json),rows_sha256:sha(json)});}
    check('truncated private section refuses despite valid replacement signature',()=>assert.throws(()=>capture.verify(changed(v=>replaceRows(v,'deliverables',[])),key,result.expected),/capture_count_mismatch/));
    check('duplicate private identities refuse with matching declared count',()=>assert.throws(()=>capture.verify(changed(v=>{const list=rows(v,'deliverables');list.push(list[0]);v.sections.deliverables.count++;replaceRows(v,'deliverables',list);}),key,result.expected),/capture_identity_invalid/));
    check('malformed identity refuses independently of counts',()=>assert.throws(()=>capture.verify(changed(v=>{const list=rows(v,'deliverables');list[0].id=null;replaceRows(v,'deliverables',list);}),key,result.expected),/capture_identity_invalid/));
    check('missing section refuses',()=>assert.throws(()=>capture.verify(changed(v=>delete v.sections.clients),key,result.expected),/capture_section_missing/));
    check('section byte digest refuses same-count body change',()=>assert.throws(()=>capture.verify(changed(v=>{v.sections.deliverables.rows_json=v.sections.deliverables.rows_json.replace('Synthetic capture body','Replaced capture body');}),key,result.expected),/capture_count_or_content_mismatch/));
    check('moved authority assembled from separate reads refuses',()=>assert.throws(()=>capture.verify(changed(v=>{const list=rows(v,'syncview_runtime_flags');list[0].value.video='linear';replaceRows(v,'syncview_runtime_flags',list);}),key,result.expected),/captured_rpc_invalid/));
    check('saved date content must match raw RPC without relying on row count',()=>assert.throws(()=>capture.verify(changed(v=>{v.native_snapshot.plans[0].plan_date='2030-01-09';}),key,result.expected),/captured_plan_content_mismatch/));
    check('wrong declared source pin refuses before SQL',()=>assert.throws(()=>capture.sourceBinding('0'.repeat(40)),/source_pin_mismatch/));
    const originalDefinition=db.query("select pg_get_functiondef('workload_native_snapshot_v1()'::regprocedure)");
    db.query("create or replace function workload_native_snapshot_v1() returns jsonb language plpgsql stable security definer as $$begin raise exception 'synthetic_private_rpc_must_not_run';end;$$;");
    await reject('changed RPC catalog refuses before its replacement executes',()=>capture.capture(cfg,catalog,commit,key),/capture_query_or_catalog_refused/);
    db.query(originalDefinition);
    const current=await capture.inspectCatalog(cfg);assert.deepEqual(current,catalog);
    db.query('alter table public.workload_plan rename to workload_plan_missing;');
    await reject('missing relation refuses without emitting a partial packet',()=>capture.capture(cfg,catalog,commit,key),/capture_query_or_catalog_refused/);
    db.query('alter table public.workload_plan_missing rename to workload_plan;');
    privateRole='workload_capture_'+db.name;
    db.query('create role '+privateRole+" login password '"+cfg.password.replaceAll("'","''")+"';",'postgres');
    await reject('missing table grants refuse complete acquisition',()=>capture.capture({...cfg,user:privateRole},catalog,commit,key),/capture_query_or_catalog_refused/);
    await reject('read-only database transaction refuses a write',()=>capture.runSql(cfg,"begin isolation level repeatable read read only;update public.workload_plan set plan_date='2030-02-02';rollback;"),/capture_query_or_catalog_refused/);

    // Hold one relation while the capture establishes its catalog snapshot.
    // A concurrent writer changes the native base and authority before the
    // blocked data SELECT proceeds. REPEATABLE READ must retain the old image.
    blocker=spawn(cfg.psql,capture.args(cfg),{env:capture.safeEnv(cfg.password),windowsHide:true,stdio:['pipe','pipe','pipe']});
    let blockOutput='';blocker.stdout.on('data',d=>{blockOutput+=d;});blocker.stderr.on('data',()=>{});
    blocker.stdin.write('begin;lock table public.workload_issues in access exclusive mode;\n\\echo CAPTURE_LOCK_READY\n');
    const deadline=Date.now()+10000;
    while(!blockOutput.includes('CAPTURE_LOCK_READY')){if(Date.now()>deadline)throw Error('fixture_lock_timeout');await new Promise(r=>setTimeout(r,20));}
    const pending=capture.capture(cfg,catalog,commit,key);
    let waiting=false;
    while(Date.now()<deadline){
      waiting=db.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%workload-native-private-capture-v1%')")==='t';
      if(waiting)break;await new Promise(r=>setTimeout(r,20));
    }
    assert.equal(waiting,true,'actual capture must block after observing its catalog snapshot');
    db.query("update deliverables set title='Concurrent changed body' where id='del_capture';update syncview_runtime_flags set value='{"+'"video":"linear","graphics":"syncview"'+"}' where key='prod_authority';");
    const closed=new Promise(resolve=>blocker.once('close',resolve));blocker.stdin.end('commit;\n');await closed;blocker=null;
    const old=readPacket(await pending),next=readPacket(await capture.capture(cfg,catalog,commit,key));
    check('concurrent source and authority change yields coherent old capture',()=>{
      assert.equal(rows(old,'deliverables').find(r=>r.id==='del_capture').title,'Synthetic capture body');
      assert.equal(old.native_snapshot.authority.video,'syncview');assert.ok(old.native_snapshot.rows.some(r=>r.id==='del_capture'));
    });
    check('next complete capture sees coherent new authority and source',()=>{
      assert.equal(rows(next,'deliverables').find(r=>r.id==='del_capture').title,'Concurrent changed body');
      assert.equal(next.native_snapshot.authority.video,'linear');assert.ok(!next.native_snapshot.rows.some(r=>r.id==='del_capture'));
      assert.notEqual(old.transaction.snapshot,next.transaction.snapshot);
    });
    blocker=spawn(cfg.psql,capture.args(cfg),{env:capture.safeEnv(cfg.password),windowsHide:true,stdio:['pipe','pipe','pipe']});
    blockOutput='';blocker.stdout.on('data',d=>{blockOutput+=d;});blocker.stderr.on('data',()=>{});
    blocker.stdin.write('begin;lock table public.workload_issues in access exclusive mode;\n\\echo CAPTURE_LOCK_READY\n');
    const ddlDeadline=Date.now()+10000;
    while(!blockOutput.includes('CAPTURE_LOCK_READY')){if(Date.now()>ddlDeadline)throw Error('fixture_lock_timeout');await new Promise(r=>setTimeout(r,20));}
    const ddlPending=capture.capture(cfg,catalog,commit,key);waiting=false;
    while(Date.now()<ddlDeadline){waiting=db.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%workload-native-private-capture-v1%')")==='t';if(waiting)break;await new Promise(r=>setTimeout(r,20));}
    assert.equal(waiting,true);
    const substituted=originalDefinition.replace("jsonb_build_object('ok',true,'contract','workload-native-snapshot-v1'", "jsonb_build_object('synthetic_revision','changed','ok',true,'contract','workload-native-snapshot-v1'");
    assert.notEqual(substituted,originalDefinition);db.query(substituted);
    const ddlClosed=new Promise(resolve=>blocker.once('close',resolve));blocker.stdin.end('commit;\n');await ddlClosed;blocker=null;
    await reject('definition changes after initial catalog gate are refused',()=>ddlPending,/observed_catalog_mismatch/);
    db.query(originalDefinition);
    const labelDefinition=db.query("select pg_get_functiondef('production_workload_label_projection(jsonb)'::regprocedure)");
    const pausedLabel=labelDefinition.replace(/\r?\nbegin\r?\n/i,'\nbegin\n perform pg_advisory_xact_lock(847299);\n');
    assert.notEqual(pausedLabel,labelDefinition);db.query(pausedLabel);
    const pausedCatalog=await capture.inspectCatalog(cfg);
    blocker=spawn(cfg.psql,capture.args(cfg),{env:capture.safeEnv(cfg.password),windowsHide:true,stdio:['pipe','pipe','pipe']});
    blockOutput='';blocker.stdout.on('data',d=>{blockOutput+=d;});blocker.stderr.on('data',()=>{});
    blocker.stdin.write('begin;select pg_advisory_xact_lock(847299);\n\\echo CAPTURE_LOCK_READY\n');
    const lateDeadline=Date.now()+10000;
    while(!blockOutput.includes('CAPTURE_LOCK_READY')){if(Date.now()>lateDeadline)throw Error('fixture_lock_timeout');await new Promise(r=>setTimeout(r,20));}
    const latePending=capture.capture(cfg,pausedCatalog,commit,key);waiting=false;
    while(Date.now()<lateDeadline){waiting=db.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory' and query like '%workload-native-private-capture-v1%')")==='t';if(waiting)break;await new Promise(r=>setTimeout(r,20));}
    assert.equal(waiting,true);db.query(substituted);
    const lateClosed=new Promise(resolve=>blocker.once('close',resolve));blocker.stdin.end('commit;\n');await lateClosed;blocker=null;
    await reject('post-evaluation observation refuses late executable definition change',()=>latePending,/observed_catalog_after_mismatch/);
    db.query(originalDefinition);db.query(labelDefinition);
    const configFile=path.join(output,'CLI-CONFIG.private.json'),packetFile=path.join(output,'CLI-CAPTURE.private.json');
    fs.writeFileSync(configFile,JSON.stringify({connection:cfg,reviewed_catalog:catalog,reviewed_commit:commit,integrity_key:key}),{mode:0o600});
    const cli=spawnSync(process.execPath,[path.join(__dirname,'native-capture.js'),configFile,packetFile],{encoding:'utf8',timeout:60000,windowsHide:true,
      env:{...process.env,PGHOSTADDR:'192.0.2.11',PGSERVICE:'synthetic-remote',PGSERVICEFILE:'synthetic-missing',PGDATABASE:'wrong',PGPASSWORD:'wrong'}});
    fs.writeFileSync(path.join(output,'CLI.stdout.txt'),cli.stdout);fs.writeFileSync(path.join(output,'CLI.stderr.txt'),cli.stderr);
    check('actual CLI discards ambient libpq overrides and writes only private receipt',()=>{assert.equal(cli.status,0);assert.equal(JSON.parse(cli.stdout).populationVerdict,'UNPROVEN');assert.ok(fs.existsSync(packetFile));});
    check('actual CLI output contains no fixture names, IDs, raw body, database or credentials',()=>{
      for(const forbidden of ['capturefixture','del_capture','Synthetic Capture','Concurrent changed body',db.name,cfg.password,key])assert.ok(!cli.stdout.includes(forbidden));assert.equal(cli.stderr,'');
    });
    const repeat=spawnSync(process.execPath,[path.join(__dirname,'native-capture.js'),configFile,packetFile],{encoding:'utf8',timeout:60000});
    check('existing private receipt is never overwritten',()=>{assert.equal(repeat.status,1);assert.equal(JSON.parse(repeat.stdout).code,'private_output_exists');});
    const report={classification:'ISOLATED_POSTGRES',status:'PASS',checks,passed:checks.length,source_commit:commit,
      capture_component_sha256:sha(fs.readFileSync(path.join(__dirname,'native-capture.js'))),populationVerdict:'UNPROVEN',
      limits:'Actual migration-shaped SQL and atomic private capture only; no native comparator, independent trust, installed/serving/live, client/browser or G5 closure proof.'};
    fs.writeFileSync(path.join(output,'REPORT.json'),JSON.stringify(report,null,2));passed=true;return report;
  } finally {
    if(blocker){blocker.stdin.end('rollback;\n');blocker.kill();}
    if(passed){db.drop();if(privateRole)db.query('drop role '+privateRole,'postgres');}
  }
}
if(require.main===module){
  const filename=process.argv[2],output=process.argv[3];
  Promise.resolve().then(()=>run(JSON.parse(fs.readFileSync(capture.privatePath(filename,true),'utf8')),output))
    .then(r=>console.log(JSON.stringify({classification:r.classification,status:r.status,passed:r.passed,populationVerdict:r.populationVerdict})))
    .catch(()=>{console.log(JSON.stringify({status:'FAIL',code:'capture_rehearsal_failed',populationVerdict:'UNPROVEN'}));process.exitCode=1;});
}
module.exports={run,Fixture};
