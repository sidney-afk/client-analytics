'use strict';
const assert = require('assert/strict');
const { makeWorld, pending, resume, gatewayOk } = require('./helpers/native-intake-world');
let failures = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
}
const outage = { status: 503, body: { ok: false, error: 'project_mapping_validation_unavailable' } };
const bytes = job => JSON.stringify(job.payload);
async function main() {
  for (const fault of ['provider outage', 'lost accepted response', 'partial acceptance']) {
    await test(fault + ': fresh realms retain identical request; automatic requests stop; manual recovery completes', async () => {
      let w = makeWorld(); const job = await pending(w), original = bytes(job);
      // Acceptance here is an injected transport boundary, not a fake server.
      // Real partial commit/replay proof remains PR1274 G2b.
      w.gatewayScript.push(fault === 'provider outage' ? outage : { throw: fault });
      assert.equal((await resume(w, 'submit', job)).ok, false);
      let posts = w.gatewayPosts.slice();
      for (let i = 0; i < 9; i++) {
        w = makeWorld({ store: w.store });
        w.gatewayScript.push(outage);
        await resume(w, 'startup');
        posts.push(...w.gatewayPosts);
        assert.ok(w.readJob(), 'recovery must survive every refresh');
        assert.equal(bytes(w.readJob()), original);
      }
      assert.equal(posts.length, 4, 'one live click plus three automatic attempts');
      assert.ok(posts.every(p => JSON.stringify(p) === original));
      w.gatewayScript = [gatewayOk(job)];
      assert.equal((await resume(w, 'manual-recovery')).ok, true);
      assert.equal(JSON.stringify(w.gatewayPosts.at(-1)), original);
      assert.equal(w.cardWrites.length, 2);
      assert.equal(w.readJob(), null);
    });
  }
  await test('accepted recovery retains completed cards across exhaustion and sign-out; resumes remaining only', async () => {
    let w = makeWorld(); const job = await pending(w);
    w.gatewayScript.push(gatewayOk(job)); w.cardFail = p => p.id.endsWith('_2');
    await resume(w, 'submit', job);
    assert.equal(w.readJob().completed_card_ids.length, 1);
    await w.context._linearIntakePurgeSensitiveState();
    for (let i = 0; i < 8; i++) {
      w = makeWorld({ store: w.store }); w.cardFail = () => 'network';
      await resume(w, 'startup');
      assert.equal(w.readJob().result.native_committed, true);
      assert.equal(w.readJob().completed_card_ids.length, 1);
    }
    w.cardFail = () => false;
    assert.equal((await resume(w, 'manual-recovery')).ok, true);
    assert.equal(w.gatewayPosts.length, 0);
    assert.equal(w.cardWrites.length, 1);
    assert.ok(w.cardWrites[0].payload.post.id.endsWith('_2'));
    assert.equal(w.readJob(), null);
  });
  for (const fault of ['lost accepted response', 'partial acceptance']) {
    await test(fault + ' + retries + sign-out: scrubbed unknown marker, never fabricated acceptance/replay', async () => {
      let w = makeWorld(); const job = await pending(w); const id = job.payload.request_id;
      w.gatewayScript.push({ throw: fault }); await resume(w, 'submit', job);
      for (let i=0;i<3;i++) { w.gatewayScript.push(outage); await resume(w,'startup'); }
      await w.context._linearIntakePurgeSensitiveState();
      w = makeWorld({ store: w.store });
      const marker = w.context._linearIntakeUnresolvedRead()[0];
      assert.ok(marker, 'retain metadata instead of mistaking unknown acceptance for a draft');
      assert.equal(marker.payload.request_id, id);
      assert.equal(marker.payload.source_edited_at, job.payload.source_edited_at);
      assert.equal(marker.result, null);
      assert.equal(marker.requires_original_payload, true);
      assert.equal(marker.payload.batch, undefined);
      assert.ok(marker.payload.items.every(i => Object.keys(i).sort().join(',') === 'card_id,team,videoNumber'));
      assert.equal(marker.context.draftSnapshot, undefined);
      assert.equal(w.readJob(), null, 'unknown evidence does not occupy the active slot');
      assert.equal((await resume(w,'manual-recovery',marker)).ok, false);
      assert.equal(w.gatewayPosts.length, 0);
      assert.match(w.context._linearIntakeRecoveryHtml(), /Staff recovery is needed/);
      assert.doesNotMatch(w.context._linearIntakeRecoveryHtml(), /<button/);
    });
  }
  await test('never-sent draft still obeys explicit sign-out purge', async () => {
    const w=makeWorld(); await pending(w); await w.context._linearIntakePurgeSensitiveState(); assert.equal(w.readJob(),null);
  });
  await test('actor switch and public entry cannot replay staff job; original actor and client complete', async () => {
    const w=makeWorld(); const job=await pending(w);
    w.gatewayScript.push(gatewayOk(job));
    w.onGatewayResponse=()=> { w.identity={role:'admin',member:{id:'actor-b'}}; };
    assert.equal((await resume(w,'submit',job)).ok,false);
    assert.equal(w.cardWrites.length,0);
    assert.equal(w.context._linearIntakeRecoveryHtml(), '');
    w.context._isIntake=true;
    assert.equal((await resume(w,'manual-recovery')).ok,false);
    w.context._isIntake=false; w.onGatewayResponse=null; w.identity={role:'admin',member:{id:'actor-a'}};
    assert.equal(w.context._linearIntakeRecoveryHtml('fixture-other'), '');
    w.context.calState.client='fixture-other';
    assert.equal((await resume(w,'manual-recovery')).ok,true);
    assert.equal(w.gatewayPosts.length,1);
    assert.ok(w.cardWrites.every(c=>c.slug==='fixture-client'));
    assert.equal(w.context.calState.posts.length,0);
  });
  await test('duplicate clicks share request; different payload does not replace it', async () => {
    const w=makeWorld(); const job=await pending(w); const again=await pending(w);
    assert.equal(bytes(job),bytes(again));
    await assert.rejects(pending(w,'new-edits'), /pending_conflict/);
    w.gatewayScript.push(gatewayOk(job));
    const results=await Promise.all([resume(w,'submit',job),resume(w,'submit',job)]);
    assert.ok(results.every(r=>r.ok)); assert.equal(w.gatewayPosts.length,1);
  });
  await test('Samples uses the same retained result and completed-card checkpoint through sign-out and recovery', async () => {
    let w=makeWorld(); const job=await pending(w,'sample',{surface:'sxr',materialization_source:'samples-native'});
    job.payload.surface='sxr'; w.context._linearIntakeWrite(job);
    let writes=[];
    const setup=world=>{
      world.context._sxrCacheRead=()=>({posts:[]});
      world.context._sxrUpsertFetch=async(slug,payload)=>{
        writes.push(payload.sample.id); const fail=world.cardFail(payload.sample);
        return {ok:!fail,json:async()=>({ok:!fail})};
      };
    };
    setup(w); w.cardFail=p=>p.id.endsWith('_2'); w.gatewayScript.push(gatewayOk(job));
    await resume(w,'samples-create-post',job);
    assert.equal(w.readJob().completed_card_ids.length,1);
    await w.context._linearIntakePurgeSensitiveState();
    w=makeWorld({store:w.store}); setup(w);
    assert.equal((await resume(w,'manual-recovery')).ok,true);
    assert.equal(w.gatewayPosts.length,0); assert.equal(writes.length,3);
    assert.equal(writes[1],writes[2]); assert.equal(w.readJob(),null);
  });
  await test('unreadable storage cannot overwrite an older record or dispatch', async () => {
    const w=makeWorld(); await pending(w); const raw=w.store.get(w.context.NATIVE_INTAKE_PENDING_KEY);
    w.readUnavailable=true; await assert.rejects(pending(w,'another'), /storage_unavailable/);
    assert.equal(w.store.get(w.context.NATIVE_INTAKE_PENDING_KEY),raw); assert.equal(w.gatewayPosts.length,0);
    w.readUnavailable=false;
    w.store.set(w.context.NATIVE_INTAKE_PENDING_KEY,'{broken');
    await assert.rejects(pending(w,'another'), /storage_unavailable/);
    assert.equal(w.store.get(w.context.NATIVE_INTAKE_PENDING_KEY),'{broken');
  });
  await test('storage fails after acceptance: original durable payload recovers after refresh', async () => {
    let w=makeWorld(); const job=await pending(w), original=bytes(job);
    w.gatewayScript.push(gatewayOk(job)); w.onGatewayResponse=()=>{w.quotaExceeded=true;};
    assert.equal((await resume(w,'submit',job)).ok,false); assert.equal(w.cardWrites.length,0);
    w=makeWorld({store:w.store}); w.gatewayScript.push(gatewayOk(job));
    assert.equal((await resume(w,'manual-recovery')).ok,true);
    assert.equal(JSON.stringify(w.gatewayPosts[0]),original);
  });
  await test('quota failure before first dispatch sends nothing', async () => {
    const w=makeWorld(); w.quotaExceeded=true; await assert.rejects(pending(w),/storage_unavailable/); assert.equal(w.gatewayPosts.length,0);
  });
  await test('anonymous retry never replaces its original draft snapshot with newer edits', async () => {
    const w=makeWorld(); w.context._isIntake=true; w.identity=null;
    const job=await pending(w,'same',{draftSnapshot:{form_raw:'original'}});
    const again=await pending(w,'same',{draftSnapshot:{form_raw:'new'}});
    assert.equal(again.context.draftSnapshot.form_raw,'original'); assert.equal(bytes(again),bytes(job));
  });
  await test('sign-out storage failure honors privacy (server recovery remains unproven)', async () => {
    const w=makeWorld(); const job=await pending(w); w.gatewayScript.push({throw:'partial'});
    await resume(w,'submit',job); w.quotaExceeded=true;
    await w.context._linearIntakePurgeSensitiveState();
    assert.equal(w.readJob(),null); assert.ok(w.notifications.length>0);
  });
  await test('P1: uncertain A/sign-out permits B unrelated work; A returns to scoped duplicate protection', async () => {
    const w=makeWorld(); const a=await pending(w,'original-a');
    w.gatewayScript.push({throw:'partial acceptance'});await resume(w,'submit',a);
    await w.context._linearIntakePurgeSensitiveState();
    w.identity={role:'admin',member:{id:'actor-b'}};
    const b=await pending(w,'unrelated-b',{clientSlug:'fixture-other'});
    assert.equal(w.context._linearIntakeRecoveryHtml('fixture-client'),'');
    assert.doesNotMatch(w.context._linearIntakeRecoveryHtml(),/Request details were cleared/);
    w.gatewayScript.push(gatewayOk(b));assert.equal((await resume(w,'submit',b)).ok,true);
    assert.equal(w.gatewayPosts.at(-1).client_slug,'fixture-other');
    const markers=w.context._linearIntakeUnresolvedRead();assert.equal(markers.length,1);
    assert.equal(markers[0].payload.request_id,a.payload.request_id);
    assert.equal(markers[0].payload.source_edited_at,a.payload.source_edited_at);
    assert.equal(markers[0].result,null);assert.equal(markers[0].context.draftSnapshot,undefined);
    assert.equal(markers[0].payload.batch,undefined);assert.equal(w.readJob(),null);
    w.identity={role:'admin',member:{id:'actor-a'}};
    await assert.rejects(pending(w,'new-signature-same-client'),/native_intake_recovery_pending/);
    await assert.rejects(pending(w,'original-a'),/native_intake_recovery_pending/);
    assert.match(w.context._linearIntakeRecoveryHtml('fixture-client'),/Staff recovery is needed/);
    assert.doesNotMatch(w.context._linearIntakeRecoveryHtml('fixture-client'),/<button/);
    const sent=w.gatewayPosts.length;
    assert.equal((await resume(w,'manual-recovery',markers[0])).ok,false);
    assert.equal(w.gatewayPosts.length,sent);
  });
  await test('multiple unknown markers survive refresh; same actor can work for another client without exposing foreign markers', async () => {
    let w=makeWorld();const ids=[];
    for(const slug of ['fixture-client','fixture-second']){
      const job=await pending(w,slug,{clientSlug:slug});ids.push(job.payload.request_id);
      w.gatewayScript.push({throw:'unknown'});await resume(w,'submit',job);
      await w.context._linearIntakePurgeSensitiveState();
    }
    w=makeWorld({store:w.store});
    const markers=w.context._linearIntakeUnresolvedRead();assert.deepEqual(Array.from(markers,m=>m.payload.request_id),ids);
    assert.equal(markers.length,2);assert.equal(w.readJob(),null);
    assert.equal((w.context._linearIntakeRecoveryHtml().match(/Staff recovery is needed/g)||[]).length,2);
    assert.equal((w.context._linearIntakeRecoveryHtml('fixture-second').match(/Staff recovery is needed/g)||[]).length,1);
    for(const slug of ['fixture-client','fixture-second'])await assert.rejects(pending(w,'different',{clientSlug:slug}),/recovery_pending/);
    w.identity={role:'admin',member:{id:'actor-b'}};assert.equal(w.context._linearIntakeRecoveryHtml(),'');
    const b=await pending(w,'unrelated',{clientSlug:'fixture-third'});w.gatewayScript.push(gatewayOk(b));
    assert.equal((await resume(w,'submit',b)).ok,true);assert.equal(w.context._linearIntakeUnresolvedRead().length,2);
  });
  for(const fault of ['throw','lost write'])await test('archive '+fault+' keeps old evidence and scrubbed active fallback; retry safely migrates it', async()=>{
    const w=makeWorld();const first=await pending(w,'a');w.gatewayScript.push({throw:'unknown'});await resume(w,'submit',first);
    await w.context._linearIntakePurgeSensitiveState();
    const key=w.context.NATIVE_INTAKE_PENDING_KEY+':unresolved', prior=w.store.get(key);
    w.identity={role:'admin',member:{id:'actor-b'}};
    const second=await pending(w,'b',{clientSlug:'fixture-other'});w.gatewayScript.push({throw:'unknown'});await resume(w,'submit',second);
    const set=w.context.localStorage.setItem;
    w.context.localStorage.setItem=(k,v)=>{if(k===key){if(fault==='throw')throw new Error('fixture quota');return;}set(k,v);};
    await w.context._linearIntakePurgeSensitiveState();
    assert.equal(w.store.get(key),prior);
    assert.equal(w.readJob().payload.request_id,second.payload.request_id);
    assert.equal(w.readJob().requires_original_payload,true);assert.equal(w.readJob().payload.batch,undefined);
    w.identity={role:'admin',member:{id:'actor-c'}};
    const count=w.gatewayPosts.length;
    await assert.rejects(pending(w,'c',{clientSlug:'fixture-third'}));
    assert.equal(w.gatewayPosts.length,count);assert.equal(w.store.get(key),prior);
    w.context.localStorage.setItem=set;
    const third=await pending(w,'c',{clientSlug:'fixture-third'});
    assert.equal(w.context._linearIntakeUnresolvedRead().length,2);
    assert.equal(w.readJob().payload.request_id,third.payload.request_id);
    assert.notEqual(third.payload.request_id,second.payload.request_id);
  });
  await test('unreadable archive fails safely without overwriting evidence or dispatching',async()=>{
    const w=makeWorld(), key=w.context.NATIVE_INTAKE_PENDING_KEY+':unresolved';
    w.store.set(key,'{broken');await assert.rejects(pending(w),/storage_unavailable/);
    assert.equal(w.store.get(key),'{broken');assert.equal(w.gatewayPosts.length,0);
    assert.match(w.context._linearIntakeRecoveryHtml(),/cannot be read/);
  });
  await test('prior-head unknown marker migrates from the global slot before unrelated work',async()=>{
    const w=makeWorld();const a=await pending(w);w.gatewayScript.push({throw:'unknown'});await resume(w,'submit',a);
    w.context._linearIntakePersistRecovery(w.readJob());
    assert.equal(w.readJob().requires_original_payload,true);
    w.identity={role:'admin',member:{id:'actor-b'}};
    const b=await pending(w,'new-b',{clientSlug:'fixture-other'});
    assert.equal(w.context._linearIntakeUnresolvedRead()[0].payload.request_id,a.payload.request_id);
    assert.equal(w.readJob().payload.request_id,b.payload.request_id);
  });
  await test('P2: legacy accepted job remains paused through repeated sign-out; no automatic card writes',async()=>{
    const w=makeWorld();const job=await pending(w);w.gatewayScript.push(gatewayOk(job));w.cardFail=()=>true;
    await resume(w,'submit',job);
    const legacy=w.readJob();delete legacy.automatic_attempts;legacy.resume_refusals=3;w.context._linearIntakeWrite(legacy);
    const writes=w.cardWrites.length;
    assert.equal((await resume(w,'startup')).error.code,'native_intake_recovery_paused');
    for(let i=0;i<3;i++){
      await w.context._linearIntakePurgeSensitiveState();assert.equal(w.readJob().automatic_attempts,3);
      assert.equal((await resume(w,'startup')).error.code,'native_intake_recovery_paused');
      assert.equal(w.cardWrites.length,writes);
    }
    w.cardFail=()=>false;assert.equal((await resume(w,'manual-recovery')).ok,true);
    assert.equal(w.gatewayPosts.length,1);
  });
  await test('current budget survives unknown archival; failed attempt checkpoint still sends nothing',async()=>{
    const w=makeWorld();const job=await pending(w);w.gatewayScript.push({throw:'unknown'});await resume(w,'submit',job);
    for(let i=0;i<3;i++)await resume(w,'startup');
    for(let i=0;i<3;i++)await w.context._linearIntakePurgeSensitiveState();
    const markers=w.context._linearIntakeUnresolvedRead();assert.equal(markers.length,1);assert.equal(markers[0].automatic_attempts,3);
    assert.equal(markers[0].result,null);assert.equal(markers[0].payload.batch,undefined);
    const w2=makeWorld();await pending(w2);w2.quotaExceeded=true;await resume(w2,'startup');
    assert.equal(w2.gatewayPosts.length,0);assert.equal(w2.readJob().automatic_attempts,0);
  });
  console.log(`${passed} preservation checks passed; ${failures} failed.`);
  console.log('UNPROVEN: exact recovery after uncertain sign-out or loss of browser storage requires a server-owned request/recovery record.');
  process.exitCode=failures?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
