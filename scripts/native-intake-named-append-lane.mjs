// Actual restored-target SQL plus the pinned merged naming policy. The older
// gateway seam supplies native route arguments; it is not new-handler proof.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
import {gw,sql,rows} from './native-card-materialization/fixture.mjs';
import {hooks,resetHooks,runSql} from './native-intake-manifest/supabase-shim.mjs';
const policy=await import(pathToFileURL(process.env.NAMED_APPEND_POLICY).href),root=path.resolve(''),q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb',sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const saved=JSON.parse(fs.readFileSync(process.env.NAMED_APPEND_SEED,'utf8')),batchId=saved.group.native_request.batch.id||saved.group.native_request.batch_id||saved.group.native_request.request_id;
const actualBatchId=await sql(`select batch_id from public.production_intake_manifests where request_id=${q(saved.group.native_request.request_id)}`);
const batch=async()=> (await rows('select * from public.batches where id='+q(actualBatchId)))[0];
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);};
let sequence=0;
async function appendArgs(mode='both',name=''){
  const b=await batch(),body=gw.rootBody(mode,'submission:'+crypto.randomUUID(),{client_slug:b.client_slug});delete body.batch;
  body.batch_id=b.id;body.expected_batch_updated_at=b.updated_at;if(name)body.items[0].name=name;
  let args;hooks.beforeRpc=(rpc,a)=>{if(rpc==='production_intake_append'){args=structuredClone(a);throw Error('capture_trusted_native_plan_before_SQL');}};
  const reply=await gw.post(body);resetHooks();assert.ok(reply.status>=400);assert.ok(args,'actual gateway reached append RPC');
  const existing=await rows('select * from public.deliverables where batch_id='+q(b.id));
  const planned=policy.planAppendIntakeItems(existing,body.items,args.p_rows.map(r=>r.id),b.purpose);
  args.p_rows=args.p_rows.map((r,i)=>({...r,title:planned[i].title,sort_key:planned[i].sort_key,_intake_ordinal:planned[i]._intake_ordinal}));
  args.p_events=args.p_events.map((e,i)=>({...e,outbound:{...e.outbound,payload:{...e.outbound.payload,title:planned[i].title,_intent_fingerprint:sha(JSON.stringify({body,row:args.p_rows[i]}))}}}));
  return {args,body,planned};
}
function call(a){return `set role service_role;select public.production_intake_append(${q(a.p_batch_id)},${q(a.p_expected_updated_at)}::timestamptz,${j(a.p_rows)},${j(a.p_events)})::text`;}
const run=async a=>JSON.parse(await sql(call(a)));
const count=async()=>sql('select count(*) from public.deliverables where batch_id='+q(actualBatchId));
try{
  const predecessor=fs.readFileSync(path.join(root,'migrations/2026-09-05-native-only-intake.sql'),'utf8');
  const from=predecessor.indexOf('create or replace function public.production_intake_append('),to=predecessor.indexOf('-- Compatibility replacement of 2026-08-31-production-component-fill.sql');
  assert.ok(from>0&&to>from);await sql('begin;\n'+predecessor.slice(from,to)+'\ncommit;');
  const first=await appendArgs('both','Launch hook');
  await check('restored native-only predecessor rejects named append without changing work',async()=>{
    const before=await count(),r=await runSql(call(first.args));assert.notEqual(r.status,0);assert.match(r.stderr,/invalid_intake_append_order/);assert.equal(await count(),before);
  });
  await sql(fs.readFileSync(process.env.NAMED_APPEND_V8,'utf8'));
  await check('main naming predecessor alone refuses native parent route',async()=>{
    const r=await runSql(call(first.args));assert.notEqual(r.status,0);assert.match(r.stderr,/invalid_intake_append_route/);
  });
  await sql(fs.readFileSync(path.join(root,'migrations/2026-09-07-native-intake-named-append.sql'),'utf8'));
  await check('hybrid accepts paired named native append with terminal native receipts',async()=>{
    const r=await run(first.args);assert.equal(r.replay,false);assert.equal(r.items.length,2);
    assert.deepEqual(r.items.map(x=>x.title),Array.from(first.planned,x=>x.title));assert.ok(r.items.every(x=>x.title.endsWith(' — Launch hook')));
    const receipts=await rows('select * from public.mirror_outbox where entity_id in ('+r.items.map(x=>q(x.id)).join(',')+')');assert.equal(receipts.length,2);assert.ok(receipts.every(x=>x.status==='skipped'&&x.linear_result.native_only===true));
  });
  await check('exact retry keeps IDs titles receipt count and original identity; changed identity refuses',async()=>{
    const before=await count(),r=await run(first.args);assert.equal(r.replay,true);assert.equal(await count(),before);
    assert.deepEqual(r.items.map(x=>x.id),first.args.p_rows.map(x=>x.id));
    const changed=structuredClone(first.args);changed.p_events[0].outbound.payload._intent_fingerprint=sha('different original requested name');
    const refused=await runSql(call(changed));assert.notEqual(refused.status,0);assert.match(refused.stderr,/idempotency_conflict/);assert.equal(await count(),before);
  });
  const second=await appendArgs('both','Second post');
  await check('next named pair consumes the previous named ordinal and preserves team kinds',async()=>{
    assert.equal(second.planned[0]._intake_ordinal,first.planned[0]._intake_ordinal+1);const r=await run(second.args);
    assert.ok(r.items.find(x=>x.team==='video').title.startsWith('Video '));assert.ok(r.items.find(x=>x.team==='graphics').title.startsWith('Thumbnail '));assert.ok(r.items.every(x=>x.title.endsWith(' — Second post')));
  });
  const unnamed=await appendArgs('video');
  await check('unnamed single-component append retains bare title and next ordinal',async()=>{
    assert.equal(unnamed.planned[0]._intake_ordinal,second.planned[0]._intake_ordinal+1);const r=await run(unnamed.args);assert.match(r.items[0].title,/^Video [1-9][0-9]*$/);
  });
  const invalid=await appendArgs('video','Refuse');
  await check('wrong ordinal wrong kind and empty name suffix are refused atomically',async()=>{
    const before=await count();for(const mutate of [a=>a.p_rows[0]._intake_ordinal++,a=>a.p_rows[0].title='Thumbnail '+a.p_rows[0]._intake_ordinal+' — Refuse',a=>a.p_rows[0].title='Video '+a.p_rows[0]._intake_ordinal+' — ']){
      const a=structuredClone(invalid.args);mutate(a);const r=await runSql(call(a));assert.notEqual(r.status,0);assert.match(r.stderr,/invalid_intake_append_order/);assert.equal(await count(),before);
    }
  });
  const solo=await appendArgs('video','Shared name'),created=await run(solo.args),sibling=created.items[0];
  // Synthetic card fixture only; the tested operation below is the real fill RPC.
  await sql(`insert into public.calendar_posts(id,client,status,video_deliverable_id) values(${q(sibling.card_id)},${q(sibling.client_slug)},'In Progress',${q(sibling.id)});`);
  await check('named missing component keeps the sibling name and native route on fill and retry',async()=>{
    const body={operation:'component_fill',surface:'calendar',client_slug:sibling.client_slug,request_id:'calendar:'+crypto.randomUUID(),card_id:sibling.card_id,sibling_id:sibling.id,team:'graphics'};
    let args;hooks.beforeRpc=(rpc,a)=>{if(rpc==='production_component_fill'){args=structuredClone(a);throw Error('capture_native_fill');}};
    await gw.post(body);resetHooks();assert.ok(args);args.p_row.title=policy.componentFillTitle(sibling.title,'graphics','calendar');args.p_event.outbound.payload.title=args.p_row.title;args.p_event.outbound.payload._intent_fingerprint=sha(JSON.stringify({body,row:args.p_row}));
    const statement=`set role service_role;select public.production_component_fill(${q(args.p_batch_id)},${q(args.p_expected_updated_at)}::timestamptz,${q(args.p_sibling_id)},${j(args.p_row)},${j(args.p_event)})::text`;
    const r=JSON.parse(await sql(statement)),retry=JSON.parse(await sql(statement));assert.equal(r.replay,false);assert.equal(retry.replay,true);assert.equal(r.item.title,'Thumbnail '+solo.planned[0]._intake_ordinal+' — Shared name');assert.equal(retry.item.id,r.item.id);
  });
  const provider=gw.net.requests.filter(r=>/api\.linear\.app|linear-outbound/.test(r.url));assert.equal(provider.length,0);
  const report={status:'PASS',classification:'ACTUAL_RESTORED_TARGET_SQL_WITH_PINNED_NAMING_POLICY',passed:checks.length,checks,provider_attempts:0,
    policy_sha256:sha(fs.readFileSync(process.env.NAMED_APPEND_POLICY)),migration_sha256:sha(fs.readFileSync(path.join(root,'migrations/2026-09-07-native-intake-named-append.sql'))),
    limits:['Separate subsequent schema/append proof; older authenticated v9 package does not include these accepted appends or final hybrid','Actual merged policy and SQL; gateway route fixture predates merged named-handler behavior','No live install provider call or object recovery']};
  fs.writeFileSync(path.join(process.env.NAMED_APPEND_OUTPUT,'REPORT.private.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:'PASS',passed:checks.length,provider_attempts:0}));
}catch(e){resetHooks();fs.writeFileSync(path.join(process.env.NAMED_APPEND_OUTPUT,'FAILURE.private.log'),String(e.stack));console.log(JSON.stringify({status:'FAIL',passed:checks.length}));process.exitCode=1;}
