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
      const marker = w.readJob();
      assert.ok(marker, 'retain metadata instead of mistaking unknown acceptance for a draft');
      assert.equal(marker.payload.request_id, id);
      assert.equal(marker.payload.source_edited_at, job.payload.source_edited_at);
      assert.equal(marker.result, null);
      assert.equal(marker.requires_original_payload, true);
      assert.equal(marker.payload.batch, undefined);
      assert.ok(marker.payload.items.every(i => Object.keys(i).sort().join(',') === 'card_id,team,videoNumber'));
      assert.equal(marker.context.draftSnapshot, undefined);
      assert.equal((await resume(w,'manual-recovery')).ok, false);
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
  console.log(`${passed} preservation checks passed; ${failures} failed.`);
  console.log('UNPROVEN: exact recovery after uncertain sign-out or loss of browser storage requires a server-owned request/recovery record.');
  process.exitCode=failures?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
