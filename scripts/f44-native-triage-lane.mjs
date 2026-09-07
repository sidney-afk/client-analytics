import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import vm from 'node:vm';import {createRequire} from 'node:module';
import {loadGateway,ROOT} from './native-intake-reconcile/load-gateway.mjs';
import {runSql,hooks,resetHooks} from './native-intake-manifest/supabase-shim.mjs';
const gw=await loadGateway(),checks=[],q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
async function sql(s){const r=await runSql(s);if(r.status)throw Error(r.stderr);return r.stdout.trim();}
async function rows(s){return JSON.parse(await sql(`select coalesce(json_agg(t),'[]'::json) from (${s}) t`));}
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');let sequence=0;
function envelope(team='video',payload){payload??={clientName:'F44 Fixture',filmingPlans:'',notes:'Original note\nVideo 1 notes: preserve all text',title:'Fixture intake '+(++sequence),videos:[{number:1,main_cam:'main footage',side_cam:'side footage',audio:'audio footage',dueDate:'2026-09-12'}]};const hash=sha(stable(payload));return {...payload,action:'legacy_intake_receive',team,payload_hash:hash,receipt_key:`linear-intake-v1:${team}:${hash}`,idempotency_key:`linear-intake-v1:${team}:${hash}`};}
const original=e=>Object.fromEntries(['clientName','filmingPlans','notes','title','videos'].map(k=>[k,e[k]]));
const owner=async e=>(await rows('select * from public.legacy_intake_native_triage where payload_hash='+q(e.payload_hash)))[0];
async function complete(e,teams=['video'],headers=gw.STAFF,revision){const g=await owner(e);return gw.post({action:'legacy_intake_triage_complete',payload_hash:e.payload_hash,revision:revision??Number(g.revision),intended_teams:teams,confirm:'CONFIRM_ORIGINAL_SUBMISSION_TEAMS'},headers);}
const check=async(name,fn)=>{try{await fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false});throw e;}};
const require=createRequire(import.meta.url),{extractFunction}=require('../test/helpers/extract-function'),browser={};vm.createContext(browser);
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');vm.runInContext(['_linearConfirmedReceived','_linearConfirmedCreate','_linearResponseParentId','_linearUuid'].map(n=>extractFunction(html,n)).join('\n'),browser);
const snapshot=async()=>sql("select jsonb_build_object('owners',(select coalesce(jsonb_agg(to_jsonb(t) order by payload_hash),'[]') from public.legacy_intake_native_triage t),'manifests',(select count(*) from public.production_intake_manifests),'cards',(select count(*) from public.calendar_posts),'children',(select count(*) from public.deliverables))::text");
try{
  await sql(`insert into public.clients select (jsonb_populate_record(null::public.clients,(select to_jsonb(c)||'{"slug":"f44fixture","display_name":"F44 Fixture"}'::jsonb from public.clients c where slug='fixture-client'))).*;`);
  await sql(`insert into public.team_members(id,name,role,active) values('99999999-9999-4999-8999-999999999999','Fixture SMM','smm',true);`);
  const smm={'x-syncview-key':'fixture-smm-key','x-syncview-actor':'Fixture SMM'};
  await check('invalid UTF-8 refuses before original-byte capture',async()=>{
    const bad=envelope(),encoded=Buffer.from(JSON.stringify(bad).replace('Original note','BADBYTE'));
    encoded[encoded.indexOf('BADBYTE')]=255;
    const response=await gw.handler(new Request('http://gateway.fixture.invalid/functions/v1/production-write?action=legacy_intake_receive',{method:'POST',headers:{'content-type':'application/json'},body:encoded}));
    assert.equal(response.status,400);assert.equal((await response.json()).error,'legacy_intake_invalid_utf8');assert.equal(await owner(bad),undefined);
  });
  await check('closed, missing and malformed public control refuse without capture',async()=>{
    for(const value of ['{"enabled":false}','{}','{"enabled":"true"}']){await sql(`update public.syncview_runtime_flags set value=${q(value)}::jsonb where key='public_intake_enabled'`);const before=await snapshot();assert.equal((await gw.post(envelope(),{})).status,403);assert.equal(await snapshot(),before);}
    await sql("delete from public.syncview_runtime_flags where key='public_intake_enabled'");assert.equal((await gw.post(envelope(),{})).status,403);
    await sql("insert into public.syncview_runtime_flags(key,value) values('public_intake_enabled','{\"enabled\":true}')");
  });
  await check('anonymous, creative, missing and invalid roster credentials cannot read protected inbox',async()=>{
    for(const headers of [{},{'x-syncview-key':'wrong'}, {'x-syncview-key':'fixture-admin-key'}, {'x-syncview-key':'fixture-creative-key','x-syncview-actor':'Fixture SMM'}])assert.ok([401,403].includes((await gw.post({action:'legacy_intake_triage_list'},headers)).status));
  });
  const e=envelope();
  await check('fresh tokenless F44 receives strict browser receipt and exact durable original',async()=>{
    const oldBody={...e};delete oldBody.action;const raw=' \n'+JSON.stringify(oldBody)+'\n';
    const response=await gw.handler(new Request('http://gateway.fixture.invalid/functions/v1/production-write?action=legacy_intake_receive',{
      method:'POST',headers:{'content-type':'application/json'},body:raw}));
    const r={status:response.status,json:await response.json()};assert.equal(r.status,202,JSON.stringify(r));assert.equal(browser._linearConfirmedReceived(r.json,{...e,payload:original(e)}),true);
    const g=await owner(e);assert.equal(g.payload_json,stable(original(e)));assert.equal(g.received.video.raw_body,raw);assert.equal(g.origin_actor,'public-intake');assert.equal(g.state,'triage');
  });
  await check('same key replay retains original owner and raw bytes',async()=>{const before=await owner(e);assert.equal((await gw.post(e,{})).status,202);assert.deepEqual(await owner(e),before);});
  await check('provider replay and finalize UPDATEs are fenced for fresh native capture',async()=>{
    const capture=process.env.F44_CAPTURE_FILE;
    if(!capture)throw Error('exact_private_F44_capture_required');
    const bytes=fs.readFileSync(capture);assert.equal(sha(bytes),'10ebf24b63ee6ef72f1c7aa0f019dec2830e1d682d85649fc74bb332270b0e8f');
    const graph=JSON.parse(bytes);assert.equal(graph.nodes.length,142);
    for(const suffix of ['Video','Graphics']){
      const replay=graph.nodes.find(n=>n.name==='F44 Replay Receipt '+suffix);assert.equal(replay.type,'n8n-nodes-base.supabase');assert.equal(replay.parameters.operation,'update');assert.equal(replay.parameters.tableId,'linear_intake_receipts');
      assert.deepEqual(replay.parameters.fieldsUi.fieldValues.map(f=>f.fieldId),['status','attempts','replay_note','updated_at']);
      const finalize=graph.nodes.find(n=>n.name==='F44 Finalize Receipt '+suffix);assert.equal(finalize.parameters.operation,'update');assert.equal(finalize.parameters.tableId,'linear_intake_receipts');
    }
    for(const set of ["status='pending',attempts=attempts+1,replay_note='{}',updated_at=now()",
      "status='created',parent_issue_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',child_issue_ids='[\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\"]'"]){
      const r=await runSql(`set role service_role;update public.linear_intake_receipts set ${set} where receipt_key=${q(e.receipt_key)}`);
      assert.notEqual(r.status,0);assert.match(r.stderr,/legacy_intake_native_owned/);
    }
    const second=envelope('graphics',original(e));const inserted=await runSql(`set role service_role;insert into public.linear_intake_receipts(receipt_key,payload_hash,client,team,payload_json) values(${q(second.receipt_key)},${q(e.payload_hash)},'F44 Fixture','graphics',${q(stable(original(e)))})`);
    assert.notEqual(inserted.status,0);assert.match(inserted.stderr,/legacy_intake_native_owned/);assert.equal((await owner(e)).state,'triage');
  });
  await check('two real SQL sessions serialize capture against an old provider claim without deadlock',async()=>{
    const a=envelope();assert.equal((await gw.post(a,{})).status,202);
    const raw=JSON.stringify(a),call=`public.legacy_intake_native_receive(${q(stable(original(a)))},'video',${q(raw)},'f44fixture')`;
    const capture=runSql(`set application_name='f44-native-race';begin;select ${call};select pg_sleep(1);commit;`);
    let ready=false;for(let i=0;i<20;i++){const active=await rows("select pid from pg_stat_activity where application_name='f44-native-race' and wait_event='PgSleep'");if(active.length){ready=true;break;}await new Promise(r=>setTimeout(r,25));}
    assert.equal(ready,true,'capture holds real receipt and mapping locks');
    const claim=runSql(`set lock_timeout='5s';set role service_role;update public.linear_intake_receipts set status='failed',error='provider tail' where receipt_key=${q(a.receipt_key)}`);
    const [accepted,refused]=await Promise.all([capture,claim]);assert.equal(accepted.status,0,accepted.stderr);assert.notEqual(refused.status,0);assert.match(refused.stderr,/legacy_intake_native_owned/);assert.equal((await owner(a)).state,'triage');
  });
  await check('unretried historical debt appears in protected inbox as a preserved hold',async()=>{
    const a=envelope();await sql(`insert into public.linear_intake_receipts(receipt_key,payload_hash,client,team,payload_json) values(${q(a.receipt_key)},${q(a.payload_hash)},'F44 Fixture','video',${q(stable(original(a)))})`);
    const inbox=await gw.post({action:'legacy_intake_triage_list'});assert.equal(inbox.status,200,JSON.stringify(inbox));
    const debt=inbox.json.rows.find(r=>r.payload_hash===a.payload_hash);assert.ok(debt);assert.equal(debt.state,'held');assert.equal(debt.historical_only,true);assert.equal(await owner(a),undefined);
    // A real historical provider owner retains its old state transition.
    await sql(`set role service_role;update public.linear_intake_receipts set status='failed',error='historical fixture refusal' where receipt_key=${q(a.receipt_key)}`);
  });
  for(const nativeFirst of [true,false])await check('first capture versus other-team provider INSERT: '+(nativeFirst?'native wins':'provider wins'),async()=>{
    const a=envelope(),other=envelope('graphics',original(a));
    const receive=`select public.legacy_intake_native_receive(${q(stable(original(a)))},'video',${q(JSON.stringify(a))},'f44fixture')`;
    const insert=`insert into public.linear_intake_receipts(receipt_key,payload_hash,client,team,payload_json) values(${q(other.receipt_key)},${q(other.payload_hash)},'F44 Fixture','graphics',${q(stable(original(a)))})`;
    const firstName=nativeFirst?'f44-first-native':'f44-first-provider',secondName=nativeFirst?'f44-wait-provider':'f44-wait-native';
    const first=runSql(`set application_name=${q(firstName)};set lock_timeout='5s';begin;${nativeFirst?receive:insert};select pg_sleep(2);commit`);
    async function waits(name,event){for(let i=0;i<20;i++){
      if((await rows(`select pid from pg_stat_activity where application_name=${q(name)} and wait_event=${q(event)}`)).length)return true;
      await new Promise(resolve=>setTimeout(resolve,25));
    }return false;}
    assert.equal(await waits(firstName,'PgSleep'),true,'first admission is still uncommitted');
    const second=runSql(`set application_name=${q(secondName)};set lock_timeout='5s';${nativeFirst?insert:receive}`);
    assert.equal(await waits(secondName,'advisory'),true,'other-team admission waits on the same payload lock');
    const [winner,loser]=await Promise.all([first,second]);assert.equal(winner.status,0,winner.stderr);
    if(nativeFirst){assert.notEqual(loser.status,0);assert.match(loser.stderr,/legacy_intake_native_owned/);
      assert.equal((await rows('select * from public.linear_intake_receipts where receipt_key='+q(other.receipt_key))).length,0);
      assert.equal((await owner(a)).state,'triage');
    }else{
      assert.equal(loser.status,0,loser.stderr);const before=await sql('select count(*) from public.production_intake_manifests');
      const attempted=await complete(a,['video','graphics']);assert.equal(attempted.status,409);assert.equal(attempted.json.error,'legacy_intake_provider_or_unknown_receipt');
      assert.equal(await sql('select count(*) from public.production_intake_manifests'),before);
      const inbox=await gw.post({action:'legacy_intake_triage_list'});assert.equal(inbox.json.rows.find(r=>r.payload_hash===a.payload_hash).state,'held');
      assert.equal((await rows('select status from public.linear_intake_receipts where receipt_key='+q(other.receipt_key)))[0].status,'pending');
    }
  });
  await check('hash mismatch, extra fields and capture failure never acknowledge durable receipt',async()=>{
    assert.equal((await gw.post({...envelope(),extra:'must not drop'},{})).status,400);
    assert.equal((await gw.post({...envelope(),payload_hash:'0'.repeat(64)},{})).status,409);
    hooks.beforeRpc=n=>{if(n==='legacy_intake_native_receive')throw Error('synthetic_capture_failure');};const r=await gw.post(envelope(),{});resetHooks();assert.equal(r.status,500);assert.notEqual(r.json.durable_capture,true);
  });
  const paired=envelope('graphics',original(e));await gw.post(paired,{});
  await check('stale revision and omission of received team cannot reserve native work',async()=>{
    assert.equal((await complete(e,['video','graphics'],gw.STAFF,1)).status,409);
    assert.equal((await complete(e,['video'])).status,409);assert.equal((await owner(e)).native_request,null);
  });
  await check('accepted child interruption conserves manifest and another real staff actor completes it',async()=>{
    hooks.beforeRpc=n=>{if(n==='production_deliverable_write')throw Error('synthetic_interrupted_child');};const r=await complete(e,['video','graphics']);resetHooks();assert.equal(r.status,500,JSON.stringify(r));
    const g=await owner(e);assert.ok(g.native_request);assert.equal((await rows('select * from public.production_intake_manifests where request_id='+q(g.native_request.request_id))).length,1);
    const held=await complete(e,['video','graphics'],smm);assert.equal(held.status,409,JSON.stringify(held));assert.equal(held.json.reason,'native_materialization_held');
    await sql("update public.syncview_runtime_flags set value=value||'{\"mode\":\"native\",\"epoch\":\"f44-fixture\"}'::jsonb where key='native_card_materialization'");
    const done=await complete(e,['video','graphics'],smm);assert.equal(done.status,200,JSON.stringify(done));assert.equal(done.json.state,'complete');
    const completed=await owner(e);assert.equal(completed.completion_actor.key,'member:11111111-1111-4111-8111-111111111111');assert.equal(completed.completed_by.key,'member:99999999-9999-4999-8999-999999999999');
    const cards=await rows("select * from public.calendar_posts where client='f44fixture'");assert.equal(cards.length,1);assert.ok(cards[0].video_deliverable_id);assert.ok(cards[0].graphic_deliverable_id);
    assert.equal(completed.payload_json,stable(original(e)));assert.deepEqual(Object.keys(completed.received).sort(),['graphics','video']);
  });
  await check('completion replay reads human edits and keeps native IDs and original F44 pending ledger',async()=>{
    const g=await owner(e),before=await rows('select id from public.deliverables where batch_id='+q((await rows('select batch_id from public.production_intake_manifests where request_id='+q(g.native_request.request_id)))[0].batch_id));
    await sql("update public.calendar_posts set name='Human retained title',caption='Human retained caption' where client='f44fixture'");
    assert.equal((await complete(e,['video','graphics'],smm)).status,200);
    const card=(await rows("select * from public.calendar_posts where client='f44fixture'"))[0];assert.equal(card.name,'Human retained title');assert.equal(card.caption,'Human retained caption');
    assert.deepEqual((await rows('select id from public.deliverables where id in ('+before.map(r=>q(r.id)).join(',')+')')).map(r=>r.id).sort(),before.map(r=>r.id).sort());
    assert.equal((await rows('select distinct status from public.linear_intake_receipts where payload_hash='+q(e.payload_hash)))[0].status,'pending');
  });
  await sql("delete from public.public_intake_log");
  await check('late included team joins the same committed mapping',async()=>{
    const a=envelope();await gw.post(a,{});const r=await complete(a,['video','graphics']);assert.equal(r.status,200,JSON.stringify(r));const id=(await owner(a)).native_request.request_id;
    await gw.post(envelope('graphics',original(a)),{});const g=await owner(a);assert.equal(g.native_request.request_id,id);assert.equal(g.state,'complete');assert.equal(Object.keys(g.received).length,2);
  });
  await check('late excluded team is held without splitting or creating more work',async()=>{
    const a=envelope();await gw.post(a,{});assert.equal((await complete(a)).status,200);const n=await sql('select count(*) from public.deliverables');
    const r=await gw.post(envelope('graphics',original(a)),{});assert.equal(r.status,202);assert.equal((await owner(a)).reason,'late_team_conflict');assert.equal((await complete(a,['video','graphics'])).status,409);assert.equal(await sql('select count(*) from public.deliverables'),n);
  });
  await check('old pending and provider-created receipts are conserved and cannot be recreated',async()=>{
    for(const status of ['pending','created']){const a=envelope();await sql(`insert into public.linear_intake_receipts(receipt_key,payload_hash,client,team,payload_json,status,parent_issue_id,child_issue_ids) values(${q(a.receipt_key)},${q(a.payload_hash)},'F44 Fixture','video',${q(stable(original(a)))},${q(status)},${status==='created'?"'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'":'null'},${q(status==='created'?'["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]':'[]')})`);
      const n=await sql('select count(*) from public.deliverables'),r=await gw.post(a,{});assert.equal(r.status,status==='created'?200:202,JSON.stringify(r));
      if(status==='created')assert.equal(browser._linearConfirmedCreate(r.json,{...a,payload:original(a)}),true);
      assert.equal((await owner(a)).state,'held');assert.equal((await complete(a)).status,409);assert.equal(await sql('select count(*) from public.deliverables'),n);
    }
  });
  await check('native-disabled completion refuses before any provider request',async()=>{
    const a=envelope();await gw.post(a,{});await sql("update public.syncview_runtime_flags set value='{\"video\":{\"enabled\":false,\"epoch\":null},\"graphics\":{\"enabled\":false,\"epoch\":null}}' where key='native_intake_epochs'");
    const r=await complete(a);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.json.error,'legacy_intake_native_epoch_required');
    await sql("update public.syncview_runtime_flags set value='{}' where key='native_intake_epochs'");
    const malformed=await complete(a);assert.equal(malformed.status,503);assert.equal(malformed.json.error,'authority_unavailable');
    await sql("delete from public.syncview_runtime_flags where key='native_intake_epochs'");
    assert.equal((await complete(a)).status,503);
    await sql("insert into public.syncview_runtime_flags(key,value) values('native_intake_epochs','{\"video\":{\"enabled\":true,\"epoch\":\"integrated-video\"},\"graphics\":{\"enabled\":true,\"epoch\":\"integrated-graphics\"}}')");
  });
  await sql('delete from public.public_intake_log');
  await check('lost prepare response reuses the first frozen request and complete response loss is recoverable',async()=>{
    const a=envelope();await gw.post(a,{});hooks.afterRpc=(name,args,result)=>{if(name==='legacy_intake_native_prepare')throw Error('synthetic_lost_prepare');return result;};
    assert.equal((await complete(a)).status,500);resetHooks();const id=(await owner(a)).native_request.request_id;
    hooks.afterRpc=(name,args,result)=>{if(name==='legacy_intake_native_finish')throw Error('synthetic_lost_finish');return result;};
    assert.equal((await complete(a)).status,500);resetHooks();assert.equal((await owner(a)).state,'complete');
    assert.equal((await complete(a, ['video'], smm)).status,200);assert.equal((await owner(a)).native_request.request_id,id);
  });
  await check('late excluded team before root acceptance wins the atomic hold',async()=>{
    const a=envelope();await gw.post(a,{});const before=await sql('select count(*) from public.production_intake_manifests');
    hooks.beforeRpc=async name=>{if(name==='production_intake_root_begin'){hooks.beforeRpc=null;await gw.post(envelope('graphics',original(a)),{});}};
    const r=await complete(a);resetHooks();assert.notEqual(r.json.native_committed,true);assert.ok(r.status>=400);
    assert.equal((await owner(a)).state,'held');assert.equal(await sql('select count(*) from public.production_intake_manifests'),before);
  });
  await check('ordinary current native intake remains automatically accepted under its existing contract',async()=>{
    const r=await gw.post(gw.rootBody('both',gw.requestId('submission'),{client_slug:'f44fixture'}));
    assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.json.native_committed,true);
  });
  await check('inbox keyset paging and service-only owner grants',async()=>{
    const r=await gw.post({action:'legacy_intake_triage_list'});assert.equal(r.status,200);assert.ok(r.json.rows.length>=5);
    const after=r.json.rows[0].payload_hash,next=await gw.post({action:'legacy_intake_triage_list',after});assert.equal(next.status,200);assert.ok(next.json.rows.every(row=>row.payload_hash>after));
    const privileges=await rows("select has_table_privilege('anon','public.legacy_intake_native_triage','SELECT') a,has_table_privilege('authenticated','public.legacy_intake_native_triage','SELECT') b,has_table_privilege('service_role','public.legacy_intake_native_triage','UPDATE') c");assert.deepEqual(privileges[0],{a:false,b:false,c:false});
  });
  await check('new recovery owner byte roundtrip preserves payload, raw envelopes and staff provenance',async()=>{
    const before=await sql("select jsonb_agg(to_jsonb(t) order by payload_hash)::text from public.legacy_intake_native_triage t");
    await sql('create table public.f44_restore_fixture (like public.legacy_intake_native_triage including all)');
    await sql(`insert into public.f44_restore_fixture select * from jsonb_populate_recordset(null::public.f44_restore_fixture,${q(before)}::jsonb)`);
    assert.equal(await sql('select jsonb_agg(to_jsonb(t) order by payload_hash)::text from public.f44_restore_fixture t'),before);
    await sql('truncate public.legacy_intake_native_triage; insert into public.legacy_intake_native_triage select * from public.f44_restore_fixture');
    assert.equal((await complete(e,['video','graphics'],smm)).status,200,'restored mapping resumes against accepted manifest');
    const {compose}=require('./f44-native-recovery-extension'),backup=require('./track-b-backup');
    const base=backup.resolveCorpus('history-v8').tables,extended=compose(base);assert.equal(extended.length,base.length+2);assert.equal(base.some(t=>t.name==='legacy_intake_native_triage'),false);
  });
  await check('all actual handler paths used zero provider or drainer transports',async()=>{assert.deepEqual(gw.net.requests,[]);});
  console.log('F44_NATIVE_RESULT '+JSON.stringify({passed:true,groups:checks.length,externalRequests:gw.net.requests.length}));
}catch(error){fs.writeFileSync(path.join(process.env.F44_NATIVE_OUTPUT,'lane-failure.private.log'),String(error.stack));console.log('F44_NATIVE_RESULT '+JSON.stringify({passed:false,groups:checks.length,failed:checks.at(-1)?.name}));process.exitCode=1;}
finally{fs.writeFileSync(path.join(process.env.F44_NATIVE_OUTPUT,'REPORT.private.json'),JSON.stringify({classification:'ACTUAL_HANDLER_DISPOSABLE_SQL',checks,providerRequests:gw.net.requests.length,source_sha256:sha(fs.readFileSync(path.join(ROOT,'supabase/functions/production-write/index.ts')))},null,2));}
