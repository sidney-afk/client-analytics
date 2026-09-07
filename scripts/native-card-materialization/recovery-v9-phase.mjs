// Isolated actual-handler/SQL continuity proof. Synthetic media identities are
// ledger fixtures only: this module neither creates nor recovers object bytes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {gw,sql,rows} from './fixture.mjs';
import {runSql} from '../native-intake-manifest/supabase-shim.mjs';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const owner=async hash=>(await rows('select * from public.legacy_intake_native_triage where payload_hash='+q(hash)))[0];
const complete=async hash=>gw.post({action:'legacy_intake_triage_complete',payload_hash:hash,revision:Number((await owner(hash)).revision),intended_teams:['video','graphics'],confirm:'CONFIRM_ORIGINAL_SUBMISSION_TEAMS'});
function envelope(title,team='video'){
  const payload={clientName:'Recovery F44 Fixture',filmingPlans:'Original filming plan',notes:'Retain original café\nVideo 1 notes: intact',title,videos:[{number:1,main_cam:'Main',side_cam:'Side',audio:'Audio',dueDate:null}]};
  const canonical=stable(payload),hash=sha(canonical),key=`linear-intake-v1:${team}:${hash}`;
  return {canonical,hash,key,body:{...payload,team,payload_hash:hash,receipt_key:key,idempotency_key:key}};
}
async function receive(e){
  const raw=' {\n '+JSON.stringify(e.body).slice(1,-1)+'\n} ';
  const response=await gw.handler(new Request('http://gateway.fixture.invalid/functions/v1/production-write?action=legacy_intake_receive',{method:'POST',headers:{'content-type':'application/json'},body:raw}));
  assert.equal(response.status,202,JSON.stringify(await response.json()));return raw;
}
let result={};
if(process.env.CARD_MATERIALIZATION_PHASE==='seed'){
  await sql(`insert into public.clients select (jsonb_populate_record(null::public.clients,(select to_jsonb(c)||'{"slug":"recovery-f44","display_name":"Recovery F44 Fixture"}'::jsonb from public.clients c where slug='fixture-client'))).*;
    update public.syncview_runtime_flags set value='{"enabled":true}' where key='public_intake_enabled';
    update public.syncview_runtime_flags set value=value||'{"mode":"native","epoch":"recovery-v9"}'::jsonb where key='native_card_materialization';`);
  const accepted=envelope('Recovery accepted'),rawVideo=await receive(accepted),rawGraphics=await receive(envelope('Recovery accepted','graphics'));
  const done=await complete(accepted.hash);assert.equal(done.status,200,JSON.stringify(done));assert.equal(done.json.state,'complete');
  await sql("update public.calendar_posts set name='Retained F44 human title',caption='Retained caption' where client='recovery-f44'");
  const pending=envelope('Recovery pending');await receive(pending);
  const debt=envelope('Recovery old provider debt');
  await sql(`insert into public.linear_intake_receipts(receipt_key,payload_hash,client,team,payload_json) values(${q(debt.key)},${q(debt.hash)},'Recovery F44 Fixture','video',${q(debt.canonical)});`);
  const card=(await rows("select * from public.calendar_posts where client='recovery-f44'"))[0];
  const id='99999999-0000-4000-8000-000000000009',content=sha('synthetic ledger identity; no object claim');
  for(const [offset,state] of [[0,'verified'],[20,'pending'],[40,'held']]){
    const record={id:offset===0?id:crypto.randomUUID(),deliverable_id:card.video_deliverable_id,source_kind:'native_brief',source_entity_id:card.video_deliverable_id,client_slug:'recovery-f44',team:'video',source_updated_at:'2026-09-07T00:00:00Z',source_sha256:sha('synthetic original brief'),source_offset:offset,source_length:12,original_url_sha256:sha('synthetic URL '+offset),audience:'staff',state,source_receipt_sha256:sha('synthetic source receipt')};
    if(state==='verified')Object.assign(record,{content_sha256:content,readback_sha256:content,storage_path:content+'/'+id,byte_length:31,mime_type:'image/png',verified_at:'2026-09-07T00:00:00Z'});
    await sql(`set role service_role;insert into public.native_brief_media_occurrences select (jsonb_populate_record(null::public.native_brief_media_occurrences,${q(JSON.stringify({...record,created_at:'2026-09-07T00:00:00Z'}))}::jsonb)).*;`);
  }
  const deferred={contract:'native_brief_owner_deferred_v1',id:card.video_deliverable_id,client_slug:'recovery-f44',team:'video',source_status:'posted',original_url_sha256:sha('synthetic deferred URL'),content_sha256:sha('synthetic deferred content'),byte_length:52428801,owner_receipt_sha256:sha('synthetic private owner receipt')};
  await sql(`update public.syncview_runtime_flags set value=value||${q(JSON.stringify({owner_deferred_references:[deferred],synthetic_preserved_field:'retain'}))}::jsonb where key='native_brief_media';
    update public.syncview_runtime_flags set value=value||'{"mode":"hold"}'::jsonb where key='native_card_materialization';`);
  assert.equal(Number(await sql("select count(*) from public.public_intake_log where client_slug='recovery-f44'")),3);
  result={accepted,pending,debt,rawVideo,rawGraphics,card,group:await owner(accepted.hash),media:await rows('select * from public.native_brief_media_occurrences order by id'),flag:(await rows("select value from public.syncview_runtime_flags where key='native_brief_media'"))[0].value};
}else if(process.env.CARD_MATERIALIZATION_PHASE==='replay'){
  const saved=JSON.parse(fs.readFileSync(process.env.CARD_MATERIALIZATION_PHASE_SEED,'utf8'));
  assert.deepEqual(await owner(saved.accepted.hash),saved.group);
  assert.deepEqual(await rows('select * from public.native_brief_media_occurrences order by id'),saved.media);
  assert.deepEqual((await rows("select value from public.syncview_runtime_flags where key='native_brief_media'"))[0].value,saved.flag);
  const beforeIds=await rows('select id from public.deliverables order by id');
  const reply=await complete(saved.accepted.hash);assert.equal(reply.status,200,JSON.stringify(reply));
  assert.deepEqual((await rows("select * from public.calendar_posts where client='recovery-f44'"))[0],saved.card);
  assert.deepEqual(await rows('select id from public.deliverables order by id'),beforeIds);
  const group=await owner(saved.accepted.hash);assert.equal(group.origin_actor,'public-intake');assert.deepEqual(group.native_request,saved.group.native_request);assert.deepEqual(group.received,saved.group.received);
  const inbox=await gw.post({action:'legacy_intake_triage_list'});assert.equal(inbox.status,200);
  assert.equal(inbox.json.rows.find(r=>r.payload_hash===saved.pending.hash).state,'triage');
  assert.equal(inbox.json.rows.find(r=>r.payload_hash===saved.debt.hash).historical_only,true);
  for(const statement of [
    `update public.linear_intake_receipts set status='pending',attempts=attempts+1,replay_note='{}',updated_at=now() where receipt_key=${q(saved.accepted.key)}`,
    `insert into public.linear_intake_receipts(receipt_key,payload_hash,client,team,payload_json) values(${q(saved.pending.key.replace(':video:',':graphics:'))},${q(saved.pending.hash)},'Recovery F44 Fixture','graphics',${q(saved.pending.canonical)})`]){
    const refused=await runSql('set role service_role;'+statement);assert.notEqual(refused.status,0);assert.match(refused.stderr,/legacy_intake_native_owned/);
  }
  for(const role of ['anon','authenticated'])for(const table of ['public_intake_log','legacy_intake_native_triage','native_brief_media_occurrences'])assert.notEqual((await runSql(`set role ${role};select * from public.${table}`)).status,0);
  for(const statement of ['update public.native_brief_media_occurrences set state=state','delete from public.native_brief_media_occurrences','truncate public.native_brief_media_occurrences'])assert.notEqual((await runSql('set role service_role;'+statement)).status,0);
  // The positive unique-index shape is checked directly rather than accepting
  // an unrelated row constraint failure as evidence of content deduplication.
  const verified=saved.media.find(r=>r.state==='verified'),nextId=crypto.randomUUID();
  const same={...verified,id:nextId,storage_path:verified.content_sha256+'/'+nextId,source_updated_at:'2026-09-08T00:00:00Z'};
  const unique=await runSql(`set role service_role;insert into public.native_brief_media_occurrences select (jsonb_populate_record(null::public.native_brief_media_occurrences,${q(JSON.stringify(same))}::jsonb)).*;`);
  assert.notEqual(unique.status,0);assert.match(unique.stderr,/native_brief_media_verified_occurrence/);
  result={replayed:1,pending_preserved:true,historical_hold_preserved:true,provider_fences_preserved:true,media_table_only:true,owner_receipt_bytes_recovered:false,object_bytes_recovered:false};
}else throw Error('unknown_v9_phase');
result.provider_attempts=gw.net.requests.filter(r=>/api\.linear\.app|linear-outbound/.test(r.url)).length;assert.equal(result.provider_attempts,0);
fs.writeFileSync(process.env.CARD_MATERIALIZATION_PHASE_REPORT,JSON.stringify(result,null,2));
