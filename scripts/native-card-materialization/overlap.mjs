// Finite overlaps prove locks through pg_stat_activity, not Promise.all alone.
import {gw,accepted,emitted,call,sql,rows} from './fixture.mjs';
import {runSql,hooks,resetHooks} from '../native-intake-manifest/supabase-shim.mjs';
const q=v=>"'"+String(v).replace(/'/g,"''")+"'";
async function waitFor(name,event){
  for(let i=0;i<80;i++){
    const found=await rows(`select wait_event_type,wait_event from pg_stat_activity where application_name=${q(name)}`);
    if(found.some(r=>r.wait_event_type===event))return;
    await new Promise(r=>setTimeout(r,25));
  }
  throw new Error('real_session_barrier_not_observed');
}
const materializeSql=c=>`select public.production_card_materialize(${q(c.surface)},${q(c.source)},${q(JSON.stringify(c.body))})::text;`;
export async function additional(check,facts){
  // Two actual gateway callers pause before the same real root RPC. This is a
  // fresh native intake, not a simulated returned-row fixture.
  const body=gw.rootBody('both',gw.requestId());let arrived=0,release;
  const gate=new Promise(r=>release=r);
  hooks.beforeRpc=async name=>{if(name==='production_intake_root_begin'){if(++arrived===2)release();await gate;}};
  const responses=await Promise.all([gw.post(body),gw.post(body)]);resetHooks();
  check('two real gateways accept one immutable request',responses.every(r=>r.status===201)&&arrived===2);
  const c=await emitted(body,responses[0]);const id=c.body.post.id;
  const blocker=runSql(`set application_name='native_card_blocker';begin;select pg_advisory_xact_lock(hashtextextended('card-materialization:calendar:'||${q(c.body.client)}||':'||${q(id)},0));select pg_sleep(3);commit;`);
  await waitFor('native_card_blocker','Timeout');
  const first=runSql("set application_name='native_card_first';set role service_role;"+materializeSql(c));
  const second=runSql("set application_name='native_card_second';set role service_role;"+materializeSql(c));
  await waitFor('native_card_first','Lock');await waitFor('native_card_second','Lock');
  const results=await Promise.all([first,second,blocker]);
  const outputs=results.slice(0,2).map(r=>r.status===0?JSON.parse(r.stdout.trim()):null);
  check('overlapping materializers wait then create once and replay once',outputs.every(r=>r?.ok)&&outputs.map(r=>r.outcome).sort().join(',')==='created,replayed'
    &&(await rows(`select id from public.production_card_materialization_receipts where card_id=${q(id)}`)).length===1);
  // Real binder holds the SAME card row before validating its provider-era
  // identity. Native card links are blank, so its existing refusal is retained.
  const hold=runSql(`set application_name='native_card_binder_hold';begin;select id from public.calendar_posts where client=${q(c.body.client)} and id=${q(id)} for update;select pg_sleep(3);commit;`);
  await waitFor('native_card_binder_hold','Timeout');
  const bind={source_surface:'calendar',client_slug:c.body.client,card_id:id,component:'video',deliverable_id:c.body.post.video_deliverable_id};
  const binder=runSql(`set application_name='native_card_real_binder';set role service_role;select public.production_comment_card_bind_and_import(${q(JSON.stringify(bind))}::jsonb,'[]','{}');`);
  const replay=runSql("set application_name='native_card_binder_replay';set role service_role;"+materializeSql(c));
  await waitFor('native_card_real_binder','Lock');await waitFor('native_card_binder_replay','Lock');
  const before=await facts();const r=await Promise.all([binder,replay,hold]);
  check('real binder and replay serialize card-first without mutation or deadlock',r[0].status!==0&&/crosswalk_bind/.test(r[0].stderr)&&r[1].status===0&&JSON.parse(r[1].stdout.trim()).ok&&before===await facts());
  // Positive binder canary: explicit later provider linkage in a fictional
  // row is not inferred from the native marker and invokes the actual binder.
  await sql(`update public.deliverables set linear_identifier='VID-991' where id=${q(c.body.post.video_deliverable_id)};
    update public.calendar_posts set linear_issue_id='VID-991' where client=${q(c.body.client)} and id=${q(id)};`);
  const bound=await runSql(`set role service_role;select public.production_comment_card_bind_and_import(${q(JSON.stringify(bind))}::jsonb,'[]','{}');`);
  check('real binder retains its verified provider-identity positive path',bound.status===0);
  // A changed child commits while the materializer is waiting. The test sees
  // the actual child lock wait, and requires the POST to reject the new facts.
  const changed=await accepted('both');const child=changed.body.post.graphic_deliverable_id;
  const mutate=runSql(`set application_name='native_card_child_mutator';begin;update public.deliverables set card_id=null where id=${q(child)};select pg_sleep(3);commit;`);
  await waitFor('native_card_child_mutator','Timeout');
  const pending=runSql("set application_name='native_card_child_waiter';set role service_role;"+materializeSql(changed));
  await waitFor('native_card_child_waiter','Lock');
  const cr=await pending;await mutate;const changedResult=cr.status===0?JSON.parse(cr.stdout.trim()):{};
  check('complete child set is rechecked after actual lock wait',!changedResult.ok&&changedResult.conserved&&changedResult.reason==='accepted_children_incomplete'
    &&(await rows(`select id from public.calendar_posts where id=${q(changed.body.post.id)}`)).length===0);
  // Original before-child2 failure. Build the endpoint envelope using the real
  // browser validator over immutable manifest rows as a declared test seam;
  // no production response is claimed for the missing accepted child.
  const partial=await accepted('both','calendar',2);const m=(await rows('select * from public.production_intake_manifests where request_id='+q(partial.body.request_id)))[0];
  check('original gateway interruption commits manifest and only child1',partial.response.status>=500&&m.expected_items.length===2
    &&(await rows('select id from public.deliverables where batch_id='+q(m.batch_id))).length===1);
  const fakeResult={status:201,json:{ok:true,native_committed:true,items:m.expected_items.map(i=>({item_index:i.item_index,video_number:i.video_number,...i.row}))}};
  const incomplete=await emitted(partial.body,fakeResult);const missing=await call(incomplete.body);
  check('two-item incomplete root cannot masquerade as complete smaller request',!missing.ok&&missing.reason==='accepted_children_incomplete');
  const one=await accepted('video');check('complete one-item root remains independently acceptable',(await call(one.body)).ok);
  // Current authority and admission are separate from original accepted epochs.
  const held=await accepted('video');await sql("update public.syncview_runtime_flags set value='{\"video\":\"linear\",\"graphics\":\"syncview\"}' where key='prod_authority';");
  const h=await call(held.body);check('current F27 authority refuses fresh card without provider fallback',!h.ok&&h.reason==='f27_held');
  await sql("update public.syncview_runtime_flags set value='{\"video\":\"syncview\",\"graphics\":\"syncview\"}' where key='prod_authority';");
  await sql("update public.syncview_runtime_flags set value=value||'{\"mode\":\"hold\"}'::jsonb where key='native_card_materialization';");
  check('admission hold preserves exact accepted current-row replay',(await call(one.body)).ok);
  check('admission hold refuses fresh accepted work visibly',!(await call(held.body)).ok);
  await sql("update public.syncview_runtime_flags set value=value||'{\"mode\":\"native\",\"epoch\":\"synthetic-coverage-v2\"}'::jsonb where key='native_card_materialization';");
  check('changed coverage epoch does not reinterpret original receipt',(await call(one.body)).ok);
  const tz=await runSql("set timezone='Pacific/Honolulu';set role service_role;"+materializeSql(one));
  check('session timezone cannot change immutable manifest receipt identity',tz.status===0&&JSON.parse(tz.stdout.trim()).ok);
  const advanced=await accepted('video');await sql(`update public.deliverables set status='canceled' where id=${q(advanced.body.post.video_deliverable_id)};`);
  const ar=await call(advanced.body);check('later native lifecycle change holds fresh initial card',!ar.ok&&ar.reason==='native_lifecycle_held');
  const ancient=await accepted('video');await sql("update public.syncview_runtime_flags set value=jsonb_set(value,'{covered_from}',to_jsonb(clock_timestamp()+interval '1 second')) where key='native_card_materialization';");
  const old=await call(ancient.body);check('accepted request older than proven coverage stays held',!old.ok&&old.reason==='coverage_unproven');
}
